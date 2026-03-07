// scraper.js — AmbientScore URL scraper with SSRF protection
// Fetches a URL, parses HTML with cheerio, extracts conversion-relevant elements

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const dns = require('dns');
const { promisify } = require('util');

const dnsResolve = promisify(dns.resolve4);

// ── SSRF Protection ──────────────────────────────────────────────

const BLOCKED_PROTOCOLS = new Set(['file:', 'ftp:', 'data:', 'javascript:', 'gopher:']);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  '169.254.169.254'   // Azure/AWS/GCP IMDS
]);

function isBlockedIP(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1') return true;
  const parts = ip.split('.');
  if (parts.length !== 4) return false; // let IPv6 through for now, block specific
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local / IMDS)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

async function validateUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Protocol check
  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Blocked protocol: ' + parsed.protocol);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS URLs are supported');
  }

  // Hostname check
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Blocked hostname: ' + hostname);
  }

  // IP literal check
  if (isBlockedIP(hostname)) {
    throw new Error('Internal/private IP addresses are not allowed');
  }

  // DNS resolution check (prevents DNS rebinding)
  try {
    const addresses = await dnsResolve(hostname);
    for (const addr of addresses) {
      if (isBlockedIP(addr)) {
        throw new Error('URL resolves to a blocked internal IP address');
      }
    }
  } catch (err) {
    if (err.message.includes('blocked')) throw err;
    // DNS resolution failure — could be IP literal or unreachable
    if (isBlockedIP(hostname)) {
      throw new Error('Internal/private IP addresses are not allowed');
    }
  }

  return parsed;
}

// ── HTML Extraction Helpers ──────────────────────────────────────

const CTA_KEYWORDS = /get started|sign up|buy|purchase|subscribe|try|start|book|schedule|contact|request|download|join|register|claim|order|add to cart|checkout|apply|enroll/i;
const TRUST_KEYWORDS = /testimonial|review|rated|stars?|trust|certified|secure|guarantee|money.?back|refund|verified|award|featured in|as seen|client|partner/i;

function extractCTAs($) {
  const ctas = [];
  // Buttons
  $('button, [role="button"], input[type="submit"], a.btn, a.button, .cta').each(function () {
    const text = $(this).text().trim();
    if (text && text.length < 100) {
      ctas.push({
        text: text,
        tag: this.tagName.toLowerCase(),
        href: $(this).attr('href') || null,
        classes: $(this).attr('class') || ''
      });
    }
  });
  // Links with CTA keywords
  $('a').each(function () {
    const text = $(this).text().trim();
    if (text && CTA_KEYWORDS.test(text) && text.length < 100) {
      const existing = ctas.find(c => c.text === text);
      if (!existing) {
        ctas.push({
          text: text,
          tag: 'a',
          href: $(this).attr('href') || null,
          classes: $(this).attr('class') || ''
        });
      }
    }
  });
  return ctas.slice(0, 20); // cap
}

function extractForms($) {
  const forms = [];
  $('form').each(function () {
    const fields = [];
    $(this).find('input, select, textarea').each(function () {
      const type = $(this).attr('type') || this.tagName.toLowerCase();
      const name = $(this).attr('name') || $(this).attr('placeholder') || '';
      if (type !== 'hidden' && type !== 'submit') {
        fields.push({ type: type, name: name });
      }
    });
    forms.push({
      action: $(this).attr('action') || '',
      method: $(this).attr('method') || 'get',
      fieldCount: fields.length,
      fields: fields.slice(0, 15)
    });
  });
  return forms.slice(0, 10);
}

function extractSocialProof($) {
  const elements = [];

  // Testimonials (common patterns)
  $('[class*="testimonial"], [class*="review"], [class*="quote"], blockquote, [class*="social-proof"]').each(function () {
    const text = $(this).text().trim().substring(0, 300);
    if (text.length > 20) {
      elements.push({ type: 'testimonial', content: text });
    }
  });

  // Client logos
  $('[class*="logo"], [class*="client"], [class*="partner"], [class*="trusted"]').each(function () {
    const imgs = $(this).find('img');
    if (imgs.length > 0) {
      elements.push({
        type: 'logo_bar',
        count: imgs.length,
        alts: imgs.map(function () { return $(this).attr('alt') || ''; }).get().filter(Boolean).slice(0, 10)
      });
    }
  });

  // Trust badges
  $('[class*="badge"], [class*="trust"], [class*="secure"], [class*="certified"]').each(function () {
    const text = $(this).text().trim().substring(0, 100);
    if (text.length > 3) {
      elements.push({ type: 'badge', content: text });
    }
  });

  // Stats/numbers
  $('[class*="stat"], [class*="metric"], [class*="number"], [class*="counter"]').each(function () {
    const text = $(this).text().trim().substring(0, 100);
    if (text.length > 3) {
      elements.push({ type: 'stat', content: text });
    }
  });

  // Look for trust keywords in body text
  $('p, span, div').each(function () {
    const text = $(this).text().trim();
    if (TRUST_KEYWORDS.test(text) && text.length > 20 && text.length < 200) {
      const existing = elements.find(e => e.content === text);
      if (!existing && elements.length < 20) {
        elements.push({ type: 'trust_mention', content: text });
      }
    }
  });

  return elements.slice(0, 20);
}

function extractPricing($) {
  const pricing = [];
  $('[class*="pricing"], [class*="price"], [class*="plan"], [class*="tier"]').each(function () {
    const text = $(this).text().trim().substring(0, 300);
    if (text.length > 10) {
      pricing.push(text);
    }
  });
  // Also look for dollar/currency signs
  const bodyText = $('body').text();
  const priceMatches = bodyText.match(/\$[\d,]+(?:\.\d{2})?(?:\s*\/\s*\w+)?/g);
  if (priceMatches) {
    pricing.push(...priceMatches.slice(0, 10));
  }
  return [...new Set(pricing)].slice(0, 10);
}

function extractImages($) {
  const images = [];
  $('img').each(function () {
    const src = $(this).attr('src') || '';
    const alt = $(this).attr('alt') || '';
    if (src) {
      images.push({ src: src.substring(0, 200), alt: alt.substring(0, 100), hasAlt: alt.length > 0 });
    }
  });
  const totalImages = images.length;
  const imagesWithAlt = images.filter(i => i.hasAlt).length;
  return {
    total: totalImages,
    withAlt: imagesWithAlt,
    altCoverage: totalImages > 0 ? Math.round((imagesWithAlt / totalImages) * 100) : 0,
    samples: images.slice(0, 5)
  };
}

function extractNavigation($) {
  const navLinks = [];
  $('nav a, [role="navigation"] a, header a').each(function () {
    const text = $(this).text().trim();
    const href = $(this).attr('href') || '';
    if (text && text.length < 60) {
      navLinks.push({ text: text, href: href });
    }
  });
  return {
    linkCount: navLinks.length,
    links: navLinks.slice(0, 20)
  };
}

function extractLinks($, baseUrl) {
  const internal = [];
  const external = [];
  let baseDomain;
  try { baseDomain = new URL(baseUrl).hostname; } catch { baseDomain = ''; }

  $('a[href]').each(function () {
    const href = $(this).attr('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname === baseDomain) {
        internal.push(resolved.pathname);
      } else {
        external.push(resolved.hostname);
      }
    } catch { /* skip malformed */ }
  });

  return {
    internal: [...new Set(internal)].slice(0, 30),
    external: [...new Set(external)].slice(0, 20)
  };
}

function extractSchemaOrg($) {
  const schemas = [];
  $('script[type="application/ld+json"]').each(function () {
    try {
      const data = JSON.parse($(this).html());
      schemas.push(data);
    } catch { /* malformed JSON-LD */ }
  });
  return schemas.slice(0, 5);
}

function extractOpenGraph($) {
  const og = {};
  $('meta[property^="og:"]').each(function () {
    const prop = $(this).attr('property').replace('og:', '');
    og[prop] = $(this).attr('content') || '';
  });
  return og;
}

function extractBodyText($) {
  // Remove scripts, styles, nav, footer for cleaner text
  const clone = $.root().clone();
  clone.find('script, style, nav, footer, noscript, svg, [aria-hidden="true"]').remove();
  let text = clone.find('body').text();
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text.substring(0, 8000);
}

// ── Main Scraper ─────────────────────────────────────────────────

async function scrapeUrl(urlStr) {
  // Validate URL (SSRF protection)
  const parsed = await validateUrl(urlStr);

  const startTime = Date.now();

  // Fetch HTML
  let response;
  try {
    response = await axios.get(parsed.href, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      responseType: 'text',
      // Limit response size to 5MB
      maxContentLength: 5 * 1024 * 1024,
      // Don't throw on 4xx so we can inspect the body for Cloudflare signatures
      validateStatus: function (s) { return s < 500; }
    });
  } catch (fetchErr) {
    // Network-level errors (timeout, DNS, connection refused)
    const msg = fetchErr.message || '';
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) throw new Error('SITE_TIMEOUT: ' + parsed.hostname);
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) throw new Error('SITE_UNREACHABLE: ' + parsed.hostname);
    throw fetchErr;
  }

  // ── Bot-protection detection ────────────────────────────────────
  const fetchTimeMs = Date.now() - startTime;
  const html = typeof response.data === 'string' ? response.data : '';
  const cfRay = response.headers['cf-ray'] || '';
  const server = (response.headers['server'] || '').toLowerCase();
  const contentType = (response.headers['content-type'] || '').toLowerCase();
  const isHtmlIsh = contentType.includes('html') || contentType.includes('text') || html.trimStart().startsWith('<');

  // Only inspect body for WAF fingerprints if the response looks like HTML
  const htmlLower = isHtmlIsh ? html.substring(0, 5000).toLowerCase() : '';
  const titleMatch = htmlLower.match(/<title[^>]*>(.*?)<\/title>/);
  const pageTitle = titleMatch ? titleMatch[1] : '';

  // Cloudflare fingerprint: need 2+ signals to confirm (avoids false positives)
  const cfSignals = [
    cfRay ? 1 : 0,
    server.includes('cloudflare') ? 1 : 0,
    htmlLower.includes('cf-ray') ? 1 : 0,
    htmlLower.includes('cloudflare') ? 1 : 0,
    htmlLower.includes('cf-challenge') || htmlLower.includes('cf_turnstile') || htmlLower.includes('cf_clearance') ? 1 : 0,
    htmlLower.includes('challenge-platform') ? 1 : 0,
    htmlLower.includes('attention required') ? 1 : 0,
    htmlLower.includes('just a moment') ? 1 : 0,
    htmlLower.includes('checking your browser') ? 1 : 0,
    pageTitle.includes('just a moment') || pageTitle.includes('attention required') ? 1 : 0
  ].reduce(function (a, b) { return a + b; }, 0);
  const isCloudflare = cfSignals >= 2;

  // Build block metadata for logging
  const blockMeta = {
    status: response.status,
    provider: isCloudflare ? 'cloudflare' : (server.includes('akamai') ? 'akamai' : 'unknown'),
    hostname: parsed.hostname,
    finalUrl: response.request?.res?.responseUrl || parsed.href,
    cfRay: cfRay || null,
    server: server || null,
    contentType: contentType || null,
    bodyPreview: html.substring(0, 120),
    cfSignals: cfSignals
  };

  if (response.status === 403 || response.status === 401) {
    const err = new Error(isCloudflare
      ? 'SITE_BLOCKED_CLOUDFLARE: ' + parsed.hostname + ' is protected by Cloudflare'
      : 'SITE_BLOCKED: ' + parsed.hostname + ' returned ' + response.status);
    err.blockMeta = blockMeta;
    throw err;
  }

  // Catch challenge pages that return 200 (Cloudflare interstitials)
  if (isHtmlIsh && isCloudflare && html.length < 50000) {
    // Challenge pages are small + have CF fingerprints — real pages are larger
    const hasRealContent = htmlLower.includes('<article') || htmlLower.includes('<main') ||
      htmlLower.includes('</p>') || html.length > 20000;
    if (!hasRealContent) {
      const err = new Error('SITE_BLOCKED_CLOUDFLARE: ' + parsed.hostname + ' served a Cloudflare challenge page');
      err.blockMeta = blockMeta;
      throw err;
    }
  }

  // Check content type (contentType already extracted above for WAF detection)
  if (!contentType.includes('html') && !contentType.includes('text')) {
    throw new Error('URL did not return HTML content (got: ' + contentType.split(';')[0] + ')');
  }

  const $ = cheerio.load(html);
  const bodyText = extractBodyText($);
  const links = extractLinks($, parsed.href);

  const result = {
    url: urlStr,
    finalUrl: response.request?.res?.responseUrl || parsed.href,
    statusCode: response.status,
    fetchTimeMs: fetchTimeMs,
    title: $('title').text().trim(),
    metaDescription: $('meta[name="description"]').attr('content') || '',
    h1: $('h1').map(function () { return $(this).text().trim(); }).get().filter(Boolean),
    h2: $('h2').map(function () { return $(this).text().trim(); }).get().filter(Boolean),
    h3: $('h3').map(function () { return $(this).text().trim(); }).get().filter(Boolean).slice(0, 10),
    ctas: extractCTAs($),
    forms: extractForms($),
    socialProof: extractSocialProof($),
    pricing: extractPricing($),
    images: extractImages($),
    navigation: extractNavigation($),
    internalLinks: links.internal,
    externalLinks: links.external,
    bodyText: bodyText,
    wordCount: bodyText.split(/\s+/).filter(Boolean).length,
    schemaOrg: extractSchemaOrg($),
    openGraph: extractOpenGraph($),
    jsRenderedWarning: bodyText.length < 200
      ? 'This page may use client-side rendering. Analysis is based on available static content and may be partial.'
      : null
  };

  return result;
}

module.exports = { scrapeUrl, validateUrl };

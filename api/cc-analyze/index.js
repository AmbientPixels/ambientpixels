// cc-analyze — POST /api/cc-analyze
// Runs ConversionCore audit pipeline and returns score + findings
// Every scan (free or paid) runs full pipeline + stores report
// Payment unlocks the full report view

const crypto = require('crypto');
const storage = require('../_utils/companyStorage');
const { analyze } = require('../_lib/conversionCore/analyzer');
const stripeClient = require('../_lib/conversionCore/stripeClient');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const MAX_FREE_PER_HOUR = 5;

// ── URL Validation ───────────────────────────────────────────────

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Rate Limiting (blob-based, per IP) ───────────────────────────

async function checkRateLimit(ip) {
  const key = 'cc_ratelimit';
  const now = Date.now();
  const hourAgo = now - 3600000;

  let limits = await storage.getState(key) || {};

  // Clean up old entries (older than 1 hour)
  for (const k of Object.keys(limits)) {
    limits[k] = (limits[k] || []).filter(ts => ts > hourAgo);
    if (limits[k].length === 0) delete limits[k];
  }

  const ipHits = limits[ip] || [];
  if (ipHits.length >= MAX_FREE_PER_HOUR) {
    return true; // rate limited
  }

  // Record this hit
  ipHits.push(now);
  limits[ip] = ipHits;
  await storage.setState(key, limits);
  return false;
}

// ── Analytics Logging ────────────────────────────────────────────

async function logScan(event) {
  try {
    const analytics = (await storage.getState('cc_analytics')) || [];
    analytics.push(event);
    // Cap at 10000 entries, 90-day retention
    const cutoff = Date.now() - 90 * 86400000;
    const pruned = analytics.filter(e => new Date(e.timestamp).getTime() > cutoff).slice(-10000);
    await storage.setState('cc_analytics', pruned);
  } catch { /* non-critical */ }
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }

  try {
    const body = req.body || {};
    const url = (body.url || '').trim();
    const sessionId = body.sessionId || null;

    // If sessionId provided, verify payment and unlock existing report (no URL needed)
    if (sessionId) {
      const payment = await stripeClient.verifySession(sessionId);
      if (payment.valid && payment.metadata && payment.metadata.reportId) {
        const existingId = payment.metadata.reportId;
        const existing = await storage.getState('cc_report_' + existingId);
        if (existing) {
          existing.unlocked = true;
          existing.paidAt = new Date().toISOString();
          existing.customerEmail = payment.customerEmail || null;
          existing.priceType = payment.metadata.priceType || 'single';
          await storage.setState('cc_report_' + existingId, existing);

          // Grant pack credits if this was a 3-pack purchase (idempotent with webhook)
          var packCreditsRemaining = null;
          if (payment.metadata.priceType === 'pack' && payment.customerEmail) {
            try {
              const creditUtils = require('../_lib/conversionCore/creditUtils');
              var creditResult = await creditUtils.grantPackCredits({
                email: payment.customerEmail,
                stripeSessionId: sessionId,
                reportId: existingId
              });
              if (creditResult) {
                packCreditsRemaining = creditResult.credits;
              } else {
                // Webhook already processed — read existing record
                var creditsKey = creditUtils.emailToCreditsKey(payment.customerEmail);
                var existingCredits = await storage.getState(creditsKey);
                if (existingCredits) packCreditsRemaining = existingCredits.credits;
              }
            } catch (creditErr) {
              context.log.warn('[cc-analyze] Credit creation failed (non-fatal):', creditErr.message);
            }
          }

          context.res = {
            status: 200,
            headers: CORS,
            body: JSON.stringify({
              ok: true,
              reportId: existingId,
              score: existing.score,
              grade: existing.grade,
              isPaid: true,
              reportUrl: '/conversioncore/report.html?id=' + existingId,
              priceType: payment.metadata.priceType || 'single',
              packCreditsRemaining: packCreditsRemaining
            })
          };
          return;
        }
      }
      // If verification failed, fall through to normal flow
    }

    // Validate URL
    if (!url || !isValidUrl(url)) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'A valid HTTP/HTTPS URL is required.' }) };
      return;
    }

    // Rate limit check
    if (!sessionId) {
      const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-client-ip'] || 'unknown').split(',')[0].trim();
      const limited = await checkRateLimit(clientIp);
      if (limited) {
        context.res = { status: 429, headers: CORS, body: JSON.stringify({ error: 'Rate limit exceeded. Maximum ' + MAX_FREE_PER_HOUR + ' free scans per hour. Upgrade for unlimited access.' }) };
        return;
      }
    }

    // If createCheckout requested, create Stripe session and return URL
    // Reuse existing reportId from free scan if provided (report already in blob)
    if (body.createCheckout) {
      const reportId = body.reportId || ('ccr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
      const priceType = body.priceType === 'pack' ? 'pack' : 'single';
      const checkout = await stripeClient.createCheckoutSession({
        reportId: reportId,
        url: url,
        email: body.email || '',
        priceType: priceType
      });

      // Only run analysis if no existing report (i.e. no reportId was provided)
      if (!body.reportId) {
        analyze(url).then(async (result) => {
          result.fullReport.id = reportId;
          await storage.setState('cc_report_' + reportId, result.fullReport);
          await logScan({ reportId, url, tier: 'paid-' + priceType, score: result.score, timestamp: new Date().toISOString() });
        }).catch(err => {
          context.log.error('[cc-analyze] Background analysis failed for ' + reportId + ':', err.message);
        });
      }

      context.res = {
        status: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          reportId: reportId,
          checkoutUrl: checkout.checkoutUrl,
          sessionId: checkout.sessionId
        })
      };
      return;
    }

    // Generate report ID for free scan
    const reportId = 'ccr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

    // Free scan — run full pipeline, store report (locked)
    const result = await analyze(url);
    result.fullReport.id = reportId;
    await storage.setState('cc_report_' + reportId, result.fullReport);

    // Log analytics
    await logScan({ reportId, url, tier: 'free', score: result.score, timestamp: new Date().toISOString() });

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        reportId: reportId,
        score: result.score,
        grade: result.grade,
        teaserFindings: result.teaserFindings,
        blurredCount: result.totalFindings > 3 ? result.totalFindings - 3 : 0,
        totalFindings: result.totalFindings,
        isPaid: false,
        jsRenderedWarning: result.fullReport.jsRenderedWarning || null
      })
    };

  } catch (err) {
    context.log.error('[cc-analyze] Error:', err.message || err);
    const status = err.message && (err.message.includes('Blocked') || err.message.includes('not allowed') || err.message.includes('Invalid URL'))
      ? 400 : 500;
    const msg = status === 400 ? err.message : 'Analysis failed: ' + (err.message || 'unknown error').substring(0, 200);
    context.res = { status: status, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};

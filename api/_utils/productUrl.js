// productUrl.js — send a post to the page it is actually about.
//
// THE BUG (live, 2026-08-08, twice, AFTER the www campaign-URL fix shipped):
// Echo creates social_post.schedule actions with NO taskId and NO campaign_id,
// so the campaign-URL resolution fixed earlier never runs for them. Echo writes
// the bare domain itself and the post goes out pointing at the front page:
//
//   "...When you're job hunting, 'looks great' doesn't pay the bills.
//    #jobsearch #resume #careers https://ambientpixels.ai"
//
// A post about resumes sending its clicks to the company homepage, against an
// objective measured in Resume Roast RUNS.
//
// Name matching alone cannot fix it: neither post names a product. They are
// topical, so resolution reads what the copy is ABOUT and falls back to leaving
// the link alone when it cannot tell. Guessing wrong is worse than the homepage.
//
// URLs live in _data/product-facts.json next to the claims they belong to, so
// there is one product source of truth rather than a second list to drift.
//
// Pure. No I/O beyond the facts file it requires at load.

'use strict';

const _facts = (require('../_data/product-facts.json').products) || {};

// Bare homepage: our domain with NO path. The negative lookahead is what keeps
// /resume-roast/ and /blog/... untouched — those are already correct.
const BARE_HOME_RE = /https?:\/\/(?:www\.)?ambientpixels\.ai(?![\/\w-])(\?[^\s)]*)?/gi;

// Topic → product, for copy that never names the product. Ordered: the first
// match wins, so the narrower audience (job seekers) is tested before the more
// general site-critique vocabulary.
const TOPIC_HINTS = [
  { product: 'ResumeRoast', re: /\b(resume|r[eé]sum[eé]|cv|ats|applicant tracking|cover letter|job search|job hunt|job hunting|job application|hiring manager|recruiter|laid off)\b/i },
  { product: 'AmbientScore', re: /\b(landing page|home ?page|conversion|cta|call to action|above the fold|bounce rate|signup flow|main button|your site|your website)\b/i },
  { product: 'PixelAgents', re: /\b(ai agent|ai agents|agent marketplace|prebuilt agent)\b/i }
];

function _urlFor(productKey) {
  const p = productKey && _facts[productKey];
  return (p && p.url) || null;
}

/**
 * Which product page this copy should point at, or null when it cannot be told.
 * Explicit product names win over topic hints.
 * @returns {?string} absolute url
 */
function resolveProductUrl(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const hay = text.toLowerCase();

  // Longest name first so "AmbientScore" beats "AmbientOS" in mixed copy.
  const names = Object.keys(_facts).sort(function (a, b) { return b.length - a.length; });
  for (const n of names) {
    if (n !== 'AmbientOS' && hay.indexOf(n.toLowerCase()) !== -1) return _urlFor(n);
  }
  const loose = { 'pixel agents': 'PixelAgents', 'story forge': 'StoryForge', 'card forge': 'CardForge', 'ambient score': 'AmbientScore', 'resume roast': 'ResumeRoast' };
  for (const k of Object.keys(loose).sort(function (a, b) { return b.length - a.length; })) {
    if (hay.indexOf(k) !== -1) return _urlFor(loose[k]);
  }
  for (const h of TOPIC_HINTS) {
    if (h.re.test(text)) return _urlFor(h.product);
  }
  return null;
}

/**
 * Replace a BARE homepage link with the product page the copy is about.
 * Leaves everything else alone: links that already carry a path are correct,
 * third-party domains are never ours to rewrite, and copy whose product cannot
 * be resolved keeps the homepage rather than being sent somewhere invented.
 * Any query string on the bare link is carried across so UTM survives.
 */
function repairBareHomepageUrl(text) {
  if (typeof text !== 'string' || !text) return text;
  BARE_HOME_RE.lastIndex = 0;
  if (!BARE_HOME_RE.test(text)) return text;
  const target = resolveProductUrl(text);
  if (!target) return text;
  BARE_HOME_RE.lastIndex = 0;
  return text.replace(BARE_HOME_RE, function (_m, query) { return target + (query || ''); });
}

module.exports = { resolveProductUrl, repairBareHomepageUrl, BARE_HOME_RE };

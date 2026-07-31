// Outcome attribution for outbound social copy — pure string transforms.
//
// Revenue Seasons attributes a sale by matching utm_content to the originating
// social action id (rewards-engine.js:390). Scheduled posts have carried that tag
// since Outcome Attribution Phase 2, but prospect REPLIES never did (0/24 coverage
// as of 2026-07-31), which is why 100% of the first $398 was unattributable.
//
// Two things here that the scheduled-post path's inline version does NOT handle,
// and which a naive copy of it would get wrong on replies:
//
//   1. Reply links already carry a query string (?id=ccr_...), so the separator
//      must be '&'. (The inline version does handle this; kept here deliberately.)
//   2. Replies put the link INLINE after a colon — "Full report here: https://..."
//      — whereas the scheduled trim only protects a link sitting on its own line.
//      Reusing that trim would hard-cut the report link off the end of every reply.
//
// NOTE: agent-runner.js still has an equivalent injection inline near the
// social_post.schedule creation. It works and is verified in production, so it was
// deliberately left alone rather than migrated in the same change. Consolidate onto
// this module next time that path is touched.
//
// Spec: docs/superpowers/specs/2026-07-31-prospect-reply-attribution-design.md

'use strict';

// Own-domain URLs only. Third-party links in copy must never be rewritten.
const OWN_URL_RE = /https?:\/\/(?:www\.)?ambientpixels\.ai(?:\/[^\s)]*)?/gi;

function _suffix(platform, actionId) {
  return 'utm_source=' + encodeURIComponent(String(platform || '')) +
         '&utm_content=' + encodeURIComponent(String(actionId || ''));
}

// Tag every untagged own-domain URL with this action's id. Idempotent: a URL that
// already carries any utm_ is left exactly as-is, so a re-draft cannot double-stamp.
function injectUtm(text, platform, actionId) {
  const src = String(text == null ? '' : text);
  if (!src) return '';
  const suf = _suffix(platform, actionId);
  return src.replace(OWN_URL_RE, function (url) {
    if (url.indexOf('utm_') !== -1) return url;
    return url + (url.indexOf('?') !== -1 ? '&' : '?') + suf;
  });
}

// Exactly how many characters injectUtm will add — so a caller can reserve the
// headroom before trimming instead of discovering the overflow afterwards.
function utmReserve(text, platform, actionId) {
  const src = String(text == null ? '' : text);
  if (!src) return 0;
  const urls = src.match(OWN_URL_RE) || [];
  const untagged = urls.filter(function (u) { return u.indexOf('utm_') === -1; });
  return untagged.length * (1 + _suffix(platform, actionId).length); // 1 = '?' or '&'
}

// Trim to `limit`, cutting prose rather than the trailing link. Unlike the
// scheduled-post trim this accepts a link preceded by a space, not just a newline,
// because that is the shape prospect replies actually use.
function trimPreservingTrailingUrl(text, limit) {
  const src = String(text == null ? '' : text);
  if (src.length <= limit) return src;

  const m = src.match(/(\s+)(https?:\/\/\S+)\s*$/);
  const suffix = m ? (m[1] + m[2]) : '';
  const body = suffix ? src.substring(0, src.length - suffix.length) : src;
  const maxBody = limit - suffix.length;

  if (maxBody > 40) {
    let trimmed = body.substring(0, maxBody);
    const lastSentence = trimmed.match(/^([\s\S]*[.!?])\s/);
    if (lastSentence && lastSentence[1].length > maxBody * 0.5) {
      trimmed = lastSentence[1];
    } else {
      trimmed = trimmed.substring(0, trimmed.lastIndexOf(' ')) || trimmed;
    }
    return (trimmed.trim() + suffix).trim();
  }
  if (m) {
    // No body budget left, but there IS a link — a bare link beats no link, since
    // the link is the only thing in the reply a prospect can act on.
    return m[2].substring(0, limit);
  }
  return src.substring(0, limit - 1).trim() + '…';
}

module.exports = { injectUtm, utmReserve, trimPreservingTrailingUrl, OWN_URL_RE };

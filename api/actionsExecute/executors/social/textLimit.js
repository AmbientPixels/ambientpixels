'use strict';

/**
 * Truncate `text` to at most `maxChars` characters WITHOUT dropping a trailing link.
 *
 * Promo copy puts the CTA URL (optionally followed by hashtags) at the END of the post.
 * A naive tail-chop (`text.substring(0, max)`) deletes exactly that — the reader is left
 * with a post they can't act on. This trims the PROSE and keeps the link (plus anything
 * after it, e.g. hashtags) intact. Last-resort safety net; upstream should keep posts in
 * budget so this rarely fires.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncatePreservingUrl(text, maxChars) {
  var s = String(text || '');
  if (s.length <= maxChars) return s;

  // Locate the LAST http(s) URL — the clickable CTA link normally sits at the end.
  var urlRe = /https?:\/\/[^\s)]+/g;
  var m;
  var last = null;
  while ((m = urlRe.exec(s)) !== null) {
    last = { url: m[0], start: m.index };
  }

  // No link, or the link alone already blows the budget → clean word-boundary tail-chop.
  if (!last || last.url.length + 2 > maxChars) {
    return s.substring(0, maxChars - 1).replace(/\s+\S*$/, '') + '…';
  }

  // Everything from the link to the end (URL + any trailing hashtags) is protected.
  var tail = s.substring(last.start).trim();
  var head = s.substring(0, last.start).trim();
  var budget = maxChars - tail.length - 2; // reserve 2 chars for the "\n\n" separator

  if (budget < 1) {
    // Only the link fits — ship the link by itself rather than a truncated one.
    return tail.length <= maxChars ? tail : tail.substring(0, maxChars);
  }
  if (head.length > budget) {
    head = head.substring(0, budget - 1).replace(/\s+\S*$/, '') + '…';
  }
  return (head + '\n\n' + tail).trim();
}

module.exports = { truncatePreservingUrl };

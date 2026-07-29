'use strict';

// titleSimilarity — fuzzy title match for objective/campaign proposal dedup.
// Extracted from companyHeartbeat/helpers.js (which re-exports it) so pure
// modules like proposalDecide/materialize.js can use it without pulling the
// heartbeat's storage/gemini requires. Single source of truth — do not copy
// this implementation elsewhere.
//
// The exact-title checks let rewordings through — three first-customer
// objectives went live simultaneously (obj-first-customer / obj-mrz8kvg9 /
// obj-ms2msmuy, CEO escalation 2026-07-27). Stopword-strip + crude suffix
// stem, scored as overlap over the smaller token set. 0.6+ = same intent.
// Lexically distant paraphrases (e.g. "Achieve Budget Compliance" vs
// "Implement Financial Guardrails") still score low — the north-star-metric
// checks in the proposal gates cover that class.
var _TITLE_STOPWORDS = {
  the: 1, a: 1, an: 1, to: 1, of: 1, for: 1, via: 1, and: 1, or: 1, in: 1, on: 1,
  by: 1, with: 1, our: 1, your: 1, my: 1, this: 1, that: 1, is: 1, are: 1, be: 1,
  at: 1, as: 1, from: 1, into: 1, it: 1, its: 1, new: 1
};

function _stemTitleToken(w) {
  // Plural first so 'customers' and 'customer' reach the same suffix rules —
  // stripping in the other order left them at different stems.
  if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
  if (w.length > 5 && /er$/.test(w)) return w.slice(0, -2);
  if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
  return w;
}

function titleSimilarity(a, b) {
  function toks(s) {
    var seen = {};
    String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).forEach(function (w) {
      if (!w || w.length < 3 || _TITLE_STOPWORDS[w]) return;
      seen[_stemTitleToken(w)] = 1;
    });
    return Object.keys(seen);
  }
  var ta = toks(a), tb = toks(b);
  if (!ta.length || !tb.length) return 0;
  var setB = {};
  tb.forEach(function (w) { setB[w] = 1; });
  var overlap = ta.filter(function (w) { return setB[w]; }).length;
  return overlap / Math.min(ta.length, tb.length);
}

module.exports = { titleSimilarity: titleSimilarity };

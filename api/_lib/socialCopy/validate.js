// validate.js — deterministic post-checks. Pure: no I/O, no model.
//
// These run BEFORE the quality gate, which is fail-open. A regex costs nothing
// and catches the failures a small model actually produces: preamble, refusals,
// a dropped URL, over-length, and the buzzwords that make copy read as AI
// marketing.

const { platformRule, BANNED_WORDS } = require('./voice');

const PREAMBLE_RX = /^\s*(here('| i)s|this is|sure[,!]|okay[,!]|i'?ve written|draft:|post:)/i;
const REFUSAL_RX = /\b(i (cannot|can't|am unable to)|as an ai|i'm sorry, but)\b/i;

function validateCopy(text, opts) {
  opts = opts || {};
  const s = String(text == null ? '' : text).trim();
  const problems = [];

  if (!s) return { ok: false, problems: ['empty output'] };

  const rule = platformRule(opts.platform);
  if (!rule) problems.push('unsupported platform "' + opts.platform + '"');
  else if (s.length > rule.maxLen) problems.push('too long: ' + s.length + ' chars, limit is ' + rule.maxLen);

  if (REFUSAL_RX.test(s)) problems.push('reads as a refusal, which would be published as the post');
  if (PREAMBLE_RX.test(s)) problems.push('starts with preamble, which would be published verbatim');

  const url = String(opts.url || '').trim();
  if (url) {
    const n = s.split(url).length - 1;
    if (n === 0) problems.push('missing the required url ' + url);
    else if (n > 1) problems.push('the url appears ' + n + ' times; include it exactly once');
  }

  if (/—|--/.test(s)) problems.push('contains an em dash or double hyphen');

  const lower = s.toLowerCase();
  BANNED_WORDS.forEach(function (w) {
    if (lower.includes(w)) problems.push('contains the banned word "' + w + '"');
  });

  return { ok: problems.length === 0, problems: problems };
}

module.exports = { validateCopy };

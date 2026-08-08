// prompt.js — builds the worker's prompt. Pure: no I/O, no model, no storage.
//
// Budget: ~1,000 tokens. That number is the entire justification for this
// module — a fleet agent spends ~11,315 input tokens on the same job because it
// carries identity, memory and company doctrine it does not need in order to
// write 150 words.

const path = require('path');
const { VOICE_RULES, platformRule } = require('./voice');

// Loaded once at require time. product-facts.json is the source of truth for
// what we may claim; Nova owns it. Injecting the relevant entry is far cheaper
// than letting a weak model guess and relying on the gate to catch it.
let PRODUCT_FACTS = {};
try {
  PRODUCT_FACTS = require(path.join(__dirname, '..', '..', '_data', 'product-facts.json')).products || {};
} catch (e) {
  PRODUCT_FACTS = {};
}

// ~4 chars per token is close enough to bound a budget; this is a guardrail,
// not billing.
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function factsBlock(productKey) {
  const f = PRODUCT_FACTS[productKey];
  if (!f) return '';
  const lines = ['TRUE FACTS ABOUT THIS PRODUCT (do not state anything outside this list):'];
  (f.features || []).slice(0, 6).forEach(x => lines.push('- ' + x));
  if ((f.notThis || []).length) {
    lines.push('WHAT IT IS NOT (getting these wrong is the most common failure):');
    (f.notThis || []).slice(0, 4).forEach(x => lines.push('- ' + x));
  }
  return lines.join('\n') + '\n\n';
}

function buildCopyPrompt(brief) {
  brief = brief || {};
  const rule = platformRule(brief.platform);
  if (!rule) throw new Error('buildCopyPrompt: unsupported platform "' + brief.platform + '"');
  const url = String(brief.url || '').trim();
  if (!url) throw new Error('buildCopyPrompt: a product url is required — every post must carry one');

  const qg = brief.qgFeedback
    ? 'A PREVIOUS ATTEMPT WAS REJECTED. Fix this and do not repeat it:\n' + brief.qgFeedback + '\n\n'
    : '';

  return [
    'Write ONE publish-ready social media post.',
    '',
    'BRIEF: ' + String(brief.title || '').slice(0, 200),
    String(brief.description || '').slice(0, 600),
    '',
    factsBlock(brief.productKey) + qg +
    'PLATFORM: ' + brief.platform + ' — max ' + rule.maxLen + ' characters. ' + rule.guidance,
    '',
    'VOICE:',
    '- ' + VOICE_RULES,
    '',
    'HARD REQUIREMENTS:',
    '- The post MUST include this URL exactly once: ' + url,
    '- Stay under ' + rule.maxLen + ' characters, including the URL.',
    '- Write exactly ONE post. Not variations, not a batch.',
    '- The first character of your reply IS the first character of the post. No preamble, no "here is the post", no rationale. Your reply is published verbatim.',
    '- Never state a number, statistic or outcome that is not in the facts above.'
  ].join('\n');
}

module.exports = { buildCopyPrompt, estimateTokens };

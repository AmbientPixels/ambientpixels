// model-registry.js — pure model routing + fallback-chain logic.
// No network, no storage: safe to require in tests. gemini.js wires these to
// the actual provider callers.

// Model IDs. Provider is inferred from the resolved id prefix (claude-* vs gemini-*).
var MODELS = {
  'claude':        'claude-sonnet-4-6',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-haiku':  'claude-haiku-4-5-20251001',
  'gemini':        'gemini-2.5-flash',
  'gemini-flash':  'gemini-2.5-flash',
  'gemini-pro':    'gemini-2.5-pro'
};

// Fixed cross-provider tail appended to every chain. Contains one Gemini and one
// Claude model so every chain reaches BOTH providers — a whole-provider outage
// never zeroes the fleet.
var FALLBACK_TAIL = ['gemini-flash', 'claude-sonnet'];

function providerOf(modelKey) {
  var id = MODELS[modelKey] || '';
  return id.indexOf('claude') === 0 ? 'claude' : 'gemini';
}

function isClaudeModel(modelKey) {
  return providerOf(modelKey) === 'claude';
}

// [configuredKey, ...FALLBACK_TAIL] deduped BY RESOLVED MODEL ID (not by key —
// 'gemini' and 'gemini-flash' both resolve to gemini-2.5-flash and must not be
// attempted twice). Unknown keys are dropped. Order preserved.
function buildChain(configuredKey) {
  var order = [configuredKey].concat(FALLBACK_TAIL);
  var seen = {};
  var chain = [];
  for (var i = 0; i < order.length; i++) {
    var key = order[i];
    var id = MODELS[key];
    if (!id) continue;
    if (seen[id]) continue;
    seen[id] = true;
    chain.push(key);
  }
  return chain;
}

// Walk the chain calling attemptFn(modelKey) => Promise<text|null>. Returns the
// first non-null text. When a non-primary answers, calls onFallback(primaryKey,
// usedKey). When the whole chain fails, calls onFallback(primaryKey, null).
async function runChain(chain, attemptFn, onFallback) {
  for (var i = 0; i < chain.length; i++) {
    var text = await attemptFn(chain[i]);
    if (text !== null && text !== undefined) {
      if (i > 0 && typeof onFallback === 'function') onFallback(chain[0], chain[i]);
      return text;
    }
  }
  if (typeof onFallback === 'function') onFallback(chain[0] || null, null);
  return null;
}

module.exports = { MODELS: MODELS, FALLBACK_TAIL: FALLBACK_TAIL, providerOf: providerOf, isClaudeModel: isClaudeModel, buildChain: buildChain, runChain: runChain };

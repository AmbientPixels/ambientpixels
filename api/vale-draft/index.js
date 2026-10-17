// vale-draft — Vale drafts an email reply (or a new email) in Chad's voice for Vale Mail.
//   POST /api/vale-draft   bearer only   { from, fromName, subject, latest, prior[], instruction,
//                                          stance, mode, to, client? }  →  { draft }
// The browser sends the text it already shows; nothing is read from the mailbox here and
// nothing is stored except an hourly call count. Client threads (rules-only domains) are
// Claude-only: noFallback, so client mail never reaches another provider. Logs carry error
// codes only — never mail text, never model error messages.
'use strict';

var draftLib = require('../_lib/vale/draft');

var RATE_KEY = 'valeDraftRate';
var RATE_LIMIT = 30;

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function json(context, status, body) { context.res = { status: status, headers: CORS, body: body }; }
function logCode(context, code) { if (context.log && context.log.error) context.log.error('[vale-draft] ' + code); }
function hourOf(ms) { return new Date(ms).toISOString().slice(0, 13); }

function parseBody(b) {
  if (typeof b !== 'string') return b;
  try { return JSON.parse(b); } catch (e) { return null; }
}

// Counts this call against the hour. Returns 'ok' | 'limited'. Throws if storage fails.
async function takeRate(store, nowMs) {
  var hour = hourOf(nowMs);
  var limited = false;
  await store.mutate(RATE_KEY, function (cur) {
    var count = (cur && cur.hour === hour && Number.isFinite(cur.count)) ? cur.count : 0;
    if (count >= RATE_LIMIT) { limited = true; return undefined; }
    return { hour: hour, count: count + 1 };
  });
  return limited ? 'limited' : 'ok';
}

// deps: { auth, store:{getWithMeta, mutate}, callModel, seedRules, voice, now }
async function handle(context, req, deps) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS, body: '' }; return; }
  if (req.method !== 'POST') return json(context, 405, { error: 'POST only.', code: 'method' });

  var gate;
  try { gate = await deps.auth(req, context, { bearerOnly: true }); }
  catch (e) { logCode(context, 'auth_error'); return json(context, 403, { error: 'Sign in with Microsoft first.', reason: 'auth_error' }); }
  if (!gate || !gate.ok || gate.via !== 'bearer') {
    return json(context, 403, { error: 'Sign in with Microsoft first.', reason: (gate && gate.reason) || 'bearer_required' });
  }

  var v = draftLib.validateDraftRequest(parseBody(req.body));
  if (!v.ok) return json(context, 400, { error: 'Invalid draft request.', code: v.code });

  try {
    try {
      if (await takeRate(deps.store, deps.now()) === 'limited') {
        return json(context, 429, { error: 'Vale has drafted a lot this hour. Try again in a bit.', code: 'rate_limited' });
      }
    } catch (e) {
      logCode(context, 'rate_store_unavailable');
      return json(context, 503, { error: 'Could not start the draft. Try again.', code: 'store_unavailable' });
    }

    // A failed rules read must not route client mail to a fallback provider: fail safe.
    var rulesMeta = await deps.store.getWithMeta('valeMailRules');
    var rules = (!rulesMeta.failed && rulesMeta.value) || deps.seedRules || {};
    // The browser may flag a client thread it can see (earlier messages, Reply-To); that only ever
    // adds Claude-only routing, never removes it.
    var client = rulesMeta.failed || draftLib.isClientThread(v.req, rules) || v.req.client === true;

    var p = draftLib.buildDraftPrompt(v.req, deps.voice, { client: client });
    var out;
    try {
      out = await deps.callModel({
        system: p.system, prompt: p.prompt, model: 'claude-sonnet', caller: 'vale-draft',
        maxTokens: 800, temperature: 0.4, noFallback: client
      });
    } catch (e) {
      if (e && e.name === 'LlmUnavailableError') {
        logCode(context, 'model_unavailable');
        return json(context, 502, { error: 'Vale could not draft right now. Try again in a minute.', code: 'model_unavailable' });
      }
      throw e;
    }

    var text = draftLib.parseDraft(out && out.text);
    if (!text) { logCode(context, 'empty_draft'); return json(context, 502, { error: 'Vale came back empty. Try again.', code: 'empty_draft' }); }
    return json(context, 200, { draft: text });
  } catch (e) {
    logCode(context, 'fault');
    return json(context, 500, { error: 'vale-draft fault', code: 'fault' });
  }
}

function defaultDeps() {
  var vs = require('../_utils/valeStorage');
  var { requireCeoAsync } = require('../_utils/valeAuth');
  return {
    auth: requireCeoAsync,
    store: { getWithMeta: vs.getValeWithMeta, mutate: vs.mutateVale },
    callModel: require('../_lib/llm').callModel,
    seedRules: require('../_data/vale-mail-rules.seed.json'),
    voice: require('../_data/vale-voice.json'),
    now: Date.now
  };
}

module.exports = async function (context, req) { return handle(context, req, defaultDeps()); };
module.exports.handle = handle;
module.exports.RATE_LIMIT = RATE_LIMIT;

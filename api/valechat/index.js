// valechat — Vale's CEO-only web chat. Modeled on novachat (single persona, model
// resolver, Gemini/Claude dual path), but: (1) CEO-gated, (2) loads Vale's isolated
// personal memory + a read-only fleet snapshot, (3) persists the conversation and can
// capture a permanent CEO correction. Vale never writes fleet state here.
// The answer itself comes from _lib/vale/chatCore, shared with the Teams chat.
'use strict';

var vs = require('../_utils/valeStorage');
var mem = require('../_utils/vale-memory');
var { requireCeoAsync, valeConfig } = require('../_utils/valeAuth');
var chatCore = require('../_lib/vale/chatCore');

module.exports = async function (context, req) {
  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, x-ms-client-principal, x-ms-client-principal-id, x-user-id',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }

  var gate = await requireCeoAsync(req, context);
  if (!gate.ok) { context.res = { status: 403, headers: corsHeaders, body: { error: 'CEO only.', reason: gate.reason } }; return; }

  if (req.method === 'GET') {
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', entity: 'Vale', message: 'Vale is here.' } };
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Vale cannot connect — API key missing.' } };
    return;
  }

  try {
    var body = req.body || {};
    var message = body.message;
    var history = body.history;
    if (!message) { context.res = { status: 400, headers: corsHeaders, body: { error: 'No message provided.' } }; return; }

    // Mail only for a verified Microsoft sign-in with mail switched on.
    var vcfg = valeConfig();
    var answer = await chatCore.answer({
      message: message, history: history, where: 'office', caller: 'valechat', log: context.log,
      includeMail: gate.via === 'bearer' && vcfg.strict && vcfg.mailEnabled
    });
    if (answer.error) { context.res = { status: answer.error.status, headers: corsHeaders, body: { error: 'Vale hit a glitch.', details: answer.error.details } }; return; }
    var reply = answer.reply;

    // Persist the exchange (ring buffer).
    var conv = (await vs.getVale('valeConversations')) || [];
    conv = mem.pushConversation(conv, { role: 'user', text: message, ts: new Date().toISOString() });
    conv = mem.pushConversation(conv, { role: 'vale', text: reply, ts: new Date().toISOString() });
    await vs.setVale('valeConversations', conv);

    // Optional memory capture. body.remember = free text to store as a preference.
    // body.correction = true stores the user's message as a PERMANENT CEO correction.
    if (body.remember || body.correction) {
      var rec = mem.makeMemory({
        type: 'preference',
        text: body.correction ? message : body.remember,
        source: body.correction ? 'auto:ceo-correction' : 'vale',
        evidence: { via: 'valechat' }
      });
      var added = mem.addMemory(answer.memories, rec);
      if (added.added) await vs.setVale('valeMemory', added.list);
    }

    // links: "[open N]" in the reply → exact Outlook URL (the page renders them; Vale never types URLs).
    context.res = { status: 200, headers: corsHeaders, body: { reply: reply, links: answer.links } };
  } catch (error) {
    context.log.error('[valechat] Internal error: ' + error.message);
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Vale experienced a system fault.', details: error.message } };
  }
};

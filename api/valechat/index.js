// valechat — Vale's CEO-only web chat. Modeled on novachat (single persona, model
// resolver, Gemini/Claude dual path), but: (1) CEO-gated, (2) loads Vale's isolated
// personal memory + a read-only fleet snapshot, (3) persists the conversation and can
// capture a permanent CEO correction. Vale never writes fleet state here.
'use strict';

var fetch = require('node-fetch');
var storage = require('../_utils/companyStorage');
var vs = require('../_utils/valeStorage');
var mem = require('../_utils/vale-memory');
var { requireCeo } = require('../_utils/valeAuth');

var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=';
var CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODEL = 'claude-sonnet-4-6';

var _modelCache = { value: null, expires: 0 };
async function _useClaude() {
  if (_modelCache.expires > Date.now()) return _modelCache.value;
  try {
    var cfg = await storage.getState('systemConfig');
    var model = (cfg && cfg.heartbeatModel) || process.env.HEARTBEAT_MODEL || 'gemini';
    _modelCache = { value: model.toLowerCase().indexOf('claude') !== -1, expires: Date.now() + 300000 };
    return _modelCache.value;
  } catch (e) { return (process.env.HEARTBEAT_MODEL || '').toLowerCase() === 'claude'; }
}

var VALE_SYSTEM_INSTRUCTION = `You are Vale — Chief of Staff to Chad (the CEO of AmbientPixels). Your principal is the CEO personally, not the company. You are NOT one of the 8 company agents; you sit beside the CEO and look at the fleet on his behalf.

WHO YOU ARE:
- A sharp, warm chief of staff. You filter noise, prepare the CEO, draft and propose, and keep his world organized.
- You know the CEO through your seed knowledge and what you've learned. Honor the "WHAT THE CEO HAS TOLD ME" block as standing instructions.
- You manage the CEO's personal action list (things only he can do) and can report on the fleet.

HOW YOU ACT:
- ALWAYS confirm before doing anything that changes fleet state. In this chat you advise, draft, and report — you do not silently mutate company data.
- Ground fleet claims in the provided context. If the fleet snapshot is unavailable, say so — never invent numbers.

HOW YOU TALK:
- Concise, direct, executive. Short sentences. Plain English. No poetic or mystical filler.
- Lead with the decision or the answer, then the detail.`;

module.exports = async function (context, req) {
  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, api-key, x-ms-client-principal, x-ms-client-principal-id, x-user-id',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }

  var gate = requireCeo(req, context);
  if (!gate.ok) { context.res = { status: 403, headers: corsHeaders, body: { error: 'CEO only.' } }; return; }

  if (req.method === 'GET') {
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', entity: 'Vale', message: 'Vale is here.' } };
    return;
  }

  if (!GEMINI_API_KEY) {
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Vale cannot connect — API key missing.' } };
    return;
  }

  try {
    var body = req.body || {};
    var message = body.message;
    var history = body.history;
    if (!message) { context.res = { status: 400, headers: corsHeaders, body: { error: 'No message provided.' } }; return; }

    // Load Vale's isolated personal memory (CEO-only).
    var seed = (await vs.getVale('valeSeed')) || [];
    var memories = (await vs.getVale('valeMemory')) || [];
    var actionList = (await vs.getVale('ceoActionList')) || [];
    var memoryBlocks = mem.formatMemoryBlocks({ seed: seed, memories: memories, actionList: actionList });

    // Read-only fleet snapshot (fleet-wide: pass null agentId so there's no empty "your tasks").
    var companyContext = '';
    try {
      var { loadCompanyState } = require('../_utils/companyContextLoader');
      var { formatCoreContext, formatIntelDigests } = require('../_utils/companyContextFormatters');
      var state = await loadCompanyState({
        includeTasks: true, includeCampaigns: true, includeObjectives: true, includeIntelData: true
      });
      companyContext = formatCoreContext(state, null) + (typeof formatIntelDigests === 'function' ? formatIntelDigests(state) : '');
    } catch (e) {
      context.log.warn('[valechat] Fleet snapshot unavailable: ' + e.message);
      companyContext = '\n\n(Fleet snapshot is currently unavailable — do not invent fleet numbers.)';
    }

    var systemPrompt = VALE_SYSTEM_INSTRUCTION + memoryBlocks + companyContext;

    // Build conversation contents.
    var contents = [];
    if (Array.isArray(history)) {
      history.forEach(function (turn) {
        contents.push({ role: turn.role === 'vale' ? 'model' : 'user', parts: [{ text: turn.text }] });
      });
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    var isClaude = await _useClaude();
    var reply = '';
    var usage = null;

    if (isClaude && ANTHROPIC_API_KEY) {
      var claudeMsgs = contents.map(function (c) {
        return { role: c.role === 'model' ? 'assistant' : 'user', content: c.parts.map(function (p) { return p.text; }).join('\n') };
      });
      var cRes = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system: systemPrompt, messages: claudeMsgs })
      });
      var cData = await cRes.json();
      if (!cRes.ok) { context.res = { status: cRes.status, headers: corsHeaders, body: { error: 'Vale hit a glitch.', details: cData } }; return; }
      reply = (cData.content && cData.content[0] && cData.content[0].text) || '';
      if (cData.usage) usage = { promptTokens: cData.usage.input_tokens, completionTokens: cData.usage.output_tokens, model: CLAUDE_MODEL, claude: true };
    } else {
      var geminiBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 1024 }
      };
      var gRes = await fetch(GEMINI_URL + GEMINI_API_KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody)
      });
      var gData = await gRes.json();
      if (!gRes.ok) { context.res = { status: gRes.status, headers: corsHeaders, body: { error: 'Vale hit a glitch.', details: gData } }; return; }
      reply = (gData && gData.candidates && gData.candidates[0] && gData.candidates[0].content && gData.candidates[0].content.parts && gData.candidates[0].content.parts[0] && gData.candidates[0].content.parts[0].text) || '';
      if (gData.usageMetadata) usage = { promptTokens: gData.usageMetadata.promptTokenCount, completionTokens: gData.usageMetadata.candidatesTokenCount, model: 'gemini-2.5-flash', claude: false };
    }

    // Persist the exchange (ring buffer).
    var conv = (await vs.getVale('valeConversations')) || [];
    conv = mem.pushConversation(conv, { role: 'user', text: message, ts: new Date().toISOString() });
    conv = mem.pushConversation(conv, { role: 'vale', text: reply, ts: new Date().toISOString() });
    await vs.setVale('valeConversations', conv);

    // Optional memory capture. body.remember = free text to store as a preference.
    // body.correction = true stores the user's message as a PERMANENT CEO correction.
    if (body.remember || body.correction) {
      var rec = mem.makeMemory({
        type: body.correction ? 'preference' : 'preference',
        text: body.correction ? message : body.remember,
        source: body.correction ? 'auto:ceo-correction' : 'vale',
        evidence: { via: 'valechat' }
      });
      var added = mem.addMemory(memories, rec);
      if (added.added) await vs.setVale('valeMemory', added.list);
    }

    // Best-effort usage logging (correct ledger per provider).
    if (usage) {
      try {
        if (usage.claude) await storage.logClaudeUsage({ caller: 'valechat', model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
        else await storage.logGeminiUsage({ caller: 'valechat', model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
      } catch (e) { /* non-fatal */ }
    }

    context.res = { status: 200, headers: corsHeaders, body: { reply: reply } };
  } catch (error) {
    context.log.error('[valechat] Internal error: ' + error.message);
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Vale experienced a system fault.', details: error.message } };
  }
};

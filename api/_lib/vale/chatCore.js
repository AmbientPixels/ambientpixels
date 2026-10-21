// chatCore — Vale's answer to one message, shared by the Office chat (api/valechat) and the
// Teams chat (api/vale-teams-bot) so the two can never drift. Builds her context (persona,
// memory, fleet snapshot, the team in HQ's numbers, mail when the caller allows it), makes one
// model call (two if she asks to search mail), and logs usage. Gating, conversation storage
// and memory capture stay with each caller.
'use strict';

var fetch = require('node-fetch');
var storage = require('../../_utils/companyStorage');
var vs = require('../../_utils/valeStorage');
var mem = require('../../_utils/vale-memory');
var { formatMailContext } = require('./mailContext');
var liveMail = require('./liveMail');
var { briefConfig, briefDeps } = require('./briefDeps');

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

var WHERE = {
  office: '',
  teams: '\n\nWHERE YOU ARE: a Microsoft Teams chat with Chad. Keep replies short enough to read on a phone. ' +
    'You cannot see his email here; if he asks about mail, say so and point him to the Office page chat.'
};

// opts: { message, history: [{role:'user'|'vale', text}], includeMail, where: 'office'|'teams', caller, log }
// Returns { reply, links, memories, usages } or { error: { status, details } }.
async function answer(opts) {
  var log = opts.log || { warn: function () {} };
  var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!GEMINI_API_KEY) return { error: { status: 500, details: 'Vale cannot connect — API key missing.' } };

  // Vale's isolated personal memory (CEO-only).
  var seed = (await vs.getVale('valeSeed')) || [];
  var memories = mem.pruneMemories((await vs.getVale('valeMemory')) || [], Date.now());
  var actionList = (await vs.getVale('ceoActionList')) || [];
  var memoryBlocks = mem.formatMemoryBlocks({ seed: seed, memories: memories, actionList: actionList });

  // Read-only fleet snapshot (fleet-wide: pass null agentId so there's no empty "your tasks").
  var companyContext = '';
  try {
    var { loadCompanyState } = require('../../_utils/companyContextLoader');
    var { formatCoreContext, formatIntelDigests } = require('../../_utils/companyContextFormatters');
    var state = await loadCompanyState({ includeTasks: true, includeCampaigns: true, includeObjectives: true, includeIntelData: true });
    companyContext = formatCoreContext(state, null) + (typeof formatIntelDigests === 'function' ? formatIntelDigests(state) : '');
  } catch (e) {
    log.warn('[vale chat] Fleet snapshot unavailable: ' + e.message);
    companyContext = '\n\n(Fleet snapshot is currently unavailable — do not invent fleet numbers.)';
  }

  // Where the team is, in HQ's own numbers: what's waiting on Chad (the approval queue the
  // snapshot above never loaded), goal, campaign pace, who has work, the last 24 hours.
  var team = require('./teamContext');
  var teamContext;
  try { teamContext = team.formatTeamContext(await team.loadTeamSummary(storage, Date.now())); }
  catch (e) { log.warn('[vale chat] Team summary unavailable: ' + e.message); teamContext = team.formatTeamContext(null); }

  // Read-only mail context, only when the caller allows it (a verified Microsoft sign-in with
  // mail switched on). Live inbox first; the last brief's summary rides along for its judgments.
  var mailContext = '';
  var live = null;
  if (opts.includeMail) {
    try {
      var bd = briefDeps(briefConfig());
      live = await liveMail.loadLiveMail({ cfg: bd.cfg, now: bd.now, fetch: bd.fetch, store: bd.store, seedRules: bd.seedRules });
    } catch (e) {
      live = { ok: false, reason: 'error' };
      log.warn('[vale chat] Live mail unavailable: ' + e.message);
    }
    if (live.ok) mailContext = live.block;
    else {
      mailContext = '\n\n(Live mail is unavailable right now (' + live.reason + ')' +
        (/reconnect|not_connected/.test(live.reason) ? ' — Chad needs to reconnect on the Office page, Mail card' : '') +
        '. Say so if asked about email; use only the summary below and never guess.)';
      live = null;
    }
    var mailMeta = await vs.getValeWithMeta('valeMailState');
    mailContext += mailMeta.failed
      ? '\n\n(The last brief\'s mail summary could not be loaded right now.)'
      : formatMailContext(mailMeta.value, Date.now());
  }

  var systemPrompt = VALE_SYSTEM_INSTRUCTION + (WHERE[opts.where] || '') + memoryBlocks + companyContext + teamContext + mailContext;

  var contents = [];
  (Array.isArray(opts.history) ? opts.history : []).forEach(function (turn) {
    contents.push({ role: turn.role === 'vale' ? 'model' : 'user', parts: [{ text: turn.text }] });
  });
  contents.push({ role: 'user', parts: [{ text: opts.message }] });

  var isClaude = await _useClaude();

  // One model call. Returns { reply, usage } or { error: { status, details } }.
  async function ask(sys) {
    if (isClaude && ANTHROPIC_API_KEY) {
      var claudeMsgs = contents.map(function (c) {
        return { role: c.role === 'model' ? 'assistant' : 'user', content: c.parts.map(function (p) { return p.text; }).join('\n') };
      });
      var cRes = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system: sys, messages: claudeMsgs })
      });
      var cData = await cRes.json();
      if (!cRes.ok) return { error: { status: cRes.status, details: cData } };
      return {
        reply: (cData.content && cData.content[0] && cData.content[0].text) || '',
        usage: cData.usage ? { promptTokens: cData.usage.input_tokens, completionTokens: cData.usage.output_tokens, model: CLAUDE_MODEL, claude: true } : null
      };
    }
    var geminiBody = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: contents,
      generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 1024 }
    };
    var gRes = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody)
    });
    var gData = await gRes.json();
    if (!gRes.ok) return { error: { status: gRes.status, details: gData } };
    return {
      reply: (gData && gData.candidates && gData.candidates[0] && gData.candidates[0].content && gData.candidates[0].content.parts && gData.candidates[0].content.parts[0] && gData.candidates[0].content.parts[0].text) || '',
      usage: gData.usageMetadata ? { promptTokens: gData.usageMetadata.promptTokenCount, completionTokens: (gData.usageMetadata.candidatesTokenCount || 0) + (gData.usageMetadata.thoughtsTokenCount || 0), model: 'gemini-2.5-flash', claude: false } : null
    };
  }

  // At most one whole-mailbox search, when Vale asks for it with a SEARCH_MAIL line.
  var result = await liveMail.answerWithSearch(ask, systemPrompt, live);
  if (result.error) return { error: result.error };

  // Best-effort usage logging (correct ledger per provider), one entry per model call.
  for (var u = 0; u < result.usages.length; u++) {
    var usage = result.usages[u];
    try {
      if (usage.claude) await storage.logClaudeUsage({ caller: opts.caller || 'valechat', model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
      else await storage.logGeminiUsage({ caller: opts.caller || 'valechat', model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
    } catch (e) { /* non-fatal */ }
  }

  return { reply: result.reply, links: (live && live.links) || {}, memories: memories, usages: result.usages };
}

module.exports = { answer, VALE_SYSTEM_INSTRUCTION };

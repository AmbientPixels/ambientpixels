// valeBriefCron — sends the CEO a morning brief (14:00 UTC) and evening wrap (01:00 UTC)
// to a dedicated Discord webhook. Isolated from the heartbeat; no-op if the webhook is
// unset. dispatchDiscord in fleetAlerts is hardcoded to DISCORD_ALERT_WEBHOOK, so this
// uses its own minimal poster reading DISCORD_VALE_WEBHOOK.
'use strict';

var fetch = require('node-fetch');
var storage = require('../_utils/companyStorage');
var vs = require('../_utils/valeStorage');
var brief = require('../_utils/vale-brief');

var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=';
var COLOR = 6266069; // soft violet

async function postToDiscord(text) {
  var url = process.env.DISCORD_VALE_WEBHOOK;
  if (!url) return false;
  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Vale — Office of the CEO', embeds: [{ description: String(text).slice(0, 3900), color: COLOR, timestamp: new Date().toISOString() }] })
    });
    return !!(res && (res.ok || res.status === 204));
  } catch (e) { return false; }
}

async function narrate(facts, kind) {
  // Best-effort LLM narration in the CEO's plain voice; falls back to deterministic text.
  var fallback = brief.formatBriefFallback(facts, kind);
  if (!GEMINI_API_KEY) return fallback;
  try {
    var prompt = 'You are Vale, the CEO\'s chief of staff. Write a short (3-5 line) ' + (kind === 'evening' ? 'evening wrap' : 'morning brief') +
      ' in plain, executive English (no poetry, no em dashes). Base it ONLY on these facts, do not invent anything:\n' + JSON.stringify(facts, null, 2);
    var res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 400 } })
    });
    var data = await res.json();
    if (!res.ok) return fallback;
    var text = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
    return text.trim() || fallback;
  } catch (e) { return fallback; }
}

module.exports = async function (context, myTimer) {
  try {
    var kind = (new Date().getUTCHours() < 12) ? 'evening' : 'morning'; // 01:00 UTC → evening, 14:00 UTC → morning
    var heartbeatRuns = (await storage.getState('heartbeatRuns')) || [];
    var approvalQueue = (await storage.getState('approvalQueue')) || [];
    var ceoActionList = (await vs.getVale('ceoActionList')) || [];

    var facts = brief.buildBriefFacts({ heartbeatRuns: heartbeatRuns, approvalQueue: approvalQueue, ceoActionList: ceoActionList }, Date.now());
    var text = await narrate(facts, kind);
    var delivered = await postToDiscord(text);

    var briefs = (await vs.getVale('valeBriefs')) || [];
    briefs.push({ kind: kind, text: text, facts: facts, delivered: delivered, at: new Date().toISOString() });
    if (briefs.length > 60) briefs = briefs.slice(-60);
    await vs.setVale('valeBriefs', briefs);

    context.log('[valeBriefCron] ' + kind + ' brief sent=' + delivered);
  } catch (e) {
    context.log.error('[valeBriefCron] ' + (e && e.message));
  }
};

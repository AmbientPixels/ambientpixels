// vale-teams-bot — POST /api/vale-teams-bot. Vale in a Microsoft Teams chat, for Chad only.
// Teams (Bot Framework) posts each activity here. We verify the Bot Framework token, then the
// tenant and Chad's Entra object id, answer through _lib/vale/chatCore (the same brain as the
// Office chat, without mail), and reply on the conversation. Anything else is ignored.
// Dormant (503) until VALE_BOT_APP_ID, VALE_BOT_APP_SECRET and VALE_BOT_TENANT_ID are set.
// Plan: docs/superpowers/plans/2026-10-20-vale-teams-chat.md
'use strict';

var fetch = require('node-fetch');
var vs = require('../_utils/valeStorage');
var botAuth = require('../_lib/vale/botAuth');
var chatCore = require('../_lib/vale/chatCore');

var HISTORY_TURNS = 12;   // kept for context (6 exchanges)
var STORED_TURNS = 40;

function clean(text) {
  return String(text || '').replace(/<at>[^<]*<\/at>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function send(deps, activity, payload) {
  var token = await deps.auth.getOutboundToken({ fetch: deps.fetch, tenantId: deps.cfg.tenantId, appId: deps.cfg.appId, appSecret: deps.cfg.appSecret });
  var base = String(activity.serviceUrl).replace(/\/+$/, '');
  var url = base + '/v3/conversations/' + encodeURIComponent(activity.conversation.id) + '/activities' +
    (activity.id ? '/' + encodeURIComponent(activity.id) : '');
  var res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(Object.assign({ replyToId: activity.id, from: activity.recipient, recipient: activity.from, conversation: activity.conversation }, payload))
  });
  return res.status;
}

// Returns { status, body? } for the HTTP response; deps make it testable offline.
async function run(deps, req) {
  var cfg = deps.cfg;
  if (!cfg.appId || !cfg.appSecret || !cfg.tenantId || !cfg.ceoOid) return { status: 503, body: { error: 'Vale bot is not set up.' } };
  var activity = req.body || {};

  var auth = await deps.auth.verifyInbound(req.headers && (req.headers.authorization || req.headers.Authorization), activity, { appId: cfg.appId, fetch: deps.fetch });
  if (!auth.ok) { deps.log('refused: ' + auth.reason); return { status: 401 }; }

  if (activity.type !== 'message') return { status: 200 };
  var tenant = (activity.conversation && activity.conversation.tenantId) || (activity.channelData && activity.channelData.tenant && activity.channelData.tenant.id);
  if (tenant !== cfg.tenantId) { deps.log('refused: other tenant'); return { status: 200 }; }
  if (!activity.from || activity.from.aadObjectId !== cfg.ceoOid) { deps.log('refused: not Chad'); return { status: 200 }; }
  if (!activity.conversation || activity.conversation.conversationType && activity.conversation.conversationType !== 'personal') {
    deps.log('ignored: not a 1:1 chat'); return { status: 200 };
  }
  if (!deps.auth.serviceUrlAllowed(activity.serviceUrl)) { deps.log('refused: serviceUrl'); return { status: 200 }; }

  var text = clean(activity.text);
  if (!text) return { status: 200 };

  try { await send(deps, activity, { type: 'typing' }); } catch (e) { /* best effort */ }

  var stored = (await deps.vs.getVale('valeTeamsChat')) || [];
  var history = stored.slice(-HISTORY_TURNS).map(function (t) { return { role: t.role, text: t.text }; });
  var ans = await deps.chat.answer({ message: text, history: history, includeMail: false, where: 'teams', caller: 'vale-teams-bot', log: { warn: deps.log } });
  if (ans.error) {
    var det = ans.error.details;
    var why = det && det.error ? (det.error.status || det.error.type || '') + ' ' + (det.error.message || '') : (typeof det === 'string' ? det : '');
    deps.log('model error: ' + ans.error.status + ' ' + String(why).slice(0, 300));
  }
  var reply = ans.error ? "I hit a glitch answering that. Try again in a minute, or ask me on the Office page." : (ans.reply || "I don't have an answer for that.");

  var st = await send(deps, activity, { type: 'message', text: reply, textFormat: 'markdown' });
  if (st < 200 || st >= 300) deps.log('reply not accepted: ' + st);

  var now = new Date(deps.now()).toISOString();
  stored = stored.concat([{ role: 'user', text: text, ts: now }, { role: 'vale', text: reply, ts: now }]).slice(-STORED_TURNS);
  await deps.vs.setVale('valeTeamsChat', stored);
  return { status: 200 };
}

module.exports = async function (context, req) {
  try {
    var r = await run({
      cfg: {
        appId: process.env.VALE_BOT_APP_ID || '', appSecret: process.env.VALE_BOT_APP_SECRET || '',
        tenantId: process.env.VALE_BOT_TENANT_ID || '', ceoOid: process.env.VALE_CEO_OID || ''
      },
      auth: botAuth, chat: chatCore, vs: vs, fetch: fetch,
      now: function () { return Date.now(); },
      log: function (m) { context.log('[vale-teams-bot] ' + m); }
    }, req);
    context.res = { status: r.status, headers: { 'Content-Type': 'application/json' }, body: r.body || '' };
  } catch (e) {
    context.log.error('[vale-teams-bot] ' + (e && e.message));
    context.res = { status: 500, body: '' };
  }
};
module.exports.run = run;
module.exports.clean = clean;

// teamsPost — one Adaptive Card to Vale's Teams channel, through the channel's Workflows
// "Post to a channel when a webhook request is received" address (VALE_TEAMS_WEBHOOK_URL:
// a secret app setting, never in code or logs). No Entra scope is involved, so the Vale
// app stays read-only. Workflows answers 202 when it has ACCEPTED a request; that is not
// proof the card rendered (spec 2026-10-17 §11, Stage 1b).
'use strict';

function buildCard(msg) {
  var body = [{ type: 'TextBlock', text: String(msg.title || 'Vale'), weight: 'Bolder', size: 'Medium', wrap: true }];
  (msg.lines || []).forEach(function (l) {
    body.push({ type: 'TextBlock', text: String(l), wrap: true, spacing: 'Small' });
  });
  var card = { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: body };
  if (msg.link && msg.link.url) card.actions = [{ type: 'Action.OpenUrl', title: msg.link.title || 'Open', url: msg.link.url }];
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }]
  };
}

async function postToTeams(url, msg, fetchImpl) {
  if (!url) return { ok: false, status: 0, reason: 'no_url' };
  var res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCard(msg))
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status };
}

module.exports = { buildCard, postToTeams };

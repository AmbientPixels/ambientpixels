// mailer.js — sends Vale's brief FROM her own mailbox (vale@ambientpixels.ai) with an
// app-only token. Exchange RBAC for Applications scopes the app's Mail.Send to that one
// mailbox, so Microsoft itself prevents sending as the CEO; this module also never takes a
// sender from its input — only cfg.senderAddress.
'use strict';

var oauth = require('./oauth');

// deps: { cfg: { tenantId, clientId, clientSecret, senderAddress }, fetch }
// msg: { to, subject, html }
async function sendBrief(deps, msg) {
  var cfg = deps.cfg;
  if (!cfg.senderAddress) throw new Error('no sender configured');
  var tok = await oauth.tokenRequest(deps.fetch, cfg, { grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' });
  if (!tok.body.access_token) throw new Error('app token failed: ' + (tok.body.error || tok.status));

  var url = 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(cfg.senderAddress) + '/sendMail';
  var r = await deps.fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok.body.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: String(msg.subject || '').slice(0, 250),
        body: { contentType: 'HTML', content: String(msg.html || '') },
        toRecipients: [{ emailAddress: { address: msg.to } }]
      },
      saveToSentItems: true
    })
  });
  if (r.status !== 202) {
    var detail = '';
    try { detail = (await r.text()).slice(0, 200); } catch (e) { detail = ''; }
    throw new Error('sendMail ' + r.status + (detail ? ': ' + detail : ''));
  }
  return true;
}

module.exports = { sendBrief: sendBrief };

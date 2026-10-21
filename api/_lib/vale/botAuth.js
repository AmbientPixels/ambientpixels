// botAuth — the Teams chat's two Microsoft handshakes, with node:crypto and node-fetch only
// (package-lock.json is protected; no botbuilder SDK).
//  1. Inbound: every activity Teams sends carries a Bot Framework JWT. Verify signature,
//     issuer, audience (the Vale Bot app id), expiry, the key's channel endorsement, and that
//     the token was minted for the activity's serviceUrl.
//  2. Outbound: a client-credentials token for the Vale Bot app, to reply on the conversation.
// The Vale Bot app is its own Entra registration with no Graph permissions; the read-only
// "Vale" app is never involved.
'use strict';

var crypto = require('crypto');
var { decodeJwt } = require('./jwt');

var OPENID = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
var ISSUER = 'https://api.botframework.com';
// Replies only ever go to Bot Framework hosts, never to a serviceUrl an attacker could choose.
var SERVICE_HOSTS = [/^smba\.trafficmanager\.net$/i, /\.botframework\.com$/i, /^smba\.infra\.gov\.teams\.microsoft\.us$/i];

function fail(reason) { return { ok: false, reason: reason }; }

// opts: { jwks, appId, channelId, serviceUrl, nowSec?, skewSec? }
function verifyBotToken(token, opts) {
  opts = opts || {};
  var d = decodeJwt(token);
  if (!d || !d.header || !d.payload) return fail('malformed');
  if (d.header.alg !== 'RS256') return fail('bad_alg');
  var keys = (opts.jwks && opts.jwks.keys) || [];
  var jwk = keys.find(function (k) { return k && k.kid === d.header.kid; });
  if (!jwk) return fail('unknown_kid');
  if (Array.isArray(jwk.endorsements) && opts.channelId && jwk.endorsements.indexOf(opts.channelId) === -1) return fail('not_endorsed');
  var valid;
  try {
    var pub = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
    valid = crypto.verify('RSA-SHA256', Buffer.from(d.signingInput), pub, d.signature);
  } catch (e) { return fail('bad_key'); }
  if (!valid) return fail('bad_signature');
  var c = d.payload;
  var now = opts.nowSec != null ? opts.nowSec : Math.floor(Date.now() / 1000);
  var skew = opts.skewSec != null ? opts.skewSec : 300;
  if (c.iss !== ISSUER) return fail('bad_iss');
  if (!opts.appId || c.aud !== opts.appId) return fail('bad_aud');
  if (typeof c.exp !== 'number' || now > c.exp + skew) return fail('expired');
  if (typeof c.nbf === 'number' && now + skew < c.nbf) return fail('not_yet_valid');
  if (c.serviceurl && opts.serviceUrl && String(c.serviceurl).replace(/\/+$/, '') !== String(opts.serviceUrl).replace(/\/+$/, '')) return fail('bad_serviceurl');
  return { ok: true, claims: c };
}

function serviceUrlAllowed(u) {
  try {
    var url = new URL(u);
    return url.protocol === 'https:' && SERVICE_HOSTS.some(function (re) { return re.test(url.hostname); });
  } catch (e) { return false; }
}

// Cached signing keys (Microsoft rotates them; refetch on an unknown kid, at most hourly otherwise).
var _keys = { jwks: null, at: 0 };
async function getBotKeys(fetchImpl, force) {
  if (!force && _keys.jwks && Date.now() - _keys.at < 3600000) return _keys.jwks;
  var cfg = await (await fetchImpl(OPENID)).json();
  var jwks = await (await fetchImpl(cfg.jwks_uri)).json();
  _keys = { jwks: jwks, at: Date.now() };
  return jwks;
}

async function verifyInbound(authHeader, activity, opts) {
  var m = /^Bearer\s+(.+)$/i.exec(String(authHeader || ''));
  if (!m) return fail('no_token');
  var args = { appId: opts.appId, channelId: activity && activity.channelId, serviceUrl: activity && activity.serviceUrl };
  var r = verifyBotToken(m[1], Object.assign({ jwks: await getBotKeys(opts.fetch) }, args));
  if (!r.ok && r.reason === 'unknown_kid') r = verifyBotToken(m[1], Object.assign({ jwks: await getBotKeys(opts.fetch, true) }, args));
  return r;
}

// Outbound token for replies (single-tenant bot: token from the bot's own tenant).
var _out = { token: null, exp: 0 };
async function getOutboundToken(opts) {
  if (_out.token && Date.now() < _out.exp - 120000) return _out.token;
  var res = await opts.fetch('https://login.microsoftonline.com/' + encodeURIComponent(opts.tenantId) + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&client_id=' + encodeURIComponent(opts.appId) +
      '&client_secret=' + encodeURIComponent(opts.appSecret) + '&scope=' + encodeURIComponent('https://api.botframework.com/.default')
  });
  var j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('bot token: ' + res.status + ' ' + (j.error || ''));
  _out = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return _out.token;
}

module.exports = { verifyBotToken, verifyInbound, serviceUrlAllowed, getOutboundToken, getBotKeys, ISSUER };

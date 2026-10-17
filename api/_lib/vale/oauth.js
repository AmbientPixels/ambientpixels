// oauth.js — Microsoft identity platform helpers for Vale (confidential web client,
// auth-code + PKCE, refresh, client credentials). Pure except tokenRequest, which takes
// an injected fetch.
'use strict';

var crypto = require('crypto');
var jwt = require('./jwt');

// Read-only delegated scopes for Stage 1. offline_access → refresh token.
var SCOPES = 'openid profile offline_access User.Read Mail.Read Calendars.Read';

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function makePkce() {
  var verifier = b64url(crypto.randomBytes(32));
  var challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier: verifier, challenge: challenge };
}

function makeState() { return b64url(crypto.randomBytes(24)); }

// cfg: { tenantId, clientId, redirectUri, loginHint? }
function authorizeUrl(cfg, state, challenge) {
  var q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    state: state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  if (cfg.loginHint) q.set('login_hint', cfg.loginHint);
  return 'https://login.microsoftonline.com/' + cfg.tenantId + '/oauth2/v2.0/authorize?' + q.toString();
}

// POST to the tenant token endpoint. Returns { status, body } and never throws on HTTP errors.
async function tokenRequest(fetchImpl, cfg, params) {
  var body = new URLSearchParams(Object.assign({ client_id: cfg.clientId, client_secret: cfg.clientSecret }, params));
  var r = await fetchImpl('https://login.microsoftonline.com/' + cfg.tenantId + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  var json = {};
  try { json = await r.json(); } catch (e) { json = {}; }
  return { status: r.status, body: json || {} };
}

// The ID token arrives directly from the token endpoint over TLS in response to our own
// code exchange, so decoding (not re-verifying) it is the standard practice here.
function idTokenClaims(idToken) {
  var d = jwt.decodeJwt(idToken);
  return (d && d.payload) || null;
}

module.exports = { SCOPES: SCOPES, makePkce: makePkce, makeState: makeState, authorizeUrl: authorizeUrl, tokenRequest: tokenRequest, idTokenClaims: idTokenClaims };

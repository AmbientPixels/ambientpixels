// tokenStore.js — Vale's delegated access to the CEO mailbox. Holds the refresh token
// encrypted (tokenCrypto) in vale/valeMailToken and trades it for a short-lived Graph
// access token on each run, writing back the rotated refresh token.
//
// Record shape: { box, account, scopes, connectedAt, lastSuccessAt, lastError, lastErrorAt, needsReconnect }
'use strict';

var oauth = require('./oauth');
var tokenCrypto = require('./tokenCrypto');

var TOKEN_KEY = 'valeMailToken';

class ReconnectError extends Error { constructor(reason) { super('reconnect: ' + reason); this.name = 'ReconnectError'; this.reason = reason; } }
class StoreError extends Error { constructor(msg) { super(msg); this.name = 'StoreError'; } }

// deps: { cfg: {tenantId, clientId, clientSecret, tokenKey}, fetch, store: {getWithMeta, mutate}, now? }
async function getAccessToken(deps) {
  var nowIso = new Date((deps.now || Date.now)()).toISOString();
  var meta = await deps.store.getWithMeta(TOKEN_KEY);
  if (meta.failed) throw new StoreError('could not read the stored mailbox connection');
  var rec = meta.value;
  if (!rec || !rec.box) throw new ReconnectError('not_connected');
  if (rec.needsReconnect) throw new ReconnectError('needs_reconnect');

  var refreshToken = tokenCrypto.decrypt(rec.box, deps.cfg.tokenKey);
  var res = await oauth.tokenRequest(deps.fetch, deps.cfg, { grant_type: 'refresh_token', refresh_token: refreshToken, scope: oauth.SCOPES });

  if (!res.body.access_token) {
    var err = res.body.error || ('http_' + res.status);
    if (err === 'invalid_grant' || err === 'interaction_required') {
      await deps.store.mutate(TOKEN_KEY, function (cur) {
        if (!cur) return undefined;
        return Object.assign({}, cur, { needsReconnect: true, lastError: err, lastErrorAt: nowIso });
      });
      throw new ReconnectError(err);
    }
    throw new Error('token refresh failed: ' + err);
  }

  var rotated = res.body.refresh_token;
  await deps.store.mutate(TOKEN_KEY, function (cur) {
    if (!cur) return undefined; // disconnected mid-run: don't resurrect the connection
    var next = Object.assign({}, cur, { lastSuccessAt: nowIso, lastError: null, lastErrorAt: null });
    if (rotated) next.box = tokenCrypto.encrypt(rotated, deps.cfg.tokenKey);
    return next;
  });
  return res.body.access_token;
}

// Builds the record saved after a successful code exchange.
function connectionRecord(tokenBody, claims, tokenKey, nowIso) {
  return {
    box: tokenCrypto.encrypt(tokenBody.refresh_token, tokenKey),
    account: (claims && (claims.preferred_username || claims.email)) || null,
    scopes: tokenBody.scope || oauth.SCOPES,
    connectedAt: nowIso,
    lastSuccessAt: nowIso,
    lastError: null,
    lastErrorAt: null,
    needsReconnect: false
  };
}

// The connection summary safe to show the CEO (never the token).
function statusOf(rec) {
  if (!rec || !rec.box) return { connected: false };
  return {
    connected: !rec.needsReconnect,
    needsReconnect: !!rec.needsReconnect,
    account: rec.account || null,
    scopes: rec.scopes || null,
    connectedAt: rec.connectedAt || null,
    lastSuccessAt: rec.lastSuccessAt || null,
    lastError: rec.lastError || null
  };
}

module.exports = { getAccessToken: getAccessToken, connectionRecord: connectionRecord, statusOf: statusOf, ReconnectError: ReconnectError, StoreError: StoreError, TOKEN_KEY: TOKEN_KEY };

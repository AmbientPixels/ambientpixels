// jwt.js — verify a Microsoft Entra v2 access token for Vale, using node:crypto only
// (no JWT/MSAL dependency: package-lock.json is protected). Pure: the caller supplies
// the JWKS and the clock, so every rule is unit-testable offline.
'use strict';

var crypto = require('crypto');

function b64urlToBuf(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function decodeJwt(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(b64urlToBuf(parts[0]).toString('utf8')),
      payload: JSON.parse(b64urlToBuf(parts[1]).toString('utf8')),
      signingInput: parts[0] + '.' + parts[1],
      signature: b64urlToBuf(parts[2])
    };
  } catch (e) { return null; }
}

function fail(reason) { return { ok: false, reason: reason }; }

// opts: { jwks: {keys:[...]}, tenantId, clientId, ceoOid, allowedClients?, nowSec?, skewSec?, scope? }
// allowedClients: the SPAs (azp) allowed to call Vale's API — e.g. Vale + Vale Mail. The audience
// is always clientId (Vale's API); an empty/absent list means [clientId] only.
// Returns { ok: true, claims } or { ok: false, reason }. Never consults `roles`.
function verifyAccessToken(token, opts) {
  opts = opts || {};
  var d = decodeJwt(token);
  if (!d || !d.header || !d.payload) return fail('malformed');
  if (d.header.alg !== 'RS256') return fail('bad_alg');

  var keys = (opts.jwks && opts.jwks.keys) || [];
  var jwk = null;
  for (var i = 0; i < keys.length; i++) { if (keys[i] && keys[i].kid === d.header.kid) { jwk = keys[i]; break; } }
  if (!jwk) return fail('unknown_kid');

  var valid;
  try {
    var pub = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
    valid = crypto.verify('RSA-SHA256', Buffer.from(d.signingInput), pub, d.signature);
  } catch (e) { return fail('bad_key'); }
  if (!valid) return fail('bad_signature');

  var c = d.payload;
  var now = opts.nowSec != null ? opts.nowSec : Math.floor(Date.now() / 1000);
  var skew = opts.skewSec != null ? opts.skewSec : 300;

  if (c.iss !== 'https://login.microsoftonline.com/' + opts.tenantId + '/v2.0') return fail('bad_iss');
  if (!opts.tenantId || c.tid !== opts.tenantId) return fail('bad_tid');
  if (!opts.clientId || c.aud !== opts.clientId) return fail('bad_aud');
  var allowed = (Array.isArray(opts.allowedClients) && opts.allowedClients.length) ? opts.allowedClients : [opts.clientId];
  if (typeof c.azp !== 'string' || !c.azp || allowed.indexOf(c.azp) === -1) return fail('bad_azp');
  if (typeof c.exp !== 'number' || now > c.exp + skew) return fail('expired');
  if (typeof c.nbf === 'number' && now + skew < c.nbf) return fail('not_yet_valid');
  var scopes = String(c.scp || '').split(' ');
  if (scopes.indexOf(opts.scope || 'access_as_user') === -1) return fail('bad_scope');
  if (!opts.ceoOid || c.oid !== opts.ceoOid) return fail('not_ceo');

  return { ok: true, claims: c };
}

module.exports = { verifyAccessToken: verifyAccessToken, decodeJwt: decodeJwt, b64urlToBuf: b64urlToBuf };

// valeAuth.js — CEO-only gate for Vale endpoints.
//
// Two paths:
//   1. requireCeo (sync, legacy): decodes the SWA/B2C principal via cfAuth and checks the
//      email against CEO_EMAILS (or a ceo/admin role). The principal header is NOT signed,
//      so this path is forgeable against the public Function App — kept only for non-mail
//      Vale data while VALE_STRICT_AUTH is off, and for non-Vale callers.
//   2. requireCeoAsync (2026-10-17): a Microsoft Entra bearer token from the CEO's
//      ambientpixels.ai account, signature-verified against the tenant JWKS (jwt.js) and
//      pinned to VALE_CEO_OID. Anything touching mail passes { bearerOnly: true }.
// Never uses the shared x-company-secret and never fails open.
'use strict';

var { extractUserInfo } = require('./cfAuth');
var jwt = require('../_lib/vale/jwt');

function parseCeoAllowlist(envVal) {
  return String(envVal || '')
    .split(',')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function isCeo(userInfo, allowlist) {
  if (!userInfo || !userInfo.isAuthenticated) return false;
  var email = (userInfo.email || '').toLowerCase();
  if (email && allowlist.indexOf(email) !== -1) return true;
  var roles = (userInfo.principal && (userInfo.principal.userRoles || [])) || [];
  return roles.indexOf('ceo') !== -1 || roles.indexOf('admin') !== -1;
}

// I/O wrapper: reads CEO_EMAILS from env, extracts the principal, returns {ok, userInfo}.
function requireCeo(req, context) {
  var allow = parseCeoAllowlist(process.env.CEO_EMAILS);
  var userInfo = extractUserInfo(req, context);
  return { ok: isCeo(userInfo, allow), userInfo: userInfo };
}

function valeConfig(env) {
  env = env || process.env;
  return {
    tenantId: env.VALE_TENANT_ID || '',
    clientId: env.VALE_CLIENT_ID || '',
    ceoOid: env.VALE_CEO_OID || '',
    strict: env.VALE_STRICT_AUTH === '1',
    mailEnabled: env.VALE_MAIL_ENABLED === '1'
  };
}

function bearerFrom(req) {
  var h = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  var m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : null;
}

// JWKS cache: 24 h; on an unknown kid (key rotation) refetch at most once per 5 min.
var JWKS_TTL_MS = 24 * 60 * 60 * 1000;
var JWKS_REFETCH_MS = 5 * 60 * 1000;
var _jwks = { keys: null, fetchedAt: 0, lastRefetchAt: 0 };
function _resetJwksCache() { _jwks = { keys: null, fetchedAt: 0, lastRefetchAt: 0 }; }

function _defaultFetch() { return (typeof fetch === 'function') ? fetch : require('node-fetch'); }

async function _fetchJwks(tenantId, fetchImpl) {
  var r = await fetchImpl('https://login.microsoftonline.com/' + tenantId + '/discovery/v2.0/keys');
  if (!r.ok) throw new Error('jwks ' + r.status);
  return r.json();
}

async function verifyBearer(token, d) {
  var cfg = d.cfg;
  if (!cfg.tenantId || !cfg.clientId || !cfg.ceoOid) return { ok: false, reason: 'not_configured' };
  var now = d.now();
  if (!_jwks.keys || now - _jwks.fetchedAt > JWKS_TTL_MS) {
    _jwks.keys = await _fetchJwks(cfg.tenantId, d.fetch);
    _jwks.fetchedAt = now;
  }
  var opts = { jwks: _jwks.keys, tenantId: cfg.tenantId, clientId: cfg.clientId, ceoOid: cfg.ceoOid, nowSec: Math.floor(now / 1000) };
  var res = jwt.verifyAccessToken(token, opts);
  if (!res.ok && res.reason === 'unknown_kid' && now - _jwks.lastRefetchAt > JWKS_REFETCH_MS) {
    _jwks.lastRefetchAt = now;
    _jwks.keys = await _fetchJwks(cfg.tenantId, d.fetch);
    _jwks.fetchedAt = now;
    opts.jwks = _jwks.keys;
    res = jwt.verifyAccessToken(token, opts);
  }
  return res;
}

// opts.bearerOnly: anything touching mail or mail-derived data — ignores VALE_STRICT_AUTH.
// deps (tests): { cfg, now, fetch }.
// Returns { ok, via: 'bearer'|'principal'|null, claims?, userInfo?, reason? }.
async function requireCeoAsync(req, context, opts, deps) {
  opts = opts || {};
  deps = deps || {};
  var cfg = deps.cfg || valeConfig();
  var d = { cfg: cfg, now: deps.now || Date.now, fetch: deps.fetch || _defaultFetch() };

  var token = bearerFrom(req);
  if (token) {
    // A bearer token, if present, is the only thing judged — a bad token never falls
    // back to the forgeable principal.
    try {
      var v = await verifyBearer(token, d);
      if (v.ok) return { ok: true, via: 'bearer', claims: v.claims };
      return { ok: false, via: 'bearer', reason: v.reason };
    } catch (e) {
      return { ok: false, via: 'bearer', reason: 'jwks_unavailable' };
    }
  }

  if (opts.bearerOnly || cfg.strict) return { ok: false, via: null, reason: 'bearer_required' };

  var legacy = requireCeo(req, context);
  return { ok: legacy.ok, via: legacy.ok ? 'principal' : null, userInfo: legacy.userInfo, reason: legacy.ok ? null : 'not_ceo' };
}

module.exports = { parseCeoAllowlist, isCeo, requireCeo, requireCeoAsync, valeConfig, bearerFrom, _resetJwksCache };

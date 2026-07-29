// linkedinAuth.js — shared LinkedIn access-token manager with programmatic refresh.
// Single source of truth: socialCredentials.linkedin blob (same shape the
// actionsExecute LinkedIn adapter reads/writes), env vars as bootstrap fallback.
// Access tokens live ~60 days; this refreshes proactively when <7 days remain
// so read paths (account stats, engagement pull) stop dying silently on expiry.

const https = require('https');
const querystring = require('querystring');
const storage = require('./companyStorage');

const REFRESH_BUFFER_MS = 7 * 24 * 60 * 60 * 1000; // refresh when <7 days left
const MEM_CACHE_TTL_MS = 5 * 60 * 1000;

var _memCache = { token: '', at: 0 };

function _postForm(url, form) {
  return new Promise(function (resolve, reject) {
    var body = querystring.stringify(form);
    var parsed = new URL(url);
    var req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        resolve({ status: res.statusCode, data: json, raw: data });
      });
    });
    req.on('error', function (err) { reject(err); });
    req.setTimeout(10000, function () { req.destroy(); reject(new Error('LinkedIn token refresh timed out')); });
    req.write(body);
    req.end();
  });
}

async function _readBlobCreds() {
  try {
    var blob = (await storage.getState('socialCredentials')) || {};
    return blob.linkedin || null;
  } catch (e) {
    return null;
  }
}

async function _refresh(refreshToken) {
  var clientId = process.env.LINKEDIN_CLIENT_ID || '';
  var clientSecret = process.env.LINKEDIN_CLIENT_SECRET || '';
  if (!refreshToken || !clientId || !clientSecret) {
    console.warn('[linkedinAuth] Cannot refresh: missing refresh token or client credentials');
    return null;
  }

  var res = await _postForm('https://www.linkedin.com/oauth/v2/accessToken', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });

  if (res.status !== 200 || !res.data || !res.data.access_token) {
    console.error('[linkedinAuth] Refresh failed HTTP ' + res.status + ': ' + (res.raw || '').slice(0, 250));
    return null;
  }

  var now = Date.now();
  var next = {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token || refreshToken,
    expiresAt: new Date(now + (Number(res.data.expires_in) || 60 * 86400) * 1000).toISOString(),
    refreshTokenExpiresAt: res.data.refresh_token_expires_in
      ? new Date(now + Number(res.data.refresh_token_expires_in) * 1000).toISOString()
      : undefined,
    refreshedAt: new Date(now).toISOString()
  };

  try {
    var blob = (await storage.getState('socialCredentials')) || {};
    blob.linkedin = Object.assign(blob.linkedin || {}, next);
    await storage.setState('socialCredentials', blob);
    console.log('[linkedinAuth] Token refreshed, expires ' + next.expiresAt);
  } catch (e) {
    console.error('[linkedinAuth] Refreshed but blob write failed: ' + e.message);
  }

  return next.accessToken;
}

/**
 * Get a valid LinkedIn access token. Order: fresh blob token → proactive
 * refresh (blob or env refresh token) → stale blob token → env token.
 * @param {boolean} force - skip caches and refresh now (use after a 401)
 */
async function getAccessToken(force) {
  if (!force && _memCache.token && (Date.now() - _memCache.at) < MEM_CACHE_TTL_MS) {
    return _memCache.token;
  }

  var creds = await _readBlobCreds();
  var expiresAt = creds && creds.expiresAt ? Date.parse(creds.expiresAt) : 0;
  var blobFresh = creds && creds.accessToken && expiresAt && (expiresAt - Date.now() > REFRESH_BUFFER_MS);

  if (!force && blobFresh) {
    _memCache = { token: creds.accessToken, at: Date.now() };
    return creds.accessToken;
  }

  var refreshToken = (creds && creds.refreshToken) || process.env.LINKEDIN_REFRESH_TOKEN || '';
  var refreshed = null;
  try { refreshed = await _refresh(refreshToken); } catch (e) {
    console.error('[linkedinAuth] Refresh error: ' + (e && e.message));
  }
  if (refreshed) {
    _memCache = { token: refreshed, at: Date.now() };
    return refreshed;
  }

  // Refresh unavailable/failed — best remaining token (callers surface 401s)
  var fallback = (creds && creds.accessToken) || process.env.LINKEDIN_ACCESS_TOKEN || '';
  _memCache = { token: fallback, at: Date.now() };
  return fallback;
}

module.exports = { getAccessToken };

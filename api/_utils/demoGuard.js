// demoGuard.js — Demo environment isolation helpers
// Controls: BLOB_PREFIX, DEMO_MODE, DEMO_EXPIRES_AT env vars

function isDemoMode() {
  var val = (process.env.DEMO_MODE || '').toLowerCase();
  return val === 'true' || val === '1';
}

function isDemoExpired() {
  var expiresAt = process.env.DEMO_EXPIRES_AT;
  if (!expiresAt) return false;
  return Date.now() > new Date(expiresAt).getTime();
}

function getBlobPrefix() {
  return (process.env.BLOB_PREFIX || '').replace(/\/+$/, '');
}

function prefixBlobKey(key) {
  var prefix = getBlobPrefix();
  if (!prefix) return key;
  return prefix + '/' + key;
}

var GUARD_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

function httpGuard(req) {
  if (isDemoExpired()) {
    return {
      status: 403,
      headers: GUARD_HEADERS,
      body: { error: 'DEMO_EXPIRED', message: 'This demo environment has expired.' }
    };
  }
  if (isDemoMode()) {
    var method = (req && req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'OPTIONS' && method !== 'HEAD') {
      return {
        status: 403,
        headers: GUARD_HEADERS,
        body: { error: 'DEMO_READ_ONLY', message: 'This is a read-only demo environment. Mutations are disabled.' }
      };
    }
  }
  return null;
}

function timerSkip(context) {
  if (isDemoExpired() || isDemoMode()) {
    if (context && context.log) {
      context.log('[DemoGuard] Timer skipped — DEMO_MODE=' + (process.env.DEMO_MODE || 'unset') + ' DEMO_EXPIRES_AT=' + (process.env.DEMO_EXPIRES_AT || 'unset'));
    }
    return true;
  }
  return false;
}

module.exports = {
  isDemoMode: isDemoMode,
  isDemoExpired: isDemoExpired,
  getBlobPrefix: getBlobPrefix,
  prefixBlobKey: prefixBlobKey,
  httpGuard: httpGuard,
  timerSkip: timerSkip
};

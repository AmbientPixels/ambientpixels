// linkedin.js — LinkedIn platform adapter for social_post.publish
// OAuth 2.0 Bearer Token — LinkedIn UGC Posts API (/v2/ugcPosts)
// Posts as AmbientPixels ORGANIZATION page (urn:li:organization:{orgId})
// Requires w_organization_social scope on the OAuth token
// Env vars: LINKEDIN_ACCESS_TOKEN, LINKEDIN_ORG_ID
// Auto-refresh: stores tokens in blob (socialCredentials) and refreshes via refresh_token grant

const https = require('https');
const querystring = require('querystring');
const crypto = require('crypto');
const storage = require('../../../_utils/companyStorage');
const { retryOn429, shouldSkipDueToExistingReceipt } = require('../../../_utils/platformRetry');

const LINKEDIN_API_URL = 'https://api.linkedin.com/v2/ugcPosts';
const MAX_CHARS = 3000;
// NOTE: Native image upload deferred — LinkedIn org posting permissions differ from Ads access.
// Media[] items are shared as article link cards for now.

// In-memory cache so we don't hit blob on every call within the same function invocation
var _cachedCreds = null;
var _cachedCredsAt = 0;
var CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * Load credentials: blob (socialCredentials.linkedin) first, env vars as fallback.
 */
async function getCredentials() {
  // Return in-memory cache if fresh
  if (_cachedCreds && (Date.now() - _cachedCredsAt) < CACHE_TTL) {
    return _cachedCreds;
  }

  var creds = { accessToken: '', orgId: process.env.LINKEDIN_ORG_ID || '107826087', refreshToken: '', clientId: '', clientSecret: '', expiresAt: '' };

  try {
    var blob = await storage.getState('socialCredentials');
    if (blob && blob.linkedin && blob.linkedin.accessToken) {
      creds.accessToken = blob.linkedin.accessToken;
      creds.refreshToken = blob.linkedin.refreshToken || '';
      creds.clientId = blob.linkedin.clientId || process.env.LINKEDIN_CLIENT_ID || '';
      creds.clientSecret = blob.linkedin.clientSecret || process.env.LINKEDIN_CLIENT_SECRET || '';
      creds.expiresAt = blob.linkedin.expiresAt || '';
      if (blob.linkedin.orgId) creds.orgId = blob.linkedin.orgId;
      _cachedCreds = creds;
      _cachedCredsAt = Date.now();
      return creds;
    }
  } catch (e) {
    console.warn('[LinkedIn] blob read failed, falling back to env vars:', e.message);
  }

  // Fallback to env vars
  creds.accessToken = process.env.LINKEDIN_ACCESS_TOKEN || '';
  creds.refreshToken = process.env.LINKEDIN_REFRESH_TOKEN || '';
  creds.clientId = process.env.LINKEDIN_CLIENT_ID || '';
  creds.clientSecret = process.env.LINKEDIN_CLIENT_SECRET || '';
  _cachedCreds = creds;
  _cachedCredsAt = Date.now();
  return creds;
}

/**
 * Refresh the access token using the refresh_token grant.
 * Writes updated tokens back to blob storage.
 * @returns {Promise<{ok: boolean, accessToken?: string, error?: string}>}
 */
function _refreshAccessToken(creds) {
  return new Promise(function (resolve) {
    if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
      return resolve({ ok: false, error: 'Missing refresh credentials (refreshToken, clientId, or clientSecret)' });
    }

    var postData = querystring.stringify({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret
    });

    var options = {
      hostname: 'www.linkedin.com',
      path: '/oauth/v2/accessToken',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try {
          var parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.access_token) {
            var now = new Date();
            var expiresAt = new Date(now.getTime() + (parsed.expires_in || 5184000) * 1000).toISOString();
            // Write to blob
            storage.getState('socialCredentials').then(function (blob) {
              blob = blob || {};
              blob.linkedin = Object.assign(blob.linkedin || {}, {
                accessToken: parsed.access_token,
                refreshToken: parsed.refresh_token || creds.refreshToken,
                expiresAt: expiresAt,
                refreshedAt: now.toISOString()
              });
              storage.setState('socialCredentials', blob).then(function () {
                _log('token-refreshed', { expiresAt: expiresAt });
              });
            });
            // Invalidate in-memory cache
            _cachedCreds = null;
            _cachedCredsAt = 0;
            resolve({ ok: true, accessToken: parsed.access_token, expiresAt: expiresAt });
          } else {
            _log('refresh-failed', { status: res.statusCode, body: data.substring(0, 300) });
            resolve({ ok: false, error: 'Refresh returned ' + res.statusCode + ': ' + (parsed.error_description || parsed.error || data.substring(0, 200)) });
          }
        } catch (e) {
          resolve({ ok: false, error: 'Parse error: ' + e.message });
        }
      });
    });
    req.on('error', function (err) { resolve({ ok: false, error: 'Network error: ' + err.message }); });
    req.setTimeout(10000, function () { req.destroy(); resolve({ ok: false, error: 'Refresh request timed out' }); });
    req.write(postData);
    req.end();
  });
}

function getAuthorUrn(creds) {
  return 'urn:li:organization:' + creds.orgId;
}

function validateCredentials(creds) {
  if (!creds.accessToken) return 'LINKEDIN_ACCESS_TOKEN not set';
  if (!creds.orgId) return 'LINKEDIN_ORG_ID not set';
  return null;
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Log structured info for every LinkedIn post attempt.
 * @param {string} event - Event name
 * @param {Object} data - Log payload
 */
function _log(event, data) {
  var orgId = process.env.LINKEDIN_ORG_ID || '107826087';
  var entry = Object.assign({
    _source: 'linkedin-adapter',
    event: event,
    target: 'organization',
    orgId: orgId,
    ts: new Date().toISOString()
  }, data || {});
  console.log('[LinkedIn]', JSON.stringify(entry));
}

/**
 * Pre-flight token check — calls /v2/userinfo to verify token validity.
 * Also checks /v2/organizationAcls to verify org posting permission.
 * @returns {Promise<{valid: boolean, name?: string, error?: string, orgAccess?: boolean}>}
 */
async function validateToken() {
  var creds = await getCredentials();
  if (!creds.accessToken) return { valid: false, error: 'LINKEDIN_ACCESS_TOKEN not set' };

  return new Promise((resolve) => {
    // Step 1: Basic token validity via /v2/userinfo
    const options = {
      hostname: 'api.linkedin.com',
      path: '/v2/userinfo',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + creds.accessToken
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 401) {
          _log('token-invalid', { status: 401 });
          resolve({ valid: false, error: 'Access token expired or revoked (401). Generate a new token at https://www.linkedin.com/developers/apps' });
        } else if (res.statusCode === 200 || res.statusCode === 403) {
          // 200 = full access, 403 = lacks openid but token is alive — both OK for posting
          let name = '';
          try { const me = JSON.parse(data); name = me.name || ''; } catch (e) {}
          // Step 2: Check org admin access
          _checkOrgAccess(creds).then((orgResult) => {
            resolve({ valid: true, name: name, orgAccess: orgResult.hasAccess, orgError: orgResult.error });
          });
        } else {
          _log('token-check-failed', { status: res.statusCode });
          resolve({ valid: false, error: 'LinkedIn /v2/userinfo returned HTTP ' + res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ valid: false, error: 'Network error checking token: ' + err.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ valid: false, error: 'Token check timed out' }); });
    req.end();
  });
}

/**
 * Check if the token owner has admin/posting access to the org page.
 * Uses /v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget))
 * @returns {Promise<{hasAccess: boolean, error?: string}>}
 */
function _checkOrgAccess(creds) {
  return new Promise((resolve) => {
    const orgUrn = 'urn:li:organization:' + creds.orgId;
    const path = '/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organizationalTarget))';
    const options = {
      hostname: 'api.linkedin.com',
      path: path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + creds.accessToken,
        'X-Restli-Protocol-Version': '2.0.0'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            const elements = (result && result.elements) || [];
            const match = elements.some(e => (e.organizationalTarget || e.organization) === orgUrn);
            _log('org-access-check', { status: 200, found: match, elementsCount: elements.length });
            resolve({ hasAccess: match });
          } catch (e) {
            resolve({ hasAccess: false, error: 'Parse error on orgAcls' });
          }
        } else if (res.statusCode === 403) {
          _log('org-access-check', { status: 403, hint: 'Token likely missing w_organization_social or r_organization_admin scope' });
          resolve({ hasAccess: false, error: 'Token missing w_organization_social scope (403 on organizationAcls)' });
        } else {
          _log('org-access-check', { status: res.statusCode });
          // Non-fatal: proceed anyway — the actual post call will tell us definitively
          resolve({ hasAccess: true, error: 'orgAcls HTTP ' + res.statusCode + ' (proceeding anyway)' });
        }
      });
    });
    req.on('error', () => resolve({ hasAccess: true, error: 'orgAcls network error (proceeding anyway)' }));
    req.setTimeout(6000, () => { req.destroy(); resolve({ hasAccess: true, error: 'orgAcls timeout (proceeding anyway)' }); });
    req.end();
  });
}

/**
 * Publish a post to LinkedIn as AmbientPixels organization page.
 * Uses /rest/posts (new API) as primary, /v2/ugcPosts as fallback.
 * Author is ALWAYS urn:li:organization:{orgId}.
 * @param {Object} action - Full action object
 * @returns {Promise<{receipt: Object}>}
 */
async function publishToLinkedIn(action) {
  var creds = await getCredentials();
  var credError = validateCredentials(creds);
  if (credError) {
    _log('credential-error', { error: credError });
    throw { code: 'MISSING_CREDENTIALS', message: credError };
  }

  var authorUrn = getAuthorUrn(creds);
  let text = (action.payload && action.payload.text) || '';
  if (!text || text.trim().length === 0) {
    throw { code: 'EMPTY_CONTENT', message: 'Post text is empty' };
  }

  // M1 idempotency guard — skip re-post if an existing receipt has the same content_hash.
  // Check is done pre-truncation so the hash matches what was stored on the original success.
  var _currentHash = contentHash(text);
  var _existingReceipt = shouldSkipDueToExistingReceipt(action, _currentHash);
  if (_existingReceipt) {
    _log('skip-repost-content-hash-match', { post_id: _existingReceipt.post_id, post_urn: _existingReceipt.post_urn });
    return { receipt: _existingReceipt };
  }

  if (text.length > MAX_CHARS) {
    _log('truncating', { original: text.length, limit: MAX_CHARS });
    text = text.substring(0, MAX_CHARS - 1).replace(/\s+\S*$/, '') + '\u2026';
  }

  // Pre-flight: verify token is still valid + check org access
  var tokenCheck = await validateToken();
  if (!tokenCheck.valid) {
    // Try refresh before giving up
    _log('token-expired-attempting-refresh', {});
    var refreshResult = await _refreshAccessToken(creds);
    if (refreshResult.ok) {
      creds = await getCredentials();
      authorUrn = getAuthorUrn(creds);
      tokenCheck = await validateToken();
      if (!tokenCheck.valid) {
        _log('token-rejected-after-refresh', { error: tokenCheck.error });
        throw { code: 'TOKEN_INVALID', message: 'Token still invalid after refresh: ' + (tokenCheck.error || '') };
      }
    } else {
      _log('refresh-failed-giving-up', { error: refreshResult.error });
      throw { code: 'TOKEN_INVALID', message: (tokenCheck.error || 'Token expired') + ' | Refresh failed: ' + refreshResult.error };
    }
  }
  if (tokenCheck.orgAccess === false) {
    _log('org-access-denied', { error: tokenCheck.orgError });
    console.warn('[LinkedIn] WARNING: org access check failed:', tokenCheck.orgError, '— proceeding with post attempt');
  }

  _log('publish-start', { textLength: text.length, author: authorUrn });

  var media = (action.payload && action.payload.media) || [];

  // Build attempts list using current creds
  var result = await _tryAllApis(creds, authorUrn, text, media);
  if (result.ok) return result.value;

  // If all failed with 401/403, try one refresh + retry
  var has401 = result.errors.some(function (e) { return e.statusCode === 401 || e.statusCode === 403; });
  if (has401 && creds.refreshToken) {
    _log('post-failed-401-attempting-refresh', {});
    var refresh = await _refreshAccessToken(creds);
    if (refresh.ok) {
      creds = await getCredentials();
      authorUrn = getAuthorUrn(creds);
      var retry = await _tryAllApis(creds, authorUrn, text, media);
      if (retry.ok) return retry.value;
      result = retry; // use retry errors for final message
    }
  }

  var finalMsg = result.errors.map(function (e) { return e.label + ': ' + e.message; }).join(' → ') + ' | author=' + authorUrn;
  _log('publish-all-failed', { errors: result.errors });
  throw { code: 'LINKEDIN_ALL_APIS_FAILED', message: finalMsg };
}

/**
 * Try all 3 LinkedIn APIs in order. Returns {ok, value, errors}.
 */
async function _tryAllApis(creds, authorUrn, text, media) {
  var attempts = [];

  // ── Attempt 1: New Posts API (/rest/posts) — org author ──
  var postsPayload = {
    author: authorUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: []
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false
  };

  if (media.length > 0) {
    var firstMedia1 = typeof media[0] === 'string' ? media[0] : (media[0].url || media[0].id || '');
    if (firstMedia1.startsWith('http')) {
      postsPayload.content = {
        article: {
          source: firstMedia1,
          title: (typeof media[0] === 'object' && media[0].title) || 'Shared content'
        }
      };
    }
  }

  attempts.push({
    label: 'Posts API (org)',
    url: 'https://api.linkedin.com/rest/posts',
    body: JSON.stringify(postsPayload),
    headers: {
      'LinkedIn-Version': '202502',
      'X-Restli-Protocol-Version': '2.0.0'
    }
  });

  // ── Attempt 2: UGC Posts API (/v2/ugcPosts) — org author ──
  var shareContent = { shareCommentary: { text: text }, shareMediaCategory: 'NONE' };
  if (media.length > 0) {
    var firstMedia2 = typeof media[0] === 'string' ? media[0] : (media[0].url || media[0].id || '');
    if (firstMedia2.startsWith('http')) {
      shareContent.shareMediaCategory = 'ARTICLE';
      shareContent.media = [{ status: 'READY', originalUrl: firstMedia2, title: { text: (typeof media[0] === 'object' && media[0].title) || 'Shared content' } }];
    }
  }
  attempts.push({
    label: 'UGC Posts API (org)',
    url: LINKEDIN_API_URL,
    body: JSON.stringify({
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    }),
    headers: { 'X-Restli-Protocol-Version': '2.0.0' }
  });

  // ── Attempt 3: Shares API (/v2/shares) — org owner ──
  attempts.push({
    label: 'Shares API (org)',
    url: 'https://api.linkedin.com/v2/shares',
    body: JSON.stringify({
      owner: authorUrn,
      text: { text: text },
      distribution: { linkedInDistributionTarget: {} }
    }),
    headers: { 'X-Restli-Protocol-Version': '2.0.0' }
  });

  var errors = [];
  for (var i = 0; i < attempts.length; i++) {
    var attempt = attempts[i];
    try {
      var result = await _linkedInPost(attempt, creds, text);
      _log('publish-success', { api: attempt.label, postId: result.receipt.post_id });
      return { ok: true, value: result };
    } catch (err) {
      var errMsg = err.message || err.code || JSON.stringify(err).substring(0, 200);
      _log('publish-attempt-failed', { api: attempt.label, error: errMsg, statusCode: err.statusCode });
      errors.push({ label: attempt.label, message: errMsg, statusCode: err.statusCode });
    }
  }

  return { ok: false, errors: errors };
}

/**
 * Execute a single LinkedIn POST attempt
 * @param {Object} attempt - {label, url, body, headers}
 * @param {Object} creds - Credentials
 * @param {string} text - Original post text
 * @returns {Promise<{receipt: Object}>}
 */
function _linkedInPost(attempt, creds, text) {
  // Wrap the POST in retryOn429. Errors carry statusCode for the helper's status detection.
  // Only retries 429 + 5xx — 401/403 (token issues) and 4xx other errors throw immediately.
  const _doPost = () => new Promise((resolve, reject) => {
    const url = new URL(attempt.url);
    const headers = Object.assign({
      'Authorization': 'Bearer ' + creds.accessToken,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(attempt.body)
    }, attempt.headers || {});

    const options = {
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = null; }

        if (res.statusCode === 201) {
          const postUrn = (parsed && parsed.id) || res.headers['x-restli-id'] || res.headers['x-linkedin-id'] || '';
          const postId = postUrn.split(':').pop() || postUrn;
          resolve({
            receipt: {
              platform: 'linkedin',
              handle: getAuthorUrn(creds),
              post_id: postId,
              post_urn: postUrn,
              post_url: postId ? 'https://www.linkedin.com/feed/update/' + postUrn : '',
              timestamp: new Date().toISOString(),
              content_hash: contentHash(text),
              api: attempt.label,
              author: getAuthorUrn(creds)
            }
          });
        } else if (res.statusCode === 403) {
          // Specific 403 handling with actionable message
          let errMsg = (parsed && parsed.message) || data.substring(0, 300);
          const hint = 'Token missing w_organization_social scope OR token owner is not an admin of org ' + creds.orgId + '. '
            + 'Verify at: https://www.linkedin.com/developers/apps — ensure "Advertising on LinkedIn" or "Marketing Developer Platform" product is enabled '
            + 'and the app has w_organization_social permission.';
          reject({
            code: 'LINKEDIN_ORG_AUTH_FAILED',
            statusCode: 403,
            message: errMsg + ' | HINT: ' + hint
          });
        } else {
          let errMsg = (parsed && parsed.message) || (parsed && parsed.status) || data.substring(0, 300);
          reject({
            code: 'LINKEDIN_API_ERROR_' + res.statusCode,
            statusCode: res.statusCode,
            message: errMsg
          });
        }
      });
    });

    req.on('error', (err) => reject({ code: 'NETWORK_ERROR', message: err.message }));
    req.setTimeout(15000, () => { req.destroy(); reject({ code: 'TIMEOUT', message: 'Timeout' }); });
    req.write(attempt.body);
    req.end();
  });

  return retryOn429(_doPost, { platform: 'linkedin', actionId: null });
}

module.exports = {
  publishToLinkedIn,
  getCredentials,
  getAuthorUrn,
  validateCredentials,
  validateToken,
  contentHash,
  _refreshAccessToken
};

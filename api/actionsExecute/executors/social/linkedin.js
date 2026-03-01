// linkedin.js — LinkedIn platform adapter for social_post.publish
// OAuth 2.0 Bearer Token — LinkedIn UGC Posts API (/v2/ugcPosts)
// Posts as AmbientPixels ORGANIZATION page (urn:li:organization:{orgId})
// Requires w_organization_social scope on the OAuth token
// Env vars: LINKEDIN_ACCESS_TOKEN, LINKEDIN_ORG_ID

const https = require('https');
const crypto = require('crypto');

const LINKEDIN_API_URL = 'https://api.linkedin.com/v2/ugcPosts';
const MAX_CHARS = 3000;
// NOTE: Native image upload deferred — LinkedIn org posting permissions differ from Ads access.
// Media[] items are shared as article link cards for now.

function getCredentials() {
  return {
    accessToken: process.env.LINKEDIN_ACCESS_TOKEN || '',
    orgId: process.env.LINKEDIN_ORG_ID || '107826087'
  };
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
  const creds = getCredentials();
  const entry = Object.assign({
    _source: 'linkedin-adapter',
    event: event,
    target: 'organization',
    orgId: creds.orgId,
    author: getAuthorUrn(creds),
    ts: new Date().toISOString()
  }, data || {});
  console.log('[LinkedIn]', JSON.stringify(entry));
}

/**
 * Pre-flight token check — calls /v2/userinfo to verify token validity.
 * Also checks /v2/organizationAcls to verify org posting permission.
 * @returns {Promise<{valid: boolean, name?: string, error?: string, orgAccess?: boolean}>}
 */
function validateToken() {
  const creds = getCredentials();
  if (!creds.accessToken) return Promise.resolve({ valid: false, error: 'LINKEDIN_ACCESS_TOKEN not set' });

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
  const creds = getCredentials();
  const credError = validateCredentials(creds);
  if (credError) {
    _log('credential-error', { error: credError });
    throw { code: 'MISSING_CREDENTIALS', message: credError };
  }

  const authorUrn = getAuthorUrn(creds);
  let text = (action.payload && action.payload.text) || '';
  if (!text || text.trim().length === 0) {
    throw { code: 'EMPTY_CONTENT', message: 'Post text is empty' };
  }
  if (text.length > MAX_CHARS) {
    _log('truncating', { original: text.length, limit: MAX_CHARS });
    text = text.substring(0, MAX_CHARS - 1).replace(/\s+\S*$/, '') + '\u2026';
  }

  // Pre-flight: verify token is still valid + check org access
  const tokenCheck = await validateToken();
  if (!tokenCheck.valid) {
    _log('token-rejected', { error: tokenCheck.error });
    throw { code: 'TOKEN_INVALID', message: tokenCheck.error || 'LinkedIn access token is invalid or expired. Refresh it in Azure App Settings.' };
  }
  if (tokenCheck.orgAccess === false) {
    _log('org-access-denied', { error: tokenCheck.orgError });
    // Warn but don't block — the actual post call is the definitive check
    console.warn('[LinkedIn] WARNING: org access check failed:', tokenCheck.orgError, '— proceeding with post attempt');
  }

  _log('publish-start', { textLength: text.length, author: authorUrn });

  const media = (action.payload && action.payload.media) || [];
  const attempts = [];

  // ── Attempt 1: New Posts API (/rest/posts) — org author ──
  const postsPayload = {
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
    const firstMedia = typeof media[0] === 'string' ? media[0] : (media[0].url || media[0].id || '');
    if (firstMedia.startsWith('http')) {
      postsPayload.content = {
        article: {
          source: firstMedia,
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
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0'
    }
  });

  // ── Attempt 2: UGC Posts API (/v2/ugcPosts) — org author ──
  const shareContent = { shareCommentary: { text: text }, shareMediaCategory: 'NONE' };
  if (media.length > 0) {
    const firstMedia = typeof media[0] === 'string' ? media[0] : (media[0].url || media[0].id || '');
    if (firstMedia.startsWith('http')) {
      shareContent.shareMediaCategory = 'ARTICLE';
      shareContent.media = [{ status: 'READY', originalUrl: firstMedia, title: { text: (typeof media[0] === 'object' && media[0].title) || 'Shared content' } }];
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

  // Try each API in order until one succeeds
  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await _linkedInPost(attempt, creds, text);
      _log('publish-success', { api: attempt.label, postId: result.receipt.post_id });
      return result;
    } catch (err) {
      const errMsg = err.message || err.code || JSON.stringify(err).substring(0, 200);
      _log('publish-attempt-failed', { api: attempt.label, error: errMsg, statusCode: err.statusCode });
      errors.push(attempt.label + ': ' + errMsg);
    }
  }

  // All attempts failed
  const finalMsg = errors.join(' → ') + ' | author=' + authorUrn;
  _log('publish-all-failed', { errors: errors });
  throw {
    code: 'LINKEDIN_ALL_APIS_FAILED',
    message: finalMsg
  };
}

/**
 * Execute a single LinkedIn POST attempt
 * @param {Object} attempt - {label, url, body, headers}
 * @param {Object} creds - Credentials
 * @param {string} text - Original post text
 * @returns {Promise<{receipt: Object}>}
 */
function _linkedInPost(attempt, creds, text) {
  return new Promise((resolve, reject) => {
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
}

module.exports = {
  publishToLinkedIn,
  getCredentials,
  getAuthorUrn,
  validateCredentials,
  validateToken,
  contentHash
};

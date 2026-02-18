// linkedin.js — LinkedIn platform adapter for social_post.publish
// OAuth 2.0 Bearer Token — LinkedIn UGC Posts API (/v2/ugcPosts)
// Requires "Share on LinkedIn" product (w_member_social scope)
// Env vars: LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN

const https = require('https');
const crypto = require('crypto');

const LINKEDIN_API_URL = 'https://api.linkedin.com/v2/ugcPosts';
const MAX_CHARS = 3000;

function getCredentials() {
  return {
    accessToken: process.env.LINKEDIN_ACCESS_TOKEN || '',
    personUrn: process.env.LINKEDIN_PERSON_URN || '' // e.g. urn:li:person:ACoAAA...
  };
}

function validateCredentials(creds) {
  if (!creds.accessToken) return 'LINKEDIN_ACCESS_TOKEN not set';
  if (!creds.personUrn) return 'LINKEDIN_PERSON_URN not set';
  return null;
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Extract numeric member ID from a base64-encoded LinkedIn person URN.
 * LinkedIn encodes the numeric ID inside the base64 bytes.
 * Format: 2-byte type prefix + entity data. Numeric ID is typically at byte offset 4 as uint32 BE.
 * @param {string} encodedId - The base64-encoded part of urn:li:person:{encodedId}
 * @returns {string|null} Numeric member ID or null
 */
function decodeNumericIdFromUrn(encodedId) {
  try {
    const buf = Buffer.from(encodedId, 'base64');
    if (buf.length < 8) return null;
    // LinkedIn URN: bytes 0-1 = type prefix (0x00, 0x2A for member), bytes 4-7 = numeric member ID
    const id = buf.readUInt32BE(4);
    if (id > 10000 && id < 2000000000) return String(id);
    // Fallback: try offset 0
    const id0 = buf.readUInt32BE(0);
    if (id0 > 10000 && id0 < 2000000000) return String(id0);
  } catch (e) {}
  return null;
}

/**
 * Resolve numeric member ID. Tries in order:
 * 1. /v2/me API call (requires r_liteprofile scope)
 * 2. Decode from base64-encoded URN in env var
 * @returns {Promise<{memberId: string|null, error?: string, method?: string}>}
 */
function resolveMemberId() {
  const creds = getCredentials();
  if (!creds.accessToken) return Promise.resolve({ memberId: null, error: 'No token' });

  // First: try to decode numeric ID directly from the encoded URN (no API call needed)
  const urnParts = (creds.personUrn || '').split(':');
  const encodedId = urnParts[urnParts.length - 1] || '';
  if (encodedId && !/^\d+$/.test(encodedId)) {
    const decoded = decodeNumericIdFromUrn(encodedId);
    if (decoded) {
      return Promise.resolve({ memberId: decoded, method: 'base64-decode' });
    }
  } else if (/^\d+$/.test(encodedId)) {
    // URN already contains a numeric ID
    return Promise.resolve({ memberId: encodedId, method: 'env-var-numeric' });
  }

  // Fallback: try /v2/me API
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.linkedin.com',
      path: '/v2/me?projection=(id)',
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
            const me = JSON.parse(data);
            resolve({ memberId: me.id || null, method: 'api-v2-me' });
          } catch (e) { resolve({ memberId: null, error: 'Parse error' }); }
        } else {
          resolve({ memberId: null, error: '/v2/me HTTP ' + res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ memberId: null, error: err.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ memberId: null, error: 'Timeout' }); });
    req.end();
  });
}

/**
 * Pre-flight token check — calls /v2/userinfo to verify token validity
 * @returns {Promise<{valid: boolean, name?: string, error?: string}>}
 */
function validateToken() {
  const creds = getCredentials();
  if (!creds.accessToken) return Promise.resolve({ valid: false, error: 'LINKEDIN_ACCESS_TOKEN not set' });
  return new Promise((resolve) => {
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
        if (res.statusCode === 200) {
          try {
            const me = JSON.parse(data);
            resolve({ valid: true, name: me.name || '', sub: me.sub });
          } catch (e) { resolve({ valid: true }); }
        } else if (res.statusCode === 401) {
          resolve({ valid: false, error: 'Access token expired or revoked (401). Generate a new token at https://www.linkedin.com/developers/apps' });
        } else if (res.statusCode === 403) {
          // 403 on /v2/userinfo means token is active but lacks openid scope — still valid for posting
          resolve({ valid: true, limited: true });
        } else {
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
 * Publish a post to LinkedIn using UGC Posts API
 * @param {Object} action - Full action object
 * @returns {Promise<{receipt: Object}>}
 */
async function publishToLinkedIn(action) {
  const creds = getCredentials();
  const credError = validateCredentials(creds);
  if (credError) {
    throw { code: 'MISSING_CREDENTIALS', message: credError };
  }

  const text = (action.payload && action.payload.text) || '';
  if (!text || text.trim().length === 0) {
    throw { code: 'EMPTY_CONTENT', message: 'Post text is empty' };
  }
  if (text.length > MAX_CHARS) {
    throw { code: 'CONTENT_TOO_LONG', message: 'Post exceeds ' + MAX_CHARS + ' chars (' + text.length + ')' };
  }

  // Pre-flight: verify token is still valid
  const tokenCheck = await validateToken();
  if (!tokenCheck.valid) {
    throw { code: 'TOKEN_INVALID', message: tokenCheck.error || 'LinkedIn access token is invalid or expired. Refresh it in Azure App Settings.' };
  }

  // Resolve numeric member ID from base64-encoded URN or env var
  const meResult = await resolveMemberId();
  const numericId = (meResult.memberId && /^\d+$/.test(meResult.memberId)) ? meResult.memberId : null;
  const media = (action.payload && action.payload.media) || [];

  // Build API attempts in priority order:
  // 1. New Posts API (/rest/posts) — replaces deprecated UGC, uses urn:li:person:{numericId}
  // 2. UGC Posts API (/v2/ugcPosts) — legacy, uses urn:li:member:{numericId}
  // 3. Shares API (/v2/shares) — oldest fallback
  const attempts = [];

  if (numericId) {
    // ── Attempt 1: New Posts API (/rest/posts) ──
    const postsPayload = {
      author: 'urn:li:person:' + numericId,
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
      label: 'Posts API',
      url: 'https://api.linkedin.com/rest/posts',
      body: JSON.stringify(postsPayload),
      headers: {
        'LinkedIn-Version': '202401',
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });

    // ── Attempt 2: UGC Posts API (/v2/ugcPosts) ──
    const shareContent = { shareCommentary: { text: text }, shareMediaCategory: 'NONE' };
    if (media.length > 0) {
      const firstMedia = typeof media[0] === 'string' ? media[0] : (media[0].url || media[0].id || '');
      if (firstMedia.startsWith('http')) {
        shareContent.shareMediaCategory = 'ARTICLE';
        shareContent.media = [{ status: 'READY', originalUrl: firstMedia, title: { text: (typeof media[0] === 'object' && media[0].title) || 'Shared content' } }];
      }
    }
    attempts.push({
      label: 'UGC Posts API',
      url: LINKEDIN_API_URL,
      body: JSON.stringify({
        author: 'urn:li:member:' + numericId,
        lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
      }),
      headers: { 'X-Restli-Protocol-Version': '2.0.0' }
    });
  }

  // ── Attempt 3: Shares API (/v2/shares) — last resort ──
  attempts.push({
    label: 'Shares API',
    url: 'https://api.linkedin.com/v2/shares',
    body: JSON.stringify({
      owner: creds.personUrn,
      text: { text: text },
      distribution: { linkedInDistributionTarget: {} }
    }),
    headers: { 'X-Restli-Protocol-Version': '2.0.0' }
  });

  // Try each API in order until one succeeds
  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await _linkedInPost(attempt, creds, text, meResult);
      return result;
    } catch (err) {
      errors.push(attempt.label + ': ' + (err.message || err.code || JSON.stringify(err).substring(0, 200)));
    }
  }

  // All attempts failed
  throw {
    code: 'LINKEDIN_ALL_APIS_FAILED',
    message: errors.join(' → ') + ' | resolved=' + (numericId || 'null') + ' via ' + (meResult.method || meResult.error || 'unknown')
  };
}

/**
 * Execute a single LinkedIn POST attempt
 * @param {Object} attempt - {label, url, body, headers}
 * @param {Object} creds - Credentials
 * @param {string} text - Original post text
 * @param {Object} meResult - Member ID resolution result
 * @returns {Promise<{receipt: Object}>}
 */
function _linkedInPost(attempt, creds, text, meResult) {
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
              handle: creds.personUrn,
              post_id: postId,
              post_urn: postUrn,
              post_url: postId ? 'https://www.linkedin.com/feed/update/' + postUrn : '',
              timestamp: new Date().toISOString(),
              content_hash: contentHash(text),
              api: attempt.label
            }
          });
        } else {
          let errMsg = (parsed && parsed.message) || (parsed && parsed.status) || data.substring(0, 300);
          reject({
            code: 'LINKEDIN_API_ERROR_' + res.statusCode,
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
  validateCredentials,
  validateToken,
  contentHash
};

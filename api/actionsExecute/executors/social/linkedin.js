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
 * Resolve numeric member ID from LinkedIn /v2/me endpoint.
 * The UGC Posts API requires urn:li:member:{NUMERIC_ID} format.
 * The env var contains an encoded hash ID which the API rejects.
 * @returns {Promise<{memberId: string|null, error?: string, raw?: string}>}
 */
function resolveMemberId() {
  const creds = getCredentials();
  if (!creds.accessToken) return Promise.resolve({ memberId: null, error: 'No token' });
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
            resolve({ memberId: me.id || null, raw: data.substring(0, 200) });
          } catch (e) { resolve({ memberId: null, error: 'Parse error: ' + data.substring(0, 100) }); }
        } else {
          resolve({ memberId: null, error: '/v2/me returned HTTP ' + res.statusCode + ': ' + data.substring(0, 200) });
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

  // Resolve numeric member ID — UGC Posts API requires urn:li:member:{NUMERIC_ID}
  // The env var contains an encoded hash (ACoAAA...) which the API rejects
  const meResult = await resolveMemberId();
  let useSharesApi = false;

  let authorUrn;
  if (meResult.memberId && /^\d+$/.test(meResult.memberId)) {
    // Got numeric ID — use UGC Posts API with urn:li:member: prefix
    authorUrn = 'urn:li:member:' + meResult.memberId;
  } else {
    // /v2/me failed or returned non-numeric ID — fall back to Shares API
    // Shares API accepts urn:li:person: with encoded IDs
    authorUrn = creds.personUrn;
    useSharesApi = true;
  }

  const media = (action.payload && action.payload.media) || [];
  let body, apiUrl;

  if (useSharesApi) {
    // ── Shares API fallback (/v2/shares) ──
    // Works with w_member_social scope and accepts encoded person URNs
    apiUrl = 'https://api.linkedin.com/v2/shares';
    const sharesPayload = {
      owner: authorUrn,
      text: { text: text },
      distribution: {
        linkedInDistributionTarget: {}
      }
    };

    // Attach article media if provided
    if (media.length > 0) {
      const firstMedia = typeof media[0] === 'string' ? media[0] : (media[0].url || media[0].id || '');
      if (firstMedia.startsWith('http')) {
        sharesPayload.content = {
          contentEntities: [{
            entityLocation: firstMedia,
            entity: firstMedia
          }],
          title: (typeof media[0] === 'object' && media[0].title) || 'Shared content'
        };
      }
    }

    body = JSON.stringify(sharesPayload);
  } else {
    // ── UGC Posts API (primary) ──
    apiUrl = LINKEDIN_API_URL;
    const shareContent = {
      shareCommentary: { text: text },
      shareMediaCategory: 'NONE'
    };

    if (media.length > 0) {
      const firstMedia = typeof media[0] === 'string' ? media[0] : (media[0].url || media[0].id || '');
      if (firstMedia.startsWith('http')) {
        shareContent.shareMediaCategory = 'ARTICLE';
        shareContent.media = [{
          status: 'READY',
          originalUrl: firstMedia,
          title: { text: (typeof media[0] === 'object' && media[0].title) || 'Shared content' }
        }];
      }
    }

    const postPayload = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': shareContent
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    };

    body = JSON.stringify(postPayload);
  }

  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + creds.accessToken,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Length': Buffer.byteLength(body)
      }
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
              content_hash: contentHash(text)
            }
          });
        } else {
          let errMsg = (parsed && parsed.message) || (parsed && parsed.status) || data.substring(0, 300);
          errMsg += ' | DEBUG: api=' + apiUrl + ', author=' + authorUrn + ', /v2/me=' + (meResult.memberId || meResult.error || 'null');
          if (res.statusCode === 403) {
            errMsg += ' | 403 Hint: Token may lack w_member_social scope, or URN does not match the token owner.';
          } else if (res.statusCode === 401) {
            errMsg += ' | 401 Hint: Access token expired. LinkedIn tokens expire after 60 days.';
          }
          reject({
            code: 'LINKEDIN_API_ERROR_' + res.statusCode,
            message: errMsg,
            raw: data.substring(0, 500)
          });
        }
      });
    });

    req.on('error', (err) => {
      reject({ code: 'NETWORK_ERROR', message: err.message });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject({ code: 'TIMEOUT', message: 'LinkedIn API request timed out after 15s' });
    });

    req.write(body);
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

// linkedin.js — LinkedIn platform adapter for social_post.publish
// OAuth 2.0 Bearer Token — LinkedIn Community Management Posts API (/rest/posts)
// Env vars: LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN

const https = require('https');
const crypto = require('crypto');

const LINKEDIN_API_URL = 'https://api.linkedin.com/rest/posts';
const LINKEDIN_API_VERSION = '202601';
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
 * Pre-flight token check — calls /v2/me to verify token validity
 * @returns {Promise<{valid: boolean, name?: string, error?: string}>}
 */
function validateToken() {
  const creds = getCredentials();
  if (!creds.accessToken) return Promise.resolve({ valid: false, error: 'LINKEDIN_ACCESS_TOKEN not set' });
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.linkedin.com',
      path: '/v2/me',
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
            resolve({ valid: true, name: (me.localizedFirstName || '') + ' ' + (me.localizedLastName || ''), sub: me.id });
          } catch (e) { resolve({ valid: true }); }
        } else if (res.statusCode === 401) {
          resolve({ valid: false, error: 'Access token expired or revoked (401). Generate a new token at https://www.linkedin.com/developers/apps' });
        } else if (res.statusCode === 403) {
          // 403 on /v2/me means token is active but lacks profile scope — still valid for posting
          resolve({ valid: true, limited: true });
        } else {
          resolve({ valid: false, error: 'LinkedIn /v2/me returned HTTP ' + res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ valid: false, error: 'Network error checking token: ' + err.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ valid: false, error: 'Token check timed out' }); });
    req.end();
  });
}

/**
 * Publish a post to LinkedIn
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

  // Build Posts API payload
  const postPayload = {
    author: creds.personUrn,
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

  // If media provided with URN IDs (uploaded via Images/Videos API), attach
  const media = (action.payload && action.payload.media) || [];
  if (media.length > 0) {
    const firstMedia = typeof media[0] === 'string' ? media[0] : (media[0].id || media[0].url || '');
    // URN-based media (urn:li:image:xxx or urn:li:video:xxx)
    if (firstMedia.startsWith('urn:li:')) {
      postPayload.content = {
        media: {
          id: firstMedia,
          title: (typeof media[0] === 'object' && media[0].title) || ''
        }
      };
    }
    // URL-based article share (link preview)
    else if (firstMedia.startsWith('http')) {
      postPayload.content = {
        article: {
          source: firstMedia,
          title: (typeof media[0] === 'object' && media[0].title) || 'Shared content'
        }
      };
    }
  }

  const body = JSON.stringify(postPayload);

  return new Promise((resolve, reject) => {
    const url = new URL(LINKEDIN_API_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + creds.accessToken,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LINKEDIN_API_VERSION,
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
          // Add diagnostic hints for common errors
          if (res.statusCode === 403) {
            errMsg += ' | 403 Hint: Token may lack w_member_social scope, or person URN (' + creds.personUrn + ') does not match the token owner. Regenerate token with correct scopes.';
          } else if (res.statusCode === 401) {
            errMsg += ' | 401 Hint: Access token expired. LinkedIn tokens expire after 60 days. Refresh at https://www.linkedin.com/developers/apps';
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

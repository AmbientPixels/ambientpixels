// linkedin.js — LinkedIn platform adapter for social_post.publish
// OAuth 2.0 Bearer Token — LinkedIn Community Management Posts API (/rest/posts)
// Env vars: LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN

const https = require('https');
const crypto = require('crypto');

const LINKEDIN_API_URL = 'https://api.linkedin.com/rest/posts';
const LINKEDIN_API_VERSION = '202301';
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
    lifecycleState: 'PUBLISHED'
  };

  // If media URLs provided, attach as articles
  const media = (action.payload && action.payload.media) || [];
  if (media.length > 0) {
    postPayload.content = {
      article: {
        source: typeof media[0] === 'string' ? media[0] : media[0].url,
        title: (typeof media[0] === 'object' && media[0].title) || 'Shared content'
      }
    };
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
          const errMsg = (parsed && parsed.message) || (parsed && parsed.status) || data.substring(0, 300);
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
  contentHash
};

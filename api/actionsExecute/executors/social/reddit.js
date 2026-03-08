// reddit.js — Reddit platform adapter for social_post.publish / social_post.schedule
// Script app + username/password OAuth (resource owner password grant)
// Env vars: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_DEFAULT_SUBREDDIT

const https = require('https');
const crypto = require('crypto');

const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_SUBMIT_URL = 'https://oauth.reddit.com/api/submit';
const MAX_TITLE_CHARS = 300;
const DEFAULT_USER_AGENT = 'AmbientPixels/1.0 (automated marketing bot)';

let _tokenCache = null;

function getCredentials() {
  return {
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
    username: process.env.REDDIT_USERNAME || '',
    password: process.env.REDDIT_PASSWORD || '',
    defaultSubreddit: process.env.REDDIT_DEFAULT_SUBREDDIT || 'AmbientPixels'
  };
}

function validateCredentials(creds) {
  if (!creds.clientId) return 'REDDIT_CLIENT_ID not set';
  if (!creds.clientSecret) return 'REDDIT_CLIENT_SECRET not set';
  if (!creds.username) return 'REDDIT_USERNAME not set';
  if (!creds.password) return 'REDDIT_PASSWORD not set';
  return null;
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Make an HTTPS request and return parsed JSON
 */
function httpRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: method,
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        resolve({ status: res.statusCode, data: json, raw: data });
      });
    });

    req.on('error', (err) => reject({ code: 'NETWORK_ERROR', message: err.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      reject({ code: 'TIMEOUT', message: 'Reddit API request timed out' });
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Get OAuth access token via username+password grant (script app)
 */
async function getAccessToken(creds) {
  if (_tokenCache && _tokenCache.expiresAt > Date.now()) {
    return _tokenCache.token;
  }

  const basicAuth = Buffer.from(creds.clientId + ':' + creds.clientSecret).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username: creds.username,
    password: creds.password
  }).toString();

  const res = await httpRequest(REDDIT_TOKEN_URL, 'POST', {
    'Authorization': 'Basic ' + basicAuth,
    'User-Agent': DEFAULT_USER_AGENT,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body)
  }, body);

  if (res.status !== 200 || !res.data || !res.data.access_token) {
    throw {
      code: 'REDDIT_AUTH_ERROR',
      message: (res.data && res.data.message) || (res.data && res.data.error) || 'Authentication failed (HTTP ' + res.status + ')',
      raw: (res.raw || '').substring(0, 300)
    };
  }

  const ttl = (res.data.expires_in || 3600) * 1000;
  _tokenCache = {
    token: res.data.access_token,
    expiresAt: Date.now() + ttl - 60000 // refresh 1 min early
  };

  return _tokenCache.token;
}

/**
 * Parse Reddit title + body from action payload.
 * Supports:
 *   - payload.title + payload.text (explicit split)
 *   - payload.text starting with "TITLE: ..." on first line
 *   - Fallback: first line = title, rest = body
 */
function parseTitleAndBody(payload) {
  // Explicit title field takes priority
  if (payload.title && payload.text) {
    var title = String(payload.title).trim().substring(0, MAX_TITLE_CHARS);
    return { title, body: String(payload.text).trim() };
  }

  var raw = String(payload.text || '').trim();

  // Check for "TITLE: ..." convention on first line
  var titleMatch = raw.match(/^TITLE:\s*(.+?)(?:\n|$)([\s\S]*)/i);
  if (titleMatch) {
    var title = titleMatch[1].trim().substring(0, MAX_TITLE_CHARS);
    var body = (titleMatch[2] || '').trim();
    return { title, body };
  }

  // Fallback: first line = title, rest = body
  var newline = raw.indexOf('\n');
  if (newline > 0) {
    var title = raw.substring(0, newline).trim().substring(0, MAX_TITLE_CHARS);
    var body = raw.substring(newline + 1).trim();
    return { title, body };
  }

  // Single-line post: use full text as title with empty body
  return { title: raw.substring(0, MAX_TITLE_CHARS), body: '' };
}

/**
 * Resolve target subreddit from payload or env
 */
function resolveSubreddit(payload, creds) {
  var sr = (payload && payload.subreddit) ? String(payload.subreddit).replace(/^r\//, '').trim() : '';
  return sr || creds.defaultSubreddit || 'AmbientPixels';
}

/**
 * Publish a text post to Reddit
 * @param {Object} action - Full action object
 * @returns {Promise<{receipt: Object}>}
 */
async function publishToReddit(action) {
  const creds = getCredentials();
  const credError = validateCredentials(creds);
  if (credError) {
    throw { code: 'MISSING_CREDENTIALS', message: credError };
  }

  const payload = action.payload || {};
  if (!payload.text && !payload.title) {
    throw { code: 'EMPTY_CONTENT', message: 'Post text is empty' };
  }

  const { title, body } = parseTitleAndBody(payload);
  if (!title) {
    throw { code: 'MISSING_TITLE', message: 'Reddit posts require a title' };
  }

  const subreddit = resolveSubreddit(payload, creds);
  const token = await getAccessToken(creds);

  const submitBody = new URLSearchParams({
    kind: 'self',
    sr: subreddit,
    title: title,
    text: body || '',
    sendreplies: 'true',
    resubmit: 'true'
  }).toString();

  const res = await httpRequest(REDDIT_SUBMIT_URL, 'POST', {
    'Authorization': 'Bearer ' + token,
    'User-Agent': DEFAULT_USER_AGENT,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(submitBody)
  }, submitBody);

  // Reddit returns 200 even for errors — check json.errors array
  const rData = res.data && res.data.json;
  if (res.status !== 200 || !rData) {
    throw {
      code: 'REDDIT_API_ERROR_' + res.status,
      message: (res.raw || '').substring(0, 300)
    };
  }

  if (rData.errors && rData.errors.length > 0) {
    throw {
      code: 'REDDIT_SUBMIT_ERROR',
      message: rData.errors.map(function(e) { return e[1] || e[0]; }).join('; '),
      raw: JSON.stringify(rData.errors)
    };
  }

  const postData = rData.data || {};
  const postId = postData.id || '';
  const postUrl = postData.url ? ('https://reddit.com' + postData.url.replace(/^https?:\/\/www\.reddit\.com/, '')) : ('https://reddit.com/r/' + subreddit);
  const now = new Date().toISOString();

  return {
    receipt: {
      platform: 'reddit',
      account: 'u/' + creds.username,
      post_id: postId,
      post_url: postUrl,
      subreddit: 'r/' + subreddit,
      title: title,
      timestamp: now,
      content_hash: contentHash(title + '\n' + body)
    }
  };
}

module.exports = {
  publishToReddit,
  getCredentials,
  validateCredentials,
  parseTitleAndBody,
  resolveSubreddit,
  contentHash
};

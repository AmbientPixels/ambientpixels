// bluesky.js — Bluesky platform adapter for social_post.publish
// AT Protocol — createRecord on app.bsky.feed.post
// Env vars: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD

const https = require('https');
const crypto = require('crypto');
const media = require('./media');

const BLUESKY_PDS = 'https://bsky.social';
const MAX_CHARS = 300; // Bluesky grapheme limit
const MAX_MEDIA = 4; // Bluesky allows up to 4 images per post
const BSKY_MAX_IMAGE_BYTES = 1000000; // Bluesky 1MB image limit

let _sessionCache = null;

function getCredentials() {
  return {
    handle: process.env.BLUESKY_HANDLE || '',
    appPassword: process.env.BLUESKY_APP_PASSWORD || ''
  };
}

function validateCredentials(creds) {
  if (!creds.handle) return 'BLUESKY_HANDLE not set';
  if (!creds.appPassword) return 'BLUESKY_APP_PASSWORD not set';
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
      reject({ code: 'TIMEOUT', message: 'Bluesky API request timed out' });
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Authenticate with Bluesky PDS — returns session with accessJwt and did
 */
async function createSession(creds) {
  // Reuse cached session if available and not expired
  if (_sessionCache && _sessionCache.expiresAt > Date.now()) {
    return _sessionCache;
  }

  const body = JSON.stringify({
    identifier: creds.handle,
    password: creds.appPassword
  });

  const res = await httpRequest(
    BLUESKY_PDS + '/xrpc/com.atproto.server.createSession',
    'POST',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body
  );

  if (res.status !== 200 || !res.data || !res.data.accessJwt) {
    throw {
      code: 'BLUESKY_AUTH_ERROR',
      message: (res.data && res.data.message) || 'Authentication failed (HTTP ' + res.status + ')',
      raw: (res.raw || '').substring(0, 500)
    };
  }

  _sessionCache = {
    accessJwt: res.data.accessJwt,
    did: res.data.did,
    handle: res.data.handle,
    expiresAt: Date.now() + (10 * 60 * 1000) // cache for 10 min
  };

  return _sessionCache;
}

/**
 * Detect facets (links, mentions) in post text for rich text
 */
function detectFacets(text) {
  const facets = [];

  // URL detection
  const urlRegex = /https?:\/\/[^\s)]+/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    facets.push({
      index: { byteStart: Buffer.byteLength(text.substring(0, match.index)), byteEnd: Buffer.byteLength(text.substring(0, match.index + match[0].length)) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }]
    });
  }

  // Mention detection (@handle.bsky.social)
  const mentionRegex = /@([a-zA-Z0-9._-]+(\.[a-zA-Z0-9._-]+)+)/g;
  while ((match = mentionRegex.exec(text)) !== null) {
    facets.push({
      index: { byteStart: Buffer.byteLength(text.substring(0, match.index)), byteEnd: Buffer.byteLength(text.substring(0, match.index + match[0].length)) },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: match[1] }] // resolved later in production
    });
  }

  return facets;
}

/**
 * Publish a post to Bluesky
 * @param {Object} action - Full action object
 * @returns {Promise<{receipt: Object}>}
 */
async function publishToBluesky(action) {
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
    throw { code: 'CONTENT_TOO_LONG', message: 'Post exceeds ' + MAX_CHARS + ' characters (' + text.length + ')' };
  }

  // Authenticate
  const session = await createSession(creds);

  // Build post record
  const now = new Date().toISOString();
  const record = {
    $type: 'app.bsky.feed.post',
    text: text,
    createdAt: now,
    langs: ['en']
  };

  // Add facets (rich text: links, mentions)
  const facets = detectFacets(text);
  if (facets.length > 0) {
    record.facets = facets;
  }

  // Upload images from media[] if present — uses shared media module for host allowlist + download
  const mediaItems = media.extractMediaItems(action.payload && action.payload.media, MAX_MEDIA);
  const uploadedBlobs = [];
  for (const item of mediaItems) {
    try {
      const downloaded = await media.downloadMedia(item.url, { maxBytes: BSKY_MAX_IMAGE_BYTES });
      const blobRef = await _uploadBlob(session, downloaded.buffer, downloaded.contentType);
      uploadedBlobs.push({
        alt: item.alt || '',
        image: blobRef
      });
    } catch (blobErr) {
      // Non-fatal: skip this image, continue with others or text-only
      console.warn('[Bluesky] Image upload failed for', item.url, ':', blobErr.message || blobErr.code);
    }
  }

  // Attach images embed if any were uploaded
  if (uploadedBlobs.length > 0) {
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: uploadedBlobs
    };
  } else if (action.payload && action.payload.embed_url) {
    // Fallback: embed external link if provided in payload
    record.embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: action.payload.embed_url,
        title: action.payload.embed_title || '',
        description: action.payload.embed_description || ''
      }
    };
  }

  const body = JSON.stringify({
    repo: session.did,
    collection: 'app.bsky.feed.post',
    record: record
  });

  const res = await httpRequest(
    BLUESKY_PDS + '/xrpc/com.atproto.repo.createRecord',
    'POST',
    {
      'Authorization': 'Bearer ' + session.accessJwt,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  );

  if (res.status === 200 && res.data && res.data.uri) {
    // Parse AT URI → post URL
    // at://did:plc:xxx/app.bsky.feed.post/rkey → https://bsky.app/profile/handle/post/rkey
    const atUri = res.data.uri;
    const rkey = atUri.split('/').pop();
    const postUrl = 'https://bsky.app/profile/' + session.handle + '/post/' + rkey;

    return {
      receipt: {
        platform: 'bluesky',
        handle: '@' + session.handle,
        post_id: rkey,
        at_uri: atUri,
        cid: res.data.cid || '',
        post_url: postUrl,
        timestamp: now,
        content_hash: contentHash(text)
      }
    };
  } else {
    const errMsg = (res.data && res.data.message) || (res.data && res.data.error) || (res.raw || '').substring(0, 300);
    throw {
      code: 'BLUESKY_API_ERROR_' + res.status,
      message: errMsg,
      raw: (res.raw || '').substring(0, 500)
    };
  }
}

/**
 * Upload a blob to Bluesky PDS. Returns the blob ref object for embedding.
 */
async function _uploadBlob(session, buffer, contentType) {
  const res = await httpRequest(
    BLUESKY_PDS + '/xrpc/com.atproto.repo.uploadBlob',
    'POST',
    {
      'Authorization': 'Bearer ' + session.accessJwt,
      'Content-Type': contentType || 'image/jpeg',
      'Content-Length': buffer.length
    },
    buffer
  );

  if (res.status === 200 && res.data && res.data.blob) {
    return res.data.blob;
  }
  throw {
    code: 'BSKY_BLOB_UPLOAD_FAILED',
    message: 'uploadBlob returned HTTP ' + res.status + ': ' + (res.raw || '').substring(0, 300)
  };
}

module.exports = {
  publishToBluesky,
  getCredentials,
  validateCredentials,
  createSession,
  contentHash
};

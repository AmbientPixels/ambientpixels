// x.js — X (Twitter) platform adapter for social_post.publish
// OAuth 1.0a signing using HMAC-SHA1
// Env vars: X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET, X_HANDLE

const crypto = require('crypto');
const https = require('https');
const media = require('./media');
const { retryOn429, shouldSkipDueToExistingReceipt } = require('../../../_utils/platformRetry');

const X_API_URL = 'https://api.x.com/2/tweets';
const X_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const MAX_CHARS = 280;
const MAX_MEDIA = 4; // X allows up to 4 images per tweet
const SUPPORTED_MEDIA_TYPES = {
  'image/jpeg': 'tweet_image',
  'image/png': 'tweet_image',
  'image/gif': 'tweet_gif',
  'image/webp': 'tweet_image',
  'video/mp4': 'tweet_video'
};

function getCredentials() {
  return {
    consumerKey: process.env.X_CONSUMER_KEY || '',
    consumerSecret: process.env.X_CONSUMER_SECRET || '',
    accessToken: process.env.X_ACCESS_TOKEN || '',
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || '',
    handle: process.env.X_HANDLE || '@AIAmbientPixels'
  };
}

function validateCredentials(creds) {
  if (!creds.consumerKey) return 'X_CONSUMER_KEY not set';
  if (!creds.consumerSecret) return 'X_CONSUMER_SECRET not set';
  if (!creds.accessToken) return 'X_ACCESS_TOKEN not set';
  if (!creds.accessTokenSecret) return 'X_ACCESS_TOKEN_SECRET not set';
  return null;
}

// OAuth 1.0a signature generation
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function generateSignature(method, url, oauthParams, consumerSecret, tokenSecret) {
  // Sort params alphabetically
  const sortedKeys = Object.keys(oauthParams).sort();
  const paramString = sortedKeys
    .map(k => percentEncode(k) + '=' + percentEncode(oauthParams[k]))
    .join('&');

  const signatureBase = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString)
  ].join('&');

  const signingKey = percentEncode(consumerSecret) + '&' + percentEncode(tokenSecret);

  return crypto
    .createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');
}

function buildAuthHeader(oauthParams) {
  const parts = Object.keys(oauthParams)
    .filter(k => k.startsWith('oauth_'))
    .sort()
    .map(k => percentEncode(k) + '="' + percentEncode(oauthParams[k]) + '"');
  return 'OAuth ' + parts.join(', ');
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

const X_MAX_MEDIA_BYTES = 15 * 1024 * 1024; // 15 MB cap for X

/**
 * Upload media to X via v1.1 chunked upload (INIT → APPEND → FINALIZE)
 * Returns media_id_string
 */
async function uploadMediaToX(mediaBuffer, contentType, creds) {
  const mediaCategory = SUPPORTED_MEDIA_TYPES[contentType] || 'tweet_image';
  const totalBytes = mediaBuffer.length;

  // INIT
  const initParams = {
    command: 'INIT',
    total_bytes: totalBytes.toString(),
    media_type: contentType,
    media_category: mediaCategory
  };
  const initResult = await _mediaApiCall(creds, initParams);
  if (!initResult || !initResult.media_id_string) {
    throw { code: 'MEDIA_INIT_FAILED', message: 'Media INIT failed: ' + JSON.stringify(initResult) };
  }
  const mediaId = initResult.media_id_string;

  // APPEND — send in 5MB chunks
  const CHUNK_SIZE = 5 * 1024 * 1024;
  let segmentIndex = 0;
  for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
    const chunk = mediaBuffer.slice(offset, Math.min(offset + CHUNK_SIZE, totalBytes));
    await _mediaAppend(creds, mediaId, segmentIndex, chunk);
    segmentIndex++;
  }

  // FINALIZE
  const finalizeParams = {
    command: 'FINALIZE',
    media_id: mediaId
  };
  const finalizeResult = await _mediaApiCall(creds, finalizeParams);

  // Check processing status for async media (video/gif)
  if (finalizeResult && finalizeResult.processing_info) {
    await _waitForProcessing(creds, mediaId, finalizeResult.processing_info);
  }

  return mediaId;
}

/**
 * POST to media upload endpoint with OAuth 1.0a signed form params
 */
function _mediaApiCall(creds, params) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = generateNonce();

    const oauthParams = {
      oauth_consumer_key: creds.consumerKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: creds.accessToken,
      oauth_version: '1.0'
    };

    // For form-encoded POST, include body params in signature base
    const allParams = Object.assign({}, oauthParams, params);
    const signature = generateSignature('POST', X_UPLOAD_URL, allParams, creds.consumerSecret, creds.accessTokenSecret);
    oauthParams.oauth_signature = signature;

    const authHeader = buildAuthHeader(oauthParams);
    const bodyStr = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');

    const url = new URL(X_UPLOAD_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed || {});
        } else {
          reject({ code: 'MEDIA_API_ERROR_' + res.statusCode, message: (parsed && parsed.error) || data.substring(0, 300) });
        }
      });
    });
    req.on('error', err => reject({ code: 'NETWORK_ERROR', message: err.message }));
    req.setTimeout(30000, () => { req.destroy(); reject({ code: 'TIMEOUT', message: 'Media upload timed out' }); });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * APPEND segment via multipart/form-data
 */
function _mediaAppend(creds, mediaId, segmentIndex, chunkBuffer) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = generateNonce();
    const boundary = '----XMediaBoundary' + crypto.randomBytes(8).toString('hex');

    const oauthParams = {
      oauth_consumer_key: creds.consumerKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: creds.accessToken,
      oauth_version: '1.0'
    };

    // APPEND: only oauth params in signature base (multipart body excluded)
    const signature = generateSignature('POST', X_UPLOAD_URL, oauthParams, creds.consumerSecret, creds.accessTokenSecret);
    oauthParams.oauth_signature = signature;
    const authHeader = buildAuthHeader(oauthParams);

    // Build multipart body
    const parts = [];
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="command"\r\n\r\nAPPEND');
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="media_id"\r\n\r\n' + mediaId);
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="segment_index"\r\n\r\n' + segmentIndex);
    const preFile = parts.join('\r\n') + '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="media_data"\r\n\r\n';
    const postFile = '\r\n--' + boundary + '--\r\n';

    const preBuffer = Buffer.from(preFile);
    // Send media_data as base64 to avoid binary issues with form-data
    const base64Chunk = chunkBuffer.toString('base64');
    const base64Buffer = Buffer.from(base64Chunk);
    const postBuffer = Buffer.from(postFile);
    const fullBody = Buffer.concat([preBuffer, base64Buffer, postBuffer]);

    const url = new URL(X_UPLOAD_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': fullBody.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject({ code: 'MEDIA_APPEND_ERROR_' + res.statusCode, message: data.substring(0, 300) });
        }
      });
    });
    req.on('error', err => reject({ code: 'NETWORK_ERROR', message: err.message }));
    req.setTimeout(60000, () => { req.destroy(); reject({ code: 'TIMEOUT', message: 'Media append timed out' }); });
    req.write(fullBody);
    req.end();
  });
}

/**
 * Poll STATUS until processing is complete (for video/gif)
 */
async function _waitForProcessing(creds, mediaId, processingInfo) {
  let checkAfter = (processingInfo.check_after_secs || 5) * 1000;
  const maxWait = 120000; // 2 min max
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, checkAfter));

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = generateNonce();
    const queryParams = { command: 'STATUS', media_id: mediaId };
    const oauthParams = {
      oauth_consumer_key: creds.consumerKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: creds.accessToken,
      oauth_version: '1.0'
    };
    const allParams = Object.assign({}, oauthParams, queryParams);
    const signature = generateSignature('GET', X_UPLOAD_URL, allParams, creds.consumerSecret, creds.accessTokenSecret);
    oauthParams.oauth_signature = signature;
    const authHeader = buildAuthHeader(oauthParams);

    const qs = 'command=STATUS&media_id=' + mediaId;
    const result = await new Promise((resolve, reject) => {
      const url = new URL(X_UPLOAD_URL + '?' + qs);
      https.get({ hostname: url.hostname, path: url.pathname + url.search, headers: { 'Authorization': authHeader } }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
        });
      }).on('error', err => reject(err));
    });

    if (!result || !result.processing_info) return; // done
    if (result.processing_info.state === 'succeeded') return;
    if (result.processing_info.state === 'failed') {
      throw { code: 'MEDIA_PROCESSING_FAILED', message: 'Media processing failed: ' + JSON.stringify(result.processing_info.error || {}) };
    }
    checkAfter = (result.processing_info.check_after_secs || 5) * 1000;
  }

  throw { code: 'MEDIA_PROCESSING_TIMEOUT', message: 'Media processing timed out after 2 minutes' };
}

/**
 * Publish a tweet to X
 * @param {Object} action - Full action object
 * @returns {Promise<{receipt: Object}>} - Execution receipt
 */
async function publishToX(action) {
  const creds = getCredentials();
  const credError = validateCredentials(creds);
  if (credError) {
    throw { code: 'MISSING_CREDENTIALS', message: credError };
  }

  let text = (action.payload && action.payload.text) || '';
  if (!text || text.trim().length === 0) {
    throw { code: 'EMPTY_CONTENT', message: 'Tweet text is empty' };
  }

  // M1 idempotency guard: if an existing receipt matches the current content hash, return
  // it instead of re-posting. Truncation is applied AFTER this check so hashes match across
  // retries even for long tweets (the stored receipt's hash reflects the pre-truncation text
  // from the original successful post).
  const _currentHash = contentHash(text);
  const _existingReceipt = shouldSkipDueToExistingReceipt(action, _currentHash);
  if (_existingReceipt) {
    console.log('[X] Skipping repost — content_hash matches existing receipt (post_id:', _existingReceipt.post_id + ')');
    return { receipt: _existingReceipt };
  }

  if (text.length > MAX_CHARS) {
    _log('truncating', { original: text.length, limit: MAX_CHARS });
    text = text.substring(0, MAX_CHARS - 1).replace(/\s+\S*$/, '') + '\u2026';
  }

  // Upload media if provided (max 4) — uses shared media module for host allowlist + download
  const mediaItems = media.extractMediaItems(action.payload && action.payload.media, MAX_MEDIA);
  const uploadedMediaIds = [];

  for (const item of mediaItems) {
    try {
      const downloaded = await media.downloadMedia(item.url, { maxBytes: X_MAX_MEDIA_BYTES });
      const mediaId = await uploadMediaToX(downloaded.buffer, downloaded.contentType, creds);
      uploadedMediaIds.push(mediaId);
    } catch (mediaErr) {
      // If media was explicitly provided and upload fails, abort the tweet
      throw {
        code: 'MEDIA_UPLOAD_FAILED',
        message: 'Media upload failed for ' + item.url + ': ' + (mediaErr.message || mediaErr.code) + '. Tweet not posted.'
      };
    }
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  // OAuth params — DO NOT include JSON body params in signature base
  const oauthParams = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0'
  };

  const signature = generateSignature('POST', X_API_URL, oauthParams, creds.consumerSecret, creds.accessTokenSecret);
  oauthParams.oauth_signature = signature;

  const authHeader = buildAuthHeader(oauthParams);

  // Build tweet body — attach media_ids if any were uploaded
  const tweetBody = { text: text };
  if (uploadedMediaIds.length > 0) {
    tweetBody.media = { media_ids: uploadedMediaIds };
  }
  const body = JSON.stringify(tweetBody);

  // Tweet POST wrapped in retryOn429 — retries 429 + 5xx up to 3x with exponential backoff.
  // Each invocation creates a fresh Promise. Errors throw via reject(...) which retryOn429
  // inspects via err.code (parses _XXX suffix) to decide whether to retry.
  const _doTweet = () => new Promise((resolve, reject) => {
    const url = new URL(X_API_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = null; }

        if (res.statusCode === 201 && parsed && parsed.data && parsed.data.id) {
          const postId = parsed.data.id;
          const handle = creds.handle.replace(/^@/, '');
          resolve({
            receipt: {
              platform: 'x',
              handle: creds.handle,
              post_id: postId,
              post_url: 'https://x.com/' + handle + '/status/' + postId,
              timestamp: new Date().toISOString(),
              content_hash: contentHash(text),
              media_ids: uploadedMediaIds.length > 0 ? uploadedMediaIds : undefined,
              media_count: uploadedMediaIds.length || 0
            }
          });
        } else {
          const errMsg = (parsed && parsed.detail) || (parsed && parsed.title) || data.substring(0, 200);
          const errCode = (parsed && parsed.status) || res.statusCode;
          reject({
            code: 'X_API_ERROR_' + errCode,
            message: errMsg,
            statusCode: res.statusCode,
            headers: res.headers || {},
            raw: data.substring(0, 500)
          });
        }
      });
    });

    req.on('error', (err) => {
      reject({
        code: 'NETWORK_ERROR',
        message: err.message
      });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject({ code: 'TIMEOUT', message: 'X API request timed out after 15s' });
    });

    req.write(body);
    req.end();
  });

  return retryOn429(_doTweet, { platform: 'x', actionId: action && action.id });
}

module.exports = {
  publishToX,
  uploadMediaToX,
  getCredentials,
  validateCredentials,
  contentHash
};

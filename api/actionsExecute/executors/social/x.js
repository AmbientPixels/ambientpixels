// x.js — X (Twitter) platform adapter for social_post.publish
// OAuth 1.0a signing using HMAC-SHA1
// Env vars: X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET, X_HANDLE

const crypto = require('crypto');
const https = require('https');
const media = require('./media');
const { truncatePreservingUrl } = require('./textLimit');
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

function _log(event, data) {
  var entry = Object.assign({
    _source: 'x-adapter',
    event: event,
    ts: new Date().toISOString()
  }, data || {});
  console.log('[X]', JSON.stringify(entry));
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
 * Resolve a reply parent into an X tweet id, or null if it is not one.
 *
 * Accepts the X-native `in_reply_to_tweet_id` and also `parent`, which is the
 * field bluesky.js already reads off action.payload.reply — one caller shape
 * then works for both platforms.
 *
 * The numeric check is load-bearing. X tweet ids are numeric strings; handed
 * an at:// URI copied from a Bluesky payload, the API ignores the unusable
 * reference and posts a TOP-LEVEL tweet. Something written as a reply to
 * someone else would ship as a context-free post on the brand account.
 */
function _replyParentId(reply) {
  if (!reply || typeof reply !== 'object') return null;
  const raw = reply.in_reply_to_tweet_id || reply.parent;
  if (raw == null) return null;
  const id = (typeof raw === 'object') ? (raw.id || raw.in_reply_to_tweet_id || null) : raw;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const s = String(id).trim();
  // Leading-zero and zero ids are not real snowflakes. A bare 0 slips past a
  // plain \d+ check and would post top-level while looking like a threaded reply.
  return /^[1-9]\d*$/.test(s) ? s : null;
}

/**
 * Build the POST /2/tweets request body. Pure: no I/O, no OAuth, no network.
 * Extracted so threading can be asserted without stubbing OAuth or the socket.
 */
function buildTweetBody(text, mediaIds, reply) {
  const body = { text: text };
  if (Array.isArray(mediaIds) && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds }; // X rejects an empty media_ids array
  }
  const parentId = _replyParentId(reply);
  if (parentId) body.reply = { in_reply_to_tweet_id: parentId };
  return body;
}

/**
 * Shape 4 (2026-08-08): X demotes posts carrying outbound links, so a post
 * whose text ENDS with a URL is delivered as a clean tweet + the URL in a
 * self-reply. Split only when the URL is the final token — a mid-text link or
 * trailing hashtags mean the copy was not written for splitting, and posting
 * a mangled body is worse than eating the demotion.
 * Pure. Returns { body, url } or null.
 */
function splitLinkForReply(text) {
  const s = String(text || '').trim();
  const m = s.match(/^([\s\S]*?)\s+(https?:\/\/\S+)$/);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null; // URL-only post — nothing left to say without it
  return { body: body, url: m[2] };
}

/**
 * Pure delivery decision, receipt-driven because the failure modes are public:
 *  skip        — receipt is complete; the incident rule (a receipt exists →
 *                never post again) short-circuits everything.
 *  reply-only  — main tweet is LIVE but its link reply never landed
 *                (receipt.link_reply_pending); deliver ONLY the reply.
 *  post        — fresh tweet; body/replyText carry the split when policy
 *                wants it and the text allows it.
 */
function decideXDelivery(opts) {
  opts = opts || {};
  const split = splitLinkForReply(opts.text);
  const isThreadedReply = !!_replyParentId(opts.payloadReply);

  if (opts.existingReceipt) {
    if (opts.existingReceipt.link_reply_pending === true && split && !isThreadedReply) {
      return { mode: 'reply-only', parentId: String(opts.existingReceipt.post_id), replyText: split.url };
    }
    // Pending but underivable → skip. Never invent a link to post publicly.
    return { mode: 'skip', receipt: opts.existingReceipt };
  }

  if (opts.wantSplit && split && !isThreadedReply) {
    return { mode: 'post', body: split.body, replyText: split.url };
  }
  return { mode: 'post', body: String(opts.text || ''), replyText: null };
}

// linkPolicy comes from the shared voice spec so the executor and the copy
// pipeline cannot disagree about where a link belongs. Guarded require: if the
// lib is ever absent, X falls back to posting the full text (today's shape).
function _linkPolicyWantsReply() {
  try {
    const { PLATFORM_RULES } = require('../../../_lib/socialCopy/voice');
    return !!(PLATFORM_RULES && PLATFORM_RULES.social_x && PLATFORM_RULES.social_x.linkPolicy === 'reply');
  } catch (e) { return false; }
}

/**
 * POST one tweet body with a FRESH OAuth signature (nonce/timestamp are
 * per-request, so this must be re-signed per call — the link reply is a second
 * call). Resolves { postId }. Wrapped in retryOn429.
 */
function _signedTweetPost(creds, tweetBody, actionId) {
  const doPost = () => new Promise((resolve, reject) => {
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
    oauthParams.oauth_signature = generateSignature('POST', X_API_URL, oauthParams, creds.consumerSecret, creds.accessTokenSecret);
    const authHeader = buildAuthHeader(oauthParams);
    const body = JSON.stringify(tweetBody);

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
          resolve({ postId: parsed.data.id });
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
    req.on('error', (err) => { reject({ code: 'NETWORK_ERROR', message: err.message }); });
    req.setTimeout(15000, () => { req.destroy(); reject({ code: 'TIMEOUT', message: 'X API request timed out after 15s' }); });
    req.write(body);
    req.end();
  });
  return retryOn429(doPost, { platform: 'x', actionId: actionId });
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

  // M1 idempotency guard: hash the ORIGINAL payload text (stable across
  // retries and across the body/link split) and let the delivery decision be
  // receipt-driven: a complete receipt skips, a pending link reply delivers
  // only the reply, and only a fresh action posts a tweet.
  const _currentHash = contentHash(text);
  const _existingReceipt = shouldSkipDueToExistingReceipt(action, _currentHash);
  const _delivery = decideXDelivery({
    text: text,
    wantSplit: _linkPolicyWantsReply(),
    payloadReply: action.payload && action.payload.reply,
    existingReceipt: _existingReceipt
  });

  if (_delivery.mode === 'skip') {
    console.log('[X] Skipping repost — content_hash matches existing receipt (post_id:', _delivery.receipt.post_id + ')');
    return { receipt: _delivery.receipt };
  }

  if (_delivery.mode === 'reply-only') {
    // The main tweet is LIVE; only its link reply is missing. A failure here
    // may throw — marking the action failed is safe because the receipt
    // survives and the next attempt converges right back to reply-only.
    const _ro = await _signedTweetPost(creds, buildTweetBody(_delivery.replyText, [], { in_reply_to_tweet_id: _delivery.parentId }), action && action.id);
    _log('link-reply-delivered', { parent: _delivery.parentId, reply_id: _ro.postId, recovered: true });
    return { receipt: Object.assign({}, _existingReceipt, { link_reply_id: _ro.postId, link_reply_pending: false, link_reply_error: null }) };
  }

  let bodyText = _delivery.body;
  if (bodyText.length > MAX_CHARS) {
    _log('truncating', { original: bodyText.length, limit: MAX_CHARS });
    // URL-preserving: trim the prose, never drop a trailing CTA link.
    bodyText = truncatePreservingUrl(bodyText, MAX_CHARS);
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

  // Build tweet body — attaches media_ids, and threads the tweet when
  // action.payload.reply names a parent tweet id.
  const _replyTo = _replyParentId(action.payload && action.payload.reply);
  const _main = await _signedTweetPost(creds, buildTweetBody(bodyText, uploadedMediaIds, action.payload && action.payload.reply), action && action.id);
  const handle = creds.handle.replace(/^@/, '');
  const receipt = {
    platform: 'x',
    handle: creds.handle,
    post_id: _main.postId,
    post_url: 'https://x.com/' + handle + '/status/' + _main.postId,
    timestamp: new Date().toISOString(),
    // Hash of the ORIGINAL payload text, not the split body — idempotency
    // compares against the payload, which does not change across retries.
    content_hash: _currentHash,
    media_ids: uploadedMediaIds.length > 0 ? uploadedMediaIds : undefined,
    media_count: uploadedMediaIds.length || 0,
    // Present only on replies, so "did this thread or silently post
    // top-level?" is answerable from the receipt alone.
    in_reply_to: _replyTo || undefined
  };

  if (_delivery.replyText) {
    try {
      const _lr = await _signedTweetPost(creds, buildTweetBody(_delivery.replyText, [], { in_reply_to_tweet_id: _main.postId }), action && action.id);
      receipt.link_reply_id = _lr.postId;
      _log('link-reply-delivered', { parent: _main.postId, reply_id: _lr.postId });
    } catch (linkErr) {
      // The main tweet is LIVE. Never throw here — that would mark a live
      // post failed and invite a duplicate. Record the pending reply; the
      // execute gate lets a re-run deliver ONLY the missing reply.
      receipt.link_reply_pending = true;
      receipt.link_reply_error = (linkErr && (linkErr.message || linkErr.code)) || String(linkErr);
      _log('link-reply-failed', { parent: _main.postId, error: receipt.link_reply_error });
    }
  }

  return { receipt: receipt };
}

module.exports = {
  publishToX,
  uploadMediaToX,
  getCredentials,
  validateCredentials,
  contentHash,
  buildTweetBody, // exported for x.reply.test.js — threading needs direct assertion
  splitLinkForReply,  // exported for x.linkreply.test.js
  decideXDelivery     // exported for x.linkreply.test.js
};

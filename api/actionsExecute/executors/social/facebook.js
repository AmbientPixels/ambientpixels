// facebook.js — Facebook Page adapter for social_post.publish / social_post.schedule
//
// Graph API v26.0, posting as the AmbientPixels Page (POST /{page-id}/feed).
// Replaces the manual-outbox stub that shipped while the app was unbuilt.
//
// Credentials: socialCredentials.facebook blob first, env vars as fallback —
// same precedence as linkedin.js. Env: FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID,
// FACEBOOK_APP_ID, FACEBOOK_APP_SECRET.
//
// TOKEN MODEL — the part that bites you later:
// A Page token derived from a LONG-LIVED user token never expires, so there is no
// refresh flow here (unlike LinkedIn). But `data_access_expires_at` is a SEPARATE
// 90-day clock, and when it lapses the failure is asymmetric: publishing keeps
// working while reads (insights, followers, comments) start returning empty. That
// looks exactly like "nobody engaged" instead of "we lost access". checkTokenHealth()
// exists so the caller can catch it before it becomes a phantom zero.

const https = require('https');
const crypto = require('crypto');
const storage = require('../../../_utils/companyStorage');
const { truncatePreservingUrl } = require('./textLimit');
const { retryOn429, shouldSkipDueToExistingReceipt } = require('../../../_utils/platformRetry');

const GRAPH_VERSION = 'v26.0';
const GRAPH_HOST = 'graph.facebook.com';
// Facebook's real ceiling. Nothing we write approaches it; this is a guard, not a budget.
const MAX_CHARS = 63206;
// Warn this far ahead of the data-access cliff so there's time to re-authorize.
const DATA_ACCESS_WARN_DAYS = 21;

var _cachedCreds = null;
var _cachedCredsAt = 0;
var CACHE_TTL = 5 * 60 * 1000;

function _log(event, data) {
  console.log('[Facebook]', JSON.stringify(Object.assign({
    _source: 'facebook-adapter',
    event: event,
    ts: new Date().toISOString()
  }, data || {})));
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Load credentials: blob (socialCredentials.facebook) first, env vars as fallback.
 */
async function getCredentials() {
  if (_cachedCreds && (Date.now() - _cachedCredsAt) < CACHE_TTL) return _cachedCreds;

  var creds = { pageAccessToken: '', pageId: '', appId: '', appSecret: '' };

  try {
    var blob = await storage.getState('socialCredentials');
    if (blob && blob.facebook && blob.facebook.pageAccessToken) {
      creds.pageAccessToken = blob.facebook.pageAccessToken;
      creds.pageId = blob.facebook.pageId || process.env.FACEBOOK_PAGE_ID || '';
      creds.appId = blob.facebook.appId || process.env.FACEBOOK_APP_ID || '';
      creds.appSecret = blob.facebook.appSecret || process.env.FACEBOOK_APP_SECRET || '';
      _cachedCreds = creds;
      _cachedCredsAt = Date.now();
      return creds;
    }
  } catch (e) {
    console.warn('[Facebook] blob read failed, falling back to env vars:', e.message);
  }

  creds.pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '';
  creds.pageId = process.env.FACEBOOK_PAGE_ID || '';
  creds.appId = process.env.FACEBOOK_APP_ID || '';
  creds.appSecret = process.env.FACEBOOK_APP_SECRET || '';
  _cachedCreds = creds;
  _cachedCredsAt = Date.now();
  return creds;
}

function validateCredentials(creds) {
  if (!creds.pageAccessToken) return 'FACEBOOK_PAGE_ACCESS_TOKEN not set';
  if (!creds.pageId) return 'FACEBOOK_PAGE_ID not set';
  return null;
}

// Test seam — the module caches creds for 5 minutes, which would otherwise make
// tests order-dependent.
function _resetCredsCache() { _cachedCreds = null; _cachedCredsAt = 0; }

/**
 * Facebook returns errors as { error: { message, type, code, error_subcode, fbtrace_id } }.
 * Flatten that into something a governance log entry can actually be read from.
 */
function _describeError(parsed, raw, statusCode) {
  var e = parsed && parsed.error;
  if (!e) return 'HTTP ' + statusCode + ': ' + String(raw || '').substring(0, 300);
  var bits = [e.message || e.type || 'unknown error'];
  if (e.code != null) bits.push('code=' + e.code);
  if (e.error_subcode != null) bits.push('subcode=' + e.error_subcode);
  if (e.fbtrace_id) bits.push('fbtrace=' + e.fbtrace_id);
  return bits.join(' | ');
}

function _request(method, path, params) {
  return new Promise(function (resolve, reject) {
    var body = params ? new URLSearchParams(params).toString() : '';
    var isPost = method === 'POST';
    var options = {
      hostname: GRAPH_HOST,
      path: '/' + GRAPH_VERSION + path + (isPost ? '' : (body ? '?' + body : '')),
      method: method,
      headers: isPost ? {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    };

    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { /* non-JSON error page */ }
        if (res.statusCode === 200) return resolve(parsed || {});
        // statusCode is attached so retryOn429 can see 429/5xx and back off.
        reject({
          code: 'FACEBOOK_API_ERROR_' + res.statusCode,
          statusCode: res.statusCode,
          headers: res.headers,
          message: _describeError(parsed, data, res.statusCode)
        });
      });
    });
    req.on('error', function (err) { reject({ code: 'NETWORK_ERROR', message: err.message }); });
    req.setTimeout(20000, function () { req.destroy(); reject({ code: 'TIMEOUT', message: 'Facebook request timed out' }); });
    if (isPost) req.write(body);
    req.end();
  });
}

/**
 * Inspect the Page token. Reports BOTH clocks, because they differ:
 * `expires_at: 0` means the token itself is permanent, while
 * `data_access_expires_at` is the 90-day read-access cliff.
 * Requires appId/appSecret; without them we can only say "unknown".
 */
async function checkTokenHealth() {
  var creds = await getCredentials();
  if (!creds.pageAccessToken) return { ok: false, error: 'No page access token configured' };
  if (!creds.appId || !creds.appSecret) {
    return { ok: true, unknown: true, error: 'appId/appSecret not configured — cannot inspect token expiry' };
  }

  try {
    var res = await _request('GET', '/debug_token', {
      input_token: creds.pageAccessToken,
      access_token: creds.appId + '|' + creds.appSecret
    });
    var d = (res && res.data) || {};
    var out = {
      ok: !!d.is_valid,
      type: d.type || null,
      tokenExpiresAt: d.expires_at === 0 ? null : (d.expires_at || null),
      dataAccessExpiresAt: d.data_access_expires_at || null,
      scopes: d.scopes || []
    };
    if (out.dataAccessExpiresAt) {
      var daysLeft = Math.floor((out.dataAccessExpiresAt * 1000 - Date.now()) / 86400000);
      out.dataAccessDaysLeft = daysLeft;
      // Asymmetric failure: posts keep succeeding while reads silently empty out.
      // Surfacing it as a warning is the whole point of this function.
      out.dataAccessWarning = daysLeft <= DATA_ACCESS_WARN_DAYS
        ? 'Facebook data access expires in ' + daysLeft + ' days (' +
          new Date(out.dataAccessExpiresAt * 1000).toISOString().slice(0, 10) +
          '). Publishing will keep working but insights and follower reads will return EMPTY, ' +
          'which looks identical to zero engagement. Re-authorize at ' +
          'developers.facebook.com/tools/explorer before then.'
        : null;
    }
    return out;
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// FALLBACK ONLY — ask Facebook for the real permalink instead where possible.
//
// Pages created under the New Pages Experience publish under an actor id that is NOT
// the Page id the API accepts. Verified on the first live post: we post to
// 1250918731441250 and Facebook's own permalink_url came back rooted at
// 122105341017424861. A URL built from the Page id is therefore a guess, and post_url
// feeds receipts, attribution and the dashboard, so a wrong one breaks link tracking
// everywhere it lands.
function _permalink(pageId, returnedId) {
  if (!returnedId) return '';
  var parts = String(returnedId).split('_');
  if (parts.length === 2 && parts[1]) return 'https://www.facebook.com/' + pageId + '/posts/' + parts[1];
  return 'https://www.facebook.com/' + returnedId;
}

/**
 * Ask Facebook for the canonical permalink. Best-effort by design: the post is ALREADY
 * published by the time this runs, so a failure here must never turn a successful
 * publish into a thrown error. Returns '' and lets the caller fall back.
 */
async function _fetchPermalink(postId, token) {
  try {
    var res = await _request('GET', '/' + postId, { fields: 'permalink_url', access_token: token });
    var url = (res && res.permalink_url) || '';
    // Posts come back absolute; VIDEOS come back relative ("/AmbientPixels/videos/123/").
    // Storing the relative form gives every consumer a broken link, and it is the kind of
    // thing that looks fine in a receipt and fails only when somebody clicks it.
    if (url && url.charAt(0) === '/') url = 'https://www.facebook.com' + url;
    return url;
  } catch (e) {
    _log('permalink-read-failed', { post_id: postId, error: e.message || String(e) });
    return '';
  }
}

/**
 * Publish a post to the AmbientPixels Facebook Page.
 *
 * Text-only posts go to /feed. When payload.media carries an http(s) image we post to
 * /photos instead, which produces a native image post rather than a link card.
 * A bare URL left in the message body is enough for Facebook to build its own link
 * preview, so we deliberately do NOT also pass `link` — that renders the URL twice.
 *
 * @param {Object} action — full action object
 * @returns {Promise<{receipt: Object}>}
 */
async function publishToFacebook(action) {
  var creds = await getCredentials();
  var credError = validateCredentials(creds);
  if (credError) {
    _log('credential-error', { error: credError });
    throw { code: 'MISSING_CREDENTIALS', message: credError };
  }

  var payload = action.payload || {};
  var text = (payload.text || '').trim();
  if (!text) throw { code: 'EMPTY_CONTENT', message: 'Post text is empty' };

  // Idempotency: hash BEFORE truncation so it matches what a prior success stored.
  // Guards the window where the POST succeeded but the receipt never persisted.
  var hash = contentHash(text);
  var existing = shouldSkipDueToExistingReceipt(action, hash);
  if (existing) {
    _log('skip-repost-content-hash-match', { post_id: existing.post_id });
    return { receipt: existing };
  }

  if (text.length > MAX_CHARS) {
    _log('truncating', { original: text.length, limit: MAX_CHARS });
    text = truncatePreservingUrl(text, MAX_CHARS);
  }

  var media = Array.isArray(payload.media) ? payload.media : [];
  var firstMedia = media.length
    ? (typeof media[0] === 'string' ? media[0] : (media[0].url || ''))
    : '';

  // Three destinations, picked by what the payload carries. video_url wins: a post with
  // both a clip and a still image is a video post, not a photo post with a spare file.
  //
  // /videos takes file_url and fetches the media itself, so nothing is uploaded from here.
  // That only works because videoEngine writes to a PUBLIC blob container — if that
  // container ever goes private, this silently starts failing with a Facebook-side fetch
  // error rather than anything that points back at the container.
  var videoUrl = String(payload.video_url || '').trim();
  var useVideo = /^https?:\/\//.test(videoUrl);
  var usePhoto = !useVideo && /^https?:\/\//.test(firstMedia);
  var mode = useVideo ? 'video' : (usePhoto ? 'photo' : 'feed');

  var endpoint, params;
  if (useVideo) {
    endpoint = '/' + creds.pageId + '/videos';
    params = { file_url: videoUrl, description: text, access_token: creds.pageAccessToken };
    if (payload.video_title) params.title = String(payload.video_title).slice(0, 255);
  } else if (usePhoto) {
    endpoint = '/' + creds.pageId + '/photos';
    params = { url: firstMedia, caption: text, access_token: creds.pageAccessToken };
  } else {
    endpoint = '/' + creds.pageId + '/feed';
    params = { message: text, access_token: creds.pageAccessToken };
  }

  _log('publish-start', { pageId: creds.pageId, textLength: text.length, mode: mode });

  var result = await retryOn429(
    function () { return _request('POST', endpoint, params); },
    { platform: 'facebook', actionId: action.id || null }
  );

  // /photos returns { id, post_id }; /feed and /videos return { id }.
  var postId = result.post_id || result.id || '';
  // Authoritative permalink, with the constructed one only as a fallback.
  var canonical = await _fetchPermalink(postId, creds.pageAccessToken);
  var receipt = {
    platform: 'facebook',
    page_id: creds.pageId,
    handle: 'AmbientPixels',
    post_id: postId,
    photo_id: usePhoto ? (result.id || '') : '',
    video_id: useVideo ? (result.id || '') : '',
    // A video id is NOT the {page}_{post} composite _permalink() expects, so the constructed
    // fallback would be wrong rather than merely ugly. Better an empty URL that reads as
    // "unknown" than a confident link to nothing.
    post_url: canonical || (useVideo ? '' : _permalink(creds.pageId, postId)),
    post_url_source: canonical ? 'graph' : (useVideo ? 'unavailable' : 'constructed'),
    // Facebook transcodes asynchronously: this returns 200 while the post is still
    // processing, so a successful receipt does NOT mean the clip is watchable yet.
    processing: useVideo ? true : undefined,
    timestamp: new Date().toISOString(),
    content_hash: hash,
    api: mode === 'video' ? 'videos' : (usePhoto ? 'photos' : 'feed'),
    graph_version: GRAPH_VERSION
  };

  _log('publish-success', { post_id: receipt.post_id, post_url: receipt.post_url });
  return { receipt: receipt };
}

/**
 * Read engagement for one post.
 *
 * Reads the summary counts rather than /insights on purpose: post_impressions and
 * friends are LIFETIME CUMULATIVE totals, and a caller that samples them repeatedly
 * and adds the samples up inflates the number by however often it polled. Callers
 * must DIFFERENCE these against the previous snapshot, never sum them.
 * Returns null (not zero) when the read fails, so "we couldn't look" stays
 * distinguishable from "nobody engaged".
 */
async function fetchPostEngagement(postId) {
  var creds = await getCredentials();
  if (validateCredentials(creds) || !postId) return null;
  try {
    var res = await _request('GET', '/' + postId, {
      fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0),shares,created_time',
      access_token: creds.pageAccessToken
    });
    return {
      post_id: postId,
      likes: (res.likes && res.likes.summary && res.likes.summary.total_count) || 0,
      comments: (res.comments && res.comments.summary && res.comments.summary.total_count) || 0,
      shares: (res.shares && res.shares.count) || 0,
      created_time: res.created_time || null,
      _cumulative: true,   // caller MUST difference, never sum
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    _log('engagement-read-failed', { post_id: postId, error: err.message || String(err) });
    return null;
  }
}

/**
 * Read comments on one post, newest first.
 *
 * Returns [] for "the post has no comments" and NULL for "we could not look". Those are
 * different sentences and the inbox renders them differently: an empty array is a post
 * nobody replied to, null is a hole in our knowledge. Collapsing them is how a broken token
 * starts reading as silence.
 *
 * Requires pages_read_engagement. Comments are NOT cumulative counters, so unlike the
 * metrics these can be consumed directly.
 */
async function fetchPostComments(postId, opts) {
  var creds = await getCredentials();
  if (validateCredentials(creds) || !postId) return null;
  var limit = (opts && opts.limit) || 50;
  try {
    var res = await _request('GET', '/' + postId + '/comments', {
      fields: 'id,message,created_time,permalink_url,from{id,name},like_count,parent',
      order: 'reverse_chronological',
      limit: String(limit),
      access_token: creds.pageAccessToken
    });
    var rows = (res && res.data) || [];
    return rows.map(function (c) {
      var from = c.from || {};
      return {
        id: c.id,
        post_id: postId,
        // `from` is omitted by Graph for commenters who have not granted the app profile
        // access, which is most of them. An absent name is anonymised, not missing data.
        author: from.name || 'Facebook user',
        author_id: from.id || null,
        text: c.message || '',
        created_time: c.created_time || null,
        permalink: c.permalink_url || '',
        likes: typeof c.like_count === 'number' ? c.like_count : 0,
        is_reply: !!(c.parent && c.parent.id)
      };
    });
  } catch (err) {
    _log('comments-read-failed', { post_id: postId, error: err.message || String(err) });
    return null;
  }
}

/**
 * Reply to a comment as the Page. Requires pages_manage_engagement.
 * Deliberately NOT wired to any automation: the reply lane has no fabrication guard, and a
 * first-person anecdote invented by a model has already passed the quality gate at 95% once.
 * A human decides every one of these.
 */
async function replyToComment(commentId, text) {
  var creds = await getCredentials();
  var credError = validateCredentials(creds);
  if (credError) throw { code: 'MISSING_CREDENTIALS', message: credError };
  if (!commentId) throw { code: 'MISSING_COMMENT_ID', message: 'commentId is required' };
  var body = String(text || '').trim();
  if (!body) throw { code: 'EMPTY_CONTENT', message: 'Reply text is empty' };

  var result = await retryOn429(
    function () { return _request('POST', '/' + commentId + '/comments', { message: body, access_token: creds.pageAccessToken }); },
    { platform: 'facebook', actionId: null }
  );
  _log('comment-reply-success', { comment_id: commentId, reply_id: result.id });
  return { reply_id: result.id || '', comment_id: commentId, timestamp: new Date().toISOString() };
}

/**
 * Page-level follower count. Returns null on failure — never 0 — so a lost token
 * cannot be mistaken for an audience that vanished.
 */
async function fetchPageStats() {
  var creds = await getCredentials();
  if (validateCredentials(creds)) return null;
  try {
    var res = await _request('GET', '/' + creds.pageId, {
      fields: 'name,followers_count,fan_count,link',
      access_token: creds.pageAccessToken
    });
    return {
      platform: 'facebook',
      handle: res.name || 'AmbientPixels',
      pageId: creds.pageId,
      followers: typeof res.followers_count === 'number' ? res.followers_count : null,
      likes: typeof res.fan_count === 'number' ? res.fan_count : null,
      profileUrl: res.link || ('https://www.facebook.com/' + creds.pageId),
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    _log('page-stats-failed', { error: err.message || String(err) });
    return null;
  }
}

module.exports = {
  publishToFacebook,
  getCredentials,
  validateCredentials,
  checkTokenHealth,
  fetchPostEngagement,
  fetchPostComments,
  replyToComment,
  fetchPageStats,
  contentHash,
  _permalink,
  _fetchPermalink,
  _describeError,
  _resetCredsCache,
  GRAPH_VERSION,
  MAX_CHARS
};

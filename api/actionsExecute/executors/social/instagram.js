// instagram.js — Instagram Business adapter for social_post.publish / social_post.schedule
//
// Graph API, posting as @ambientpixels2022 (IG user 17841442391762826), which is the
// Business account linked to the AmbientPixels Page. The Page token is the SAME token
// facebook.js uses — Instagram Graph is reached through the Page, not through a separate
// credential — so getCredentials() here delegates to the Facebook adapter and adds only
// the IG user id. One token, one expiry, one place to rotate.
//
// THREE THINGS THAT MAKE THIS UNLIKE EVERY OTHER ADAPTER:
//
// 1. Instagram cannot post text-only. Every post needs an image, and the pipeline
//    approves WORDS. When the payload carries no usable media we render the approved
//    copy onto a brand card (cardEngine, $0, no model) rather than inventing a picture.
//
// 2. Publishing is TWO calls, not one: create a container, then publish it. That splits
//    the failure surface in a way a single POST does not — see the unknown-outcome guard
//    on the publish step, which is the whole reason this file is careful.
//
// 3. Captions do not render clickable links. A URL in an Instagram caption is dead text.
//    Link-shaped posts exist specifically to carry a URL, so this adapter REFUSES them
//    rather than publishing copy whose entire purpose has been silently removed.
//    CEO decision, 2026-08-09.

const https = require('https');
const crypto = require('crypto');
const facebook = require('./facebook');
const { truncatePreservingUrl } = require('./textLimit');
const { retryOn429, shouldSkipDueToExistingReceipt } = require('../../../_utils/platformRetry');

const GRAPH_VERSION = 'v26.0';
const GRAPH_HOST = 'graph.facebook.com';
// Instagram's real caption ceiling.
const MAX_CHARS = 2200;
// Instagram rejects a post with more than 30 hashtags. Failing here with our own message
// beats failing at Graph with theirs.
const MAX_HASHTAGS = 30;

function _log(event, data) {
  console.log('[Instagram]', JSON.stringify(Object.assign({
    _source: 'instagram-adapter',
    event: event,
    ts: new Date().toISOString()
  }, data || {})));
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Credentials = the Facebook Page token + the IG user id.
 *
 * Delegating to facebook.getCredentials() is deliberate: Instagram Graph authenticates
 * with the Page token, so duplicating the blob-first/env-fallback loading here would
 * create a second thing to rotate and a second thing to forget.
 */
async function getCredentials() {
  const fbCreds = await facebook.getCredentials();
  return {
    pageAccessToken: (fbCreds && fbCreds.pageAccessToken) || '',
    igUserId: process.env.INSTAGRAM_USER_ID || '',
    igUsername: process.env.INSTAGRAM_USERNAME || 'ambientpixels2022'
  };
}

function validateCredentials(creds) {
  if (!creds.pageAccessToken) return 'FACEBOOK_PAGE_ACCESS_TOKEN not set (Instagram authenticates with the Page token)';
  if (!creds.igUserId) return 'INSTAGRAM_USER_ID not set';
  return null;
}

function _describeError(parsed, raw, statusCode) {
  const e = parsed && parsed.error;
  if (!e) return 'HTTP ' + statusCode + ': ' + String(raw || '').substring(0, 300);
  const bits = [e.message || e.type || 'unknown error'];
  if (e.code != null) bits.push('code=' + e.code);
  if (e.error_subcode != null) bits.push('subcode=' + e.error_subcode);
  if (e.fbtrace_id) bits.push('fbtrace=' + e.fbtrace_id);
  return bits.join(' | ');
}

function _request(method, path, params) {
  return new Promise(function (resolve, reject) {
    const body = params ? new URLSearchParams(params).toString() : '';
    const isPost = method === 'POST';
    const options = {
      hostname: GRAPH_HOST,
      path: '/' + GRAPH_VERSION + path + (isPost ? '' : (body ? '?' + body : '')),
      method: method,
      headers: isPost ? {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    };

    const req = https.request(options, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { /* non-JSON error page */ }
        if (res.statusCode === 200) return resolve(parsed || {});
        reject({
          code: 'INSTAGRAM_API_ERROR_' + res.statusCode,
          statusCode: res.statusCode,
          headers: res.headers,
          message: _describeError(parsed, data, res.statusCode)
        });
      });
    });
    req.on('error', function (err) { reject({ code: 'NETWORK_ERROR', message: err.message }); });
    req.setTimeout(20000, function () { req.destroy(); reject({ code: 'TIMEOUT', message: 'Instagram request timed out' }); });
    if (isPost) req.write(body);
    req.end();
  });
}

/**
 * Pure. Any http(s) URL in the caption.
 *
 * This is the link-shape guard's real detector. post_shape lives on the TASK
 * (`task.post_shape`, set in agent-runner.js) and never reaches the action the executor
 * receives, so checking the shape field alone would be a guard that silently never fires.
 * Detecting the URL targets the actual harm instead: a link rendered as dead text.
 */
function findUrls(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"')]+/gi);
  return m || [];
}

/** Pure. Hashtag count, for the 30 ceiling. */
function countHashtags(text) {
  const m = String(text || '').match(/(^|\s)#[^\s#]+/g);
  return m ? m.length : 0;
}

/**
 * Pure. Decide whether this action may be published to Instagram at all.
 * Returns null to proceed, or {code, message} to refuse.
 *
 * Refusing is the point. The alternative considered and rejected was stripping the URL
 * and posting the rest: that publishes copy written to sell a click, minus the click,
 * and the post reads as a non-sequitur while the funnel correctly attributes zero to it
 * for entirely the wrong reason.
 */
function checkPublishable(payload) {
  const text = String((payload && payload.text) || '').trim();
  if (!text) return { code: 'EMPTY_CONTENT', message: 'Post text is empty' };

  // Explicit shape, when a caller does pass it. Cheap, and correct if post_shape is ever
  // plumbed onto the action.
  const shape = payload && payload.post_shape;
  if (shape && shape.kind === 'link') {
    return {
      code: 'LINK_SHAPE_UNSUPPORTED',
      message: 'This is a link-shaped post and Instagram captions do not render clickable links. Route link shapes to another platform.'
    };
  }

  const urls = findUrls(text);
  if (urls.length) {
    return {
      code: 'LINK_SHAPE_UNSUPPORTED',
      message: 'Caption contains ' + urls.length + ' URL(s) which Instagram renders as dead text (' + urls[0] + '). '
        + 'Instagram takes engagement-shaped posts only — a link here is unclickable and the post loses its purpose.'
    };
  }

  if (countHashtags(text) > MAX_HASHTAGS) {
    return {
      code: 'TOO_MANY_HASHTAGS',
      message: 'Instagram allows at most ' + MAX_HASHTAGS + ' hashtags; this caption has ' + countHashtags(text) + '.'
    };
  }

  return null;
}

// A container is not publishable the instant it is created. Instagram fetches image_url
// on ITS side, asynchronously, and the container sits IN_PROGRESS until that finishes.
// Publishing before then fails with "Media ID is not available" (code 9007, subcode
// 2207027) — which is what happened to the first real post on 2026-08-09.
const CONTAINER_POLL_INTERVAL_MS = 3000;
const CONTAINER_READY_TIMEOUT_MS = 60000;

function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * Pure. What a container's status_code means for us.
 * 'ready'   — publishable now
 * 'pending' — still processing, keep waiting
 * 'failed'  — terminal, never publishable (Instagram could not use the image)
 */
function classifyContainerStatus(statusCode) {
  var s = String(statusCode || '').toUpperCase();
  if (s === 'FINISHED') return 'ready';
  if (s === 'ERROR' || s === 'EXPIRED') return 'failed';
  return 'pending'; // IN_PROGRESS, PUBLISHED, or an empty/unknown read
}

/**
 * Block until the container is publishable.
 *
 * Everything this throws is SAFE TO RETRY and deliberately does NOT set
 * requires_manual_review: no publish has been attempted, so nothing can be live. That is
 * the opposite of the media_publish step below, where an unknown outcome must never retry.
 * A container nobody publishes expires on its own within 24h, costs nothing, and is
 * invisible — so giving up here is free.
 */
async function _waitForContainerReady(creationId, token) {
  const deadline = Date.now() + CONTAINER_READY_TIMEOUT_MS;
  let lastStatus = '(never read)';
  let polls = 0;

  while (Date.now() < deadline) {
    polls++;
    let res = null;
    try {
      res = await _request('GET', '/' + creationId, { fields: 'status_code,status', access_token: token });
    } catch (readErr) {
      // Reading the status is not the same as publishing. A failed read tells us nothing
      // about the container, so treat it as "not ready yet" and keep waiting rather than
      // failing a post that was about to become publishable.
      _log('container-status-read-failed', { creation_id: creationId, poll: polls, error: readErr.message || String(readErr) });
      await _sleep(CONTAINER_POLL_INTERVAL_MS);
      continue;
    }

    lastStatus = (res && res.status_code) || '(absent)';
    const verdict = classifyContainerStatus(lastStatus);

    if (verdict === 'ready') {
      _log('container-ready', { creation_id: creationId, polls: polls, waited_ms: polls * CONTAINER_POLL_INTERVAL_MS });
      return;
    }
    if (verdict === 'failed') {
      throw {
        code: 'IG_CONTAINER_FAILED',
        message: 'Instagram could not prepare the media container (status ' + lastStatus + ')'
          + ((res && res.status) ? ': ' + res.status : '')
          + '. Nothing was published. The usual cause is an image_url Instagram could not fetch.'
      };
    }
    await _sleep(CONTAINER_POLL_INTERVAL_MS);
  }

  throw {
    code: 'IG_CONTAINER_NOT_READY',
    message: 'Container ' + creationId + ' was still "' + lastStatus + '" after '
      + Math.round(CONTAINER_READY_TIMEOUT_MS / 1000) + 's. Nothing was published; this is safe to retry.'
  };
}

/**
 * Best-effort canonical permalink. The post is ALREADY live when this runs, so a failure
 * here must never turn a successful publish into a thrown error — same rule as
 * facebook.js:_fetchPermalink.
 */
async function _fetchPermalink(mediaId, token) {
  try {
    const res = await _request('GET', '/' + mediaId, { fields: 'permalink', access_token: token });
    return (res && res.permalink) || '';
  } catch (e) {
    _log('permalink-read-failed', { media_id: mediaId, error: e.message || String(e) });
    return '';
  }
}

/**
 * Publish a post to the AmbientPixels Instagram Business account.
 *
 * @param {Object} action — full action object
 * @returns {Promise<{receipt: Object}>}
 */
async function publishToInstagram(action) {
  const creds = await getCredentials();
  const credError = validateCredentials(creds);
  if (credError) {
    _log('credential-error', { error: credError });
    throw { code: 'MISSING_CREDENTIALS', message: credError };
  }

  const payload = action.payload || {};

  // Refuse BEFORE spending anything — no card render, no container, no Graph call.
  const refusal = checkPublishable(payload);
  if (refusal) {
    _log('refused', { action_id: action.id || null, code: refusal.code });
    throw refusal;
  }

  let caption = String(payload.text || '').trim();

  // Hash BEFORE truncation so it matches what a prior success stored.
  const hash = contentHash(caption);
  const existing = shouldSkipDueToExistingReceipt(action, hash);
  if (existing) {
    _log('skip-repost-content-hash-match', { media_id: existing.post_id });
    return { receipt: existing };
  }

  if (caption.length > MAX_CHARS) {
    _log('truncating', { original: caption.length, limit: MAX_CHARS });
    caption = truncatePreservingUrl(caption, MAX_CHARS);
  }

  // ── The image ──
  // Supplied media wins. Otherwise render the approved copy onto a brand card: $0, no
  // model, and it can only ever show words a human already signed off on.
  const media = Array.isArray(payload.media) ? payload.media : [];
  const firstMedia = media.length
    ? (typeof media[0] === 'string' ? media[0] : (media[0].url || ''))
    : '';

  let imageUrl = /^https?:\/\//.test(firstMedia) ? firstMedia : '';
  let cardMeta = null;
  if (!imageUrl) {
    const cardEngine = require('../../../_lib/contentEngine/cardEngine');
    cardMeta = await cardEngine.generateCard({
      text: caption,
      handle: '@' + creds.igUsername,
      jobId: 'ig-' + (action.id || Date.now())
    });
    imageUrl = cardMeta.imageUrl;
    _log('card-rendered', { action_id: action.id || null, bytes: cardMeta.bytes, url: imageUrl });
  }

  // ── Step 1: container ──
  // A container that is never published is inert: it expires on its own in 24h, costs
  // nothing and is invisible. So a failure HERE is safe to retry.
  _log('container-create-start', { ig_user: creds.igUserId, captionLength: caption.length });
  const container = await retryOn429(
    function () {
      return _request('POST', '/' + creds.igUserId + '/media', {
        image_url: imageUrl,
        caption: caption,
        access_token: creds.pageAccessToken
      });
    },
    { platform: 'instagram', actionId: action.id || null }
  );

  const creationId = (container && container.id) || '';
  if (!creationId) {
    throw { code: 'IG_CONTAINER_FAILED', message: 'Instagram returned no container id' };
  }

  // ── Step 1b: wait for Instagram to actually prepare it ──
  // The /media call returning an id means "accepted", NOT "ready". Publishing straight
  // after it is a race, and on 2026-08-09 it lost: the first real post failed with
  // "Media ID is not available" (9007/2207027). Verified at the time that the image was
  // publicly fetchable and nothing had published — the container simply was not finished.
  await _waitForContainerReady(creationId, creds.pageAccessToken);

  // ── Step 2: publish ──
  // This is the dangerous one. If the POST lands but the RESPONSE is lost, the post is
  // live and we do not know it — and a retry publishes the same container again or builds
  // a new one, either way a double post to a public account.
  //
  // So the two failure classes are separated. A definite API error (Graph answered, with
  // a status) means nothing published and a retry is safe. A timeout or a dropped socket
  // means the outcome is UNKNOWN, and unknown is parked for a human — never retried.
  // Same rule actionsScheduler/stuck-execution.js already enforces after the
  // 2026-08-08 triple-post: "outcome unknown" must never mean "try again".
  let published;
  try {
    published = await _request('POST', '/' + creds.igUserId + '/media_publish', {
      creation_id: creationId,
      access_token: creds.pageAccessToken
    });
  } catch (err) {
    const code = (err && err.code) || '';
    const outcomeUnknown = code === 'TIMEOUT' || code === 'NETWORK_ERROR';
    if (outcomeUnknown) {
      _log('publish-outcome-unknown', { action_id: action.id || null, creation_id: creationId, error: err.message });
      throw {
        code: 'IG_PUBLISH_OUTCOME_UNKNOWN',
        message: 'media_publish did not return a verdict for container ' + creationId + ' (' + (err.message || code) + '). '
          + 'The post MAY be live. Check https://www.instagram.com/' + creds.igUsername + '/ before doing anything else — '
          + 'this will not be retried automatically because a retry could double-post.',
        // actionsScheduler honours this and parks the action instead of retrying.
        requires_manual_review: true,
        creation_id: creationId
      };
    }
    _log('publish-failed', { action_id: action.id || null, creation_id: creationId, error: err.message });
    throw err;
  }

  const mediaId = (published && published.id) || '';
  if (!mediaId) {
    throw {
      code: 'IG_PUBLISH_NO_ID',
      message: 'media_publish returned 200 with no media id for container ' + creationId + ' — cannot confirm the post',
      requires_manual_review: true,
      creation_id: creationId
    };
  }

  const permalink = await _fetchPermalink(mediaId, creds.pageAccessToken);

  const receipt = {
    platform: 'instagram',
    ig_user_id: creds.igUserId,
    handle: '@' + creds.igUsername,
    post_id: mediaId,
    creation_id: creationId,
    post_url: permalink || ('https://www.instagram.com/' + creds.igUsername + '/'),
    // Flagged when the URL is the profile rather than the post, so nothing downstream
    // reports a profile link as post-level attribution.
    post_url_is_fallback: !permalink,
    image_url: imageUrl,
    image_source: cardMeta ? 'cardEngine' : 'payload.media',
    card_job_id: cardMeta ? cardMeta.jobId : null,
    content_hash: hash,
    published_at: new Date().toISOString(),
    // cardEngine is free; a supplied image cost whatever produced it, not us.
    estimated_cost: 0
  };

  _log('publish-success', { action_id: action.id || null, media_id: mediaId, permalink: receipt.post_url });
  return { receipt: receipt };
}

module.exports = {
  publishToInstagram,
  getCredentials,
  validateCredentials,
  checkPublishable,
  classifyContainerStatus,
  findUrls,
  countHashtags,
  contentHash,
  _describeError,
  GRAPH_VERSION,
  MAX_CHARS,
  MAX_HASHTAGS,
  CONTAINER_READY_TIMEOUT_MS
};

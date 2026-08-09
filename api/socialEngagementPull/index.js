const https = require('https');
const storage = require('../_utils/companyStorage');
const socialTelemetry = require('../socialMetrics/telemetry');
const linkedinAuth = require('../_utils/linkedinAuth');

const LOOKBACK_DAYS = 30;
const MAX_SNAPSHOTS = 50000;
const MAX_POSTS_PER_CYCLE = 120;
// Facebook joined 2026-08-09. It was already accepted by socialMetrics/telemetry.js
// (which has listed it since the adapter shipped), so execution events were being
// RECORDED for Facebook posts while this cron filtered every one of them back out —
// the funnel would have shown a published post that never produced a metrics row.
const SOCIAL_PLATFORMS = ['x', 'linkedin', 'bluesky', 'facebook', 'instagram'];

function _id(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function _iso() {
  return new Date().toISOString();
}

function _httpRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: method,
      headers: headers || {}
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        resolve({ status: res.statusCode, data: json, raw: data });
      });
    });

    req.on('error', (err) => reject({ code: 'NETWORK_ERROR', message: err.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      reject({ code: 'TIMEOUT', message: 'Request timed out' });
    });

    if (body) req.write(body);
    req.end();
  });
}

function _extractXPostId(postUrl) {
  const m = String(postUrl || '').match(/status\/(\d{6,30})/i);
  return m ? m[1] : '';
}

function _extractLinkedInPostId(postUrl) {
  const url = String(postUrl || '');
  const urn = url.match(/urn:li:(?:share|ugcPost):[A-Za-z0-9_-]+/i);
  if (urn) return urn[0];
  const seg = url.split('/').filter(Boolean).pop() || '';
  if (!seg) return '';
  if (/^[0-9]+$/.test(seg)) return 'urn:li:share:' + seg;
  return seg;
}

function _extractBlueskyParts(postUrl) {
  const m = String(postUrl || '').match(/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/i);
  if (!m) return null;
  return { handle: m[1], rkey: m[2] };
}

async function _resolveDidFromHandle(handle) {
  const res = await _httpRequest('https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=' + encodeURIComponent(handle), 'GET');
  if (res.status !== 200 || !res.data || !res.data.did) {
    throw { code: 'BSKY_RESOLVE_HANDLE_FAILED', message: 'Failed to resolve handle: ' + handle };
  }
  return res.data.did;
}

async function _deriveBlueskyAtUri(postUrl) {
  if (String(postUrl || '').indexOf('at://') === 0) return postUrl;
  const parts = _extractBlueskyParts(postUrl);
  if (!parts) return '';
  const did = await _resolveDidFromHandle(parts.handle);
  return 'at://' + did + '/app.bsky.feed.post/' + parts.rkey;
}

async function _pullXMetrics(postId) {
  const bearer = process.env.X_BEARER_TOKEN || '';
  if (!bearer) throw { code: 'AUTH_X_BEARER_MISSING', message: 'X_BEARER_TOKEN not set', status: 401 };
  if (!postId) throw { code: 'PAYLOAD_POST_ID_MISSING', message: 'Missing X post id', status: 400 };

  const url = 'https://api.x.com/2/tweets/' + encodeURIComponent(postId) + '?tweet.fields=public_metrics';
  const res = await _httpRequest(url, 'GET', { 'Authorization': 'Bearer ' + bearer });
  if (res.status !== 200 || !res.data || !res.data.data) {
    throw { code: 'X_ENGAGEMENT_LOOKUP_FAILED', status: res.status, message: (res.data && (res.data.detail || res.data.error)) || (res.raw || '').slice(0, 300) };
  }

  const pm = (res.data.data && res.data.data.public_metrics) || {};
  return {
    likes: Number.isFinite(pm.like_count) ? pm.like_count : 0,
    comments: Number.isFinite(pm.reply_count) ? pm.reply_count : 0,
    reposts: Number.isFinite(pm.retweet_count) ? pm.retweet_count : 0,
    quotes: Number.isFinite(pm.quote_count) ? pm.quote_count : null,
    views: null,
    clicks: null
  };
}

async function _persistLastPulledAt() {
  const meta = (await storage.getState('socialEngagementMeta')) || {};
  const next = Object.assign({}, meta, {
    lastPulledAt: _iso()
  });
  await storage.setState('socialEngagementMeta', next);
}

async function _pullLinkedInMetrics(postId, isRetry) {
  const token = await linkedinAuth.getAccessToken(isRetry === true);
  if (!token) throw { code: 'AUTH_LINKEDIN_TOKEN_MISSING', message: 'No LinkedIn access token available', status: 401 };
  if (!postId) throw { code: 'PAYLOAD_POST_ID_MISSING', message: 'Missing LinkedIn post id', status: 400 };

  const encoded = encodeURIComponent(postId);
  const url = 'https://api.linkedin.com/v2/socialActions/' + encoded + '?projection=(likesSummary,commentsSummary,totalSocialActivityCounts)';
  const res = await _httpRequest(url, 'GET', {
    'Authorization': 'Bearer ' + token,
    'X-Restli-Protocol-Version': '2.0.0'
  });

  if (res.status === 401 && isRetry !== true) {
    // Token rejected — force one refresh and retry
    return _pullLinkedInMetrics(postId, true);
  }
  if (res.status !== 200 || !res.data) {
    throw { code: 'LINKEDIN_ENGAGEMENT_LOOKUP_FAILED', status: res.status, message: (res.data && (res.data.message || res.data.error)) || (res.raw || '').slice(0, 300) };
  }

  const d = res.data || {};
  const counts = d.totalSocialActivityCounts || {};
  return {
    likes: Number.isFinite((d.likesSummary || {}).totalLikes) ? d.likesSummary.totalLikes : (Number.isFinite(counts.numLikes) ? counts.numLikes : 0),
    comments: Number.isFinite((d.commentsSummary || {}).totalFirstLevelComments) ? d.commentsSummary.totalFirstLevelComments : (Number.isFinite(counts.numComments) ? counts.numComments : 0),
    reposts: Number.isFinite(counts.numShares) ? counts.numShares : 0,
    quotes: null,
    views: null,
    clicks: null
  };
}

async function _pullBlueskyMetrics(postUrl) {
  const atUri = await _deriveBlueskyAtUri(postUrl);
  if (!atUri) throw { code: 'PAYLOAD_POST_ID_MISSING', message: 'Missing Bluesky AT URI', status: 400 };

  const url = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=' + encodeURIComponent(atUri);
  const res = await _httpRequest(url, 'GET');
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.posts) || !res.data.posts[0]) {
    throw { code: 'BLUESKY_ENGAGEMENT_LOOKUP_FAILED', status: res.status, message: (res.data && (res.data.message || res.data.error)) || (res.raw || '').slice(0, 300) };
  }

  const p = res.data.posts[0] || {};
  return {
    likes: Number.isFinite(p.likeCount) ? p.likeCount : 0,
    comments: Number.isFinite(p.replyCount) ? p.replyCount : 0,
    reposts: Number.isFinite(p.repostCount) ? p.repostCount : 0,
    quotes: Number.isFinite(p.quoteCount) ? p.quoteCount : null,
    views: null,
    clicks: null,
    at_uri: p.uri || atUri
  };
}

/**
 * Facebook post metrics, via the adapter (it owns credentials + Graph versioning).
 *
 * fetchPostEngagement returns NULL when the read fails and stamps `_cumulative`
 * when it succeeds. Null is turned into a throw here so the caller records an
 * error snapshot: returning zeroes would put "0 likes" on the dashboard for a post
 * we could not read, which is the exact failure the Nov 7 data-access expiry will
 * cause (publishing keeps working while insights quietly return empty).
 *
 * The absolute totals are stored as-is, which is what every other platform here
 * does — X's like_count and Bluesky's likeCount are lifetime totals too. Snapshots
 * are point-in-time captures and differencing belongs to whoever reads a series of
 * them. Do NOT sum these.
 */
async function _pullFacebookMetrics(postId) {
  const facebook = require('../actionsExecute/executors/social/facebook');
  if (!postId) throw { code: 'PAYLOAD_POST_ID_MISSING', message: 'Missing Facebook post id', status: 400 };
  const eng = await facebook.fetchPostEngagement(postId);
  if (!eng) {
    throw { code: 'FACEBOOK_ENGAGEMENT_LOOKUP_FAILED', status: 502, message: 'Graph read failed or credentials missing for post ' + postId };
  }
  return {
    likes: Number.isFinite(eng.likes) ? eng.likes : 0,
    comments: Number.isFinite(eng.comments) ? eng.comments : 0,
    reposts: Number.isFinite(eng.shares) ? eng.shares : 0,
    quotes: null,
    views: null,
    clicks: null
  };
}

/**
 * Instagram media metrics.
 *
 * Read straight off the media object (`like_count`, `comments_count`) rather than the
 * /insights edge: insights on a brand-new Business account with 0 followers return
 * sparse or empty metric arrays, and an empty insights payload would arrive here as a
 * confident zero. These two fields are always present on a published media object.
 *
 * Reposts/quotes are null, not 0 — Instagram has no public reshare counter for feed
 * posts, and "we cannot see it" is not "it did not happen".
 *
 * Absolute totals at capture time, exactly like every other platform here. Difference a
 * series of these; never sum them.
 */
async function _pullInstagramMetrics(mediaId) {
  const instagram = require('../actionsExecute/executors/social/instagram');
  if (!mediaId) throw { code: 'PAYLOAD_POST_ID_MISSING', message: 'Missing Instagram media id', status: 400 };
  const creds = await instagram.getCredentials();
  if (instagram.validateCredentials(creds)) {
    throw { code: 'AUTH_INSTAGRAM_MISSING', message: 'Instagram credentials unavailable', status: 401 };
  }
  const url = 'https://graph.facebook.com/v26.0/' + encodeURIComponent(mediaId)
    + '?fields=like_count,comments_count&access_token=' + encodeURIComponent(creds.pageAccessToken);
  const res = await _httpRequest(url, 'GET');
  if (res.status !== 200 || !res.data) {
    throw {
      code: 'INSTAGRAM_ENGAGEMENT_LOOKUP_FAILED',
      status: res.status,
      message: (res.data && res.data.error && res.data.error.message) || (res.raw || '').slice(0, 300)
    };
  }
  return {
    likes: Number.isFinite(res.data.like_count) ? res.data.like_count : 0,
    comments: Number.isFinite(res.data.comments_count) ? res.data.comments_count : 0,
    reposts: null,
    quotes: null,
    views: null,
    clicks: null
  };
}

function _buildSnapshot(base, mode, metrics, errMeta) {
  return {
    id: _id('seg'),
    post_platform: base.post_platform,
    post_id: base.post_id,
    post_url: base.post_url || '',
    action_id: base.action_id,
    agent_id: base.agent_id || '',
    // What the post SAID, stamped at capture time.
    //
    // The dashboard used to resolve this by looking the action up by id at read
    // time, but `actions` is a trimmed rolling store (~a week) while snapshots
    // keep 60 days and this cron re-polls for 30. So every post older than the
    // trim showed as a blank row with a number next to it — a leaderboard of
    // nothing. Carried forward from the previous snapshot when the action is
    // already gone (see _priorTextByPost), so a post keeps its text for as long
    // as we keep measuring it.
    post_text: base.post_text || '',
    captured_at: _iso(),
    window_hint: 'pull',
    metrics: {
      likes: metrics && metrics.likes !== undefined ? metrics.likes : null,
      comments: metrics && metrics.comments !== undefined ? metrics.comments : null,
      reposts: metrics && metrics.reposts !== undefined ? metrics.reposts : null,
      quotes: metrics && metrics.quotes !== undefined ? metrics.quotes : null,
      views: metrics && metrics.views !== undefined ? metrics.views : null,
      clicks: metrics && metrics.clicks !== undefined ? metrics.clicks : null
    },
    meta: {
      mode: mode,
      source: 'api',
      error_class: errMeta ? errMeta.error_class : null,
      error_code: errMeta ? errMeta.error_code : null,
      error_message: errMeta ? errMeta.error_message : null
    }
  };
}

function _postKey(r) {
  return String(r.post_platform || '') + '|' + (r.post_id || r.post_url || r.action_id || '');
}

// Last known text per post, indexed under BOTH the post key and the action id.
// Bluesky rewrites post_id to the at:// URI once metrics come back, so a lookup
// keyed only on post_id misses the very rows it just wrote; the action id is
// stable across that rewrite.
function _priorTextByPost(snapshots) {
  const out = {};
  for (let i = 0; i < (snapshots || []).length; i++) {
    const s = snapshots[i];
    if (!s || !s.post_text) continue;
    out[_postKey(s)] = s.post_text;
    if (s.action_id) out['action|' + s.action_id] = s.post_text;
  }
  return out;
}

function _extractRecentSuccessPosts(events, actionsById) {
  actionsById = actionsById || {};
  const cutoff = Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return (events || [])
    .filter((e) => e && e.event_type === 'execution' && e.result === 'success' && SOCIAL_PLATFORMS.indexOf(e.platform) !== -1)
    .filter((e) => {
      const ts = Date.parse(e.executed_at || e.created_at || '');
      return !Number.isNaN(ts) && ts >= cutoff;
    })
    .sort((a, b) => Date.parse(b.executed_at || b.created_at || '') - Date.parse(a.executed_at || a.created_at || ''))
    .slice(0, MAX_POSTS_PER_CYCLE)
    .map((e) => {
      const platform = e.platform;
      const postUrl = e.post_url || '';
      let postId = '';
      if (platform === 'x') postId = _extractXPostId(postUrl);
      else if (platform === 'linkedin') postId = _extractLinkedInPostId(postUrl);
      else if (platform === 'bluesky') postId = _extractBlueskyParts(postUrl) ? _extractBlueskyParts(postUrl).rkey : '';
      else if (platform === 'instagram') {
        // Same rule as Facebook: the media id comes from the receipt. There is no URL
        // form to parse it back out of — an Instagram permalink carries a shortcode,
        // not the numeric media id the API needs.
        const _ig = actionsById[e.action_id];
        postId = (_ig && _ig.execution && _ig.execution.receipt && _ig.execution.receipt.post_id) || '';
      }
      else if (platform === 'facebook') {
        // From the RECEIPT, never parsed from post_url. New Pages publish under an
        // actor id that is not the Page id, so a composite rebuilt from a URL is a
        // guess — and Graph answers a wrong-but-well-formed id with someone else's
        // data or none. Empty here surfaces as PAYLOAD_POST_ID_MISSING on the
        // snapshot rather than as a silent skip.
        const _a = actionsById[e.action_id];
        postId = (_a && _a.execution && _a.execution.receipt && _a.execution.receipt.post_id) || '';
      }

      return {
        post_platform: platform,
        post_id: postId,
        post_url: postUrl,
        action_id: e.action_id,
        agent_id: e.agent_id || ''
      };
    });
}

module.exports = async function (context) {
  var demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;
  const mode = 'real';

  try {
    const events = (await storage.getState('socialMetricsEvents')) || [];

    // Text sources, in order of preference: the live action (fresh posts), then
    // whatever we stamped on this post last time (older posts whose action has
    // been trimmed away). Read once, outside the pull loop.
    const existingSnapshots = (await storage.getState('socialEngagementSnapshots')) || [];
    const priorTextByPost = _priorTextByPost(existingSnapshots);
    const actions = (await storage.getState('actions')) || [];
    const actionTextMap = {};
    // Actions are loaded BEFORE targets are picked because Facebook post ids come
    // from the action receipt, not from the post URL.
    const actionsById = {};
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (!a || !a.id) continue;
      actionsById[a.id] = a;
      if (a.payload && a.payload.text) actionTextMap[a.id] = String(a.payload.text).slice(0, 280);
    }

    const targets = _extractRecentSuccessPosts(events, actionsById);
    const snapshots = [];

    if (targets.length) {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        t.post_text = actionTextMap[t.action_id]
          || priorTextByPost[_postKey(t)]
          || priorTextByPost['action|' + t.action_id]
          || '';

        try {
          let metrics = null;
          if (t.post_platform === 'x') {
            metrics = await _pullXMetrics(t.post_id);
          } else if (t.post_platform === 'linkedin') {
            metrics = await _pullLinkedInMetrics(t.post_id);
          } else if (t.post_platform === 'bluesky') {
            metrics = await _pullBlueskyMetrics(t.post_url);
            if (metrics && metrics.at_uri) t.post_id = metrics.at_uri;
          } else if (t.post_platform === 'facebook') {
            metrics = await _pullFacebookMetrics(t.post_id);
          } else if (t.post_platform === 'instagram') {
            metrics = await _pullInstagramMetrics(t.post_id);
          }

          snapshots.push(_buildSnapshot(t, mode, metrics, null));
        } catch (err) {
          const tax = socialTelemetry.mapErrorToTelemetry(err || {});
          snapshots.push(_buildSnapshot(t, mode, null, tax));
        }
      }
    } else {
      context.log('[socialEngagementPull] No recent successful social posts found');
    }

    if (snapshots.length) {
      const merged = existingSnapshots.concat(snapshots);
      const trimmed = merged.length > MAX_SNAPSHOTS ? merged.slice(-MAX_SNAPSHOTS) : merged;
      await storage.setState('socialEngagementSnapshots', trimmed);
      context.log('[socialEngagementPull] Appended snapshots:', snapshots.length, 'mode=', mode);
    }

    // ── Facebook comment harvest ──
    //
    // Hosted here rather than as a new heartbeat module: companyHeartbeat/index.js
    // is off-limits, and this cron already has the two things the harvest needs —
    // recent successful posts and the actions store holding their receipts.
    //
    // Non-fatal by construction. Comments are a separate concern from metrics, and
    // a Graph outage must not cost us the snapshot write that already succeeded
    // above.
    try {
      const fbComments = require('./facebook-comments');
      const facebook = require('../actionsExecute/executors/social/facebook');
      const summary = await fbComments.pullFacebookComments({
        storage: storage,
        log: (m) => context.log(m),
        nowMs: Date.now(),
        events: events,
        actionsById: actionsById,
        sinceMs: Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
        fetchComments: (postId, opts) => facebook.fetchPostComments(postId, opts),
        getPageId: async () => {
          const creds = await facebook.getCredentials();
          return (creds && creds.pageId) || null;
        }
      });
      if (summary && summary.added > 0) {
        context.log('[socialEngagementPull] Facebook comments added to engagement inbox:', summary.added);
      }
    } catch (fbErr) {
      context.log.warn('[socialEngagementPull] Facebook comment harvest failed (non-fatal):', (fbErr && fbErr.message) || String(fbErr));
    }

    await _persistLastPulledAt();
  } catch (err) {
    context.log.error('[socialEngagementPull] Fatal:', err && err.message ? err.message : err);
  }
};

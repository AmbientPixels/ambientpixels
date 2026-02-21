const https = require('https');
const storage = require('../_utils/companyStorage');
const socialTelemetry = require('../socialMetrics/telemetry');

const LOOKBACK_DAYS = 30;
const MAX_SNAPSHOTS = 50000;
const MAX_POSTS_PER_CYCLE = 120;

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

async function _pullLinkedInMetrics(postId) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN || '';
  if (!token) throw { code: 'AUTH_LINKEDIN_TOKEN_MISSING', message: 'LINKEDIN_ACCESS_TOKEN not set', status: 401 };
  if (!postId) throw { code: 'PAYLOAD_POST_ID_MISSING', message: 'Missing LinkedIn post id', status: 400 };

  const encoded = encodeURIComponent(postId);
  const url = 'https://api.linkedin.com/v2/socialActions/' + encoded + '?projection=(likesSummary,commentsSummary,totalSocialActivityCounts)';
  const res = await _httpRequest(url, 'GET', {
    'Authorization': 'Bearer ' + token,
    'X-Restli-Protocol-Version': '2.0.0'
  });

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

function _buildSnapshot(base, mode, metrics, errMeta) {
  return {
    id: _id('seg'),
    post_platform: base.post_platform,
    post_id: base.post_id,
    post_url: base.post_url || '',
    action_id: base.action_id,
    agent_id: base.agent_id || '',
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

function _extractRecentSuccessPosts(events) {
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

      return {
        post_platform: platform,
        post_id: postId,
        post_url: postUrl,
        action_id: e.action_id,
        agent_id: e.agent_id || ''
      };
    });
}

function _mockMetrics(base, i) {
  const seed = (i + 1) * (base.post_platform === 'x' ? 3 : base.post_platform === 'linkedin' ? 5 : 7);
  return {
    likes: 10 + seed,
    comments: 2 + (seed % 6),
    reposts: 1 + (seed % 4),
    quotes: base.post_platform === 'x' ? (seed % 3) : null,
    views: base.post_platform === 'x' ? (120 + seed * 9) : null,
    clicks: null
  };
}

module.exports = async function (context) {
  const forceMock = String(process.env.SOCIAL_ENGAGEMENT_PULL_FORCE_MOCK || '').trim() === '1';
  const mode = forceMock ? 'mock_forced' : 'real';

  try {
    const events = (await storage.getState('socialMetricsEvents')) || [];
    const targets = _extractRecentSuccessPosts(events);
    if (!targets.length) {
      context.log('[socialEngagementPull] No recent successful social posts found');
      return;
    }

    const snapshots = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];

      if (forceMock) {
        snapshots.push(_buildSnapshot(t, mode, _mockMetrics(t, i), null));
        continue;
      }

      try {
        let metrics = null;
        if (t.post_platform === 'x') {
          metrics = await _pullXMetrics(t.post_id);
        } else if (t.post_platform === 'linkedin') {
          metrics = await _pullLinkedInMetrics(t.post_id);
        } else if (t.post_platform === 'bluesky') {
          metrics = await _pullBlueskyMetrics(t.post_url);
          if (metrics && metrics.at_uri) t.post_id = metrics.at_uri;
        }

        snapshots.push(_buildSnapshot(t, mode, metrics, null));
      } catch (err) {
        const tax = socialTelemetry.mapErrorToTelemetry(err || {});
        snapshots.push(_buildSnapshot(t, mode, null, tax));
      }
    }

    if (!snapshots.length) return;

    const existing = (await storage.getState('socialEngagementSnapshots')) || [];
    const merged = existing.concat(snapshots);
    const trimmed = merged.length > MAX_SNAPSHOTS ? merged.slice(-MAX_SNAPSHOTS) : merged;
    await storage.setState('socialEngagementSnapshots', trimmed);

    context.log('[socialEngagementPull] Appended snapshots:', snapshots.length, 'mode=', mode);
  } catch (err) {
    context.log.error('[socialEngagementPull] Fatal:', err && err.message ? err.message : err);
  }
};

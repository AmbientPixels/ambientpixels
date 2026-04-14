// outcomeRefresh — Timer Trigger (daily @ 14:00 UTC)
//
// Phase 1 of the Outcome Attribution System. Walks `outcomeSnapshots` entries
// whose `complete: false` (i.e., haven't reached the t7 maturity sample yet)
// and pulls fresh engagement metrics from the originating platform. Appends
// samples at lag boundaries t1, t7, t30. At t7 computes engagementRate and
// flips complete=true.
//
// Platform support in Phase 1:
//   X (twitter): OAuth 1.0a fetchTweetMetrics (mirrors actionsMetricsPull)
//   Bluesky: AT Protocol getPostThread (public, no auth)
//   Reddit: /api/info.json (public, requires User-Agent)
//   LinkedIn: DEFERRED (r_basicprofile OAuth complexity — Phase 1.5 follow-up)
//   Facebook: DEFERRED (Business Manager API)
//
// LinkedIn blind spot: snapshots for linkedin platform never reach
// `complete: true`. Callers (outcome-intel digest) must handle this.
//
// Non-fatal per snapshot: if one post fetch errors we skip it and continue.

const https = require('https');
const crypto = require('crypto');
const storage = require('../_utils/companyStorage');

const MAX_AGE_DAYS = 30;          // stop refreshing after 30 days
const PER_CYCLE_CAP = 50;          // max fetches per cron run
const LAG_BOUNDARIES = ['t1', 't7', 't30'];
const LAG_DAYS = { t0: 0, t1: 1, t7: 7, t30: 30 };

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function oauthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map(k => percentEncode(k) + '=' + percentEncode(params[k]))
    .join('&');
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&');
  const key = percentEncode(consumerSecret) + '&' + percentEncode(tokenSecret);
  return crypto.createHmac('sha1', key).update(base).digest('base64');
}

function buildOAuthHeader(oauthParams) {
  const parts = Object.keys(oauthParams)
    .filter(k => k.startsWith('oauth_'))
    .sort()
    .map(k => percentEncode(k) + '="' + percentEncode(oauthParams[k]) + '"');
  return 'OAuth ' + parts.join(', ');
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: headers || {}
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_e) { /* raw */ }
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on('error', err => reject({ code: 'NETWORK_ERROR', message: err.message }));
    req.setTimeout(10000, () => { req.destroy(); reject({ code: 'TIMEOUT', message: 'request timeout' }); });
    req.end();
  });
}

// ── X metrics fetch (OAuth 1.0a) ──
async function fetchXMetrics(postId) {
  const creds = {
    consumerKey: process.env.X_CONSUMER_KEY || '',
    consumerSecret: process.env.X_CONSUMER_SECRET || '',
    accessToken: process.env.X_ACCESS_TOKEN || '',
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || ''
  };
  if (!creds.consumerKey || !creds.accessToken) {
    throw { code: 'X_CREDS_MISSING', message: 'X credentials not configured' };
  }
  const baseUrl = 'https://api.x.com/2/tweets/' + postId;
  const queryParams = { 'tweet.fields': 'public_metrics' };
  const oauthParams = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0'
  };
  const allParams = Object.assign({}, oauthParams, queryParams);
  oauthParams.oauth_signature = oauthSignature('GET', baseUrl, allParams, creds.consumerSecret, creds.accessTokenSecret);
  const headers = { 'Authorization': buildOAuthHeader(oauthParams) };
  const qs = 'tweet.fields=' + encodeURIComponent(queryParams['tweet.fields']);
  const res = await httpGet(baseUrl + '?' + qs, headers);
  if (res.status !== 200 || !res.body || !res.body.data) {
    throw { code: 'X_API_ERROR_' + res.status, message: (res.body && res.body.detail) || String(res.raw).substring(0, 200) };
  }
  const m = res.body.data.public_metrics || {};
  return {
    likes: m.like_count || 0,
    comments: m.reply_count || 0,
    reposts: (m.retweet_count || 0) + (m.quote_count || 0),
    views: m.impression_count || 0,
    clicks: 0
  };
}

// ── Bluesky metrics fetch (AT Protocol, public) ──
async function fetchBlueskyMetrics(atUri) {
  if (!atUri) throw { code: 'BSKY_NO_URI', message: 'missing at_uri' };
  const url = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=' + encodeURIComponent(atUri) + '&depth=0';
  const res = await httpGet(url, { 'Accept': 'application/json' });
  if (res.status !== 200 || !res.body || !res.body.thread || !res.body.thread.post) {
    throw { code: 'BSKY_API_ERROR_' + res.status, message: String(res.raw).substring(0, 200) };
  }
  const p = res.body.thread.post;
  return {
    likes: p.likeCount || 0,
    comments: p.replyCount || 0,
    reposts: (p.repostCount || 0) + (p.quoteCount || 0),
    views: 0,  // Bluesky does not expose view count publicly
    clicks: 0
  };
}

// ── Reddit metrics fetch (public info API) ──
async function fetchRedditMetrics(postId) {
  if (!postId) throw { code: 'REDDIT_NO_ID', message: 'missing post_id' };
  const fullId = postId.startsWith('t3_') ? postId : ('t3_' + postId);
  const url = 'https://www.reddit.com/api/info.json?id=' + fullId;
  const res = await httpGet(url, { 'User-Agent': 'AmbientPixels/1.0 outcome-refresh' });
  if (res.status !== 200 || !res.body || !res.body.data || !Array.isArray(res.body.data.children) || res.body.data.children.length === 0) {
    throw { code: 'REDDIT_API_ERROR_' + res.status, message: String(res.raw).substring(0, 200) };
  }
  const d = res.body.data.children[0].data;
  return {
    likes: d.ups || d.score || 0,
    comments: d.num_comments || 0,
    reposts: d.num_crossposts || 0,
    views: 0,
    clicks: 0
  };
}

async function fetchMetrics(snapshot) {
  const platform = (snapshot.platform || '').toLowerCase();
  if (platform === 'x' || platform === 'twitter') return fetchXMetrics(snapshot.postId);
  if (platform === 'bluesky') return fetchBlueskyMetrics(snapshot.postUrl && snapshot.postUrl.startsWith('at://') ? snapshot.postUrl : snapshot._atUri || snapshot.atUri || deriveBlueskyAtUri(snapshot));
  if (platform === 'reddit') return fetchRedditMetrics(snapshot.postId);
  // linkedin/facebook not supported in Phase 1
  throw { code: 'PLATFORM_UNSUPPORTED', message: 'platform not supported yet: ' + platform };
}

function deriveBlueskyAtUri(snapshot) {
  // Bluesky baseline stored post_url but we also need at_uri. If missing, skip.
  // Baseline helper stores actionId on the snapshot; use it to look up the action.
  // Here we just return null so the caller errors out cleanly.
  return null;
}

function nextLagBoundary(samples, daysSincePublish) {
  // Return the next lag string whose threshold <= daysSincePublish and which
  // doesn't already have a sample captured. Returns null if we're caught up.
  const have = new Set((samples || []).map(s => s.lag));
  for (let i = 0; i < LAG_BOUNDARIES.length; i++) {
    const lag = LAG_BOUNDARIES[i];
    if (!have.has(lag) && daysSincePublish >= LAG_DAYS[lag]) return lag;
  }
  return null;
}

function computeEngagementRate(sample) {
  if (!sample) return null;
  const views = Number(sample.views || 0);
  if (views <= 0) {
    // Fallback for platforms without view counts (Bluesky, Reddit): use
    // (likes+comments+reposts) / (likes+comments+reposts+followers-baseline)
    // is unreliable, so emit engagement numerator only and let the digest
    // decide how to compare. Mark rate as null — consumer must check.
    return null;
  }
  return ((sample.likes || 0) + (sample.comments || 0) + (sample.reposts || 0)) / views;
}

// ── Downstream attribution (Phase 2 UTM) ──
// Walks blogPostViews + formIntake looking for utm_content === actionId.
// Populates snapshot.downstream counts. Non-fatal.
async function backfillDownstream(store, blogViews, formIntakeEvents) {
  const byActionBV = {};
  const byActionFS = {};
  const bvSubTypes = {};

  for (let i = 0; i < (blogViews || []).length; i++) {
    const v = blogViews[i];
    const actId = v && v.utmContent;
    if (!actId) continue;
    byActionBV[actId] = (byActionBV[actId] || 0) + 1;
  }
  for (let i = 0; i < (formIntakeEvents || []).length; i++) {
    const f = formIntakeEvents[i];
    const actId = f && f.utm && f.utm.content;
    if (!actId) continue;
    byActionFS[actId] = (byActionFS[actId] || 0) + 1;
    const t = f.type || 'unknown';
    if (!bvSubTypes[actId]) bvSubTypes[actId] = {};
    bvSubTypes[actId][t] = (bvSubTypes[actId][t] || 0) + 1;
  }

  const keys = Object.keys(store);
  for (let i = 0; i < keys.length; i++) {
    const s = store[keys[i]];
    if (!s.downstream) s.downstream = { blogViews: 0, formSubmits: 0, submissionTypes: {} };
    s.downstream.blogViews = byActionBV[s.actionId] || 0;
    s.downstream.formSubmits = byActionFS[s.actionId] || 0;
    s.downstream.submissionTypes = bvSubTypes[s.actionId] || {};
  }
}

module.exports = async function (context) {
  context.log('[outcomeRefresh] Starting refresh cycle');

  let store = {};
  let actions = [];
  try {
    store = (await storage.getState('outcomeSnapshots')) || {};
    actions = (await storage.getState('actions')) || [];
  } catch (err) {
    context.log.error('[outcomeRefresh] state load failed:', (err && err.message) || String(err));
    return;
  }

  // Build action lookup for Bluesky at_uri hydration
  const actionMap = {};
  for (let i = 0; i < actions.length; i++) {
    if (actions[i] && actions[i].id) actionMap[actions[i].id] = actions[i];
  }

  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let fetched = 0;
  let completedThisRun = 0;

  const keys = Object.keys(store);
  for (let i = 0; i < keys.length; i++) {
    if (fetched >= PER_CYCLE_CAP) break;
    const s = store[keys[i]];
    if (!s || s.complete) continue;
    const pubMs = Date.parse(s.publishedAt || 0);
    if (!Number.isFinite(pubMs)) continue;
    const ageMs = now - pubMs;
    if (ageMs > maxAgeMs) continue;
    const daysSince = ageMs / (24 * 60 * 60 * 1000);

    const lag = nextLagBoundary(s.samples, daysSince);
    if (!lag) continue;

    // Hydrate at_uri for bluesky from the linked action receipt if needed.
    if ((s.platform || '').toLowerCase() === 'bluesky' && !s.atUri) {
      const act = actionMap[s.actionId];
      const atUri = act && act.execution && act.execution.receipt && act.execution.receipt.at_uri;
      if (atUri) s.atUri = atUri;
    }

    try {
      const m = await fetchMetrics(s);
      const sample = {
        lag: lag,
        capturedAt: new Date().toISOString(),
        likes: m.likes,
        comments: m.comments,
        reposts: m.reposts,
        views: m.views,
        clicks: m.clicks
      };
      s.samples.push(sample);
      fetched++;
      if (lag === 't7') {
        s.engagementRate = computeEngagementRate(sample);
        s.complete = true;
        completedThisRun++;
      }
      context.log('[outcomeRefresh]', s.actionId, s.platform, lag, 'likes:', sample.likes, 'comments:', sample.comments, 'reposts:', sample.reposts);
    } catch (err) {
      // Stamp a failure sample so we don't spin on the same post every cycle.
      s.samples.push({
        lag: lag,
        capturedAt: new Date().toISOString(),
        error: ((err && err.code) || 'FETCH_ERROR') + ': ' + String((err && err.message) || err).substring(0, 200)
      });
      context.log.warn('[outcomeRefresh] fetch failed for', s.actionId, s.platform, lag, ':', (err && err.code) || 'error');
    }
  }

  // Phase 2 downstream attribution backfill (harmless if blogPostViews has no utm data yet).
  try {
    const blogViews = (await storage.getState('blogPostViews')) || [];
    const formIntakeEvents = (await storage.getState('formIntake')) || [];
    // Normalize blogViews shape (existing schema is {slug,timestamp,views}; Phase 2 extends with utmContent)
    const flatBV = Array.isArray(blogViews) ? blogViews : [];
    const flatFS = Array.isArray(formIntakeEvents) ? formIntakeEvents : [];
    await backfillDownstream(store, flatBV, flatFS);
  } catch (err) {
    context.log.warn('[outcomeRefresh] downstream backfill failed (non-fatal):', (err && err.message) || String(err));
  }

  try {
    await storage.setState('outcomeSnapshots', store);
    context.log('[outcomeRefresh] cycle complete. fetched:', fetched, 'completed(t7):', completedThisRun);
  } catch (err) {
    context.log.error('[outcomeRefresh] state save failed:', (err && err.message) || String(err));
  }
};

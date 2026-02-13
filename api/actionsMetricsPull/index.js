// actionsMetricsPull — Timer Trigger (every 15 minutes)
// Pulls engagement metrics (likes, retweets, impressions, replies) for
// recently published X posts and updates the action receipt.

const https = require('https');
const crypto = require('crypto');
const storage = require('../_utils/companyStorage');

// X API v2 tweet lookup with metrics
const X_API_BASE = 'https://api.x.com/2/tweets';
const METRICS_FIELDS = 'public_metrics,non_public_metrics,organic_metrics';
const LOOKBACK_HOURS = 48; // only pull metrics for posts within this window

function getCredentials() {
  return {
    consumerKey: process.env.X_CONSUMER_KEY || '',
    consumerSecret: process.env.X_CONSUMER_SECRET || '',
    accessToken: process.env.X_ACCESS_TOKEN || '',
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || '',
    bearerToken: process.env.X_BEARER_TOKEN || ''
  };
}

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

function generateSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map(k => percentEncode(k) + '=' + percentEncode(params[k]))
    .join('&');
  const signatureBase = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString)
  ].join('&');
  const signingKey = percentEncode(consumerSecret) + '&' + percentEncode(tokenSecret);
  return crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');
}

function buildAuthHeader(oauthParams) {
  const parts = Object.keys(oauthParams)
    .filter(k => k.startsWith('oauth_'))
    .sort()
    .map(k => percentEncode(k) + '="' + percentEncode(oauthParams[k]) + '"');
  return 'OAuth ' + parts.join(', ');
}

/**
 * Fetch tweet metrics from X API v2 using OAuth 1.0a
 * GET /2/tweets/:id?tweet.fields=public_metrics
 */
function fetchTweetMetrics(postId, creds) {
  return new Promise((resolve, reject) => {
    const baseUrl = X_API_BASE + '/' + postId;
    const queryParams = { 'tweet.fields': 'public_metrics' };

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

    // For GET, query params ARE included in signature base
    const allParams = Object.assign({}, oauthParams, queryParams);
    const signature = generateSignature('GET', baseUrl, allParams, creds.consumerSecret, creds.accessTokenSecret);
    oauthParams.oauth_signature = signature;

    const authHeader = buildAuthHeader(oauthParams);
    const queryString = Object.keys(queryParams)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]))
      .join('&');

    const url = new URL(baseUrl + '?' + queryString);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'Authorization': authHeader }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = null; }
        if (res.statusCode === 200 && parsed && parsed.data) {
          resolve(parsed.data);
        } else {
          reject({
            code: 'X_METRICS_ERROR_' + res.statusCode,
            message: (parsed && parsed.detail) || data.substring(0, 200)
          });
        }
      });
    });

    req.on('error', (err) => reject({ code: 'NETWORK_ERROR', message: err.message }));
    req.setTimeout(10000, () => {
      req.destroy();
      reject({ code: 'TIMEOUT', message: 'Metrics fetch timed out' });
    });
    req.end();
  });
}

module.exports = async function (context) {
  context.log('[MetricsPull] Starting metrics pull cycle');

  const creds = getCredentials();
  if (!creds.consumerKey || !creds.accessToken) {
    context.log.warn('[MetricsPull] X credentials not configured, skipping');
    return;
  }

  try {
    const actions = (await storage.getState('actions')) || [];
    const cutoff = Date.now() - (LOOKBACK_HOURS * 60 * 60 * 1000);
    let updated = 0;

    // Find actions with successful X execution receipts within lookback window
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (!a.execution || a.execution.status !== 'success') continue;
      if (!a.execution.receipt || a.execution.receipt.platform !== 'x') continue;
      if (!a.execution.receipt.post_id) continue;

      // Check if within lookback window
      const finishedAt = new Date(a.execution.finished_at || a.execution.receipt.timestamp).getTime();
      if (finishedAt < cutoff) continue;

      const postId = a.execution.receipt.post_id;

      try {
        const tweetData = await fetchTweetMetrics(postId, creds);
        const metrics = tweetData.public_metrics || {};

        // Update receipt with engagement metrics
        a.execution.receipt.metrics = {
          likes: metrics.like_count || 0,
          retweets: metrics.retweet_count || 0,
          replies: metrics.reply_count || 0,
          quotes: metrics.quote_count || 0,
          impressions: metrics.impression_count || 0,
          bookmarks: metrics.bookmark_count || 0,
          pulled_at: new Date().toISOString()
        };

        actions[i] = a;
        updated++;
        context.log('[MetricsPull] Updated metrics for post', postId, ':', JSON.stringify(a.execution.receipt.metrics));
      } catch (err) {
        context.log.warn('[MetricsPull] Failed to fetch metrics for post', postId, ':', err.message || err.code);
      }

      // Rate limit: max 15 lookups per cycle (X API rate limit is 300/15min for app auth)
      if (updated >= 15) break;
    }

    if (updated > 0) {
      await storage.setState('actions', actions);
      context.log('[MetricsPull] Updated metrics for', updated, 'posts');
    } else {
      context.log('[MetricsPull] No posts to update');
    }

  } catch (err) {
    context.log.error('[MetricsPull] Fatal error:', err.message || err);
  }
};

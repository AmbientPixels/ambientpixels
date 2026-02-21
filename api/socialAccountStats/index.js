const https = require('https');
const storage = require('../_utils/companyStorage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

const CACHE_KEY = 'socialAccountStats';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

// ── HTTP helper ──

function _httpGet(url, headers) {
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: headers || {}
    };
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        resolve({ status: res.statusCode, data: json, raw: data });
      });
    });
    req.on('error', function (err) { reject({ code: 'NETWORK_ERROR', message: err.message }); });
    req.setTimeout(12000, function () { req.destroy(); reject({ code: 'TIMEOUT', message: 'Request timed out' }); });
    req.end();
  });
}

// ── X (Twitter) ──

async function pullXAccountStats() {
  var bearer = process.env.X_BEARER_TOKEN || '';
  var handle = (process.env.X_HANDLE || 'AIAmbientPixels').replace(/^@/, '');
  if (!bearer) return { ok: false, error: 'X_BEARER_TOKEN not set' };

  try {
    // 1. Lookup user by username → get ID + public_metrics
    var userUrl = 'https://api.x.com/2/users/by/username/' + encodeURIComponent(handle) + '?user.fields=public_metrics,profile_image_url,description,created_at';
    var userRes = await _httpGet(userUrl, { 'Authorization': 'Bearer ' + bearer });
    if (userRes.status !== 200 || !userRes.data || !userRes.data.data) {
      return { ok: false, error: 'X user lookup failed (HTTP ' + userRes.status + '): ' + ((userRes.data && (userRes.data.detail || userRes.data.title)) || (userRes.raw || '').slice(0, 200)) };
    }

    var user = userRes.data.data;
    var pm = user.public_metrics || {};
    var userId = user.id;

    // 2. Get recent tweets with public_metrics
    var tweetsUrl = 'https://api.x.com/2/users/' + userId + '/tweets?max_results=10&tweet.fields=public_metrics,created_at&exclude=retweets,replies';
    var tweetsRes = await _httpGet(tweetsUrl, { 'Authorization': 'Bearer ' + bearer });
    var tweets = [];
    if (tweetsRes.status === 200 && tweetsRes.data && Array.isArray(tweetsRes.data.data)) {
      tweets = tweetsRes.data.data.map(function (t) {
        var m = t.public_metrics || {};
        return {
          id: t.id,
          text: (t.text || '').slice(0, 140),
          created_at: t.created_at || '',
          url: 'https://x.com/' + handle + '/status/' + t.id,
          likes: m.like_count || 0,
          retweets: m.retweet_count || 0,
          replies: m.reply_count || 0,
          quotes: m.quote_count || 0,
          impressions: m.impression_count || null,
          bookmarks: m.bookmark_count || null
        };
      });
    }

    return {
      ok: true,
      platform: 'x',
      handle: '@' + handle,
      name: user.name || handle,
      description: (user.description || '').slice(0, 200),
      avatar: user.profile_image_url || '',
      followers: pm.followers_count || 0,
      following: pm.following_count || 0,
      tweets_count: pm.tweet_count || 0,
      listed: pm.listed_count || 0,
      recentPosts: tweets
    };
  } catch (err) {
    return { ok: false, error: 'X: ' + (err.message || err.code || String(err)) };
  }
}

// ── LinkedIn ──

async function pullLinkedInAccountStats() {
  var token = process.env.LINKEDIN_ACCESS_TOKEN || '';
  var orgId = process.env.LINKEDIN_ORG_ID || '107826087';
  if (!token) return { ok: false, error: 'LINKEDIN_ACCESS_TOKEN not set' };

  try {
    // 1. Org info
    var orgUrl = 'https://api.linkedin.com/v2/organizations/' + orgId + '?projection=(localizedName,vanityName,logoV2)';
    var orgRes = await _httpGet(orgUrl, {
      'Authorization': 'Bearer ' + token,
      'X-Restli-Protocol-Version': '2.0.0'
    });
    var orgName = '';
    var vanity = '';
    if (orgRes.status === 200 && orgRes.data) {
      orgName = orgRes.data.localizedName || '';
      vanity = orgRes.data.vanityName || '';
    }

    // 2. Follower count via networkSizes
    var followerUrl = 'https://api.linkedin.com/v2/networkSizes/urn:li:organization:' + orgId + '?edgeType=CompanyFollowedByMember';
    var followerRes = await _httpGet(followerUrl, {
      'Authorization': 'Bearer ' + token,
      'X-Restli-Protocol-Version': '2.0.0'
    });
    var followers = 0;
    if (followerRes.status === 200 && followerRes.data) {
      followers = followerRes.data.firstDegreeSize || 0;
    }

    // 3. Recent posts via /v2/ugcPosts (org author)
    var postsUrl = 'https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(urn:li:organization:' + orgId + ')&sortBy=LAST_MODIFIED&count=10';
    var postsRes = await _httpGet(postsUrl, {
      'Authorization': 'Bearer ' + token,
      'X-Restli-Protocol-Version': '2.0.0'
    });
    var posts = [];
    if (postsRes.status === 200 && postsRes.data && Array.isArray(postsRes.data.elements)) {
      posts = postsRes.data.elements.slice(0, 10).map(function (p) {
        var sc = (p.specificContent && p.specificContent['com.linkedin.ugc.ShareContent']) || {};
        var text = (sc.shareCommentary && sc.shareCommentary.text) || '';
        var postUrn = p.id || '';
        return {
          id: postUrn,
          text: text.slice(0, 140),
          created_at: p.created && p.created.time ? new Date(p.created.time).toISOString() : '',
          url: postUrn ? 'https://www.linkedin.com/feed/update/' + postUrn : '',
          likes: null,
          comments: null,
          reposts: null
        };
      });

      // 4. Get social actions for each post (likes/comments)
      for (var i = 0; i < posts.length && i < 5; i++) {
        try {
          var actionsUrl = 'https://api.linkedin.com/v2/socialActions/' + encodeURIComponent(posts[i].id) + '?projection=(likesSummary,commentsSummary)';
          var actRes = await _httpGet(actionsUrl, {
            'Authorization': 'Bearer ' + token,
            'X-Restli-Protocol-Version': '2.0.0'
          });
          if (actRes.status === 200 && actRes.data) {
            posts[i].likes = (actRes.data.likesSummary && actRes.data.likesSummary.totalLikes) || 0;
            posts[i].comments = (actRes.data.commentsSummary && actRes.data.commentsSummary.totalFirstLevelComments) || 0;
          }
        } catch (_) { /* skip */ }
      }
    }

    return {
      ok: true,
      platform: 'linkedin',
      handle: vanity ? vanity : 'org:' + orgId,
      name: orgName || 'LinkedIn Org',
      description: '',
      avatar: '',
      followers: followers,
      following: null,
      posts_count: posts.length,
      recentPosts: posts
    };
  } catch (err) {
    return { ok: false, error: 'LinkedIn: ' + (err.message || err.code || String(err)) };
  }
}

// ── Bluesky ──

async function pullBlueskyAccountStats() {
  var handle = process.env.BLUESKY_HANDLE || '';
  if (!handle) return { ok: false, error: 'BLUESKY_HANDLE not set' };

  try {
    // 1. Profile
    var profileUrl = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=' + encodeURIComponent(handle);
    var profileRes = await _httpGet(profileUrl, {});
    if (profileRes.status !== 200 || !profileRes.data) {
      return { ok: false, error: 'Bluesky profile lookup failed (HTTP ' + profileRes.status + ')' };
    }

    var p = profileRes.data;

    // 2. Author feed
    var feedUrl = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=' + encodeURIComponent(handle) + '&limit=10&filter=posts_no_replies';
    var feedRes = await _httpGet(feedUrl, {});
    var posts = [];
    if (feedRes.status === 200 && feedRes.data && Array.isArray(feedRes.data.feed)) {
      posts = feedRes.data.feed.slice(0, 10).map(function (item) {
        var post = (item && item.post) || {};
        var record = post.record || {};
        var rkey = (post.uri || '').split('/').pop() || '';
        return {
          id: rkey,
          text: (record.text || '').slice(0, 140),
          created_at: record.createdAt || '',
          url: 'https://bsky.app/profile/' + handle + '/post/' + rkey,
          likes: Number.isFinite(post.likeCount) ? post.likeCount : 0,
          replies: Number.isFinite(post.replyCount) ? post.replyCount : 0,
          reposts: Number.isFinite(post.repostCount) ? post.repostCount : 0,
          quotes: Number.isFinite(post.quoteCount) ? post.quoteCount : null
        };
      });
    }

    return {
      ok: true,
      platform: 'bluesky',
      handle: '@' + (p.handle || handle),
      name: p.displayName || handle,
      description: (p.description || '').slice(0, 200),
      avatar: p.avatar || '',
      followers: p.followersCount || 0,
      following: p.followsCount || 0,
      posts_count: p.postsCount || 0,
      recentPosts: posts
    };
  } catch (err) {
    return { ok: false, error: 'Bluesky: ' + (err.message || err.code || String(err)) };
  }
}

// ── Main handler ──

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }

  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS, body: { error: 'Method not allowed' } };
    return;
  }

  var secret = (req.headers && req.headers['x-company-secret']) || '';
  var principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
    return;
  }

  var forceRefresh = (req.query && req.query.refresh === '1');

  try {
    // Check cache
    if (!forceRefresh) {
      var cached = await storage.getState(CACHE_KEY);
      if (cached && cached._cachedAt) {
        var age = Date.now() - Date.parse(cached._cachedAt);
        if (age < CACHE_TTL_MS) {
          context.res = {
            status: 200,
            headers: CORS,
            body: Object.assign({}, cached, { meta: { cached: true, cacheAgeMs: age, ttlMs: CACHE_TTL_MS } })
          };
          return;
        }
      }
    }

    // Pull from all platforms in parallel
    var results = await Promise.all([
      pullXAccountStats(),
      pullLinkedInAccountStats(),
      pullBlueskyAccountStats()
    ]);

    var platforms = {};
    var errors = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.ok) {
        platforms[r.platform] = r;
      } else {
        errors.push(r.error || 'Unknown error');
      }
    }

    // Aggregate totals
    var totalFollowers = 0;
    var totalPosts = 0;
    var allRecentPosts = [];
    var platformKeys = Object.keys(platforms);
    for (var j = 0; j < platformKeys.length; j++) {
      var pl = platforms[platformKeys[j]];
      totalFollowers += (pl.followers || 0);
      totalPosts += (pl.posts_count || pl.tweets_count || 0);
      if (Array.isArray(pl.recentPosts)) {
        pl.recentPosts.forEach(function (post) {
          allRecentPosts.push(Object.assign({ platform: platformKeys[j] }, post));
        });
      }
    }

    // Sort recent posts by date desc
    allRecentPosts.sort(function (a, b) {
      return Date.parse(b.created_at || '') - Date.parse(a.created_at || '');
    });

    var payload = {
      _cachedAt: new Date().toISOString(),
      totals: {
        followers: totalFollowers,
        posts: totalPosts,
        platforms_connected: platformKeys.length,
        platforms_errored: errors.length
      },
      platforms: platforms,
      recentPosts: allRecentPosts.slice(0, 20),
      errors: errors
    };

    // Persist cache
    await storage.setState(CACHE_KEY, payload);

    context.res = {
      status: 200,
      headers: CORS,
      body: Object.assign({}, payload, { meta: { cached: false, ttlMs: CACHE_TTL_MS } })
    };
  } catch (err) {
    context.log.error('[social-account-stats] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to load account stats', details: err && err.message ? err.message : String(err) }
    };
  }
};

// social-intel.js — extracted from companyHeartbeat/index.js (Phase 4 refactor)
// Social intelligence digest builder and prompt block formatter

const { SOCIAL_INTEL_FRESHNESS_MS, SOCIAL_INTEL_WINDOW_DAYS } = require('./constants');
const { _socialIntelIsoDayUTC, _socialIntelEventTs, _socialIntelResolveMode } = require('./helpers');

function _socialIntelBuildDigest(existingDigest, socialEvents, engagementSnapshots, engagementMeta, nowMs, accountStats, weeklyHistory, blogPostViews) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var existingAsOf = existingDigest && existingDigest.asOfUtc ? Date.parse(existingDigest.asOfUtc) : NaN;
  if (existingDigest && Number.isFinite(existingAsOf) && (now - existingAsOf) < SOCIAL_INTEL_FRESHNESS_MS) {
    return existingDigest;
  }

  var events = Array.isArray(socialEvents) ? socialEvents : [];
  var snapshots = Array.isArray(engagementSnapshots) ? engagementSnapshots : [];
  var sevenCutoff = now - (SOCIAL_INTEL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  var day24Cutoff = now - (24 * 60 * 60 * 1000);
  var todayUtc = _socialIntelIsoDayUTC(new Date(now));

  var execTotal7d = 0;
  var execSuccess7d = 0;
  var latencyTotal7d = 0;
  var latencyCount7d = 0;
  var publishedToday = 0;
  var failures24h = 0;
  var issueCount24h = {};
  var issueLatest24h = {};

  for (var i = 0; i < events.length; i++) {
    var ev = events[i] || {};
    if (ev.event_type !== 'execution') continue;
    var ts = _socialIntelEventTs(ev);
    if (!Number.isFinite(ts)) continue;
    var isSuccess = ev.result === 'success';
    var isFailure = ev.result === 'failure';

    if (ts >= sevenCutoff) {
      execTotal7d += 1;
      if (isSuccess) execSuccess7d += 1;
      if (Number.isFinite(ev.latency_ms) && ev.latency_ms >= 0) {
        latencyTotal7d += ev.latency_ms;
        latencyCount7d += 1;
      }
    }

    if (isSuccess && _socialIntelIsoDayUTC(new Date(ts)) === todayUtc) {
      publishedToday += 1;
    }

    if (isFailure && ts >= day24Cutoff) {
      failures24h += 1;
      var cls = ev.error_class || 'UNKNOWN';
      issueCount24h[cls] = (issueCount24h[cls] || 0) + 1;
      issueLatest24h[cls] = Math.max(issueLatest24h[cls] || 0, ts);
    }
  }

  var topIssue24h = null;
  var issueKeys = Object.keys(issueCount24h);
  if (issueKeys.length > 0) {
    issueKeys.sort(function (a, b) {
      var countDiff = (issueCount24h[b] || 0) - (issueCount24h[a] || 0);
      if (countDiff !== 0) return countDiff;
      var recencyDiff = (issueLatest24h[b] || 0) - (issueLatest24h[a] || 0);
      if (recencyDiff !== 0) return recencyDiff;
      return a.localeCompare(b);
    });
    topIssue24h = issueKeys[0] || null;
  }

  var byPlatform = {
    x: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
    linkedin: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
    bluesky: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
    reddit: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 },
    facebook: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 }
  };
  var platformPostSets = { x: {}, linkedin: {}, bluesky: {}, reddit: {}, facebook: {} };
  var postAgg = {};

  for (var j = 0; j < snapshots.length; j++) {
    var s = snapshots[j] || {};
    var pts = Date.parse(s.captured_at || '');
    if (!Number.isFinite(pts) || pts < sevenCutoff) continue;
    var platform = String(s.post_platform || '').toLowerCase();
    if (!byPlatform[platform]) continue;

    var likes = Number.isFinite(s.metrics && s.metrics.likes) ? s.metrics.likes : 0;
    var comments = Number.isFinite(s.metrics && s.metrics.comments) ? s.metrics.comments : 0;
    var reposts = Number.isFinite(s.metrics && s.metrics.reposts) ? s.metrics.reposts : 0;

    byPlatform[platform].likes7d += likes;
    byPlatform[platform].comments7d += comments;
    byPlatform[platform].reposts7d += reposts;

    var postId = String(s.post_id || s.action_id || '').trim();
    if (postId) {
      platformPostSets[platform][postId] = true;
    }

    var postKey = platform + '|' + (postId || (s.post_url || '').trim());
    if (!postKey || postKey === platform + '|') continue;
    if (!postAgg[postKey]) {
      postAgg[postKey] = {
        platform: platform,
        post_url: s.post_url || '',
        likes: 0,
        comments: 0,
        reposts: 0,
        latestTs: pts
      };
    }
    postAgg[postKey].likes += likes;
    postAgg[postKey].comments += comments;
    postAgg[postKey].reposts += reposts;
    if (pts > postAgg[postKey].latestTs) postAgg[postKey].latestTs = pts;
    if (!postAgg[postKey].post_url && s.post_url) postAgg[postKey].post_url = s.post_url;
  }

  byPlatform.x.posts7d = Object.keys(platformPostSets.x).length;
  byPlatform.linkedin.posts7d = Object.keys(platformPostSets.linkedin).length;
  byPlatform.bluesky.posts7d = Object.keys(platformPostSets.bluesky).length;
  byPlatform.facebook.posts7d = Object.keys(platformPostSets.facebook).length;

  var topPosts7d = Object.keys(postAgg)
    .map(function (k) { return postAgg[k]; })
    .sort(function (a, b) {
      if (b.likes !== a.likes) return b.likes - a.likes;
      if (b.latestTs !== a.latestTs) return b.latestTs - a.latestTs;
      var ap = a.platform || '';
      var bp = b.platform || '';
      if (ap !== bp) return ap.localeCompare(bp);
      return String(a.post_url || '').localeCompare(String(b.post_url || ''));
    })
    .slice(0, 5)
    .map(function (p) {
      return {
        platform: p.platform,
        post_url: p.post_url || '',
        likes: p.likes,
        comments: p.comments,
        reposts: p.reposts
      };
    });

  var mode = _socialIntelResolveMode(engagementMeta, snapshots);
  var lastPulledAt = (engagementMeta && typeof engagementMeta.lastPulledAt === 'string' && !Number.isNaN(Date.parse(engagementMeta.lastPulledAt)))
    ? engagementMeta.lastPulledAt
    : null;

  var successRate7d = execTotal7d > 0 ? Number(((execSuccess7d / execTotal7d) * 100).toFixed(2)) : 0;
  var avgExecutionLatencyMs7d = latencyCount7d > 0 ? Math.round(latencyTotal7d / latencyCount7d) : 0;

  var topEngagementPlatform = 'x';
  ['x', 'linkedin', 'bluesky', 'facebook'].forEach(function (p) {
    if (byPlatform[p].likes7d > byPlatform[topEngagementPlatform].likes7d) topEngagementPlatform = p;
  });

  // Account-level stats (from socialAccountStats cache)
  var acct = (accountStats && accountStats.platforms) ? accountStats : null;
  var acctTotals = (accountStats && accountStats.totals) ? accountStats.totals : null;
  var acctFollowers = { x: 0, linkedin: 0, bluesky: 0, facebook: 0, total: 0 };
  if (acct && acct.platforms) {
    ['x', 'linkedin', 'bluesky', 'facebook'].forEach(function (p) {
      var pl = acct.platforms[p];
      if (pl && pl.ok !== false) acctFollowers[p] = pl.followers || 0;
    });
    acctFollowers.total = acctFollowers.x + acctFollowers.linkedin + acctFollowers.bluesky + acctFollowers.facebook;
  }
  if (acctTotals && acctTotals.followers) acctFollowers.total = acctTotals.followers;

  var acctTopPosts = [];
  if (accountStats && Array.isArray(accountStats.recentPosts)) {
    acctTopPosts = accountStats.recentPosts
      .filter(function (p) { return (p.likes || 0) + (p.replies || 0) + (p.reposts || p.retweets || 0) > 0; })
      .sort(function (a, b) { return ((b.likes || 0) + (b.replies || 0) + (b.reposts || b.retweets || 0)) - ((a.likes || 0) + (a.replies || 0) + (a.reposts || a.retweets || 0)); })
      .slice(0, 5)
      .map(function (p) {
        return {
          platform: p.platform || '',
          text: (p.text || '').slice(0, 80),
          likes: p.likes || 0,
          replies: p.replies || p.comments || 0,
          reposts: p.reposts || p.retweets || 0,
          url: p.url || ''
        };
      });
  }

  var signals = [];
  if (acctFollowers.total > 0) {
    signals.push('Account followers: ' + acctFollowers.total + ' total (x=' + acctFollowers.x + ', linkedin=' + acctFollowers.linkedin + ', bluesky=' + acctFollowers.bluesky + ').');
  }
  signals.push('Delivery 7d: ' + execSuccess7d + '/' + execTotal7d + ' executions succeeded (' + successRate7d + '%).');
  signals.push('Failures 24h: ' + failures24h + (topIssue24h ? ' (top issue: ' + topIssue24h + ').' : '.'));
  signals.push('Top engagement platform (likes 7d): ' + topEngagementPlatform + ' (' + byPlatform[topEngagementPlatform].likes7d + ').');

  var recommendations = [];
  if (mode !== 'real') {
    recommendations.push('Validate live engagement pull path before making channel strategy changes.');
  }
  if (failures24h > 0 && topIssue24h) {
    recommendations.push('Investigate ' + topIssue24h + ' failures in the last 24h and patch retry/content guardrails.');
  }
  if (successRate7d < 90) {
    recommendations.push('Improve delivery reliability before increasing social posting cadence.');
  }
  ['x', 'linkedin', 'bluesky', 'facebook'].forEach(function (p) {
    if (recommendations.length >= 3) return;
    if (byPlatform[p].posts7d === 0) {
      recommendations.push('Publish at least one ' + p + ' post this week to restore engagement signal coverage.');
    }
  });
  if (recommendations.length === 0) {
    recommendations.push('Maintain current cadence and monitor latency and issue drift daily.');
  }

  // Week-over-week deltas (compare current 7d vs last week's snapshot)
  var deltas = null;
  var prevWeek = Array.isArray(weeklyHistory) && weeklyHistory.length > 0 ? weeklyHistory[weeklyHistory.length - 1] : null;
  if (prevWeek && prevWeek.engagement) {
    deltas = { followers: {}, engagement: {}, postCount: {} };
    ['x', 'linkedin', 'bluesky'].forEach(function (p) {
      var prevF = (prevWeek.followers && prevWeek.followers[p]) || 0;
      var curF = acctFollowers[p] || 0;
      deltas.followers[p] = prevF > 0 ? Math.round(((curF - prevF) / prevF) * 1000) / 10 : 0;

      var prevE = (prevWeek.engagement[p] && prevWeek.engagement[p].total) || 0;
      var curE = (byPlatform[p] ? byPlatform[p].likes7d + byPlatform[p].comments7d + byPlatform[p].reposts7d : 0);
      deltas.engagement[p] = prevE > 0 ? Math.round(((curE - prevE) / prevE) * 1000) / 10 : 0;

      var prevP = (prevWeek.engagement[p] && prevWeek.engagement[p].posts) || 0;
      var curP = byPlatform[p] ? byPlatform[p].posts7d : 0;
      deltas.postCount[p] = curP - prevP;
    });
  }

  // Top blog posts by views (for Echo's promotion digest)
  var topBlogPosts = [];
  var bpv = Array.isArray(blogPostViews) ? blogPostViews : [];
  if (bpv.length > 0) {
    topBlogPosts = bpv
      .filter(function (v) { return (v.views || 0) > 0; })
      .sort(function (a, b) { return (b.views || 0) - (a.views || 0); })
      .slice(0, 3)
      .map(function (v) {
        return { title: (v.title || '').substring(0, 80), slug: v.slug || '', views: v.views || 0 };
      });
  }

  return {
    asOfUtc: new Date(now).toISOString(),
    windowDays: 7,
    mode: mode,
    lastPulledAt: lastPulledAt,
    delivery: {
      publishedToday: publishedToday,
      failures24h: failures24h,
      successRate7d: successRate7d,
      avgExecutionLatencyMs7d: avgExecutionLatencyMs7d,
      topIssue24h: topIssue24h
    },
    engagement: {
      byPlatform: byPlatform
    },
    account: {
      followers: acctFollowers,
      connectedPlatforms: acctTotals ? acctTotals.platforms_connected || 0 : 0,
      topLivePosts: acctTopPosts
    },
    topPosts7d: topPosts7d,
    deltas: deltas,
    topBlogPosts: topBlogPosts,
    signals: signals.slice(0, 4),
    recommendations: recommendations.slice(0, 3)
  };
}

function _buildSocialIntelPromptBlock(agent, socialIntel) {
  if (!socialIntel || !agent || (agent.name !== 'Echo' && agent.name !== 'Nova')) return '';
  var byPlatform = (socialIntel.engagement && socialIntel.engagement.byPlatform) || {};
  var px = byPlatform.x || { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 };
  var pl = byPlatform.linkedin || { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 };
  var pb = byPlatform.bluesky || { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 };
  var warning = socialIntel.mode !== 'real'
    ? '\n⚠ Metrics are mock/fallback; do not change strategy based solely on this.'
    : '';

  var acct = socialIntel.account || {};
  var followers = acct.followers || { x: 0, linkedin: 0, bluesky: 0, total: 0 };
  var acctSection = '';
  if (followers.total > 0) {
    acctSection = '\n- Account followers: ' + followers.total + ' total (x=' + followers.x + ', linkedin=' + followers.linkedin + ', bluesky=' + followers.bluesky + '), connected=' + (acct.connectedPlatforms || 0) + '/3';
  }

  var livePostsSection = '';
  var livePosts = (acct.topLivePosts || []).slice(0, 3);
  if (livePosts.length) {
    livePostsSection = '\n- Top recent posts (all account posts, ranked by engagement):';
    livePosts.forEach(function (p) {
      livePostsSection += '\n  - ' + p.platform + ': "' + (p.text || '').slice(0, 60) + '" — ' + p.likes + ' likes, ' + p.replies + ' replies, ' + p.reposts + ' reposts' + (p.url ? ' (' + p.url + ')' : '');
    });
  }

  if (agent.name === 'Echo') {
    var deltas = socialIntel.deltas || null;

    // Helper: trend arrow + % for a delta value
    function _trendArrow(pct) {
      if (pct === 0 || pct === null || pct === undefined) return '(flat)';
      var arrow = pct > 0 ? '↑' : '↓';
      return '(' + arrow + Math.abs(pct) + '% wow)';
    }
    function _healthLabel(fDelta, eDelta) {
      if (fDelta < -5 || eDelta < -10) return 'DECLINING';
      if (fDelta > 5 || eDelta > 15) return 'GROWING';
      return 'STABLE';
    }

    // Platform health with WoW trends
    var platformLines = '';
    ['x', 'linkedin', 'bluesky'].forEach(function (p) {
      var bp = byPlatform[p] || { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 };
      var eng = bp.likes7d + bp.comments7d + bp.reposts7d;
      var fol = followers[p] || 0;
      var fDelta = deltas && deltas.followers[p] || 0;
      var eDelta = deltas && deltas.engagement[p] || 0;
      var health = deltas ? _healthLabel(fDelta, eDelta) : '';
      var healthTag = health === 'DECLINING' ? ' — DECLINING' : (health === 'GROWING' ? ' — GROWING' : '');
      platformLines += '\n  - ' + p + ': ' + fol + ' followers ' + (deltas ? _trendArrow(fDelta) : '') +
        ', ' + eng + ' engagement ' + (deltas ? _trendArrow(eDelta) : '') +
        ', ' + bp.posts7d + ' posts' + healthTag;
    });

    // Platform health summary (actionable)
    var healthSummary = '';
    if (deltas) {
      var declining = [];
      var growing = [];
      ['x', 'linkedin', 'bluesky'].forEach(function (p) {
        var fD = deltas.followers[p] || 0;
        var eD = deltas.engagement[p] || 0;
        if (fD < -5 || eD < -10) declining.push(p);
        if (fD > 5 || eD > 15) growing.push(p);
      });
      if (declining.length > 0 || growing.length > 0) {
        healthSummary = '\n- PLATFORM HEALTH: ';
        if (declining.length) healthSummary += declining.join(', ') + ' declining — needs strategy refresh. ';
        if (growing.length) healthSummary += growing.join(', ') + ' growing — capitalize with increased cadence.';
      }
    }

    var top3 = (socialIntel.topPosts7d || []).slice(0, 3);
    var top3Lines = top3.length
      ? top3.map(function (p) {
        return '  - ' + p.platform + ': ' + (p.likes || 0) + ' likes, ' + (p.comments || 0) + ' comments' + (p.post_url ? ' (' + p.post_url + ')' : '');
      }).join('\n')
      : '  - (none)';

    // Blog performance for promotion
    var blogSection = '';
    var topBlogs = socialIntel.topBlogPosts || [];
    if (topBlogs.length > 0) {
      blogSection = '\n- TOP BLOG CONTENT (promote on social):';
      topBlogs.forEach(function (b) {
        blogSection += '\n  - "' + b.title + '" — ' + b.views + ' views' + (b.slug ? ' (/blog/' + b.slug + ')' : '');
      });
    }

    var recLines = (socialIntel.recommendations || []).slice(0, 3).map(function (r) { return '- ' + r; }).join('\n') || '- (none)';

    return '\n\nSOCIAL ANALYTICS (Echo — 7d, week-over-week):' +
      '\n- As of: ' + (socialIntel.asOfUtc || '') +
      '\n- Delivery: ' + (socialIntel.delivery && socialIntel.delivery.successRate7d || 0) + '% success, ' + (socialIntel.delivery && socialIntel.delivery.publishedToday || 0) + ' today, ' + (socialIntel.delivery && socialIntel.delivery.failures24h || 0) + ' failures 24h' +
      '\n- Platform performance (7d):' + platformLines +
      healthSummary +
      livePostsSection +
      '\n- Top agent posts (3):\n' + top3Lines +
      blogSection +
      '\n- Recommendations:\n' + recLines +
      warning;
  }

  var shortRecs = (socialIntel.recommendations || []).slice(0, 2).map(function (r) { return '- ' + r; }).join('\n') || '- (none)';
  return '\n\nSOCIAL INTEL DIGEST (Nova — concise, 7d UTC):' +
    acctSection +
    '\n- Delivery: successRate7d=' + (socialIntel.delivery && socialIntel.delivery.successRate7d || 0) + '%, publishedToday=' + (socialIntel.delivery && socialIntel.delivery.publishedToday || 0) + ', failures24h=' + (socialIntel.delivery && socialIntel.delivery.failures24h || 0) +
    '\n- Engagement by platform (7d): x=' + px.likes7d + '/' + px.comments7d + '/' + px.reposts7d + ' (posts ' + px.posts7d + '), linkedin=' + pl.likes7d + '/' + pl.comments7d + '/' + pl.reposts7d + ' (posts ' + pl.posts7d + '), bluesky=' + pb.likes7d + '/' + pb.comments7d + '/' + pb.reposts7d + ' (posts ' + pb.posts7d + ')' +
    '\n- topIssue24h=' + ((socialIntel.delivery && socialIntel.delivery.topIssue24h) || 'null') + ', lastPulledAt=' + (socialIntel.lastPulledAt || 'null') +
    '\n- Recommendations (max 2):\n' + shortRecs +
    warning;
}

// Build a compact weekly snapshot for WoW delta computation (stored in socialWeeklySnapshots blob)
function _buildWeeklySnapshot(digest) {
  if (!digest) return null;
  var bp = (digest.engagement && digest.engagement.byPlatform) || {};
  var followers = (digest.account && digest.account.followers) || {};
  var snapshot = {
    week: new Date().toISOString().substring(0, 10),
    timestamp: digest.asOfUtc || new Date().toISOString(),
    followers: { x: followers.x || 0, linkedin: followers.linkedin || 0, bluesky: followers.bluesky || 0, total: followers.total || 0 },
    engagement: {}
  };
  ['x', 'linkedin', 'bluesky'].forEach(function (p) {
    var pl = bp[p] || { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 };
    snapshot.engagement[p] = {
      total: pl.likes7d + pl.comments7d + pl.reposts7d,
      likes: pl.likes7d,
      comments: pl.comments7d,
      reposts: pl.reposts7d,
      posts: pl.posts7d
    };
  });
  return snapshot;
}

// Campaign velocity digest for Echo — which campaigns are behind/on-track/ahead
function _buildCampaignVelocityBlock(campaigns, allTasks) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) return '';
  var now = Date.now();
  var lines = [];
  var socialTypes = ['social_linkedin', 'social_x', 'social_bluesky', 'social_facebook', 'social_reddit'];

  campaigns.forEach(function (c) {
    if (c.status !== 'active') return;
    var types = c.allowedTaskTypes || (c.taskType ? [c.taskType] : []);
    var isSocial = types.some(function (t) { return socialTypes.indexOf(t) !== -1; });
    if (!isSocial) return;

    var linked = (allTasks || []).filter(function (t) { return t.campaign_id === c.id; });
    var done = linked.filter(function (t) { return t.status === 'done'; }).length;
    var total = linked.length;
    var max = c.maxTasks || 0;
    var pct = max > 0 ? Math.round((done / max) * 100) : (total > 0 ? Math.round((done / total) * 100) : 0);

    var pace = 'ON TRACK';
    if (c.endDate) {
      var daysLeft = Math.max(0, Math.ceil((Date.parse(c.endDate) - now) / (24 * 60 * 60 * 1000)));
      var tasksLeft = (max || total) - done;
      if (daysLeft <= 0 && tasksLeft > 0) {
        pace = 'OVERDUE';
      } else if (daysLeft > 0 && tasksLeft > 0) {
        var needed = Math.ceil(tasksLeft / Math.max(1, Math.floor(daysLeft / 3.5))); // posts per ~half-week
        if (needed > (c.frequency || 2)) pace = 'BEHIND PACE (need ~' + needed + '/week)';
      }
      if (tasksLeft <= 0) pace = 'COMPLETE';
      lines.push('- "' + (c.title || c.id).substring(0, 40) + '" [' + done + '/' + (max || total) + ' done, ' + pct + '%] ' + (daysLeft > 0 ? daysLeft + 'd left' : '') + ' — ' + pace);
    } else {
      if (max > 0 && done >= max) pace = 'COMPLETE';
      lines.push('- "' + (c.title || c.id).substring(0, 40) + '" [' + done + '/' + (max || total) + ' done, ' + pct + '%] — ' + pace);
    }
  });

  if (lines.length === 0) return '';
  return '\n\nCAMPAIGN VELOCITY (your active social campaigns):\n' +
    lines.join('\n') +
    '\nPrioritize BEHIND PACE campaigns. Do NOT create tasks for COMPLETE campaigns.';
}

module.exports = {
  _socialIntelBuildDigest,
  _buildSocialIntelPromptBlock,
  _buildWeeklySnapshot,
  _buildCampaignVelocityBlock
};

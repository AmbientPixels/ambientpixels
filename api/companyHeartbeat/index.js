// companyHeartbeat — Timer Trigger (every 30 minutes)
// Runs agent heartbeat cycles: reviews tasks, takes actions, logs activity
// Uses existing agentchat endpoint pattern for Gemini calls

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');
const webSearch = require('../toolsWebSearch/index');
const fs = require('fs');
const path = require('path');

const imageEngine = require('../_lib/contentEngine/imageEngine');
const crypto = require('crypto');
const { normalizeCampaignRef, ensureCampaign } = require('../_shared/campaignMatcher');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

const AGENT_IDS = ['nova', 'cipher', 'pixel', 'forge', 'echo', 'scribe', 'quill', 'scout'];

// Load agent personalities from company-agents.json
let _agentPersonalities = {};
try {
  const _agentsRaw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/company-agents.json'), 'utf8'));
  (_agentsRaw.agents || []).forEach(function (a) { if (a.id && a.systemPrompt) _agentPersonalities[a.id] = a.systemPrompt; });
} catch (_e) { /* fallback: heartbeat works without personality injection */ }

function _sanitizeSingleComment(text, fallbackText) {
  const fallback = String(fallbackText || '').trim() || 'I created this item to keep execution aligned and moving forward.';
  if (!text) return fallback;
  let s = String(text).replace(/\s+/g, ' ').trim();
  s = s.replace(/^['"`]+|['"`]+$/g, '').trim();
  if (!s) return fallback;
  if (s.length > 220) s = s.substring(0, 220).trim();
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

async function generateConversationalEntityComment(kind, options) {
  options = options || {};
  const k = String(kind || 'item').toLowerCase();
  const title = String(options.title || '').trim();
  const goal = String(options.goalTitle || options.goalId || '').trim();
  const seed = String(options.seedText || '').trim();
  const fallback = _sanitizeSingleComment(options.fallbackText || '',
    k === 'campaign'
      ? 'I created this campaign to group related work and keep planning/execution aligned under one objective.'
      : 'I created this project from the goal so the team has a clear execution container to work from.'
  );

  const prompt = [
    'Write exactly ONE conversational first-person sentence for a newly created ' + k + '.',
    'Rules:',
    '- Max 180 characters',
    '- Plain human language',
    '- No lists, no labels, no metadata, no markdown',
    '- Return only the sentence',
    title ? ('Title: ' + title) : '',
    goal ? ('Goal: ' + goal) : '',
    seed ? ('Context: ' + seed.substring(0, 500)) : ''
  ].filter(Boolean).join('\n');

  const raw = await callGemini(prompt, options.agentId || 'nova');
  return _sanitizeSingleComment(raw, fallback);
}

// Agent system prompts (abbreviated for heartbeat context)
const AGENT_ROLES = {
  nova: { name: 'Nova', role: 'Prime Operator', tier: 2, focus: 'execution planning, delegation, progress monitoring, escalation to CEO',
    doctrine: { strategicBias: 'Platform leverage, automation, 10x thinking', riskTolerance: 'High but calculated', timeHorizon: '3-10 years', coreQuestion: 'Does this increase AmbientPixels leverage?', escalationTriggers: ['Resource conflicts', 'Brand/platform pivots', 'Strategic misalignment'] } },
  cipher: { name: 'Cipher', role: 'CFO', tier: 3, focus: 'budgets, API costs, resource efficiency, spending',
    doctrine: { strategicBias: 'Capital efficiency, measurable ROI', riskTolerance: 'Low-Medium', timeHorizon: '12-36 months', coreQuestion: 'What is the ROI and downside risk?', escalationTriggers: ['API cost spikes', 'Unclear monetization', 'Budget drift'] } },
  pixel: { name: 'Pixel', role: 'Design & QC', tier: 3, focus: 'UI quality, accessibility, design consistency, frontend',
    doctrine: { strategicBias: 'Design systems, clarity, consistency', riskTolerance: 'Low (quality risk)', timeHorizon: 'Product lifecycle', coreQuestion: 'Is this intentional design?', escalationTriggers: ['UI inconsistency', 'Accessibility regressions', 'Feature clutter'] } },
  forge: { name: 'Forge', role: 'DevOps', tier: 3, focus: 'deployments, infrastructure, uptime, backend security',
    doctrine: { strategicBias: 'Stability, automation, observability', riskTolerance: 'Low (infra risk)', timeHorizon: 'Immediate + continuous', coreQuestion: 'Will this break at scale?', escalationTriggers: ['Security exposure', 'Unmonitored automation', 'Recursion loops'] } },
  echo: { name: 'Echo', role: 'Marketing', tier: 3, focus: 'content, social media, community, brand voice',
    doctrine: { strategicBias: 'Distribution, publishing cadence, narrative', riskTolerance: 'Medium', timeHorizon: 'Weekly-Quarterly', coreQuestion: 'Are we visible?', escalationTriggers: ['Dormant channels', 'Missed campaign cadence', 'Brand inconsistency'] } },
  scribe: { name: 'Scribe', role: 'Head of Content', tier: 3, focus: 'longform drafts, product briefs, documentation, content pipeline, publishing',
    doctrine: { strategicBias: 'Clarity, documentation, repeatability', riskTolerance: 'Low', timeHorizon: 'Immediate + archival', coreQuestion: 'Is this unambiguous?', escalationTriggers: ['Vague directives', 'Missing documentation', 'Inconsistent voice'] } },
  quill: { name: 'Quill', role: 'Content — Editor & Brand Voice', tier: 4, reportsTo: 'scribe', focus: 'editing, compression, brand consistency, CTA polish',
    doctrine: { strategicBias: 'Precision editing, clarity compression', riskTolerance: 'Low', timeHorizon: 'Immediate', coreQuestion: 'Can this be 20% clearer?', escalationTriggers: ['Redundant language', 'Message dilution'] } },
  scout: { name: 'Scout', role: 'Head of Research & Intelligence', tier: 3, focus: 'market research, competitive intelligence, trend analysis, strategic research, business decisions, web research',
    doctrine: { strategicBias: 'Strategic advantage, signal detection', riskTolerance: 'Medium', timeHorizon: 'Quarterly-Annual', coreQuestion: 'Where is leverage hiding?', escalationTriggers: ['Competitor acceleration', 'Platform dependency risk', 'Market shifts'] } }
};

// Decision classification thresholds
const CFO_THRESHOLD = 100; // budget_impact above this requires CEO approval

// ── Guardrails ──
const GUARDRAILS = {
  maxActionsPerCyclePerAgent: 3,
  maxGeminiCallsPerCycle: 15, // Tier 4 sub-agents are gated; only consume calls when triggered
  maxNewTasksPerCycle: 6,
  maxExecutesPerCyclePerAgent: 2,
  maxContentGeneratesPerCyclePerAgent: 1,
  maxEscalationsPerCycle: 3,
  maxActiveTasks: 50,
  dedupeWindowMs: 600000 // 10 min
};

// ── Persistent Agent Memory ──
let _agentMemoryStore = {}; // { agentId: [{ type, text, source, timestamp }] } — loaded from storage each cycle
const MAX_MEMORIES_PER_AGENT = 20;
const MAX_L4_WRITES_PER_AGENT_PER_DAY = 5;
const L4_PREFERRED_TYPES = new Set(['decision', 'constraint', 'resolved_incident', 'verified_fact', 'preference']);
const L4_LEGACY_TYPES = new Set(['learning', 'feedback', 'context', 'preference']);
const L4_ALLOWED_TYPES = new Set([...L4_PREFERRED_TYPES, ...L4_LEGACY_TYPES]);
const L4_DEFAULT_TTL_DAYS = 14;

// ── Tier 4 Sub-Agent Gating ──
const TIER4_SUB_AGENTS = new Set(['quill']);
const OBJECTIVE_EXEMPT_CATEGORIES = new Set(['ops_breakfix', 'governance', 'maintenance']);
const ALLOWED_UPDATE_KEYS = new Set([
  'status', 'assignee', 'dueDate', 'priority', 'classification', 'taskType',
  'tags', 'objective_id', 'directive_id', 'campaign_id', 'parent_task_id', 'child_task_ids'
]);
const CAP_DEFAULTS = {
  maxCreatesPerAgentPerRun: 2,
  maxMovesPerAgentPerRun: 5,
  maxUpdatesPerAgentPerRun: 8,
  maxProposalsPerAgentPerRun: 10
};
const _MUTATION_BUCKET_MAP = { create: 'creates', move: 'moves', update: 'updates' };
const MAX_TOOL_CALLS_PER_AGENT = 2;
const MAX_RESEARCH_INJECTIONS = 3;
const MAX_RESEARCH_CHARS = 2000;
const MAX_RESEARCH_STORE_ENTRIES = 20;
const AGENT_COOLDOWN_VIOLATIONS_PER_RUN = 2;
const MAX_OBSERVATIONS_PER_AGENT = 10;
const MAX_OBSERVATION_CHARS = 180;
const MAX_ENTITY_COMMENT_CALLS_PER_RUN = 6;
const VALID_TASK_STATUSES = ['pending-approval', 'backlog', 'todo', 'in-progress', 'review', 'done'];

// ── Phase 2B: Known action types for dual-envelope normalizer ──
const KNOWN_ACTION_TYPES = [
  'create-task', 'update-task', 'move-task', 'execute-task', 'review-task',
  'comment-task', 'create-social-action', 'revise-action', 'create-doc',
  'update-doc', 'submit-for-publish', 'create-content-package', 'generate-image',
  'create-reminder', 'web_search', 'remember'
];
const RESEARCH_MAX_AGE_DAYS = 30;
const SUB_AGENT_MENTION_WINDOW_HOURS = 24;
const SOCIAL_INTEL_WINDOW_DAYS = 7;
const SOCIAL_INTEL_FRESHNESS_MS = 30 * 60 * 1000;

// Campaign matching/creation now delegated to shared module: api/_shared/campaignMatcher.js

// Strip repeated auto-generated prefixes from task titles (prevents recursive nesting)
const _TASK_PREFIXES = [
  /^Write social copy for:\s*/i,
  /^Social Copy\s*[—–-]\s*/i,
  /^Generate hero image for:\s*/i,
  /^Hero Image\s*[—–-]\s*/i,
  /^Content Brief\s*[—–-]\s*/i,
  /^Draft:\s*/i,
  /^Auto:\s*/i,
  /^Calendar Update\s*[—–-]\s*/i
];
function stripTaskPrefixes(title) {
  if (!title) return title || '';
  var changed = true;
  var maxPasses = 5;
  while (changed && maxPasses-- > 0) {
    changed = false;
    for (var i = 0; i < _TASK_PREFIXES.length; i++) {
      if (_TASK_PREFIXES[i].test(title)) {
        title = title.replace(_TASK_PREFIXES[i], '');
        changed = true;
      }
    }
  }
  return title.trim();
}

function _isActiveStatus(status) {
  return status === 'todo' || status === 'in-progress' || status === 'review';
}

function _isRecent(ts, hours) {
  if (!ts) return false;
  var t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) <= hours * 60 * 60 * 1000;
}

function _hasAssignedActiveTasks(tasks, agentId) {
  return tasks.some(function (t) {
    return String(t.assignee || '').toLowerCase() === agentId &&
      _isActiveStatus(String(t.status || '').toLowerCase());
  });
}

function _hasRecentMention(tasks, agentId) {
  var agentName = (AGENT_ROLES[agentId] && AGENT_ROLES[agentId].name) || agentId;
  var needle = ('@' + agentName).toLowerCase();

  return tasks.some(function (t) {
    var comments = Array.isArray(t.comments) ? t.comments : [];
    return comments.some(function (c) {
      var text = String(c.text || c.comment || c.body || '').trim().toLowerCase();
      var ts = c.createdAt || c.created_at || c.timestamp || c.time || null;
      return text.indexOf(needle) !== -1 && _isRecent(ts, SUB_AGENT_MENTION_WINDOW_HOURS);
    });
  });
}

function _socialIntelIsoDayUTC(d) {
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function _socialIntelEventTs(ev) {
  var iso = (ev && (ev.executed_at || ev.created_at)) || '';
  var ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : null;
}

function _socialIntelResolveMode(engagementMeta, snapshots) {
  var mode = engagementMeta && typeof engagementMeta.mode === 'string' ? String(engagementMeta.mode).trim() : '';
  if (mode === 'real') return 'real';
  return 'real';
}

function _socialIntelBuildDigest(existingDigest, socialEvents, engagementSnapshots, engagementMeta, nowMs, accountStats) {
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
    bluesky: { likes7d: 0, comments7d: 0, reposts7d: 0, posts7d: 0 }
  };
  var platformPostSets = { x: {}, linkedin: {}, bluesky: {} };
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
  ['x', 'linkedin', 'bluesky'].forEach(function (p) {
    if (byPlatform[p].likes7d > byPlatform[topEngagementPlatform].likes7d) topEngagementPlatform = p;
  });

  // Account-level stats (from socialAccountStats cache)
  var acct = (accountStats && accountStats.platforms) ? accountStats : null;
  var acctTotals = (accountStats && accountStats.totals) ? accountStats.totals : null;
  var acctFollowers = { x: 0, linkedin: 0, bluesky: 0, total: 0 };
  if (acct && acct.platforms) {
    ['x', 'linkedin', 'bluesky'].forEach(function (p) {
      var pl = acct.platforms[p];
      if (pl && pl.ok !== false) acctFollowers[p] = pl.followers || 0;
    });
    acctFollowers.total = acctFollowers.x + acctFollowers.linkedin + acctFollowers.bluesky;
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
  ['x', 'linkedin', 'bluesky'].forEach(function (p) {
    if (recommendations.length >= 3) return;
    if (byPlatform[p].posts7d === 0) {
      recommendations.push('Publish at least one ' + p + ' post this week to restore engagement signal coverage.');
    }
  });
  if (recommendations.length === 0) {
    recommendations.push('Maintain current cadence and monitor latency and issue drift daily.');
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
    var top3 = (socialIntel.topPosts7d || []).slice(0, 3);
    var top3Lines = top3.length
      ? top3.map(function (p) {
        return '- ' + p.platform + ': ' + (p.likes || 0) + ' likes, ' + (p.comments || 0) + ' comments, ' + (p.reposts || 0) + ' reposts' + (p.post_url ? ' (' + p.post_url + ')' : '');
      }).join('\n')
      : '- (none)';
    var recLines = (socialIntel.recommendations || []).slice(0, 3).map(function (r) { return '- ' + r; }).join('\n') || '- (none)';
    return '\n\nSOCIAL INTEL DIGEST (Echo — delivery + engagement + account, 7d UTC):' +
      '\n- As of: ' + (socialIntel.asOfUtc || '') +
      acctSection +
      '\n- Delivery: successRate7d=' + (socialIntel.delivery && socialIntel.delivery.successRate7d || 0) + '%, publishedToday=' + (socialIntel.delivery && socialIntel.delivery.publishedToday || 0) + ', failures24h=' + (socialIntel.delivery && socialIntel.delivery.failures24h || 0) + ', avgLatencyMs7d=' + (socialIntel.delivery && socialIntel.delivery.avgExecutionLatencyMs7d || 0) + ', topIssue24h=' + ((socialIntel.delivery && socialIntel.delivery.topIssue24h) || 'null') +
      '\n- Engagement by platform (agent posts, 7d):' +
      '\n  - x: likes=' + px.likes7d + ', comments=' + px.comments7d + ', reposts=' + px.reposts7d + ', posts=' + px.posts7d +
      '\n  - linkedin: likes=' + pl.likes7d + ', comments=' + pl.comments7d + ', reposts=' + pl.reposts7d + ', posts=' + pl.posts7d +
      '\n  - bluesky: likes=' + pb.likes7d + ', comments=' + pb.comments7d + ', reposts=' + pb.reposts7d + ', posts=' + pb.posts7d +
      livePostsSection +
      '\n- Agent top posts (max 3):\n' + top3Lines +
      '\n- Recommendations (max 3):\n' + recLines +
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

// ── Escalation Hierarchy: Owner → Domain Lead → CEO (Nova) ──
// Maps each agent to their domain lead. Tasks with explicit domainLead field take priority.
const DOMAIN_LEAD_MAP = {
  scribe: 'nova',    // Scribe reports to Nova (department head)
  quill: 'scribe',   // Quill reports to Scribe
  scout: 'nova',     // Scout reports to Nova (department head)
  echo: 'nova',      // Echo escalates to Nova (department head)
  pixel: 'nova',     // Pixel escalates to Nova
  forge: 'nova',     // Forge escalates to Nova
  cipher: 'nova',    // Cipher escalates to Nova
  nova: null          // Nova is top of chain (CEO is human)
};

/**
 * Evaluate which escalation tier should handle a task.
 * Returns: { handler: 'owner'|'domainLead'|'escalationLead', domainLead, reason, novaSkip }
 */
function evaluateEscalationPath(task, now) {
  const assignee = (task.assignee || '').toLowerCase();
  const priority = (task.priority || 'medium').toLowerCase();
  const status = (task.status || '').toLowerCase();
  const domainLead = task.domainLead || DOMAIN_LEAD_MAP[assignee] || 'nova';
  const isBlocked = status === 'blocked' || (task.tags && task.tags.indexOf('blocked') !== -1);
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const hoursUntilDue = dueDate ? (dueDate.getTime() - now) / (1000 * 60 * 60) : Infinity;
  const isOverdue = dueDate ? hoursUntilDue < 0 : false;

  // Blocked → escalate to Nova immediately
  if (isBlocked) {
    return { handler: 'escalationLead', domainLead, reason: 'task_blocked', novaSkip: false };
  }

  // Overdue → escalate to Nova immediately
  if (isOverdue) {
    return { handler: 'escalationLead', domainLead, reason: 'task_overdue', novaSkip: false };
  }

  // High priority due within 24h → both domain lead AND Nova
  if (priority === 'high' && hoursUntilDue <= 24) {
    return { handler: 'both', domainLead, reason: 'high_due_24h', novaSkip: false };
  }

  // Medium priority due within 24h → domain lead only, Nova skips
  // Exception 1: if assignee IS nova, never skip (circular — nova is its own domain lead)
  // Exception 2: if task has been stuck 8+ hours (updatedAt age), escalate to Nova too
  const _taskAge = task.updatedAt ? (now - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60) : 0;
  if (priority === 'medium' && hoursUntilDue <= 24) {
    if (assignee === 'nova') {
      return { handler: 'owner', domainLead, reason: 'medium_due_24h_nova_is_owner', novaSkip: false };
    }
    if (_taskAge >= 8) {
      return { handler: 'both', domainLead, reason: 'medium_due_24h_stale_8h', novaSkip: false };
    }
    return { handler: 'domainLead', domainLead, reason: 'medium_due_24h_domain_lead_handles', novaSkip: true };
  }

  // Default: normal owner flow
  return { handler: 'owner', domainLead, reason: 'normal_flow', novaSkip: false };
}

function shouldRunTier4Agent(tasks, agentId) {
  if (!TIER4_SUB_AGENTS.has(agentId)) return { run: true, reason: 'not_tier4_subagent' };
  if (_hasAssignedActiveTasks(tasks, agentId)) return { run: true, reason: 'assigned_active_task' };
  if (_hasRecentMention(tasks, agentId)) return { run: true, reason: 'recent_mention_ping' };
  return { run: false, reason: 'no_assigned_tasks_or_mentions' };
}

function _normalizeCategory(category) {
  return String(category || '').trim().toLowerCase();
}

function _isInProgressStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'in-progress' || normalized === 'in_progress';
}

function _isStartWorkStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || _isInProgressStatus(normalized);
}

function _isTerminalTaskStatus(s) {
  return ['done', 'completed', 'closed'].includes(String(s || '').toLowerCase());
}

function _isObjectiveExemptCategory(category) {
  return OBJECTIVE_EXEMPT_CATEGORIES.has(_normalizeCategory(category));
}

const ALLOWED_MODES = new Set(['manual', 'supervised_autonomous', 'experimental']);

function _normalizeActivationMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (ALLOWED_MODES.has(normalized)) return normalized;
  return 'supervised_autonomous';
}

async function resolveActivationMode(storage, runId) {
  var raw = await storage.getState('activationMode');
  var provided = String(raw || '').trim().toLowerCase();
  if (ALLOWED_MODES.has(provided)) return provided;
  // Invalid or missing — default + log
  await logEvent('policy-violation', null, 'Invalid or missing activationMode, defaulting to supervised_autonomous', runId, {
    runId: runId, gate: 'activation_mode', reason: 'invalid_or_missing_mode', provided: raw || null
  });
  return 'supervised_autonomous';
}

const ALLOWED_EXEC_MODES = new Set(['active', 'observe', 'frozen']);
function normalizeExecutionMode(v) {
  var s = String(v || '').trim().toLowerCase();
  return ALLOWED_EXEC_MODES.has(s) ? s : 'active';
}

function _buildBlockedProposal(agentId, runId, reasonBlocked, proposedAction, payload) {
  var p = payload || {};
  var ac = Array.isArray(p.acceptanceCriteria) && p.acceptanceCriteria.length > 0
    ? p.acceptanceCriteria : ['Define success criteria.'];
  var ev = p.evidence && typeof p.evidence === 'object' ? Object.assign({}, p.evidence) : {};
  if (!ev.runId) ev.runId = runId;
  if (!ev.gate) ev.gate = reasonBlocked;
  var result = {
    type: 'proposal',
    agentId: agentId,
    runId: runId,
    reasonBlocked: reasonBlocked,
    proposedAction: proposedAction,
    payload: {
      title: String(p.title || 'Blocked ' + proposedAction + ' (' + reasonBlocked + ')').substring(0, 120),
      category: String(p.category || 'maintenance'),
      objective_id: p.objective_id || null,
      objective_suggestion: p.objective_suggestion || (reasonBlocked === 'objective_gate' ? 'Assign an objective before this task can proceed.' : null),
      acceptanceCriteria: ac.slice(0, 5),
      evidence: ev
    }
  };
  // Preserve extra payload fields from specialized gates (blockedKeys, cap, bucket, allowedKeys)
  if (p.blockedKeys) result.payload.blockedKeys = p.blockedKeys;
  if (p.allowedKeys) result.payload.allowedKeys = p.allowedKeys;
  if (p.cap !== undefined) result.payload.cap = p.cap;
  if (p.current !== undefined) result.payload.current = p.current;
  if (p.bucket) result.payload.bucket = p.bucket;
  if (p.taskId) result.payload.taskId = p.taskId;
  return result;
}

function _normalizeProposal(p) {
  if (!p || typeof p !== 'object') return p;
  p.type = 'proposal';
  if (p.payload) {
    if (p.payload.title) p.payload.title = String(p.payload.title).substring(0, 120);
    if (!p.payload.category) p.payload.category = 'maintenance';
    p.payload.category = String(p.payload.category);
    if (!Array.isArray(p.payload.acceptanceCriteria) || p.payload.acceptanceCriteria.length === 0) {
      p.payload.acceptanceCriteria = ['Define success criteria.'];
    }
    if (p.payload.acceptanceCriteria.length > 5) p.payload.acceptanceCriteria = p.payload.acceptanceCriteria.slice(0, 5);
    if (!p.payload.evidence || typeof p.payload.evidence !== 'object') p.payload.evidence = {};
    if (!p.payload.evidence.runId && p.runId) p.payload.evidence.runId = p.runId;
  }
  return p;
}

function _isValidProposal(p) {
  if (!p || p.type !== 'proposal') return false;
  if (!p.agentId || !p.runId || !p.reasonBlocked || !p.proposedAction) return false;
  if (!p.payload) return false;
  if (!p.payload.title) return false;
  if (!p.payload.category) return false;
  if (!Array.isArray(p.payload.acceptanceCriteria) || p.payload.acceptanceCriteria.length < 1) return false;
  if (!p.payload.evidence || typeof p.payload.evidence !== 'object' || !p.payload.evidence.runId) return false;
  if (!p.payload.objective_id && !p.payload.objective_suggestion) return false;
  return true;
}

// ── Phase 2B: Dual-envelope agent output normalizer ──
// Supports legacy { observation, actions } and new { taskUpdates, proposals, remember, observations }
function normalizeAgentResult(parsed) {
  const normalized = { actions: [], proposals: [], remember: [], observations: [] };
  if (!parsed || typeof parsed !== 'object') return normalized;

  // ── Legacy format: { observation, actions } ──
  if (Array.isArray(parsed.actions)) {
    if (typeof parsed.observation === 'string' && parsed.observation.trim()) {
      normalized.observations.push(parsed.observation.trim());
    }
    for (var i = 0; i < parsed.actions.length; i++) {
      var action = parsed.actions[i];
      if (!action || typeof action !== 'object') continue;
      var type = action.type || '';

      if (type === 'remember' && action.memory) {
        // Extract to normalized.remember AND keep in actions for existing processing loop
        normalized.remember.push({
          type: (action.memory.type || '').trim(),
          text: (action.memory.text || '').trim(),
          evidence: action.memory.evidence || undefined,
          expiresAt: action.memory.expiresAt || undefined
        });
        normalized.actions.push(action);
      } else if (type === 'proposal') {
        // Agent explicitly emitted a proposal
        normalized.proposals.push(action.proposal || action);
      } else if (KNOWN_ACTION_TYPES.indexOf(type) !== -1) {
        normalized.actions.push(action);
      } else {
        // Unknown type → observation warning, do not crash
        normalized.observations.push('[unknown-action-type] ' + type + ': ' + (action.summary || '').substring(0, 200));
      }
    }
    return normalized;
  }

  // ── New format: { taskUpdates, proposals, remember, observations } ──
  if (parsed.taskUpdates || parsed.proposals || parsed.remember || parsed.observations) {
    // taskUpdates → actions (same format the processing loop expects)
    if (Array.isArray(parsed.taskUpdates)) {
      for (var j = 0; j < parsed.taskUpdates.length; j++) {
        var tu = parsed.taskUpdates[j];
        if (tu && typeof tu === 'object') normalized.actions.push(tu);
      }
    }
    // proposals
    if (Array.isArray(parsed.proposals)) {
      for (var k = 0; k < parsed.proposals.length; k++) {
        if (parsed.proposals[k] && typeof parsed.proposals[k] === 'object') {
          normalized.proposals.push(parsed.proposals[k]);
        }
      }
    }
    // remember → extract AND convert to action objects for existing processing loop
    if (Array.isArray(parsed.remember)) {
      for (var m = 0; m < parsed.remember.length; m++) {
        var mem = parsed.remember[m];
        if (mem && typeof mem === 'object') {
          normalized.remember.push({
            type: (mem.type || '').trim(),
            text: (mem.text || '').trim(),
            evidence: mem.evidence || undefined,
            expiresAt: mem.expiresAt || undefined
          });
          // Convert to action object for existing processing loop
          normalized.actions.push({ type: 'remember', memory: mem });
        }
      }
    }
    // observations
    if (Array.isArray(parsed.observations)) {
      for (var n = 0; n < parsed.observations.length; n++) {
        if (typeof parsed.observations[n] === 'string') {
          normalized.observations.push(parsed.observations[n]);
        }
      }
    } else if (typeof parsed.observations === 'string' && parsed.observations.trim()) {
      normalized.observations.push(parsed.observations.trim());
    }
    return normalized;
  }

  // Fallback: unrecognized format
  return normalized;
}

// ── Phase 4A: Defensive envelope normalization ──
async function _normalizeEnvelope(parsed, opts) {
  const options = opts || {};
  const agentId = options.agentId || null;
  const runId = options.runId || null;
  const onPolicyViolationGate = typeof options.onPolicyViolationGate === 'function' ? options.onPolicyViolationGate : null;
  const envelope = { taskUpdates: [], proposals: [], remember: [], observations: [] };

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (onPolicyViolationGate) onPolicyViolationGate('output_envelope');
    await logEvent('policy-violation', agentId, 'Invalid agent output envelope', runId, {
      runId: runId,
      agentId: agentId,
      gate: 'output_envelope',
      reason: 'invalid_json_or_non_object'
    });
    envelope.observations.push('Invalid agent output envelope.');
    return envelope;
  }

  const fields = ['taskUpdates', 'proposals', 'remember', 'observations'];
  for (const field of fields) {
    const value = parsed[field];
    if (Array.isArray(value)) {
      envelope[field] = value;
      continue;
    }
    if (value === null || value === undefined) {
      envelope[field] = [];
      continue;
    }
    if (typeof value === 'string' || (typeof value === 'object' && !Array.isArray(value))) {
      envelope[field] = [value];
      envelope.observations.push('Normalized non-array field: ' + field);
      continue;
    }
    envelope[field] = [];
    envelope.observations.push('Normalized non-array field: ' + field);
  }

  return envelope;
}

module.exports = async function (context) {
  const cycleId = 'cycle-' + Date.now();
  const runId = cycleId;
  const cycleStart = new Date().toISOString();
  let geminiCalls = 0;
  let newTasksCreated = 0;
  const agentActions = {};
  const _pendingEscalations = [];
  const skippedAgents = [];

  context.log('[Heartbeat] Starting cycle:', cycleId);

  try {
    if (!GEMINI_API_KEY) {
      context.log.warn('[Heartbeat] No GEMINI_API_KEY — skipping');
      await logEvent('heartbeat', null, 'Heartbeat skipped: no API key', cycleId);
      return;
    }

    // Load current state
    const tasks = (await storage.getState('tasks')) || [];
    const _taskIdsAtLoad = new Set(tasks.map(function (t) { return t && t.id; }).filter(Boolean));
    const _taskIdsArchived = new Set(); // populated by archive block
    const configs = (await storage.getState('agentConfigs')) || {};
    const recentLogs = await storage.getLogs({ limit: 50 });
    const _rawDirectives = (await storage.getState('directives')) || [];
    const campaigns = (await storage.getState('campaigns')) || [];
    // Server-side migration: merge directives into campaigns (one-time)
    if (_rawDirectives.length > 0) {
      const _existingCmpIds = new Set(campaigns.map(c => c && c.id).filter(Boolean));
      let _migrated = 0;
      for (const _rd of _rawDirectives) {
        if (!_rd || !_rd.id || _existingCmpIds.has(_rd.id)) continue;
        let _st = String(_rd.status || 'active').toLowerCase();
        if (_st === 'completed') _st = 'complete';
        if (_st === 'pending-approval') _st = 'active';
        _rd.status = _st;
        _rd._migratedFromDirective = true;
        if (!_rd.createdAt) _rd.createdAt = _rd.createdDate || new Date().toISOString();
        if (!_rd.updatedAt) _rd.updatedAt = _rd.createdAt;
        campaigns.push(_rd);
        _migrated++;
      }
      if (_migrated > 0) {
        context.log('[Heartbeat] Migrated ' + _migrated + ' directives into campaigns');
      }
    }
    const directives = campaigns; // backward compat alias
    const objectives = (await storage.getState('objectives')) || [];
    const _documentsAtLoad = (await storage.getState('documents')) || [];
    const _documentIdsAtLoad = new Set(_documentsAtLoad.map(function (d) { return d && d.id; }).filter(Boolean));
    let campaignsChanged = false;
    let tasksCampaignChanged = false;
    const campaignGovEvents = [];
    let autoFixCount = 0;
    let createdCampaignAutoCount = 0;
    const _guardrailCounts = {
      orphanBlocked: 0,
      exactDupBlocked: 0,
      fuzzyDupBlocked: 0,
      taskCeilingBlocked: 0,
      socialPromoGateBlocked: 0,
      ceoApprovalsTriggered: 0,
      pausedCampaignAutomationBlocked: 0
    };
    const _campaignsTouched = new Set();
    const _tasksTouched = new Set();
    const _agentRunStats = {};
    let _entityCommentCalls = 0;
    async function _commentForEntity(kind, opts) {
      opts = opts || {};
      if (_entityCommentCalls >= MAX_ENTITY_COMMENT_CALLS_PER_RUN) {
        return _sanitizeSingleComment('', opts.fallbackText || 'I created this item to keep execution aligned.');
      }
      _entityCommentCalls++;
      return generateConversationalEntityComment(kind, opts);
    }

    for (const c of campaigns) {
      if (!c || typeof c !== 'object') continue;
      if (!c.id) { c.id = 'cmp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6); campaignsChanged = true; autoFixCount++; _campaignsTouched.add(c.id); }
      if (!c.status) { c.status = 'active'; campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      if (!c.createdAt) { c.createdAt = new Date().toISOString(); campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      if (!c.updatedAt) { c.updatedAt = c.createdAt; campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      if (!c.title) { c.title = 'Untitled Campaign'; campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
      if (c.description === undefined || c.description === null) { c.description = ''; campaignsChanged = true; autoFixCount++; if (c.id) _campaignsTouched.add(c.id); }
    }

    // Normalize objective linking: linkedDirective/linkedDirectives → linkedCampaigns
    for (const _normObj of objectives) {
      if (!_normObj) continue;
      if (!Array.isArray(_normObj.linkedCampaigns)) {
        if (Array.isArray(_normObj.linkedDirectives)) {
          _normObj.linkedCampaigns = _normObj.linkedDirectives;
        } else if (_normObj.linkedDirective) {
          _normObj.linkedCampaigns = [_normObj.linkedDirective];
        } else {
          _normObj.linkedCampaigns = [];
        }
      }
      _normObj.linkedDirectives = _normObj.linkedCampaigns; // backward compat alias
      autoFixCount++;
    }

    // ── Goal → auto-create Campaign for goals with no linked campaigns ──
    let objectivesChanged = false;
    for (const _goalObj of objectives) {
      if (!_goalObj || !_goalObj.id) continue;
      const _goalStatus = String(_goalObj.status || '').toLowerCase();
      if (_goalStatus === 'complete' || _goalStatus === 'canceled') continue;

      const _goalCmpIds = Array.isArray(_goalObj.linkedCampaigns) ? _goalObj.linkedCampaigns : [];
      const _hasActiveCampaign = _goalCmpIds.some(function (cmpId) {
        const cmp = campaigns.find(function (c) { return c && c.id === cmpId && !c.deletedAt; });
        return cmp && String(cmp.status || '').toLowerCase() !== 'archived';
      });
      if (_hasActiveCampaign) continue;

      const _newCmpId = 'cmp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const _goalDescBase = String(_goalObj.description || '').trim();
      const _goalContextLine = await _commentForEntity('campaign', {
        agentId: 'nova',
        title: (_goalObj.quarter ? '[Q' + _goalObj.quarter + '] ' : '') + (_goalObj.title || 'Untitled Campaign'),
        goalTitle: _goalObj.title || _goalObj.id,
        goalId: _goalObj.id,
        seedText: _goalDescBase,
        fallbackText: 'I created this campaign from the goal "' + (_goalObj.title || _goalObj.id) + '" so the team has a clear execution container.'
      });
      const _newCmp = {
        id: _newCmpId,
        title: (_goalObj.quarter ? '[Q' + _goalObj.quarter + '] ' : '') + (_goalObj.title || 'Untitled Campaign'),
        description: _goalContextLine,
        status: 'active',
        priority: _goalObj.priority || 'medium',
        objective_id: _goalObj.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        provenance: 'Auto: Goal → Campaign'
      };
      campaigns.push(_newCmp);
      createdCampaignAutoCount++;
      _campaignsTouched.add(_newCmpId);
      campaignsChanged = true;

      if (!Array.isArray(_goalObj.linkedCampaigns)) _goalObj.linkedCampaigns = [];
      _goalObj.linkedCampaigns.push(_newCmpId);
      _goalObj.linkedDirectives = _goalObj.linkedCampaigns;
      objectivesChanged = true;

      context.log('[Heartbeat] Auto-created Campaign "' + _newCmp.title + '" (' + _newCmpId + ') for Goal "' + (_goalObj.title || _goalObj.id) + '" (' + _goalObj.id + ')');
      await logEvent('goal-auto-campaign', null, 'Auto-created campaign for goal', runId, {
        runId, objectiveId: _goalObj.id, objectiveTitle: _goalObj.title, campaignId: _newCmpId, campaignTitle: _newCmp.title
      });
    }
    if (objectivesChanged) {
      await storage.setState('objectives', objectives);
      context.log('[Heartbeat] Pushed updated objectives after goal→campaign auto-creation');
    }

    // Build campaignById map for O(1) lookups in freeze gates
    const campaignById = {};
    for (const _c of campaigns) { if (_c && _c.id) campaignById[_c.id] = _c; }

    // Ensure tasks have campaign_id (normalize directive_id → campaign_id, then auto-match)
    for (const t of tasks) {
      if (!t) continue;
      normalizeCampaignRef(t);
      if (t.campaign_id) continue;

      const _tResult = await ensureCampaign({
        campaign_id: t.campaign_id,
        title: t.title || '',
        description: t.description || '',
        goalId: t.objective_id || null,
        division: t.division || null,
        provenance: 'Auto: Campaign ' + (t.assignee || 'nova'),
        campaigns: campaigns,
        entrypoint: 'heartbeat_task',
        debug: true,
        logger: context.log
      });
      t.campaign_id = _tResult.campaignId;
      if (_tResult.created) {
        _tResult.campaign.description = await _commentForEntity('campaign', {
          agentId: t.assignee || 'nova',
          title: _tResult.campaign.title || t.title || 'Campaign',
          goalId: t.objective_id || null,
          seedText: t.description || '',
          fallbackText: 'I created this campaign to group related work and keep planning/execution aligned under one objective.'
        });
        _tResult.campaign.updatedAt = new Date().toISOString();
        campaignsChanged = true;
        _campaignsTouched.add(_tResult.campaignId);
        campaignGovEvents.push({
          id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          type: 'campaign-created',
          data: { campaignId: _tResult.campaignId, title: _tResult.campaign.title, provenance: _tResult.campaign.provenance || null, source: 'task_auto_attach' },
          timestamp: new Date().toISOString()
        });
      }
      t.updatedAt = new Date().toISOString();
      tasksCampaignChanged = true;
      autoFixCount++;
      if (t.id) _tasksTouched.add(t.id);
    }

    // Auto-complete campaigns where ALL linked tasks are done
    for (const c of campaigns) {
      if (!c || c.deletedAt || String(c.status || '').toLowerCase() !== 'active') continue;
      const cmpTasks = tasks.filter(function (t) { return t && t.campaign_id === c.id; });
      if (cmpTasks.length === 0) continue;
      const allDone = cmpTasks.every(function (t) {
        const s = String(t.status || '').toLowerCase();
        return s === 'done' || s === 'archived';
      });
      if (!allDone) continue;
      c.status = 'complete';
      c.updatedAt = new Date().toISOString();
      campaignsChanged = true;
      autoFixCount++;
      if (c.id) _campaignsTouched.add(c.id);
      campaignGovEvents.push({
        id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        type: 'campaign_auto_complete',
        data: { campaignId: c.id, title: c.title, taskCount: cmpTasks.length },
        timestamp: new Date().toISOString()
      });
    }
    const documents = (await storage.getState('documents')) || [];
    const workspaceMemory = (await storage.getState('workspaceMemory')) || [];
    const workspaceDates = (await storage.getState('dates')) || [];
    const allActions = (await storage.getState('actions')) || [];
    const socialMetricsEvents = (await storage.getState('socialMetricsEvents')) || [];
    const socialEngagementSnapshots = (await storage.getState('socialEngagementSnapshots')) || [];
    const socialEngagementMeta = (await storage.getState('socialEngagementMeta')) || {};
    const runtimeMemory = (await storage.getState('runtimeMemory')) || {};
    const socialAccountStats = (await storage.getState('socialAccountStats')) || null;
    const socialIntel = _socialIntelBuildDigest(
      runtimeMemory && runtimeMemory.socialIntel,
      socialMetricsEvents,
      socialEngagementSnapshots,
      socialEngagementMeta,
      Date.now(),
      socialAccountStats
    );
    runtimeMemory.socialIntel = socialIntel;
    const revisionActions = allActions.filter(a => a.approval && a.approval.status === 'revision_requested');
    // Load persistent agent memories
    _agentMemoryStore = (await storage.getState('agentMemories')) || {};
    // Load CEO-curated seed memories (markdown per agent + global)
    const _seedMemories = (await storage.getState('agentSeedMemories')) || {};
    // Load persistent research intelligence store (survives beyond task completion)
    let researchIntelStore = (await storage.getState('researchIntel')) || [];
    // Load worker reports (client-side workers sync intel here for Nova to read)
    let workerReports = [];
    try { workerReports = (await storage.getState('workerReports')) || []; } catch (_wrErr) { /* non-fatal */ }
    // Fetch cost data for Cipher (CFO) awareness
    let costIntel = null;
    try {
      const geminiCosts = await storage.getGeminiCostSummary(30);
      costIntel = { gemini: geminiCosts };
    } catch (e) { context.log('[Heartbeat] Cost data fetch failed:', e.message); }

    // Fetch site intelligence: real telemetry, social metrics, deployment config
    let siteIntel = null;
    try {
      siteIntel = await _fetchSiteIntel(context, storage);
      const _siParts = [];
      if (siteIntel.telemetry) _siParts.push('telemetry');
      if (siteIntel.socialMetrics) _siParts.push('social');
      if (siteIntel.deployConfig) _siParts.push('deploy');
      if (_siParts.length > 0) context.log('[Heartbeat] Site intel loaded:', _siParts.join(', '));
    } catch (siErr) {
      context.log('[Heartbeat] Site intel fetch failed (non-fatal):', siErr.message);
      siteIntel = null;
    }

    // v2.3: Exclude pending-approval items from heartbeat processing
    const pendingTasks = tasks.filter(t => t.status === 'pending-approval');
    const pendingCmps = campaigns.filter(c => c.status === 'pending-approval');
    if (pendingTasks.length > 0 || pendingCmps.length > 0) {
      context.log('[Heartbeat] Pending approval items detected: ' + pendingTasks.length + ' tasks, ' + pendingCmps.length + ' campaigns — skipping until approved.');
    }
    const activeCampaigns = campaigns.filter(c => c.status === 'active' && !c.deletedAt);
    const activeDirectives = activeCampaigns; // backward compat alias
    const activeObjectives = objectives.filter(o => o.status && o.status !== 'complete' && o.status !== 'canceled');
    const normalizedActivationMode = await resolveActivationMode(storage, runId);

    // Load execution_mode (GridOS automation posture)
    const _rawExecMode = await storage.getState('execution_mode');
    const executionMode = normalizeExecutionMode(_rawExecMode);

    await logEvent('mode-resolved', null, 'Activation mode resolved: ' + normalizedActivationMode + ', execution_mode: ' + executionMode, runId, {
      runId: runId, activationMode: normalizedActivationMode, executionMode: executionMode
    });

    // Frozen: block all automation, exit early
    if (executionMode === 'frozen') {
      await logEvent('run-health', null, 'Heartbeat blocked: execution_mode frozen', runId, {
        runId: runId, mode: executionMode, channel: 'heartbeat', result: 'blocked', reason: 'execution_mode_frozen'
      });
      context.log('[Heartbeat] execution_mode=frozen — automation locked, exiting early');
      return;
    }

    // Compute effective rate caps (Phase 1F: experimental mode gets 1.5x)
    const _capMultiplier = normalizedActivationMode === 'experimental' ? 1.5 : 1;
    const _effectiveCaps = {
      maxCreatesPerAgentPerRun: Math.floor(CAP_DEFAULTS.maxCreatesPerAgentPerRun * _capMultiplier),
      maxMovesPerAgentPerRun: Math.floor(CAP_DEFAULTS.maxMovesPerAgentPerRun * _capMultiplier),
      maxUpdatesPerAgentPerRun: Math.floor(CAP_DEFAULTS.maxUpdatesPerAgentPerRun * _capMultiplier),
      maxProposalsPerAgentPerRun: Math.floor(CAP_DEFAULTS.maxProposalsPerAgentPerRun * _capMultiplier)
    };

    await logEvent('run-start', null, 'Heartbeat run start', runId, {
      runId: runId,
      mode: normalizedActivationMode,
      taskCount: tasks.length,
      agentCount: AGENT_IDS.length
    });

    // ── Per-day memory write counter (Phase 1E) ──
    const _memoryWriteCounters = {}; // keyed by agentId+YYYY-MM-DD
    const _todayKey = new Date().toISOString().substring(0, 10);
    function _getMemWriteCount(aid) {
      return _memoryWriteCounters[aid + ':' + _todayKey] || 0;
    }
    function _incMemWrite(aid) {
      var k = aid + ':' + _todayKey;
      _memoryWriteCounters[k] = (_memoryWriteCounters[k] || 0) + 1;
    }

    // ── Per-run counters (Phase 1C) ──
    const _runCounters = {
      runId: runId,
      mode: normalizedActivationMode,
      totals: { creates: 0, moves: 0, updates: 0, blocked: 0, proposals: 0 },
      byAgent: {}
    };
    function _ensureAgentCounters(aid) {
      if (!_runCounters.byAgent[aid]) _runCounters.byAgent[aid] = { creates: 0, moves: 0, updates: 0, blocked: 0, proposals: 0 };
    }
    function _incBlocked(aid) {
      _ensureAgentCounters(aid);
      _runCounters.totals.blocked++;
      _runCounters.byAgent[aid].blocked++;
    }
    function _incProposal(aid) {
      _ensureAgentCounters(aid);
      _runCounters.totals.proposals++;
      _runCounters.byAgent[aid].proposals++;
    }
    function _canAddProposal(aid) {
      _ensureAgentCounters(aid);
      return _runCounters.byAgent[aid].proposals < _effectiveCaps.maxProposalsPerAgentPerRun;
    }

    const _runGateCounts = {
      output_envelope: 0,
      proposal_schema: 0,
      objective_status: 0,
      observation_clamp: 0,
      project_status: 0
    };
    const _objectiveStatusBlockDetails = [];
    const _projectStatusBlockDetails = [];
    function _incPolicyGate(gate) {
      if (Object.prototype.hasOwnProperty.call(_runGateCounts, gate)) {
        _runGateCounts[gate]++;
      }
    }

    // Cooldown is per-run only (non-persistent): after repeated violations, force proposals-only path.
    const _cooldownLogged = new Set();
    function _isAgentInCooldown(aid) {
      return (_runCounters?.byAgent?.[aid]?.blocked || 0) >= AGENT_COOLDOWN_VIOLATIONS_PER_RUN;
    }
    async function _logAgentCooldownOnce(aid) {
      if (_cooldownLogged.has(aid)) return;
      _cooldownLogged.add(aid);
      await logEvent('policy-violation', aid, 'Agent forced into proposals-only cooldown for this run', runId, {
        runId: runId,
        agentId: aid,
        gate: 'agent_cooldown',
        reason: 'violations_in_run',
        violations: (_runCounters?.byAgent?.[aid]?.blocked || 0)
      });
    }

    // ── Backfill: re-resolve hero image URLs for pending publish AQ entries ──
    // Covers the case where Scribe submitted before Pixel generated the image
    try {
      const _aqBackfill = (await storage.getState('approvalQueue')) || [];
      let _aqChanged = false;
      for (let _bfi = 0; _bfi < _aqBackfill.length; _bfi++) {
        const _bfItem = _aqBackfill[_bfi];
        if (_bfItem.status !== 'pending') continue;
        if (_bfItem.actionType !== 'publish_document') continue;
        if (_bfItem.heroImageUrl) continue; // already resolved
        const _bfAssetId = _bfItem.heroImageAssetId || null;
        if (!_bfAssetId) {
          // Check the document store for a newly attached hero_image_asset_id
          if (_bfItem.documentId) {
            const _bfDoc = documents.find(d => d.id === _bfItem.documentId);
            if (_bfDoc && _bfDoc.hero_image_asset_id) {
              _bfItem.heroImageAssetId = _bfDoc.hero_image_asset_id;
            }
          }
        }
        if (_bfItem.heroImageAssetId) {
          const _bfImgAssets = (await storage.getState('imageAssets')) || [];
          const _bfAsset = _bfImgAssets.find(a => a.id === _bfItem.heroImageAssetId);
          if (_bfAsset && _bfAsset.url) {
            _bfItem.heroImageUrl = _bfAsset.url;
            _aqChanged = true;
            // Also backfill the action payload
            const _bfActIdx = allActions.findIndex(a => a.id === _bfItem.action_id);
            if (_bfActIdx !== -1 && allActions[_bfActIdx].payload) {
              allActions[_bfActIdx].payload.hero_image_url = _bfAsset.url;
              allActions[_bfActIdx].payload.hero_image_asset_id = _bfItem.heroImageAssetId;
            }
            context.log('[Heartbeat] Backfilled hero image for AQ entry:', _bfItem.id, '→', _bfAsset.url);
          }
        }
      }
      if (_aqChanged) {
        await storage.setState('approvalQueue', _aqBackfill);
        await storage.setState('actions', allActions);
      }
    } catch (_bfErr) { context.log.warn('[Heartbeat] Hero image backfill failed (non-fatal):', _bfErr.message); }

    // ── RECONCILIATION: Notify Scribe tasks when hero image is ready but comment was missed ──
    try {
      let _heroNotifyChanged = false;
      const _heroReadyDocs = documents.filter(d => d && d.hero_image_asset_id && !d.awaiting_hero_image && d.kind === 'marketing_post');
      for (const _hrd of _heroReadyDocs) {
        // Find active Scribe task referencing this document
        const _hrdOriginTask = tasks.find(t =>
          t.assignee === 'scribe' && t.status !== 'done' && t.status !== 'archived' &&
          t.comments && t.comments.some(c => c.text && c.text.indexOf(_hrd.id) !== -1)
        );
        if (!_hrdOriginTask) continue;
        // Check if already notified
        const _hrdAlreadyNotified = _hrdOriginTask.comments.some(c =>
          c.text && c.text.indexOf('You can now submit this document for publish') !== -1
        );
        if (_hrdAlreadyNotified) continue;
        // Check if publish action already exists (no need to notify)
        const _hrdHasPublish = allActions.some(a =>
          a.type === 'publish_document' && a.payload && a.payload.documentId === _hrd.id
        );
        if (_hrdHasPublish) continue;
        // Add notification comment
        if (!_hrdOriginTask.comments) _hrdOriginTask.comments = [];
        _hrdOriginTask.comments.push({
          id: 'cmt-hero-ready-recon-' + Date.now(),
          author: 'system',
          text: 'Hero image generated and attached to document ' + _hrd.id + ' (asset: ' + _hrd.hero_image_asset_id + '). You can now submit this document for publish using submit-for-publish with documentId: ' + _hrd.id,
          type: 'system',
          createdAt: new Date().toISOString()
        });
        _heroNotifyChanged = true;
        context.log('[Heartbeat] RECONCILIATION: notified Scribe task', _hrdOriginTask.id, 'that hero image is ready for doc:', _hrd.id);
      }
      if (_heroNotifyChanged) {
        await storage.setState('tasks', tasks);
      }
    } catch (_hnErr) { context.log.warn('[Heartbeat] Hero notify reconciliation failed (non-fatal):', _hnErr.message); }

    // Dedupe check: get recent log summaries to avoid repeats
    const recentSummaries = new Set();
    const dedupeAfter = Date.now() - GUARDRAILS.dedupeWindowMs;
    recentLogs.forEach(function (l) {
      if (new Date(l.timestamp).getTime() > dedupeAfter && l.summary) {
        recentSummaries.add(l.summary);
      }
    });

    // ── Evaluate escalation paths for all active tasks ──
    const now = Date.now();
    const escalationLog = [];
    const novaSkipTaskIds = new Set();

    const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'backlog' && t.status !== 'pending-approval');
    for (const task of activeTasks) {
      const esc = evaluateEscalationPath(task, now);
      if (esc.handler !== 'owner' && esc.handler !== 'normal_flow') {
        escalationLog.push({
          taskId: task.id,
          taskTitle: task.title,
          priority: task.priority,
          dueDate: task.dueDate,
          handler: esc.handler,
          domainLead: esc.domainLead,
          reason: esc.reason,
          novaSkip: esc.novaSkip
        });
      }
      if (esc.novaSkip) {
        novaSkipTaskIds.add(task.id);
        context.log('[Heartbeat] Escalation:', task.title,
          '→ Owner →', esc.domainLead, '| Nova skipped (' + esc.reason + ')');
      }
    }

    // ── Goal cancel → cascade pause to linked Campaigns ──
    let _campaignsCascadePushed = false;
    for (const _obj of objectives) {
      if (!_obj || !_obj.id) continue;
      if (String(_obj.status || '').toLowerCase() !== 'canceled') continue;
      const linkedCmpIds = Array.isArray(_obj.linkedCampaigns) ? _obj.linkedCampaigns : (Array.isArray(_obj.linkedDirectives) ? _obj.linkedDirectives : []);
      for (const cmpId of linkedCmpIds) {
        const cmp = campaigns.find(c => c && c.id === cmpId);
        if (cmp && String(cmp.status || '').toLowerCase() === 'active') {
          cmp.status = 'paused';
          cmp.updatedAt = new Date().toISOString();
          cmp._pausedByGoalCancel = _obj.id;
          _campaignsCascadePushed = true;
          campaignsChanged = true;
          if (cmp.id) _campaignsTouched.add(cmp.id);
          context.log('[Heartbeat] Cascade: Goal canceled (' + _obj.id + ' "' + (_obj.title || '') + '") → paused linked Campaign (' + cmpId + ' "' + (cmp.title || '') + '")');
          await logEvent('goal-cancel-cascade', null, 'Campaign paused by goal cancel cascade', runId, {
            runId, objectiveId: _obj.id, objectiveTitle: _obj.title, campaignId: cmpId, campaignTitle: cmp.title
          });
        }
      }
    }
    if (_campaignsCascadePushed) {
      await storage.setState('campaigns', campaigns);
      context.log('[Heartbeat] Cascade: pushed updated campaigns to server after goal-cancel pause');
    }

    // ── Auto-archive tasks ──
    // 1) Immediate archive for tasks linked to canceled objectives.
    // 2) Done-task aging archive (>7 days old).
    const ARCHIVE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const ARCHIVE_MAX = 2000;
    const archiveNow = Date.now();
    const archive = (await storage.getState('tasksArchive')) || [];
    const archivedTaskIds = new Set(archive.map(function (t) { return t && t.id; }).filter(Boolean));
    const canceledObjectives = new Map();
    for (const _obj of objectives) {
      if (!_obj || !_obj.id) continue;
      if (String(_obj.status || '').toLowerCase() === 'canceled') {
        canceledObjectives.set(_obj.id, _obj);
      }
    }
    const canceledCampaigns = new Map();
    for (const _cmp of campaigns) {
      if (!_cmp || !_cmp.id) continue;
      if (String(_cmp.status || '').toLowerCase() === 'canceled') {
        canceledCampaigns.set(_cmp.id, _cmp);
      }
    }

    const canceledArchiveCounts = new Map();
    const toArchive = [];
    const keepTasks = [];
    for (const task of tasks) {
      // Canceled-campaign archive: archive tasks linked to canceled campaigns
      const campaignId = task && task.campaign_id ? task.campaign_id : null;
      if (campaignId && canceledCampaigns.has(campaignId)) {
        const campaign = canceledCampaigns.get(campaignId);
        const nowIso = new Date().toISOString();
        const archiveStamp = task.archivedAt || nowIso;
        const cancelComment = 'Auto-archived: Campaign canceled (campaignId=' + campaignId + ', title=' + (campaign.title || campaignId) + '). Execution blocked.';
        if (!task.comments) task.comments = [];
        const hasCancelComment = task.comments.some(function (c) {
          return c && c.author === 'system' && c.text === cancelComment;
        });
        if (!hasCancelComment) {
          task.comments.push({
            id: 'cmt-archive-campaign-canceled-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            author: 'system',
            text: cancelComment,
            type: 'system',
            createdAt: nowIso
          });
        }
        const lastComment = (task.comments && task.comments.length > 0) ? task.comments[task.comments.length - 1] : null;
        if (!archivedTaskIds.has(task.id)) {
          toArchive.push({
            id: task.id,
            title: task.title,
            description: (task.description || '').substring(0, 200),
            status: task.status,
            priority: task.priority,
            assignee: task.assignee,
            division: task.division || null,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
            source: task.source,
            commentCount: task.comments ? task.comments.length : 0,
            lastComment: lastComment ? { author: lastComment.author, text: (lastComment.text || '').substring(0, 150), createdAt: lastComment.createdAt } : null,
            archivedAt: archiveStamp,
            archivedReason: 'campaign_canceled',
            campaignId: campaignId,
            campaignTitle: campaign.title || null
          });
          archivedTaskIds.add(task.id);
          _taskIdsArchived.add(task.id);
          canceledArchiveCounts.set('cmp:' + campaignId, (canceledArchiveCounts.get('cmp:' + campaignId) || 0) + 1);
        }
        task._archived = true;
        task.updatedAt = new Date().toISOString();
        keepTasks.push(task);
        continue;
      }

      // Canceled-objective archive
      const objectiveId = task && task.objective_id ? task.objective_id : null;
      if (objectiveId && canceledObjectives.has(objectiveId)) {
        const objective = canceledObjectives.get(objectiveId);
        const nowIso = new Date().toISOString();
        const archiveStamp = task.archivedAt || nowIso;
        const cancelComment = 'Auto-archived: Objective canceled (objectiveId=' + objectiveId + ', title=' + (objective.title || objectiveId) + '). Execution blocked.';
        if (!task.comments) task.comments = [];
        const hasCancelComment = task.comments.some(function (c) {
          return c && c.author === 'system' && c.text === cancelComment;
        });
        if (!hasCancelComment) {
          task.comments.push({
            id: 'cmt-archive-objective-canceled-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            author: 'system',
            text: cancelComment,
            type: 'system',
            createdAt: nowIso
          });
        }
        const lastComment = (task.comments && task.comments.length > 0) ? task.comments[task.comments.length - 1] : null;

        if (!archivedTaskIds.has(task.id)) {
          toArchive.push({
            id: task.id,
            title: task.title,
            description: (task.description || '').substring(0, 200),
            status: task.status,
            priority: task.priority,
            assignee: task.assignee,
            division: task.division || null,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
            source: task.source,
            commentCount: task.comments ? task.comments.length : 0,
            lastComment: lastComment ? { author: lastComment.author, text: (lastComment.text || '').substring(0, 150), createdAt: lastComment.createdAt } : null,
            archivedAt: archiveStamp,
            archivedReason: 'objective_canceled',
            objectiveId: objectiveId,
            objectiveTitle: objective.title || null
          });
          archivedTaskIds.add(task.id);
          _taskIdsArchived.add(task.id);
          canceledArchiveCounts.set(objectiveId, (canceledArchiveCounts.get(objectiveId) || 0) + 1);
        }
        // Mark as archived and KEEP in active. Do NOT use `continue` to remove —
        // CompanyStore sync always re-adds items from localStorage that are missing
        // from server, causing infinite oscillation. Frontend filters _archived tasks.
        task._archived = true;
        task.updatedAt = new Date().toISOString();
        keepTasks.push(task);
        continue;
      }

      // Cleanup: agent hallucinated status 'archived' — fix to valid status.
      // Do NOT remove from active (continue) — CompanyStore sync re-adds from localStorage,
      // causing infinite oscillation. Instead, repair status in-place so the canceled-objective
      // or done-aged archive path handles it on subsequent runs.
      if (task.status === 'archived') {
        task.status = 'done';
        task.completedAt = task.completedAt || new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        context.log('[Heartbeat] Cleanup: task', task.id, 'had invalid status "archived" — repaired to "done"');
        // Fall through to normal archive checks below (done-aged, canceled-objective already handled above)
      }

      if (task.status === 'done') {
        const completedMs = task.completedAt ? new Date(task.completedAt).getTime() : 0;
        const updatedMs = task.updatedAt ? new Date(task.updatedAt).getTime() : 0;
        const doneAt = completedMs || updatedMs;
        if (doneAt && (archiveNow - doneAt) > ARCHIVE_AGE_MS && !archivedTaskIds.has(task.id)) {
          // Compact: strip full comments, keep summary
          const lastComment = (task.comments && task.comments.length > 0) ? task.comments[task.comments.length - 1] : null;
          toArchive.push({
            id: task.id,
            title: task.title,
            description: (task.description || '').substring(0, 200),
            status: 'done',
            priority: task.priority,
            assignee: task.assignee,
            division: task.division || null,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
            source: task.source,
            commentCount: task.comments ? task.comments.length : 0,
            lastComment: lastComment ? { author: lastComment.author, text: (lastComment.text || '').substring(0, 150), createdAt: lastComment.createdAt } : null,
            archivedAt: new Date().toISOString(),
            archivedReason: 'done_aged_7d'
          });
          archivedTaskIds.add(task.id);
          _taskIdsArchived.add(task.id);
          task._archived = true;
          task.updatedAt = new Date().toISOString();
          // Fall through to keepTasks — same anti-oscillation pattern
        }
      }
      keepTasks.push(task);
    }

    if (toArchive.length > 0) {
      archive.push(...toArchive);
      // Cap archive
      if (archive.length > ARCHIVE_MAX) archive.splice(0, archive.length - ARCHIVE_MAX);
      await storage.setState('tasksArchive', archive);
      // Replace tasks array in-place (agents use this reference)
      tasks.length = 0;
      tasks.push(...keepTasks);
      context.log('[Heartbeat] Archived', toArchive.length, 'task(s). Active tasks:', tasks.length);
    }

    if (canceledArchiveCounts.size > 0) {
      const byObjective = Array.from(canceledArchiveCounts.entries()).map(function (entry) {
        return { objectiveId: entry[0], count: entry[1] };
      });
      const totalCanceledArchived = byObjective.reduce(function (sum, item) { return sum + item.count; }, 0);
      const details = {
        runId: runId,
        reason: 'objective_canceled',
        count: totalCanceledArchived,
        byObjective: byObjective
      };
      if (byObjective.length === 1) {
        details.objectiveId = byObjective[0].objectiveId;
      }
      await logEvent('auto-archive', null, 'Auto-archived tasks for canceled objective(s)', runId, details);
    }

    // ── Fix 11c: Document cleanup — archive stale duplicate drafts ──
    // Runs once per heartbeat: archives draft/ready_for_approval docs older than 48h
    // that have near-duplicate titles (keeps the newest of each cluster)
    try {
      const _allDocs = (await storage.getState('documents')) || [];
      const _archivableDocs = _allDocs.filter(d =>
        (d.status === 'draft' || d.status === 'ready_for_approval') &&
        d.created_at && (Date.now() - new Date(d.created_at).getTime()) > 48 * 60 * 60 * 1000
      );
      if (_archivableDocs.length > 0) {
        // Group by fuzzy title — keep newest per cluster, archive the rest
        const _clusters = [];
        for (const doc of _archivableDocs) {
          const _dWords = (doc.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
          let matched = false;
          for (const cluster of _clusters) {
            const _cWords = cluster.words;
            if (_dWords.length >= 3 && _cWords.length >= 3) {
              const _overlap = _dWords.filter(w => _cWords.indexOf(w) !== -1).length;
              const _sim = _overlap / Math.max(_dWords.length, _cWords.length);
              if (_sim > 0.5) {
                cluster.docs.push(doc);
                matched = true;
                break;
              }
            }
          }
          if (!matched) _clusters.push({ words: _dWords, docs: [doc] });
        }
        let _archivedCount = 0;
        for (const cluster of _clusters) {
          if (cluster.docs.length <= 1) continue;
          // Sort newest first, archive all but the newest
          cluster.docs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          for (let ci = 1; ci < cluster.docs.length; ci++) {
            const _idx = _allDocs.findIndex(d => d.id === cluster.docs[ci].id);
            if (_idx !== -1) {
              _allDocs[_idx].status = 'archived';
              _allDocs[_idx].updated_at = new Date().toISOString();
              _allDocs[_idx]._archived_reason = 'duplicate_cleanup';
              _archivedCount++;
            }
          }
        }
        if (_archivedCount > 0) {
          await storage.setState('documents', _allDocs);
          context.log('[Heartbeat] Doc cleanup: archived', _archivedCount, 'stale duplicate draft(s) from', _clusters.length, 'title clusters');
        }
      }
    } catch (_docCleanErr) {
      context.log('[Heartbeat] Doc cleanup error (non-fatal):', String(_docCleanErr).substring(0, 200));
    }

    // ── Auto-triage CEO tasks ──
    // CEO-created tasks with assignee AND dueDate already set need no human triage.
    // Inject a system comment so the prompt-level triage gate is satisfied immediately.
    let autoTriageCount = 0;
    for (const task of tasks) {
      if (task.source === 'heartbeat') continue;          // agent-created — needs real triage
      if (task.status === 'done' || task.status === 'backlog') continue;
      if (!task.assignee || !task.dueDate) continue;      // incomplete — needs Nova triage
      const hasTriageStamp = task.comments && task.comments.some(
        c => c.author === 'nova' || c.author === 'system'
      );
      if (hasTriageStamp) continue;                        // already triaged
      // Inject auto-triage stamp
      if (!task.comments) task.comments = [];
      task.comments.push({
        id: 'cmt-autotriage-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        author: 'system',
        text: 'Auto-triaged: CEO-assigned task with assignee (' + task.assignee + ') and due date (' + task.dueDate.substring(0, 10) + ') preset. Ready for execution.',
        type: 'system',
        createdAt: new Date().toISOString()
      });
      task.updatedAt = new Date().toISOString();
      autoTriageCount++;
    }
    if (autoTriageCount > 0) {
      context.log('[Heartbeat] Auto-triaged', autoTriageCount, 'CEO task(s) with assignee+dueDate');
    }

    // Review cooldown: track tasks that enter review THIS cycle — cannot be reviewed in same cycle
    const _reviewCooldownIds = new Set();
    const _agentCampaignCtx = {
      campaignById: campaignById,
      campaigns: campaigns,
      campaignGovEvents: campaignGovEvents,
      campaignsChanged: false
    };

    // Process each agent
    for (const agentId of AGENT_IDS) {
      if (geminiCalls >= GUARDRAILS.maxGeminiCallsPerCycle) {
        context.log('[Heartbeat] Max Gemini calls reached, stopping');
        break;
      }

      const agentConfig = configs[agentId] || {};
      const heartbeat = agentConfig.heartbeat || { enabled: true };

      // Skip if agent heartbeat is disabled
      if (heartbeat.enabled === false) {
        context.log('[Heartbeat] Agent', agentId, 'heartbeat disabled, skipping');
        continue;
      }

      // Tier 4 sub-agent gating: only run if they have active tasks or recent @mentions
      if (TIER4_SUB_AGENTS.has(agentId)) {
        const gate = shouldRunTier4Agent(tasks, agentId);
        if (!gate.run) {
          context.log('[Heartbeat] Skipping Tier4 sub-agent', agentId + ':', gate.reason);
          skippedAgents.push({ agentId: agentId, reason: gate.reason });
          continue;
        }
        context.log('[Heartbeat] Tier4 sub-agent', agentId, 'triggered:', gate.reason);
      }

      agentActions[agentId] = 0;

      try {
        const result = await runAgentHeartbeat(
          context, agentId, tasks, configs, recentSummaries, cycleId,
          agentId === 'nova' ? novaSkipTaskIds : null,
          activeDirectives, activeObjectives, documents,
          workspaceMemory, workspaceDates, revisionActions,
          agentId === 'cipher' ? costIntel : null,
          _reviewCooldownIds, _seedMemories, researchIntelStore, socialIntel,
          normalizedActivationMode, _isAgentInCooldown, _logAgentCooldownOnce, _incPolicyGate,
          _agentCampaignCtx, siteIntel,
          agentId === 'nova' ? workerReports : null
        );
        // Collect any new research intel from this agent's cycle
        if (result.newResearchIntel) {
          researchIntelStore.push(result.newResearchIntel);
          if (researchIntelStore.length > MAX_RESEARCH_STORE_ENTRIES) {
            researchIntelStore = researchIntelStore.slice(-MAX_RESEARCH_STORE_ENTRIES);
          }
        }
        geminiCalls += result.geminiCalls;
        agentActions[agentId] = result.actions;
        _agentRunStats[agentId] = {
          attempted: result.actionAttempts || 0,
          executed: result.actions || 0,
          blocked: 0,
          newTasksCreated: 0,
          avgLatencyMs: result.durationMs || 0,
          guardrailBlocked: ((result.guardrails && result.guardrails.orphanBlocked) || 0)
            + ((result.guardrails && result.guardrails.exactDupBlocked) || 0)
            + ((result.guardrails && result.guardrails.fuzzyDupBlocked) || 0)
            + ((result.guardrails && result.guardrails.taskCeilingBlocked) || 0)
            + ((result.guardrails && result.guardrails.socialPromoGateBlocked) || 0)
        };
        if (result.guardrails) {
          _guardrailCounts.orphanBlocked += result.guardrails.orphanBlocked || 0;
          _guardrailCounts.exactDupBlocked += result.guardrails.exactDupBlocked || 0;
          _guardrailCounts.fuzzyDupBlocked += result.guardrails.fuzzyDupBlocked || 0;
          _guardrailCounts.taskCeilingBlocked += result.guardrails.taskCeilingBlocked || 0;
          _guardrailCounts.socialPromoGateBlocked += result.guardrails.socialPromoGateBlocked || 0;
        }
        if (_agentCampaignCtx.campaignsChanged) {
          campaignsChanged = true;
          _agentCampaignCtx.campaignsChanged = false;
        }

        // Observe mode: discard taskUpdates before mutation stage
        if (executionMode === 'observe' && result.taskUpdates && result.taskUpdates.length > 0) {
          const _observeBlocked = result.taskUpdates.length;
          context.log('[Heartbeat]', agentId, 'observe mode — discarding', _observeBlocked, 'taskUpdates');
          result.taskUpdates = [];
          _incBlocked(agentId);
          await logEvent('run-digest', agentId, 'Observe mode: taskUpdates discarded', runId, {
            mode: executionMode, channel: 'heartbeat', agentId: agentId,
            taskUpdatesBlocked: _observeBlocked, taskUpdatesApplied: 0,
            proposalsCount: (result.proposals || []).length,
            observationsCount: (result.observations || []).length,
            rememberCount: (result.remember || []).length
          });
        }

        // Apply task mutations
        if (result.taskUpdates && result.taskUpdates.length > 0) {
          for (const update of result.taskUpdates) {
            if (newTasksCreated >= GUARDRAILS.maxNewTasksPerCycle && update.action === 'create') {
              context.log('[Heartbeat] Max new tasks reached, skipping create');
              continue;
            }
            // Review cooldown: block reviews on tasks that entered review this cycle
            if (update.action === 'review' && update.taskId && _reviewCooldownIds.has(update.taskId)) {
              context.log('[Heartbeat]', agentId, 'BLOCKED review on', update.taskId, '— task just entered review this cycle (cooldown)');
              continue;
            }
            const mutationAction = update.action;
            const isTaskMutation = mutationAction === 'create' || mutationAction === 'move' || mutationAction === 'update';

            // Per-run cooldown: once threshold is reached, suppress further task mutations for this agent.
            if (isTaskMutation && _isAgentInCooldown(agentId)) {
              await _logAgentCooldownOnce(agentId);
              continue;
            }

            if (isTaskMutation) {
              if (!result.proposals) result.proposals = [];

              // Manual mode gate: proposal-only, no direct task mutations
              if (normalizedActivationMode === 'manual') {
                _incBlocked(agentId);
                const _modeTask = mutationAction === 'create'
                  ? { id: null, title: (update.task && update.task.title) || 'Untitled', category: (update.task && update.task.category) || null, objective_id: (update.task && update.task.objective_id) || null }
                  : tasks.find(t => t.id === update.taskId);
                if (_canAddProposal(agentId)) {
                  const modeProposal = _normalizeProposal(_buildBlockedProposal(agentId, runId, 'mode_gate', mutationAction === 'create' ? 'create_task' : 'move_task', {
                    title: (_modeTask && _modeTask.title) || (update.task && update.task.title) || null,
                    category: (_modeTask && _modeTask.category) || (update.task && update.task.category) || null,
                    objective_id: (_modeTask && _modeTask.objective_id) || (update.task && update.task.objective_id) || null,
                    objective_suggestion: 'Switch to supervised_autonomous or assign an objective to proceed.',
                    evidence: {
                      blockedAction: mutationAction,
                      taskId: update.taskId || null,
                      mode: normalizedActivationMode
                    }
                  }));
                  if (_isValidProposal(modeProposal)) {
                    result.proposals.push(modeProposal);
                    _incProposal(agentId);
                  } else {
                    _incPolicyGate('proposal_schema');
                    await logEvent('policy-violation', agentId, 'Invalid proposal rejected', runId, { gate: 'proposal_schema', reason: 'invalid_proposal', proposedAction: mutationAction });
                  }
                }
                await logEvent('policy-violation', agentId, 'Task mutation blocked by activation mode', runId, {
                  runId: runId,
                  agentId: agentId,
                  gate: 'mode_gate',
                  action: mutationAction,
                  reason: 'activationMode=manual blocks task mutations',
                  taskId: update.taskId || null,
                  category: (_modeTask && _modeTask.category) || (update.task && update.task.category) || null
                });
                continue;
              }

              // Objective gate: require objective_id for create and transitions into start-work statuses unless exempt category
              let requiresObjective = false;
              let targetTask = null;
              if (mutationAction === 'create') {
                requiresObjective = true;
              } else if (mutationAction === 'move') {
                targetTask = tasks.find(t => t.id === update.taskId);
                const oldStatus = targetTask ? targetTask.status : null;
                if (_isStartWorkStatus(update.newStatus) && !_isStartWorkStatus(oldStatus)) {
                  requiresObjective = true;
                }
              } else if (mutationAction === 'update') {
                targetTask = tasks.find(t => t.id === update.taskId);
                const oldStatus = targetTask ? targetTask.status : null;
                const nextStatus = update.updates ? update.updates.status : null;
                if (_isStartWorkStatus(nextStatus) && !_isStartWorkStatus(oldStatus)) {
                  requiresObjective = true;
                }
              }

              if (requiresObjective) {
                const gateTask = mutationAction === 'create' ? (update.task || {}) : (targetTask || {});
                const category = _normalizeCategory(gateTask.category || gateTask.task_category || null);
                const objectiveId = mutationAction === 'create'
                  ? (update.task && update.task.objective_id)
                  : ((update.updates && update.updates.objective_id) || gateTask.objective_id || null);
                if (!_isObjectiveExemptCategory(category) && !objectiveId) {
                  const gateProposal = _buildBlockedProposal(agentId, runId, 'objective_gate', mutationAction === 'create' ? 'create_task' : 'move_task', {
                    title: gateTask.title || (update.task && update.task.title) || null,
                    category: category || null,
                    objective_id: null,
                    objective_suggestion: 'Assign an objective before this task can proceed.',
                    acceptanceCriteria: ['Link task to an active objective.'],
                    evidence: {
                      blockedAction: mutationAction,
                      taskId: update.taskId || null,
                      targetStatus: update.newStatus || (update.updates && update.updates.status) || null
                    }
                  });
                  _incBlocked(agentId);
                  if (_canAddProposal(agentId)) {
                    const _normalizedObjProposal = _normalizeProposal(gateProposal);
                    if (_isValidProposal(_normalizedObjProposal)) {
                      result.proposals.push(_normalizedObjProposal);
                      _incProposal(agentId);
                    } else {
                      _incPolicyGate('proposal_schema');
                      await logEvent('policy-violation', agentId, 'Invalid proposal rejected', runId, { gate: 'proposal_schema', reason: 'invalid_proposal', proposedAction: mutationAction });
                    }
                  }
                  await logEvent('policy-violation', agentId, 'Task mutation blocked by objective gate', runId, {
                    runId: runId,
                    agentId: agentId,
                    gate: 'objective_gate',
                    action: mutationAction,
                    reason: 'objective_id required for task write',
                    taskId: update.taskId || null,
                    category: category || null
                  });
                  continue;
                }
              }

              // Objective status gate: move/update transitions into start-work statuses require active objective
              if (mutationAction === 'move' || mutationAction === 'update') {
                const oldStatus = targetTask ? targetTask.status : null;
                const nextStatus = mutationAction === 'move'
                  ? update.newStatus
                  : (update.updates ? update.updates.status : null);
                const entersStartWork = _isStartWorkStatus(nextStatus) && !_isStartWorkStatus(oldStatus);

                if (entersStartWork) {
                  const objectiveIdOnTask = targetTask ? (targetTask.objective_id || null) : null;
                  const linkedObjective = objectiveIdOnTask
                    ? objectives.find(o => o.id === objectiveIdOnTask)
                    : null;
                  const objectiveStatus = linkedObjective ? String(linkedObjective.status || '').toLowerCase() : null;
                  const _terminalObjStatuses = ['complete', 'completed', 'canceled'];
                  const missingOrNotActive = !linkedObjective || _terminalObjStatuses.indexOf(objectiveStatus) !== -1;

                  if (missingOrNotActive) {
                    _incBlocked(agentId);
                    const objectiveBlockReason = objectiveStatus === 'complete'
                      ? 'objective_completed'
                      : objectiveStatus === 'canceled'
                        ? 'objective_canceled'
                        : 'objective_missing_or_not_active';

                    if (_canAddProposal(agentId)) {
                      const suggestedFix = linkedObjective
                        ? 'activate objective'
                        : 'reassign objective';
                      const statusProposal = _normalizeProposal({
                        type: 'proposal',
                        agentId: agentId,
                        runId: runId,
                        reasonBlocked: 'objective_status',
                        proposedAction: 'move_task',
                        payload: {
                          title: 'Task blocked: objective must be active before entering in-progress',
                          category: 'governance',
                          objective_id: objectiveIdOnTask,
                          taskId: update.taskId || null,
                          suggestedFix: suggestedFix,
                          objective_suggestion: suggestedFix === 'activate objective'
                            ? 'Activate objective before moving task to in-progress.'
                            : 'Reassign task to an active objective before moving to in-progress.',
                          acceptanceCriteria: ['Objective exists and has status active before task enters in-progress.'],
                          evidence: {
                            runId: runId,
                            gate: 'objective_status',
                            blockedAction: mutationAction,
                            taskId: update.taskId || null,
                            objective_id: objectiveIdOnTask,
                            objective_status: objectiveStatus || 'missing',
                            reason: objectiveBlockReason
                          }
                        }
                      });
                      if (_isValidProposal(statusProposal)) {
                        result.proposals.push(statusProposal);
                        _incProposal(agentId);
                      }
                    }

                    _incPolicyGate('objective_status');
                    if (objectiveBlockReason === 'objective_canceled') {
                      _objectiveStatusBlockDetails.push({
                        objectiveId: objectiveIdOnTask || null,
                        objectiveStatus: 'canceled',
                        reason: 'objective_canceled'
                      });
                    }
                    await logEvent('policy-violation', agentId, 'Task mutation blocked by objective status gate', runId, {
                      runId: runId,
                      agentId: agentId,
                      gate: 'objective_status',
                      reason: objectiveBlockReason,
                      objectiveId: objectiveIdOnTask || null,
                      objectiveStatus: objectiveStatus || 'missing',
                      objective_id: objectiveIdOnTask,
                      taskId: update.taskId || null
                    });
                    continue;
                  }
                }
              }
            }

            // Rate-cap gate: per-agent per-run mutation caps
            if (isTaskMutation) {
              const _bucket = _MUTATION_BUCKET_MAP[mutationAction];
              _ensureAgentCounters(agentId);
              const _capKey = mutationAction === 'create' ? 'maxCreatesPerAgentPerRun'
                : mutationAction === 'move' ? 'maxMovesPerAgentPerRun'
                : 'maxUpdatesPerAgentPerRun';
              const _cap = _effectiveCaps[_capKey];
              const _current = _runCounters.byAgent[agentId][_bucket];
              if (_current >= _cap) {
                _incBlocked(agentId);
                if (_canAddProposal(agentId)) {
                  const _rcProposal = _normalizeProposal(_buildBlockedProposal(agentId, runId, 'rate_cap', mutationAction, {
                    title: 'Rate cap exceeded: ' + _bucket + ' (' + _current + '/' + _cap + ')',
                    category: 'governance',
                    taskId: update.taskId || null,
                    cap: _cap,
                    current: _current,
                    bucket: _bucket,
                    objective_suggestion: 'Reduce mutation volume or request cap increase.',
                    acceptanceCriteria: ['Stay within per-agent per-run ' + _bucket + ' cap of ' + _cap + '.'],
                    evidence: {
                      blockedAction: mutationAction,
                      taskId: update.taskId || null,
                      cap: _cap,
                      current: _current
                    }
                  }));
                  if (_isValidProposal(_rcProposal)) {
                    result.proposals.push(_rcProposal);
                    _incProposal(agentId);
                  } else {
                    _incPolicyGate('proposal_schema');
                    await logEvent('policy-violation', agentId, 'Invalid proposal rejected', runId, { gate: 'proposal_schema', reason: 'invalid_proposal', proposedAction: mutationAction });
                  }
                }
                await logEvent('policy-violation', agentId, 'Task mutation blocked by rate cap', runId, {
                  runId: runId,
                  agentId: agentId,
                  gate: 'rate_cap',
                  action: mutationAction,
                  reason: 'cap_exceeded',
                  cap: _cap,
                  current: _current,
                  taskId: update.taskId || null
                });
                continue;
              }
            }

            // Field allowlist gate: block updates containing disallowed keys
            if (mutationAction === 'update' || (mutationAction === 'move' && update.updates)) {
              const updateKeys = update.updates ? Object.keys(update.updates) : [];
              const blockedKeys = updateKeys.filter(k => !ALLOWED_UPDATE_KEYS.has(k));
              if (blockedKeys.length > 0) {
                const allowlistProposal = _buildBlockedProposal(agentId, runId, 'field_allowlist', mutationAction, {
                  title: 'Update blocked: disallowed fields [' + blockedKeys.join(', ') + ']',
                  category: 'governance',
                  taskId: update.taskId || null,
                  blockedKeys: blockedKeys,
                  allowedKeys: Array.from(ALLOWED_UPDATE_KEYS),
                  objective_suggestion: 'Use only allowed update fields: ' + Array.from(ALLOWED_UPDATE_KEYS).join(', ') + '.',
                  acceptanceCriteria: ['Remove disallowed fields: ' + blockedKeys.join(', ') + '.'],
                  evidence: {
                    blockedAction: mutationAction,
                    taskId: update.taskId || null,
                    blockedKeys: blockedKeys
                  }
                });
                _incBlocked(agentId);
                if (_canAddProposal(agentId)) {
                  const _normalizedAlProposal = _normalizeProposal(allowlistProposal);
                  if (_isValidProposal(_normalizedAlProposal)) {
                    result.proposals.push(_normalizedAlProposal);
                    _incProposal(agentId);
                  } else {
                    _incPolicyGate('proposal_schema');
                    await logEvent('policy-violation', agentId, 'Invalid proposal rejected', runId, { gate: 'proposal_schema', reason: 'invalid_proposal', proposedAction: mutationAction });
                  }
                }
                await logEvent('policy-violation', agentId, 'Task update blocked by field allowlist', runId, {
                  runId: runId,
                  agentId: agentId,
                  gate: 'field_allowlist',
                  action: mutationAction,
                  taskId: update.taskId || null,
                  blockedKeys: blockedKeys
                });
                continue;
              }
            }

            // Canceled-objective freeze: block ALL mutations on tasks linked to canceled objectives
            if (mutationAction !== 'create') {
              const _freezeTask = tasks.find(t => t.id === update.taskId);
              if (_freezeTask && _freezeTask.objective_id) {
                const _freezeObj = objectives.find(o => o.id === _freezeTask.objective_id);
                if (_freezeObj && String(_freezeObj.status || '').toLowerCase() === 'canceled') {
                  _incBlocked(agentId);
                  _incPolicyGate('objective_canceled_freeze');
                  await logEvent('policy-violation', agentId, 'Mutation blocked: task linked to canceled objective', runId, {
                    runId: runId, agentId: agentId, gate: 'objective_canceled_freeze',
                    action: mutationAction, taskId: update.taskId,
                    objectiveId: _freezeTask.objective_id, reason: 'objective_canceled'
                  });
                  continue;
                }
              }
            }

            // Canceled-campaign freeze: block ALL mutations on tasks linked to canceled campaigns
            if (mutationAction !== 'create') {
              const _cmpCancelTask = tasks.find(t => t.id === update.taskId);
              if (_cmpCancelTask && _cmpCancelTask.campaign_id) {
                const _cmpCancel = campaignById[_cmpCancelTask.campaign_id] || null;
                if (_cmpCancel && String(_cmpCancel.status || '').toLowerCase() === 'canceled') {
                  _incBlocked(agentId);
                  await logEvent('policy-violation', agentId, 'Mutation blocked: task linked to canceled campaign', runId, {
                    runId: runId, agentId: agentId, gate: 'campaign_canceled_freeze',
                    action: mutationAction, taskId: update.taskId,
                    campaignId: _cmpCancelTask.campaign_id, reason: 'campaign_canceled'
                  });
                  continue;
                }
              }
            }

            // Campaign status freeze gate: block ALL mutations on tasks linked to paused campaigns
            if (mutationAction !== 'create') {
              const _psTask = tasks.find(t => t.id === update.taskId);
              const _psCampaignId = _psTask ? (_psTask.campaign_id || null) : null;
              if (_psCampaignId) {
                const _psCampaign = campaignById[_psCampaignId] || null;
                const _psOldStatus = _psTask ? (_psTask.status || null) : null;
                const _psNextStatus = mutationAction === 'move'
                  ? update.newStatus
                  : (update.updates ? update.updates.status : null);
                const _psFieldsChanged = update.updates ? Object.keys(update.updates) : (mutationAction === 'move' ? ['status'] : []);

                if (_psCampaign && String(_psCampaign.status || '').toLowerCase() === 'paused') {
                  _incBlocked(agentId);
                  _incPolicyGate('campaign_status');
                  _guardrailCounts.pausedCampaignAutomationBlocked++;
                  _projectStatusBlockDetails.push({ campaignId: _psCampaignId, taskId: update.taskId, reason: 'campaign_paused' });
                  await logEvent('policy-violation', agentId, 'Mutation blocked: campaign paused — all task mutations frozen', runId, {
                    type: 'policy-violation', gate: 'campaign_status', reason: 'campaign_paused',
                    campaignId: _psCampaignId, campaignStatus: 'paused', taskId: update.taskId,
                    attempted: { fieldsChanged: _psFieldsChanged, statusFrom: _psOldStatus, statusTo: _psNextStatus }
                  });
                  continue;
                }
              }
            }

            // ── CONTENT PUBLISH GUARD: blog/content tasks stay in 'review' until submit-for-publish ──
            // Prevents content tasks from going to 'done' before the document is submitted for publish
            {
              const _cpgNextStatus = update.newStatus || (update.updates && update.updates.status) || null;
              if (_cpgNextStatus === 'done') {
                const _cpgTask = tasks.find(t => t.id === update.taskId);
                if (_cpgTask) {
                  const _cpgTitle = (_cpgTask.title || '').toLowerCase();
                  const _cpgTags = _cpgTask.tags || [];
                  const _isContentTask = /draft blog|blog post|draft.*article|content brief/i.test(_cpgTask.title || '') ||
                    _cpgTags.indexOf('content') !== -1 || _cpgTags.indexOf('blog') !== -1;
                  if (_isContentTask) {
                    // Find linked document ID from task comments
                    let _cpgDocId = null;
                    const _cpgComments = _cpgTask.comments || [];
                    for (let _ci = _cpgComments.length - 1; _ci >= 0; _ci--) {
                      const _cmMatch = (_cpgComments[_ci].text || '').match(/doc_[a-z0-9_]+/i);
                      if (_cmMatch) { _cpgDocId = _cmMatch[0]; break; }
                    }
                    if (_cpgDocId) {
                      // Check if a publish_document action exists for this document
                      const _cpgHasPublish = allActions.some(a =>
                        a.type === 'publish_document' && a.payload && a.payload.documentId === _cpgDocId
                      );
                      if (!_cpgHasPublish) {
                        // Cap at review — agent needs to run submit-for-publish first
                        if (update.newStatus) update.newStatus = 'review';
                        if (update.updates && update.updates.status) update.updates.status = 'review';
                        context.log('[Heartbeat]', agentId, 'CONTENT PUBLISH GUARD: capped task', update.taskId, 'to review — doc', _cpgDocId, 'has no publish action yet');
                      }
                    }
                  }
                }
              }
            }

            const updatedTask = applyTaskUpdate(tasks, update, _pendingEscalations, agentId);
            if (updatedTask && updatedTask.id) _tasksTouched.add(updatedTask.id);
            // Increment per-agent mutation counter on successful write
            if (isTaskMutation) {
              const _successBucket = _MUTATION_BUCKET_MAP[mutationAction];
              if (_successBucket) {
                _ensureAgentCounters(agentId);
                _runCounters.totals[_successBucket]++;
                _runCounters.byAgent[agentId][_successBucket]++;
              }
            }
            if (update.action === 'create') newTasksCreated++;
            // CEO task completion → create action for approval queue
            if (update._ceoApprovalAction) {
              const ceo = update._ceoApprovalAction;
              const actionsStore = (await storage.getState('actions')) || [];
              // Dedupe: skip if a task_completion.approve already exists for this taskId
              const existingApproval = actionsStore.find(a => a.type === 'task_completion.approve' && a.payload && a.payload.taskId === ceo.taskId);
              // Skip if ANY social post action was ever linked to this task — social post approval is the gate, not task_completion
              const linkedSocialAction = actionsStore.find(a => a._parentTaskId === ceo.taskId && a.type && a.type.indexOf('social_post') === 0);
              // Skip if a content package approval exists for this task — content.package approval is the gate
              const linkedContentPkg = actionsStore.find(a => a._parentTaskId === ceo.taskId && a.type === 'content.package');
              // Also check approvalQueue for content.package items linked to this task
              const approvalQueueStore = linkedContentPkg ? null : (await storage.getState('approvalQueue')) || [];
              const linkedContentPkgAQ = !linkedContentPkg && approvalQueueStore ? approvalQueueStore.find(q => q.taskId === ceo.taskId && (q.kind === 'content.package' || q.type === 'content.package')) : null;
              if (linkedSocialAction) {
                context.log('[Heartbeat] Skipping task_completion.approve for task:', ceo.taskId, '— linked social action', linkedSocialAction.id, 'will auto-complete on CEO approval');
              } else if (linkedContentPkg || linkedContentPkgAQ) {
                context.log('[Heartbeat] Skipping task_completion.approve for task:', ceo.taskId, '— linked content package in approval queue');
              } else if (existingApproval) {
                context.log('[Heartbeat] Skipping duplicate task_completion.approve for task:', ceo.taskId, '(existing:', existingApproval.id + ')');
              } else {
              const nowIso = new Date().toISOString();
              // Check for linked document — if one exists, publish_document is the real CEO gate
              let _tcDocId = null;
              try {
                const _tcDocs = (await storage.getState('documents')) || [];
                const _tcDoc = _tcDocs.find(d => d.taskId === ceo.taskId);
                if (_tcDoc) _tcDocId = _tcDoc.id;
              } catch (_tcErr) { /* non-fatal */ }

              if (_tcDocId) {
                // Task has a linked document — auto-complete, publish_document is the CEO gate
                const _docParent = tasks.find(t => t.id === ceo.taskId);
                if (_docParent && _docParent.status !== 'done') {
                  _docParent.status = 'done';
                  _docParent.completedAt = nowIso;
                  _docParent.updatedAt = nowIso;
                }
                context.log('[Heartbeat] Auto-completed task with linked doc:', ceo.taskId, '(doc:', _tcDocId, ') — publish_document is the CEO gate');
              } else {
              // No linked document — create task_completion.approve for CEO review
              const completionAction = {
                id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                created_at: nowIso,
                created_by: ceo.reviewerId || agentId,
                type: 'task_completion.approve',
                platform: 'internal',
                payload: {
                  text: '**Task:** ' + ceo.taskTitle + '\n\n**Deliverable:**\n' + (ceo.deliverable || '(no deliverable)').substring(0, 2000) + '\n\n**Peer Review (' + (ceo.reviewerId || 'agent') + '):** ' + (ceo.reviewFeedback || 'Approved'),
                  taskId: ceo.taskId,
                  taskTitle: ceo.taskTitle,
                  assignee: ceo.assignee
                },
                classification: 'autonomous',
                requires_ceo_approval: true,
                risk_level: 'low',
                brand_impact: 'none',
                budget_impact: 0,
                // Pending CEO approval — task stays in review until CEO signs off on the deliverable
                approval: { status: 'pending' },
                execution: { status: 'pending', started_at: null, finished_at: null, attempts: 0, last_error: null, receipt: null },
                action_type: 'task_completion.approve',
                action_category: 'task',
                execution_status: 'pending',
                origin_agent: ceo.reviewerId || agentId,
                action_payload: { taskId: ceo.taskId, taskTitle: ceo.taskTitle },
                requires_approval: true,
                is_irreversible: false,
                _parentTaskId: ceo.taskId,
                source: 'heartbeat'
              };
              actionsStore.push(completionAction);
              _guardrailCounts.ceoApprovalsTriggered++;
              // Task stays in review — CEO approves via actions tab, client-side handler moves task to done
              await storage.setState('actions', actionsStore);
              context.log('[Heartbeat] Created pending task_completion.approve for CEO review:', ceo.taskTitle, '→', completionAction.id);
              } // end action creation
              } // end if(_tcDocId) else
            }
            // Track tasks that just entered review — block same-cycle reviews
            if (updatedTask && updatedTask.status === 'review' && (update.action === 'execute' || update.action === 'move' || update.action === 'social-action-created')) {
              _reviewCooldownIds.add(updatedTask.id);
            }
          }
        }

        // Nova auto-assign fallback: if Nova commented on unassigned tasks, detect agent name and auto-assign
        if (agentId === 'nova') {
          const _AGENT_NAMES = { scribe: 'scribe', pixel: 'pixel', echo: 'echo', forge: 'forge', cipher: 'cipher', scout: 'scout', quill: 'quill' };
          for (let _ti = 0; _ti < tasks.length; _ti++) {
            var _t = tasks[_ti];
            if (_t.assignee || _t.status === 'done') continue;
            // Find the MOST RECENT Nova comment (iterate backwards)
            var _novaComments = (_t.comments || []).filter(function(c) { return c.author === 'nova'; });
            if (_novaComments.length === 0) continue;
            var _latestNova = _novaComments[_novaComments.length - 1];
            var _cLower = (_latestNova.text || '').toLowerCase();
            var _assigned = false;
            var _agentKeys = Object.keys(_AGENT_NAMES);
            for (var _ai = 0; _ai < _agentKeys.length; _ai++) {
              if (_cLower.indexOf(_agentKeys[_ai]) !== -1) {
                _t.assignee = _AGENT_NAMES[_agentKeys[_ai]];
                _t.updatedAt = new Date().toISOString();
                if (_t.id) _tasksTouched.add(_t.id);
                if (!_t.comments) _t.comments = [];
                _t.comments.push({ id: 'cmt-autoassign-' + Date.now(), author: 'system', text: 'Auto-assigned to ' + _agentKeys[_ai] + ' based on Nova triage comment.', type: 'system', createdAt: new Date().toISOString() });
                context.log('[Heartbeat] AUTO-ASSIGN:', _t.id, '→', _AGENT_NAMES[_agentKeys[_ai]], '(Nova mentioned', _agentKeys[_ai], 'in triage comment)');
                _assigned = true;
                break;
              }
            }
          }
        }

        // Record heartbeat
        if (configs[agentId]) {
          configs[agentId].heartbeat = configs[agentId].heartbeat || {};
          configs[agentId].heartbeat.lastBeat = new Date().toISOString();
          configs[agentId].heartbeat.status = 'alive';
        }
      } catch (err) {
        context.log.error('[Heartbeat] Agent', agentId, 'failed:', err.message);
        _agentRunStats[agentId] = _agentRunStats[agentId] || {
          attempted: 0,
          executed: 0,
          blocked: 0,
          newTasksCreated: 0,
          avgLatencyMs: 0,
          error: err.message
        };
        await logEvent('error', agentId, 'Heartbeat failed: ' + err.message, cycleId);
      }
    }

    // TTL pruning of agent memories (Phase 1E)
    const _pruneNow = Date.now();
    const _ttlFallbackMs = L4_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
    for (const _pAid of Object.keys(_agentMemoryStore)) {
      if (!Array.isArray(_agentMemoryStore[_pAid])) continue;
      _agentMemoryStore[_pAid] = _agentMemoryStore[_pAid].filter(function (m) {
        var expiry;
        if (m.expiresAt) {
          expiry = new Date(m.expiresAt).getTime();
        } else if (m.timestamp) {
          expiry = new Date(m.timestamp).getTime() + _ttlFallbackMs;
        } else {
          return true; // no date info, keep
        }
        return isNaN(expiry) || expiry > _pruneNow;
      });
      // Re-enforce store cap after pruning
      if (_agentMemoryStore[_pAid].length > MAX_MEMORIES_PER_AGENT) {
        _agentMemoryStore[_pAid] = _agentMemoryStore[_pAid].slice(-MAX_MEMORIES_PER_AGENT);
      }
    }

    // Objective lifecycle health proposals (non-destructive)
    // Suggest status changes only; do not auto-modify objective records.
    const _tasksByObjectiveId = new Map();
    for (const _t of tasks) {
      if (!_t || !_t.objective_id) continue;
      if (!_tasksByObjectiveId.has(_t.objective_id)) _tasksByObjectiveId.set(_t.objective_id, []);
      _tasksByObjectiveId.get(_t.objective_id).push(_t);
    }

    for (const _obj of objectives) {
      if (!_obj || !_obj.id) continue;
      const _linkedTasks = _tasksByObjectiveId.get(_obj.id) || [];
      const _objStatus = String(_obj.status || '').toLowerCase();
      const _allLinkedDone = _linkedTasks.length > 0 && _linkedTasks.every(t => _isTerminalTaskStatus(t.status));

      // Active objective with all linked tasks complete -> suggest objective completion
      if (_objStatus === 'active' && _allLinkedDone) {
        const _completeProposal = _normalizeProposal({
          type: 'proposal',
          agentId: 'nova',
          runId: runId,
          reasonBlocked: 'objective_lifecycle',
          proposedAction: 'complete_objective',
          payload: {
            title: 'Mark objective completed: ' + (_obj.title || _obj.id),
            category: 'governance',
            objective_id: _obj.id,
            objective_suggestion: 'Mark objective as completed.',
            acceptanceCriteria: ['Objective status is active.', 'All linked tasks are completed.'],
            evidence: {
              runId: runId,
              gate: 'objective_lifecycle',
              objective_id: _obj.id,
              objective_status: _objStatus,
              linked_task_count: _linkedTasks.length,
              completed_task_count: _linkedTasks.length
            }
          }
        });
        if (_isValidProposal(_completeProposal)) {
          await logEvent('proposal', 'nova', 'Objective lifecycle suggestion: mark completed (' + (_obj.title || _obj.id) + ')', runId, _completeProposal);
        }
      }

      // Objective with no linked tasks -> suggest archive
      if (_linkedTasks.length === 0) {
        const _archiveProposal = _normalizeProposal({
          type: 'proposal',
          agentId: 'nova',
          runId: runId,
          reasonBlocked: 'objective_lifecycle',
          proposedAction: 'archive_objective',
          payload: {
            title: 'Archive objective with no linked tasks: ' + (_obj.title || _obj.id),
            category: 'governance',
            objective_id: _obj.id,
            objective_suggestion: 'Archive objective or link at least one active task.',
            acceptanceCriteria: ['Objective has zero linked tasks.', 'Owner confirms objective should be archived or re-linked.'],
            evidence: {
              runId: runId,
              gate: 'objective_lifecycle',
              objective_id: _obj.id,
              objective_status: _objStatus,
              linked_task_count: 0
            }
          }
        });
        if (_isValidProposal(_archiveProposal)) {
          await logEvent('proposal', 'nova', 'Objective lifecycle suggestion: archive (' + (_obj.title || _obj.id) + ')', runId, _archiveProposal);
        }
      }
    }

    // ── Task Integrity Guard (permanent) ──
    const _taskIdsAtPersist = new Set(tasks.map(function (t) { return t && t.id; }).filter(Boolean));
    const _unexpectedRemoved = [];
    _taskIdsAtLoad.forEach(function (tid) {
      if (!_taskIdsAtPersist.has(tid) && !_taskIdsArchived.has(tid)) {
        _unexpectedRemoved.push(tid);
      }
    });
    if (_unexpectedRemoved.length > 0) {
      context.log.warn('[Heartbeat] TASK INTEGRITY VIOLATION:', _unexpectedRemoved.length, 'task(s) removed without archive. IDs:', _unexpectedRemoved.slice(0, 5).join(', '));
      await logEvent('task-integrity-violation', null, 'Tasks removed from active without archive record', runId, {
        runId: runId,
        removedCount: _unexpectedRemoved.length,
        removedSample: _unexpectedRemoved.slice(0, 10),
        tasksLoadedCount: _taskIdsAtLoad.size,
        tasksPersistedCount: _taskIdsAtPersist.size,
        archivedCount: _taskIdsArchived.size,
        mode: normalizedActivationMode
      });
    }

    // Persist updated state
    await storage.setState('tasks', tasks);
    if (campaignsChanged) await storage.setState('campaigns', campaigns);
    if (campaignGovEvents.length > 0) {
      const govLog = (await storage.getState('governanceLog')) || [];
      for (const evt of campaignGovEvents) govLog.push(evt);
      if (govLog.length > 300) govLog.splice(0, govLog.length - 300);
      await storage.setState('governanceLog', govLog);
    }
    await storage.setState('agentConfigs', configs);
    await storage.setState('agentMemories', _agentMemoryStore);
    await storage.setState('researchIntel', researchIntelStore);
    await storage.setState('runtimeMemory', runtimeMemory);

    // Persist escalations to approval queue
    if (_pendingEscalations.length > 0) {
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      for (const esc of _pendingEscalations) {
        approvalQueue.push({
          id: 'appr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          taskId: esc.taskId,
          taskTitle: esc.taskTitle,
          originAgent: esc.originAgent,
          riskLevel: esc.riskLevel,
          budgetImpact: esc.budgetImpact,
          brandImpact: esc.brandImpact,
          classification: esc.classification,
          proposedDeadline: null,
          recommendation: '',
          status: 'pending',
          submittedAt: new Date().toISOString(),
          resolvedAt: null,
          ceoDecision: null
        });
      }
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);
      context.log('[Heartbeat] Escalated', _pendingEscalations.length, 'tasks to CEO approval queue');

      // Log escalation events
      for (const esc of _pendingEscalations) {
        await logEvent('escalation', esc.originAgent,
          esc.taskTitle + ' escalated to CEO (' + esc.classification + ', risk: ' + esc.riskLevel + ')',
          cycleId
        );
      }
    }

    // Log cron entry
    const ranTier4 = AGENT_IDS.filter(function (id) {
      return TIER4_SUB_AGENTS.has(id) && !skippedAgents.some(function (s) { return s.agentId === id; });
    });

    const cronLog = (await storage.getState('cronLog')) || [];
    cronLog.push({
      agentId: null,
      task: 'companyHeartbeat',
      result: 'completed',
      cycleId: cycleId,
      geminiCalls: geminiCalls,
      newTasks: newTasksCreated,
      agentActions: agentActions,
      skippedAgents: skippedAgents,
      ranTier4: ranTier4,
      escalationLog: escalationLog.length > 0 ? escalationLog : undefined,
      timestamp: new Date().toISOString()
    });
    if (cronLog.length > 50) cronLog.splice(0, cronLog.length - 50);
    await storage.setState('cronLog', cronLog);

    const skipSummary = skippedAgents.length > 0
      ? ', skipped: ' + skippedAgents.map(function (s) { return s.agentId; }).join(', ')
      : '';

    await logEvent('heartbeat', null,
      'Heartbeat cycle complete: ' + geminiCalls + ' API calls, ' + newTasksCreated + ' new tasks' + skipSummary,
      cycleId
    );

    await logEvent('run-end', null, 'Heartbeat run end', runId, {
      runId: runId,
      mode: normalizedActivationMode,
      totals: _runCounters.totals,
      byAgent: _runCounters.byAgent
    });

    const _agentsDigest = Object.keys(_runCounters.byAgent).map(function (aid) {
      return {
        agentId: aid,
        blocked: _runCounters.byAgent[aid].blocked || 0,
        proposals: _runCounters.byAgent[aid].proposals || 0
      };
    });
    const topBlockedAgents = _agentsDigest
      .filter(function (a) { return a.blocked > 0; })
      .sort(function (a, b) { return b.blocked - a.blocked; })
      .slice(0, 3)
      .map(function (a) { return { agentId: a.agentId, blocked: a.blocked }; });
    const topProposalAgents = _agentsDigest
      .filter(function (a) { return a.proposals > 0; })
      .sort(function (a, b) { return b.proposals - a.proposals; })
      .slice(0, 3)
      .map(function (a) { return { agentId: a.agentId, proposals: a.proposals }; });

    const _runDigestDetails = {
      runId: runId,
      mode: normalizedActivationMode,
      totals: _runCounters.totals,
      topBlockedAgents: topBlockedAgents,
      topProposalAgents: topProposalAgents
    };
    if (_objectiveStatusBlockDetails.length > 0) {
      _runDigestDetails.objectiveStatusBlocks = _objectiveStatusBlockDetails;
    }
    if (_projectStatusBlockDetails.length > 0) {
      _runDigestDetails.projectStatusBlocks = _projectStatusBlockDetails;
    }
    await logEvent('run-digest', null, 'Heartbeat run digest', runId, _runDigestDetails);

    const blockedTotal = _runCounters.totals.blocked || 0;
    const proposalsTotal = _runCounters.totals.proposals || 0;
    const reasons = [];
    if (blockedTotal > 10) reasons.push('blocked_total_gt_10');
    if ((_runGateCounts.output_envelope || 0) > 0) reasons.push('output_envelope_violations');
    if ((_runGateCounts.proposal_schema || 0) > 0) reasons.push('proposal_schema_violations');
    if ((_runGateCounts.objective_status || 0) > 3) reasons.push('objective_status_gt_3');
    if (_objectiveStatusBlockDetails.length > 0) reasons.push('objective_canceled_blocked');
    if (_projectStatusBlockDetails.length > 0) reasons.push('project_paused_blocked');
    const status = reasons.length === 0 ? 'ok' : 'warn';

    await logEvent('run-health', null, 'Heartbeat run health: ' + status, runId, {
      runId: runId,
      mode: normalizedActivationMode,
      status: status,
      reasons: reasons,
      stats: {
        blockedTotal: blockedTotal,
        proposalsTotal: proposalsTotal,
        gateCounts: _runGateCounts
      }
    });

    // ── Persist compact heartbeat run summary (for dashboard health panel) ──
    const finishedAt = new Date().toISOString();
    const startedAtMs = new Date(cycleStart).getTime();
    const finishedAtMs = new Date(finishedAt).getTime();
    const durationMs = (isNaN(startedAtMs) || isNaN(finishedAtMs)) ? 0 : Math.max(0, finishedAtMs - startedAtMs);

    const createdTaskIds = Array.from(_taskIdsAtPersist).filter(function (tid) { return !_taskIdsAtLoad.has(tid); });
    const createdTaskIdSet = new Set(createdTaskIds);

    const createdCampaignIdSet = new Set(campaignGovEvents
      .filter(function (evt) { return evt && evt.type === 'campaign-created' && evt.data && evt.data.campaignId; })
      .map(function (evt) { return evt.data.campaignId; }));

    const updatedDirectiveCount = 0; // directives merged into campaigns — kept for summary compat
    const updatedCampaignCount = Array.from(_campaignsTouched).filter(function (id) { return !createdCampaignIdSet.has(id); }).length;
    const updatedTaskCount = Array.from(_tasksTouched).filter(function (id) { return !createdTaskIdSet.has(id); }).length;

    const docsAtPersist = (await storage.getState('documents')) || [];
    const createdDocsCount = docsAtPersist.filter(function (d) { return d && d.id && !_documentIdsAtLoad.has(d.id); }).length;

    const activeTasksNow = tasks.filter(function (t) {
      var st = String((t && t.status) || '').toLowerCase();
      return st !== 'done' && st !== 'archived';
    });
    const overdueTasks = activeTasksNow.filter(function (t) {
      if (!t || !t.dueDate) return false;
      var due = new Date(t.dueDate).getTime();
      return !isNaN(due) && due < Date.now();
    }).length;
    const blockedTasks = activeTasksNow.filter(function (t) { return String((t && t.status) || '').toLowerCase() === 'blocked'; }).length;
    const oldestActiveTaskAgeHours = activeTasksNow.reduce(function (maxHrs, t) {
      var created = new Date((t && t.createdAt) || 0).getTime();
      if (isNaN(created) || created <= 0) return maxHrs;
      var ageHrs = (Date.now() - created) / 3600000;
      return ageHrs > maxHrs ? ageHrs : maxHrs;
    }, 0);

    const perAgent = {};
    Object.keys(_agentRunStats).forEach(function (aid) {
      var rs = _agentRunStats[aid] || {};
      var rc = (_runCounters.byAgent && _runCounters.byAgent[aid]) || {};
      perAgent[aid] = {
        actionsAttempted: rs.attempted || 0,
        actionsExecuted: rs.executed || 0,
        actionsBlocked: (rc.blocked || 0) + (rs.guardrailBlocked || 0),
        newTasksCreated: rc.creates || 0,
        avgLatencyMs: rs.avgLatencyMs || 0,
        error: rs.error || null
      };
    });

    const guardrailTotal = (_guardrailCounts.orphanBlocked || 0)
      + (_guardrailCounts.exactDupBlocked || 0)
      + (_guardrailCounts.fuzzyDupBlocked || 0)
      + (_guardrailCounts.taskCeilingBlocked || 0)
      + (_guardrailCounts.socialPromoGateBlocked || 0)
      + (_guardrailCounts.pausedCampaignAutomationBlocked || 0);

    const heartbeatSummary = {
      runId: runId,
      startedAt: cycleStart,
      finishedAt: finishedAt,
      durationMs: durationMs,
      mode: normalizedActivationMode,
      executionMode: executionMode,
      status: status,
      errorSummary: null,
      created: {
        goals: 0,
        campaigns: createdCampaignIdSet.size,
        campaignsAutoCreated: createdCampaignAutoCount,
        tasks: createdTaskIds.length,
        docs: createdDocsCount
      },
      updated: {
        tasks: updatedTaskCount,
        directives: updatedDirectiveCount,
        campaigns: updatedCampaignCount
      },
      autoFixes: autoFixCount,
      agentActions: {
        proposed: proposalsTotal,
        executed: Object.keys(agentActions).reduce(function (sum, aid) { return sum + (agentActions[aid] || 0); }, 0),
        blocked: blockedTotal + guardrailTotal,
        escalated: _pendingEscalations.length
      },
      guardrails: {
        orphanBlocked: _guardrailCounts.orphanBlocked || 0,
        exactDupBlocked: _guardrailCounts.exactDupBlocked || 0,
        fuzzyDupBlocked: _guardrailCounts.fuzzyDupBlocked || 0,
        taskCeilingBlocked: _guardrailCounts.taskCeilingBlocked || 0,
        socialPromoGateBlocked: _guardrailCounts.socialPromoGateBlocked || 0,
        ceoApprovalsTriggered: _guardrailCounts.ceoApprovalsTriggered || 0,
        pausedCampaignAutomationBlocked: _guardrailCounts.pausedCampaignAutomationBlocked || 0
      },
      backlogPressure: {
        activeTasks: activeTasksNow.length,
        activeTasksCap: GUARDRAILS.maxActiveTasks,
        newTasksThisCycle: newTasksCreated,
        newTasksCap: GUARDRAILS.maxNewTasksPerCycle,
        overdueTasks: overdueTasks,
        blockedTasks: blockedTasks,
        oldestActiveTaskAgeHours: Math.round(oldestActiveTaskAgeHours)
      },
      perAgent: perAgent,
      skippedAgents: skippedAgents
    };

    const heartbeatRuns = (await storage.getState('heartbeatRuns')) || [];
    heartbeatRuns.push(heartbeatSummary);
    if (heartbeatRuns.length > 100) heartbeatRuns.splice(0, heartbeatRuns.length - 100);
    await storage.setState('heartbeatRuns', heartbeatRuns);
    await logEvent('heartbeat-summary', null, 'Heartbeat summary persisted', runId, {
      runId: runId,
      status: status,
      durationMs: durationMs,
      newTasks: newTasksCreated
    });

    context.log('[Heartbeat] Cycle complete:', cycleId, '| Gemini calls:', geminiCalls, '| New tasks:', newTasksCreated, '| Skipped:', skippedAgents.length, '| Tier4 ran:', ranTier4.join(', ') || 'none');

  } catch (err) {
    context.log.error('[Heartbeat] Fatal error:', err.message);
    await logEvent('error', null, 'Heartbeat fatal: ' + err.message, cycleId);
    try {
      const finishedAt = new Date().toISOString();
      const startedAtMs = new Date(cycleStart).getTime();
      const finishedAtMs = new Date(finishedAt).getTime();
      const durationMs = (isNaN(startedAtMs) || isNaN(finishedAtMs)) ? 0 : Math.max(0, finishedAtMs - startedAtMs);
      const heartbeatRuns = (await storage.getState('heartbeatRuns')) || [];
      heartbeatRuns.push({
        runId: runId,
        startedAt: cycleStart,
        finishedAt: finishedAt,
        durationMs: durationMs,
        mode: 'unknown',
        executionMode: 'unknown',
        status: 'error',
        errorSummary: String(err && err.message ? err.message : err),
        created: { goals: 0, campaigns: 0, campaignsAutoCreated: 0, tasks: 0, docs: 0 },
        updated: { tasks: 0, directives: 0, campaigns: 0 },
        autoFixes: 0,
        agentActions: { proposed: 0, executed: 0, blocked: 0, escalated: 0 },
        guardrails: {
          orphanBlocked: 0,
          exactDupBlocked: 0,
          fuzzyDupBlocked: 0,
          taskCeilingBlocked: 0,
          socialPromoGateBlocked: 0,
          ceoApprovalsTriggered: 0,
          pausedCampaignAutomationBlocked: 0
        },
        backlogPressure: {
          activeTasks: 0,
          activeTasksCap: GUARDRAILS.maxActiveTasks,
          newTasksThisCycle: 0,
          newTasksCap: GUARDRAILS.maxNewTasksPerCycle,
          overdueTasks: 0,
          blockedTasks: 0,
          oldestActiveTaskAgeHours: 0
        },
        perAgent: {},
        skippedAgents: []
      });
      if (heartbeatRuns.length > 100) heartbeatRuns.splice(0, heartbeatRuns.length - 100);
      await storage.setState('heartbeatRuns', heartbeatRuns);
    } catch (_persistErr) {
      context.log.warn('[Heartbeat] Failed to persist fatal heartbeat summary:', _persistErr.message || _persistErr);
    }
  }
};

// ── Run a single agent's heartbeat ──
async function runAgentHeartbeat(context, agentId, tasks, configs, recentSummaries, cycleId, novaSkipTaskIds, activeDirectives, activeObjectives, documents, workspaceMemory, workspaceDates, revisionActions, costIntel, reviewCooldownIds, seedMemories, researchIntelStore, socialIntel, normalizedActivationMode, isAgentInCooldown, logAgentCooldownOnce, incPolicyGate, campaignCtx, siteIntel, workerReports) {
  const _agentRunStartMs = Date.now();
  const result = {
    geminiCalls: 0,
    actions: 0,
    actionAttempts: 0,
    durationMs: 0,
    taskUpdates: [],
    proposals: [],
    newResearchIntel: null,
    guardrails: {
      orphanBlocked: 0,
      exactDupBlocked: 0,
      fuzzyDupBlocked: 0,
      taskCeilingBlocked: 0,
      socialPromoGateBlocked: 0
    }
  };
  const agent = AGENT_ROLES[agentId];
  if (!agent) return result;

  // Read dynamic doctrine weight from workspace config (slider value), clamp 0.0–0.6
  const agentCfg = configs[agentId] || {};
  let dw = parseFloat(agentCfg.doctrineWeight);
  if (isNaN(dw)) dw = 0.4;
  if (dw > 0.6) dw = 0.6;
  if (dw < 0) dw = 0;
  agent._doctrineWeight = Math.round(dw * 100) / 100;

  // Build execution context bundle for execute/review prompts (eliminates context loss)
  const execContext = {
    campaigns: activeDirectives || [],
    directives: activeDirectives || [], // backward compat alias
    objectives: activeObjectives || [],
    seedMemories: seedMemories || {},
    researchIntel: researchIntelStore || [],
    documents: documents || [],
    agentId: agentId
  };

  // Build context for the agent
  const agentTasks = tasks.filter(t => t.assignee === agentId && t.status !== 'done');
  // Nova sees backlog tasks so she can triage them; other agents only see active tasks
  const allActiveTasks = agentId === 'nova'
    ? tasks.filter(t => t.status !== 'done')
    : tasks.filter(t => t.status !== 'done' && t.status !== 'backlog');
  // Only show this agent their own revision-requested actions
  const agentRevisions = (revisionActions || []).filter(a => a.created_by === agentId || a.origin_agent === agentId);

  const prompt = buildHeartbeatPrompt(agent, agentTasks, allActiveTasks, activeDirectives, activeObjectives, documents, workspaceMemory, workspaceDates, agentRevisions, costIntel, reviewCooldownIds, seedMemories, researchIntelStore, socialIntel, workerReports);

  // Call Gemini
  const response = await callGemini(prompt, agentId);
  result.geminiCalls = 1;

  if (!response) {
    context.log('[Heartbeat]', agentId, 'got no response');
    result.durationMs = Date.now() - _agentRunStartMs;
    return result;
  }

  // Parse structured output
  let parsed = null;
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    // Retry with repair prompt if JSON parse fails
    context.log('[Heartbeat]', agentId, 'JSON parse failed, attempting repair');
    try {
      const repaired = await callGemini(
        'The following text was supposed to be valid JSON but has errors. Fix it and return ONLY the valid JSON, nothing else:\n\n' + response
      );
      result.geminiCalls++;
      if (repaired) {
        const jsonMatch = repaired.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (repairErr) {
      context.log.warn('[Heartbeat]', agentId, 'JSON repair also failed');
    }
  }

  // ── Phase 2B + 4A: Normalize output then defensively normalize envelope ──
  const normalizedResult = normalizeAgentResult(parsed);
  const normalized = await _normalizeEnvelope(
    (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      ? parsed
      : {
        taskUpdates: normalizedResult.actions,
        proposals: normalizedResult.proposals,
        remember: normalizedResult.remember,
        observations: normalizedResult.observations
      },
    { agentId: agentId, runId: cycleId, onPolicyViolationGate: incPolicyGate }
  );

  // Per-run cooldown (non-persistent): proposals/observations allowed, mutations + remember suppressed.
  if (typeof isAgentInCooldown === 'function' && isAgentInCooldown(agentId)) {
    normalized.taskUpdates = normalized.taskUpdates.filter(function (a) {
      const t = (a && a.type) || '';
      return t !== 'create-task' && t !== 'update-task' && t !== 'move-task';
    });
    normalized.remember = [];
    if (typeof logAgentCooldownOnce === 'function') {
      await logAgentCooldownOnce(agentId);
    }
  }

  // Log unknown action types as warnings
  for (var _oi = 0; _oi < normalized.observations.length; _oi++) {
    var _obsItem = typeof normalized.observations[_oi] === 'string'
      ? normalized.observations[_oi]
      : JSON.stringify(normalized.observations[_oi] || '');
    if (_obsItem && _obsItem.indexOf('[unknown-action-type]') === 0) {
      context.log('[Heartbeat]', agentId, 'WARN:', _obsItem);
    }
  }

  // ── Tool-call interception: detect web_search tool calls and execute them ──
  let toolUsage = 0;
  const toolResults = [];
  const toolActions = normalized.taskUpdates.filter(a => a.tool === 'web_search' || a.type === 'web_search');
  const regularActions = normalized.taskUpdates.filter(a => a.tool !== 'web_search' && a.type !== 'web_search');

  // Scout recursion guard: skip search if task already has research_intel
  const scoutTargetTask = agentTasks.find(t => t.status === 'in-progress') || agentTasks[0];
  const hasExistingResearch = scoutTargetTask && scoutTargetTask.research_intel;
  if (agentId === 'scout' && hasExistingResearch && toolActions.length > 0) {
    context.log('[Heartbeat] scout RECURSION BLOCKED: research_intel already exists on task', scoutTargetTask.id);
    await logEvent('tool-recursion-blocked', agentId, 'research_intel already attached to ' + scoutTargetTask.id, cycleId);
    toolActions.length = 0; // clear all tool calls
  }

  for (const toolCall of toolActions) {
    if (toolUsage >= MAX_TOOL_CALLS_PER_AGENT) {
      context.log('[Heartbeat]', agentId, 'RATE LIMITED: web_search call #' + (toolUsage + 1) + ' blocked (max ' + MAX_TOOL_CALLS_PER_AGENT + ')');
      await logEvent('tool-rate-limited', agentId, 'web_search rate limited: ' + ((toolCall.args && toolCall.args.q) || 'no query'), cycleId);
      toolResults.push({ query: (toolCall.args && toolCall.args.q) || '', ok: false, error: 'rate_limited', results: [] });
      continue;
    }
    const q = (toolCall.args && toolCall.args.q) || '';
    const n = (toolCall.args && toolCall.args.n) || 5;
    if (!q) continue;

    context.log('[Heartbeat]', agentId, 'executing web_search:', q);
    const searchResult = await webSearch.searchInternal(q, n, agentId, context);
    toolResults.push(searchResult);
    toolUsage++;
  }

  // If tool calls produced results, do a follow-up Gemini call so the agent can synthesize
  if (toolResults.length > 0 && toolResults.some(r => r.ok && r.results.length > 0)) {
    const toolContext = toolResults.map(function (r, i) {
      if (!r.ok) return 'Search #' + (i + 1) + ' (' + r.query + '): ' + (r.error || 'failed');
      return 'Search #' + (i + 1) + ' (' + r.query + '):\n' + r.results.map(function (hit) {
        return '  - [' + hit.rank + '] ' + hit.title + '\n    URL: ' + hit.url + '\n    ' + (hit.snippet || '').substring(0, 200);
      }).join('\n');
    }).join('\n\n');

    const synthesisPrompt = `You are ${agent.name}, ${agent.role} at AmbientPixels.

You requested web searches and here are the results:

${toolContext}

Based on these results, produce TWO outputs:

1. DELIVERABLE: A full markdown research brief with findings and a "## Sources" section listing ONLY URLs from the search results above. Do NOT cite URLs not returned by the tool.

2. STRUCTURED INTEL: After the deliverable, on a new line, output EXACTLY this JSON block (no extra text around it):
<!--RESEARCH_INTEL_JSON
{"title":"brief title","summary":"max 600 char summary","key_findings":["finding 1","finding 2"],"sources":["url1","url2"],"impact_tags":["marketing|pricing|ux|infra|finance|strategy"]}
RESEARCH_INTEL_JSON-->

Rules for the structured intel:
- summary: max 600 characters
- key_findings: max 5 items, each max 200 characters
- sources: max 3 URLs (only from search results)
- impact_tags: pick from: marketing, pricing, ux, infra, finance, strategy

Write the full deliverable first, then the structured JSON block.`;

    const synthesisResponse = await callGemini(synthesisPrompt);
    result.geminiCalls++;

    if (synthesisResponse) {
      // Extract structured research_intel from synthesis response
      let researchIntel = null;
      let deliverableText = synthesisResponse;
      const intelMatch = synthesisResponse.match(/<!--RESEARCH_INTEL_JSON\s*([\s\S]*?)\s*RESEARCH_INTEL_JSON-->/);
      if (intelMatch) {
        deliverableText = synthesisResponse.replace(/<!--RESEARCH_INTEL_JSON[\s\S]*?RESEARCH_INTEL_JSON-->/, '').trim();
        try {
          const raw = JSON.parse(intelMatch[1].trim());
          const _riId = 'ri_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
          researchIntel = {
            id: _riId,
            title: String(raw.title || '').substring(0, 120),
            summary: String(raw.summary || '').substring(0, 600),
            key_findings: (raw.key_findings || []).slice(0, 5).map(f => String(f).substring(0, 200)),
            sources: (raw.sources || []).slice(0, 3).map(s => String(s)),
            impact_tags: (raw.impact_tags || []).filter(t => ['marketing','pricing','ux','infra','finance','strategy'].indexOf(t) !== -1),
            timestamp: new Date().toISOString(),
            created_by: agentId
          };
          // Persist to research intel store so all agents see it even after task completion
          result.newResearchIntel = researchIntel;
          context.log('[Heartbeat]', agentId, 'research_intel extracted:', researchIntel.title);
        } catch (e) {
          context.log('[Heartbeat]', agentId, 'research_intel JSON parse failed:', e.message);
        }
      }

      // Attach deliverable + research_intel to target task
      const targetTask = agentTasks.find(t => t.status === 'in-progress') || agentTasks[0];
      if (targetTask) {
        result.taskUpdates.push({
          action: 'comment',
          taskId: targetTask.id,
          comment: {
            type: 'deliverable',
            author: agentId,
            text: deliverableText,
            sources: toolResults.filter(r => r.ok).reduce(function (urls, r) {
              return urls.concat(r.results.map(function (h) { return h.url; }));
            }, []),
            timestamp: new Date().toISOString()
          }
        });
        // Store structured research_intel on task metadata
        if (researchIntel) {
          result.taskUpdates.push({
            action: 'set-research-intel',
            taskId: targetTask.id,
            research_intel: researchIntel
          });
        }
        context.log('[Heartbeat]', agentId, 'web research deliverable attached to task:', targetTask.id, researchIntel ? '(with structured intel)' : '(no structured intel)');
      }
    }
  }

  // Process structured actions (non-tool actions)
  const actions = regularActions;
  result.actionAttempts = Array.isArray(actions) ? actions.length : 0;
  let actionCount = 0;

  // SERVER-SIDE FORCED HERO IMAGE: If Pixel has a hero image task idle 10+ min and didn't produce generate-image, inject it
  if (agentId === 'pixel') {
    const _pixelHeroTask = agentTasks.find(t =>
      (t.status === 'todo' || t.status === 'in-progress') &&
      (t.title || '').indexOf('Generate hero image for:') === 0 &&
      t.createdAt
    );
    if (_pixelHeroTask) {
      const _pHeroAge = Date.now() - new Date(_pixelHeroTask.createdAt).getTime();
      const _hasGenerateImage = actions.some(a => a.type === 'generate-image');
      if (!_hasGenerateImage) {
        const _pDocMatch = (_pixelHeroTask.description || '').match(/Document ID:\s*(doc_[a-z0-9_]+)/i);
        const _pDocId = _pDocMatch ? _pDocMatch[1] : null;
        const _pTitle = (_pixelHeroTask.title || '').replace('Generate hero image for: ', '');
        context.log('[Heartbeat] PIXEL FORCED HERO IMAGE: task', _pixelHeroTask.id, 'idle', Math.round(_pHeroAge / 60000), 'min — injecting generate-image action');
        actions.unshift({
          type: 'generate-image',
          taskId: _pixelHeroTask.id,
          summary: 'System-forced hero image generation for: ' + _pTitle,
          image: {
            purpose: 'blog_header',
            topic: _pTitle,
            goal: 'Hero image for: ' + _pTitle,
            preset: 'ap-neon-glass',
            attachTo: _pDocId ? { type: 'document', id: _pDocId } : undefined
          }
        });
      }
    }
  }

  // ANTI-STALL: if agent has triaged idle tasks but produced no execute/create-doc/create-social-action, inject forced execute
  // v2: Skip convergence-blocked tasks (3+ deliverables) — try a different task or review-task instead
  if (agentId !== 'nova') {
    const _hasWorkAction = actions.some(a =>
      a.type === 'execute-task' || a.type === 'create-doc' || a.type === 'create-social-action' || a.type === 'review-task'
    );
    if (!_hasWorkAction) {
      const _prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const _triagedIdle = agentTasks
        .filter(t =>
          (t.status === 'todo' || t.status === 'in-progress') &&
          t.comments && t.comments.some(c => c.author === 'nova' || c.author === 'system')
        )
        .sort((a, b) => (_prioOrder[a.priority] || 3) - (_prioOrder[b.priority] || 3));
      // Filter out convergence-blocked tasks (3+ deliverables — would just get blocked again)
      let _executableIdle = _triagedIdle.filter(t => {
        const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
        return _delCount < 3;
      });
      // Fix 8: For Echo, filter out tasks that already have pending social actions (avoids dedup loop)
      if (agentId === 'echo' && _executableIdle.length > 0) {
        try {
          const _existingActions = (await storage.getState('actions')) || [];
          const _pendingSocialTaskIds = new Set();
          for (let _eai = 0; _eai < _existingActions.length; _eai++) {
            const _ea = _existingActions[_eai];
            if (!_ea || !_ea.type || _ea.type.indexOf('social_post') !== 0) continue;
            const _eaStatus = (_ea.approval && _ea.approval.status) || '';
            if (_eaStatus === 'rejected' || _eaStatus === 'cancelled') continue;
            const _eaExecStatus = (_ea.execution && _ea.execution.status) || '';
            if (_eaExecStatus === 'success') continue;
            if (_ea._parentTaskId) _pendingSocialTaskIds.add(_ea._parentTaskId);
          }
          if (_pendingSocialTaskIds.size > 0) {
            const _beforeCount = _executableIdle.length;
            _executableIdle = _executableIdle.filter(t => !_pendingSocialTaskIds.has(t.id));
            if (_executableIdle.length < _beforeCount) {
              context.log('[Heartbeat] ANTI-STALL: echo filtered out', (_beforeCount - _executableIdle.length),
                'task(s) with pending social actions — remaining:', _executableIdle.length);
            }
          }
        } catch (_pendErr) {
          context.log('[Heartbeat] ANTI-STALL: echo pending social filter error (non-fatal):', String(_pendErr).substring(0, 200));
        }
      }
      if (_executableIdle.length > 0) {
        const _stallTask = _executableIdle[0];
        // Detect social tasks for Echo — must use create-social-action, not execute-task
        const _stallText = ((_stallTask.title || '') + ' ' + (_stallTask.description || '')).toLowerCase();
        const _isSocialTask = /linkedin|twitter|x\.com|social media|social post|bluesky|tweet|social_linkedin|social_x|social_bluesky/.test(_stallText) ||
          /^social_/.test(_stallTask.taskType || '');
        if (agentId === 'echo' && _isSocialTask) {
          // Determine platform from task metadata
          const _platform = (_stallTask.taskType === 'social_linkedin' || /linkedin/.test(_stallText)) ? 'linkedin'
            : (_stallTask.taskType === 'social_x' || /twitter|x\.com|tweet/.test(_stallText)) ? 'x'
            : (_stallTask.taskType === 'social_bluesky' || /bluesky/.test(_stallText)) ? 'bluesky'
            : 'linkedin';
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'has', _triagedIdle.length,
            'triaged idle task(s) (' + (_triagedIdle.length - _executableIdle.length) + ' convergence-blocked) — injecting create-social-action (social task) for:', _stallTask.id, '"' + (_stallTask.title || '') + '"', 'platform:', _platform);
          actions.unshift({
            type: 'create-social-action',
            taskId: _stallTask.id,
            social: { platform: _platform, text: '' },
            summary: 'Anti-stall social action: ' + (_stallTask.title || _stallTask.id)
          });
        } else {
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'has', _triagedIdle.length,
            'triaged idle task(s) (' + (_triagedIdle.length - _executableIdle.length) + ' convergence-blocked) — injecting execute-task for:', _stallTask.id, '"' + (_stallTask.title || '') + '"');
          actions.unshift({
            type: 'execute-task',
            taskId: _stallTask.id,
            summary: 'Anti-stall forced execution: ' + (_stallTask.title || _stallTask.id)
          });
        }
      } else if (_triagedIdle.length > 0) {
        // ALL idle tasks are convergence-blocked — try review-task on another agent's task instead
        const _reviewCandidates = allActiveTasks.filter(t =>
          t.status === 'review' && t.assignee !== agentId &&
          t.comments && t.comments.length > 0
        );
        if (_reviewCandidates.length > 0) {
          const _reviewTarget = _reviewCandidates[0];
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'all', _triagedIdle.length,
            'idle tasks convergence-blocked — injecting review-task for:', _reviewTarget.id, '"' + (_reviewTarget.title || '') + '"');
          actions.unshift({
            type: 'review-task',
            taskId: _reviewTarget.id,
            summary: 'Anti-stall review (all own tasks convergence-blocked): ' + (_reviewTarget.title || _reviewTarget.id)
          });
        } else {
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'all', _triagedIdle.length,
            'idle tasks convergence-blocked and no reviewable tasks from other agents — agent fully stalled');
        }
      }
    }
  }

  // Track visual docs created this cycle — blocks same-cycle submit-for-publish
  const _visualDocsCreatedThisCycle = new Set();
  const _VISUAL_DOC_KINDS = ['marketing_post', 'product_brief'];

  // Tier 4 sub-agent action restrictions (server-side enforcement)
  const TIER4_FORBIDDEN = ['create-social-action', 'create-doc', 'submit-for-publish', 'create-task', 'create-content-package'];
  const isTier4 = agent.tier === 4;

  // Work-producing actions bypass dedup entirely — deliverables are always unique
  const _DEDUP_EXEMPT = new Set(['execute-task', 'create-doc', 'create-social-action', 'generate-image', 'create-content-package', 'review-task']);

  for (const action of actions) {
    if (actionCount >= GUARDRAILS.maxActionsPerCyclePerAgent) break;

    // Block forbidden actions for Tier 4 sub-agents
    if (isTier4 && TIER4_FORBIDDEN.indexOf(action.type) !== -1) {
      context.log('[Heartbeat]', agentId, 'BLOCKED forbidden action:', action.type, '(Tier 4 restriction)');
      continue;
    }

    // Only Echo can create social posts (server-side enforcement)
    if (action.type === 'create-social-action' && agentId !== 'echo') {
      context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action (only Echo can post)');
      continue;
    }

    // ── TASK TYPE PIPELINE GUARD ──
    // Validate action type matches the task's taskType to prevent pipeline mismatches
    if (action.taskId) {
      const _ttTask = tasks.find(t => t.id === action.taskId);
      const _ttType = _ttTask ? (_ttTask.taskType || 'general') : 'general';
      const _ttSocial = ['social_x', 'social_linkedin', 'social_bluesky'];
      const _ttBlog = ['blog_post', 'article', 'newsletter'];
      const _ttDoc = ['blog_post', 'article', 'newsletter', 'internal_doc'];
      const _ttContent = ['design_asset'];

      // Block: social action on a non-social task
      if (action.type === 'create-social-action' && _ttType !== 'general' && _ttSocial.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— taskType is', _ttType, '(expected social_x/social_linkedin/social_bluesky)');
        continue;
      }
      // Block: content package on a non-content task
      if (action.type === 'create-content-package' && _ttType !== 'general' && _ttContent.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-content-package on', action.taskId, '— taskType is', _ttType, '(expected design_asset)');
        continue;
      }
      // Warn: create-doc on task that doesn't require docs (soft — log only)
      if (action.type === 'create-doc' && _ttType !== 'general' && _ttDoc.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'WARNING: create-doc on', action.taskId, '— taskType is', _ttType, '(docs usually for blog_post/article/newsletter/internal_doc)');
      }
      // Warn: submit-for-publish on task that doesn't require docs
      if (action.type === 'submit-for-publish' && _ttType !== 'general' && _ttDoc.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'WARNING: submit-for-publish on', action.taskId, '— taskType is', _ttType, '(publish usually for blog_post/article/newsletter/internal_doc)');
      }
      // Log: track all taskType + action combinations for monitoring
      if (_ttType !== 'general') {
        context.log('[Heartbeat] PIPELINE:', agentId, action.type, 'on taskType:', _ttType, 'task:', action.taskId);
      }
    }

    // Nova escalation guard: skip actions on tasks handled by domain lead
    if (novaSkipTaskIds && action.taskId && novaSkipTaskIds.has(action.taskId)) {
      const skipTarget = tasks.find(t => t.id === action.taskId);
      const dlead = skipTarget ? (skipTarget.domainLead || DOMAIN_LEAD_MAP[(skipTarget.assignee || '').toLowerCase()] || '?') : '?';
      context.log('[Heartbeat] Nova SKIPPED action on', action.taskId,
        '— handled by domain lead (' + dlead + '), not High/Blocked/Overdue');
      continue;
    }

    const _isDedupeExempt = _DEDUP_EXEMPT.has(action.type);
    const summary = agent.name + ': ' + (action.summary || action.type || 'action') + (action.taskId ? ' [' + action.taskId + ']' : '');

    // Dedupe (skipped for work-producing actions)
    if (!_isDedupeExempt && recentSummaries.has(summary)) {
      context.log('[Heartbeat]', agentId, 'skipping duplicate:', summary);
      continue;
    }

    if (action.type === 'create-task' && action.task) {
      // SERVER-SIDE GUARD: active task ceiling — prevent unbounded task growth
      const _activeTaskCount = tasks.filter(t => t.status !== 'done' && t.status !== 'archived').length;
      if (_activeTaskCount >= GUARDRAILS.maxActiveTasks) {
        result.guardrails.taskCeilingBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED create-task: active task ceiling reached (' + _activeTaskCount + '/' + GUARDRAILS.maxActiveTasks + ')');
        continue;
      }

      // Inherit linking from parent campaign when provided
      var _taskCampaignId = action.task.campaign_id || action.task.directive_id || null;
      var _taskObjectiveId = action.task.objective_id || null;
      if (_taskCampaignId && campaignCtx && campaignCtx.campaignById && campaignCtx.campaignById[_taskCampaignId]) {
        var _parentCmp = campaignCtx.campaignById[_taskCampaignId];
        if (!_taskObjectiveId && _parentCmp.objective_id) _taskObjectiveId = _parentCmp.objective_id;
      }

      // SERVER-SIDE GUARD: agent-created tasks must link to a goal or campaign
      const _hasObjective = _taskObjectiveId || (action.task.source && action.task.source.type === 'ceo');
      const _hasCampaign = _taskCampaignId;
      if (!_hasObjective && !_hasCampaign) {
        result.guardrails.orphanBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED orphan task creation: "' + (action.task.title || '') + '" — must set objective_id or campaign_id');
        continue;
      }

      // SERVER-SIDE DEDUP: block if an active task with very similar title already exists
      const proposedTitle = (action.task.title || '').toLowerCase().trim();
      if (proposedTitle) {
        const _normalize = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        const normalizedNew = _normalize(proposedTitle);
        const existingMatch = tasks.find(t => t.status !== 'done' && _normalize(t.title || '') === normalizedNew);
        if (existingMatch) {
          result.guardrails.exactDupBlocked++;
          context.log('[Heartbeat]', agentId, 'BLOCKED duplicate task creation:', proposedTitle, '— matches existing:', existingMatch.id);
          continue;
        }
        // Also check fuzzy: if 80%+ of words match
        const newWords = normalizedNew.split(' ').filter(w => w.length > 2);
        if (newWords.length >= 3) {
          const fuzzyMatch = tasks.find(t => {
            if (t.status === 'done') return false;
            const existingWords = _normalize(t.title || '').split(' ').filter(w => w.length > 2);
            if (existingWords.length === 0) return false;
            const overlap = newWords.filter(w => existingWords.indexOf(w) !== -1).length;
            return overlap / Math.max(newWords.length, existingWords.length) >= 0.8;
          });
          if (fuzzyMatch) {
            result.guardrails.fuzzyDupBlocked++;
            context.log('[Heartbeat]', agentId, 'BLOCKED fuzzy-duplicate task:', proposedTitle, '— similar to:', fuzzyMatch.title, '(', fuzzyMatch.id, ')');
            continue;
          }
        }
      }
      // SERVER-SIDE GUARD: Block premature social promotion tasks for blog posts
      // Social tasks should ONLY be created after CEO publishes + promotes the blog post
      const _taskTitle = (action.task.title || '').toLowerCase();
      const _taskDesc = (action.task.description || '').toLowerCase();
      const _taskText = _taskTitle + ' ' + _taskDesc;
      const _isSocialPromoTask = /social\s*(media|post|promo|copy|campaign)|promote.*blog|blog.*promo/.test(_taskText);
      const _refsBlogPost = /blog\s*post|hello\s*world|marketing_post|first\s*post/.test(_taskText);
      if (_isSocialPromoTask && _refsBlogPost) {
        result.guardrails.socialPromoGateBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED premature social promo task:', action.task.title, '— blog must be published + promoted first. Social tasks are auto-created on publish with promote=true.');
        continue;
      }

      // Log raw Gemini output for debugging task creation issues
      context.log('[Heartbeat]', agentId, 'create-task RAW:', JSON.stringify({
        assignee: action.task.assignee,
        dueDate: action.task.dueDate,
        status: action.task.status,
        priority: action.task.priority
      }));

      // Resolve campaign via shared module if not already set
      if (!_taskCampaignId) {
        const _ctResult = await ensureCampaign({
          campaign_id: _taskCampaignId || null,
          title: action.task.title || '',
          description: action.task.description || '',
          goalId: _taskObjectiveId || null,
          division: action.task.division || null,
          provenance: 'Auto: Campaign ' + agentId,
          campaigns: (campaignCtx && campaignCtx.campaigns) ? campaignCtx.campaigns : [],
          entrypoint: 'heartbeat_create_task',
          debug: true,
          logger: context.log
        });
        _taskCampaignId = _ctResult.campaignId;
        if (_ctResult.created) {
          _ctResult.campaign.description = await generateConversationalEntityComment('campaign', {
            agentId: agentId,
            title: _ctResult.campaign.title || action.task.title || 'Campaign',
            goalId: _taskObjectiveId || null,
            seedText: action.task.description || '',
            fallbackText: 'I created this campaign to group related work and keep planning/execution aligned under one objective.'
          });
          _ctResult.campaign.updatedAt = new Date().toISOString();
          if (campaignCtx) campaignCtx.campaignsChanged = true;
          if (campaignCtx && Array.isArray(campaignCtx.campaignGovEvents)) campaignCtx.campaignGovEvents.push({
            id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
            type: 'campaign-created',
            data: { campaignId: _ctResult.campaignId, title: _ctResult.campaign.title, provenance: _ctResult.campaign.provenance || null, source: 'heartbeat_create_task' },
            timestamp: new Date().toISOString()
          });
        }
      }

      // Only Nova can set parent_task_id — strip from other agents to keep hierarchy clean
      var _parentTaskId = (agentId === 'nova' && action.task.parent_task_id) ? action.task.parent_task_id : null;
      if (action.task.parent_task_id && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED parent_task_id from create-task — only Nova can set task hierarchy');
      }
      // Pass through taskType if agent provides it; auto-infer from title if not set
      let _taskType = action.task.taskType || null;
      if (!_taskType) {
        const _ctTitle = ((action.task.title || '') + ' ' + (action.task.description || '')).toLowerCase();
        if (/write.*blog|draft.*blog|blog\s*post|create.*blog|publish.*blog|new.*blog|first\s*blog|write.*article/.test(_ctTitle)) _taskType = 'blog_post';
        else if (/social.*post|post.*to.*x\b|tweet|linkedin.*post|bluesky.*post/.test(_ctTitle)) _taskType = 'social_x';
        else if (/hero\s*image|generate.*image.*blog|blog.*header/.test(_ctTitle)) _taskType = 'design_asset';
        else if (/spec\b|runbook|release.*note|governance.*doc|internal.*doc/.test(_ctTitle)) _taskType = 'internal_doc';
        else if (/research|competitive.*intel|market.*analysis/.test(_ctTitle)) _taskType = 'research';
        else if (/deploy|infrastructure|ci.*cd|pipeline|devops/.test(_ctTitle)) _taskType = 'ops';
      }
      result.taskUpdates.push({
        action: 'create',
        task: {
          title: action.task.title || 'Untitled',
          description: action.task.description || '',
          taskType: _taskType || 'general',
          status: action.task.status || 'todo',
          priority: action.task.priority || 'medium',
          assignee: action.task.assignee || agentId,
          division: action.task.division || null,
          dueDate: action.task.dueDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          objective_id: _taskObjectiveId || null,
          campaign_id: _taskCampaignId || null,
          category: action.task.category || null,
          parent_task_id: _parentTaskId
        }
      });
    } else if (action.type === 'update-task' && action.taskId) {
      // Strip parent_task_id from non-Nova agents
      var _updates = action.updates || {};
      if (_updates.parent_task_id && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED parent_task_id from update-task — only Nova can set task hierarchy');
        delete _updates.parent_task_id;
      }
      if (_updates.child_task_ids && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED child_task_ids from update-task — only Nova can set task hierarchy');
        delete _updates.child_task_ids;
      }
      result.taskUpdates.push({
        action: 'update',
        taskId: action.taskId,
        updates: _updates
      });
    } else if (action.type === 'move-task' && action.taskId && action.newStatus) {
      result.taskUpdates.push({
        action: 'move',
        taskId: action.taskId,
        newStatus: action.newStatus
      });
    } else if (action.type === 'execute-task' && action.taskId) {
      // SERVER-SIDE GUARD: block Echo from using execute-task on social post tasks
      // Echo must use create-social-action instead — execute-task bypasses the action governance layer
      if (agentId === 'echo') {
        const socialTask = tasks.find(t => t.id === action.taskId);
        if (socialTask) {
          const taskText = ((socialTask.title || '') + ' ' + (socialTask.description || '')).toLowerCase();
          if (/linkedin|twitter|x\.com|social media|social post|bluesky|tweet/.test(taskText)) {
            context.log('[Heartbeat] BLOCKED Echo execute-task on social post task:', action.taskId, '— must use create-social-action instead');
            continue;
          }
        }
      }
      // TRIAGE GATE: block execution on truly untouched tasks (zero comments = never triaged)
      // Exception: CEO-created tasks with assignee + dueDate are pre-triaged (CEO outranks Nova)
      if (agentId !== 'nova') {
        const targetTask = tasks.find(t => t.id === action.taskId);
        const hasAnyComment = targetTask && targetTask.comments && targetTask.comments.length > 0;
        const isCeoTriaged = targetTask && targetTask.source !== 'heartbeat' && targetTask.assignee && targetTask.dueDate;
        if (targetTask && !hasAnyComment && !isCeoTriaged) {
          context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task has zero comments (needs Nova triage first)');
          continue;
        }
      }
      // DELIVERABLE GUARD: block re-execution if task already has a deliverable or is in review/done
      {
        const _exTask = tasks.find(t => t.id === action.taskId);
        if (_exTask) {
          if (_exTask.status === 'review' || _exTask.status === 'done') {
            context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task already in', _exTask.status);
            continue;
          }
          // CONVERGENCE GUARD: if 3+ deliverables already exist, the task is looping — block and escalate
          const _deliverableCount = (_exTask.comments || []).filter(c => c.type === 'deliverable').length;
          if (_deliverableCount >= 3) {
            context.log('[Heartbeat]', agentId, 'CONVERGENCE BLOCKED execute-task on', action.taskId,
              '— task has', _deliverableCount, 'deliverables already (revision loop detected). Escalating to CEO.');
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: '[SYSTEM] Revision loop detected: ' + _deliverableCount + ' deliverables on this task without convergence. Task needs CEO review to break the cycle — either approve the latest draft, provide specific direction, or close the task.',
              agentId: 'system'
            });
            // Move to review so CEO sees it
            if (_exTask.status !== 'review') {
              result.taskUpdates.push({
                action: 'move',
                taskId: action.taskId,
                newStatus: 'review'
              });
            }
            continue;
          }
          const _hasDeliverable = _deliverableCount > 0;
          if (_hasDeliverable && _exTask.status !== 'in-progress') {
            context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task already has a deliverable and is not in-progress (revision). Use review-task or comment-task instead.');
            continue;
          }
          if (_hasDeliverable && _exTask.status === 'in-progress') {
            context.log('[Heartbeat]', agentId, 'REVISION ALLOWED: re-executing task', action.taskId, '— has', _deliverableCount, 'prior deliverable(s), status is in-progress (changes-requested)');
          }
        }
      }
      // Execute: agent produces actual work on a task (costs 1 extra Gemini call)
      if (result.executes >= GUARDRAILS.maxExecutesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max executes reached, skipping');
      } else {
        const task = tasks.find(t => t.id === action.taskId);
        if (task) {
          const deliverable = await executeTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext);
          result.geminiCalls++;
          if (deliverable) {
            result.taskUpdates.push({
              action: 'execute',
              taskId: action.taskId,
              deliverable: deliverable,
              agentId: agentId
            });
            result.executes = (result.executes || 0) + 1;

            // SERVER-SIDE FALLBACK: Auto-create document for blog post tasks that used execute-task instead of create-doc
            // Three-layer detection: (1) taskType field, (2) title/desc regex fallback, (3) deliverable content signals
            const _etTaskText = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
            const _etDeliverableLower = (deliverable || '').toLowerCase();
            const _isBlogByType = (task.taskType === 'blog_post' || task.taskType === 'article');
            const _isBlogByTitle = /write.*blog|draft.*blog|blog\s*post|create.*blog|publish.*blog|new.*blog|first\s*blog|introductory\s*post|write.*article|compose.*article/.test(_etTaskText);
            const _isBlogByContent = /document\s*type:\s*marketing_post|publishing\s*to\s*\/blog\/|submit.*ceo.*approv.*publish/.test(_etDeliverableLower);
            const _isBlogTask = agentId === 'scribe' && (_isBlogByType || _isBlogByTitle || _isBlogByContent);
            if (_isBlogTask) context.log('[Heartbeat] BLOG DETECTED:', agentId, 'task:', action.taskId, 'byType:', _isBlogByType, 'byTitle:', _isBlogByTitle, 'byContent:', _isBlogByContent);
            if (_isBlogTask && deliverable.length > 200) {
              const _etDocsStore = (await storage.getState('documents')) || [];
              const _etExistingDoc = _etDocsStore.find(d => {
                if (d.status === 'rejected' || d.status === 'archived') return false;
                // Check top-level taskId (set by execute-task fallback)
                if (d.taskId && d.taskId === action.taskId) return true;
                // Check source.task_id (set by create-doc handler)
                if (d.source && d.source.task_id && d.source.task_id === action.taskId) return true;
                // Exact title match (fallback)
                if (d.title && d.title === task.title) return true;
                return false;
              });
              if (_etExistingDoc) {
                context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback SKIPPED — doc already exists for task:', action.taskId, 'existing doc:', _etExistingDoc.id, _etExistingDoc.title);
              }
              if (!_etExistingDoc) {
                const _etDocId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                const _etDoc = {
                  id: _etDocId,
                  title: task.title || 'Untitled Blog Post',
                  kind: 'marketing_post',
                  content_md: deliverable,
                  status: 'draft',
                  tags: ['blog', 'auto-created-from-execute'],
                  created_by: agentId,
                  taskId: action.taskId,
                  promote: false,
                  awaiting_hero_image: true,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                };
                _etDocsStore.push(_etDoc);
                await storage.setState('documents', _etDocsStore);
                context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback: Created marketing_post from execute-task deliverable:', _etDocId, 'for blog task:', action.taskId);

                // Auto-create Pixel hero image task (same logic as create-doc handler)
                // SPAWN GUARD: do not spawn child tasks from auto-created tasks (prevents auto→auto chains)
                const _etSourceAutoCreated = task.tags && task.tags.indexOf('auto-created') !== -1;
                const _etHeroTitle = 'Generate hero image for: ' + stripTaskPrefixes(_etDoc.title);
                const _etHeroExists = tasks.some(t =>
                  t.assignee === 'pixel' && t.status !== 'done' &&
                  (t.title === _etHeroTitle || (t.description && t.description.indexOf(_etDocId) !== -1))
                );
                if (!_etHeroExists && !_etSourceAutoCreated) {
                  const _etHeroTask = {
                    id: 'task_' + Date.now() + '_hero_' + Math.random().toString(36).substr(2, 4),
                    title: _etHeroTitle,
                    description: 'Generate a hero image for the blog post "' + _etDoc.title + '".\nDocument ID: ' + _etDocId + '\nUse generate-image with purpose "blog_header" and attachTo: { type: "document", id: "' + _etDocId + '" }.\nChoose an appropriate preset based on the content tone.',
                    taskType: 'design_asset',
                    status: 'todo',
                    priority: task.priority || 'high',
                    dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
                    assignee: 'pixel',
                    source: 'heartbeat',
                    created_by: 'system',
                    parent_task_id: action.taskId,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    campaign_id: task.campaign_id || null,
                    objective_id: task.objective_id || null,
                    tags: ['hero-image', 'auto-created', 'visual-workflow'],
                    comments: [{
                      id: 'cmt-hero-' + Date.now(),
                      author: 'nova',
                      text: 'Pixel, generate a hero image for the blog post "' + _etDoc.title + '" (doc: ' + _etDocId + '). Use generate-image with purpose blog_header and attachTo the document.',
                      type: 'system',
                      createdAt: new Date().toISOString()
                    }]
                  };
                  tasks.push(_etHeroTask);
                  context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback: Created Pixel hero image task:', _etHeroTask.id, 'for auto-doc:', _etDocId);
                }
                // Add visible diagnostic comment on the task
                result.taskUpdates.push({
                  action: 'comment',
                  taskId: action.taskId,
                  comment: '[AUTO-DOC] Blog post detected via execute-task — auto-created document (' + _etDocId + ', kind: marketing_post) and Pixel hero image task. Next: Pixel generates hero image, then submit-for-publish.',
                  agentId: 'system'
                });
              }
            }
          }
        }
      }
    } else if (action.type === 'create-social-action' && action.social) {
      // TRIAGE GATE: if this social action is linked to a task, that task must be triaged first
      // Exception: CEO-created tasks with assignee + dueDate are pre-triaged
      if (agentId !== 'nova' && action.taskId) {
        const socialTarget = tasks.find(t => t.id === action.taskId);
        const hasSocialTriage = socialTarget && socialTarget.comments && socialTarget.comments.length > 0;
        const isCeoSocialTriaged = socialTarget && socialTarget.source !== 'heartbeat' && socialTarget.assignee && socialTarget.dueDate;
        if (socialTarget && !hasSocialTriage && !isCeoSocialTriaged) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— task has zero comments (needs Nova triage first)');
          continue;
        }
      }
      // DEDUPE GUARD: block duplicate social posts for the SAME TASK only
      const existingActions = (await storage.getState('actions')) || [];
      const isDupe = existingActions.some(function(ea) {
        if (!ea.type || ea.type.indexOf('social_post') !== 0) return false;
        var eaStatus = (ea.approval && ea.approval.status) || '';
        if (eaStatus === 'rejected' || eaStatus === 'cancelled') return false; // allow retry after reject
        var eaExecStatus = (ea.execution && ea.execution.status) || '';
        if (eaExecStatus === 'success') return false; // completed actions don't block new ones
        // Same task already has a pending/in-flight social action
        if (action.taskId && ea._parentTaskId === action.taskId) return true;
        return false;
      });
      if (isDupe) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — duplicate: pending social action already exists for task', action.taskId);
        continue;
      }

      // FIX 3: Block social actions that reference blog posts not yet published+promoted
      // This prevents the entire cascade: social action → copy task → Scribe create-doc → hero image
      if (action.taskId) {
        const _saParentTask = tasks.find(t => t.id === action.taskId);
        if (_saParentTask) {
          const _saText = ((_saParentTask.title || '') + ' ' + (_saParentTask.description || '')).toLowerCase();
          const _saRefsBlog = /blog\s*post|marketing_post|hello\s*world|write.*article|first\s*post/.test(_saText);
          if (_saRefsBlog) {
            // Check if the blog post is actually published + promoted
            const _saDocs = (await storage.getState('documents')) || [];
            const _saPublishedAndPromoted = _saDocs.some(d =>
              d.status === 'published' && d.promote === true &&
              d.kind === 'marketing_post'
            );
            if (!_saPublishedAndPromoted) {
              context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — blog not published+promoted yet. Social tasks auto-created after CEO approves publish with promote=true.');
              continue;
            }
          }
        }
      }

      // ── COPY REVIEW GATE ──
      // Social posts linked to tasks must go through Scribe for copy writing + peer review first.
      // Mirrors the Pixel hero image pattern: auto-create a Scribe task, block until reviewed.
      // Exception: task already has reviewed_copy (set when Scribe's writing sub-task is approved)
      if (action.taskId) {
        const socialTask = tasks.find(t => t.id === action.taskId);
        if (socialTask && !socialTask.reviewed_copy) {
          // Check if a Scribe writing sub-task already exists for this social task
          const _copyTag = 'social-copy-for-' + action.taskId;
          const _copyTaskExists = tasks.some(t =>
            t.status !== 'done' &&
            ((t.tags && t.tags.indexOf(_copyTag) !== -1) ||
             (t.assignee === 'scribe' && t.parent_task_id === action.taskId && (t.title || '').indexOf('Write social copy') === 0))
          );
          // Also check if a COMPLETED Scribe copy task exists (reviewed_copy may not have propagated yet)
          const _copyTaskDone = tasks.find(t =>
            t.status === 'done' &&
            ((t.tags && t.tags.indexOf(_copyTag) !== -1) ||
             (t.assignee === 'scribe' && t.parent_task_id === action.taskId && (t.title || '').indexOf('Write social copy') === 0))
          );
          if (_copyTaskDone) {
            // Copy task is done but reviewed_copy wasn't set — extract deliverable now
            const _deliverables = (_copyTaskDone.comments || []).filter(c => c.type === 'deliverable');
            if (_deliverables.length > 0) {
              socialTask.reviewed_copy = _deliverables[_deliverables.length - 1].text;
              socialTask.updatedAt = new Date().toISOString();
              context.log('[Heartbeat]', agentId, 'Late-resolved reviewed_copy from done copy task:', _copyTaskDone.id);
              // Fall through — allow the social action with the reviewed copy
            }
          }
          // If STILL no reviewed copy, block and create Scribe task
          // SPAWN GUARD: do not spawn child tasks from auto-created tasks (prevents auto→auto chains)
          const _isAutoCreatedSource = socialTask.tags && socialTask.tags.indexOf('auto-created') !== -1;
          if (!socialTask.reviewed_copy && !_isAutoCreatedSource) {
            if (!_copyTaskExists) {
              const _platform = (action.social.platform || 'linkedin').toLowerCase();
              const _maxLen = _platform === 'x' ? '280 chars' : _platform === 'bluesky' ? '300 chars' : '3000 chars for LinkedIn';
              const copyTask = {
                id: 'task_' + Date.now() + '_copy_' + Math.random().toString(36).substr(2, 4),
                title: 'Write social copy for: ' + stripTaskPrefixes(socialTask.title || 'Untitled'),
                description: 'Write publish-ready social media copy for the task: "' + stripTaskPrefixes(socialTask.title || '') + '".\n\n'
                  + 'Original description: ' + ((socialTask.description || 'N/A').substring(0, 500)) + '\n\n'
                  + 'Parent task ID: ' + action.taskId + '\n'
                  + 'Platform: ' + _platform + '\n'
                  + 'Max length: ' + _maxLen + '\n\n'
                  + 'Requirements:\n'
                  + '- Write clean, platform-ready copy (no markdown, no headers, no internal notes)\n'
                  + '- Professional and on-brand for AmbientPixels\n'
                  + '- After writing, this task goes to peer review. Once approved, Echo uses the copy to create the social post.\n'
                  + '- Use execute-task to produce your deliverable.',
                status: 'todo',
                priority: socialTask.priority || 'high',
                assignee: 'scribe',
                source: 'heartbeat',
                created_by: 'system',
                parent_task_id: action.taskId || null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                dueDate: socialTask.dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                campaign_id: socialTask.campaign_id || null,
                tags: ['social-copy', 'auto-created', _copyTag],
                comments: [{
                  id: 'cmt-' + Date.now(),
                  author: 'system',
                  text: 'Auto-created: Echo attempted to post for task "' + (socialTask.title || '') + '" but no reviewed copy exists. Scribe must write and submit copy for peer review first.',
                  type: 'system',
                  createdAt: new Date().toISOString()
                }]
              };
              tasks.push(copyTask);
              context.log('[Heartbeat]', agentId, 'AUTO-CREATED Scribe copy task:', copyTask.id, 'for social task:', action.taskId);
            } else {
              context.log('[Heartbeat]', agentId, 'Scribe copy task already exists for social task:', action.taskId, '— waiting for review');
            }
            // Mark parent task as awaiting copy review (only once)
            if (!socialTask.awaiting_copy_review) {
              socialTask.awaiting_copy_review = true;
              socialTask.updatedAt = new Date().toISOString();
              if (!socialTask.comments) socialTask.comments = [];
              socialTask.comments.push({
                id: 'cmt-copywait-' + Date.now(),
                author: 'system',
                text: 'Social post blocked — awaiting reviewed copy from Scribe. Once Scribe writes and a peer reviews the copy, Echo can create the social action.',
                type: 'system',
                createdAt: new Date().toISOString()
              });
            }
            context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— awaiting reviewed copy from Scribe');
            continue;
          }
        }
      }

      // Fix 9: If the social task has reviewed_copy but the action text is empty, inject the copy
      if (action.taskId) {
        const _rcTask = tasks.find(t => t.id === action.taskId);
        if (_rcTask && _rcTask.reviewed_copy && (!action.social.text || action.social.text.trim() === '')) {
          action.social.text = _rcTask.reviewed_copy;
          context.log('[Heartbeat]', agentId, 'Injected reviewed_copy into social action text (' + action.social.text.length + ' chars)');
        }
      }

      // Agent-initiated social post action — routes through action layer governance
      const socialPayload = action.social;

      // Fix 10: Strip alternative draft options that Scribe includes in deliverables
      // Scribe often writes multiple options (main + "Alternative Option" sections separated by ---)
      if (socialPayload.text && /\*\*Alternative\s+Option/i.test(socialPayload.text)) {
        let _cleaned = socialPayload.text;
        // Cut at first --- followed by **Alternative Option or just **Alternative Option
        _cleaned = _cleaned.split(/\n-{2,}\s*\n(?=\s*\*\*Alternative)/i)[0]
          || _cleaned.split(/\*\*Alternative\s+Option[^*]*\*\*/i)[0]
          || _cleaned;
        _cleaned = _cleaned.replace(/\n-{2,}\s*$/, '').trim(); // trailing ---
        if (_cleaned.length > 20) {
          context.log('[Heartbeat] Fix 10: Stripped alternative draft options — kept', _cleaned.length, 'of', socialPayload.text.length, 'chars');
          socialPayload.text = _cleaned;
        }
      }

      // Fix 10b: Strip remaining markdown bold/italic from social post text
      if (socialPayload.text && /\*\*/.test(socialPayload.text)) {
        socialPayload.text = socialPayload.text
          .replace(/\*\*([^*]+)\*\*/g, '$1')   // **bold** → bold
          .replace(/\*([^*]+)\*/g, '$1');        // *italic* → italic
      }

      // Server-side sanitizer: strip deliverable metadata that agents sometimes dump into post text
      if (socialPayload.text && /\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up|Peer Review|Notes|Review).*?:\*\*/i.test(socialPayload.text)) {
        let raw = socialPayload.text;
        context.log('[Heartbeat] Sanitizing social post text — detected deliverable metadata');

        // Strategy 1: Extract just the LinkedIn Post Draft section
        const draftMatch = raw.match(/\*\*LinkedIn Post Draft:\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i)
          || raw.match(/\*\*(?:Post|Draft|Content):\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i);
        if (draftMatch && draftMatch[1].trim().length > 20) {
          raw = draftMatch[1].trim();
        } else {
          // Strategy 2: Remove all known section headers and keep what's left
          // Split by section headers and keep only content paragraphs
          const sections = raw.split(/\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up Comment|Peer Review[^*]*|Notes|Review[^*]*):\*\*/i);
          // Find the longest section that looks like actual post content (no markdown headers)
          let best = '';
          for (const section of sections) {
            const cleaned = section.replace(/^#{1,4}\s+.*$/gm, '').replace(/^\s*[-–]\s+/gm, '').trim();
            if (cleaned.length > best.length && !/^\s*\*\*/.test(cleaned) && cleaned.length > 20) {
              best = cleaned;
            }
          }
          if (best.length > 20) raw = best;
        }

        // Strip remaining markdown formatting
        raw = raw.replace(/^#{1,4}\s+.*$/gm, '');          // ## headings
        raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1');        // **bold** → bold
        raw = raw.replace(/\*([^*]+)\*/g, '$1');             // *italic* → italic
        raw = raw.replace(/^\s*\*\s+/gm, '');               // bullet points
        raw = raw.replace(/\n{3,}/g, '\n\n').trim();         // collapse blank lines
        context.log('[Heartbeat] Sanitized text:', raw.substring(0, 120));
        socialPayload.text = raw;
      }

      const postText = socialPayload.text || '';

      // Server-side enforcement: reject posts with unfilled template placeholders
      if (/\[(?:[^\]]*(?:mention|insert|add|include|TBD|link|placeholder|url|website|your |e\.g\.|fill))[^\]]*\]/i.test(postText)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — contains placeholder brackets:', postText.substring(0, 100));
        continue;
      }

      // Server-side enforcement: reject posts linking to unpublished blog articles
      // v2.4.4: Skip this check for {{ARTICLE_URL}} tokens — those are resolved at execute time
      const textWithoutTokens = postText.replace(/\{\{ARTICLE_URL[^}]*\}\}/g, '');
      const blogSlugMatches = textWithoutTokens.match(/(?:ambientpixels\.ai)?\/blog\/([a-z0-9][a-z0-9-]+[a-z0-9])/gi);
      if (blogSlugMatches && blogSlugMatches.length > 0) {
        const blogPosts = (await storage.getState('blogPosts')) || [];
        const publishedSlugs = new Set(blogPosts.map(p => p.slug));
        const deadSlugs = [];
        for (const match of blogSlugMatches) {
          const slug = match.replace(/.*\/blog\//i, '');
          if (!publishedSlugs.has(slug)) deadSlugs.push(slug);
        }
        if (deadSlugs.length > 0) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — links to unpublished blog slug(s):', deadSlugs.join(', '));
          continue;
        }
      }

      // v2.5: Promotion gating — block social posts that reference blog posts without promote: true
      if (blogSlugMatches && blogSlugMatches.length > 0) {
        const _allDocs = (await storage.getState('documents')) || [];
        const _blogPostsForPromo = (await storage.getState('blogPosts')) || [];
        const unpromotedSlugs = [];
        for (const match of blogSlugMatches) {
          const slug = match.replace(/.*\/blog\//i, '');
          // Find the published blog post, then its source document
          const _bp = _blogPostsForPromo.find(p => p.slug === slug);
          if (_bp) {
            const _srcDoc = _allDocs.find(d => d.id === (_bp.documentId || _bp.document_id));
            if (_srcDoc && !_srcDoc.promote) unpromotedSlugs.push(slug);
            else if (!_srcDoc) unpromotedSlugs.push(slug); // no source doc = no promote flag
          }
        }
        if (unpromotedSlugs.length > 0) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — blog slug(s) not approved for promotion:', unpromotedSlugs.join(', '));
          continue;
        }
      }

      const actionRequest = {
        type: (socialPayload.scheduled_for || socialPayload.schedule_for) ? 'social_post.schedule' : 'social_post.publish',
        platform: socialPayload.platform || 'x',
        payload: {
          text: socialPayload.text || '',
          media: socialPayload.media || [],
          scheduled_for: socialPayload.scheduled_for || socialPayload.schedule_for || null
        },
        created_by: agentId
      };

      // Save to actions store (requires CEO approval)
      const actionsStore = (await storage.getState('actions')) || [];
      const newAction = _createActionFromHeartbeat(actionRequest, agentId);

      // v2.4.4: If agent provided artifact_id, wire up tokens + dependsOn for URL resolution
      if (socialPayload.artifact_id) {
        newAction.tokens = { ARTICLE_URL: { type: 'artifact', id: socialPayload.artifact_id } };
        newAction.dependsOn = [{ type: 'artifact', id: socialPayload.artifact_id }];
        context.log('[Heartbeat]', agentId, 'social action linked to artifact:', socialPayload.artifact_id);
      }

      // Link action to parent task if provided
      if (action.taskId) newAction._parentTaskId = action.taskId;

      actionsStore.push(newAction);
      await storage.setState('actions', actionsStore);

      // Extract first media URL for approval queue preview (if any)
      var _socialPreviewImage = null;
      if (newAction.payload && Array.isArray(newAction.payload.media) && newAction.payload.media.length > 0) {
        var _firstMedia = newAction.payload.media[0];
        _socialPreviewImage = (typeof _firstMedia === 'string') ? _firstMedia : (_firstMedia && _firstMedia.url) || null;
      }

      // Add to approval queue
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      approvalQueue.push({
        id: 'aq-' + newAction.id,
        kind: 'action',
        action_id: newAction.id,
        taskId: action.taskId || null,
        taskTitle: 'Social Post (' + (newAction.platform || 'x') + ')',
        originAgent: agentId,
        classification: newAction.classification,
        riskLevel: newAction.risk_level,
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: (newAction.payload && newAction.payload.text) ? newAction.payload.text.substring(0, 120) : '',
        previewImageUrl: _socialPreviewImage
      });
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);

      // Auto-advance parent task to review if taskId provided
      // Fallback: if no taskId but agent has a matching active task, auto-link
      var socialTaskId = action.taskId || null;
      if (!socialTaskId) {
        var platform = (socialPayload.platform || 'social').toLowerCase();
        var agentActiveTasks = tasks.filter(t => t.assignee === agentId && (t.status === 'todo' || t.status === 'in-progress'));
        var socialKeywords = ['social', 'post', 'linkedin', 'twitter', 'bluesky', 'x post', 'hello world', 'publish', 'announce'];
        var matchingTasks = agentActiveTasks.filter(t => {
          var haystack = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
          return socialKeywords.some(kw => haystack.indexOf(kw) !== -1) || haystack.indexOf(platform) !== -1;
        });
        if (matchingTasks.length === 1) {
          socialTaskId = matchingTasks[0].id;
          context.log('[Heartbeat]', agentId, 'auto-linked social action to task:', socialTaskId, '(fallback match)');
        } else if (matchingTasks.length === 0 && agentActiveTasks.length === 1) {
          socialTaskId = agentActiveTasks[0].id;
          context.log('[Heartbeat]', agentId, 'auto-linked social action to only active task:', socialTaskId);
        }
      }
      if (socialTaskId) {
        var parentIdx = tasks.findIndex(t => t.id === socialTaskId);
        if (parentIdx !== -1 && tasks[parentIdx].status !== 'done' && tasks[parentIdx].status !== 'review') {
          tasks[parentIdx].status = 'review';
          tasks[parentIdx].updatedAt = new Date().toISOString();
          if (!tasks[parentIdx].comments) tasks[parentIdx].comments = [];
          tasks[parentIdx].comments.push({
            id: 'cmt-' + Date.now(),
            author: agentId,
            text: 'Social post created and submitted for CEO approval (action: ' + newAction.id + '). Awaiting CEO decision.',
            type: 'deliverable',
            createdAt: new Date().toISOString()
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', socialTaskId, 'to review (social action created)');
        }
      }

      context.log('[Heartbeat]', agentId, 'created social action:', newAction.id, newAction.type, newAction.platform);
      result.taskUpdates.push({ action: 'social-action-created', actionId: newAction.id, agentId: agentId, taskId: socialTaskId });

    } else if (action.type === 'revise-action' && action.action_id && action.social) {
      // Agent revising a CEO-rejected action — update payload and re-submit for approval
      // Server-side sanitizer: strip deliverable metadata from revised text
      if (action.social.text && /\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up|Peer Review|Notes|Review).*?:\*\*/i.test(action.social.text)) {
        let raw = action.social.text;
        const draftMatch = raw.match(/\*\*LinkedIn Post Draft:\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i)
          || raw.match(/\*\*(?:Post|Draft|Content):\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i);
        if (draftMatch && draftMatch[1].trim().length > 20) {
          raw = draftMatch[1].trim();
        } else {
          const sections = raw.split(/\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up Comment|Peer Review[^*]*|Notes|Review[^*]*):\*\*/i);
          let best = '';
          for (const section of sections) {
            const cleaned = section.replace(/^#{1,4}\s+.*$/gm, '').replace(/^\s*[-–]\s+/gm, '').trim();
            if (cleaned.length > best.length && !/^\s*\*\*/.test(cleaned) && cleaned.length > 20) best = cleaned;
          }
          if (best.length > 20) raw = best;
        }
        raw = raw.replace(/^#{1,4}\s+.*$/gm, '');
        raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1');
        raw = raw.replace(/\*([^*]+)\*/g, '$1');
        raw = raw.replace(/^\s*\*\s+/gm, '');
        raw = raw.replace(/\n{3,}/g, '\n\n').trim();
        action.social.text = raw;
      }
      const revisedText = action.social.text || '';

      // Server-side enforcement: reject revised posts with placeholder brackets
      if (/\[(?:[^\]]*(?:mention|insert|add|include|TBD|link|placeholder|url|website|your |e\.g\.|fill))[^\]]*\]/i.test(revisedText)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED revise-action — contains placeholder brackets:', revisedText.substring(0, 100));
        continue;
      }

      const actionsStore = (await storage.getState('actions')) || [];
      const origIdx = actionsStore.findIndex(a => a.id === action.action_id);
      if (origIdx === -1) {
        context.log('[Heartbeat]', agentId, 'revise-action: action not found:', action.action_id);
        continue;
      }
      const orig = actionsStore[origIdx];

      // Detect if this is a publish_document action
      const _isPublishRevision = (orig.type === 'publish_document' || orig.action_type === 'publish_document');

      // Update payload with revised content
      orig.payload = orig.payload || {};
      if (_isPublishRevision) {
        // For publish_document: update content_md, not payload.text
        orig.payload.content_md = revisedText;
      } else {
        orig.payload.text = revisedText;
      }
      if (action.social.media) orig.payload.media = action.social.media;
      if (action.social.scheduled_for) orig.payload.scheduled_for = action.social.scheduled_for;

      // For publish_document revisions: re-resolve hero image URL from imageAssets
      // (Pixel may have generated the image after the original submit-for-publish)
      let _revHeroImageUrl = orig.payload.hero_image_url || null;
      if (_isPublishRevision) {
        try {
          // Check if the document now has a hero_image_asset_id (Pixel may have updated it)
          const _revDocs = (await storage.getState('documents')) || [];
          const _revDoc = _revDocs.find(d => d.id === (orig.payload.documentId || ''));
          const _revAssetId = (_revDoc && _revDoc.hero_image_asset_id) || orig.payload.hero_image_asset_id || null;
          if (_revAssetId) {
            orig.payload.hero_image_asset_id = _revAssetId;
            const _revImgAssets = (await storage.getState('imageAssets')) || [];
            const _revAsset = _revImgAssets.find(a => a.id === _revAssetId);
            if (_revAsset && _revAsset.url) {
              _revHeroImageUrl = _revAsset.url;
              orig.payload.hero_image_url = _revHeroImageUrl;
            }
          }
        } catch (_revImgErr) { /* non-fatal */ }
      }

      // Reset approval to pending
      orig.approval = orig.approval || {};
      orig.approval.status = 'pending';
      orig.approval.decision_note = null;
      orig.approval.revised_at = new Date().toISOString();
      orig.approval.revision_count = (orig.approval.revision_count || 0) + 1;

      // Reset execution state so it can be re-executed after approval
      orig.execution_status = 'pending';
      if (orig.execution) {
        orig.execution.status = 'pending';
        orig.execution.attempts = 0;
        orig.execution.last_error = null;
      }

      actionsStore[origIdx] = orig;
      await storage.setState('actions', actionsStore);

      // Auto-memory: remember CEO feedback so agent learns from rejections
      const ceoFeedback = (orig.approval && orig.approval.decision_note) || '';
      if (ceoFeedback.length > 5) {
        if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
        var _autoMemNow = new Date();
        _agentMemoryStore[agentId].push({
          id: 'mem_' + Date.now() + '_auto',
          type: 'feedback',
          text: 'CEO rejected my ' + (orig.platform || '') + ' post and said: "' + ceoFeedback.substring(0, 200) + '"',
          source: 'auto:ceo-revision',
          timestamp: _autoMemNow.toISOString(),
          expiresAt: new Date(_autoMemNow.getTime() + L4_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
        });
        if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
          _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
        }
      }

      // Update or re-add to approval queue
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      const aqIdx = approvalQueue.findIndex(q => q.action_id === orig.id);
      // Extract media preview for revised social post
      var _revisedPreviewImage = null;
      if (orig.payload && Array.isArray(orig.payload.media) && orig.payload.media.length > 0) {
        var _rm = orig.payload.media[0];
        _revisedPreviewImage = (typeof _rm === 'string') ? _rm : (_rm && _rm.url) || null;
      }

      // Preserve existing AQ entry fields for publish_document revisions
      const _prevAqEntry = aqIdx !== -1 ? approvalQueue[aqIdx] : {};

      const aqEntry = _isPublishRevision ? {
        // Publish-document-specific AQ entry
        id: aqIdx !== -1 ? _prevAqEntry.id : 'aq-' + orig.id,
        kind: 'action',
        actionType: 'publish_document',
        action_id: orig.id,
        taskId: _prevAqEntry.taskId || null,
        taskTitle: 'Publish: ' + (orig.payload.title || 'Untitled'),
        originAgent: agentId,
        classification: orig.classification || 'executive_required',
        riskLevel: orig.risk_level || 'medium',
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: (orig.payload.content_md || revisedText).substring(0, 120),
        documentId: orig.payload.documentId || _prevAqEntry.documentId || null,
        slug: orig.payload.slug || _prevAqEntry.slug || null,
        docKind: orig.payload.kind || _prevAqEntry.docKind || null,
        artifactId: _prevAqEntry.artifactId || null,
        heroImageUrl: _revHeroImageUrl,
        heroImageAssetId: orig.payload.hero_image_asset_id || _prevAqEntry.heroImageAssetId || null,
        revisionCount: orig.approval.revision_count || 0
      } : {
        // Social post AQ entry (original behavior)
        id: aqIdx !== -1 ? _prevAqEntry.id : 'aq-' + orig.id,
        kind: 'action',
        action_id: orig.id,
        taskId: null,
        taskTitle: 'Social Post (' + (orig.platform || 'x') + ')',
        originAgent: agentId,
        classification: orig.classification || 'standard',
        riskLevel: orig.risk_level || 'medium',
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: revisedText.substring(0, 120),
        previewImageUrl: _revisedPreviewImage,
        revisionCount: orig.approval.revision_count || 0
      };
      if (aqIdx !== -1) {
        approvalQueue[aqIdx] = aqEntry;
      } else {
        approvalQueue.push(aqEntry);
      }
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);

      context.log('[Heartbeat]', agentId, 'revised action:', orig.id, '| revision #' + orig.approval.revision_count);
      result.taskUpdates.push({ action: 'action-revised', actionId: orig.id, agentId: agentId });

    } else if (action.type === 'comment-task' && action.taskId && action.comment) {
      // Comment dedup: skip if same agent posted a similar comment on this task in last 2 hours
      const targetTask = tasks.find(t => t.id === action.taskId);
      const recentComments = (targetTask && Array.isArray(targetTask.comments)) ? targetTask.comments : [];
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const commentText = String(action.comment).toLowerCase().trim();

      // Guard 1: Max 3 comments per agent per task (prevents spam loops)
      const agentCommentCount = recentComments.filter(c => (c.user || c.author || '') === agentId).length;
      if (agentCommentCount >= 3) {
        context.log('[Heartbeat]', agentId, 'comment-task SKIPPED (agent already has', agentCommentCount, 'comments on task:', action.taskId, ')');
        continue;
      }

      // Guard 2: Similarity dedup — skip if same agent posted 60%+ similar comment in last 2 hours
      const isDuplicate = recentComments.some(c => {
        if ((c.user || c.author || '') !== agentId) return false;
        const ts = c.createdAt || c.created_at || c.timestamp || null;
        if (ts && new Date(ts).getTime() < twoHoursAgo) return false;
        const existing = String(c.text || c.comment || c.body || '').toLowerCase().trim();
        const wordsA = commentText.split(/\s+/);
        const wordsB = new Set(existing.split(/\s+/));
        const overlap = wordsA.filter(w => wordsB.has(w)).length;
        return overlap >= wordsA.length * 0.6;
      });

      // Guard 3: Block follow-up/waiting loop patterns (any agent who already asked about the same thing)
      const isFollowUpLoop = /\b(still waiting|still awaiting|checking in|following up|just checking|any update|provide.*update|firm eta|appendix)\b/i.test(commentText) &&
        recentComments.some(c => {
          if ((c.user || c.author || '') !== agentId) return false;
          const existing = String(c.text || c.comment || c.body || '').toLowerCase();
          return /\b(waiting|awaiting|checking|following|update|appendix)\b/.test(existing);
        });

      // Guard 4: Block Nova re-delegation spam — if Nova already delegated this task (has a comment)
      // and the task is assigned to another agent with active status, no need to re-delegate
      const isDelegationSpam = agentId === 'nova' && targetTask &&
        targetTask.assignee && targetTask.assignee !== 'nova' &&
        (targetTask.status === 'todo' || targetTask.status === 'in-progress' || targetTask.status === 'review') &&
        recentComments.some(c => (c.user || c.author || '') === 'nova' && c.type !== 'system');

      if (isDuplicate || isFollowUpLoop || isDelegationSpam) {
        context.log('[Heartbeat]', agentId, 'comment-task SKIPPED (' + (isDelegationSpam ? 'delegation-spam' : isFollowUpLoop ? 'follow-up loop' : 'duplicate') + ' comment) on task:', action.taskId);
      } else {
        result.taskUpdates.push({
          action: 'comment',
          taskId: action.taskId,
          comment: action.comment,
          agentId: agentId
        });
      }
    } else if (action.type === 'review-task' && action.taskId) {
      // Review: agent reviews another agent's deliverable (costs 1 extra Gemini call)
      const task = tasks.find(t => t.id === action.taskId && t.status === 'review');
      if (task) {
        const review = await reviewTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext);
        result.geminiCalls++;
        if (review) {
          result.taskUpdates.push({
            action: 'review',
            taskId: action.taskId,
            review: review,
            agentId: agentId
          });
        }
      }
    } else if (action.type === 'create-doc' && action.document) {
      // Create a documentation draft — stored in documents store
      const docPayload = action.document;
      const VALID_DOC_KINDS = ['spec', 'runbook', 'release_notes', 'product_brief', 'marketing_post', 'governance'];
      const kind = docPayload.kind || 'product_brief';

      if (docPayload.title && VALID_DOC_KINDS.indexOf(kind) !== -1) {
        // FIX: Block create-doc on social-copy tasks — Scribe must use execute-task for social copy, not create-doc
        // Creating a marketing_post doc for social copy triggers hero image cascade (the entire bug chain)
        if (action.taskId) {
          const _originTask = tasks.find(t => t.id === action.taskId);
          const _isSocialCopyTask = _originTask && (
            (_originTask.tags && _originTask.tags.indexOf('social-copy') !== -1) ||
            ((_originTask.title || '').indexOf('Write social copy for:') === 0)
          );
          if (_isSocialCopyTask) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc on social-copy task:', action.taskId, '— use execute-task for social copy, not create-doc');
            if (action.taskId) {
              result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] create-doc blocked on social copy task. Use execute-task to produce your social copy deliverable, not create-doc.', agentId: 'system' });
            }
            break;
          }
        }

        // GUARD: Require task linkage — no orphan doc creation
        if (!action.taskId) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-doc without task linkage — orphan docs not allowed. Title:', docPayload.title);
          break;
        }

        // GUARD: Max 1 doc per agent per heartbeat cycle
        const _docsCreatedThisCycle = result.taskUpdates.filter(u => u.action === 'doc-created' && u.agentId === agentId).length;
        if (_docsCreatedThisCycle >= 1) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-doc — already created', _docsCreatedThisCycle, 'doc(s) this cycle. Title:', docPayload.title);
          result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Doc creation limit reached (1 per heartbeat cycle). Try again next cycle.', agentId: 'system' });
          break;
        }

        // Fix 11: Hard caps on unpublished documents by kind
        const existingDocs = (await storage.getState('documents')) || [];
        const INTERNAL_KINDS = ['spec', 'runbook', 'release_notes', 'governance'];
        const EXTERNAL_KINDS = ['marketing_post', 'product_brief'];
        const _isInternalKind = INTERNAL_KINDS.indexOf(kind) !== -1;
        const _isExternalKind = EXTERNAL_KINDS.indexOf(kind) !== -1;

        // Fix 11a: Internal docs — hard cap at 5 unpublished, must be GridOS/operational subject matter
        if (_isInternalKind) {
          const _activeInternalDocs = existingDocs.filter(d =>
            INTERNAL_KINDS.indexOf(d.kind) !== -1 &&
            d.status !== 'published' && d.status !== 'rejected' && d.status !== 'archived'
          );
          if (_activeInternalDocs.length >= 5) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (internal) — hard cap reached:', _activeInternalDocs.length, 'active internal docs. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Internal doc cap reached (5 max). Publish or archive existing internal docs first.', agentId: 'system' });
            break;
          }
          // Subject matter gate: internal docs must be about GridOS, system operations, or technical reference
          const _docText = ((docPayload.title || '') + ' ' + (docPayload.content_md || '').substring(0, 500)).toLowerCase();
          const _isGridOSTopic = /gridos|gridops|heartbeat|agent|orchestrat|governance|storage|pipeline|api|function|deployment|architecture|config|escalation|triage|approval|execution|workflow|system|technical|reference|runbook|spec|schema|endpoint/.test(_docText);
          if (!_isGridOSTopic) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (internal) — not GridOS/operational subject matter. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Internal docs (spec/runbook/governance) are for GridOS technical reference only. For marketing/blog content, use kind: marketing_post.', agentId: 'system' });
            break;
          }
        }

        // Fix 11b: External docs — hard cap at 5 unpublished drafts
        if (_isExternalKind) {
          const _activeExternalDocs = existingDocs.filter(d =>
            EXTERNAL_KINDS.indexOf(d.kind) !== -1 &&
            d.status !== 'published' && d.status !== 'rejected' && d.status !== 'archived'
          );
          if (_activeExternalDocs.length >= 5) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (external) — hard cap reached:', _activeExternalDocs.length, 'unpublished external docs. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] External doc cap reached (5 max unpublished). CEO must publish or discard existing drafts before new ones can be created.', agentId: 'system' });
            break;
          }
        }

        // Fix 11b: Fuzzy title dedup — word-overlap similarity blocks near-duplicate titles
        const _proposedDocTitle = (docPayload.title || '').toLowerCase().trim();
        const _proposedWords = _proposedDocTitle.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
        const duplicateDoc = existingDocs.find(d => {
          if (!d.title) return false;
          if (d.status === 'rejected' || d.status === 'archived') return false;
          const existTitle = d.title.toLowerCase().trim();
          // Exact match
          if (existTitle === _proposedDocTitle) {
            if (action.taskId && d.taskId && action.taskId !== d.taskId) return false;
            if (action.taskId && !d.taskId) return false;
            return true;
          }
          // Fuzzy match: >60% word overlap blocks creation
          if (_proposedWords.length >= 3) {
            const _existWords = existTitle.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
            if (_existWords.length >= 3) {
              const _overlap = _proposedWords.filter(w => _existWords.indexOf(w) !== -1).length;
              const _similarity = _overlap / Math.max(_proposedWords.length, _existWords.length);
              if (_similarity > 0.6) {
                // Still allow different-task linkage
                if (action.taskId && d.taskId && action.taskId !== d.taskId) return false;
                if (action.taskId && !d.taskId) return false;
                return true;
              }
            }
          }
          return false;
        });
        if (duplicateDoc) {
          context.log('[Heartbeat]', agentId, 'BLOCKED duplicate doc creation:', _proposedDocTitle, '— fuzzy matches existing doc:', duplicateDoc.id, duplicateDoc.title);
          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Document already exists with similar title: "' + duplicateDoc.title + '" (id: ' + duplicateDoc.id + '). Use update-doc to revise it instead of creating a duplicate.',
              agentId: agentId
            });
          }
          break;
        }

        const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        const doc = {
          id: docId,
          title: docPayload.title,
          kind: kind,
          status: 'draft',
          tags: Array.isArray(docPayload.tags) ? docPayload.tags : [],
          created_by: agentId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          content_md: docPayload.content_md || '',
          promote: false,
          taskId: action.taskId || null,
          source: { action_id: null, task_id: action.taskId || null }
        };

        const docsStore = (await storage.getState('documents')) || [];
        docsStore.push(doc);
        if (docsStore.length > 500) docsStore.splice(0, docsStore.length - 500);
        await storage.setState('documents', docsStore);

        context.log('[Heartbeat]', agentId, 'created doc draft:', doc.id, doc.title);
        result.taskUpdates.push({ action: 'doc-created', documentId: doc.id, agentId: agentId });

        // Link doc back to the originating task: add comment + move to review
        const _isVisualKind = ['marketing_post', 'product_brief'].indexOf(kind) !== -1;
        if (action.taskId) {
          result.taskUpdates.push({
            action: 'comment',
            taskId: action.taskId,
            comment: _isVisualKind
              ? 'Document created: "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + '). Awaiting hero image from Pixel before submitting for publish.'
              : 'Document created: "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + '). Submitting for CEO approval.',
            agentId: agentId
          });
          // Only move if task isn't already in a later stage (prevents race: execute→review then create-doc→in-progress)
          const _cdCurrentTask = tasks.find(t => t.id === action.taskId);
          const _cdCurrentStatus = _cdCurrentTask ? _cdCurrentTask.status : '';
          const _cdTargetStatus = _isVisualKind ? 'in-progress' : 'review';
          const _cdAlreadyAdvanced = (_cdCurrentStatus === 'review' || _cdCurrentStatus === 'done');
          if (!_cdAlreadyAdvanced) {
            result.taskUpdates.push({
              action: 'move',
              taskId: action.taskId,
              newStatus: _cdTargetStatus
            });
          } else {
            context.log('[Heartbeat]', agentId, 'create-doc: skipping status move — task', action.taskId, 'already in', _cdCurrentStatus, '(would have moved to', _cdTargetStatus + ')');
          }
        }

        // Visual doc kinds: auto-create Pixel hero image task instead of auto-submitting for publish
        // Doc stays in draft until Pixel generates the hero image, then Scribe submits in a future heartbeat
        const VISUAL_DOC_KINDS = ['marketing_post', 'product_brief'];
        context.log('[Heartbeat] HERO-DIAG:', agentId, 'doc kind:', kind, 'isVisual:', VISUAL_DOC_KINDS.indexOf(kind) !== -1, 'docId:', doc.id, 'taskId:', action.taskId || 'NONE');
        if (action.taskId) {
          result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[DIAG] create-doc fired — kind: ' + kind + ', isVisual: ' + (VISUAL_DOC_KINDS.indexOf(kind) !== -1) + ', docId: ' + doc.id, agentId: 'system' });
        }
        // SPAWN GUARD: do not spawn hero tasks from auto-created source tasks (prevents auto→auto chains)
        const _cdSourceTask = action.taskId ? tasks.find(t => t.id === action.taskId) : null;
        const _cdSourceAutoCreated = _cdSourceTask && _cdSourceTask.tags && _cdSourceTask.tags.indexOf('auto-created') !== -1;
        if (VISUAL_DOC_KINDS.indexOf(kind) !== -1 && agentId === 'scribe' && !_cdSourceAutoCreated) {
          // Only Scribe-created visual docs trigger hero image tasks (prevents ops/engineering docs from spawning hero tasks)
          // FIX 5: Stronger dedup — check by title substring match, not just exact title or doc ID
          // Prevents multiple hero tasks when the same blog post has multiple doc records
          const _heroTaskTitle = 'Generate hero image for: ' + stripTaskPrefixes(doc.title);
          const _heroNormTitle = doc.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
          const _heroTaskExists = tasks.some(t => {
            if (t.assignee !== 'pixel' || t.status === 'done') return false;
            if (t.title === _heroTaskTitle) return true;
            if (t.description && t.description.indexOf(doc.id) !== -1) return true;
            // Fuzzy: any active Pixel hero task whose title contains the same blog title words
            if ((t.title || '').indexOf('Generate hero image for:') === 0) {
              const _existHeroNorm = t.title.replace('Generate hero image for: ', '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
              if (_existHeroNorm === _heroNormTitle) return true;
              // Check if one contains the other (handles "Write our first blog post: Hello World" vs "Hello World")
              if (_heroNormTitle.length > 10 && (_existHeroNorm.indexOf(_heroNormTitle) !== -1 || _heroNormTitle.indexOf(_existHeroNorm) !== -1)) return true;
            }
            return false;
          });

          context.log('[Heartbeat] HERO-DIAG:', agentId, 'heroTaskExists:', _heroTaskExists, 'heroTitle:', _heroTaskTitle);
          if (action.taskId) {
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[DIAG] hero dedup check — exists: ' + _heroTaskExists + ', looking for: ' + _heroTaskTitle, agentId: 'system' });
          }
          if (!_heroTaskExists) {
            // Create a task for Pixel to generate the hero image
            const heroTask = {
              id: 'task_' + Date.now() + '_hero_' + Math.random().toString(36).substr(2, 4),
              title: _heroTaskTitle,
              description: 'Generate a hero image for the blog post "' + doc.title + '".\nDocument ID: ' + doc.id + '\nUse generate-image with purpose "blog_header" and attachTo: { type: "document", id: "' + doc.id + '" }.\nChoose an appropriate preset based on the content tone.',
              taskType: 'design_asset',
              status: 'todo',
              priority: action.task && action.task.priority ? action.task.priority : 'high',
              dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
              assignee: 'pixel',
              source: 'heartbeat',
              created_by: 'system',
              parent_task_id: action.taskId || null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              campaign_id: action.campaign_id || null,
              objective_id: action.objective_id || (action.task && action.task.objective_id) || null,
              tags: ['hero-image', 'auto-created', 'visual-workflow'],
              comments: [{
                id: 'cmt-hero-' + Date.now(),
                author: 'nova',
                text: 'Pixel, generate a hero image for the blog post "' + doc.title + '" (doc: ' + doc.id + ', kind: ' + kind + '). Use generate-image with purpose blog_header and attachTo the document. Choose a preset that matches the content tone.',
                type: 'system',
                createdAt: new Date().toISOString()
              }]
            };
            tasks.push(heroTask);
            context.log('[Heartbeat]', agentId, 'AUTO-CREATED Pixel hero image task:', heroTask.id, 'for doc:', doc.id);
          } else {
            context.log('[Heartbeat]', agentId, 'Pixel hero image task already exists for doc:', doc.id, '— skipping auto-create');
          }

          // Mark doc as awaiting hero image
          doc.awaiting_hero_image = true;
          doc.updated_at = new Date().toISOString();
          const _awIdx = docsStore.findIndex(d => d.id === docId);
          if (_awIdx !== -1) docsStore[_awIdx] = doc;
          await storage.setState('documents', docsStore);

          // Comment on the originating task
          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Doc created but NOT submitted for publish yet — waiting for Pixel to generate a hero image (doc: ' + doc.id + '). Publish will happen after the hero image is attached.',
              agentId: 'system'
            });
          }

          context.log('[Heartbeat]', agentId, 'visual doc created — deferred publish, awaiting Pixel hero image:', doc.id, doc.title);
        } else {
          // Internal doc kinds (spec, runbook, release_notes, governance) — require CEO approval before publish
          const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          doc.status = 'ready_for_approval';
          doc.slug = slug;
          doc.visibility = 'internal';
          doc.updated_at = new Date().toISOString();
          doc.submitted_by = agentId;
          const dIdx = docsStore.findIndex(d => d.id === docId);
          if (dIdx !== -1) docsStore[dIdx] = doc;
          await storage.setState('documents', docsStore);

          // Create publish_document action (requires CEO approval)
          const internalPubAction = {
            id: 'act_pub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            created_at: new Date().toISOString(),
            created_by: agentId,
            type: 'publish_document',
            platform: 'site',
            payload: {
              documentId: doc.id,
              title: doc.title,
              slug: slug,
              kind: doc.kind,
              content_md: doc.content_md,
              target_path: '/docs/published/' + slug,
              public_url: '/docs/published/' + slug,
              hero_image_asset_id: null,
              hero_image_url: null,
              missing_hero_image: false
            },
            classification: 'advisory',
            requires_ceo_approval: true,
            risk_level: 'low',
            brand_impact: 'low',
            budget_impact: 0,
            approval: {
              status: 'pending',
              approved_by: null,
              approved_at: null,
              decision_note: null
            },
            execution: {
              status: 'pending',
              started_at: null,
              finished_at: null,
              attempts: 0,
              last_error: null,
              receipt: null
            },
            action_type: 'publish_document',
            action_category: 'content',
            execution_status: 'pending',
            origin_agent: agentId,
            action_payload: { documentId: doc.id, title: doc.title, slug: slug },
            requires_approval: true,
            is_irreversible: false,
            bundle_id: null
          };

          const internalActionsStore = (await storage.getState('actions')) || [];
          internalActionsStore.push(internalPubAction);
          if (internalActionsStore.length > 500) internalActionsStore.splice(0, internalActionsStore.length - 500);
          await storage.setState('actions', internalActionsStore);

          context.log('[Heartbeat]', agentId, 'internal doc submitted for CEO approval:', doc.id, doc.title, '→ action:', internalPubAction.id);
          result.taskUpdates.push({ action: 'doc-pending-approval', documentId: doc.id, agentId: agentId, actionId: internalPubAction.id });

          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Document "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + ') submitted for CEO approval before publishing to /docs/published/' + slug,
              agentId: agentId
            });
            result.taskUpdates.push({
              action: 'move',
              taskId: action.taskId,
              newStatus: 'review'
            });
          }
        }
      }
    } else if (action.type === 'update-doc' && action.documentId) {
      // Update an existing document's content or metadata
      const docsStore = (await storage.getState('documents')) || [];
      const docIdx = docsStore.findIndex(d => d.id === action.documentId);

      if (docIdx !== -1) {
        const doc = docsStore[docIdx];
        const updates = action.updates || {};
        if (updates.content_md) doc.content_md = updates.content_md;
        if (updates.title) {
          doc.title = updates.title;
          doc.slug = updates.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        }
        if (updates.tags) doc.tags = updates.tags;
        if (updates.append_md && doc.content_md) {
          doc.content_md = doc.content_md + '\n\n' + updates.append_md;
        }
        doc.updated_at = new Date().toISOString();
        doc.last_edited_by = agentId;
        docsStore[docIdx] = doc;
        await storage.setState('documents', docsStore);

        // If doc is published internally, also update the publishedDocs store
        if (doc.visibility === 'internal' && doc.status === 'published' && doc.slug) {
          const pubStore = (await storage.getState('publishedDocs')) || [];
          const pubIdx = pubStore.findIndex(p => p.documentId === doc.id);
          if (pubIdx !== -1) {
            pubStore[pubIdx].content_md = doc.content_md;
            pubStore[pubIdx].title = doc.title;
            pubStore[pubIdx].tags = doc.tags || [];
            pubStore[pubIdx].updated_at = doc.updated_at;
            if (updates.title) {
              pubStore[pubIdx].slug = doc.slug;
              pubStore[pubIdx].target_path = '/docs/published/' + doc.slug;
              pubStore[pubIdx].public_url = '/docs/published/' + doc.slug;
            }
            await storage.setState('publishedDocs', pubStore);
          }
        }

        context.log('[Heartbeat]', agentId, 'updated doc:', doc.id, doc.title);
        result.taskUpdates.push({ action: 'doc-updated', documentId: doc.id, agentId: agentId });
      } else {
        context.log('[Heartbeat]', agentId, 'update-doc failed — doc not found:', action.documentId);
      }

    } else if (action.type === 'submit-for-publish' && action.documentId) {
      // Submit a document for human approval + publish
      // GUARDRAIL: No agent can directly publish — this only creates a publish_document action
      // that requires CEO/human approval before execution.
      const docsStore = (await storage.getState('documents')) || [];
      const docIdx = docsStore.findIndex(d => d.id === action.documentId);

      if (docIdx !== -1) {
        const doc = docsStore[docIdx];

        // Only drafts or review docs can be submitted for publish
        if (doc.status === 'draft' || doc.status === 'review') {
          // Dedup: skip if a pending publish action already exists for this document
          const existingActs = (await storage.getState('actions')) || [];
          const hasPendingPub = existingActs.some(a => a.type === 'publish_document' && a.payload && a.payload.documentId === doc.id && a.approval && a.approval.status === 'pending');
          if (hasPendingPub) {
            context.log('[Heartbeat] Skipping duplicate submit-for-publish for doc:', doc.id, doc.title);
            break;
          }

          // Hard guardrail: BLOCK submit-for-publish on visual doc kinds without hero image
          const VISUAL_KINDS = ['marketing_post', 'product_brief'];
          if (VISUAL_KINDS.indexOf(doc.kind) !== -1 && !doc.hero_image_asset_id) {
            context.log('[Heartbeat]', agentId, 'BLOCKED submit-for-publish on', doc.kind, 'doc without hero_image_asset_id:', doc.id, doc.title, '— waiting for Pixel hero image');
            docsStore[docIdx].missing_hero_image = true;
            await storage.setState('documents', docsStore);
            // Notify via task comment
            if (action.taskId) {
              result.taskUpdates.push({
                action: 'comment',
                taskId: action.taskId,
                comment: 'Publish BLOCKED: doc "' + doc.title + '" (' + doc.id + ') is a ' + doc.kind + ' and has no hero image yet. Waiting for Pixel to generate one. Submit again after hero_image_asset_id is set.',
                agentId: 'system'
              });
            }
            break;
          }

          // Update doc status
          docsStore[docIdx].status = 'ready_for_approval';
          docsStore[docIdx].updated_at = new Date().toISOString();
          docsStore[docIdx].submitted_by = agentId;
          await storage.setState('documents', docsStore);

          // Generate slug from title
          const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

          // Route based on doc kind: marketing_post/product_brief → public blog, others → internal docs
          const PUBLIC_KINDS = ['marketing_post', 'product_brief'];
          const isPublic = PUBLIC_KINDS.indexOf(doc.kind) !== -1;
          const pubTargetPath = isPublic ? '/blog/' + slug : '/docs/published/' + slug;
          const pubPublicUrl = isPublic ? '/blog/' + slug : '/docs/published/' + slug;

          // Create publish_document action (requires CEO approval)
          const publishAction = {
            id: 'act_pub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            created_at: new Date().toISOString(),
            created_by: agentId,
            type: 'publish_document',
            platform: 'site',
            payload: {
              documentId: doc.id,
              title: doc.title,
              slug: slug,
              kind: doc.kind,
              content_md: doc.content_md,
              target_path: pubTargetPath,
              public_url: pubPublicUrl,
              hero_image_asset_id: doc.hero_image_asset_id || null,
              hero_image_url: null, // resolved below after imageAssets lookup
              missing_hero_image: (!doc.hero_image_asset_id && VISUAL_KINDS.indexOf(doc.kind) !== -1) || false
            },
            classification: 'executive_required',
            requires_ceo_approval: true,
            risk_level: 'medium',
            brand_impact: 'medium',
            budget_impact: 0,
            approval: {
              status: 'pending',
              approved_by: null,
              approved_at: null,
              decision_note: null
            },
            execution: {
              status: 'pending',
              started_at: null,
              finished_at: null,
              attempts: 0,
              last_error: null,
              receipt: null
            },
            // Legacy compat fields
            action_type: 'publish_document',
            action_category: 'content',
            execution_status: 'pending',
            origin_agent: agentId,
            action_payload: { documentId: doc.id, title: doc.title, slug: slug },
            requires_approval: true,
            is_irreversible: true,
            bundle_id: null
          };

          // Save action to actions store
          const actionsStore = (await storage.getState('actions')) || [];
          actionsStore.push(publishAction);
          if (actionsStore.length > 500) actionsStore.splice(0, actionsStore.length - 500);
          await storage.setState('actions', actionsStore);

          // v2.4.4: Register draft artifact for URL resolution
          const sfpArtifactId = 'art_' + Date.now() + '_' + slug;
          const sfpArtifacts = (await storage.getState('ap_artifacts')) || [];
          sfpArtifacts.push({
            id: sfpArtifactId,
            type: 'article',
            title: doc.title,
            slug: slug,
            url: null,
            status: 'draft',
            createdAt: new Date().toISOString(),
            publishedAt: null,
            source: { type: 'submit-for-publish', agentId: agentId, taskId: action.taskId || null },
            actionId: publishAction.id,
            documentId: doc.id
          });
          if (sfpArtifacts.length > 200) sfpArtifacts.splice(0, sfpArtifacts.length - 200);
          await storage.setState('ap_artifacts', sfpArtifacts);
          context.log('[Heartbeat] Registered draft artifact:', sfpArtifactId, 'for submit-for-publish action:', publishAction.id);

          // Resolve hero image URL from imageAssets store (for approval queue + drawer preview)
          let _heroImageUrl = null;
          if (doc.hero_image_asset_id) {
            try {
              const _imgAssets = (await storage.getState('imageAssets')) || [];
              const _heroAsset = _imgAssets.find(a => a.id === doc.hero_image_asset_id);
              if (_heroAsset && _heroAsset.url) _heroImageUrl = _heroAsset.url;
            } catch (_heroErr) { /* non-fatal */ }
          }
          // Backfill resolved URL into action payload so actions drawer can render it
          if (_heroImageUrl) {
            publishAction.payload.hero_image_url = _heroImageUrl;
            // Re-save action with resolved hero image URL (action was persisted before URL resolution)
            const _actStore2 = (await storage.getState('actions')) || [];
            const _actIdx2 = _actStore2.findIndex(x => x.id === publishAction.id);
            if (_actIdx2 !== -1) { _actStore2[_actIdx2] = publishAction; await storage.setState('actions', _actStore2); }
          }

          // Add to CEO approval queue
          const approvalQueue = (await storage.getState('approvalQueue')) || [];
          approvalQueue.push({
            id: 'aq-' + publishAction.id,
            kind: 'action',
            actionType: 'publish_document',
            action_id: publishAction.id,
            taskId: action.taskId || null,
            taskTitle: 'Publish: ' + doc.title,
            originAgent: agentId,
            classification: 'executive_required',
            riskLevel: 'medium',
            budgetImpact: 0,
            brandImpact: 'medium',
            status: 'pending',
            timestamp: publishAction.created_at,
            preview: (doc.content_md || '').substring(0, 120),
            documentId: doc.id,
            slug: slug,
            docKind: doc.kind,
            artifactId: sfpArtifactId,
            heroImageUrl: _heroImageUrl,
            heroImageAssetId: doc.hero_image_asset_id || null
          });
          if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
          await storage.setState('approvalQueue', approvalQueue);

          // Audit log
          const auditLog = (await storage.getState('actionAuditLog')) || [];
          auditLog.push({
            id: 'alog-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            type: 'publish-requested',
            data: {
              actionId: publishAction.id,
              documentId: doc.id,
              title: doc.title,
              slug: slug,
              submittedBy: agentId,
              taskId: action.taskId || null
            },
            timestamp: new Date().toISOString()
          });
          if (auditLog.length > 500) auditLog.splice(0, auditLog.length - 500);
          await storage.setState('actionAuditLog', auditLog);

          // Governance log
          const govLog = (await storage.getState('governanceLog')) || [];
          govLog.push({
            id: 'gov-' + Date.now(),
            type: 'publish-requested',
            data: {
              actionId: publishAction.id,
              documentId: doc.id,
              title: doc.title,
              agent: agentId
            },
            timestamp: new Date().toISOString()
          });
          if (govLog.length > 200) govLog.splice(0, govLog.length - 200);
          await storage.setState('governanceLog', govLog);

          context.log('[Heartbeat]', agentId, 'submitted doc for publish:', doc.id, doc.title, '→ action:', publishAction.id);
          result.taskUpdates.push({ action: 'publish-requested', actionId: publishAction.id, documentId: doc.id, agentId: agentId });
        } else {
          context.log('[Heartbeat]', agentId, 'cannot submit doc for publish — status is', doc.status);
        }
      }
    } else if (action.type === 'create-content-package' && action.content) {
      // Agent-initiated image content generation — routes through approval queue
      // GATE: only Echo (marketing visuals) and Pixel (design assets) can generate content
      const CONTENT_ALLOWED_AGENTS = ['echo', 'pixel'];
      if (CONTENT_ALLOWED_AGENTS.indexOf(agentId) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-content-package (only Echo/Pixel can generate images)');
        continue;
      }

      // Guardrail: max 1 content generation per heartbeat per agent
      if ((result.contentGenerates || 0) >= GUARDRAILS.maxContentGeneratesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max content generates reached, skipping');
        continue;
      }

      const cp = action.content;
      const cpTopic = (cp.topic || '').trim();
      const cpGoal = (cp.goal || '').trim();
      if (!cpTopic || cpTopic.length < 3 || !cpGoal || cpGoal.length < 3) {
        context.log('[Heartbeat]', agentId, 'create-content-package SKIPPED: topic/goal too short');
        continue;
      }

      // Load config defaults
      let _ceConfig = null;
      try { _ceConfig = await imageEngine.loadContentEngineConfig(); } catch (e) { /* use hardcoded defaults */ }

      const cpPreset = (cp.preset || (_ceConfig && _ceConfig.defaultPreset) || 'ap-neon-glass').trim();
      let cpOutputs = cp.outputs || (_ceConfig && _ceConfig.defaultOutputs) || ['x_image'];
      const cpVariations = Math.min(Math.max(parseInt(cp.variations) || 1, 1), 2); // agents capped at 2 variations

      // Validate preset
      if (!imageEngine.PRESETS || !imageEngine.PRESETS[cpPreset]) {
        context.log('[Heartbeat]', agentId, 'create-content-package SKIPPED: invalid preset:', cpPreset);
        continue;
      }

      // Validate & filter outputs
      if (imageEngine.PURPOSES) {
        cpOutputs = cpOutputs.filter(function (o) { return !!imageEngine.PURPOSES[o]; });
      }
      if (cpOutputs.length === 0) cpOutputs = ['x_image'];
      // Cap agent output types to 3 max
      if (cpOutputs.length > 3) cpOutputs = cpOutputs.slice(0, 3);

      // Usage limit check
      const accountId = 'ambientpixels-internal';
      try {
        const limitCheck = await imageEngine.checkUsageLimits(accountId);
        if (!limitCheck.allowed) {
          context.log('[Heartbeat]', agentId, 'create-content-package BLOCKED: usage limit exceeded');
          continue;
        }
      } catch (limErr) {
        context.log('[Heartbeat]', agentId, 'create-content-package: usage check failed, proceeding:', limErr.message);
      }

      context.log('[Heartbeat]', agentId, 'generating content package:', cpTopic, '| preset:', cpPreset, '| outputs:', cpOutputs.join(','), '| variations:', cpVariations);
      const genStartMs = Date.now();

      // Create brief
      const cpBriefId = 'brief_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const cpBrief = {
        id: cpBriefId,
        createdAt: new Date().toISOString(),
        createdBy: agentId,
        source: 'heartbeat',
        topic: cpTopic,
        goal: cpGoal,
        preset: cpPreset,
        outputs: cpOutputs,
        variations: cpVariations,
        status: 'generating',
        directiveId: (cp.directiveId || '').trim() || null,
        objectiveId: (cp.objectiveId || '').trim() || null
      };
      await imageEngine.saveBrief(cpBrief);

      // Generate images
      const cpPackageId = 'pkg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const cpAllOutputs = {};
      const cpThumbUrls = [];
      let cpSuccessCount = 0;
      let cpFailedCount = 0;

      for (let v = 0; v < cpVariations; v++) {
        for (let i = 0; i < cpOutputs.length; i++) {
          const outputType = cpOutputs[i];
          const outputKey = cpVariations > 1 ? outputType + '_v' + (v + 1) : outputType;
          const variationNum = v + 1;
          const prompt = imageEngine.buildPrompt({
            topic: cpTopic, goal: cpGoal, preset: cpPreset,
            outputType: outputType, variation: variationNum
          });
          try {
            context.log('[Heartbeat]', agentId, 'generating', outputKey);
            const genResult = await imageEngine.generateImage({
              topic: cpTopic, goal: cpGoal, preset: cpPreset,
              outputType: outputType, variation: variationNum,
              jobId: cpPackageId + '_' + outputKey
            });
            cpAllOutputs[outputKey] = {
              status: 'success', outputType: outputType, variation: variationNum,
              size: genResult.size, imageUrl: genResult.imageUrl, thumbUrl: genResult.thumbUrl,
              metaUrl: genResult.metaUrl, model: genResult.model, bytes: genResult.bytes, promptUsed: prompt
            };
            cpThumbUrls.push(genResult.thumbUrl);
            cpSuccessCount++;
          } catch (genErr) {
            context.log.error('[Heartbeat]', agentId, 'content gen failed:', outputKey, genErr.message);
            cpAllOutputs[outputKey] = {
              status: 'failed', outputType: outputType, variation: variationNum,
              error: genErr.message, promptUsed: prompt
            };
            cpFailedCount++;
          }
        }
      }

      // Total failure
      if (cpSuccessCount === 0) {
        cpBrief.status = 'failed';
        cpBrief.updatedAt = new Date().toISOString();
        await imageEngine.saveBrief(cpBrief);
        context.log('[Heartbeat]', agentId, 'content package generation FAILED (all images failed)');
        continue;
      }

      // Save package
      const cpDurationMs = Date.now() - genStartMs;
      const cpOverallStatus = cpFailedCount === 0 ? 'pending_approval' : 'partial_success';
      const cpPkg = {
        id: cpPackageId, briefId: cpBriefId,
        createdAt: new Date().toISOString(), generatedBy: agentId, createdBy: agentId,
        agentRole: agent.role, source: 'heartbeat', createdVia: 'heartbeat',
        directiveId: cpBrief.directiveId, objectiveId: cpBrief.objectiveId,
        accountId: accountId, accountType: 'internal',
        engineVersion: imageEngine.ENGINE_VERSION, preset: cpPreset,
        presetVersion: imageEngine.getPresetVersion(cpPreset),
        variations: cpVariations, outputs: cpAllOutputs,
        promptSummary: ('Topic: ' + cpTopic + ' — ' + cpGoal + ' (' + cpPreset + ')').substring(0, 140),
        status: cpOverallStatus, successCount: cpSuccessCount, failedCount: cpFailedCount,
        durationMs: cpDurationMs, estimatedCost: imageEngine.estimateCost(cpSuccessCount),
        model: imageEngine.GEMINI_IMAGE_MODEL, provider: imageEngine.GEMINI_IMAGE_PROVIDER
      };
      const cpPackageUrl = await imageEngine.savePackage(cpPkg);

      // Update brief
      cpBrief.status = cpOverallStatus;
      cpBrief.packageId = cpPackageId;
      cpBrief.updatedAt = new Date().toISOString();
      await imageEngine.saveBrief(cpBrief);

      // Submit to approval queue
      const cpSuccessImageUrls = [];
      Object.keys(cpAllOutputs).forEach(function (k) {
        if (cpAllOutputs[k].status === 'success' && cpAllOutputs[k].imageUrl) cpSuccessImageUrls.push(cpAllOutputs[k].imageUrl);
      });

      const cpApprovalItem = {
        id: 'aq-' + cpPackageId, kind: 'content.package', type: 'content.package',
        title: 'Content Package — ' + cpTopic,
        subtitle: cpSuccessCount + ' image' + (cpSuccessCount !== 1 ? 's' : '') + (cpFailedCount > 0 ? ', ' + cpFailedCount + ' failed' : '') + ' · ' + cpPreset + ' · by ' + agentId,
        status: 'pending', createdAt: new Date().toISOString(), createdBy: agentId,
        source: 'heartbeat', briefId: cpBriefId, packageId: cpPackageId,
        preset: cpPreset, goal: cpGoal, successCount: cpSuccessCount, failedCount: cpFailedCount,
        preview: {
          thumbs: cpThumbUrls.slice(0, 4), preset: cpPreset, goal: cpGoal,
          outputTypes: cpOutputs, successCount: cpSuccessCount, failedCount: cpFailedCount
        },
        links: {
          packageUrl: cpPackageUrl, packageViewUrl: '/modules/company/content-engine.html?pkg=' + cpPackageId,
          imageUrls: cpSuccessImageUrls
        }
      };

      const cpQueue = (await storage.getState('approvalQueue')) || [];
      cpQueue.push(cpApprovalItem);
      if (cpQueue.length > 200) cpQueue = cpQueue.slice(-200);
      await storage.setState('approvalQueue', cpQueue);

      // Write usage record
      try {
        await imageEngine.writeUsageRecord({
          accountId: accountId, accountType: 'internal', packageId: cpPackageId,
          timestamp: cpPkg.createdAt, engineVersion: imageEngine.ENGINE_VERSION,
          preset: cpPreset, presetVersion: imageEngine.getPresetVersion(cpPreset),
          formatsRequested: cpOutputs, variations: cpVariations,
          imagesGenerated: cpSuccessCount, model: imageEngine.GEMINI_IMAGE_MODEL,
          durationMs: cpDurationMs, estimatedCost: imageEngine.estimateCost(cpSuccessCount),
          status: cpOverallStatus === 'partial_success' ? 'partial' : 'success',
          createdBy: agentId, agentRole: agent.role, source: 'heartbeat'
        });
      } catch (usageErr) { context.log.warn('[Heartbeat] Usage record write failed (non-fatal):', usageErr.message); }

      // Append to gallery index
      try {
        await imageEngine.appendToIndex({
          packageId: cpPackageId, briefId: cpBriefId, preset: cpPreset, topic: cpTopic,
          createdAt: cpPkg.createdAt, status: cpOverallStatus,
          successCount: cpSuccessCount, failedCount: cpFailedCount,
          thumbs: cpThumbUrls.slice(0, 4), outputTypes: cpOutputs, variations: cpVariations,
          createdBy: agentId, source: 'heartbeat'
        });
      } catch (idxErr) { context.log.warn('[Heartbeat] Gallery index append failed (non-fatal):', idxErr.message); }

      // Auto-advance parent task to review if taskId provided
      if (action.taskId) {
        const taskIdx = tasks.findIndex(t => t.id === action.taskId);
        if (taskIdx !== -1 && tasks[taskIdx].status !== 'done' && tasks[taskIdx].status !== 'review') {
          tasks[taskIdx].status = 'review';
          tasks[taskIdx].updatedAt = new Date().toISOString();
          if (!tasks[taskIdx].comments) tasks[taskIdx].comments = [];
          tasks[taskIdx].comments.push({
            id: 'cmt-' + Date.now(), author: agentId,
            text: 'Content package created (' + cpSuccessCount + ' images, preset: ' + cpPreset + '). Submitted for CEO approval (package: ' + cpPackageId + ').',
            type: 'deliverable', createdAt: new Date().toISOString()
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', action.taskId, 'to review (content package created)');
        }
      }

      result.contentGenerates = (result.contentGenerates || 0) + 1;
      context.log('[Heartbeat]', agentId, 'content package created:', cpPackageId, cpSuccessCount, 'ok,', cpFailedCount, 'failed, duration:', cpDurationMs + 'ms');
      result.taskUpdates.push({ action: 'content-package-created', packageId: cpPackageId, agentId: agentId, taskId: action.taskId || null });

    } else if (action.type === 'generate-image' && action.image) {
      // Single image generation for blog headers, inline illustrations, social media assets
      // Allowed agents: echo, pixel, scribe (scribe can generate blog headers)
      const IMG_ALLOWED_AGENTS = ['echo', 'pixel', 'scribe'];
      if (IMG_ALLOWED_AGENTS.indexOf(agentId) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED generate-image (only echo/pixel/scribe)');
        continue;
      }

      // Guardrail: shares the content generates limit with create-content-package
      if ((result.contentGenerates || 0) >= GUARDRAILS.maxContentGeneratesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max content generates reached, skipping generate-image');
        continue;
      }

      const img = action.image;
      const imgTopic = (img.topic || '').trim();
      const imgGoal = (img.goal || '').trim();
      const imgPurpose = (img.purpose || '').trim(); // blog_header, inline_illustration, social_media
      if (!imgTopic || imgTopic.length < 3 || !imgGoal || imgGoal.length < 3) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: topic/goal too short');
        continue;
      }

      const VALID_PURPOSES = ['blog_header', 'inline_illustration', 'social_media'];
      if (!imgPurpose || VALID_PURPOSES.indexOf(imgPurpose) === -1) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: invalid purpose:', imgPurpose);
        continue;
      }

      // Load config defaults
      let _imgCeConfig = null;
      try { _imgCeConfig = await imageEngine.loadContentEngineConfig(); } catch (e) { /* defaults */ }

      const imgPreset = (img.preset || (_imgCeConfig && _imgCeConfig.defaultPreset) || 'ap-neon-glass').trim();
      // Map purpose → default outputType (agent can override)
      const PURPOSE_OUTPUT_MAP = { 'blog_header': 'blog_image', 'inline_illustration': 'blog_image', 'social_media': 'x_image' };
      const imgOutputType = (img.outputType && imageEngine.PURPOSES && imageEngine.PURPOSES[img.outputType]) ? img.outputType : PURPOSE_OUTPUT_MAP[imgPurpose];

      // Validate preset
      if (!imageEngine.PRESETS || !imageEngine.PRESETS[imgPreset]) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: invalid preset:', imgPreset);
        continue;
      }

      // Usage limit check
      const imgAccountId = 'ambientpixels-internal';
      try {
        const imgLimitCheck = await imageEngine.checkUsageLimits(imgAccountId);
        if (!imgLimitCheck.allowed) {
          context.log('[Heartbeat]', agentId, 'generate-image BLOCKED: usage limit exceeded');
          continue;
        }
      } catch (limErr) {
        context.log('[Heartbeat]', agentId, 'generate-image: usage check failed, proceeding:', limErr.message);
      }

      // Handle attachTo — declared early so early-guard can reference it
      const attachTo = img.attachTo || null;

      // Early guard: skip blog_header generation if target document already has a hero image
      if (imgPurpose === 'blog_header' && attachTo && attachTo.type === 'document' && attachTo.id) {
        const _earlyDocCheck = (await storage.getState('documents')) || [];
        const _earlyDoc = _earlyDocCheck.find(d => d.id === attachTo.id);
        if (_earlyDoc && _earlyDoc.hero_image_asset_id) {
          context.log('[Heartbeat]', agentId, 'generate-image SKIPPED (early): doc', attachTo.id, 'already has hero_image_asset_id:', _earlyDoc.hero_image_asset_id);
          continue;
        }
      }

      context.log('[Heartbeat]', agentId, 'generating image:', imgPurpose, '| topic:', imgTopic, '| preset:', imgPreset, '| outputType:', imgOutputType);
      const imgGenStartMs = Date.now();
      const imgJobId = 'img_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');

      let imgResult = null;
      try {
        imgResult = await imageEngine.generateImage({
          topic: imgTopic,
          goal: imgGoal,
          preset: imgPreset,
          outputType: imgOutputType,
          jobId: imgJobId
        });
      } catch (genErr) {
        context.log.error('[Heartbeat]', agentId, 'generate-image FAILED:', genErr.message);
        // Non-blocking: log failure and continue
        result.taskUpdates.push({ action: 'generate-image-failed', agentId: agentId, error: genErr.message });
        continue;
      }

      const imgDurationMs = Date.now() - imgGenStartMs;
      const imgAlt = (img.alt || imgTopic).substring(0, 200);

      // Build image asset record
      const imgAsset = {
        id: imgJobId,
        url: imgResult.imageUrl,
        thumbUrl: imgResult.thumbUrl,
        metaUrl: imgResult.metaUrl,
        purpose: imgPurpose,
        outputType: imgOutputType,
        preset: imgPreset,
        aspect: (imageEngine.PURPOSES[imgOutputType] && imageEngine.PURPOSES[imgOutputType].aspect) || '4:3',
        alt: imgAlt,
        model: imgResult.model,
        bytes: imgResult.bytes,
        size: imgResult.size,
        attachedTo: null,
        createdBy: agentId,
        createdAt: new Date().toISOString(),
        durationMs: imgDurationMs,
        status: 'active'
      };

      // Link asset to document or action
      if (attachTo && attachTo.type === 'document' && attachTo.id) {
        const imgDocsStore = (await storage.getState('documents')) || [];
        const imgDocIdx = imgDocsStore.findIndex(d => d.id === attachTo.id);

        if (imgDocIdx !== -1) {
          const imgDoc = imgDocsStore[imgDocIdx];

          if (imgPurpose === 'blog_header') {
            // Guard: skip if document already has a hero image attached
            if (imgDoc.hero_image_asset_id) {
              context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: doc', attachTo.id, 'already has hero_image_asset_id:', imgDoc.hero_image_asset_id, '— not overwriting');
              // Still notify Scribe that hero image is available (may have been missed on prior cycle)
              const _heroDocIdExisting = attachTo.id;
              const _originTaskExisting = tasks.find(t =>
                t.assignee === 'scribe' && t.status !== 'done' &&
                t.comments && t.comments.some(c => c.text && c.text.indexOf(_heroDocIdExisting) !== -1)
              );
              if (_originTaskExisting) {
                const _alreadyNotified = _originTaskExisting.comments.some(c => c.text && c.text.indexOf('You can now submit this document for publish') !== -1);
                if (!_alreadyNotified) {
                  if (!_originTaskExisting.comments) _originTaskExisting.comments = [];
                  _originTaskExisting.comments.push({
                    id: 'cmt-hero-ready-' + Date.now(),
                    author: 'system',
                    text: 'Hero image generated and attached to document ' + _heroDocIdExisting + ' (asset: ' + imgDoc.hero_image_asset_id + '). You can now submit this document for publish using submit-for-publish with documentId: ' + _heroDocIdExisting,
                    type: 'system',
                    createdAt: new Date().toISOString()
                  });
                  context.log('[Heartbeat]', agentId, 'notified originating task', _originTaskExisting.id, 'that hero image is already attached for doc:', _heroDocIdExisting);
                }
              }
            } else {
            // Set hero_image_asset_id only — no content_md mutation
            imgDoc.hero_image_asset_id = imgJobId;
            imgDoc.updated_at = new Date().toISOString();
            imgDoc.last_edited_by = agentId;
            imgAsset.attachedTo = { type: 'document', id: attachTo.id, field: 'hero_image_asset_id' };
            context.log('[Heartbeat]', agentId, 'attached hero image asset', imgJobId, 'to doc:', attachTo.id);

            // Clear awaiting flag
            imgDoc.awaiting_hero_image = false;

            // Notify originating Scribe task that hero image is ready
            const _heroDocId = attachTo.id;
            const _originTask = tasks.find(t =>
              t.assignee === 'scribe' && t.status !== 'done' &&
              t.comments && t.comments.some(c => c.text && c.text.indexOf(_heroDocId) !== -1)
            );
            if (_originTask) {
              if (!_originTask.comments) _originTask.comments = [];
              _originTask.comments.push({
                id: 'cmt-hero-ready-' + Date.now(),
                author: 'system',
                text: 'Hero image generated and attached to document ' + _heroDocId + ' (asset: ' + imgJobId + '). You can now submit this document for publish using submit-for-publish with documentId: ' + _heroDocId,
                type: 'system',
                createdAt: new Date().toISOString()
              });
              context.log('[Heartbeat]', agentId, 'notified originating task', _originTask.id, 'that hero image is ready for doc:', _heroDocId);
            }
            } // end of else (no existing hero image)
          } else if (imgPurpose === 'inline_illustration') {
            // Token replacement: {{IMAGE:slot}} → ![alt](url)
            const imgSlot = (img.slot || 'default').trim();
            const imgToken = '{{IMAGE:' + imgSlot + '}}';
            // Dedup: skip entirely if this slot was already filled on this doc
            const _existingSlots = (imgDoc.inline_image_assets || []).map(function (a) { return a.slot; });
            if (_existingSlots.indexOf(imgSlot) !== -1) {
              context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: slot', imgSlot, 'already filled on doc:', attachTo.id);
            } else {
              if (imgDoc.content_md && imgDoc.content_md.indexOf(imgToken) !== -1) {
                imgDoc.content_md = imgDoc.content_md.replace(imgToken, '![' + imgAlt + '](' + imgResult.imageUrl + ')');
                context.log('[Heartbeat]', agentId, 'replaced token', imgToken, 'in doc:', attachTo.id);
              } else {
                // Fallback: append at end
                imgDoc.content_md = (imgDoc.content_md || '') + '\n\n![' + imgAlt + '](' + imgResult.imageUrl + ')';
                context.log('[Heartbeat]', agentId, 'appended inline image to doc:', attachTo.id, '(token', imgToken, 'not found)');
              }
              imgDoc.updated_at = new Date().toISOString();
              imgDoc.last_edited_by = agentId;
              if (!imgDoc.inline_image_assets) imgDoc.inline_image_assets = [];
              imgDoc.inline_image_assets.push({ assetId: imgJobId, slot: imgSlot });
              imgAsset.attachedTo = { type: 'document', id: attachTo.id, field: 'inline', slot: imgSlot };
              context.log('[Heartbeat]', agentId, 'attached inline image asset', imgJobId, 'to doc:', attachTo.id);
            }
          }

          imgDocsStore[imgDocIdx] = imgDoc;
          await storage.setState('documents', imgDocsStore);

          // If doc is published internally, update published copy too
          if (imgDoc.visibility === 'internal' && imgDoc.status === 'published' && imgDoc.slug) {
            const imgPubStore = (await storage.getState('publishedDocs')) || [];
            const imgPubIdx = imgPubStore.findIndex(p => p.documentId === imgDoc.id);
            if (imgPubIdx !== -1) {
              if (imgPurpose === 'blog_header') imgPubStore[imgPubIdx].hero_image_asset_id = imgJobId;
              if (imgPurpose === 'inline_illustration') imgPubStore[imgPubIdx].content_md = imgDoc.content_md;
              imgPubStore[imgPubIdx].updated_at = imgDoc.updated_at;
              await storage.setState('publishedDocs', imgPubStore);
            }
          }
        } else {
          context.log('[Heartbeat]', agentId, 'generate-image: attachTo document not found:', attachTo.id);
        }
      } else if (attachTo && attachTo.type === 'action' && attachTo.id) {
        // Attach image to a pending social action's media array
        const imgActionsStore = (await storage.getState('actions')) || [];
        const imgActIdx = imgActionsStore.findIndex(a => a.id === attachTo.id);

        if (imgActIdx !== -1) {
          const imgAct = imgActionsStore[imgActIdx];
          // Only mutate if still pending approval
          if (imgAct.approval && imgAct.approval.status === 'pending') {
            if (!imgAct.payload) imgAct.payload = {};
            if (!imgAct.payload.media) imgAct.payload.media = [];
            // Cap at 1 media item for now
            if (imgAct.payload.media.length < 1) {
              imgAct.payload.media.push({ type: 'image', url: imgResult.imageUrl, alt: imgAlt, assetId: imgJobId });
              imgActionsStore[imgActIdx] = imgAct;
              await storage.setState('actions', imgActionsStore);
              imgAsset.attachedTo = { type: 'action', id: attachTo.id, field: 'media' };
              context.log('[Heartbeat]', agentId, 'attached image to action:', attachTo.id);
            } else {
              context.log('[Heartbeat]', agentId, 'generate-image: action', attachTo.id, 'already has max media items');
            }
          } else {
            context.log('[Heartbeat]', agentId, 'generate-image: action', attachTo.id, 'not in pending status, skipping media attach');
          }
        } else {
          context.log('[Heartbeat]', agentId, 'generate-image: attachTo action not found:', attachTo.id);
        }
      }

      // Persist asset to imageAssets registry
      try {
        const imgAssetsStore = (await storage.getState('imageAssets')) || [];
        imgAssetsStore.push(imgAsset);
        if (imgAssetsStore.length > 500) imgAssetsStore.splice(0, imgAssetsStore.length - 500);
        await storage.setState('imageAssets', imgAssetsStore);
      } catch (assetStoreErr) {
        context.log.error('[Heartbeat]', agentId, 'generate-image: imageAssets persist FAILED (non-fatal):', assetStoreErr.message);
      }

      // Write usage record
      try {
        await imageEngine.writeUsageRecord({
          accountId: imgAccountId, accountType: 'internal', packageId: imgJobId,
          timestamp: imgAsset.createdAt, engineVersion: imageEngine.ENGINE_VERSION,
          preset: imgPreset, presetVersion: imageEngine.getPresetVersion(imgPreset),
          formatsRequested: [imgOutputType], variations: 1,
          imagesGenerated: 1, model: imageEngine.GEMINI_IMAGE_MODEL,
          durationMs: imgDurationMs, estimatedCost: imageEngine.estimateCost(1),
          status: 'success', createdBy: agentId, agentRole: agent.role,
          source: 'heartbeat', actionType: 'generate-image', purpose: imgPurpose
        });
      } catch (usageErr) { context.log.warn('[Heartbeat] generate-image usage record failed (non-fatal):', usageErr.message); }

      // Auto-advance parent task: all image tasks → review (hero images stay in review until attached to blog)
      if (action.taskId) {
        const imgTaskIdx = tasks.findIndex(t => t.id === action.taskId);
        if (imgTaskIdx !== -1 && tasks[imgTaskIdx].status !== 'done') {
          tasks[imgTaskIdx].status = 'review';
          tasks[imgTaskIdx].updatedAt = new Date().toISOString();
          if (!tasks[imgTaskIdx].comments) tasks[imgTaskIdx].comments = [];
          tasks[imgTaskIdx].comments.push({
            id: 'cmt-' + Date.now(), author: agentId,
            text: 'Generated ' + imgPurpose + ' image (asset: ' + imgJobId + ', preset: ' + imgPreset + ').' + (imgAsset.attachedTo ? ' Attached to ' + imgAsset.attachedTo.type + ' ' + imgAsset.attachedTo.id + '.' : ''),
            type: 'deliverable', createdAt: new Date().toISOString(),
            imageUrl: imgAsset.url || null,
            thumbUrl: imgAsset.thumbUrl || imgAsset.url || null,
            assetId: imgJobId
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', action.taskId, 'to review (image generated)');
        }
      }

      result.contentGenerates = (result.contentGenerates || 0) + 1;
      context.log('[Heartbeat]', agentId, 'image generated:', imgJobId, imgPurpose, imgOutputType, imgDurationMs + 'ms');
      result.taskUpdates.push({ action: 'image-generated', assetId: imgJobId, purpose: imgPurpose, agentId: agentId, taskId: action.taskId || null, attachedTo: imgAsset.attachedTo });

    } else if (action.type === 'remember' && action.memory) {
      // Agent saves a persistent memory (hardened Phase 1E + 1F manual gate)
      const mem = action.memory;
      const _memNow = new Date();
      const _memNowIso = _memNow.toISOString();
      let _memOk = false;
      let _memBlockedReason = null;

      // Manual mode gate: block all memory writes
      if (normalizedActivationMode === 'manual') {
        _memBlockedReason = 'mode_gate_manual';
        await logEvent('policy-violation', agentId, 'Memory write blocked: manual mode', runId, {
          runId: runId, agentId: agentId, gate: 'mode_gate', reason: 'manual_blocks_remember'
        });
      } else if (!mem.text || mem.text.trim().length === 0) {
        _memBlockedReason = 'empty_text';
      } else {
        const _memType = (mem.type || '').trim().toLowerCase();

        // Type validation
        if (!_memType || !L4_ALLOWED_TYPES.has(_memType)) {
          _memBlockedReason = 'invalid_type';
          await logEvent('policy-violation', agentId, 'Memory write blocked: invalid type', runId, {
            runId: runId, agentId: agentId, gate: 'memory_schema', reason: 'invalid_type', type: mem.type || null
          });
        }
        // Evidence requirement for preferred GridOS types
        else if (L4_PREFERRED_TYPES.has(_memType) && (!mem.evidence || typeof mem.evidence !== 'object' || !mem.evidence.runId)) {
          _memBlockedReason = 'missing_evidence';
          await logEvent('policy-violation', agentId, 'Memory write blocked: preferred type requires evidence', runId, {
            runId: runId, agentId: agentId, gate: 'memory_schema', reason: 'missing_evidence', type: _memType
          });
        }
        // Daily rate-cap
        else if (_getMemWriteCount(agentId) >= MAX_L4_WRITES_PER_AGENT_PER_DAY) {
          _memBlockedReason = 'daily_cap_exceeded';
          await logEvent('policy-violation', agentId, 'Memory write blocked: daily cap exceeded', runId, {
            runId: runId, agentId: agentId, gate: 'memory_rate_cap', reason: 'daily_cap_exceeded',
            cap: MAX_L4_WRITES_PER_AGENT_PER_DAY, current: _getMemWriteCount(agentId)
          });
        }
        // All checks passed — store
        else {
          if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
          var _memExpiresAt = mem.expiresAt || new Date(_memNow.getTime() + L4_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
          _agentMemoryStore[agentId].push({
            id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            type: _memType,
            text: mem.text.trim().substring(0, 300),
            source: cycleId,
            timestamp: mem.ts || _memNowIso,
            expiresAt: _memExpiresAt,
            evidence: L4_PREFERRED_TYPES.has(_memType) ? mem.evidence : undefined
          });
          // Cap per-agent memories
          if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
            _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
          }
          _incMemWrite(agentId);
          _memOk = true;
          context.log('[Heartbeat]', agentId, 'saved memory:', mem.text.substring(0, 80));
          result.taskUpdates.push({ action: 'memory-saved', agentId: agentId });
        }
      }

      await logEvent('memory-write-attempt', agentId, _memOk ? 'Memory saved' : 'Memory blocked: ' + _memBlockedReason, runId, {
        runId: runId, agentId: agentId, ok: _memOk, type: (mem.type || null), blockedReason: _memBlockedReason
      });
    } else if (action.type === 'create-reminder' && action.reminder) {
      // Agent sets a reminder/date in the workspace dates store
      const rem = action.reminder;
      if (rem.title && rem.date) {
        const dates = (await storage.getState('dates')) || [];

        // Dedup: skip if a date with the same title + date already exists
        const normTitle = rem.title.trim().toLowerCase();
        const normDate = rem.date.substring(0, 10);
        const isDupe = dates.some(d =>
          d.title && d.title.trim().toLowerCase() === normTitle && d.date === normDate
        );
        if (isDupe) {
          context.log('[Heartbeat]', agentId, 'SKIPPED duplicate reminder:', rem.title, normDate);
          continue;
        }

        const VALID_TYPES = ['event', 'deadline', 'milestone', 'recurring'];
        const dateEntry = {
          id: 'date_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          title: rem.title.substring(0, 200),
          date: normDate,
          type: (rem.type && VALID_TYPES.indexOf(rem.type) !== -1) ? rem.type : 'deadline',
          description: (rem.description || '').substring(0, 500),
          created_by: agentId,
          created_at: new Date().toISOString()
        };

        dates.push(dateEntry);
        if (dates.length > 200) dates.splice(0, dates.length - 200);
        await storage.setState('dates', dates);

        context.log('[Heartbeat]', agentId, 'created reminder:', dateEntry.id, dateEntry.title, dateEntry.date);
        result.taskUpdates.push({ action: 'reminder-created', dateId: dateEntry.id, agentId: agentId });
      }
    }

    await logEvent('agent-action', agentId, summary, cycleId);
    recentSummaries.add(summary);
    actionCount++;
  }

  result.actions = actionCount;

  // 0-action diagnostic: log why agent did nothing
  if (actionCount === 0 && agentTasks.length > 0) {
    const _idleTodo = agentTasks.filter(t => t.status === 'todo' || t.status === 'in-progress');
    const _triagedCount = _idleTodo.filter(t => t.comments && t.comments.some(c => c.author === 'nova' || c.author === 'system')).length;
    context.log('[Heartbeat] ZERO-ACTION DIAGNOSTIC:', agentId,
      '| assigned:', agentTasks.length,
      '| todo/in-progress:', _idleTodo.length,
      '| triaged:', _triagedCount,
      '| rawActionsFromLLM:', result.actionAttempts,
      '| dedupeExemptTypes: execute-task,create-doc,create-social-action,generate-image,create-content-package,review-task');
  }

  // ── Phase 2B: Process normalized proposals from new-format or explicit agent proposals ──
  for (var _pi = 0; _pi < normalized.proposals.length; _pi++) {
    var _agentProp = normalized.proposals[_pi];
    if (!_agentProp || typeof _agentProp !== 'object') continue;
    // Ensure required fields for validation — fill agent context if missing
    if (!_agentProp.agentId) _agentProp.agentId = agentId;
    if (!_agentProp.runId) _agentProp.runId = cycleId;
    if (!_agentProp.reasonBlocked) _agentProp.reasonBlocked = 'agent_proposed';
    if (!_agentProp.proposedAction) _agentProp.proposedAction = 'agent_suggestion';
    // Fix 7: Auto-wrap proposals missing payload — LLM sometimes returns flat proposals without nested payload
    if (!_agentProp.payload) {
      _agentProp.payload = {
        title: _agentProp.title || _agentProp.summary || _agentProp.proposedAction || 'Agent suggestion',
        category: _agentProp.category || 'maintenance',
        acceptanceCriteria: _agentProp.acceptanceCriteria || ['Define success criteria.'],
        evidence: { runId: _agentProp.runId, agentId: _agentProp.agentId, autoWrapped: true },
        objective_suggestion: _agentProp.objective_suggestion || _agentProp.objective_id || 'Agent-proposed improvement'
      };
    }
    // Fix 7b: Ensure objective linkage even if payload existed but lacked it
    if (_agentProp.payload && !_agentProp.payload.objective_id && !_agentProp.payload.objective_suggestion) {
      _agentProp.payload.objective_suggestion = _agentProp.objective_suggestion || _agentProp.objective_id || 'Agent-proposed improvement';
    }
    var _normProp = _normalizeProposal(_agentProp);
    if (_isValidProposal(_normProp)) {
      result.proposals.push(_normProp);
      context.log('[Heartbeat]', agentId, 'accepted new-format proposal:', (_normProp.payload && _normProp.payload.title) || '(untitled)');
    } else {
      context.log('[Heartbeat]', agentId, 'rejected invalid new-format proposal:', JSON.stringify({ type: _normProp && _normProp.type, agentId: _normProp && _normProp.agentId, runId: _normProp && _normProp.runId, hasPayload: !!(_normProp && _normProp.payload), hasTitle: !!(_normProp && _normProp.payload && _normProp.payload.title), hasCategory: !!(_normProp && _normProp.payload && _normProp.payload.category), hasAC: !!(_normProp && _normProp.payload && Array.isArray(_normProp.payload.acceptanceCriteria) && _normProp.payload.acceptanceCriteria.length > 0), hasEvidence: !!(_normProp && _normProp.payload && _normProp.payload.evidence && _normProp.payload.evidence.runId), hasObjective: !!(_normProp && _normProp.payload && (_normProp.payload.objective_id || _normProp.payload.objective_suggestion)), reasonBlocked: _normProp && _normProp.reasonBlocked, proposedAction: _normProp && _normProp.proposedAction }).substring(0, 500));
    }
  }

  // ── Phase 2B: Log normalized observations (replaces legacy parsed.observation) ──
  let _obsClamped = false;
  let _observationItems = normalized.observations.map(function (o) {
    if (typeof o === 'string') return o;
    if (o === null || o === undefined) return '';
    return String(o);
  }).filter(function (o) { return o.trim().length > 0; });
  if (_observationItems.length > MAX_OBSERVATIONS_PER_AGENT) {
    _observationItems = _observationItems.slice(0, MAX_OBSERVATIONS_PER_AGENT);
    _obsClamped = true;
  }
  _observationItems = _observationItems.map(function (o) {
    if (o.length > MAX_OBSERVATION_CHARS) {
      _obsClamped = true;
      return o.substring(0, MAX_OBSERVATION_CHARS);
    }
    return o;
  });
  if (_obsClamped) {
    if (typeof incPolicyGate === 'function') incPolicyGate('observation_clamp');
    await logEvent('policy-violation', agentId, 'Observation clamp applied', cycleId, {
      runId: cycleId,
      agentId: agentId,
      gate: 'observation_clamp',
      reason: 'exceeded_limits'
    });
  }

  for (var _obsIdx = 0; _obsIdx < _observationItems.length; _obsIdx++) {
    var _obs = _observationItems[_obsIdx];
    if (_obs && !recentSummaries.has(_obs)) {
      await logEvent('agent-action', agentId, agent.name + ': ' + _obs, cycleId);
    }
  }

  result.durationMs = Date.now() - _agentRunStartMs;
  return result;
}

// ── Site Context Digest (v1.0) ──
function buildSiteContextBlock() {
  try {
    const digestPath = path.join(__dirname, '..', '..', 'data', 'site-manifest.digest.json');
    const raw = fs.readFileSync(digestPath, 'utf-8');
    const d = JSON.parse(raw);
    if (!d || !d.counts) return '';

    const cats = d.counts.categories || {};
    const catParts = Object.keys(cats).map(k => k.charAt(0).toUpperCase() + k.slice(1) + ': ' + cats[k]);
    let block = '\nSITE CONTEXT (AmbientPixels.ai — auto-generated digest):\n';
    block += 'Pages: ' + (d.counts.pages || 0) + ' | ' + catParts.join(' | ') + '\n';

    if (d.gitHead) block += 'Build: ' + d.gitHead;
    if (d.lastDeployHint) {
      const hint = d.lastDeployHint;
      const dateStr = hint.length > 10 ? new Date(hint).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : hint;
      block += (d.gitHead ? ' | ' : '') + 'Last deploy hint: ' + dateStr;
    }
    block += '\n';

    if (d.attention && d.attention.length > 0) {
      block += 'Attention:\n';
      d.attention.forEach(function (a) {
        block += '- ' + a.path + ' — ' + a.issue.replace(/([A-Z])/g, ' $1').trim().toLowerCase() + '\n';
      });
    }

    if (d.recentPages && d.recentPages.length > 0) {
      block += 'Recent changes:\n';
      d.recentPages.forEach(function (p) {
        block += '- ' + p.path + (p.title ? ' — "' + p.title + '"' : '') + '\n';
      });
    }

    return block + 'Use this context when reasoning about the site, content gaps, or SEO issues.\n';
  } catch (e) {
    // Digest not found or unreadable — graceful fallback
    return '';
  }
}

// ── Build heartbeat prompt ──
function buildHeartbeatPrompt(agent, agentTasks, allActiveTasks, activeDirectives, activeObjectives, documents, workspaceMemory, workspaceDates, agentRevisions, costIntel, reviewCooldownIds, seedMemories, researchIntelStore, socialIntel, workerReports) {
  activeDirectives = activeDirectives || [];
  activeObjectives = activeObjectives || [];
  documents = documents || [];
  workspaceMemory = workspaceMemory || [];
  workspaceDates = workspaceDates || [];

  // Pipeline action guidance based on taskType
  const _pipelineHints = {
    blog_post: '→ Use execute-task to draft content. System will auto-create document + hero image task.',
    article: '→ Use execute-task to draft content. System will auto-create document.',
    newsletter: '→ Use execute-task to draft content. System will auto-create document.',
    social_x: '→ Use create-social-action with platform "x" to draft the post.',
    social_linkedin: '→ Use create-social-action with platform "linkedin" to draft the post.',
    social_bluesky: '→ Use create-social-action with platform "bluesky" to draft the post.',
    internal_doc: '→ Use create-doc to write the document, then submit-for-publish when ready.',
    design_asset: '→ Use create-content-package or generate-image to produce visual assets.',
    research: '→ Use execute-task to produce research deliverable. Use web_search for live data.',
    ops: '→ Use execute-task to produce deliverable (report, fix, deployment plan).',
    finance: '→ Use execute-task to produce financial analysis or report.',
    editorial: '→ Use execute-task to produce editing/proofreading deliverable.',
    bug_fix: '→ Use execute-task to produce fix report or implementation plan.',
    intake: '→ Nova should triage: classify taskType, assign to correct agent.',
    support: '→ Nova should triage: classify taskType, assign to correct agent.'
  };

  const taskList = agentTasks.map(t => {
    const src = t.source === 'heartbeat' ? 'agent' : 'CEO';
    const _tType = t.taskType || 'general';
    let line = '- [' + t.status + '] ' + t.title + ' (priority: ' + t.priority + ', type: ' + _tType + ', source: ' + src + ', id: ' + t.id;
    if (t.campaign_id) line += ', campaign: ' + t.campaign_id;
    if (t.dueDate) line += ', due: ' + t.dueDate.substring(0, 10);
    if (t.reviewed_copy) line += ', reviewed_copy: "' + t.reviewed_copy.substring(0, 300) + (t.reviewed_copy.length > 300 ? '...' : '') + '"';
    if (t.awaiting_copy_review) line += ', ⏳ AWAITING COPY REVIEW FROM SCRIBE';
    line += ')';
    // Add pipeline hint based on taskType
    if (_pipelineHints[_tType]) line += '\n  PIPELINE: ' + _pipelineHints[_tType];
    if (t.description) {
      const desc = t.description.length > 200 ? t.description.substring(0, 200) + '...' : t.description;
      line += '\n  Description: ' + desc;
    }
    if (t.comments && t.comments.length > 0) {
      const recent = t.comments.slice(-3);
      recent.forEach(c => {
        const who = c.user || c.author || 'unknown';
        const text = String(c.text || c.comment || c.body || '').substring(0, 150);
        line += '\n  Comment (' + who + '): ' + text;
      });
    }
    return line;
  }).join('\n') || '(none assigned)';

  // SERVER-SIDE HERO IMAGE NUDGE: If Pixel has a hero image task idle for 5+ min, inject urgent override
  let heroImageNudge = '';
  if (agent.name === 'Pixel') {
    const _heroTask = agentTasks.find(t =>
      (t.status === 'todo' || t.status === 'in-progress') &&
      (t.title || '').indexOf('Generate hero image for:') === 0 &&
      t.createdAt
    );
    if (_heroTask) {
      const _heroAge = Date.now() - new Date(_heroTask.createdAt).getTime();
      if (_heroAge > 5 * 60 * 1000) { // 5 minutes
        const _docIdMatch = (_heroTask.description || '').match(/Document ID:\s*(doc_[a-z0-9_]+)/i);
        const _heroDocId = _docIdMatch ? _docIdMatch[1] : null;
        const _heroTitle = (_heroTask.title || '').replace('Generate hero image for: ', '');
        heroImageNudge = `

⚠️ URGENT — HERO IMAGE OVERDUE (${Math.round(_heroAge / 60000)} min idle):
Task: "${_heroTask.title}" (id: ${_heroTask.id})
${_heroDocId ? 'Document ID: ' + _heroDocId : ''}
This hero image task has been waiting for ${Math.round(_heroAge / 60000)} minutes. The ENTIRE content pipeline is blocked.
YOUR FIRST ACTION MUST BE:
{ "type": "generate-image", "taskId": "${_heroTask.id}", "image": { "purpose": "blog_header", "topic": "${_heroTitle}", "goal": "Hero image for: ${_heroTitle}", "preset": "ap-neon-glass"${_heroDocId ? ', "attachTo": { "type": "document", "id": "' + _heroDocId + '" }' : ''} } }
DO NOT comment. DO NOT review. DO NOT plan. Generate the image NOW.`;
      }
    }
  }

  const otherTasks = allActiveTasks
    .filter(t => t.assignee !== agent.name.toLowerCase())
    .slice(0, 10)
    .map(t => {
      const assignee = t.assignee || 'UNASSIGNED';
      const due = t.dueDate ? t.dueDate.substring(0, 10) : 'NO DUE DATE';
      const commentCount = (t.comments && t.comments.length) || 0;
      return '- [' + t.status + '] ' + t.title + ' (assignee: ' + assignee + ', due: ' + due + ', comments: ' + commentCount + ', id: ' + t.id + ')';
    })
    .join('\n') || '(none)';

  // Find tasks in review from other agents (for potential review action)
  // Exclude tasks that entered review THIS heartbeat cycle (review cooldown)
  const _cooldownSet = reviewCooldownIds || new Set();
  const _nowMs = Date.now();
  const _reviewableRaw = allActiveTasks
    .filter(t => t.status === 'review' && t.assignee !== agent.name.toLowerCase() && !_cooldownSet.has(t.id) && t.comments && t.comments.length > 0);
  // Sort stale reviews first (oldest updatedAt)
  _reviewableRaw.sort((a, b) => new Date(a.updatedAt || a.createdAt || 0).getTime() - new Date(b.updatedAt || b.createdAt || 0).getTime());
  const reviewableTasks = _reviewableRaw
    .map(t => {
      const _ageMin = Math.round((_nowMs - new Date(t.updatedAt || t.createdAt || _nowMs).getTime()) / 60000);
      const _urgent = _ageMin >= 60 ? ' ⚠️ STALE ' + _ageMin + 'min — REVIEW NOW' : _ageMin >= 30 ? ' (waiting ' + _ageMin + 'min)' : '';
      const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
      const _convergence = _delCount >= 3 ? ' 🔴 CONVERGENCE LOOP (' + _delCount + ' drafts — CEO needs to break the cycle)' : '';
      const _delTag = _delCount > 0 ? ', deliverables: ' + _delCount : ', no deliverable yet';
      return '- [review] ' + t.title + ' (by ' + (t.assignee || 'unassigned') + ', type: ' + (t.taskType || 'general') + _delTag + ', id: ' + t.id + ')' + _urgent + _convergence;
    })
    .join('\n') || '(none)';
  // Review urgency override: if 2+ tasks stale 60+ min, inject priority instruction
  const _staleReviewCount = _reviewableRaw.filter(t => (_nowMs - new Date(t.updatedAt || t.createdAt || _nowMs).getTime()) >= 60 * 60000).length;
  const _reviewUrgencyNudge = _staleReviewCount >= 2
    ? '\n\n🚨 REVIEW BOTTLENECK: ' + _staleReviewCount + ' tasks have been waiting for review 60+ minutes. YOUR FIRST ACTION THIS CYCLE MUST BE review-task on one of the stale tasks above. Do NOT execute your own tasks until you have reviewed at least one stale task.\n'
    : _staleReviewCount === 1
    ? '\n\n⚠️ REVIEW NEEDED: 1 task has been waiting for review 60+ minutes. Prioritize reviewing it before executing your own work.\n'
    : '';

  // Nova-only: surface untriaged tasks — ANY task without a Nova/system comment needs triage
  // CEO/manual tasks get a PRIORITY LANE — always shown first, never buried by agent-created noise
  let triageSection = '';
  if (agent.name === 'Nova') {
    const _hasNovaComment = (t) => t.comments && t.comments.some(c => c.author === 'nova' || c.author === 'system');
    const _prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const allUntriaged = allActiveTasks.filter(t => t.status !== 'done' && (!_hasNovaComment(t) || !t.assignee));

    // Split into CEO/manual tasks (priority lane) vs agent-created tasks
    const ceoUntriaged = allUntriaged.filter(t => t.source !== 'heartbeat')
      .sort((a, b) => (_prioOrder[a.priority] || 3) - (_prioOrder[b.priority] || 3));
    const agentUntriaged = allUntriaged.filter(t => t.source === 'heartbeat')
      .sort((a, b) => (_prioOrder[a.priority] || 3) - (_prioOrder[b.priority] || 3));

    // CEO tasks always shown (up to 5), then fill remaining slots with agent tasks
    const ceoSlice = ceoUntriaged.slice(0, 5);
    const agentSlice = agentUntriaged.slice(0, Math.max(0, 10 - ceoSlice.length));
    const needsTriage = ceoSlice.concat(agentSlice);

    const _formatTriageItem = (t) => {
      const missing = [];
      if (!t.assignee) missing.push('NO ASSIGNEE');
      if (!t.dueDate) missing.push('NO DUE DATE');
      if (!(t.comments && t.comments.length)) missing.push('NO COMMENTS');
      if (t.assignee && t.dueDate) missing.push('NEEDS TRIAGE COMMENT');
      const src = t.source === 'heartbeat' ? 'agent-created' : 'CEO/manual';
      return '- ' + t.title + ' [' + t.status + ', ' + src + '] ⚠ ' + missing.join(', ') + ' (assignee: ' + (t.assignee || 'none') + ', id: ' + t.id + ')';
    };

    if (needsTriage.length > 0) {
      let triageList = '';
      if (ceoSlice.length > 0) {
        triageList += '🔴 CEO/MANUAL TASKS (triage these FIRST — the CEO is waiting):\n' + ceoSlice.map(_formatTriageItem).join('\n');
      }
      if (agentSlice.length > 0) {
        if (ceoSlice.length > 0) triageList += '\n\nAgent-created tasks (' + agentUntriaged.length + ' total untriaged):\n';
        triageList += agentSlice.map(_formatTriageItem).join('\n');
      }
      triageSection = `\n\n⚠ NEEDS TRIAGE (your #1 priority — every task MUST have your triage comment before agents can execute):
${triageList}
For each task: verify assignee is correct for the task type, set dueDate if missing, and leave a delegation comment explaining what you expect. Your comment is the triage stamp that unlocks the task for execution.
IMPORTANT: CEO/manual tasks are the CEO's direct requests — triage them FIRST before any agent-created tasks. Total untriaged: ${allUntriaged.length} (${ceoUntriaged.length} CEO, ${agentUntriaged.length} agent-created).`;
    }
  }

  // Nova-only: Worker intel — surface recent worker reports so Nova can act on their findings
  let workerIntelSection = '';
  if (agent.name === 'Nova' && workerReports && workerReports.length > 0) {
    // Only show reports from the last 2 hours
    const _wrCutoff = Date.now() - 2 * 60 * 60 * 1000;
    const recentReports = workerReports
      .filter(r => r.finishedAt && new Date(r.finishedAt).getTime() > _wrCutoff)
      .slice(-5); // max 5 most recent
    if (recentReports.length > 0) {
      const wrLines = recentReports.map(r => {
        const age = Math.round((Date.now() - new Date(r.finishedAt).getTime()) / 60000);
        let line = '- ' + (r.type || 'worker') + ' (' + age + 'min ago, ' + (r.itemsProcessed || 0) + ' items): ' + (r.summary || 'No summary');
        if (r.findings && r.findings.length > 0) {
          line += '\n  Findings: ' + r.findings.slice(0, 3).join('; ');
        }
        if (r.proposed_actions && r.proposed_actions.length > 0) {
          const actions = r.proposed_actions.slice(0, 3).map(a =>
            (a.actionType || 'action') + ' on ' + (a.itemId || '?') + ' (' + (a.priority || 'medium') + ' priority, ' + (a.riskLevel || 'low') + ' risk): ' + (a.rationale || '')
          );
          line += '\n  Recommended: ' + actions.join('; ');
        }
        if (r.risks && r.risks.length > 0) {
          line += '\n  Risks: ' + r.risks.slice(0, 2).join('; ');
        }
        return line;
      }).join('\n');
      workerIntelSection = `\n\nWORKER INTEL (from pressure-triggered analysis — act on these findings):
${wrLines}
Workers are read-only analysts that spawn during pressure spikes. Use their findings and proposed_actions to prioritize your triage and delegation decisions. If a worker recommends assigning a reviewer or escalating a task, act on it.`;
    }
  }

  // Active Campaigns — strategic priorities that drive task creation
  let directivesSection = '';
  if (activeDirectives.length > 0) {
    // Check which campaigns already have tasks linked to them
    const campaignTaskMap = {};
    allActiveTasks.forEach(t => {
      if (t.campaign_id) {
        if (!campaignTaskMap[t.campaign_id]) campaignTaskMap[t.campaign_id] = [];
        campaignTaskMap[t.campaign_id].push(t.title);
      }
    });
    const cmpList = activeDirectives.map(c => {
      const linked = campaignTaskMap[c.id];
      const linkInfo = linked ? ' [' + linked.length + ' task(s) linked]' : ' [NO TASKS YET — needs task creation]';
      return '- "' + c.title + '" (id: ' + c.id + ', priority: ' + (c.priority || 'medium') + ')' + linkInfo;
    }).join('\n');
    directivesSection = `\n\nACTIVE CAMPAIGNS (strategic priorities — these drive what the company works on):
${cmpList}
IMPORTANT: Create specific leaf tasks for each campaign directly (e.g. "Draft Q1 marketing brief", "Audit API cost dashboard"). NEVER create meta-tasks like "Create Tasks for Campaigns" or "Create Individual Tasks for..." — those are wasted actions. If a campaign needs multiple tasks, create each one individually in this heartbeat cycle.`;
  }

  // Active Objectives — enriched with task linkage + linked campaigns
  let objectivesSection = '';
  if (activeObjectives.length > 0) {
    // Build objective → task map
    const objectiveTaskMap = {};
    allActiveTasks.forEach(t => {
      if (t.objective_id) {
        if (!objectiveTaskMap[t.objective_id]) objectiveTaskMap[t.objective_id] = [];
        objectiveTaskMap[t.objective_id].push(t.title);
      }
    });
    // Build objective → campaign map from BOTH directions:
    // 1) campaign.linkedObjectives (array on campaign)
    // 2) objective.linkedCampaigns (array set from goals page, normalized from old linkedDirective)
    const objectiveCmpMap = {};
    const _allCampaigns = activeDirectives.length > 0 ? activeDirectives : [];
    const _cmpById = {};
    _allCampaigns.forEach(c => { _cmpById[c.id] = c; });
    _allCampaigns.forEach(c => {
      (c.linkedObjectives || []).forEach(objId => {
        if (!objectiveCmpMap[objId]) objectiveCmpMap[objId] = [];
        if (!objectiveCmpMap[objId].some(x => x.id === c.id)) {
          objectiveCmpMap[objId].push({ id: c.id, title: c.title });
        }
      });
    });
    // Also check objective.linkedCampaigns (array, set from goals UI)
    activeObjectives.forEach(o => {
      const _lcs = Array.isArray(o.linkedCampaigns) ? o.linkedCampaigns : (Array.isArray(o.linkedDirectives) ? o.linkedDirectives : (o.linkedDirective ? [o.linkedDirective] : []));
      _lcs.forEach(cmpId => {
        if (cmpId && _cmpById[cmpId]) {
          if (!objectiveCmpMap[o.id]) objectiveCmpMap[o.id] = [];
          if (!objectiveCmpMap[o.id].some(x => x.id === cmpId)) {
            const c = _cmpById[cmpId];
            objectiveCmpMap[o.id].push({ id: c.id, title: c.title });
          }
        }
      });
    });
    const objList = activeObjectives.map(o => {
      const linked = objectiveTaskMap[o.id];
      const linkInfo = linked ? ' [' + linked.length + ' task(s) linked]' : ' [NO TASKS YET \u2014 needs task creation]';
      const cmps = objectiveCmpMap[o.id];
      const cmpInfo = cmps ? ' campaigns: ' + cmps.map(c => '"' + c.title + '" (id: ' + c.id + ')').join(', ') : '';
      return '- "' + o.title + '" Q' + (o.quarter || '?') + ' (id: ' + o.id + ', progress: ' + (o.progress || 0) + '%' + cmpInfo + ')' + linkInfo;
    }).join('\n');
    objectivesSection = `\n\nACTIVE GOALS (strategic goals \u2014 create tasks to advance these, always set objective_id when creating tasks for a goal):
${objList}`;
  }

  // Existing documents — so agents know what's already drafted/published
  let docsSection = '';
  if (documents.length > 0) {
    const docList = documents.slice(-10).map(d =>
      '- "' + d.title + '" [' + (d.status || 'draft') + '] (id: ' + d.id + ', slug: ' + (d.slug || '?') + (d.promote ? ', promote: YES' : '') + ')'
    ).join('\n');
    docsSection = `\n\nEXISTING DOCUMENTS (already created — do NOT duplicate):
${docList}`;

    // KNOWLEDGE BASE: inject content excerpts from published/approved docs so agents can reference and learn
    const knowledgeDocs = documents.filter(d =>
      d && d.content_md && d.content_md.length > 50 &&
      (d.status === 'published' || d.status === 'final' || d.status === 'ready_for_approval')
    );
    if (knowledgeDocs.length > 0) {
      // Prioritize docs relevant to this agent's role, then most recent
      const _agentName = (agent.name || '').toLowerCase();
      const _roleKeywords = {
        scribe: ['blog', 'content', 'marketing', 'copy', 'editorial', 'writing'],
        pixel: ['design', 'image', 'visual', 'brand', 'ui', 'ux', 'hero'],
        forge: ['devops', 'infrastructure', 'deployment', 'api', 'architecture', 'pipeline'],
        cipher: ['finance', 'budget', 'cost', 'revenue', 'metrics', 'kpi'],
        echo: ['social', 'marketing', 'engagement', 'community', 'platform', 'audience'],
        scout: ['research', 'market', 'competitive', 'intelligence', 'analysis', 'trends'],
        nova: ['governance', 'operations', 'strategy', 'delegation', 'playbook'],
        quill: ['audit', 'compliance', 'quality', 'validation', 'review']
      };
      const myKeywords = _roleKeywords[_agentName] || [];
      const scored = knowledgeDocs.map(d => {
        const haystack = ((d.title || '') + ' ' + (d.kind || '') + ' ' + (d.tags || []).join(' ')).toLowerCase();
        const relevance = myKeywords.filter(k => haystack.indexOf(k) !== -1).length;
        return { doc: d, relevance: relevance };
      });
      scored.sort((a, b) => b.relevance - a.relevance || new Date(b.doc.updated_at || 0) - new Date(a.doc.updated_at || 0));
      const topDocs = scored.slice(0, 5);
      const kbLines = topDocs.map(s => {
        const d = s.doc;
        const excerpt = d.content_md.replace(/#{1,6}\s+/g, '').replace(/[*_`~\[\]()>]/g, '').replace(/\n+/g, ' ').trim().substring(0, 300);
        return '- "' + d.title + '" (' + (d.kind || '?') + ', by ' + (d.created_by || '?') + '): ' + excerpt + (d.content_md.length > 300 ? '...' : '');
      }).join('\n');
      docsSection += `\n\nKNOWLEDGE BASE (published documentation — reference these for context, procedures, and decisions):
${kbLines}
Use this knowledge to inform your work. Do not re-create documents that already cover these topics.`;
    }
  }

  // Recent research intelligence — from persistent store + active tasks (token-bounded)
  // Primary source: researchIntelStore (persists beyond task completion)
  // Secondary source: active Scout tasks with research_intel (catches fresh research not yet persisted)
  let researchSection = '';
  const _researchCutoff = Date.now() - (RESEARCH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const persistedEntries = (researchIntelStore || [])
    .filter(e => !e.timestamp || new Date(e.timestamp).getTime() > _researchCutoff)
    .slice(-MAX_RESEARCH_INJECTIONS);
  // Also check active tasks for fresh research not yet in the store
  const persistedIds = new Set(persistedEntries.map(e => e.id).filter(Boolean));
  const freshFromTasks = [];
  allActiveTasks.forEach(t => {
    if (t.assignee === 'scout' && t.research_intel && !persistedIds.has(t.research_intel.id)) {
      freshFromTasks.push(t.research_intel);
    }
  });
  const allResearch = persistedEntries.concat(freshFromTasks).slice(-MAX_RESEARCH_INJECTIONS);
  if (allResearch.length > 0) {
    let totalChars = 0;
    const injected = [];
    for (const ri of allResearch) {
      const findings = (ri.key_findings || []).slice(0, 5).map(f => '  • ' + f).join('\n');
      const impact = (ri.impact_tags || []).join(', ');
      const sources = (ri.sources || []).slice(0, 3).join(', ');
      const age = ri.timestamp ? ' (' + new Date(ri.timestamp).toLocaleDateString() + ')' : '';
      const block =
        '- [' + (ri.title || 'Research') + ']' + age + ' — ' + (ri.summary || '').substring(0, 600) + '\n' +
        (findings ? findings + '\n' : '') +
        (impact ? '  Impact: ' + impact + '\n' : '') +
        (sources ? '  Sources: ' + sources : '');
      if (totalChars + block.length > MAX_RESEARCH_CHARS) break;
      totalChars += block.length;
      injected.push(block);
    }
    if (injected.length > 0) {
      researchSection = '\n\nRESEARCH INTELLIGENCE (from Scout — Research & Intelligence dept, persisted across cycles):\n' +
        injected.join('\n') +
        '\nUse these findings to inform your decisions and work when relevant.';
    }
  }

  // CEO workspace context: high-priority memories + upcoming critical dates (token-capped)
  const MAX_WORKSPACE_CHARS = 1000;
  let workspaceSection = '';
  const wsParts = [];
  let wsChars = 0;

  // High-priority memories (pinned or priority high/critical)
  const priorityMemories = workspaceMemory.filter(m =>
    m.pinned || m.priority === 'high' || m.priority === 'critical'
  ).slice(0, 5);
  if (priorityMemories.length > 0) {
    const memLines = [];
    for (const m of priorityMemories) {
      const line = '- [' + (m.priority || 'medium') + (m.pinned ? ', pinned' : '') + '] ' + (m.title || m.content || '').substring(0, 150);
      if (wsChars + line.length > MAX_WORKSPACE_CHARS) break;
      wsChars += line.length;
      memLines.push(line);
    }
    if (memLines.length > 0) wsParts.push('Key Memories:\n' + memLines.join('\n'));
  }

  // Upcoming dates (next 7 days + overdue deadlines)
  const nowDate = new Date().toISOString().split('T')[0];
  const sevenDaysMs = 7 * 86400000;
  const criticalDates = workspaceDates.filter(d => {
    if (!d.date) return false;
    const diffMs = new Date(d.date + 'T00:00:00').getTime() - Date.now();
    return (diffMs >= 0 && diffMs <= sevenDaysMs) || (diffMs < 0 && d.type === 'deadline');
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  if (criticalDates.length > 0) {
    const dateLines = [];
    for (const d of criticalDates) {
      const diffDays = Math.ceil((new Date(d.date + 'T00:00:00').getTime() - Date.now()) / 86400000);
      const urgency = diffDays < 0 ? 'OVERDUE ' + Math.abs(diffDays) + 'd' : diffDays === 0 ? 'TODAY' : diffDays + 'd away';
      const line = '- [' + (d.type || 'event') + '] ' + d.title + ' (' + urgency + (d.priority ? ', ' + d.priority : '') + ')';
      if (wsChars + line.length > MAX_WORKSPACE_CHARS) break;
      wsChars += line.length;
      dateLines.push(line);
    }
    if (dateLines.length > 0) wsParts.push('Critical Dates:\n' + dateLines.join('\n'));
  }

  if (wsParts.length > 0) {
    workspaceSection = '\n\nCEO NOTES (pinned context from the CEO — factor into your decisions):\n' + wsParts.join('\n');
  }

  // Cost intelligence — real spend data for Cipher (CFO)
  let costSection = '';
  if (costIntel && agent.name === 'Cipher') {
    const g = costIntel.gemini;
    if (g && g.totalCalls > 0) {
      const topCallers = Object.entries(g.byCaller || {}).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5);
      const topAgents = Object.entries(g.byAgent || {}).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5);
      const dayEntries = Object.entries(g.byDay || {}).sort((a, b) => a[0].localeCompare(b[0]));
      const recentDays = dayEntries.slice(-7);
      const avgDailyCost = g.totalCost / Math.max(dayEntries.length, 1);

      costSection = `\n\n💰 COST INTELLIGENCE (REAL DATA — 30-day window):
Gemini API — Total: $${g.totalCost.toFixed(4)} | Calls: ${g.totalCalls} | Tokens: ${g.totalTokens.toLocaleString()}
Avg daily spend: $${avgDailyCost.toFixed(4)}/day | Projected monthly: $${(avgDailyCost * 30).toFixed(2)}

By Service (top spenders):
${topCallers.map(([name, d]) => '- ' + name + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)').join('\n') || '(none)'}

By Agent (who is spending):
${topAgents.map(([name, d]) => '- ' + name + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)').join('\n') || '(none)'}

Daily Trend (last 7 days):
${recentDays.map(([day, d]) => '- ' + day + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)').join('\n') || '(no data)'}

These are REAL costs hitting the Azure subscription. Use this data in your CFO analyses, budget reports, and cost recommendations. Flag anomalies, suggest optimizations, and track burn rate against any budget thresholds.`;
    }
  }

  // Revision requests — actions the CEO sent back for changes
  agentRevisions = agentRevisions || [];
  let revisionSection = '';
  if (agentRevisions.length > 0) {
    const revList = agentRevisions.slice(0, 3).map(a => {
      const note = (a.approval && a.approval.decision_note) || 'No specific feedback provided';
      const aType = a.type || a.action_type || 'unknown';
      const plat = a.platform || '';
      const text = (a.payload && (a.payload.text || a.payload.content || '')) || '';
      const preview = text.length > 150 ? text.substring(0, 150) + '...' : text;
      return '- ACTION ID: ' + a.id + ' | Type: ' + aType + (plat ? ' (' + plat + ')' : '') +
        '\n  Original content: ' + preview +
        '\n  CEO feedback: ' + note;
    }).join('\n');
    revisionSection = `\n\n⚠ CEO REVISION REQUESTS (HIGH PRIORITY — the CEO rejected these and wants changes):
${revList}
You MUST address these revision requests using revise-action. Provide the action_id and the corrected content based on the CEO's feedback. This takes priority over creating new actions.`;
  }

  // Build doctrine block if available and weight > 0
  const dWeight = agent._doctrineWeight != null ? agent._doctrineWeight : 0.4;
  const doctrineBlock = (agent.doctrine && dWeight > 0) ? `
OPERATING DOCTRINE (apply with weight: ${dWeight} / ${Math.round(dWeight * 100)}% — influences strategy, does NOT override governance):
- Strategic Bias: ${agent.doctrine.strategicBias}
- Risk Tolerance: ${agent.doctrine.riskTolerance}
- Time Horizon: ${agent.doctrine.timeHorizon}
- Core Question (ask yourself before every action): "${agent.doctrine.coreQuestion}"
- Escalation Triggers: ${agent.doctrine.escalationTriggers.join(', ')}
You must remain within your assigned authority tier. Doctrine influences your strategic lens but does NOT override CEO authority or governance rules. Escalate when escalation triggers are met.
` : '';

  const personality = _agentPersonalities[agent.name.toLowerCase()] || '';
  const personalityBlock = personality ? '\nPERSONALITY: ' + personality + '\n' : '';

  // Inject CEO-curated seed memories (global + per-agent)
  seedMemories = seedMemories || {};
  const globalSeed = (seedMemories._global || '').substring(0, 2000);
  const agentSeed = (seedMemories[agent.name.toLowerCase()] || '').substring(0, 1500);
  let seedBlock = '';
  if (globalSeed || agentSeed) {
    seedBlock = '\nCEO KNOWLEDGE BASE (curated by the CEO — always follow these instructions and context):\n';
    if (globalSeed) seedBlock += globalSeed + '\n';
    if (agentSeed) seedBlock += '\n--- Your specific knowledge ---\n' + agentSeed + '\n';
  }

  // Inject agent memory (persistent across heartbeat cycles)
  const agentMem = (_agentMemoryStore[agent.name.toLowerCase()] || []).slice(-10);
  let memoryBlock = '';
  if (agentMem.length > 0) {
    const memLines = agentMem.map(function (m) {
      return '- [' + (m.type || 'note') + '] ' + (m.text || '').substring(0, 200) + (m.source ? ' (from: ' + m.source + ')' : '');
    }).join('\n');
    memoryBlock = '\nYOUR MEMORY (persistent notes from previous heartbeats — use these to avoid repeating yourself and to build on past work):\n' + memLines + '\n';
  }

  const socialIntelSection = _buildSocialIntelPromptBlock(agent, socialIntel);

  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.
${personalityBlock}${doctrineBlock}${seedBlock}${memoryBlock}
This is an automated heartbeat check. Review your current tasks and the company task board, then decide what actions to take (if any). Not every heartbeat needs action — only act if something is genuinely needed.

YOUR TASKS:
${taskList}
${heroImageNudge}
OTHER ACTIVE TASKS:
${otherTasks}

TASKS AWAITING REVIEW (from other agents — you can review these):
${reviewableTasks}${_reviewUrgencyNudge}
${triageSection}${workerIntelSection}${directivesSection}${objectivesSection}${docsSection}${researchSection}${workspaceSection}${costSection}${revisionSection}${socialIntelSection}
${buildSiteContextBlock()}
CURRENT TIME: ${new Date().toISOString()}

${['Nova', 'Forge', 'Pixel', 'Cipher', 'Scout', 'Quill', 'Scribe', 'Echo'].includes(agent.name) ? `
STRICT: Respond with ONLY valid JSON. No prose. No markdown. No explanation text outside JSON.

GRIDOS OUTPUT ENVELOPE (REQUIRED for all agents):
Response format MUST be exactly:
{
  "taskUpdates": [],
  "proposals": [],
  "remember": [],
  "observations": []
}

Mapping rules:
- taskUpdates: include ONLY create-task, update-task, move-task objects (same action object fields as legacy format); update-task may use only allowed update keys, and include objective_id for create/in-progress transitions unless objective-exempt category.
- proposals: schema-v1 proposal objects when blocked by a gate or when external approval is needed; include objective_id OR objective_suggestion, acceptanceCriteria, and evidence.runId.
- remember: memory entries with { "type", "text", "evidence", "expiresAt" } (only when allowed by activationMode), using only allowed L4 memory types; preferred types require evidence.runId.
- observations: short warning/summary strings.

Role-specific guidance:
- Quill: validate allowed update keys before emitting taskUpdates; if any gate risk exists, prefer proposals over taskUpdates.
- Scribe: docs/content changes should be proposals unless objective_id is explicit; keep outputs bounded and use observations for brief notes only. When feedback is given on a deliverable, REVISE the existing draft — do NOT produce an entirely new document. Address each feedback point specifically and preserve sections that were not flagged.
- Echo: never execute external actions directly; use proposals only for social/publishing work. Provide max 2-3 variants and ensure each proposal includes acceptanceCriteria and evidence.runId.

Example payload:
{
  "taskUpdates": [
    {
      "type": "update-task",
      "summary": "Reassigned stale objective task",
      "taskId": "task-123",
      "updates": { "assignee": "forge", "priority": "high", "objective_id": "obj_q1_ops" }
    },
    {
      "type": "move-task",
      "summary": "Moved triaged task into in-progress",
      "taskId": "task-456",
      "newStatus": "in-progress"
    }
  ],
  "proposals": [],
  "remember": [],
  "observations": ["Triage complete for 3 tasks"]
}
` : `
STRICT: Respond with ONLY valid JSON. No prose. No markdown. No explanation text outside JSON.

{
  "observation": "One sentence about what you notice or your current state",
  "actions": [
    {
      "type": "create-task|update-task|move-task|execute-task|review-task|comment-task|create-social-action|revise-action|create-doc|submit-for-publish|create-content-package|generate-image|create-reminder|web_search|remember",
      "summary": "Brief description of what you're doing",
      "task": { "title": "", "description": "", "taskType": "general|blog_post|article|social_x|social_linkedin|social_bluesky|internal_doc|design_asset|research|ops|finance|editorial|bug_fix|newsletter|intake|support", "status": "todo|in-progress", "priority": "low|medium|high|critical", "assignee": "agentId", "dueDate": "2026-02-20T00:00:00Z", "campaign_id": "optional-campaign-id", "objective_id": "required-objective-id", "category": "optional-category" },
      "taskId": "existing-task-id",
      "action_id": "existing-action-id-for-revise-action",
      "updates": { "status": "...", "assignee": "agentId", "priority": "high", "dueDate": "2026-02-20T00:00:00Z", "classification": "...", "tags": [], "objective_id": "...", "campaign_id": "..." },
      "newStatus": "todo|in-progress|review|done",
      "comment": "Your comment text here",
      "social": { "text": "Post content", "platform": "x|linkedin|bluesky", "media": ["https://..."], "scheduled_for": "2026-02-14T09:00:00Z", "artifact_id": "optional-art_xxx-if-linking-to-article" },
      "document": { "title": "Doc Title", "kind": "spec|runbook|release_notes|product_brief|marketing_post|governance", "tags": ["tag1"], "content_md": "# Heading\n\nMarkdown content..." },
      "documentId": "existing-doc-id",
      "tool": "web_search",
      "args": { "q": "search query", "n": 5 },
      "reminder": { "title": "Reminder title", "date": "2026-02-20", "type": "deadline|event|milestone|recurring", "description": "Optional details" },
      "content": { "topic": "Visual subject", "goal": "What images are for", "preset": "ap-neon-glass", "outputs": ["x_image"], "variations": 1, "campaignId": "optional", "objectiveId": "optional" },
      "image": { "purpose": "blog_header|inline_illustration|social_media", "topic": "Visual subject", "goal": "What the image is for", "preset": "ap-neon-glass", "outputType": "blog_image", "alt": "Alt text for accessibility", "attachTo": { "type": "document|action", "id": "target-id" }, "slot": "optional-token-name" },
      "memory": { "text": "What to remember", "type": "decision|constraint|resolved_incident|verified_fact|preference|learning|feedback|context", "evidence": { "runId": "cycle-xxx" } }
    }
  ]
}
`}

IMPORTANT: updates object may ONLY contain: status, assignee, dueDate, priority, classification, taskType, tags, objective_id, campaign_id, parent_task_id, child_task_ids. Any other keys (title, description, etc.) will be BLOCKED by the backend. Use taskType in updates to reclassify intake/support tasks to the correct pipeline type (e.g., taskType: "blog_post").

Action types:
- create-task: Create a new task. Include "task" with title, description, taskType, status ("todo" or "in-progress" — default is "todo"), priority, assignee (agent id), dueDate (ISO datetime, realistic: 1-7 days out), and optionally campaign_id (to link to an active campaign). You MUST always set status, priority, assignee, dueDate, and taskType. Valid taskType values: "general", "blog_post", "article", "social_x", "social_linkedin", "social_bluesky", "internal_doc", "design_asset", "research", "ops", "finance", "editorial", "bug_fix", "newsletter", "intake", "support". Choose the type that best matches the task's purpose — this determines which pipeline processes it.
- update-task: Update an existing task. Provide taskId and "updates" with ONLY allowed keys: status, assignee, dueDate, priority, classification, taskType, tags, objective_id, campaign_id, parent_task_id, child_task_ids. NEVER include title or description in updates — the backend will block it. To reclassify an intake/support task, set taskType to the correct pipeline type (e.g., "blog_post", "social_x", "ops").
- move-task: Move a task to a new status column. Provide taskId and newStatus.
- execute-task: Pick up one of YOUR in-progress or todo tasks and produce actual work output (a report, analysis, draft, recommendation, audit, etc). This will generate a deliverable and move the task to review.
- review-task: Review a completed deliverable from another agent's task in the review column. Approve (done) or request changes (back to in-progress). You CANNOT review your own tasks — you must review tasks assigned to a DIFFERENT agent. Self-reviews are blocked by the system.
- comment-task: Add a comment to any task. Provide taskId and "comment" string. Use for status updates, delegation notes, questions, or flagging blockers.
- create-social-action: (Marketing/Echo) Draft a social media post routed through CEO approval. Include "social" with: text (max 280 for X, 300 for Bluesky, 3000 for LinkedIn), platform ("x"|"linkedin"|"bluesky"), optionally media (URLs). You may include scheduled_for (ISO datetime) to time posts strategically (e.g., peak engagement hours, staggering content throughout the day). Keep scheduling within 24 hours. If you have no specific timing reason, omit scheduled_for and the post will go live immediately after CEO approval.
  CRITICAL: The "text" field must contain ONLY the clean, publish-ready post copy that will appear on the social platform. Do NOT include task titles, deliverable headers, markdown formatting (**bold**, ## headings), notes sections, peer review comments, follow-up instructions, or any internal metadata. The text is posted VERBATIM to the platform. Example: "text": "AmbientPixels helps teams govern AI at scale. Learn more at https://ambientpixels.ai #AI" — NOT "**Task:** Hello World\\n**Deliverable:**\\n## Draft\\nAmbientPixels...".
  ARTICLE URL RULES: Never hardcode an article/blog URL unless you are 100% certain the article is already published. If linking to an article that is pending publish or was just submitted, use the placeholder token {{ARTICLE_URL}} in your text and include "artifact_id" in the social object (set it to the artifact ID from the publish action). The URL will be resolved automatically when the article is published. Example: "social": { "text": "Check out our latest post {{ARTICLE_URL}}", "platform": "x", "artifact_id": "art_123_my-slug" }. Never link to /modules/company/ or /docs/published/ as those are internal and auth-gated.
- revise-action: Revise an action that the CEO sent back for changes. Provide "action_id" (from the CEO REVISION REQUESTS section) and "social" with the corrected content (same format as create-social-action). The revised action replaces the old one and is re-submitted for CEO approval. Address ALL of the CEO's feedback in your revision.
- create-doc: Create a NEW document. Include "document" with: title (string), kind, tags (array of strings), and content_md (full markdown content — MUST be complete, publish-ready text with NO placeholders like "[insert here]" or "[TBD]"). Also include "taskId" if this doc is for a specific task. IMPORTANT: Check EXISTING DOCUMENTS below first — if a relevant doc already exists, use update-doc instead of creating a duplicate.
  DOCUMENT KINDS — two distinct tracks:
  • EXTERNAL (public blog): "marketing_post" or "product_brief" — public articles about AI, creative tech, industry trends. Include a hero image (auto-generated by Pixel). Published to /blog/ after CEO approval. Used in social media promotion. Max 5 unpublished drafts at a time.
  • INTERNAL (GridOS reference): "spec", "runbook", "release_notes", or "governance" — technical documentation about GridOS internals, system architecture, API endpoints, agent workflows, heartbeat pipeline, storage schemas, escalation rules, deployment procedures. For agents and humans to reference. Published to /docs/published/. Max 5 active at a time. MUST be about GridOS/operational subject matter — marketing content is NOT allowed as internal docs.
- update-doc: Update an existing document. Include "documentId" (the doc ID from EXISTING DOCUMENTS) and "updates" with any of: content_md (full replacement), append_md (add new content to end), title (rename), tags (replace tags). Use this when new information should be added to an existing doc instead of creating a new one. Internal docs are auto-refreshed at /docs/published/.
- submit-for-publish: Submit a completed document for human/CEO approval to publish on the site. Include "documentId" (the ID of an existing draft or review document) and optionally "taskId" (the task that produced the doc). This creates a publish_document action in the approval queue. You CANNOT publish directly — only a human can approve publishing.
- create-content-package: (Echo and Pixel ONLY) Generate an image content package for marketing, social media, or design assets. Include "content" with: topic (visual subject, min 3 chars), goal (what the images will be used for, min 3 chars), preset (visual style — use "ap-neon-glass" if unsure), outputs (array of output types: "x_image", "linkedin_image", "og_image", "blog_hero", "instagram_square" — max 3), and variations (1-2, default 1). Also include "taskId" if this is for a specific task. Images are generated via Gemini and submitted to the CEO approval queue. Max 1 content package per heartbeat. Use this when a task requires MULTIPLE visual assets for a campaign — NOT for single images.
- generate-image: (Echo, Pixel, Scribe) Generate a SINGLE image and optionally attach it to a document or social action. Include "image" with: purpose ("blog_header"|"inline_illustration"|"social_media"), topic (visual subject, min 3 chars), goal (what the image is for, min 3 chars), preset (visual style — default "ap-neon-glass"), outputType (optional override: "blog_image", "x_image", "hero_image", etc), alt (alt text for accessibility). To attach to a document: set attachTo: { "type": "document", "id": "doc_xxx" }. For blog_header purpose: sets doc.hero_image_asset_id (no content mutation). For inline_illustration: replaces {{IMAGE:slot}} token in doc markdown (include "slot" field to name the anchor; agent should have placed {{IMAGE:slotName}} in the doc content_md first). To attach to a social action: set attachTo: { "type": "action", "id": "act_xxx" } — adds image to action media[] (action must still be pending). Shares the 1-per-heartbeat content generation limit with create-content-package. Use this for blog post hero images, inline article illustrations, or social post graphics — use create-content-package for multi-image campaign batches.
- create-reminder: Set a reminder or important date in the CEO workspace. Include "reminder" with: title (string), date (YYYY-MM-DD), type ("deadline"|"event"|"milestone"|"recurring"), and optionally description. Use for tracking deadlines, renewals, milestones, or follow-ups. These appear in the CEO Morning Inbox and are injected into future heartbeat prompts.
- web_search: (Scout/research agents only) Run a live web search. Include "tool": "web_search" and "args": { "q": "search query", "n": 5 }. Max 3 searches per heartbeat. Results are returned and you'll be asked to synthesize findings into a deliverable with cited sources.
- remember: Save a persistent memory that survives across heartbeat cycles. Include "memory" with: text (what to remember, max 300 chars) and type ("decision"|"constraint"|"resolved_incident"|"verified_fact"|"preference"|"learning"|"feedback"|"context"). Preferred GridOS types (decision, constraint, resolved_incident, verified_fact) require evidence: { "runId": "cycle-xxx" }. Memories expire after 14 days. Only save genuinely useful information — not status updates. Good memories: "CEO prefers concise LinkedIn posts under 100 words", "Blog posts need 400+ words minimum", "Scout found that competitor X launched feature Y". Bad memories: "I commented on task X", "Working on the LinkedIn post".

GRIDOS SHARED RULES v2 — GOVERNANCE COMPLIANCE

You operate under backend-enforced governance gates.
The backend is authoritative. You must pre-comply.

Before emitting ANY taskUpdates or remember actions, run this checklist:

GATE CHECKLIST

1) ACTIVATION MODE
   - If activationMode === "manual":
       taskUpdates = []
       remember = []
       proposals only
   - No exceptions.

2) OBJECTIVE REQUIREMENT
   - Required for:
       create-task
       move-task into "in_progress"
   - Must include: objective_id
   - Exempt categories:
       ops_breakfix, governance, maintenance
   - If objective_id unknown:
       DO NOT create task.
       Emit proposal with objective_suggestion.

3) ALLOWED UPDATE KEYS
   update-task and move-task updates may ONLY include:
     status, assignee, dueDate, priority, classification,
     tags, objective_id, campaign_id, parent_task_id, child_task_ids

   NEVER attempt to update:
     title, description, provenance/origin fields

4) RATE CAPS (supervised_autonomous defaults)
   creates <= 2
   moves   <= 5
   updates <= 8
   proposals <= 10
   If experimental mode: caps are higher but still bounded.
   Do NOT exceed reasonable limits.

5) IF A GATE WOULD FAIL
   - Do NOT attempt mutation.
   - Emit a schema-compliant proposal (v1).
   - Do NOT output prose.

Rules:
- actions array can be empty if nothing needs doing
- Max 3 actions per heartbeat
- Max 1 execute-task per heartbeat (it's thorough work)
- Only create tasks that are genuinely useful
- Only move tasks if you have reason to
- Prefer execute-task on your own in-progress or todo tasks when you have work to do
- MANDATORY PEER REVIEW: If there are tasks in the TASKS AWAITING REVIEW section from OTHER agents, you MUST use review-task on at least one BEFORE creating new work or executing your own tasks. Reviewing others' deliverables is a core duty — not optional. Exceptions (peer review can wait): (1) You have a critical or high priority task assigned to you — produce that deliverable FIRST. (2) You have an auto-created hero image task — use generate-image FIRST. In both cases, review after your deliverable is done.
- You CANNOT review your own tasks. Only review tasks assigned to a different agent. The system blocks self-reviews.
- Keep observations brief and factual
- When creating tasks, ALWAYS set: status ("todo" or "in-progress"), priority, assignee, and a realistic dueDate (1-7 days out). Tasks without these fields are incomplete and will be triaged.
- Use update-task to assign unassigned tasks, adjust priorities, or set missing due dates
- CEO TASK PROTECTION: Tasks NOT created by heartbeat (source != "heartbeat") were created by the CEO. You MUST NOT change their title or description — the CEO's intent is immutable. You may update assignee, priority, dueDate, status, and tags. If you need to add context, use comment-task instead.
- Use comment-task to leave delegation notes, ask questions, or flag blockers
- SOCIAL PROMOTION PIPELINE: Do NOT create social promotion tasks, social copy tasks, or social media image tasks for blog posts. These are auto-created by the system ONLY after the CEO publishes a blog post with the "promote" flag enabled. The pipeline is: Scribe writes (create-doc) → Pixel hero image → submit-for-publish → CEO approves + promotes → system auto-creates Echo social tasks. Any premature social tasks will be blocked by the server.

TRIAGE GATE — ALL TASKS MUST BE TRIAGED BY NOVA FIRST:
- Before you can execute, create-social-action, or create-doc on any task, it MUST have at least one comment from Nova (the Prime Operator). Nova's comment is the triage stamp.
- If a task assigned to you has NO comment from Nova, do NOT execute it. Instead, wait — Nova will triage it in her heartbeat.
- Exception: If YOU are Nova, you may triage AND execute in the same cycle.
- Exception: CEO/manual tasks (source is NOT "heartbeat") that ALREADY have an assignee AND a dueDate set were personally configured by the CEO. You may execute these immediately without waiting for Nova's triage — the CEO's assignment IS the triage stamp.

ANTI-PLANNING-LOOP — PRODUCE DELIVERABLES, NOT PLANS:
- CRITICAL RULE: If you have an ACTIONABLE task (has Nova comment OR is a CEO task with assignee+dueDate) assigned to you that is in-progress OR todo with priority critical or high, your FIRST action MUST be to produce work on that task. Do NOT create sub-tasks, comment, or plan — produce the actual deliverable NOW.
  - For content/analysis tasks: use execute-task to produce the deliverable.
  - For image/visual content tasks (marketing graphics, social media images, design assets): use create-content-package with the taskId. (Echo and Pixel only)
  - For blog post hero images: use generate-image with purpose "blog_header" and attachTo the document. (Pixel only — Pixel is Head of Design and owns all hero image generation)
  - For inline article illustrations: use generate-image with purpose "inline_illustration" and attachTo the document. (Scribe, Pixel)
  - For social media / LinkedIn / X / Bluesky post tasks: use create-social-action with the taskId to draft the post immediately.
  - For document tasks: use create-doc to produce the document directly.
  - You do NOT need to move a task from todo to in-progress first — execute-task, create-social-action, and create-doc all work on todo tasks and auto-advance the status.
- execute-task, create-social-action, and create-doc are ALWAYS higher priority than create-task, move-task, and comment-task. Prefer producing work over organizing work.
- Do NOT create a new task if you already have a todo or in-progress task that covers the same goal — execute the existing task instead.
- Do NOT comment on a task just to say you are "working on it" or "planning to" — instead, use execute-task or the appropriate action to produce the output.
- TASK CREATION LIMIT: Do not create more than 1 new task per heartbeat unless you have also used execute-task or create-doc in the same cycle. Organizing without producing is not useful.
- TASK CREATION SCOPE: Only create tasks that DIRECTLY serve an existing CEO task, active campaign, or active objective. Do NOT create speculative tasks about API costs, deployment monitoring, performance optimization, infrastructure audits, or other operational topics unless the CEO, a campaign, or an objective specifically requests it. The CEO sets the agenda — agents execute it. When creating a task for an objective, ALWAYS set objective_id to that objective's id. When creating a task for a campaign, ALWAYS set campaign_id to that campaign's id.
- If a task description says to use create-doc, you MUST use create-doc (not execute-task) to produce the document directly.
- BLOG POST / MARKETING CONTENT RULE: When your task involves writing a blog post, article, or marketing content, you MUST use create-doc with kind "marketing_post" — NOT execute-task. execute-task only produces a deliverable comment — it does NOT create a publishable document, does NOT trigger automatic hero image generation by Pixel, and does NOT enter the publish pipeline. Always use create-doc for any content that should become a published article or blog post. Include the full markdown content in document.content_md and set document.kind to "marketing_post".
- If a CEO comment says "top priority" or "complete before other work", that task takes absolute precedence — execute it immediately.` + (agent.name === 'Nova' ? `
- GRIDOS CONTRACT (Nova — Prime Operator):
  - Prioritize routing work to existing objective_id.
  - If no objective exists, propose ONE objective_suggestion only.
  - Prefer reassigning/moving existing tasks over creating new ones.
  - Keep task creation minimal and structured.
- PRIME OPERATOR DUTIES (Nova): You are the operational lead. Your #1 job is keeping the board actionable.
  - TRIAGE FIRST: If any task in the NEEDS TRIAGE section is missing an assignee, due date, or comments — fix that NOW. Use multiple actions if needed:
    1. update-task to set assignee (pick the right agent by role) and dueDate (1-7 days out, realistic)
    2. comment-task to leave a delegation note explaining what you expect and why you assigned it
  - Every task on the board should have: an assignee, a dueDate, and at least one comment explaining intent
  - REVIEW DUTY: After triage, your SECOND priority is reviewing deliverables. If there are tasks in the review column from other agents, you MUST review-task them before doing any other work. No task should sit in review for more than 1 heartbeat cycle without a review comment.
  - Only reassign an already-assigned task if it is stuck (no update in >48h) or blocked
  - Only change an existing due date if the objective changed or the task is stale
  - Only re-prioritize if a campaign/objective changed or the task has been stale >48h
  - Never modify a task you created in the same heartbeat cycle
  - Move stale tasks forward or flag blockers with comment-task
  - Review other agents' deliverables promptly
  - Keep the board clean: close completed work, reassign only truly stuck tasks
  - TASK HIERARCHY: You are the ONLY agent who can set parent_task_id. When creating sub-tasks that depend on or derive from another task, set parent_task_id to the parent task's id. This creates visible parent/child linkage on the board. Example: if Scout produced an audit and you create follow-up tasks from it, set parent_task_id to the audit task's id.
  - GOAL EXECUTION: Active goals are quarterly targets. When you see a goal marked [NO TASKS YET], you MUST create tasks to advance it:
    1. Break the goal into concrete, assignable tasks (1-3 tasks per goal)
    2. Assign by role: doc-writing/content → scribe, design → pixel, devops → forge, finance → cipher, marketing → echo, research → scout
    3. ALWAYS set objective_id on each task (use the goal id from ACTIVE GOALS)
    4. If the goal has linked campaigns, also set campaign_id to the relevant campaign
    5. Set realistic due dates (2-5 days out) and priority based on goal importance
    6. Leave a delegation comment on each task explaining how it advances the goal
  - CAMPAIGN EXECUTION: Active campaigns are strategic priorities. When you see a campaign marked [NO TASKS YET], you MUST create tasks to fulfill it:
    1. Break the campaign into concrete, assignable tasks
    2. Assign doc-writing/content tasks to scribe, design tasks to pixel, devops to forge, finance to cipher, marketing to echo, research/market analysis/competitive intel to scout
    3. Set campaign_id on each task to link it to the campaign (use the campaign id from the ACTIVE CAMPAIGNS section)
    4. If the campaign is linked to a goal, also set objective_id on each task
    5. Set realistic due dates (2-5 days out) and priority based on the campaign priority
    6. Leave a delegation comment on each task explaining what the campaign requires
    For documentation campaigns: create tasks assigned to scribe to draft the document, then scribe will use create-doc and submit-for-publish when ready
    For blog posts or marketing content that should be visually strong: create TWO tasks linked to the same campaign:
      a) Assign scribe to write the blog post (create-doc with marketing_post kind)
      b) Assign pixel to generate the hero image (generate-image with blog_header purpose, referencing the doc ID once scribe creates it)
    This ensures Scribe writes and Pixel designs — they collaborate through the task board.
  - ESCALATION HIERARCHY — Owner → Domain Lead → CEO:
    You must respect the company chain of command. Do NOT intervene on tasks where the domain lead should handle it first.
    Escalation tiers:
      Tier 4 agents (Quill) → Domain Lead (Scribe)
      Tier 3 agents (Echo, Pixel, Forge, Cipher, Scout, Scribe) → You (Nova)
      You (Nova) → CEO (human)
    Rules:
    1. Medium priority tasks due within 24h: The DOMAIN LEAD handles this (e.g., Scribe for Quill tasks). You must NOT comment, update, or reassign these tasks. Let the domain lead manage their reports.
    2. High priority tasks due within 24h: Both domain lead and you should engage. You may comment or escalate.
    3. Blocked tasks: You intervene immediately regardless of priority.
    4. Overdue tasks: You intervene immediately regardless of priority.
    5. If a domain lead has already engaged on a task and it remains at-risk after their intervention, THEN you may escalate.
    When in doubt: If the task is not High priority, not Blocked, and not Overdue — skip it and let the domain lead handle it.
  - DEADLINE DISCIPLINE — T-12h Escalation & Assignment Freeze:
    Treat priority: high tasks with due dates as SLA-bound deliverables.
    1. If a high priority task is due within the next 12 hours and the deliverable is not complete, you MUST:
       a. Post a firm directive comment on the task requiring a complete artifact in the next heartbeat cycle.
       b. Explicitly prohibit further "progress-only" updates (e.g., "continuing," "aiming," "working on it").
       c. Ensure the task is in in-progress or review (whichever is appropriate) and remains visible.
       Example comment: "This task is due within 12 hours. Please deliver the complete artifact in the next heartbeat cycle. Progress-only updates are not sufficient."
    2. If the agent responsible for a due-soon high-priority task has or is being assigned new tasks, you MUST:
       a. Prevent this by reassigning the new tasks elsewhere or deferring them.
       b. Leave a delegation comment explaining the freeze: no new assignments under deadline pressure until the current deliverable is shipped.
    3. If the deliverable is still incomplete after the next cycle:
       a. Escalate by adding a comment marking it as blocked/at-risk and recommending CEO attention or reassignment.
  - Agent roster for assignment: cipher (CFO/budgets), pixel (design/UI), forge (engineering/devops/infra), echo (marketing/social/campaigns), scribe (content/docs/briefs), quill (editing/brand voice), scout (research & intelligence/market analysis)` : '') + (agent.name === 'Echo' ? `
- GRIDOS CONTRACT (Echo — Marketing):
  - Never execute external actions directly.
  - All social/publishing actions must be proposals routed through CEO approval.
  - Provide max 2-3 variants per run.
  - Include acceptanceCriteria in each proposal.
- DEPARTMENT HEAD DUTIES (Echo — Marketing):
  - You are the ONLY agent authorized to post on social media (LinkedIn, X.com, Bluesky).
  - COLLABORATIVE SOCIAL POST WORKFLOW:
    Social posts go through a collaborative pipeline: Echo owns strategy → Scribe writes copy → Peer review → Echo posts.
    When you use create-social-action on a task, the server checks for reviewed_copy on the task:
      1. If NO reviewed_copy exists: the server AUTO-CREATES a Scribe writing task and BLOCKS your social action. This is expected — wait for Scribe to write and a peer to review.
      2. If reviewed_copy EXISTS on the task: your social action goes through. Use the reviewed_copy as your post text.
    HOW TO USE REVIEWED COPY: When a task has reviewed_copy (visible in its properties), use that text as the "text" field in create-social-action. The copy was written by Scribe and peer-reviewed — it is publish-ready. You may make minor platform adjustments (hashtags, @mentions, length trimming) but do NOT rewrite the reviewed copy.
    Example: { "type": "create-social-action", "taskId": "task-id", "social": { "platform": "linkedin", "text": "<use the reviewed_copy from the task>" } }
  - CRITICAL RULE — SOCIAL POST TASKS MUST USE create-social-action:
    When a task involves writing a LinkedIn post, X/Twitter post, or any social media content, you MUST use "create-social-action" with the task's ID.
    IMPORTANT: create-social-action does NOT publish live. It creates a DRAFT that goes to the CEO approval queue. The CEO reviews the text, can request revisions, and only publishes after explicit approval. This IS the draft mechanism. Even if the task says "draft only" or "do not publish live", you MUST still use create-social-action — it is how drafts are submitted for review.
    Do NOT use "execute-task" for social posts. execute-task dumps the post as a task comment, bypasses the approval queue, and the post can never be published.
    Correct: { "type": "create-social-action", "taskId": "task-id", "social": { "platform": "linkedin", "text": "your clean post text here" } }
    WRONG: { "type": "execute-task", "taskId": "task-id" } ← NEVER do this for social posts.
  - The "text" field in create-social-action must contain ONLY the clean, publish-ready post copy. No markdown, no section headers, no peer review notes, no follow-up comments. Just the post text exactly as it should appear on the platform.
  - NEVER include placeholder brackets like [insert URL], [website link], [your company], etc. If you don't have a URL, omit it or use the real URL: https://ambientpixels.ai
  - ALLOWED actions: create-social-action, execute-task (only for NON-social tasks like campaign analysis), create-task, update-task, move-task, comment-task, review-task, create-doc (marketing_post kind), generate-image (social_media purpose)
  - If a task description mentions LinkedIn, X, Twitter, social media, "post", or "draft" for social — ALWAYS use create-social-action. No exceptions.
  - PROMOTION GATING: You may ONLY auto-generate social posts for published documents when "promote: YES" appears in the EXISTING DOCUMENTS list. If a document is published but does NOT show "promote: YES", do NOT create a social post for it. You may note in your reasoning that the document could benefit from promotion, but you MUST NOT create a social action for it. This is a CEO-controlled gate — only the CEO can enable promotion on a document.
  - SOCIAL PROMOTION PIPELINE: Do NOT create social media promotion tasks, social copy tasks, or social image tasks for blog posts BEFORE the blog is published and promoted. The correct pipeline is: 1) Scribe writes blog post (create-doc) → 2) Pixel generates hero image → 3) submit-for-publish → 4) CEO approves publish + enables "promote" → 5) System auto-creates social tasks for Echo. Creating social tasks before step 4 wastes heartbeat cycles and creates noise. Wait for the system to create them.` : '') + (agent.name === 'Pixel' ? `
- GRIDOS CONTRACT (Pixel — Design & QC):
  - Create tasks only when acceptanceCriteria are defined.
  - Prefer updating classification, tags, status, objective_id.
  - Do not rewrite task descriptions.
- DEPARTMENT HEAD DUTIES (Pixel — Design):
  - You lead the Design department. Your job is to produce visual assets: hero images for blog posts, social media graphics, UI mockups, and branded content.
  - ALLOWED actions: generate-image (blog_header, inline_illustration, social_media purposes), create-content-package, execute-task, create-task (design tasks), update-task, move-task, comment-task, review-task
  - FORBIDDEN actions: create-social-action (that's Echo's domain), create-doc, submit-for-publish (that's Scribe's domain)
  - HERO IMAGE WORKFLOW: When you have a task to generate a hero image for a blog post or document:
    1. Look at the task description for the document ID (e.g., "doc_xxx") or find the related document in EXISTING DOCUMENTS.
    2. Use generate-image with purpose "blog_header", the appropriate preset and topic, and attachTo: { type: "document", id: "doc_xxx" }.
    3. This sets hero_image_asset_id on the document automatically. Scribe will then submit it for publish.
  - VISUAL QUALITY: Choose presets that match the content tone. Use "ap-neon-glass" for tech announcements, "ap-corporate-tech" for business content, "ap-2d-flat" for tutorials, "ap-ornate-frame" for showcase pieces.
  - CROSS-DEPARTMENT COLLABORATION: You work closely with Scribe (content) and Echo (marketing). When they create documents or social posts that need visuals, pick up the corresponding design tasks promptly. Your hero images make their content publishable.
  - PRODUCE, DON'T PLAN: If a task says "generate hero image" or "create visual for blog post", use generate-image immediately — do NOT create sub-tasks or comment that you're planning to do it.
  - HERO IMAGE PRIORITY OVERRIDE: If you have a "Generate hero image for:" task assigned to you, your ABSOLUTE FIRST action in your actions array MUST be generate-image for that task. Do NOT comment-task, do NOT review-task, do NOT create-task — put generate-image as action #1. The entire content pipeline (Scribe, Echo, publish) is blocked waiting for YOUR image. Every heartbeat you spend commenting instead of generating is a wasted cycle. Extract the document ID from the task description and use it in attachTo.` : '') + (agent.name === 'Scribe' ? `
- GRIDOS CONTRACT (Scribe — Content):
  - Documentation changes are proposals unless tied to objective_id.
  - Use objective_suggestion if objective missing.
  - Do not mutate titles/descriptions directly.
- DEPARTMENT HEAD DUTIES (Scribe — Content):
  - You lead the Content department. Your job is to produce longform content: product briefs, blog drafts, documentation, AND social media copy.
  - Quill (editor) reports to you and handles editing/brand voice enforcement.
  - ALLOWED actions: execute-task, create-task (content tasks), update-task, move-task, comment-task, review-task, create-doc, submit-for-publish, generate-image (inline_illustration purpose only)
  - FORBIDDEN actions: create-social-action (that's Echo's domain), generate-image with purpose blog_header (that's Pixel's domain)
  - You CAN create docs and submit them for publish (CEO approval required). Use submit-for-publish when a doc is complete.
  - When creating docs with create-doc, always use proper markdown with clear headings, structured sections, and professional tone.
  - Focus on producing high-quality content and managing the content pipeline. Delegate editing tasks to Quill.
  - SOCIAL COPY WRITING: You will receive auto-created tasks titled "Write social copy for: [title]" tagged with "social-copy". These are part of the collaborative social post workflow:
    1. Read the task description — it contains the original social post request, platform, and max length.
    2. Use execute-task to produce clean, publish-ready social media copy as your deliverable.
    3. Your deliverable text must be PLATFORM-READY: no markdown, no headers, no internal notes, no placeholders. Just the post text exactly as it should appear on LinkedIn/X/Bluesky.
    4. After you produce the deliverable, the task moves to review. A peer agent (Quill, Nova, or Echo) reviews your copy.
    5. Once approved, the reviewed copy is automatically sent to Echo for posting via the CEO approval queue.
    Write compelling, professional copy that matches AmbientPixels brand voice. Keep it concise and engaging.
  - BLOG POST WORKFLOW: When you have a blog post task (especially with CEO comments like "top priority"), use create-doc with kind "marketing_post" to produce the full blog post content directly. Do NOT create sub-tasks or outlines — write the actual post.
  - CROSS-AGENT VISUAL WORKFLOW: When you create a marketing_post or product_brief doc with create-doc, the server AUTOMATICALLY creates a Pixel hero image task — you do NOT need to create one yourself.
    1. Do NOT use create-task to request a hero image from Pixel. The server handles this when you use create-doc with kind "marketing_post" or "product_brief". Creating one manually causes duplicates.
    2. Wait for Pixel to generate the hero image (the doc will have hero_image_asset_id set).
    3. Only use submit-for-publish AFTER the document has a hero image. You can check this in the EXISTING DOCUMENTS section — look for hero_image_asset_id on the doc.
    If the task does NOT mention visuals and is purely informational/technical documentation, you may submit-for-publish immediately.
  - PRODUCE, DON'T PLAN: Your value is in creating finished documents, not organizing tasks. If a task says "draft a blog post", your next action should be create-doc with the full markdown content, not create-task for an outline.
  - CONTENT QUALITY RULE — NO PLACEHOLDERS: When you use create-doc, the content_md MUST be complete, publish-ready content. NEVER include placeholder text like "[insert here]", "[content to be added]", "[TBD]", or skeleton outlines. Every section must have real, substantive paragraphs. If you don't have enough information, write what you know and make it coherent — do NOT leave blanks. The CEO will reject any document with placeholder content. Aim for 400-800 words minimum for blog posts.` : '') + (agent.name === 'Quill' ? `
- GRIDOS CONTRACT (Quill — Editor):
  - Validate allowed update keys before emitting taskUpdates.
  - If invalid fields detected, convert to proposal instead.
  - Enforce JSON-only output.
- SUB-AGENT RESTRICTIONS (Quill — Tier 4, reports to Scribe):
  - You are an editor and brand voice enforcer under Scribe (Head of Content). Your job is to review and refine drafts for tone, clarity, compression, and CTA quality.
  - ALLOWED actions: review-task, comment-task, execute-task (only for editing/refining tasks assigned to you)
  - FORBIDDEN actions: create-social-action, update-task (assignee/priority changes), move-task to done, create-task, create-doc, submit-for-publish
  - You CANNOT publish anything directly — all feedback stays as task comments or review verdicts for Scribe to act on
  - You CANNOT approve anything or escalate to the CEO
  - You CANNOT modify directives or objectives
  - Focus on reviewing drafts in the review column. Approve clean work, request changes on anything off-brand.` : '') + (agent.name === 'Scout' ? `
- GRIDOS CONTRACT (Scout — Research & Intelligence):
  - Evidence-first. Include evidence references in proposals.
  - Use remember only for verified_fact or constraint types.
  - Avoid memory overuse.
- DEPARTMENT HEAD DUTIES (Scout — Research & Intelligence):
  - You lead the Research & Intelligence department. Your job is to research market trends, competitive intelligence, business strategy, and industry benchmarks to support company growth and business decisions.
  - You serve ALL departments — any agent or directive that needs research support is in your scope.
  - ALLOWED actions: execute-task, create-task (research tasks assigned to yourself), update-task, move-task, comment-task, web_search (tool call), create-doc (research briefs, market reports, competitive analyses), submit-for-publish (submit completed research docs for CEO approval)
  - FORBIDDEN actions: create-social-action
  - WEB SEARCH TOOL: You have access to a live web search tool. To use it, include actions with type "web_search":
    { "type": "web_search", "tool": "web_search", "args": { "q": "your search query", "n": 5 } }
    Rules:
    - Max 2 web searches per heartbeat cycle
    - Only search when a directive or task specifically requires research — do NOT search speculatively
    - Max 10 results per query (use n=5 to n=8 for most queries)
    - The runtime will execute your searches and feed results back for synthesis
    - You MUST include a "## Sources" section in your output listing ONLY URLs returned by the search tool
    - NEVER cite, reference, or link to URLs you did not receive from the search tool
    - NEVER hallucinate citations — if the tool returned no results, say so honestly
    - Results are cached for 24 hours — identical queries won't hit the API again
  - RECURSION GUARD: Once your research deliverable is attached to a task, you CANNOT search again on that task. If the task status changes or a directive requires updated research, a new task should be created.
  - When you produce research, the system extracts a structured summary (title, findings, sources, impact tags) that is shared with ALL agents automatically.
  - Focus on executing research tasks with structured briefs: findings, analysis, recommendations, and cited sources.
  - When creating research docs with create-doc, use proper markdown with clear headings, structured sections, and cited sources.` : '') + (agent.name === 'Cipher' ? `
- GRIDOS CONTRACT (Cipher — CFO):
  - Use numeric thresholds only.
  - If cost data missing, propose instrumentation — do not guess metrics.
  - Use tags/classification fields instead of title edits.
  - Never modify task titles or descriptions.` : '') + (agent.name === 'Forge' ? `
- GRIDOS CONTRACT (Forge — DevOps):
  - Use category ops_breakfix for urgent system incidents (objective_id exempt).
  - Otherwise require objective_id before task creation.
  - Never bypass approval requirements.` : '') + `
- Echo (Marketing): Use create-social-action to draft social posts. All posts require CEO approval. Keep brand voice consistent, professional, and forward-looking.
  - TASK-TO-SOCIAL LINK: When creating a social post that fulfills an existing task, ALWAYS include "taskId" in the create-social-action so the system can auto-advance the task to review. Example: { "type": "create-social-action", "taskId": "task-123", "social": { ... } }
  - Echo CAN also use create-doc with kind "marketing_post" to draft blog posts for the public blog at /blog/. After creating a doc, use submit-for-publish to send it for CEO approval.
  - ALLOWED actions: execute-task, create-task, update-task, move-task, comment-task, review-task, create-social-action, create-doc (marketing_post only), submit-for-publish
- SOCIAL POST RULES (ALL AGENTS):
  - ONLY Echo may use create-social-action. All other agents MUST NOT create social posts — if you want social content, create a task for Echo instead.
  - NEVER write social posts that impersonate another agent. Do NOT say "Echo here", "Cipher here", etc. Social posts speak as AmbientPixels the company, not individual agents.
  - Social post text MUST be complete and ready to publish. NO placeholder brackets like "[insert here]", "[mention X]", "[TBD]", or "[link]". If you lack specific details, write around them naturally.
  - NEVER link to /blog/<slug> unless that article is already published. If the article is still pending CEO approval, do NOT include the URL — write the post without it and promote the article after it goes live. Posts with dead blog links will be automatically rejected by the system.
  - Max 280 chars for X, 300 for Bluesky, 3000 for LinkedIn. Trim to fit.`;
}

// ── Apply task mutation ──
function applyTaskUpdate(tasks, update, _pendingEscalations, _creatingAgentId) {
  if (update.action === 'create') {
    const riskLevel = update.task.risk_level || 'low';
    const budgetImpact = update.task.budget_impact || 0;
    const brandImpact = update.task.brand_impact || 'low';
    // Auto-classify
    let classification = update.task.classification || 'autonomous';
    if (riskLevel === 'high' || brandImpact === 'high') classification = 'executive_required';
    else if (budgetImpact > CFO_THRESHOLD) classification = 'executive_required';
    else if (riskLevel === 'medium' || brandImpact === 'medium') classification = 'advisory';

    const requiresApproval = classification === 'executive_required' || classification === 'advisory';

    // Validate and normalize dueDate — Gemini may send partial dates or weird formats
    const rawDue = update.task.dueDate;
    const parsedDue = rawDue ? new Date(rawDue) : null;
    const validDueDate = (parsedDue && !isNaN(parsedDue.getTime()))
      ? parsedDue.toISOString()
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // fallback: 3 days out

    // Validate assignee — must be a known agent ID
    const rawAssignee = (update.task.assignee || '').toLowerCase();
    const validAssignee = AGENT_IDS.indexOf(rawAssignee) !== -1 ? rawAssignee : 'nova';

    const task = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      title: update.task.title,
      description: update.task.description || '',
      status: (update.task.status && VALID_TASK_STATUSES.indexOf(update.task.status) !== -1) ? update.task.status : 'todo',
      priority: update.task.priority || 'medium',
      assignee: validAssignee,
      division: update.task.division || null,
      tags: [],
      dueDate: validDueDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      comments: [],
      source: 'heartbeat',
      created_by: _creatingAgentId || 'system',
      parent_task_id: update.task.parent_task_id || null,
      // Governance fields
      requires_ceo_approval: requiresApproval,
      risk_level: riskLevel,
      budget_impact: budgetImpact,
      brand_impact: brandImpact,
      escalated: requiresApproval,
      classification: classification,
      campaign_id: update.task.campaign_id || null,
      objective_id: update.task.objective_id || null
    };
    tasks.push(task);
    if (tasks.length > 500) tasks.splice(0, tasks.length - 500);

    // Auto-escalate to approval queue if needed
    if (requiresApproval) {
      _pendingEscalations.push({
        taskId: task.id,
        taskTitle: task.title,
        classification: classification,
        riskLevel: riskLevel,
        budgetImpact: budgetImpact,
        brandImpact: brandImpact,
        originAgent: update.task.assignee || 'nova'
      });
    }
    return task;
  }

  if (update.action === 'execute') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        // Add deliverable as a comment
        if (!tasks[i].comments) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          author: update.agentId,
          text: update.deliverable,
          type: 'deliverable',
          createdAt: new Date().toISOString()
        });
        // Move to review
        tasks[i].status = 'review';
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'review') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        // MANDATORY PEER REVIEW: block self-review — reviewer must be different from assignee
        const taskAssignee = (tasks[i].assignee || '').toLowerCase();
        const reviewerId = (update.agentId || '').toLowerCase();
        if (taskAssignee && reviewerId && taskAssignee === reviewerId) {
          // Self-review blocked — log and skip
          if (!tasks[i].comments) tasks[i].comments = [];
          tasks[i].comments.push({
            id: 'cmt-' + Date.now(),
            author: 'system',
            text: 'Self-review blocked: ' + update.agentId + ' cannot review their own deliverable. A different agent must review this task.',
            type: 'system',
            createdAt: new Date().toISOString()
          });
          tasks[i].updatedAt = new Date().toISOString();
          return tasks[i];
        }
        // Add review as a comment
        if (!tasks[i].comments) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          author: update.agentId,
          text: update.review.feedback,
          type: 'review',
          verdict: update.review.verdict,
          createdAt: new Date().toISOString()
        });
        // Move based on verdict
        if (update.review.verdict === 'approved') {
          // DELIVERABLE GATE: tasks with deliverables require CEO approval before moving to done
          const _hasDeliverable = (tasks[i].comments || []).some(c => c.type === 'deliverable');

          // ── COPY PROPAGATION (special case — auto-completes, feeds into social pipeline) ──
          const _tags = tasks[i].tags || [];
          const _isSocialCopy = _tags.indexOf('social-copy') !== -1;
          if (_isSocialCopy) {
            // Social-copy tasks auto-complete: the parent social post has its own approval gate
            tasks[i].status = 'done';
            tasks[i].completedAt = new Date().toISOString();
            const _parentTag = _tags.find(t => t.startsWith('social-copy-for-'));
            const _parentSocialTaskId = _parentTag ? _parentTag.replace('social-copy-for-', '') : null;
            if (_parentSocialTaskId) {
              const _parentSocialTask = tasks.find(t => t.id === _parentSocialTaskId);
              if (_parentSocialTask) {
                const _deliverables = (tasks[i].comments || []).filter(c => c.type === 'deliverable');
                const _copyText = _deliverables.length > 0 ? _deliverables[_deliverables.length - 1].text : '';
                if (_copyText) {
                  _parentSocialTask.reviewed_copy = _copyText;
                  _parentSocialTask.awaiting_copy_review = false;
                  _parentSocialTask.updatedAt = new Date().toISOString();
                  if (!_parentSocialTask.comments) _parentSocialTask.comments = [];
                  _parentSocialTask.comments.push({
                    id: 'cmt-copyready-' + Date.now(),
                    author: 'system',
                    text: 'Reviewed copy ready from Scribe (approved by ' + update.agentId + '). Echo can now create the social post using this copy.',
                    type: 'system',
                    createdAt: new Date().toISOString()
                  });
                  console.log('[Heartbeat] COPY PROPAGATED: reviewed_copy set on parent task:', _parentSocialTaskId, '(' + _copyText.length + ' chars)');
                }
              }
            }
          } else if (_hasDeliverable) {
            // ── HERO IMAGE AUTO-COMPLETE: hero tasks skip CEO approval — publish_document is the gate ──
            const _isHeroTask = _tags.indexOf('hero-image') !== -1;
            if (_isHeroTask) {
              tasks[i].status = 'done';
              tasks[i].completedAt = new Date().toISOString();
              tasks[i].comments.push({
                id: 'cmt-heroclose-' + Date.now(),
                author: 'system',
                text: 'Hero image task auto-completed after peer review approval. The publish_document action is the CEO gate for the final article + image.',
                type: 'system',
                createdAt: new Date().toISOString()
              });
              console.log('[Heartbeat] HERO AUTO-COMPLETE: task', tasks[i].id, 'auto-completed — publish_document is the CEO gate');
              // Notify parent blog task that hero image is ready for submit-for-publish
              if (tasks[i].parent_task_id) {
                const _parentBlogTask = tasks.find(t => t.id === tasks[i].parent_task_id);
                if (_parentBlogTask) {
                  if (!_parentBlogTask.comments) _parentBlogTask.comments = [];
                  _parentBlogTask.comments.push({
                    id: 'cmt-heroready-' + Date.now(),
                    author: 'system',
                    text: 'Hero image approved and attached. Document is ready for submit-for-publish. Scribe, use submit-for-publish to send the article + hero image for CEO approval.',
                    type: 'system',
                    createdAt: new Date().toISOString()
                  });
                  _parentBlogTask.updatedAt = new Date().toISOString();
                }
              }
            } else {
            // Non-hero deliverable tasks stay in review — CEO must approve before done
            tasks[i].status = 'review';
            if (!update._ceoApprovalAction) {
              update._ceoApprovalAction = {
                taskId: tasks[i].id,
                taskTitle: tasks[i].title,
                assignee: tasks[i].assignee,
                reviewerId: update.agentId,
                reviewFeedback: update.review.feedback,
                deliverable: (tasks[i].comments || []).filter(c => c.type === 'deliverable').map(c => c.text).join('\n').substring(0, 2000)
              };
            }
            }
          } else {
            // No deliverable — auto-complete (simple status transitions, etc.)
            tasks[i].status = 'done';
            tasks[i].completedAt = new Date().toISOString();
          }
        } else {
          // Request changes — back to in-progress
          tasks[i].status = 'in-progress';
          tasks[i].completedAt = null;
        }
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'set-research-intel') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        tasks[i].research_intel = update.research_intel;
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'comment') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        if (!tasks[i].comments) tasks[i].comments = [];
        // Support rich comment objects (from tool-call deliverables) or plain strings
        if (update.comment && typeof update.comment === 'object') {
          tasks[i].comments.push({
            id: 'cmt-' + Date.now(),
            author: update.comment.author || update.agentId || 'unknown',
            text: update.comment.text || '',
            type: update.comment.type || 'comment',
            sources: update.comment.sources || undefined,
            createdAt: update.comment.timestamp || new Date().toISOString()
          });
        } else {
          tasks[i].comments.push({
            id: 'cmt-' + Date.now(),
            author: update.agentId || 'unknown',
            text: update.comment || '',
            type: 'comment',
            createdAt: new Date().toISOString()
          });
        }
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'update' || update.action === 'move') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        if (update.updates) {
          // CEO task protection: agents cannot rewrite title/description of CEO-created tasks
          const isCeoTask = tasks[i].source !== 'heartbeat';
          const PROTECTED_FIELDS = ['title', 'description'];
          Object.keys(update.updates).forEach(k => {
            if (k !== 'id' && k !== 'createdAt' && k !== 'comments') {
              if (isCeoTask && PROTECTED_FIELDS.indexOf(k) !== -1) return; // skip — CEO intent is immutable
              if (k === 'status' && VALID_TASK_STATUSES.indexOf(update.updates[k]) === -1) {
                console.log('[applyTaskUpdate] BLOCKED invalid status in updates:', update.updates[k], 'for task:', tasks[i].id);
                return; // skip invalid status
              }
              tasks[i][k] = update.updates[k];
            }
          });
        }
        if (update.newStatus) {
          if (VALID_TASK_STATUSES.indexOf(update.newStatus) === -1) {
            console.log('[applyTaskUpdate] BLOCKED invalid status:', update.newStatus, 'for task:', tasks[i].id);
            tasks[i].updatedAt = new Date().toISOString();
            return tasks[i];
          }
          const oldStatus = tasks[i].status;
          tasks[i].status = update.newStatus;
          if (update.newStatus === 'done' && oldStatus !== 'done') {
            tasks[i].completedAt = new Date().toISOString();
          } else if (update.newStatus !== 'done') {
            tasks[i].completedAt = null;
          }
        }
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }
  return null;
}

// ── Workspace file resolver: inject real code into execution prompts ──
const MAX_WORKSPACE_INJECT_CHARS = 6000;
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const WORKSPACE_SCAN_EXTENSIONS = new Set(['.html', '.css', '.js', '.md', '.json']);
const WORKSPACE_SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'package-lock.json']);

function _resolveWorkspaceFiles(agent, task) {
  const results = [];
  const titleLower = (task.title || '').toLowerCase();
  const descLower = (task.description || '').toLowerCase();
  const combined = titleLower + ' ' + descLower;

  // Role-based scan directories
  const roleDirs = {
    'Design & QC': ['.', 'css', 'modules'],
    'DevOps': ['api', 'scripts', '.github'],
    'Marketing': ['blog', 'modules/company'],
    'Head of Content': ['blog', 'docs'],
    'Content — Editor & Brand Voice': ['blog', 'docs'],
    'Head of Research & Intelligence': ['data', 'docs']
  };
  const scanDirs = (roleDirs[agent.role] || ['.']).slice(0);

  // Detect file paths explicitly mentioned in task description
  const pathMatches = combined.match(/[\/\w-]+\.(?:html|css|js|md|json)/gi) || [];
  for (const p of pathMatches) {
    try {
      const full = path.resolve(WORKSPACE_ROOT, p.replace(/^[\/]+/, ''));
      if (full.startsWith(WORKSPACE_ROOT) && fs.existsSync(full)) {
        const stat = fs.statSync(full);
        if (stat.isFile() && stat.size < 50000) {
          results.push({ path: p, content: fs.readFileSync(full, 'utf8') });
        }
      }
    } catch (_e) { /* skip */ }
  }

  // Keyword-based file detection
  const keywords = {
    'website': ['index.html'],
    'homepage': ['index.html'],
    'landing': ['index.html'],
    'mockup': ['index.html', 'css/base.css', 'css/theme.css'],
    'design': ['index.html', 'css/base.css', 'css/theme.css', 'css/components.css'],
    'dashboard': ['modules/company/dashboard.html'],
    'config': ['modules/company/config-overview.html'],
    'blog': ['blog/index.html'],
    'support': ['support/index.html'],
    'nav': ['css/nav.css'],
    'accessibility': ['index.html', 'css/base.css'],
    'deploy': ['staticwebapp.config.json', 'package.json'],
    'infrastructure': ['staticwebapp.config.json', 'package.json']
  };
  for (const [kw, files] of Object.entries(keywords)) {
    if (combined.indexOf(kw) !== -1) {
      for (const f of files) {
        if (results.some(r => r.path === f)) continue;
        try {
          const full = path.resolve(WORKSPACE_ROOT, f);
          if (full.startsWith(WORKSPACE_ROOT) && fs.existsSync(full)) {
            const stat = fs.statSync(full);
            if (stat.isFile() && stat.size < 50000) {
              results.push({ path: f, content: fs.readFileSync(full, 'utf8') });
            }
          }
        } catch (_e) { /* skip */ }
      }
    }
  }

  // If no matches found, fall back to role-dir scan for top-level HTML/CSS
  if (results.length === 0) {
    for (const dir of scanDirs) {
      try {
        const absDir = path.resolve(WORKSPACE_ROOT, dir);
        if (!absDir.startsWith(WORKSPACE_ROOT)) continue;
        const entries = fs.readdirSync(absDir).slice(0, 20);
        for (const entry of entries) {
          if (WORKSPACE_SKIP_DIRS.has(entry)) continue;
          const ext = path.extname(entry).toLowerCase();
          if (!WORKSPACE_SCAN_EXTENSIONS.has(ext)) continue;
          const full = path.join(absDir, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isFile() && stat.size < 50000) {
              results.push({ path: path.relative(WORKSPACE_ROOT, full).replace(/\\/g, '/'), content: fs.readFileSync(full, 'utf8') });
            }
          } catch (_e2) { /* skip */ }
          if (results.length >= 5) break;
        }
      } catch (_e3) { /* skip */ }
      if (results.length >= 5) break;
    }
  }

  // Trim to fit char budget
  let totalChars = 0;
  const trimmed = [];
  for (const r of results) {
    const maxPerFile = Math.min(2000, MAX_WORKSPACE_INJECT_CHARS - totalChars);
    if (maxPerFile <= 200) break;
    const content = r.content.length > maxPerFile
      ? r.content.substring(0, maxPerFile) + '\n... (trimmed, ' + r.content.length + ' chars total)'
      : r.content;
    totalChars += content.length;
    trimmed.push({ path: r.path, content: content });
    if (totalChars >= MAX_WORKSPACE_INJECT_CHARS) break;
  }
  return trimmed;
}

// ── Site Intelligence: fetch real telemetry, social metrics, deploy config ──
async function _fetchSiteIntel(context, storage) {
  const si = { telemetry: null, socialMetrics: null, deployConfig: null };

  // 1) Application Insights telemetry (same source as telemetrySummary API)
  const aiAppId = process.env.APPINSIGHTS_APP_ID || '';
  const aiKey = process.env.APPINSIGHTS_API_KEY || '';
  if (aiAppId && aiKey) {
    try {
      const kustoUrl = 'https://api.applicationinsights.io/v1/apps/' + aiAppId + '/query';
      const timespan = 'P7D';
      const queries = [
        // Top pages
        'pageViews | extend cleanUrl = tostring(split(url, "?")[0]) | summarize views = count() by path = cleanUrl | top 10 by views desc',
        // Top referrers
        'pageViews | extend ref = tostring(customDimensions["refUri"]) | where isnotempty(ref) | extend refHost = tostring(parse_url(ref).Host) | where refHost != "ambientpixels.ai" and refHost != "www.ambientpixels.ai" and refHost != "" | summarize sessions = dcount(session_Id) by referrer = refHost | top 10 by sessions desc',
        // Performance
        'pageViews | summarize p50 = percentile(duration, 50), p95 = percentile(duration, 95)',
        // Errors
        'exceptions | summarize count_ = count() by name = type | top 5 by count_ desc'
      ];
      const results = await Promise.all(queries.map(q =>
        fetch(kustoUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': aiKey },
          body: JSON.stringify({ query: q, timespan: timespan })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      ));
      const _parseKusto = (result) => {
        if (!result || !result.tables || !result.tables[0]) return [];
        const cols = (result.tables[0].columns || []).map(c => c.name);
        return (result.tables[0].rows || []).map(row => {
          const obj = {};
          cols.forEach((name, i) => { obj[name] = row[i]; });
          return obj;
        });
      };
      const pages = _parseKusto(results[0]).map(r => ({ path: r.path || '/', views: r.views || 0 }));
      const referrers = _parseKusto(results[1]).map(r => ({ referrer: r.referrer || '', sessions: r.sessions || 0 }));
      const perfRows = _parseKusto(results[2]);
      const perf = perfRows.length > 0 ? { p50: Math.round(perfRows[0].p50 || 0), p95: Math.round(perfRows[0].p95 || 0) } : null;
      const errors = _parseKusto(results[3]).map(r => ({ name: r.name || 'Unknown', count: r.count_ || 0 }));

      si.telemetry = { range: '7d', topPages: pages, topReferrers: referrers, performance: perf, errors: errors };
    } catch (telErr) {
      context.log('[Heartbeat] Telemetry fetch failed (non-fatal):', telErr.message);
    }
  }

  // 2) Social metrics from storage
  try {
    const rawEvents = (await storage.getState('socialMetricsEvents')) || [];
    if (Array.isArray(rawEvents) && rawEvents.length > 0) {
      const now = Date.now();
      const weekAgo = now - 7 * 86400000;
      const recent = rawEvents.filter(e => e.timestamp && new Date(e.timestamp).getTime() > weekAgo);
      const byPlatform = {};
      for (const e of recent) {
        const p = e.platform || 'unknown';
        if (!byPlatform[p]) byPlatform[p] = { posted: 0, failed: 0 };
        if (e.status === 'success' || e.status === 'posted') byPlatform[p].posted++;
        else if (e.status === 'error' || e.status === 'failed') byPlatform[p].failed++;
      }
      if (Object.keys(byPlatform).length > 0) {
        si.socialMetrics = { range: '7d', total: recent.length, byPlatform: byPlatform };
      }
    }
  } catch (smErr) {
    context.log('[Heartbeat] Social metrics fetch failed (non-fatal):', smErr.message);
  }

  // 3) Deployment config from filesystem
  try {
    const swaPath = path.resolve(WORKSPACE_ROOT, 'staticwebapp.config.json');
    if (fs.existsSync(swaPath)) {
      const raw = JSON.parse(fs.readFileSync(swaPath, 'utf8'));
      si.deployConfig = {
        routeCount: Array.isArray(raw.routes) ? raw.routes.length : 0,
        hasAuth: !!(raw.auth),
        hasHeaders: !!(raw.globalHeaders || raw.responseOverrides),
        platform: raw.platform || 'Azure Static Web Apps',
        navigationFallback: raw.navigationFallback || null,
        apiRoutes: Array.isArray(raw.routes) ? raw.routes.filter(r => r.route && r.route.startsWith('/api')).map(r => r.route).slice(0, 15) : []
      };
    }
  } catch (dcErr) {
    context.log('[Heartbeat] Deploy config read failed (non-fatal):', dcErr.message);
  }

  return si;
}

// ── Format site intel into prompt section based on agent role + task keywords ──
function _buildSiteIntelSection(agent, task, siteIntel) {
  if (!siteIntel) return '';
  const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
  const sections = [];

  // Telemetry: inject for analytics/traffic/performance tasks, or for Forge/Scout/Echo/Nova
  const _wantsTelemetry = siteIntel.telemetry && (
    agent.name === 'Forge' || agent.name === 'Scout' || agent.name === 'Echo' || agent.name === 'Nova' ||
    /traffic|analytics|performance|seo|page.?load|error|monitor|audit|metric/.test(combined)
  );
  if (_wantsTelemetry) {
    const t = siteIntel.telemetry;
    let s = '\n📊 REAL SITE ANALYTICS (Application Insights, last 7 days — do NOT fabricate traffic numbers):';
    if (t.topPages && t.topPages.length > 0) {
      s += '\nTop Pages: ' + t.topPages.slice(0, 7).map(p => p.path + ' (' + p.views + ' views)').join(' | ');
    }
    if (t.topReferrers && t.topReferrers.length > 0) {
      s += '\nTop Referrers: ' + t.topReferrers.slice(0, 5).map(r => r.referrer + ' (' + r.sessions + ' sessions)').join(' | ');
    }
    if (t.performance) {
      s += '\nPage Load: p50=' + t.performance.p50 + 'ms, p95=' + t.performance.p95 + 'ms';
    }
    if (t.errors && t.errors.length > 0) {
      s += '\nTop Errors: ' + t.errors.map(e => e.name + ' (' + e.count + 'x)').join(' | ');
    }
    sections.push(s);
  }

  // Social metrics: inject for Echo (Marketing) or social-related tasks
  const _wantsSocial = siteIntel.socialMetrics && (
    agent.name === 'Echo' ||
    /social|linkedin|twitter|bluesky|post|campaign|engagement/.test(combined)
  );
  if (_wantsSocial) {
    const sm = siteIntel.socialMetrics;
    let s = '\n📱 REAL SOCIAL METRICS (last 7 days — do NOT fabricate engagement numbers):';
    s += '\nTotal events: ' + sm.total;
    for (const [platform, counts] of Object.entries(sm.byPlatform)) {
      s += '\n- ' + platform + ': ' + counts.posted + ' posted, ' + counts.failed + ' failed';
    }
    sections.push(s);
  }

  // Deploy config: inject for Forge or deployment/infrastructure tasks
  const _wantsDeploy = siteIntel.deployConfig && (
    agent.name === 'Forge' ||
    /deploy|infra|config|route|azure|hosting|security|header|auth/.test(combined)
  );
  if (_wantsDeploy) {
    const dc = siteIntel.deployConfig;
    let s = '\n🚀 REAL DEPLOYMENT CONFIG (staticwebapp.config.json):';
    s += '\nPlatform: ' + dc.platform + ' | Routes: ' + dc.routeCount + ' | Auth: ' + (dc.hasAuth ? 'Yes' : 'No') + ' | Custom headers: ' + (dc.hasHeaders ? 'Yes' : 'No');
    if (dc.navigationFallback) {
      s += '\nSPA fallback: ' + (dc.navigationFallback.rewrite || 'none');
    }
    if (dc.apiRoutes.length > 0) {
      s += '\nAPI routes: ' + dc.apiRoutes.join(', ');
    }
    sections.push(s);
  }

  return sections.length > 0 ? sections.join('\n') + '\n' : '';
}

// ── Format rich social intel digest for execute/review prompts ──
function _buildSocialIntelExecSection(agent, task, socialIntel) {
  if (!socialIntel) return '';
  const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();

  // Determine if this agent/task needs social intel
  const alwaysShow = agent.name === 'Echo' || agent.name === 'Nova' || agent.name === 'Scout';
  const taskWants = /social|linkedin|twitter|bluesky|post|campaign|engagement|audience|content|brand/.test(combined);
  if (!alwaysShow && !taskWants) return '';

  const parts = [];
  parts.push('\n📱 REAL SOCIAL MEDIA DATA (live from platform APIs — do NOT fabricate engagement numbers):');

  // Account / followers
  const acct = socialIntel.account || {};
  const followers = acct.followers || {};
  if (followers.total > 0) {
    parts.push('Followers: X=' + (followers.x || 0) + ', LinkedIn=' + (followers.linkedin || 0) + ', Bluesky=' + (followers.bluesky || 0) + ' (total: ' + followers.total + ')');
  }

  // Delivery stats
  const del = socialIntel.delivery || {};
  if (del.successRate7d !== undefined) {
    parts.push('Delivery (7d): ' + del.successRate7d + '% success rate, ' + (del.publishedToday || 0) + ' posted today, ' + (del.failures24h || 0) + ' failures last 24h' + (del.topIssue24h ? ', top issue: ' + del.topIssue24h : ''));
  }

  // Engagement by platform
  const byPlatform = (socialIntel.engagement && socialIntel.engagement.byPlatform) || {};
  const platformNames = Object.keys(byPlatform);
  if (platformNames.length > 0) {
    parts.push('Engagement (7d):');
    for (const pName of platformNames) {
      const p = byPlatform[pName] || {};
      parts.push('  ' + pName + ': ' + (p.likes7d || 0) + ' likes, ' + (p.comments7d || 0) + ' comments, ' + (p.reposts7d || 0) + ' reposts (' + (p.posts7d || 0) + ' posts)');
    }
  }

  // Top performing posts
  const topPosts = (socialIntel.topPosts7d || []).slice(0, 3);
  if (topPosts.length > 0) {
    parts.push('Top Posts (7d):');
    for (const tp of topPosts) {
      parts.push('  - ' + (tp.platform || '?') + ': ' + (tp.likes || 0) + ' likes, ' + (tp.comments || 0) + ' comments, ' + (tp.reposts || 0) + ' reposts' + (tp.post_url ? ' (' + tp.post_url + ')' : ''));
    }
  }

  // Recommendations
  const recs = (socialIntel.recommendations || []).slice(0, 3);
  if (recs.length > 0 && (agent.name === 'Echo' || agent.name === 'Nova')) {
    parts.push('Recommendations: ' + recs.join(' | '));
  }

  // Mode warning
  if (socialIntel.mode && socialIntel.mode !== 'real') {
    parts.push('⚠ Data is mock/fallback — do not base strategy solely on these numbers.');
  }

  if (socialIntel.lastPulledAt) {
    parts.push('Last pulled: ' + socialIntel.lastPulledAt);
  }

  return parts.join('\n') + '\n';
}

// ── Build exec context block: fills the 5 context gaps between heartbeat→execute ──
function _buildExecContextBlock(agent, task, ctx) {
  if (!ctx) return '';
  const parts = [];
  const MAX_CTX_CHARS = 3000; // total budget for all 5 sections
  let used = 0;

  // 1) CAMPAIGN / OBJECTIVE CONTEXT — if task is linked to a campaign or objective, show what it says
  const cmpId = task.campaign_id || null;
  const objId = task.objective_id || null;
  if (cmpId && Array.isArray(ctx.campaigns)) {
    const cmp = ctx.campaigns.find(c => c.id === cmpId);
    if (cmp) {
      const desc = (cmp.description || '').substring(0, 300);
      const line = '\n📋 CAMPAIGN CONTEXT (this task belongs to campaign "' + cmp.title + '", id: ' + cmp.id + (cmp.priority ? ', priority: ' + cmp.priority : '') + '):\n' + (desc || '(no description)');
      if (used + line.length < MAX_CTX_CHARS) { parts.push(line); used += line.length; }
    }
  }
  if (objId && Array.isArray(ctx.objectives)) {
    const obj = ctx.objectives.find(o => o.id === objId);
    if (obj) {
      const line = '🎯 GOAL: "' + obj.title + '" (Q' + (obj.quarter || '?') + ', progress: ' + (obj.progress || 0) + '%) — align your deliverable to advance this goal.';
      if (used + line.length < MAX_CTX_CHARS) { parts.push(line); used += line.length; }
    }
  }

  // 2) CEO SEED MEMORIES — curated instructions the CEO wrote for this agent
  if (ctx.seedMemories) {
    const globalSeed = (ctx.seedMemories._global || '').substring(0, 600);
    const agentSeed = (ctx.seedMemories[ctx.agentId] || '').substring(0, 400);
    if (globalSeed || agentSeed) {
      let seedBlock = '\n📝 CEO INSTRUCTIONS (follow these during execution):';
      if (globalSeed) seedBlock += '\n' + globalSeed;
      if (agentSeed) seedBlock += '\n--- Your specific instructions ---\n' + agentSeed;
      if (used + seedBlock.length < MAX_CTX_CHARS) { parts.push(seedBlock); used += seedBlock.length; }
    }
  }

  // 3) RESEARCH INTEL — Scout's findings, useful for content/strategy tasks
  if (Array.isArray(ctx.researchIntel) && ctx.researchIntel.length > 0) {
    const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
    const wantsResearch = agent.name === 'Scout' || agent.name === 'Nova' || agent.name === 'Scribe' ||
      /research|market|competitor|trend|benchmark|strateg|analys|intel|brief/.test(combined);
    if (wantsResearch) {
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const recent = ctx.researchIntel
        .filter(r => !r.timestamp || new Date(r.timestamp).getTime() > cutoff)
        .slice(-3);
      if (recent.length > 0) {
        let rBlock = '\n🔍 RESEARCH INTEL (from Scout — real findings, cite these):';
        for (const ri of recent) {
          const entry = '\n- ' + (ri.title || 'Research') + ': ' + (ri.summary || '').substring(0, 200);
          if (used + rBlock.length + entry.length > MAX_CTX_CHARS) break;
          rBlock += entry;
          const findings = (ri.key_findings || []).slice(0, 3).map(f => '  • ' + f).join('\n');
          if (findings) rBlock += '\n' + findings;
          const sources = (ri.sources || []).slice(0, 2).join(', ');
          if (sources) rBlock += '\n  Sources: ' + sources;
        }
        parts.push(rBlock);
        used += rBlock.length;
      }
    }
  }

  // 4) SITE CONTEXT — page inventory, recent changes, build info
  try {
    const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
    const wantsSite = agent.name === 'Scribe' || agent.name === 'Pixel' || agent.name === 'Forge' || agent.name === 'Scout' ||
      /site|page|content|blog|seo|design|audit|layout|navigation|url/.test(combined);
    if (wantsSite) {
      const siteBlock = buildSiteContextBlock();
      if (siteBlock && used + siteBlock.length < MAX_CTX_CHARS) {
        parts.push(siteBlock);
        used += siteBlock.length;
      }
    }
  } catch (e) { /* non-fatal */ }

  // 5) EXISTING DOCUMENTS — prevent duplicate creation, know what's published
  if (Array.isArray(ctx.documents) && ctx.documents.length > 0) {
    const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
    const wantsDocs = agent.name === 'Scribe' || agent.name === 'Nova' || agent.name === 'Quill' ||
      /doc|blog|article|publish|draft|content|write|brief|spec/.test(combined);
    if (wantsDocs) {
      const docList = ctx.documents.slice(-8).map(d =>
        '- "' + d.title + '" [' + (d.status || 'draft') + '] (id: ' + d.id + (d.promote ? ', promote: YES' : '') + ')'
      ).join('\n');
      const dBlock = '\n📄 EXISTING DOCUMENTS (do NOT duplicate these):\n' + docList;
      if (used + dBlock.length < MAX_CTX_CHARS) { parts.push(dBlock); used += dBlock.length; }
    }
  }

  return parts.length > 0 ? parts.join('\n') + '\n' : '';
}

// ── Execute a task: agent produces actual work output ──
async function executeTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext) {
  // Resolve workspace files for real code context
  let workspaceFiles = [];
  try {
    workspaceFiles = _resolveWorkspaceFiles(agent, task);
    if (workspaceFiles.length > 0) {
      context.log('[Heartbeat]', agent.name, 'workspace context injected:', workspaceFiles.length, 'file(s) for:', task.title);
    }
  } catch (wsErr) {
    context.log.warn('[Heartbeat]', agent.name, 'workspace file resolve failed (non-fatal):', wsErr.message);
  }
  const prompt = buildExecutePrompt(agent, task, workspaceFiles, costIntel, siteIntel, socialIntel, execContext);
  const output = await callGeminiExecute(prompt, agent.name.toLowerCase());
  if (!output) {
    context.log('[Heartbeat]', agent.name, 'execute-task returned empty for:', task.title);
    return null;
  }
  context.log('[Heartbeat]', agent.name, 'produced deliverable for:', task.title, '(' + output.length + ' chars)');
  return output;
}

function buildExecutePrompt(agent, task, workspaceFiles, costIntel, siteIntel, socialIntel, execContext) {
  workspaceFiles = workspaceFiles || [];
  costIntel = costIntel || null;
  siteIntel = siteIntel || {};
  socialIntel = socialIntel || null;
  execContext = execContext || {};
  // Gather existing comments for context
  const existingComments = (task.comments || [])
    .filter(c => c.text)
    .map(c => '- [' + (c.type || 'comment') + ' by ' + (c.author || 'unknown') + '] ' + c.text.substring(0, 200))
    .join('\n') || '(none)';

  // Revision-awareness: count prior deliverables and feedback to prevent re-draft loops
  const _deliverableComments = (task.comments || []).filter(c => c.type === 'deliverable');
  const _feedbackComments = (task.comments || []).filter(c =>
    c.type === 'review' || c.type === 'feedback' ||
    (c.text && /please\s+(incorporate|add|revise|update|fix|address|action)/i.test(c.text))
  );
  const _revisionCycle = _deliverableComments.length;
  let _revisionBlock = '';
  if (_revisionCycle >= 1 && _feedbackComments.length > 0) {
    const latestFeedback = _feedbackComments.slice(-3).map(c =>
      '- ' + (c.author || 'unknown') + ': ' + (c.text || '').substring(0, 300)
    ).join('\n');
    _revisionBlock = `
⚠️ REVISION MODE (cycle ${_revisionCycle + 1}) — This task already has ${_revisionCycle} prior deliverable(s) and ${_feedbackComments.length} feedback comment(s).
DO NOT write a new document from scratch. Instead:
1. Start from your most recent deliverable
2. Address EACH specific feedback point listed below
3. Mark addressed items with [ADDRESSED] in your revision notes
4. Only change sections that were flagged — preserve everything else

FEEDBACK TO ADDRESS:
${latestFeedback}

If you cannot address a feedback point, explain why in a brief note. Do NOT re-draft the entire document.`;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const eDW = agent._doctrineWeight != null ? agent._doctrineWeight : 0.4;
  const execDoctrine = (agent.doctrine && eDW > 0) ? `
OPERATING DOCTRINE (apply with weight: ${eDW} / ${Math.round(eDW * 100)}%):
- Strategic Bias: ${agent.doctrine.strategicBias}
- Risk Tolerance: ${agent.doctrine.riskTolerance}
- Core Question: "${agent.doctrine.coreQuestion}"
Apply your doctrine lens to your deliverable. Doctrine does NOT override governance or CEO authority.
` : '';
  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.
TODAY'S DATE: ${todayStr}
${execDoctrine}
You are executing a task and producing a deliverable. This is real work output — be thorough, specific, and actionable.

TASK: ${task.title}
DESCRIPTION: ${task.description || '(no description)'}
PRIORITY: ${task.priority}
STATUS: ${task.status}

EXISTING COMMENTS/HISTORY:
${existingComments}
${_revisionBlock}
${workspaceFiles.length > 0 ? '\nWORKSPACE FILES (actual source code from the AmbientPixels repo — review these, do NOT roleplay):\n' + workspaceFiles.map(f => '--- ' + f.path + ' ---\n' + f.content).join('\n\n') + '\n' : ''}${costIntel && costIntel.gemini && costIntel.gemini.totalCalls > 0 && agent.name === 'Cipher' ? '\n💰 REAL COST DATA (30-day window — use these numbers, do NOT fabricate financial data):\nGemini API — Total: $' + costIntel.gemini.totalCost.toFixed(4) + ' | Calls: ' + costIntel.gemini.totalCalls + ' | Tokens: ' + costIntel.gemini.totalTokens.toLocaleString() + '\nAvg daily: $' + (costIntel.gemini.totalCost / Math.max(Object.keys(costIntel.gemini.byDay || {}).length, 1)).toFixed(4) + '/day | Projected monthly: $' + ((costIntel.gemini.totalCost / Math.max(Object.keys(costIntel.gemini.byDay || {}).length, 1)) * 30).toFixed(2) + '\nBy Agent: ' + Object.entries(costIntel.gemini.byAgent || {}).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5).map(([n, d]) => n + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)').join(', ') + '\nBy Service: ' + Object.entries(costIntel.gemini.byCaller || {}).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5).map(([n, d]) => n + ': $' + d.cost.toFixed(4)).join(', ') + '\n' : ''}${_buildSiteIntelSection(agent, task, siteIntel)}${_buildSocialIntelExecSection(agent, task, socialIntel)}${_buildExecContextBlock(agent, task, execContext)}
Based on your role as ${agent.role}, produce the appropriate deliverable for this task. Examples of what you should produce:
${agent.role === 'CEO' ? '- Strategic analysis, priority decisions, team directives, product direction memos' : ''}${agent.role === 'CFO' ? '- Budget reports, cost analyses, spending recommendations, ROI assessments' : ''}${agent.role === 'Design & QC' ? '- Design reviews, UI audit notes, accessibility recommendations, UX improvement plans' : ''}${agent.role === 'DevOps' ? '- Deployment plans, infrastructure audits, security checklists, performance reports' : ''}${agent.role === 'Marketing' ? '- Content drafts, social media copy, campaign briefs, brand messaging guides' : ''}${agent.name === 'Scribe' ? '- Longform drafts, product briefs, blog posts, documentation, social threads' : ''}${agent.name === 'Quill' ? '- Editing feedback, tone corrections, brand voice enforcement, CTA improvements' : ''}${agent.name === 'Scout' ? '- Market research briefs, competitive intelligence reports, trend analyses, strategic research, business benchmarks. Always include a ## Sources section with cited URLs.' : ''}

CRITICAL RULES — READ CAREFULLY:
- Write your deliverable directly — no JSON wrapping. Be specific to AmbientPixels.
- Use headers, bullet points, or sections as appropriate. This will be attached to the task as a deliverable comment.
- Use today's date (${todayStr}) for any dates in your deliverable. NEVER use dates from 2023 or 2024.
- Your deliverable must be COMPLETE and SELF-CONTAINED. Do NOT create placeholder sections like "Appendix A", "TBD", "To Be Populated", or reference external documents that do not exist.
- Do NOT reference or wait for information from external sources that have not been provided to you. Work with what you have.
- Do NOT invent fictional dependencies, missing documents, or pending inputs. If you need more context, note it briefly in a "Notes" section but still deliver complete, actionable output.
- NEVER loop on the same request across multiple heartbeats. If you already produced a deliverable, do not produce it again unless explicitly asked for a revision.`;
}

// ── Review a task: agent evaluates another agent's deliverable ──
async function reviewTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext) {
  // Resolve workspace files for real code context during review
  let workspaceFiles = [];
  try {
    workspaceFiles = _resolveWorkspaceFiles(agent, task);
    if (workspaceFiles.length > 0) {
      context.log('[Heartbeat]', agent.name, 'review workspace context injected:', workspaceFiles.length, 'file(s) for:', task.title);
    }
  } catch (wsErr) {
    context.log.warn('[Heartbeat]', agent.name, 'review workspace file resolve failed (non-fatal):', wsErr.message);
  }
  const prompt = buildReviewPrompt(agent, task, workspaceFiles, costIntel, siteIntel, socialIntel, execContext);
  const response = await callGeminiExecute(prompt, agent.name.toLowerCase());
  if (!response) {
    context.log('[Heartbeat]', agent.name, 'review-task returned empty for:', task.title);
    return null;
  }

  // Parse verdict from response
  let verdict = 'approved';
  let feedback = response;

  // Check if the response contains structured verdict
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      verdict = parsed.verdict === 'changes-requested' ? 'changes-requested' : 'approved';
      feedback = parsed.feedback || response;
    }
  } catch (e) {
    // If no JSON, check for keywords
    const lower = response.toLowerCase();
    if (lower.includes('changes requested') || lower.includes('needs revision') || lower.includes('request changes') || lower.includes('not approved')) {
      verdict = 'changes-requested';
    }
  }

  context.log('[Heartbeat]', agent.name, 'reviewed:', task.title, '→', verdict);
  return { verdict, feedback };
}

function buildReviewPrompt(agent, task, workspaceFiles, costIntel, siteIntel, socialIntel, execContext) {
  workspaceFiles = workspaceFiles || [];
  costIntel = costIntel || null;
  siteIntel = siteIntel || {};
  socialIntel = socialIntel || null;
  execContext = execContext || {};
  // Find the deliverable comment(s)
  const deliverables = (task.comments || [])
    .filter(c => c.type === 'deliverable')
    .map(c => '--- Deliverable by ' + (c.author || 'unknown') + ' ---\n' + c.text)
    .join('\n\n') || '(no deliverable found)';

  // Find any previous reviews
  const previousReviews = (task.comments || [])
    .filter(c => c.type === 'review')
    .map(c => '--- Review by ' + (c.author || 'unknown') + ' [' + (c.verdict || '?') + '] ---\n' + c.text)
    .join('\n\n');

  const rDW = agent._doctrineWeight != null ? agent._doctrineWeight : 0.4;
  const reviewDoctrine = (agent.doctrine && rDW > 0) ? `
OPERATING DOCTRINE (apply with weight: ${rDW} / ${Math.round(rDW * 100)}%):
- Strategic Bias: ${agent.doctrine.strategicBias}
- Risk Tolerance: ${agent.doctrine.riskTolerance}
- Core Question: "${agent.doctrine.coreQuestion}"
Review through your doctrine lens. Doctrine does NOT override governance or CEO authority.
` : '';

  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.
${reviewDoctrine}
You are reviewing a deliverable from another team member. Evaluate the quality and completeness of their work.

TASK: ${task.title}
DESCRIPTION: ${task.description || '(no description)'}
ASSIGNED TO: ${task.assignee || 'unassigned'}
PRIORITY: ${task.priority}

DELIVERABLE(S):
${deliverables}
${previousReviews ? '\nPREVIOUS REVIEWS:\n' + previousReviews : ''}
${workspaceFiles.length > 0 ? '\nWORKSPACE FILES (actual source code — compare the deliverable against these real files, do NOT roleplay):\n' + workspaceFiles.map(f => '--- ' + f.path + ' ---\n' + f.content).join('\n\n') + '\n' : ''}${costIntel && costIntel.gemini && costIntel.gemini.totalCalls > 0 && agent.name === 'Cipher' ? '\n💰 REAL COST DATA for verification:\nGemini API Total: $' + costIntel.gemini.totalCost.toFixed(4) + ' | Calls: ' + costIntel.gemini.totalCalls + ' | Tokens: ' + costIntel.gemini.totalTokens.toLocaleString() + '\n' : ''}${_buildSiteIntelSection(agent, task, siteIntel)}${_buildSocialIntelExecSection(agent, task, socialIntel)}${_buildExecContextBlock(agent, task, execContext)}
Review this deliverable from your perspective as ${agent.role}. Then respond with ONLY valid JSON:
{
  "verdict": "approved" or "changes-requested",
  "feedback": "Your detailed review feedback — what's good, what needs improvement, specific suggestions. 2-4 sentences."
}

Guidelines:
- Approve if the work is solid and addresses the task
- Request changes if there are significant gaps, errors, or missing elements
- Be constructive — give specific, actionable feedback
- Consider quality from your role's perspective (${agent.focus})
- Do NOT request "Appendix A", external documents, or fictional dependencies that were not provided. Judge the deliverable based on what was actually produced.
- Do NOT loop — if the deliverable is reasonably complete, approve it. Perfection is not the goal; actionable output is.`;
}

// ── Call Gemini with higher token limit for deliverables/reviews ──
async function callGeminiExecute(prompt, agentId) {
  if (!GEMINI_API_KEY) return null;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      topP: 0.9,
      maxOutputTokens: 1200
    }
  };

  try {
    const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[Heartbeat] Gemini execute returned', res.status);
      return null;
    }

    const data = await res.json();
    // Track token usage
    const um = data?.usageMetadata;
    if (um) {
      storage.logGeminiUsage({ caller: 'heartbeat-execute', model: 'gemini-2.0-flash', agentId: agentId || null, promptTokens: um.promptTokenCount || 0, completionTokens: um.candidatesTokenCount || 0, totalTokens: um.totalTokenCount || 0 }).catch(() => {});
    }
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('[Heartbeat] Gemini execute call failed:', err.message);
    return null;
  }
}

// ── Call Gemini directly (same pattern as agentchat) ──
async function callGemini(prompt, agentId) {
  if (!GEMINI_API_KEY) return null;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 1500
    }
  };

  try {
    const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[Heartbeat] Gemini returned', res.status);
      return null;
    }

    const data = await res.json();
    // Track token usage
    const um = data?.usageMetadata;
    if (um) {
      storage.logGeminiUsage({ caller: 'heartbeat', model: 'gemini-2.0-flash', agentId: agentId || null, promptTokens: um.promptTokenCount || 0, completionTokens: um.candidatesTokenCount || 0, totalTokens: um.totalTokenCount || 0 }).catch(() => {});
    }
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('[Heartbeat] Gemini call failed:', err.message);
    return null;
  }
}

// ── Create action object from heartbeat (server-side, mirrors CompanySchemas.createActionRequest) ──
function _createActionFromHeartbeat(data, agentId) {
  const actionType = data.type || 'social_post.publish';
  const platform = data.platform || 'x';
  const requiresApproval = ['social_post.publish', 'social_post.reply', 'social_post.schedule'].indexOf(actionType) !== -1;
  const catMap = { social_post: 'social', email: 'email', git: 'git', azure: 'azure' };
  const catKey = actionType.split('.')[0] || 'unknown';
  const category = catMap[catKey] || 'content';

  return {
    id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    created_at: new Date().toISOString(),
    created_by: agentId,
    type: actionType,
    platform: platform,
    payload: data.payload || {},
    classification: 'advisory',
    requires_ceo_approval: requiresApproval,
    risk_level: 'medium',
    brand_impact: 'medium',
    budget_impact: 0,
    approval: {
      status: 'pending',
      approved_by: null,
      approved_at: null,
      decision_note: null
    },
    execution: {
      status: 'pending',
      started_at: null,
      finished_at: null,
      attempts: 0,
      last_error: null,
      receipt: null
    },
    // Legacy compat
    action_type: actionType,
    action_category: category,
    execution_status: 'pending',
    origin_agent: agentId,
    action_payload: data.payload || {},
    requires_approval: requiresApproval,
    is_irreversible: ['social_post.publish', 'social_post.reply'].indexOf(actionType) !== -1,
    bundle_id: null,
    source: 'heartbeat'
  };
}

// ── Log helper ──
async function logEvent(type, agentId, summary, cycleId, details) {
  const event = {
    id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    type: type,
    agentId: agentId,
    summary: summary,
    cycle: cycleId,
    timestamp: new Date().toISOString()
  };
  if (details && typeof details === 'object') event.details = details;
  await storage.appendLog(event);
}

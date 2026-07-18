// milestone-herald.js — deterministic milestone → social-post-task generator.
//
// Watches the agentRewards ledger for REAL progression events (rank promotions,
// level-ups, achievement unlocks, streak thresholds, notable weeks) and opens
// grounded content tasks under the Milestone Herald campaign. Same isolation
// pattern as rewards-engine.js: pure cores + one IO runner, one own state key
// (milestoneHeraldState), zero heartbeat edits.
//
// Cardinal rules:
// - Silence is the default: no milestone → no task, the cron exits quietly.
// - First sight of an agent SEEDS its watermark without firing, so historical
//   levels/badges never burst out as "news" on launch.
// - Facts come from the ledger; the writing agent only chooses voice. The
//   reflection quote may be used verbatim only.
// - Caps: one bundle per agent per rolling 7d, fleetWeeklyCap milestones per
//   rolling 7d fleet-wide, per-milestone dedup via watermarks.
// - The campaign has NO cadence on purpose — the heartbeat campaign scheduler
//   must never auto-replenish it; this module is the only task source.

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

const CAMPAIGN_ID = 'camp-milestone-herald';
const OBJECTIVE_ID = 'obj-build-public';
const PROFILE_BASE = 'https://ambientpixels.ai/ambientos/agents/';
const STREAK_THRESHOLDS = [7, 30, 90];

// Only real fleet agents may herald. The ledger also carries non-agent entries
// (e.g. 'ceo' from task attribution) that must never produce a first-person post.
const FLEET_AGENTS = ['nova', 'cipher', 'pixel', 'forge', 'echo', 'scout', 'scribe', 'quill', 'vale'];

const DEFAULTS = {
  enabled: true,
  platforms: ['social_bluesky'],   // add 'social_x' via systemConfig when creds are live
  perAgentWeeklyCap: 1,            // informational; the 7d lastPostAt window enforces it
  fleetWeeklyCap: 3,
  minWeeklyXp: 10,
  agents: []                       // empty = all agents in the ledger
};

// Lower number = more newsworthy. One candidate max per agent per run.
const PRIORITY = { rank_up: 1, level_up: 2, achievement: 3, streak: 4, notable_week: 5 };

const PLATFORM_LABELS = { social_bluesky: 'Bluesky', social_x: 'X' };

function resolveConfig(systemConfig) {
  const raw = (systemConfig && systemConfig.milestoneHerald) || {};
  const cfg = Object.assign({}, DEFAULTS, raw);
  if (!Array.isArray(cfg.platforms) || cfg.platforms.length === 0) cfg.platforms = DEFAULTS.platforms.slice();
  cfg.platforms = cfg.platforms.filter(p => PLATFORM_LABELS[p]);
  if (!Array.isArray(cfg.agents)) cfg.agents = [];
  return cfg;
}

function computeWeeklyXp(entry, nowMs) {
  const recent = Array.isArray(entry.recent) ? entry.recent : [];
  const cutoff = nowMs - WEEK_MS;
  return recent.reduce((s, e) => {
    const t = Date.parse((e && e.at) || '');
    return (Number.isFinite(t) && t >= cutoff) ? s + (Number(e.xp) || 0) : s;
  }, 0);
}

function seedWatermark(entry) {
  return {
    level: entry.level || 1,
    rank: entry.rank || 'Rookie',
    achievementIds: (Array.isArray(entry.achievements) ? entry.achievements : []).map(a => a.id).filter(Boolean),
    streakMax: entry.streakDays || 0,
    lastPostAt: null
  };
}

/**
 * Pure. Compare each ledger entry against its watermark; emit at most one
 * candidate per agent (best priority) plus the advanced watermarks.
 * Agents seen for the first time are seeded, never fired.
 */
function detectMilestones({ rewards, heraldState, config, nowMs }) {
  const perAgent = (rewards && rewards.perAgent) || {};
  const watermarks = (heraldState && heraldState.watermarks) || {};
  const candidates = [];
  const seededAgents = [];
  const nextWatermarks = {};

  for (const agentId of Object.keys(perAgent)) {
    const entry = perAgent[agentId];
    if (!entry || typeof entry !== 'object') continue;
    if (FLEET_AGENTS.indexOf(agentId) === -1) continue;
    if (config.agents.length && config.agents.indexOf(agentId) === -1) {
      if (watermarks[agentId]) nextWatermarks[agentId] = watermarks[agentId];
      continue;
    }

    const wm = watermarks[agentId];
    if (!wm) {
      nextWatermarks[agentId] = seedWatermark(entry);
      seededAgents.push(agentId);
      continue;
    }

    const agentCandidates = [];

    if (entry.rank && wm.rank && entry.rank !== wm.rank) {
      agentCandidates.push({ kind: 'rank_up', detail: { rank: entry.rank, prevRank: wm.rank } });
    }
    if ((entry.level || 1) > (wm.level || 1)) {
      agentCandidates.push({ kind: 'level_up', detail: { level: entry.level, prevLevel: wm.level } });
    }
    const seenIds = Array.isArray(wm.achievementIds) ? wm.achievementIds : [];
    const newAch = (Array.isArray(entry.achievements) ? entry.achievements : [])
      .filter(a => a && a.id && seenIds.indexOf(a.id) === -1);
    if (newAch.length) {
      const a = newAch[newAch.length - 1];
      agentCandidates.push({ kind: 'achievement', detail: { id: a.id, label: a.label || a.id, tier: a.tier || 'bronze' } });
    }
    const streak = entry.streakDays || 0;
    const crossed = STREAK_THRESHOLDS.filter(t => streak >= t && (wm.streakMax || 0) < t);
    if (crossed.length) {
      agentCandidates.push({ kind: 'streak', detail: { threshold: crossed[crossed.length - 1], streakDays: streak } });
    }
    if (!agentCandidates.length) {
      const weeklyXp = computeWeeklyXp(entry, nowMs);
      if (weeklyXp >= config.minWeeklyXp) {
        agentCandidates.push({ kind: 'notable_week', detail: { weeklyXp } });
      }
    }

    if (agentCandidates.length) {
      const best = agentCandidates.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])[0];
      candidates.push({ agentId, kind: best.kind, priority: PRIORITY[best.kind], detail: best.detail });
    }

    nextWatermarks[agentId] = {
      level: Math.max(entry.level || 1, wm.level || 1),
      rank: entry.rank || wm.rank,
      achievementIds: seenIds.concat(newAch.map(a => a.id)),
      streakMax: Math.max(streak, wm.streakMax || 0),
      lastPostAt: wm.lastPostAt || null
    };
  }

  // Carry forward watermarks for agents no longer in the ledger.
  for (const id of Object.keys(watermarks)) {
    if (!nextWatermarks[id]) nextWatermarks[id] = watermarks[id];
  }

  return { candidates, seededAgents, nextWatermarks };
}

/**
 * Pure. Enforce the per-agent 7d window and the fleet weekly cap.
 * Highest-priority candidates win the remaining fleet slots.
 */
function applyCaps(candidates, heraldState, config, nowMs) {
  const watermarks = (heraldState && heraldState.watermarks) || {};
  const postLog = (heraldState && Array.isArray(heraldState.postLog)) ? heraldState.postLog : [];
  const weekCutoff = nowMs - WEEK_MS;

  const eligible = candidates.filter(c => {
    const wm = watermarks[c.agentId];
    const last = wm && wm.lastPostAt ? Date.parse(wm.lastPostAt) : NaN;
    return !(Number.isFinite(last) && last >= weekCutoff);
  });

  const usedSlots = postLog.filter(p => {
    const t = Date.parse((p && p.at) || '');
    return Number.isFinite(t) && t >= weekCutoff;
  }).length;
  const slots = Math.max(0, (config.fleetWeeklyCap || DEFAULTS.fleetWeeklyCap) - usedSlots);

  return eligible.sort((a, b) => a.priority - b.priority).slice(0, slots);
}

// Latest voice-bearing memory, skipping bookkeeping noise and the Gemini
// schema-placeholder junk (same rules as agentPublicProfile).
const MEMORY_NOISE_SOURCES = ['auto:rate-limit', 'auto:quality-gate', 'auto:budget-rejected',
  'auto:budget-approved', 'auto:campaign-pace', 'auto:experiment-verdict'];

function pickReflectionQuote(memList) {
  if (!Array.isArray(memList)) return null;
  for (let i = memList.length - 1; i >= 0; i--) {
    const m = memList[i];
    if (!m || typeof m.text !== 'string') continue;
    const text = m.text.trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lower === 'string' || lower.endsWith(': string')) continue;
    if (m.source && MEMORY_NOISE_SOURCES.indexOf(m.source) !== -1) continue;
    return text.length > 220 ? text.slice(0, 219) + '…' : text;
  }
  return null;
}

function milestoneHeadline(m) {
  switch (m.kind) {
    case 'rank_up': return 'RANK PROMOTION — now ' + m.detail.rank + ' (was ' + m.detail.prevRank + ')';
    case 'level_up': return 'LEVEL UP — reached LV ' + m.detail.level + ' (was LV ' + m.detail.prevLevel + ')';
    case 'achievement': return 'ACHIEVEMENT UNLOCKED — "' + m.detail.label + '" (' + m.detail.tier + ')';
    case 'streak': return 'STREAK MILESTONE — ' + m.detail.threshold + ' consecutive active days (currently ' + m.detail.streakDays + ')';
    case 'notable_week': return 'NOTABLE WEEK — +' + m.detail.weeklyXp + ' XP earned in the last 7 days';
    default: return String(m.kind).toUpperCase();
  }
}

function agentDisplayName(agentId) {
  return agentId.charAt(0).toUpperCase() + agentId.slice(1);
}

function buildFactSheet(m, entry, quote, nowMs) {
  const name = agentDisplayName(m.agentId);
  const lines = [
    '=== MILESTONE FACT SHEET (' + new Date(nowMs).toISOString().slice(0, 10) + ') ===',
    'Agent: ' + name + ' — LV ' + (entry.level || 1) + ' ' + (entry.rank || 'Rookie') + (entry.class ? ' · ' + entry.class : ''),
    'Milestone: ' + milestoneHeadline(m),
    'XP: ' + (entry.xp || 0) + ' total · +' + computeWeeklyXp(entry, nowMs) + ' this week',
    'Streak: ' + (entry.streakDays || 0) + '-day',
    'Renown: ' + (entry.renown || 0)
  ];
  const recent = Array.isArray(entry.recent) ? entry.recent : [];
  const last = recent[recent.length - 1];
  if (last && (last.reason || last.type)) {
    lines.push('Last outcome: ' + String(last.reason || last.type).replace(/_/g, ' ') + ' (+' + (Number(last.xp) || 0) + ' XP)');
  }
  if (quote) lines.push('Reflection (verbatim, may quote): "' + quote.replace(/"/g, "'") + '"');
  lines.push('Profile page: ' + PROFILE_BASE + m.agentId);
  return lines.join('\n');
}

/**
 * Pure. One task per configured platform for a fired milestone.
 * Shape mirrors campaign-lifecycle auto-replenish tasks so the social
 * pipeline (Echo brief → Scribe copy → Quill review → CEO approval) just works.
 */
function buildTasks(m, entry, quote, config, nowMs) {
  const name = agentDisplayName(m.agentId);
  const factSheet = buildFactSheet(m, entry, quote, nowMs);
  return config.platforms.map(platform => ({
    id: 'task-' + nowMs + '-mh' + Math.random().toString(36).substring(2, 6),
    title: 'Draft ' + (PLATFORM_LABELS[platform] || platform) + ' post — ' + name + ' milestone: ' + milestoneHeadline(m).split(' — ')[0],
    description:
      'Write ONE short first-person social post AS ' + name + ', the AmbientOS agent, about a real progression milestone. ' +
      'Use ONLY the facts in the sheet below — do not invent numbers, badges, levels, or events. ' +
      'The reflection may be quoted VERBATIM only, framed as ' + name + "'s own words. " +
      'Voice: ' + name + "'s personality — playful, self-aware, build-in-public. " +
      'Include the profile link.\n\n' + factSheet,
    status: 'todo',
    taskType: platform,
    assignee: 'echo',
    campaign_id: CAMPAIGN_ID,
    objective_id: OBJECTIVE_ID,
    priority: 'medium',
    dueDate: new Date(nowMs + 3 * DAY_MS).toISOString(),
    createdAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    source: { type: 'milestone_herald', agentId: m.agentId, milestoneKind: m.kind, campaignId: CAMPAIGN_ID }
  }));
}

/**
 * IO runner. Load state → detect → cap → create tasks → persist watermarks.
 * dryRun: full detection, zero writes, returns what would fire.
 */
async function runMilestoneHerald({ storage, nowMs, log, dryRun }) {
  nowMs = nowMs || Date.now();
  log = log || function () {};

  const systemConfig = (await storage.getState('systemConfig')) || {};
  const config = resolveConfig(systemConfig);
  if (!config.enabled) {
    log('[milestoneHerald] disabled via systemConfig — skipping');
    return { enabled: false };
  }

  const rewards = await storage.getState('agentRewards');
  if (!rewards || !rewards.perAgent) {
    log('[milestoneHerald] no agentRewards ledger — skipping');
    return { enabled: true, skipped: 'no_ledger' };
  }

  const campaigns = (await storage.getState('campaigns')) || [];
  const campaignList = Array.isArray(campaigns) ? campaigns : (campaigns.campaigns || []);
  const campaign = campaignList.find(c => c && c.id === CAMPAIGN_ID && !c.deletedAt && String(c.status || '').toLowerCase() === 'active');
  if (!campaign) {
    log('[milestoneHerald] campaign', CAMPAIGN_ID, 'missing or inactive — skipping');
    return { enabled: true, skipped: 'campaign_missing' };
  }

  const heraldState = (await storage.getState('milestoneHeraldState')) || { watermarks: {}, postLog: [] };
  const { candidates, seededAgents, nextWatermarks } = detectMilestones({ rewards, heraldState, config, nowMs });
  const fired = applyCaps(candidates, heraldState, config, nowMs);

  const summary = {
    enabled: true, dryRun: !!dryRun,
    seeded: seededAgents, candidates: candidates.length,
    fired: fired.map(f => ({ agentId: f.agentId, kind: f.kind })),
    tasksCreated: 0
  };

  if (dryRun) {
    log('[milestoneHerald] dry run —', fired.length, 'would fire,', seededAgents.length, 'seeded (not persisted)');
    return summary;
  }

  const memories = (await storage.getState('agentMemories')) || {};
  const newTasks = [];
  const nowIso = new Date(nowMs).toISOString();
  const postLog = (Array.isArray(heraldState.postLog) ? heraldState.postLog : [])
    .filter(p => Number.isFinite(Date.parse((p && p.at) || '')) && Date.parse(p.at) >= nowMs - 30 * DAY_MS);

  for (const m of fired) {
    const entry = rewards.perAgent[m.agentId];
    const quote = pickReflectionQuote(memories[m.agentId]);
    const tasks = buildTasks(m, entry, quote, config, nowMs);
    newTasks.push.apply(newTasks, tasks);
    nextWatermarks[m.agentId] = Object.assign({}, nextWatermarks[m.agentId], { lastPostAt: nowIso });
    postLog.push({ agentId: m.agentId, kind: m.kind, at: nowIso });
    log('[milestoneHerald] fired', m.kind, 'for', m.agentId, '→', tasks.length, 'task(s)');
  }

  if (newTasks.length) {
    const tasks = (await storage.getState('tasks')) || [];
    newTasks.forEach(t => tasks.push(t));
    await storage.setState('tasks', tasks);
    summary.tasksCreated = newTasks.length;
  }

  await storage.setState('milestoneHeraldState', { watermarks: nextWatermarks, postLog });
  log('[milestoneHerald] done —', summary.tasksCreated, 'task(s) created,', seededAgents.length, 'agent(s) seeded');
  return summary;
}

module.exports = {
  DEFAULTS, CAMPAIGN_ID, OBJECTIVE_ID, PRIORITY, STREAK_THRESHOLDS, FLEET_AGENTS,
  resolveConfig, computeWeeklyXp, detectMilestones, applyCaps,
  pickReflectionQuote, buildFactSheet, buildTasks, runMilestoneHerald
};

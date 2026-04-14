// reflection-intel.js — Self-Awareness Phase 1
//
// Builds a per-agent introspection digest + the YOUR SELF-REFLECTION prompt
// block. Consumed by prompt-builders.js (injection) and
// modules/company/awareness.html (via api/awarenessDigest endpoint).
//
// Import direction: prompt-builders.js imports from here. This module must NOT
// import from prompt-builders.js (circular require at load time).

const {
  AGENT_IDS, AGENT_ROLES, _agentPersonalityData,
  REFLECTION_CADENCE_DAYS,
  STRATEGY_FATIGUE_MIN_ATTEMPTS, STRATEGY_FATIGUE_MIN_VS_MEDIAN
} = require('./constants');

const DECISION_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const ACTION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const FATIGUE_LOOKBACK_MS = 21 * 24 * 60 * 60 * 1000;

// Classify an outcome delta into improved/tied/regressed.
function classifyOutcome(deltaVsAgentMedian) {
  if (deltaVsAgentMedian == null) return 'pendingOutcome';
  if (deltaVsAgentMedian > 0.15) return 'improved';
  if (deltaVsAgentMedian < -0.15) return 'regressed';
  return 'tied';
}

// Group items by keyFn into { key: count } or { key: [items] }
function groupCount(items, keyFn) {
  const out = {};
  for (let i = 0; i < items.length; i++) {
    const k = keyFn(items[i]);
    if (k == null) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function groupList(items, keyFn) {
  const out = {};
  for (let i = 0; i < items.length; i++) {
    const k = keyFn(items[i]);
    if (k == null) continue;
    if (!out[k]) out[k] = [];
    out[k].push(items[i]);
  }
  return out;
}

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

// Compare actual action mix to expected role mix. Returns a drift label.
function classifyDrift(actualMix, expectedMix) {
  if (!expectedMix) return 'unknown';
  const totals = Object.values(actualMix).reduce((s, n) => s + n, 0);
  if (totals === 0) return 'under-producing';

  // Check for 'none' violations (did something the role is explicitly NOT meant to do).
  const violations = [];
  Object.keys(expectedMix).forEach(t => {
    if (expectedMix[t] === 'none' && (actualMix[t] || 0) > 0) {
      violations.push(t);
    }
  });
  if (violations.length > 0) {
    // Special case: Echo writing create-social-action directly is the biggest
    // drift risk per CLAUDE.md ("Echo NEVER writes post copy").
    return 'drifting-' + violations[0];
  }

  // Under-producing-core: agent has activity but NONE in any high-or-medium
  // expected category. We widened to include medium because execute-task,
  // update-task, review-task heartbeat types flow through task-mutations.js
  // (not actions[]) so they're invisible to us. Comments + create-task +
  // create-doc + remember cover most real activity — if an agent shows none
  // of their expected medium+ categories, that IS a legit drift signal.
  let expectedTypes = new Set();
  Object.keys(expectedMix).forEach(t => {
    if (expectedMix[t] === 'high' || expectedMix[t] === 'medium') {
      expectedTypes.add(t);
    }
  });
  if (expectedTypes.size > 0 && totals > 2) {
    let coreActual = 0;
    expectedTypes.forEach(t => { coreActual += actualMix[t] || 0; });
    if (coreActual === 0) return 'under-producing-core';
  }

  return 'on-role';
}

// Strategy fatigue: scan actions for repeated (hookType, platform) or
// (experimentTag) clusters where >=5 attempts AND median engagement <70% of
// the agent's overall median.
function detectFatigue(agentId, recentActions, outcomeSnapshots, agentMedian) {
  const fatigue = [];
  if (!recentActions || recentActions.length < STRATEGY_FATIGUE_MIN_ATTEMPTS) return fatigue;
  if (!agentMedian || agentMedian <= 0) return fatigue; // insufficient outcome data yet

  // Cluster by hookType+platform (via outcomeSnapshots lookup by actionId)
  const clusters = {};
  recentActions.forEach(a => {
    if (!a || !a.id) return;
    const snap = outcomeSnapshots && outcomeSnapshots[a.id];
    if (!snap) return;
    const key = (snap.hookType || 'general') + '|' + (snap.platform || 'unknown');
    if (!clusters[key]) clusters[key] = { engagements: [], attempts: 0 };
    clusters[key].attempts++;
    if (snap.complete) {
      const t7 = (snap.samples || []).find(s => s.lag === 't7');
      if (t7) {
        const total = (Number(t7.likes || 0) + Number(t7.comments || 0) + Number(t7.reposts || 0));
        clusters[key].engagements.push(total);
      }
    }
  });

  Object.keys(clusters).forEach(key => {
    const c = clusters[key];
    if (c.attempts < STRATEGY_FATIGUE_MIN_ATTEMPTS) return;
    if (c.engagements.length < 2) return; // need some mature data
    const m = median(c.engagements);
    if (m < agentMedian * STRATEGY_FATIGUE_MIN_VS_MEDIAN) {
      const [hookType, platform] = key.split('|');
      const pct = agentMedian > 0 ? Math.round((m / agentMedian - 1) * 100) : 0;
      fatigue.push({
        signal: 'hookType:' + hookType + ' on ' + platform,
        attempts: c.attempts,
        medianEngagement: Math.round(m * 100) / 100,
        vsAgentMedian: pct,
        recommendation: 'try a different hook; ' + c.attempts + ' attempts, engagement ' + Math.abs(pct) + '% below your median'
      });
    }
  });

  return fatigue;
}

// Detect tasks the agent has retried >=3 times without success.
function detectRepeatedFailures(agentId, tasks) {
  const failures = [];
  if (!Array.isArray(tasks)) return failures;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t || t.assignee !== agentId) continue;
    if (t.status === 'done') continue;
    const comments = t.comments || [];
    const failedAttempts = comments.filter(c => c && (c.type === 'failed_attempt' || (c.text || '').toLowerCase().indexOf('failed attempt') !== -1));
    if (failedAttempts.length >= 3) {
      failures.push({
        taskId: t.id,
        title: (t.title || '').substring(0, 80),
        attempts: failedAttempts.length,
        status: t.status || 'unknown'
      });
    }
  }
  return failures.slice(0, 5); // cap display
}

// Executor action type → heartbeat action type.
// The `actions` store contains EXECUTOR-level types (social_post.schedule,
// publish_document, image.generate) but expectedActionMix is declared in
// HEARTBEAT-level types (create-social-action, create-doc, generate-image).
// Normalize executor types back to their heartbeat origin so drift detection
// compares apples to apples.
const EXECUTOR_TO_HEARTBEAT_TYPE = {
  'social_post.schedule': 'create-social-action',
  'social_post.publish': 'create-social-action',
  'social_post.reply': 'bluesky-reply',
  'publish_document': 'create-doc',
  'submit_for_publish': 'submit-for-publish',
  'image.generate': 'generate-image',
  'content_package.execute': 'execute-task',
  'task_completion.approve': 'review-task',
  'research_intel.approve': 'web_search'
};
function normalizeActionType(t) {
  if (!t) return 'unknown';
  return EXECUTOR_TO_HEARTBEAT_TYPE[t] || t;
}

function buildReflectionDigest(agentDecisions, outcomeSnapshots, actions, memories, tasks, outcomeDigest, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const decisionCutoff = now - DECISION_LOOKBACK_MS;
  const actionCutoff = now - ACTION_LOOKBACK_MS;
  const fatigueCutoff = now - FATIGUE_LOOKBACK_MS;

  const decisions = Array.isArray(agentDecisions) ? agentDecisions : [];
  const allActions = Array.isArray(actions) ? actions : [];
  const mems = memories && typeof memories === 'object' ? memories : {};

  const perAgent = {};
  let fatigueCount = 0;
  let roleDriftCount = 0;
  let overdueCount = 0;

  for (let i = 0; i < AGENT_IDS.length; i++) {
    const aid = AGENT_IDS[i];
    const roleDef = AGENT_ROLES[aid] || {};
    const personality = _agentPersonalityData[aid] || {};

    // Decision patterns (last 14d)
    const myDecisions = decisions.filter(d => {
      if (!d || d.agentId !== aid) return false;
      const ts = Date.parse(d.timestamp || 0);
      return Number.isFinite(ts) && ts >= decisionCutoff;
    });
    const byType = groupList(myDecisions, d => d.decisionType || 'unspecified');
    const decisionPatterns = Object.keys(byType).map(t => {
      const list = byType[t];
      const cls = { total: list.length, improved: 0, tied: 0, regressed: 0, pendingOutcome: 0 };
      list.forEach(d => {
        const c = classifyOutcome(d.outcome && d.outcome.deltaVsAgentMedian);
        cls[c]++;
      });
      return Object.assign({ decisionType: t }, cls);
    });

    // Action-type mix (last 7d) — pulled from MULTIPLE sources because most
    // agent work never lands in the `actions` store (which only holds external
    // approved actions). Nova/Cipher do most work via tasks + memories; those
    // channels must be counted or drift detection false-positives under-
    // producing for correctly-functioning agents.
    //
    // Sources:
    //   - actions[] filtered by created_by (executor types → heartbeat types via map)
    //   - tasks[] created by agent (counted as 'create-task')
    //   - task comments authored by agent (counted as 'comment-task')
    //   - memories written by agent in the window (counted as 'remember')
    const actualMix = {};

    // a) Actions — translate executor types back to heartbeat equivalents.
    const myActions = allActions.filter(a => {
      if (!a || a.created_by !== aid) return false;
      const ts = Date.parse(a.createdAt || a.created_at || 0);
      return Number.isFinite(ts) && ts >= actionCutoff;
    });
    myActions.forEach(a => {
      const t = normalizeActionType(a.type);
      actualMix[t] = (actualMix[t] || 0) + 1;
    });

    // b) Tasks created by this agent.
    if (Array.isArray(tasks)) {
      const myCreates = tasks.filter(t => {
        if (!t) return false;
        const creator = t.createdBy || t.created_by || t.createdby;
        if (creator !== aid) return false;
        const ts = Date.parse(t.createdAt || t.created_at || 0);
        return Number.isFinite(ts) && ts >= actionCutoff;
      }).length;
      if (myCreates > 0) actualMix['create-task'] = (actualMix['create-task'] || 0) + myCreates;

      // c) Comments authored by agent across all tasks (proxy for comment-task + review activity).
      let myComments = 0;
      for (let ti = 0; ti < tasks.length; ti++) {
        const tt = tasks[ti];
        if (!tt || !Array.isArray(tt.comments)) continue;
        for (let ci = 0; ci < tt.comments.length; ci++) {
          const c = tt.comments[ci];
          if (!c || c.author !== aid) continue;
          const cts = Date.parse(c.createdAt || c.created_at || 0);
          if (Number.isFinite(cts) && cts >= actionCutoff) myComments++;
        }
      }
      if (myComments > 0) actualMix['comment-task'] = (actualMix['comment-task'] || 0) + myComments;
    }

    // d) Memory writes — 'remember' heartbeat action type.
    const myMemsInWindow = (mems[aid] || []).filter(m => {
      if (!m) return false;
      const ts = Date.parse(m.timestamp || 0);
      return Number.isFinite(ts) && ts >= actionCutoff;
    }).length;
    if (myMemsInWindow > 0) actualMix['remember'] = (actualMix['remember'] || 0) + myMemsInWindow;
    const expectedMix = roleDef.expectedActionMix || null;
    const drift = classifyDrift(actualMix, expectedMix);
    if (drift !== 'on-role' && drift !== 'unknown') roleDriftCount++;

    // Strategy fatigue (last 21d, keyed on outcomeSnapshots hookType+platform)
    const fatigueActions = allActions.filter(a => {
      if (!a || a.created_by !== aid) return false;
      const ts = Date.parse(a.createdAt || a.created_at || 0);
      return Number.isFinite(ts) && ts >= fatigueCutoff;
    });
    const agentMedian = (outcomeDigest && outcomeDigest.perAgent && outcomeDigest.perAgent[aid] && outcomeDigest.perAgent[aid].medianTotalEngagement) || 0;
    const strategyFatigue = detectFatigue(aid, fatigueActions, outcomeSnapshots, agentMedian);
    fatigueCount += strategyFatigue.length;

    // Repeated failures
    const repeatedFailures = detectRepeatedFailures(aid, tasks);

    // Cadence: lastReflectionAt from memories where type='reflection'
    const myMems = mems[aid] || [];
    const reflMems = myMems.filter(m => m && m.type === 'reflection');
    const latestReflection = reflMems.length > 0
      ? reflMems.reduce((latest, m) => {
          const mt = Date.parse(m.timestamp || 0);
          const lt = latest ? Date.parse(latest.timestamp || 0) : 0;
          return (Number.isFinite(mt) && mt > lt) ? m : latest;
        }, null)
      : null;
    const lastReflectionAt = latestReflection ? latestReflection.timestamp : null;
    // CRITICAL: null is first-deploy case. Treat as massively overdue so nudge fires.
    // Never default to 0 (would silently suppress nudge) or cause NaN on subtraction.
    let reflectionDueDays;
    let reflectionOverdue;
    if (lastReflectionAt == null) {
      reflectionDueDays = 999;
      reflectionOverdue = true;
    } else {
      const lastMs = Date.parse(lastReflectionAt);
      if (!Number.isFinite(lastMs)) {
        reflectionDueDays = 999;
        reflectionOverdue = true;
      } else {
        const daysSince = (now - lastMs) / (24 * 60 * 60 * 1000);
        reflectionDueDays = Math.max(0, Math.round(daysSince - REFLECTION_CADENCE_DAYS));
        reflectionOverdue = daysSince >= REFLECTION_CADENCE_DAYS;
      }
    }
    if (reflectionOverdue) overdueCount++;

    perAgent[aid] = {
      coreQuestion: (roleDef.doctrine && roleDef.doctrine.coreQuestion) || null,
      internalMonologue: (personality && personality.internalMonologue) || null,
      decisionPatterns: decisionPatterns,
      strategyFatigue: strategyFatigue,
      roleAdherence: {
        actual: actualMix,
        expected: expectedMix,
        drift: drift
      },
      repeatedFailures: repeatedFailures,
      lastReflectionAt: lastReflectionAt,
      reflectionDueDays: reflectionDueDays,
      reflectionOverdue: reflectionOverdue
    };
  }

  return {
    generatedAt: new Date(now).toISOString(),
    perAgent: perAgent,
    globals: {
      totalAgents: AGENT_IDS.length,
      reflectionsOverdue: overdueCount,
      fatigueSignalsCount: fatigueCount,
      roleDriftCount: roleDriftCount
    }
  };
}

// ── Role-specific reflection focus ──
// Agents that don't produce social posts or hit quality-gate-rewrite sites
// have near-empty decisionPatterns + strategyFatigue. Instead of showing them
// empty sections, we surface a role-specific focus prompt so their reflection
// targets something meaningful. Keeps the prompt block lean AND useful.
const ROLE_REFLECTION_FOCUS = {
  scout: 'Focus on: research pipeline health. Are your web searches producing actionable intel that other agents cite? Is your research backlog resolving or accumulating? Have you surfaced a competitive signal the CEO hadn\'t seen this week?',
  pixel: 'Focus on: design output. Are hero images landing within campaign pace? Any recurring CEO corrections on visual style? Which products have gone >30 days without new visual assets?',
  quill: 'Focus on: editing throughput + voice consistency. Are you reviewing Scribe\'s output within 1 heartbeat? Are your feedback patterns consistent (or are you catching the same issues repeatedly — which suggests Scribe isn\'t internalizing)?'
};

// ── Prompt block builder (Phase 3) ──
// Pure deterministic formatting. Does NOT generate LLM insights inline — that's
// the agent's job in their reflection memory. We supply data; they interpret.
function _buildReflectionPromptBlock(agentId, reflectionDigest) {
  if (!reflectionDigest || !reflectionDigest.perAgent) return '';
  const agent = reflectionDigest.perAgent[agentId];
  if (!agent) return '';

  const lines = [];
  lines.push('');
  lines.push('YOUR SELF-REFLECTION (evidence for your next type=\'reflection\' memory):');
  lines.push('');

  if (agent.coreQuestion) {
    lines.push('CORE QUESTION (from your role doctrine):');
    lines.push('  "' + agent.coreQuestion + '"');
    lines.push('');
  }

  // Role focus (Scout/Quill/Pixel only — others get the data-heavy sections)
  const roleFocus = ROLE_REFLECTION_FOCUS[agentId];
  if (roleFocus) {
    lines.push('REFLECTION FOCUS:');
    lines.push('  ' + roleFocus);
    lines.push('');
  }

  // Decision patterns — suppressed entirely for Scout/Quill/Pixel when empty
  // (their decision hooks don't fire yet; showing "no decisions" is prompt noise).
  const patterns = agent.decisionPatterns || [];
  if (patterns.length > 0) {
    lines.push('RECENT DECISION OUTCOMES (last 14 days):');
    patterns.forEach(p => {
      lines.push('- ' + p.decisionType + ': ' + p.total + ' decisions. ' +
        p.improved + ' improved, ' + p.tied + ' tied, ' + p.regressed + ' regressed, ' +
        p.pendingOutcome + ' pending.');
    });
    lines.push('');
  } else if (!roleFocus) {
    lines.push('RECENT DECISION OUTCOMES: no structured decisions logged in last 14 days.');
    lines.push('');
  }

  // Strategy fatigue
  const fatigue = agent.strategyFatigue || [];
  if (fatigue.length > 0) {
    lines.push('STRATEGY FATIGUE SIGNALS:');
    fatigue.forEach(f => {
      lines.push('- ' + f.signal + ' — ' + f.attempts + ' attempts, engagement ' + Math.abs(f.vsAgentMedian) + '% below your median.');
      lines.push('  Recommendation: ' + f.recommendation);
    });
    lines.push('');
  }

  // Role adherence
  const rh = agent.roleAdherence || {};
  const mixStr = rh.actual ? Object.keys(rh.actual).map(k => k + ':' + rh.actual[k]).join(', ') : '(no actions 7d)';
  if (rh.drift === 'on-role') {
    lines.push('ROLE ADHERENCE: on-role. (Your 7-day action mix aligns with expected shape.)');
  } else if (rh.drift && rh.drift.indexOf('drifting-') === 0) {
    const action = rh.drift.replace('drifting-', '');
    lines.push('ROLE ADHERENCE: drifting. (Your role doesn\'t produce "' + action + '" directly — you did this 7d. Actual mix: ' + mixStr + '.)');
  } else if (rh.drift === 'under-producing') {
    lines.push('ROLE ADHERENCE: under-producing. (No actions in last 7 days — if you\'re blocked, write a memory explaining why.)');
  } else if (rh.drift === 'under-producing-core') {
    lines.push('ROLE ADHERENCE: under-producing-core. (You have actions 7d but zero in your role\'s high-expected categories. Actual: ' + mixStr + '.)');
  }
  lines.push('');

  // Repeated failures
  const fails = agent.repeatedFailures || [];
  if (fails.length > 0) {
    lines.push('REPEATED FAILURES:');
    fails.forEach(f => {
      lines.push('- ' + (f.title || f.taskId) + ': ' + f.attempts + ' failed attempts, status=' + f.status + '. Consider declining, escalating, or changing approach.');
    });
    lines.push('');
  }

  if (agent.reflectionOverdue) {
    lines.push('⏰ REFLECTION DUE — see nudge below.');
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  buildReflectionDigest,
  _buildReflectionPromptBlock,
  classifyDrift,
  classifyOutcome
};

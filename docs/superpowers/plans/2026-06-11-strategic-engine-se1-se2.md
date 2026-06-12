# Strategic Engine SE-1 + SE-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every agent a CEO-authored north-star KPI tree in their prompt (SE-1) and make objective progress metric-computed with auto-complete at target (SE-2), killing the stale-objective class.

**Architecture:** One new pure module `strategy-intel.js` (no requires, no storage calls — same class as `quality-gate.js`) provides metric resolvers, a strategy digest, a `COMPANY STRATEGY` prompt block (hard char cap, injected directly under WORLD STATE), and `evaluateObjectives()` which mutates measurable objectives in place and returns governance events. The heartbeat wires it in at 4 small call sites; objective gov events ride the existing `campaignGovEvents` → governanceLog merge. A new `companyStrategy` state key (allowlisted in company-state) is seeded once by script; 3 of the 4 active objectives get CEO-sanctioned completion flips by a retrofit script.

**Tech Stack:** Node.js Azure Functions (CommonJS), offline `.cjs` assert tests in `c:/tmp/` (house pattern from `test-grace-window.cjs`), deploy via `git push origin master` (CI/CD).

**CEO-confirmed inputs (2026-06-11 session):**
- North stars (priority order): paying_customers 0→**1** by 2026-08-31 (PRIMARY, manual source) · bluesky_followers 72→**500** by 2026-09-30 (auto) · blog_views_week 16→**100** by 2026-09-30 (auto) · weekly_active_users ?→**25** by 2026-09-30 (manual, telemetry pending)
- Revenue posture: first paying customer is THE era goal · Cadence: monthly · Pitch scope (SE-3, later): all 7 dept heads
- Budget $35/mo · Era: `real-company-v1`

**High-blast-radius acknowledgment:** This plan edits `api/companyHeartbeat/index.js`, `agent-runner.js`, `prompt-builders.js`, and adds ONE line to `api/company-state/index.js` (VALID_KEYS). All are explicitly required by the CEO-approved SE-1/SE-2 scope. Read each region before editing. Nothing else on the do-not-touch list is touched. `systemConfig` is NOT touched at all.

**Decoupling rule that keeps this safe:** `evaluateObjectives()` does not need the `companyStrategy` key — measurable criteria live on the objective itself (`criteria: {metric, target, by, baseline}`). If the strategy key is missing/unseeded, prompts simply lack the block and nothing else changes (fail-open, like worldState).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `api/companyHeartbeat/strategy-intel.js` | **Create** | Pure: resolvers, digest, prompt block, evaluateObjectives |
| `c:/tmp/test-strategy-intel.cjs` | **Create** | Offline assert tests (TDD, written first) |
| `api/company-state/index.js` | Modify (1 line) | Allowlist `companyStrategy` |
| `api/companyHeartbeat/index.js` | Modify (4 sites) | Load key, build digest, thread ctx ×2, SE-2 evaluate call + legacy-skip guard |
| `api/companyHeartbeat/agent-runner.js` | Modify (3 sites) | Destructure, `_promptCtx`, capture `northStarMetric` in both proposal handlers |
| `api/companyHeartbeat/prompt-builders.js` | Modify (4 sites) | Import, destructure, build+inject block, STRATEGIC AUTHORITY schema text |
| `modules/company/objectives.html` | Modify (2 sites) | Display metric progress for measurable objectives; skip client auto-sync for them |
| `scripts/seed-company-strategy.cjs` | **Create** | One-time seed of `companyStrategy` (dry-run default, `--apply`) |
| `scripts/retrofit-objectives-se2.cjs` | **Create** | Completion flips for 3 objectives + gov log entries (dry-run default, `--apply`) |

---

### Task 1: `strategy-intel.js` — resolvers + digest (TDD)

**Files:**
- Create: `c:/tmp/test-strategy-intel.cjs`
- Create: `c:\Dev\Ambientpixels\ambientpixels\api\companyHeartbeat\strategy-intel.js`

- [ ] **Step 1: Write the failing test file**

Write `c:/tmp/test-strategy-intel.cjs` (house pattern: plain asserts, counter, exit 1 on failure):

```javascript
// Offline test of api/companyHeartbeat/strategy-intel.js — pure module, no mocks needed.
const SI = require('c:/Dev/Ambientpixels/ambientpixels/api/companyHeartbeat/strategy-intel.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

const NOW = Date.parse('2026-06-12T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const STRATEGY = {
  mission: 'AI-native studio where agents run the company and products ship in public.',
  era: 'real-company-v1',
  eraGoal: 'Prove the system can win real paying customers.',
  planningCadence: 'monthly',
  northStar: [
    { metric: 'paying_customers', label: 'Paying customers', priority: 1, target: 1, by: '2026-08-31', source: 'manual', current: 0, baseline: 0 },
    { metric: 'bluesky_followers', label: 'Bluesky followers', priority: 2, target: 500, by: '2026-09-30', source: 'socialAccountStats', baseline: 72 },
    { metric: 'blog_views_week', label: 'Blog views/week', priority: 3, target: 100, by: '2026-09-30', source: 'blogPostViews', baseline: 16 },
    { metric: 'weekly_active_users', label: 'Weekly active product users', priority: 4, target: 25, by: '2026-09-30', source: 'manual', current: null, baseline: 0 }
  ],
  riskPosture: 'autonomous-inside-rails',
  monthlyBudget: 35
};

const SOURCES = {
  socialAccountStats: { platforms: { bluesky: { followers: 80 }, x: { followers: 53 }, linkedin: { followers: 0 } }, totals: { followers: 133 } },
  blogPostViews: [
    { slug: 'a', timestamp: new Date(NOW - 1 * DAY).toISOString() },
    { slug: 'b', timestamp: new Date(NOW - 3 * DAY).toISOString() },
    { slug: 'c', timestamp: new Date(NOW - 6 * DAY).toISOString() },
    { slug: 'd', timestamp: new Date(NOW - 9 * DAY).toISOString() } // outside 7d
  ]
};

console.log('— resolveNorthStarMetric —');
ok(SI.resolveNorthStarMetric(STRATEGY.northStar[1], SOURCES, NOW).value === 80, 'bluesky_followers reads socialAccountStats.platforms.bluesky.followers');
ok(SI.resolveNorthStarMetric(STRATEGY.northStar[2], SOURCES, NOW).value === 3, 'blog_views_week counts trailing-7d events only');
ok(SI.resolveNorthStarMetric(STRATEGY.northStar[0], SOURCES, NOW).value === 0, 'manual source returns entry.current');
ok(SI.resolveNorthStarMetric(STRATEGY.northStar[3], SOURCES, NOW).resolved === false, 'manual with null current → resolved:false');
ok(SI.resolveNorthStarMetric({ metric: 'unknown_thing', source: 'auto' }, SOURCES, NOW).resolved === false, 'unknown metric → resolved:false, no throw');
ok(SI.resolveNorthStarMetric(STRATEGY.northStar[1], {}, NOW).resolved === false, 'missing sources → resolved:false, no throw');

console.log('— buildStrategyDigest —');
const digest = SI.buildStrategyDigest(STRATEGY, SOURCES, NOW);
ok(digest && digest.era === 'real-company-v1', 'digest carries era');
ok(digest.northStar.length === 4, 'digest has 4 north stars');
ok(digest.northStar[1].current === 80 && digest.northStar[1].resolved === true, 'digest resolves live values');
ok(digest.northStar[1].pctToTarget === Math.round(((80 - 72) / (500 - 72)) * 100), 'pctToTarget uses baseline');
ok(SI.buildStrategyDigest(null, SOURCES, NOW) === null, 'null strategy → null digest');
ok(SI.buildStrategyDigest({ northStar: [] }, SOURCES, NOW) === null, 'empty northStar → null digest');

console.log('— _buildStrategyPromptBlock —');
const block = SI._buildStrategyPromptBlock(digest);
ok(block.indexOf('COMPANY STRATEGY') !== -1, 'block has header');
ok(block.indexOf('paying_customers') !== -1 && block.indexOf('2026-08-31') !== -1, 'block lists primary north star with deadline');
ok(block.indexOf('northStarMetric') !== -1, 'block states the proposal rule');
ok(block.length <= SI.MAX_STRATEGY_BLOCK_CHARS, 'block under hard cap (' + block.length + '/' + SI.MAX_STRATEGY_BLOCK_CHARS + ')');
ok(SI._buildStrategyPromptBlock(null) === '', 'null digest → empty string (prompts unchanged)');

console.log('— evaluateObjectives —');
function freshObjs() {
  return [
    { id: 'o1', title: 'Grow bluesky', status: 'active', progress: 10,
      criteria: { metric: 'bluesky_followers', target: 75, by: '2026-09-30', baseline: 72 } },          // current 80 ≥ 75 → auto-complete
    { id: 'o2', title: 'Blog reach', status: 'active', progress: 50,
      criteria: { metric: 'blog_views_week', target: 100, by: '2026-06-01', baseline: 16 } },           // deadline passed, not met → miss flag
    { id: 'o3', title: 'Legacy objective', status: 'active', progress: 40 },                            // no criteria → untouched
    { id: 'o4', title: 'Already done', status: 'complete', progress: 100,
      criteria: { metric: 'bluesky_followers', target: 10, by: '2026-09-30', baseline: 0 } },           // complete → skipped
    { id: 'o5', title: 'Manual metric', status: 'active', progress: 5,
      criteria: { metric: 'weekly_active_users', target: 25, by: '2026-09-30', baseline: 0 } }          // unresolvable → untouched
  ];
}
const objs = freshObjs();
const res = SI.evaluateObjectives(objs, SOURCES, NOW);
ok(res.changed === true, 'evaluate reports change');
ok(objs[0].status === 'complete' && objs[0].progress === 100, 'o1 auto-completed at target');
ok(typeof objs[0].completedAt === 'string' && objs[0].completedBy === 'system:metric', 'o1 stamped completedAt/completedBy');
ok(res.govEvents.some(e => e.type === 'objective_auto_complete' && e.data.objectiveId === 'o1'), 'o1 gov event emitted');
ok(objs[1].status === 'active' && typeof objs[1].deadlineMissedAt === 'string', 'o2 deadline-miss flagged, stays active');
ok(res.govEvents.some(e => e.type === 'objective_deadline_miss' && e.data.objectiveId === 'o2'), 'o2 gov event emitted');
ok(objs[1].progress === Math.round(((3 - 16) / (100 - 16)) * 100) || objs[1].progress === 0, 'o2 progress clamped at 0 (current below baseline)');
ok(objs[2].progress === 40, 'o3 legacy untouched');
ok(objs[3].progress === 100 && !objs[3].deadlineMissedAt, 'o4 complete skipped entirely');
ok(objs[4].progress === 5, 'o5 unresolvable metric → progress untouched');
const res2 = SI.evaluateObjectives(objs, SOURCES, NOW + DAY);
ok(!res2.govEvents.some(e => e.type === 'objective_deadline_miss' && e.data.objectiveId === 'o2'), 'o2 miss NOT re-logged on second run');
ok(SI.evaluateObjectives([], SOURCES, NOW).changed === false, 'empty objectives → no change, no throw');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node c:/tmp/test-strategy-intel.cjs`
Expected: FAIL with `Cannot find module '.../strategy-intel.js'`

- [ ] **Step 3: Implement `strategy-intel.js`**

Create `api/companyHeartbeat/strategy-intel.js` — **zero `require()` calls** (pure, offline-testable standalone):

```javascript
// strategy-intel.js — Strategic Engine SE-1/SE-2 (2026-06-11)
//
// Pure module: metric resolvers, companyStrategy digest, COMPANY STRATEGY
// prompt block, and measurable-objective evaluation. No storage calls, no
// requires — same testability class as quality-gate.js.
//
// SE-1: buildStrategyDigest(companyStrategy, sources, nowMs) → digest|null
//       _buildStrategyPromptBlock(digest) → string (hard char cap, throws over)
// SE-2: evaluateObjectives(objectives, sources, nowMs) → { changed, govEvents }
//       Mutates objectives in place (house pattern: processCampaignLifecycle).
//       Criteria live ON the objective ({metric,target,by,baseline}) so SE-2
//       works even if the companyStrategy key is missing.

const MAX_STRATEGY_BLOCK_CHARS = 1200;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Resolvers keyed by metric name. Each: (entry, sources, nowMs) → number|null.
// Adding a future metric = add one entry here; no schema change.
const METRIC_RESOLVERS = {
  bluesky_followers: function (entry, sources) {
    const s = sources && sources.socialAccountStats;
    const n = s && s.platforms && s.platforms.bluesky && Number(s.platforms.bluesky.followers);
    return Number.isFinite(n) ? n : null;
  },
  total_followers: function (entry, sources) {
    const s = sources && sources.socialAccountStats;
    const n = s && s.totals && Number(s.totals.followers);
    return Number.isFinite(n) ? n : null;
  },
  blog_views_week: function (entry, sources, nowMs) {
    const views = sources && sources.blogPostViews;
    if (!Array.isArray(views)) return null;
    const cutoff = nowMs - WEEK_MS;
    let count = 0;
    for (let i = 0; i < views.length; i++) {
      const t = Date.parse((views[i] && views[i].timestamp) || '');
      if (Number.isFinite(t) && t >= cutoff && t <= nowMs) count++;
    }
    return count;
  }
};

// → { value: number|null, resolved: boolean }
function resolveNorthStarMetric(entry, sources, nowMs) {
  if (!entry || !entry.metric) return { value: null, resolved: false };
  if (entry.source === 'manual') {
    const v = Number(entry.current);
    return Number.isFinite(v) ? { value: v, resolved: true } : { value: null, resolved: false };
  }
  const resolver = METRIC_RESOLVERS[entry.metric];
  if (!resolver) return { value: null, resolved: false };
  try {
    const v = resolver(entry, sources || {}, nowMs);
    return Number.isFinite(v) ? { value: v, resolved: true } : { value: null, resolved: false };
  } catch (_e) {
    return { value: null, resolved: false };
  }
}

function _pctToTarget(current, target, baseline) {
  const t = Number(target), b = Number.isFinite(Number(baseline)) ? Number(baseline) : 0;
  if (!Number.isFinite(current) || !Number.isFinite(t)) return null;
  if (t === b) return current >= t ? 100 : 0; // div-0 guard
  return Math.max(0, Math.min(100, Math.round(((current - b) / (t - b)) * 100)));
}

// → digest | null. Null means "no strategy seeded" — callers emit nothing.
function buildStrategyDigest(companyStrategy, sources, nowMs) {
  const cs = companyStrategy;
  if (!cs || !Array.isArray(cs.northStar) || cs.northStar.length === 0) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const northStar = cs.northStar.slice(0, 5).map(function (e) {
    const r = resolveNorthStarMetric(e, sources, now);
    const byMs = Date.parse(e.by || '');
    return {
      metric: String(e.metric || ''),
      label: String(e.label || e.metric || ''),
      priority: Number(e.priority) || 99,
      target: Number(e.target),
      by: e.by || null,
      source: e.source || 'manual',
      baseline: Number.isFinite(Number(e.baseline)) ? Number(e.baseline) : null,
      current: r.value,
      resolved: r.resolved,
      pctToTarget: r.resolved ? _pctToTarget(r.value, e.target, e.baseline) : null,
      daysLeft: Number.isFinite(byMs) ? Math.ceil((byMs - now) / (24 * 60 * 60 * 1000)) : null
    };
  }).sort(function (a, b) { return a.priority - b.priority; });
  return {
    asOfUtc: new Date(now).toISOString(),
    mission: String(cs.mission || '').substring(0, 160),
    era: String(cs.era || '').substring(0, 40),
    eraGoal: String(cs.eraGoal || '').substring(0, 120),
    planningCadence: String(cs.planningCadence || 'monthly').substring(0, 20),
    riskPosture: String(cs.riskPosture || '').substring(0, 60),
    monthlyBudget: Number(cs.monthlyBudget) || null,
    northStar: northStar
  };
}

// Renders the prompt block. '' when digest null (prompts unchanged).
// Throws if over hard cap — same discipline as _buildWorldStatePromptBlock.
function _buildStrategyPromptBlock(digest) {
  if (!digest || !Array.isArray(digest.northStar) || digest.northStar.length === 0) return '';
  const lines = [];
  lines.push('═══ COMPANY STRATEGY (era: ' + digest.era + ') ═══');
  if (digest.mission) lines.push('MISSION: ' + digest.mission);
  if (digest.eraGoal) lines.push('ERA GOAL: ' + digest.eraGoal);
  lines.push('NORTH STARS (every proposal, campaign and task should serve one):');
  digest.northStar.forEach(function (ns, i) {
    const cur = ns.resolved ? String(ns.current) : '?';
    const tags = [];
    if (i === 0) tags.push('PRIMARY');
    tags.push(ns.source === 'manual' ? (ns.resolved ? 'manual' : 'manual — telemetry pending') : 'auto');
    const pct = ns.pctToTarget !== null ? ' (' + ns.pctToTarget + '% of the way)' : '';
    lines.push((i + 1) + '. ' + ns.metric + ': ' + cur + ' → ' + ns.target + ' by ' + (ns.by || 'n/a') + pct + ' [' + tags.join(' · ') + ']');
  });
  lines.push('RULE: propose-objective / propose-campaign MUST include "northStarMetric" naming which north star it serves. Proposals serving none get flagged for CEO scrutiny.');
  const meta = [];
  if (digest.monthlyBudget) meta.push('BUDGET: $' + digest.monthlyBudget + '/mo');
  if (digest.riskPosture) meta.push('POSTURE: ' + digest.riskPosture);
  if (digest.planningCadence) meta.push('CADENCE: ' + digest.planningCadence);
  if (meta.length) lines.push(meta.join(' · '));
  lines.push('═══ END COMPANY STRATEGY ═══');
  const block = '\n' + lines.join('\n') + '\n';
  if (block.length > MAX_STRATEGY_BLOCK_CHARS) {
    throw new Error('[strategy] prompt block exceeds ' + MAX_STRATEGY_BLOCK_CHARS + ' char hard cap: ' + block.length + '. Trim fields before shipping.');
  }
  return block;
}

// SE-2. Mutates objectives in place; returns { changed, govEvents }.
// Only touches objectives with a valid criteria object and non-terminal status.
function evaluateObjectives(objectives, sources, nowMs) {
  const out = { changed: false, govEvents: [] };
  if (!Array.isArray(objectives)) return out;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  for (const obj of objectives) {
    if (!obj || obj.deletedAt) continue;
    if (obj.status === 'complete' || obj.status === 'canceled') continue;
    const c = obj.criteria;
    if (!c || typeof c !== 'object' || !c.metric || !Number.isFinite(Number(c.target))) continue;
    const r = resolveNorthStarMetric({ metric: c.metric, source: c.source || 'auto', current: c.current }, sources, now);
    if (!r.resolved) continue; // unresolvable (manual/no telemetry) → leave untouched, no fake progress
    const pct = _pctToTarget(r.value, c.target, c.baseline);
    obj.measuredAt = new Date(now).toISOString();
    obj.measuredValue = r.value;
    if (obj.progress !== pct) { obj.progress = pct; out.changed = true; }
    if (r.value >= Number(c.target)) {
      obj.status = 'complete';
      obj.progress = 100;
      obj.completedAt = new Date(now).toISOString();
      obj.completedBy = 'system:metric';
      out.changed = true;
      out.govEvents.push({
        id: 'gov-' + now + '-' + Math.random().toString(36).substring(2, 6),
        type: 'objective_auto_complete',
        data: { objectiveId: obj.id, title: obj.title, metric: c.metric, target: Number(c.target), finalValue: r.value },
        timestamp: new Date(now).toISOString()
      });
    } else {
      const byMs = Date.parse(c.by || '');
      if (Number.isFinite(byMs) && now > byMs && !obj.deadlineMissedAt) {
        obj.deadlineMissedAt = new Date(now).toISOString();
        out.changed = true;
        out.govEvents.push({
          id: 'gov-' + now + '-' + Math.random().toString(36).substring(2, 6),
          type: 'objective_deadline_miss',
          data: { objectiveId: obj.id, title: obj.title, metric: c.metric, target: Number(c.target), current: r.value, by: c.by },
          timestamp: new Date(now).toISOString()
        });
      }
    }
  }
  return out;
}

module.exports = {
  resolveNorthStarMetric: resolveNorthStarMetric,
  buildStrategyDigest: buildStrategyDigest,
  _buildStrategyPromptBlock: _buildStrategyPromptBlock,
  evaluateObjectives: evaluateObjectives,
  METRIC_RESOLVERS: METRIC_RESOLVERS,
  MAX_STRATEGY_BLOCK_CHARS: MAX_STRATEGY_BLOCK_CHARS
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node c:/tmp/test-strategy-intel.cjs`
Expected: `~28 passed, 0 failed`, exit 0. If the block-cap assertion fails, trim block wording — do NOT raise the cap.

- [ ] **Step 5: Commit**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
git add api/companyHeartbeat/strategy-intel.js
git commit -m "SE-1/SE-2: strategy-intel module - north-star resolvers, strategy digest, prompt block, measurable-objective evaluation (pure, offline-tested)"
```
(Pre-commit hook regenerates `api/_data/skills.json` — if it stages that file too, that's expected; verify hook output appears.)

---

### Task 2: Allowlist `companyStrategy` in company-state

**Files:**
- Modify: `api/company-state/index.js` (VALID_KEYS array, lines ~11–33) — **do-not-touch file; this single line is explicitly sanctioned by this plan**

- [ ] **Step 1: Read lines 1–40 of `api/company-state/index.js`**, then apply this one edit (anchor on the last entries of VALID_KEYS):

```javascript
// OLD
  'agentRegistry',
  'emergenceDigest'
];

// NEW
  'agentRegistry',
  'emergenceDigest',
  'companyStrategy'
];
```

- [ ] **Step 2: Sanity check** — `node -e "require('c:/Dev/Ambientpixels/ambientpixels/api/company-state/index.js')"` should not throw at parse time (it may fail later on missing Azure env at require-time — only a SyntaxError is a failure here; if the module requires env at load, just run `node --check api/company-state/index.js` instead).

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/api/company-state/index.js`
Expected: no output, exit 0

- [ ] **Step 3: Commit**

```bash
git add api/company-state/index.js
git commit -m "SE-1: allowlist companyStrategy state key"
```

---

### Task 3: Heartbeat SE-1 wiring (`index.js`)

**Files:**
- Modify: `api/companyHeartbeat/index.js` — sites at lines ~14, ~209, ~405, ~1861, ~1930 (line numbers drift; anchor on the verbatim snippets below). **Read each region before editing.**

- [ ] **Step 1: Add the require** near the other intel requires at the top (anchor line 14 `const { buildFinanceDigest } = require('./finance-intel');`):

```javascript
// NEW line after the finance-intel require:
const { buildStrategyDigest, _buildStrategyPromptBlock, evaluateObjectives } = require('./strategy-intel');
```
(`_buildStrategyPromptBlock` is imported by prompt-builders.js, not index.js — index only needs the other two. Import exactly:)
```javascript
const { buildStrategyDigest, evaluateObjectives } = require('./strategy-intel');
```

- [ ] **Step 2: Load the state key.** Anchor on the existing blogPostViews load:

```javascript
// OLD (lines ~208-209)
    let _blogPostViewsForDigest = [];
    try { _blogPostViewsForDigest = (await storage.getState('blogPostViews')) || []; } catch (_e) { /* non-fatal */ }

// NEW
    let _blogPostViewsForDigest = [];
    try { _blogPostViewsForDigest = (await storage.getState('blogPostViews')) || []; } catch (_e) { /* non-fatal */ }
    let companyStrategy = null;
    try { companyStrategy = (await storage.getState('companyStrategy')) || null; } catch (_e) { /* non-fatal */ }
```

- [ ] **Step 3: Build the digest** right after the World State block (anchor: the `catch` that logs `World state failed:` at lines ~403-405):

```javascript
// OLD
    } catch (_e) {
      context.log('[heartbeat] World state failed:', _e.message, _e.stack ? _e.stack.split('\n').slice(0, 3).join(' | ') : '');
    }

// NEW
    } catch (_e) {
      context.log('[heartbeat] World state failed:', _e.message, _e.stack ? _e.stack.split('\n').slice(0, 3).join(' | ') : '');
    }

    // ── Strategic Engine SE-1: COMPANY STRATEGY digest ──
    // CEO-authored north-star KPI tree (companyStrategy key) resolved against
    // live sources. Injected into every prompt directly under WORLD STATE.
    // Null when unseeded — prompts simply lack the block (fail-open).
    var strategyDigest = null;
    try {
      strategyDigest = buildStrategyDigest(companyStrategy, {
        socialAccountStats: socialAccountStats,
        blogPostViews: _blogPostViewsForDigest
      }, Date.now());
      if (strategyDigest) context.log('[heartbeat] Strategy digest:', strategyDigest.northStar.length, 'north stars, era=' + strategyDigest.era);
      else context.log('[heartbeat] Strategy digest: companyStrategy not seeded — block omitted');
    } catch (_e) {
      context.log('[heartbeat] Strategy digest failed (non-fatal):', _e.message);
    }
```

- [ ] **Step 4: Thread into the PARALLEL agent call site.** Anchor verbatim (lines ~1859-1862):

```javascript
// OLD
            outcomeDigest, reflectionDigest, worldState,
            productFacts, skillsData,
            forgeOpsDigest, financeDigest, allocationDigest, researchDemandDigest, contentDigest, strategicDigest,
            socialAccountStats,

// NEW
            outcomeDigest, reflectionDigest, worldState,
            productFacts, skillsData,
            forgeOpsDigest, financeDigest, allocationDigest, researchDemandDigest, contentDigest, strategicDigest,
            strategyDigest,
            socialAccountStats,
```

- [ ] **Step 5: Thread into the SEQUENTIAL agent call site.** Anchor verbatim (lines ~1928-1931 — note this site lacks `outcomeDigest, reflectionDigest, worldState`; that is pre-existing, do NOT add them):

```javascript
// OLD
          performanceDigest, agentExperiments,
          productFacts, skillsData,
          forgeOpsDigest, financeDigest, allocationDigest, researchDemandDigest, contentDigest, strategicDigest,
          socialAccountStats,

// NEW
          performanceDigest, agentExperiments,
          productFacts, skillsData,
          forgeOpsDigest, financeDigest, allocationDigest, researchDemandDigest, contentDigest, strategicDigest,
          strategyDigest,
          socialAccountStats,
```

- [ ] **Step 6: Syntax check + commit**

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/api/companyHeartbeat/index.js`
Expected: exit 0

```bash
git add api/companyHeartbeat/index.js
git commit -m "SE-1: load companyStrategy, build strategy digest, thread into both agent call sites"
```

---

### Task 4: `agent-runner.js` — ctx + proposal handlers

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` — destructure (line ~294), `_promptCtx` (line ~500), propose-campaign handler (~4895-4976), propose-objective handler (~4977-5029). **Read each region before editing.**

- [ ] **Step 1: Destructure `strategyDigest` from ctx.** In the line-294 destructure, change:

```javascript
// OLD (fragment within the long destructure line)
..., outcomeDigest, reflectionDigest, worldState, productFacts, skillsData, ...

// NEW
..., outcomeDigest, reflectionDigest, worldState, strategyDigest, productFacts, skillsData, ...
```

- [ ] **Step 2: Add to `_promptCtx`** (line ~500), same insertion style:

```javascript
// OLD (fragment)
..., outcomeDigest, reflectionDigest, worldState, productFacts, skillsData, ...

// NEW
..., outcomeDigest, reflectionDigest, worldState, strategyDigest, productFacts, skillsData, ...
```

- [ ] **Step 3: Capture `northStarMetric` in propose-campaign.** Anchor on the `_pcEntry` literal (~line 4958). Insert a validation just before it and a field inside it:

```javascript
// NEW — insert immediately BEFORE `var _pcEntry = {`
  var _pcNS = (_pc.northStarMetric || '').trim().substring(0, 50);
  var _pcNSValid = !!(strategyDigest && Array.isArray(strategyDigest.northStar) &&
    strategyDigest.northStar.some(function (n) { return n.metric === _pcNS; }));
  if (strategyDigest && !_pcNSValid) {
    context.log('[Heartbeat]', agentId, 'propose-campaign missing/unknown northStarMetric ("' + _pcNS + '") — flagging for CEO scrutiny');
  }
```

```javascript
// OLD (last fields of _pcEntry)
    kpiTarget: (_pc.kpiTarget || '').substring(0, 200),
    createdAt: new Date().toISOString()
  };

// NEW
    kpiTarget: (_pc.kpiTarget || '').substring(0, 200),
    northStarMetric: _pcNSValid ? _pcNS : null,
    strategyFlag: (strategyDigest && !_pcNSValid) ? 'no-north-star-metric' : null,
    createdAt: new Date().toISOString()
  };
```

- [ ] **Step 4: Same for propose-objective.** Anchor on `var _poEntry = {` (~line 5005):

```javascript
// NEW — insert immediately BEFORE `var _poEntry = {`
  var _poNS = (_po.northStarMetric || '').trim().substring(0, 50);
  var _poNSValid = !!(strategyDigest && Array.isArray(strategyDigest.northStar) &&
    strategyDigest.northStar.some(function (n) { return n.metric === _poNS; }));
  if (strategyDigest && !_poNSValid) {
    context.log('[Heartbeat]', agentId, 'propose-objective missing/unknown northStarMetric ("' + _poNS + '") — flagging for CEO scrutiny');
  }
```

```javascript
// OLD (last fields of _poEntry)
    suggestedCampaigns: Array.isArray(_po.suggestedCampaigns) ? _po.suggestedCampaigns.slice(0, 3) : [],
    createdAt: new Date().toISOString()
  };

// NEW
    suggestedCampaigns: Array.isArray(_po.suggestedCampaigns) ? _po.suggestedCampaigns.slice(0, 3) : [],
    northStarMetric: _poNSValid ? _poNS : null,
    strategyFlag: (strategyDigest && !_poNSValid) ? 'no-north-star-metric' : null,
    createdAt: new Date().toISOString()
  };
```

Design note: **flag, don't block** (graduated autonomy, design principle 3). When `strategyDigest` is null (unseeded), no flag is set — agents aren't punished for a block they never saw. AQ entries carry extra fields harmlessly; the dashboard ignores unknown fields.

- [ ] **Step 5: Syntax check + commit**

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/api/companyHeartbeat/agent-runner.js`
Expected: exit 0

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "SE-1: thread strategyDigest through agent ctx; proposals capture+validate northStarMetric (flag, not block)"
```

---

### Task 5: `prompt-builders.js` — block injection + proposal schema text

**Files:**
- Modify: `api/companyHeartbeat/prompt-builders.js` — import (~line 165), destructure (line 244), block build (~1374), injection (line 1656), STRATEGIC AUTHORITY (~1992-1995). **Read each region before editing.**

- [ ] **Step 1: Import.** Anchor line 165 `const { _buildReflectionPromptBlock } = require('./reflection-intel');`:

```javascript
// NEW line after it:
const { _buildStrategyPromptBlock } = require('./strategy-intel');
```

- [ ] **Step 2: Destructure `strategyDigest`** in `buildHeartbeatPrompt` (line 244) — same fragment edit as agent-runner:

```javascript
// OLD (fragment): ..., outcomeDigest, reflectionDigest, worldState, productFacts, ...
// NEW:            ..., outcomeDigest, reflectionDigest, worldState, strategyDigest, productFacts, ...
```

- [ ] **Step 3: Build the block.** Anchor verbatim on the worldStateBlock build (lines ~1369-1374):

```javascript
// OLD
  let worldStateBlock = '';
  try {
    worldStateBlock = _buildWorldStatePromptBlock(worldState) || '';
  } catch (_wsErr) {
    worldStateBlock = '\n═══ WORLD STATE — build error, see logs ═══\n';
  }

// NEW
  let worldStateBlock = '';
  try {
    worldStateBlock = _buildWorldStatePromptBlock(worldState) || '';
  } catch (_wsErr) {
    worldStateBlock = '\n═══ WORLD STATE — build error, see logs ═══\n';
  }

  // Strategic Engine SE-1: COMPANY STRATEGY block — CEO's north-star KPI tree.
  // Sits directly under WORLD STATE (facts), giving agents direction. Empty
  // string when companyStrategy is unseeded; never blocks prompt assembly.
  let companyStrategyBlock = '';
  try {
    companyStrategyBlock = _buildStrategyPromptBlock(strategyDigest) || '';
  } catch (_csErr) {
    companyStrategyBlock = '';
  }
```

- [ ] **Step 4: Inject into the assembled prompt.** Anchor verbatim line 1656:

```javascript
// OLD
${worldStateBlock}${personalityBlock}${doctrineBlock}${seedBlock}${memoryBlock}${reflectionCalloutBlock}${outcomesBlock}${reflectionPromptBlock}${productFactsBlock}${skillsSystemBlock}${skillsBlock}${recentActivityBlock}${founderVoiceBlock}${messagesBlock}

// NEW
${worldStateBlock}${companyStrategyBlock}${personalityBlock}${doctrineBlock}${seedBlock}${memoryBlock}${reflectionCalloutBlock}${outcomesBlock}${reflectionPromptBlock}${productFactsBlock}${skillsSystemBlock}${skillsBlock}${recentActivityBlock}${founderVoiceBlock}${messagesBlock}
```

- [ ] **Step 5: Update STRATEGIC AUTHORITY schemas.** Anchor verbatim lines 1992-1995:

```javascript
// OLD
    - propose-objective: { "type": "propose-objective", "objective": { "title": "...", "description": "...", "rationale": "...", "successCriteria": "...", "timeHorizon": "..." } }
    - propose-campaign: { "type": "propose-campaign", "campaign": { "name": "...", "description": "...", "rationale": "...", "platforms": [...], "frequency": N, "cadence": "weekly" } }
    ALL fields are required. Rationale must cite specific agent data (Echo analytics, Cipher ROI, Scout research, Forge alerts).
    Max 1 objective proposal + 1 campaign proposal per day. CEO approves → auto-created. CEO rejects → feedback stored.

// NEW
    - propose-objective: { "type": "propose-objective", "objective": { "title": "...", "description": "...", "rationale": "...", "successCriteria": "...", "timeHorizon": "...", "northStarMetric": "..." } }
    - propose-campaign: { "type": "propose-campaign", "campaign": { "name": "...", "description": "...", "rationale": "...", "platforms": [...], "frequency": N, "cadence": "weekly", "northStarMetric": "..." } }
    ALL fields are required. Rationale must cite specific agent data (Echo analytics, Cipher ROI, Scout research, Forge alerts) AND "northStarMetric" must name the COMPANY STRATEGY north star this serves (exact metric name). Proposals serving no north star get flagged for CEO scrutiny.
    Max 1 objective proposal + 1 campaign proposal per day. CEO approves → auto-created. CEO rejects → feedback stored.
```

- [ ] **Step 6: Syntax check + commit**

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/api/companyHeartbeat/prompt-builders.js`
Expected: exit 0

```bash
git add api/companyHeartbeat/prompt-builders.js
git commit -m "SE-1: COMPANY STRATEGY prompt block under WORLD STATE + northStarMetric required in proposal schemas"
```

---

### Task 6: Heartbeat SE-2 wiring (`index.js` rollup)

**Files:**
- Modify: `api/companyHeartbeat/index.js` — the Objective progress rollup block (lines ~3452-3478). **Read the region first.**

- [ ] **Step 1: Wire `evaluateObjectives` before the legacy rollup and guard the legacy loop.** Replace the block verbatim:

```javascript
// OLD
    // ── Objective progress rollup ──
    {
      let _objChanged = false;
      for (const obj of objectives) {
        if (!obj || obj.deletedAt) continue;
        const linked = Array.isArray(obj.linkedCampaigns) ? obj.linkedCampaigns : [];

// NEW
    // ── Strategic Engine SE-2: measurable objectives (metric-computed) ──
    // Objectives with criteria:{metric,target,by,baseline} get progress from
    // live metric sources — not task counts. Auto-complete at target,
    // deadline-miss flagged once. Gov events ride campaignGovEvents → governanceLog.
    try {
      const _se2 = evaluateObjectives(objectives, {
        socialAccountStats: socialAccountStats,
        blogPostViews: _blogPostViewsForDigest
      }, Date.now());
      if (_se2.changed) objectivesChanged = true;
      for (const _evt of _se2.govEvents) campaignGovEvents.push(_evt);
      if (_se2.govEvents.length > 0) context.log('[Heartbeat] SE-2:', _se2.govEvents.map(function (e) { return e.type + ':' + e.data.objectiveId; }).join(', '));
    } catch (_se2Err) {
      context.log('[Heartbeat] SE-2 objective evaluation failed (non-fatal):', _se2Err.message);
    }

    // ── Objective progress rollup (legacy: task-count, only for objectives WITHOUT criteria) ──
    {
      let _objChanged = false;
      for (const obj of objectives) {
        if (!obj || obj.deletedAt) continue;
        if (obj.criteria && typeof obj.criteria === 'object') continue; // SE-2 owns measurable objectives
        const linked = Array.isArray(obj.linkedCampaigns) ? obj.linkedCampaigns : [];
```

(The rest of the legacy block — from `const objCamps = campaigns.filter(...)` through the closing `}` after `context.log('[Heartbeat] Objective progress rollup updated');` — stays byte-identical.)

- [ ] **Step 2: Verify the gov-event merge needs no change.** Read lines ~3609-3615 and confirm it still reads:

```javascript
      const govLog = (await storage.getState('governanceLog')) || [];
      let _govChanged = false;
      if (campaignGovEvents.length > 0) {
        for (const evt of campaignGovEvents) govLog.push(evt);
```
No edit — `objective_auto_complete` / `objective_deadline_miss` events flow through it. Also confirm `if (objectivesChanged) await storage.setState('objectives', objectives);` still exists at ~3606.

- [ ] **Step 3: Syntax check + commit**

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/api/companyHeartbeat/index.js`
Expected: exit 0

```bash
git add api/companyHeartbeat/index.js
git commit -m "SE-2: metric-computed objective progress + auto-complete + deadline-miss in heartbeat; legacy rollup skips measurable objectives"
```

---

### Task 7: Dashboard — show metric progress, stop client overwrite

**Files:**
- Modify: `modules/company/objectives.html` (~lines 442-458 — inline script; **Read the region first**, line numbers approximate)

- [ ] **Step 1: Guard the client auto-sync.** Find the auto-sync loop (reference shape):

```javascript
objectives.forEach(function (o) {
  if (o.status === 'canceled') return;
  var p = (typeof AgentEngine.getObjectiveProgress === 'function') ? AgentEngine.getObjectiveProgress(o.id) : null;
  if (!p || p.campaigns === 0) return;
```
Add one guard line right after the `canceled` check:

```javascript
  if (o.status === 'canceled') return;
  if (o.criteria && typeof o.criteria === 'object') return; // SE-2: server owns measurable objectives
```

- [ ] **Step 2: Prefer server progress for measurable objectives in the render path.** Find the display line (reference shape):

```javascript
var progress = (typeof AgentEngine.getObjectiveProgress === 'function') ? AgentEngine.getObjectiveProgress(obj.id) : null;
var pct = progress ? progress.pct : (o.progressPercentage || 0);
```
Change the `pct` assignment to:

```javascript
var pct = (o.criteria && typeof o.criteria === 'object')
  ? (typeof o.progress === 'number' ? o.progress : 0)
  : (progress ? progress.pct : (o.progressPercentage || 0));
```
(Variable names in the real file may differ slightly — keep the file's own names; the rule is: `criteria` present → display server `progress`, never the campaign-derived pct.)

- [ ] **Step 3: Verify render with Playwright** (per working guidelines — Node Playwright against Live Server or the local SWA): load `/modules/company/objectives.html`, confirm the objectives list renders and no console errors. Measurable display can only be fully verified post-retrofit; this step is a no-regression check.

- [ ] **Step 4: Commit**

```bash
git add modules/company/objectives.html
git commit -m "SE-2: dashboard renders server metric progress for measurable objectives; client auto-sync skips them"
```

---

### Task 8: Seed + retrofit scripts

**Files:**
- Create: `scripts/seed-company-strategy.cjs`
- Create: `scripts/retrofit-objectives-se2.cjs`

Both: dry-run by default, `--apply` to write, print full before/after JSON (manual rollback path), POST via company-state API.

- [ ] **Step 1: Write `scripts/seed-company-strategy.cjs`**

```javascript
// Seed the companyStrategy state key (SE-1). Dry-run by default; --apply to write.
// CEO-confirmed 2026-06-11: revenue-first era, 4 north stars, monthly cadence.
const BASE = 'https://ambientpixels-nova-api.azurewebsites.net/api/company-state';
const SECRET = 'pixelpusher';
const APPLY = process.argv.includes('--apply');

const companyStrategy = {
  mission: 'AI-native studio where agents run the company and products ship in public.',
  era: 'real-company-v1',
  eraGoal: 'Prove the system can win real paying customers.',
  planningCadence: 'monthly',
  northStar: [
    { metric: 'paying_customers', label: 'Paying customers', priority: 1, target: 1, by: '2026-08-31', source: 'manual', current: 0, baseline: 0 },
    { metric: 'bluesky_followers', label: 'Bluesky followers', priority: 2, target: 500, by: '2026-09-30', source: 'socialAccountStats', baseline: 72 },
    { metric: 'blog_views_week', label: 'Blog views/week', priority: 3, target: 100, by: '2026-09-30', source: 'blogPostViews', baseline: 16 },
    { metric: 'weekly_active_users', label: 'Weekly active product users', priority: 4, target: 25, by: '2026-09-30', source: 'manual', current: null, baseline: 0 }
  ],
  riskPosture: 'autonomous-inside-rails',
  monthlyBudget: 35,
  updatedAt: new Date().toISOString(),
  updatedBy: 'CEO (session 2026-06-11)'
};

(async () => {
  const cur = await fetch(BASE + '?key=companyStrategy', { headers: { 'x-company-secret': SECRET } });
  if (cur.status === 400) { console.error('companyStrategy not in VALID_KEYS yet — deploy Task 2 first.'); process.exit(1); }
  const existing = (await cur.json()).value;
  console.log('EXISTING:', JSON.stringify(existing, null, 2));
  console.log('\nPROPOSED:', JSON.stringify(companyStrategy, null, 2));
  if (existing && !APPLY) console.log('\nWARNING: key already has a value — --apply will OVERWRITE it (full JSON above is your rollback).');
  if (!APPLY) { console.log('\nDRY RUN — rerun with --apply to write.'); return; }
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-company-secret': SECRET },
    body: JSON.stringify({ key: 'companyStrategy', value: companyStrategy })
  });
  console.log('\nWRITE:', r.status, await r.text());
})().catch(e => { console.error('FATAL', e); process.exit(1); });
```

- [ ] **Step 2: Write `scripts/retrofit-objectives-se2.cjs`**

CEO-sanctioned completion flips (handoff §3: "3 are at 90–99% and need completion flips anyway"):
- `obj-founder-voice` → complete (its own criterion — Bluesky 200 in 90 days — expired; superseded by north star bluesky_followers 500)
- `obj-pulse-promo` → complete (30-day window long expired, progress 99)
- `obj-the-floor` → complete (progress 90, no resolvable metric; "agents as the brand draw" is now the operating mode)
- `obj-pa-redesign-launch` → untouched (active launch deliverable, stays on legacy task-rollup; CEO may give it criteria later)

```javascript
// SE-2 retrofit: completion flips for 3 of 4 active objectives (CEO-sanctioned,
// handoff 2026-06-11 §3). Dry-run by default; --apply to write.
const BASE = 'https://ambientpixels-nova-api.azurewebsites.net/api/company-state';
const SECRET = 'pixelpusher';
const APPLY = process.argv.includes('--apply');
const HDRS = { 'x-company-secret': SECRET };

const FLIPS = {
  'obj-founder-voice': 'Superseded by north star bluesky_followers (72→500 by 2026-09-30); original 90-day criterion expired.',
  'obj-pulse-promo': '30-day promo window long expired at 99% task progress.',
  'obj-the-floor': 'Agents-as-brand is now the default operating mode; objective served its purpose at 90%.'
};

(async () => {
  const get = async (k) => (await (await fetch(BASE + '?key=' + k, { headers: HDRS })).json()).value || [];
  const objectives = await get('objectives');
  const govLog = await get('governanceLog');
  const now = new Date().toISOString();
  console.log('BEFORE:', JSON.stringify(objectives.filter(o => FLIPS[o.id]), null, 2));
  let changed = 0;
  for (const o of objectives) {
    if (!FLIPS[o.id] || o.status === 'complete') continue;
    o.status = 'complete';
    o.progress = 100;
    o.completedAt = now;
    o.completedBy = 'retrofit:se2';
    o.retrofitNote = FLIPS[o.id];
    govLog.push({
      id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      type: 'objective_retrofit_complete',
      data: { objectiveId: o.id, title: o.title, note: FLIPS[o.id] },
      timestamp: now
    });
    changed++;
    console.log('FLIP → complete:', o.id, '—', FLIPS[o.id]);
  }
  if (!changed) { console.log('Nothing to do (already complete?).'); return; }
  console.log('\nAFTER:', JSON.stringify(objectives.filter(o => FLIPS[o.id]), null, 2));
  if (!APPLY) { console.log('\nDRY RUN — rerun with --apply to write objectives + governanceLog.'); return; }
  for (const [key, value] of [['objectives', objectives], ['governanceLog', govLog]]) {
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-company-secret': SECRET },
      body: JSON.stringify({ key, value })
    });
    console.log('WRITE', key + ':', r.status);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
```

- [ ] **Step 3: Dry-run both against live state** (reads work pre-deploy; seed's GET will 400 until Task 2 deploys — that exact message is the expected output for the seed script today):

Run: `node scripts/retrofit-objectives-se2.cjs`
Expected: BEFORE/AFTER JSON for the 3 objectives, `DRY RUN` line, no writes.

Run: `node scripts/seed-company-strategy.cjs`
Expected (pre-deploy): `companyStrategy not in VALID_KEYS yet — deploy Task 2 first.` exit 1. (Post-deploy: EXISTING null + PROPOSED JSON + DRY RUN line.)

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-company-strategy.cjs scripts/retrofit-objectives-se2.cjs
git commit -m "SE-1/SE-2: seed + retrofit scripts (dry-run default, --apply, before/after JSON rollback trail)"
```

---

### Task 9: Full offline verification, deploy, live verification

- [ ] **Step 1: Re-run the full offline test**

Run: `node c:/tmp/test-strategy-intel.cjs`
Expected: all pass, exit 0.

- [ ] **Step 2: Final syntax sweep**

Run: `node --check api/companyHeartbeat/index.js; node --check api/companyHeartbeat/agent-runner.js; node --check api/companyHeartbeat/prompt-builders.js; node --check api/companyHeartbeat/strategy-intel.js; node --check api/company-state/index.js`
Expected: exit 0 for all five.

- [ ] **Step 3: Push (deploys via CI/CD)**

```bash
git push origin master
```
Watch GitHub Actions `azure-static-web-apps-calm-sky-05cc8e110.yml` to green.

- [ ] **Step 4: Post-deploy — seed the strategy**

Run: `node scripts/seed-company-strategy.cjs` → confirm GET no longer 400s and shows DRY RUN.
Run: `node scripts/seed-company-strategy.cjs --apply` → `WRITE: 200`.
Verify: `GET /api/company-state?key=companyStrategy` returns the seeded JSON.

- [ ] **Step 5: Post-deploy — retrofit objectives**

Run: `node scripts/retrofit-objectives-se2.cjs` (dry-run review) then `node scripts/retrofit-objectives-se2.cjs --apply`
Verify: objectives state shows the 3 flips with `completedBy: 'retrofit:se2'`; governanceLog has 3 `objective_retrofit_complete` entries.

- [ ] **Step 6: Trigger a heartbeat and verify SE-1/SE-2 live**

```bash
curl -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-heartbeat-trigger" -H "Content-Type: application/json" -H "x-company-secret: pixelpusher"
```
Then verify, in order:
1. `heartbeatRuns` last entry: no errors, normal agent counts.
2. Function logs / App Insights: `[heartbeat] Strategy digest: 4 north stars, era=real-company-v1` present; no `Strategy digest failed`.
3. `objectives`: `obj-pa-redesign-launch` still active and untouched by SE-2 (it has no `criteria`).
4. Dashboard objectives page renders; 3 flipped objectives show complete.
5. Prompt-size events did not blow up (block adds ~700 chars ≈ 175 tokens — ceiling is 30K tokens).

- [ ] **Step 7: Soak expectations (next 24-48h, no action needed)**
- New proposals in AQ carry `northStarMetric` (or `strategyFlag: 'no-north-star-metric'` during the first cycles while agents learn the field).
- First `objective_auto_complete`/`objective_deadline_miss` events only after a measurable objective exists (none until agents propose one or CEO adds `criteria` to pa-redesign).

---

## Rollback paths
- **Code:** `git revert` any commit; heartbeat is fail-open at every new call site (try/catch, empty block, non-fatal logs).
- **companyStrategy key:** seed script prints prior value before overwrite; restore by re-POSTing it. Deleting the key entirely just removes the block from prompts.
- **Retrofit:** script prints full BEFORE JSON — re-POST it to objectives to undo flips. governanceLog entries are append-only audit, leave them.

## Self-review notes
- Spec coverage: SE-1 (key ✓ Task 2/8, block ✓ Task 1/3/5, proposal gate ✓ Task 4/5), SE-2 (criteria schema ✓ Task 1, computed progress ✓ Task 1/6, auto-complete + deadline-flag ✓ Task 1/6, retrofit ✓ Task 8, dashboard ✓ Task 7). SE-3/SE-4 deliberately absent.
- Type consistency: `strategyDigest` (digest object) is the name threaded everywhere; `companyStrategy` (raw key) only exists in index.js Task 3 Step 2 and scripts. `criteria` object on objectives; legacy `successCriteria` string untouched.
- The two objectives keeping `status: 'active'` post-retrofit: only `obj-pa-redesign-launch` — correct per CEO scope ("retrofit the 4" = 3 flips + 1 left on legacy; it has no resolvable metric).
- `activeObjectives` filter (index.js:898, `status !== 'complete' && status !== 'canceled'`) automatically drops auto-completed objectives from agent prompts next cycle — no extra wiring.

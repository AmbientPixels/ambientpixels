# Revenue Seasons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the agent XP economy so revenue outcomes dominate, add monthly seasons with a rising par, and make standings purchase real operational power (budget, model tier, action slots, proposal rights) with an escalating watch → squeeze → retirement ladder.

**Architecture:** All economy logic stays in the pure functions of `api/companyHeartbeat/rewards-engine.js` (TDD against `rewards-engine.test.js`, plain `node` runner). The engine precomputes derived artifacts (`budgetPlan`, `privileges`, ladder statuses) into the `agentRewards` ledger; heartbeat-side code only READS the ledger at three small hook points. The engine's IO layer gains one narrow write: an auto-drafted CEO-gated retirement proposal on ladder transition.

**Tech Stack:** Node.js (Azure Functions), `node:assert` test harness, companyStorage blob state. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-30-revenue-seasons-design.md`

**Verified codebase facts this plan relies on** (do not re-derive; line numbers at HEAD `e8a24077`):
- `revenueLedger` is companyStorage-direct, envelope `{ entries: [], updatedAt }`. Entry fields: `id` (Stripe event id, unique), `type` (`one_time|subscription_initial|subscription_renewal|subscription_canceled|refund|dispute`), `amountCents` (negative for refunds), `utmContent` (= originating social **action id**), `utmSource`, `occurredAt`, `recordedAt`, `product`, `customerEmail`. Writer: `api/_lib/stripe/revenueLedger.js:90-109`.
- `as_leads` is a companyStorage-direct plain array, entries `{ email, reportId, url, score, utmContent, utmSource, source, ts }`, **no id field**, capped 5000. Sole writer: `api/as-analyze/index.js:163-178`.
- Scans live in `cc_analytics` (there is NO `as_scans` key): `{ reportId, url, tier, score, timestamp }` (+`requestedBy` on `tier:'agent'` rows; `tier:'failed'` rows have no reportId). `tier` ∈ `free | agent | paid-single | paid-pack | failed`. Public scans = tier not `agent`/`failed`.
- Actions use snake_case `created_by` and post-hoc `_parentTaskId`. Terminal actions >7d are TRIMMED from `actions` by `actionsArchiver`; attribution survives in companyStorage-direct `actionAttributionIndex` = `{ map: { actionId: { agent, campaignId, at } }, updatedAt, count }`.
- Tasks: `assignee`, `reviewer`/`reviewedAt` (set only by social-copy propagation), `campaign_id`, `parent_task_id`. Campaigns have NO type/owner field; nearest conversion discriminator is `northStarMetric`.
- `agent_retire_proposal` queue entry shape: see `api/fleetProposalCreate/index.js:136-151` (`id: 'retpr_…'`, `retire: { targetAgent, rationale, reassignmentPlan, estimatedWinddownCost, orphans }`). `PROTECTED_AGENTS = {nova, cipher}` (constants.js:393), `FLEET_MIN_SIZE = 5` (constants.js:394). Approval side-effects: `api/approveProposal/index.js:180-224`.
- Per-agent budget caps: registry rows become `AGENT_ROLES[id]` in-place via `_applyRegistry` (constants.js:431-444) inside `loadAgentRegistry` (constants.js:461-484, called from `index.js:138`); `allocation-intel.js:79-93` reads `AGENT_ROLES[aid].monthlyCap`. `applyBudgetOverrides` (constants.js:449-459) is the existing systemConfig-override precedent.
- Model resolution: `gemini.js:22-45` `_resolveModel()` (systemConfig.heartbeatModel → env → 'gemini', 5-min cache); `_callWithFallback` (gemini.js:208-217) has `agentId` in scope. No per-agent override exists today.
- Action slot cap: `GUARDRAILS.maxActionsPerCyclePerAgent = 3` (constants.js:89), enforced at `agent-runner.js:1392-1404`. `_agentRewards` is loaded at `agent-runner.js:545`.
- Proposal rights: `PROPOSAL_AUTHORIZED_AGENTS` gate at `agent-runner.js:5364-5370` (campaign) and `:5531-5537` (objective).
- Prompt block: `buildProgressionPromptBlock` lives IN rewards-engine.js:345-378 (pure), called from `prompt-builders.js:1241-1247`; no prompt-builders change is needed beyond what the engine function returns.
- `runRewardsEngine` (rewards-engine.js:380-427) loads 9 keys via injected `storage.getState/setState`; `rewardsEngineCron` injects raw `companyStorage`.
- Existing test harness: `node api/companyHeartbeat/rewards-engine.test.js`, ~19 `test()` cases, `assert` + pass/fail counters. All must stay green.

**Working directory for all commands:** `c:\Dev\Ambientpixels\ambientpixels`

**Run tests with:** `node api/companyHeartbeat/rewards-engine.test.js`

---

### Task 1: Attribution resolver (pure functions)

Resolve a `utmContent` action id to the distinct fleet agents in its causal chain, and compute the conversion-campaign fallback set.

**Files:**
- Modify: `api/companyHeartbeat/rewards-engine.js` (constants block + new helpers before `extractEvents`)
- Test: `api/companyHeartbeat/rewards-engine.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `rewards-engine.test.js` before the final `console.log` line (import the two new fns by adding `resolveContributors, conversionFallbackAgents` to the require destructure at the top of the file):

```js
// ── Task 1: attribution resolver ──
test('resolveContributors walks action -> task -> reviewer and dedups to fleet agents', () => {
  const ctx = {
    actionsById: { act_1: { id: 'act_1', created_by: 'scribe', _parentTaskId: 'tk1' } },
    attributionIndex: {},
    tasksById: { tk1: { id: 'tk1', assignee: 'echo', reviewer: 'quill', campaign_id: 'camp-x' } }
  };
  assert.deepStrictEqual(resolveContributors('act_1', ctx), ['scribe', 'echo', 'quill']);
});

test('resolveContributors falls back to actionAttributionIndex for trimmed actions', () => {
  const ctx = {
    actionsById: {},
    attributionIndex: { act_old: { agent: 'echo', campaignId: 'camp-x', at: '2026-07-01T00:00:00Z' } },
    tasksById: {}
  };
  assert.deepStrictEqual(resolveContributors('act_old', ctx), ['echo']);
});

test('resolveContributors filters system/ceo/unknown and returns [] on no match', () => {
  const ctx = {
    actionsById: { act_2: { id: 'act_2', created_by: 'system', _parentTaskId: 'tk2' } },
    attributionIndex: {},
    tasksById: { tk2: { id: 'tk2', assignee: 'ceo' } }
  };
  assert.deepStrictEqual(resolveContributors('act_2', ctx), []);
  assert.deepStrictEqual(resolveContributors('missing', ctx), []);
  assert.deepStrictEqual(resolveContributors(null, ctx), []);
});

test('conversionFallbackAgents = assignees of recent tasks on active conversion campaigns', () => {
  const state = {
    campaigns: [
      { id: 'camp-conv', status: 'active', northStarMetric: 'paying customers' },
      { id: 'camp-paused', status: 'paused', northStarMetric: 'revenue' },
      { id: 'camp-brand', status: 'active', northStarMetric: 'bluesky followers' }
    ],
    tasks: [
      { id: 't1', campaign_id: 'camp-conv', assignee: 'echo', updatedAt: at(-3) },
      { id: 't2', campaign_id: 'camp-conv', assignee: 'scribe', updatedAt: at(-40) },  // stale >30d
      { id: 't3', campaign_id: 'camp-paused', assignee: 'pixel', updatedAt: at(-3) },  // paused campaign
      { id: 't4', campaign_id: 'camp-brand', assignee: 'scout', updatedAt: at(-3) }    // not conversion
    ],
    tasksArchive: []
  };
  assert.deepStrictEqual(conversionFallbackAgents(state, NOW), ['echo']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: the 4 new tests FAIL (`resolveContributors is not a function`); all pre-existing tests still PASS.

- [ ] **Step 3: Implement**

In `rewards-engine.js`, extend the constants block (after `PROCESSED_CAP`, line ~40):

```js
// ── Revenue Seasons constants (2026-07-30 spec) ─────────────────────────────
const FLEET_AGENTS = ['nova', 'cipher', 'pixel', 'forge', 'echo', 'scout', 'scribe', 'quill', 'vale'];
const _FLEET_SET = {}; FLEET_AGENTS.forEach(function (id) { _FLEET_SET[id] = true; });
const CONVERSION_METRIC_RX = /revenue|customer|sale|checkout|conversion|lead/i;
const FALLBACK_WINDOW_MS = 30 * 86400000;
```

Add the two pure helpers immediately above `// ── extractEvents` (line ~288):

```js
// ── Attribution: utm_content (= action id) -> causal chain of fleet agents ───
// ctx: { actionsById, attributionIndex, tasksById } — all plain maps, all optional.
function resolveContributors(utmContent, ctx) {
  ctx = ctx || {};
  var out = [];
  if (!utmContent) return out;
  var a = (ctx.actionsById || {})[utmContent];
  if (a) {
    if (a.created_by) out.push(a.created_by);
    var t = a._parentTaskId && (ctx.tasksById || {})[a._parentTaskId];
    if (t) {
      if (t.assignee) out.push(t.assignee);
      if (t.reviewer) out.push(t.reviewer);
    }
  } else {
    // action trimmed by actionsArchiver — attribution survives in the index
    var ix = ((ctx.attributionIndex || {})[utmContent]) || null;
    if (ix && ix.agent) out.push(ix.agent);
  }
  var seen = {};
  return out.filter(function (id) {
    if (!_FLEET_SET[id] || seen[id]) return false;
    seen[id] = true; return true;
  });
}

// Fallback for unattributed conversions: distinct assignees of tasks touched in the
// last 30d that belong to ACTIVE campaigns whose northStarMetric reads as conversion.
function conversionFallbackAgents(state, nowMs) {
  state = state || {};
  var conv = {};
  _arr(state.campaigns).forEach(function (c) {
    if (c && c.id && c.status === 'active' && CONVERSION_METRIC_RX.test(c.northStarMetric || '')) conv[c.id] = true;
  });
  var cutoff = nowMs - FALLBACK_WINDOW_MS;
  var agents = {};
  _arr(state.tasks).concat(_arr(state.tasksArchive)).forEach(function (t) {
    if (!t || !conv[t.campaign_id] || !_FLEET_SET[t.assignee]) return;
    var ts = Date.parse(t.updatedAt || t.completedAt || t.createdAt || 0) || 0;
    if (ts >= cutoff) agents[t.assignee] = true;
  });
  return Object.keys(agents).sort();
}
```

Add both to `module.exports` at the bottom:

```js
  resolveContributors: resolveContributors, conversionFallbackAgents: conversionFallbackAgents,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: all tests PASS (old count + 4).

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/rewards-engine.js api/companyHeartbeat/rewards-engine.test.js
git commit -m "feat(rewards): attribution resolver — utm action chain + conversion-campaign fallback"
```

---

### Task 2: Revenue-lane event extraction

Emit `revenue_sale` / `funnel_lead` / `funnel_scan` events (per-recipient, pre-split via `xpOverride`) from `revenueLedger`, `as_leads`, `cc_analytics`.

**Files:**
- Modify: `api/companyHeartbeat/rewards-engine.js` (`extractEvents` + constants)
- Test: `api/companyHeartbeat/rewards-engine.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 2: revenue-lane extraction ──
const REV_STATE = () => ({
  approvalQueue: [], blogPosts: [], outcomeSnapshots: {}, tasksArchive: [],
  tasks: [{ id: 'tk1', assignee: 'echo', reviewer: 'quill', campaign_id: 'camp-conv', updatedAt: at(-1) }],
  campaigns: [{ id: 'camp-conv', status: 'active', northStarMetric: 'paying customers' }],
  actionsById: { act_1: { id: 'act_1', created_by: 'scribe', _parentTaskId: 'tk1' } },
  attributionIndex: {},
  revenueLedgerEntries: [], asLeads: [], scans: []
});

test('an attributed sale splits 100 + $-XP across the causal chain, floor 1 each', () => {
  const s = REV_STATE();
  s.revenueLedgerEntries = [{ id: 'evt_1', type: 'one_time', amountCents: 2900, utmContent: 'act_1', occurredAt: at(0) }];
  const evs = extractEvents(s, null).filter(e => e.type === 'revenue_sale');
  // total = 100 + 29 = 129, 3 contributors (scribe, echo, quill) -> 43 each
  assert.strictEqual(evs.length, 3);
  assert.ok(evs.every(e => e.xpOverride === 43));
  const ids = evs.map(e => e.id).sort();
  assert.deepStrictEqual(ids, ['sale_evt_1__echo', 'sale_evt_1__quill', 'sale_evt_1__scribe']);
});

test('refunds, disputes and cancellations emit no sale events', () => {
  const s = REV_STATE();
  s.revenueLedgerEntries = [
    { id: 'evt_r', type: 'refund', amountCents: -2900, utmContent: 'act_1', occurredAt: at(0) },
    { id: 'evt_d', type: 'dispute', amountCents: -2900, occurredAt: at(0) },
    { id: 'evt_c', type: 'subscription_canceled', amountCents: 0, occurredAt: at(0) }
  ];
  assert.strictEqual(extractEvents(s, null).filter(e => e.type === 'revenue_sale').length, 0);
});

test('an unattributed sale pays 50% to conversion-campaign agents; company keeps the rest', () => {
  const s = REV_STATE();
  s.revenueLedgerEntries = [{ id: 'evt_2', type: 'one_time', amountCents: 2900, utmContent: null, occurredAt: at(0) }];
  const evs = extractEvents(s, null).filter(e => e.type === 'revenue_sale');
  // fallback set = ['echo'] (task on active conversion campaign) -> floor(129*0.5) = 64
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].agentId, 'echo');
  assert.strictEqual(evs[0].xpOverride, 64);
  assert.strictEqual(evs[0].id, 'sale_evt_2__echo');
});

test('a lead pays 15 XP through the same chain; scans pay 3 via fallback', () => {
  const s = REV_STATE();
  s.asLeads = [{ email: 'x@y.z', utmContent: 'act_1', ts: at(0) }];
  s.scans = [
    { reportId: 'ccr_1', tier: 'free', timestamp: at(0) },
    { reportId: 'ccr_2', tier: 'agent', timestamp: at(0) },     // internal — excluded
    { tier: 'failed', timestamp: at(0) }                        // failed — excluded
  ];
  const leads = extractEvents(s, null).filter(e => e.type === 'funnel_lead');
  assert.strictEqual(leads.length, 3, 'lead split across scribe/echo/quill');
  assert.ok(leads.every(e => e.xpOverride === 5), '15/3 = 5 each');
  const scans = extractEvents(s, null).filter(e => e.type === 'funnel_scan');
  assert.strictEqual(scans.length, 1, 'only the public scan, via fallback');
  assert.strictEqual(scans[0].agentId, 'echo');
  assert.strictEqual(scans[0].id, 'scan_ccr_1__echo');
});

test('lead ids are stable across runs (ts + email hash) so dedup holds', () => {
  const s = REV_STATE();
  s.asLeads = [{ email: 'x@y.z', utmContent: 'act_1', ts: at(0) }];
  const a = extractEvents(s, null).filter(e => e.type === 'funnel_lead').map(e => e.id).sort();
  const b = extractEvents(s, null).filter(e => e.type === 'funnel_lead').map(e => e.id).sort();
  assert.deepStrictEqual(a, b);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: new tests FAIL (no revenue events emitted); old tests PASS.

- [ ] **Step 3: Implement**

Constants block additions:

```js
const REVENUE_XP = { saleBase: 100, perDollar: 1, lead: 15, scan: 3 };
const UNATTRIBUTED_SHARE = 0.5;   // organic conversions: half pays the fallback set
const POSITIVE_SALE_TYPES = { one_time: true, subscription_initial: true, subscription_renewal: true };
```

Add a tiny stable hash helper next to `_arr` (line ~92):

```js
function _hash(s) { s = String(s || ''); var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
```

Add a split emitter above `extractEvents`:

```js
// Split totalXp across the chain (or the 50% fallback set) as per-recipient events.
// idBase must be stable; per-recipient ids get '__<agent>' so dedup is per share.
function _emitSplit(ev, idBase, type, totalXp, at, utmContent, ctx, state, nowMs) {
  var who = resolveContributors(utmContent, ctx);
  var xp = totalXp;
  if (!who.length) {
    who = conversionFallbackAgents(state, nowMs);
    xp = Math.floor(totalXp * UNATTRIBUTED_SHARE);
  }
  if (!who.length || xp <= 0) return;
  var share = Math.max(1, Math.floor(xp / who.length));
  who.forEach(function (id) {
    ev.push({ id: idBase + '__' + id, type: type, agentId: id, xpOverride: share, at: at || '' });
  });
}
```

In `extractEvents`, after the tasks block (before `return ev;`), using the tasks `byId` map already built there:

```js
  // ── Revenue lane (2026-07-30): sales, leads, public scans ──────────────────
  var nowMs = state._nowMs || Date.now();
  var ctx = {
    actionsById: (state.actionsById && typeof state.actionsById === 'object') ? state.actionsById : {},
    attributionIndex: (state.attributionIndex && typeof state.attributionIndex === 'object') ? state.attributionIndex : {},
    tasksById: byId
  };
  _arr(state.revenueLedgerEntries).forEach(function (r) {
    if (!r || !r.id || !POSITIVE_SALE_TYPES[r.type] || !(r.amountCents > 0)) return;
    var total = REVENUE_XP.saleBase + Math.floor(r.amountCents / 100) * REVENUE_XP.perDollar;
    _emitSplit(ev, 'sale_' + r.id, 'revenue_sale', total, r.occurredAt || r.recordedAt, r.utmContent, ctx, state, nowMs);
  });
  _arr(state.asLeads).forEach(function (l) {
    if (!l || !l.ts) return;
    _emitSplit(ev, 'lead_' + _day(l.ts).replace(/-/g, '') + '_' + _hash(l.ts + '|' + (l.email || '')),
      'funnel_lead', REVENUE_XP.lead, l.ts, l.utmContent, ctx, state, nowMs);
  });
  _arr(state.scans).forEach(function (s) {
    if (!s || s.tier === 'agent' || s.tier === 'failed' || !s.reportId) return;
    _emitSplit(ev, 'scan_' + s.reportId, 'funnel_scan', REVENUE_XP.scan, s.timestamp, null, ctx, state, nowMs);
  });
```

Note: `extractEvents` gains optional state fields (`revenueLedgerEntries`, `asLeads`, `scans`, `actionsById`, `attributionIndex`, `campaigns`, `_nowMs`) — all default-safe, so every existing test and the current IO caller keep working unchanged until Task 7 wires the real sources.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/rewards-engine.js api/companyHeartbeat/rewards-engine.test.js
git commit -m "feat(rewards): revenue-lane events — sale/lead/scan with causal-chain split"
```

---

### Task 3: Economy application — cap exemption, churn nerf, season accrual

`applyEvents` honors `xpOverride`, exempts the revenue lane from the daily cap, lane-caps `task_done` at 3 XP/day (no Renown from lane overflow), accrues `seasonXp`/`seasonRevenueXp`/`revenueRecent`, ticks new counters, adds revenue achievements.

**Files:**
- Modify: `api/companyHeartbeat/rewards-engine.js`
- Test: `api/companyHeartbeat/rewards-engine.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 3: economy application ──
test('revenue_sale is exempt from the daily cap and accrues season + revenue XP', () => {
  const { rewards } = applyEvents([
    { id: 'appr_x1', type: 'proposal_approved', agentId: 'echo', at: at(0, 1) },   // 8 XP
    { id: 'sale_e1__echo', type: 'revenue_sale', agentId: 'echo', xpOverride: 43, at: at(0, 2) }
  ], null, NOW);
  const a = agent(rewards, 'echo');
  assert.ok(a.xp >= 8 + 43, 'sale not haircut by the 12/day cap (got ' + a.xp + ')');
  assert.ok(a.seasonXp >= 8 + 43, 'season XP accrues');
  assert.ok(a.seasonRevenueXp >= 43, 'revenue-lane season XP tracked');
  assert.strictEqual(a.counters.sales, 1);
  assert.ok(Array.isArray(a.revenueRecent) && a.revenueRecent.length === 1);
  assert.ok(a.achievements.some(x => x.id === 'first_sale'), 'first_sale unlocked');
});

test('task_done lane-caps at 3 XP/day: 4th task pays nothing and mints no renown', () => {
  const evs = [1, 2, 3, 4].map(n => ({ id: 'tk_lane_' + n, type: 'task_done', agentId: 'scribe', at: at(0, n) }));
  const { rewards } = applyEvents(evs, null, NOW);
  const a = agent(rewards, 'scribe');
  assert.strictEqual(a.xp, 3, 'lane cap 3');
  assert.strictEqual(a.renown, 0, 'no renown from lane overflow');
  assert.strictEqual(a.counters.tasksDone, 4, 'counter still counts all tasks');
});

test('funnel_lead exempt from cap; funnel_scan is NOT exempt', () => {
  const evs = [
    { id: 'lead_a__echo', type: 'funnel_lead', agentId: 'echo', xpOverride: 15, at: at(0, 1) },
    { id: 'appr_c1', type: 'proposal_approved', agentId: 'echo', at: at(0, 2) },     // fills cap: 8
    { id: 'appr_c2', type: 'proposal_approved', agentId: 'echo', at: at(0, 3) },     // 8 -> capped at 4
    { id: 'scan_s1__echo', type: 'funnel_scan', agentId: 'echo', xpOverride: 3, at: at(0, 4) } // cap full -> 0
  ];
  const { rewards } = applyEvents(evs, null, NOW);
  const a = agent(rewards, 'echo');
  // lead 15 (exempt) + capped non-exempt lanes 12 = 27
  assert.strictEqual(a.xp, 27);
  assert.strictEqual(a.counters.leads, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: new 3 FAIL; old PASS.

- [ ] **Step 3: Implement**

Constants:

```js
const CAP_EXEMPT_TYPES = { revenue_sale: true, funnel_lead: true };
const TASK_DONE_DAILY_XP_CAP = 3;
const REVENUE_LANE_TYPES = { revenue_sale: true, funnel_lead: true, funnel_scan: true };
const REVENUE_RECENT_CAP = 300;
```

`_newAgent` counters gain `sales: 0, leads: 0, scansAttributed: 0`; add fields `seasonXp: 0, seasonRevenueXp: 0, revenueRecent: []` after `dailyXpDay: null`. In `_ensureAgent`/`_initRewards`, older ledger entries won't have them — add a normalizer inside `_initRewards` after the perAgent guard:

```js
  Object.keys(r.perAgent).forEach(function (id) {
    var A = r.perAgent[id];
    if (typeof A.seasonXp !== 'number') A.seasonXp = 0;
    if (typeof A.seasonRevenueXp !== 'number') A.seasonRevenueXp = 0;
    if (!Array.isArray(A.revenueRecent)) A.revenueRecent = [];
    if (typeof A.dailyTaskXp !== 'number') A.dailyTaskXp = 0;
  });
```

`_baseXpFor` first line becomes:

```js
  if (e.xpOverride != null && Number.isFinite(Number(e.xpOverride))) return Number(e.xpOverride);
```

`_bumpCounters` gains:

```js
    case 'revenue_sale': A.counters.sales = (A.counters.sales || 0) + 1; break;
    case 'funnel_lead': A.counters.leads = (A.counters.leads || 0) + 1; break;
    case 'funnel_scan': A.counters.scansAttributed = (A.counters.scansAttributed || 0) + 1; break;
```

In the `queue.forEach` body of `applyEvents`, replace the grant block (currently `var computed = … A.renown += renownGain;`) with:

```js
    if (A.dailyXpDay !== day) { A.dailyXp = 0; A.dailyTaskXp = 0; A.dailyXpDay = day; }

    var computed = Math.round(_baseXpFor(e) * _streakMult(A.streakDays));
    var granted, lost = 0;
    if (e.type === 'task_done') {
      // Churn nerf: task lane pays at most 3 XP/day; lane overflow mints NOTHING.
      granted = Math.max(0, Math.min(computed, TASK_DONE_DAILY_XP_CAP - A.dailyTaskXp));
      A.dailyTaskXp += granted;
      A.dailyXp += granted;
    } else if (CAP_EXEMPT_TYPES[e.type]) {
      granted = computed;                     // sales/leads are never haircut
    } else {
      var allowed = Math.max(0, DAILY_XP_CAP - A.dailyXp);
      granted = Math.min(computed, allowed);
      lost = computed - granted;
      A.dailyXp += granted;
    }
    A.xp += granted;
    A.seasonXp += granted;
    if (REVENUE_LANE_TYPES[e.type] && granted > 0) {
      A.seasonRevenueXp += granted;
      A.revenueRecent.unshift({ at: e.at || _iso(nowMs), xp: granted });
      if (A.revenueRecent.length > REVENUE_RECENT_CAP) A.revenueRecent = A.revenueRecent.slice(0, REVENUE_RECENT_CAP);
    }
    var renownGain = _overflowRenown(lost);
    A.renown += renownGain;
```

(The streak update line above this stays where it is. The existing `_bumpCounters`/`recent`/`newAwards` lines below stay unchanged — but skip the `recent`/`newAwards` push when `granted === 0 && renownGain === 0 && e.type === 'task_done'` to keep the rolling list from flooding with zero rows:)

```js
    _bumpCounters(A, e);
    if (!(granted === 0 && renownGain === 0 && e.type === 'task_done')) {
      A.recent.unshift({ at: e.at, type: e.type, xp: granted, renown: renownGain, reason: e.type, sourceId: e.id });
      if (A.recent.length > RECENT_CAP) A.recent = A.recent.slice(0, RECENT_CAP);
      newAwards.push({ agentId: aid, type: e.type, xp: granted, renown: renownGain, sourceId: e.id });
    }
```

`ACHIEVEMENTS` additions:

```js
  { id: 'first_lead', label: 'First Lead Captured', tier: 'bronze', test: a => (a.counters.leads || 0) >= 1 },
  { id: 'first_sale', label: 'First Blood — Attributed Sale', tier: 'platinum', test: a => (a.counters.sales || 0) >= 1 },
  { id: 'sales_10', label: '10 Attributed Sales', tier: 'platinum', test: a => (a.counters.sales || 0) >= 10 },
```

`SPEC_SUFFIX` addition: `revenue_sale: 'the Closer', funnel_lead: 'the Hunter'`. `BASE_CLASS` addition: `vale: 'Steward'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: all PASS. If the pre-existing cap test (`XP capped at 12/day`) fails, the grant-block refactor broke non-exempt lanes — fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/rewards-engine.js api/companyHeartbeat/rewards-engine.test.js
git commit -m "feat(rewards): cap-exempt revenue lane, task-churn nerf, season XP accrual"
```

---

### Task 4: Season rollover, par, ladder, privilege tiers

Pure `rolloverSeason(prev, nowMs, opts)`: on month change, archive standings, count par misses, derive ladder statuses and privilege tiers, compute next par.

**Files:**
- Modify: `api/companyHeartbeat/rewards-engine.js`
- Test: `api/companyHeartbeat/rewards-engine.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 4: season rollover ──
const mkLedger = (season, perAgent, seasonMeta) => ({
  season, seasonMeta: seasonMeta || null, perAgent, company: { counters: {} }, processedEventIds: [], assistPairs: {}
});
const mkA = (seasonXp, extra) => Object.assign({
  xp: seasonXp, level: 1, rank: 'Rookie', renown: 0, streakDays: 0, lastActiveDay: null,
  dailyXp: 0, dailyXpDay: null, seasonXp, seasonRevenueXp: 0, revenueRecent: [],
  counters: {}, achievements: [], recent: [], parMisses: 0, ladderStatus: 'safe', seasonHistory: []
}, extra || {});
const AUG = Date.UTC(2026, 7, 1, 1, 0, 0);   // 2026-08-01
const IDS5 = ['echo', 'scribe', 'nova', 'quill', 'pixel'];

test('rollover archives standings, resets season XP, sets scaled par', () => {
  const prev = mkLedger('2026-07', {
    echo: mkA(100), scribe: mkA(80), nova: mkA(50), quill: mkA(10), pixel: mkA(5)
  }, { par: 40 });
  const r = rolloverSeason(prev, AUG, { activeIds: IDS5, parFloor: 40 });
  assert.strictEqual(r.rewards.season, '2026-08');
  const e = r.rewards.perAgent.echo;
  assert.strictEqual(e.seasonXp, 0, 'season XP reset');
  assert.strictEqual(e.seasonHistory[0].season, '2026-07');
  assert.strictEqual(e.seasonHistory[0].rank, 1);
  assert.strictEqual(e.seasonHistory[0].belowPar, false);
  // median of [100,80,50,10,5] = 50 -> par = max(40, round(55)) = 55
  assert.strictEqual(r.rewards.seasonMeta.par, 55);
  assert.strictEqual(r.rewards.seasonMeta.previousChampion, 'echo');
});

test('par misses escalate the ladder: watch -> squeezed -> retirement_pending', () => {
  const below = { par: 40 };
  let prev = mkLedger('2026-07', { echo: mkA(100), scribe: mkA(90), nova: mkA(80), quill: mkA(70), pixel: mkA(5) }, below);
  let r = rolloverSeason(prev, AUG, { activeIds: IDS5, parFloor: 40 });
  assert.strictEqual(r.rewards.perAgent.pixel.parMisses, 1);
  assert.strictEqual(r.rewards.perAgent.pixel.ladderStatus, 'watch');
  // simulate two more below-par seasons
  r.rewards.perAgent.pixel.parMisses = 2;
  r.rewards.perAgent.pixel.ladderStatus = 'squeezed';
  r.rewards.season = '2026-08';
  r.rewards.perAgent.pixel.seasonXp = 0;
  const SEP = Date.UTC(2026, 8, 1, 1, 0, 0);
  ['echo', 'scribe', 'nova', 'quill'].forEach(id => { r.rewards.perAgent[id].seasonXp = 100; });
  const r2 = rolloverSeason(r.rewards, SEP, { activeIds: IDS5, parFloor: 40 });
  assert.strictEqual(r2.rewards.perAgent.pixel.parMisses, 3);
  assert.strictEqual(r2.rewards.perAgent.pixel.ladderStatus, 'retirement_pending');
  assert.ok(r2.transitions.some(t => t.agentId === 'pixel' && t.to === 'retirement_pending'), 'transition reported');
});

test('at-or-above-par season resets misses; privilege tiers derive from final ranks', () => {
  // 6 agents — probation only applies when fleet >= 6
  const IDS6 = ['echo', 'scribe', 'nova', 'forge', 'quill', 'pixel'];
  const prev = mkLedger('2026-07', {
    echo: mkA(100), scribe: mkA(80), nova: mkA(50, { parMisses: 1, ladderStatus: 'watch' }),
    forge: mkA(45), quill: mkA(42), pixel: mkA(41)
  }, { par: 40 });
  const r = rolloverSeason(prev, AUG, { activeIds: IDS6, parFloor: 40 });
  assert.strictEqual(r.rewards.perAgent.nova.parMisses, 0, 'recovery resets');
  assert.strictEqual(r.rewards.perAgent.nova.ladderStatus, 'safe');
  const tiers = r.rewards.privileges.tiers;
  assert.strictEqual(tiers.echo, 'vanguard');
  assert.strictEqual(tiers.scribe, 'vanguard');
  assert.strictEqual(tiers.nova, 'line');
  assert.strictEqual(tiers.forge, 'line');
  assert.strictEqual(tiers.quill, 'probation');
  assert.strictEqual(tiers.pixel, 'probation');
});

test('probation is skipped for small fleets (< 6 agents)', () => {
  const prev = mkLedger('2026-07', {
    echo: mkA(100), scribe: mkA(80), nova: mkA(50), quill: mkA(45), pixel: mkA(41)
  }, { par: 40 });
  const r = rolloverSeason(prev, AUG, { activeIds: IDS5, parFloor: 40 });
  const tiers = r.rewards.privileges.tiers;
  assert.strictEqual(tiers.pixel, 'line', 'no probation at fleet size 5');
});

test('no rollover mid-season; bootstrap ledger without seasonMeta counts no misses', () => {
  const prev = mkLedger('2026-08', { echo: mkA(5) }, { par: 40 });
  const r = rolloverSeason(prev, AUG, { activeIds: ['echo'], parFloor: 40 });
  assert.strictEqual(r.rolled, false, 'same month: no-op');
  const boot = mkLedger('2026-07', { echo: mkA(0), scribe: mkA(0) }, null);   // pre-seasons ledger
  const rb = rolloverSeason(boot, AUG, { activeIds: ['echo', 'scribe'], parFloor: 40 });
  assert.strictEqual(rb.rewards.perAgent.echo.parMisses, 0, 'no par existed -> no miss');
  assert.strictEqual(rb.rewards.seasonMeta.par, 40, 'par floors at 40');
});
```

Add `rolloverSeason` to the require destructure at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: 4 new FAIL (`rolloverSeason is not a function`).

- [ ] **Step 3: Implement**

Constants:

```js
const SEASON_PAR_FLOOR = 40;
const SEASON_PAR_GROWTH = 1.10;
const SEASON_HISTORY_CAP = 12;
const LADDER_BY_MISSES = ['safe', 'watch', 'squeezed', 'retirement_pending'];
const VANGUARD_RANKS = 2;      // top-2 = vanguard
const PROBATION_RANKS = 2;     // bottom-2 = probation (only when fleet >= 6)
```

New pure function above `// ── IO orchestration`:

```js
function _median(nums) {
  var s = nums.slice().sort(function (a, b) { return a - b; });
  if (!s.length) return 0;
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Season rollover. Call FIRST each run, on the raw previous ledger (before
// _initRewards stamps the current month over prev.season). Returns
// { rewards, rolled, transitions: [{agentId, from, to}] }.
function rolloverSeason(prev, nowMs, opts) {
  opts = opts || {};
  var nowMonth = _iso(nowMs).substring(0, 7);
  if (!prev || !prev.perAgent || !prev.season || prev.season === nowMonth) {
    return { rewards: prev, rolled: false, transitions: [] };
  }
  var r = JSON.parse(JSON.stringify(prev));
  var activeIds = (opts.activeIds && opts.activeIds.length) ? opts.activeIds : FLEET_AGENTS;
  var parFloor = Number.isFinite(opts.parFloor) ? opts.parFloor : SEASON_PAR_FLOOR;
  var par = (r.seasonMeta && Number.isFinite(r.seasonMeta.par)) ? r.seasonMeta.par : null;
  var fleet = activeIds.filter(function (id) { return r.perAgent[id]; });
  var ranked = fleet.map(function (id) { return { id: id, sx: r.perAgent[id].seasonXp || 0 }; })
    .sort(function (a, b) { return b.sx - a.sx; });
  var transitions = [];

  ranked.forEach(function (row, i) {
    var A = r.perAgent[row.id];
    var belowPar = par != null && row.sx < par;
    if (par != null) A.parMisses = belowPar ? (A.parMisses || 0) + 1 : 0;
    else A.parMisses = A.parMisses || 0;
    var from = A.ladderStatus || 'safe';
    A.ladderStatus = LADDER_BY_MISSES[Math.min(A.parMisses, 3)];
    if (A.ladderStatus !== from) transitions.push({ agentId: row.id, from: from, to: A.ladderStatus });
    if (!Array.isArray(A.seasonHistory)) A.seasonHistory = [];
    A.seasonHistory.unshift({ season: r.season, seasonXp: row.sx, seasonRevenueXp: A.seasonRevenueXp || 0, rank: i + 1, par: par, belowPar: belowPar });
    if (A.seasonHistory.length > SEASON_HISTORY_CAP) A.seasonHistory = A.seasonHistory.slice(0, SEASON_HISTORY_CAP);
    A.seasonXp = 0;
    A.seasonRevenueXp = 0;
  });

  var tiers = {};
  ranked.forEach(function (row, i) {
    var probation = fleet.length >= 6 && i >= ranked.length - PROBATION_RANKS;
    tiers[row.id] = i < VANGUARD_RANKS ? 'vanguard' : (probation ? 'probation' : 'line');
  });

  var nextPar = Math.max(parFloor, Math.round(SEASON_PAR_GROWTH * _median(ranked.map(function (x) { return x.sx; }))));
  r.seasonMeta = { par: nextPar, startedAt: _iso(nowMs), previousChampion: ranked.length ? ranked[0].id : null };
  r.privileges = { enabled: true, season: nowMonth, tiers: tiers };
  r.season = nowMonth;
  return { rewards: r, rolled: true, transitions: transitions };
}
```

Also in `_initRewards`, seed `seasonMeta` on a brand-new ledger so par exists from day one:

```js
  if (!r.seasonMeta) r.seasonMeta = { par: SEASON_PAR_FLOOR, startedAt: _iso(nowMs), previousChampion: null };
```

Export `rolloverSeason`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/rewards-engine.js api/companyHeartbeat/rewards-engine.test.js
git commit -m "feat(rewards): monthly season rollover — scaling par, ladder statuses, privilege tiers"
```

---

### Task 5: Merit budget plan

Pure `computeBudgetPlan(rewards, opts)`: 40% survival floor + 60% proportional to trailing-14d revenue XP, squeeze ×0.7 with champion redistribution.

**Files:**
- Modify: `api/companyHeartbeat/rewards-engine.js`
- Test: `api/companyHeartbeat/rewards-engine.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 5: merit budget plan ──
test('pre-revenue (all trailing 0) the plan is an even split of the pool', () => {
  const led = mkLedger('2026-08', { echo: mkA(0), scribe: mkA(0), nova: mkA(0), quill: mkA(0) }, { par: 40 });
  const plan = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  assert.strictEqual(plan.perAgent.echo, 25);
  assert.strictEqual(plan.perAgent.quill, 25);
});

test('trailing revenue XP shifts the 60% merit share; floor guarantees survival', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0, { revenueRecent: [{ at: new Date(AUG - 2 * 86400000).toISOString(), xp: 60 }] }),
    scribe: mkA(0, { revenueRecent: [{ at: new Date(AUG - 3 * 86400000).toISOString(), xp: 20 }] }),
    nova: mkA(0), quill: mkA(0)
  }, { par: 40 });
  const plan = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  // floor: 40/4 = 10 each. merit 60: echo 45, scribe 15, others 0.
  assert.strictEqual(plan.perAgent.echo, 55);
  assert.strictEqual(plan.perAgent.scribe, 25);
  assert.strictEqual(plan.perAgent.nova, 10);
  // entries older than 14d are ignored
  led.perAgent.echo.revenueRecent = [{ at: new Date(AUG - 20 * 86400000).toISOString(), xp: 60 }];
  const plan2 = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  assert.strictEqual(plan2.perAgent.scribe, 70, 'scribe now sole earner: 10 + 60');
});

test('squeezed agents lose 30%, redistributed to the previous champion', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0), scribe: mkA(0), nova: mkA(0), quill: mkA(0, { ladderStatus: 'squeezed' })
  }, { par: 40 });
  led.seasonMeta = { par: 40, previousChampion: 'echo' };
  const plan = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  assert.strictEqual(plan.perAgent.quill, 17.5, '25 * 0.7');
  assert.strictEqual(plan.perAgent.echo, 32.5, '25 + freed 7.5');
});
```

Add `computeBudgetPlan` to the test-file require.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: 3 new FAIL.

- [ ] **Step 3: Implement**

Constants:

```js
const MERIT_FLOOR_PCT = 0.4;
const MERIT_PCT = 0.6;
const SQUEEZE_CAP_MULT = 0.7;
const TRAILING_REVENUE_WINDOW_MS = 14 * 86400000;
```

Pure functions (below `rolloverSeason`):

```js
function _round2(n) { return Math.round(n * 100) / 100; }

function computeTrailingRevenueXp(A, nowMs) {
  var cutoff = nowMs - TRAILING_REVENUE_WINDOW_MS;
  return _arr(A && A.revenueRecent).reduce(function (s, r) {
    var t = Date.parse(r && r.at || 0) || 0;
    return t >= cutoff ? s + (Number(r.xp) || 0) : s;
  }, 0);
}

// The continuous meritocracy: floor + performance share, squeeze redistribution.
// Pre-revenue (all trailing 0) this reduces to an even split == current behavior.
function computeBudgetPlan(rewards, opts) {
  opts = opts || {};
  var nowMs = opts.nowMs || Date.now();
  var pool = Number(opts.poolDollars) || 0;
  var floorPct = Number.isFinite(opts.floorPct) ? opts.floorPct : MERIT_FLOOR_PCT;
  var meritPct = Number.isFinite(opts.meritPct) ? opts.meritPct : MERIT_PCT;
  var squeezeMult = Number.isFinite(opts.squeezeMult) ? opts.squeezeMult : SQUEEZE_CAP_MULT;
  var ids = ((opts.activeIds && opts.activeIds.length) ? opts.activeIds : FLEET_AGENTS)
    .filter(function (id) { return rewards && rewards.perAgent && rewards.perAgent[id]; });
  if (!ids.length || pool <= 0) return { enabled: false, perAgent: {}, computedAt: _iso(nowMs) };

  var trail = {};
  var total = 0;
  ids.forEach(function (id) { trail[id] = computeTrailingRevenueXp(rewards.perAgent[id], nowMs); total += trail[id]; });

  var perAgent = {};
  ids.forEach(function (id) {
    var floorShare = (pool * floorPct) / ids.length;
    var meritShare = total > 0 ? pool * meritPct * (trail[id] / total) : (pool * meritPct) / ids.length;
    perAgent[id] = floorShare + meritShare;
  });

  var champion = rewards.seasonMeta && rewards.seasonMeta.previousChampion;
  var freed = 0;
  ids.forEach(function (id) {
    if ((rewards.perAgent[id].ladderStatus || 'safe') === 'squeezed') {
      var cut = perAgent[id] * (1 - squeezeMult);
      perAgent[id] -= cut;
      freed += cut;
    }
  });
  if (freed > 0 && champion && perAgent[champion] != null) perAgent[champion] += freed;

  ids.forEach(function (id) { perAgent[id] = _round2(perAgent[id]); });
  return { enabled: true, perAgent: perAgent, poolDollars: pool, trailing: trail, computedAt: _iso(nowMs) };
}
```

Export `computeBudgetPlan` and `computeTrailingRevenueXp`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/rewards-engine.js api/companyHeartbeat/rewards-engine.test.js
git commit -m "feat(rewards): continuous merit budget plan — floor + trailing-revenue share + squeeze"
```

---

### Task 6: Prompt block v2 — SEASON STANDINGS

Extend `buildProgressionPromptBlock` with season rank/top-3, par progress, days left, ladder consequence lines, privilege tier, and the revenue earning guide. Existing assertions (header, level, `lead the fleet`, outcomes-only line) must keep passing.

**Files:**
- Modify: `api/companyHeartbeat/rewards-engine.js`
- Test: `api/companyHeartbeat/rewards-engine.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 6: prompt block v2 ──
test('prompt block shows season standings, par progress and earning guide', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0, { seasonXp: 50, level: 4, rank: 'Rookie', xp: 388 }),
    scribe: mkA(0, { seasonXp: 30, level: 5, rank: 'Rookie', xp: 543 }),
    nova: mkA(0, { seasonXp: 5, level: 1, rank: 'Rookie', xp: 37 })
  }, { par: 40, previousChampion: null });
  led.privileges = { enabled: true, season: '2026-08', tiers: { echo: 'vanguard', scribe: 'line', nova: 'probation' } };
  const block = buildProgressionPromptBlock('nova', led, AUG + 10 * 86400000);
  assert.ok(/SEASON/.test(block), 'season header');
  assert.ok(/#3 of 3/.test(block), 'season rank');
  assert.ok(/5\/40/.test(block), 'par progress seasonXp/par');
  assert.ok(/days (left|remain)/i.test(block), 'days remaining');
  assert.ok(/probation/i.test(block), 'privilege tier shown');
  assert.ok(/sale/i.test(block) && /lead/i.test(block), 'earning guide names the revenue lane');
});

test('ladder consequence lines are stated verbatim for hot states', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0, { seasonXp: 50 }), nova: mkA(0, { seasonXp: 5, parMisses: 2, ladderStatus: 'squeezed' }),
    quill: mkA(0, { seasonXp: 1, parMisses: 3, ladderStatus: 'retirement_pending' })
  }, { par: 40 });
  assert.ok(/budget is cut 30%/i.test(buildProgressionPromptBlock('nova', led, AUG)), 'squeeze line');
  const rp = buildProgressionPromptBlock('quill', led, AUG);
  assert.ok(/retirement/i.test(rp) && /successor/i.test(rp), 'existential line');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: 2 new FAIL.

- [ ] **Step 3: Implement**

Change the signature to `buildProgressionPromptBlock(agentId, rewards, nowMs)` (`nowMs` optional, default `Date.now()`; the existing caller `prompt-builders.js:1246` needs no change). Replace the function body's return with a build that keeps the career stat line and peer line, then appends the season section. Full replacement for the section after `recentLine`:

```js
  var nowT = nowMs || Date.now();
  var seasonRanked = Object.keys(rewards.perAgent)
    .filter(function (id) { return _FLEET_SET[id]; })
    .map(function (id) { return { id: id, sx: rewards.perAgent[id].seasonXp || 0 }; })
    .sort(function (a, b) { return b.sx - a.sx; });
  var sIdx = seasonRanked.findIndex(function (x) { return x.id === agentId; });
  var par = (rewards.seasonMeta && rewards.seasonMeta.par) || null;
  var month = rewards.season || _iso(nowT).substring(0, 7);
  var monthEnd = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1);
  var daysLeft = Math.max(0, Math.ceil((monthEnd - nowT) / 86400000));
  var top3 = seasonRanked.slice(0, 3).map(function (x, i) { return (i + 1) + '. ' + _cap(x.id) + ' ' + x.sx; }).join('  ');

  var seasonLine = 'Season ' + month + ': rank #' + (sIdx + 1) + ' of ' + seasonRanked.length +
    '. Top: ' + top3 + '. Your season XP ' + (me.seasonXp || 0) + (par ? '/' + par + ' par' : '') +
    '. ' + daysLeft + ' days left.';

  var status = me.ladderStatus || 'safe';
  var ladderLine = '';
  if (status === 'watch') {
    ladderLine = 'LADDER: You are on relegation watch (1 below-par season). Finish at or above par or your budget gets cut next season.\n';
  } else if (status === 'squeezed') {
    ladderLine = 'LADDER: Your budget is cut 30% this season (2 below-par seasons). Finishing at or above par restores it. One more below-par season auto-drafts a retirement proposal.\n';
  } else if (status === 'retirement_pending') {
    ladderLine = 'LADDER: A retirement proposal for you has been drafted for CEO decision. You are one CEO decision from retirement. Revenue-lane outcomes are the only thing that resets this. Your successor would inherit your memories.\n';
  }

  var tier = (rewards.privileges && rewards.privileges.enabled !== false && rewards.privileges.tiers && rewards.privileges.tiers[agentId]) || 'line';
  var tierLine = tier === 'vanguard'
    ? 'Privileges: VANGUARD — +1 action slot, full model tier, proposal rights.'
    : tier === 'probation'
      ? 'Privileges: PROBATION — -1 action slot, economy model, campaign/objective proposals blocked. Climb the season board to restore them.'
      : 'Privileges: LINE — standard slots and model.';

  return '\n═══ YOUR PROGRESSION — SEASON ' + month + ' ═══\n' +
    'Level ' + lvl + ' ' + (me.rank || 'Rookie') + (me.class ? ' (' + me.class + ')' : '') + '. ' +
      into + '/' + xpForNext + ' XP to Level ' + (lvl + 1) + '. Renown ' + (me.renown || 0) + '. ' + (me.streakDays || 0) + '-day streak.\n' +
    seasonLine + '\n' +
    peerLine + '\n' +
    ladderLine +
    tierLine + '\n' +
    recentLine + '\n' +
    'Revenue lane pays most: attributed sale 100+ XP, lead 15, public scan 3 — split across every agent in the chain that produced it (writer, assignee, reviewer). Tasks pay at most 3 XP/day. ' +
    'You earn XP ONLY from outcomes that land: revenue, CEO-approved work, published content, real engagement, completed peer-reviewed tasks. Proposing, commenting, or messaging earns nothing. To climb, ship something that sells.\n';
```

Note the old test asserting `/only from outcomes/i` still matches (`ONLY from outcomes`), and the old header test asserts `indexOf('YOUR PROGRESSION') !== -1` which still holds inside the new header.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: all PASS, including the two pre-existing prompt-block tests.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/rewards-engine.js api/companyHeartbeat/rewards-engine.test.js
git commit -m "feat(rewards): SEASON STANDINGS prompt block — par, ladder stakes, privileges, earning guide"
```

---

### Task 7: IO wiring — new sources, pipeline order, config, retirement draft

`runRewardsEngine` loads the new sources, runs rollover FIRST, attaches `budgetPlan`, honors `systemConfig.rewards` kill switches, and drafts the CEO-gated retirement proposal on transition.

**Files:**
- Modify: `api/companyHeartbeat/rewards-engine.js` (`runRewardsEngine` + a small config normalizer)
- Test: `api/companyHeartbeat/rewards-engine.test.js` (fake-storage integration tests)

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 7: IO wiring ──
function fakeStorage(seed) {
  const db = Object.assign({}, seed);
  return {
    db,
    getState: async (k) => (k in db ? JSON.parse(JSON.stringify(db[k])) : null),
    setState: async (k, v) => { db[k] = JSON.parse(JSON.stringify(v)); }
  };
}

test('runRewardsEngine pays an attributed sale end-to-end and attaches budgetPlan', async () => {
  const st = fakeStorage({
    approvalQueue: [], blogPosts: [], outcomeSnapshots: {}, tasksArchive: [], blogPostViews: [],
    socialAccountStats: {}, runtimeMemory: {}, agentRewards: null,
    tasks: [{ id: 'tk1', assignee: 'echo', reviewer: 'quill', campaign_id: 'camp-conv', updatedAt: at(-1) }],
    campaigns: [{ id: 'camp-conv', status: 'active', northStarMetric: 'paying customers' }],
    actions: [{ id: 'act_1', created_by: 'scribe', _parentTaskId: 'tk1' }],
    actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [{ id: 'evt_1', type: 'one_time', amountCents: 2900, utmContent: 'act_1', occurredAt: at(0) }] },
    as_leads: [], cc_analytics: [], systemConfig: {},
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => ({ id, status: 'active' })) }
  });
  const res = await runRewardsEngine({ storage: st, nowMs: NOW, log: () => {} });
  assert.strictEqual(res.ok, true);
  const led = st.db.agentRewards;
  assert.ok(led.perAgent.scribe.counters.sales >= 1, 'writer credited');
  assert.ok(led.perAgent.echo.seasonRevenueXp > 0, 'assignee credited');
  assert.ok(led.budgetPlan && led.budgetPlan.perAgent, 'budgetPlan attached');
});

test('runRewardsEngine drafts ONE retirement proposal on transition, never for protected agents', async () => {
  const mkPrev = (targetId) => {
    const per = {};
    FLEET_TEST_IDS.forEach(id => { per[id] = mkA(id === targetId ? 0 : 100); });
    per[targetId].parMisses = 2;
    per[targetId].ladderStatus = 'squeezed';
    return mkLedger('2026-07', per, { par: 40 });
  };
  const seed = (targetId) => ({
    approvalQueue: [], blogPosts: [], outcomeSnapshots: {}, tasks: [], tasksArchive: [], blogPostViews: [],
    socialAccountStats: {}, runtimeMemory: {}, campaigns: [], actions: [], actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [] }, as_leads: [], cc_analytics: [], systemConfig: {},
    agentRewards: mkPrev(targetId),
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => ({ id, status: 'active' })) }
  });
  let st = fakeStorage(seed('quill'));
  await runRewardsEngine({ storage: st, nowMs: AUG, log: () => {} });
  let drafts = st.db.approvalQueue.filter(q => q.type === 'agent_retire_proposal');
  assert.strictEqual(drafts.length, 1, 'draft appended');
  assert.strictEqual(drafts[0].retire.targetAgent, 'quill');
  assert.strictEqual(drafts[0].proposedBy, 'rewards-engine');
  // re-run: no duplicate
  await runRewardsEngine({ storage: st, nowMs: AUG + 3600000, log: () => {} });
  drafts = st.db.approvalQueue.filter(q => q.type === 'agent_retire_proposal');
  assert.strictEqual(drafts.length, 1, 'dedup across runs');
  // protected agent: no draft
  st = fakeStorage(seed('nova'));
  await runRewardsEngine({ storage: st, nowMs: AUG, log: () => {} });
  assert.strictEqual(st.db.approvalQueue.filter(q => q.type === 'agent_retire_proposal').length, 0, 'nova is protected');
});

test('systemConfig.rewards.enabled=false skips seasons/budget/drafts but legacy lanes still pay', async () => {
  const st = fakeStorage({
    approvalQueue: [], blogPosts: [{ id: 'b1', author: 'scribe', publishedAt: at(0) }],
    outcomeSnapshots: {}, tasks: [], tasksArchive: [], blogPostViews: [], socialAccountStats: {}, runtimeMemory: {},
    campaigns: [], actions: [], actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [{ id: 'evt_9', type: 'one_time', amountCents: 2900, utmContent: null, occurredAt: at(0) }] },
    as_leads: [], cc_analytics: [],
    systemConfig: { rewards: { enabled: false } },
    agentRewards: null,
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => ({ id, status: 'active' })) }
  });
  await runRewardsEngine({ storage: st, nowMs: NOW, log: () => {} });
  const led = st.db.agentRewards;
  assert.ok(led.perAgent.scribe.counters.blogs >= 1, 'legacy blog lane still pays');
  assert.ok(!led.budgetPlan || led.budgetPlan.enabled === false, 'no merit budget when disabled');
  assert.ok(!Object.keys(led.perAgent).some(id => (led.perAgent[id].counters.sales || 0) > 0), 'revenue lane off');
});
```

Add near the other test helpers: `const FLEET_TEST_IDS = ['nova', 'cipher', 'pixel', 'forge', 'echo', 'scout', 'scribe', 'quill', 'vale'];` and add `runRewardsEngine` to the require destructure. Because these tests are async, wrap: change the `test` helper to support promises —

```js
const asyncTests = [];
function testAsync(name, fn) { asyncTests.push({ name, fn }); }
```

and at the bottom of the file, replace the final two lines with:

```js
(async () => {
  for (const t of asyncTests) {
    try { await t.fn(); pass++; console.log('  PASS ', t.name); }
    catch (e) { fail++; console.log('  FAIL ', t.name, '\n        ', e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();
```

Use `testAsync(...)` for the three tests above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: 3 new FAIL (missing sources / no budgetPlan / no draft); all sync tests PASS.

- [ ] **Step 3: Implement**

Constants:

```js
const PROTECTED_AGENTS = { nova: true, cipher: true };   // mirror constants.js:393 — never auto-draft retirement
const FLEET_MIN = 5;                                     // mirror constants.js:394
```

Config normalizer (near the other helpers):

```js
function normalizeRewardsConfig(sysCfg) {
  var c = (sysCfg && sysCfg.rewards) || {};
  var mb = c.meritBudget || {};
  return {
    enabled: c.enabled !== false,
    meritBudget: { enabled: mb.enabled !== false, floorPct: Number.isFinite(mb.floorPct) ? mb.floorPct : MERIT_FLOOR_PCT, meritPct: Number.isFinite(mb.meritPct) ? mb.meritPct : MERIT_PCT },
    privileges: { enabled: !c.privileges || c.privileges.enabled !== false },
    parFloor: Number.isFinite(c.parFloor) ? c.parFloor : SEASON_PAR_FLOOR,
    squeezeMult: Number.isFinite(c.squeezeMult) ? c.squeezeMult : SQUEEZE_CAP_MULT,
    budgetMonthly: Number.isFinite(c.budgetMonthly) ? c.budgetMonthly : null
  };
}
```

Rewrite `runRewardsEngine`'s body (keep the try/catch no-op contract and the return shape):

```js
async function runRewardsEngine(opts) {
  opts = opts || {};
  var storage = opts.storage;
  var nowMs = opts.nowMs || Date.now();
  var log = opts.log || function () {};
  try {
    var loaded = await Promise.all([
      storage.getState('approvalQueue').then(function (v) { return v || []; }),
      storage.getState('blogPosts').then(function (v) { return v || []; }),
      storage.getState('outcomeSnapshots').then(function (v) { return v || {}; }),
      storage.getState('tasks').then(function (v) { return v || []; }),
      storage.getState('tasksArchive').then(function (v) { return v || []; }),
      storage.getState('socialAccountStats').then(function (v) { return v || {}; }),
      storage.getState('runtimeMemory').then(function (v) { return v || {}; }),
      storage.getState('agentRewards').then(function (v) { return v || null; }),
      storage.getState('blogPostViews').then(function (v) { return Array.isArray(v) ? v.length : 0; }),
      storage.getState('revenueLedger').then(function (v) { return (v && Array.isArray(v.entries)) ? v.entries : []; }),
      storage.getState('as_leads').then(function (v) { return v || []; }),
      storage.getState('cc_analytics').then(function (v) { return v || []; }),
      storage.getState('actions').then(function (v) { return v || []; }),
      storage.getState('actionAttributionIndex').then(function (v) { return (v && v.map) ? v.map : {}; }),
      storage.getState('campaigns').then(function (v) { return v || []; }),
      storage.getState('systemConfig').then(function (v) { return v || {}; }),
      storage.getState('agentRegistry').then(function (v) { return v || null; })
    ]);
    var cfg = normalizeRewardsConfig(loaded[15]);
    var registry = loaded[16];
    var activeIds = (registry && Array.isArray(registry.agents))
      ? registry.agents.filter(function (a) { return a && a.status === 'active'; }).map(function (a) { return a.id; })
      : FLEET_AGENTS;

    var actionsById = {};
    _arr(loaded[12]).forEach(function (a) { if (a && a.id) actionsById[a.id] = a; });

    var state = {
      approvalQueue: loaded[0], blogPosts: loaded[1], outcomeSnapshots: loaded[2],
      tasks: loaded[3], tasksArchive: loaded[4], _nowMs: nowMs
    };
    if (cfg.enabled) {
      state.revenueLedgerEntries = loaded[9];
      state.asLeads = loaded[10];
      state.scans = loaded[11];
      state.actionsById = actionsById;
      state.attributionIndex = loaded[13];
      state.campaigns = loaded[14];
    }

    var prev = loaded[7];
    var rolled = cfg.enabled
      ? rolloverSeason(prev, nowMs, { activeIds: activeIds, parFloor: cfg.parFloor })
      : { rewards: prev, rolled: false, transitions: [] };

    var events = extractEvents(state, rolled.rewards);
    var applied = applyEvents(events, rolled.rewards, nowMs);

    var followerTotal = 0;
    var sas = loaded[5] || {};
    var sasPlatforms = (sas && sas.platforms) ? sas.platforms : sas;
    Object.keys(sasPlatforms || {}).forEach(function (k) {
      var f = sasPlatforms[k] && Number(sasPlatforms[k].followers);
      if (Number.isFinite(f)) followerTotal += f;
    });
    var rm = loaded[6] || {};
    var rev = rm.revenueDigest && Number(rm.revenueDigest.totalCents);
    var rewards = applyCompany(applied.rewards, {
      followerTotal: followerTotal,
      revenueCents: Number.isFinite(rev) ? rev : undefined,
      blogViews: loaded[8]
    }, nowMs);

    if (cfg.enabled && cfg.meritBudget.enabled) {
      var pool = cfg.budgetMonthly != null ? cfg.budgetMonthly
        : (loaded[15] && loaded[15].finance && Number(loaded[15].finance.budgetMonthly)) || 110;
      rewards.budgetPlan = computeBudgetPlan(rewards, {
        poolDollars: pool, floorPct: cfg.meritBudget.floorPct, meritPct: cfg.meritBudget.meritPct,
        squeezeMult: cfg.squeezeMult, activeIds: activeIds, nowMs: nowMs
      });
    } else {
      rewards.budgetPlan = { enabled: false, perAgent: {}, computedAt: _iso(nowMs) };
    }
    if (rewards.privileges) rewards.privileges.enabled = cfg.enabled && cfg.privileges.enabled;

    await storage.setState('agentRewards', rewards);

    // Retirement drafts — the ladder's final rung. IO-layer append, dedup-guarded,
    // never for protected agents, never below fleet minimum. CEO decides.
    if (cfg.enabled && rolled.transitions.length) {
      var pending = _arr(loaded[0]);
      var drafts = 0;
      rolled.transitions.forEach(function (t) {
        if (t.to !== 'retirement_pending' || PROTECTED_AGENTS[t.agentId]) return;
        if (activeIds.length - 1 < FLEET_MIN) return;
        var dup = pending.some(function (q) {
          return q && q.type === 'agent_retire_proposal' && q.status === 'pending' &&
            q.retire && q.retire.targetAgent === t.agentId;
        });
        if (dup) return;
        var A = rewards.perAgent[t.agentId] || {};
        pending.push({
          id: 'retpr_' + nowMs + '_rwd' + drafts,
          type: 'agent_retire_proposal',
          status: 'pending',
          proposedBy: 'rewards-engine',
          retire: {
            targetAgent: t.agentId,
            rationale: ('Season ladder: ' + (A.parMisses || 3) + ' consecutive below-par seasons. Auto-drafted by the rewards ladder per the 2026-07-30 Revenue Seasons spec. CEO decision required.').substring(0, 500),
            reassignmentPlan: 'Standard retire flow: open tasks reassign to the domain lead on approval. Successor seeding (knowledge inheritance) is Track C.',
            estimatedWinddownCost: 0,
            orphans: []
          },
          estimatedCost: 0,
          evidence: { source: 'rewards-ladder', season: (prev && prev.season) || null, parMisses: A.parMisses || null },
          createdAt: _iso(nowMs)
        });
        drafts++;
      });
      if (drafts > 0) await storage.setState('approvalQueue', pending);
    }

    log('[rewardsEngine] events=' + events.length + ' awards=' + applied.newAwards.length + ' followers=' + followerTotal + ' rolled=' + rolled.rolled);
    return { ok: true, events: events.length, awards: applied.newAwards.length, rolled: rolled.rolled };
  } catch (err) {
    log('[rewardsEngine] Fatal (no-op): ' + (err && err.message ? err.message : String(err)));
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}
```

Export `normalizeRewardsConfig`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node api/companyHeartbeat/rewards-engine.test.js`
Expected: all PASS (sync + async).

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/rewards-engine.js api/companyHeartbeat/rewards-engine.test.js
git commit -m "feat(rewards): IO wiring — revenue sources, season pipeline, kill switches, retirement drafts"
```

---

### Task 8: Heartbeat read-hooks — merit caps, model tier, action slots, proposal rights

Three small read-side hooks. The engine remains the only writer of `agentRewards`; the heartbeat only reads it. CEO approved touching these files for this feature (spec §11).

**Files:**
- Modify: `api/companyHeartbeat/constants.js` (in `loadAgentRegistry`, after `_applyRegistry`)
- Modify: `api/companyHeartbeat/gemini.js` (probation model downgrade in `_callWithFallback`)
- Modify: `api/companyHeartbeat/agent-runner.js` (per-agent slot cap at ~1392; probation proposal block at ~5364 and ~5531)

- [ ] **Step 1: constants.js — merit caps**

In `loadAgentRegistry` (constants.js:461-484), add a helper above it and call it after BOTH `_applyRegistry(...)` call sites (the persisted branch AND the bootstrap branch), before their returns:

```js
// Merit budget (Revenue Seasons): the rewards engine precomputes per-agent caps in
// agentRewards.budgetPlan; here we only READ and apply them to the in-memory
// AGENT_ROLES rows (never persisted back to agentRegistry — caps are derived state).
async function _applyMeritBudget(storage) {
  try {
    var rw = await storage.getState('agentRewards');
    var plan = rw && rw.budgetPlan;
    if (!plan || plan.enabled === false || !plan.perAgent) return;
    AGENT_IDS.forEach(function (id) {
      var cap = Number(plan.perAgent[id]);
      if (Number.isFinite(cap) && cap >= 0.5 && cap <= 200 && AGENT_ROLES[id]) {
        AGENT_ROLES[id].monthlyCap = Math.round(cap * 100) / 100;
      }
    });
  } catch (_mbErr) { /* fail-open: registry caps stand */ }
}
```

Call sites inside `loadAgentRegistry`:

```js
    if (persisted && Array.isArray(persisted.agents) && persisted.agents.length >= FLEET_MIN_SIZE) {
      _applyRegistry(persisted);
      await _applyMeritBudget(storage);
      return persisted;
    }
```

and in the bootstrap branch, after its `_applyRegistry(boot)` (or equivalent) line, add `await _applyMeritBudget(storage);` the same way. Read the function first — apply the call after every `_applyRegistry` invocation inside `loadAgentRegistry`, nowhere else.

- [ ] **Step 2: gemini.js — probation model downgrade**

After the `_resolveModel` function (gemini.js:~45), add:

```js
// Revenue Seasons privilege tier: probation agents run the economy model.
// Read-only ledger peek, cached like the model key, fail-open to no downgrade.
var _probCache = null;
var _probExpiry = 0;
async function _probationSet() {
  var now = Date.now();
  if (_probCache && now < _probExpiry) return _probCache;
  var set = {};
  try {
    var rw = await storage.getState('agentRewards');
    var priv = rw && rw.privileges;
    if (priv && priv.enabled !== false && priv.tiers) {
      Object.keys(priv.tiers).forEach(function (id) { if (priv.tiers[id] === 'probation') set[id] = true; });
    }
  } catch (e) { /* fail-open */ }
  _probCache = set;
  _probExpiry = now + CACHE_TTL_MS;
  return set;
}
```

In `_callWithFallback` (gemini.js:208-217), after `var configured = await _resolveModel();` and the unknown-config guard, add:

```js
  try {
    var _prob = await _probationSet();
    if (agentId && _prob[agentId]) configured = 'gemini-flash';
  } catch (_pe) { /* fail-open */ }
```

- [ ] **Step 3: agent-runner.js — slots + proposal rights**

First verify scope: confirm `_agentRewards` (loaded at agent-runner.js:545) is in scope at the action loop (~line 1392) — both are inside the same per-agent run function. If it is NOT in scope, load it once immediately before the loop with `const _agentRewards = (await storage.getState('agentRewards')) || null;` (do not add a second load if scope reaches).

Immediately before the `for (const action of actions) {` loop (~line 1392), add:

```js
  // Revenue Seasons privilege tier — vanguard +1 slot, probation -1 (floor 1).
  const _privTier = (_agentRewards && _agentRewards.privileges && _agentRewards.privileges.enabled !== false &&
    _agentRewards.privileges.tiers && _agentRewards.privileges.tiers[agentId]) || 'line';
  const _slotCap = Math.max(1, GUARDRAILS.maxActionsPerCyclePerAgent +
    (_privTier === 'vanguard' ? 1 : (_privTier === 'probation' ? -1 : 0)));
```

Replace both uses of `GUARDRAILS.maxActionsPerCyclePerAgent` inside the rate-limit check (the `if` condition and the two `cap:` / message references at 1392-1404) with `_slotCap`.

In the `propose-campaign` handler after the `PROPOSAL_AUTHORIZED_AGENTS` gate (agent-runner.js:5364-5370), add:

```js
      if (_privTier === 'probation') {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — probation tier (Revenue Seasons)');
        await logEvent('policy-violation', agentId, 'propose-campaign blocked: probation privilege tier', cycleId,
          { runId: cycleId, gate: 'privilege_probation', kind: 'campaign' });
        continue;
      }
```

Add the equivalent block (with `kind: 'objective'`) in the `propose-objective` handler after its gate (agent-runner.js:5531-5537). If `_privTier` is not in scope at those lines (different function), recompute it locally from `_agentRewards` with the same expression, or from a fresh `storage.getState('agentRewards')` read if `_agentRewards` is also out of scope — verify with a scope check before choosing.

- [ ] **Step 4: Verify**

```bash
node api/companyHeartbeat/rewards-engine.test.js
node api/companyHeartbeat/smoke-test.js
node --check api/companyHeartbeat/constants.js
node --check api/companyHeartbeat/gemini.js
node --check api/companyHeartbeat/agent-runner.js
```

Expected: rewards tests all PASS; smoke-test passes (it asserts `GUARDRAILS.maxActionsPerCyclePerAgent` still equals 3 — unchanged); all three files parse.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/constants.js api/companyHeartbeat/gemini.js api/companyHeartbeat/agent-runner.js
git commit -m "feat(rewards): heartbeat read-hooks — merit caps, probation model tier, slot/proposal privileges"
```

---

### Task 9: Docs, skill update, deploy verification

**Files:**
- Modify: `.claude/skills/agent-rewards/SKILL.md` (Recent Changes entry)
- Modify: `docs/superpowers/specs/2026-07-30-revenue-seasons-design.md` (status line → Implemented)

- [ ] **Step 1: Update the skill's Recent Changes**

Prepend a `2026-07-30 — Revenue Seasons SHIPPED` entry to the Recent Changes section of `.claude/skills/agent-rewards/SKILL.md` covering: revenue lane (sale 100+$1/$, lead 15, scan 3; cap-exempt sale/lead), causal-chain split via `utm_content` action id + `actionAttributionIndex` fallback, task_done lane cap 3/day, monthly seasons + par (`seasonMeta.par`, floor 40, 110% of median), ladder statuses, `budgetPlan` merit caps applied in `loadAgentRegistry`, probation model downgrade in gemini.js, slot/proposal privileges in agent-runner.js, retirement drafts (`proposedBy: 'rewards-engine'`), and the `systemConfig.rewards` kill switches. Note that season 1 = 2026-08 and the first rollover fires on the first engine run of August.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/agent-rewards/SKILL.md docs/superpowers/specs/2026-07-30-revenue-seasons-design.md
git commit -m "docs(rewards): Revenue Seasons — skill Recent Changes + spec status"
```

- [ ] **Step 3: Post-deploy verification (after CI deploys — repo auto-pushes)**

```bash
# 1. Manual engine run
curl -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/rewards-engine-trigger" -H "x-company-secret: pixelpusher"
# Expected: { ok: true, events: N, awards: M, rolled: false }  (rolled=true only on the first August run)

# 2. Inspect the ledger for the new fields
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/agentRewards" -H "x-company-secret: pixelpusher"
# Expected: perAgent.*.seasonXp / ladderStatus / parMisses present; budgetPlan.perAgent sums ≈ pool; privileges.tiers all 'line' (bootstrap)

# 3. After the next heartbeat, confirm the prompt block renders (check a heartbeat run record's prompt or agent output referencing SEASON)
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=heartbeatRuns" -H "x-company-secret: pixelpusher"
```

Expected sanity: with `revenueLedger` currently empty, `budgetPlan` must be an even split (≈ registry caps scale) — if any agent's cap moved sharply on day one, the merit math is wrong; disable via `systemConfig.rewards.meritBudget.enabled=false` and investigate.

---

## Execution notes

- **Order matters:** Tasks 1→7 are strictly sequential (each builds on the previous). Task 8 depends on 7 (ledger fields must exist before hooks read them). Task 9 last.
- **The repo loop auto-commits AND pushes** — every commit deploys within minutes. Never leave the tree broken between steps; run the full test file before every commit.
- **Do not touch** `api/companyHeartbeat/index.js`, `api/company-state/index.js`, or any file on the CLAUDE.md do-not-touch list. This plan deliberately needs none of them.
- **Rollback:** every subsystem is independently killable at runtime without deploy: `systemConfig.rewards = { enabled: false }` (master), or `{ meritBudget: { enabled: false } }` / `{ privileges: { enabled: false } }`. systemConfig writes MERGE.
- **Deliberately deferred from spec §8** (call out in Task 9's skill update, do not silently drop): the per-tier IMAGE budget share. It needs its own gate in the content-package/generate-image path and ships as a fast-follow with the dashboard season UI (spec §10). Model tier, action slots, and proposal rights ARE in scope here.

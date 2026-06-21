# Dynamic Agentic Proposal Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let all strategic agents (nova, echo, scout, cipher, pixel, forge) propose campaigns/objectives grounded in the data they already see, routed through a fleet-capped best-first selector, with the deterministic cron kept as a safety net.

**Architecture:** Add the two action types to the allowlist so the existing handlers become reachable; authorize the 6 agents; have handlers compute a deterministic severity from a declared `trigger` enum and STAGE candidates onto `result.stagedProposals` instead of writing directly; after the agent loop, a new additive block in `index.js` selects the top-N per type and writes them to `approvalQueue`; the cron already defers via `_isDeduped` (locked in with a test). Prompt-builders advertises the action schema + per-agent trigger guidance.

**Tech Stack:** Node.js (Azure Functions). Tests are plain `node <file>.test.js` using `assert` + a custom `test()` runner (no framework). Spec: [docs/superpowers/specs/2026-06-20-dynamic-agentic-proposals-design.md](../specs/2026-06-20-dynamic-agentic-proposals-design.md).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `api/companyHeartbeat/constants.js` | action allowlist, authorization set, fleet cap, trigger→severity map | modify + export |
| `api/companyHeartbeat/agent-proposal-select.js` | **NEW** pure module: `proposalSeverity()` + `selectTopProposals()` | create |
| `api/companyHeartbeat/agent-proposal-select.test.js` | **NEW** unit tests for the pure module | create |
| `api/companyHeartbeat/agent-runner.js` | result init + handler authorization/severity/staging | modify |
| `api/companyHeartbeat/index.js` | collect staged proposals + post-loop select/write block (high blast radius) | modify |
| `api/companyHeartbeat/proposal-generator.test.js` | lock in cron cross-source deference | modify |
| `api/companyHeartbeat/prompt-builders.js` | `_buildProposalPromptBlock()` + inject per agent | modify |

**Trigger enum + severity** (single source of truth, Task 1):

| Trigger key | For | Type | Severity |
|---|---|---|---|
| `runway-critical` | cipher | objective | 95 |
| `budget-red` | cipher | objective | 75 |
| `runway-low` | cipher | objective | 70 |
| `agent-cost-red` | cipher | objective | 50 |
| `declining-platform` | echo | campaign | 80 |
| `research-demand` | scout | campaign | 70 |
| `recurring-incident` | forge | objective | 65 |
| `uncovered-product` | nova | campaign | 60 |
| `objective-near-complete` | nova | objective | 55 |
| `campaign-behind-pace` | echo | campaign | 55 |
| `low-campaign-count` | nova | campaign | 50 |
| `low-objective-count` | nova | objective | 50 |
| `design-gap` | pixel | campaign | 30 |
| (unknown / missing) | — | — | 10 + flag `no-data-trigger` |

---

## Task 1: Constants — allowlist, authorization, fleet cap, severity map

**Files:**
- Modify: `api/companyHeartbeat/constants.js:245-253` (KNOWN_ACTION_TYPES), `:451` (exports)

- [ ] **Step 1: Add the two action types to KNOWN_ACTION_TYPES**

In `constants.js`, change the array at line 245 to include the proposal types (add to the last line):

```javascript
const KNOWN_ACTION_TYPES = [
  'create-task', 'update-task', 'move-task', 'execute-task', 'review-task',
  'comment-task', 'create-social-action', 'revise-action', 'create-doc',
  'update-doc', 'submit-for-publish', 'create-content-package', 'generate-image',
  'create-reminder', 'web_search', 'remember',
  'request-budget', 'approve-budget-request',
  'propose-product', 'propose-pivot', 'propose-retire',
  'propose-hire-agent', 'propose-retire-agent', 'propose-role-evolution',
  'propose-campaign', 'propose-objective'
];
```

- [ ] **Step 2: Add authorization set, fleet cap, and trigger severity map**

Add immediately after the `KNOWN_ACTION_TYPES` array (after line 253):

```javascript
// ── Agentic proposal generation (System: dynamic agent proposals) ──
// The 6 strategic agents allowed to emit propose-campaign / propose-objective.
// Quill (editor) excluded. Domain emerges from the trigger guidance in prompts.
const PROPOSAL_AUTHORIZED_AGENTS = new Set(['nova', 'echo', 'scout', 'cipher', 'pixel', 'forge']);

// Max agent-sourced proposals that reach approvalQueue per cycle, per type (best-first).
const AGENT_PROPOSAL_FLEET_CAP = { campaign_proposal: 2, objective_proposal: 2 };

// Deterministic severity per declared trigger. Unknown/missing → UNKNOWN severity + flag.
const PROPOSAL_TRIGGER_SEVERITY = {
  'runway-critical': 95,
  'budget-red': 75,
  'runway-low': 70,
  'agent-cost-red': 50,
  'declining-platform': 80,
  'research-demand': 70,
  'recurring-incident': 65,
  'uncovered-product': 60,
  'objective-near-complete': 55,
  'campaign-behind-pace': 55,
  'low-campaign-count': 50,
  'low-objective-count': 50,
  'design-gap': 30
};
const PROPOSAL_UNKNOWN_TRIGGER_SEVERITY = 10;
```

- [ ] **Step 3: Export the new constants**

In the `module.exports = { ... }` block (around line 451, where `KNOWN_ACTION_TYPES` is exported), add:

```javascript
  KNOWN_ACTION_TYPES,
  PROPOSAL_AUTHORIZED_AGENTS,
  AGENT_PROPOSAL_FLEET_CAP,
  PROPOSAL_TRIGGER_SEVERITY,
  PROPOSAL_UNKNOWN_TRIGGER_SEVERITY,
```

(Keep the existing `KNOWN_ACTION_TYPES,` line — do not duplicate it; add only the new four.)

- [ ] **Step 4: Verify constants load**

Run: `node -e "const c=require('./api/companyHeartbeat/constants'); console.log(c.KNOWN_ACTION_TYPES.includes('propose-campaign'), c.KNOWN_ACTION_TYPES.includes('propose-objective'), c.PROPOSAL_AUTHORIZED_AGENTS.has('cipher'), c.AGENT_PROPOSAL_FLEET_CAP.campaign_proposal, c.PROPOSAL_TRIGGER_SEVERITY['runway-critical'])"`
Expected: `true true true 2 95`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/constants.js
git commit -m "feat: allowlist + authz + severity constants for agentic proposals"
```

---

## Task 2: Pure selector module (severity + best-first selection)

**Files:**
- Create: `api/companyHeartbeat/agent-proposal-select.js`
- Test: `api/companyHeartbeat/agent-proposal-select.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/companyHeartbeat/agent-proposal-select.test.js`:

```javascript
// Run with: node api/companyHeartbeat/agent-proposal-select.test.js
const assert = require('assert');
const { proposalSeverity, selectTopProposals } = require('./agent-proposal-select');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

test('proposalSeverity maps a known trigger', () => {
  assert.strictEqual(proposalSeverity('runway-critical'), 95);
});
test('proposalSeverity returns unknown severity for missing/garbage trigger', () => {
  assert.strictEqual(proposalSeverity(undefined), 10);
  assert.strictEqual(proposalSeverity('nope'), 10);
});

test('selectTopProposals keeps top-N per type by severity desc', () => {
  const staged = [
    { type: 'campaign_proposal', severity: 50, payload: { name: 'low' } },
    { type: 'campaign_proposal', severity: 80, payload: { name: 'high' } },
    { type: 'campaign_proposal', severity: 60, payload: { name: 'mid' } },
    { type: 'objective_proposal', severity: 70, payload: { title: 'o1' } }
  ];
  const out = selectTopProposals(staged, { campaign_proposal: 2, objective_proposal: 2 });
  assert.strictEqual(out.selected.length, 3); // 2 campaigns + 1 objective
  assert.strictEqual(out.deferred.length, 1); // the 50-severity campaign
  const campNames = out.selected.filter(p => p.type === 'campaign_proposal').map(p => p.payload.name);
  assert.deepStrictEqual(campNames, ['high', 'mid']);
  assert.strictEqual(out.deferred[0].payload.name, 'low');
});

test('selectTopProposals handles empty input', () => {
  const out = selectTopProposals([], { campaign_proposal: 2, objective_proposal: 2 });
  assert.deepStrictEqual(out.selected, []);
  assert.deepStrictEqual(out.deferred, []);
});

test('selectTopProposals defaults cap to 0 for unknown types (defers them)', () => {
  const out = selectTopProposals([{ type: 'weird', severity: 99 }], { campaign_proposal: 2, objective_proposal: 2 });
  assert.strictEqual(out.selected.length, 0);
  assert.strictEqual(out.deferred.length, 1);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyHeartbeat/agent-proposal-select.test.js`
Expected: FAIL — `Cannot find module './agent-proposal-select'`

- [ ] **Step 3: Write the module**

Create `api/companyHeartbeat/agent-proposal-select.js`:

```javascript
// Pure helpers for agentic proposal selection. No IO — unit-tested in isolation.
'use strict';

const {
  PROPOSAL_TRIGGER_SEVERITY,
  PROPOSAL_UNKNOWN_TRIGGER_SEVERITY
} = require('./constants');

// Map a declared trigger key to a deterministic severity. Unknown/missing → low.
function proposalSeverity(trigger) {
  if (trigger && Object.prototype.hasOwnProperty.call(PROPOSAL_TRIGGER_SEVERITY, trigger)) {
    return PROPOSAL_TRIGGER_SEVERITY[trigger];
  }
  return PROPOSAL_UNKNOWN_TRIGGER_SEVERITY;
}

// Given staged candidates [{type, severity, ...}] and per-type caps {type: n},
// return { selected, deferred }. Within each type, highest severity wins; ties keep
// input order (stable). Types with no cap entry default to 0 (everything deferred).
function selectTopProposals(staged, caps) {
  var list = Array.isArray(staged) ? staged.slice() : [];
  caps = caps || {};
  var byType = {};
  list.forEach(function (p, i) {
    if (!p || !p.type) return;
    (byType[p.type] = byType[p.type] || []).push({ p: p, i: i });
  });
  var selected = [], deferred = [];
  Object.keys(byType).forEach(function (type) {
    var cap = Number.isFinite(caps[type]) ? caps[type] : 0;
    var sorted = byType[type].sort(function (a, b) {
      var d = (b.p.severity || 0) - (a.p.severity || 0);
      return d !== 0 ? d : a.i - b.i; // stable on ties
    });
    sorted.forEach(function (entry, idx) {
      if (idx < cap) selected.push(entry.p);
      else deferred.push(entry.p);
    });
  });
  return { selected: selected, deferred: deferred };
}

module.exports = { proposalSeverity: proposalSeverity, selectTopProposals: selectTopProposals };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyHeartbeat/agent-proposal-select.test.js`
Expected: `5 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/agent-proposal-select.js api/companyHeartbeat/agent-proposal-select.test.js
git commit -m "feat: pure severity + best-first selector for agent proposals"
```

---

## Task 3: Handlers — authorize, score, and stage instead of write

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js:307-323` (result init), `:4952` (propose-campaign), `:5045` (propose-objective)

Background: the `else if (action.type === 'propose-campaign' && action.campaign)` block starts at line 4952 and currently ends by writing `_pcAQ.push(_pcEntry); await storage.setState('approvalQueue', _pcAQ)` at lines 5040-5041. The `propose-objective` block starts at 5045 and writes at 5114-5115. We keep all existing gates (capital, 1/day, dedup, north-star flag) and only (a) add an authorization check at the top and (b) replace the direct approvalQueue write with staging.

- [ ] **Step 1: Add `stagedProposals` to the result object**

In `agent-runner.js`, in the `const result = {` block (line 307), add the field after `proposals: [],` (line 313):

```javascript
    proposals: [],
    stagedProposals: [],
```

- [ ] **Step 2: Confirm the constants alias used in agent-runner**

Run: `grep -n "require('./constants')\|require(\"./constants\")" api/companyHeartbeat/agent-runner.js | head -3`
Expected: a line importing constants (commonly `const C = require('./constants');`). Note the alias (assume `C` below; if the file uses a different name or destructures, adapt the references in Steps 3-4 accordingly).

- [ ] **Step 3: propose-campaign — add authorization + stage (replace the write)**

In `agent-runner.js`, find the propose-campaign handler header at line 4952:

```javascript
    } else if (action.type === 'propose-campaign' && action.campaign) {
```

Immediately after that line, insert the authorization gate:

```javascript
      if (!C.PROPOSAL_AUTHORIZED_AGENTS.has(agentId)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — not an authorized proposer');
        continue;
      }
```

Then replace the write lines 5040-5043:

```javascript
      _pcAQ.push(_pcEntry);
      await storage.setState('approvalQueue', _pcAQ);
      context.log('[Heartbeat]', agentId, 'created campaign proposal:', _pcEntry.id, _pcName);
      result.taskUpdates.push({ action: 'campaign-proposed', proposalId: _pcEntry.id, agentId: agentId });
```

with staging (note: do NOT write to approvalQueue here anymore):

```javascript
      var _pcTrigger = (action.campaign.trigger || '').trim();
      var _pcSeverity = _proposalSeverity(_pcTrigger);
      if (_pcSeverity === C.PROPOSAL_UNKNOWN_TRIGGER_SEVERITY && !_pcEntry.strategyFlag) {
        _pcEntry.strategyFlag = 'no-data-trigger';
      }
      _pcEntry.trigger = _pcTrigger || null;
      result.stagedProposals.push({ type: 'campaign_proposal', severity: _pcSeverity, payload: _pcEntry });
      context.log('[Heartbeat]', agentId, 'staged campaign proposal:', _pcEntry.id, _pcName, 'sev', _pcSeverity);
      result.taskUpdates.push({ action: 'campaign-proposed', proposalId: _pcEntry.id, agentId: agentId });
```

- [ ] **Step 4: propose-objective — add authorization + stage (replace the write)**

Find the propose-objective handler header at line 5045:

```javascript
    } else if (action.type === 'propose-objective' && action.objective) {
```

Immediately after that line, insert:

```javascript
      if (!C.PROPOSAL_AUTHORIZED_AGENTS.has(agentId)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — not an authorized proposer');
        continue;
      }
```

Then replace the write lines 5114-5117:

```javascript
      _poAQ.push(_poEntry);
      await storage.setState('approvalQueue', _poAQ);
      context.log('[Heartbeat]', agentId, 'created objective proposal:', _poEntry.id, _poTitle);
      result.taskUpdates.push({ action: 'objective-proposed', proposalId: _poEntry.id, agentId: agentId });
```

with:

```javascript
      var _poTrigger = (action.objective.trigger || '').trim();
      var _poSeverity = _proposalSeverity(_poTrigger);
      if (_poSeverity === C.PROPOSAL_UNKNOWN_TRIGGER_SEVERITY && !_poEntry.strategyFlag) {
        _poEntry.strategyFlag = 'no-data-trigger';
      }
      _poEntry.trigger = _poTrigger || null;
      result.stagedProposals.push({ type: 'objective_proposal', severity: _poSeverity, payload: _poEntry });
      context.log('[Heartbeat]', agentId, 'staged objective proposal:', _poEntry.id, _poTitle, 'sev', _poSeverity);
      result.taskUpdates.push({ action: 'objective-proposed', proposalId: _poEntry.id, agentId: agentId });
```

- [ ] **Step 5: Import the severity helper at the top of agent-runner.js**

Find the require block near the top of `agent-runner.js` (where `./constants` is required). Add:

```javascript
const { proposalSeverity: _proposalSeverity } = require('./agent-proposal-select');
```

- [ ] **Step 6: Syntax-check the module loads**

Run: `node -e "require('./api/companyHeartbeat/agent-runner.js'); console.log('agent-runner loads OK')"`
Expected: `agent-runner loads OK` (no syntax/require error)

- [ ] **Step 7: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "feat: authorize + severity-stage agent campaign/objective proposals"
```

---

## Task 4: index.js — collect staged proposals + post-loop select/write

**Files:**
- Modify: `api/companyHeartbeat/index.js` (agent loop at ~2055; post-loop block near the auto-post block ~3050)

⚠️ **High blast radius file.** Changes are additive only. Do not touch the agent loop body, state loading, or concurrency.

- [ ] **Step 1: Import the selector + declare the cycle buffer before the agent loop**

Near the top of `index.js`, after the existing `require('./agent-runner')` line (line 26), add:

```javascript
const { selectTopProposals: _selectTopProposals } = require('./agent-proposal-select');
const { AGENT_PROPOSAL_FLEET_CAP: _AGENT_PROPOSAL_FLEET_CAP } = require('./constants');
```

Then, immediately before the sequential agent loop that contains line 2055 (`const result = _prefetchedResults[agentId] || await runAgentHeartbeat(...)`), declare the buffer. Locate the `for`/loop opening just above 2055 and add this line just before it:

```javascript
    const _stagedAgentProposals = [];
```

- [ ] **Step 2: Collect staged proposals inside the loop**

Immediately after the `const result = _prefetchedResults[agentId] || await runAgentHeartbeat(...)` assignment (line 2055), add:

```javascript
        if (result && Array.isArray(result.stagedProposals) && result.stagedProposals.length) {
          for (var _spi = 0; _spi < result.stagedProposals.length; _spi++) {
            _stagedAgentProposals.push(result.stagedProposals[_spi]);
          }
        }
```

- [ ] **Step 3: Add the post-loop select/write block**

Find the auto-post block that runs after the agent loop (search anchor: the comment near line 3050 referencing `_social_action_pending` and `reviewed_copy`). Immediately BEFORE that auto-post block, insert:

```javascript
    // ── Agentic proposal selection (best-first, fleet-capped) ──
    // Agents staged campaign/objective proposals during their runs; pick the top-N per
    // type by severity and write them to approvalQueue. Additive, CEO-approved, never
    // auto-executes. Failure is non-fatal — proposals are a nice-to-have.
    try {
      if (_stagedAgentProposals.length) {
        var _sel = _selectTopProposals(_stagedAgentProposals, _AGENT_PROPOSAL_FLEET_CAP);
        if (_sel.selected.length) {
          var _propQueue = (await storage.getState('approvalQueue')) || [];
          _sel.selected.forEach(function (s) { _propQueue.push(s.payload); });
          await storage.setState('approvalQueue', _propQueue);
          context.log('[Heartbeat] Agentic proposals written:', _sel.selected.length,
            'deferred:', _sel.deferred.length);
        }
        for (var _dfi = 0; _dfi < _sel.deferred.length; _dfi++) {
          var _df = _sel.deferred[_dfi];
          await logEvent('proposal-deferred', (_df.payload && _df.payload.proposedBy) || 'system',
            'Agent proposal deferred (over fleet cap): ' + ((_df.payload && (_df.payload.name || _df.payload.title)) || _df.type),
            cycleId, { gate: 'proposal_fleet_cap', type: _df.type, severity: _df.severity });
        }
      }
    } catch (_propErr) {
      context.log('[Heartbeat] Agentic proposal selection failed (non-fatal):', String(_propErr).substring(0, 200));
    }
```

Note: confirm the in-scope names `storage`, `context`, `cycleId`, and `logEvent` match what the surrounding auto-post block uses (it uses all four — copy the exact identifiers from that block if they differ).

- [ ] **Step 4: Syntax-check the module loads**

Run: `node -e "require('./api/companyHeartbeat/index.js'); console.log('index loads OK')"`
Expected: `index loads OK` (no syntax error). If it logs about a missing Azure binding that's fine — only a SyntaxError fails this step.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/index.js
git commit -m "feat: post-loop best-first selection of staged agent proposals"
```

---

## Task 5: Lock in cron cross-source deference

**Files:**
- Modify: `api/companyHeartbeat/proposal-generator.test.js`

The cron's `_isDeduped` already returns true when ANY pending proposal of a type exists (regardless of source), so a pending agent proposal already suppresses the cron for that type. This test documents and protects that behavior.

- [ ] **Step 1: Add the failing/locking test**

In `proposal-generator.test.js`, before the final `console.log('\n' + pass...)` line, add:

```javascript
// ── Cron defers to a pending AGENT-sourced proposal (not just its own) ──
test('campaign suppressed when a pending agent campaign_proposal exists', () => {
  const st = baseState({
    campaigns: [{ id: 'c1', status: 'active', product: 'Alpha' }], // would normally trigger (count < 3)
    approvalQueue: [{ type: 'campaign_proposal', status: 'pending', proposedBy: 'echo', source: 'agent', createdAt: daysAgo(0) }]
  });
  const r = computeProposals(st, NOW);
  assert.ok(!camp(r), 'cron should defer to the pending agent campaign proposal');
});

test('objective suppressed when a pending agent objective_proposal exists', () => {
  const st = baseState({
    objectives: [{ id: 'o1', status: 'active', progress: 50 }], // would normally trigger (count < 3)
    approvalQueue: [{ type: 'objective_proposal', status: 'pending', proposedBy: 'cipher', source: 'agent', createdAt: daysAgo(0) }]
  });
  const r = computeProposals(st, NOW);
  assert.ok(!obj(r), 'cron should defer to the pending agent objective proposal');
});
```

- [ ] **Step 2: Run the test**

Run: `node api/companyHeartbeat/proposal-generator.test.js`
Expected: `19 passed, 0 failed` (17 existing + 2 new). If either new test FAILS, the deference is not automatic — implement it in `proposal-generator.js` `computeProposals` by skipping the count-based campaign/objective trigger when `queue.some(q => q.type === <type> && q.status === 'pending')`, then re-run until green.

- [ ] **Step 3: Commit**

```bash
git add api/companyHeartbeat/proposal-generator.test.js
git commit -m "test: lock in cron deference to pending agent proposals"
```

---

## Task 6: Prompt-builders — advertise the action + per-agent triggers

**Files:**
- Modify: `api/companyHeartbeat/prompt-builders.js` (new helper near `_buildProductLifecyclePromptBlock` at line 83; inject in the template at line 1687)

Without this, opening the route is inert — the model won't emit an action it doesn't know exists.

- [ ] **Step 1: Add the prompt-block helper**

In `prompt-builders.js`, after the `_buildProductLifecyclePromptBlock` function (ends before line 245), add:

```javascript
// Per-agent trigger guidance for agentic campaign/objective proposals.
// Returns '' for agents not authorized to propose.
const _PROPOSAL_AGENT_GUIDE = {
  nova:   { kinds: 'campaign or objective', triggers: 'low-campaign-count (active campaigns < 3), low-objective-count (active objectives < 3), uncovered-product (a live product with no active campaign), objective-near-complete (an active objective >= 95%)' },
  cipher: { kinds: 'objective',             triggers: 'runway-critical (runway < 15d), runway-low (runway < 30d), budget-red (system budget RED), agent-cost-red (an agent RED on cost)' },
  scout:  { kinds: 'campaign',              triggers: 'research-demand (a research signal shows demand for a product that has no active campaign)' },
  echo:   { kinds: 'campaign',              triggers: 'declining-platform (a platform DECLINING week-over-week), campaign-behind-pace (a campaign >= 2 weeks behind target pace)' },
  forge:  { kinds: 'objective',             triggers: 'recurring-incident (3+ of the same ops_breakfix)' },
  pixel:  { kinds: 'campaign',              triggers: 'design-gap (a product with a design-asset gap AND real page traffic)' }
};

function _buildProposalPromptBlock(agent) {
  var g = agent && _PROPOSAL_AGENT_GUIDE[agent.id];
  if (!g) return '';
  return '\n\nPROPOSE NEW WORK (optional, only when warranted):\n' +
    'You may propose a ' + g.kinds + ' when ONE of these data triggers is true RIGHT NOW. ' +
    'Do not propose otherwise. Cite the specific number/signal in rationale.\n' +
    'Your valid triggers: ' + g.triggers + '.\n' +
    'Emit as an action. For a campaign:\n' +
    '{"type":"propose-campaign","campaign":{"name":"...","description":"...","rationale":"<cite the trigger + number>","trigger":"<one trigger key above>","product":"...","platforms":["social_bluesky"],"frequency":3,"cadence":"weekly","duration":"30 days","kpiTarget":"...","northStarMetric":"<an existing north-star metric or omit>"}}\n' +
    'For an objective:\n' +
    '{"type":"propose-objective","objective":{"title":"...","description":"...","rationale":"<cite the trigger + number>","trigger":"<one trigger key above>","successCriteria":"...","timeHorizon":"60 days","northStarMetric":"<existing metric or omit>"}}\n' +
    'Limits: at most 1 proposal per day; only the highest-severity few across the fleet reach the CEO. A missing/invalid trigger gets flagged for CEO scrutiny.';
}
```

- [ ] **Step 2: Build the section inside buildHeartbeatPrompt**

In `buildHeartbeatPrompt` (line 245), near where `productLifecycleSection` is built (line 1424), add:

```javascript
  const proposalSection = _buildProposalPromptBlock(agent);
```

- [ ] **Step 3: Inject the section into the prompt template**

In the template literal at line 1687, add `${proposalSection}` immediately after `${productLifecycleSection}`:

```javascript
...${allocationSection}${progressionSection}${productLifecycleSection}${proposalSection}${costSection}...
```

- [ ] **Step 4: Syntax-check + verify the block renders for an authorized agent**

Run: `node -e "const pb=require('./api/companyHeartbeat/prompt-builders.js'); console.log(typeof pb.buildHeartbeatPrompt)"`
Expected: `function` (loads without syntax error).

Run: `node -e "const m=require('./api/companyHeartbeat/prompt-builders.js'); /* internal helper not exported; assert no crash on require */ console.log('prompt-builders OK')"`
Expected: `prompt-builders OK`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/prompt-builders.js
git commit -m "feat: advertise propose-campaign/-objective + per-agent triggers in prompts"
```

---

## Task 7: End-to-end smoke + deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Run the full local test suite for changed modules**

Run:
```bash
node api/companyHeartbeat/agent-proposal-select.test.js && \
node api/companyHeartbeat/proposal-generator.test.js
```
Expected: both end with `... passed, 0 failed`.

- [ ] **Step 2: Push to deploy**

```bash
git push origin master
```
Expected: GitHub Actions deploy kicks off (CI/CD).

- [ ] **Step 3: Smoke on production (Sonnet recommended for the test)**

On the Heartbeat page, set the model to **Sonnet 4.6** (best structured emission), then trigger a cycle. Or via CLI:

```bash
curl -s -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-heartbeat-trigger" \
  -H "x-company-secret: pixelpusher" -H "Content-Type: application/json" >/dev/null
```

Then inspect the approval queue for an agent-sourced (non-`auto:proposal-generator`) proposal:

```bash
node -e "fetch('https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=approvalQueue',{headers:{'x-company-secret':'pixelpusher'}}).then(r=>r.json()).then(j=>{const aq=j.value||j;const p=aq.filter(x=>['campaign_proposal','objective_proposal'].includes(x.type)&&x.source!=='auto:proposal-generator');console.log('agent proposals:',p.length);p.forEach(x=>console.log(' ',x.type,'|',x.name||x.title,'| by',x.proposedBy,'| trigger',x.trigger,'| flag',x.strategyFlag));});"
```
Expected: 0 or more agent proposals. If a real trigger condition exists (e.g. objectives < 3) and the model is Sonnet, expect ≥1 with a cited `trigger`. Zero is acceptable if no trigger condition is currently true — confirm by checking the heartbeat logs for `staged campaign proposal` / `staged objective proposal` lines.

- [ ] **Step 4: Verify the safety net still works on a weak model**

Set the model to **Gemini Flash** or **Haiku**, trigger a cycle. Confirm the cron path still fills the floor (fire `POST /api/proposal-generator-trigger` if needed) and no errors appear in heartbeat logs.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** §1 allowlist → Task 1. §2 authz → Task 3. §3 triggers → Task 6 (guide) + Task 1 (severity). §4 staging+best-first → Tasks 2,3,4. §5 cron deference → Task 5. §6 prompt advertising → Task 6. §7 testing → Tasks 2,5,7. §8 blast radius → Task 4 warning.
- **`continue` keyword:** Steps in Task 3 use `continue`, which assumes the handler chain sits inside the `for` loop over actions — it does (the existing handlers already use `continue`). If your local code differs, match the surrounding control flow.
- **Constants alias:** Task 3 assumes agent-runner imports constants as `C`. Step 2 of Task 3 makes you verify this first — adapt if different.
- **`logEvent` signature:** Task 4 Step 3 assumes `logEvent(type, agentId, message, cycleId, details)` — the exact signature used by the nearby auto-post block (`logEvent('policy-violation', 'echo', ..., cycleId, {...})`). Confirm and match.

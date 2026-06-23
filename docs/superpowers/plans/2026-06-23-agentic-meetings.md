# Agentic Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the fleet originate quality-gated work via a server-side agentic meeting — agents propose an agenda, discuss, vote (majority + Nova tiebreak + budget pre-check), and route winners by blast radius (internal auto-creates, strategic → CEO approval queue). Triggered by a button now, optionally automated by a switch.

**Architecture:** One server-side reusable core (`api/companyMeeting/meeting-core.js`) exposing pure helpers + a `runAgenticMeeting()` orchestrator. Two thin callers: an HTTP trigger (the button) and a timer cron (the autonomy switch). Persists to a dedicated `agenticMeetings` blob key via `_utils/companyStorage` (bypasses `company-state` VALID_KEYS). Reuses `gemini.js` for model calls and writes to the existing `tasks` / `approvalQueue` stores. Zero edits to heartbeat `index.js` or `company-state/index.js`.

**Tech Stack:** Node.js (Azure Functions, CommonJS), `node-fetch`, existing `_utils/companyStorage`, `companyHeartbeat/gemini.js`. Tests are plain `node` scripts using `assert` (mirrors `proposal-generator.test.js`).

**Reference spec:** `docs/superpowers/specs/2026-06-23-agentic-meetings-design.md`

---

## File Structure

- Create: `api/companyMeeting/meeting-core.js` — constants + pure helpers (`classifyBlastRadius`, `tallyVote`, `budgetEligible`, `parseItemsFromReply`, `extractCandidates`) + `runAgenticMeeting()` orchestrator.
- Create: `api/companyMeeting/meeting-core.test.js` — node `assert` tests for all pure helpers + a mocked orchestrator run.
- Create: `api/companyMeeting/prompts.js` — pure prompt builders (`buildAgendaPrompt`, `buildDiscussionPrompt`, `buildVotePrompt`) kept out of the core for clarity.
- Create: `api/agentic-meeting-trigger/index.js` + `function.json` — `POST /api/agentic-meeting-trigger` (the button).
- Create: `api/agenticMeetingCron/index.js` + `function.json` — weekly timer; runs the core when `systemConfig.agenticMeetings.enabled`.
- Create: `api/meetingsRead/index.js` + `function.json` — `GET /api/meetingsRead` returns the `agenticMeetings` list for the dashboard.
- Modify: `modules/company/meetings.html` — add "Run Agentic Meeting" button, an autonomy toggle, and a render block for agentic meeting records. (If the file does not exist, create it following the standard company-module layout used by `modules/company/goals.html`.)

**Persistence key:** `agenticMeetings` (array, FIFO cap 50), written via `storage.setState('agenticMeetings', ...)`. Never added to `company-state` VALID_KEYS — read only through `/api/meetingsRead`.

**Model interface (verify before Task 6):** `const { callGemini } = require('../companyHeartbeat/gemini');` — `await callGemini(promptString, agentId)` returns a string (model reply) or `null` on failure. It already respects `systemConfig.heartbeatModel`.

---

## Task 1: Scaffold meeting-core + blast-radius classifier

**Files:**
- Create: `api/companyMeeting/meeting-core.js`
- Test: `api/companyMeeting/meeting-core.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/companyMeeting/meeting-core.test.js`:

```js
// Run with: node api/companyMeeting/meeting-core.test.js
const assert = require('assert');
const core = require('./meeting-core');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// ── classifyBlastRadius ──
test('campaign/objective/product are strategic', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'campaign' }), 'strategic');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'objective' }), 'strategic');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'product_launch' }), 'strategic');
});
test('research_task and internal_doc are internal', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'research_task' }), 'internal');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'internal_doc' }), 'internal');
});
test('execution_task is internal ONLY with a target objective', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'execution_task', targetObjectiveId: 'obj-1' }), 'internal');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'execution_task' }), 'strategic');
});
test('unknown kind defaults to strategic (fail safe to human review)', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'wat' }), 'strategic');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — `Cannot find module './meeting-core'`.

- [ ] **Step 3: Write minimal implementation**

Create `api/companyMeeting/meeting-core.js`:

```js
'use strict';

// The 6 strategic agents who attend, discuss, and vote.
const MEETING_ATTENDEES = ['nova', 'echo', 'scout', 'cipher', 'pixel', 'forge'];

// Static kind → blast-radius map. Unknown kinds fall through to 'strategic'.
const BLAST_RADIUS_MAP = {
  research_task: 'internal',
  internal_doc: 'internal',
  campaign: 'strategic',
  objective: 'strategic',
  product_launch: 'strategic',
  product_pivot: 'strategic',
  product_retire: 'strategic',
  social: 'strategic'
};

// execution_task is internal only when it attaches to an existing objective;
// a free-floating execution task is treated as strategic (route to CEO).
function classifyBlastRadius(candidate) {
  const kind = candidate && candidate.kind;
  if (kind === 'execution_task') return candidate.targetObjectiveId ? 'internal' : 'strategic';
  return BLAST_RADIUS_MAP[kind] || 'strategic';
}

module.exports = { MEETING_ATTENDEES, BLAST_RADIUS_MAP, classifyBlastRadius };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS (4 passed, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): blast-radius classifier + core scaffold"
```

---

## Task 2: Vote tally (majority + Nova tiebreak)

**Files:**
- Modify: `api/companyMeeting/meeting-core.js`
- Test: `api/companyMeeting/meeting-core.test.js`

- [ ] **Step 1: Add failing tests**

Append before the final `console.log` in `meeting-core.test.js`:

```js
// ── tallyVote ──
const V = (agentId, vote) => ({ agentId, vote });
test('majority approve passes', () => {
  const r = core.tallyVote([V('nova','approve'), V('echo','approve'), V('cipher','reject')]);
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.approve, 2); assert.strictEqual(r.reject, 1);
});
test('majority reject fails', () => {
  const r = core.tallyVote([V('nova','reject'), V('echo','reject'), V('cipher','approve')]);
  assert.strictEqual(r.passed, false);
});
test('abstains are excluded from the base', () => {
  const r = core.tallyVote([V('nova','approve'), V('echo','abstain'), V('cipher','abstain')]);
  assert.strictEqual(r.abstain, 2);
  assert.strictEqual(r.passed, true); // 1 approve > 0 reject
});
test('tie + Nova approve passes via tiebreak', () => {
  const r = core.tallyVote([V('nova','approve'), V('echo','reject')]);
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.tiebreak, true);
});
test('tie + Nova reject fails via tiebreak', () => {
  const r = core.tallyVote([V('nova','reject'), V('echo','approve')]);
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.tiebreak, true);
});
test('tie + Nova abstain fails (conservative default)', () => {
  const r = core.tallyVote([V('nova','abstain'), V('echo','approve'), V('cipher','reject')]);
  assert.strictEqual(r.passed, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — `core.tallyVote is not a function`.

- [ ] **Step 3: Implement `tallyVote`**

Add to `meeting-core.js` (before `module.exports`):

```js
// Simple majority of cast (non-abstain) votes. Exact tie → Nova decides; if Nova
// did not approve (rejected, abstained, or absent) the item fails (conservative).
function tallyVote(votes) {
  let approve = 0, reject = 0, abstain = 0;
  (votes || []).forEach(function (v) {
    if (v.vote === 'approve') approve++;
    else if (v.vote === 'reject') reject++;
    else abstain++;
  });
  let passed, tiebreak = false;
  if (approve > reject) passed = true;
  else if (reject > approve) passed = false;
  else {
    tiebreak = true;
    const nova = (votes || []).find(function (v) { return v.agentId === 'nova'; });
    passed = !!(nova && nova.vote === 'approve');
  }
  return { approve: approve, reject: reject, abstain: abstain, passed: passed, tiebreak: tiebreak };
}
```

Update `module.exports` to add `tallyVote`:

```js
module.exports = { MEETING_ATTENDEES, BLAST_RADIUS_MAP, classifyBlastRadius, tallyVote };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS (10 passed, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): vote tally with Nova tiebreak"
```

---

## Task 3: Budget pre-check (reuses Capital Allocation)

**Files:**
- Modify: `api/companyMeeting/meeting-core.js`
- Test: `api/companyMeeting/meeting-core.test.js`

- [ ] **Step 1: Add failing tests**

Append before the final `console.log`:

```js
// ── budgetEligible ──
const ALLOC = (over) => ({ systemBudget: 15, systemSpent: over ? 14.9 : 5, systemStatus: over ? 'RED' : 'GREEN' });
test('no cost → always eligible', () => {
  assert.strictEqual(core.budgetEligible({ kind: 'research_task' }, ALLOC(false)).eligible, true);
});
test('cost within remaining → eligible', () => {
  assert.strictEqual(core.budgetEligible({ estimatedCost: 2 }, ALLOC(false)).eligible, true);
});
test('system RED → ineligible', () => {
  const r = core.budgetEligible({ estimatedCost: 0.05 }, ALLOC(true));
  assert.strictEqual(r.eligible, false);
  assert.ok(/RED/.test(r.reason));
});
test('cost exceeds remaining → ineligible', () => {
  const r = core.budgetEligible({ estimatedCost: 99 }, { systemBudget: 15, systemSpent: 5, systemStatus: 'GREEN' });
  assert.strictEqual(r.eligible, false);
});
test('missing allocation → fail-open (eligible)', () => {
  assert.strictEqual(core.budgetEligible({ estimatedCost: 5 }, null).eligible, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — `core.budgetEligible is not a function`.

- [ ] **Step 3: Implement `budgetEligible`**

Add to `meeting-core.js` before `module.exports`:

```js
// Deterministic budget gate. Fail-OPEN on missing/unreadable allocation state so a
// transient read error never silently blocks the whole meeting.
function budgetEligible(candidate, allocation) {
  const cost = Number(candidate && candidate.estimatedCost);
  if (!Number.isFinite(cost) || cost <= 0) return { eligible: true, reason: null };
  if (!allocation || typeof allocation !== 'object') return { eligible: true, reason: null };
  if (allocation.systemStatus === 'RED') return { eligible: false, reason: 'system budget RED' };
  const remaining = (Number(allocation.systemBudget) || 0) - (Number(allocation.systemSpent) || 0);
  if (cost > remaining) {
    return { eligible: false, reason: 'cost ' + cost + ' exceeds remaining ' + remaining.toFixed(2) };
  }
  return { eligible: true, reason: null };
}
```

Update `module.exports` to add `budgetEligible`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS (15 passed, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): budget pre-check via Capital Allocation"
```

---

## Task 4: Parse + dedupe candidate items from model replies

**Files:**
- Modify: `api/companyMeeting/meeting-core.js`
- Test: `api/companyMeeting/meeting-core.test.js`

- [ ] **Step 1: Add failing tests**

Append before the final `console.log`:

```js
// ── parseItemsFromReply ──
test('parses a fenced JSON items array from reply text', () => {
  const reply = 'I propose two things.\n```json\n{"items":[{"kind":"campaign","title":"Beacon launch"}]}\n```\nThanks.';
  const items = core.parseItemsFromReply(reply, 'echo');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].kind, 'campaign');
  assert.strictEqual(items[0].proposedBy, 'echo');
});
test('returns [] when no JSON present', () => {
  assert.deepStrictEqual(core.parseItemsFromReply('just talking, no proposal', 'nova'), []);
});
test('caps items per agent at 2', () => {
  const reply = '{"items":[{"kind":"campaign","title":"a"},{"kind":"campaign","title":"b"},{"kind":"campaign","title":"c"}]}';
  assert.strictEqual(core.parseItemsFromReply(reply, 'echo').length, 2);
});

// ── extractCandidates (dedupe across turns) ──
test('extractCandidates dedupes by normalized title+kind', () => {
  const turns = [
    { agentId: 'echo', items: [{ kind: 'campaign', title: 'Beacon Launch', proposedBy: 'echo' }] },
    { agentId: 'nova', items: [{ kind: 'campaign', title: 'beacon launch', proposedBy: 'nova' }] }
  ];
  const out = core.extractCandidates(turns);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].id); // assigned a stable id
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — `core.parseItemsFromReply is not a function`.

- [ ] **Step 3: Implement parsing + dedupe**

Add to `meeting-core.js` before `module.exports`:

```js
const MAX_ITEMS_PER_AGENT = 2;
const VALID_KINDS = ['research_task', 'internal_doc', 'execution_task', 'campaign', 'objective', 'product_launch', 'product_pivot', 'product_retire', 'social'];

function _norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

// Pull the first JSON object containing an `items` array out of a model reply.
// Tolerates ```json fences and surrounding prose. Returns [] on anything unparseable.
function parseItemsFromReply(reply, agentId) {
  if (!reply || typeof reply !== 'string') return [];
  let obj = null;
  // Try fenced block first, then the first {...} that parses.
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const brace = reply.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);
  for (const c of candidates) {
    try { const parsed = JSON.parse(c); if (parsed && Array.isArray(parsed.items)) { obj = parsed; break; } } catch (_e) { /* keep trying */ }
  }
  if (!obj) return [];
  return obj.items
    .filter(function (it) { return it && VALID_KINDS.indexOf(it.kind) !== -1 && _norm(it.title).length > 0; })
    .slice(0, MAX_ITEMS_PER_AGENT)
    .map(function (it) {
      return {
        kind: it.kind,
        title: String(it.title).slice(0, 140),
        description: String(it.description || '').slice(0, 1000),
        rationale: String(it.rationale || '').slice(0, 500),
        estimatedCost: Number.isFinite(Number(it.estimatedCost)) ? Number(it.estimatedCost) : null,
        targetObjectiveId: it.targetObjectiveId || null,
        proposedBy: agentId
      };
    });
}

// Flatten all turns' items into a deduped candidate slate (by normalized title+kind),
// assigning each a stable id. First proposer wins on a duplicate.
function extractCandidates(turns) {
  const seen = new Set();
  const out = [];
  (turns || []).forEach(function (turn) {
    (turn.items || []).forEach(function (it) {
      const key = it.kind + '::' + _norm(it.title);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(Object.assign({ id: 'cand-' + (out.length + 1) + '-' + key.replace(/[^a-z0-9]+/gi, '').slice(0, 12) }, it));
    });
  });
  return out;
}

function _normalizeTitle(s) { return _norm(s); } // exported alias for reuse/testing
```

Update `module.exports` to add `parseItemsFromReply`, `extractCandidates`, `MAX_ITEMS_PER_AGENT`, `VALID_KINDS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS (19 passed, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): parse + dedupe candidate items from replies"
```

---

## Task 5: Prompt builders

**Files:**
- Create: `api/companyMeeting/prompts.js`
- Test: `api/companyMeeting/meeting-core.test.js` (smoke assertions)

- [ ] **Step 1: Add failing smoke tests**

Append before the final `console.log` in `meeting-core.test.js`:

```js
// ── prompts ──
const prompts = require('./prompts');
test('agenda prompt names the agent and asks for JSON topics', () => {
  const p = prompts.buildAgendaPrompt('nova', { activeObjectives: [], activeCampaigns: [], recentlyFinished: [], decliningProducts: [], researchSignals: [] });
  assert.ok(/nova/i.test(p));
  assert.ok(/agenda/i.test(p));
  assert.ok(/json/i.test(p));
});
test('discussion prompt includes the agenda + the items JSON contract', () => {
  const p = prompts.buildDiscussionPrompt('echo', [{ topic: 'Grow X' }], 'prior transcript here');
  assert.ok(/Grow X/.test(p));
  assert.ok(/"items"/.test(p));
});
test('vote prompt lists the candidates and the approve/reject/abstain contract', () => {
  const p = prompts.buildVotePrompt('cipher', [{ id: 'cand-1', kind: 'campaign', title: 'Beacon' }]);
  assert.ok(/Beacon/.test(p));
  assert.ok(/approve/i.test(p) && /reject/i.test(p) && /abstain/i.test(p));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — `Cannot find module './prompts'`.

- [ ] **Step 3: Implement `prompts.js`**

Create `api/companyMeeting/prompts.js`:

```js
'use strict';

// Compact JSON snapshot of the relevant state for the agenda step.
function _stateSummary(state) {
  const s = state || {};
  return JSON.stringify({
    activeObjectives: (s.activeObjectives || []).map(function (o) { return { id: o.id, title: o.title, progress: o.progress }; }),
    activeCampaigns: (s.activeCampaigns || []).map(function (c) { return { id: c.id, title: c.title || c.name }; }),
    recentlyFinished: s.recentlyFinished || [],
    decliningProducts: s.decliningProducts || [],
    researchSignals: s.researchSignals || []
  });
}

function buildAgendaPrompt(agentId, state) {
  return 'You are ' + agentId + ', Prime Operator opening an AmbientOS strategy meeting.\n' +
    'Current company state (JSON):\n' + _stateSummary(state) + '\n\n' +
    'Decide whether there is anything worth convening the fleet on right now — a coverage gap, ' +
    'a finished initiative needing a successor, a declining product, or a real opportunity.\n' +
    'Reply with ONLY a fenced json block:\n' +
    '```json\n{"convene": true, "agenda": [{"topic": "...", "rationale": "..."}]}\n```\n' +
    'Use at most 3 agenda topics. If nothing is worth a meeting, return {"convene": false, "agenda": []}.';
}

function buildDiscussionPrompt(agentId, agenda, transcript) {
  return 'You are ' + agentId + ' in an AmbientOS strategy meeting.\n' +
    'AGENDA: ' + JSON.stringify(agenda) + '\n\n' +
    (transcript ? ('Discussion so far:\n' + transcript + '\n\n') : '') +
    'Speak briefly on the agenda, then propose 0-2 concrete work items you believe the fleet should take on.\n' +
    'End your reply with a fenced json block of proposals (omit the block if you propose nothing):\n' +
    '```json\n{"items":[{"kind":"campaign|objective|research_task|internal_doc|execution_task|product_launch|product_pivot|product_retire|social",' +
    '"title":"...","description":"...","rationale":"<cite a number or signal>","estimatedCost":0,"targetObjectiveId":"<id if execution_task under an existing objective, else omit>"}]}\n```';
}

function buildVotePrompt(agentId, candidates) {
  const slate = (candidates || []).map(function (c) { return { id: c.id, kind: c.kind, title: c.title, rationale: c.rationale }; });
  return 'You are ' + agentId + ' voting on the proposed work from this AmbientOS meeting.\n' +
    'CANDIDATES (JSON): ' + JSON.stringify(slate) + '\n\n' +
    'For EACH candidate, vote approve, reject, or abstain, with a one-line rationale. Be a quality gate — ' +
    'reject vague, duplicate, off-strategy, or low-leverage items.\n' +
    'Reply with ONLY a fenced json block:\n' +
    '```json\n{"votes":[{"id":"cand-1","vote":"approve|reject|abstain","rationale":"..."}]}\n```';
}

module.exports = { buildAgendaPrompt, buildDiscussionPrompt, buildVotePrompt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS (22 passed, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/prompts.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): agenda/discussion/vote prompt builders"
```

---

## Task 6: `runAgenticMeeting` orchestrator (mocked model)

**Files:**
- Modify: `api/companyMeeting/meeting-core.js`
- Test: `api/companyMeeting/meeting-core.test.js`

The orchestrator is injected with `callModel` (defaulting to `gemini.callGemini`) and `storage` so it is fully testable with stubs.

- [ ] **Step 1: Add failing end-to-end test**

First, make the runner async-aware. At the TOP of `meeting-core.test.js` (right after `let pass = 0, fail = 0;`), add an async test queue:

```js
const _asyncTests = [];
function testA(name, fn) { _asyncTests.push({ name: name, fn: fn }); }
```

Then REPLACE the file's final block (`console.log('\n' + pass ...)` and `process.exit(...)`) with a runner that drains the async queue after the sync tests:

```js
(async () => {
  for (const t of _asyncTests) {
    try { await t.fn(); pass++; console.log('  PASS ', t.name); }
    catch (e) { fail++; console.log('  FAIL ', t.name, '\n        ', e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();
```

Now append the end-to-end test (note: registered with `testA`, not `test`):

```js
// ── runAgenticMeeting (mocked model + in-memory storage) ──
const NOW = Date.UTC(2026, 5, 23, 12, 0, 0);
function mockStorage(initial) {
  const s = Object.assign({ tasks: [], approvalQueue: [], agenticMeetings: [], capitalAllocation: { systemBudget: 15, systemSpent: 5, systemStatus: 'GREEN' } }, initial || {});
  return { getState: async (k) => s[k], setState: async (k, v) => { s[k] = v; }, _state: s };
}
// Scripted model: agenda convenes; echo proposes a campaign (strategic) + a research task (internal);
// everyone approves; nova closes.
function mockModel(prompt, agentId) {
  if (/Prime Operator opening/.test(prompt)) return Promise.resolve('```json\n{"convene":true,"agenda":[{"topic":"Grow Bluesky","rationale":"flat 30d"}]}\n```');
  if (/Speak briefly on the agenda/.test(prompt)) {
    if (agentId === 'echo') return Promise.resolve('We should push Bluesky.\n```json\n{"items":[{"kind":"campaign","title":"Bluesky Growth Push","rationale":"flat followers","estimatedCost":2},{"kind":"research_task","title":"Bluesky competitor scan","rationale":"need angles","estimatedCost":0}]}\n```');
    return Promise.resolve('Agreed, no new items from me.');
  }
  if (/voting on the proposed work/.test(prompt)) {
    return Promise.resolve('```json\n{"votes":[{"id":"' + (prompt.match(/"id":"(cand-[^"]+)"/) || [])[1] + '","vote":"approve","rationale":"good"}]}\n```');
  }
  return Promise.resolve('(ok)');
}

testA('runAgenticMeeting routes internal→tasks and strategic→approvalQueue', async () => {
  const storage = mockStorage();
  const rec = await core.runAgenticMeeting({ storage, nowMs: NOW, trigger: 'button', callModel: mockModel, log: function () {} });
  assert.strictEqual(rec.convened, true);
  // Bluesky Growth Push (campaign=strategic) → approvalQueue; competitor scan (research=internal) → tasks
  assert.strictEqual(storage._state.approvalQueue.filter(function (q) { return q.source === 'meeting'; }).length, 1);
  assert.strictEqual(storage._state.tasks.filter(function (t) { return t.source === 'meeting'; }).length, 1);
  assert.strictEqual(storage._state.agenticMeetings.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — `core.runAgenticMeeting is not a function`.

- [ ] **Step 3: Implement `runAgenticMeeting`**

Add to `meeting-core.js` before `module.exports` (require prompts at top of file: `const prompts = require('./prompts');`):

```js
const MEETINGS_CAP = 50;

function _routeInternalTask(candidate, meetingId, nowIso) {
  const assignee = candidate.kind === 'research_task' ? 'scout' : (candidate.proposedBy || 'nova');
  return {
    id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: candidate.title,
    description: candidate.description || candidate.rationale || '',
    taskType: candidate.kind === 'research_task' ? 'research' : (candidate.kind === 'internal_doc' ? 'internal_doc' : 'general'),
    status: 'todo',
    priority: 'medium',
    assignee: assignee,
    objective_id: candidate.targetObjectiveId || null,
    createdAt: nowIso,
    updatedAt: nowIso,
    source: 'meeting',
    created_by: candidate.proposedBy || 'nova',
    meetingId: meetingId
  };
}

function _routeStrategicProposal(candidate, meeting, nowIso) {
  const typeByKind = {
    campaign: 'campaign_proposal', objective: 'objective_proposal',
    product_launch: 'product_proposal', product_pivot: 'product_pivot_proposal',
    product_retire: 'product_retire_proposal', social: 'social_proposal', execution_task: 'task_proposal'
  };
  return {
    id: 'mprop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    type: typeByKind[candidate.kind] || 'campaign_proposal',
    status: 'pending',
    proposedBy: candidate.proposedBy || 'nova',
    source: 'meeting',
    meetingId: meeting.id,
    title: candidate.title,
    name: candidate.title,
    description: candidate.description || '',
    rationale: candidate.rationale || '',
    voteTally: { approve: candidate.approveCount, reject: candidate.rejectCount, abstain: candidate.abstainCount },
    estimatedCost: candidate.estimatedCost,
    createdAt: nowIso
  };
}

// Orchestrate one agentic meeting. `callModel(prompt, agentId)` and `storage` are
// injected for testability; in production the trigger/cron pass the real ones.
async function runAgenticMeeting(opts) {
  opts = opts || {};
  const storage = opts.storage;
  const nowMs = opts.nowMs || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const log = opts.log || function () {};
  const trigger = opts.trigger || 'button';
  const callModel = opts.callModel || require('../companyHeartbeat/gemini').callGemini;

  // 1. Gather state for the agenda
  const [objectives, campaigns, allocation] = await Promise.all([
    storage.getState('objectives').then(function (v) { return v || []; }),
    storage.getState('campaigns').then(function (v) { return v || []; }),
    storage.getState('capitalAllocation').then(function (v) { return v || null; })
  ]);
  const state = {
    activeObjectives: objectives.filter(function (o) { return o.status === 'active'; }),
    activeCampaigns: campaigns.filter(function (c) { return c.status === 'active'; }),
    recentlyFinished: objectives.filter(function (o) { return o.status === 'complete' || o.status === 'archived'; }).slice(-5).map(function (o) { return o.title; }),
    decliningProducts: [], researchSignals: []
  };

  // 2. Agenda proposal (Nova)
  const agendaReply = await callModel(prompts.buildAgendaPrompt('nova', state), 'nova');
  let agendaObj = null;
  try { const m = (agendaReply || '').match(/\{[\s\S]*\}/); agendaObj = m ? JSON.parse(m[0]) : null; } catch (_e) { agendaObj = null; }
  if (!agendaObj || agendaObj.convene === false || !Array.isArray(agendaObj.agenda) || agendaObj.agenda.length === 0) {
    const skipRec = { id: 'amtg-' + nowMs, trigger: trigger, convened: false, reason: 'no agenda', createdAt: nowIso };
    await _persistMeeting(storage, skipRec);
    log('[agenticMeeting] No agenda — not convened');
    return skipRec;
  }
  const agenda = agendaObj.agenda.slice(0, 3);

  // 3. Discussion (each attendee once, sees prior transcript)
  const transcriptParts = [];
  const turns = [];
  for (const agentId of MEETING_ATTENDEES) {
    const reply = await callModel(prompts.buildDiscussionPrompt(agentId, agenda, transcriptParts.join('\n\n')), agentId);
    const items = parseItemsFromReply(reply || '', agentId);
    turns.push({ agentId: agentId, text: reply || '(no response)', items: items });
    transcriptParts.push(agentId + ': ' + (reply || '(no response)'));
  }

  // 4. Candidate slate + budget pre-check
  const candidates = extractCandidates(turns);
  candidates.forEach(function (c) {
    const be = budgetEligible(c, allocation);
    c.eligible = be.eligible; c.ineligibleReason = be.reason;
    c.blastRadius = classifyBlastRadius(c);
  });

  // 5. Vote (each attendee votes on eligible candidates)
  const eligible = candidates.filter(function (c) { return c.eligible; });
  candidates.forEach(function (c) { c.votes = []; });
  if (eligible.length > 0) {
    for (const agentId of MEETING_ATTENDEES) {
      const reply = await callModel(prompts.buildVotePrompt(agentId, eligible), agentId);
      let voteObj = null;
      try { const m = (reply || '').match(/\{[\s\S]*\}/); voteObj = m ? JSON.parse(m[0]) : null; } catch (_e) { voteObj = null; }
      const votes = (voteObj && Array.isArray(voteObj.votes)) ? voteObj.votes : [];
      votes.forEach(function (v) {
        const cand = eligible.find(function (c) { return c.id === v.id; });
        if (cand && ['approve', 'reject', 'abstain'].indexOf(v.vote) !== -1) {
          cand.votes.push({ agentId: agentId, vote: v.vote, rationale: String(v.rationale || '').slice(0, 200) });
        }
      });
    }
  }
  candidates.forEach(function (c) {
    const t = tallyVote(c.votes);
    c.approveCount = t.approve; c.rejectCount = t.reject; c.abstainCount = t.abstain;
    c.tiebreak = t.tiebreak; c.passed = !!c.eligible && t.passed;
  });

  // 6. Route by blast radius
  const internalCreated = [], proposalsQueued = [];
  const passed = candidates.filter(function (c) { return c.passed; });
  if (passed.some(function (c) { return c.blastRadius === 'internal'; })) {
    const tasks = (await storage.getState('tasks')) || [];
    passed.filter(function (c) { return c.blastRadius === 'internal'; }).forEach(function (c) {
      const t = _routeInternalTask(c, 'amtg-' + nowMs, nowIso); tasks.push(t); internalCreated.push(t.id);
    });
    await storage.setState('tasks', tasks);
  }
  if (passed.some(function (c) { return c.blastRadius === 'strategic'; })) {
    const aq = (await storage.getState('approvalQueue')) || [];
    const meetingStub = { id: 'amtg-' + nowMs };
    passed.filter(function (c) { return c.blastRadius === 'strategic'; }).forEach(function (c) {
      const p = _routeStrategicProposal(c, meetingStub, nowIso); aq.push(p); proposalsQueued.push(p.id);
    });
    await storage.setState('approvalQueue', aq);
  }

  // 7. Persist record
  const record = {
    id: 'amtg-' + nowMs, trigger: trigger, convened: true, agenda: agenda,
    attendees: MEETING_ATTENDEES, transcript: turns.map(function (t) { return { agentId: t.agentId, text: t.text }; }),
    candidates: candidates, routed: { internalCreated: internalCreated, proposalsQueued: proposalsQueued },
    createdAt: nowIso, durationMs: Date.now() - nowMs
  };
  await _persistMeeting(storage, record);
  log('[agenticMeeting] convened — candidates ' + candidates.length + ', passed ' + passed.length + ', internal ' + internalCreated.length + ', queued ' + proposalsQueued.length);
  return record;
}

async function _persistMeeting(storage, record) {
  const list = (await storage.getState('agenticMeetings')) || [];
  list.push(record);
  if (list.length > MEETINGS_CAP) list.splice(0, list.length - MEETINGS_CAP);
  await storage.setState('agenticMeetings', list);
}
```

Update `module.exports` to add `runAgenticMeeting`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS (23 passed, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): runAgenticMeeting orchestrator + blast-radius routing"
```

---

## Task 7: Button endpoint — `agentic-meeting-trigger`

**Files:**
- Create: `api/agentic-meeting-trigger/index.js`
- Create: `api/agentic-meeting-trigger/function.json`

- [ ] **Step 1: Create `function.json`**

```json
{
  "bindings": [
    { "authLevel": "anonymous", "type": "httpTrigger", "direction": "in", "name": "req", "methods": ["post", "options"], "route": "agentic-meeting-trigger" },
    { "type": "http", "direction": "out", "name": "res" }
  ]
}
```

- [ ] **Step 2: Create `index.js`**

```js
// agentic-meeting-trigger — POST /api/agentic-meeting-trigger (the button).
// Runs one agentic meeting on demand and returns the record for the UI.
const storage = require('../_utils/companyStorage');
const { runAgenticMeeting } = require('../companyMeeting/meeting-core');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) { context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid write secret' } }; return; }
  try {
    const record = await runAgenticMeeting({ storage: storage, nowMs: Date.now(), trigger: 'button', log: function () { context.log.apply(context, arguments); } });
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', meeting: record } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 300) } };
  }
};
```

- [ ] **Step 3: Verify it loads**

Run: `node -e "require('./api/agentic-meeting-trigger'); console.log('ok')"`
Expected: prints `ok` (no throw).

- [ ] **Step 4: Commit**

```bash
git add api/agentic-meeting-trigger
git commit -m "feat(meetings): button trigger endpoint"
```

---

## Task 8: Signal detection + autonomy cron (weekly + signal)

**Files:**
- Modify: `api/companyMeeting/meeting-core.js`
- Test: `api/companyMeeting/meeting-core.test.js`
- Create: `api/agenticMeetingCron/index.js`
- Create: `api/agenticMeetingCron/function.json`

- [ ] **Step 1: Add failing tests for `detectMeetingSignals`**

Append before the async runner block in `meeting-core.test.js`:

```js
// ── detectMeetingSignals ──
test('coverage-gap fires when <3 active objectives', () => {
  const s = core.detectMeetingSignals({ activeObjectiveCount: 1, finishedRecently: false, researchSignalCount: 0 }, NOW2, []);
  assert.ok(s.some(function (x) { return x.type === 'coverage-gap'; }));
});
test('research-opportunity fires when unactioned research signals exist', () => {
  const s = core.detectMeetingSignals({ activeObjectiveCount: 5, finishedRecently: false, researchSignalCount: 2 }, NOW2, []);
  assert.ok(s.some(function (x) { return x.type === 'research-opportunity'; }));
});
test('no signals on a healthy, covered state', () => {
  const s = core.detectMeetingSignals({ activeObjectiveCount: 4, finishedRecently: false, researchSignalCount: 0 }, NOW2, []);
  assert.strictEqual(s.length, 0);
});
test('a signal is deduped if a same-type meeting convened in the last 7 days', () => {
  const recent = [{ convened: true, trigger: 'signal:coverage-gap', createdAt: new Date(NOW2 - 2 * 86400000).toISOString() }];
  const s = core.detectMeetingSignals({ activeObjectiveCount: 1, finishedRecently: false, researchSignalCount: 0 }, NOW2, recent);
  assert.ok(!s.some(function (x) { return x.type === 'coverage-gap'; }));
});
```

Add the `NOW2` constant near the top of the test file (after `NOW` is introduced in Task 6, or define it standalone): `const NOW2 = Date.UTC(2026, 5, 23, 12, 0, 0);`

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — `core.detectMeetingSignals is not a function`.

- [ ] **Step 3: Implement `detectMeetingSignals`**

Add to `meeting-core.js` before `module.exports`:

```js
// Pure signal detector for ad-hoc (non-weekly) meetings. `state` carries simple counts
// so this stays testable. Dedupes against same-type meetings convened in the last 7 days.
function detectMeetingSignals(state, nowMs, recentMeetings) {
  const s = state || {};
  const signals = [];
  if ((s.activeObjectiveCount || 0) < 3) signals.push({ type: 'coverage-gap', reason: 'only ' + (s.activeObjectiveCount || 0) + ' active objective(s)' });
  if (s.finishedRecently && (s.activeObjectiveCount || 0) === 0) signals.push({ type: 'finished-initiative', reason: 'initiatives finished with none active' });
  if ((s.researchSignalCount || 0) > 0) signals.push({ type: 'research-opportunity', reason: (s.researchSignalCount) + ' unactioned research signal(s)' });
  const weekAgo = nowMs - 7 * 86400000;
  const recentTypes = new Set((recentMeetings || [])
    .filter(function (m) { return m.convened && (Date.parse(m.createdAt || '') || 0) >= weekAgo; })
    .map(function (m) { return m.trigger; }));
  return signals.filter(function (sig) { return !recentTypes.has('signal:' + sig.type); });
}
```

Update `module.exports` to add `detectMeetingSignals`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS (27 passed, 0 failed).

- [ ] **Step 5: Create cron `function.json`** (DAILY 15:00 UTC — daily so signals fire promptly; the weekly council is gated inside by weekday)

```json
{
  "bindings": [
    { "name": "meetingTimer", "type": "timerTrigger", "direction": "in", "schedule": "0 0 15 * * *" }
  ]
}
```

- [ ] **Step 6: Create cron `index.js`**

```js
// agenticMeetingCron — daily timer. Runs ONLY when the autonomy switch is on
// (systemConfig.agenticMeetings.enabled). Convenes on the weekly council day (Monday),
// or on any day a signal fires (deduped). Respects maxPerWeek.
const storage = require('../_utils/companyStorage');
const { runAgenticMeeting, detectMeetingSignals } = require('../companyMeeting/meeting-core');

function _meetingsThisWeek(list, nowMs) {
  const weekAgo = nowMs - 7 * 86400000;
  return (list || []).filter(function (m) { return m.convened && (Date.parse(m.createdAt || '') || 0) >= weekAgo; }).length;
}

module.exports = async function (context) {
  const demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;
  try {
    const cfg = (await storage.getState('systemConfig')) || {};
    const am = cfg.agenticMeetings || {};
    if (!am.enabled) { context.log('[agenticMeetingCron] disabled — skipping'); return; }

    const nowMs = Date.now();
    const meetings = (await storage.getState('agenticMeetings')) || [];
    const cap = Number.isFinite(am.maxPerWeek) ? am.maxPerWeek : 2;
    if (_meetingsThisWeek(meetings, nowMs) >= cap) { context.log('[agenticMeetingCron] weekly cap reached — skipping'); return; }

    const isCouncilDay = new Date(nowMs).getUTCDay() === 1; // Monday
    let trigger = null;
    if (isCouncilDay) {
      trigger = 'cron-weekly';
    } else if (am.signalsEnabled !== false) {
      const objectives = (await storage.getState('objectives')) || [];
      const activeCount = objectives.filter(function (o) { return o.status === 'active'; }).length;
      const finishedRecently = objectives.some(function (o) {
        return (o.status === 'complete' || o.status === 'archived') && (Date.parse(o.archivedAt || o.completedAt || '') || 0) >= (nowMs - 7 * 86400000);
      });
      const signals = detectMeetingSignals({ activeObjectiveCount: activeCount, finishedRecently: finishedRecently, researchSignalCount: 0 }, nowMs, meetings);
      if (signals.length) trigger = 'signal:' + signals[0].type;
    }

    if (!trigger) { context.log('[agenticMeetingCron] nothing to convene today'); return; }
    const rec = await runAgenticMeeting({ storage: storage, nowMs: nowMs, trigger: trigger, log: function () { context.log.apply(context, arguments); } });
    context.log('[agenticMeetingCron] complete:', JSON.stringify({ trigger: trigger, convened: rec.convened, id: rec.id }));
  } catch (err) {
    context.log.error && context.log.error('[agenticMeetingCron] failed:', err && err.message);
  }
};
```

- [ ] **Step 7: Verify it loads**

Run: `node -e "require('./api/agenticMeetingCron'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 8: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js api/agenticMeetingCron
git commit -m "feat(meetings): signal detection + daily autonomy cron (weekly + signal)"
```

---

## Task 9: Read endpoint — `meetingsRead`

**Files:**
- Create: `api/meetingsRead/index.js`
- Create: `api/meetingsRead/function.json`

- [ ] **Step 1: Create `function.json`**

```json
{
  "bindings": [
    { "authLevel": "anonymous", "type": "httpTrigger", "direction": "in", "name": "req", "methods": ["get", "options"], "route": "meetingsRead" },
    { "type": "http", "direction": "out", "name": "res" }
  ]
}
```

- [ ] **Step 2: Create `index.js`**

```js
// meetingsRead — GET /api/meetingsRead. Returns the agenticMeetings list (newest first)
// for the dashboard. Read-only; agenticMeetings is not a company-state VALID_KEY.
const storage = require('../_utils/companyStorage');
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret', 'Content-Type': 'application/json'
};
module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }
  try {
    const list = (await storage.getState('agenticMeetings')) || [];
    const out = list.slice().reverse();
    context.res = { status: 200, headers: corsHeaders, body: { meetings: out } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 200) } };
  }
};
```

- [ ] **Step 3: Verify it loads**

Run: `node -e "require('./api/meetingsRead'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add api/meetingsRead
git commit -m "feat(meetings): read endpoint for the dashboard"
```

---

## Task 10: Dashboard — button, toggle, render

**Files:**
- Modify: `modules/company/meetings.html` (locate it first; if absent, create using the `modules/company/goals.html` layout as the template — same `<head>`, sidebar include, and `content-section` wrapper).

- [ ] **Step 1: Locate the meetings UI**

Run: `ls modules/company/meetings.html` (and `grep -rl "runMeeting" modules/company` to find where meetings render today). Use that file. Confirm the API base helper (`getApiBase()`) and `CompanyStore.getWriteHeaders()` exist on the page (other modules use them).

- [ ] **Step 2: Add the button + toggle markup**

Insert near the top of the meetings content section:

```html
<div class="act-panel" id="agentic-meeting-panel" style="margin-bottom:1rem;">
  <div class="act-panel-head"><span><i class="fas fa-people-group"></i> Agentic Meeting</span></div>
  <div class="act-panel-body">
    <p style="font-size:var(--c-text-sm);opacity:.8;">The fleet proposes its own agenda, debates, votes, and routes the winners (internal work auto-creates; strategic work goes to your approval queue).</p>
    <button id="run-agentic-meeting" class="act-btn act-btn--approve"><i class="fas fa-gavel"></i> Run Agentic Meeting</button>
    <label style="margin-left:1rem;font-size:var(--c-text-sm);"><input type="checkbox" id="agentic-auto-toggle"> Auto-run weekly</label>
    <div id="agentic-meeting-status" style="margin-top:.5rem;font-size:var(--c-text-xs);opacity:.7;"></div>
  </div>
</div>
<div id="agentic-meeting-list"></div>
```

- [ ] **Step 3: Add the JS (button → trigger, toggle → systemConfig, render from meetingsRead)**

Add a `<script>` block (or extend the page's existing one):

```js
(function () {
  var apiBase = (typeof getApiBase === 'function') ? getApiBase() : 'https://ambientpixels-nova-api.azurewebsites.net/api';
  var hdrs = (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteHeaders) ? CompanyStore.getWriteHeaders() : { 'x-company-secret': 'pixelpusher' };
  var btn = document.getElementById('run-agentic-meeting');
  var statusEl = document.getElementById('agentic-meeting-status');
  var toggle = document.getElementById('agentic-auto-toggle');

  function renderMeetings() {
    fetch(apiBase + '/meetingsRead', { headers: hdrs }).then(function (r) { return r.json(); }).then(function (d) {
      var list = (d && d.meetings) || [];
      document.getElementById('agentic-meeting-list').innerHTML = list.slice(0, 10).map(function (m) {
        if (!m.convened) return '<div class="act-row"><div class="act-row-info"><div class="act-row-title">No meeting needed</div><div class="act-row-meta">' + (m.createdAt || '').slice(0, 16) + ' · ' + (m.reason || '') + '</div></div></div>';
        var passed = (m.candidates || []).filter(function (c) { return c.passed; }).length;
        return '<div class="act-row"><div class="act-row-info"><div class="act-row-title">' + (m.agenda || []).map(function (a) { return a.topic; }).join(', ') + '</div>'
          + '<div class="act-row-meta">' + (m.createdAt || '').slice(0, 16) + ' · ' + (m.candidates || []).length + ' proposed · ' + passed + ' passed · '
          + (m.routed ? (m.routed.internalCreated.length + ' tasks, ' + m.routed.proposalsQueued.length + ' to approval') : '') + '</div></div></div>';
      }).join('') || '<p style="opacity:.6;font-size:var(--c-text-sm);">No agentic meetings yet.</p>';
    }).catch(function () {});
  }

  btn.addEventListener('click', function () {
    btn.disabled = true; statusEl.textContent = 'Convening the fleet… (this runs ~16 model calls, give it a moment)';
    fetch(apiBase + '/agentic-meeting-trigger', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.disabled = false;
        if (d && d.meeting && d.meeting.convened === false) statusEl.textContent = 'Fleet decided nothing needed convening right now.';
        else if (d && d.meeting) statusEl.textContent = 'Done — see the latest meeting below.';
        else statusEl.textContent = 'Error: ' + ((d && d.error) || 'unknown');
        renderMeetings();
      })
      .catch(function (e) { btn.disabled = false; statusEl.textContent = 'Request failed: ' + e.message; });
  });

  // Toggle reads/writes systemConfig.agenticMeetings.enabled
  fetch(apiBase + '/company-state?key=systemConfig', { headers: hdrs }).then(function (r) { return r.json(); }).then(function (d) {
    var cfg = (d && (d.value || d)) || {}; toggle.checked = !!(cfg.agenticMeetings && cfg.agenticMeetings.enabled);
  }).catch(function () {});
  toggle.addEventListener('change', function () {
    fetch(apiBase + '/company-state?key=systemConfig', { headers: hdrs }).then(function (r) { return r.json(); }).then(function (d) {
      var cfg = (d && (d.value || d)) || {};
      cfg.agenticMeetings = Object.assign({ cadence: 'weekly', maxPerWeek: 2, signalsEnabled: true }, cfg.agenticMeetings || {}, { enabled: toggle.checked });
      return fetch(apiBase + '/company-state', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs), body: JSON.stringify({ key: 'systemConfig', value: cfg }) });
    });
  });

  renderMeetings();
})();
```

> Note: `systemConfig` IS a company-state VALID_KEY (the model toggle already uses it), so writing `agenticMeetings` into it from the dashboard is allowed and needs no new endpoint.

- [ ] **Step 4: Compile-check the page scripts**

Run:
```bash
node -e "const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('modules/company/meetings.html','utf8');const re=/<script\b[^>]*>([\s\S]*?)<\/script>/gi;let m,i=0,bad=0;while((m=re.exec(h))){i++;if(!m[1].trim()||/\bsrc=/.test(m[0]))continue;try{new vm.Script(m[1]);}catch(e){bad++;console.log('ERR#'+i,e.message);}}console.log(i+' scripts, '+bad+' errors');"
```
Expected: `N scripts, 0 errors`.

- [ ] **Step 5: Commit**

```bash
git add modules/company/meetings.html
git commit -m "feat(meetings): dashboard button, autonomy toggle, render"
```

---

## Task 11: Full-suite verification

- [ ] **Step 1: Run the meeting test suite**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: `27 passed, 0 failed`.

- [ ] **Step 2: Confirm endpoints + cron load without throwing**

Run:
```bash
node -e "require('./api/agentic-meeting-trigger');require('./api/agenticMeetingCron');require('./api/meetingsRead');require('./api/companyMeeting/meeting-core');console.log('all load ok')"
```
Expected: `all load ok`.

- [ ] **Step 3: Confirm no high-blast-radius files changed**

Run: `git diff --name-only origin/master...HEAD | grep -E "companyHeartbeat/index.js|company-state/index.js|staticwebapp.config.json|data/company-actions.json" || echo "clean — no protected files touched"`
Expected: `clean — no protected files touched`.

- [ ] **Step 4: Push to deploy**

```bash
git push origin master
```

- [ ] **Step 5: Post-deploy smoke (after CI/CD finishes)**

Run:
```bash
curl -sX POST "https://ambientpixels-nova-api.azurewebsites.net/api/agentic-meeting-trigger" -H "x-company-secret: pixelpusher" -H "Content-Type: application/json" | head -c 400
```
Expected: a JSON `{ "status": "ok", "meeting": { ... } }` with `convened` true or false. Then open the Meetings dashboard page and confirm the record renders.

---

## Self-Review notes (for the implementer)

- **Model dependency:** a real convened meeting needs a capable model. On Gemini the agents may under-emit the JSON `items`/`votes` blocks; if live meetings convene but produce 0 candidates, that's the known model-emission gap (see `project_proposal_triggers_health_aware`), not a code bug — re-test on Claude Sonnet (requires Anthropic credits).
- **`agenticMeetings` is not a VALID_KEY** — only readable via `/api/meetingsRead`, only written by the core. Do not add it to `company-state/index.js`.
- **Signals** ship in v1 (Task 8): `detectMeetingSignals` (coverage-gap, finished-initiative, research-opportunity) runs daily in the cron, deduped per type over 7 days and bounded by `maxPerWeek`. The research-opportunity input is wired to 0 for now (no research-signal source plumbed); add a real `researchSignalCount` source as a fast-follow.

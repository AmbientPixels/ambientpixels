# Agentic Meeting — Profit Brief & Knowledge Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agentic meetings produce profit-oriented, executable, deduped work by feeding agents a shared money brief + per-agent memory, splitting output into two lanes (fleet work vs CEO decisions), deduping across meetings, and pinning meetings to Claude Sonnet.

**Architecture:** A new pure module `companyMeeting/meeting-brief.js` assembles the shared brief (reusing the heartbeat's `buildWorldState`) and per-agent memory slices. `meeting-core.js` loads the extra state, feeds brief + memory into the prompts, validates a new item contract (`lane`/`owner`/`deliverable`/`profitThesis`), routes `execution_task` items by lane, dedups all items against existing tasks/proposals, and defaults its model call to Sonnet (fallback to the global model). `prompts.js` is reframed around profitability. The Meetings page renders the new `decision_request` type.

**Tech Stack:** Node.js (Azure Functions), plain `assert`-based test files run with `node`, Azure Blob state via `companyStorage`.

**Spec:** `docs/superpowers/specs/2026-06-23-agentic-meeting-profit-brief-design.md`

---

## File Structure

- **Create** `api/companyMeeting/meeting-brief.js` — `buildSharedBrief`, `buildAgentMemorySlice`, `isDuplicateTopic` (all pure).
- **Create** `api/companyMeeting/meeting-brief.test.js` — tests for the three pure functions.
- **Create** `api/companyHeartbeat/gemini.test.js` — test for `_isClaudeModel` (model-selection logic).
- **Modify** `api/companyHeartbeat/gemini.js` — add `callWithModel` + export `_isClaudeModel`.
- **Modify** `api/companyMeeting/prompts.js` — reframe agenda/discussion/vote; new item contract.
- **Modify** `api/companyMeeting/meeting-core.js` — item validation, brief+memory wiring, lane routing, dedup, Sonnet-pinned default model.
- **Modify** `api/companyMeeting/meeting-core.test.js` — update mock items to the new contract; add lane-routing + dedup assertions.
- **Modify** `modules/company/meetings.html` — render `decision_request` entries with Approve/Reject.

---

## Task 1: Add a model-override call path in gemini.js

**Files:**
- Modify: `api/companyHeartbeat/gemini.js`
- Test: `api/companyHeartbeat/gemini.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `api/companyHeartbeat/gemini.test.js`:

```js
// Run with: node api/companyHeartbeat/gemini.test.js
const assert = require('assert');
const gemini = require('./gemini');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

test('_isClaudeModel recognizes the claude model keys', () => {
  assert.strictEqual(gemini._isClaudeModel('claude'), true);
  assert.strictEqual(gemini._isClaudeModel('claude-sonnet'), true);
  assert.strictEqual(gemini._isClaudeModel('claude-haiku'), true);
});
test('_isClaudeModel rejects gemini and unknowns', () => {
  assert.strictEqual(gemini._isClaudeModel('gemini'), false);
  assert.strictEqual(gemini._isClaudeModel('wat'), false);
  assert.strictEqual(gemini._isClaudeModel(''), false);
});
test('callWithModel is exported as a function', () => {
  assert.strictEqual(typeof gemini.callWithModel, 'function');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyHeartbeat/gemini.test.js`
Expected: FAIL — `_isClaudeModel` / `callWithModel` are not exported (currently only `callGemini, callGeminiExecute, getActiveModel`).

- [ ] **Step 3: Add `callWithModel` and export the helpers**

In `api/companyHeartbeat/gemini.js`, add this function just above the `module.exports` line:

```js
// Call a specific model regardless of systemConfig (used to pin meetings to Sonnet).
// Meeting replies are free-form JSON (not the agent envelope) so the Gemini path is
// NOT schema-gated here. Returns text, or null on missing key / API error.
async function callWithModel(prompt, agentId, modelKey) {
  var model = String(modelKey || '').toLowerCase();
  if (_isClaudeModel(model)) return _callClaude(prompt, agentId, 1500, model);
  if (model === 'gemini') return _callGeminiRaw(prompt, agentId, 1500, 0.7, 'meeting', false);
  return callGemini(prompt, agentId); // unknown key → legacy dynamic resolution
}
```

Replace the export line:

```js
module.exports = { callGemini, callGeminiExecute, getActiveModel, callWithModel, _isClaudeModel };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyHeartbeat/gemini.test.js`
Expected: PASS — `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/gemini.js api/companyHeartbeat/gemini.test.js
git commit -m "feat(gemini): add callWithModel for pinning a specific model"
```

---

## Task 2: `buildSharedBrief` — the money picture

**Files:**
- Create: `api/companyMeeting/meeting-brief.js`
- Test: `api/companyMeeting/meeting-brief.test.js` (create)

The brief is rendered from the `worldState` object produced by the heartbeat's `buildWorldState` (shape: `.finance.{monthlyActual,monthlyBudget,monthlyRevenue,mrr,payingCustomers,netBurn,status}`, `.company.runwayDays`, `.products[].{name,status,signal}`, `.objectives[].{title,progress}`, `.campaigns[].{title,pace,progress}`), plus the `outcomeDigest.totals` funnel.

- [ ] **Step 1: Write the failing test**

Create `api/companyMeeting/meeting-brief.test.js`:

```js
// Run with: node api/companyMeeting/meeting-brief.test.js
const assert = require('assert');
const brief = require('./meeting-brief');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const WS = {
  generatedAt: '2026-06-23T12:00:00.000Z',
  company: { runwayDays: 47 },
  finance: { monthlyActual: 9.2, monthlyBudget: 15, monthlyRevenue: 0, mrr: 0, payingCustomers: 0, netBurn: 9.2, status: 'YELLOW' },
  products: [
    { name: 'AmbientScore', status: 'active', signal: 'declining' },
    { name: 'Blindspot', status: 'active', signal: null }
  ],
  objectives: [{ title: 'Run Loud', progress: 40 }],
  campaigns: [{ title: 'Build in Public v3', pace: 'BEHIND', progress: 30 }]
};
const OUT = { totals: { snapshots: 12, complete: 8, blogViews: 140, formSubmits: 3 } };

test('buildSharedBrief includes the money line with revenue, spend, runway', () => {
  const b = brief.buildSharedBrief(WS, OUT);
  assert.ok(/MONEY/.test(b));
  assert.ok(/\$9\.2/.test(b));        // spend
  assert.ok(/47d/.test(b));           // runway
});
test('buildSharedBrief labels declining products as burning', () => {
  const b = brief.buildSharedBrief(WS, OUT);
  assert.ok(/AmbientScore/.test(b));
  assert.ok(/declining/i.test(b));
});
test('buildSharedBrief includes the funnel line from outcomeDigest', () => {
  const b = brief.buildSharedBrief(WS, OUT);
  assert.ok(/FUNNEL/.test(b));
  assert.ok(/140/.test(b));           // blog views
});
test('buildSharedBrief fails open on a null worldState', () => {
  const b = brief.buildSharedBrief(null, null);
  assert.strictEqual(typeof b, 'string');
  assert.ok(b.length > 0);
});
test('buildSharedBrief stays under the 2500-char cap', () => {
  const b = brief.buildSharedBrief(WS, OUT);
  assert.ok(b.length <= 2500, 'len=' + b.length);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-brief.test.js`
Expected: FAIL — `Cannot find module './meeting-brief'`.

- [ ] **Step 3: Create `meeting-brief.js` with `buildSharedBrief`**

Create `api/companyMeeting/meeting-brief.js`:

```js
'use strict';

// Pure assembly of the meeting's shared business brief + per-agent memory slices
// + cross-meeting dedup. No state I/O — the caller loads state and passes it in.

const SHARED_BRIEF_CAP = 2500;

function _money(n) { return '$' + (Number(n) || 0).toFixed(2); }

// Render the money-forward brief from a worldState object (heartbeat buildWorldState
// output) + the outcomeDigest funnel. Every section is omitted if its source is
// missing — never throws (except the dev char-cap guard).
function buildSharedBrief(worldState, outcomeDigest) {
  const ws = worldState || {};
  const fin = ws.finance || {};
  const lines = [];
  lines.push('═══ BUSINESS BRIEF (money first) ═══');

  // MONEY
  const runway = (ws.company && ws.company.runwayDays != null) ? ws.company.runwayDays + 'd' : '—';
  lines.push('MONEY: revenue ' + _money(fin.monthlyRevenue) + ' MTD / ' + _money(fin.mrr) + ' MRR / ' +
    (fin.payingCustomers || 0) + ' paying. Spend ' + _money(fin.monthlyActual) + ' of ' + _money(fin.monthlyBudget) +
    ' (' + (fin.status || 'unknown') + '). Net burn ' + _money(fin.netBurn) + '. Runway ' + runway + '.');

  // PRODUCTS — earns vs burns
  const prods = Array.isArray(ws.products) ? ws.products : [];
  if (prods.length) {
    const pStr = prods.slice(0, 8).map(function (p) {
      const flag = (p.signal && /declin/i.test(p.signal)) ? ' BURNING' : '';
      return p.name + ' (' + (p.status || 'active') + (p.signal ? ', ' + p.signal : '') + flag + ')';
    }).join(', ');
    lines.push('PRODUCTS: ' + pStr + '.');
  }

  // FUNNEL
  const ot = (outcomeDigest && outcomeDigest.totals) || null;
  if (ot) {
    lines.push('FUNNEL: ' + (ot.complete || 0) + '/' + (ot.snapshots || 0) + ' posts measured → ' +
      (ot.blogViews || 0) + ' blog views → ' + (ot.formSubmits || 0) + ' form submits.');
  }

  // PIPELINE
  const objs = Array.isArray(ws.objectives) ? ws.objectives : [];
  if (objs.length) {
    lines.push('OBJECTIVES: ' + objs.slice(0, 5).map(function (o) { return '"' + o.title + '" ' + (o.progress || 0) + '%'; }).join(', ') + '.');
  }
  const camps = Array.isArray(ws.campaigns) ? ws.campaigns : [];
  if (camps.length) {
    lines.push('CAMPAIGNS: ' + camps.slice(0, 5).map(function (c) { return '"' + c.title + '" ' + (c.pace || '') + ' ' + (c.progress || 0) + '%'; }).join(', ') + '.');
  }

  lines.push('═══ END BRIEF ═══');
  const block = lines.join('\n');
  if (block.length > SHARED_BRIEF_CAP) {
    throw new Error('[meeting-brief] shared brief exceeds ' + SHARED_BRIEF_CAP + ' char cap: ' + block.length);
  }
  return block;
}

module.exports = { buildSharedBrief, SHARED_BRIEF_CAP };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-brief.test.js`
Expected: PASS — `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-brief.js api/companyMeeting/meeting-brief.test.js
git commit -m "feat(meetings): buildSharedBrief money-first business brief"
```

---

## Task 3: `buildAgentMemorySlice` — per-agent specialty memory

**Files:**
- Modify: `api/companyMeeting/meeting-brief.js`
- Test: `api/companyMeeting/meeting-brief.test.js`

The slice draws from a `mem` bundle the caller assembles: `{ agentMemories, researchIntel, weeklyReports, agentSeedMemories }`. Cap ~1500 chars, fail-open to `''`.

- [ ] **Step 1: Write the failing test (append to meeting-brief.test.js, before the final console.log)**

```js
// ── buildAgentMemorySlice ──
const MEM = {
  agentSeedMemories: { _global: 'Ship money, not ceremony.', cipher: 'Watch revenue/$ spend.' },
  agentMemories: {
    cipher: [{ type: 'reflection', content: 'AmbientScore is our only paywall.' }],
    scout: [{ type: 'note', content: 'old note' }]
  },
  researchIntel: [{ title: 'Competitor X pricing', summary: 'They charge $49/mo.' }],
  weeklyReports: { cipher: [{ summary: 'Spend flat, revenue $0.' }] }
};

test('cipher slice includes finance signal + weekly report + seed', () => {
  const s = brief.buildAgentMemorySlice('cipher', MEM);
  assert.ok(/revenue/i.test(s));
  assert.ok(/AmbientScore/.test(s));      // own reflection
});
test('scout slice includes research intel (L7)', () => {
  const s = brief.buildAgentMemorySlice('scout', MEM);
  assert.ok(/Competitor X/.test(s));
});
test('an agent with no memory gets an empty slice', () => {
  const s = brief.buildAgentMemorySlice('forge', { agentMemories: {}, researchIntel: [], weeklyReports: {}, agentSeedMemories: {} });
  assert.strictEqual(s, '');
});
test('memory slice stays under 1500 chars', () => {
  const s = brief.buildAgentMemorySlice('cipher', MEM);
  assert.ok(s.length <= 1500, 'len=' + s.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-brief.test.js`
Expected: FAIL — `buildAgentMemorySlice is not a function`.

- [ ] **Step 3: Implement `buildAgentMemorySlice`**

In `api/companyMeeting/meeting-brief.js`, add before `module.exports`:

```js
const MEMORY_SLICE_CAP = 1500;

function _trim(s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); }

// Per-agent specialty memory. Returns '' when the agent has nothing.
function buildAgentMemorySlice(agentId, mem) {
  const id = String(agentId || '').toLowerCase();
  const m = mem || {};
  const seed = m.agentSeedMemories || {};
  const memories = (m.agentMemories || {})[id] || [];
  const research = Array.isArray(m.researchIntel) ? m.researchIntel : [];
  const weekly = (m.weeklyReports || {})[id] || [];
  const lines = [];

  // Seed anchors (global + own)
  const seedBits = [];
  if (seed._global) seedBits.push(_trim(seed._global, 160));
  if (seed[id]) seedBits.push(_trim(seed[id], 160));
  if (seedBits.length) lines.push('ANCHORS: ' + seedBits.join(' | '));

  // Latest weekly report (cipher/forge/nova)
  if (weekly.length) {
    const last = weekly[weekly.length - 1] || {};
    if (last.summary) lines.push('LAST WEEKLY: ' + _trim(last.summary, 240));
  }

  // Role-specialty source: scout → research intel; everyone → own reflections/verdicts
  if (id === 'scout' && research.length) {
    lines.push('RESEARCH: ' + research.slice(0, 3).map(function (r) {
      return _trim((r.title || '') + (r.summary ? ' — ' + r.summary : ''), 160);
    }).join(' | '));
  }
  const focus = memories.filter(function (x) {
    return x && (x.type === 'reflection' || (x.source && String(x.source).indexOf('experiment-verdict') !== -1));
  }).slice(-3);
  if (focus.length) {
    lines.push('YOUR NOTES: ' + focus.map(function (x) { return _trim(x.content || x.text || '', 160); }).filter(Boolean).join(' | '));
  }

  if (!lines.length) return '';
  let block = '─ YOUR MEMORY (' + id + ') ─\n' + lines.join('\n');
  if (block.length > MEMORY_SLICE_CAP) block = block.slice(0, MEMORY_SLICE_CAP);
  return block;
}
```

Update the export:

```js
module.exports = { buildSharedBrief, buildAgentMemorySlice, SHARED_BRIEF_CAP, MEMORY_SLICE_CAP };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-brief.test.js`
Expected: PASS — `9 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-brief.js api/companyMeeting/meeting-brief.test.js
git commit -m "feat(meetings): buildAgentMemorySlice per-agent specialty memory"
```

---

## Task 4: `isDuplicateTopic` — cross-meeting dedup

**Files:**
- Modify: `api/companyMeeting/meeting-brief.js`
- Test: `api/companyMeeting/meeting-brief.test.js`

Topic match = ≥2 shared significant title tokens, OR same non-null `targetObjectiveId`. This must collapse the real incident clusters.

- [ ] **Step 1: Write the failing test (append before final console.log)**

```js
// ── isDuplicateTopic ──
test('collapses the AmbientScore+Blindspot cluster (>=2 shared tokens)', () => {
  const existing = [{ title: 'AmbientScore + Blindspot Final Sprint & Insight Routing' }];
  const cand = { title: 'AmbientScore + Blindspot — Go/No-Go Decision & Launch Scope Freeze' };
  assert.strictEqual(brief.isDuplicateTopic(cand, existing), true);
});
test('collapses the Pulse Daily cluster', () => {
  const existing = [{ title: 'Pulse Daily: Post-Launch Operating Model Decision' }];
  const cand = { title: 'Pulse Daily: Ownership & Cadence Lock (Post-Launch SLA)' };
  assert.strictEqual(brief.isDuplicateTopic(cand, existing), true);
});
test('distinct topics are NOT flagged duplicate', () => {
  const existing = [{ title: 'AmbientScore + Blindspot Final Sprint' }];
  const cand = { title: 'Build in Public v4: One-Sentence Narrative Lock' };
  assert.strictEqual(brief.isDuplicateTopic(cand, existing), false);
});
test('same targetObjectiveId is a duplicate regardless of title', () => {
  const existing = [{ title: 'Totally different words', targetObjectiveId: 'obj-9' }];
  const cand = { title: 'Nothing in common here', targetObjectiveId: 'obj-9' };
  assert.strictEqual(brief.isDuplicateTopic(cand, existing), true);
});
test('empty existing → never a duplicate', () => {
  assert.strictEqual(brief.isDuplicateTopic({ title: 'anything' }, []), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-brief.test.js`
Expected: FAIL — `isDuplicateTopic is not a function`.

- [ ] **Step 3: Implement `isDuplicateTopic`**

In `api/companyMeeting/meeting-brief.js`, add before `module.exports`:

```js
const TOPIC_STOP_WORDS = new Set(['the', 'and', 'for', 'launch', 'campaign', 'this', 'week', 'plus',
  'new', 'with', 'into', 'our', 'decision', 'lock', 'gate', 'scope', 'final', 'post', 'model', 'plan',
  'review', 'sync', 'sprint', 'freeze', 'go', 'no']);

function _topicTokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length > 2 && !TOPIC_STOP_WORDS.has(w); });
}

// True if `candidate` repeats a topic already present in `existing` (array of
// {title, targetObjectiveId?}). Match = same non-null targetObjectiveId, or >=2
// shared significant title tokens.
function isDuplicateTopic(candidate, existing) {
  const c = candidate || {};
  const cTokens = _topicTokens(c.title);
  const cObj = c.targetObjectiveId || null;
  return (existing || []).some(function (e) {
    if (!e) return false;
    if (cObj && e.targetObjectiveId && e.targetObjectiveId === cObj) return true;
    const eTokens = _topicTokens(e.title);
    const shared = cTokens.filter(function (w) { return eTokens.indexOf(w) !== -1; }).length;
    return shared >= 2;
  });
}
```

Update the export:

```js
module.exports = { buildSharedBrief, buildAgentMemorySlice, isDuplicateTopic, SHARED_BRIEF_CAP, MEMORY_SLICE_CAP };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-brief.test.js`
Expected: PASS — `14 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-brief.js api/companyMeeting/meeting-brief.test.js
git commit -m "feat(meetings): isDuplicateTopic cross-meeting dedup"
```

---

## Task 5: Reframe the prompts (profit + two-lane contract)

**Files:**
- Modify: `api/companyMeeting/prompts.js`
- Test: `api/companyMeeting/meeting-core.test.js` (existing prompt tests)

- [ ] **Step 1: Update the existing prompt tests to the new signatures**

In `api/companyMeeting/meeting-core.test.js`, replace the three `// ── prompts ──` tests (lines ~110-127) with:

```js
// ── prompts ──
const prompts = require('./prompts');
test('agenda prompt names the agent, includes the brief, asks for JSON topics', () => {
  const p = prompts.buildAgendaPrompt('nova', '═══ BUSINESS BRIEF ═══\nMONEY: ...', []);
  assert.ok(/nova/i.test(p));
  assert.ok(/agenda/i.test(p));
  assert.ok(/json/i.test(p));
  assert.ok(/BUSINESS BRIEF/.test(p));      // brief injected
  assert.ok(/revenue|profit|cost|growth/i.test(p)); // profit framing
});
test('discussion prompt includes agenda, brief, memory slice, and the lane contract', () => {
  const p = prompts.buildDiscussionPrompt('echo', [{ topic: 'Grow X' }], 'prior transcript', 'BRIEF HERE', 'MEM HERE');
  assert.ok(/Grow X/.test(p));
  assert.ok(/"items"/.test(p));
  assert.ok(/BRIEF HERE/.test(p));
  assert.ok(/MEM HERE/.test(p));
  assert.ok(/profitThesis/.test(p));        // required field documented
  assert.ok(/fleet_task|ceo_decision/.test(p));
});
test('vote prompt rejects ceremony/no-thesis items', () => {
  const p = prompts.buildVotePrompt('cipher', [{ id: 'cand-1', kind: 'execution_task', title: 'Beacon' }]);
  assert.ok(/Beacon/.test(p));
  assert.ok(/approve/i.test(p) && /reject/i.test(p) && /abstain/i.test(p));
  assert.ok(/profitThesis|ceremony|owner/i.test(p));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL on the three prompt tests (brief/profit/lane assertions not present; `buildAgendaPrompt` still uses the old state-object signature).

- [ ] **Step 3: Rewrite `prompts.js`**

Replace the entire body of `api/companyMeeting/prompts.js` with:

```js
'use strict';

const KNOWN_AGENTS = "nova, echo, scout, cipher, pixel, forge, scribe, quill";

function buildAgendaPrompt(agentId, brief, pendingTopics) {
  const pending = (pendingTopics && pendingTopics.length)
    ? ('\nAlready in front of the CEO (do NOT re-raise these): ' + pendingTopics.slice(0, 12).join('; ') + '\n')
    : '';
  return 'You are ' + agentId + ', Prime Operator opening an AmbientOS strategy meeting.\n' +
    'The company must become profitable. Read the money picture below and decide where the biggest ' +
    'opportunity or leak is — something that moves REVENUE, COST, or GROWTH.\n\n' +
    (brief || '(brief unavailable)') + '\n' + pending + '\n' +
    'Convene only if there is real money-moving work. Reply with ONLY a fenced json block:\n' +
    '```json\n{"convene": true, "agenda": [{"topic": "...", "rationale": "<cite a number from the brief>"}]}\n```\n' +
    'At most 3 topics. If nothing is worth a meeting, return {"convene": false, "agenda": []}.';
}

function buildDiscussionPrompt(agentId, agenda, transcript, brief, memorySlice) {
  return 'You are ' + agentId + ' in an AmbientOS strategy meeting. The goal is PROFIT.\n' +
    'AGENDA: ' + JSON.stringify(agenda) + '\n\n' +
    (brief ? (brief + '\n\n') : '') +
    (memorySlice ? (memorySlice + '\n\n') : '') +
    (transcript ? ('Discussion so far:\n' + transcript + '\n\n') : '') +
    'Speak briefly, then propose 0-2 work items that move revenue, cost, or growth.\n' +
    'RULES:\n' +
    '- Every item needs a "profitThesis": the revenue/cost/growth lever, citing a number from the brief.\n' +
    '- For execution work, set "lane":\n' +
    '    "fleet_task"   = a real agent DOES it. Requires "owner" (one of: ' + KNOWN_AGENTS + ') and a concrete "deliverable" (an artifact + how we know it is done).\n' +
    '    "ceo_decision" = a money call only the CEO can make, with options + data.\n' +
    '- BANNED: "convene a sync", "assign a DRI", "lock an SLA", "go/no-go gate", or any item whose deliverable is "a decision" or "a meeting". Propose WORK or a crisp CEO decision, never ceremony.\n' +
    'End with a fenced json block (omit it if you propose nothing):\n' +
    '```json\n{"items":[{"kind":"execution_task","lane":"fleet_task","owner":"cipher",' +
    '"title":"...","deliverable":"...","profitThesis":"...","description":"...","rationale":"...","estimatedCost":0,' +
    '"targetObjectiveId":"<id if under an existing objective, else omit>"}]}\n```\n' +
    'kind may also be campaign|objective|research_task|internal_doc|product_launch|product_pivot|product_retire|social when proposing those directly.';
}

function buildVotePrompt(agentId, candidates) {
  const slate = (candidates || []).map(function (c) {
    return { id: c.id, kind: c.kind, lane: c.lane || null, title: c.title, owner: c.owner || null, profitThesis: c.profitThesis || null };
  });
  return 'You are ' + agentId + ' voting on the proposed work from this AmbientOS meeting.\n' +
    'CANDIDATES (JSON): ' + JSON.stringify(slate) + '\n\n' +
    'Be a hard quality gate. REJECT any item that: has no profitThesis, is a fleet_task with no real owner, ' +
    'is ceremony (a sync/DRI/SLA/"make a decision"), is a duplicate, or is off-strategy/low-leverage.\n' +
    'For EACH candidate, vote approve, reject, or abstain with a one-line rationale.\n' +
    'Reply with ONLY a fenced json block:\n' +
    '```json\n{"votes":[{"id":"cand-1","vote":"approve|reject|abstain","rationale":"..."}]}\n```';
}

module.exports = { buildAgendaPrompt, buildDiscussionPrompt, buildVotePrompt };
```

- [ ] **Step 4: Run test to verify the prompt tests pass**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: the three prompt tests PASS. (Other tests may still fail — `runAgenticMeeting` and `parseItemsFromReply` change in Tasks 6-7. That is expected; this step only fixes the prompt tests.)

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/prompts.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): profit-framed prompts with two-lane item contract"
```

---

## Task 6: Validate the new item contract in `parseItemsFromReply`

**Files:**
- Modify: `api/companyMeeting/meeting-core.js:69-96` (parseItemsFromReply) + `VALID_KINDS`
- Test: `api/companyMeeting/meeting-core.test.js`

- [ ] **Step 1: Write the failing tests (replace the `// ── parseItemsFromReply ──` block, lines ~83-97)**

```js
// ── parseItemsFromReply (new contract: profitThesis required; lane for execution_task) ──
test('drops an item with no profitThesis', () => {
  const reply = '{"items":[{"kind":"campaign","title":"Beacon launch"}]}';
  assert.deepStrictEqual(core.parseItemsFromReply(reply, 'echo'), []);
});
test('keeps a strategic item that has a profitThesis', () => {
  const reply = '{"items":[{"kind":"campaign","title":"Beacon launch","profitThesis":"+$X MRR"}]}';
  const items = core.parseItemsFromReply(reply, 'echo');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].proposedBy, 'echo');
});
test('drops a fleet_task with no owner', () => {
  const reply = '{"items":[{"kind":"execution_task","lane":"fleet_task","title":"x","deliverable":"d","profitThesis":"p"}]}';
  assert.deepStrictEqual(core.parseItemsFromReply(reply, 'nova'), []);
});
test('keeps a valid fleet_task with owner + deliverable + thesis', () => {
  const reply = '{"items":[{"kind":"execution_task","lane":"fleet_task","owner":"cipher","title":"Rank products by ROI","deliverable":"memo to nova","profitThesis":"cut the worst burner"}]}';
  const items = core.parseItemsFromReply(reply, 'cipher');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].lane, 'fleet_task');
  assert.strictEqual(items[0].owner, 'cipher');
});
test('drops an execution_task with no valid lane', () => {
  const reply = '{"items":[{"kind":"execution_task","title":"x","profitThesis":"p"}]}';
  assert.deepStrictEqual(core.parseItemsFromReply(reply, 'nova'), []);
});
test('keeps a ceo_decision with a profitThesis (no owner needed)', () => {
  const reply = '{"items":[{"kind":"execution_task","lane":"ceo_decision","title":"Kill or fund AmbientScore","profitThesis":"$0 revenue at 75%"}]}';
  const items = core.parseItemsFromReply(reply, 'nova');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].lane, 'ceo_decision');
});
test('returns [] when no JSON present', () => {
  assert.deepStrictEqual(core.parseItemsFromReply('just talking', 'nova'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — current `parseItemsFromReply` keeps items with no profitThesis and ignores `lane`/`owner`.

- [ ] **Step 3: Update `parseItemsFromReply` + the item map**

In `api/companyMeeting/meeting-core.js`, replace the `.filter(...).slice(...).map(...)` chain in `parseItemsFromReply` (lines ~82-95) with:

```js
  const KNOWN = ['nova', 'echo', 'scout', 'cipher', 'pixel', 'forge', 'scribe', 'quill'];
  return obj.items
    .filter(function (it) {
      if (!it || VALID_KINDS.indexOf(it.kind) === -1 || _norm(it.title).length === 0) return false;
      if (_norm(it.profitThesis).length === 0) return false;            // every item needs a thesis
      if (it.kind === 'execution_task') {
        if (it.lane !== 'fleet_task' && it.lane !== 'ceo_decision') return false;
        if (it.lane === 'fleet_task') {
          if (KNOWN.indexOf(String(it.owner || '').toLowerCase()) === -1) return false;
          if (_norm(it.deliverable).length === 0) return false;
        }
      }
      return true;
    })
    .slice(0, MAX_ITEMS_PER_AGENT)
    .map(function (it) {
      return {
        kind: it.kind,
        lane: it.lane || null,
        owner: it.owner ? String(it.owner).toLowerCase() : null,
        deliverable: String(it.deliverable || '').slice(0, 500),
        profitThesis: String(it.profitThesis || '').slice(0, 300),
        title: String(it.title).slice(0, 140),
        description: String(it.description || '').slice(0, 1000),
        rationale: String(it.rationale || '').slice(0, 500),
        estimatedCost: Number.isFinite(Number(it.estimatedCost)) ? Number(it.estimatedCost) : null,
        targetObjectiveId: it.targetObjectiveId || null,
        proposedBy: agentId
      };
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: the `parseItemsFromReply` tests PASS. (The `runAgenticMeeting` e2e test still fails — its mock items lack `profitThesis`; fixed in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): validate profitThesis + lane/owner item contract"
```

---

## Task 7: Wire brief + memory + lane routing + dedup + model pin into `runAgenticMeeting`

**Files:**
- Modify: `api/companyMeeting/meeting-core.js` (top requires, `_routeInternalTask`, new `_routeDecisionRequest`, `runAgenticMeeting` steps 1/2/3/6, default `callModel`)
- Test: `api/companyMeeting/meeting-core.test.js` (update mock + add lane/dedup assertions)

- [ ] **Step 1: Update the e2e mock + add new assertions**

In `api/companyMeeting/meeting-core.test.js`, update `mockModel` so its proposed items carry the new contract, and add a `fleet_task` and a `ceo_decision`. Replace the `echo` branch inside `mockModel` (line ~140) with:

```js
    if (agentId === 'echo') return Promise.resolve('We should push Bluesky.\n```json\n{"items":[' +
      '{"kind":"campaign","title":"Bluesky Growth Push","rationale":"flat followers","profitThesis":"+50 followers → top-funnel","estimatedCost":2},' +
      '{"kind":"research_task","title":"Bluesky competitor scan","rationale":"need angles","profitThesis":"find a cheaper acquisition channel","estimatedCost":0}]}\n```');
    if (agentId === 'cipher') return Promise.resolve('Money view.\n```json\n{"items":[' +
      '{"kind":"execution_task","lane":"fleet_task","owner":"cipher","title":"Rank products by revenue per dollar","deliverable":"memo to nova ranking 7 products","profitThesis":"cut the biggest burner, save $X/mo"},' +
      '{"kind":"execution_task","lane":"ceo_decision","title":"Kill or fund AmbientScore","profitThesis":"$0 revenue at 75% done — decide"}]}\n```');
    return Promise.resolve('Agreed, no new items from me.');
```

Then add assertions to the `runAgenticMeeting` test body (after the existing assertions, before its closing `});`):

```js
  // fleet_task → an internal task assigned to its named owner
  const fleetTasks = storage._state.tasks.filter(function (t) { return t.source === 'meeting' && t.assignee === 'cipher'; });
  assert.ok(fleetTasks.length >= 1, 'fleet_task should create a task assigned to cipher');
  // ceo_decision → a decision_request in the approvalQueue
  assert.ok(storage._state.approvalQueue.some(function (q) { return q.type === 'decision_request'; }), 'ceo_decision should queue a decision_request');
```

Add a dedicated dedup test after the `runAgenticMeeting` test:

```js
testA('runAgenticMeeting suppresses a ceo_decision that duplicates a pending decision_request', async () => {
  const storage = mockStorage({ approvalQueue: [
    { id: 'dr-old', type: 'decision_request', status: 'pending', title: 'AmbientScore funding decision', createdAt: new Date(NOW - 86400000).toISOString() }
  ] });
  function dupModel(prompt, agentId) {
    if (/Prime Operator opening/.test(prompt)) return Promise.resolve('```json\n{"convene":true,"agenda":[{"topic":"AmbientScore","rationale":"$0"}]}\n```');
    if (/Speak briefly/.test(prompt)) {
      if (agentId === 'cipher') return Promise.resolve('```json\n{"items":[{"kind":"execution_task","lane":"ceo_decision","title":"AmbientScore funding decision again","profitThesis":"$0 revenue"}]}\n```');
      return Promise.resolve('nothing');
    }
    if (/voting on the proposed work/.test(prompt)) {
      const ids = (prompt.match(/"id":"(cand-[^"]+)"/g) || []).map(function (s) { return s.replace(/"id":"|"$/g, ''); });
      return Promise.resolve('```json\n{"votes":[' + ids.map(function (id) { return '{"id":"' + id + '","vote":"approve","rationale":"y"}'; }).join(',') + ']}\n```');
    }
    return Promise.resolve('(ok)');
  }
  const rec = await core.runAgenticMeeting({ storage, nowMs: NOW, trigger: 'button', callModel: dupModel, log: function () {} });
  const newDRs = storage._state.approvalQueue.filter(function (q) { return q.type === 'decision_request' && q.id !== 'dr-old'; });
  assert.strictEqual(newDRs.length, 0, 'duplicate decision should be suppressed');
  assert.ok(Array.isArray(rec.suppressedDuplicates) && rec.suppressedDuplicates.length >= 1, 'suppression recorded');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: FAIL — no `decision_request` routing, no dedup, `rec.suppressedDuplicates` undefined.

- [ ] **Step 3: Implement the wiring in `meeting-core.js`**

(a) At the top requires (after `const prompts = require('./prompts');`), add:

```js
const meetingBrief = require('./meeting-brief');
const { buildWorldState } = require('../companyHeartbeat/world-state-intel');
const gemini = require('../companyHeartbeat/gemini');
```

(b) Replace `_routeInternalTask` (lines ~127-144) so a `fleet_task` is assigned to its `owner` and uses the deliverable as the description:

```js
function _taskTypeForOwner(owner) {
  if (owner === 'scout') return 'research';
  if (owner === 'scribe') return 'internal_doc';
  return 'general';
}

function _routeInternalTask(candidate, meetingId, nowIso) {
  const isFleet = candidate.kind === 'execution_task' && candidate.lane === 'fleet_task';
  const assignee = isFleet ? candidate.owner
    : (candidate.kind === 'research_task' ? 'scout' : (candidate.proposedBy || 'nova'));
  const taskType = isFleet ? _taskTypeForOwner(assignee)
    : (candidate.kind === 'research_task' ? 'research' : (candidate.kind === 'internal_doc' ? 'internal_doc' : 'general'));
  return {
    id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: candidate.title,
    description: (isFleet && candidate.deliverable) ? candidate.deliverable : (candidate.description || candidate.rationale || ''),
    taskType: taskType,
    status: 'todo',
    priority: 'medium',
    assignee: assignee,
    objective_id: candidate.targetObjectiveId || null,
    profitThesis: candidate.profitThesis || null,
    createdAt: nowIso,
    updatedAt: nowIso,
    source: 'meeting',
    created_by: candidate.proposedBy || 'nova',
    meetingId: meetingId
  };
}

function _routeDecisionRequest(candidate, meetingId, nowIso) {
  return {
    id: 'mdec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    type: 'decision_request',
    status: 'pending',
    proposedBy: candidate.proposedBy || 'nova',
    source: 'meeting',
    meetingId: meetingId,
    title: candidate.title,
    name: candidate.title,
    description: candidate.description || '',
    profitThesis: candidate.profitThesis || null,
    voteTally: { approve: candidate.approveCount, reject: candidate.rejectCount, abstain: candidate.abstainCount },
    createdAt: nowIso
  };
}
```

(c) In `classifyBlastRadius` (lines ~22-26), a `fleet_task` is internal (the fleet does it); a `ceo_decision` is strategic. Replace the function with:

```js
function classifyBlastRadius(candidate) {
  const kind = candidate && candidate.kind;
  if (kind === 'execution_task') {
    if (candidate.lane === 'fleet_task') return 'internal';
    if (candidate.lane === 'ceo_decision') return 'strategic';
    return candidate.targetObjectiveId ? 'internal' : 'strategic';
  }
  return BLAST_RADIUS_MAP[kind] || 'strategic';
}
```

(d) In `runAgenticMeeting`, replace the state-gather + agenda + discussion sections (steps 1-3, lines ~180-223). Replace from `// 1. Gather state for the agenda` through the end of the discussion `for` loop with:

```js
  // 1. Gather state for the agenda + the knowledge brief
  const [objectives, campaigns, allocationRaw, runtimeMemory, tasksState, approvalQueueState,
    agentMemories, researchIntel, weeklyReports, agentSeedMemories, socialAccountStats] = await Promise.all([
    storage.getState('objectives').then(function (v) { return v || []; }),
    storage.getState('campaigns').then(function (v) { return v || []; }),
    storage.getState('capitalAllocation').then(function (v) { return v || null; }),
    storage.getState('runtimeMemory').then(function (v) { return v || {}; }),
    storage.getState('tasks').then(function (v) { return v || []; }),
    storage.getState('approvalQueue').then(function (v) { return v || []; }),
    storage.getState('agentMemories').then(function (v) { return v || {}; }),
    storage.getState('researchIntel').then(function (v) { return v || []; }),
    storage.getState('weeklyReports').then(function (v) { return v || {}; }),
    storage.getState('agentSeedMemories').then(function (v) { return v || {}; }),
    storage.getState('socialAccountStats').then(function (v) { return v || {}; })
  ]);
  const allocation = _flattenAllocation(allocationRaw);

  // Shared brief — reuse the heartbeat's cached worldState, else rebuild it (fail-open).
  let worldState = runtimeMemory.worldState;
  if (!worldState || !worldState.generatedAt) {
    try {
      worldState = buildWorldState({
        financeDigest: runtimeMemory.financeDigest, revenueDigest: runtimeMemory.revenueDigest,
        outcomeDigest: runtimeMemory.outcomeDigest, strategicDigest: runtimeMemory.strategicDigest,
        forgeOpsDigest: runtimeMemory.forgeOpsDigest, contentDigest: runtimeMemory.contentDigest,
        socialAccountStats: socialAccountStats, campaigns: campaigns, objectives: objectives,
        tasks: tasksState, approvalQueue: approvalQueueState
      }, nowMs);
    } catch (_e) { worldState = null; }
  }
  let brief = '';
  try { brief = meetingBrief.buildSharedBrief(worldState, runtimeMemory.outcomeDigest); } catch (_e) { brief = ''; }

  // Topics already in front of the CEO — so Nova does not re-raise them.
  const pendingTopics = (approvalQueueState || [])
    .filter(function (q) { return q && q.status === 'pending' && (q.type === 'decision_request' || /_proposal$/.test(q.type || '')); })
    .map(function (q) { return String(q.title || q.name || '').slice(0, 60); }).filter(Boolean);

  // 2. Agenda proposal (Nova), fed the brief
  const agendaReply = await callModel(prompts.buildAgendaPrompt('nova', brief, pendingTopics), 'nova');
```

Leave the agenda-parse / not-convened block exactly as it is. Then replace the discussion `for` loop (the `for (const agentId of MEETING_ATTENDEES)` block at ~218) with:

```js
  // 3. Discussion (each attendee once, sees prior transcript + their own memory)
  const transcriptParts = [];
  const turns = [];
  for (const agentId of MEETING_ATTENDEES) {
    let slice = '';
    try {
      slice = meetingBrief.buildAgentMemorySlice(agentId, {
        agentMemories: agentMemories, researchIntel: researchIntel,
        weeklyReports: weeklyReports, agentSeedMemories: agentSeedMemories
      });
    } catch (_e) { slice = ''; }
    const reply = await callModel(prompts.buildDiscussionPrompt(agentId, agenda, transcriptParts.join('\n\n'), brief, slice), agentId);
    const items = parseItemsFromReply(reply || '', agentId);
    turns.push({ agentId: agentId, text: reply || '(no response)', items: items });
    transcriptParts.push(agentId + ': ' + (reply || '(no response)'));
  }
```

(e) Replace the routing block (step 6, lines ~256-274) with lane-aware routing + dedup:

```js
  // 6. Route by blast radius, after cross-meeting dedup.
  const internalCreated = [], proposalsQueued = [], suppressedDuplicates = [];
  const passed = candidates.filter(function (c) { return c.passed; });

  const existingTasks = (tasksState || []).filter(function (t) { return t && t.status !== 'done' && t.status !== 'archived'; });
  const cutoff14d = nowMs - 14 * 86400000;
  const existingDecisions = (approvalQueueState || []).filter(function (q) {
    return q && q.type === 'decision_request' && (q.status === 'pending' || (Date.parse(q.createdAt || '') || 0) >= cutoff14d);
  });
  const existingProposalsByType = {}; // type → array of {title, targetObjectiveId}
  (approvalQueueState || []).forEach(function (q) {
    if (q && q.status === 'pending' && /_proposal$/.test(q.type || '')) {
      (existingProposalsByType[q.type] = existingProposalsByType[q.type] || []).push({ title: q.title || q.name });
    }
  });

  const internalPassed = passed.filter(function (c) { return c.blastRadius === 'internal'; });
  const strategicPassed = passed.filter(function (c) { return c.blastRadius === 'strategic'; });

  if (internalPassed.length) {
    const tasks = (await storage.getState('tasks')) || [];
    const activeCount = tasks.filter(function (t) { return t && t.status !== 'done' && t.status !== 'archived'; }).length;
    let created = 0;
    internalPassed.forEach(function (c) {
      if (meetingBrief.isDuplicateTopic(c, existingTasks)) { suppressedDuplicates.push({ title: c.title, lane: c.lane || c.kind }); return; }
      if (activeCount + created >= 50) { log('[agenticMeeting] task ceiling hit, skipping: ' + c.title); return; }
      const t = _routeInternalTask(c, 'amtg-' + nowMs, nowIso); tasks.push(t); internalCreated.push(t.id);
      existingTasks.push({ title: t.title, targetObjectiveId: t.objective_id }); created++;
    });
    await storage.setState('tasks', tasks);
  }

  if (strategicPassed.length) {
    const aq = (await storage.getState('approvalQueue')) || [];
    const meetingStub = { id: 'amtg-' + nowMs };
    strategicPassed.forEach(function (c) {
      if (c.kind === 'execution_task' && c.lane === 'ceo_decision') {
        if (meetingBrief.isDuplicateTopic(c, existingDecisions)) { suppressedDuplicates.push({ title: c.title, lane: 'ceo_decision' }); return; }
        const dr = _routeDecisionRequest(c, meetingStub.id, nowIso); aq.push(dr); proposalsQueued.push(dr.id);
        c.proposalId = dr.id; existingDecisions.push({ title: dr.title });
      } else {
        const p = _routeStrategicProposal(c, meetingStub, nowIso);
        const peers = existingProposalsByType[p.type] || [];
        if (meetingBrief.isDuplicateTopic(c, peers)) { suppressedDuplicates.push({ title: c.title, lane: c.kind }); return; }
        aq.push(p); proposalsQueued.push(p.id); c.proposalId = p.id; peers.push({ title: p.title });
        existingProposalsByType[p.type] = peers;
      }
    });
    await storage.setState('approvalQueue', aq);
  }
```

(f) Add `suppressedDuplicates` to the persisted record. In the `record` object (step 7, ~277), add the field to `routed`:

```js
    routed: { internalCreated: internalCreated, proposalsQueued: proposalsQueued },
    suppressedDuplicates: suppressedDuplicates,
```

(g) Pin the default model to Sonnet (fallback to global). Replace line ~178:

```js
  const callModel = opts.callModel || async function (prompt, agentId) {
    const r = await gemini.callWithModel(prompt, agentId, 'claude-sonnet');
    if (r != null) return r;
    const active = await gemini.getActiveModel().catch(function () { return { key: 'gemini' }; });
    return gemini.callWithModel(prompt, agentId, active.key);
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/companyMeeting/meeting-core.test.js`
Expected: PASS — all tests green, including the updated e2e (fleet_task→task assigned to cipher, ceo_decision→decision_request) and the new dedup test.

- [ ] **Step 5: Commit**

```bash
git add api/companyMeeting/meeting-core.js api/companyMeeting/meeting-core.test.js
git commit -m "feat(meetings): brief+memory feed, lane routing, dedup, Sonnet pin"
```

---

## Task 8: Render `decision_request` on the Meetings page

**Files:**
- Modify: `modules/company/meetings.html`

- [ ] **Step 1: Locate how meeting candidates/proposals render**

Run: `grep -n "task_proposal\|decided\|proposalDecide\|candidate" modules/company/meetings.html | head -40`
Expected: find the render function + the Approve/Reject handler that posts to `/api/proposalDecide`.

- [ ] **Step 2: Add `decision_request` to the rendered/approvable types**

In `modules/company/meetings.html`, wherever the per-candidate render maps proposal `type` to a label/badge, add a `decision_request` case rendering a "DECISION" badge, the `profitThesis` line, and the existing Approve/Reject buttons (they already POST `{id, decision}` to `/api/proposalDecide`, which flips status; `decision_request` needs no materialization, so it is a status-flip-only type — `materializeFromProposal` already returns `null` for unknown types, which is correct).

Concretely, in the type-to-label map add:

```js
decision_request: { label: 'CEO DECISION', cls: 'badge-decision' },
```

and in the card body, after the title, render the thesis when present:

```js
(p.profitThesis ? '<div class="cand-thesis">Why it matters: ' + esc(p.profitThesis) + '</div>' : '')
```

(Match the existing `esc()` helper and class-naming already used in the file.)

- [ ] **Step 3: Verify `proposalDecide` leaves `decision_request` as status-flip-only**

Run: `grep -n "decision_request\|materializeFromProposal\|return null" api/proposalDecide/materialize.js`
Expected: confirm `materializeFromProposal` returns `null` for any type not in {campaign_proposal, objective_proposal, task_proposal}. `decision_request` is not listed → returns `null` → `proposalDecide` only flips status. No code change needed in materialize.js. (If a future change adds materialization types, keep `decision_request` out of them.)

- [ ] **Step 4: Manual smoke (post-deploy)**

After deploy, open the Meetings page; a `decision_request` from a meeting shows the DECISION badge + thesis + Approve/Reject; approving flips its status with no entity created.

- [ ] **Step 5: Commit**

```bash
git add modules/company/meetings.html
git commit -m "feat(meetings): render decision_request entries with approve/reject"
```

---

## Task 9: Verify triggers honor the model pin + full regression

**Files:**
- Inspect: `api/agenticMeetingCron/index.js`, `api/agentic-meeting-trigger/index.js`

- [ ] **Step 1: Confirm the triggers rely on the default `callModel`**

Run: `grep -n "callModel\|runAgenticMeeting" api/agenticMeetingCron/index.js api/agentic-meeting-trigger/index.js`
Expected: they call `runAgenticMeeting({ storage, ... })` WITHOUT passing `callModel`. If so, the Sonnet-pinned default (Task 7g) applies automatically — no change needed.

- [ ] **Step 2: If a trigger DOES pass `callModel`, remove that argument**

Only if Step 1 shows a `callModel:` key in a trigger's `runAgenticMeeting({...})` call, delete that key so the pinned default is used. (Do not add new model wiring in the trigger — the pin lives in `meeting-core`.)

- [ ] **Step 3: Run all touched test suites**

Run:
```
node api/companyHeartbeat/gemini.test.js
node api/companyMeeting/meeting-brief.test.js
node api/companyMeeting/meeting-core.test.js
node api/proposalDecide/materialize.test.js
```
Expected: every suite prints `N passed, 0 failed`.

- [ ] **Step 4: Syntax-check the changed server modules**

Run:
```
node --check api/companyHeartbeat/gemini.js
node --check api/companyMeeting/meeting-brief.js
node --check api/companyMeeting/meeting-core.js
node --check api/companyMeeting/prompts.js
```
Expected: no output (all OK).

- [ ] **Step 5: Commit any trigger change + push to deploy**

```bash
git add -A api/agenticMeetingCron api/agentic-meeting-trigger
git commit -m "chore(meetings): ensure triggers use the Sonnet-pinned default model" || echo "no trigger change needed"
git push origin master
```

- [ ] **Step 6: Post-deploy verification**

Trigger one meeting (`POST /api/agentic-meeting-trigger` with `x-company-secret: pixelpusher`), then read the latest `agenticMeetings` record and confirm: (a) outputs carry `lane`/`profitThesis`, (b) a `fleet_task` landed on the task board assigned to a real agent, (c) a `ceo_decision` is a `decision_request` in `approvalQueue`, (d) `suppressedDuplicates` is present when a topic repeats, (e) no duplicate of an already-pending topic was created.

---

## Self-Review Notes

- **Spec coverage:** shared brief (Task 2), per-agent memory (Task 3), dedup (Task 4 + wiring in 7e), two-lane output (Tasks 5/6/7), `decision_request` render (Task 8), Sonnet pin + fallback (Tasks 1/7g/9), error handling = fail-open in every builder (Tasks 2/3 + try-catch wiring in 7d), testing throughout. All spec sections map to a task.
- **Type consistency:** `buildSharedBrief(worldState, outcomeDigest)`, `buildAgentMemorySlice(agentId, mem)`, `isDuplicateTopic(candidate, existing)`, `callWithModel(prompt, agentId, modelKey)` used identically across tasks. Item fields `lane`/`owner`/`deliverable`/`profitThesis`/`targetObjectiveId` consistent between parse (Task 6) and routing (Task 7).
- **Known network-test gap:** the Sonnet pin/fallback wrapper (Task 7g) is prod-only network code; its model-selection branch is unit-tested via `_isClaudeModel` (Task 1), and end-to-end meeting logic is tested with an injected `callModel`. Accepted exception (network dependency); verified manually post-deploy (Task 9 Step 6).

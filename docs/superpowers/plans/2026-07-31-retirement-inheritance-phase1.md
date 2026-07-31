# Retirement Knowledge Inheritance — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a CEO approves an `agent_retire_proposal`, freeze that agent's memories and weekly reports into a new `agentInheritance` escrow, so the material survives for a future successor.

**Architecture:** Two pure functions in `api/_utils/inheritanceEscrow.js` (build the escrow, insert it idempotently), called from a new non-fatal step in the existing retire branch of `api/approveProposal/index.js`. All IO stays in the call site, matching how that branch already reads and writes state. Nothing reads the escrow yet — delivery is Phase 2.

**Tech Stack:** Node.js (Azure Functions v3, CommonJS). Tests are `node:assert` scripts run directly with `node`, matching `api/_utils/vale-actions.test.js`. No test framework, no Python.

**Spec:** `docs/superpowers/specs/2026-07-31-retirement-knowledge-inheritance-design.md`

---

## Context the engineer needs

**Why this exists.** The ladder prompt tells a retiring agent *"Your successor would inherit your memories"* (`api/companyHeartbeat/rewards-engine.js:783`). Retirement currently reassigns tasks, archives the registry entry and writes a governance log — it never touches memories.

**Why it is urgent even though retirement deletes nothing.** `api/memoryConsolidate/index.js:75` loops over **every** key in `agentMemories` with no active-agent filter, collapsing clusters of 5+ similar entries older than 7 days. An archived agent's bucket keeps being compressed forever. The snapshot must be taken at retirement or the source quietly degrades.

**Blast radius.** `api/approveProposal/index.js` executes CEO decisions for hire / retire / evolve / product proposals. The retire branch is documented as the delicate one (see its header comment on write ordering and idempotency). The new step is additive, wrapped in `try/catch`, and never blocks the retirement. `agentMemories` is **read only** — never written, never deleted.

**Measured sizes (live, 2026-07-31).** Largest per-agent memory bucket is cipher at 50 entries / **24,063 bytes**. `weeklyReports` is not a `company-state` VALID_KEY so it cannot be read from the CLI, but it is capped at 12 entries per agent (`agent-runner.js`) and server-side `storage.getState('weeklyReports')` works normally. A single escrow is tens of KB — no size concern.

**Cannot be tested end-to-end.** Firing the real path requires approving a real `agent_retire_proposal`, which archives a live agent. That is destructive and out of scope. Verification is unit tests plus a read-only dry run against real production memory data (Task 4).

---

## File Structure

| File | Responsibility |
|---|---|
| Create: `api/_utils/inheritanceEscrow.js` | Pure escrow construction + idempotent insert. No IO, no imports. |
| Create: `api/_utils/inheritanceEscrow.test.js` | `node:assert` tests for the above. |
| Modify: `api/company-state/index.js` | Add `agentInheritance` to `VALID_KEYS` so the escrow is readable. |
| Modify: `api/approveProposal/index.js` | Require the module; add capture step to the retire branch; extend the governance entry. |

---

## Task 1: Make `agentInheritance` a readable state key

**Files:**
- Modify: `api/company-state/index.js:34` (end of the `VALID_KEYS` array)

- [ ] **Step 1: Add the key**

The array currently ends:

```js
  'capitalAllocation',
  'agentRegistry',
  'emergenceDigest',
  'companyStrategy',
  'asProspects'
];
```

Change to:

```js
  'capitalAllocation',
  'agentRegistry',
  'emergenceDigest',
  'companyStrategy',
  'asProspects',
  'agentInheritance'
];
```

- [ ] **Step 2: Verify the key is now accepted**

Run:

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=agentInheritance" \
  -H "x-company-secret: pixelpusher"
```

Expected **before deploy**: a JSON body starting `{"error":"Invalid or missing key. Valid keys: ...` — this confirms the endpoint currently rejects it. The key becomes valid only after CI/CD deploys. Do not block on the deployed result; the local edit is what this task delivers.

- [ ] **Step 3: Commit**

```bash
git add api/company-state/index.js
git commit -m "feat(inheritance): add agentInheritance to company-state VALID_KEYS"
```

---

## Task 2: The pure escrow module

**Files:**
- Create: `api/_utils/inheritanceEscrow.js`
- Test: `api/_utils/inheritanceEscrow.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/_utils/inheritanceEscrow.test.js` with exactly this content:

```js
// Run with: node api/_utils/inheritanceEscrow.test.js
const assert = require('assert');
const e = require('./inheritanceEscrow');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
}

const CAPTURED = '2026-10-01T12:00:00.000Z';
const REG = { id: 'pixel', name: 'Pixel', role: 'Design — Director' };
const MEMS = [
  { text: 'Hero images under 200KB load before the fold', type: 'learning', timestamp: '2026-09-01T00:00:00Z' },
  { text: 'Prospect replies convert worse with media attached', type: 'learning', timestamp: '2026-09-02T00:00:00Z' }
];
const REPORTS = [{ id: 'wr_1', date: '2026-09-07', text: 'Shipped 3 hero images.' }];

function mkInput(over) {
  return Object.assign({
    agentId: 'pixel', registryEntry: REG, memories: MEMS, reports: REPORTS,
    retiredAt: '2026-10-01T11:59:00.000Z', retiredReason: 'Three seasons below par.',
    capturedAt: CAPTURED
  }, over || {});
}

test('buildEscrow produces a self-describing snapshot with correct counts', () => {
  const esc = e.buildEscrow(mkInput());
  assert.strictEqual(esc.agentId, 'pixel');
  assert.strictEqual(esc.name, 'Pixel');
  assert.strictEqual(esc.role, 'Design — Director');
  assert.strictEqual(esc.status, 'raw', 'Phase 2 owns every other status');
  assert.strictEqual(esc.memoryCount, 2);
  assert.strictEqual(esc.reportCount, 1);
  assert.strictEqual(esc.raw.memories.length, 2);
  assert.strictEqual(esc.raw.reports.length, 1);
  assert.strictEqual(esc.capturedAt, CAPTURED);
  assert.strictEqual(esc.retiredReason, 'Three seasons below par.');
});

test('an agent with nothing recorded still gets an escrow, not a missing one', () => {
  // The record must show the agent genuinely had nothing, rather than looking
  // like the capture failed.
  const esc = e.buildEscrow(mkInput({ memories: undefined, reports: null }));
  assert.strictEqual(esc.memoryCount, 0);
  assert.strictEqual(esc.reportCount, 0);
  assert.deepStrictEqual(esc.raw.memories, []);
  assert.deepStrictEqual(esc.raw.reports, []);
});

test('buildEscrow deep-copies, so the live agentMemories bucket is never aliased', () => {
  const source = [{ text: 'original', type: 'learning' }];
  const esc = e.buildEscrow(mkInput({ memories: source }));
  esc.raw.memories[0].text = 'mutated';
  assert.strictEqual(source[0].text, 'original', 'source memory must be untouched');
});

test('buildEscrow tolerates garbage input without throwing', () => {
  // The call site is non-fatal, but it must not be the thing that throws.
  const esc = e.buildEscrow(null);
  assert.strictEqual(esc.agentId, '');
  assert.strictEqual(esc.memoryCount, 0);
  assert.strictEqual(esc.status, 'raw');
});

test('captureEscrow inserts a new escrow and stamps updatedAt', () => {
  const esc = e.buildEscrow(mkInput());
  const r = e.captureEscrow({}, esc, CAPTURED);
  assert.strictEqual(r.added, true);
  assert.strictEqual(r.store.escrows.pixel.agentId, 'pixel');
  assert.strictEqual(r.store.updatedAt, CAPTURED);
});

test('captureEscrow is idempotent — an existing escrow always wins', () => {
  // Re-approving a retirement must not overwrite a frozen snapshot with a
  // consolidation-degraded one.
  const first = e.buildEscrow(mkInput());
  const r1 = e.captureEscrow({}, first, CAPTURED);
  const degraded = e.buildEscrow(mkInput({ memories: [] }));
  const r2 = e.captureEscrow(r1.store, degraded, '2026-11-01T00:00:00.000Z');
  assert.strictEqual(r2.added, false);
  assert.strictEqual(r2.store.escrows.pixel.memoryCount, 2, 'original snapshot preserved');
});

test('captureEscrow does not mutate the store it is given', () => {
  const store = { escrows: {}, updatedAt: null };
  e.captureEscrow(store, e.buildEscrow(mkInput()), CAPTURED);
  assert.deepStrictEqual(store.escrows, {}, 'input store must be untouched');
});

test('captureEscrow refuses an escrow with no agentId', () => {
  const r = e.captureEscrow({}, { agentId: '' }, CAPTURED);
  assert.strictEqual(r.added, false);
  assert.deepStrictEqual(r.store.escrows, {});
});

test('captureEscrow preserves escrows for other agents', () => {
  const r1 = e.captureEscrow({}, e.buildEscrow(mkInput()), CAPTURED);
  const other = e.buildEscrow(mkInput({ agentId: 'forge', registryEntry: { name: 'Forge', role: 'Ops' } }));
  const r2 = e.captureEscrow(r1.store, other, CAPTURED);
  assert.strictEqual(r2.added, true);
  assert.strictEqual(Object.keys(r2.store.escrows).sort().join(','), 'forge,pixel');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node api/_utils/inheritanceEscrow.test.js
```

Expected: the process throws `Cannot find module './inheritanceEscrow'` — the module does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/_utils/inheritanceEscrow.js` with exactly this content:

```js
// Track C Phase 1 — freeze a retiring agent's knowledge into the agentInheritance
// escrow.
//
// Retirement itself deletes nothing, but memoryConsolidate iterates EVERY key in
// agentMemories with no active-agent filter (memoryConsolidate/index.js:75), so an
// archived agent's memories keep being collapsed forever. The snapshot has to be
// taken at retirement or the source quietly degrades.
//
// Pure functions only — all IO lives in the approveProposal retire branch. Nothing
// reads these escrows yet; distillation, hire-time matching and the successor prompt
// block are Phase 2, which owns every status other than 'raw'.
//
// Spec: docs/superpowers/specs/2026-07-31-retirement-knowledge-inheritance-design.md

'use strict';

function _clone(list) {
  if (!Array.isArray(list)) return [];
  try { return JSON.parse(JSON.stringify(list)); } catch (_e) { return []; }
}

// Freeze one retiring agent's knowledge. Never mutates or aliases its inputs — the
// source agentMemories bucket must survive exactly as it was, because it is the
// recovery path if this capture is ever lost.
function buildEscrow(input) {
  const i = input || {};
  const reg = i.registryEntry || {};
  const agentId = String(i.agentId || '');
  const memories = _clone(i.memories);
  const reports = _clone(i.reports);
  return {
    agentId: agentId,
    name: reg.name || agentId,
    role: reg.role || '',
    retiredAt: i.retiredAt || null,
    retiredReason: i.retiredReason || '',
    capturedAt: i.capturedAt || null,
    status: 'raw',
    memoryCount: memories.length,
    reportCount: reports.length,
    raw: { memories: memories, reports: reports }
  };
}

// Idempotent insert. An existing escrow always wins: a re-approved retirement must
// never overwrite a frozen snapshot with a consolidation-degraded one.
function captureEscrow(store, escrow, nowIso) {
  const src = (store && typeof store === 'object') ? store : {};
  const escrows = (src.escrows && typeof src.escrows === 'object') ? src.escrows : {};
  const id = escrow && escrow.agentId;
  if (!id || escrows[id]) {
    return { store: { escrows: escrows, updatedAt: src.updatedAt || null }, added: false };
  }
  const merged = Object.assign({}, escrows);
  merged[id] = escrow;
  return { store: { escrows: merged, updatedAt: nowIso || null }, added: true };
}

module.exports = { buildEscrow, captureEscrow };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
node api/_utils/inheritanceEscrow.test.js
```

Expected final line: `9 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/_utils/inheritanceEscrow.js api/_utils/inheritanceEscrow.test.js
git commit -m "feat(inheritance): pure escrow build + idempotent capture, 9 tests"
```

---

## Task 3: Capture at retirement

**Files:**
- Modify: `api/approveProposal/index.js:17` (imports)
- Modify: `api/approveProposal/index.js:201-220` (retire branch: after the registry flip, before the governance log)

- [ ] **Step 1: Add the import**

Find line 17:

```js
const { DOMAIN_LEAD_MAP } = require('../companyHeartbeat/constants');
```

Change to:

```js
const { DOMAIN_LEAD_MAP } = require('../companyHeartbeat/constants');
const { buildEscrow, captureEscrow } = require('../_utils/inheritanceEscrow');
```

- [ ] **Step 2: Insert the capture step**

In the `agent_retire_proposal` branch, find this exact block:

```js
          // Step 3: governance log (non-fatal)
          try {
            const gov = (await storage.getState('governanceLog')) || [];
            gov.push({
              at: target.resolvedAt, type: 'agent-retired',
              targetAgent: targetAgentId, reassignedCount: reassignedCount,
              ceoNote: ceoNote, proposalId: target.id
            });
```

Replace it with:

```js
          // Step 2.5: Track C Phase 1 — freeze this agent's knowledge into the
          // inheritance escrow. Retirement deletes nothing, but memoryConsolidate
          // keeps collapsing an archived agent's memories, so the snapshot has to be
          // taken now. Non-fatal by design: a storage failure must never block a CEO
          // retirement, and agentMemories is left intact as the recovery path.
          let inheritanceCaptured = false;
          let inheritanceCounts = { memories: 0, reports: 0 };
          try {
            const escrowStore = (await storage.getState('agentInheritance')) || {};
            const existing = (escrowStore.escrows || {})[targetAgentId];
            if (existing) {
              inheritanceCaptured = true;
              inheritanceCounts = {
                memories: existing.memoryCount || 0,
                reports: existing.reportCount || 0
              };
            } else {
              const allMemories = (await storage.getState('agentMemories')) || {};
              const allReports = (await storage.getState('weeklyReports')) || {};
              const nowIso = new Date().toISOString();
              const escrow = buildEscrow({
                agentId: targetAgentId,
                registryEntry: reg || {},
                memories: allMemories[targetAgentId],
                reports: allReports[targetAgentId],
                retiredAt: target.resolvedAt,
                retiredReason: ceoNote || (target.retire.rationale || '').substring(0, 500),
                capturedAt: nowIso
              });
              const captured = captureEscrow(escrowStore, escrow, nowIso);
              if (captured.added) await storage.setState('agentInheritance', captured.store);
              inheritanceCaptured = captured.added;
              inheritanceCounts = { memories: escrow.memoryCount, reports: escrow.reportCount };
            }
          } catch (_inhErr) {
            context.log.error('[approveProposal] inheritance capture failed (non-fatal):',
              String(_inhErr).substring(0, 200));
          }

          // Step 3: governance log (non-fatal)
          try {
            const gov = (await storage.getState('governanceLog')) || [];
            gov.push({
              at: target.resolvedAt, type: 'agent-retired',
              targetAgent: targetAgentId, reassignedCount: reassignedCount,
              ceoNote: ceoNote, proposalId: target.id,
              inheritanceCaptured: inheritanceCaptured,
              inheritanceCounts: inheritanceCounts
            });
```

Note: `reg` is the registry entry already declared in step 2 of the same block scope; it is `undefined` if the agent was not found, which `buildEscrow` handles via `reg || {}`.

- [ ] **Step 3: Verify the file still parses**

Run:

```bash
node -e "require('./api/approveProposal/index.js'); console.log('approveProposal loads OK')"
```

Expected: `approveProposal loads OK`

- [ ] **Step 4: Update the file header comment**

The header documents the retire write order. Find:

```js
//   Write order: approvalQueue (status flip) → tasks (reassignment) →
//   agentRegistry (archive) → governanceLog (audit). On partial failure CEO
//   retries — all steps are idempotent by state-check, not proposal-ID tracking
//   (except evolve's doctrineHistory which uses proposalId).
```

Change to:

```js
//   Write order: approvalQueue (status flip) → tasks (reassignment) →
//   agentRegistry (archive) → agentInheritance (knowledge escrow, non-fatal) →
//   governanceLog (audit). On partial failure CEO retries — all steps are
//   idempotent by state-check, not proposal-ID tracking (except evolve's
//   doctrineHistory which uses proposalId).
```

- [ ] **Step 5: Commit**

```bash
git add api/approveProposal/index.js
git commit -m "feat(inheritance): capture retiring agent's memories into escrow on retire approval"
```

---

## Task 4: Verification

**Files:** none modified.

- [ ] **Step 1: Run every affected suite**

Run each and confirm the expected line:

```bash
node api/_utils/inheritanceEscrow.test.js
node api/companyHeartbeat/rewards-engine.test.js
node api/companyHeartbeat/smoke-test.js
node modules/company/js/seasons.test.js
```

Expected: `9 passed, 0 failed` · `73 passed, 0 failed` · `Results: 25 passed, 0 failed` · `14 passed, 0 failed`

- [ ] **Step 2: Dry-run the capture against real production memories (read-only)**

This proves the escrow builds correctly at real size without approving anything. Save as `scratchpad/dryrun-escrow.js` (scratchpad, not the repo):

```js
const https = require('https');
const { buildEscrow, captureEscrow } = require('C:/Dev/Ambientpixels/ambientpixels/api/_utils/inheritanceEscrow');

function get(key) {
  return new Promise((res, rej) => {
    https.get('https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=' + key,
      { headers: { 'x-company-secret': 'pixelpusher' } }, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
      }).on('error', rej);
  });
}

(async () => {
  const mems = await get('agentMemories');
  const store = mems.value || mems;
  let acc = {};
  for (const id of Object.keys(store)) {
    if (!Array.isArray(store[id])) continue;
    const esc = buildEscrow({
      agentId: id, registryEntry: { name: id, role: 'dry-run' },
      memories: store[id], reports: [],
      retiredAt: '2026-10-01T00:00:00Z', retiredReason: 'dry run', capturedAt: '2026-10-01T00:00:00Z'
    });
    const r = captureEscrow(acc, esc, '2026-10-01T00:00:00Z');
    acc = r.store;
    console.log(id.padEnd(9), 'memories', String(esc.memoryCount).padStart(3),
      '| escrow bytes', JSON.stringify(esc).length);
  }
  console.log('total escrow store bytes:', JSON.stringify(acc).length);
  console.log('re-capture adds nothing:', captureEscrow(acc, buildEscrow({ agentId: 'pixel' }), 'x').added === false);
})();
```

Run: `node scratchpad/dryrun-escrow.js`

Expected: one line per agent with a non-zero byte count, largest around **24,000 bytes** (cipher), and a final `re-capture adds nothing: true`.

- [ ] **Step 3: Confirm nothing was written**

The dry run is read-only and the real path only fires on a retirement approval, so the key must still be absent. Run:

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=agentInheritance" \
  -H "x-company-secret: pixelpusher"
```

Expected after deploy: `null` or an empty body — **not** a populated `escrows` object. A populated result means something wrote state that should not have; stop and investigate before proceeding.

- [ ] **Step 4: Commit any stragglers and confirm a clean tree**

```bash
git status --short
```

Expected: no modified tracked files under `api/`.

---

## Self-review notes

**Spec coverage:** §5.1 escrow shape → Task 2 Step 3. §5.1 VALID_KEYS → Task 1. §5.2 capture, idempotency, non-fatal, source-not-deleted, self-describing name/role → Task 3 Step 2, tested in Task 2 Step 1. §5.3 governance visibility → Task 3 Step 2. §5.4 all five listed test cases → Task 2 Step 1 (the storage-failure case is covered structurally by the `try/catch` plus the "tolerates garbage input" test, since a live storage failure cannot be unit-tested from here).

**Deliberately not built (Phase 2, spec §6):** distillation, the cron and trigger endpoint, `successorTo` on hire, the successor prompt block, ageing, and stuck-escrow alerting. Nothing in this plan reads an escrow.

**Deployment note:** this repo auto-pushes to production. Task 1 and Task 2 are inert on their own (a new valid key nobody writes; a module nobody imports). Task 3 is the first commit that changes behaviour, and only on the retire path, which cannot fire before the first CEO retirement approval — earliest 2026-10-01.

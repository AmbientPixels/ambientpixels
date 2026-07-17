# reflectionWriterCron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone daily cron that guarantees every reflection-overdue agent gets a grounded `type:'reflection'` memory written, independent of the fleet model's voluntary compliance.

**Architecture:** A new Azure Function `reflectionWriterCron` (timer, 15:30 UTC) reads `runtimeMemory.reflectionDigest`, selects overdue agents, generates each a reflection via the heartbeat's existing `callGeminiProposal` (gemini-pro, with a deterministic template fallback), and writes it to `agentMemories` labeled `source:'auto:reflection'`. Pure logic lives in a separate `reflectionWriter.js` module (unit-tested); `index.js` is the thin I/O shell. Two additive changes surface the auto-label on the awareness dashboard. Zero edits to the heartbeat engine (`index.js`, `agent-runner.js`).

**Tech Stack:** Node.js (Azure Functions), `_utils/companyStorage`, `companyHeartbeat/gemini.js` (`callGeminiProposal`, `getActiveModel`), plain `assert` test harness (matches existing `_utils/*.test.js` convention).

---

## Repo / execution notes

- **Git root is `ambientpixels/`** (not the parent). All `git`, `git add`, and `node` commands below assume **cwd = `ambientpixels/`**.
- **Commit/push norms:** this repo's working tree is auto-committed and pushed by other agents/the loop. The plan includes local `git commit` steps per TDD discipline, but **do not `git push`** — deployment (Task 7) is an explicit, user-confirmed step.
- Run tests with plain Node: `node api/reflectionWriterCron/reflectionWriter.test.js` (no jest/mocha in this repo).
- **One assumption to confirm at start:** the reflection digest is read from `runtimeMemory.reflectionDigest`. This is stated by the ambientos-guide and consistent with `heartbeatRuns[-1].digestsBuilt.reflectionDigest`. If a first live run writes 0 with "no reflectionDigest present", re-check the key by reading `api/awarenessDigest/index.js` (it reads the same value the endpoint returns).

## File structure

| File | Responsibility |
|------|----------------|
| `api/reflectionWriterCron/reflectionWriter.js` | **Pure** helpers: select overdue agents, idempotency check, prompt builder, template fallback, memory factory, FIFO cap. No I/O. |
| `api/reflectionWriterCron/reflectionWriter.test.js` | Unit tests for every pure helper. |
| `api/reflectionWriterCron/index.js` | I/O shell: load state, loop overdue agents, call model / fallback, write `agentMemories`. |
| `api/reflectionWriterCron/function.json` | Timer trigger, `0 30 15 * * *`. |
| `api/companyHeartbeat/reflection-intel.js` | +1 field `lastReflectionAuto` on `perAgent[aid]` (additive). |
| `modules/company/awareness.html` | Append `(auto)` marker in `renderCadence` when `lastReflectionAuto`. |

---

### Task 1: Pure helpers — agent selection + idempotency

**Files:**
- Create: `api/reflectionWriterCron/reflectionWriter.js`
- Test: `api/reflectionWriterCron/reflectionWriter.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/reflectionWriterCron/reflectionWriter.test.js`:

```js
// Run with: node api/reflectionWriterCron/reflectionWriter.test.js
const assert = require('assert');
const R = require('./reflectionWriter');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const NOW = Date.UTC(2026, 6, 17, 1, 0, 0);
const HOUR = 3600000;

test('selectOverdueAgents returns only reflectionOverdue===true', () => {
  const digest = { perAgent: {
    nova:   { reflectionOverdue: true },
    cipher: { reflectionOverdue: false },
    echo:   { reflectionOverdue: true }
  } };
  const out = R.selectOverdueAgents(digest).map(o => o.agentId).sort();
  assert.deepStrictEqual(out, ['echo', 'nova']);
});

test('selectOverdueAgents is safe on empty/missing digest', () => {
  assert.deepStrictEqual(R.selectOverdueAgents(null), []);
  assert.deepStrictEqual(R.selectOverdueAgents({}), []);
});

test('hasRecentReflection true when a reflection is within skip window', () => {
  const list = [{ type: 'reflection', timestamp: new Date(NOW - 2 * HOUR).toISOString() }];
  assert.strictEqual(R.hasRecentReflection(list, NOW, 24), true);
});

test('hasRecentReflection false when the only reflection is older than window', () => {
  const list = [{ type: 'reflection', timestamp: new Date(NOW - 48 * HOUR).toISOString() }];
  assert.strictEqual(R.hasRecentReflection(list, NOW, 24), false);
});

test('hasRecentReflection ignores non-reflection types', () => {
  const list = [{ type: 'feedback', timestamp: new Date(NOW - 1 * HOUR).toISOString() }];
  assert.strictEqual(R.hasRecentReflection(list, NOW, 24), false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/reflectionWriterCron/reflectionWriter.test.js`
Expected: FAIL — `Cannot find module './reflectionWriter'`.

- [ ] **Step 3: Write minimal implementation**

Create `api/reflectionWriterCron/reflectionWriter.js`:

```js
// reflectionWriter.js — pure helpers for reflectionWriterCron (no I/O).

const MAX_TEXT_CHARS = 1000;
const SKIP_HOURS = 24;
const TTL_DAYS = 30;
const MAX_MEMORIES = 50;
const SOURCE = 'auto:reflection';
const DAY_MS = 86400000;

function selectOverdueAgents(reflectionDigest) {
  const pa = (reflectionDigest && reflectionDigest.perAgent) || {};
  return Object.keys(pa)
    .filter(id => pa[id] && pa[id].reflectionOverdue === true)
    .map(id => ({ agentId: id, data: pa[id] }));
}

function hasRecentReflection(memList, nowMs, skipHours) {
  const cutoff = nowMs - skipHours * 3600 * 1000;
  const list = Array.isArray(memList) ? memList : [];
  return list.some(m => {
    if (!m || m.type !== 'reflection') return false;
    const ts = Date.parse(m.timestamp || 0);
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

module.exports = {
  MAX_TEXT_CHARS, SKIP_HOURS, TTL_DAYS, MAX_MEMORIES, SOURCE,
  selectOverdueAgents, hasRecentReflection
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/reflectionWriterCron/reflectionWriter.test.js`
Expected: PASS — `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/reflectionWriterCron/reflectionWriter.js api/reflectionWriterCron/reflectionWriter.test.js
git commit -m "feat(reflection-cron): pure agent-selection + idempotency helpers"
```

---

### Task 2: Pure helpers — prompt builder + template fallback

**Files:**
- Modify: `api/reflectionWriterCron/reflectionWriter.js`
- Test: `api/reflectionWriterCron/reflectionWriter.test.js`

- [ ] **Step 1: Add the failing tests**

Append inside `reflectionWriter.test.js`, before the final `console.log` summary:

```js
const SAMPLE = {
  coreQuestion: 'Is my research producing intel other agents cite?',
  decisionPatterns: [{ decisionType: 'quality-gate-rewrite', total: 4, improved: 3, tied: 0, regressed: 1, pendingOutcome: 0 }],
  strategyFatigue: [{ signal: 'hookType:howto on x', attempts: 6, vsAgentMedian: -40 }],
  roleAdherence: { drift: 'under-producing' },
  repeatedFailures: [{ title: 'Draft competitor teardown', attempts: 3, status: 'in-progress' }]
};

test('buildReflectionPrompt embeds core question + a decision pattern + instruction', () => {
  const p = R.buildReflectionPrompt('scout', SAMPLE);
  assert.ok(p.indexOf('scout') !== -1);
  assert.ok(p.indexOf('Is my research producing intel') !== -1);
  assert.ok(p.indexOf('quality-gate-rewrite') !== -1);
  assert.ok(p.toLowerCase().indexOf('what you will change') !== -1);
});

test('buildTemplateFallback is non-empty and references drift + core question', () => {
  const t = R.buildTemplateFallback('scout', SAMPLE);
  assert.ok(t.length > 40);
  assert.ok(t.indexOf('under-producing') !== -1);
  assert.ok(t.indexOf('Is my research producing intel') !== -1);
});

test('buildTemplateFallback handles an empty digest slice without throwing', () => {
  const t = R.buildTemplateFallback('nova', {});
  assert.ok(typeof t === 'string' && t.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/reflectionWriterCron/reflectionWriter.test.js`
Expected: FAIL — `R.buildReflectionPrompt is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `reflectionWriter.js`, add these two functions above `module.exports`:

```js
function buildReflectionPrompt(agentId, a) {
  a = a || {};
  const parts = [];
  parts.push('You are ' + agentId + ', an autonomous agent at AmbientPixels writing a private self-reflection memory.');
  if (a.coreQuestion) parts.push('Your core question: "' + a.coreQuestion + '"');

  const dp = (a.decisionPatterns || []).map(function (p) {
    return '- ' + p.decisionType + ': ' + p.total + ' decisions (' + p.improved + ' improved, ' +
      p.regressed + ' regressed, ' + p.pendingOutcome + ' pending)';
  }).join('\n');
  parts.push('Your recent decision outcomes (14d):\n' + (dp || '- (no structured decisions logged)'));

  const sf = (a.strategyFatigue || []).map(function (f) {
    return '- ' + f.signal + ': ' + f.attempts + ' attempts, ' + Math.abs(f.vsAgentMedian) + '% below your median';
  }).join('\n');
  if (sf) parts.push('Strategy fatigue signals:\n' + sf);

  const rh = a.roleAdherence || {};
  parts.push('Role adherence: ' + (rh.drift || 'unknown') + '.');

  const rf = (a.repeatedFailures || []).map(function (f) {
    return '- ' + (f.title || f.taskId) + ' (' + f.attempts + ' failed attempts)';
  }).join('\n');
  if (rf) parts.push('Repeated failures:\n' + rf);

  parts.push('Write a concrete 100-180 word reflection answering BOTH: (1) what your recent outcomes show, referencing the specifics above; (2) what you will change going forward. Write in first person. Do not restate the data verbatim — synthesize it into a conclusion. Output ONLY the reflection prose, no preamble.');
  return parts.join('\n\n');
}

function buildTemplateFallback(agentId, a) {
  a = a || {};
  const rh = a.roleAdherence || {};
  const drift = rh.drift || 'on-role';
  const topDecision = (a.decisionPatterns || [])[0];
  const fatigue = (a.strategyFatigue || [])[0];
  const bits = ['Reflection (auto-generated from my activity digest).'];
  if (topDecision) {
    bits.push('Over the last 14 days my ' + topDecision.decisionType + ' decisions were ' +
      topDecision.improved + ' improved / ' + topDecision.regressed + ' regressed across ' +
      topDecision.total + ' total.');
  } else {
    bits.push('I have no structured decision outcomes logged in the last 14 days.');
  }
  bits.push('My role adherence reads as "' + drift + '".');
  if (fatigue) {
    bits.push('A fatigue signal shows ' + fatigue.signal + ' running ' + Math.abs(fatigue.vsAgentMedian) +
      '% below my median — worth changing approach.');
  }
  if (a.coreQuestion) {
    bits.push('Against my core question — ' + a.coreQuestion + ' — I will focus next cycle on the highest-leverage gap this data exposes' +
      (drift.indexOf('under-producing') === 0 ? ', starting by producing work in my core action types.' : '.'));
  }
  return bits.join(' ');
}
```

Then add `buildReflectionPrompt, buildTemplateFallback,` to the `module.exports` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/reflectionWriterCron/reflectionWriter.test.js`
Expected: PASS — `8 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/reflectionWriterCron/reflectionWriter.js api/reflectionWriterCron/reflectionWriter.test.js
git commit -m "feat(reflection-cron): reflection prompt builder + deterministic fallback"
```

---

### Task 3: Pure helpers — memory factory + FIFO cap

**Files:**
- Modify: `api/reflectionWriterCron/reflectionWriter.js`
- Test: `api/reflectionWriterCron/reflectionWriter.test.js`

- [ ] **Step 1: Add the failing tests**

Append inside `reflectionWriter.test.js`, before the final `console.log` summary:

```js
test('makeReflectionMemory sets type/source/TTL and caps text at 1000', () => {
  const long = 'y'.repeat(1500);
  const m = R.makeReflectionMemory({ text: long, now: NOW, model: 'gemini-pro' });
  assert.strictEqual(m.type, 'reflection');
  assert.strictEqual(m.source, 'auto:reflection');
  assert.strictEqual(m.text.length, 1000);
  assert.strictEqual(m.timestamp, new Date(NOW).toISOString());
  assert.strictEqual(new Date(m.expiresAt).getTime(), NOW + 30 * 86400000);
  assert.strictEqual(m.evidence.basis, 'digest');
  assert.strictEqual(m.evidence.model, 'gemini-pro');
  assert.ok(String(m.id).indexOf('mem-refl-') === 0);
});

test('capMemories keeps only the last MAX entries', () => {
  const list = [];
  for (let i = 0; i < 55; i++) list.push({ i: i });
  const capped = R.capMemories(list, 50);
  assert.strictEqual(capped.length, 50);
  assert.strictEqual(capped[0].i, 5);
  assert.strictEqual(capped[49].i, 54);
});

test('capMemories leaves a short list untouched', () => {
  const list = [{ i: 1 }, { i: 2 }];
  assert.strictEqual(R.capMemories(list, 50).length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/reflectionWriterCron/reflectionWriter.test.js`
Expected: FAIL — `R.makeReflectionMemory is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `reflectionWriter.js`, add above `module.exports`:

```js
function makeReflectionMemory(opts) {
  const now = opts.now;
  const text = String(opts.text || '').trim().slice(0, MAX_TEXT_CHARS);
  return {
    id: 'mem-refl-' + now + '-' + Math.random().toString(36).slice(2, 6),
    type: 'reflection',
    text: text,
    source: SOURCE,
    timestamp: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_DAYS * DAY_MS).toISOString(),
    evidence: { basis: 'digest', model: opts.model || null }
  };
}

function capMemories(list, max) {
  if (!Array.isArray(list)) return [];
  return list.length > max ? list.slice(-max) : list;
}
```

Then add `makeReflectionMemory, capMemories` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/reflectionWriterCron/reflectionWriter.test.js`
Expected: PASS — `11 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/reflectionWriterCron/reflectionWriter.js api/reflectionWriterCron/reflectionWriter.test.js
git commit -m "feat(reflection-cron): reflection memory factory + FIFO cap"
```

---

### Task 4: The cron I/O shell + timer binding

**Files:**
- Create: `api/reflectionWriterCron/index.js`
- Create: `api/reflectionWriterCron/function.json`

No unit test (network + storage I/O); verified live in Task 7. Every branch is guarded so a failure never throws out of the handler.

- [ ] **Step 1: Create `function.json`**

```json
{
  "bindings": [
    {
      "name": "timer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 30 15 * * *"
    }
  ]
}
```

- [ ] **Step 2: Create `index.js`**

```js
// reflectionWriterCron — Timer Trigger (daily @ 15:30 UTC)
//
// Guarantees the 3-day reflection cadence. Reads runtimeMemory.reflectionDigest,
// finds agents flagged reflectionOverdue, and writes each a grounded
// type='reflection' memory (source:'auto:reflection'). Reflection text is
// generated by the heartbeat's existing gemini-pro path (callGeminiProposal),
// with a deterministic template fallback so a bad/empty LLM response never leaves
// an agent overdue. Standalone — no changes to the heartbeat engine.

const storage = require('../_utils/companyStorage');
const gemini = require('../companyHeartbeat/gemini');
const demoGuard = require('../_utils/demoGuard');
const R = require('./reflectionWriter');

module.exports = async function (context) {
  if (demoGuard.timerSkip(context)) return;
  context.log('[reflectionWriterCron] start');

  let rt;
  try {
    rt = (await storage.getState('runtimeMemory')) || {};
  } catch (err) {
    context.log.error('[reflectionWriterCron] failed to load runtimeMemory:', (err && err.message) || err);
    return;
  }

  const digest = rt.reflectionDigest;
  if (!digest || !digest.perAgent) {
    context.log('[reflectionWriterCron] no reflectionDigest present — exiting');
    return;
  }

  const overdue = R.selectOverdueAgents(digest);
  if (overdue.length === 0) {
    context.log('[reflectionWriterCron] no overdue agents — nothing to do');
    return;
  }

  let memories;
  try {
    memories = (await storage.getState('agentMemories')) || {};
  } catch (err) {
    context.log.error('[reflectionWriterCron] failed to load agentMemories:', (err && err.message) || err);
    return;
  }

  let modelKey = null;
  try { modelKey = (await gemini.getActiveModel()).key; } catch (e) { modelKey = null; }

  const now = Date.now();
  let written = 0;
  const writtenAgents = [];

  for (let i = 0; i < overdue.length; i++) {
    const agentId = overdue[i].agentId;
    const data = overdue[i].data;
    const list = Array.isArray(memories[agentId]) ? memories[agentId] : [];

    if (R.hasRecentReflection(list, now, R.SKIP_HOURS)) {
      context.log('[reflectionWriterCron]', agentId, 'reflected within', R.SKIP_HOURS, 'h — skipping');
      continue;
    }

    let text = null;
    try {
      text = await gemini.callGeminiProposal(R.buildReflectionPrompt(agentId, data));
    } catch (e) {
      context.log.warn('[reflectionWriterCron]', agentId, 'LLM call failed:', (e && e.message) || e);
    }
    if (!text || !String(text).trim()) {
      text = R.buildTemplateFallback(agentId, data);
      context.log('[reflectionWriterCron]', agentId, 'used template fallback');
    }

    const mem = R.makeReflectionMemory({ text: text, now: now, model: modelKey });
    list.push(mem);
    memories[agentId] = R.capMemories(list, R.MAX_MEMORIES);
    written++;
    writtenAgents.push(agentId);
  }

  if (written > 0) {
    try {
      await storage.setState('agentMemories', memories);
      context.log('[reflectionWriterCron] wrote', written, 'reflections for:', writtenAgents.join(', '));
    } catch (err) {
      context.log.error('[reflectionWriterCron] failed to save agentMemories:', (err && err.message) || err);
    }
  } else {
    context.log('[reflectionWriterCron] complete — 0 reflections written');
  }
};
```

- [ ] **Step 3: Sanity-check the module loads (no syntax/require errors)**

Run: `node -e "require('./api/reflectionWriterCron'); console.log('loads OK')"`
Expected: `loads OK` (Azure resolves the folder to `index.js`; this confirms requires resolve — `../companyHeartbeat/gemini`, `../_utils/companyStorage`, `../_utils/demoGuard`, `./reflectionWriter`).

- [ ] **Step 4: Re-run the unit suite to confirm nothing regressed**

Run: `node api/reflectionWriterCron/reflectionWriter.test.js`
Expected: PASS — `11 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/reflectionWriterCron/index.js api/reflectionWriterCron/function.json
git commit -m "feat(reflection-cron): timer-triggered writer that fills overdue reflections"
```

---

### Task 5: Surface the auto-label in the reflection digest

**Files:**
- Modify: `api/companyHeartbeat/reflection-intel.js` (around lines 309 and 341)

Additive field only — no behavior change to existing consumers. The `awarenessDigest` endpoint returns the digest verbatim, so the new field flows through with no endpoint change.

- [ ] **Step 1: Add `lastReflectionAuto` derivation**

In `buildReflectionDigest`, immediately after this existing line (~309):

```js
    const lastReflectionAt = latestReflection ? latestReflection.timestamp : null;
```

add:

```js
    const lastReflectionAuto = !!(latestReflection && latestReflection.source === 'auto:reflection');
```

- [ ] **Step 2: Expose it on the per-agent object**

In the `perAgent[aid] = { ... }` object (~330-344), add this line next to `lastReflectionAt`:

```js
      lastReflectionAuto: lastReflectionAuto,
```

- [ ] **Step 3: Verify the module still loads**

Run: `node -e "require('./api/companyHeartbeat/reflection-intel'); console.log('reflection-intel loads OK')"`
Expected: `reflection-intel loads OK`.

- [ ] **Step 4: Commit**

```bash
git add api/companyHeartbeat/reflection-intel.js
git commit -m "feat(awareness): expose lastReflectionAuto on reflection digest"
```

---

### Task 6: Show the `(auto)` marker on the awareness dashboard

**Files:**
- Modify: `modules/company/awareness.html` (in `renderCadence`, ~line 256)

- [ ] **Step 1: Append the marker to the "last:" line**

Replace this exact block:

```js
        var last = a.lastReflectionAt
          ? 'last: ' + String(a.lastReflectionAt).substring(0, 10)
          : 'never reflected';
```

with:

```js
        var last = a.lastReflectionAt
          ? 'last: ' + String(a.lastReflectionAt).substring(0, 10) + (a.lastReflectionAuto ? ' (auto)' : '')
          : 'never reflected';
```

- [ ] **Step 2: Commit**

```bash
git add modules/company/awareness.html
git commit -m "feat(awareness): mark auto-written reflections in the cadence grid"
```

---

### Task 7: Deploy and verify live

**No code.** Deployment is `git push origin master` → GitHub Actions (per CLAUDE.md). **Confirm with the CEO before pushing.**

- [ ] **Step 1: Push (after CEO confirmation)**

```bash
git push origin master
```

- [ ] **Step 2: Confirm the function deployed**

After GitHub Actions completes, confirm the function is registered:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://ambientpixels-nova-api.azurewebsites.net/api/reflectionWriterCron"
```
Expected: a non-404 (timer functions aren't HTTP-invocable, but a 404 would mean the folder didn't deploy). Primary confirmation is the Azure Portal → Functions list showing `reflectionWriterCron`.

- [ ] **Step 3: Trigger once (Azure Portal → Functions → reflectionWriterCron → Code+Test → Run), then verify writes**

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/awarenessDigest" \
  -H "x-company-secret: pixelpusher" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const d=j.digest||j;console.log('overdue:',d.globals.reflectionsOverdue);Object.keys(d.perAgent).forEach(id=>{const a=d.perAgent[id];console.log(' ',id,'last:',a.lastReflectionAt,'auto:',a.lastReflectionAuto);});});"
```
Expected: `reflectionsOverdue` drops toward 0; agents show today's `lastReflectionAt` with `auto: true`.

- [ ] **Step 4: Eyeball reflection quality**

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=agentMemories" \
  -H "x-company-secret: pixelpusher" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s).value;Object.keys(m).forEach(id=>{(m[id]||[]).filter(x=>x.type==='reflection'&&x.source==='auto:reflection').forEach(x=>console.log('['+id+']',x.text.slice(0,160)));});});"
```
Expected: one grounded reflection per previously-overdue agent, referencing that agent's real data (not boilerplate). Spot-check nova and echo (previously zero reflections).

---

## Self-review

- **Spec coverage:** standalone cron (T1–4) ✓; gemini-pro content via `callGeminiProposal` (T4) ✓; deterministic fallback (T2, wired T4) ✓; idempotency 24h skip (T1, wired T4) ✓; `auto:reflection` label + 1000-char cap + 30d TTL (T3) ✓; daily 15:30 schedule (T4) ✓; transparency label on digest (T5) + dashboard marker (T6) ✓; verification (T7) ✓; rollback = delete folder (spec) ✓.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; every command shows expected output.
- **Type consistency:** helper names (`selectOverdueAgents`, `hasRecentReflection`, `buildReflectionPrompt`, `buildTemplateFallback`, `makeReflectionMemory`, `capMemories`) and constants (`SKIP_HOURS`, `MAX_MEMORIES`, `SOURCE`) are used identically in `index.js` (Task 4) and the tests (Tasks 1–3). Memory shape (`type`,`source`,`timestamp`,`expiresAt`,`evidence`) matches what `reflection-intel.js` reads (`type`, `timestamp`, `source`).

## Known minor: token attribution

`callGeminiProposal` logs usage under `caller:'proposal-generator'`, `agentId:'nova'`. Reflection tokens (~9 small calls/day) will attribute to that bucket. Cosmetic only; not worth editing the shared heartbeat helper (which the design keeps untouched). Revisit only if cost dashboards need per-caller precision.

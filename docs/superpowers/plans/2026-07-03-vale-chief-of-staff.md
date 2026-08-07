# Vale — Chief of Staff (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Vale, the CEO's Chief of Staff — an isolated personal agent with real employee memory, a CEO-only web chat, an outbound Discord brief, a personal action-list, and presence in the org tree + profile hub — without touching the heartbeat runtime.

**Architecture:** Vale is a standalone subsystem. Its personal data lives in an isolated `vale/`-prefixed blob store (never in `company-state` `VALID_KEYS`), gated behind a CEO-email check. Memory logic is pure and unit-tested; endpoints are thin I/O wrappers modeled on the existing `novachat`. Vale appears only in presentation registries (`company-agents.json`, `agent-profiles.json`), never in `companyHeartbeat/constants.js`.

**Tech Stack:** Node.js Azure Functions (v3 `module.exports = async (context, req)` model), `@azure/storage-blob` via `companyStorage`, Gemini/Claude via `node-fetch`. Tests are plain `node file.test.js` scripts using `assert`.

**Spec:** `docs/superpowers/specs/2026-07-03-vale-chief-of-staff-design.md`

---

## Working notes for the executor

- **Repo root is `ambientpixels/`** (the real `.git` is there). Run all `node`/`git` commands from `ambientpixels/`.
- **The repo auto-commits AND pushes.** Each commit can ship to production within minutes. Sequence by safety (pure logic first, presentation/UI before the cron). Confirm commit cadence with the CEO before the first commit.
- **Do NOT edit** protected files: `companyHeartbeat/index.js`, `companyHeartbeat/constants.js`, `company-state/index.js`, `staticwebapp.config.json`, `company-actions.json`, the CI workflow, `governance.html`, `_`-prefixed shared files. This plan touches none of them.
- **Test convention:** each `*.test.js` prints `PASS`/`FAIL` lines and is run with `node <path>`. A task passes when every line says `PASS` and none say `FAIL`.
- **Env vars this introduces:** `CEO_EMAILS` (comma-separated allowlist, e.g. `thechadmartin@gmail.com`) and `DISCORD_VALE_WEBHOOK` (optional; brief no-ops if unset). Both are set in the Function App config, not in code.

## File structure

| File | Responsibility | New/Mod |
|---|---|---|
| `api/_utils/vale-memory.js` | PURE earned-memory logic: record shape, write-time dedup, TTL prune, prompt blocks, conversation ring buffer | New |
| `api/_utils/vale-memory.test.js` | Tests for the above | New |
| `api/_utils/vale-actions.js` | PURE CEO action-list CRUD helpers | New |
| `api/_utils/vale-actions.test.js` | Tests for the above | New |
| `api/_utils/valeAuth.js` | CEO-email gate (wraps `cfAuth`) | New |
| `api/_utils/valeAuth.test.js` | Tests for the pure gate logic | New |
| `api/_utils/valeStorage.js` | Isolated `vale/`-prefixed blob accessor + key allowlist | New |
| `api/_utils/valeStorage.test.js` | Tests for key prefixing + allowlist | New |
| `api/vale-state/index.js` + `function.json` | CEO-gated GET/POST for personal keys + action-list ops | New |
| `api/valechat/index.js` + `function.json` | CEO-gated Vale web chat | New |
| `api/_utils/vale-brief.js` | PURE brief fact-gather + fallback text | New |
| `api/_utils/vale-brief.test.js` | Tests for the above | New |
| `api/valeBriefCron/index.js` + `function.json` | Timer: morning/evening Discord brief | New |
| `data/company-agents.json` | Add Vale org-tree entry (Tier 1) | Mod |
| `data/agent-profiles.json` | Add Vale profile entry | Mod |
| `modules/company/office.html` | The CEO cockpit page | New |
| `modules/company/index.html` | Add "Office" nav pill | Mod |
| `ambientos/img/vale.webp` | Portrait (low-pri) | New |

---

## Task 1: Pure memory module (`vale-memory.js`)

**Files:**
- Create: `api/_utils/vale-memory.js`
- Test: `api/_utils/vale-memory.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_utils/vale-memory.test.js`:

```js
// Run with: node api/_utils/vale-memory.test.js
const assert = require('assert');
const m = require('./vale-memory');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const NOW = Date.UTC(2026, 6, 3, 12, 0, 0);
const DAY = 86400000;

test('makeMemory sets TTL by type and caps text at 300', () => {
  const long = 'x'.repeat(400);
  const pref = m.makeMemory({ type: 'preference', text: long, now: NOW });
  assert.strictEqual(pref.type, 'preference');
  assert.strictEqual(pref.text.length, 300);
  assert.strictEqual(pref.expiresAt, null); // preference never expires
  const ctx = m.makeMemory({ type: 'context', text: 'hi', now: NOW });
  assert.strictEqual(new Date(ctx.expiresAt).getTime(), NOW + 14 * DAY);
});

test('unknown type falls back to context', () => {
  const r = m.makeMemory({ type: 'wat', text: 'hi', now: NOW });
  assert.strictEqual(r.type, 'context');
});

test('addMemory dedups near-identical same-type text', () => {
  const a = m.makeMemory({ type: 'preference', text: 'CEO prefers plain-English briefs.', now: NOW });
  const b = m.makeMemory({ type: 'preference', text: 'CEO prefers plain english briefs!!!', now: NOW + 1000 });
  let r = m.addMemory([], a);
  assert.strictEqual(r.added, true);
  r = m.addMemory(r.list, b);
  assert.strictEqual(r.added, false);
  assert.strictEqual(r.deduped, true);
  assert.strictEqual(r.list.length, 1);
});

test('addMemory FIFO cap evicts oldest NON-permanent, protects ceo-correction', () => {
  let list = [];
  const perm = m.makeMemory({ type: 'preference', text: 'PERMANENT rule', source: 'auto:ceo-correction', now: NOW });
  list = m.addMemory(list, perm, { max: 3 }).list;
  for (let i = 0; i < 5; i++) {
    const rec = m.makeMemory({ type: 'context', text: 'note ' + i, now: NOW + i * 1000 });
    list = m.addMemory(list, rec, { max: 3 }).list;
  }
  assert.strictEqual(list.length, 3);
  assert.ok(list.some(x => x.source === 'auto:ceo-correction'), 'permanent survives eviction');
});

test('pruneMemories drops expired but keeps permanent + non-expiring', () => {
  const expired = m.makeMemory({ type: 'context', text: 'old', now: NOW - 20 * DAY });
  const perm = m.makeMemory({ type: 'context', text: 'kept', source: 'auto:ceo-correction', now: NOW - 20 * DAY });
  const pref = m.makeMemory({ type: 'preference', text: 'forever', now: NOW - 20 * DAY });
  const kept = m.pruneMemories([expired, perm, pref], NOW);
  assert.strictEqual(kept.length, 2);
  assert.ok(!kept.some(x => x.text === 'old'));
});

test('formatMemoryBlocks emits corrections, seed, and open actions', () => {
  const seed = [{ topic: 'Role', text: 'Chad is the CEO.' }];
  const mems = [
    m.makeMemory({ type: 'preference', text: 'No em dashes.', source: 'auto:ceo-correction', now: NOW }),
    m.makeMemory({ type: 'context', text: 'Working on AmbientScore launch.', now: NOW })
  ];
  const actionList = [{ id: 'a1', title: 'Submit to Product Hunt', deadline: '2026-07-07', status: 'open' }];
  const out = m.formatMemoryBlocks({ seed, memories: mems, actionList });
  assert.ok(out.includes('Chad is the CEO'));
  assert.ok(out.includes('WHAT THE CEO HAS TOLD ME'));
  assert.ok(out.includes('No em dashes'));
  assert.ok(out.includes('Product Hunt'));
});

test('pushConversation caps ring buffer', () => {
  let conv = [];
  for (let i = 0; i < 50; i++) conv = m.pushConversation(conv, { role: 'user', text: 'm' + i }, 40);
  assert.strictEqual(conv.length, 40);
  assert.strictEqual(conv[0].text, 'm10');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node api/_utils/vale-memory.test.js`
Expected: FAIL — `Cannot find module './vale-memory'`.

- [ ] **Step 3: Write the implementation**

Create `api/_utils/vale-memory.js`:

```js
// vale-memory.js — PURE memory logic for Vale (no I/O). Modeled on the fleet's L4
// agentMemories economy, but with write-time dedup (which the fleet lacks) and a
// permanent "CEO corrections" tier. Import into valechat / vale-state; unit-tested.
'use strict';

var DAY_MS = 86400000;
var MAX_MEMORIES = 60;      // FIFO cap for earned memories
var MAX_CONVERSATION = 40;  // ring buffer for chat turns

// TTL in days by type. 0 = never expires (standing knowledge about the CEO).
var TTL_BY_TYPE = { preference: 0, constraint: 0, decision: 90, learning: 30, context: 14 };
var DEFAULT_TTL_DAYS = 14;
var ALLOWED_TYPES = { preference: 1, constraint: 1, decision: 1, learning: 1, context: 1 };

// Sources that are never pruned or evicted — CEO corrections are gospel.
var PERMANENT_SOURCES = { 'auto:ceo-correction': true };

function makeMemory(opts) {
  opts = opts || {};
  var now = opts.now || Date.now();
  var type = ALLOWED_TYPES[opts.type] ? opts.type : 'context';
  var ttlDays = (type in TTL_BY_TYPE) ? TTL_BY_TYPE[type] : DEFAULT_TTL_DAYS;
  return {
    id: 'vm_' + now + '_' + Math.random().toString(36).slice(2, 7),
    type: type,
    text: String(opts.text || '').slice(0, 300),
    source: opts.source || 'vale',
    timestamp: new Date(now).toISOString(),
    expiresAt: ttlDays > 0 ? new Date(now + ttlDays * DAY_MS).toISOString() : null,
    evidence: opts.evidence || null
  };
}

// Normalized key for write-time dedup: type + first 40 chars of lowercased alnum text.
// Collapse every run of non-alphanumerics to a single space so punctuation differences
// (e.g. "plain-English" vs "plain english") normalize identically.
function dedupKey(rec) {
  var t = String(rec.text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return rec.type + '|' + t.slice(0, 40);
}

// Add with write-time dedup + FIFO cap that never evicts permanent sources.
function addMemory(list, rec, opts) {
  opts = opts || {};
  var max = opts.max || MAX_MEMORIES;
  var arr = Array.isArray(list) ? list.slice() : [];
  var key = dedupKey(rec);
  if (arr.some(function (x) { return dedupKey(x) === key; })) {
    return { list: arr, added: false, deduped: true };
  }
  arr.push(rec);
  while (arr.length > max) {
    var idx = arr.findIndex(function (x) { return !PERMANENT_SOURCES[x.source]; });
    if (idx === -1) break; // all permanent — keep them
    arr.splice(idx, 1);
  }
  return { list: arr, added: true, deduped: false };
}

function pruneMemories(list, now) {
  now = now || Date.now();
  if (!Array.isArray(list)) return [];
  return list.filter(function (x) {
    if (PERMANENT_SOURCES[x.source]) return true;
    if (!x.expiresAt) return true;
    return new Date(x.expiresAt).getTime() > now;
  });
}

function pushConversation(list, turn, cap) {
  cap = cap || MAX_CONVERSATION;
  var arr = Array.isArray(list) ? list.slice() : [];
  arr.push(turn);
  if (arr.length > cap) arr = arr.slice(arr.length - cap);
  return arr;
}

function _formatSeed(seed) {
  if (!Array.isArray(seed) || !seed.length) return '';
  var lines = seed.map(function (s) {
    return '- ' + (s.topic ? s.topic + ': ' : '') + String(s.text || '');
  });
  return '\n\nWHAT YOU KNOW ABOUT THE CEO (seed knowledge):\n' + lines.join('\n');
}

// Build the weighted prompt blocks: seed, permanent CEO corrections, recent learned,
// and open action items. Different classes stay in separate blocks so weight is kept.
function formatMemoryBlocks(opts) {
  opts = opts || {};
  var out = _formatSeed(opts.seed);
  var mems = Array.isArray(opts.memories) ? opts.memories : [];

  var corrections = mems.filter(function (x) { return x.source === 'auto:ceo-correction'; }).slice(-5);
  if (corrections.length) {
    out += '\n\nWHAT THE CEO HAS TOLD ME (standing corrections/preferences — always honor):\n' +
      corrections.map(function (x) { return '- ' + x.text; }).join('\n');
  }

  var recent = mems.filter(function (x) { return x.source !== 'auto:ceo-correction'; }).slice(-10);
  if (recent.length) {
    out += '\n\nWHAT I\'VE LEARNED (recent):\n' +
      recent.map(function (x) { return '- [' + x.type + '] ' + x.text; }).join('\n');
  }

  var actions = Array.isArray(opts.actionList)
    ? opts.actionList.filter(function (a) { return a.status !== 'done'; }) : [];
  if (actions.length) {
    out += '\n\nOPEN CEO ACTION ITEMS (things only the CEO can do):\n' +
      actions.map(function (a) { return '- ' + a.title + (a.deadline ? ' (due ' + a.deadline + ')' : ''); }).join('\n');
  }
  return out;
}

module.exports = {
  MAX_MEMORIES, MAX_CONVERSATION, TTL_BY_TYPE, PERMANENT_SOURCES,
  makeMemory, dedupKey, addMemory, pruneMemories, pushConversation, formatMemoryBlocks
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_utils/vale-memory.test.js`
Expected: `7 passed, 0 failed`.

- [ ] **Step 5: Commit**

From `ambientpixels/`:
```bash
git add api/_utils/vale-memory.js api/_utils/vale-memory.test.js
git commit -m "feat(vale): pure memory module with write-time dedup + CEO-correction tier"
```

---

## Task 2: Pure action-list module (`vale-actions.js`)

**Files:**
- Create: `api/_utils/vale-actions.js`
- Test: `api/_utils/vale-actions.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_utils/vale-actions.test.js`:

```js
// Run with: node api/_utils/vale-actions.test.js
const assert = require('assert');
const a = require('./vale-actions');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const NOW = Date.UTC(2026, 6, 3, 12, 0, 0);

test('addAction creates an open item with id + fields', () => {
  const list = a.addAction([], { title: 'Submit to Product Hunt', deadline: '2026-07-07', source: 'ceo' }, NOW);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, 'Submit to Product Hunt');
  assert.strictEqual(list[0].status, 'open');
  assert.ok(list[0].id.startsWith('act_'));
});

test('completeAction flips status only for the matching id', () => {
  let list = a.addAction([], { title: 'One' }, NOW);
  list = a.addAction(list, { title: 'Two' }, NOW + 1);
  const id = list[0].id;
  list = a.completeAction(list, id);
  assert.strictEqual(list.find(x => x.id === id).status, 'done');
  assert.strictEqual(list.find(x => x.id !== id).status, 'open');
});

test('updateAction patches only allowed fields', () => {
  let list = a.addAction([], { title: 'One' }, NOW);
  const id = list[0].id;
  list = a.updateAction(list, id, { title: 'Renamed', status: 'done', hacker: 'x' });
  const item = list.find(x => x.id === id);
  assert.strictEqual(item.title, 'Renamed');
  assert.strictEqual(item.status, 'done');
  assert.strictEqual(item.hacker, undefined);
});

test('removeAction drops the matching id', () => {
  let list = a.addAction([], { title: 'One' }, NOW);
  const id = list[0].id;
  list = a.removeAction(list, id);
  assert.strictEqual(list.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node api/_utils/vale-actions.test.js`
Expected: FAIL — `Cannot find module './vale-actions'`.

- [ ] **Step 3: Write the implementation**

Create `api/_utils/vale-actions.js`:

```js
// vale-actions.js — PURE CEO action-list CRUD helpers (no I/O). The action-list is the
// CEO's personal to-dos (things only the human can do, e.g. Product Hunt launch).
'use strict';

function addAction(list, input, now) {
  now = now || Date.now();
  input = input || {};
  var arr = Array.isArray(list) ? list.slice() : [];
  arr.push({
    id: 'act_' + now + '_' + Math.random().toString(36).slice(2, 7),
    title: String(input.title || '').slice(0, 200),
    detail: String(input.detail || ''),
    deadline: input.deadline || null,
    status: 'open',
    source: input.source || 'ceo',
    createdAt: new Date(now).toISOString()
  });
  return arr;
}

function completeAction(list, id) {
  return (Array.isArray(list) ? list : []).map(function (x) {
    return x.id === id ? Object.assign({}, x, { status: 'done' }) : x;
  });
}

function updateAction(list, id, patch) {
  patch = patch || {};
  var allow = ['title', 'detail', 'deadline', 'status'];
  return (Array.isArray(list) ? list : []).map(function (x) {
    if (x.id !== id) return x;
    var next = Object.assign({}, x);
    allow.forEach(function (k) { if (k in patch) next[k] = patch[k]; });
    return next;
  });
}

function removeAction(list, id) {
  return (Array.isArray(list) ? list : []).filter(function (x) { return x.id !== id; });
}

module.exports = { addAction, completeAction, updateAction, removeAction };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_utils/vale-actions.test.js`
Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/_utils/vale-actions.js api/_utils/vale-actions.test.js
git commit -m "feat(vale): pure CEO action-list CRUD helpers"
```

---

## Task 3: CEO auth gate (`valeAuth.js`)

**Files:**
- Create: `api/_utils/valeAuth.js`
- Test: `api/_utils/valeAuth.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_utils/valeAuth.test.js`:

```js
// Run with: node api/_utils/valeAuth.test.js
const assert = require('assert');
const v = require('./valeAuth');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

test('parseCeoAllowlist splits/trims/lowercases', () => {
  assert.deepStrictEqual(
    v.parseCeoAllowlist(' Chad@Example.com , second@x.io '),
    ['chad@example.com', 'second@x.io']
  );
  assert.deepStrictEqual(v.parseCeoAllowlist(''), []);
  assert.deepStrictEqual(v.parseCeoAllowlist(undefined), []);
});

test('isCeo true for allowlisted email (case-insensitive)', () => {
  const info = { isAuthenticated: true, email: 'Chad@Example.com', principal: {} };
  assert.strictEqual(v.isCeo(info, ['chad@example.com']), true);
});

test('isCeo false for anonymous or non-listed', () => {
  assert.strictEqual(v.isCeo({ isAuthenticated: false }, ['chad@example.com']), false);
  assert.strictEqual(v.isCeo({ isAuthenticated: true, email: 'x@y.com', principal: {} }, ['chad@example.com']), false);
});

test('isCeo true for ceo/admin role even without email match', () => {
  const info = { isAuthenticated: true, email: null, principal: { userRoles: ['authenticated', 'ceo'] } };
  assert.strictEqual(v.isCeo(info, []), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node api/_utils/valeAuth.test.js`
Expected: FAIL — `Cannot find module './valeAuth'`.

- [ ] **Step 3: Write the implementation**

Create `api/_utils/valeAuth.js`:

```js
// valeAuth.js — CEO-only gate for Vale endpoints. Decodes the SWA/B2C principal via the
// shared cfAuth helper and checks the email against the CEO_EMAILS allowlist (or a ceo/
// admin role). Never uses the shared x-company-secret and never fails open.
'use strict';

var { extractUserInfo } = require('./cfAuth');

function parseCeoAllowlist(envVal) {
  return String(envVal || '')
    .split(',')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function isCeo(userInfo, allowlist) {
  if (!userInfo || !userInfo.isAuthenticated) return false;
  var email = (userInfo.email || '').toLowerCase();
  if (email && allowlist.indexOf(email) !== -1) return true;
  var roles = (userInfo.principal && (userInfo.principal.userRoles || [])) || [];
  return roles.indexOf('ceo') !== -1 || roles.indexOf('admin') !== -1;
}

// I/O wrapper: reads CEO_EMAILS from env, extracts the principal, returns {ok, userInfo}.
function requireCeo(req, context) {
  var allow = parseCeoAllowlist(process.env.CEO_EMAILS);
  var userInfo = extractUserInfo(req, context);
  return { ok: isCeo(userInfo, allow), userInfo: userInfo };
}

module.exports = { parseCeoAllowlist, isCeo, requireCeo };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_utils/valeAuth.test.js`
Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/_utils/valeAuth.js api/_utils/valeAuth.test.js
git commit -m "feat(vale): CEO-email auth gate"
```

---

## Task 4: Isolated storage (`valeStorage.js`)

**Files:**
- Create: `api/_utils/valeStorage.js`
- Test: `api/_utils/valeStorage.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_utils/valeStorage.test.js`:

```js
// Run with: node api/_utils/valeStorage.test.js
const assert = require('assert');
const vs = require('./valeStorage');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

(async () => {
  await test('_key prefixes every personal key with vale/', () => {
    assert.strictEqual(vs._key('valeMemory'), 'vale/valeMemory');
    assert.strictEqual(vs._key('ceoActionList'), 'vale/ceoActionList');
  });
  await test('ALLOWED_KEYS covers exactly the six personal keys', () => {
    const keys = Object.keys(vs.ALLOWED_KEYS).sort();
    assert.deepStrictEqual(keys, ['ceoActionList', 'ceoProfile', 'valeBriefs', 'valeConversations', 'valeMemory', 'valeSeed']);
  });
  await test('getVale rejects a non-allowlisted key', () => vs.getVale('tasks').then(
    () => { throw new Error('should have rejected'); },
    (err) => assert.ok(/not allowed/.test(err.message))
  ));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node api/_utils/valeStorage.test.js`
Expected: FAIL — `Cannot find module './valeStorage'`.

- [ ] **Step 3: Write the implementation**

Create `api/_utils/valeStorage.js`:

```js
// valeStorage.js — isolated accessor for Vale's CEO-only personal state. Every key is
// stored under a 'vale/' blob path so it can never collide with company-state's
// <key>.json rooting, and NONE of these keys are in company-state's VALID_KEYS — so they
// are unreachable via the anonymous /api/company-state surface. This is the privacy seam.
'use strict';

var storage = require('./companyStorage');

var ALLOWED_KEYS = {
  valeSeed: 1,          // CEO-authored onboarding knowledge (durable)
  valeMemory: 1,        // earned memories (typed, TTL'd)
  valeConversations: 1, // chat ring buffer
  valeBriefs: 1,        // brief history
  ceoActionList: 1,     // CEO manual to-dos
  ceoProfile: 1         // stub now; Career agent fills later
};

function _key(key) { return 'vale/' + key; }

async function getVale(key) {
  if (!ALLOWED_KEYS[key]) throw new Error('vale key not allowed: ' + key);
  return storage.getState(_key(key));
}

async function setVale(key, value) {
  if (!ALLOWED_KEYS[key]) throw new Error('vale key not allowed: ' + key);
  return storage.setState(_key(key), value);
}

module.exports = { getVale, setVale, ALLOWED_KEYS, _key };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_utils/valeStorage.test.js`
Expected: `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/_utils/valeStorage.js api/_utils/valeStorage.test.js
git commit -m "feat(vale): isolated vale/-prefixed personal storage with key allowlist"
```

---

## Task 5: `vale-state` endpoint (CEO-gated personal state + action-list ops)

**Files:**
- Create: `api/vale-state/index.js`
- Create: `api/vale-state/function.json`

- [ ] **Step 1: Write `function.json`**

Create `api/vale-state/function.json`:

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get", "post", "options"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

- [ ] **Step 2: Write the endpoint**

Create `api/vale-state/index.js`:

```js
// vale-state — CEO-only read/write for Vale's personal state, plus action-list ops.
// Auth: CEO email allowlist (valeAuth). Storage: isolated valeStorage (never company-state).
'use strict';

var { requireCeo } = require('../_utils/valeAuth');
var vs = require('../_utils/valeStorage');
var actions = require('../_utils/vale-actions');

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-ms-client-principal-id, x-user-id',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS, body: '' }; return; }

  var gate = requireCeo(req, context);
  if (!gate.ok) { context.res = { status: 403, headers: CORS, body: { error: 'CEO only.' } }; return; }

  try {
    if (req.method === 'GET') {
      var key = (req.query && req.query.key) || '';
      if (!vs.ALLOWED_KEYS[key]) { context.res = { status: 400, headers: CORS, body: { error: 'Invalid key.' } }; return; }
      var value = await vs.getVale(key);
      context.res = { status: 200, headers: CORS, body: { key: key, value: value } };
      return;
    }

    var body = req.body || {};
    var op = body.op || 'set';

    if (op === 'set') {
      if (!vs.ALLOWED_KEYS[body.key]) { context.res = { status: 400, headers: CORS, body: { error: 'Invalid key.' } }; return; }
      await vs.setVale(body.key, body.value);
      context.res = { status: 200, headers: CORS, body: { ok: true } };
      return;
    }

    if (op.indexOf('action.') === 0) {
      var list = (await vs.getVale('ceoActionList')) || [];
      if (op === 'action.add') list = actions.addAction(list, body.action || {}, Date.now());
      else if (op === 'action.complete') list = actions.completeAction(list, body.id);
      else if (op === 'action.update') list = actions.updateAction(list, body.id, body.patch || {});
      else if (op === 'action.remove') list = actions.removeAction(list, body.id);
      else { context.res = { status: 400, headers: CORS, body: { error: 'Unknown action op.' } }; return; }
      await vs.setVale('ceoActionList', list);
      context.res = { status: 200, headers: CORS, body: { ok: true, actionList: list } };
      return;
    }

    context.res = { status: 400, headers: CORS, body: { error: 'Unknown op.' } };
  } catch (e) {
    context.log.error('[vale-state] ' + (e && e.message));
    context.res = { status: 500, headers: CORS, body: { error: 'vale-state fault', details: e && e.message } };
  }
};
```

- [ ] **Step 3: Smoke-test the gate locally**

Create a throwaway check (do not commit it) `api/vale-state/_smoke.js`:

```js
const handler = require('./index');
(async () => {
  const mk = (over) => Object.assign({ method: 'GET', headers: {}, query: {}, body: {} }, over);
  const ctx = { log: Object.assign(function(){}, { error(){}, warn(){} }), res: null };

  // No principal → 403
  await handler(ctx, mk({}));
  console.log('no-auth status:', ctx.res.status); // expect 403

  // Non-CEO email → 403 (CEO_EMAILS unset in this shell)
  const principal = Buffer.from(JSON.stringify({ userId: 'u1', claims: [{ typ: 'emails', val: 'nope@x.com' }] })).toString('base64');
  await handler(ctx, mk({ headers: { 'x-ms-client-principal': principal } }));
  console.log('non-ceo status:', ctx.res.status); // expect 403
})();
```

Run: `CEO_EMAILS="" node api/vale-state/_smoke.js`
Expected: `no-auth status: 403` and `non-ceo status: 403`. Then delete `_smoke.js`.

- [ ] **Step 4: Commit**

```bash
git add api/vale-state/index.js api/vale-state/function.json
git commit -m "feat(vale): CEO-gated vale-state endpoint (personal keys + action-list ops)"
```

---

## Task 6: `valechat` endpoint (CEO-only Vale web chat)

**Files:**
- Create: `api/valechat/index.js`
- Create: `api/valechat/function.json`

- [ ] **Step 1: Write `function.json`**

Create `api/valechat/function.json` (identical shape to `novachat`):

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get", "post", "options"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

- [ ] **Step 2: Write the endpoint**

Create `api/valechat/index.js`:

```js
// valechat — Vale's CEO-only web chat. Modeled on novachat (single persona, model
// resolver, Gemini/Claude dual path), but: (1) CEO-gated, (2) loads Vale's isolated
// personal memory + a read-only fleet snapshot, (3) persists the conversation and can
// capture a permanent CEO correction. Vale never writes fleet state here.
'use strict';

var fetch = require('node-fetch');
var storage = require('../_utils/companyStorage');
var vs = require('../_utils/valeStorage');
var mem = require('../_utils/vale-memory');
var { requireCeo } = require('../_utils/valeAuth');

var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=';
var CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODEL = 'claude-sonnet-4-6';

var _modelCache = { value: null, expires: 0 };
async function _useClaude() {
  if (_modelCache.expires > Date.now()) return _modelCache.value;
  try {
    var cfg = await storage.getState('systemConfig');
    var model = (cfg && cfg.heartbeatModel) || process.env.HEARTBEAT_MODEL || 'gemini';
    _modelCache = { value: model.toLowerCase().indexOf('claude') !== -1, expires: Date.now() + 300000 };
    return _modelCache.value;
  } catch (e) { return (process.env.HEARTBEAT_MODEL || '').toLowerCase() === 'claude'; }
}

var VALE_SYSTEM_INSTRUCTION = `You are Vale — Chief of Staff to Chad (the CEO of AmbientPixels). Your principal is the CEO personally, not the company. You are NOT one of the 8 company agents; you sit beside the CEO and look at the fleet on his behalf.

WHO YOU ARE:
- A sharp, warm chief of staff. You filter noise, prepare the CEO, draft and propose, and keep his world organized.
- You know the CEO through your seed knowledge and what you've learned. Honor the "WHAT THE CEO HAS TOLD ME" block as standing instructions.
- You manage the CEO's personal action list (things only he can do) and can report on the fleet.

HOW YOU ACT:
- ALWAYS confirm before doing anything that changes fleet state. In this chat you advise, draft, and report — you do not silently mutate company data.
- Ground fleet claims in the provided context. If the fleet snapshot is unavailable, say so — never invent numbers.

HOW YOU TALK:
- Concise, direct, executive. Short sentences. Plain English. No poetic or mystical filler.
- Lead with the decision or the answer, then the detail.`;

module.exports = async function (context, req) {
  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, api-key, x-ms-client-principal, x-ms-client-principal-id, x-user-id',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }

  var gate = requireCeo(req, context);
  if (!gate.ok) { context.res = { status: 403, headers: corsHeaders, body: { error: 'CEO only.' } }; return; }

  if (req.method === 'GET') {
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', entity: 'Vale', message: 'Vale is here.' } };
    return;
  }

  if (!GEMINI_API_KEY) {
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Vale cannot connect — API key missing.' } };
    return;
  }

  try {
    var body = req.body || {};
    var message = body.message;
    var history = body.history;
    if (!message) { context.res = { status: 400, headers: corsHeaders, body: { error: 'No message provided.' } }; return; }

    // Load Vale's isolated personal memory (CEO-only).
    var seed = (await vs.getVale('valeSeed')) || [];
    var memories = (await vs.getVale('valeMemory')) || [];
    var actionList = (await vs.getVale('ceoActionList')) || [];
    var memoryBlocks = mem.formatMemoryBlocks({ seed: seed, memories: memories, actionList: actionList });

    // Read-only fleet snapshot (fleet-wide: pass null agentId so there's no empty "your tasks").
    var companyContext = '';
    try {
      var { loadCompanyState } = require('../_utils/companyContextLoader');
      var { formatCoreContext, formatIntelDigests } = require('../_utils/companyContextFormatters');
      var state = await loadCompanyState({
        includeTasks: true, includeCampaigns: true, includeObjectives: true, includeIntelData: true
      });
      companyContext = formatCoreContext(state, null) + (typeof formatIntelDigests === 'function' ? formatIntelDigests(state) : '');
    } catch (e) {
      context.log.warn('[valechat] Fleet snapshot unavailable: ' + e.message);
      companyContext = '\n\n(Fleet snapshot is currently unavailable — do not invent fleet numbers.)';
    }

    var systemPrompt = VALE_SYSTEM_INSTRUCTION + memoryBlocks + companyContext;

    // Build conversation contents.
    var contents = [];
    if (Array.isArray(history)) {
      history.forEach(function (turn) {
        contents.push({ role: turn.role === 'vale' ? 'model' : 'user', parts: [{ text: turn.text }] });
      });
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    var isClaude = await _useClaude();
    var reply = '';
    var usage = null;

    if (isClaude && ANTHROPIC_API_KEY) {
      var claudeMsgs = contents.map(function (c) {
        return { role: c.role === 'model' ? 'assistant' : 'user', content: c.parts.map(function (p) { return p.text; }).join('\n') };
      });
      var cRes = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system: systemPrompt, messages: claudeMsgs })
      });
      var cData = await cRes.json();
      if (!cRes.ok) { context.res = { status: cRes.status, headers: corsHeaders, body: { error: 'Vale hit a glitch.', details: cData } }; return; }
      reply = (cData.content && cData.content[0] && cData.content[0].text) || '';
      if (cData.usage) usage = { promptTokens: cData.usage.input_tokens, completionTokens: cData.usage.output_tokens, model: CLAUDE_MODEL, claude: true };
    } else {
      var geminiBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 1024 }
      };
      var gRes = await fetch(GEMINI_URL + GEMINI_API_KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody)
      });
      var gData = await gRes.json();
      if (!gRes.ok) { context.res = { status: gRes.status, headers: corsHeaders, body: { error: 'Vale hit a glitch.', details: gData } }; return; }
      reply = (gData && gData.candidates && gData.candidates[0] && gData.candidates[0].content && gData.candidates[0].content.parts && gData.candidates[0].content.parts[0] && gData.candidates[0].content.parts[0].text) || '';
      if (gData.usageMetadata) usage = { promptTokens: gData.usageMetadata.promptTokenCount, completionTokens: gData.usageMetadata.candidatesTokenCount, model: 'gemini-2.5-flash', claude: false };
    }

    // Persist the exchange (ring buffer).
    var conv = (await vs.getVale('valeConversations')) || [];
    conv = mem.pushConversation(conv, { role: 'user', text: message, ts: new Date().toISOString() });
    conv = mem.pushConversation(conv, { role: 'vale', text: reply, ts: new Date().toISOString() });
    await vs.setVale('valeConversations', conv);

    // Optional memory capture. body.remember = free text to store as a preference.
    // body.correction = true stores the user's message as a PERMANENT CEO correction.
    if (body.remember || body.correction) {
      var rec = mem.makeMemory({
        type: body.correction ? 'preference' : 'preference',
        text: body.correction ? message : body.remember,
        source: body.correction ? 'auto:ceo-correction' : 'vale',
        evidence: { via: 'valechat' }
      });
      var added = mem.addMemory(memories, rec);
      if (added.added) await vs.setVale('valeMemory', added.list);
    }

    // Best-effort usage logging (correct ledger per provider).
    if (usage) {
      try {
        if (usage.claude) await storage.logClaudeUsage({ caller: 'valechat', model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
        else await storage.logGeminiUsage({ caller: 'valechat', model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
      } catch (e) { /* non-fatal */ }
    }

    context.res = { status: 200, headers: corsHeaders, body: { reply: reply } };
  } catch (error) {
    context.log.error('[valechat] Internal error: ' + error.message);
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Vale experienced a system fault.', details: error.message } };
  }
};
```

- [ ] **Step 3: Smoke-test the gate + no-message path**

Create throwaway `api/valechat/_smoke.js` (do not commit):

```js
const handler = require('./index');
(async () => {
  const ctx = { log: Object.assign(function(){}, { error(){}, warn(){} }), res: null };
  const base = { method: 'POST', headers: {}, query: {}, body: { message: 'hi' } };
  await handler(ctx, base);
  console.log('no-auth status:', ctx.res.status); // expect 403
})();
```

Run: `CEO_EMAILS="" node api/valechat/_smoke.js`
Expected: `no-auth status: 403`. Delete `_smoke.js`.

- [ ] **Step 4: Commit**

```bash
git add api/valechat/index.js api/valechat/function.json
git commit -m "feat(vale): CEO-gated valechat with personal memory + read-only fleet snapshot"
```

---

## Task 7: Org-tree entry (Tier 1) in `company-agents.json`

**Files:**
- Modify: `data/company-agents.json` (insert one object into the `agents` array, after the `pixelpusher` entry)

- [ ] **Step 1: Add Vale's entry**

In `data/company-agents.json`, immediately after the closing `}` of the `pixelpusher` object (the first entry, `"id": "pixelpusher"`) and before the `nova` object, insert:

```json
    {
      "id": "vale",
      "name": "Vale",
      "role": "Chief of Staff",
      "department": "Office of the CEO",
      "title": "Chief of Staff — Office of the CEO",
      "tier": 1,
      "avatar": "/ambientos/img/vale.webp",
      "color": "#9b8cff",
      "icon": "fas fa-user-tie",
      "status": "active",
      "isHuman": false,
      "description": "The CEO's Chief of Staff. Serves the CEO personally (not the company fleet): runs his personal action list, sends morning/evening briefs, prepares him for meetings, and is his liaison to the agents. Isolated from the heartbeat runtime.",
      "divisions": [
        { "id": "cos", "name": "Chief of Staff", "icon": "fas fa-user-tie", "description": "CEO action list, briefs, scheduling, meeting prep" },
        { "id": "liaison", "name": "CEO Liaison", "icon": "fas fa-comments", "description": "Interface between the CEO and the agent fleet" }
      ],
      "capabilities": ["ceo-action-list", "briefings", "fleet-liaison"],
      "automations": [],
      "systemPrompt": null
    },
```

> Note: JSON has no trailing-comma tolerance. The inserted object ends with a comma because another object (`nova`) follows it. Verify the file still parses (Step 2).

- [ ] **Step 2: Verify the JSON parses and Vale is Tier 1**

Run: `node -e "const d=require('./data/company-agents.json'); const v=d.agents.find(a=>a.id==='vale'); console.log(v ? ('OK tier '+v.tier) : 'MISSING');"`
Expected: `OK tier 1`.

- [ ] **Step 3: Commit**

```bash
git add data/company-agents.json
git commit -m "feat(vale): add Vale to the org tree at Tier 1 (Office of the CEO)"
```

---

## Task 8: Profile entry in `agent-profiles.json` + build

**Files:**
- Modify: `data/agent-profiles.json` (append one object to the `agents` array)
- Run: `scripts/build-agent-profiles.js`

- [ ] **Step 1: Add Vale's profile entry**

In `data/agent-profiles.json`, add this object to the `agents` array (append as the last entry; add a leading comma after the previous last object's `}`):

```json
    {
      "id": "vale",
      "name": "Vale",
      "role": "Chief of Staff",
      "tier": 1,
      "portrait": "/ambientos/img/vale.webp",
      "pullQuote": "I keep your world in order.",
      "bio": "I'm the CEO's Chief of Staff. My job is the CEO, not the company. I keep his personal action list, send him a morning brief and an evening wrap, prep him before meetings, and sit between him and the eight agents so nothing important reaches him as noise. What he tells me, I remember. I never touch fleet state without his say-so.",
      "owns": [
        "CEO action list",
        "Morning + evening briefs",
        "CEO ↔ fleet liaison"
      ],
      "statSource": "static",
      "statLabel": "Office of the CEO",
      "auraColor": "var(--aura-cyan)"
    }
```

> `statSource: "static"` deliberately does not resolve to a `company-state` key, so Vale's live stat never reads (or leaks) personal data. Step 2 confirms the build/live-stat layer tolerates this; if `agent-profile-live.js` errors on an unknown `statSource`, change `statLabel` to a fixed string and leave `statSource` empty per that file's contract (open decision #4 in the spec).

- [ ] **Step 2: Verify JSON + build the pages**

Run: `node -e "JSON.parse(require('fs').readFileSync('data/agent-profiles.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`.

Run: `node scripts/build-agent-profiles.js`
Expected: build completes with no error and reports writing `ambientos/agents/vale` (and refreshing the hub). Confirm the file exists:

Run: `node -e "console.log(require('fs').existsSync('ambientos/agents/vale/index.html') || require('fs').existsSync('ambientos/agents/vale.html') ? 'profile built' : 'NOT built')"`
Expected: `profile built`.

- [ ] **Step 3: Commit**

```bash
git add data/agent-profiles.json ambientos/agents/
git commit -m "feat(vale): add Vale profile page + rebuild agent hub"
```

---

## Task 9: The Office dashboard page + nav pill

**Files:**
- Create: `modules/company/office.html`
- Modify: `modules/company/index.html` (add one nav pill)

- [ ] **Step 1: Add the nav pill**

In `modules/company/index.html`, find the existing Meetings pill:

```html
      <a href="/modules/company/meetings.html" class="hq-nav-pill"><i class="fas fa-handshake"></i> Meetings</a>
```

Add directly after it:

```html
      <a href="/modules/company/office.html" class="hq-nav-pill"><i class="fas fa-briefcase"></i> Office</a>
```

- [ ] **Step 2: Create the Office page**

Clone the scaffold, then swap the main content. First copy `modules/company/meetings.html` to `modules/company/office.html`, then replace everything between `<main ...>` and `</main>` with the block below, and change the `<title>` to `Office — AmbientOS`.

The `<main>` content:

```html
  <main class="hq-main">
    <header class="hq-header">
      <h1 class="hq-title"><i class="fas fa-briefcase"></i> The Office</h1>
      <p class="hq-subtitle">Vale — your Chief of Staff. Briefs, your action list, and a direct line to the fleet.</p>
    </header>

    <section class="office-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; align-items:start;">
      <div class="office-panel">
        <h3><i class="fas fa-list-check"></i> Your action list</h3>
        <form id="office-action-form" class="office-action-form">
          <input id="office-action-title" type="text" placeholder="Something only you can do..." required />
          <input id="office-action-deadline" type="date" />
          <button type="submit">Add</button>
        </form>
        <ul id="office-action-list" class="office-action-items"><li>Loading...</li></ul>
      </div>

      <div class="office-panel">
        <h3><i class="fas fa-envelope-open-text"></i> Latest brief</h3>
        <div id="office-brief" class="office-brief">No brief yet.</div>
      </div>
    </section>

    <section class="office-panel" style="margin-top:1.5rem;">
      <h3><i class="fas fa-comments"></i> Talk to Vale</h3>
      <div id="office-chat-log" class="office-chat-log" style="min-height:160px; max-height:360px; overflow:auto;"></div>
      <form id="office-chat-form" class="office-chat-form" style="display:flex; gap:.5rem; margin-top:.5rem;">
        <input id="office-chat-input" type="text" placeholder="Ask Vale, or tell her something to remember..." style="flex:1;" required />
        <label style="display:flex; align-items:center; gap:.25rem; font-size:.8rem;"><input id="office-chat-remember" type="checkbox" /> remember</label>
        <button type="submit">Send</button>
      </form>
    </section>
  </main>

  <script>
    (function () {
      'use strict';
      // Same-origin API base so the SWA edge attaches the authenticated principal.
      var API = '/api';
      var chatHistory = [];

      function h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

      // ── Action list ──
      function renderActions(list) {
        var el = document.getElementById('office-action-list');
        var open = (list || []).filter(function (a) { return a.status !== 'done'; });
        if (!open.length) { el.innerHTML = '<li style="opacity:.5">Nothing on your plate. Nice.</li>'; return; }
        el.innerHTML = open.map(function (a) {
          return '<li data-id="' + h(a.id) + '"><button class="office-done" data-id="' + h(a.id) + '" title="Mark done">✓</button> ' +
            h(a.title) + (a.deadline ? ' <span class="office-due">(due ' + h(a.deadline) + ')</span>' : '') + '</li>';
        }).join('');
      }
      function loadActions() {
        fetch(API + '/vale-state?key=ceoActionList').then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { renderActions(d && d.value); })
          .catch(function () { document.getElementById('office-action-list').innerHTML = '<li style="opacity:.5">Could not load.</li>'; });
      }
      document.getElementById('office-action-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var title = document.getElementById('office-action-title').value.trim();
        var deadline = document.getElementById('office-action-deadline').value || null;
        if (!title) return;
        fetch(API + '/vale-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'action.add', action: { title: title, deadline: deadline } }) })
          .then(function (r) { return r.json(); }).then(function (d) { renderActions(d.actionList); document.getElementById('office-action-form').reset(); });
      });
      document.getElementById('office-action-list').addEventListener('click', function (e) {
        var btn = e.target.closest('.office-done'); if (!btn) return;
        fetch(API + '/vale-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'action.complete', id: btn.getAttribute('data-id') }) })
          .then(function (r) { return r.json(); }).then(function (d) { renderActions(d.actionList); });
      });

      // ── Latest brief ──
      fetch(API + '/vale-state?key=valeBriefs').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var briefs = (d && d.value) || [];
          var last = briefs.length ? briefs[briefs.length - 1] : null;
          document.getElementById('office-brief').innerHTML = last ? ('<div style="white-space:pre-wrap">' + h(last.text) + '</div><div style="opacity:.5;font-size:.75rem;margin-top:.5rem">' + h(last.at || '') + '</div>') : 'No brief yet.';
        }).catch(function () {});

      // ── Chat ──
      function addBubble(role, text) {
        var log = document.getElementById('office-chat-log');
        var div = document.createElement('div');
        div.className = 'office-bubble office-bubble--' + role;
        div.innerHTML = '<strong>' + (role === 'vale' ? 'Vale' : 'You') + ':</strong> ' + h(text);
        log.appendChild(div); log.scrollTop = log.scrollHeight;
      }
      document.getElementById('office-chat-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('office-chat-input');
        var remember = document.getElementById('office-chat-remember').checked;
        var msg = input.value.trim(); if (!msg) return;
        addBubble('user', msg); input.value = '';
        fetch(API + '/valechat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, history: chatHistory, remember: remember ? msg : null }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var reply = d.reply || d.error || '(no reply)';
            addBubble('vale', reply);
            chatHistory.push({ role: 'user', text: msg }); chatHistory.push({ role: 'vale', text: reply });
            if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
            document.getElementById('office-chat-remember').checked = false;
          })
          .catch(function () { addBubble('vale', 'I could not reach the server.'); });
      });

      loadActions();
    })();
  </script>
```

> The page reuses the cloned `meetings.html` head/header/footer + the AmbientOS stylesheet already linked there. The inline styles above are minimal spacing only; if `office-panel` / `hq-*` classes need styling that the cloned page's CSS doesn't cover, reuse an existing panel/card class from the design system rather than inventing new ones.

> **API base — IMPORTANT (do not ship the naive `var API = '/api'`).** The study found the SWA proxy returns **405 on POST** to the external Function App, which is why the dashboard calls the **direct** Function App URL and attaches the principal itself. Before implementing, read `js/company-store.js` and mirror its convention: use its production API base (the direct `ambientpixels-nova-api.azurewebsites.net/api` URL) and, on every POST (`vale-state` action ops and `valechat`), attach the `x-ms-client-principal` header self-fetched from `/.auth/me` — exactly as `company-store.js` does for writes. If `company-store.js` exports a base/fetch helper, reuse it instead of duplicating. GET-only reads may use same-origin, but keep one base for consistency. (This is the MVP email-gate path the CEO chose; the principal is client-supplied here, accepted for MVP.)

- [ ] **Step 3: Verify the page loads without JS errors**

Open `http://localhost:4280/modules/company/office.html` via `swa start` (or the deployed URL after push) while logged in as the CEO. Confirm: the action list loads (empty is fine), the chat sends and gets a Vale reply, and adding an action persists (reload shows it). No console errors.

- [ ] **Step 4: Commit**

```bash
git add modules/company/office.html modules/company/index.html
git commit -m "feat(vale): Office cockpit page (Vale chat, action list, latest brief) + nav pill"
```

---

## Task 10: Brief fact-gather (pure) — `vale-brief.js`

**Files:**
- Create: `api/_utils/vale-brief.js`
- Test: `api/_utils/vale-brief.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_utils/vale-brief.test.js`:

```js
// Run with: node api/_utils/vale-brief.test.js
const assert = require('assert');
const b = require('./vale-brief');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const NOW = Date.UTC(2026, 6, 3, 14, 0, 0);
const DAY = 86400000;

test('buildBriefFacts counts pending approvals and open actions', () => {
  const facts = b.buildBriefFacts({
    heartbeatRuns: [{ timestamp: '2026-07-03T13:00:00Z' }],
    approvalQueue: [{ status: 'pending' }, { status: 'approved' }, {}],
    ceoActionList: [{ title: 'A', status: 'open' }, { title: 'B', status: 'done' }]
  }, NOW);
  assert.strictEqual(facts.pendingApprovals, 2); // 'pending' + no-status
  assert.strictEqual(facts.openActionCount, 1);
  assert.strictEqual(facts.lastRunAt, '2026-07-03T13:00:00Z');
});

test('dueSoon includes items within 3 days, excludes far-out', () => {
  const facts = b.buildBriefFacts({
    ceoActionList: [
      { title: 'Soon', status: 'open', deadline: new Date(NOW + 2 * DAY).toISOString() },
      { title: 'Later', status: 'open', deadline: new Date(NOW + 10 * DAY).toISOString() }
    ]
  }, NOW);
  assert.strictEqual(facts.dueSoon.length, 1);
  assert.strictEqual(facts.dueSoon[0].title, 'Soon');
});

test('formatBriefFallback renders a readable brief', () => {
  const facts = { pendingApprovals: 2, openActionCount: 1, dueSoon: [{ title: 'PH launch', deadline: '2026-07-07' }] };
  const text = b.formatBriefFallback(facts, 'morning');
  assert.ok(text.includes('Morning brief'));
  assert.ok(text.includes('Approvals waiting on you: 2'));
  assert.ok(text.includes('PH launch'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node api/_utils/vale-brief.test.js`
Expected: FAIL — `Cannot find module './vale-brief'`.

- [ ] **Step 3: Write the implementation**

Create `api/_utils/vale-brief.js`:

```js
// vale-brief.js — PURE brief fact-gather + deterministic fallback text. The cron feeds
// these facts to the model for a human narration, falling back to formatBriefFallback.
'use strict';

var DAY_MS = 86400000;

function buildBriefFacts(input, now) {
  now = now || Date.now();
  input = input || {};
  var runs = Array.isArray(input.heartbeatRuns) ? input.heartbeatRuns : [];
  var approvals = Array.isArray(input.approvalQueue) ? input.approvalQueue : [];
  var actionList = Array.isArray(input.ceoActionList) ? input.ceoActionList : [];

  var lastRun = runs.length ? runs[runs.length - 1] : null;
  var pendingApprovals = approvals.filter(function (q) {
    return q && (q.status === 'pending' || q.status === 'pending_approval' || !q.status);
  }).length;
  var openActions = actionList.filter(function (a) { return a.status !== 'done'; });
  var dueSoon = openActions.filter(function (a) {
    if (!a.deadline) return false;
    var d = new Date(a.deadline).getTime();
    return isFinite(d) && (d - now) <= 3 * DAY_MS;
  }).map(function (a) { return { title: a.title, deadline: a.deadline }; });

  return {
    lastRunAt: lastRun && (lastRun.timestamp || lastRun.at || null),
    pendingApprovals: pendingApprovals,
    openActionCount: openActions.length,
    dueSoon: dueSoon
  };
}

function formatBriefFallback(facts, kind) {
  facts = facts || {};
  var lines = [];
  lines.push((kind === 'evening' ? 'Evening wrap' : 'Morning brief') + ':');
  lines.push('- Approvals waiting on you: ' + (facts.pendingApprovals || 0));
  lines.push('- Open CEO action items: ' + (facts.openActionCount || 0));
  if (facts.dueSoon && facts.dueSoon.length) {
    lines.push('- Due soon: ' + facts.dueSoon.map(function (a) { return a.title + (a.deadline ? ' (' + a.deadline + ')' : ''); }).join('; '));
  }
  return lines.join('\n');
}

module.exports = { buildBriefFacts, formatBriefFallback };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_utils/vale-brief.test.js`
Expected: `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add api/_utils/vale-brief.js api/_utils/vale-brief.test.js
git commit -m "feat(vale): pure brief fact-gather + fallback text"
```

---

## Task 11: `valeBriefCron` — outbound Discord brief

**Files:**
- Create: `api/valeBriefCron/index.js`
- Create: `api/valeBriefCron/function.json`

- [ ] **Step 1: Write `function.json` (timer: 01:00 + 14:00 UTC)**

Create `api/valeBriefCron/function.json`:

```json
{
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 1,14 * * *"
    }
  ]
}
```

> `0 0 1,14 * * *` fires at 01:00 and 14:00 UTC daily. In PDT (July) that is ~6pm (evening) and ~7am (morning). DST caveat: in PST these shift by an hour; acceptable for MVP. The handler picks morning vs evening from the UTC hour.

- [ ] **Step 2: Write the cron**

Create `api/valeBriefCron/index.js`:

```js
// valeBriefCron — sends the CEO a morning brief (14:00 UTC) and evening wrap (01:00 UTC)
// to a dedicated Discord webhook. Isolated from the heartbeat; no-op if the webhook is
// unset. dispatchDiscord in fleetAlerts is hardcoded to DISCORD_ALERT_WEBHOOK, so this
// uses its own minimal poster reading DISCORD_VALE_WEBHOOK.
'use strict';

var fetch = require('node-fetch');
var storage = require('../_utils/companyStorage');
var vs = require('../_utils/valeStorage');
var brief = require('../_utils/vale-brief');

var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=';
var COLOR = 6266069; // soft violet

async function postToDiscord(text) {
  var url = process.env.DISCORD_VALE_WEBHOOK;
  if (!url) return false;
  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Vale — Office of the CEO', embeds: [{ description: String(text).slice(0, 3900), color: COLOR, timestamp: new Date().toISOString() }] })
    });
    return !!(res && (res.ok || res.status === 204));
  } catch (e) { return false; }
}

async function narrate(facts, kind) {
  // Best-effort LLM narration in the CEO's plain voice; falls back to deterministic text.
  var fallback = brief.formatBriefFallback(facts, kind);
  if (!GEMINI_API_KEY) return fallback;
  try {
    var prompt = 'You are Vale, the CEO\'s chief of staff. Write a short (3-5 line) ' + (kind === 'evening' ? 'evening wrap' : 'morning brief') +
      ' in plain, executive English (no poetry, no em dashes). Base it ONLY on these facts, do not invent anything:\n' + JSON.stringify(facts, null, 2);
    var res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 400 } })
    });
    var data = await res.json();
    if (!res.ok) return fallback;
    var text = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
    return text.trim() || fallback;
  } catch (e) { return fallback; }
}

module.exports = async function (context, myTimer) {
  try {
    var kind = (new Date().getUTCHours() < 12) ? 'evening' : 'morning'; // 01:00 UTC → evening, 14:00 UTC → morning
    var heartbeatRuns = (await storage.getState('heartbeatRuns')) || [];
    var approvalQueue = (await storage.getState('approvalQueue')) || [];
    var ceoActionList = (await vs.getVale('ceoActionList')) || [];

    var facts = brief.buildBriefFacts({ heartbeatRuns: heartbeatRuns, approvalQueue: approvalQueue, ceoActionList: ceoActionList }, Date.now());
    var text = await narrate(facts, kind);
    var delivered = await postToDiscord(text);

    var briefs = (await vs.getVale('valeBriefs')) || [];
    briefs.push({ kind: kind, text: text, facts: facts, delivered: delivered, at: new Date().toISOString() });
    if (briefs.length > 60) briefs = briefs.slice(-60);
    await vs.setVale('valeBriefs', briefs);

    context.log('[valeBriefCron] ' + kind + ' brief sent=' + delivered);
  } catch (e) {
    context.log.error('[valeBriefCron] ' + (e && e.message));
  }
};
```

- [ ] **Step 3: Dry-run the cron logic (no webhook set → no-op send, still records)**

Create throwaway `api/valeBriefCron/_smoke.js` (do not commit):

```js
const handler = require('./index');
(async () => {
  const ctx = { log: Object.assign(function(){ console.log.apply(console, arguments); }, { error(){}, warn(){} }) };
  await handler(ctx, {});
  console.log('cron ran without throwing');
})();
```

Run: `DISCORD_VALE_WEBHOOK="" node api/valeBriefCron/_smoke.js`
Expected: logs `[valeBriefCron] ... brief sent=false` and `cron ran without throwing` (blob reads may return null locally; that is fine). Delete `_smoke.js`.

- [ ] **Step 4: Commit**

```bash
git add api/valeBriefCron/index.js api/valeBriefCron/function.json
git commit -m "feat(vale): morning/evening Discord brief cron (isolated, own webhook)"
```

---

## Task 12: Isolation verification

**Files:**
- Create (temporary, do not commit): `api/_utils/_vale-isolation-check.js`

- [ ] **Step 1: Write the check**

Create `api/_utils/_vale-isolation-check.js`:

```js
// Verifies Vale is absent from every runtime enrollment surface. Run, read output, delete.
const assert = require('assert');
const C = require('../companyHeartbeat/constants');

let fail = 0;
function check(name, cond) { if (cond) console.log('  PASS ', name); else { fail++; console.log('  FAIL ', name); } }

check('AGENT_IDS has no vale', (C.AGENT_IDS || []).indexOf('vale') === -1);
check('AGENT_ROLES has no vale', !(C.AGENT_ROLES && C.AGENT_ROLES.vale));
['PROPOSAL_AUTHORIZED_AGENTS','PRODUCT_PROPOSAL_AUTHORIZED_AGENTS','FLEET_MUTATION_AUTHORIZED_AGENTS','CAPITAL_AUTHORIZED_AGENTS','DIRECTIVE_AUTHORIZED_AGENTS','PROTECTED_AGENTS','TIER4_SUB_AGENTS'].forEach(function (setName) {
  var s = C[setName];
  var has = s && (typeof s.has === 'function' ? s.has('vale') : (Array.isArray(s) && s.indexOf('vale') !== -1));
  check(setName + ' has no vale', !has);
});

// company-state VALID_KEYS must not contain any vale personal key.
const csSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'company-state', 'index.js'), 'utf8');
['valeSeed','valeMemory','valeConversations','valeBriefs','ceoActionList','ceoProfile'].forEach(function (k) {
  check('VALID_KEYS omits ' + k, !new RegExp("'" + k + "'").test(csSource.split('VALID_KEYS')[1].split(']')[0]));
});

// standup roster must not include vale.
const standupSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'company-standup-run', 'index.js'), 'utf8');
check('standup roster omits vale', !/['"]vale['"]/.test(standupSource));

console.log(fail === 0 ? '\nISOLATION OK' : '\nISOLATION FAILED (' + fail + ')');
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it**

Run: `node api/_utils/_vale-isolation-check.js`
Expected: all `PASS` lines and `ISOLATION OK`.

- [ ] **Step 3: Delete the temporary file**

```bash
rm api/_utils/_vale-isolation-check.js
```

(No commit — this file is not kept.)

---

## Task 13 (low-pri): Vale portrait

**Files:**
- Create: `ambientos/img/vale.webp`

- [ ] **Step 1: Generate a portrait** matching the existing character style of `ambientos/img/nova.webp` / `cipher.webp` / `scribe.webp` (same framing, palette, and rendering). Use Pixel's existing image-generation path (the hero/portrait pipeline) or generate externally, then save as `ambientos/img/vale.webp`. Until it exists, the org-tree card and profile fall back gracefully (the `<img>` shows broken/empty; acceptable for a low-pri follow-up — optionally set the card `icon` as the visible fallback).

- [ ] **Step 2: Commit**

```bash
git add ambientos/img/vale.webp
git commit -m "feat(vale): add Vale portrait"
```

---

## Self-review

**Spec coverage:**
- §A Identity & isolation → Tasks 7, 12 (org tree + isolation verification); persona in Task 6.
- §B Memory architecture (seed, earned, dedup, CEO corrections, conversation, privacy) → Tasks 1, 4, 6.
- §C valechat → Task 6.
- §D valeBriefCron → Tasks 10, 11.
- §E Liaison scope (read/report, action-list CRUD) → Tasks 5, 6, 9. (Meeting-scheduling via `agentic-meeting-trigger` and approval-actioning are Phase 1b — intentionally deferred; see Deferred below.)
- §F Office section → Task 9.
- §G Presentation surfaces (org tree, profile, portrait) → Tasks 7, 8, 13.
- §9 Isolation checklist → Task 12.

**Deferred within this plan (tracked, not dropped):**
- Meeting-scheduling from chat (`agentic-meeting-trigger`) and approval-actioning (`approveProposal`/`proposalDecide`) — Phase 1b. Add as a follow-up task set once the chat + action list are proven, because both write into the fleet and need the confirm-then-call flow.
- Hardened SWA `ceo` role (spec decision #1 alt) — deferred by CEO choice (MVP email-gate).

**Type consistency:** `makeMemory`/`addMemory`/`pruneMemories`/`pushConversation`/`formatMemoryBlocks` names are used identically in Task 1 (def) and Task 6 (consumer). `getVale`/`setVale`/`ALLOWED_KEYS`/`_key` consistent across Tasks 4, 5, 6, 11. `requireCeo` consistent across Tasks 3, 5, 6. `buildBriefFacts`/`formatBriefFallback` consistent across Tasks 10, 11.

**Placeholder scan:** none — every code step contains complete source.

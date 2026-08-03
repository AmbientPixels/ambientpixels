# Deep Roast Rewrite ($9 Upsell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a free Resume Roast, sell a $9 ATS-optimized full rewrite via Stripe, delivered on a token-gated page within ~1–2 minutes.

**Architecture:** Order-based flow mirroring the $199 teardown pipeline. `POST /api/roast-rewrite` creates an order (resume text stored server-side, never in Stripe) and returns a Checkout URL. The Stripe webhook flips the order to `paid`. The delivery page's **first poll composes the rewrite inline** (one Claude call, ~30–60s) so delivery is fast without a fast cron; a new 15-min timer runner is the backstop for closed-tab buyers and handles retention scrubbing. Kill switch `systemConfig.roastRewrite.enabled` defaults to **off** — every commit is safe to auto-deploy.

**Tech Stack:** Azure Functions (Node, no SDK-style raw axios Stripe calls), companyStorage state blobs, existing `callClaude` from `api/_lib/ambientScore/analyzer.js`, vanilla JS front-end.

**Spec:** `docs/superpowers/specs/2026-08-02-roast-rewrite-upsell-design.md`

**Repo facts the executor must know:**
- All paths below are relative to `ambientpixels/` (the git root — the real `.git` lives there).
- The repo **auto-commits AND auto-pushes**; every commit deploys in minutes. The kill switch (default off, config absent = off) is what makes this safe.
- Tests are plain Node scripts using `assert` (no jest/mocha). Run them with `node <path>`.
- Python is not available. Use Node for everything.
- State keys `roast_rewrite_queue` and `roast_rewrite_<orderId>` are NEW — they collide with nothing.
- Do NOT touch: `staticwebapp.config.json`, `api/companyHeartbeat/index.js`, `api/company-state/index.js`, `package-lock.json`, `_`-prefixed files. None of the tasks below need them. (`/resume-roast/index.html` already serves as a static file, so the sibling `rewrite.html` needs no route config.)

---

### Task 1: Export the backoff helper + JSON parser from teardownComposer

The rewrite composer reuses `_callClaudeWithBackoff` and `parseJson` instead of duplicating them.

**Files:**
- Modify: `api/_lib/ambientScore/teardownComposer.js:192-201` (module.exports only)
- Test: `api/_lib/ambientScore/teardown.test.js` (existing, unchanged)

- [ ] **Step 1: Add the two exports**

In `api/_lib/ambientScore/teardownComposer.js`, replace the module.exports block:

```js
module.exports = {
  buildTeardownToken,
  queueTeardownOrder,
  advanceQueue,
  buildTeardownPrompt,
  composeTeardown,
  validateTeardown,
  parseJson,
  callClaudeWithBackoff: _callClaudeWithBackoff,
  QUEUE_CAP,
  MAX_RETRIES
};
```

- [ ] **Step 2: Run the existing teardown tests**

Run: `node api/_lib/ambientScore/teardown.test.js`
Expected: all PASS, exit 0 (output ends `teardown tests: N passed, 0 failed`).

- [ ] **Step 3: Commit**

```bash
git add api/_lib/ambientScore/teardownComposer.js
git commit -m "refactor: export backoff helper and parseJson from teardownComposer for reuse"
```

---

### Task 2: Rewrite composer library (pure functions, TDD)

**Files:**
- Create: `api/_lib/roastRewrite/composer.js`
- Create: `api/_lib/roastRewrite/composer.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/_lib/roastRewrite/composer.test.js`:

```js
#!/usr/bin/env node
// composer.test.js — unit tests for the roast-rewrite composer (pure, no network)
// Run: node api/_lib/roastRewrite/composer.test.js

const assert = require('assert');
const composer = require('./composer');

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  \x1b[32mPASS\x1b[0m ' + name); })
    .catch(e => { failed++; errors.push({ name, error: e.message }); console.log('  \x1b[31mFAIL\x1b[0m ' + name + ' : ' + e.message); })
    .then(run);
}

const queue = [];
function enqueue(name, fn) { queue.push({ name, fn }); }
function run() {
  const next = queue.shift();
  if (!next) return finish();
  test(next.name, next.fn);
}
function finish() {
  console.log('\nroast-rewrite composer tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

const NOW = '2026-08-02T12:00:00.000Z';

function makeSession(overrides) {
  return Object.assign({
    id: 'cs_test_' + Math.random().toString(36).slice(2, 8),
    metadata: { rewrite: '1', orderId: 'rr_1' },
    customer_details: { email: 'buyer@example.com' }
  }, overrides);
}

function goodRewrite() {
  return {
    rewritten_resume: '# Jane Doe\n' + 'Senior engineer with impact. '.repeat(30),
    changes: [1, 2, 3].map(i => ({ section: 'S' + i, what: 'tightened', why: 'clarity' })),
    ats_keywords: { present: ['javascript'], missing: ['kubernetes'] }
  };
}

// ── Tokens ──

enqueue('token is stable, order-specific, and differs from teardown tokens', () => {
  const a1 = composer.buildRewriteToken('rr_1');
  const a2 = composer.buildRewriteToken('rr_1');
  const b = composer.buildRewriteToken('rr_2');
  assert.strictEqual(a1, a2);
  assert.notStrictEqual(a1, b);
  assert.strictEqual(a1.length, 32);
  const teardown = require('../ambientScore/teardownComposer');
  assert.notStrictEqual(a1, teardown.buildTeardownToken('rr_1'));
});

// ── createOrder ──

enqueue('createOrder returns queue entry + doc with matching orderId', () => {
  const { entry, doc } = composer.createOrder('resume text here', { score: 42 }, NOW);
  assert.ok(entry.orderId.startsWith('rr_'));
  assert.strictEqual(entry.orderId, doc.orderId);
  assert.strictEqual(entry.status, 'created');
  assert.strictEqual(entry.createdAt, NOW);
  assert.strictEqual(doc.resumeText, 'resume text here');
  assert.deepStrictEqual(doc.roastResult, { score: 42 });
  assert.strictEqual(doc.rewrite, null);
  assert.strictEqual(doc.deliveredAt, null);
});

// ── markPaid ──

enqueue('markPaid flips created -> paid and captures Stripe email', () => {
  const { entry } = composer.createOrder('r', null, NOW);
  const session = makeSession({ metadata: { rewrite: '1', orderId: entry.orderId } });
  const { order } = composer.markPaid([entry], session, NOW);
  assert.ok(order);
  assert.strictEqual(order.status, 'paid');
  assert.strictEqual(order.paidAt, NOW);
  assert.strictEqual(order.email, 'buyer@example.com');
  assert.strictEqual(order.sessionId, session.id);
});

enqueue('markPaid dedups on sessionId (webhook retry)', () => {
  const { entry } = composer.createOrder('r', null, NOW);
  const session = makeSession({ metadata: { rewrite: '1', orderId: entry.orderId } });
  const first = composer.markPaid([entry], session, NOW);
  const second = composer.markPaid(first.queue, session, NOW);
  assert.ok(first.order);
  assert.strictEqual(second.order, null);
});

enqueue('markPaid ignores unknown orderId and non-rewrite sessions', () => {
  const { entry } = composer.createOrder('r', null, NOW);
  assert.strictEqual(composer.markPaid([entry], makeSession({ metadata: { rewrite: '1', orderId: 'rr_nope' } }), NOW).order, null);
  assert.strictEqual(composer.markPaid([entry], makeSession({ metadata: { teardown: '1' } }), NOW).order, null);
  assert.strictEqual(entry.status, 'created');
});

// ── advanceQueue ──

enqueue('advanceQueue resets stale processing to paid, fails after retries', () => {
  const stale = { orderId: 'rr_s', status: 'processing', processingAt: NOW, retryCount: 0 };
  const later = Date.parse(NOW) + composer.STALE_PROCESSING_MS + 1000;
  const r1 = composer.advanceQueue([stale], later);
  assert.strictEqual(r1.resets, 1);
  assert.strictEqual(stale.status, 'paid');
  stale.status = 'processing';
  stale.retryCount = composer.MAX_RETRIES;
  const r2 = composer.advanceQueue([stale], later);
  assert.strictEqual(r2.failed, 1);
  assert.strictEqual(stale.status, 'failed');
});

// ── retentionPass ──

enqueue('retentionPass drops stale unpaid orders and flags old delivered resumes for scrub', () => {
  const now = Date.parse(NOW);
  const staleUnpaid = { orderId: 'rr_old', status: 'created', createdAt: new Date(now - composer.UNPAID_TTL_MS - 1000).toISOString() };
  const freshUnpaid = { orderId: 'rr_new', status: 'created', createdAt: NOW };
  const oldDelivered = { orderId: 'rr_del', status: 'delivered', createdAt: NOW, deliveredAt: new Date(now - composer.RESUME_RETENTION_MS - 1000).toISOString() };
  const result = composer.retentionPass([staleUnpaid, freshUnpaid, oldDelivered], now);
  assert.deepStrictEqual(result.removeDocIds, ['rr_old']);
  assert.deepStrictEqual(result.scrubDocIds, ['rr_del']);
  assert.strictEqual(result.queue.length, 2);
  assert.ok(result.queue.find(o => o.orderId === 'rr_del').resumeScrubbed);
  // Second pass is a no-op (scrub flag set, unpaid already removed)
  const again = composer.retentionPass(result.queue, now);
  assert.deepStrictEqual(again.removeDocIds, []);
  assert.deepStrictEqual(again.scrubDocIds, []);
});

// ── Prompt ──

enqueue('prompt carries the integrity constraint and the source resume', () => {
  const p = composer.buildRewritePrompt('UNIQUE_RESUME_MARKER experience', { roast_points: ['weak verbs'] });
  assert.ok(p.includes('UNIQUE_RESUME_MARKER'));
  assert.ok(/never invent/i.test(p));
  assert.ok(p.includes('[add metric]'));
  assert.ok(p.includes('rewritten_resume'));
});

// ── validateRewrite ──

enqueue('validateRewrite accepts good output, rejects bad', () => {
  assert.strictEqual(composer.validateRewrite(goodRewrite()), null);
  assert.ok(composer.validateRewrite(null));
  assert.ok(composer.validateRewrite({ rewritten_resume: 'too short', changes: [], ats_keywords: {} }));
  const noChanges = goodRewrite();
  noChanges.changes = [];
  assert.ok(composer.validateRewrite(noChanges));
});

// ── composeRewrite ──

enqueue('composeRewrite returns parsed rewrite from a stubbed Claude', async () => {
  const stub = async () => JSON.stringify(goodRewrite());
  const out = await composer.composeRewrite('resume', null, stub);
  assert.strictEqual(composer.validateRewrite(out), null);
});

enqueue('composeRewrite retries a malformed first attempt at lower temperature', async () => {
  let calls = 0;
  const stub = async (prompt, opts) => {
    calls++;
    if (calls === 1) return 'not json at all {{{';
    assert.strictEqual(opts.temperature, 0.2);
    return JSON.stringify(goodRewrite());
  };
  const out = await composer.composeRewrite('resume', null, stub);
  assert.strictEqual(calls, 2);
  assert.ok(out.rewritten_resume);
});

enqueue('composeRewrite throws after both attempts fail', async () => {
  const stub = async () => 'garbage';
  await assert.rejects(() => composer.composeRewrite('resume', null, stub), /failed after retries/);
});

run();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node api/_lib/roastRewrite/composer.test.js`
Expected: crash with `Cannot find module './composer'`.

- [ ] **Step 3: Write the composer**

Create `api/_lib/roastRewrite/composer.js`:

```js
// composer.js — turns a free roast + resume text into the $9 Deep Roast Rewrite.
// Pure functions with the Claude call injected, mirroring teardownComposer.
// Consumed by roast-rewrite (token/order/compose), as-webhook (markPaid) and
// roastRewriteRunner (backstop compose + retention).

const crypto = require('crypto');
const { parseJson, callClaudeWithBackoff } = require('../ambientScore/teardownComposer');

const FORM_INTAKE_SALT = process.env.FORM_INTAKE_SALT || 'ambientos-intake-v1-default';
const QUEUE_CAP = 300;
const STALE_PROCESSING_MS = 10 * 60 * 1000;        // one Claude call; 10 min stuck = crashed
const MAX_RETRIES = 2;
const UNPAID_TTL_MS = 48 * 60 * 60 * 1000;          // created-but-never-paid orders
const RESUME_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // spec: scrub resume text 30d post-delivery
const PRICE_CENTS_DEFAULT = 900;
const RESUME_MAX_CHARS = 20000;

// ── Tokens ───────────────────────────────────────────────────────

function buildRewriteToken(orderId) {
  return crypto.createHmac('sha256', FORM_INTAKE_SALT)
    .update('rewrite:' + orderId)
    .digest('hex')
    .slice(0, 32);
}

// ── Orders (pure) ────────────────────────────────────────────────

// Resume text is too large for Stripe metadata, so unlike teardowns the order
// exists BEFORE checkout: queue entry (small, status machine) + doc (payload).
function createOrder(resumeText, roastResult, nowIso) {
  const orderId = 'rr_' + Date.parse(nowIso) + '_' + crypto.randomBytes(2).toString('hex');
  return {
    entry: { orderId, status: 'created', createdAt: nowIso, retryCount: 0, email: null },
    doc: {
      orderId,
      resumeText: String(resumeText).slice(0, RESUME_MAX_CHARS),
      roastResult: roastResult || null,
      rewrite: null,
      createdAt: nowIso,
      paidAt: null,
      deliveredAt: null
    }
  };
}

// Webhook path. Dedups on sessionId so Stripe retries never double-fire.
function markPaid(queue, session, nowIso) {
  const q = Array.isArray(queue) ? queue.slice() : [];
  const md = (session && session.metadata) || {};
  if (md.rewrite !== '1' || !md.orderId) return { queue: q, order: null };
  if (q.some(o => o && o.sessionId === session.id)) return { queue: q, order: null };
  const order = q.find(o => o && o.orderId === md.orderId);
  if (!order || order.status !== 'created') return { queue: q, order: null };
  order.status = 'paid';
  order.paidAt = nowIso;
  order.sessionId = session.id;
  order.email = (session.customer_details && session.customer_details.email) || null;
  return { queue: q, order };
}

// Self-heal: a crash mid-compose leaves 'processing'; after STALE_PROCESSING_MS
// it goes back to 'paid' (retryCount++) until retries are exhausted.
function advanceQueue(queue, nowMs) {
  const q = Array.isArray(queue) ? queue : [];
  let resets = 0;
  let failed = 0;
  for (const order of q) {
    if (!order || order.status !== 'processing') continue;
    const startedMs = Date.parse(order.processingAt || 0);
    if (!Number.isFinite(startedMs) || nowMs - startedMs < STALE_PROCESSING_MS) continue;
    order.retryCount = (order.retryCount || 0) + 1;
    if (order.retryCount > MAX_RETRIES) {
      order.status = 'failed';
      order.error = 'retries exhausted after stale processing';
      failed++;
    } else {
      order.status = 'paid';
      resets++;
    }
  }
  return { queue: q, resets, failed };
}

// Retention (runner tick): drop never-paid orders after 48h (delete their docs,
// which hold resume text) and scrub resume text from docs 30d after delivery.
function retentionPass(queue, nowMs) {
  const q = Array.isArray(queue) ? queue : [];
  const removeDocIds = [];
  const scrubDocIds = [];
  const kept = [];
  for (const order of q) {
    if (!order) continue;
    if (order.status === 'created' && nowMs - Date.parse(order.createdAt || 0) > UNPAID_TTL_MS) {
      removeDocIds.push(order.orderId);
      continue;
    }
    if (order.status === 'delivered' && !order.resumeScrubbed
        && nowMs - Date.parse(order.deliveredAt || 0) > RESUME_RETENTION_MS) {
      order.resumeScrubbed = true;
      scrubDocIds.push(order.orderId);
    }
    kept.push(order);
  }
  return { queue: kept, removeDocIds, scrubDocIds };
}

// ── Composition ──────────────────────────────────────────────────

function buildRewritePrompt(resumeText, roastResult) {
  const roast = roastResult
    ? JSON.stringify(roastResult).slice(0, 4000)
    : 'none provided';
  return [
    'You are a senior professional resume writer. A client paid for a full rewrite of their resume after receiving the automated roast below.',
    '',
    'INTEGRITY RULES (non-negotiable):',
    '- Use ONLY facts present in the source resume. NEVER invent employers, job titles, dates, degrees, certifications, skills, or metrics.',
    '- Where a bullet would benefit from a number the source does not contain, write the literal placeholder [add metric] for the client to fill in.',
    '- Keep the true chronology. Reordering sections is fine; changing history is not.',
    '',
    'ROAST FINDINGS (fix these):',
    roast,
    '',
    'SOURCE RESUME:',
    String(resumeText).slice(0, RESUME_MAX_CHARS),
    '',
    'Rewrite the resume: strong action verbs, achievement-first bullets, clean ATS-parseable structure (standard section headers, no tables or columns), tight professional summary.',
    '',
    'Respond with STRICT JSON only, no code fences, no prose outside JSON:',
    '{',
    '  "rewritten_resume": "<the complete rewritten resume in clean Markdown, every section>",',
    '  "changes": [3-8 of {"section": "<section name>", "what": "<what changed>", "why": "<why it helps>"}],',
    '  "ats_keywords": {"present": ["<keyword>", ...], "missing": ["<keyword worth adding IF the client truly has the experience>", ...]}',
    '}',
    '',
    'Rules: no em dashes anywhere. No invented statistics. The rewritten_resume must be complete and usable as-is.'
  ].join('\n');
}

function validateRewrite(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (typeof r.rewritten_resume !== 'string' || r.rewritten_resume.trim().length < 400) return 'rewritten_resume too short';
  if (!Array.isArray(r.changes) || r.changes.length < 3 || r.changes.length > 8) return 'changes must be 3-8 items';
  for (const c of r.changes) {
    if (!c || !c.section || !c.what || !c.why) return 'change missing field';
  }
  if (!r.ats_keywords || !Array.isArray(r.ats_keywords.present) || !Array.isArray(r.ats_keywords.missing)) return 'ats_keywords malformed';
  return null;
}

// One composition; malformed output retries once cooler; transient upstream
// errors retry with backoff inside each attempt (shared teardown helper —
// a paid $9 order must not die on an Anthropic 500 burst).
async function composeRewrite(resumeText, roastResult, callClaude) {
  const prompt = buildRewritePrompt(resumeText, roastResult);
  const attempts = [{ temperature: 0.4 }, { temperature: 0.2 }];
  let lastErr = null;
  for (const opts of attempts) {
    try {
      const raw = await callClaudeWithBackoff(callClaude, prompt, {
        temperature: opts.temperature,
        maxOutputTokens: 4000,
        caller: 'roast-rewrite-compose'
      });
      const parsed = parseJson(raw);
      const problem = validateRewrite(parsed);
      if (problem) throw new Error('rewrite validation failed: ' + problem);
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error('composeRewrite failed after retries: ' + (lastErr && lastErr.message));
}

module.exports = {
  buildRewriteToken,
  createOrder,
  markPaid,
  advanceQueue,
  retentionPass,
  buildRewritePrompt,
  validateRewrite,
  composeRewrite,
  QUEUE_CAP,
  MAX_RETRIES,
  STALE_PROCESSING_MS,
  UNPAID_TTL_MS,
  RESUME_RETENTION_MS,
  PRICE_CENTS_DEFAULT,
  RESUME_MAX_CHARS
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node api/_lib/roastRewrite/composer.test.js`
Expected: `roast-rewrite composer tests: 12 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/roastRewrite/
git commit -m "feat: roast-rewrite composer lib (orders, integrity-constrained prompt, retention)"
```

---

### Task 3: Stripe checkout for the rewrite

**Files:**
- Modify: `api/_lib/ambientScore/stripeClient.js` (add one function + export)

- [ ] **Step 1: Add `createRewriteCheckout`**

In `api/_lib/ambientScore/stripeClient.js`, after `createTeardownCheckout` (line ~109), add:

```js
// ── Create Rewrite Checkout ($9 Deep Roast Rewrite) ──────────────
// Inline price_data like the teardown. The order already exists server-side
// (resume text is too large for metadata) so metadata carries only the id.

async function createRewriteCheckout({ orderId, token, priceCents, utmContent, utmSource }) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  if (!orderId || !token) throw new Error('orderId and token required');

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('allow_promotion_codes', 'true');
  // Same card+link pinning as createCheckoutSession — see comment there.
  params.append('payment_method_types[0]', 'card');
  params.append('payment_method_types[1]', 'link');
  params.append('line_items[0][price_data][currency]', 'usd');
  params.append('line_items[0][price_data][unit_amount]', String(priceCents || 900));
  params.append('line_items[0][price_data][product_data][name]', 'Deep Roast Resume Rewrite');
  params.append('line_items[0][price_data][product_data][description]', 'Your resume professionally rewritten and ATS-optimized, based on your roast. Ready in minutes.');
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', SITE_URL + '/resume-roast/rewrite.html?id=' + orderId + '&key=' + token);
  params.append('cancel_url', SITE_URL + '/pixel-agents/run.html?agent=resume-roast&cancelled=1');
  params.append('metadata[rewrite]', '1');
  params.append('metadata[orderId]', orderId);
  if (utmContent) params.append('metadata[utm_content]', String(utmContent).slice(0, 120));
  if (utmSource) params.append('metadata[utm_source]', String(utmSource).slice(0, 50));

  const res = await axios.post(STRIPE_BASE + '/checkout/sessions', params.toString(), {
    headers: {
      'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    timeout: 15000
  });

  return { checkoutUrl: res.data.url, sessionId: res.data.id };
}
```

Then extend the exports line at the bottom of the file:

```js
module.exports = { createCheckoutSession, createTeardownCheckout, createRewriteCheckout, createOffer, verifySession, verifyWebhookSignature };
```

- [ ] **Step 2: Syntax check**

Run: `node -e "require('./api/_lib/ambientScore/stripeClient.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add api/_lib/ambientScore/stripeClient.js
git commit -m "feat: Stripe checkout session for $9 roast rewrite"
```

---

### Task 4: `/api/roast-rewrite` endpoint (create, poll+compose, requeue, status)

**Files:**
- Create: `api/roast-rewrite/index.js`
- Create: `api/roast-rewrite/function.json`

- [ ] **Step 1: Create `api/roast-rewrite/function.json`**

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get", "post", "options"],
      "route": "roast-rewrite"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

- [ ] **Step 2: Create `api/roast-rewrite/index.js`**

```js
// roast-rewrite — GET/POST /api/roast-rewrite
// The $9 Deep Roast Rewrite surface:
//   GET  ?config=1                       -> { enabled, priceCents } (public, gates the upsell card)
//   POST { action:'create', resumeText, roastResult } -> order + Stripe checkout URL
//   GET  ?id=<orderId>&key=<hmac>        -> order status; composes inline on first poll after payment
//   POST { action:'status' }             -> queue dump (secret-gated, CEO ops)
//   POST { action:'requeue', id }        -> failed -> paid (secret-gated, CEO recovery)
//
// Compose-on-poll: the Stripe success page polls this GET; the first poll that
// finds the order 'paid' runs the single Claude call inline (~30-60s) so
// delivery beats any cron cadence. roastRewriteRunner is the backstop for
// buyers who close the tab before the success page loads.

const storage = require('../_utils/companyStorage');
const stripeClient = require('../_lib/ambientScore/stripeClient');
const composer = require('../_lib/roastRewrite/composer');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const MAX_CREATES_PER_HOUR = 5;
const QUEUE_KEY = 'roast_rewrite_queue';

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || 'unknown';
}

// Same blob + shape as as-teardown's limiter, separate namespace key.
async function checkRateLimit(ip) {
  const key = 'cc_rewrite_ratelimit';
  const now = Date.now();
  const hourAgo = now - 3600000;
  let limits = (await storage.getState(key)) || {};
  for (const k of Object.keys(limits)) {
    limits[k] = (limits[k] || []).filter(ts => ts > hourAgo);
    if (limits[k].length === 0) delete limits[k];
  }
  const hits = limits[ip] || [];
  if (hits.length >= MAX_CREATES_PER_HOUR) return true;
  hits.push(now);
  limits[ip] = hits;
  await storage.setState(key, limits);
  return false;
}

async function getConfig() {
  const cfg = (await storage.getState('systemConfig')) || {};
  const rr = cfg.roastRewrite || {};
  return {
    enabled: rr.enabled === true,
    priceCents: Number.isFinite(Number(rr.priceCents)) && Number(rr.priceCents) > 0
      ? Number(rr.priceCents)
      : composer.PRICE_CENTS_DEFAULT
  };
}

function tokenValid(orderId, key) {
  return !!orderId && !!key && composer.buildRewriteToken(orderId) === String(key);
}

// Client payload for the delivery page. Never includes resumeText.
function orderView(order, doc) {
  const view = { orderId: order.orderId, status: order.status, createdAt: order.createdAt };
  if (order.status === 'delivered' && doc && doc.rewrite) {
    view.rewrite = doc.rewrite;
    view.deliveredAt = order.deliveredAt || doc.deliveredAt;
  }
  return view;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    // ── GET ──
    if (req.method === 'GET') {
      if (req.query.config === '1') {
        const cfg = await getConfig();
        context.res = { status: 200, headers: CORS_HEADERS, body: cfg };
        return;
      }

      const orderId = req.query.id;
      const key = req.query.key;
      if (!tokenValid(orderId, key)) {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Invalid or missing key.' } };
        return;
      }

      let queue = (await storage.getState(QUEUE_KEY)) || [];
      const order = queue.find(o => o && o.orderId === orderId);
      if (!order) {
        context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Order not found.' } };
        return;
      }

      // Compose-on-poll: first poll after payment does the work inline.
      if (order.status === 'paid') {
        order.status = 'processing';
        order.processingAt = new Date().toISOString();
        await storage.setState(QUEUE_KEY, queue);

        const doc = await storage.getState('roast_rewrite_' + orderId);
        if (!doc || !doc.resumeText) {
          order.status = 'failed';
          order.error = 'order doc missing';
          await storage.setState(QUEUE_KEY, queue);
          context.res = { status: 200, headers: CORS_HEADERS, body: orderView(order, null) };
          return;
        }

        try {
          const { callClaude } = require('../_lib/ambientScore/analyzer');
          const rewrite = await composer.composeRewrite(doc.resumeText, doc.roastResult, callClaude);
          const nowIso = new Date().toISOString();
          doc.rewrite = rewrite;
          doc.deliveredAt = nowIso;
          await storage.setState('roast_rewrite_' + orderId, doc);

          // Re-read the queue: the compose took ~a minute and another writer
          // (webhook for a different order, runner tick) may have saved since.
          queue = (await storage.getState(QUEUE_KEY)) || [];
          const fresh = queue.find(o => o && o.orderId === orderId) || order;
          fresh.status = 'delivered';
          fresh.deliveredAt = nowIso;
          await storage.setState(QUEUE_KEY, queue);

          if (fresh.email) {
            try {
              const emailSender = require('../_lib/ambientScore/emailSender');
              const SITE_URL = process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai';
              const viewLink = SITE_URL + '/resume-roast/rewrite.html?id=' + orderId + '&key=' + composer.buildRewriteToken(orderId);
              await emailSender.sendRewriteReadyEmail(fresh.email, viewLink);
            } catch (mailErr) {
              context.log.warn('[roast-rewrite] ready email failed (non-fatal):', mailErr.message);
            }
          }

          context.res = { status: 200, headers: CORS_HEADERS, body: orderView(fresh, doc) };
          return;
        } catch (err) {
          context.log.error('[roast-rewrite] compose failed for ' + orderId + ':', err.message);
          order.retryCount = (order.retryCount || 0) + 1;
          order.error = String(err.message || err).slice(0, 300);
          order.status = order.retryCount > composer.MAX_RETRIES ? 'failed' : 'paid';
          await storage.setState(QUEUE_KEY, queue);
          // Report 'processing' while retries remain so the page keeps polling.
          const reported = order.status === 'failed' ? order : Object.assign({}, order, { status: 'processing' });
          context.res = { status: 200, headers: CORS_HEADERS, body: orderView(reported, null) };
          return;
        }
      }

      const doc = order.status === 'delivered' ? await storage.getState('roast_rewrite_' + orderId) : null;
      context.res = { status: 200, headers: CORS_HEADERS, body: orderView(order, doc) };
      return;
    }

    // ── POST actions ──
    const body = req.body || {};

    if (body.action === 'status') {
      if (req.headers['x-company-secret'] !== 'pixelpusher') {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Forbidden.' } };
        return;
      }
      const queue = (await storage.getState(QUEUE_KEY)) || [];
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          orders: queue.map(o => ({
            orderId: o.orderId, status: o.status, email: o.email || null,
            createdAt: o.createdAt, paidAt: o.paidAt || null, deliveredAt: o.deliveredAt || null,
            retryCount: o.retryCount || 0, error: o.error || null,
            key: composer.buildRewriteToken(o.orderId)
          }))
        }
      };
      return;
    }

    if (body.action === 'requeue') {
      if (req.headers['x-company-secret'] !== 'pixelpusher') {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Forbidden.' } };
        return;
      }
      const requeueId = String(body.id || body.orderId || '');
      const rqQueue = (await storage.getState(QUEUE_KEY)) || [];
      const rqOrder = rqQueue.find(o => o && o.orderId === requeueId);
      if (!rqOrder) {
        context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Order not found.', orderId: requeueId } };
        return;
      }
      if (rqOrder.status !== 'failed') {
        context.res = { status: 409, headers: CORS_HEADERS, body: { error: 'Only failed orders can be requeued.', orderId: requeueId, status: rqOrder.status } };
        return;
      }
      rqOrder.status = 'paid';
      rqOrder.retryCount = 0;
      rqOrder.error = null;
      rqOrder.requeuedAt = new Date().toISOString();
      await storage.setState(QUEUE_KEY, rqQueue);
      context.log('[roast-rewrite] Order requeued by CEO:', requeueId);
      context.res = { status: 200, headers: CORS_HEADERS, body: { ok: true, orderId: requeueId, status: 'paid' } };
      return;
    }

    if (body.action === 'create') {
      const cfg = await getConfig();
      if (!cfg.enabled) {
        context.res = { status: 503, headers: CORS_HEADERS, body: { error: 'Rewrites are not available right now.' } };
        return;
      }
      const resumeText = String(body.resumeText || '').trim();
      if (resumeText.length < 200 || resumeText.length > composer.RESUME_MAX_CHARS) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Resume text must be between 200 and ' + composer.RESUME_MAX_CHARS + ' characters.' } };
        return;
      }
      if (await checkRateLimit(getClientIP(req))) {
        context.res = { status: 429, headers: CORS_HEADERS, body: { error: 'Too many requests. Try again in an hour.' } };
        return;
      }

      const nowIso = new Date().toISOString();
      const roastResult = (body.roastResult && typeof body.roastResult === 'object') ? body.roastResult : null;
      const { entry, doc } = composer.createOrder(resumeText, roastResult, nowIso);

      const queue = (await storage.getState(QUEUE_KEY)) || [];
      queue.push(entry);
      while (queue.length > composer.QUEUE_CAP) queue.shift();
      await storage.setState('roast_rewrite_' + entry.orderId, doc);
      await storage.setState(QUEUE_KEY, queue);

      const session = await stripeClient.createRewriteCheckout({
        orderId: entry.orderId,
        token: composer.buildRewriteToken(entry.orderId),
        priceCents: cfg.priceCents,
        utmContent: String(body.utmContent || '').trim() || null,
        utmSource: String(body.utmSource || '').trim() || null
      });
      context.res = { status: 200, headers: CORS_HEADERS, body: { checkoutUrl: session.checkoutUrl, orderId: entry.orderId } };
      return;
    }

    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Unknown action.' } };
  } catch (err) {
    context.log.error('[roast-rewrite] Error:', err.message || err);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Something went wrong. Please try again.' } };
  }
};
```

- [ ] **Step 3: Syntax check**

Run: `node -e "require('./api/roast-rewrite/index.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add api/roast-rewrite/
git commit -m "feat: roast-rewrite endpoint (create/poll-compose/requeue/status), kill-switched off"
```

---

### Task 5: `sendRewriteReadyEmail` in emailSender

**Files:**
- Modify: `api/_lib/ambientScore/emailSender.js` (add one function + export)

- [ ] **Step 1: Add the function**

In `api/_lib/ambientScore/emailSender.js`, before the `module.exports` line (line ~187), add:

```js
async function sendRewriteReadyEmail(toEmail, viewLink) {
  return sendAcsEmail(toEmail, 'Your resume rewrite is ready',
    '<p>Your Deep Roast Rewrite is done. Your resume has been professionally rewritten and ATS-optimized.</p>' +
    '<p><a href="' + viewLink + '">View your rewritten resume</a></p>' +
    '<p>Keep this link — it is your copy. Not happy with the rewrite? Reply to this email and we will refund you, no questions asked.</p>');
}
```

Then extend the exports:

```js
module.exports = { sendReportEmail, sendTeardownAckEmail, sendTeardownCeoNotify, sendTeardownDeliveryEmail, sendRewriteReadyEmail };
```

- [ ] **Step 2: Syntax check**

Run: `node -e "require('./api/_lib/ambientScore/emailSender.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add api/_lib/ambientScore/emailSender.js
git commit -m "feat: rewrite-ready delivery email"
```

---

### Task 6: Webhook branch for rewrite payments

**Files:**
- Modify: `api/as-webhook/index.js` (insert a block inside the `checkout.session.completed` handler, BEFORE the teardown block at line ~41)

- [ ] **Step 1: Add the rewrite branch**

In `api/as-webhook/index.js`, directly after `const session = event.data.object;` (line ~36) and before the teardown `if (session.metadata?.teardown === '1') {` block, insert:

```js
      // Rewrite orders ($9 Deep Roast Rewrite) — flip the pre-created order to
      // paid; composition happens on the delivery page's first poll (or the
      // runner backstop). Every side effect is non-fatal: always return 200.
      if (session.metadata?.rewrite === '1') {
        const rrComposer = require('../_lib/roastRewrite/composer');
        let rrOrder = null;
        try {
          const rrQueue = (await storage.getState('roast_rewrite_queue')) || [];
          const rrResult = rrComposer.markPaid(rrQueue, session, new Date().toISOString());
          rrOrder = rrResult.order;
          if (rrOrder) {
            await storage.setState('roast_rewrite_queue', rrResult.queue);
            context.log('[as-webhook] Rewrite order paid: ' + rrOrder.orderId);
          } else {
            context.log('[as-webhook] Rewrite session already processed or order missing: ' + session.id);
          }
        } catch (rrErr) {
          context.log.error('[as-webhook] Rewrite order update failed:', rrErr.message);
        }

        if (rrOrder) {
          try {
            const pa = require('../_utils/productAnalytics');
            await pa.emitEvent('pixelagents', 'rewrite_purchase',
              { orderId: rrOrder.orderId, agentId: 'resume-roast' },
              { category: 'conversion', source: 'server' });
          } catch (paErr) {
            context.log.warn('[as-webhook] rewrite_purchase event failed (non-fatal):', paErr.message);
          }
          try {
            const { dispatchDiscord } = require('../_utils/fleetAlerts');
            await dispatchDiscord({
              title: 'Rewrite order paid: $9',
              description: 'Deep Roast Rewrite ' + rrOrder.orderId + (rrOrder.email ? (' for ' + rrOrder.email) : ''),
              color: 0x2E7D32
            });
          } catch (alertErr) {
            context.log.warn('[as-webhook] Rewrite Discord alert failed (non-fatal):', alertErr.message);
          }
        }

        await revenueRecorder.recordCheckoutRevenue({
          event: event,
          session: session,
          product: 'pixelagents',
          type: 'one_time',
          plan: 'roast_rewrite',
          fallbackCents: 900,
          log: context.log
        });

        context.res = { status: 200, body: JSON.stringify({ received: true }) };
        return;
      }
```

**Known limitation (documented, not fixed here):** the `charge.refunded` handler at the bottom of this file records all refunds under product `ambientscore`. A refunded $9 rewrite will be misattributed by product (amount still correct). Acceptable at v1 volume; noted in the spec's verification section.

- [ ] **Step 2: Syntax check**

Run: `node -e "require('./api/as-webhook/index.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add api/as-webhook/index.js
git commit -m "feat: as-webhook handles $9 rewrite payments (paid flip, ledger, analytics)"
```

---

### Task 7: Backstop runner + retention

**Files:**
- Create: `api/roastRewriteRunner/index.js`
- Create: `api/roastRewriteRunner/function.json`

New timer function instead of modifying `asTeardownRunner` — zero blast radius on the $199 pipeline. Cron grid: heartbeat :00 even hours, asTeardownRunner :05/15min, asProspectCron :25 — this runs at :12/15min (:12, :27, :42, :57).

- [ ] **Step 1: Create `api/roastRewriteRunner/function.json`**

```json
{
  "bindings": [
    {
      "name": "rewriteTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 12/15 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Create `api/roastRewriteRunner/index.js`**

```js
// roastRewriteRunner — Timer Trigger (every 15 min at :12; grid: heartbeat :00
// even hours, asTeardownRunner :05, asProspectCron :25).
//
// Backstop for the $9 Deep Roast Rewrite: compose-on-poll (roast-rewrite GET)
// handles buyers who reach the delivery page; this catches orders whose buyer
// closed the tab after paying (composes + emails the link) plus:
//   - advanceQueue self-heal (stale 'processing' -> 'paid' -> 'failed')
//   - retention: unpaid orders dropped after 48h, resume text scrubbed 30d
//     after delivery (docs hold resumes = PII)
// One order per tick — a rewrite is a single Claude call.

const storage = require('../_utils/companyStorage');
const composer = require('../_lib/roastRewrite/composer');
const { dispatchDiscord } = require('../_utils/fleetAlerts');

const SITE_URL = process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai';
const QUEUE_KEY = 'roast_rewrite_queue';
// Give compose-on-poll first shot: only orders paid >3 min ago are picked up.
const BACKSTOP_GRACE_MS = 3 * 60 * 1000;

module.exports = async function (context) {
  let queue;
  try {
    queue = (await storage.getState(QUEUE_KEY)) || [];
  } catch (err) {
    context.log.error('[roastRewriteRunner] queue load failed:', err.message);
    return;
  }
  if (!Array.isArray(queue) || queue.length === 0) return;

  const now = Date.now();

  // Self-heal stale processing entries.
  const healed = composer.advanceQueue(queue, now);
  queue = healed.queue;
  let dirty = healed.resets > 0 || healed.failed > 0;
  if (healed.failed) {
    await dispatchDiscord({
      title: 'Rewrite order FAILED after retries',
      description: 'Check roast_rewrite_queue for status failed. Refund may be owed ($9).',
      color: 0xC62828
    });
  }

  // Retention: drop stale unpaid orders (and their docs), scrub old resumes.
  const retention = composer.retentionPass(queue, now);
  queue = retention.queue;
  dirty = dirty || retention.removeDocIds.length > 0 || retention.scrubDocIds.length > 0;
  for (const id of retention.removeDocIds) {
    try { await storage.setState('roast_rewrite_' + id, { purged: true }); } catch (e) { /* retried next tick via flag loss — acceptable */ }
  }
  for (const id of retention.scrubDocIds) {
    try {
      const doc = await storage.getState('roast_rewrite_' + id);
      if (doc && doc.resumeText) {
        delete doc.resumeText;
        doc.roastResult = null;
        await storage.setState('roast_rewrite_' + id, doc);
      }
    } catch (e) {
      context.log.warn('[roastRewriteRunner] scrub failed for ' + id + ':', e.message);
    }
  }
  if (dirty) {
    try { await storage.setState(QUEUE_KEY, queue); } catch (e) { /* retried next tick */ }
  }

  // Backstop compose: one paid order past the grace window.
  const order = queue.find(o => o && o.status === 'paid'
    && now - Date.parse(o.paidAt || o.createdAt || 0) > BACKSTOP_GRACE_MS);
  if (!order) return;

  order.status = 'processing';
  order.processingAt = new Date().toISOString();
  try {
    await storage.setState(QUEUE_KEY, queue);
  } catch (err) {
    context.log.error('[roastRewriteRunner] crash-marker save failed, skipping tick:', err.message);
    return;
  }

  try {
    const doc = await storage.getState('roast_rewrite_' + order.orderId);
    if (!doc || !doc.resumeText) throw new Error('order doc missing');

    const { callClaude } = require('../_lib/ambientScore/analyzer');
    const rewrite = await composer.composeRewrite(doc.resumeText, doc.roastResult, callClaude);
    const nowIso = new Date().toISOString();
    doc.rewrite = rewrite;
    doc.deliveredAt = nowIso;
    await storage.setState('roast_rewrite_' + order.orderId, doc);

    order.status = 'delivered';
    order.deliveredAt = nowIso;
    await storage.setState(QUEUE_KEY, queue);
    context.log('[roastRewriteRunner] delivered ' + order.orderId);

    if (order.email) {
      try {
        const emailSender = require('../_lib/ambientScore/emailSender');
        const viewLink = SITE_URL + '/resume-roast/rewrite.html?id=' + order.orderId + '&key=' + composer.buildRewriteToken(order.orderId);
        await emailSender.sendRewriteReadyEmail(order.email, viewLink);
      } catch (mailErr) {
        context.log.warn('[roastRewriteRunner] ready email failed (non-fatal):', mailErr.message);
      }
    }
  } catch (err) {
    context.log.error('[roastRewriteRunner] compose failed for ' + order.orderId + ':', err.message);
    order.retryCount = (order.retryCount || 0) + 1;
    order.error = String(err.message || err).slice(0, 300);
    order.status = order.retryCount > composer.MAX_RETRIES ? 'failed' : 'paid';
    try { await storage.setState(QUEUE_KEY, queue); } catch (e) { /* self-heal covers */ }
    if (order.status === 'failed') {
      await dispatchDiscord({
        title: 'Rewrite order FAILED after retries',
        description: order.orderId + ': ' + order.error + '\nRefund may be owed ($9).',
        color: 0xC62828
      });
    }
  }
};
```

- [ ] **Step 3: Syntax check**

Run: `node -e "require('./api/roastRewriteRunner/index.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add api/roastRewriteRunner/
git commit -m "feat: roastRewriteRunner backstop (compose for closed tabs, self-heal, PII retention)"
```

---

### Task 8: Delivery page

**Files:**
- Create: `resume-roast/rewrite.html`

- [ ] **Step 1: Create `resume-roast/rewrite.html`**

Look at `resume-roast/index.html`'s `<head>` (first ~40 lines) and copy its meta/viewport/favicon/font conventions so the page matches the roast brand, then use this structure and script (adapt class names only if index.html's CSS obviously provides equivalents — do not invent new frameworks):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Your Resume Rewrite — AmbientPixels</title>
  <link rel="stylesheet" href="/css/base.css" />
  <link rel="stylesheet" href="/css/components.css" />
  <link rel="stylesheet" href="/css/theme.css" />
  <style>
    .rw-wrap { max-width: 820px; margin: 0 auto; padding: 2rem 1rem 4rem; }
    .rw-status { text-align: center; padding: 3rem 1rem; }
    .rw-spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid rgba(127,127,127,.3); border-top-color: currentColor; border-radius: 50%; animation: rw-spin 0.9s linear infinite; }
    @keyframes rw-spin { to { transform: rotate(360deg); } }
    .rw-doc { white-space: pre-wrap; font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; font-size: 0.92rem; line-height: 1.55; background: rgba(127,127,127,.08); border-radius: 8px; padding: 1.5rem; overflow-x: auto; }
    .rw-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 1rem 0 2rem; }
    .rw-section { margin-top: 2rem; }
    .rw-changes li { margin-bottom: 0.5rem; }
    .rw-keywords span { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; background: rgba(127,127,127,.15); margin: 0 0.3rem 0.3rem 0; font-size: 0.85rem; }
    .rw-refund { opacity: 0.75; font-size: 0.9rem; margin-top: 2rem; }
    @media print { .rw-actions, .rw-refund, .rw-section-hide-print { display: none; } .rw-doc { background: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="rw-wrap">
    <div id="rw-loading" class="rw-status">
      <div class="rw-spinner"></div>
      <h1>Your rewrite is being prepared</h1>
      <p>Usually ready in about a minute. This page updates automatically — a copy of the link is also in your email receipt confirmation.</p>
    </div>
    <div id="rw-error" class="rw-status" style="display:none">
      <h1>Something went wrong</h1>
      <p id="rw-error-msg"></p>
    </div>
    <div id="rw-ready" style="display:none">
      <h1>Your rewritten resume</h1>
      <div class="rw-actions">
        <button class="btn" id="rw-copy">Copy to clipboard</button>
        <button class="btn" id="rw-download-md">Download .md</button>
        <button class="btn" id="rw-download-txt">Download .txt</button>
        <button class="btn" id="rw-print">Print</button>
      </div>
      <div class="rw-doc" id="rw-resume"></div>
      <div class="rw-section rw-section-hide-print">
        <h2>What changed and why</h2>
        <ul class="rw-changes" id="rw-changes"></ul>
      </div>
      <div class="rw-section rw-section-hide-print">
        <h2>ATS keywords</h2>
        <p>Found in your resume:</p><div class="rw-keywords" id="rw-kw-present"></div>
        <p>Worth adding if you genuinely have the experience:</p><div class="rw-keywords" id="rw-kw-missing"></div>
      </div>
      <p class="rw-refund">Not happy with the rewrite? Reply to your receipt email and we'll refund you, no questions asked.</p>
    </div>
  </div>
  <script>
    (function () {
      var params = new URLSearchParams(location.search);
      var id = params.get('id');
      var key = params.get('key');
      var POLL_MS = 5000;
      var MAX_POLLS = 120; // 10 minutes, then show the email fallback message

      function esc(s) {
        var d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
      }

      function showError(msg) {
        document.getElementById('rw-loading').style.display = 'none';
        document.getElementById('rw-error').style.display = '';
        document.getElementById('rw-error-msg').textContent = msg;
      }

      function download(filename, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }

      function render(data) {
        var rw = data.rewrite;
        document.getElementById('rw-loading').style.display = 'none';
        document.getElementById('rw-ready').style.display = '';
        document.getElementById('rw-resume').textContent = rw.rewritten_resume;
        document.getElementById('rw-changes').innerHTML = (rw.changes || [])
          .map(function (c) { return '<li><strong>' + esc(c.section) + ':</strong> ' + esc(c.what) + ' <em>(' + esc(c.why) + ')</em></li>'; })
          .join('');
        var kw = rw.ats_keywords || {};
        document.getElementById('rw-kw-present').innerHTML = (kw.present || []).map(function (k) { return '<span>' + esc(k) + '</span>'; }).join('');
        document.getElementById('rw-kw-missing').innerHTML = (kw.missing || []).map(function (k) { return '<span>' + esc(k) + '</span>'; }).join('');
        document.getElementById('rw-copy').onclick = function () {
          navigator.clipboard.writeText(rw.rewritten_resume).then(function () {
            document.getElementById('rw-copy').textContent = 'Copied!';
          });
        };
        document.getElementById('rw-download-md').onclick = function () { download('resume-rewrite.md', rw.rewritten_resume); };
        document.getElementById('rw-download-txt').onclick = function () { download('resume-rewrite.txt', rw.rewritten_resume); };
        document.getElementById('rw-print').onclick = function () { window.print(); };
      }

      if (!id || !key) { showError('This link is missing its key. Use the exact link from your email or checkout.'); return; }

      var polls = 0;
      function poll() {
        polls++;
        fetch('/api/roast-rewrite?id=' + encodeURIComponent(id) + '&key=' + encodeURIComponent(key))
          .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
          .then(function (res) {
            if (!res.ok) { showError(res.body.error || 'Could not load your order.'); return; }
            var s = res.body.status;
            if (s === 'delivered' && res.body.rewrite) { render(res.body); return; }
            if (s === 'failed') { showError('Your rewrite hit a technical problem. We have been alerted — reply to your receipt email for a fix or an instant refund.'); return; }
            if (s === 'created') { showError('This order has not been paid yet. If you just paid, wait a few seconds and refresh.'); return; }
            if (polls >= MAX_POLLS) { showError('This is taking longer than expected. We will email the link when it is ready — you can close this page.'); return; }
            setTimeout(poll, POLL_MS);
          })
          .catch(function () {
            if (polls >= MAX_POLLS) { showError('Network trouble. We will email the link when the rewrite is ready.'); return; }
            setTimeout(poll, POLL_MS);
          });
      }
      poll();
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the `btn` class exists in the shared CSS**

Run: `grep -c "\.btn" css/components.css`
Expected: a number ≥ 1. If 0, check `resume-roast/index.html` for its button class and use that instead (search-before-creating rule — do not invent a new button style).

- [ ] **Step 3: Commit**

```bash
git add resume-roast/rewrite.html
git commit -m "feat: rewrite delivery page (poll, render, copy/download/print)"
```

---

### Task 9: Upsell card on the run page

**Files:**
- Modify: `pixel-agents/js/pixel-agent-run.js` (capture input; append card after `renderResult` sections loop at line ~529; add two functions)
- Modify: `pixel-agents/css/pixel-agent-run.css` (upsell styles)

- [ ] **Step 1: Capture the roast input**

In `pixel-agent-run.js`, find the globals near the top where `currentResult` / `currentRunId` are declared (grep `let currentResult` or `var currentResult`) and add alongside them:

```js
let currentInput = null;
let rewriteCfg = null;
```

Then in the run flow, directly after `currentResult = data;` (line ~359), add:

```js
    currentInput = input;
```

- [ ] **Step 2: Append the upsell hook at the end of `renderResult`**

At the end of `renderResult(data)` — after the `for (const section of sections)` loop closes (line ~529), before the function's closing brace — add:

```js
  maybeRenderRewriteUpsell(body);
```

- [ ] **Step 3: Add the upsell functions**

After `renderResult`'s closing brace (before the `// ── Actions ──` comment at line ~532), add:

```js
// ── $9 Deep Roast Rewrite upsell (resume-roast only, kill-switched) ──
async function getRewriteConfig() {
  if (rewriteCfg) return rewriteCfg;
  try {
    const res = await fetch(getApiBase() + '/roast-rewrite?config=1');
    rewriteCfg = res.ok ? await res.json() : { enabled: false };
  } catch (_) {
    rewriteCfg = { enabled: false };
  }
  return rewriteCfg;
}

function maybeRenderRewriteUpsell(body) {
  if (!currentAgent || currentAgent.id !== 'resume-roast' || !currentInput) return;
  getRewriteConfig().then(cfg => {
    if (!cfg || !cfg.enabled) return;
    if (document.getElementById('pa-rewrite-btn')) return;
    const price = '$' + (Math.round(cfg.priceCents || 900) / 100);
    const card = document.createElement('div');
    card.className = 'pa-result-card pa-rewrite-upsell';
    card.innerHTML =
      '<div class="pa-result-card-label">Want it fixed, not just roasted?</div>' +
      '<div class="pa-rewrite-upsell-body">Get your resume professionally rewritten — ATS-optimized, ready to send, based on this exact roast.</div>' +
      '<button class="pa-rewrite-upsell-btn" id="pa-rewrite-btn">Get the full rewrite — ' + price + '</button>' +
      '<div class="pa-rewrite-upsell-note">Ready in minutes · Not happy? We refund, no questions.</div>';
    body.appendChild(card);
    document.getElementById('pa-rewrite-btn').addEventListener('click', startRewriteCheckout);
    if (window.ProductAnalytics) try { ProductAnalytics.track('rewrite_upsell_view', { agentId: 'resume-roast' }); } catch (_) {}
  });
}

async function startRewriteCheckout() {
  const btn = document.getElementById('pa-rewrite-btn');
  if (!btn || !currentInput) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Opening checkout…';
  if (window.ProductAnalytics) try { ProductAnalytics.track('rewrite_upsell_click', { agentId: 'resume-roast' }); } catch (_) {}
  try {
    const res = await fetch(getApiBase() + '/roast-rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        resumeText: currentInput,
        roastResult: (currentResult && currentResult.result) || null
      })
    });
    const data = await res.json();
    if (res.ok && data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    btn.disabled = false;
    btn.textContent = label;
    alert(data.error || 'Could not start checkout. Please try again.');
  } catch (_) {
    btn.disabled = false;
    btn.textContent = label;
  }
}
```

- [ ] **Step 4: Add the styles**

At the end of `pixel-agents/css/pixel-agent-run.css`, append (first check the file's existing custom-property names with `grep "var(--" pixel-agents/css/pixel-agent-run.css | head -20` and swap in its accent/token names if they differ):

```css
/* ── $9 Deep Roast Rewrite upsell ── */
.pa-rewrite-upsell {
  border: 1px solid rgba(255, 122, 61, 0.45);
  background: linear-gradient(135deg, rgba(255, 122, 61, 0.10), rgba(255, 122, 61, 0.02));
}
.pa-rewrite-upsell-body {
  margin: 0.5rem 0 1rem;
  line-height: 1.5;
}
.pa-rewrite-upsell-btn {
  display: inline-block;
  padding: 0.65rem 1.4rem;
  border: none;
  border-radius: 8px;
  background: #ff7a3d;
  color: #fff;
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
}
.pa-rewrite-upsell-btn:hover { filter: brightness(1.08); }
.pa-rewrite-upsell-btn:disabled { opacity: 0.6; cursor: wait; }
.pa-rewrite-upsell-note {
  margin-top: 0.6rem;
  font-size: 0.85rem;
  opacity: 0.7;
}
```

- [ ] **Step 5: Run the PA smoke test (rule after touching pixel-agent-run surfaces)**

Run: `node api/pixel-agent-run/smoke-test.js`
Expected: all cases pass, exit 0.

- [ ] **Step 6: Commit**

```bash
git add pixel-agents/js/pixel-agent-run.js pixel-agents/css/pixel-agent-run.css
git commit -m "feat: $9 rewrite upsell card after resume-roast results (dark until enabled)"
```

---

### Task 10: Enable + live verification (CEO-gated — do NOT run unprompted)

No code. This is the go-live checklist; the deploy has already happened via auto-push with the switch off. **Everything below requires the CEO present** (real card, refund decision).

- [ ] **Step 1: Set config (read-modify-write — GET first, ALWAYS)**

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=systemConfig" -H "x-company-secret: pixelpusher" > /tmp/sysconfig.json
# Merge with Node (jq not installed), then POST the WHOLE merged object back:
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('/tmp/sysconfig.json', 'utf8'));
cfg.roastRewrite = { enabled: true, priceCents: 900 };
fs.writeFileSync('/tmp/sysconfig-new.json', JSON.stringify(cfg));
"
curl -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=systemConfig" -H "Content-Type: application/json" -H "x-company-secret: pixelpusher" -d @/tmp/sysconfig-new.json
```

- [ ] **Step 2: Config round-trip check**

Run: `curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/roast-rewrite?config=1"`
Expected: `{"enabled":true,"priceCents":900}` (retry once on 404 — Consumption worker roulette serves stale code briefly after deploy).

- [ ] **Step 3: Live end-to-end with a real browser checkout (CEO card)**

1. Run a free roast at `/pixel-agents/run.html?agent=resume-roast` with a real resume text (≥200 chars). Confirm the upsell card renders under the results.
2. Click the button → complete Stripe checkout with the CEO card ($9).
3. Confirm the delivery page shows "being prepared" then renders the rewrite within ~2 minutes.
4. Verify the rewrite invented nothing (spot-check employers/dates against the input).
5. Check email for "Your resume rewrite is ready".

- [ ] **Step 4: Verify the money + analytics trail**

```bash
# Ledger entry (product pixelagents, plan roast_rewrite):
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/revenueDigest" -H "x-company-secret: pixelpusher"
# Order status:
curl -s -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/roast-rewrite" -H "Content-Type: application/json" -H "x-company-secret: pixelpusher" -d '{"action":"status"}'
```
Also confirm `rewrite_upsell_view`, `rewrite_upsell_click`, `rewrite_purchase` appear in product analytics for product `pixelagents` (query endpoint or blob).

- [ ] **Step 5: Refund + prune the CEO test purchase**

Refund the $9 in the Stripe dashboard, then prune so it is NEVER narrated as revenue (07-31 lesson):

```bash
curl -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/revenueDigest" -H "Content-Type: application/json" -H "x-company-secret: pixelpusher" -d '{"action":"prune-test-entries"}'
```
Note: the refund webhook will log under product `ambientscore` (known limitation from Task 6) — expected, ignore.

- [ ] **Step 6: Update memory**

Update `project_roast_rewrite_upsell.md`: shipped commits, live-verify result, success-gate counter start date (50 roasts / 0 sales → revisit offer).

---

## Self-review notes (already applied)

- Spec §3 said "extend `asTeardownRunner` or mirror it" — plan chose a separate `roastRewriteRunner` (zero blast radius on the $199 pipeline; the teardown runner's early-return structure would have needed refactoring).
- Spec's `.md`/`.txt`/print delivery, token URL, kill switch, price config, integrity constraint, retention scrub, requeue, success gate: all covered (Tasks 2, 4, 7, 8, 10).
- Refund misattribution limitation documented in Task 6 rather than silently ignored.
- Every event uses product `pixelagents` (already in `productAnalyticsIngest` VALID_PRODUCTS — the ingest whitelists products, not event names, so no ingest change is needed; Task 10 Step 4 verifies arrival end-to-end).

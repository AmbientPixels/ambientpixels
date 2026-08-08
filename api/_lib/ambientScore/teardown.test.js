#!/usr/bin/env node
// teardown.test.js — unit tests for teardownComposer (pure functions, no network)
// Run: node api/_lib/ambientScore/teardown.test.js

const assert = require('assert');
const composer = require('./teardownComposer');

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
  console.log('\nteardown tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

function makeSession(overrides) {
  return Object.assign({
    id: 'cs_test_' + Math.random().toString(36).slice(2, 8),
    metadata: { teardown: '1', url: 'https://example.com', goal: 'more signups', email: 'form@example.com' },
    customer_details: { email: 'stripe@example.com' }
  }, overrides);
}

function goodTeardown() {
  return {
    summary: 'A'.repeat(60),
    killers: Array.from({ length: 5 }, (_, i) => ({ title: 'K' + i, why: 'why', before: 'before', after: 'after', impact: 'high' })),
    fixOrder: [1, 2, 3, 4].map(w => ({ week: w, items: ['do a thing'] })),
    confidence: 'high'
  };
}

// ── Tokens ──

enqueue('token is stable and order-specific', () => {
  const a1 = composer.buildTeardownToken('td_1');
  const a2 = composer.buildTeardownToken('td_1');
  const b = composer.buildTeardownToken('td_2');
  assert.strictEqual(a1, a2);
  assert.notStrictEqual(a1, b);
  assert.strictEqual(a1.length, 32);
});

// ── queueTeardownOrder ──

enqueue('queueTeardownOrder builds a paid order from session metadata', () => {
  const { queue: q, order } = composer.queueTeardownOrder(makeSession(), [], '2026-07-30T00:00:00.000Z');
  assert.ok(order);
  assert.strictEqual(order.status, 'paid');
  assert.strictEqual(order.url, 'https://example.com');
  assert.strictEqual(order.goal, 'more signups');
  assert.strictEqual(q.length, 1);
  assert.ok(order.orderId.startsWith('td_'));
});

enqueue('Stripe-collected email wins over metadata email', () => {
  const { order } = composer.queueTeardownOrder(makeSession(), [], '2026-07-30T00:00:00.000Z');
  assert.strictEqual(order.email, 'stripe@example.com');
});

enqueue('metadata email used when Stripe has none', () => {
  const s = makeSession({ customer_details: null });
  const { order } = composer.queueTeardownOrder(s, [], '2026-07-30T00:00:00.000Z');
  assert.strictEqual(order.email, 'form@example.com');
});

enqueue('dedups on sessionId (webhook retries)', () => {
  const s = makeSession();
  const first = composer.queueTeardownOrder(s, [], '2026-07-30T00:00:00.000Z');
  const second = composer.queueTeardownOrder(s, first.queue, '2026-07-30T00:01:00.000Z');
  assert.strictEqual(second.order, null);
  assert.strictEqual(second.queue.length, 1);
});

enqueue('ignores non-teardown sessions', () => {
  const s = makeSession({ metadata: { reportId: 'ccr_x' } });
  const { order } = composer.queueTeardownOrder(s, [], '2026-07-30T00:00:00.000Z');
  assert.strictEqual(order, null);
});

enqueue('caps the queue at ' + composer.QUEUE_CAP, () => {
  let q = Array.from({ length: composer.QUEUE_CAP }, (_, i) => ({ orderId: 'td_old_' + i, sessionId: 'cs_old_' + i, status: 'delivered' }));
  const { queue: q2, order } = composer.queueTeardownOrder(makeSession(), q, '2026-07-30T00:00:00.000Z');
  assert.ok(order);
  assert.strictEqual(q2.length, composer.QUEUE_CAP);
  assert.strictEqual(q2[q2.length - 1].orderId, order.orderId);
  assert.strictEqual(q2[0].orderId, 'td_old_1');
});

// ── advanceQueue ──

enqueue('stale processing resets to paid with retryCount', () => {
  const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
  const q = [{ orderId: 'td_a', status: 'processing', processingAt: '2026-07-30T09:00:00.000Z', retryCount: 0 }];
  const res = composer.advanceQueue(q, nowMs);
  assert.strictEqual(res.resets, 1);
  assert.strictEqual(q[0].status, 'paid');
  assert.strictEqual(q[0].retryCount, 1);
});

enqueue('fresh processing left alone', () => {
  const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
  const q = [{ orderId: 'td_a', status: 'processing', processingAt: '2026-07-30T11:30:00.000Z', retryCount: 0 }];
  const res = composer.advanceQueue(q, nowMs);
  assert.strictEqual(res.resets, 0);
  assert.strictEqual(q[0].status, 'processing');
});

enqueue('retry exhaustion goes to failed', () => {
  const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
  const q = [{ orderId: 'td_a', status: 'processing', processingAt: '2026-07-30T09:00:00.000Z', retryCount: composer.MAX_RETRIES }];
  const res = composer.advanceQueue(q, nowMs);
  assert.strictEqual(res.failed, 1);
  assert.strictEqual(q[0].status, 'failed');
});

// ── validateTeardown ──

enqueue('validateTeardown accepts a good document', () => {
  assert.strictEqual(composer.validateTeardown(goodTeardown()), null);
});

enqueue('validateTeardown rejects wrong killer count', () => {
  const t = goodTeardown();
  t.killers.pop();
  assert.ok(composer.validateTeardown(t));
});

enqueue('validateTeardown rejects missing rewrite fields', () => {
  const t = goodTeardown();
  delete t.killers[2].after;
  assert.ok(composer.validateTeardown(t));
});

enqueue('validateTeardown rejects short summary and bad fixOrder', () => {
  const t1 = goodTeardown();
  t1.summary = 'too short';
  assert.ok(composer.validateTeardown(t1));
  const t2 = goodTeardown();
  t2.fixOrder = t2.fixOrder.slice(0, 3);
  assert.ok(composer.validateTeardown(t2));
});

// ── composeTeardown ──

const fakeReport = {
  score: 61,
  grade: 'C',
  fullReport: {
    url: 'https://example.com',
    score: 61,
    grade: 'C',
    siteTypeLabel: 'SaaS',
    dimensions: { d1: { label: 'Messaging Clarity', score: 55 } },
    findings: [{ finding: 'weak headline', recommendation: 'sharpen it', estimatedImpact: 'high' }],
    synthesis: { executiveSummary: 'Needs work.' },
    extraction: { headlines: ['We synergize solutions'], ctas: ['Submit'] }
  }
};

enqueue('composeTeardown returns validated JSON on first try', async () => {
  const calls = [];
  const fakeClaude = async (prompt, opts) => {
    calls.push(opts);
    assert.ok(prompt.includes('example.com'));
    assert.ok(prompt.includes('We synergize solutions'));
    return JSON.stringify(goodTeardown());
  };
  const out = await composer.composeTeardown(fakeReport, 'more signups', fakeClaude);
  assert.strictEqual(out.killers.length, 5);
  assert.strictEqual(calls.length, 1);
});

enqueue('composeTeardown retries once on invalid output', async () => {
  let n = 0;
  const fakeClaude = async () => {
    n++;
    return n === 1 ? 'not json at all {broken' : JSON.stringify(goodTeardown());
  };
  const out = await composer.composeTeardown(fakeReport, '', fakeClaude);
  assert.strictEqual(n, 2);
  assert.ok(out.summary);
});

enqueue('composeTeardown throws after two bad attempts', async () => {
  const fakeClaude = async () => JSON.stringify({ summary: 'x', killers: [] });
  let threw = false;
  try {
    await composer.composeTeardown(fakeReport, '', fakeClaude);
  } catch (e) {
    threw = true;
    assert.ok(e.message.includes('composeTeardown failed'));
  }
  assert.ok(threw);
});

enqueue('composeTeardown strips markdown fences', async () => {
  const fakeClaude = async () => '```json\n' + JSON.stringify(goodTeardown()) + '\n```';
  const out = await composer.composeTeardown(fakeReport, '', fakeClaude);
  assert.strictEqual(out.killers.length, 5);
});

// ── callClaudeWithBackoff budget (2026-08-07) ────────────────────────
// This ladder is a multiplier on top of one call: three tries plus 10s of
// sleeps. A caller behind a hard limit (the $9 rewrite composes inside an HTTP
// request Azure kills at 230s) needs both halves bounded or the budget is
// fiction.

const transient = () => { throw new Error('Claude returned 529: overloaded'); };

enqueue('callClaudeWithBackoff without a deadline still climbs the whole ladder', async () => {
  let calls = 0;
  const fakeClaude = async () => { calls++; return transient(); };
  let threw = false;
  try { await composer.callClaudeWithBackoff(fakeClaude, 'p', { caller: 't' }); } catch (_) { threw = true; }
  assert.ok(threw);
  assert.strictEqual(calls, 3, 'unbudgeted behaviour must not change');
});

enqueue('a budget below the attempt floor makes no call at all', async () => {
  let calls = 0;
  const fakeClaude = async () => { calls++; return 'never reached'; };
  let caught = null;
  try {
    await composer.callClaudeWithBackoff(fakeClaude, 'p', { caller: 't', deadlineAt: Date.now() + 500 });
  } catch (e) { caught = e; }
  assert.strictEqual(calls, 0, 'a generation certain to be aborted still costs tokens');
  assert.ok(caught && caught.deadline === true, 'must be flagged as a deadline, not an upstream fault');
});

enqueue('the ladder stops rather than sleeping into its own deadline', async () => {
  let calls = 0;
  const fakeClaude = async () => { calls++; return transient(); };
  // Room for the immediate try, but the 2s backoff would leave under the 15s
  // floor, so the retry must be abandoned instead of slept into.
  let caught = null;
  try {
    await composer.callClaudeWithBackoff(fakeClaude, 'p', { caller: 't', deadlineAt: Date.now() + 16500 });
  } catch (e) { caught = e; }
  assert.strictEqual(calls, 1, 'made ' + calls + ' calls; the backoff retry had no room');
  assert.ok(caught, 'must still surface the failure');
});

enqueue('a deadline error is not treated as transient and is never retried', async () => {
  let calls = 0;
  const fakeClaude = async () => {
    calls++;
    // Deliberately worded to trip none of TRANSIENT_ERR_RX's patterns — the
    // word "timeout" alone would send the ladder to sleep on a budget that no
    // longer exists.
    throw new Error('Claude budget exhausted before completion');
  };
  let threw = false;
  try { await composer.callClaudeWithBackoff(fakeClaude, 'p', { caller: 't' }); } catch (_) { threw = true; }
  assert.ok(threw);
  assert.strictEqual(calls, 1, 'running out of our own clock is not an upstream fault to back off from');
});

console.log('\nteardownComposer tests\n');
run();

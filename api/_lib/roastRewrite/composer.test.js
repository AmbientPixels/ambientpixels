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

// ── Fail-closed / cap fixes (review follow-up) ──

enqueue('retentionPass fails closed on a malformed createdAt (removes it)', () => {
  const now = Date.parse(NOW);
  const corrupt = { orderId: 'rr_corrupt', status: 'created', createdAt: 'garbage' };
  const result = composer.retentionPass([corrupt], now);
  assert.deepStrictEqual(result.removeDocIds, ['rr_corrupt']);
  assert.strictEqual(result.queue.length, 0);
});

enqueue('retentionPass scrubs resume PII from old failed orders', () => {
  const now = Date.parse(NOW);
  const oldFailed = {
    orderId: 'rr_failed_old',
    status: 'failed',
    createdAt: new Date(now - composer.RESUME_RETENTION_MS - 1000).toISOString()
  };
  const result = composer.retentionPass([oldFailed], now);
  assert.deepStrictEqual(result.scrubDocIds, ['rr_failed_old']);
  assert.ok(result.queue.find(o => o.orderId === 'rr_failed_old').resumeScrubbed);
  // second pass is a no-op once scrubbed
  const again = composer.retentionPass(result.queue, now);
  assert.deepStrictEqual(again.scrubDocIds, []);
});

enqueue('advanceQueue treats non-finite processingAt as stale, not stuck forever', () => {
  const bad = { orderId: 'rr_bad_date', status: 'processing', processingAt: 'garbage', retryCount: 0 };
  const r = composer.advanceQueue([bad], Date.parse(NOW));
  assert.strictEqual(r.resets, 1);
  assert.strictEqual(bad.status, 'paid');

  const missing = { orderId: 'rr_missing_date', status: 'processing', retryCount: composer.MAX_RETRIES };
  const r2 = composer.advanceQueue([missing], Date.parse(NOW));
  assert.strictEqual(r2.failed, 1);
  assert.strictEqual(missing.status, 'failed');
});

enqueue('capQueue drops oldest entries beyond QUEUE_CAP and returns their doc ids', () => {
  const q = [];
  for (let i = 0; i < composer.QUEUE_CAP + 2; i++) q.push({ orderId: 'rr_' + i, status: 'created' });
  const result = composer.capQueue(q);
  assert.strictEqual(result.queue.length, composer.QUEUE_CAP);
  assert.deepStrictEqual(result.removeDocIds, ['rr_0', 'rr_1']);
  assert.strictEqual(result.queue[0].orderId, 'rr_2');
});

enqueue('capQueue is a no-op under the cap', () => {
  const q = [{ orderId: 'rr_only', status: 'created' }];
  const result = composer.capQueue(q);
  assert.strictEqual(result.queue.length, 1);
  assert.deepStrictEqual(result.removeDocIds, []);
});

run();

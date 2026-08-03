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
  const { order, reason } = composer.markPaid([entry], session, NOW);
  assert.ok(order);
  assert.strictEqual(order.status, 'paid');
  assert.strictEqual(order.paidAt, NOW);
  assert.strictEqual(order.email, 'buyer@example.com');
  assert.strictEqual(order.sessionId, session.id);
  assert.strictEqual(reason, null);
});

enqueue('markPaid dedups on sessionId (webhook retry)', () => {
  const { entry } = composer.createOrder('r', null, NOW);
  const session = makeSession({ metadata: { rewrite: '1', orderId: entry.orderId } });
  const first = composer.markPaid([entry], session, NOW);
  const second = composer.markPaid(first.queue, session, NOW);
  assert.ok(first.order);
  assert.strictEqual(second.order, null);
  assert.strictEqual(second.reason, 'dedup');
});

enqueue('markPaid ignores unknown orderId and non-rewrite sessions', () => {
  const { entry } = composer.createOrder('r', null, NOW);
  const missing = composer.markPaid([entry], makeSession({ metadata: { rewrite: '1', orderId: 'rr_nope' } }), NOW);
  assert.strictEqual(missing.order, null);
  assert.strictEqual(missing.reason, 'missing');
  const notRewrite = composer.markPaid([entry], makeSession({ metadata: { teardown: '1' } }), NOW);
  assert.strictEqual(notRewrite.order, null);
  assert.strictEqual(notRewrite.reason, 'not-rewrite');
  assert.strictEqual(entry.status, 'created');
});

enqueue('markPaid reports bad-status when the order exists but is not created', () => {
  const { entry } = composer.createOrder('r', null, NOW);
  entry.status = 'paid';
  const session = makeSession({ metadata: { rewrite: '1', orderId: entry.orderId } });
  const { order, reason } = composer.markPaid([entry], session, NOW);
  assert.strictEqual(order, null);
  assert.strictEqual(reason, 'bad-status');
});

// ── advanceQueue ──

enqueue('advanceQueue resets stale processing to paid, fails after retries, and reports affected ids', () => {
  const stale = { orderId: 'rr_s', status: 'processing', processingAt: NOW, retryCount: 0 };
  const later = Date.parse(NOW) + composer.STALE_PROCESSING_MS + 1000;
  const r1 = composer.advanceQueue([stale], later);
  assert.strictEqual(r1.resets, 1);
  assert.deepStrictEqual(r1.resetIds, ['rr_s']);
  assert.deepStrictEqual(r1.failedIds, []);
  assert.strictEqual(stale.status, 'paid');
  stale.status = 'processing';
  stale.retryCount = composer.MAX_RETRIES;
  const r2 = composer.advanceQueue([stale], later);
  assert.strictEqual(r2.failed, 1);
  assert.deepStrictEqual(r2.failedIds, ['rr_s']);
  assert.deepStrictEqual(r2.resetIds, []);
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

enqueue('retentionPass fully purges a scrubbed delivered entry once the 60d link lifetime passes', () => {
  const now = Date.parse(NOW);
  const oldLink = {
    orderId: 'rr_link_dead',
    status: 'delivered',
    createdAt: NOW,
    deliveredAt: new Date(now - (2 * composer.RESUME_RETENTION_MS) - 1000).toISOString(),
    resumeScrubbed: true
  };
  const result = composer.retentionPass([oldLink], now);
  assert.deepStrictEqual(result.removeDocIds, ['rr_link_dead']);
  assert.deepStrictEqual(result.scrubDocIds, []);
  assert.strictEqual(result.queue.length, 0);
});

enqueue('retentionPass keeps a scrubbed delivered entry inside the 60d link lifetime', () => {
  const now = Date.parse(NOW);
  const recentLink = {
    orderId: 'rr_link_alive',
    status: 'delivered',
    createdAt: NOW,
    deliveredAt: new Date(now - (45 * 24 * 60 * 60 * 1000)).toISOString(),
    resumeScrubbed: true
  };
  const result = composer.retentionPass([recentLink], now);
  assert.deepStrictEqual(result.removeDocIds, []);
  assert.strictEqual(result.queue.length, 1);
  assert.strictEqual(result.queue[0].orderId, 'rr_link_alive');
});

enqueue('retentionPass fully purges a scrubbed failed entry once the 60d window passes', () => {
  const now = Date.parse(NOW);
  const oldFailedLink = {
    orderId: 'rr_failed_dead',
    status: 'failed',
    createdAt: new Date(now - (2 * composer.RESUME_RETENTION_MS) - 1000).toISOString(),
    resumeScrubbed: true
  };
  const result = composer.retentionPass([oldFailedLink], now);
  assert.deepStrictEqual(result.removeDocIds, ['rr_failed_dead']);
  assert.strictEqual(result.queue.length, 0);
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
  assert.deepStrictEqual(r.resetIds, ['rr_bad_date']);
  assert.strictEqual(bad.status, 'paid');

  const missing = { orderId: 'rr_missing_date', status: 'processing', retryCount: composer.MAX_RETRIES };
  const r2 = composer.advanceQueue([missing], Date.parse(NOW));
  assert.strictEqual(r2.failed, 1);
  assert.deepStrictEqual(r2.failedIds, ['rr_missing_date']);
  assert.strictEqual(missing.status, 'failed');
});

// ── retentionPass allowedIds (docs-first two-step retention) ──

enqueue('retentionPass with allowedIds only removes/flags allowed candidates; others are left untouched', () => {
  const now = Date.parse(NOW);
  const staleUnpaidAllowed = { orderId: 'rr_allowed_remove', status: 'created', createdAt: new Date(now - composer.UNPAID_TTL_MS - 1000).toISOString() };
  const staleUnpaidBlocked = { orderId: 'rr_blocked_remove', status: 'created', createdAt: new Date(now - composer.UNPAID_TTL_MS - 1000).toISOString() };
  const oldDeliveredAllowed = { orderId: 'rr_allowed_scrub', status: 'delivered', createdAt: NOW, deliveredAt: new Date(now - composer.RESUME_RETENTION_MS - 1000).toISOString() };
  const oldDeliveredBlocked = { orderId: 'rr_blocked_scrub', status: 'delivered', createdAt: NOW, deliveredAt: new Date(now - composer.RESUME_RETENTION_MS - 1000).toISOString() };

  const result = composer.retentionPass(
    [staleUnpaidAllowed, staleUnpaidBlocked, oldDeliveredAllowed, oldDeliveredBlocked],
    now,
    ['rr_allowed_remove', 'rr_allowed_scrub']
  );

  assert.deepStrictEqual(result.removeDocIds, ['rr_allowed_remove']);
  assert.deepStrictEqual(result.scrubDocIds, ['rr_allowed_scrub']);
  // Blocked candidates survive, unflagged.
  assert.strictEqual(result.queue.length, 3); // blocked-remove, blocked-scrub, allowed-scrub (kept, just flagged)
  const blockedRemove = result.queue.find(o => o.orderId === 'rr_blocked_remove');
  assert.ok(blockedRemove, 'blocked created-expired entry must survive when not allowed');
  const blockedScrub = result.queue.find(o => o.orderId === 'rr_blocked_scrub');
  assert.ok(blockedScrub, 'blocked delivered entry must survive when not allowed');
  assert.ok(!blockedScrub.resumeScrubbed, 'blocked delivered entry must not be flagged when not allowed');
  const allowedScrub = result.queue.find(o => o.orderId === 'rr_allowed_scrub');
  assert.ok(allowedScrub.resumeScrubbed, 'allowed delivered entry should be flagged');
});

enqueue('retentionPass omitted allowedIds behaves exactly like the unrestricted call (regression guard)', () => {
  const now = Date.parse(NOW);
  const staleUnpaid = { orderId: 'rr_no_restriction', status: 'created', createdAt: new Date(now - composer.UNPAID_TTL_MS - 1000).toISOString() };
  const result = composer.retentionPass([staleUnpaid], now);
  assert.deepStrictEqual(result.removeDocIds, ['rr_no_restriction']);
  assert.strictEqual(result.queue.length, 0);
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

enqueue('capQueue drops oldest created entries first and never drops paid/processing entries', () => {
  const q = [];
  q.push({ orderId: 'rr_paid_old', status: 'paid' });
  q.push({ orderId: 'rr_processing_old', status: 'processing' });
  for (let i = 0; i < composer.QUEUE_CAP; i++) q.push({ orderId: 'rr_created_' + i, status: 'created' });
  // length is QUEUE_CAP + 2 -> overflow of 2, both droppable via 'created'
  const result = composer.capQueue(q);
  assert.strictEqual(result.queue.length, composer.QUEUE_CAP);
  assert.deepStrictEqual(result.removeDocIds, ['rr_created_0', 'rr_created_1']);
  assert.ok(result.queue.find(o => o.orderId === 'rr_paid_old'), 'paid entry must survive');
  assert.ok(result.queue.find(o => o.orderId === 'rr_processing_old'), 'processing entry must survive');
});

enqueue('capQueue returns over-cap unchanged when no created entries are droppable (safety beats cap)', () => {
  const q = [];
  for (let i = 0; i < composer.QUEUE_CAP + 3; i++) q.push({ orderId: 'rr_paid_' + i, status: 'paid' });
  const result = composer.capQueue(q);
  assert.strictEqual(result.queue.length, composer.QUEUE_CAP + 3);
  assert.deepStrictEqual(result.removeDocIds, []);
});

run();

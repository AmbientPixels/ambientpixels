// Run with: node api/actionsScheduler/stuck-execution.test.js
//
// THE BUG THIS EXISTS TO PREVENT (observed live, 2026-08-08):
// Three Bluesky replies were posted TWICE to the same threads, eleven hours
// apart. Reconstructed from act_1786164429244_bsreply_kxj3u:
//
//   04:50:00  scheduler dispatches the reply. It POSTS SUCCESSFULLY.
//             The write-back that records success never lands, so the action
//             sits at execution.status = 'running'.
//   15:42:01  stuck-running escape hatch fires after 652 minutes. To decide
//             whether it really posted, it reads a.execution.receipt --
//             which is written by the same write-back that just failed.
//             Absent by construction. It concludes 'failed'.
//   15:50:00  'failed' is eligible, so it dispatches again. Duplicate reply
//             to a stranger, on the brand account.
//
// The recovery path read exactly the state its own failure mode destroys, so it
// could never recover a real success -- it would always re-post.
//
// The rule this encodes: for an operation that is publicly visible and NOT
// idempotent, "we don't know if it worked" must never resolve to "do it again".
// A missed reply costs nothing. A duplicate one is permanent and reads as spam.

const assert = require('assert');
const { resolveStuckExecution, STUCK_THRESHOLD_MS } = require('./stuck-execution');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const NOW = Date.parse('2026-08-08T15:42:00Z');
const ago = ms => new Date(NOW - ms).toISOString();
const MIN = 60000;

const running = over => ({
  id: 'act_1', type: 'social_post.reply',
  execution: { status: 'running', started_at: ago(over) }
});

t('an action running under the threshold is left alone', function () {
  const r = resolveStuckExecution(running(5 * MIN), NOW);
  assert.strictEqual(r.verdict, 'still_running');
});

t('a stuck action WITH a receipt is promoted to success', function () {
  const a = running(652 * MIN);
  a.execution.receipt = { post_id: '3mslgdhwu4y23', post_url: 'https://bsky.app/x' };
  const r = resolveStuckExecution(a, NOW);
  assert.strictEqual(r.verdict, 'success');
});

t('THE BUG: a stuck PUBLIC POST with no receipt must NOT become retryable', function () {
  // This is the exact shape of act_1786164429244_bsreply_kxj3u at 15:42.
  const r = resolveStuckExecution(running(652 * MIN), NOW);
  assert.strictEqual(r.verdict, 'needs_review', 'resolved to "' + r.verdict + '" — anything retryable re-posts publicly');
  assert.strictEqual(r.requiresManualReview, true);
  assert.ok(/unknown|verify|not retr/i.test(r.error.message), 'the error must say why it stopped: ' + r.error.message);
});

t('the unknown-outcome verdict is reached for every public post type', function () {
  ['social_post.reply', 'social_post.publish', 'social_post.schedule'].forEach(function (type) {
    const a = running(652 * MIN); a.type = type;
    assert.strictEqual(resolveStuckExecution(a, NOW).verdict, 'needs_review', type + ' was left retryable');
  });
});

t('a non-public action is still allowed to fail and retry', function () {
  // Retry is correct where the operation is not publicly visible; the duplicate
  // cost that justifies stopping does not exist there.
  const a = running(652 * MIN); a.type = 'task_completion';
  const r = resolveStuckExecution(a, NOW);
  assert.strictEqual(r.verdict, 'failed');
  assert.ok(!r.requiresManualReview);
});

t('an action already marked for review is never resolved again', function () {
  const a = running(652 * MIN);
  a.execution.requires_manual_review = true;
  assert.strictEqual(resolveStuckExecution(a, NOW).verdict, 'needs_review');
});

t('actions that are not running are not this function\'s business', function () {
  ['success', 'failed', 'pending', undefined].forEach(function (s) {
    const a = running(652 * MIN); a.execution.status = s;
    assert.strictEqual(resolveStuckExecution(a, NOW).verdict, 'not_applicable', 'status ' + s);
  });
  assert.strictEqual(resolveStuckExecution({ id: 'x' }, NOW).verdict, 'not_applicable');
});

t('a missing or unparseable started_at does not silently retry a public post', function () {
  // An unreadable timestamp must not read as "not stuck, carry on" and then
  // fall through to a fresh dispatch.
  [null, undefined, 'not-a-date'].forEach(function (v) {
    const a = running(652 * MIN); a.execution.started_at = v;
    const r = resolveStuckExecution(a, NOW);
    assert.notStrictEqual(r.verdict, 'success', 'started_at=' + v);
    assert.ok(r.verdict === 'needs_review' || r.verdict === 'still_running',
      'started_at=' + v + ' resolved to ' + r.verdict);
  });
});

t('a receipt without any usable id is not proof of posting', function () {
  const a = running(652 * MIN);
  a.execution.receipt = { platform: 'bluesky' }; // no post_id / post_url / public_url
  assert.strictEqual(resolveStuckExecution(a, NOW).verdict, 'needs_review');
});

t('the threshold is exported and sane', function () {
  assert.ok(STUCK_THRESHOLD_MS > 0 && STUCK_THRESHOLD_MS <= 60 * MIN);
});

t('malformed input never throws', function () {
  [null, undefined, {}, { execution: null }, { execution: {} }, 42].forEach(function (junk) {
    assert.doesNotThrow(function () { resolveStuckExecution(junk, NOW); }, JSON.stringify(junk));
  });
});

console.log('\nstuck execution tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

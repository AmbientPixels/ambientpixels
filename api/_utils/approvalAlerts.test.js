// Run with: node api/_utils/approvalAlerts.test.js
// Approval latency is the slowest human stage in every pipeline: a post can
// clear Scribe, Quill and the quality gate in one cycle and then sit unseen
// for a day. These pings route the approve loop to the CEO's phone. The
// decision logic is edge-triggered like fleet health: alert on NEW items,
// never every 5 minutes.
const assert = require('assert');
const { collectPending, decideApprovalAlert, COOLDOWN_MS } = require('./approvalAlerts');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const NOW = 1700000000000;

t('collectPending finds pending actions and skips decided ones', function () {
  const actions = [
    { id: 'a1', type: 'social_post.schedule', platform: 'bluesky', approval: { status: 'pending' }, payload: { text: 'Hello world' } },
    { id: 'a2', type: 'social_post.publish', platform: 'x', approval: { status: 'approved' } },
    { id: 'a3', type: 'social_post.publish', platform: 'x', approval: { status: 'rejected' } }
  ];
  const got = collectPending(actions, []);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].id, 'a1');
  assert.ok(got[0].label.includes('bluesky'), 'label should carry the platform: ' + got[0].label);
});

t('an approvalQueue mirror of the same action is not counted twice', function () {
  const actions = [{ id: 'a1', type: 'social_post.schedule', platform: 'bluesky', approval: { status: 'pending' }, payload: { text: 'x' } }];
  const aq = [
    { id: 'aq-a1', action_id: 'a1', status: 'pending', title: 'mirror of a1' },
    { id: 'aq-doc9', action_id: 'doc9', status: 'pending', kind: 'blog.publish', title: 'Publish: AI agent article' },
    { id: 'aq-old', action_id: 'old1', status: 'approved', title: 'decided' }
  ];
  const got = collectPending(actions, aq);
  assert.strictEqual(got.length, 2, JSON.stringify(got.map(g => g.id)));
  assert.ok(got.some(g => g.id === 'doc9'), 'doc approvals must be included');
});

t('first pending item triggers an alert', function () {
  const d = decideApprovalAlert(['a1'], null, NOW);
  assert.strictEqual(d.action, 'alert');
  assert.deepStrictEqual(d.state.alertedIds, ['a1']);
  assert.strictEqual(d.state.lastAlertAt, new Date(NOW).toISOString());
});

t('already-alerted items stay silent', function () {
  const prev = { alertedIds: ['a1'], lastAlertAt: new Date(NOW - COOLDOWN_MS * 4).toISOString() };
  const d = decideApprovalAlert(['a1'], prev, NOW);
  assert.strictEqual(d.action, 'none');
});

t('a new item after the cooldown alerts again', function () {
  const prev = { alertedIds: ['a1'], lastAlertAt: new Date(NOW - COOLDOWN_MS - 1000).toISOString() };
  const d = decideApprovalAlert(['a1', 'a2'], prev, NOW);
  assert.strictEqual(d.action, 'alert');
  assert.deepStrictEqual(d.newIds, ['a2']);
  assert.deepStrictEqual(d.state.alertedIds, ['a1', 'a2']);
});

t('the cooldown defers but does not swallow — un-alerted ids stay eligible', function () {
  const prev = { alertedIds: ['a1'], lastAlertAt: new Date(NOW - 60 * 1000).toISOString() };
  const d = decideApprovalAlert(['a1', 'a2'], prev, NOW);
  assert.strictEqual(d.action, 'none');
  // a2 must NOT be marked alerted, or it would never ping after the cooldown.
  assert.deepStrictEqual(d.state.alertedIds, ['a1'], 'deferred ids must not be marked as alerted');
});

t('a drained queue resets state so the next pending item alerts fresh', function () {
  const prev = { alertedIds: ['a1', 'a2'], lastAlertAt: new Date(NOW - 1000).toISOString() };
  const d = decideApprovalAlert([], prev, NOW);
  assert.strictEqual(d.action, 'none');
  assert.deepStrictEqual(d.state.alertedIds, []);
});

t('decided-elsewhere ids are pruned from alerted state', function () {
  // a1 was approved in the dashboard; a3 is new. alertedIds must not grow forever.
  const prev = { alertedIds: ['a1'], lastAlertAt: new Date(NOW - COOLDOWN_MS - 1000).toISOString() };
  const d = decideApprovalAlert(['a3'], prev, NOW);
  assert.strictEqual(d.action, 'alert');
  assert.deepStrictEqual(d.state.alertedIds, ['a3']);
});

console.log('\napproval alert tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

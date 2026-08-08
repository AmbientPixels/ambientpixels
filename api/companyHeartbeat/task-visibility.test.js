// Run with: node api/companyHeartbeat/task-visibility.test.js
//
// THE LOOP THIS ENDS (measured live, 2026-08-08):
// 51 policy violations in 24h. 30 of them were ONE task —
// task-1785722401043-tjg0, "Draft LinkedIn post for The B2B Operator's LinkedIn
// Playbook" — sitting in 'review' on camp-msckchvl-u5ck, a campaign paused on
// 08-05. It was blocked 31 times.
//
// The cause is an asymmetry, not a bad gate. index.js filters the campaign list
// to active only, so agents never SEE a paused campaign. But the task board has
// no such filter, so they see its TASKS — and prompt-builders looks the campaign
// up in activeDirectives, fails, and silently skips the whole context block with
// no else. The agent gets an ordinary-looking task in 'review' with no hint that
// every mutation will be rejected. It tries. It is blocked. Next cycle, again.
//
// Filtering paused campaigns out of the prompt is what makes the orphan look
// healthy: the "paused" signal was removed along with the campaign.

const assert = require('assert');
const V = require('./task-visibility');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const ACTIVE = [{ id: 'camp-live' }, { id: 'camp-seo-search-intent' }];
const task = o => Object.assign({ id: 't1', title: 'x', status: 'review' }, o);

t('a task with no campaign is always actionable', function () {
  const r = V.filterActionableTasks([task({})], ACTIVE);
  assert.strictEqual(r.visible.length, 1);
  assert.strictEqual(r.hidden.length, 0);
});

t('a task on an ACTIVE campaign stays visible', function () {
  const r = V.filterActionableTasks([task({ campaign_id: 'camp-live' })], ACTIVE);
  assert.strictEqual(r.visible.length, 1);
});

t('THE BUG: a task on a paused campaign is hidden', function () {
  const r = V.filterActionableTasks([task({ id: 'task-1785722401043-tjg0', campaign_id: 'camp-msckchvl-u5ck' })], ACTIVE);
  assert.strictEqual(r.visible.length, 0, 'still offered to the agent — it will be blocked again');
  assert.strictEqual(r.hidden.length, 1);
  assert.strictEqual(r.hidden[0].campaign_id, 'camp-msckchvl-u5ck');
});

t('a task on a campaign that no longer exists is hidden too', function () {
  // Deleted campaigns leave the same orphan shape as paused ones.
  const r = V.filterActionableTasks([task({ campaign_id: 'camp-deleted-long-ago' })], ACTIVE);
  assert.strictEqual(r.visible.length, 0);
});

t('FAIL OPEN: an empty campaign list hides NOTHING', function () {
  // If the campaigns fetch fails or every campaign is genuinely paused, an
  // Set-based filter would blank the entire board and every agent would go
  // silent — far worse than the loop this fixes. Absence of data must never
  // read as "everything is forbidden".
  const tasks = [task({ campaign_id: 'camp-live' }), task({ id: 't2', campaign_id: 'camp-paused' })];
  [[], null, undefined, 'nonsense', {}].forEach(function (bad) {
    const r = V.filterActionableTasks(tasks, bad);
    assert.strictEqual(r.visible.length, 2, 'hid tasks with campaigns=' + JSON.stringify(bad));
    assert.strictEqual(r.hidden.length, 0);
  });
});

t('campaign entries without an id do not poison the active set', function () {
  const r = V.filterActionableTasks([task({ campaign_id: 'camp-live' })], [{ id: 'camp-live' }, {}, null, { id: null }]);
  assert.strictEqual(r.visible.length, 1);
});

t('malformed tasks never throw and are never silently dropped', function () {
  const r = V.filterActionableTasks([null, undefined, {}, task({})], ACTIVE);
  assert.doesNotThrow(function () { V.filterActionableTasks([null], ACTIVE); });
  // A null entry is not a campaign task; it must not be counted as "hidden by us".
  assert.strictEqual(r.hidden.length, 0);
});

t('a non-array task list returns an empty result rather than throwing', function () {
  [null, undefined, 'x', 42, {}].forEach(function (bad) {
    const r = V.filterActionableTasks(bad, ACTIVE);
    assert.deepStrictEqual(r.visible, []);
    assert.deepStrictEqual(r.hidden, []);
  });
});

t('the hidden list is reported so the drop is never silent', function () {
  // A filter that hides work without saying so is indistinguishable from an
  // empty queue — which is exactly how the dead discovery sensor hid for five
  // weeks. The caller logs summarise().
  const r = V.filterActionableTasks([
    task({ id: 'a', campaign_id: 'camp-paused-1' }),
    task({ id: 'b', campaign_id: 'camp-paused-1' }),
    task({ id: 'c', campaign_id: 'camp-paused-2' })
  ], ACTIVE);
  const s = V.summarise(r.hidden);
  assert.ok(s.includes('camp-paused-1'), 'summary must name the campaigns: ' + s);
  assert.ok(/3/.test(s), 'summary must count the tasks: ' + s);
});

t('summarise handles an empty list without producing noise', function () {
  assert.strictEqual(V.summarise([]), '');
  assert.strictEqual(V.summarise(null), '');
});

console.log('\ntask visibility tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

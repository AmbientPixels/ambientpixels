// Run with: node api/companyHeartbeat/_utils/campaignAvailability.test.js
//
// This module MIRRORS the campaign gates in agent-runner.js. If it drifts, agents are told
// a shut campaign is open and waste the action anyway — the exact problem it was written to
// remove. These tests pin the mirror.

const assert = require('assert');
const ca = require('./campaignAvailability');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const NOW = Date.parse('2026-08-09T12:00:00Z');
const day = 86400000;

console.log('\ncampaignAvailability');

t('an active campaign with no constraints is open', () => {
  assert.strictEqual(ca.closureReason({ id: 'c', status: 'active' }, [], NOW), null);
});

t('paused is closed, and says mutations are frozen too', () => {
  const r = ca.closureReason({ id: 'c', status: 'paused' }, [], NOW);
  assert.strictEqual(r.reason, 'paused');
  assert.ok(/ALL task mutations/.test(r.detail), 'paused must warn it blocks more than creation');
});

t('complete and canceled are closed', () => {
  assert.strictEqual(ca.closureReason({ id: 'c', status: 'complete' }, [], NOW).reason, 'complete');
  assert.strictEqual(ca.closureReason({ id: 'c', status: 'cancelled' }, [], NOW).reason, 'canceled');
});

t('date windows close the campaign on both sides', () => {
  assert.strictEqual(ca.closureReason({ id: 'c', status: 'active', startDate: '2026-08-20' }, [], NOW).reason, 'not_started');
  assert.strictEqual(ca.closureReason({ id: 'c', status: 'active', endDate: '2026-08-01' }, [], NOW).reason, 'ended');
});

t('maxTasks cap closes it, and auto-created children do not count', () => {
  const c = { id: 'c', status: 'active', maxTasks: 2 };
  const real = [{ campaign_id: 'c', createdAt: '2026-07-01' }, { campaign_id: 'c', createdAt: '2026-07-02' }];
  assert.strictEqual(ca.closureReason(c, real, NOW).reason, 'max_tasks');

  // The gate excludes auto-created workflow artifacts; so must this, or every campaign
  // looks capped as soon as copy tasks spawn.
  const withAuto = [{ campaign_id: 'c', createdAt: '2026-07-01' },
    { campaign_id: 'c', createdAt: '2026-07-02', tags: ['auto-created'] }];
  assert.strictEqual(ca.closureReason(c, withAuto, NOW), null, 'auto-created tasks must not count toward the cap');
});

t('archived tasks do not count toward the cap', () => {
  const c = { id: 'c', status: 'active', maxTasks: 1 };
  assert.strictEqual(ca.closureReason(c, [{ campaign_id: 'c', createdAt: '2026-07-01', status: 'archived' }], NOW), null);
});

t('cadence closes the window after a recent task and reopens after it', () => {
  const c = { id: 'c', status: 'active', cadence: 'daily' };
  const recent = [{ campaign_id: 'c', createdAt: new Date(NOW - 2 * 3600000).toISOString() }];
  const r = ca.closureReason(c, recent, NOW);
  assert.strictEqual(r.reason, 'cadence');
  assert.ok(/allowed in ~/.test(r.detail), 'must say when it frees up, not just that it is shut');

  const old = [{ campaign_id: 'c', createdAt: new Date(NOW - 2 * day).toISOString() }];
  assert.strictEqual(ca.closureReason(c, old, NOW), null, 'outside the window it must reopen');
});

t('frequency subdivides the cadence window, matching the gate', () => {
  // weekly with frequency 7 => ~1 day window, so a 2-day-old task no longer blocks.
  const c = { id: 'c', status: 'active', cadence: 'weekly', frequency: 7 };
  const twoDays = [{ campaign_id: 'c', createdAt: new Date(NOW - 2 * day).toISOString() }];
  assert.strictEqual(ca.closureReason(c, twoDays, NOW), null);
});

t('effectiveMaxTasks derivation matches the gate formula', () => {
  // frequency 2, weekly, 14-day run, 1 platform => 2 * 2 periods * 1 = 4
  const c = { id: 'c', status: 'active', frequency: 2, cadence: 'weekly',
    startDate: '2026-08-01T00:00:00Z', endDate: '2026-08-15T00:00:00Z', allowedTaskTypes: ['blog_post'] };
  assert.strictEqual(ca.effectiveMaxTasks(c, NOW), 4);
});

t('block names what is OPEN, because that is the short list', () => {
  const camps = [
    { id: 'open1', title: 'Open One', status: 'active' },
    { id: 'p1', title: 'Paused One', status: 'paused' },
    { id: 'x1', title: 'Dead', status: 'canceled' }
  ];
  const b = ca.buildCampaignAvailabilityBlock(camps, [], NOW);
  assert.ok(/ACCEPTING new tasks \(1\)/.test(b));
  assert.ok(b.indexOf('open1') !== -1, 'the open campaign must be named');
  assert.ok(/PAUSED/.test(b) && b.indexOf('p1') !== -1, 'paused must be named individually');
  assert.ok(/1 canceled/.test(b), 'other closures collapse to a count');
  assert.strictEqual(b.indexOf('x1'), -1, 'canceled campaigns must NOT be listed by id — that is the noise we removed');
});

t('says so plainly when nothing is open', () => {
  const b = ca.buildCampaignAvailabilityBlock([{ id: 'p', title: 'P', status: 'paused' }], [], NOW);
  assert.ok(/ACCEPTING new tasks: NONE/.test(b));
  assert.ok(/do not retry into a closed campaign/.test(b));
});

t('archived campaigns are ignored entirely', () => {
  assert.strictEqual(ca.buildCampaignAvailabilityBlock([{ id: 'a', status: 'archived' }], [], NOW), '');
});

t('empty input yields no block rather than an empty heading', () => {
  assert.strictEqual(ca.buildCampaignAvailabilityBlock([], [], NOW), '');
  assert.strictEqual(ca.buildCampaignAvailabilityBlock(null, null, NOW), '');
});

t('the block stays small enough to sit in every prompt', () => {
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ id: 'c' + i, title: 'Campaign number ' + i, status: 'paused' });
  const b = ca.buildCampaignAvailabilityBlock(many, [], NOW);
  assert.ok(b.length < 1500, 'block grew to ' + b.length + ' chars — it must stay capped');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

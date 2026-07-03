// Run with: node api/proposalEdit/validate.test.js
const assert = require('assert');
const { validatePatch } = require('./validate');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// ── allowlist ──
test('drops unknown keys (no error)', () => {
  const { clean, error } = validatePatch('campaign_proposal', { name: 'X', bogus: 1, id: 'hax', status: 'approved' });
  assert.strictEqual(error, null);
  assert.strictEqual(clean.name, 'X');
  assert.ok(!('bogus' in clean) && !('id' in clean) && !('status' in clean));
});

// ── required field ──
test('empty name is a hard error (campaign)', () => {
  const { error } = validatePatch('campaign_proposal', { name: '   ' });
  assert.ok(/name is required/i.test(error || ''));
});
test('empty title is a hard error (objective)', () => {
  const { error } = validatePatch('objective_proposal', { title: '' });
  assert.ok(/title is required/i.test(error || ''));
});
test('omitting name entirely is NOT an error (partial patch)', () => {
  const { clean, error } = validatePatch('campaign_proposal', { description: 'hi' });
  assert.strictEqual(error, null);
  assert.strictEqual(clean.description, 'hi');
  assert.ok(!('name' in clean));
});

// ── string clamps ──
test('name clamps to 100 chars', () => {
  const { clean } = validatePatch('campaign_proposal', { name: 'a'.repeat(200) });
  assert.strictEqual(clean.name.length, 100);
});
test('successCriteria clamps to 300', () => {
  const { clean } = validatePatch('objective_proposal', { successCriteria: 'b'.repeat(500) });
  assert.strictEqual(clean.successCriteria.length, 300);
});

// ── platforms ──
test('platforms filtered to valid social task types', () => {
  const { clean } = validatePatch('campaign_proposal', { platforms: ['social_x', 'social_facebook', 'garbage', 'social_bluesky'] });
  assert.deepStrictEqual(clean.platforms, ['social_x', 'social_bluesky']);
});
test('platforms that filter to empty are omitted (not blanked)', () => {
  const { clean } = validatePatch('campaign_proposal', { platforms: ['garbage'] });
  assert.ok(!('platforms' in clean));
});

// ── frequency / cadence ──
test('frequency clamps to [1,14] and coerces int', () => {
  assert.strictEqual(validatePatch('campaign_proposal', { frequency: 0 }).clean.frequency, 1);
  assert.strictEqual(validatePatch('campaign_proposal', { frequency: 99 }).clean.frequency, 14);
  assert.strictEqual(validatePatch('campaign_proposal', { frequency: '3' }).clean.frequency, 3);
});
test('bad frequency is omitted', () => {
  assert.ok(!('frequency' in validatePatch('campaign_proposal', { frequency: 'abc' }).clean));
});
test('cadence must be in the enum else omitted', () => {
  assert.strictEqual(validatePatch('campaign_proposal', { cadence: 'weekly' }).clean.cadence, 'weekly');
  assert.ok(!('cadence' in validatePatch('campaign_proposal', { cadence: 'hourly' }).clean));
});

// ── metric ──
test('metricTarget coerces number, rejects negatives/NaN', () => {
  assert.strictEqual(validatePatch('objective_proposal', { metricTarget: '101' }).clean.metricTarget, 101);
  assert.strictEqual(validatePatch('objective_proposal', { metricTarget: null }).clean.metricTarget, null);
  assert.ok(!('metricTarget' in validatePatch('objective_proposal', { metricTarget: -5 }).clean));
  assert.ok(!('metricTarget' in validatePatch('objective_proposal', { metricTarget: 'x' }).clean));
});
test('metricDeadline must be YYYY-MM-DD or null else omitted', () => {
  assert.strictEqual(validatePatch('objective_proposal', { metricDeadline: '2026-08-31' }).clean.metricDeadline, '2026-08-31');
  assert.strictEqual(validatePatch('objective_proposal', { metricDeadline: null }).clean.metricDeadline, null);
  assert.ok(!('metricDeadline' in validatePatch('objective_proposal', { metricDeadline: 'Aug 31' }).clean));
});
test('northStarMetric empty string becomes null', () => {
  assert.strictEqual(validatePatch('objective_proposal', { northStarMetric: '' }).clean.northStarMetric, null);
});

// ── unknown type ──
test('unknown proposal type returns error', () => {
  const { error } = validatePatch('budget_request', { name: 'x' });
  assert.ok(/not an editable proposal type/i.test(error || ''));
});

// ── malformed patch guard ──
test('null patch is treated as empty (no crash, no error)', () => {
  const { clean, error } = validatePatch('campaign_proposal', null);
  assert.strictEqual(error, null);
  assert.deepStrictEqual(clean, {});
});
test('non-object patch is treated as empty (no crash)', () => {
  assert.deepStrictEqual(validatePatch('objective_proposal', 'oops').clean, {});
  assert.deepStrictEqual(validatePatch('campaign_proposal', 42).clean, {});
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);

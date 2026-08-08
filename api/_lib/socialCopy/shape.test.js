// Run with: node api/_lib/socialCopy/shape.test.js
// Shape selection decides which posts carry a link. Getting the rotation wrong
// either re-creates the all-ads feed we are escaping, or starves the one
// conversion post the campaign objective is measured on.
const assert = require('assert');
const { pickPostShape, shapeKindsFromTasks, engagementBriefLines, DEFAULT_PROFILE, VARIANT_GUIDANCE } = require('./shape');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

t('a campaign with no history opens with engagement, not an ad', function () {
  const s = pickPostShape({ recentKinds: [], seed: 'task-1' });
  assert.strictEqual(s.kind, 'engagement');
  assert.ok(s.variant, 'engagement shape must carry a variant');
});

t('two engagement posts in a row make the third a link post — the 2:1 ratio', function () {
  const s = pickPostShape({ recentKinds: ['engagement', 'engagement'], seed: 'task-2' });
  assert.strictEqual(s.kind, 'link');
});

t('after a link post the cycle restarts with engagement', function () {
  const s = pickPostShape({ recentKinds: ['engagement', 'engagement', 'link'], seed: 'task-3' });
  assert.strictEqual(s.kind, 'engagement');
});

t('a link shape carries no variant', function () {
  const s = pickPostShape({ recentKinds: ['engagement', 'engagement'], seed: 'task-4' });
  assert.strictEqual(s.variant, undefined);
});

t('linkEvery is honored, including the every-post escape hatch', function () {
  assert.strictEqual(pickPostShape({ profile: { linkEvery: 1 }, recentKinds: [], seed: 'a' }).kind, 'link');
  assert.strictEqual(pickPostShape({ profile: { linkEvery: 2 }, recentKinds: ['engagement'], seed: 'b' }).kind, 'link');
  assert.strictEqual(pickPostShape({ profile: { linkEvery: 2 }, recentKinds: ['link'], seed: 'c' }).kind, 'engagement');
});

t('linkEvery of 0 means never link — and a falsy zero must not fall back to the default', function () {
  // (opts.x || DEFAULT) discarding a legitimate 0 bit us twice on 2026-08-08.
  const s = pickPostShape({ profile: { linkEvery: 0 }, recentKinds: ['engagement', 'engagement', 'engagement'], seed: 'd' });
  assert.strictEqual(s.kind, 'engagement');
});

t('the variant comes from the campaign profile and is deterministic per seed', function () {
  const profile = { engagementVariants: ['question'] };
  const a = pickPostShape({ profile, recentKinds: [], seed: 'task-x' });
  assert.strictEqual(a.variant, 'question');
  const b1 = pickPostShape({ recentKinds: [], seed: 'same-seed' });
  const b2 = pickPostShape({ recentKinds: [], seed: 'same-seed' });
  assert.strictEqual(b1.variant, b2.variant, 'same seed must give the same variant');
  assert.ok(DEFAULT_PROFILE.engagementVariants.includes(b1.variant));
});

t('shapeKindsFromTasks filters by campaign + platform and sorts by createdAt', function () {
  const tasks = [
    { id: 'c', campaign_id: 'camp-1', taskType: 'social_x', post_shape: { kind: 'link' }, createdAt: '2026-08-03' },
    { id: 'a', campaign_id: 'camp-1', taskType: 'social_x', post_shape: { kind: 'engagement' }, createdAt: '2026-08-01' },
    { id: 'other-campaign', campaign_id: 'camp-2', taskType: 'social_x', post_shape: { kind: 'link' }, createdAt: '2026-08-02' },
    { id: 'other-platform', campaign_id: 'camp-1', taskType: 'social_bluesky', post_shape: { kind: 'link' }, createdAt: '2026-08-02' },
    { id: 'unshaped', campaign_id: 'camp-1', taskType: 'social_x', createdAt: '2026-08-02' },
    { id: 'superseded', campaign_id: 'camp-1', taskType: 'social_x', _revision_superseded: true, post_shape: { kind: 'link' }, createdAt: '2026-08-02' }
  ];
  assert.deepStrictEqual(shapeKindsFromTasks(tasks, 'camp-1', 'social_x'), ['engagement', 'link']);
});

t('engagement brief lines forbid links AND override campaign URL rules', function () {
  const lines = engagementBriefLines('question');
  assert.ok(/do not include any url/i.test(lines), 'must forbid URLs');
  assert.ok(/overrides any campaign rule/i.test(lines), 'campaign descriptions still say "MUST include that URL" until the data task runs — the brief must out-rank them');
  assert.ok(lines.includes(VARIANT_GUIDANCE.question), 'variant guidance must be included');
  assert.ok(/never invent/i.test(lines), 'the truth rule is the fabrication guard');
});

t('an unknown variant still produces a safe brief instead of undefined', function () {
  const lines = engagementBriefLines('no_such_variant');
  assert.ok(!/undefined/.test(lines));
  assert.ok(/do not include any url/i.test(lines));
});

console.log('\nshape tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

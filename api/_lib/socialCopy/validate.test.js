// Run with: node api/_lib/socialCopy/validate.test.js
// Free checks that catch the cheap model's most likely mistakes before the
// (fail-open) quality gate is asked to.
const assert = require('assert');
const { validateCopy } = require('./validate');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const URL = 'https://www.ambientpixels.ai/resume-roast/';
const OK = 'Your resume says "responsible for". So did every intern. Get it roasted free. ' + URL;

t('good copy passes', function () {
  const r = validateCopy(OK, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
});

t('a missing URL fails — the post would send nobody anywhere', function () {
  const r = validateCopy('Get your resume roasted free.', { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /url/i.test(p)));
});

t('over-length fails, with the actual numbers named', function () {
  const r = validateCopy('x'.repeat(400) + ' ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /300/.test(p) && /4\d\d/.test(p)), 'problem must name limit and actual: ' + JSON.stringify(r.problems));
});

t('em dashes fail — they are the clearest tell that a model wrote it', function () {
  const r = validateCopy('Your resume — it is bad. ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /em dash/i.test(p)));
});

t('banned buzzwords fail and the offender is named', function () {
  const r = validateCopy('Supercharge your resume today. ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /supercharge/i.test(p)));
});

t('preamble fails — it would be published verbatim', function () {
  const r = validateCopy('Here is the post: get roasted. ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /preamble/i.test(p)));
});

t('a refusal is caught rather than published as the post', function () {
  const r = validateCopy('I cannot write this post because the brief is unclear.', { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /refusal/i.test(p)));
});

t('empty or whitespace output fails', function () {
  for (const bad of ['', '   ', null, undefined]) {
    assert.strictEqual(validateCopy(bad, { platform: 'social_bluesky', url: URL }).ok, false);
  }
});

t('the URL appearing twice fails — it reads as spam', function () {
  const r = validateCopy('Roast it ' + URL + ' seriously ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /once/i.test(p)));
});

t('too many hashtags fails — tag spam is a ranking penalty, not a boost', function () {
  const r = validateCopy('Roast it #jobsearch #resume #hiring #careers ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /hashtag/i.test(p)), JSON.stringify(r.problems));
});

t('the per-platform budget is enforced, not one shared number', function () {
  const one = 'Roast it #jobsearch ' + URL;
  const two = 'Roast it #jobsearch #resume ' + URL;
  assert.strictEqual(validateCopy(one, { platform: 'social_x', url: URL }).ok, true, 'one tag is fine on X');
  assert.strictEqual(validateCopy(two, { platform: 'social_x', url: URL }).ok, false, 'two is not');
  assert.strictEqual(validateCopy(two, { platform: 'social_bluesky', url: URL }).ok, true, 'but two is fine on bluesky');
});

t('a URL fragment is not counted as a hashtag', function () {
  // Same trap as the facet detector: every post carries a URL, and some carry
  // fragments. Counting "#how-it-works" as a tag would fail good copy.
  const u = 'https://www.ambientpixels.ai/resume-roast/#how-it-works';
  const r = validateCopy('Get it roasted free. ' + u, { platform: 'social_bluesky', url: u });
  assert.ok(!r.problems.some(p => /hashtag/i.test(p)), JSON.stringify(r.problems));
});

console.log('\nvalidate tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

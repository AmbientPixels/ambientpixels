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
  // X copy carries no body link here because its linkPolicy is 'reply'.
  const one = 'Roast it #jobsearch';
  const two = 'Roast it #jobsearch #resume';
  assert.strictEqual(validateCopy(one, { platform: 'social_x', url: URL }).ok, true, JSON.stringify(validateCopy(one, { platform: 'social_x', url: URL }).problems));
  assert.strictEqual(validateCopy(two, { platform: 'social_x', url: URL }).ok, false, 'two tags on X is spam');
  assert.strictEqual(validateCopy(two + ' ' + URL, { platform: 'social_bluesky', url: URL }).ok, true, 'but two is fine on bluesky');
});

t('a body link is rejected where the platform demotes it', function () {
  // X and LinkedIn suppress posts carrying outbound links; the link belongs in
  // a follow-up there. Passing url still means "this post is FOR this url" —
  // the body just must not contain it.
  const rX = validateCopy('Roast it free. ' + URL, { platform: 'social_x', url: URL });
  assert.strictEqual(rX.ok, false);
  assert.ok(rX.problems.some(p => /reply/i.test(p)), JSON.stringify(rX.problems));
  const rLi = validateCopy('Roast it free. The full story is linked below. ' + URL, { platform: 'social_linkedin', url: URL });
  assert.strictEqual(rLi.ok, false);
  assert.ok(rLi.problems.some(p => /comment/i.test(p)), JSON.stringify(rLi.problems));
});

t('link-free copy passes on reply/comment platforms even when a url is expected', function () {
  // The old rule ("missing the required url") firing here would make shape 4
  // (clean post, link in first reply) impossible to express on X at all.
  const r = validateCopy('Roast it free. #jobsearch', { platform: 'social_x', url: URL });
  assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
});

t('no url expected at all still validates — shape 1 is expressible', function () {
  // A no-link value post simply passes no url. Nothing should demand one.
  const r = validateCopy('Most resumes say "responsible for". So does every intern\'s.', { platform: 'social_bluesky' });
  assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
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

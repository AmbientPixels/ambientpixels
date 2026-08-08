// Run with: node api/_utils/productUrl.test.js
//
// THE BUG (live, 2026-08-08 19:38 and 19:42, AFTER the www fix shipped):
// Echo creates social_post.schedule actions with NO task and NO campaign, so the
// campaign-URL path fixed earlier never runs. Echo writes the bare domain itself
// and the post ships pointing at the company homepage:
//
//   "...When you're job hunting, 'looks great' doesn't pay the bills.
//    #jobsearch #resume #careers https://ambientpixels.ai"
//
// A post about resumes sending clicks to the front page, against an objective
// measured in Resume Roast runs.
//
// Name matching alone cannot fix it — neither post names a product. They are
// TOPICAL, so the resolver has to read what the copy is about.

const assert = require('assert');
const P = require('./productUrl');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const HOME = 'https://ambientpixels.ai';
const ROAST = 'https://www.ambientpixels.ai/resume-roast/';
const SCORE = 'https://www.ambientpixels.ai/ambientscore/';

// ── the two real posts ──

t('REAL: the resume post resolves to Resume Roast', function () {
  const text = 'I asked a friend to review my resume once. They said "it looks great". Which was nice, but not very helpful. When you\'re job hunting, "looks great" doesn\'t pay the bills. #jobsearch #resume #careers ' + HOME;
  assert.strictEqual(P.repairBareHomepageUrl(text).includes(ROAST), true, P.repairBareHomepageUrl(text).slice(-90));
});

t('REAL: the landing-page critique resolves to AmbientScore', function () {
  const text = "Cool site. One small thing I saw. Your main button says 'Learn More'. Our free tool often suggests something more specific like 'Get Your Free Plan' to lift clicks. " + HOME;
  assert.ok(P.repairBareHomepageUrl(text).includes(SCORE));
});

// ── resolution ──

t('an explicit product name wins over topic hints', function () {
  assert.strictEqual(P.resolveProductUrl('New in CardForge this week: better borders.'), 'https://www.ambientpixels.ai/cardforge/');
});

t('topic words resolve when no product is named', function () {
  assert.strictEqual(P.resolveProductUrl('my cv keeps getting filtered by the ats'), ROAST);
  assert.strictEqual(P.resolveProductUrl('your homepage cta is burying the signup'), SCORE);
});

t('unrelated copy resolves to nothing rather than guessing', function () {
  assert.strictEqual(P.resolveProductUrl('we shipped a small refactor today'), null);
  assert.strictEqual(P.resolveProductUrl(''), null);
  assert.strictEqual(P.resolveProductUrl(null), null);
});

// ── repair, and what it must NOT touch ──

t('a URL that ALREADY has a product path is left alone', function () {
  const text = 'roast it free ' + ROAST;
  assert.strictEqual(P.repairBareHomepageUrl(text), text, 'rewrote a correct link');
});

t('a blog link is left alone', function () {
  const text = 'read it https://ambientpixels.ai/blog/how-to-find-conversion-killers about your resume';
  assert.strictEqual(P.repairBareHomepageUrl(text), text);
});

t('an existing query string is carried across, so UTM survives', function () {
  const out = P.repairBareHomepageUrl('my resume is stuck ' + HOME + '?utm_source=x&utm_content=act_1');
  assert.ok(out.includes(ROAST + '?utm_source=x&utm_content=act_1'), out.slice(-100));
});

t('the www form of the bare homepage is repaired too', function () {
  assert.ok(P.repairBareHomepageUrl('my resume is stuck https://www.ambientpixels.ai').includes(ROAST));
});

t('third-party links are never touched', function () {
  const text = 'my resume vs https://example.com/ambientpixels.ai/fake and ' + HOME;
  const out = P.repairBareHomepageUrl(text);
  assert.ok(out.includes('https://example.com/ambientpixels.ai/fake'), 'third-party link damaged');
});

t('copy with no resolvable product keeps the homepage rather than guessing', function () {
  const text = 'we shipped something today ' + HOME;
  assert.strictEqual(P.repairBareHomepageUrl(text), text);
});

t('trailing punctuation after the bare domain is preserved', function () {
  const out = P.repairBareHomepageUrl('fix your resume at ' + HOME + '.');
  assert.ok(out.endsWith('.'), out);
  assert.ok(out.includes(ROAST));
});

t('malformed input never throws', function () {
  [null, undefined, 42, {}, []].forEach(function (v) {
    assert.doesNotThrow(function () { P.repairBareHomepageUrl(v); }, JSON.stringify(v));
  });
});

t('every product in product-facts has a usable url', function () {
  const facts = require('../_data/product-facts.json').products || {};
  Object.keys(facts).forEach(function (k) {
    assert.ok(/^https:\/\/www\.ambientpixels\.ai\//.test(facts[k].url || ''), k + ' has no usable url');
  });
});

console.log('\nproduct url tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

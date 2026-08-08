// Run with: node api/companyHeartbeat/bluesky-keywords.test.js
//
// Discovery and relevance are two halves of one funnel and they must agree.
//
// They did not, and it cost the whole lane (measured 2026-08-08). Every
// discovery keyword was a builder topic — "AI agents", "indie hacker", "solo
// founder", "vibe coding", "build in public", "AI orchestration", "agent
// framework" — while the live revenue objective was obj-resume-roast-demand,
// whose audience is job seekers. So the sensor filled a 200-slot store with
// threads the relevance filter was then guaranteed to reject: one new candidate
// survived per run, and the top of the queue was memes, politics and an NSFW art
// post that matched the bare word "build".
//
// A search term that no DOMAIN_TERM can match is a term whose results can never
// be drafted. This test makes that drift fail loudly instead of quietly draining
// the funnel.

const assert = require('assert');
const KW = require('../_data/bluesky-discovery-keywords.json');
const { DOMAIN_TERMS, relevanceVerdict } = require('./bluesky-relevance');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

t('the keyword list is present and non-trivial', function () {
  assert.ok(Array.isArray(KW.keywords) && KW.keywords.length >= 5, 'too few keywords to fill a 2h window');
});

t('keywords are unique — a duplicate burns a search slot for nothing', function () {
  const lower = KW.keywords.map(function (k) { return String(k).toLowerCase().trim(); });
  assert.strictEqual(new Set(lower).size, lower.length, 'duplicate keyword: ' + lower.join(', '));
});

t('EVERY keyword overlaps a relevance DOMAIN_TERM', function () {
  // The drift guard. A keyword whose results cannot pass relevanceVerdict is a
  // keyword that fills the store with rejects.
  const domains = DOMAIN_TERMS.map(function (d) { return d.toLowerCase(); });
  const orphans = KW.keywords.filter(function (k) {
    const kw = String(k).toLowerCase();
    return !domains.some(function (d) { return d.includes(kw) || kw.includes(d); });
  });
  assert.strictEqual(orphans.length, 0,
    'keywords with no matching domain term (their results can never be drafted): ' + orphans.join(', '));
});

t('the set actually targets the live revenue objective', function () {
  // obj-resume-roast-demand: 50 runs by 2026-08-22. If the fleet is hunting
  // builders while the objective is job seekers, the funnel is pointed away from
  // the number being measured.
  const all = KW.keywords.join(' ').toLowerCase();
  ['resume', 'job'].forEach(function (must) {
    assert.ok(all.includes(must), 'no keyword targets "' + must + '" — the Resume Roast audience');
  });
});

t('builder coverage survives for camp-agent-build-log', function () {
  const all = KW.keywords.join(' ').toLowerCase();
  assert.ok(/agent|build in public/.test(all), 'builder topics dropped entirely');
});

t('a realistic job-seeker thread passes relevance end to end', function () {
  // The shape discovery should now be surfacing.
  const v = relevanceVerdict('I have been job hunting for three months and my resume still gets no replies. Starting to think the applicant tracking system is filtering me out.');
  assert.strictEqual(v.ok, true, 'refused as ' + v.reason);
});

t('filters stay sane', function () {
  const f = KW.filters || {};
  assert.ok(f.maxAgeMinutes >= 60, 'window too tight to fill between 2h runs');
  assert.ok(f.minReplies >= 0);
});

console.log('\nkeyword/domain agreement tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

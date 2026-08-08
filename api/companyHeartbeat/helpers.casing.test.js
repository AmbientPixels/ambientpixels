// Run with: node api/companyHeartbeat/helpers.casing.test.js
//
// capitalizeSentences is the last pass before copy goes public — it runs on
// scheduled social posts (agent-runner ~3113), replies (reply-normalize), blog
// titles and published docs. It had no tests.
//
// The gap that prompted these: a live Bluesky post read "writing for an ai and a
// human at the same time... to get an ats score". Founder voice writes lowercase
// and step 2 only fixes SENTENCE STARTS, so mid-sentence acronyms shipped
// lowercase on the brand account.
//
// The freeze/restore pass is what makes this safe: URLs, bare domains, hashtags
// and @mentions are swapped for placeholders before any casing runs, so
// ambientpixels.ai and #ai cannot be mangled into ambientpixels.AI or #AI.

const assert = require('assert');
const { capitalizeSentences } = require('./helpers');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

// ── the live failure ──

t('REAL: mid-sentence "ai" and "ats" are capitalised', function () {
  const out = capitalizeSentences('it is a real fear, writing for an ai and a human at the same time. paste it in to get an ats score.');
  assert.ok(/an AI and/.test(out), 'ai not fixed: ' + out);
  assert.ok(/an ATS score/.test(out), 'ats not fixed: ' + out);
});

t('sentence starts are still capitalised', function () {
  assert.strictEqual(capitalizeSentences('hello there. second one here.'), 'Hello there. Second one here.');
});

t('a sentence STARTING with an acronym gets the full acronym, not just "Ai"', function () {
  assert.ok(/^AI agents/.test(capitalizeSentences('ai agents are hard to make reliable.')));
});

t('the standalone pronoun i still becomes I', function () {
  assert.ok(/\bI built\b/.test(capitalizeSentences('i built a thing.')));
});

// ── the freeze pass must protect links and tags ──

t('a domain is NOT mangled — ambientpixels.ai must not become ambientpixels.AI', function () {
  const out = capitalizeSentences('get it roasted at ambientpixels.ai today.');
  assert.ok(out.includes('ambientpixels.ai'), 'domain damaged: ' + out);
  assert.ok(!/ambientpixels\.AI/.test(out), 'domain uppercased: ' + out);
});

t('a full URL survives untouched', function () {
  const url = 'https://www.ambientpixels.ai/resume-roast/?utm_source=bluesky';
  const out = capitalizeSentences('roast it free. ' + url);
  assert.ok(out.includes(url), 'url damaged: ' + out);
});

t('a hashtag keeps its case — #ai must not become #AI', function () {
  const out = capitalizeSentences('shipping today #ai #buildinpublic');
  assert.ok(out.includes('#ai'), 'hashtag uppercased: ' + out);
  assert.ok(out.includes('#buildinpublic'));
});

t('an @mention keeps its case', function () {
  assert.ok(capitalizeSentences('thanks @nova.bsky.social for the tip').includes('@nova.bsky.social'));
});

// ── no false positives ──

t('ordinary words that CONTAIN an acronym are untouched', function () {
  // "said" contains "ai", "cats" contains "ats", "curl" contains "url".
  const out = capitalizeSentences('she said the cats knocked over my curl command and the rain fell.');
  ['said', 'cats', 'curl', 'rain'].forEach(function (w) {
    assert.ok(out.includes(w), w + ' was mangled: ' + out);
  });
});

t('SaaS keeps its conventional mixed case', function () {
  assert.ok(/\bSaaS\b/.test(capitalizeSentences('we build saas tools.')), capitalizeSentences('we build saas tools.'));
});

t('possessives survive', function () {
  assert.ok(/AI's/.test(capitalizeSentences("the ai's output was wrong.")));
});

t('already-correct acronyms are left alone', function () {
  const s = 'The ATS rejected it. AI did not help.';
  assert.strictEqual(capitalizeSentences(s), s);
});

// ── robustness ──

t('non-string and empty input is returned unchanged', function () {
  [null, undefined, '', 42, {}].forEach(function (v) {
    assert.doesNotThrow(function () { capitalizeSentences(v); }, JSON.stringify(v));
  });
  assert.strictEqual(capitalizeSentences(''), '');
});

t('multi-line copy keeps its line structure', function () {
  const out = capitalizeSentences('first line about ai.\n\nsecond line about ats.');
  assert.strictEqual(out.split('\n').length, 3);
  assert.ok(/First line about AI/.test(out));
  assert.ok(/Second line about ATS/.test(out));
});

console.log('\ncasing tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

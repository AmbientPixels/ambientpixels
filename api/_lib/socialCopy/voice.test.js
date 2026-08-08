// Run with: node api/_lib/socialCopy/voice.test.js
// The voice spec is the only thing standing between a cheap model and copy that
// does not sound like us. These assert the load-bearing rules survive edits.
const assert = require('assert');
const { VOICE_RULES, PLATFORM_RULES, BANNED_WORDS, platformRule } = require('./voice');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

t('the voice rules carry the non-negotiables', function () {
  const s = VOICE_RULES.toLowerCase();
  for (const must of ['founder voice', 'sentence case', 'em dash', '5th grade', 'one idea per line']) {
    assert.ok(s.includes(must), 'voice spec lost: ' + must);
  }
});

t('banned words include the ones that make copy read as AI marketing', function () {
  for (const w of ['supercharge', 'unleash', 'revolutionary', 'thrilled']) {
    assert.ok(BANNED_WORDS.includes(w), 'missing banned word: ' + w);
  }
});

t('every supported platform has a length cap and guidance', function () {
  for (const p of ['social_bluesky', 'social_x', 'social_linkedin']) {
    const r = platformRule(p);
    assert.ok(r, 'no rule for ' + p);
    assert.ok(Number.isFinite(r.maxLen) && r.maxLen > 0, p + ' has no usable maxLen');
    assert.ok(r.guidance && r.guidance.length > 10, p + ' has no guidance');
  }
});

t('an unknown platform returns null rather than a wrong default', function () {
  // Silently defaulting to 280 chars would truncate a LinkedIn post to a stub.
  assert.strictEqual(platformRule('social_tiktok'), null);
  assert.strictEqual(platformRule(''), null);
  assert.strictEqual(platformRule(undefined), null);
});

t('the whole spec stays small — it is the point of the worker', function () {
  const chars = VOICE_RULES.length + Object.values(PLATFORM_RULES).map(r => r.guidance).join('').length;
  assert.ok(chars < 4000, 'voice + platform guidance is ' + chars + ' chars; the budget is ~1k tokens total');
});

console.log('\nvoice tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

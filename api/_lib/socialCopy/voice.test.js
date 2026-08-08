// Run with: node api/_lib/socialCopy/voice.test.js
// The voice spec is the only thing standing between a cheap model and copy that
// does not sound like us. These assert the load-bearing rules survive edits.
const assert = require('assert');
const { VOICE_RULES, PLATFORM_RULES, BANNED_WORDS, APPROVED_TAGS, platformRule } = require('./voice');

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

t('every platform declares a hashtag budget, and the budgets differ', function () {
  // Bluesky discovery runs on tags; on X more than one reads as spam. A single
  // shared number would be wrong on at least one platform.
  assert.strictEqual(platformRule('social_bluesky').maxTags, 3);
  assert.strictEqual(platformRule('social_linkedin').maxTags, 3);
  assert.strictEqual(platformRule('social_x').maxTags, 1, 'more than one hashtag on X reads as spam');
});

t('approved tags are bare words, since the writer supplies the #', function () {
  assert.ok(Array.isArray(APPROVED_TAGS) && APPROVED_TAGS.length >= 4);
  APPROVED_TAGS.forEach(function (tag) {
    assert.ok(!/[#\s]/.test(tag), 'approved tag must be a bare word: ' + JSON.stringify(tag));
  });
});

t('the voice rules name the approved tags inline', function () {
  // Scribe writes all social copy today and only ever sees VOICE_RULES, so a
  // hashtag rule that lives anywhere else does not reach the writer that matters.
  const s = VOICE_RULES.toLowerCase();
  assert.ok(s.includes('hashtag'), 'the hashtag rule must live in VOICE_RULES');
  assert.ok(s.includes('buildinpublic'), 'the list must be named inline, not referenced');
  assert.ok(s.includes('never invent'), 'a tag with no community behind it reaches nobody');
});

console.log('\nvoice tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

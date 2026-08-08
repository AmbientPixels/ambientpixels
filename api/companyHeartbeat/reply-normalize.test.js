// Run with: node api/companyHeartbeat/reply-normalize.test.js
//
// This is the last thing standing between a model's scaffolding and a public
// Bluesky post. It lived as an anonymous closure inside agent-runner's Scribe
// branch, redefined on every loop iteration, used once, and covered by nothing.
//
// It moves out here so the participation lane's inline drafts get identical
// treatment. Two writers producing reply text through two different normalisers
// is how one of them starts shipping "**Reply:**" to strangers.

const assert = require('assert');
const N = require('./reply-normalize');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

// ── the scaffolding Scribe actually emits ──

t('a clean reply passes through untouched', function () {
  const r = N.normalizeReplyDraft('That reliability wall is real. Retries mask it rather than fix it.');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'That reliability wall is real. Retries mask it rather than fix it.');
});

t('a "Bluesky Reply Draft" header is stripped', function () {
  const r = N.normalizeReplyDraft('**Bluesky Reply Draft**\n\nThat reliability wall is real and retries only mask it.');
  assert.strictEqual(r.text, 'That reliability wall is real and retries only mask it.');
});

t('To:/Platform:/Thread: label lines are stripped', function () {
  const r = N.normalizeReplyDraft('**To:** @someone.bsky.social\nPlatform: bluesky\nThread: at://x/1\n\nRetries mask the problem, they do not fix it.');
  assert.strictEqual(r.text, 'Retries mask the problem, they do not fix it.');
});

t('a leading "Reply:" label is dropped', function () {
  assert.strictEqual(N.normalizeReplyDraft('**Reply:** Retries mask the problem rather than fixing it.').text,
    'Retries mask the problem rather than fixing it.');
});

t('a fully quote-wrapped reply is unwrapped', function () {
  assert.strictEqual(N.normalizeReplyDraft('"Retries mask the problem rather than fixing it."').text,
    'Retries mask the problem rather than fixing it.');
});

t('stacked scaffolding is stripped in one pass', function () {
  const raw = 'Bluesky Reply Draft\n\n**To:** @someone\nThread: at://x/1\n\n**Reply:** "Retries mask the problem rather than fixing it."';
  assert.strictEqual(N.normalizeReplyDraft(raw).text, 'Retries mask the problem rather than fixing it.');
});

// ── meta preamble ──

t('"Here is the reply:" is stripped — it would otherwise ship verbatim', function () {
  assert.strictEqual(N.normalizeReplyDraft("Here's the reply: Retries mask the problem rather than fixing it.").text,
    'Retries mask the problem rather than fixing it.');
  assert.strictEqual(N.normalizeReplyDraft('Sure, here is my draft: Retries mask the problem rather than fixing it.').text,
    'Retries mask the problem rather than fixing it.');
});

t('"Here\'s the thing:" is NOT stripped — that is real reply text', function () {
  // The preamble rule keys on reply/draft/response/post as the noun. A generic
  // "Here's X:" strip would eat the first clause of a perfectly good reply.
  const r = N.normalizeReplyDraft("Here's the thing: retries mask the problem rather than fixing it.");
  assert.ok(r.text.startsWith("Here's the thing:"), 'over-stripped: ' + r.text);
});

// ── the decline contract ──

t('an empty deliverable is a decline, not a post', function () {
  ['', '   ', '\n\n', null, undefined].forEach(function (raw) {
    const r = N.normalizeReplyDraft(raw);
    assert.strictEqual(r.ok, false, JSON.stringify(raw));
    assert.strictEqual(r.reason, 'declined');
  });
});

t('scaffolding with no reply behind it is a decline', function () {
  const r = N.normalizeReplyDraft('**Bluesky Reply Draft**\n\n**To:** @someone\n');
  assert.strictEqual(r.ok, false, 'stripped to nothing but was treated as postable');
});

t('a WRITTEN refusal is NOT a decline — it would be posted', function () {
  // The trap that bit the participation brief: agent-runner declines only on a
  // deliverable under MIN_REPLY_CHARS. "NOTHING TO ADD" is 14 characters, so it
  // sails through and becomes the public reply. Briefs must ask for an EMPTY
  // deliverable, and this test exists so nobody "fixes" that by adding a
  // sentinel string here instead.
  const r = N.normalizeReplyDraft('NOTHING TO ADD');
  assert.strictEqual(r.ok, true, 'if this ever returns false, update the briefs to match');
  assert.ok(N.MIN_REPLY_CHARS < 'NOTHING TO ADD'.length);
});

t('the decline threshold is exported so briefs can be written against it', function () {
  assert.strictEqual(typeof N.MIN_REPLY_CHARS, 'number');
  assert.ok(N.MIN_REPLY_CHARS > 0);
});

// ── casing and length ──

t('founder-voice lowercase is sentence-cased', function () {
  const r = N.normalizeReplyDraft('retries mask the problem. they do not fix it.');
  assert.ok(/^R/.test(r.text), 'not capitalised: ' + r.text);
});

t('output is capped below the Bluesky limit, leaving headroom', function () {
  const r = N.normalizeReplyDraft('a'.repeat(600));
  assert.strictEqual(r.text.length, N.MAX_REPLY_CHARS);
  assert.ok(N.MAX_REPLY_CHARS < 300, 'bluesky caps at 300; we leave room');
});

t('a custom cap is honoured for platforms with a different limit', function () {
  assert.strictEqual(N.normalizeReplyDraft('b'.repeat(600), { maxChars: 100 }).text.length, 100);
});

// ── robustness ──

t('non-string input never throws', function () {
  [123, {}, [], true, Symbol ? undefined : null].forEach(function (junk) {
    assert.doesNotThrow(function () { N.normalizeReplyDraft(junk); });
  });
});

t('stripReplyScaffolding is exported for direct assertion', function () {
  assert.strictEqual(typeof N.stripReplyScaffolding, 'function');
  assert.strictEqual(N.stripReplyScaffolding('  hello  '), 'hello');
});

console.log('\nreply normalize tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

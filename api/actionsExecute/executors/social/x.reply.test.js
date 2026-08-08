// Run with: node api/actionsExecute/executors/social/x.reply.test.js
//
// X could only ever post top-level tweets. That blocks two separate things:
// moving the CTA link out of the post body (X demotes posts carrying outbound
// links) and replying to anyone at all, which is the only lever a 52-follower
// account has on that platform.
//
// buildTweetBody is pure on purpose. The live path builds OAuth params, signs
// them and POSTs inside a single closure, so the only way to assert threading
// without stubbing OAuth or touching the network is to extract the body.

const assert = require('assert');
const { buildTweetBody } = require('./x');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const ID = '2081727561449853150';

t('a plain post carries no reply field', function () {
  const b = buildTweetBody('hello', [], null);
  assert.strictEqual(b.text, 'hello');
  assert.ok(!('reply' in b), 'a top-level tweet must not send a reply object');
});

t('media ids still attach — this must not regress publishing', function () {
  const b = buildTweetBody('hi', ['123', '456'], null);
  assert.deepStrictEqual(b.media, { media_ids: ['123', '456'] });
});

t('an empty media list does not send an empty media object', function () {
  // X rejects media: { media_ids: [] } outright.
  assert.ok(!('media' in buildTweetBody('hi', [], null)));
  assert.ok(!('media' in buildTweetBody('hi', null, null)));
});

t('the X-native field threads the reply', function () {
  const b = buildTweetBody('re', [], { in_reply_to_tweet_id: ID });
  assert.deepStrictEqual(b.reply, { in_reply_to_tweet_id: ID });
});

t('a bluesky-shaped payload.reply.parent also threads', function () {
  // bluesky.js already reads action.payload.reply.parent. Accepting the same
  // field means one caller shape works for both platforms.
  assert.deepStrictEqual(buildTweetBody('re', [], { parent: ID }).reply, { in_reply_to_tweet_id: ID });
  assert.deepStrictEqual(buildTweetBody('re', [], { parent: { id: ID } }).reply, { in_reply_to_tweet_id: ID });
});

t('an at:// URI is REFUSED rather than posted as a top-level tweet', function () {
  // The failure this prevents: a bluesky reply payload reaches the X executor,
  // X ignores the unusable reference, and what was meant as a reply to someone
  // ships as a context-free top-level tweet on the brand account.
  const b = buildTweetBody('re', [], { parent: 'at://did:plc:abc/app.bsky.feed.post/xyz' });
  assert.ok(!('reply' in b), 'a non-numeric parent must not produce a reply field');
});

t('junk parents are refused', function () {
  for (const junk of ['', '   ', 'abc', 'https://x.com/i/status/123', {}, [], true, 0]) {
    const b = buildTweetBody('re', [], { parent: junk });
    assert.ok(!('reply' in b), 'accepted junk parent: ' + JSON.stringify(junk));
  }
});

t('a missing or empty reply object is not threading', function () {
  for (const r of [null, undefined, {}, { parent: null }, { in_reply_to_tweet_id: '' }]) {
    assert.ok(!('reply' in buildTweetBody('re', [], r)), 'treated as a reply: ' + JSON.stringify(r));
  }
});

t('numeric ids are accepted and normalised to strings', function () {
  const b = buildTweetBody('re', [], { parent: 2081727561449853150 });
  assert.strictEqual(typeof b.reply.in_reply_to_tweet_id, 'string');
});

t('text is passed through untouched', function () {
  const text = 'Your resume says "responsible for". #jobsearch';
  assert.strictEqual(buildTweetBody(text, [], null).text, text);
});

console.log('\nx reply tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

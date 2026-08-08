// Run with: node api/actionsExecute/executors/social/x.linkreply.test.js
//
// Shape 4: X demotes posts carrying outbound links, so the executor posts the
// clean body and delivers the link as a self-reply. The decision logic is pure
// and receipt-driven because the failure modes are public: the main tweet must
// never post twice, and a missing link-reply must stay visibly pending so a
// re-execute delivers ONLY the reply.
const assert = require('assert');
const { splitLinkForReply, decideXDelivery } = require('./x');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const URL = 'https://www.ambientpixels.ai/resume-roast/?utm_source=x&utm_content=act_1';

t('a trailing URL splits into clean body + reply link', function () {
  const s = splitLinkForReply('Your resume has blind spots. Find them free.\n' + URL);
  assert.ok(s, 'should split');
  assert.strictEqual(s.body, 'Your resume has blind spots. Find them free.');
  assert.strictEqual(s.url, URL);
});

t('no URL, mid-text URL, or URL-only text does not split', function () {
  assert.strictEqual(splitLinkForReply('No link here at all'), null);
  assert.strictEqual(splitLinkForReply('See ' + URL + ' for details, seriously'), null, 'URL is not trailing');
  assert.strictEqual(splitLinkForReply(URL), null, 'URL-only post would post an empty body');
  assert.strictEqual(splitLinkForReply('   ' + URL), null);
});

t('hashtags after the URL block the split — conservative by design', function () {
  assert.strictEqual(splitLinkForReply('Get roasted ' + URL + ' #jobsearch'), null);
});

t('fresh post with reply policy splits', function () {
  const d = decideXDelivery({ text: 'Find your blind spots.\n' + URL, wantSplit: true });
  assert.strictEqual(d.mode, 'post');
  assert.strictEqual(d.body, 'Find your blind spots.');
  assert.strictEqual(d.replyText, URL);
});

t('fresh post without reply policy posts the full text', function () {
  const d = decideXDelivery({ text: 'Find your blind spots.\n' + URL, wantSplit: false });
  assert.strictEqual(d.mode, 'post');
  assert.strictEqual(d.body, 'Find your blind spots.\n' + URL);
  assert.strictEqual(d.replyText, null);
});

t('an action that IS a threaded reply never splits', function () {
  const d = decideXDelivery({ text: 'context reply ' + URL, wantSplit: true, payloadReply: { in_reply_to_tweet_id: '99' } });
  assert.strictEqual(d.replyText, null, 'a reply to someone must not grow its own reply');
});

t('a complete existing receipt short-circuits — the incident rule', function () {
  const receipt = { post_id: '111', content_hash: 'h' };
  const d = decideXDelivery({ text: 'x\n' + URL, wantSplit: true, existingReceipt: receipt });
  assert.strictEqual(d.mode, 'skip');
  assert.strictEqual(d.receipt, receipt);
});

t('an existing receipt with a pending link reply posts ONLY the reply', function () {
  const receipt = { post_id: '111', link_reply_pending: true };
  const d = decideXDelivery({ text: 'Find your blind spots.\n' + URL, wantSplit: true, existingReceipt: receipt });
  assert.strictEqual(d.mode, 'reply-only');
  assert.strictEqual(d.parentId, '111');
  assert.strictEqual(d.replyText, URL);
});

t('pending reply whose URL cannot be re-derived skips rather than guessing', function () {
  const receipt = { post_id: '111', link_reply_pending: true };
  const d = decideXDelivery({ text: 'no url anymore', wantSplit: true, existingReceipt: receipt });
  assert.strictEqual(d.mode, 'skip', 'never invent a link to post publicly');
});

console.log('\nx link-reply tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

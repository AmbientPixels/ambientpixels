// Run with: node api/actionsExecute/executors/social/facebook.test.js
//
// The Facebook adapter replaced a manual-outbox stub that could not fail in
// interesting ways. The real one can, and two of its failure modes are the quiet
// kind this codebase keeps getting bitten by:
//
//   1. A duplicate public post. Facebook publishing is not idempotent, so a retry
//      after a POST that succeeded but whose receipt never persisted would post
//      twice. The content-hash guard has to fire BEFORE any network call.
//   2. A read failure that returns 0 instead of null. `followers: 0` and
//      "we lost data access" render identically on a dashboard, and the token's
//      data-access clock expires 90 days before anyone would think to check.
//
// Everything here is offline: no token, no network.

const assert = require('assert');

process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token-not-real';
process.env.FACEBOOK_PAGE_ID = '1250918731441250';

const fb = require('./facebook');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}
async function ta(name, fn) {
  try { await fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const PAGE = '1250918731441250';

console.log('\nfacebook adapter');

// ── permalink construction ──
t('composite id becomes a /posts/ permalink', () => {
  assert.strictEqual(
    fb._permalink(PAGE, PAGE + '_987654321'),
    'https://www.facebook.com/' + PAGE + '/posts/987654321'
  );
});

t('non-composite id falls back rather than producing a broken /posts/ URL', () => {
  assert.strictEqual(fb._permalink(PAGE, '987654321'), 'https://www.facebook.com/987654321');
});

t('empty id yields empty string, not a link to the page root', () => {
  assert.strictEqual(fb._permalink(PAGE, ''), '');
});

// ── error flattening ──
// A governance log entry reading "HTTP 400" is unactionable; the subcode and
// fbtrace_id are what Meta support and the docs are keyed on.
t('graph error envelope is flattened with code, subcode and fbtrace', () => {
  const msg = fb._describeError({
    error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'AbC123' }
  }, '', 400);
  assert.ok(msg.includes('Invalid OAuth access token'), msg);
  assert.ok(msg.includes('code=190'), msg);
  assert.ok(msg.includes('subcode=463'), msg);
  assert.ok(msg.includes('fbtrace=AbC123'), msg);
});

t('non-JSON error body still produces a readable message', () => {
  const msg = fb._describeError(null, '<html>502 Bad Gateway</html>', 502);
  assert.ok(msg.includes('502'), msg);
});

// ── content hash ──
t('content hash is stable and text-sensitive', () => {
  assert.strictEqual(fb.contentHash('hello'), fb.contentHash('hello'));
  assert.notStrictEqual(fb.contentHash('hello'), fb.contentHash('hello '));
});

// ── credential validation ──
t('missing token and missing page id are reported distinctly', () => {
  assert.match(fb.validateCredentials({ pageAccessToken: '', pageId: PAGE }), /ACCESS_TOKEN/);
  assert.match(fb.validateCredentials({ pageAccessToken: 'x', pageId: '' }), /PAGE_ID/);
  assert.strictEqual(fb.validateCredentials({ pageAccessToken: 'x', pageId: PAGE }), null);
});

(async () => {
  fb._resetCredsCache();

  await ta('empty post text is rejected before any network call', async () => {
    let threw = null;
    try { await fb.publishToFacebook({ id: 'a1', payload: { text: '   ' } }); }
    catch (e) { threw = e; }
    assert.ok(threw, 'should have thrown');
    assert.strictEqual(threw.code, 'EMPTY_CONTENT');
  });

  // The duplicate-post guard. If this regresses, the symptom is a public double
  // post, which cannot be taken back.
  await ta('matching content hash returns the existing receipt without posting', async () => {
    const text = 'We built a free resume roast.';
    const receipt = { platform: 'facebook', post_id: PAGE + '_111', content_hash: fb.contentHash(text) };
    const out = await fb.publishToFacebook({
      id: 'a2',
      payload: { text: text },
      execution: { receipt: receipt }
    });
    assert.strictEqual(out.receipt.post_id, PAGE + '_111');
  });

  // Diverging hash means the CEO edited the copy after a failed attempt: that is a
  // genuinely new post and must NOT be skipped. It will fail on the fake token,
  // which is the proof it got past the guard and tried to reach the network.
  await ta('diverging content hash is not skipped', async () => {
    const receipt = { platform: 'facebook', post_id: PAGE + '_111', content_hash: fb.contentHash('the old text') };
    let threw = null;
    try {
      await fb.publishToFacebook({ id: 'a3', payload: { text: 'the NEW text' }, execution: { receipt: receipt } });
    } catch (e) { threw = e; }
    assert.ok(threw, 'should have attempted the call and failed on the fake token');
    assert.notStrictEqual(threw.code, 'EMPTY_CONTENT');
  });

  // Reads must be null-on-failure. A 0 here is indistinguishable from a real
  // audience of zero and would be charted as such.
  await ta('page stats return null on failure, never zero', async () => {
    const stats = await fb.fetchPageStats();
    assert.strictEqual(stats, null, 'a failed read must be null so it cannot be charted as 0');
  });

  await ta('post engagement returns null on failure, never zero', async () => {
    assert.strictEqual(await fb.fetchPostEngagement(PAGE + '_111'), null);
    assert.strictEqual(await fb.fetchPostEngagement(''), null);
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();

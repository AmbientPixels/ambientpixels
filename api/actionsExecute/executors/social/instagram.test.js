// Run with: node api/actionsExecute/executors/social/instagram.test.js
//
// The link-shape refusal and the unknown-outcome guard are the two things worth
// protecting here. Everything else is shape.

const assert = require('assert');
const ig = require('./instagram');
const { EXECUTORS_FOR_TEST } = (() => { try { return {}; } catch (e) { return {}; } })();

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('\nfindUrls / countHashtags');

test('finds a bare url', () => {
  assert.deepStrictEqual(ig.findUrls('read this https://ambientpixels.ai/blog ok'), ['https://ambientpixels.ai/blog']);
});

test('finds http as well as https', () => {
  assert.strictEqual(ig.findUrls('http://example.com and https://b.com').length, 2);
});

test('does not invent a url from plain prose', () => {
  assert.deepStrictEqual(ig.findUrls('we shipped the thing today. no links here.'), []);
});

test('a trailing paren does not get swallowed into the url', () => {
  assert.deepStrictEqual(ig.findUrls('(see https://a.io/x)'), ['https://a.io/x']);
});

test('counts hashtags', () => {
  assert.strictEqual(ig.countHashtags('#a #b #c'), 3);
  assert.strictEqual(ig.countHashtags('no tags'), 0);
});

console.log('\ncheckPublishable — the link-shape refusal');

test('refuses a caption containing a url', () => {
  const r = ig.checkPublishable({ text: 'Our new tool is live: https://ambientpixels.ai/roast' });
  assert.ok(r, 'must refuse');
  assert.strictEqual(r.code, 'LINK_SHAPE_UNSUPPORTED');
  assert.ok(/dead text/.test(r.message), 'message must say WHY, not just no');
  assert.ok(r.message.indexOf('https://ambientpixels.ai/roast') !== -1, 'names the offending url');
});

test('refuses an explicitly link-shaped post even with no url yet', () => {
  const r = ig.checkPublishable({ text: 'some copy', post_shape: { kind: 'link' } });
  assert.strictEqual(r.code, 'LINK_SHAPE_UNSUPPORTED');
});

test('allows an engagement-shaped post', () => {
  assert.strictEqual(ig.checkPublishable({ text: 'My agents police each other without asking me.' }), null);
});

test('allows an engagement post that merely mentions a brand name', () => {
  assert.strictEqual(ig.checkPublishable({ text: 'ambientpixels.ai is where this runs' }), null,
    'a bare domain is not a clickable link and reads fine — only real URLs are refused');
});

test('refuses empty copy', () => {
  assert.strictEqual(ig.checkPublishable({ text: '   ' }).code, 'EMPTY_CONTENT');
});

test('refuses more than 30 hashtags', () => {
  const tags = Array.from({ length: 31 }, (_, i) => '#t' + i).join(' ');
  const r = ig.checkPublishable({ text: 'copy ' + tags });
  assert.strictEqual(r.code, 'TOO_MANY_HASHTAGS');
});

test('30 hashtags exactly is allowed', () => {
  const tags = Array.from({ length: 30 }, (_, i) => '#t' + i).join(' ');
  assert.strictEqual(ig.checkPublishable({ text: 'copy ' + tags }), null);
});

console.log('\ncredentials');

test('validate requires both the page token and the ig user id', () => {
  assert.ok(ig.validateCredentials({ pageAccessToken: '', igUserId: '123' }));
  assert.ok(ig.validateCredentials({ pageAccessToken: 'tok', igUserId: '' }));
  assert.strictEqual(ig.validateCredentials({ pageAccessToken: 'tok', igUserId: '123' }), null);
});

console.log('\nrouting');

test('instagram is registered for publish AND schedule', () => {
  const { isExecutable } = require('../index');
  assert.strictEqual(isExecutable('social_post.publish', 'instagram'), true);
  assert.strictEqual(isExecutable('social_post.schedule', 'instagram'), true);
});

test('instagram is NOT registered for reply (no comment automation)', () => {
  const { isExecutable } = require('../index');
  assert.strictEqual(isExecutable('social_post.reply', 'instagram'), false);
});

console.log('\nplatform is in every list it has to be in');

test('telemetry accepts instagram, or metrics rows are never recorded', () => {
  const tel = require('../../../socialMetrics/telemetry');
  assert.strictEqual(tel.isSocialAction({ type: 'social_post.publish', platform: 'instagram' }), true);
});

test('scheduler does not treat instagram as a manual platform', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../../actionsScheduler/index.js'), 'utf8');
  const m = src.match(/_manualPlatforms = (\[[^\]]*\])/);
  assert.ok(m, 'manual platform list must still be findable');
  assert.strictEqual(m[1].indexOf('instagram'), -1, 'instagram must NOT be in the SKIP list');
});

test('social task type lists include social_instagram', () => {
  const C = require('../../../companyHeartbeat/constants');
  assert.ok(C.VALID_SOCIAL_TASK_TYPES.indexOf('social_instagram') !== -1);
});

test('prompt enum names social_instagram, or the agent can never emit it', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../../companyHeartbeat/prompt-builders.js'), 'utf8');
  assert.ok(src.indexOf('social_instagram') !== -1, 'enum must be updated in the same commit as the handler');
  assert.ok(/Instagram captions render URLs as dead text/.test(src), 'the no-links rule must reach the agent, not just the executor');
});

// ── Container readiness ──
// The first real Instagram post (2026-08-09) failed with "Media ID is not available"
// (9007/2207027) because /media returning an id was treated as "ready to publish". It is
// not: Instagram fetches image_url on its own side and the container stays IN_PROGRESS
// until that finishes. Verified at the time that the image was publicly fetchable and
// media_count was 0, so the container simply had not finished.
test('only FINISHED is publishable', () => {
  assert.strictEqual(ig.classifyContainerStatus('FINISHED'), 'ready');
});

test('in-progress states mean wait, never publish and never give up', () => {
  ['IN_PROGRESS', 'PUBLISHED', '', null, undefined, '(absent)'].forEach(function (s) {
    assert.strictEqual(ig.classifyContainerStatus(s), 'pending', 'status ' + JSON.stringify(s) + ' must be pending');
  });
});

test('ERROR and EXPIRED are terminal, not retried forever', () => {
  assert.strictEqual(ig.classifyContainerStatus('ERROR'), 'failed');
  assert.strictEqual(ig.classifyContainerStatus('EXPIRED'), 'failed');
});

test('status matching is case-insensitive', () => {
  assert.strictEqual(ig.classifyContainerStatus('finished'), 'ready');
  assert.strictEqual(ig.classifyContainerStatus('error'), 'failed');
});

test('publish waits for the container before calling media_publish', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'instagram.js'), 'utf8');
  const waitAt = src.indexOf('_waitForContainerReady(creationId');
  const publishAt = src.indexOf("'/media_publish'");
  assert.ok(waitAt !== -1, 'the readiness wait must exist');
  assert.ok(publishAt !== -1, 'media_publish call must still exist');
  assert.ok(waitAt < publishAt, 'the wait must happen BEFORE media_publish, or the race is back');
});

test('container-wait failures stay retryable — they must never park for manual review', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'instagram.js'), 'utf8');
  const start = src.indexOf('async function _waitForContainerReady');
  const end = src.indexOf('async function _fetchPermalink');
  assert.ok(start !== -1 && end > start, 'could not isolate the wait helper');
  const body = src.slice(start, end);
  assert.strictEqual(body.indexOf('requires_manual_review'), -1,
    'nothing has published at this point, so parking for a human would strand a post that is safe to retry');
});

console.log('\n' + passed + ' passed');

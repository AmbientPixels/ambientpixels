// Run with: node api/studio/desk.test.js
// The Video department's request rules, and the desk routes' auth (refused before storage is touched).
const assert = require('assert');
const D = require('./desk');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const NOW = Date.parse('2026-10-15T04:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function good(over) {
  return Object.assign({
    trigger: { type: 'release', ref: 'rel_abc123_ambientscore', evidence: 'Free scans answer immediately' },
    product: 'AmbientScore', format: 'walkthrough', mood: 'ambient', title: 'What a free scan shows you',
    goal: 'Run a free scan on their own site', hook: 'Your site leaks visitors. Here is where.',
    claims: [{ claim: 'A free scan scores 8 dimensions', source: 'product-facts:AmbientScore' }],
  }, over);
}
// A request as it sits on the company board after the heartbeat applied the create.
function onBoard(request, over) {
  const spec = D.requestTask(request);
  return Object.assign({ id: 'task-' + Math.random().toString(36).slice(2, 10), comments: [], created_by: request.from, createdAt: iso(NOW), updatedAt: iso(NOW) }, spec, over);
}

(async () => {
  await t('a good request is clean, style derived from the product', () => {
    const x = D.cleanRequest(good(), 'echo');
    assert.strictEqual(typeof x, 'object', x);
    assert.strictEqual(x.style, 'as-editorial');
    assert.strictEqual(x.seconds, 150);
  });
  await t('style follows the subject: Resume Roast, AmbientOS, inside-ambientos', () => {
    assert.strictEqual(D.styleFor('ResumeRoast', 'walkthrough'), 'resume-roast');
    assert.strictEqual(D.styleFor('AmbientOS', 'walkthrough'), 'ap-monolith');
    assert.strictEqual(D.styleFor('AmbientScore', 'inside-ambientos'), 'ap-monolith');
    assert.strictEqual(D.styleFor('CardForge', 'trailer'), 'own-brand');
    assert.strictEqual(D.styleFor('Nonsense', 'trailer'), null);
  });
  await t('refusals: catalogue ids, trigger ref, claims and sources, author', () => {
    assert.match(D.cleanRequest(good({ format: 'documentary' }), 'echo'), /format must be/);
    assert.match(D.cleanRequest(good({ mood: 'sad' }), 'echo'), /mood must be/);
    assert.match(D.cleanRequest(good({ trigger: { type: 'release' } }), 'echo'), /needs a ref/);
    assert.match(D.cleanRequest(good({ trigger: { type: 'vibes', ref: 'x' } }), 'echo'), /trigger.type/);
    assert.match(D.cleanRequest(good({ claims: [] }), 'echo'), /at least one claim/);
    assert.match(D.cleanRequest(good({ claims: [{ claim: 'x', source: 'https://example.com' }] }), 'echo'), /needs a source/);
    assert.match(D.cleanRequest(good({ product: 'Nonsense' }), 'echo'), /no style wears/);
    assert.match(D.cleanRequest(good(), 'mallory'), /unknown author/);
  });
  await t('truth lint: agents never make the video, never host a product walkthrough', () => {
    assert.match(D.cleanRequest(good({ hook: "I'll render a quick demo" }), 'echo'), /studio makes them/);
    assert.match(D.cleanRequest(good({ goal: 'Nova edited this walkthrough for you' }), 'echo'), /studio makes them/);
    assert.match(D.cleanRequest(good({ title: 'Scan tour hosted by Nova' }), 'echo'), /inside-ambientos/);
    assert.strictEqual(typeof D.cleanRequest(good({ format: 'inside-ambientos', product: 'AmbientOS', title: 'How the fleet runs, hosted by Nova', seconds: 75 }), 'nova'), 'object');
  });
  await t('sources: product facts, our pages, /pulse/', () => {
    assert.ok(D.validSource('product-facts:ResumeRoast'));
    assert.ok(D.validSource('https://www.ambientpixels.ai/ambientscore/'));
    assert.ok(D.validSource('/pulse/'));
    assert.ok(!D.validSource('https://ambientpixels.ai.evil.com/x'));
  });
  await t('requestTask: a studio-assigned video_request with a readable brief and the payload', () => {
    const r = D.cleanRequest(good({ wish: { format: 'vertical-short', note: 'for Bluesky' }, campaignId: 'camp-1' }), 'echo');
    const task = D.requestTask(r);
    assert.strictEqual(task.assignee, 'studio');
    assert.strictEqual(task.taskType, 'video_request');
    assert.strictEqual(task.campaign_id, 'camp-1');
    assert.match(task.title, /^Video: What a free scan/);
    assert.match(task.description, /Video request from echo/);
    assert.match(task.description, /1\. A free scan scores 8 dimensions \(product-facts:AmbientScore\)/);
    assert.match(task.description, /```video-request\n\{/);
  });
  await t('parseRequest: status follows the board and the studio\'s markers; a decline carries Chad\'s comment', () => {
    const r = D.cleanRequest(good(), 'echo');
    assert.strictEqual(D.parseRequest(onBoard(r)).status, 'waiting');
    assert.strictEqual(D.parseRequest(onBoard(r, { status: 'in-progress' })).status, 'accepted');
    const working = onBoard(r, { status: 'in-progress', comments: [
      { author: 'studio', text: D.studioMark('scripting', '04-free-scan', 'ambientpixels') + ' On the Board.', createdAt: iso(NOW) },
      { author: 'quill', text: 'Claim 1 checks out.', createdAt: iso(NOW) },
      { author: 'studio', text: D.studioMark('in_production', '04-free-scan') + ' Voice and scenes.', createdAt: iso(NOW) },
    ] });
    const p = D.parseRequest(working);
    assert.strictEqual(p.status, 'in_production');
    assert.strictEqual(p.video, '04-free-scan');
    assert.strictEqual(p.project, 'ambientpixels');
    const declined = D.parseRequest(onBoard(r, { status: 'canceled', comments: [{ text: 'No release worth a video yet', agentId: null, timestamp: iso(NOW) }] }));
    assert.strictEqual(declined.status, 'declined');
    assert.strictEqual(declined.reason, 'No release worth a video yet');
    const released = D.parseRequest(onBoard(r, { status: 'done', comments: [{ author: 'studio', text: D.studioMark('released', '04-free-scan') + ' Released: https://www.ambientpixels.ai/ambientscore/#video. @Echo', createdAt: iso(NOW) }] }));
    assert.strictEqual(released.status, 'released');
    assert.strictEqual(released.releaseUrl, 'https://www.ambientpixels.ai/ambientscore/#video');
    assert.strictEqual(D.parseRequest({ taskType: 'general' }), null);
    assert.strictEqual(D.parseRequest({ taskType: 'video_request', description: 'no payload' }), null);
  });
  await t('a fake studio marker from anyone but the studio is ignored', () => {
    const r = D.cleanRequest(good(), 'echo');
    const p = D.parseRequest(onBoard(r, { status: 'in-progress', comments: [{ author: 'echo', text: D.studioMark('review', 'x'), createdAt: iso(NOW) }] }));
    assert.strictEqual(p.status, 'accepted');
    assert.strictEqual(p.video, null);
  });
  await t('fleetLoad and demand over board requests', () => {
    const a = D.parseRequest(onBoard(D.cleanRequest(good({ wish: { format: 'vertical-short', note: 'for Bluesky' } }), 'echo'), { status: 'done' }));
    const b = D.parseRequest(onBoard(D.cleanRequest(good({ format: 'trailer', product: 'CardForge', mood: 'upbeat', wish: { format: 'Vertical-Short' }, trigger: { type: 'bet_won', ref: 'k' } }), 'scout'), { status: 'canceled', comments: [{ text: 'No CardForge kit yet', agentId: null }] }));
    const c = D.parseRequest(onBoard(D.cleanRequest(good({ trigger: { type: 'campaign_launch', ref: 'camp-2' } }), 'nova')));
    const load = D.fleetLoad([a, b, c]);
    assert.strictEqual(load.open, 1);
    assert.ok(load.refs.has('bet_won:k'));
    const dm = D.demand([a, b, c]);
    assert.strictEqual(dm.requests, 3);
    assert.deepStrictEqual(dm.formats.walkthrough, { asked: 2, accepted: 1, declined: 0, released: 1 });
    assert.deepStrictEqual(dm.formats.trailer, { asked: 1, accepted: 0, declined: 1, released: 0 });
    assert.deepStrictEqual(dm.wishes[0], { what: 'format:vertical-short', n: 2 });
    assert.strictEqual(dm.declines[0].reason, 'No CardForge kit yet');
    assert.strictEqual(dm.byAgent.echo.released, 1);
  });

  // Routes: refused before storage.
  delete process.env.STUDIO_ACCESS_KEY; delete process.env.STUDIO_WORKER_TOKEN; delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  const handler = require('./index');
  async function call(method, action, headers = {}, body) {
    const context = { bindingData: { action }, log: { error() {} }, res: null };
    await handler(context, { method, headers, query: {}, body });
    return context.res;
  }
  await t('department routes: no credentials configured -> 403', async () => {
    for (const [m, a] of [['GET', 'desk'], ['GET', 'desk-sync'], ['POST', 'desk-comment']]) {
      assert.strictEqual((await call(m, a, { 'x-studio-key': 'guess', 'x-studio-worker-token': 'guess' })).status, 403, a);
    }
  });
  await t('the old ticket routes are gone', async () => {
    for (const [m, a] of [['POST', 'desk-decide'], ['POST', 'desk-ticket'], ['POST', 'desk-release'], ['POST', 'desk-release-url'], ['POST', 'desk-update'], ['GET', 'desk-releases'], ['POST', 'desk-release-status']]) {
      assert.strictEqual((await call(m, a)).status, 404, a);
    }
  });
  process.env.STUDIO_ACCESS_KEY = 'op-key'; process.env.STUDIO_WORKER_TOKEN = 'wk-token';
  await t('only the PC (the department) reads and comments on requests', async () => {
    assert.strictEqual((await call('GET', 'desk', { 'x-studio-key': 'op-key' })).status, 403);
    assert.strictEqual((await call('GET', 'desk-sync', { 'x-studio-key': 'op-key' })).status, 403);
    assert.strictEqual((await call('POST', 'desk-comment', { 'x-studio-key': 'op-key' })).status, 403);
  });
  await t('desk-comment refuses a bad task id or an empty comment before storage', async () => {
    assert.strictEqual((await call('POST', 'desk-comment', { 'x-studio-worker-token': 'wk-token' }, { taskId: '../x', text: 'hi' })).status, 400);
    assert.strictEqual((await call('POST', 'desk-comment', { 'x-studio-worker-token': 'wk-token' }, { taskId: 'task-123-abcd' })).status, 400);
    assert.strictEqual((await call('POST', 'desk-comment', { 'x-studio-worker-token': 'wk-token' }, { taskId: 'task-123-abcd', stage: 'launch', text: 'x' })).status, 400);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();

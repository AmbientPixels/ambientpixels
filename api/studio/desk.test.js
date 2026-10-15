// Run with: node api/studio/desk.test.js
// The Video Desk's ticket rules, and the desk routes' auth (refused before storage is touched).
const assert = require('assert');
const D = require('./desk');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const NOW = Date.parse('2026-10-15T04:00:00Z');

function good(over) {
  return Object.assign({
    trigger: { type: 'release', ref: 'rel_abc123_ambientscore', evidence: 'Free scans answer immediately' },
    product: 'AmbientScore', format: 'walkthrough', mood: 'ambient', title: 'What a free scan shows you',
    goal: 'Run a free scan on their own site', hook: 'Your site leaks visitors. Here is where.',
    claims: [{ claim: 'A free scan scores 8 dimensions', source: 'product-facts:AmbientScore' }],
  }, over);
}

(async () => {
  await t('a good fleet ticket is accepted, style derived from the product', () => {
    const x = D.cleanFleetTicket(good(), 'echo', NOW);
    assert.strictEqual(typeof x, 'object', x);
    assert.strictEqual(x.style, 'as-editorial');
    assert.strictEqual(x.status, 'proposed');
    assert.ok(D.ID.test(x.id), x.id);
    assert.strictEqual(x.seconds, 150); // the format's max when not given
  });
  await t('style follows the subject: Resume Roast, AmbientOS, inside-ambientos', () => {
    assert.strictEqual(D.styleFor('ResumeRoast', 'walkthrough'), 'resume-roast');
    assert.strictEqual(D.styleFor('AmbientOS', 'walkthrough'), 'ap-monolith');
    assert.strictEqual(D.styleFor('AmbientScore', 'inside-ambientos'), 'ap-monolith');
    assert.strictEqual(D.styleFor('CardForge', 'trailer'), 'own-brand');
    assert.strictEqual(D.styleFor('Nonsense', 'trailer'), null);
  });
  await t('refusals: catalogue ids, trigger ref, claims and sources', () => {
    assert.match(D.cleanFleetTicket(good({ format: 'documentary' }), 'echo', NOW), /format must be/);
    assert.match(D.cleanFleetTicket(good({ mood: 'sad' }), 'echo', NOW), /mood must be/);
    assert.match(D.cleanFleetTicket(good({ trigger: { type: 'release' } }), 'echo', NOW), /needs a ref/);
    assert.match(D.cleanFleetTicket(good({ trigger: { type: 'vibes', ref: 'x' } }), 'echo', NOW), /trigger.type/);
    assert.match(D.cleanFleetTicket(good({ claims: [] }), 'echo', NOW), /at least one claim/);
    assert.match(D.cleanFleetTicket(good({ claims: [{ claim: 'x', source: 'https://example.com' }] }), 'echo', NOW), /needs a source/);
    assert.match(D.cleanFleetTicket(good({ product: 'Nonsense' }), 'echo', NOW), /no style wears/);
    assert.match(D.cleanFleetTicket(good(), 'mallory', NOW), /unknown author/);
  });
  await t('truth lint: agents never make the video, never host a product walkthrough', () => {
    assert.match(D.cleanFleetTicket(good({ hook: "I'll render a quick demo" }), 'echo', NOW), /studio makes them/);
    assert.match(D.cleanFleetTicket(good({ goal: 'Nova edited this walkthrough for you' }), 'echo', NOW), /studio makes them/);
    assert.match(D.cleanFleetTicket(good({ title: 'Scan tour hosted by Nova' }), 'echo', NOW), /inside-ambientos/);
    assert.strictEqual(typeof D.cleanFleetTicket(good({ format: 'inside-ambientos', product: 'AmbientOS', title: 'How the fleet runs, hosted by Nova', seconds: 75 }), 'nova', NOW), 'object');
  });
  await t('sources: product facts, our pages, /pulse/', () => {
    assert.ok(D.validSource('product-facts:ResumeRoast'));
    assert.ok(D.validSource('https://www.ambientpixels.ai/ambientscore/'));
    assert.ok(D.validSource('/pulse/'));
    assert.ok(!D.validSource('https://ambientpixels.ai.evil.com/x'));
  });
  await t('wish is kept only when it says something', () => {
    assert.strictEqual(D.cleanFleetTicket(good({ wish: {} }), 'echo', NOW).wish, null);
    assert.deepStrictEqual(D.cleanFleetTicket(good({ wish: { format: 'vertical-short', note: 'for Bluesky' } }), 'echo', NOW).wish, { format: 'vertical-short', mood: null, style: null, note: 'for Bluesky' });
  });
  await t('decide: decline needs a reason, accept sets the project, no second decision', () => {
    const x = D.cleanFleetTicket(good(), 'echo', NOW);
    assert.match(D.decide(x, { decision: 'decline' }, 'chad', NOW), /needs a reason/);
    assert.match(D.decide(x, { decision: 'accept', project: 'xbox-gps' }, 'chad', NOW, ['ambientpixels']), /unknown project/);
    const a = D.decide(x, { decision: 'accept' }, 'chad', NOW, ['ambientpixels']);
    assert.strictEqual(a.status, 'accepted');
    assert.strictEqual(a.studio.project, 'ambientpixels');
    assert.match(D.decide(a, { decision: 'decline', reason: 'changed my mind' }, 'chad', NOW), /already decided/);
    const y = D.cleanFleetTicket(good(), 'echo', NOW);
    assert.strictEqual(D.decide(y, { decision: 'decline', reason: 'No release to show yet' }, 'chad', NOW).status, 'declined');
  });
  await t('applyUpdate: only after acceptance; video, status and release flow back', () => {
    const x = D.cleanFleetTicket(good(), 'echo', NOW);
    assert.match(D.applyUpdate(x, { status: 'scripting' }, 'studio', NOW), /not been accepted/);
    D.decide(x, { decision: 'accept' }, 'chad', NOW, ['ambientpixels']);
    D.applyUpdate(x, { video: '04-free-scan', trackerIds: ['t18', 't19'], status: 'scripting' }, 'studio', NOW);
    assert.strictEqual(x.studio.video, '04-free-scan');
    assert.strictEqual(x.status, 'scripting');
    assert.match(D.applyUpdate(x, { status: 'proposed' }, 'studio', NOW), /invalid status/);
    assert.match(D.applyUpdate(x, { releaseUrl: 'http://x' }, 'studio', NOW), /https/);
    D.applyUpdate(x, { status: 'released', releaseUrl: 'https://www.ambientpixels.ai/ambientscore/' }, 'studio', NOW);
    assert.strictEqual(x.release.url, 'https://www.ambientpixels.ai/ambientscore/');
    assert.strictEqual(x.history.map((h) => h.status).join(','), 'proposed,accepted,scripting,released');
  });
  await t('crew tickets route to the right agent', () => {
    const c = D.cleanCrewTicket({ kind: 'claims_check', title: 'Check 03 teardown claims', text: 'Every line in 03-teardown-SOURCES.md against product facts' }, 'researcher', NOW);
    assert.strictEqual(c.to, 'quill');
    assert.strictEqual(c.status, 'open');
    assert.match(D.cleanCrewTicket({ kind: 'gossip', title: 'xxxx', text: 'yyyyyyyyyyyy' }, 'x', NOW), /kind must be/);
    assert.strictEqual(D.applyUpdate(c, { status: 'taken', taskId: 'task_1' }, 'heartbeat', NOW).taskId, 'task_1');
  });
  await t('fleetLoad counts open fleet tickets, newest per agent, used trigger refs', () => {
    const a = D.cleanFleetTicket(good(), 'echo', NOW);
    const b = D.cleanFleetTicket(good({ trigger: { type: 'bet_won', ref: 'search_page|x' } }), 'scout', NOW + 1000);
    const c = D.cleanFleetTicket(good(), 'echo', NOW + 2000);
    D.decide(c, { decision: 'decline', reason: 'duplicate of a' }, 'chad', NOW);
    const load = D.fleetLoad([a, b, c]);
    assert.strictEqual(load.open, 2);
    assert.strictEqual(load.lastByAgent.echo, new Date(NOW + 2000).toISOString());
    assert.ok(load.refs.has('release:rel_abc123_ambientscore'));
  });

  // Routes: refused before storage.
  delete process.env.STUDIO_ACCESS_KEY; delete process.env.STUDIO_WORKER_TOKEN; delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  const handler = require('./index');
  async function call(method, action, headers = {}, body) {
    const context = { bindingData: { action }, log: { error() {} }, res: null };
    await handler(context, { method, headers, query: {}, body });
    return context.res;
  }
  await t('desk routes: no credentials configured -> 403', async () => {
    for (const [m, a] of [['GET', 'desk'], ['POST', 'desk-decide'], ['POST', 'desk-ticket'], ['GET', 'desk-releases'], ['POST', 'desk-release'], ['GET', 'desk-sync'], ['POST', 'desk-update']]) {
      assert.strictEqual((await call(m, a, { 'x-studio-key': 'guess', 'x-studio-worker-token': 'guess' })).status, 403, a);
    }
  });
  process.env.STUDIO_ACCESS_KEY = 'op-key'; process.env.STUDIO_WORKER_TOKEN = 'wk-token';
  await t('operator key cannot use the worker-only desk routes', async () => {
    assert.strictEqual((await call('GET', 'desk-sync', { 'x-studio-key': 'op-key' })).status, 403);
    assert.strictEqual((await call('POST', 'desk-update', { 'x-studio-key': 'op-key' })).status, 403);
  });
  await t('either credential reaches the shared desk routes (storage unset -> 503, not 403)', async () => {
    assert.strictEqual((await call('GET', 'desk', { 'x-studio-key': 'op-key' })).status, 503);
    assert.strictEqual((await call('GET', 'desk', { 'x-studio-worker-token': 'wk-token' })).status, 503);
  });
  await t('desk-decide with a bad id -> 404 before storage', async () => {
    assert.strictEqual((await call('POST', 'desk-decide', { 'x-studio-key': 'op-key' }, { id: '../x' })).status, 404);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();

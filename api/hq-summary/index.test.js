// Run: node hq-summary/index.test.js   (from api/)
// GET /api/hq-summary: the numbers HQ Today shows, checked against the live board captured 2026-10-16 03:00 UTC.
'use strict';
const assert = require('assert');
const path = require('path');

let passed = 0;
async function t(name, fn) { try { await fn(); passed++; } catch (err) { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; } }

const F = require('../_shared/fixtures/hq-board-2026-10-16.json');
const NOW = Date.parse(F.capturedAt);

// Stub storage: serve the fixture; `failing` lists keys whose read fails.
let failing = [];
let reads = [];
const storagePath = require.resolve('../_utils/companyStorage');
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: {
    validateSecret: (s) => s === 'right',
    getStateWithMeta: async (k) => { reads.push(k); return failing.indexOf(k) !== -1 ? { value: null, failed: true } : { value: F[k] === undefined ? null : F[k], failed: false }; },
    getState: async () => { throw new Error('use getStateWithMeta'); },
    setState: async () => { throw new Error('hq-summary must never write'); },
    mutateState: async () => { throw new Error('hq-summary must never write'); }
  }
};
const fn = require(path.join(__dirname, 'index.js'));
const call = async (headers) => { const c = { log: Object.assign(() => {}, { error: () => {} }) }; await fn(c, { method: 'GET', headers: headers || {}, query: {} }); return c.res; };
const summary = (state) => fn.buildSummary(state, NOW);
const fullState = () => { const s = {}; fn.SOURCES.forEach((k) => { s[k] = F[k]; }); return s; };

(async () => {
  await t('403 without the company secret', async () => {
    assert.strictEqual((await call()).status, 403);
    assert.strictEqual((await call({ 'x-company-secret': 'wrong' })).status, 403);
  });
  await t('200 with the secret, read-only (the stub throws on any write)', async () => {
    failing = []; reads = [];
    const res = await call({ 'x-company-secret': 'right' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body.blocks).sort(), ['campaigns', 'fleet', 'goal', 'happened', 'health', 'waiting', 'week']);
    assert.deepStrictEqual(reads.sort(), fn.SOURCES.slice().sort());
  });
  await t('503 when the task board cannot be read', async () => {
    failing = ['tasks'];
    const res = await call({ 'x-company-secret': 'right' });
    assert.strictEqual(res.status, 503);
  });
  await t('another source failing makes only its block "not measured", and health says so', async () => {
    failing = ['geminiUsage', 'campaigns'];
    const b = (await call({ 'x-company-secret': 'right' })).body.blocks;
    assert.strictEqual(b.week.spend, null);
    assert.strictEqual(b.campaigns.state, 'not_measured');
    assert.strictEqual(b.week.tasksDone, 19, 'the rest still counts');
    assert.strictEqual(b.health.state, 'attention');
    assert.match(b.health.issues.map((i) => i.text).join(' | '), /Couldn't read campaigns, geminiUsage/);
    failing = [];
  });

  // ── Hand count of the live board, 2026-10-16 03:00 UTC ──
  const b = summary(fullState()).blocks;
  await t('live: all systems normal; next run 06:00', async () => {
    assert.strictEqual(b.health.state, 'ok');
    assert.strictEqual(b.health.text, 'All systems normal');
    assert.strictEqual(summary(fullState()).nextRunAt, '2026-10-16T06:00:00.000Z');
  });
  await t('live: 1 waiting — the AmbientScore video request, from you', async () => {
    assert.strictEqual(b.waiting.count, 1);
    assert.strictEqual(b.waiting.items[0].title, 'Video: AmbientScore: what a free scan shows you');
    assert.strictEqual(b.waiting.items[0].from, 'You');
  });
  await t('live: the goal is 0 of 10 people this week, measured at 00:01, by Dec 3', async () => {
    assert.deepStrictEqual([b.goal.value, b.goal.target, b.goal.by, b.goal.state], [0, 10, '2026-12-03', 'measured']);
  });
  await t('live: this week 2 published, 19 done, $4.96', async () => {
    assert.deepStrictEqual([b.week.published, b.week.tasksDone, b.week.spend], [2, 19, 4.96]);
  });
  await t('live: Scribe 20 / Echo 5 / Video 1 carry the work; Cipher dormant', async () => {
    assert.deepStrictEqual(b.fleet.busy.map((x) => [x.name, x.queue]), [['Scribe', 20], ['Echo', 5], ['Video department', 1]]);
    assert.strictEqual(b.fleet.busy[0].clearBy, '2026-11-09');
    assert.deepStrictEqual(b.fleet.dormant, ['Cipher']);
  });
  await t('live: two campaigns, both starting', async () => {
    assert.deepStrictEqual(b.campaigns.items.map((c) => c.status), ['starting', 'starting']);
  });

  // ── Health rules ──
  await t('a missed heartbeat is broken and comes first', async () => {
    const st = fullState();
    st.heartbeatRuns = [{ startedAt: '2026-10-15T12:00:00Z', status: 'ok' }];
    const h = summary(st).blocks.health;
    assert.strictEqual(h.state, 'broken');
    assert.match(h.text, /missed its 00:00 UTC run/);
  });
  await t('a running agent with old work and nothing finished is a stalled lane', async () => {
    const st = fullState();
    st.tasks = F.tasks.concat([{ id: 'q1', assignee: 'quill', status: 'todo', createdAt: '2026-10-10T00:00:00Z', title: 'x' }]);
    const h = summary(st).blocks.health;
    assert.strictEqual(h.state, 'attention');
    assert.match(h.text, /Quill has 1 waiting and finished nothing this week/);
  });
  await t('never more than 3 issues shown; the rest is a count', async () => {
    const st = fullState();
    st.heartbeatRuns = [{ startedAt: '2026-10-15T12:00:00Z', status: 'ok' }];
    st.tasks = F.tasks.concat(['quill', 'vale', 'pixel'].map((a) => ({ id: a, assignee: a, status: 'todo', createdAt: '2026-10-01T00:00:00Z' })));
    const h = summary(st).blocks.health;
    assert.strictEqual(h.issues.length, 3);
    assert.strictEqual(h.more, 1);
  });

  console.log('hq-summary: ' + passed + ' passed');
})();

// proposalDecide — video items (2026-10-16): the decision lands on the company task, the queue entry follows.
// Drives the real handler against a fake blob container with ETag semantics (same fake as concurrency.test.js).
// Run: node --test proposalDecide/video.test.js   (from api/)

const test = require('node:test');
const assert = require('node:assert');
const storage = require('../_utils/companyStorage');
const handler = require('./index');
const desk = require('../studio/desk');
const VA = require('../_lib/videoApprovals');

function makeFakeContainer() {
  const store = new Map();
  let seq = 0;
  return {
    store,
    async createIfNotExists() { return {}; },
    getBlockBlobClient(name) {
      return {
        async download() {
          const rec = store.get(name);
          if (!rec) { const e = new Error('BlobNotFound'); e.statusCode = 404; throw e; }
          return { etag: rec.etag, readableStreamBody: [Buffer.from(rec.content)] };
        },
        async upload(content, _len, opts) {
          const rec = store.get(name);
          const cond = (opts && opts.conditions) || {};
          if (cond.ifMatch && (!rec || rec.etag !== cond.ifMatch)) { const e = new Error('ConditionNotMet'); e.statusCode = 412; throw e; }
          if (cond.ifNoneMatch === '*' && rec) { const e = new Error('BlobAlreadyExists'); e.statusCode = 409; throw e; }
          store.set(name, { content, etag: 'etag-' + (++seq) });
          return {};
        }
      };
    }
  };
}
const seed = (c, key, value) => c.store.set(key + '.json', { content: JSON.stringify(value), etag: 'etag-seed-' + key });
const read = (c, key) => JSON.parse(c.store.get(key + '.json').content);

const r0 = desk.cleanRequest({
  trigger: { type: 'manual', ref: 'ceo-test' }, product: 'AmbientScore', format: 'walkthrough', mood: 'ambient',
  title: 'What a free scan shows you', goal: 'Run a free scan on their own site',
  claims: [{ claim: 'Free scan, no login', source: 'product-facts:AmbientScore' }],
}, 'ceo');
const NOW = '2026-10-16T12:00:00.000Z';
const task = (over) => Object.assign({ id: 'task-1792000000000-ab12', created_by: 'ceo', createdAt: NOW, comments: [] }, desk.requestTask(r0), over || {});

function inHeartbeatWindow() { const d = new Date(); return d.getUTCHours() % 6 === 0 && d.getUTCMinutes() < 12; }

async function decide(c, body) {
  storage._setContainerClientForTests(c);
  const ctx = { res: null, log: Object.assign(function () {}, { warn: function () {}, error: function () {} }) };
  await handler(ctx, { method: 'POST', headers: { 'x-company-secret': 'pixelpusher' }, body });
  return ctx.res;
}

function setup(t0) {
  const c = makeFakeContainer();
  const tasks = [t0];
  const q = VA.syncQueue([], tasks, NOW).queue;
  seed(c, 'tasks', tasks);
  seed(c, 'approvalQueue', q);
  return { c, q };
}

test('accepting a request in the queue moves the board task to in-progress and closes the item', async (tt) => {
  if (inHeartbeatWindow()) return tt.skip('heartbeat window');
  const { c, q } = setup(task());
  const res = await decide(c, { id: q[0].id, decision: 'approved' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(read(c, 'tasks')[0].status, 'in-progress');
  assert.strictEqual(read(c, 'approvalQueue')[0].status, 'approved');
});

test('declining needs a reason; with one, the task is canceled and the reason is Chad\'s comment', async (tt) => {
  if (inHeartbeatWindow()) return tt.skip('heartbeat window');
  const { c, q } = setup(task());
  assert.strictEqual((await decide(c, { id: q[0].id, decision: 'rejected', ceoNote: '' })).status, 400);
  assert.strictEqual(read(c, 'approvalQueue')[0].status, 'pending');
  const res = await decide(c, { id: q[0].id, decision: 'rejected', ceoNote: 'Not this month' });
  assert.strictEqual(res.status, 200);
  const t = read(c, 'tasks')[0];
  assert.strictEqual(t.status, 'canceled');
  assert.strictEqual(desk.parseRequest(t).reason, 'Not this month');
  assert.strictEqual(read(c, 'approvalQueue')[0].status, 'rejected');
});

test('sending a script back writes the marker the Studio reads', async (tt) => {
  if (inHeartbeatWindow()) return tt.skip('heartbeat window');
  const comments = [
    { author: 'studio', text: desk.studioMark('scripting', '01-scan', 'ambientpixels') + ' On the Board.', createdAt: NOW },
    { author: 'studio', text: desk.checkpointMark('script') + ' 168 words.', createdAt: NOW },
  ];
  const { c, q } = setup(task({ status: 'in-progress', comments }));
  const item = q.find((x) => x.type === 'video_checkpoint');
  const res = await decide(c, { id: item.id, decision: 'rejected', ceoNote: 'Cut the second claim' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const cp = desk.parseRequest(read(c, 'tasks')[0]).checkpoints.script;
  assert.strictEqual(cp.status, 'sent_back');
  assert.strictEqual(cp.reason, 'Cut the second claim');
});

test('an item already decided on the board is closed, not re-decided', async (tt) => {
  if (inHeartbeatWindow()) return tt.skip('heartbeat window');
  const { c, q } = setup(task());
  const tasks = read(c, 'tasks'); tasks[0].status = 'in-progress'; seed(c, 'tasks', tasks);
  const res = await decide(c, { id: q[0].id, decision: 'rejected', ceoNote: 'x' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(read(c, 'tasks')[0].status, 'in-progress');
  assert.strictEqual(read(c, 'approvalQueue')[0].status, 'resolved');
});

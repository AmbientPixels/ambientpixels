// proposalDecide — regression test for the 2026-08-01 lost-update incident.
//
// What happened: the CEO approved cprop_1785542400009_auto. proposalDecide wrote the
// campaign (camp-ms9nl7dy-dcbp, stamped with proposalId), then wrote the approvalQueue
// flip. A concurrent wholesale approvalQueue write clobbered the flip, so the campaign
// went live while the proposal sat 'pending' forever — and the dashboard's overlap
// detector then flagged the proposal as overlapping its own materialized twin.
//
// This drives the real handler against a fake blob container with real ETag semantics
// and injects exactly that competing write. The flip must survive.

const test = require('node:test');
const assert = require('node:assert');
const storage = require('../_utils/companyStorage');
const handler = require('./index');

function makeFakeContainer(hooks) {
  hooks = hooks || {};
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
          const snapshot = { etag: rec.etag, readableStreamBody: [Buffer.from(rec.content)] };
          if (hooks.onRead) hooks.onRead(name, store);
          return snapshot;
        },
        async upload(content, _len, opts) {
          const rec = store.get(name);
          const cond = (opts && opts.conditions) || {};
          if (cond.ifMatch && (!rec || rec.etag !== cond.ifMatch)) {
            const e = new Error('ConditionNotMet'); e.statusCode = 412; throw e;
          }
          if (cond.ifNoneMatch === '*' && rec) {
            const e = new Error('BlobAlreadyExists'); e.statusCode = 409; throw e;
          }
          store.set(name, { content, etag: 'etag-' + (++seq) });
          return {};
        }
      };
    }
  };
}

const PROPOSAL = {
  id: 'cprop_test_auto',
  type: 'campaign_proposal',
  status: 'pending',
  proposedBy: 'nova',
  name: 'AmbientScore: First Month Fixed-Price Pilot',
  description: 'A targeted campaign offering a one-month, fixed-price pilot.',
  platforms: ['social_linkedin'],
  frequency: 3,
  cadence: 'weekly',
  duration: 13,
  createdAt: '2026-08-01T00:00:00.009Z'
};

function seed(c, key, value) {
  c.store.set(key + '.json', { content: JSON.stringify(value), etag: 'etag-seed-' + key });
}
function read(c, key) {
  return JSON.parse(c.store.get(key + '.json').content);
}

async function callApprove(container) {
  storage._setContainerClientForTests(container);
  const ctx = { res: null, log: Object.assign(function () {}, { warn: function () {} }) };
  await handler(ctx, {
    method: 'POST',
    headers: { 'x-company-secret': 'pixelpusher' },
    body: { id: PROPOSAL.id, decision: 'approved' }
  });
  return ctx.res;
}

test('approving a proposal flips the queue entry and materializes the campaign', async () => {
  const c = makeFakeContainer();
  seed(c, 'approvalQueue', [PROPOSAL]);
  seed(c, 'objectives', []);
  seed(c, 'campaigns', []);

  const res = await callApprove(c);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));

  const camps = read(c, 'campaigns');
  assert.strictEqual(camps.length, 1, 'campaign should be materialized');
  assert.strictEqual(camps[0].proposalId, PROPOSAL.id, 'campaign carries the proposal back-link');

  const entry = read(c, 'approvalQueue').find(q => q.id === PROPOSAL.id);
  assert.strictEqual(entry.status, 'approved', 'queue entry must be flipped');
  assert.strictEqual(entry.materializedId, camps[0].id);
});

test('a concurrent wholesale approvalQueue write cannot swallow the flip', async () => {
  // The competing write lands while proposalDecide is busy materializing — the exact
  // window that stranded cprop_1785542400009_auto.
  let aqReads = 0;
  const c = makeFakeContainer({
    onRead(name, store) {
      if (name !== 'approvalQueue.json') return;
      aqReads++;
      if (aqReads !== 2) return; // fire once, on the mutateState read
      const cur = JSON.parse(store.get(name).content);
      cur.push({ id: 'aq-competitor', type: 'task_escalation', status: 'pending' });
      store.set(name, { content: JSON.stringify(cur), etag: 'etag-competitor' });
    }
  });
  seed(c, 'approvalQueue', [PROPOSAL]);
  seed(c, 'objectives', []);
  seed(c, 'campaigns', []);

  const res = await callApprove(c);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));

  const finalQueue = read(c, 'approvalQueue');
  const entry = finalQueue.find(q => q.id === PROPOSAL.id);

  assert.strictEqual(entry.status, 'approved',
    'THE REGRESSION: proposal must not be left pending after its campaign went live');
  assert.ok(finalQueue.find(q => q.id === 'aq-competitor'),
    'the competing write must also survive — no clobbering in either direction');

  const camps = read(c, 'campaigns');
  assert.strictEqual(camps.length, 1, 'exactly one campaign, not a duplicate from the retry');
  assert.strictEqual(entry.materializedId, camps[0].id);
});

test('re-approving an already-materialized proposal does not create a second campaign', async () => {
  // The self-healing path: if a flip was lost before this fix, re-approving must be safe.
  const c = makeFakeContainer();
  seed(c, 'approvalQueue', [PROPOSAL]);
  seed(c, 'objectives', []);
  seed(c, 'campaigns', [{
    id: 'camp-existing', title: PROPOSAL.name, status: 'active', proposalId: PROPOSAL.id
  }]);

  const res = await callApprove(c);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(read(c, 'campaigns').length, 1, 'must not re-create the campaign');
  assert.strictEqual(read(c, 'approvalQueue').find(q => q.id === PROPOSAL.id).status, 'approved');
});

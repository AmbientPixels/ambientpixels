// Run: node companyHeartbeat/ceo-feedback-intel.test.js
'use strict';
const assert = require('assert');
const { harvestCeoFeedback, candidatesFromActions, candidatesFromQueue, SOURCE } = require('./ceo-feedback-intel');

const NOW = Date.parse('2026-10-06T12:00:00Z');

function fixture() {
  return {
    actions: [
      { id: 'act_1', type: 'social_post.reply', created_by: 'scribe', payload: { text: 'Hey, sounds rough. Our tool can help: https://x' },
        approval: { status: 'revision_requested', decision_note: 'Strip the pitch. The reply must stand on its own.', decided_at: '2026-10-05T10:00:00Z' } },
      { id: 'act_2', type: 'social_post.schedule', created_by: 'echo', payload: { text: 'We shipped a fix' },
        approval: { status: 'rejected', decision_note: 'This fix never happened. Never announce work you cannot point to.' } },
      { id: 'act_3', type: 'social_post.schedule', created_by: 'echo', payload: { text: 'fine post' },
        approval: { status: 'approved', decision_note: 'nice' } },                       // approvals are not corrections
      { id: 'act_4', type: 'social_post.schedule', created_by: 'echo', approval: { status: 'rejected' } }, // no note, nothing to learn
      { id: 'act_5', type: 'social_post.schedule', created_by: 'echo', approval: { status: 'cancelled', decision_note: 'restart' } }
    ],
    approvalQueue: [
      { id: 'cprop_1', type: 'campaign_proposal', proposedBy: 'nova', name: 'AmbientScore Lead Gen', status: 'rejected', rejectionNote: 'Same bet as last week, no new evidence.', rejectedAt: '2026-10-04T00:00:00Z', betKey: 'broadcast_post|ambientscore|bluesky' },
      { id: 'cprop_2', type: 'campaign_proposal', proposedBy: 'nova', name: 'x', status: 'expired', expiryNote: 'restart' },   // expiry is neutral
      { id: 'bsr_1', type: 'bluesky_reply', agentId: 'scribe', text: 'reply text', status: 'rejected', ceoNote: 'They already got the job. Read the whole post.' }
    ]
  };
}

// 1. Candidates: only decisions with a note, attributed to the right agent.
{
  const f = fixture();
  const ca = candidatesFromActions(f.actions);
  assert.deepStrictEqual(ca.map(c => c.sourceId), ['action:act_1', 'action:act_2']);
  assert.strictEqual(ca[0].agentId, 'scribe');
  assert.strictEqual(ca[0].kind, 'reply');
  const cq = candidatesFromQueue(f.approvalQueue);
  assert.deepStrictEqual(cq.map(c => c.sourceId), ['aq:cprop_1', 'aq:bsr_1']);
  assert.strictEqual(cq[0].betKey, 'broadcast_post|ambientscore|bluesky');
  assert.strictEqual(cq[0].kind, 'campaign proposal');
}

// 2. Harvest writes one constraint per correction, permanent, with evidence; idempotent on re-run.
{
  const f = fixture();
  const store = { scribe: [{ id: 'old', type: 'learning', text: 'x', timestamp: '2026-09-01T00:00:00Z' }] };
  const r1 = harvestCeoFeedback({ actions: f.actions, approvalQueue: f.approvalQueue, memoryStore: store, nowMs: NOW });
  assert.strictEqual(r1.written, 4);
  assert.deepStrictEqual(r1.byAgent, { scribe: 2, echo: 1, nova: 1 });
  const s = store.scribe.filter(m => m.source === SOURCE);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].type, 'constraint');
  assert.ok(/CEO sent back my reply "Hey, sounds rough/.test(s[0].text), s[0].text);
  assert.ok(/Strip the pitch/.test(s[0].text));
  assert.strictEqual(s[0].expiresAt, undefined, 'permanent');
  assert.strictEqual(s[0].evidence.sourceId, 'action:act_1');
  assert.strictEqual(s[0].timestamp, '2026-10-05T10:00:00Z', 'dated at the decision, not the harvest');
  const n = store.nova.find(m => m.source === SOURCE);
  assert.strictEqual(n.evidence.betKey, 'broadcast_post|ambientscore|bluesky', 'bet key carried so the proposal gate can find it');
  assert.ok(/CEO rejected my campaign proposal/.test(n.text));

  const r2 = harvestCeoFeedback({ actions: f.actions, approvalQueue: f.approvalQueue, memoryStore: store, nowMs: NOW });
  assert.strictEqual(r2.written, 0, 'idempotent');
  assert.strictEqual(r2.skipped, 4);
  assert.strictEqual(store.scribe.length, 3, 'nothing duplicated');
}

// 3. Per-agent cap per run, text clipped to 300.
{
  const actions = [];
  for (let i = 0; i < 6; i++) actions.push({ id: 'a' + i, type: 'social_post.schedule', created_by: 'echo', payload: { text: 'p'.repeat(200) }, approval: { status: 'rejected', decision_note: 'n'.repeat(400) } });
  const store = {};
  const r = harvestCeoFeedback({ actions: actions, memoryStore: store, nowMs: NOW });
  assert.strictEqual(r.written, 3);
  assert.strictEqual(r.skipped, 3);
  assert.ok(store.echo.every(m => m.text.length <= 300));
}

// 4. Empty input is a no-op.
{
  const store = {};
  const r = harvestCeoFeedback({ memoryStore: store });
  assert.deepStrictEqual(r, { written: 0, byAgent: {}, skipped: 0 });
  assert.deepStrictEqual(store, {});
}

console.log('ceo-feedback-intel.test.js: all assertions passed');

// Run with: node api/companyMeeting/meeting-core.test.js
const assert = require('assert');
const core = require('./meeting-core');

let pass = 0, fail = 0;
const _asyncTests = [];
function testA(name, fn) { _asyncTests.push({ name: name, fn: fn }); }
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// ── classifyBlastRadius ──
test('campaign/objective/product are strategic', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'campaign' }), 'strategic');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'objective' }), 'strategic');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'product_launch' }), 'strategic');
});
test('research_task and internal_doc are internal', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'research_task' }), 'internal');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'internal_doc' }), 'internal');
});
test('execution_task is internal ONLY with a target objective', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'execution_task', targetObjectiveId: 'obj-1' }), 'internal');
  assert.strictEqual(core.classifyBlastRadius({ kind: 'execution_task' }), 'strategic');
});
test('execution_task fleet_task → internal (lane overrides targetObjectiveId check)', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'execution_task', lane: 'fleet_task' }), 'internal');
});
test('execution_task ceo_decision → strategic', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'execution_task', lane: 'ceo_decision' }), 'strategic');
});
test('unknown kind defaults to strategic (fail safe to human review)', () => {
  assert.strictEqual(core.classifyBlastRadius({ kind: 'wat' }), 'strategic');
});

// ── tallyVote ──
const V = (agentId, vote) => ({ agentId, vote });
test('majority approve passes', () => {
  const r = core.tallyVote([V('nova','approve'), V('echo','approve'), V('cipher','reject')]);
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.approve, 2); assert.strictEqual(r.reject, 1);
});
test('majority reject fails', () => {
  const r = core.tallyVote([V('nova','reject'), V('echo','reject'), V('cipher','approve')]);
  assert.strictEqual(r.passed, false);
});
test('abstains are excluded from the base', () => {
  const r = core.tallyVote([V('nova','approve'), V('echo','abstain'), V('cipher','abstain')]);
  assert.strictEqual(r.abstain, 2);
  assert.strictEqual(r.passed, true); // 1 approve > 0 reject
});
test('tie + Nova approve passes via tiebreak', () => {
  const r = core.tallyVote([V('nova','approve'), V('echo','reject')]);
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.tiebreak, true);
});
test('tie + Nova reject fails via tiebreak', () => {
  const r = core.tallyVote([V('nova','reject'), V('echo','approve')]);
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.tiebreak, true);
});
test('tie + Nova abstain fails (conservative default)', () => {
  const r = core.tallyVote([V('nova','abstain'), V('echo','approve'), V('cipher','reject')]);
  assert.strictEqual(r.passed, false);
});

// ── budgetEligible ──
const ALLOC = (over) => ({ systemBudget: 15, systemSpent: over ? 14.9 : 5, systemStatus: over ? 'RED' : 'GREEN' });
test('no cost → always eligible', () => {
  assert.strictEqual(core.budgetEligible({ kind: 'research_task' }, ALLOC(false)).eligible, true);
});
test('cost within remaining → eligible', () => {
  assert.strictEqual(core.budgetEligible({ estimatedCost: 2 }, ALLOC(false)).eligible, true);
});
test('system RED → ineligible', () => {
  const r = core.budgetEligible({ estimatedCost: 0.05 }, ALLOC(true));
  assert.strictEqual(r.eligible, false);
  assert.ok(/RED/.test(r.reason));
});
test('cost exceeds remaining → ineligible', () => {
  const r = core.budgetEligible({ estimatedCost: 99 }, { systemBudget: 15, systemSpent: 5, systemStatus: 'GREEN' });
  assert.strictEqual(r.eligible, false);
});
test('missing allocation → fail-open (eligible)', () => {
  assert.strictEqual(core.budgetEligible({ estimatedCost: 5 }, null).eligible, true);
});

// ── parseItemsFromReply (new contract: profitThesis required; lane for execution_task) ──
test('drops an item with no profitThesis', () => {
  const reply = '{"items":[{"kind":"campaign","title":"Beacon launch"}]}';
  assert.deepStrictEqual(core.parseItemsFromReply(reply, 'echo'), []);
});
test('keeps a strategic item that has a profitThesis', () => {
  const reply = '{"items":[{"kind":"campaign","title":"Beacon launch","profitThesis":"+$X MRR"}]}';
  const items = core.parseItemsFromReply(reply, 'echo');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].proposedBy, 'echo');
});
test('drops a fleet_task with no owner', () => {
  const reply = '{"items":[{"kind":"execution_task","lane":"fleet_task","title":"x","deliverable":"d","profitThesis":"p"}]}';
  assert.deepStrictEqual(core.parseItemsFromReply(reply, 'nova'), []);
});
test('keeps a valid fleet_task with owner + deliverable + thesis', () => {
  const reply = '{"items":[{"kind":"execution_task","lane":"fleet_task","owner":"cipher","title":"Rank products by ROI","deliverable":"memo to nova","profitThesis":"cut the worst burner"}]}';
  const items = core.parseItemsFromReply(reply, 'cipher');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].lane, 'fleet_task');
  assert.strictEqual(items[0].owner, 'cipher');
});
test('drops an execution_task with no valid lane', () => {
  const reply = '{"items":[{"kind":"execution_task","title":"x","profitThesis":"p"}]}';
  assert.deepStrictEqual(core.parseItemsFromReply(reply, 'nova'), []);
});
test('keeps a ceo_decision with a profitThesis (no owner needed)', () => {
  const reply = '{"items":[{"kind":"execution_task","lane":"ceo_decision","title":"Kill or fund AmbientScore","profitThesis":"$0 revenue at 75%"}]}';
  const items = core.parseItemsFromReply(reply, 'nova');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].lane, 'ceo_decision');
});
test('returns [] when no JSON present', () => {
  assert.deepStrictEqual(core.parseItemsFromReply('just talking', 'nova'), []);
});

// ── extractCandidates (dedupe across turns) ──
test('extractCandidates dedupes by normalized title+kind', () => {
  const turns = [
    { agentId: 'echo', items: [{ kind: 'campaign', title: 'Beacon Launch', proposedBy: 'echo' }] },
    { agentId: 'nova', items: [{ kind: 'campaign', title: 'beacon launch', proposedBy: 'nova' }] }
  ];
  const out = core.extractCandidates(turns);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].id); // assigned a stable id
});

// ── prompts ──
const prompts = require('./prompts');
test('agenda prompt names the agent, includes the brief, asks for JSON topics', () => {
  const p = prompts.buildAgendaPrompt('nova', '═══ BUSINESS BRIEF ═══\nMONEY: ...', []);
  assert.ok(/nova/i.test(p));
  assert.ok(/agenda/i.test(p));
  assert.ok(/json/i.test(p));
  assert.ok(/BUSINESS BRIEF/.test(p));      // brief injected
  assert.ok(/revenue|profit|cost|growth/i.test(p)); // profit framing
});
test('discussion prompt includes agenda, brief, memory slice, and the lane contract', () => {
  const p = prompts.buildDiscussionPrompt('echo', [{ topic: 'Grow X' }], 'prior transcript', 'BRIEF HERE', 'MEM HERE');
  assert.ok(/Grow X/.test(p));
  assert.ok(/"items"/.test(p));
  assert.ok(/BRIEF HERE/.test(p));
  assert.ok(/MEM HERE/.test(p));
  assert.ok(/profitThesis/.test(p));        // required field documented
  assert.ok(/fleet_task|ceo_decision/.test(p));
});
test('vote prompt rejects ceremony/no-thesis items', () => {
  const p = prompts.buildVotePrompt('cipher', [{ id: 'cand-1', kind: 'execution_task', title: 'Beacon' }]);
  assert.ok(/Beacon/.test(p));
  assert.ok(/approve/i.test(p) && /reject/i.test(p) && /abstain/i.test(p));
  assert.ok(/profitThesis|ceremony|owner/i.test(p));
});

// ── runAgenticMeeting (mocked model + in-memory storage) ──
const NOW = Date.UTC(2026, 5, 23, 12, 0, 0);
function mockStorage(initial) {
  const s = Object.assign({ tasks: [], approvalQueue: [], agenticMeetings: [], capitalAllocation: { systemBudget: 15, systemSpent: 5, systemStatus: 'GREEN' } }, initial || {});
  return {
    getState: async (k) => s[k],
    setState: async (k, v) => { s[k] = v; },
    // Mirrors companyStorage.mutateState: read → mutate → write, and `undefined`
    // from the mutator means abort without writing.
    mutateState: async (k, fn) => {
      const cur = k in s ? s[k] : null;
      const next = await fn(cur, { attempt: 1, exists: k in s });
      if (next === undefined) return { ok: true, written: false, attempts: 1, value: cur };
      s[k] = next;
      return { ok: true, written: true, attempts: 1, value: next };
    },
    _state: s
  };
}
// Scripted model: agenda convenes; echo proposes a campaign (strategic) + a research task (internal);
// everyone approves; nova closes.
function mockModel(prompt, agentId) {
  if (/Prime Operator opening/.test(prompt)) return Promise.resolve('```json\n{"convene":true,"agenda":[{"topic":"Grow Bluesky","rationale":"flat 30d"}]}\n```');
  if (/Speak briefly/.test(prompt)) {
    if (agentId === 'echo') return Promise.resolve('We should push Bluesky.\n```json\n{"items":[' +
      '{"kind":"campaign","title":"Bluesky Growth Push","rationale":"flat followers","profitThesis":"+50 followers → top-funnel","estimatedCost":2},' +
      '{"kind":"research_task","title":"Bluesky competitor scan","rationale":"need angles","profitThesis":"find a cheaper acquisition channel","estimatedCost":0}]}\n```');
    if (agentId === 'cipher') return Promise.resolve('Money view.\n```json\n{"items":[' +
      '{"kind":"execution_task","lane":"fleet_task","owner":"cipher","title":"Rank products by revenue per dollar","deliverable":"memo to nova ranking 7 products","profitThesis":"cut the biggest burner, save $X/mo"},' +
      '{"kind":"execution_task","lane":"ceo_decision","title":"Kill or fund AmbientScore","profitThesis":"$0 revenue at 75% done — decide"}]}\n```');
    return Promise.resolve('Agreed, no new items from me.');
  }
  if (/voting on the proposed work/.test(prompt)) {
    // Approve EVERY candidate in the slate (the global match), not just the first —
    // both the strategic and the internal item must pass for this e2e to be meaningful.
    const ids = (prompt.match(/"id":"(cand-[^"]+)"/g) || []).map(function (s) { return s.replace(/"id":"|"$/g, ''); });
    const votes = ids.map(function (id) { return '{"id":"' + id + '","vote":"approve","rationale":"good"}'; });
    return Promise.resolve('```json\n{"votes":[' + votes.join(',') + ']}\n```');
  }
  return Promise.resolve('(ok)');
}

testA('runAgenticMeeting routes internal→tasks and strategic→approvalQueue', async () => {
  const storage = mockStorage();
  const rec = await core.runAgenticMeeting({ storage, nowMs: NOW, trigger: 'button', callModel: mockModel, log: function () {} });
  assert.strictEqual(rec.convened, true);
  // Bluesky Growth Push (campaign=strategic) → approvalQueue; cipher ceo_decision → approvalQueue; competitor scan (research=internal) → tasks; cipher fleet_task → tasks
  assert.ok(storage._state.approvalQueue.filter(function (q) { return q.source === 'meeting'; }).length >= 1, 'meeting items should be queued in approvalQueue');
  assert.ok(storage._state.tasks.filter(function (t) { return t.source === 'meeting'; }).length >= 1, 'meeting items should create tasks');
  assert.strictEqual(storage._state.agenticMeetings.length, 1);
  // strategic candidate carries the proposalId of its queued approvalQueue entry
  const strat = rec.candidates.find(function (c) { return c.passed && c.blastRadius === 'strategic'; });
  assert.ok(strat && strat.proposalId, 'strategic candidate should carry proposalId');
  assert.ok(storage._state.approvalQueue.some(function (q) { return q.id === strat.proposalId; }), 'proposalId should match a queued entry');
  // fleet_task → an internal task assigned to its named owner
  const fleetTasks = storage._state.tasks.filter(function (t) { return t.source === 'meeting' && t.assignee === 'cipher'; });
  assert.ok(fleetTasks.length >= 1, 'fleet_task should create a task assigned to cipher');
  // ceo_decision → a decision_request in the approvalQueue
  assert.ok(storage._state.approvalQueue.some(function (q) { return q.type === 'decision_request'; }), 'ceo_decision should queue a decision_request');
  // strategic proposals must carry the profit thesis through to the CEO queue
  const campProp = storage._state.approvalQueue.find(function (q) { return q.type === 'campaign_proposal'; });
  assert.ok(campProp && campProp.profitThesis, 'campaign proposal should carry profitThesis');
});

testA('runAgenticMeeting suppresses a ceo_decision that duplicates a pending decision_request', async () => {
  const storage = mockStorage({ approvalQueue: [
    { id: 'dr-old', type: 'decision_request', status: 'pending', title: 'AmbientScore funding decision', createdAt: new Date(NOW - 86400000).toISOString() }
  ] });
  function dupModel(prompt, agentId) {
    if (/Prime Operator opening/.test(prompt)) return Promise.resolve('```json\n{"convene":true,"agenda":[{"topic":"AmbientScore","rationale":"$0"}]}\n```');
    if (/Speak briefly/.test(prompt)) {
      if (agentId === 'cipher') return Promise.resolve('```json\n{"items":[{"kind":"execution_task","lane":"ceo_decision","title":"AmbientScore funding decision again","profitThesis":"$0 revenue"}]}\n```');
      return Promise.resolve('nothing');
    }
    if (/voting on the proposed work/.test(prompt)) {
      const ids = (prompt.match(/"id":"(cand-[^"]+)"/g) || []).map(function (s) { return s.replace(/"id":"|"$/g, ''); });
      return Promise.resolve('```json\n{"votes":[' + ids.map(function (id) { return '{"id":"' + id + '","vote":"approve","rationale":"y"}'; }).join(',') + ']}\n```');
    }
    return Promise.resolve('(ok)');
  }
  const rec = await core.runAgenticMeeting({ storage, nowMs: NOW, trigger: 'button', callModel: dupModel, log: function () {} });
  const newDRs = storage._state.approvalQueue.filter(function (q) { return q.type === 'decision_request' && q.id !== 'dr-old'; });
  assert.strictEqual(newDRs.length, 0, 'duplicate decision should be suppressed');
  assert.ok(Array.isArray(rec.suppressedDuplicates) && rec.suppressedDuplicates.length >= 1, 'suppression recorded');
});

// ── detectMeetingSignals ──
const NOW2 = Date.UTC(2026, 5, 23, 12, 0, 0);
test('coverage-gap fires when <3 active objectives', () => {
  const s = core.detectMeetingSignals({ activeObjectiveCount: 1, finishedRecently: false, researchSignalCount: 0 }, NOW2, []);
  assert.ok(s.some(function (x) { return x.type === 'coverage-gap'; }));
});
test('research-opportunity fires when unactioned research signals exist', () => {
  const s = core.detectMeetingSignals({ activeObjectiveCount: 5, finishedRecently: false, researchSignalCount: 2 }, NOW2, []);
  assert.ok(s.some(function (x) { return x.type === 'research-opportunity'; }));
});
test('no signals on a healthy, covered state', () => {
  const s = core.detectMeetingSignals({ activeObjectiveCount: 4, finishedRecently: false, researchSignalCount: 0 }, NOW2, []);
  assert.strictEqual(s.length, 0);
});
test('a signal is deduped if a same-type meeting convened in the last 7 days', () => {
  const recent = [{ convened: true, trigger: 'signal:coverage-gap', createdAt: new Date(NOW2 - 2 * 86400000).toISOString() }];
  const s = core.detectMeetingSignals({ activeObjectiveCount: 1, finishedRecently: false, researchSignalCount: 0 }, NOW2, recent);
  assert.ok(!s.some(function (x) { return x.type === 'coverage-gap'; }));
});

(async () => {
  for (const t of _asyncTests) {
    try { await t.fn(); pass++; console.log('  PASS ', t.name); }
    catch (e) { fail++; console.log('  FAIL ', t.name, '\n        ', e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();

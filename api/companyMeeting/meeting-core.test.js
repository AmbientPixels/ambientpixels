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

// ── parseItemsFromReply ──
test('parses a fenced JSON items array from reply text', () => {
  const reply = 'I propose two things.\n```json\n{"items":[{"kind":"campaign","title":"Beacon launch"}]}\n```\nThanks.';
  const items = core.parseItemsFromReply(reply, 'echo');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].kind, 'campaign');
  assert.strictEqual(items[0].proposedBy, 'echo');
});
test('returns [] when no JSON present', () => {
  assert.deepStrictEqual(core.parseItemsFromReply('just talking, no proposal', 'nova'), []);
});
test('caps items per agent at 2', () => {
  const reply = '{"items":[{"kind":"campaign","title":"a"},{"kind":"campaign","title":"b"},{"kind":"campaign","title":"c"}]}';
  assert.strictEqual(core.parseItemsFromReply(reply, 'echo').length, 2);
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
test('agenda prompt names the agent and asks for JSON topics', () => {
  const p = prompts.buildAgendaPrompt('nova', { activeObjectives: [], activeCampaigns: [], recentlyFinished: [], decliningProducts: [], researchSignals: [] });
  assert.ok(/nova/i.test(p));
  assert.ok(/agenda/i.test(p));
  assert.ok(/json/i.test(p));
});
test('discussion prompt includes the agenda + the items JSON contract', () => {
  const p = prompts.buildDiscussionPrompt('echo', [{ topic: 'Grow X' }], 'prior transcript here');
  assert.ok(/Grow X/.test(p));
  assert.ok(/"items"/.test(p));
});
test('vote prompt lists the candidates and the approve/reject/abstain contract', () => {
  const p = prompts.buildVotePrompt('cipher', [{ id: 'cand-1', kind: 'campaign', title: 'Beacon' }]);
  assert.ok(/Beacon/.test(p));
  assert.ok(/approve/i.test(p) && /reject/i.test(p) && /abstain/i.test(p));
});

// ── runAgenticMeeting (mocked model + in-memory storage) ──
const NOW = Date.UTC(2026, 5, 23, 12, 0, 0);
function mockStorage(initial) {
  const s = Object.assign({ tasks: [], approvalQueue: [], agenticMeetings: [], capitalAllocation: { systemBudget: 15, systemSpent: 5, systemStatus: 'GREEN' } }, initial || {});
  return { getState: async (k) => s[k], setState: async (k, v) => { s[k] = v; }, _state: s };
}
// Scripted model: agenda convenes; echo proposes a campaign (strategic) + a research task (internal);
// everyone approves; nova closes.
function mockModel(prompt, agentId) {
  if (/Prime Operator opening/.test(prompt)) return Promise.resolve('```json\n{"convene":true,"agenda":[{"topic":"Grow Bluesky","rationale":"flat 30d"}]}\n```');
  if (/Speak briefly on the agenda/.test(prompt)) {
    if (agentId === 'echo') return Promise.resolve('We should push Bluesky.\n```json\n{"items":[{"kind":"campaign","title":"Bluesky Growth Push","rationale":"flat followers","estimatedCost":2},{"kind":"research_task","title":"Bluesky competitor scan","rationale":"need angles","estimatedCost":0}]}\n```');
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
  // Bluesky Growth Push (campaign=strategic) → approvalQueue; competitor scan (research=internal) → tasks
  assert.strictEqual(storage._state.approvalQueue.filter(function (q) { return q.source === 'meeting'; }).length, 1);
  assert.strictEqual(storage._state.tasks.filter(function (t) { return t.source === 'meeting'; }).length, 1);
  assert.strictEqual(storage._state.agenticMeetings.length, 1);
});

(async () => {
  for (const t of _asyncTests) {
    try { await t.fn(); pass++; console.log('  PASS ', t.name); }
    catch (e) { fail++; console.log('  FAIL ', t.name, '\n        ', e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();

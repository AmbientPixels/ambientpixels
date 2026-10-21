// Run with: node api/_lib/vale/teamContext.test.js
const assert = require('assert');
const { loadTeamSummary, formatTeamContext } = require('./teamContext');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const NOW = Date.parse('2026-10-20T20:00:00Z');
const H = 3600000;
const iso = (ms) => new Date(ms).toISOString();

const STATE = {
  tasks: [
    { id: 't1', title: 'Draft blog post for Monthly Journal', assignee: 'scribe', status: 'todo', campaign_id: 'camp-monthly-journal', createdAt: iso(NOW - 30 * H) },
    { id: 't2', title: 'Write social copy', assignee: 'scribe', status: 'done', completedAt: iso(NOW - 2 * H), createdAt: iso(NOW - 40 * H) },
    { id: 't3', title: 'Pick a time for the board review', assignee: 'ceo', status: 'todo', createdAt: iso(NOW - 50 * H) }
  ],
  campaigns: [{ id: 'camp-monthly-journal', title: 'Monthly Journal', status: 'active', cadence: 'monthly', frequency: 1, startDate: '2026-10-15', endDate: '2027-10-15' }],
  objectives: [{ id: 'obj', status: 'active', title: 'Build in Public', northStarMetric: 'qualified_uses_week', measuredValue: 4, criteria: { target: 10, by: '2026-11-05' } }],
  approvalQueue: [{ id: 'aq1', type: 'campaign_proposal', name: 'Studio notes on LinkedIn', proposedBy: 'nova', status: 'pending', createdAt: iso(NOW - 20 * H) }],
  heartbeatRuns: [{ startedAt: iso(NOW - 2 * H), status: 'ok' }],
  governanceLog: [],
  actions: [],
  geminiUsage: [],
  agentRegistry: { agents: [{ id: 'scribe', name: 'Scribe', status: 'active' }, { id: 'pixel', name: 'Pixel', status: 'dormant' }] }
};

function fakeStorage(state, failing) {
  return { getStateWithMeta: async (k) => (failing || []).indexOf(k) !== -1 ? { failed: true } : { value: state[k] === undefined ? null : state[k] } };
}

(async () => {
  await test('loads the same summary HQ shows and formats the waiting items', async () => {
    const s = await loadTeamSummary(fakeStorage(STATE), NOW);
    assert.ok(s && s.blocks, 'summary built');
    const txt = formatTeamContext(s);
    assert.ok(txt.indexOf('Waiting on Chad: 2, oldest first:') !== -1, txt);
    assert.ok(txt.indexOf('"Pick a time for the board review"') !== -1, 'CEO task listed');
    assert.ok(txt.indexOf('"Studio notes on LinkedIn" from Nova') !== -1, 'proposal listed with its proposer');
  });

  await test('goal, campaign pace and the fleet read as plain lines', async () => {
    const txt = formatTeamContext(await loadTeamSummary(fakeStorage(STATE), NOW));
    assert.ok(/Goal: Build in Public .*: 4 of 10 by 2026-11-05\./.test(txt), txt);
    assert.ok(txt.indexOf('Monthly Journal: 0 of 1 this month (starting), 1 open.') !== -1, txt);
    assert.ok(txt.indexOf('Scribe: 1 waiting') !== -1, txt);
    assert.ok(txt.indexOf('Switched off: Pixel.') !== -1, txt);
    assert.ok(txt.indexOf('Scribe finished: Write social copy') !== -1, 'last 24h shows the finished task');
  });

  await test('an unreadable source says not measured, never zero', async () => {
    const txt = formatTeamContext(await loadTeamSummary(fakeStorage(STATE, ['approvalQueue', 'geminiUsage']), NOW));
    assert.ok(txt.indexOf('Waiting on Chad: not measured') !== -1, txt);
    assert.ok(txt.indexOf('model spend not measured') !== -1, txt);
    assert.ok(txt.indexOf('Waiting on Chad: 0') === -1, 'never a zero for an unread source');
  });

  await test('no task board means no summary, and the chat is told not to invent', async () => {
    const s = await loadTeamSummary(fakeStorage(STATE, ['tasks']), NOW);
    assert.strictEqual(s, null);
    assert.ok(formatTeamContext(s).indexOf('never invent numbers') !== -1);
  });

  await test('always ends with the use-only-these-facts rule', async () => {
    const txt = formatTeamContext(await loadTeamSummary(fakeStorage(STATE), NOW));
    assert.ok(/Use only these team facts\./.test(txt));
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

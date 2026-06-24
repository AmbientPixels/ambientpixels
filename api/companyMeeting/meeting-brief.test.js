// Run with: node api/companyMeeting/meeting-brief.test.js
const assert = require('assert');
const brief = require('./meeting-brief');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const WS = {
  generatedAt: '2026-06-23T12:00:00.000Z',
  company: { runwayDays: 47 },
  finance: { monthlyActual: 9.2, monthlyBudget: 15, monthlyRevenue: 0, mrr: 0, payingCustomers: 0, netBurn: 9.2, status: 'YELLOW' },
  products: [
    { name: 'AmbientScore', status: 'active', signal: 'declining' },
    { name: 'Blindspot', status: 'active', signal: null }
  ],
  objectives: [{ title: 'Run Loud', progress: 40 }],
  campaigns: [{ title: 'Build in Public v3', pace: 'BEHIND', progress: 30 }]
};
const OUT = { totals: { snapshots: 12, complete: 8, blogViews: 140, formSubmits: 3 } };

test('buildSharedBrief includes the money line with revenue, spend, runway', () => {
  const b = brief.buildSharedBrief(WS, OUT);
  assert.ok(/MONEY/.test(b));
  assert.ok(/\$9\.2/.test(b));        // spend
  assert.ok(/47d/.test(b));           // runway
});
test('buildSharedBrief labels declining products as burning', () => {
  const b = brief.buildSharedBrief(WS, OUT);
  assert.ok(/AmbientScore/.test(b));
  assert.ok(/declining/i.test(b));
});
test('buildSharedBrief includes the funnel line from outcomeDigest', () => {
  const b = brief.buildSharedBrief(WS, OUT);
  assert.ok(/FUNNEL/.test(b));
  assert.ok(/140/.test(b));           // blog views
});
test('buildSharedBrief fails open on a null worldState', () => {
  const b = brief.buildSharedBrief(null, null);
  assert.strictEqual(typeof b, 'string');
  assert.ok(b.length > 0);
});
test('buildSharedBrief stays under the 2500-char cap', () => {
  const b = brief.buildSharedBrief(WS, OUT);
  assert.ok(b.length <= 2500, 'len=' + b.length);
});

// ── buildAgentMemorySlice ──
const MEM = {
  agentSeedMemories: { _global: 'Ship money, not ceremony.', cipher: 'Watch revenue/$ spend.' },
  agentMemories: {
    cipher: [{ type: 'reflection', content: 'AmbientScore is our only paywall.' }],
    scout: [{ type: 'note', content: 'old note' }]
  },
  researchIntel: [{ title: 'Competitor X pricing', summary: 'They charge $49/mo.' }],
  weeklyReports: { cipher: [{ summary: 'Spend flat, revenue $0.' }] }
};

test('cipher slice includes finance signal + weekly report + seed', () => {
  const s = brief.buildAgentMemorySlice('cipher', MEM);
  assert.ok(/revenue/i.test(s));
  assert.ok(/AmbientScore/.test(s));      // own reflection
});
test('scout slice includes research intel (L7)', () => {
  const s = brief.buildAgentMemorySlice('scout', MEM);
  assert.ok(/Competitor X/.test(s));
});
test('an agent with no memory gets an empty slice', () => {
  const s = brief.buildAgentMemorySlice('forge', { agentMemories: {}, researchIntel: [], weeklyReports: {}, agentSeedMemories: {} });
  assert.strictEqual(s, '');
});
test('memory slice stays under 1500 chars', () => {
  const s = brief.buildAgentMemorySlice('cipher', MEM);
  assert.ok(s.length <= 1500, 'len=' + s.length);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);

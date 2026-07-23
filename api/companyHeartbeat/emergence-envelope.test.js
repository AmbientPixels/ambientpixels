// emergence-envelope.test.js — envelope-health substrate sentinel (2026-07-23)
// Run: node api/companyHeartbeat/emergence-envelope.test.js
const assert = require('node:assert');
const { _computeEnvelopeHealth } = require('./emergence-intel');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

const NOW = Date.parse('2026-07-23T12:00:00Z');
// Build a run where each agent has {at, ex, lat}
function run(agents, hoursAgo) {
  const perAgent = {};
  Object.entries(agents).forEach(([a, v]) => {
    perAgent[a] = { actionsAttempted: v.at, actionsExecuted: v.ex, avgLatencyMs: v.lat };
  });
  return { finishedAt: new Date(NOW - hoursAgo * 3600e3).toISOString(), perAgent };
}
const HEALTHY = { at: 3, ex: 2, lat: 12000 };
const MUTED = { at: 0, ex: 0, lat: 16000 };   // real LLM call, empty envelope (the schema-lockout signature)
const FASTFAIL = { at: 0, ex: 0, lat: 300 };  // failed call — throughput-collapse's territory, NOT ours

function runs12(novaState) {
  const out = [];
  for (let i = 0; i < 12; i++) out.push(run({ nova: novaState, echo: HEALTHY, scribe: HEALTHY }, i));
  return out;
}
function junkLogs(count, hoursAgo) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({
    timestamp: new Date(NOW - (hoursAgo || 1) * 3600e3).toISOString(),
    summary: 'Nova: [unknown-action-type] (missing type): {}'
  });
  return out;
}

test('one persistently muted agent (real latency, zero attempted) → YELLOW naming the agent', () => {
  const r = _computeEnvelopeHealth(runs12(MUTED), [], NOW);
  const sig = r.signals.find(s => s.signalType === 'envelope-health');
  assert.ok(sig, 'signal emitted');
  assert.strictEqual(sig.level, 'YELLOW');
  assert.ok(JSON.stringify(sig.evidence).includes('nova'));
});

test('three muted agents → RED', () => {
  const rs = [];
  for (let i = 0; i < 12; i++) rs.push(run({ nova: MUTED, cipher: MUTED, forge: MUTED, echo: HEALTHY }, i));
  const r = _computeEnvelopeHealth(rs, [], NOW);
  const sig = r.signals.find(s => s.signalType === 'envelope-health' && s.subject === 'muted-agents');
  assert.strictEqual(sig.level, 'RED');
});

test('fast-fail zeros are NOT counted as muted (throughput-collapse owns those)', () => {
  const r = _computeEnvelopeHealth(runs12(FASTFAIL), [], NOW);
  assert.strictEqual(r.signals.filter(s => s.subject === 'muted-agents').length, 0);
});

test('healthy fleet → no signals', () => {
  const r = _computeEnvelopeHealth(runs12(HEALTHY), [], NOW);
  assert.strictEqual(r.signals.length, 0);
});

test('junk envelope entries in logs: 25/24h → YELLOW, 150/24h → RED, old entries ignored', () => {
  const y = _computeEnvelopeHealth(runs12(HEALTHY), junkLogs(25), NOW);
  const ys = y.signals.find(s => s.subject === 'junk-envelopes');
  assert.strictEqual(ys && ys.level, 'YELLOW');
  const r = _computeEnvelopeHealth(runs12(HEALTHY), junkLogs(150), NOW);
  const rs2 = r.signals.find(s => s.subject === 'junk-envelopes');
  assert.strictEqual(rs2 && rs2.level, 'RED');
  const old = _computeEnvelopeHealth(runs12(HEALTHY), junkLogs(150, 30), NOW); // 30h ago — outside 24h
  assert.strictEqual(old.signals.filter(s => s.subject === 'junk-envelopes').length, 0);
});

test('too few runs → no muted-agent verdict (insufficient data)', () => {
  const r = _computeEnvelopeHealth(runs12(MUTED).slice(0, 3), [], NOW);
  assert.strictEqual(r.signals.filter(s => s.subject === 'muted-agents').length, 0);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

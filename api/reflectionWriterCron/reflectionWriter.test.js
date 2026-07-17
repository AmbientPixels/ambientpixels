// Run with: node api/reflectionWriterCron/reflectionWriter.test.js
const assert = require('assert');
const R = require('./reflectionWriter');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const NOW = Date.UTC(2026, 6, 17, 1, 0, 0);
const HOUR = 3600000;

test('selectOverdueAgents returns only reflectionOverdue===true', () => {
  const digest = { perAgent: {
    nova:   { reflectionOverdue: true },
    cipher: { reflectionOverdue: false },
    echo:   { reflectionOverdue: true }
  } };
  const out = R.selectOverdueAgents(digest).map(o => o.agentId).sort();
  assert.deepStrictEqual(out, ['echo', 'nova']);
});

test('selectOverdueAgents is safe on empty/missing digest', () => {
  assert.deepStrictEqual(R.selectOverdueAgents(null), []);
  assert.deepStrictEqual(R.selectOverdueAgents({}), []);
});

test('hasRecentReflection true when a reflection is within skip window', () => {
  const list = [{ type: 'reflection', timestamp: new Date(NOW - 2 * HOUR).toISOString() }];
  assert.strictEqual(R.hasRecentReflection(list, NOW, 24), true);
});

test('hasRecentReflection false when the only reflection is older than window', () => {
  const list = [{ type: 'reflection', timestamp: new Date(NOW - 48 * HOUR).toISOString() }];
  assert.strictEqual(R.hasRecentReflection(list, NOW, 24), false);
});

test('hasRecentReflection ignores non-reflection types', () => {
  const list = [{ type: 'feedback', timestamp: new Date(NOW - 1 * HOUR).toISOString() }];
  assert.strictEqual(R.hasRecentReflection(list, NOW, 24), false);
});

const SAMPLE = {
  coreQuestion: 'Is my research producing intel other agents cite?',
  decisionPatterns: [{ decisionType: 'quality-gate-rewrite', total: 4, improved: 3, tied: 0, regressed: 1, pendingOutcome: 0 }],
  strategyFatigue: [{ signal: 'hookType:howto on x', attempts: 6, vsAgentMedian: -40 }],
  roleAdherence: { drift: 'under-producing' },
  repeatedFailures: [{ title: 'Draft competitor teardown', attempts: 3, status: 'in-progress' }]
};

test('buildReflectionPrompt embeds core question + a decision pattern + instruction', () => {
  const p = R.buildReflectionPrompt('scout', SAMPLE);
  assert.ok(p.indexOf('scout') !== -1);
  assert.ok(p.indexOf('Is my research producing intel') !== -1);
  assert.ok(p.indexOf('quality-gate-rewrite') !== -1);
  assert.ok(p.toLowerCase().indexOf('what you will change') !== -1);
});

test('buildTemplateFallback is non-empty and references drift + core question', () => {
  const t = R.buildTemplateFallback('scout', SAMPLE);
  assert.ok(t.length > 40);
  assert.ok(t.indexOf('under-producing') !== -1);
  assert.ok(t.indexOf('Is my research producing intel') !== -1);
});

test('buildTemplateFallback handles an empty digest slice without throwing', () => {
  const t = R.buildTemplateFallback('nova', {});
  assert.ok(typeof t === 'string' && t.length > 0);
});

test('makeReflectionMemory sets type/source/TTL and caps text at 1000', () => {
  const long = 'y'.repeat(1500);
  const m = R.makeReflectionMemory({ text: long, now: NOW, model: 'gemini-pro' });
  assert.strictEqual(m.type, 'reflection');
  assert.strictEqual(m.source, 'auto:reflection');
  assert.strictEqual(m.text.length, 1000);
  assert.strictEqual(m.timestamp, new Date(NOW).toISOString());
  assert.strictEqual(new Date(m.expiresAt).getTime(), NOW + 30 * 86400000);
  assert.strictEqual(m.evidence.basis, 'digest');
  assert.strictEqual(m.evidence.model, 'gemini-pro');
  assert.ok(String(m.id).indexOf('mem-refl-') === 0);
});

test('capMemories keeps only the last MAX entries', () => {
  const list = [];
  for (let i = 0; i < 55; i++) list.push({ i: i });
  const capped = R.capMemories(list, 50);
  assert.strictEqual(capped.length, 50);
  assert.strictEqual(capped[0].i, 5);
  assert.strictEqual(capped[49].i, 54);
});

test('capMemories leaves a short list untouched', () => {
  const list = [{ i: 1 }, { i: 2 }];
  assert.strictEqual(R.capMemories(list, 50).length, 2);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);

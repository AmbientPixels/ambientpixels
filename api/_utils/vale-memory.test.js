// Run with: node api/_utils/vale-memory.test.js
const assert = require('assert');
const m = require('./vale-memory');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const NOW = Date.UTC(2026, 6, 3, 12, 0, 0);
const DAY = 86400000;

test('makeMemory sets TTL by type and caps text at 300', () => {
  const long = 'x'.repeat(400);
  const pref = m.makeMemory({ type: 'preference', text: long, now: NOW });
  assert.strictEqual(pref.type, 'preference');
  assert.strictEqual(pref.text.length, 300);
  assert.strictEqual(pref.expiresAt, null); // preference never expires
  const ctx = m.makeMemory({ type: 'context', text: 'hi', now: NOW });
  assert.strictEqual(new Date(ctx.expiresAt).getTime(), NOW + 14 * DAY);
});

test('unknown type falls back to context', () => {
  const r = m.makeMemory({ type: 'wat', text: 'hi', now: NOW });
  assert.strictEqual(r.type, 'context');
});

test('addMemory dedups near-identical same-type text', () => {
  const a = m.makeMemory({ type: 'preference', text: 'CEO prefers plain-English briefs.', now: NOW });
  const b = m.makeMemory({ type: 'preference', text: 'CEO prefers plain english briefs!!!', now: NOW + 1000 });
  let r = m.addMemory([], a);
  assert.strictEqual(r.added, true);
  r = m.addMemory(r.list, b);
  assert.strictEqual(r.added, false);
  assert.strictEqual(r.deduped, true);
  assert.strictEqual(r.list.length, 1);
});

test('addMemory FIFO cap evicts oldest NON-permanent, protects ceo-correction', () => {
  let list = [];
  const perm = m.makeMemory({ type: 'preference', text: 'PERMANENT rule', source: 'auto:ceo-correction', now: NOW });
  list = m.addMemory(list, perm, { max: 3 }).list;
  for (let i = 0; i < 5; i++) {
    const rec = m.makeMemory({ type: 'context', text: 'note ' + i, now: NOW + i * 1000 });
    list = m.addMemory(list, rec, { max: 3 }).list;
  }
  assert.strictEqual(list.length, 3);
  assert.ok(list.some(x => x.source === 'auto:ceo-correction'), 'permanent survives eviction');
});

test('pruneMemories drops expired but keeps permanent + non-expiring', () => {
  const expired = m.makeMemory({ type: 'context', text: 'old', now: NOW - 20 * DAY });
  const perm = m.makeMemory({ type: 'context', text: 'kept', source: 'auto:ceo-correction', now: NOW - 20 * DAY });
  const pref = m.makeMemory({ type: 'preference', text: 'forever', now: NOW - 20 * DAY });
  const kept = m.pruneMemories([expired, perm, pref], NOW);
  assert.strictEqual(kept.length, 2);
  assert.ok(!kept.some(x => x.text === 'old'));
});

test('formatMemoryBlocks emits corrections, seed, and open actions', () => {
  const seed = [{ topic: 'Role', text: 'Chad is the CEO.' }];
  const mems = [
    m.makeMemory({ type: 'preference', text: 'No em dashes.', source: 'auto:ceo-correction', now: NOW }),
    m.makeMemory({ type: 'context', text: 'Working on AmbientScore launch.', now: NOW })
  ];
  const actionList = [{ id: 'a1', title: 'Submit to Product Hunt', deadline: '2026-07-07', status: 'open' }];
  const out = m.formatMemoryBlocks({ seed, memories: mems, actionList });
  assert.ok(out.includes('Chad is the CEO'));
  assert.ok(out.includes('WHAT THE CEO HAS TOLD ME'));
  assert.ok(out.includes('No em dashes'));
  assert.ok(out.includes('Product Hunt'));
});

test('pushConversation caps ring buffer', () => {
  let conv = [];
  for (let i = 0; i < 50; i++) conv = m.pushConversation(conv, { role: 'user', text: 'm' + i }, 40);
  assert.strictEqual(conv.length, 40);
  assert.strictEqual(conv[0].text, 'm10');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// Run with: node api/_utils/vale-actions.test.js
const assert = require('assert');
const a = require('./vale-actions');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const NOW = Date.UTC(2026, 6, 3, 12, 0, 0);

test('addAction creates an open item with id + fields', () => {
  const list = a.addAction([], { title: 'Submit to Product Hunt', deadline: '2026-07-07', source: 'ceo' }, NOW);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, 'Submit to Product Hunt');
  assert.strictEqual(list[0].status, 'open');
  assert.ok(list[0].id.startsWith('act_'));
});

test('completeAction flips status only for the matching id', () => {
  let list = a.addAction([], { title: 'One' }, NOW);
  list = a.addAction(list, { title: 'Two' }, NOW + 1);
  const id = list[0].id;
  list = a.completeAction(list, id);
  assert.strictEqual(list.find(x => x.id === id).status, 'done');
  assert.strictEqual(list.find(x => x.id !== id).status, 'open');
});

test('updateAction patches only allowed fields', () => {
  let list = a.addAction([], { title: 'One' }, NOW);
  const id = list[0].id;
  list = a.updateAction(list, id, { title: 'Renamed', status: 'done', hacker: 'x' });
  const item = list.find(x => x.id === id);
  assert.strictEqual(item.title, 'Renamed');
  assert.strictEqual(item.status, 'done');
  assert.strictEqual(item.hacker, undefined);
});

test('removeAction drops the matching id', () => {
  let list = a.addAction([], { title: 'One' }, NOW);
  const id = list[0].id;
  list = a.removeAction(list, id);
  assert.strictEqual(list.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

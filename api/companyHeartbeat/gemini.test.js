// Run with: node api/companyHeartbeat/gemini.test.js
const assert = require('assert');
const gemini = require('./gemini');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

test('_isClaudeModel recognizes the claude model keys', () => {
  assert.strictEqual(gemini._isClaudeModel('claude'), true);
  assert.strictEqual(gemini._isClaudeModel('claude-sonnet'), true);
  assert.strictEqual(gemini._isClaudeModel('claude-haiku'), true);
});
test('_isClaudeModel rejects gemini and unknowns', () => {
  assert.strictEqual(gemini._isClaudeModel('gemini'), false);
  assert.strictEqual(gemini._isClaudeModel('wat'), false);
  assert.strictEqual(gemini._isClaudeModel(''), false);
});
test('callWithModel is exported as a function', () => {
  assert.strictEqual(typeof gemini.callWithModel, 'function');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);

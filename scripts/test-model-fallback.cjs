'use strict';
const assert = require('assert');

// ── helpers.currentCycleId ──
const h = require('../api/companyHeartbeat/helpers');
assert.strictEqual(typeof h.currentCycleId, 'function', 'currentCycleId should be exported');
assert.strictEqual(h.currentCycleId(), null, 'no active run → null');
h.beginRunLogging('cyc-abc');
assert.strictEqual(h.currentCycleId(), 'cyc-abc', 'active run → its cycleId');
h.flushRunLog();

console.log('OK: helpers.currentCycleId');

// ── model-registry ──
const R = require('../api/companyHeartbeat/model-registry');

// MODELS map has the new keys
assert.strictEqual(R.MODELS['gemini-pro'], 'gemini-2.5-pro');
assert.strictEqual(R.MODELS['gemini-flash'], 'gemini-2.5-flash');
assert.strictEqual(R.MODELS['gemini'], 'gemini-2.5-flash');
assert.strictEqual(R.MODELS['claude-sonnet'], 'claude-sonnet-4-6');

// providerOf routes by resolved model id prefix
assert.strictEqual(R.providerOf('gemini-pro'), 'gemini');
assert.strictEqual(R.providerOf('claude-haiku'), 'claude');
assert.strictEqual(R.providerOf('claude'), 'claude');
assert.strictEqual(R.providerOf('nonsense'), 'gemini', 'unknown key defaults to gemini');

// buildChain: deduped BY RESOLVED MODEL ID, order preserved
assert.deepStrictEqual(R.buildChain('gemini-pro'), ['gemini-pro', 'gemini-flash', 'claude-sonnet']);
assert.deepStrictEqual(R.buildChain('claude-sonnet'), ['claude-sonnet', 'gemini-flash']);
assert.deepStrictEqual(R.buildChain('claude-haiku'), ['claude-haiku', 'gemini-flash', 'claude-sonnet']);
// 'gemini' resolves to the same id as 'gemini-flash' → must NOT double-attempt flash
assert.deepStrictEqual(R.buildChain('gemini'), ['gemini', 'claude-sonnet']);

console.log('OK: model-registry');

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

'use strict';
const assert = require('assert');
const { decideAlertAction } = require('../api/_utils/fleetAlerts');

const RED = { level: 'RED', signalType: 'throughput-collapse' };
const NOW = 1000000000000;
const HOUR = 3600000;

// healthy → healthy: nothing
assert.deepStrictEqual(decideAlertAction(null, { collapsed: false }, NOW), { action: 'none', collapsed: false });

// healthy → collapsed: fire collapse alert (edge)
assert.deepStrictEqual(decideAlertAction(RED, { collapsed: false }, NOW), { action: 'alert-collapse', collapsed: true });

// collapsed → collapsed within cooldown: stay quiet (no spam)
assert.deepStrictEqual(
  decideAlertAction(RED, { collapsed: true, lastAlertAt: new Date(NOW - HOUR).toISOString() }, NOW),
  { action: 'none', collapsed: true });

// collapsed → collapsed past 6h cooldown: remind
assert.deepStrictEqual(
  decideAlertAction(RED, { collapsed: true, lastAlertAt: new Date(NOW - 7 * HOUR).toISOString() }, NOW),
  { action: 'remind', collapsed: true });

// collapsed → healthy: recovery alert (edge)
assert.deepStrictEqual(decideAlertAction(null, { collapsed: true, lastAlertAt: new Date(NOW - HOUR).toISOString() }, NOW),
  { action: 'alert-recover', collapsed: false });

// YELLOW (not RED) is NOT treated as collapse — only RED fires
assert.deepStrictEqual(decideAlertAction({ level: 'YELLOW', signalType: 'throughput-collapse' }, { collapsed: false }, NOW),
  { action: 'none', collapsed: false });

// empty prev state, healthy: none
assert.deepStrictEqual(decideAlertAction(null, {}, NOW), { action: 'none', collapsed: false });

console.log('OK: decideAlertAction transitions (7 cases)');
console.log('\nALL PASS');

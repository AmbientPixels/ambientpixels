// Regression test for the finding-severity sort in scorer.js.
// Guards the 0-falsy bug: `SEVERITY_RANK.critical` is 0, and `0 || fallback`
// wrongly demoted criticals, hiding them out of the top-3 teaser.
const assert = require('assert');
const { sortFindingsBySeverity } = require('../api/_lib/ambientScore/scorer');

const input = [
  { severity: 'minor', finding: 'm1' },
  { severity: 'important', finding: 'i1' },
  { severity: 'critical', finding: 'c1' },
  { severity: 'important', finding: 'i2' },
  { severity: 'critical', finding: 'c2' },
  { severity: undefined, finding: 'u1' },
];

const out = sortFindingsBySeverity(input);

// Criticals must lead (the bug demoted them to the bottom).
assert.strictEqual(out[0].severity, 'critical', 'first finding must be critical');
assert.strictEqual(out[1].severity, 'critical', 'second finding must be critical');
assert.strictEqual(out[2].severity, 'important', 'then important');
assert.strictEqual(out[3].severity, 'important', 'then important');

// Stable within a severity: c1 before c2.
assert.strictEqual(out[0].finding, 'c1');
assert.strictEqual(out[1].finding, 'c2');

// The top-3 teaser must lead with the critical findings, not the important ones.
const teaser = out.slice(0, 3).map((f) => f.severity);
assert.deepStrictEqual(teaser, ['critical', 'critical', 'important']);

// Unknown severity is treated as least severe (falls after minor is not required,
// but it must never outrank a real severity).
assert.ok(out.indexOf(input.find((f) => f.finding === 'u1')) >= 4, 'unknown severity ranks last');

// Must not mutate the caller's array.
assert.strictEqual(input[0].severity, 'minor', 'input array must not be reordered');

console.log('scorer severity sort: all assertions passed');

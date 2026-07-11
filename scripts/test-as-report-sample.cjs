const assert = require('assert');
const { SAMPLE_REPORT_IDS, isSample, isFullyViewable, buildFullBody } = require('../api/as-report/sampleReports');

// The allowlist must contain at least one real sample id.
assert.ok(SAMPLE_REPORT_IDS.size >= 1, 'expected at least one sample id');
const sampleId = [...SAMPLE_REPORT_IDS][0];

// Paid/unlocked reports are viewable regardless of id.
assert.strictEqual(isFullyViewable({ unlocked: true }, 'ccr_notasample'), true);
// Locked, non-sample reports are NOT viewable (teaser).
assert.strictEqual(isFullyViewable({ unlocked: false }, 'ccr_notasample'), false);
// Locked reports whose id is on the allowlist ARE viewable (the sample).
assert.strictEqual(isFullyViewable({ unlocked: false }, sampleId), true);
// isSample reflects the allowlist.
assert.strictEqual(isSample(sampleId), true);
assert.strictEqual(isSample('ccr_notasample'), false);

// buildFullBody must NOT mutate the stored report object.
const stored = { unlocked: false, score: 75 };
const out = buildFullBody(stored, sampleId);
assert.notStrictEqual(out, stored, 'sample body must be a copy, not the same object');
assert.strictEqual(out.unlocked, true);
assert.strictEqual(out.isSample, true);
assert.strictEqual(stored.unlocked, false, 'original report must not be mutated');
assert.strictEqual('isSample' in stored, false, 'original report must not gain isSample');
// Non-sample returns the same object unchanged.
const paid = { unlocked: true };
assert.strictEqual(buildFullBody(paid, 'ccr_notasample'), paid);

console.log('as-report sample gate: all assertions passed');

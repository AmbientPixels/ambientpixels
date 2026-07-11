const assert = require('assert');
const { SAMPLE_REPORT_IDS, isSample, isFullyViewable } = require('../api/as-report/sampleReports');

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

console.log('as-report sample gate: all assertions passed');

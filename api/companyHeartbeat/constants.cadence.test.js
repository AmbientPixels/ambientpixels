// Cadence-derived thresholds — STALE_REVIEW_THRESHOLD_MS
// Shipped 2026-08-08 after the stale-review window sat at a hardcoded 60 minutes through four
// cadence changes (30min -> 1h -> 2h -> 4h -> 6h). Past 1h, EVERY task still in review when a
// cycle ends is "stale" by the next one, so the fleet-wide "review before your own work"
// mandate fired at every agent on every cycle. Four of six agents opened the 2026-08-08T03:42
// cycle clearing reviews while the review queue grew 2 -> 3.
//
// The test that matters is GRACE_EXCEEDS_ONE_CYCLE. If that ever goes false the mandate becomes
// permanent again, and the symptom is silent: agents look busy, the queue just never drains.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const C = require('./constants.js');

const HOUR = 60 * 60 * 1000;

test('HEARTBEAT_INTERVAL_MS matches the schedule in function.json', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'function.json'), 'utf8'));
  const timer = cfg.bindings.find(b => b.type === 'timerTrigger');
  const stepped = /^\S+\s+\S+\s+\*\/(\d+)\s/.exec(timer.schedule);
  const expected = stepped
    ? parseInt(stepped[1], 10) * HOUR
    : (/^\S+\s+\S+\s+\*\s/.test(timer.schedule) ? HOUR : 6 * HOUR);
  assert.strictEqual(C.HEARTBEAT_INTERVAL_MS, expected,
    'interval drifted from function.json — cadence-derived thresholds are now wrong');
});

// The regression guard. A 1-cycle grace is mathematically always-on.
test('GRACE_EXCEEDS_ONE_CYCLE: stale window is longer than a single heartbeat interval', () => {
  assert.ok(C.STALE_REVIEW_THRESHOLD_MS > C.HEARTBEAT_INTERVAL_MS,
    'a task queued at cycle N is one full interval old at cycle N+1, so a grace window of ' +
    '<= 1 cycle flags every review item every cycle and pins the review mandate permanently');
  assert.strictEqual(C.STALE_REVIEW_THRESHOLD_MS, C.HEARTBEAT_INTERVAL_MS * C.STALE_REVIEW_GRACE_CYCLES);
});

test('stale window is not hardcoded to the old 60-minute value', () => {
  assert.notStrictEqual(C.STALE_REVIEW_THRESHOLD_MS, HOUR);
});

test('interval derivation survives a malformed schedule via the conservative default', () => {
  // Mirrors the parser in constants.js; a schedule it cannot read must not yield a tiny window.
  const parse = (schedule) => {
    const stepped = /^\S+\s+\S+\s+\*\/(\d+)\s/.exec(schedule);
    if (stepped) return parseInt(stepped[1], 10) * HOUR;
    if (/^\S+\s+\S+\s+\*\s/.test(schedule)) return HOUR;
    return 6 * HOUR;
  };
  assert.strictEqual(parse('0 0 */4 * * *'), 4 * HOUR);
  assert.strictEqual(parse('0 0 */6 * * *'), 6 * HOUR);
  assert.strictEqual(parse('0 0 * * * *'), HOUR);
  assert.strictEqual(parse('garbage'), 6 * HOUR, 'unparseable schedule must fall back to 6h, not 0');
});

// pa-metrics.js — pre-counted product-analytics numbers for the strategy
// engine's metric resolvers (strategy-intel is pure by contract and cannot do
// I/O). One read per heartbeat cycle, one number out.
//
// Exists because obj-resume-roast-demand's north star resume_roast_runs_14d
// had NO computation anywhere for its first week — the objective read a
// phantom 0 while real runs happened, and its kill gate (<15 on 2026-08-22)
// would have shut a working lane on a number nobody measured.

const pa = require('../_utils/productAnalytics');

// Pure. "Runs" = COMPLETED roasts. Started-but-abandoned runs are a product
// problem to fix, not demand to count.
function countRunsInEvents(events) {
  return (Array.isArray(events) ? events : []).filter(function (e) {
    // internal === our own devices (pa_internal flag) — never demand.
    return e && e.product === 'resumeroast' && e.event === 'agent_run_completed' && e.internal !== true;
  }).length;
}

function _utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * @param {number} nowMs
 * @param {function} readEventRange optional injected reader (tests); defaults
 *   to the real product-analytics blob reader.
 * @returns {Promise<number|null>} null = unmeasured (reader failed) — a kill
 *   gate must never fire on a zero nobody measured.
 */
async function countResumeRoastRuns14d(nowMs, readEventRange) {
  const read = readEventRange || pa.readEventRange;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    const events = await read(_utcDate(now - 14 * 24 * 60 * 60 * 1000), _utcDate(now));
    return countRunsInEvents(events);
  } catch (e) {
    return null;
  }
}

module.exports = { countResumeRoastRuns14d, countRunsInEvents };

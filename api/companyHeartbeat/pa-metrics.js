// pa-metrics.js — pre-counted product-analytics numbers for the strategy
// engine's metric resolvers (strategy-intel is pure by contract and cannot do
// I/O). One read per heartbeat cycle, one number out.
//
// Exists because obj-resume-roast-demand's north star resume_roast_runs_14d
// had NO computation anywhere for its first week — the objective read a
// phantom 0 while real runs happened, and its kill gate (<15 on 2026-08-22)
// would have shut a working lane on a number nobody measured.

const pa = require('../_utils/productAnalytics');

// Two events now report the same finished roast, and the choice between them
// was made explicitly:
//
//   agent_run_completed — the browser, only if the tab stayed open to render it
//   run_delivered       — api/pixel-agent-run, always, right before it answers
//
// Counting both double-counts every run that finished on screen. Counting only
// the client keeps the blind spot the server event exists to close. Counting
// only the server silently drops every roast delivered before it shipped and
// would read the kill gate near zero on 2026-08-22 for a lane that was working.
//
// So: DISTINCT runIds across both. One delivered roast, one count, whichever
// side reported it — and the number stays continuous across the change.
var DELIVERED_EVENTS = { agent_run_completed: true, run_delivered: true };

// Pure. "Runs" = DELIVERED roasts. Started-but-never-delivered runs are a
// product problem to fix, not demand to count.
function countRunsInEvents(events) {
  var seen = new Set();
  var unkeyed = 0;
  (Array.isArray(events) ? events : []).forEach(function (e) {
    // internal === our own devices (pa_internal flag) — never demand.
    if (!e || e.product !== 'resumeroast' || e.internal === true) return;
    if (!DELIVERED_EVENTS[e.event]) return;
    var runId = e.props && e.props.runId;
    // No runId means nothing to dedup against — count it rather than drop a
    // real roast. Only the client ever emits one of these (the server always
    // has the id it minted), so this cannot double-count a delivered pair.
    if (typeof runId === 'string' && runId) seen.add(runId);
    else unkeyed++;
  });
  return seen.size + unkeyed;
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

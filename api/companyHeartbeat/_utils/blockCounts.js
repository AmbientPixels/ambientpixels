// blockCounts.js — true per-agent block counts, derived from governanceLog.
//
// WHY THIS EXISTS
//
// `heartbeatRuns[].perAgent[id].actionsBlocked` is NOT the number of blocked actions. It is
// the sum of two partial counters assembled in index.js: `_runCounters.byAgent[id].blocked`
// (incremented only by gates that live in index.js) plus five named guardrails
// (orphan, exact dup, fuzzy dup, task ceiling, social promo). There are roughly twenty-one
// gates. Everything enforced inside agent-runner.js — campaign_freeze in all five of its
// forms, agent_cooldown, quality_gate, summary_dedup, social_echo_only, memory_schema —
// blocks the action with a bare `continue` and never touches that counter.
//
// Measured over the five most recent runs on 2026-08-09: the run records reported 2 blocks
// where governanceLog held 26. A 13x under-count, not a rounding error.
//
// That is not merely a cosmetic gap. It reads as an agent that attempted work and produced
// nothing for no reason — which is exactly how I misdiagnosed Scribe as silently dropping
// actions when every one of them had been refused by a gate and logged properly.
//
// governanceLog is the honest source: every gate writes a `policy-violation` with
// `details.gate`. It is FIFO-capped, so this is accurate over a recent window (days) and
// undercounts beyond it — which is the right trade for the 7-day dashboards that read it.
//
// The run-record field itself is left alone ON PURPOSE: correcting it means editing
// companyHeartbeat/index.js, which is off-limits without an explicit instruction naming
// that file. Fixing the readers gets the truth to every consumer without that risk.

/**
 * Pure. Count policy-violation entries per agent.
 *
 * @param {Array} governanceLog
 * @param {Object} [opts]
 *   opts.sinceMs {number}   only entries at/after this epoch ms
 *   opts.runIds  {Array}    only entries from these run ids (matches details.runId or cycle)
 *   opts.excludeGates {Array} gate names to ignore
 * @returns {Object} { [agentId]: { total, byGate: { [gate]: n } } }
 */
function countBlocksByAgent(governanceLog, opts) {
  opts = opts || {};
  var log = Array.isArray(governanceLog) ? governanceLog : [];
  var sinceMs = Number.isFinite(opts.sinceMs) ? opts.sinceMs : null;
  var runIds = Array.isArray(opts.runIds) && opts.runIds.length ? opts.runIds : null;
  var exclude = Array.isArray(opts.excludeGates) ? opts.excludeGates : [];
  var out = {};

  for (var i = 0; i < log.length; i++) {
    var e = log[i];
    if (!e || e.type !== 'policy-violation') continue;

    var aid = e.agentId || e.agent || null;
    if (!aid) continue;

    var d = e.details || {};

    if (runIds) {
      var rid = d.runId || e.cycle || e.runId || null;
      if (runIds.indexOf(rid) === -1) continue;
    }

    // An unparseable timestamp is KEPT rather than dropped. Losing a real block because a
    // date failed to parse would recreate the exact under-count this module exists to fix.
    if (sinceMs !== null) {
      var ts = Date.parse(e.timestamp || e.at || '');
      if (Number.isFinite(ts) && ts < sinceMs) continue;
    }

    var gate = d.gate || 'unknown';
    if (exclude.indexOf(gate) !== -1) continue;

    if (!out[aid]) out[aid] = { total: 0, byGate: {} };
    out[aid].total++;
    out[aid].byGate[gate] = (out[aid].byGate[gate] || 0) + 1;
  }

  return out;
}

/**
 * Pure. The gate that blocked an agent most often, for prompt/dashboard copy.
 * @returns {{gate: string, count: number}|null}
 */
function topGateForAgent(blocksByAgent, agentId) {
  var entry = blocksByAgent && blocksByAgent[agentId];
  if (!entry || !entry.byGate) return null;
  var best = null;
  Object.keys(entry.byGate).forEach(function (g) {
    if (!best || entry.byGate[g] > best.count) best = { gate: g, count: entry.byGate[g] };
  });
  return best;
}

module.exports = { countBlocksByAgent, topGateForAgent };

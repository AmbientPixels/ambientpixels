// governanceReport/index.js — /api/governance-report
//
// Aggregates governanceLog into a CEO-facing audit view:
//   - Counts by type / agent / gate / reason within a window (7d default)
//   - Flags "dead gates" — any KNOWN_GATE that hasn't fired in the window
//     (either the system is clean, OR the enforcement is silently broken)
//   - Returns the last 50 entries for inline review
//
// Query params:
//   ?window=7d|30d|all   (default 7d)
//   ?agent=<agentId>     (optional filter)
//   ?kind=<eventType>    (optional filter; e.g. 'policy-violation')
//   ?gate=<gateName>     (optional filter; e.g. 'orphan')

const storage = require('../_utils/companyStorage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

// Every gate we expect to see fire at some point. Dead-gate detection flags any
// that produced zero entries in the window. Kept in sync with agent-runner.js
// policy-violation call sites + constants.js gate names.
const KNOWN_GATES = [
  'orphan',
  'exact_dup',
  'fuzzy_dup',
  'task_ceiling',
  'research_ceiling',
  'social_promo',
  'campaign_freeze',
  'rate_limit',
  'memory_schema',
  'memory_rate_cap',
  'mode_gate',
  'observation_clamp'
];

function parseWindow(raw) {
  const v = String(raw || '7d').trim().toLowerCase();
  if (v === 'all') return { days: null, cutoff: 0 };
  const m = v.match(/^(\d+)d$/);
  const days = m ? parseInt(m[1], 10) : 7;
  return { days: days, cutoff: Date.now() - (days * 24 * 60 * 60 * 1000) };
}

function bucketBy(entries, keyFn) {
  const out = {};
  entries.forEach((e) => {
    const k = keyFn(e);
    if (!k) return;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

function timelinePerDay(entries) {
  // Daily count, ISO date keys, sorted ascending.
  const byDay = {};
  entries.forEach((e) => {
    const t = e.timestamp || '';
    const day = t.substring(0, 10);
    if (!day) return;
    byDay[day] = (byDay[day] || 0) + 1;
  });
  return Object.keys(byDay).sort().map((d) => ({ date: d, count: byDay[d] }));
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }

  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS, body: { error: 'Method not allowed' } };
    return;
  }

  if (process.env.DEMO_MODE !== 'true') {
    const secret = (req.headers && req.headers['x-company-secret']) || '';
    const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
    if (!storage.validateSecret(secret) && !principal) {
      context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
      return;
    }
  }

  try {
    const q = req.query || {};
    const win = parseWindow(q.window);
    const agentFilter = String(q.agent || '').trim().toLowerCase();
    const kindFilter = String(q.kind || '').trim().toLowerCase();
    const gateFilter = String(q.gate || '').trim().toLowerCase();

    const rawLog = (await storage.getState('governanceLog')) || [];
    const log = Array.isArray(rawLog) ? rawLog : [];

    // Filter by window + optional agent/kind/gate
    const filtered = log.filter((e) => {
      if (!e) return false;
      if (win.cutoff > 0) {
        const t = Date.parse(e.timestamp || '');
        if (!Number.isFinite(t) || t < win.cutoff) return false;
      }
      if (agentFilter && String(e.agentId || '').toLowerCase() !== agentFilter) return false;
      if (kindFilter && String(e.type || '').toLowerCase() !== kindFilter) return false;
      if (gateFilter) {
        const g = e.details && e.details.gate;
        if (!g || String(g).toLowerCase() !== gateFilter) return false;
      }
      return true;
    });

    // Summary counts
    const byType = bucketBy(filtered, (e) => e.type || 'unknown');
    const byAgent = bucketBy(filtered, (e) => e.agentId || 'system');
    const byGate = bucketBy(
      filtered.filter((e) => e.type === 'policy-violation'),
      (e) => (e.details && e.details.gate) || null
    );
    const byReason = bucketBy(
      filtered.filter((e) => e.type === 'policy-violation'),
      (e) => (e.details && e.details.reason) || null
    );

    // Rate-limit specific breakdown (for Phase 2a visibility)
    const rateLimitEntries = filtered.filter((e) =>
      e.type === 'policy-violation' && e.details && e.details.gate === 'rate_limit'
    );
    const rateLimitDropsTotal = rateLimitEntries.length;
    const rateLimitDropsByAgent = bucketBy(rateLimitEntries, (e) => e.agentId || 'system');

    // Dead-gate detection — any known gate with zero entries in the window.
    // Only meaningful within a time window; not run for window=all.
    const deadGates = win.cutoff > 0
      ? KNOWN_GATES.filter((g) => !byGate[g])
      : [];

    // Daily timeline for sparkline rendering
    const timeline = timelinePerDay(filtered);

    // Recent entries (last 50) — oldest first is how logs are written; reverse for UI.
    const recent = filtered.slice(-50).reverse().map((e) => ({
      timestamp: e.timestamp,
      type: e.type,
      agentId: e.agentId,
      summary: e.summary,
      gate: e.details && e.details.gate,
      reason: e.details && e.details.reason,
      runId: e.details && e.details.runId,
      cycle: e.cycle,
      details: e.details || null
    }));

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        meta: {
          asOfUtc: new Date().toISOString(),
          windowDays: win.days,
          totalEntriesInWindow: filtered.length,
          totalEntriesAllTime: log.length,
          filters: {
            agent: agentFilter || null,
            kind: kindFilter || null,
            gate: gateFilter || null
          }
        },
        summary: {
          byType: byType,
          byAgent: byAgent,
          byGate: byGate,
          byReason: byReason,
          rateLimitDropsTotal: rateLimitDropsTotal,
          rateLimitDropsByAgent: rateLimitDropsByAgent
        },
        deadGates: deadGates,
        knownGates: KNOWN_GATES,
        timeline: timeline,
        recentEntries: recent
      }
    };
  } catch (err) {
    context.log.error('[governance-report] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to build governance report', details: err && err.message ? err.message : String(err) }
    };
  }
};

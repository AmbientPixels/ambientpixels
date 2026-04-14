// actionAudit/index.js — /api/action-audit
//
// CEO-facing audit view of the Action System. Aggregates:
//   - Execution outcomes from `actions` state (success/failed/pending/rejected)
//   - CEO decisions from `governanceLog` (ceo-approval / ceo-reject / ceo-revision / ceo-cancel)
// Cross-references the two so each action in `recentEntries` shows its full lifecycle:
// proposed → CEO decided → executed → outcome.
//
// Mirrors governanceReport/index.js pattern (CORS, window parsing, filter params, bucket counts).
//
// Query params:
//   ?window=7d|30d|all         (default 7d)
//   ?agent=<agentId>           filter by created_by
//   ?type=<actionType>         filter by action.type
//   ?platform=<platform>       filter by action.platform
//   ?outcome=success|failed|pending|rejected  filter by execution/approval state

const storage = require('../_utils/companyStorage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

// Known outcome buckets — kept explicit so dashboard filter options match reality.
const KNOWN_OUTCOMES = ['success', 'failed', 'pending', 'running', 'rejected', 'cancelled', 'superseded'];

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

function timelinePerDay(entries, tsFn) {
  const byDay = {};
  entries.forEach((e) => {
    const t = tsFn(e);
    if (!t) return;
    const day = String(t).substring(0, 10);
    if (!day) return;
    byDay[day] = (byDay[day] || 0) + 1;
  });
  return Object.keys(byDay).sort().map((d) => ({ date: d, count: byDay[d] }));
}

// Resolve the primary outcome state for an action. Precedence:
// 1. execution.status (success/failed/running) if set
// 2. approval.status (approved/rejected/cancelled/pending/superseded) otherwise
function resolveOutcome(a) {
  const exec = a && a.execution && a.execution.status;
  if (exec === 'success' || exec === 'failed' || exec === 'running') return exec;
  const appr = a && a.approval && a.approval.status;
  if (appr) return appr;
  return 'pending';
}

function resolvePlatform(a) {
  if (!a) return null;
  if (a.platform) return a.platform;
  if (a.payload && a.payload.platform) return a.payload.platform;
  return null;
}

function latencyMs(a) {
  const s = a && a.execution && Date.parse(a.execution.started_at || '');
  const f = a && a.execution && Date.parse(a.execution.finished_at || '');
  if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s) return null;
  return f - s;
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
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
    const typeFilter = String(q.type || '').trim().toLowerCase();
    const platformFilter = String(q.platform || '').trim().toLowerCase();
    const outcomeFilter = String(q.outcome || '').trim().toLowerCase();

    const rawActions = (await storage.getState('actions')) || [];
    const actions = Array.isArray(rawActions) ? rawActions : [];
    const rawLog = (await storage.getState('governanceLog')) || [];
    const log = Array.isArray(rawLog) ? rawLog : [];

    // Build action-id → CEO decision lookup from governanceLog.
    // Matches on details.actionId OR text-pattern in summary.
    // Per Phase 7 decision: include execution outcomes AND CEO decisions for full lifecycle view.
    const ceoDecisionByActionId = {};
    const CEO_TYPES = new Set(['ceo-approval', 'ceo-reject', 'ceo-revision', 'ceo-cancel', 'ceo-revision-requested']);
    log.forEach((e) => {
      if (!e || !CEO_TYPES.has(e.type || '')) return;
      const actionId = (e.data && e.data.actionId) || (e.details && e.details.actionId) || null;
      if (!actionId) return;
      if (!ceoDecisionByActionId[actionId]) ceoDecisionByActionId[actionId] = [];
      ceoDecisionByActionId[actionId].push({
        type: e.type,
        timestamp: e.timestamp,
        summary: e.summary || null
      });
    });

    // Filter actions by window + optional facets
    const filtered = actions.filter((a) => {
      if (!a) return false;
      if (win.cutoff > 0) {
        const t = Date.parse(a.created_at || a.timestamp || a.createdAt || '');
        if (!Number.isFinite(t) || t < win.cutoff) return false;
      }
      if (agentFilter && String(a.created_by || '').toLowerCase() !== agentFilter) return false;
      if (typeFilter && String(a.type || '').toLowerCase() !== typeFilter) return false;
      if (platformFilter) {
        const p = resolvePlatform(a);
        if (!p || String(p).toLowerCase() !== platformFilter) return false;
      }
      if (outcomeFilter && resolveOutcome(a) !== outcomeFilter) return false;
      return true;
    });

    // Summary counts
    const byType = bucketBy(filtered, (a) => a.type || 'unknown');
    const byAgent = bucketBy(filtered, (a) => a.created_by || 'unknown');
    const byPlatform = bucketBy(filtered, (a) => resolvePlatform(a));
    const byOutcome = bucketBy(filtered, (a) => resolveOutcome(a));

    // CEO decision summary (from cross-referenced log entries within the window)
    // Count distinct decisions that touched actions in our filtered set.
    const filteredIds = new Set(filtered.map((a) => a.id).filter(Boolean));
    const ceoDecisionCounts = { approvals: 0, rejects: 0, revisions: 0, cancels: 0 };
    Object.keys(ceoDecisionByActionId).forEach((aid) => {
      if (!filteredIds.has(aid)) return;
      ceoDecisionByActionId[aid].forEach((d) => {
        if (d.type === 'ceo-approval') ceoDecisionCounts.approvals++;
        else if (d.type === 'ceo-reject') ceoDecisionCounts.rejects++;
        else if (d.type === 'ceo-revision' || d.type === 'ceo-revision-requested') ceoDecisionCounts.revisions++;
        else if (d.type === 'ceo-cancel') ceoDecisionCounts.cancels++;
      });
    });

    // Latency stats on actions that actually executed (have both started + finished)
    const latencies = filtered.map(latencyMs).filter((n) => n != null).sort((a, b) => a - b);
    const avgLatencyMs = latencies.length > 0
      ? Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length)
      : null;
    const p95LatencyMs = percentile(latencies, 95);
    const p50LatencyMs = percentile(latencies, 50);

    // Failure signals — recurring failure patterns grouped by type+platform+error code
    const failureAgg = {};
    filtered.forEach((a) => {
      if (resolveOutcome(a) !== 'failed') return;
      const err = (a.execution && a.execution.last_error) || (a.error && (a.error.code || a.error.message)) || 'unknown';
      const errCode = typeof err === 'object' ? (err.code || err.message || 'unknown') : String(err);
      const plat = resolvePlatform(a) || 'none';
      const key = (a.type || 'unknown') + '|' + plat + '|' + String(errCode).substring(0, 60);
      if (!failureAgg[key]) {
        failureAgg[key] = { type: a.type, platform: plat, error: String(errCode).substring(0, 60), count: 0 };
      }
      failureAgg[key].count += 1;
    });
    const failureSignals = Object.values(failureAgg).sort((a, b) => b.count - a.count);

    const timeline = timelinePerDay(filtered, (a) => a.created_at || a.timestamp || a.createdAt || '');

    // Recent entries — last 50 with full lifecycle view (CEO decisions cross-referenced)
    const recent = filtered.slice(-50).reverse().map((a) => {
      const outcome = resolveOutcome(a);
      const platform = resolvePlatform(a);
      const decisions = ceoDecisionByActionId[a.id] || [];
      const receipt = a.execution && a.execution.receipt;
      const lastError = a.execution && (a.execution.last_error || a.execution.error);
      return {
        id: a.id,
        type: a.type,
        platform: platform,
        agent: a.created_by || null,
        created_at: a.created_at || a.timestamp || a.createdAt || null,
        outcome: outcome,
        approval_status: a.approval && a.approval.status,
        execution_status: a.execution && a.execution.status,
        attempts: a.execution && a.execution.attempts,
        latencyMs: latencyMs(a),
        ceoDecisions: decisions,
        receiptUrl: receipt && (receipt.post_url || receipt.public_url || null),
        error: lastError ? (typeof lastError === 'object' ? (lastError.code || lastError.message) : String(lastError)) : null,
        taskId: a.taskId || null
      };
    });

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        meta: {
          asOfUtc: new Date().toISOString(),
          windowDays: win.days,
          totalActionsInWindow: filtered.length,
          totalActionsAllTime: actions.length,
          totalLogEntries: log.length,
          filters: {
            agent: agentFilter || null,
            type: typeFilter || null,
            platform: platformFilter || null,
            outcome: outcomeFilter || null
          }
        },
        summary: {
          byType: byType,
          byAgent: byAgent,
          byPlatform: byPlatform,
          byOutcome: byOutcome,
          ceoDecisionCounts: ceoDecisionCounts,
          avgLatencyMs: avgLatencyMs,
          p50LatencyMs: p50LatencyMs,
          p95LatencyMs: p95LatencyMs,
          latencySamples: latencies.length
        },
        failureSignals: failureSignals,
        knownOutcomes: KNOWN_OUTCOMES,
        timeline: timeline,
        recentEntries: recent
      }
    };
  } catch (err) {
    context.log.error('[action-audit] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to build action audit', details: err && err.message ? err.message : String(err) }
    };
  }
};

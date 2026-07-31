// revenueDigest — GET /api/revenueDigest
//
// Read-through for the CEO revenue dashboard. Returns the cached revenue digest
// from runtimeMemory.revenueDigest (populated by each heartbeat via
// buildRevenueDigest over the revenueLedger). Falls back to an on-demand build
// from the ledger if the runtime cache is missing or stale.
//
// Same pattern as outcomeDigest / allocationDigest. /api/* is a catch-all proxy
// in staticwebapp.config.json so no route config is needed.

const storage = require('../_utils/companyStorage');
const { buildRevenueDigest } = require('../companyHeartbeat/revenue-intel');
const { getLedger, LEDGER_KEY, POSITIVE_TYPES } = require('../_lib/stripe/revenueLedger');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

// Month-to-date LLM spend in cents (only used for the rare on-demand rebuild;
// the cached digest already carries spendCents from the heartbeat).
async function _mtdSpendCents() {
  try {
    const cost = await storage.getGeminiCostSummary(30);
    const byDay = (cost && cost.byDay) || {};
    const prefix = new Date().toISOString().substring(0, 7); // YYYY-MM
    let total = 0;
    Object.keys(byDay).forEach(function (d) {
      if (typeof d === 'string' && d.indexOf(prefix) === 0) total += (byDay[d] && byDay[d].cost) || 0;
    });
    return Math.round(total * 100);
  } catch (_e) {
    return 0;
  }
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // Auth: require company secret OR SWA principal (CEO dashboard is authed).
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    return;
  }

  // CEO-only maintenance: remove $0 "positive" entries (dry-run test checkouts
  // via 100%-off coupons). One such entry marked obj-first-customer complete and
  // put "1 paying" in WORLD STATE off a fake sale — with the fleet now optimizing
  // revenue metrics, the ledger must be truth. Legitimate $0 markers
  // (subscription_canceled) are NOT positive types and are never touched.
  // Strict secret gate (not principal) — this mutates the append-only ledger.
  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.action !== 'prune-test-entries') {
      context.res = { status: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Unknown action. Supported: prune-test-entries' }) };
      return;
    }
    if (secret !== 'pixelpusher') {
      context.res = { status: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Forbidden' }) };
      return;
    }
    try {
      const ledger = await getLedger();
      const removed = [];
      const kept = [];
      for (const e of ledger.entries) {
        const isZeroPositive = e && POSITIVE_TYPES.indexOf(e.type) !== -1 && (!Number.isFinite(e.amountCents) || e.amountCents === 0);
        if (isZeroPositive) removed.push(e); else kept.push(e);
      }
      if (removed.length > 0) {
        ledger.entries = kept;
        ledger.updatedAt = new Date().toISOString();
        ledger.lastPrune = { at: ledger.updatedAt, removedIds: removed.map(e => e.id), reason: 'zero-amount positive entries (test checkouts)' };
        await storage.setState(LEDGER_KEY, ledger);
      }
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, removedCount: removed.length, removed: removed, remaining: kept.length })
      };
    } catch (err) {
      context.res = { status: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Prune failed', details: err && err.message ? err.message : String(err) }) };
    }
    return;
  }

  try {
    let digest = null;
    const runtime = (await storage.getState('runtimeMemory')) || {};
    if (runtime && runtime.revenueDigest && runtime.revenueDigest.generatedAt) {
      digest = runtime.revenueDigest;
    }

    // Fallback: build on the fly if cache is missing or stale (>90 min old).
    const staleMs = 90 * 60 * 1000;
    const age = digest ? (Date.now() - Date.parse(digest.generatedAt)) : Infinity;
    const isStale = !digest || age > staleMs;

    if (isStale) {
      const ledger = await getLedger();
      const spendCents = await _mtdSpendCents();
      digest = buildRevenueDigest(ledger, spendCents, Date.now());
      digest._builtOnDemand = true;
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify(digest)
    };
  } catch (err) {
    context.log.error && context.log.error('[revenueDigest] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to build revenue digest', details: err && err.message ? err.message : String(err) })
    };
  }
};

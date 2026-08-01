// as-funnel — GET /api/as-funnel
//
// Read surface for the AmbientScore scan -> lead -> sale funnel. Joins the three
// sources that were previously write-only / unreadable from any dashboard:
//   cc_analytics  (scan events, not a company-state VALID_KEY)
//   as_leads      (email captures)
//   revenueLedger (real Stripe money, AmbientScore rows)
//
// Built on demand each call — the volumes are tiny (scans capped 10k, leads 5k,
// ledger is 0..low). No heartbeat wiring, no state writes, read-only.
//
// Same auth + CORS as revenueDigest. /api/* is a catch-all proxy in
// staticwebapp.config.json so no route config is needed.

const storage = require('../_utils/companyStorage');
const { buildFunnelDigest } = require('../_lib/ambientScore/funnelDigest');
const { getLedger, resolveInternalEmails } = require('../_lib/stripe/revenueLedger');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

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

  try {
    const [scans, leads, ledger, internalEmails] = await Promise.all([
      storage.getState('cc_analytics'),
      storage.getState('as_leads'),
      getLedger(),
      resolveInternalEmails().catch(function () { return []; })
    ]);

    const digest = buildFunnelDigest({
      scans: Array.isArray(scans) ? scans : [],
      leads: Array.isArray(leads) ? leads : [],
      ledger: ledger || { entries: [] },
      nowMs: Date.now(),
      // Founder/test purchases must not read as customers on the CEO's funnel view.
      internalEmails: internalEmails
    });

    context.res = { status: 200, headers: corsHeaders, body: JSON.stringify(digest) };
  } catch (err) {
    context.log.error && context.log.error('[as-funnel] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to build funnel digest', details: err && err.message ? err.message : String(err) })
    };
  }
};

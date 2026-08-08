// keepalive-record — authenticated writer for the keep-alive ping log.
// Called by the GitHub Actions keepalive workflow after each healthz probe.

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

const STATE_KEY = 'pingLog';
const MAX_ENTRIES = 100;

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 401, headers: corsHeaders, body: { error: 'unauthorized' } };
    return;
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const latency = Number(body.latencyMs);
  const entry = {
    ts: new Date().toISOString(),
    latencyMs: Number.isFinite(latency) ? Math.round(latency) : null,
    status: body.status === 'fail' ? 'fail' : 'ok'
  };

  try {
    const existing = (await storage.getState(STATE_KEY)) || [];
    const log = Array.isArray(existing) ? existing : [];
    log.push(entry);
    const trimmed = log.length > MAX_ENTRIES ? log.slice(-MAX_ENTRIES) : log;
    await storage.setState(STATE_KEY, trimmed);

    // Fleet-health watch: detect heartbeat throughput collapse and alert via Discord.
    // Runs on the keepalive cadence (~5 min) so an outage is caught within minutes.
    // Non-fatal — a failure here must never break ping recording.
    try {
      const { checkAndAlertFleetHealth } = require('../_utils/fleetAlerts');
      await checkAndAlertFleetHealth(storage);
    } catch (_fa) {
      if (context.log && context.log.error) context.log.error('[keepalive-record] fleet-health check failed:', _fa && _fa.message);
    }

    // Approval watch: ping the CEO's Discord when NEW items wait for approval.
    // Same cadence, same non-fatal contract as the fleet-health check.
    try {
      const { checkAndAlertPendingApprovals } = require('../_utils/approvalAlerts');
      await checkAndAlertPendingApprovals(storage);
    } catch (_aa) {
      if (context.log && context.log.error) context.log.error('[keepalive-record] approval check failed:', _aa && _aa.message);
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { ok: true, recorded: entry, total: trimmed.length }
    };
  } catch (err) {
    context.log.error('[keepalive-record] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'record failed', details: err.message }
    };
  }
};

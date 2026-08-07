// llm-spend — on-demand read of what the monitor sees.
// GET /api/llm-spend   (requires x-company-secret)
//
// Same summary the cron alerts on, for checking without waiting for the next
// run or a Discord post. Reads only.
//
// SECRET-GATED, unlike most reads here. This returns remaining credit balance
// and per-caller burn: telling an anonymous caller exactly how much it costs to
// exhaust the product is a different class of disclosure from the public
// dashboards, and this endpoint is for us, not for visitors.

const storage = require('../_utils/companyStorage');
const { isValidCeoSecret } = require('../_utils/ceoSecret');
const monitor = require('../_lib/llm/spendMonitor');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }

  if (!isValidCeoSecret(req.headers['x-company-secret'])) {
    context.res = { status: 401, headers: CORS, body: { error: 'Unauthorized' } };
    return;
  }

  try {
    const [claudeUsage, geminiUsage, fallbackLog, systemConfig, state] = await Promise.all([
      storage.getState('claudeUsage').then(v => v || []),
      storage.getState('geminiUsage').then(v => v || []),
      storage.getState('llmFallbackLog').then(v => v || []),
      storage.getState('systemConfig').then(v => v || {}),
      storage.getState('llmSpendMonitorState').then(v => v || null)
    ]);

    const report = monitor.summarize({
      claudeUsage,
      geminiUsage,
      fallbackLog,
      anthropicCredits: systemConfig.anthropicCredits,
      nowMs: Date.now()
    });

    // Shown without firing anything, so a check does not consume the cooldown
    // that stops the cron from re-posting.
    const pending = monitor.decideAlerts(report, state, Date.now()).alerts
      .map(a => ({ key: a.key, severity: a.severity, title: a.title }));

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        ...report,
        wouldAlert: pending,
        lastCronRunAt: state && state.lastRunAt ? state.lastRunAt : null,
        // The last 20 fallbacks, newest first — the fastest way to see WHY
        // Claude is being skipped rather than just that it is.
        recentFallbacks: (fallbackLog || []).slice(-20).reverse()
      }
    };
  } catch (err) {
    context.log.error('[llm-spend] failed:', err.message);
    context.res = { status: 500, headers: CORS, body: { error: 'Failed to compute spend summary' } };
  }
};

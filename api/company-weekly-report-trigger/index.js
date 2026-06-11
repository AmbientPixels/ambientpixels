// company-weekly-report-trigger — HTTP wrapper to manually invoke the weekly
// cadence report generator (Cipher financial / Forge ops / Nova strategic).
// Mirrors /api/company-morning-report-trigger exactly.
// POST /api/company-weekly-report-trigger
//
// Why this exists: the timer (0 0 16 * * 0, Sunday 16:00 UTC) can be swallowed
// by a deploy-driven Function App restart if commits land in the fire window.
// This endpoint gives a curl-friendly way to backfill or re-run after a fix.

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // Validate write secret — same pattern as the heartbeat / morning-report triggers
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid write secret' } };
    return;
  }

  context.log('[WeeklyReportTrigger] Manual invocation');

  try {
    const weeklyReport = require('../companyWeeklyReport/index');
    await weeklyReport(context);

    // Report back the current archive state per cadence agent so the caller can verify it landed
    const wr = (await storage.getState('weeklyReports')) || {};
    const summary = {};
    ['cipher', 'forge', 'nova'].forEach(function (a) {
      const list = Array.isArray(wr[a]) ? wr[a] : [];
      const last = list[list.length - 1];
      summary[a] = last ? { date: last.date, createdAt: last.createdAt, source: last.source || null, preview: (last.text || '').substring(0, 120) } : null;
    });

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: 'ok', message: 'Weekly report generation invoked', latest: summary }
    };
  } catch (err) {
    context.log.error('[WeeklyReportTrigger] Error:', err.message);
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Weekly report generation failed', detail: err.message } };
  }
};

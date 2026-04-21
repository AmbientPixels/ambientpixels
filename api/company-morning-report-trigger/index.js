// company-morning-report-trigger — HTTP wrapper to manually invoke the
// daily log generator. Mirrors /api/company-heartbeat-trigger exactly.
// POST /api/company-morning-report-trigger
//
// Why this exists: the timer (0 30 15 * * *) can be swallowed by a
// deploy-driven Function App restart if commits land during the fire
// window. This endpoint gives a curl-friendly way to backfill a
// missing day or re-run after a fix.

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

  // Validate write secret — same pattern as the heartbeat trigger
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = {
      status: 403,
      headers: corsHeaders,
      body: { error: 'Invalid write secret' }
    };
    return;
  }

  const todayUtc = new Date().toISOString().slice(0, 10);
  context.log('[MorningReportTrigger] Manual invocation for', todayUtc);

  try {
    const morningReport = require('../companyMorningReport/index');
    await morningReport(context);

    // Check that the entry actually landed
    const dl = (await storage.getState('dailyLog')) || [];
    const entry = dl.find(function (e) { return e && e.date === todayUtc; });

    if (entry) {
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: {
          status: 'ok',
          message: 'Morning report generated',
          date: todayUtc,
          entry: {
            id: entry.id,
            date: entry.date,
            title: entry.title,
            mood: entry.mood,
            stats: entry.stats,
            published_at: entry.published_at
          }
        }
      };
      return;
    }

    // Function ran but didn't produce an entry — usually means the
    // AI returned a malformed response that failed validation at
    // companyMorningReport/index.js:489. Surface that so the caller
    // can retry.
    context.res = {
      status: 502,
      headers: corsHeaders,
      body: {
        status: 'no_entry',
        message: 'Report ran but no entry was written for ' + todayUtc + '. Check function logs.',
        date: todayUtc
      }
    };
  } catch (err) {
    context.log.error('[MorningReportTrigger] Error:', err && err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: {
        status: 'error',
        error: 'Morning report failed',
        details: (err && err.message) || String(err)
      }
    };
  }
};

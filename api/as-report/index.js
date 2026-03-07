// as-report — GET /api/as-report?id=XXX
// Returns report data. If unlocked=false, returns score + teaser only.
// Report ID is unguessable — no auth required.

const storage = require('../_utils/companyStorage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }

  try {
    const id = (req.query.id || '').trim();

    if (!id || !id.startsWith('ccr_')) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'Valid report ID required.' }) };
      return;
    }

    const report = await storage.getState('cc_report_' + id);

    if (!report) {
      context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: 'Report not found. It may still be generating — try again in a few seconds.' }) };
      return;
    }

    // If report is locked, return teaser only
    if (!report.unlocked) {
      context.res = {
        status: 200,
        headers: CORS,
        body: JSON.stringify({
          id: report.id || id,
          url: report.url,
          createdAt: report.createdAt,
          unlocked: false,
          score: report.score,
          grade: report.grade,
          teaserFindings: report.teaserFindings || [],
          totalFindings: (report.findings || []).length,
          jsRenderedWarning: report.jsRenderedWarning || null,
          disclaimer: report.disclaimer || null
        })
      };
      return;
    }

    // Full report
    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify(report)
    };

  } catch (err) {
    context.log.error('[as-report] Error:', err.message || err);
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to load report.' }) };
  }
};

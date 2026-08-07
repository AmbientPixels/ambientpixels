// as-report — GET /api/as-report?id=XXX
// Returns report data. If unlocked=false, returns score + teaser only.
// Report ID is unguessable — no auth required.

const storage = require('../_utils/companyStorage');
const { isFullyViewable, buildFullBody } = require('./sampleReports');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// An analyzing stub older than this is treated as failed. The pipeline's worst
// measured run is ~222s; eval and synthesis retries can roughly double that.
// Ten minutes means a frozen background worker (the Consumption-plan orphan
// case) surfaces as an honest failure instead of an eternal spinner.
const ANALYZING_STALE_MS = 10 * 60 * 1000;

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

    // In-flight and failed stubs are valid poll answers, not transport errors.
    // The landing page and the viewer both read `status` before anything else.
    if (report.status === 'analyzing') {
      const started = Date.parse(report.startedAt || report.createdAt || '') || 0;
      const elapsed = started ? Date.now() - started : null;
      if (!started || elapsed > ANALYZING_STALE_MS) {
        context.res = {
          status: 200, headers: CORS,
          body: JSON.stringify({ id: report.id || id, url: report.url, status: 'failed', errorCode: 'ANALYSIS_STALLED' })
        };
        return;
      }
      context.res = {
        status: 200, headers: CORS,
        body: JSON.stringify({
          id: report.id || id, url: report.url, status: 'analyzing',
          stage: report.stage || 'fetch',
          elapsedSeconds: Math.round(elapsed / 1000)
        })
      };
      return;
    }
    if (report.status === 'failed') {
      context.res = {
        status: 200, headers: CORS,
        body: JSON.stringify({
          id: report.id || id, url: report.url, status: 'failed',
          errorCode: report.errorCode || 'ANALYSIS_FAILED',
          errorDetail: report.errorDetail || null,
          httpStatus: report.httpStatus || null
        })
      };
      return;
    }

    // If report is locked and not an allowlisted sample, return teaser only
    if (!isFullyViewable(report, id)) {
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
          contentWarning: report.contentWarning || null,
          disclaimer: report.disclaimer || null,
          // The landing page now reaches results through this endpoint, so the
          // dimension counts the buying decision needs must be served here too.
          totalDimensions: Object.keys(report.dimensions || {}).length || null,
          partialDimensions: Object.values(report.dimensions || {})
            .filter(function (d) { return d && d.partial; }).length
        })
      };
      return;
    }

    // Full report. For samples, force unlocked and flag isSample for the viewer.
    const fullBody = buildFullBody(report, id);
    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify(fullBody)
    };

  } catch (err) {
    context.log.error('[as-report] Error:', err.message || err);
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to load report.' }) };
  }
};

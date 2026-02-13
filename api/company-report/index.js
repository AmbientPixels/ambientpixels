const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const report = await storage.getState('morningReport');
    const reportHistory = await storage.getState('morningReportHistory');

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        report: report || null,
        history: (reportHistory || []).slice(-14) // last 2 weeks
      }
    };
  } catch (err) {
    context.log.error('[company-report] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Failed to fetch report', details: err.message }
    };
  }
};

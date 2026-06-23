// meetingsRead — GET /api/meetingsRead. Returns the agenticMeetings list (newest first)
// for the dashboard. Read-only; agenticMeetings is not a company-state VALID_KEY.
const storage = require('../_utils/companyStorage');
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret', 'Content-Type': 'application/json'
};
module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }
  try {
    const list = (await storage.getState('agenticMeetings')) || [];
    const out = list.slice().reverse();
    context.res = { status: 200, headers: corsHeaders, body: { meetings: out } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 200) } };
  }
};

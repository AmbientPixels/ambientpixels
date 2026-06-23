// agentic-meeting-trigger — POST /api/agentic-meeting-trigger (the button).
// Runs one agentic meeting on demand and returns the record for the UI.
const storage = require('../_utils/companyStorage');
const { runAgenticMeeting } = require('../companyMeeting/meeting-core');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) { context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid write secret' } }; return; }
  try {
    const record = await runAgenticMeeting({ storage: storage, nowMs: Date.now(), trigger: 'button', log: function () { context.log.apply(context, arguments); } });
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', meeting: record } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 300) } };
  }
};

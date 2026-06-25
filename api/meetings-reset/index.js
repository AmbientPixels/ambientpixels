// meetings-reset — POST /api/meetings-reset. Clears the agenticMeetings log.
// Maintenance/test utility: agenticMeetings is a read-only FIFO log (cap 50) written
// only by the meeting engine; it is NOT a company-state VALID_KEY, so there is no
// other write path. Secret-gated, same as the meeting trigger.
const storage = require('../_utils/companyStorage');

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
    const prev = (await storage.getState('agenticMeetings')) || [];
    await storage.setState('agenticMeetings', []);
    context.res = { status: 200, headers: corsHeaders, body: { ok: true, cleared: Array.isArray(prev) ? prev.length : 0 } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message ? err.message : err).slice(0, 300) } };
  }
};

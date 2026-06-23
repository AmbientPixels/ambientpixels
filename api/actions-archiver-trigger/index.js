// actions-archiver-trigger — HTTP wrapper to run the actions archive+trim on demand.
// Mirrors proposal-generator-trigger. POST /api/actions-archiver-trigger
// Useful for clearing the live `actions` backlog without waiting for the daily timer.

const storage = require('../_utils/companyStorage');
const archive = require('../_utils/archiveStorage');
const { runArchiver } = require('../actionsArchiver');

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
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid write secret' } };
    return;
  }
  try {
    const result = await runArchiver({
      storage: storage,
      archive: archive,
      nowMs: Date.now(),
      log: function () { context.log.apply(context, arguments); }
    });
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', result: result } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err).substring(0, 300) } };
  }
};

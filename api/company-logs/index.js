const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // GET — read log slices
  if (req.method === 'GET') {
    const options = {};
    if (req.query.since) options.since = req.query.since;
    if (req.query.type) options.type = req.query.type;
    if (req.query.limit) options.limit = parseInt(req.query.limit, 10);

    try {
      const logs = await storage.getLogs(options);
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: { logs: logs, count: logs.length }
      };
    } catch (err) {
      context.log.error('[company-logs] GET error:', err.message);
      context.res = {
        status: 500,
        headers: corsHeaders,
        body: { error: 'Failed to read logs', details: err.message }
      };
    }
    return;
  }

  // POST — append a log event
  if (req.method === 'POST') {
    const secret = (req.headers && req.headers['x-company-secret']) || '';
    if (!storage.validateSecret(secret)) {
      context.res = {
        status: 403,
        headers: corsHeaders,
        body: { error: 'Invalid write secret' }
      };
      return;
    }

    const logEvent = req.body;
    if (!logEvent || !logEvent.type || !logEvent.timestamp) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'Log event must have type and timestamp' }
      };
      return;
    }

    try {
      await storage.appendLog(logEvent);
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: { status: 'logged', id: logEvent.id }
      };
    } catch (err) {
      context.log.error('[company-logs] POST error:', err.message);
      context.res = {
        status: 500,
        headers: corsHeaders,
        body: { error: 'Failed to append log', details: err.message }
      };
    }
    return;
  }

  context.res = {
    status: 405,
    headers: corsHeaders,
    body: { error: 'Method not allowed' }
  };
};

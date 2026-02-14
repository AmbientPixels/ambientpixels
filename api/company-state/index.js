const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

// Valid state keys that can be read/written
const VALID_KEYS = [
  'tasks', 'workspaceMemory', 'agentConfigs', 'identity',
  'tools', 'dates', 'metrics', 'sessionLog', 'cronLog',
  'standupLog', 'morningReport', 'logs', '_ping',
  'directives', 'objectives', 'approvalQueue', 'governanceLog',
  'actionQueue', 'actionAuditLog', 'actionRateCounts', 'actions',
  'documents', 'publishedDocs', 'blogPosts', 'dailyLog', 'webSearchCache'
];

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // GET — read a state key
  if (req.method === 'GET') {
    const key = (req.query && req.query.key) || '';

    if (key === '_ping') {
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: { status: 'ok', service: 'company-state', mode: 'server' }
      };
      return;
    }

    if (!key || VALID_KEYS.indexOf(key) === -1) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'Invalid or missing key. Valid keys: ' + VALID_KEYS.join(', ') }
      };
      return;
    }

    try {
      const value = await storage.getState(key);
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: { key: key, value: value }
      };
    } catch (err) {
      context.log.error('[company-state] GET error:', err.message);
      context.res = {
        status: 500,
        headers: corsHeaders,
        body: { error: 'Failed to read state', details: err.message }
      };
    }
    return;
  }

  // POST — write a state key
  if (req.method === 'POST') {
    // Validate write secret
    const secret = (req.headers && req.headers['x-company-secret']) || '';
    if (!storage.validateSecret(secret)) {
      context.res = {
        status: 403,
        headers: corsHeaders,
        body: { error: 'Invalid write secret' }
      };
      return;
    }

    const body = req.body || {};
    const key = body.key;
    const value = body.value;

    if (!key || VALID_KEYS.indexOf(key) === -1) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'Invalid or missing key. Valid keys: ' + VALID_KEYS.join(', ') }
      };
      return;
    }

    if (value === undefined) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'Missing value in request body' }
      };
      return;
    }

    try {
      await storage.setState(key, value);
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: { key: key, status: 'saved' }
      };
    } catch (err) {
      context.log.error('[company-state] POST error:', err.message);
      context.res = {
        status: 500,
        headers: corsHeaders,
        body: { error: 'Failed to save state', details: err.message }
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

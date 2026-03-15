const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

// Valid state keys that can be read/written
const VALID_KEYS = [
  'tasks', 'workspaceMemory', 'agentConfigs', 'identity',
  'tools', 'dates', 'metrics', 'sessionLog', 'cronLog',
  'standupLog', 'morningReport', 'logs', '_ping',
  'directives', 'campaigns', 'objectives', 'approvalQueue', 'governanceLog',
  'actionQueue', 'actionAuditLog', 'actionRateCounts', 'actions',
  'documents', 'publishedDocs', 'blogPosts', 'dailyLog', 'webSearchCache',
  'ap_artifacts', 'meetings', 'tasksArchive', 'agentMemories', 'agentSeedMemories', 'heartbeatRuns',
  'contentEngineConfig', 'imageAssets', 'runtimeMemory',
  'execution_mode', 'workerReports', 'socialCredentials',
  'demoChatCount', 'researchIntel',
  'trendRadar', 'trendInsights', 'trendActions', 'systemConfig',
  'agentPerformance', 'agentExperiments',
  'geminiUsage', 'blogPostViews',
  'socialMetricsEvents', 'socialEngagementSnapshots', 'socialEngagementMeta', 'socialAccountStats'
];

module.exports = async function (context, req) {
  context.log('[company-state] Function called, req method:', req ? req.method : 'req is null', 'req query:', req ? JSON.stringify(req.query) : 'N/A');

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
      context.log.error('[company-state] GET error:', err.message, err.stack);
      context.res = {
        status: 500,
        headers: corsHeaders,
        body: { error: 'Failed to read state', details: err.message, stack: err.stack }
      };
    }
    return;
  }

  // POST — write a state key
  if (req.method === 'POST') {
    var blocked = require('../_utils/demoGuard').httpGuard(req);
    if (blocked) { context.res = blocked; return; }

    // Auth: accept write secret OR authenticated SWA user
    const secret = (req.headers && req.headers['x-company-secret']) || '';
    const clientPrincipal = (req.headers && req.headers['x-ms-client-principal']) || '';
    const isAuthenticated = !!clientPrincipal;
    if (!storage.validateSecret(secret) && !isAuthenticated) {
      context.res = {
        status: 403,
        headers: corsHeaders,
        body: { error: 'Invalid write secret and no authenticated user' }
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

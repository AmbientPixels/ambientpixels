const storage = require('../_utils/companyStorage');
const runSocialEngagementPull = require('../socialEngagementPull/index');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, headers: CORS, body: { error: 'Method not allowed' } };
    return;
  }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
    return;
  }

  try {
    await runSocialEngagementPull(context);

    const meta = (await storage.getState('socialEngagementMeta')) || {};
    const snapshots = (await storage.getState('socialEngagementSnapshots')) || [];

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        ok: true,
        lastPulledAt: (meta && meta.lastPulledAt) || null,
        snapshotCount: Array.isArray(snapshots) ? snapshots.length : 0
      }
    };
  } catch (err) {
    context.log.error('[social-engagement-pull-now] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to run engagement pull now', details: err && err.message ? err.message : String(err) }
    };
  }
};

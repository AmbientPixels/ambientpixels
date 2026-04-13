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

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !principal) {
    context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
    return;
  }

  try {
    // Phase 5: read from socialIntel
    var _siBeforeRaw = (await storage.getState('socialIntel')) || {};
    const beforeSnapshots = _siBeforeRaw.engagementSnapshots || [];
    const beforeCount = Array.isArray(beforeSnapshots) ? beforeSnapshots.length : 0;

    await runSocialEngagementPull(context);

    var _siAfterRaw = (await storage.getState('socialIntel')) || {};
    const meta = _siAfterRaw.engagementMeta || {};
    const snapshots = _siAfterRaw.engagementSnapshots || [];
    const totalCount = Array.isArray(snapshots) ? snapshots.length : 0;
    const added = Math.max(0, totalCount - beforeCount);
    const newRows = added > 0 ? snapshots.slice(totalCount - added) : [];

    const platformErrors = {
      x: 0,
      linkedin: 0,
      bluesky: 0
    };
    for (let i = 0; i < newRows.length; i++) {
      const row = newRows[i] || {};
      const platform = String(row.post_platform || '').toLowerCase();
      const hasError = !!(row.meta && row.meta.error_class);
      if (hasError && platformErrors[platform] !== undefined) {
        platformErrors[platform] += 1;
      }
    }

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        ok: true,
        lastPulledAt: (meta && meta.lastPulledAt) || null,
        snapshotCount: totalCount,
        snapshotsAdded: added,
        run: {
          snapshotsAdded: added,
          platformErrors: platformErrors
        }
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

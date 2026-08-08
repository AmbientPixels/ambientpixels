// as-prospect-trigger — HTTP wrapper to manually run the prospect pipeline.
// Mirrors rewards-engine-trigger / milestone-herald-trigger. POST /api/as-prospect-trigger
// For post-deploy verification without waiting for the 2h timer.

const storage = require('../_utils/companyStorage');
const { runProspectPipeline, runRoastLane } = require('../companyHeartbeat/prospect-pipeline');
// Bluesky discovery + the participation lane ride asProspectCron alongside the
// two lanes above, so they belong in the manual trigger for the same reason the
// others do: verifying a deploy should not mean waiting up to 2h for the timer.
const { runBlueskyDiscovery } = require('../companyHeartbeat/bluesky-sensor');
const { runParticipationLane } = require('../companyHeartbeat/bluesky-participation');

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
    const _log = function () { context.log.apply(context, arguments); };
    // ?lane=roast runs only the roast lane (post-deploy verification); default runs both.
    const laneParam = (req.query && req.query.lane) || (req.body && req.body.lane) || '';
    const _all = laneParam === '' || laneParam === 'all';
    let result = null, roast = null, bluesky = null, participation = null;
    if (_all || laneParam === 'prospect') result = await runProspectPipeline({ storage: storage, log: _log });
    if (_all || laneParam === 'roast') roast = await runRoastLane({ storage: storage, log: _log });
    // Discovery BEFORE participation, same order as the cron: the lane should be
    // able to draft from threads found seconds ago rather than the previous pass.
    if (_all || laneParam === 'bluesky') bluesky = await runBlueskyDiscovery({ storage: storage, log: _log });
    if (_all || laneParam === 'participation') participation = await runParticipationLane({ storage: storage, log: _log });
    context.res = { status: 200, headers: corsHeaders, body: { status: 'ok', result: result, roast: roast, bluesky: bluesky, participation: participation } };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err).substring(0, 300) } };
  }
};

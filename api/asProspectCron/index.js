// asProspectCron — AmbientScore outbound prospect pipeline (every 2h at :20).
// Thin timer shell; all logic lives in companyHeartbeat/prospect-pipeline.js.
// Spec: docs/superpowers/specs/2026-07-21-as-prospect-pipeline-design.md

const storage = require('../_utils/companyStorage');
const demoGuard = require('../_utils/demoGuard');
const { runProspectPipeline, runRoastLane } = require('../companyHeartbeat/prospect-pipeline');
const { runBlueskyDiscovery } = require('../companyHeartbeat/bluesky-sensor');
const { runParticipationLane } = require('../companyHeartbeat/bluesky-participation');

module.exports = async function (context) {
  if (demoGuard.timerSkip(context)) return;
  context.log('[asProspectCron] start');
  try {
    const summary = await runProspectPipeline({ storage: storage, log: context.log });
    context.log('[asProspectCron] done:', JSON.stringify(summary));
  } catch (err) {
    context.log.error('[asProspectCron] failed (non-fatal):', (err && err.message) || String(err));
  }
  // Resume Roast lane rides the same timer — independently enabled/capped via
  // systemConfig.roastProspecting; a failure in either lane never blocks the other.
  try {
    const roast = await runRoastLane({ storage: storage, log: context.log });
    context.log('[asProspectCron] roast lane done:', JSON.stringify(roast));
  } catch (err) {
    context.log.error('[asProspectCron] roast lane failed (non-fatal):', (err && err.message) || String(err));
  }
  // Bluesky discovery rides this timer because its 2h cooldown matches this
  // cron's cadence exactly, and because its old home does not run any more:
  // the sensor lived inside runAgentHeartbeat under `if (agentId === 'scout')`,
  // and the idle-agent gate (2026-08-07) skips Scout on every cycle where it
  // holds no tasks. Scout was skipped 7 cycles running and blueskyCandidates
  // went 25.7h stale. Discovery makes no LLM call, so it never belonged behind
  // a gate that asks whether an agent has anything to think about.
  try {
    const bsky = await runBlueskyDiscovery({ storage: storage, log: context.log });
    context.log('[asProspectCron] bluesky discovery:', JSON.stringify(bsky));
  } catch (err) {
    context.log.error('[asProspectCron] bluesky discovery failed (non-fatal):', (err && err.message) || String(err));
  }
  // Participation lane runs AFTER discovery so it can draft from threads found
  // moments ago rather than from the previous pass. Default OFF via
  // systemConfig.blueskyParticipation.enabled — a lane that talks to strangers
  // as the brand does not self-start.
  try {
    const part = await runParticipationLane({ storage: storage, log: context.log });
    context.log('[asProspectCron] participation lane:', JSON.stringify(part));
  } catch (err) {
    context.log.error('[asProspectCron] participation lane failed (non-fatal):', (err && err.message) || String(err));
  }
};

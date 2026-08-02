// asProspectCron — AmbientScore outbound prospect pipeline (every 2h at :20).
// Thin timer shell; all logic lives in companyHeartbeat/prospect-pipeline.js.
// Spec: docs/superpowers/specs/2026-07-21-as-prospect-pipeline-design.md

const storage = require('../_utils/companyStorage');
const demoGuard = require('../_utils/demoGuard');
const { runProspectPipeline, runRoastLane } = require('../companyHeartbeat/prospect-pipeline');

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
};

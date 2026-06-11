// autoPublishGrace — Timer Trigger (hourly at :30, offset from the heartbeat at :00)
// Phase C of the Full Autonomy Roadmap: advisory social posts that passed the
// composed quality gate auto-approve after systemConfig.autoPublish.graceHours
// with no CEO action. Core logic lives in _utils/graceWindow.js (shared with the
// manual auto-publish-grace-trigger endpoint).

const { runGraceWindow } = require('../_utils/graceWindow');

module.exports = async function (context) {
  const demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;
  try {
    const result = await runGraceWindow(context);
    context.log('[GraceWindow] cycle done:', JSON.stringify(result));
  } catch (err) {
    context.log.error('[GraceWindow] failed (non-fatal, next hour retries):', String(err).substring(0, 300));
  }
};

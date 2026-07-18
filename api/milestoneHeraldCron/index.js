// milestoneHeraldCron — Timer Trigger (daily @ 16:10 UTC, after the hourly
// rewards engine's :30 run).
//
// Turns REAL agentRewards milestones (level-ups, badges, streaks) into grounded
// social-post tasks under the Milestone Herald campaign. Silence is the default:
// no milestone → no task. Toggle + caps live in systemConfig.milestoneHerald.
// Standalone — no heartbeat edits. See companyHeartbeat/milestone-herald.js.

const storage = require('../_utils/companyStorage');
const demoGuard = require('../_utils/demoGuard');
const { runMilestoneHerald } = require('../companyHeartbeat/milestone-herald');

module.exports = async function (context) {
  if (demoGuard.timerSkip(context)) return;
  context.log('[milestoneHeraldCron] start');
  try {
    const summary = await runMilestoneHerald({
      storage: storage,
      nowMs: Date.now(),
      log: function () { context.log.apply(context, arguments); }
    });
    context.log('[milestoneHeraldCron] summary:', JSON.stringify(summary));
  } catch (err) {
    context.log.error('[milestoneHeraldCron] failed:', (err && err.message) || err);
  }
};

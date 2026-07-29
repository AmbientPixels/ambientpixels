// socialAccountStatsRefreshCron — Timer Trigger (daily @ 05:40 UTC, ahead of the 06:00 heartbeat)
//
// Refreshes the socialAccountStats state key (follower counts + recent posts for
// x/linkedin/bluesky) so agent intel stays current without anyone opening a
// dashboard. Previously the cache only refreshed on dashboard visits, so agents
// could read week-old follower counts. Reuses the HTTP endpoint's pull logic.

const demoGuard = require('../_utils/demoGuard');
const { refreshAccountStats } = require('../socialAccountStats/index');

module.exports = async function (context) {
  if (demoGuard.timerSkip(context)) return;

  try {
    const payload = await refreshAccountStats();
    context.log('[socialAccountStatsRefreshCron] Refreshed:',
      (payload.totals && payload.totals.followers) + ' followers across ' +
      (payload.totals && payload.totals.platforms_connected) + ' platforms' +
      (payload.errors && payload.errors.length ? ' | errors: ' + payload.errors.join(' ; ') : ''));
  } catch (err) {
    context.log.error('[socialAccountStatsRefreshCron] Failed:', err && err.message ? err.message : err);
  }
};

// releaseWatchCron — Timer Trigger (03:20 / 09:20 / 15:20 / 21:20 UTC, between heartbeats).
//
// Reads what is live on ambientpixels.ai and logs product releases to `releaseLog`.
// Video Desk spec §3a. Standalone — no heartbeat edits. Core: _lib/releaseWatch/watcher.js.
// Toggle: systemConfig.releaseWatch.enabled === false stops it.

const storage = require('../_utils/companyStorage');
const demoGuard = require('../_utils/demoGuard');
const { runReleaseWatch } = require('../_lib/releaseWatch/watcher');
const { callWithModel } = require('../companyHeartbeat/gemini');

module.exports = async function (context) {
  if (demoGuard.timerSkip(context)) return;
  try {
    const cfg = (await storage.getState('systemConfig')) || {};
    if (cfg.releaseWatch && cfg.releaseWatch.enabled === false) {
      context.log('[releaseWatchCron] disabled by systemConfig.releaseWatch.enabled');
      return;
    }
    const { summary } = await runReleaseWatch({
      storage: storage,
      fetch: fetch,
      llm: function (prompt) { return callWithModel(prompt, 'release-watcher', 'claude-haiku'); },
      token: process.env.RELEASE_WATCH_GITHUB_TOKEN || null,
      log: function () { context.log.apply(context, arguments); }
    });
    context.log('[releaseWatchCron] summary:', JSON.stringify(summary));
  } catch (err) {
    context.log.error('[releaseWatchCron] failed:', (err && err.message) || err);
  }
};

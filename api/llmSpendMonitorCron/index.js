// llmSpendMonitorCron — watches what the public products spend on Claude, and
// says something BEFORE the credits run out.
//
// WHY (2026-08-07): the products bill per call and nothing watched the meter.
// The balance could be read from the Costs page, but only by someone who went
// and looked; no alarm existed. The first symptom of exhausted credits would
// have been customers getting errors.
//
// Since _lib/llm now falls back to Gemini, the failure mode got QUIETER, not
// louder: with no credits the product keeps answering, quality silently drops,
// and nobody finds out. So the fallback log is treated as the primary alarm —
// a fallback with reason=credits means Anthropic refused for billing, and it
// fires while everything still looks fine from outside.
//
// All decisions live in _lib/llm/spendMonitor (pure, tested). This file only
// does the I/O: read state, dispatch Discord, write state back.

const storage = require('../_utils/companyStorage');
const { dispatchDiscord } = require('../_utils/fleetAlerts');
const monitor = require('../_lib/llm/spendMonitor');

const STATE_KEY = 'llmSpendMonitorState';

const COLOR = { critical: 0xC62828, warn: 0xF9A825 };

module.exports = async function (context) {
  try {
    const [claudeUsage, geminiUsage, fallbackLog, systemConfig, prevState] = await Promise.all([
      storage.getState('claudeUsage').then(v => v || []),
      storage.getState('geminiUsage').then(v => v || []),
      storage.getState('llmFallbackLog').then(v => v || []),
      storage.getState('systemConfig').then(v => v || {}),
      storage.getState(STATE_KEY).then(v => v || null)
    ]);

    const report = monitor.summarize({
      claudeUsage,
      geminiUsage,
      fallbackLog,
      anthropicCredits: systemConfig.anthropicCredits,
      nowMs: Date.now()
    });

    const { alerts, nextState } = monitor.decideAlerts(report, prevState, Date.now());

    context.log('[llmSpendMonitor] 24h $' + report.spend24hUsd +
      ' | burn $' + report.dailyBurnUsd + '/day' +
      ' | runway ' + (report.runwayDays === null ? 'n/a' : report.runwayDays + 'd') +
      ' | fallbacks24h ' + report.fallbacks24h +
      ' | alerts ' + alerts.length);

    for (const a of alerts) {
      const ok = await dispatchDiscord({
        title: (a.severity === 'critical' ? '🔴 ' : '🟠 ') + a.title,
        description: a.description +
          '\n\nBurn: $' + report.dailyBurnUsd + '/day (24h: $' + report.spend24hUsd + ')' +
          (report.balanceConfigured
            ? '\nRemaining: $' + report.remainingUsd + ' (~' + report.runwayDays + ' days)'
            : '\nNo balance recorded — set it on the Costs page to get runway warnings.'),
        color: COLOR[a.severity] || COLOR.warn
      });
      // context.log is callable and carries .error/.warn/.info — but NOT .log,
      // so index into it and the first alert of the run throws.
      if (ok) context.log('[llmSpendMonitor] alert ' + a.key + ' dispatched');
      else context.log.warn('[llmSpendMonitor] alert ' + a.key + ' NOT dispatched (no DISCORD_ALERT_WEBHOOK?)');
    }

    // Written last: if the dispatch above threw, we would rather re-alert next
    // run than record a warning that never reached anyone.
    await storage.setState(STATE_KEY, nextState);
  } catch (err) {
    // A monitor that takes the app down with it is worse than one that misses a
    // cycle. Log and let the next run try again.
    context.log.error('[llmSpendMonitor] failed:', err.message);
  }
};

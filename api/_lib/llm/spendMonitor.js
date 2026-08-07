// spendMonitor — "tell me BEFORE we run out of credits", as pure functions.
//
// WHY (2026-08-07): the public products bill per call and nothing watched the
// meter. `llmCredits` could report a balance, but only if someone opened the
// Costs page and looked. Nothing alerted. The first sign of exhausted credits
// would have been customers getting errors — and now that _lib/llm falls back
// to Gemini, it would be even quieter: the product keeps working, quality
// quietly drops, and the Anthropic balance is still zero.
//
// That fallback is exactly why the fallback LOG is the best leading indicator
// we have. A run served by Gemini means Claude refused, and `reason: 'credits'`
// means it refused for billing. That is the alarm, and it fires while the
// product is still up.
//
// Pure on purpose: no storage, no network, no clock. The cron passes state in
// and dispatches what comes out, so every threshold is testable without
// waiting for a real outage to find out whether the alert fires.

// Claude runs on both rails: fleet calls land in `geminiUsage` (with model
// claude-*), product calls in `claudeUsage`. Reading one is half the bill.
function isClaudeEntry(u) {
  return u && typeof u.model === 'string' && u.model.indexOf('claude') === 0;
}

const DAY_MS = 86400000;

// Thresholds. Deliberately conservative: a monitor that cries wolf gets muted,
// and a muted monitor is worse than none.
const RUNWAY_CRITICAL_DAYS = 3;
const RUNWAY_WARN_DAYS = 10;
const BURN_SPIKE_MULTIPLE = 3;
// Below this, a "3x spike" is noise — $0.10 to $0.40 is not an incident.
const BURN_SPIKE_FLOOR_USD = 5;
const ALERT_COOLDOWN_MS = 12 * 3600000;

/**
 * Summarise spend and provider health.
 *
 * @param {object} input
 * @param {Array}  input.claudeUsage   - `claudeUsage` state
 * @param {Array}  input.geminiUsage   - `geminiUsage` state
 * @param {Array}  input.fallbackLog   - `llmFallbackLog` state (written by _lib/llm)
 * @param {object} [input.anthropicCredits] - systemConfig.anthropicCredits { balanceUsd, asOf }
 * @param {number} input.nowMs
 */
function summarize(input) {
  const now = input.nowMs;
  const claude = (input.claudeUsage || []).filter(isClaudeEntry)
    .concat((input.geminiUsage || []).filter(isClaudeEntry));

  const since = ms => new Date(now - ms).toISOString();
  const sum = (rows) => rows.reduce((t, u) => t + (u.totalCost || 0), 0);

  const spend24h = sum(claude.filter(u => u.timestamp >= since(DAY_MS)));
  const spend7d = sum(claude.filter(u => u.timestamp >= since(7 * DAY_MS)));
  const dailyBurn = spend7d / 7;

  // Runway needs a balance the CEO recorded by hand — Anthropic has no balance
  // API. Absent that, report burn and say so rather than inventing a number.
  let remainingUsd = null;
  let runwayDays = null;
  const cfg = input.anthropicCredits;
  if (cfg && typeof cfg.balanceUsd === 'number' && cfg.asOf) {
    remainingUsd = cfg.balanceUsd - sum(claude.filter(u => u.timestamp >= cfg.asOf));
    // A zero-burn week would divide to Infinity; report null instead of "forever".
    runwayDays = dailyBurn > 0 ? remainingUsd / dailyBurn : null;
  }

  const recentFallbacks = (input.fallbackLog || []).filter(e => e && e.ts >= since(DAY_MS));
  const creditFallbacks = recentFallbacks.filter(e => e.reason === 'credits');
  // to === null means no model in the chain answered: the product is DOWN, not degraded.
  const chainExhausted = recentFallbacks.filter(e => e.to === null);

  return {
    spend24hUsd: round(spend24h),
    spend7dUsd: round(spend7d),
    dailyBurnUsd: round(dailyBurn),
    remainingUsd: remainingUsd === null ? null : round(remainingUsd),
    runwayDays: runwayDays === null ? null : Math.round(runwayDays * 10) / 10,
    balanceConfigured: remainingUsd !== null,
    fallbacks24h: recentFallbacks.length,
    creditFallbacks24h: creditFallbacks.length,
    chainExhausted24h: chainExhausted.length,
    topCallers: topBy(claude.filter(u => u.timestamp >= since(7 * DAY_MS)), 'caller')
  };
}

function round(n) { return Math.round((n || 0) * 10000) / 10000; }

function topBy(rows, key) {
  const acc = {};
  for (const r of rows) acc[r[key] || 'unknown'] = (acc[r[key] || 'unknown'] || 0) + (r.totalCost || 0);
  return Object.keys(acc)
    .map(k => ({ [key]: k, usd: round(acc[k]) }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);
}

/**
 * Decide what to alert on. Edge-triggered with a cooldown, so a condition that
 * persists for days does not post every run.
 *
 * @returns {{alerts: Array, nextState: object}}
 */
function decideAlerts(report, prevState, nowMs) {
  const prev = prevState || {};
  const fired = prev.firedAt || {};
  const alerts = [];

  const consider = (key, severity, title, description) => {
    const last = fired[key] ? new Date(fired[key]).getTime() : 0;
    if (nowMs - last < ALERT_COOLDOWN_MS) return;
    alerts.push({ key, severity, title, description });
  };

  // 1. The product is actually failing. Most urgent — a customer is seeing it.
  if (report.chainExhausted24h > 0) {
    consider('chain-exhausted', 'critical',
      'LLM chain exhausted — public products erroring',
      report.chainExhausted24h + ' request(s) in 24h had EVERY model fail. Users saw an error, not a degraded answer. Check ANTHROPIC_API_KEY, GEMINI_API_KEY, and both providers\' status.');
  }

  // 2. Claude is refusing for billing. The product still works (Gemini answers),
  //    which is precisely why this needs saying out loud — it is invisible.
  if (report.creditFallbacks24h > 0) {
    consider('credit-fallback', 'critical',
      'Anthropic is refusing calls — billing/credits',
      report.creditFallbacks24h + ' call(s) in 24h fell back to Gemini with reason=credits. The product is UP but running on the backup model. Top up Anthropic.');
  }

  // 3. Runway. Only meaningful once a balance has been recorded.
  if (report.runwayDays !== null) {
    if (report.runwayDays < RUNWAY_CRITICAL_DAYS) {
      consider('runway-critical', 'critical',
        'Anthropic credits run out in ~' + report.runwayDays + ' days',
        '$' + report.remainingUsd + ' left, burning $' + report.dailyBurnUsd + '/day.');
    } else if (report.runwayDays < RUNWAY_WARN_DAYS) {
      consider('runway-warn', 'warn',
        'Anthropic credits below ' + RUNWAY_WARN_DAYS + ' days',
        '~' + report.runwayDays + ' days left. $' + report.remainingUsd + ' at $' + report.dailyBurnUsd + '/day.');
    }
  }

  // 4. Burn spike — the shape of an abuse run or a runaway retry loop. Floor
  //    prevents alerting on a 3x jump between two rounding errors.
  if (report.spend24hUsd >= BURN_SPIKE_FLOOR_USD &&
      report.dailyBurnUsd > 0 &&
      report.spend24hUsd > report.dailyBurnUsd * BURN_SPIKE_MULTIPLE) {
    consider('burn-spike', 'warn',
      'Claude spend spiked',
      'Last 24h: $' + report.spend24hUsd + ' vs a 7-day average of $' + report.dailyBurnUsd +
      '/day. Top callers: ' + report.topCallers.map(c => c.caller + ' $' + c.usd).join(', '));
  }

  const nextFired = Object.assign({}, fired);
  for (const a of alerts) nextFired[a.key] = new Date(nowMs).toISOString();

  return {
    alerts,
    nextState: { firedAt: nextFired, lastRunAt: new Date(nowMs).toISOString(), lastReport: report }
  };
}

module.exports = {
  summarize,
  decideAlerts,
  isClaudeEntry,
  RUNWAY_CRITICAL_DAYS,
  RUNWAY_WARN_DAYS,
  BURN_SPIKE_MULTIPLE,
  BURN_SPIKE_FLOOR_USD,
  ALERT_COOLDOWN_MS
};

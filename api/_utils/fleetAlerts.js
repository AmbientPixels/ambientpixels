// fleetAlerts.js — detect fleet throughput collapse and alert the CEO via Discord.
//
// Runs off the keepalive path (~every 5 min), so a collapse is caught within minutes
// instead of the 24h emergence-cron lag — and the alerting stays OUT of the heartbeat
// pump. Reuses the emergence _computeThroughputCollapse so the "collapse" definition
// never drifts. No-op if DISCORD_ALERT_WEBHOOK is unset (safe on any environment).
//
// State: `fleetAlertState` = { collapsed, lastAlertAt, lastLevel } (edge-triggered,
// so we alert on the transition, not every 5 min). `alerts` = ring buffer (last 50).

var fetch = require('node-fetch');
var { _computeThroughputCollapse } = require('../companyHeartbeat/emergence-intel');

var ALERT_STATE_KEY = 'fleetAlertState';
var ALERTS_LOG_KEY = 'alerts';
var REMIND_COOLDOWN_MS = 6 * 60 * 60 * 1000; // while still down, re-ping at most every 6h

var COLOR_RED = 14356815;   // 0xd9092f-ish red
var COLOR_GREEN = 2667128;  // green

// POST a Discord embed to the configured webhook. Returns true on success, false if
// no webhook is configured or the call fails. Never throws.
async function dispatchDiscord(embed) {
  var url = process.env.DISCORD_ALERT_WEBHOOK;
  if (!url) return false;
  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'AmbientOS Alerts', embeds: [embed] })
    });
    return !!(res && (res.ok || res.status === 204));
  } catch (e) { return false; }
}

// Pure decision: given the current collapse signal (or null), prior state, and now,
// decide what to do. Edge-triggered with a remind cooldown while still collapsed.
// Returns { action: 'alert-collapse'|'alert-recover'|'remind'|'none', collapsed }.
function decideAlertAction(signal, prevState, nowMs) {
  var wasCollapsed = !!(prevState && prevState.collapsed);
  var isCollapsed = !!(signal && signal.level === 'RED');
  if (isCollapsed && !wasCollapsed) return { action: 'alert-collapse', collapsed: true };
  if (!isCollapsed && wasCollapsed) return { action: 'alert-recover', collapsed: false };
  if (isCollapsed && wasCollapsed) {
    var last = (prevState && prevState.lastAlertAt) ? new Date(prevState.lastAlertAt).getTime() : 0;
    if (nowMs - last >= REMIND_COOLDOWN_MS) return { action: 'remind', collapsed: true };
    return { action: 'none', collapsed: true };
  }
  return { action: 'none', collapsed: false };
}

// Read heartbeatRuns, evaluate throughput collapse, and alert on the RED transition
// (and on recovery). storage = _utils/companyStorage. Returns a small result object;
// never throws (all failures are swallowed and reported in the return value).
async function checkAndAlertFleetHealth(storage, nowMsIn) {
  var nowMs = Number.isFinite(nowMsIn) ? nowMsIn : Date.now();
  try {
    var runs = (await storage.getState('heartbeatRuns')) || [];
    if (!Array.isArray(runs) || runs.length === 0) return { ok: true, action: 'none', reason: 'no-runs' };

    var res = _computeThroughputCollapse(runs, nowMs) || {};
    var signal = (res.signals || []).find(function (s) { return s && s.signalType === 'throughput-collapse' && s.level === 'RED'; }) || null;

    var prev = (await storage.getState(ALERT_STATE_KEY)) || {};
    var decision = decideAlertAction(signal, prev, nowMs);

    if (decision.action === 'none') {
      if (prev.collapsed !== decision.collapsed) {
        prev.collapsed = decision.collapsed;
        prev.updatedAt = new Date(nowMs).toISOString();
        await storage.setState(ALERT_STATE_KEY, prev);
      }
      return { ok: true, action: 'none', collapsed: decision.collapsed };
    }

    var embed, logEntry;
    if (decision.action === 'alert-collapse' || decision.action === 'remind') {
      var detail = (signal && signal.signal) || 'Fleet throughput collapsed.';
      var rec = (signal && signal.recommendation) || '';
      embed = {
        title: decision.action === 'remind' ? '🔴 Fleet STILL down' : '🔴 Fleet throughput collapsed',
        description: (detail + (rec ? '\n\n**Likely cause:** ' + rec : '')).slice(0, 3900),
        color: COLOR_RED,
        timestamp: new Date(nowMs).toISOString()
      };
      logEntry = { type: 'throughput-collapse', level: 'RED', detail: detail, at: new Date(nowMs).toISOString() };
    } else { // alert-recover
      embed = {
        title: '✅ Fleet recovered',
        description: 'Heartbeat throughput is back to normal — agents are executing actions again.',
        color: COLOR_GREEN,
        timestamp: new Date(nowMs).toISOString()
      };
      logEntry = { type: 'throughput-recovered', level: 'OK', at: new Date(nowMs).toISOString() };
    }

    var sent = await dispatchDiscord(embed);

    prev.collapsed = decision.collapsed;
    prev.lastAlertAt = new Date(nowMs).toISOString();
    prev.lastLevel = logEntry.level;
    prev.updatedAt = prev.lastAlertAt;
    await storage.setState(ALERT_STATE_KEY, prev);

    try {
      var alerts = (await storage.getState(ALERTS_LOG_KEY)) || [];
      if (!Array.isArray(alerts)) alerts = [];
      logEntry.delivered = sent;
      alerts.push(logEntry);
      await storage.setState(ALERTS_LOG_KEY, alerts.slice(-50));
    } catch (_e) { /* non-fatal */ }

    return { ok: true, action: decision.action, delivered: sent };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  checkAndAlertFleetHealth: checkAndAlertFleetHealth,
  decideAlertAction: decideAlertAction,
  dispatchDiscord: dispatchDiscord
};

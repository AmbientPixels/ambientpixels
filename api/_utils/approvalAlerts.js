// approvalAlerts.js — ping the CEO's Discord when something waits for approval.
//
// Approval latency is the slowest human stage in every pipeline: copy can
// clear Scribe, Quill and the quality gate inside one heartbeat and then sit
// unseen in the Action Center for hours. This routes the approve loop to a
// phone. Runs off the keepalive path (~5 min) beside checkAndAlertFleetHealth,
// and is edge-triggered: it alerts on NEW pending items, with a cooldown so a
// heartbeat that mints several actions produces one ping, not five.
//
// State key `approvalAlertState` is companyStorage-direct (like
// fleetAlertState) — NOT a company-state VALID_KEY.

var { dispatchDiscord } = require('./fleetAlerts');

var STATE_KEY = 'approvalAlertState';
var COOLDOWN_MS = 30 * 60 * 1000;
var ACTION_CENTER_URL = 'https://www.ambientpixels.ai/modules/company/actions.html';
var COLOR_AMBER = 0xF9A825;

// Pure. Union of pending items across the actions store (ground truth the
// execute gate reads) and approvalQueue (docs and other non-action approvals),
// deduped by action id so an aq- mirror is not counted twice.
function collectPending(actions, approvalQueue) {
  var out = [];
  var seen = {};
  (Array.isArray(actions) ? actions : []).forEach(function (a) {
    if (!a || !a.approval || a.approval.status !== 'pending') return;
    seen[a.id] = true;
    var text = String((a.payload && a.payload.text) || '').replace(/\s+/g, ' ').slice(0, 60);
    out.push({ id: a.id, label: (a.platform || 'action') + ' · ' + (a.type || '?') + (text ? ' · "' + text + '"' : '') });
  });
  (Array.isArray(approvalQueue) ? approvalQueue : []).forEach(function (q) {
    if (!q || q.status !== 'pending') return;
    var ref = q.action_id || q.id;
    if (seen[ref]) return;
    seen[ref] = true;
    out.push({ id: ref, label: (q.kind || q.type || 'item') + ' · ' + String(q.title || '').slice(0, 60) });
  });
  return out;
}

// Pure. prevState = { alertedIds: [], lastAlertAt: iso } or null.
// Alert when there are pending ids we have not alerted on AND the cooldown has
// passed. Deferred ids are deliberately NOT marked alerted, so the cooldown
// delays a ping but never swallows one. An empty queue resets state.
function decideApprovalAlert(pendingIds, prevState, nowMs) {
  var alerted = (prevState && Array.isArray(prevState.alertedIds)) ? prevState.alertedIds : [];
  var lastAt = (prevState && prevState.lastAlertAt) ? new Date(prevState.lastAlertAt).getTime() : 0;
  pendingIds = Array.isArray(pendingIds) ? pendingIds : [];

  if (pendingIds.length === 0) {
    return { action: 'none', newIds: [], state: { alertedIds: [], lastAlertAt: prevState && prevState.lastAlertAt || null } };
  }

  // Prune ids that were decided elsewhere so the list cannot grow forever.
  var stillAlerted = alerted.filter(function (id) { return pendingIds.indexOf(id) !== -1; });
  var newIds = pendingIds.filter(function (id) { return stillAlerted.indexOf(id) === -1; });

  if (newIds.length === 0) {
    return { action: 'none', newIds: [], state: { alertedIds: stillAlerted, lastAlertAt: prevState && prevState.lastAlertAt || null } };
  }
  if (nowMs - lastAt < COOLDOWN_MS) {
    return { action: 'none', newIds: newIds, state: { alertedIds: stillAlerted, lastAlertAt: prevState && prevState.lastAlertAt || null } };
  }
  return {
    action: 'alert',
    newIds: newIds,
    state: { alertedIds: stillAlerted.concat(newIds), lastAlertAt: new Date(nowMs).toISOString() }
  };
}

// Read state, decide, ping, persist. Never throws — a failed alert must never
// take the keepalive path down with it.
async function checkAndAlertPendingApprovals(storage, nowMsIn) {
  var nowMs = Number.isFinite(nowMsIn) ? nowMsIn : Date.now();
  try {
    var actions = (await storage.getState('actions')) || [];
    var aq = [];
    try { aq = (await storage.getState('approvalQueue')) || []; } catch (e) { aq = []; }
    var pending = collectPending(actions, aq);
    var prev = null;
    try { prev = await storage.getState(STATE_KEY); } catch (e) { prev = null; }

    var d = decideApprovalAlert(pending.map(function (p) { return p.id; }), prev, nowMs);

    if (d.action === 'alert') {
      var lines = pending.slice(0, 5).map(function (p) { return '• ' + p.label; });
      if (pending.length > 5) lines.push('…and ' + (pending.length - 5) + ' more');
      await dispatchDiscord({
        title: pending.length + ' item' + (pending.length === 1 ? '' : 's') + ' waiting for your approval',
        description: lines.join('\n') + '\n\n[Open the Action Center](' + ACTION_CENTER_URL + ')',
        color: COLOR_AMBER
      });
    }

    // Persist on every run where state changed (alert, prune, or reset).
    var prevIds = (prev && prev.alertedIds) || [];
    var changed = d.action === 'alert'
      || prevIds.length !== d.state.alertedIds.length
      || prevIds.some(function (id, i) { return d.state.alertedIds[i] !== id; });
    if (changed) await storage.setState(STATE_KEY, d.state);

    return { ok: true, action: d.action, pending: pending.length, newIds: d.newIds.length };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

module.exports = { collectPending, decideApprovalAlert, checkAndAlertPendingApprovals, COOLDOWN_MS };

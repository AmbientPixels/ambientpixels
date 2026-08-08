// action-persist.js — surgical, conflict-safe persistence of execution state.
//
// Root cause of the 2026-08-08 duplicate-post incident: this function's caller
// read the whole actions array, held it across a 15-60s public platform call,
// and wrote the stale snapshot back. Concurrent writers (heartbeat cycles
// write the same array) meant one side clobbered the other — a successful
// post's receipt could vanish, stranding the action at 'running', and the
// pre-d124fff3 recovery then re-posted it publicly.
//
// syncExecutionState writes ONLY the fields actionsExecute owns — execution,
// execution_status, telemetry — onto the FRESH stored copy of one action,
// under companyStorage.mutateState (ETag retry). Every other field on the
// action, and every other action in the array, is whatever the store holds at
// write time.

const LIVE_ACTIONS_RETENTION_DAYS = 90;
const LIVE_ACTIONS_MAX_COUNT = 2000;

// Pure. Same retention semantics persistActionsWithTrim always had: drop
// entries older than 90d (by finish/create time), preserve entries with no
// parseable timestamp, cap the array at the newest 2000.
function trimActions(actions, nowMs) {
  if (!Array.isArray(actions)) return actions;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoff = now - LIVE_ACTIONS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let trimmed = actions.filter(function (a) {
    if (!a) return false;
    const tsStr = (a.execution && a.execution.finished_at) || a.created_at || a.timestamp || a.createdAt || '';
    const ts = Date.parse(tsStr);
    return !Number.isFinite(ts) || ts >= cutoff;
  });
  if (trimmed.length > LIVE_ACTIONS_MAX_COUNT) {
    trimmed = trimmed.slice(-LIVE_ACTIONS_MAX_COUNT);
  }
  return trimmed;
}

/**
 * Copy the execution-owned fields of `localAction` onto the current stored
 * copy of the same action. Never throws.
 * @returns {Promise<{ok:boolean, applied:boolean, error?:string}>}
 *   ok=false    → the write could not land (caller must log LOUDLY: for a
 *                 public post this is a receipt that exists only in memory).
 *   applied=false → the action id is no longer in the store (trimmed or
 *                 archived); nothing was written — a missing action must not
 *                 be resurrected by a late writer.
 */
async function syncExecutionState(storage, localAction) {
  let applied = false;
  try {
    const res = await storage.mutateState('actions', function (fresh) {
      const arr = Array.isArray(fresh) ? fresh.slice() : [];
      const idx = arr.findIndex(function (a) { return a && a.id === localAction.id; });
      if (idx === -1) { applied = false; return undefined; }
      applied = true;
      const merged = Object.assign({}, arr[idx], {
        execution: localAction.execution,
        execution_status: localAction.execution_status
      });
      if (localAction.telemetry) merged.telemetry = localAction.telemetry;
      arr[idx] = merged;
      return trimActions(arr);
    });
    if (!res || res.ok === false) return { ok: false, applied: false, error: 'mutateState reported not ok' };
    return { ok: true, applied: applied };
  } catch (err) {
    return { ok: false, applied: false, error: (err && err.message) || String(err) };
  }
}

module.exports = { syncExecutionState, trimActions, LIVE_ACTIONS_RETENTION_DAYS, LIVE_ACTIONS_MAX_COUNT };

// actionsArchiver/index.js — Archive + live-trim for the `actions` state store.
//
// Runs daily at 04:00 UTC (cron: 0 0 4 * * * — low-traffic window). Also runnable
// on demand via POST /api/actions-archiver-trigger.
//
// What it does:
//   1. Reads live `actions` state.
//   2. Archive phase — copies entries older than RETENTION_DAYS (any status) to
//      monthly cold-storage partitions in the `company-archive` container
//      (key format: actions-YYYY-MM.json). Dedup'd by action.id so re-runs are safe.
//   3. Trim phase (NEW) — removes from LIVE `actions` the entries that are both
//      older than RETENTION_DAYS AND terminal (posted=success, failed, rejected,
//      or cancelled). In-flight entries (pending / approved-not-yet-executed /
//      running) are KEPT regardless of age so nothing unfinished is ever dropped.
//      Trim only runs after a successful archive, so trimmed entries always have a
//      cold-storage copy first.
//   4. Writes a summary entry to governanceLog.
//
// Why terminal-only trim: the Approved/Scheduled and Exec-Log panels are driven by
// the live `actions` store. Finished work should age out (it lives in cold archive),
// but a stuck "approved-but-never-posted" action must stay visible until resolved.
//
// RETENTION_DAYS = 7 — keep the last week of finished actions live for the Exec Log;
// older finished actions move to cold storage only. (CEO-chosen 2026-06-23.)

const storage = require('../_utils/companyStorage');
const archive = require('../_utils/archiveStorage');

const RETENTION_DAYS = 7;
const GOV_LOG_CAP = 500; // matches MAX_GOVERNANCE_LOG_ENTRIES in constants.js

// Attribution-decay fix: when a finished action ages out of live `actions`, its
// actionId→{agent,campaignId} mapping would be lost — so a purchase whose UTM
// (first-touch, persisted in the buyer's localStorage indefinitely) points at that
// action lands unattributed. We persist a compact append-only index at archive time
// (companyStorage-direct key, not a company-state VALID_KEY) that the heartbeat's
// revenue→outcome join falls back to. Capped newest-first.
const ATTR_INDEX_KEY = 'actionAttributionIndex';
const ATTR_INDEX_CAP = 5000;

// ── Pure helpers (unit-tested in actionsArchiver.test.js) ──

function _actionTs(a) {
  const tsStr = (a && a.execution && a.execution.finished_at) || (a && (a.created_at || a.timestamp || a.createdAt));
  return Date.parse(tsStr || '');
}

// Terminal = the action has reached a final resting state. Mirrors _syncLegacy in
// js/agent-engine.js: rejected/cancelled approval, OR approved+execution success/failed.
// NON-terminal (kept live regardless of age): pending, approved-without-execution
// (the "stuck/scheduled" case), running.
function _isTerminalAction(a) {
  const appSt = (a && a.approval && a.approval.status) || '';
  const exSt = (a && a.execution && a.execution.status) || '';
  if (appSt === 'rejected' || appSt === 'cancelled') return true;
  const approved = appSt === 'approved' || appSt === 'overridden';
  if (approved && (exSt === 'success' || exSt === 'failed')) return true;
  return false;
}

// Pure planner: given the live actions + now, decide what to archive (cold backup)
// and what to trim from live. toArchive = ALL old entries (so every trim target is
// backed up first); toTrimIds = only the old TERMINAL ones.
function planArchiveAndTrim(actions, nowMs, ageDays) {
  const cutoff = nowMs - (ageDays * 24 * 60 * 60 * 1000);
  const toArchive = [];
  const toTrimIds = [];
  (Array.isArray(actions) ? actions : []).forEach(function (a) {
    if (!a) return;
    const ts = _actionTs(a);
    if (!Number.isFinite(ts) || ts >= cutoff) return; // recent or undated → keep, don't touch
    toArchive.push(a);
    if (_isTerminalAction(a) && a.id) toTrimIds.push(a.id);
  });
  return { toArchive: toArchive, toTrimIds: toTrimIds };
}

// Pure: extract actionId → { agent, campaignId, at } for the actions being archived.
// campaignId resolves from the action directly, else via its parent task. Only
// actions carrying at least an agent OR a campaign are indexed (others can't attribute).
function buildAttributionEntries(archivedActions, taskById, atMs) {
  const at = Number.isFinite(atMs) ? atMs : Date.now();
  const out = {};
  const tById = taskById || {};
  (Array.isArray(archivedActions) ? archivedActions : []).forEach(function (a) {
    if (!a || !a.id) return;
    const agent = a.created_by || a.createdBy || a.agentId || null;
    let campaignId = a.campaign_id || null;
    if (!campaignId && a._parentTaskId && tById[a._parentTaskId]) {
      campaignId = tById[a._parentTaskId].campaign_id || null;
    }
    if (!agent && !campaignId) return; // nothing attributable
    out[a.id] = { agent: agent, campaignId: campaignId, at: at };
  });
  return out;
}

// Pure: merge new attribution entries into the existing index blob, dedup by
// actionId (existing values win but backfill any missing agent/campaign), then cap
// to `cap` newest by `at`. Returns { map, updatedAt, count }.
function mergeAttributionIndex(existing, additions, cap, nowIso) {
  const capN = Number.isFinite(cap) ? cap : ATTR_INDEX_CAP;
  const map = (existing && existing.map && typeof existing.map === 'object') ? Object.assign({}, existing.map) : {};
  const adds = additions || {};
  Object.keys(adds).forEach(function (id) {
    if (map[id]) {
      const prev = map[id];
      map[id] = {
        agent: prev.agent || adds[id].agent || null,
        campaignId: prev.campaignId || adds[id].campaignId || null,
        at: prev.at || adds[id].at
      };
    } else {
      map[id] = adds[id];
    }
  });
  let ids = Object.keys(map);
  if (ids.length > capN) {
    ids.sort(function (x, y) { return (map[y].at || 0) - (map[x].at || 0); }); // newest first
    const keep = ids.slice(0, capN);
    const capped = {};
    keep.forEach(function (id) { capped[id] = map[id]; });
    return { map: capped, updatedAt: nowIso || new Date().toISOString(), count: keep.length };
  }
  return { map: map, updatedAt: nowIso || new Date().toISOString(), count: ids.length };
}

// ── Core run (shared by the timer module + the HTTP trigger) ──

async function runArchiver(opts) {
  opts = opts || {};
  const store = opts.storage || storage;
  const arch = opts.archive || archive;
  const nowMs = opts.nowMs || Date.now();
  const log = opts.log || function () {};
  const ageDays = Number.isFinite(opts.ageDays) ? opts.ageDays : RETENTION_DAYS;
  const runStartMs = nowMs;

  const actions = (await store.getState('actions')) || [];
  if (!Array.isArray(actions) || actions.length === 0) {
    log('[actionsArchiver] No actions to process — exiting');
    return { ok: true, archived: 0, trimmed: 0, kept: 0 };
  }

  const plan = planArchiveAndTrim(actions, nowMs, ageDays);

  if (plan.toArchive.length === 0) {
    log('[actionsArchiver] No entries older than ' + ageDays + ' days — nothing to archive/trim');
    await _appendRunSummary(store, { archived: 0, trimmed: 0, partitions: [], skipped: actions.length });
    return { ok: true, archived: 0, trimmed: 0, kept: actions.length };
  }

  // ── Archive phase: group by YYYY-MM, dedup by id, append ──
  const byMonth = {};
  plan.toArchive.forEach(function (a) {
    const d = new Date(_actionTs(a));
    const key = 'actions-' + d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(a);
  });

  const partitions = Object.keys(byMonth).sort();
  let totalArchived = 0;
  const partitionResults = [];
  let archiveOk = true;

  for (const partKey of partitions) {
    try {
      const newEntries = byMonth[partKey];
      const existing = await arch.readArchive(partKey, { limit: 999999 });
      const existingIds = new Set(existing.entries.map(function (e) { return e && e.id; }).filter(Boolean));
      const toAppend = newEntries.filter(function (a) { return a.id && !existingIds.has(a.id); });

      if (toAppend.length === 0) {
        partitionResults.push({ partition: partKey, added: 0, total: existing.total });
        continue;
      }
      const newTotal = await arch.appendArchive(partKey, toAppend);
      totalArchived += toAppend.length;
      partitionResults.push({ partition: partKey, added: toAppend.length, total: newTotal });
      log('[actionsArchiver] ' + partKey + ' — appended ' + toAppend.length + ' (total ' + newTotal + ')');
    } catch (partErr) {
      archiveOk = false;
      log('[actionsArchiver] ' + partKey + ' — archive FAILED, will skip trim: ' + (partErr && partErr.message));
    }
  }

  // ── Trim phase: only if archive succeeded (cold copy guaranteed first) ──
  let trimmed = 0;
  let keptCount = actions.length;
  if (archiveOk && plan.toTrimIds.length > 0) {
    const trimSet = new Set(plan.toTrimIds);
    const kept = actions.filter(function (a) { return !(a && trimSet.has(a.id)); });
    trimmed = actions.length - kept.length;
    keptCount = kept.length;
    if (trimmed > 0) {
      await store.setState('actions', kept);
      log('[actionsArchiver] Trimmed ' + trimmed + ' terminal action(s) >' + ageDays + 'd from live state');
    }
  } else if (!archiveOk) {
    log('[actionsArchiver] Archive had failures — trim skipped this run (will retry next run)');
  }

  // ── Attribution-index phase: preserve actionId→{agent,campaignId} for the actions
  // being aged out, so revenue that lands after they leave live `actions` still
  // attributes (first-touch UTM decay fix). Only after a successful archive. Fail-open.
  let attrIndexed = 0;
  if (archiveOk && plan.toArchive.length > 0) {
    try {
      const tasksState = (await store.getState('tasks')) || [];
      const taskById = {};
      (Array.isArray(tasksState) ? tasksState : []).forEach(function (t) { if (t && t.id) taskById[t.id] = t; });
      const additions = buildAttributionEntries(plan.toArchive, taskById, nowMs);
      const addCount = Object.keys(additions).length;
      if (addCount > 0) {
        const existingIdx = (await store.getState(ATTR_INDEX_KEY)) || null;
        const merged = mergeAttributionIndex(existingIdx, additions, ATTR_INDEX_CAP);
        await store.setState(ATTR_INDEX_KEY, merged);
        attrIndexed = addCount;
        log('[actionsArchiver] Attribution index +' + addCount + ' (total ' + merged.count + ')');
      }
    } catch (attrErr) {
      log('[actionsArchiver] Attribution index update failed (non-fatal): ' + (attrErr && attrErr.message));
    }
  }

  const durationMs = Date.now() - runStartMs;
  await _appendRunSummary(store, {
    archived: totalArchived,
    trimmed: trimmed,
    attrIndexed: attrIndexed,
    partitions: partitionResults,
    skipped: actions.length - plan.toArchive.length,
    durationMs: durationMs
  });

  log('[actionsArchiver] Complete — archived ' + totalArchived + ', trimmed ' + trimmed +
    ', attrIndexed ' + attrIndexed + ', kept ' + keptCount + ' in ' + durationMs + 'ms');
  return { ok: true, archived: totalArchived, trimmed: trimmed, attrIndexed: attrIndexed, kept: keptCount, partitions: partitionResults };
}

// ── Timer entrypoint ──

module.exports = async function (context) {
  const demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;

  context.log('[actionsArchiver] Timer fired at', new Date().toISOString());
  try {
    await runArchiver({ storage: storage, archive: archive, nowMs: Date.now(), log: function () { context.log.apply(context, arguments); } });
  } catch (err) {
    context.log.error('[actionsArchiver] Run failed:', err && err.message ? err.message : err);
    try {
      await _appendRunSummary(storage, { archived: 0, trimmed: 0, error: err && err.message ? err.message : String(err) });
    } catch (_logErr) { /* non-fatal */ }
  }
};

// Shared exports for the HTTP trigger + tests
module.exports.runArchiver = runArchiver;
module.exports.planArchiveAndTrim = planArchiveAndTrim;
module.exports._isTerminalAction = _isTerminalAction;
module.exports.buildAttributionEntries = buildAttributionEntries;
module.exports.mergeAttributionIndex = mergeAttributionIndex;
module.exports.ATTR_INDEX_KEY = ATTR_INDEX_KEY;

// ── Helpers ──

async function _appendRunSummary(store, details) {
  try {
    const govLog = (await store.getState('governanceLog')) || [];
    govLog.push({
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      type: 'archive-run',
      agentId: null,
      summary: details.error
        ? 'Archive run failed: ' + details.error
        : 'Archived ' + details.archived + ' action(s), trimmed ' + (details.trimmed || 0) + ' from live across ' + ((details.partitions || []).length) + ' partition(s)',
      timestamp: new Date().toISOString(),
      details: details
    });
    if (govLog.length > GOV_LOG_CAP) govLog.splice(0, govLog.length - GOV_LOG_CAP);
    await store.setState('governanceLog', govLog);
  } catch (err) {
    console.error('[actionsArchiver] Failed to append governanceLog entry:', err && err.message);
  }
}

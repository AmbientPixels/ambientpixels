// actionsArchiver/index.js — Weekly cold-storage archival for actions state.
//
// Runs every Sunday at 04:00 UTC (cron: 0 0 4 * * 0 — low-traffic window).
//
// What it does:
//   1. Reads live `actions` state
//   2. Filters entries older than 30 days (by execution.finished_at or created_at)
//   3. Appends them to monthly archive partitions in the `company-archive` container
//      (key format: actions-YYYY-MM.json — one blob per calendar month)
//   4. Does NOT modify live `actions` state in this phase. Medium-tier Phase 5 (90-day live
//      trim) is a separate batch. For now we duplicate old entries so any future trim is safe.
//   5. Writes a summary entry to governanceLog so the run shows up in the governance dashboard.
//
// Idempotency: re-running within the same week is safe — entries are appended but dedup'd
// against existing archive keys to avoid writing the same action twice.

const storage = require('../_utils/companyStorage');
const archive = require('../_utils/archiveStorage');

const ARCHIVE_AGE_DAYS = 30;
const GOV_LOG_CAP = 500;  // matches MAX_GOVERNANCE_LOG_ENTRIES in constants.js

module.exports = async function (context) {
  var demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;

  const runStartMs = Date.now();
  context.log('[actionsArchiver] Timer fired at', new Date().toISOString());

  try {
    const actions = (await storage.getState('actions')) || [];
    if (!Array.isArray(actions) || actions.length === 0) {
      context.log('[actionsArchiver] No actions to archive — exiting');
      return;
    }

    const cutoffMs = Date.now() - (ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000);
    const eligible = actions.filter(function (a) {
      if (!a) return false;
      const tsStr = (a.execution && a.execution.finished_at) || a.created_at || a.timestamp || a.createdAt;
      const ts = Date.parse(tsStr || '');
      return Number.isFinite(ts) && ts < cutoffMs;
    });

    if (eligible.length === 0) {
      context.log('[actionsArchiver] No entries older than', ARCHIVE_AGE_DAYS, 'days — nothing to archive');
      await _appendRunSummary({ archived: 0, partitions: [], skipped: actions.length });
      return;
    }

    // Group eligible entries by YYYY-MM of their primary timestamp
    const byMonth = {};
    eligible.forEach(function (a) {
      const tsStr = (a.execution && a.execution.finished_at) || a.created_at || a.timestamp || a.createdAt;
      const d = new Date(tsStr);
      const key = 'actions-' + d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(a);
    });

    // For each partition, dedup against existing archive entries (by action.id) before appending
    const partitions = Object.keys(byMonth).sort();
    let totalArchived = 0;
    const partitionResults = [];

    for (const partKey of partitions) {
      const newEntries = byMonth[partKey];
      const existing = await archive.readArchive(partKey, { limit: 999999 });
      const existingIds = new Set(existing.entries.map(function (e) { return e && e.id; }).filter(Boolean));
      const toAppend = newEntries.filter(function (a) { return a.id && !existingIds.has(a.id); });

      if (toAppend.length === 0) {
        context.log('[actionsArchiver]', partKey, '— already contains all', newEntries.length, 'eligible entries, skipping');
        partitionResults.push({ partition: partKey, added: 0, total: existing.total });
        continue;
      }

      const newTotal = await archive.appendArchive(partKey, toAppend);
      totalArchived += toAppend.length;
      partitionResults.push({ partition: partKey, added: toAppend.length, total: newTotal });
      context.log('[actionsArchiver]', partKey, '— appended', toAppend.length, 'entries (total now', newTotal + ')');
    }

    const durationMs = Date.now() - runStartMs;
    await _appendRunSummary({
      archived: totalArchived,
      partitions: partitionResults,
      skipped: actions.length - eligible.length,
      durationMs: durationMs
    });

    context.log('[actionsArchiver] Run complete —', totalArchived, 'entries archived across',
      partitions.length, 'partitions in', durationMs + 'ms');
  } catch (err) {
    context.log.error('[actionsArchiver] Run failed:', err && err.message ? err.message : err);
    try {
      await _appendRunSummary({
        archived: 0,
        error: err && err.message ? err.message : String(err),
        durationMs: Date.now() - runStartMs
      });
    } catch (_logErr) { /* non-fatal */ }
  }
};

// ── Helpers ──

async function _appendRunSummary(details) {
  try {
    const govLog = (await storage.getState('governanceLog')) || [];
    govLog.push({
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      type: 'archive-run',
      agentId: null,
      summary: details.error
        ? 'Archive run failed: ' + details.error
        : 'Archived ' + details.archived + ' action(s) across ' + ((details.partitions || []).length) + ' partition(s)',
      timestamp: new Date().toISOString(),
      details: details
    });
    // Enforce the same 500-entry cap as the heartbeat's governance log retention rule
    if (govLog.length > GOV_LOG_CAP) govLog.splice(0, govLog.length - GOV_LOG_CAP);
    await storage.setState('governanceLog', govLog);
  } catch (err) {
    console.error('[actionsArchiver] Failed to append governanceLog entry:', err && err.message);
  }
}

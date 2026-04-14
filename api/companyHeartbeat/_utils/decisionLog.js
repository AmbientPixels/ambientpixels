// decisionLog.js — Outcome Attribution Phase 5 helper
//
// Appends a structured decision entry to the `agentDecisions` state key.
//
// Retention: 30 days + 10K pathological cap. Matches outcomeSnapshots trim
// philosophy. At 8 agents x ~5 decisions/cycle x 24 cycles/day = up to
// 960 entries/day, so a count-based cap of 1000 would rotate out in <24h
// and break outcome backfill (which needs 7+ days).
//
// outcome field starts null; filled in by outcomeRefresh cron after t7
// completion on the linked action.
//
// Non-fatal: decision log write failures must not break the caller.

const crypto = require('crypto');

const RETENTION_DAYS = 30;
const MAX_ENTRIES_HARD_CAP = 10000;

// Note: caller must pass `storage` (the companyStorage module) since this
// helper lives inside the heartbeat module tree which uses a specific
// storage binding. Kept as a parameter instead of top-level require so the
// helper can be reused from other contexts if needed.

async function appendDecision(storage, entry) {
  if (!storage || !entry) return;
  const id = 'dec-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString();

  const row = {
    id: id,
    timestamp: now,
    cycleId: entry.cycleId || null,
    agentId: entry.agentId || 'unknown',
    decisionType: entry.decisionType || 'unspecified',
    contextActionId: entry.contextActionId || null,
    contextCampaignId: entry.contextCampaignId || null,
    contextTaskId: entry.contextTaskId || null,
    before: entry.before || null,
    after: entry.after || null,
    reasoning: (entry.reasoning || '').toString().substring(0, 500),
    outcome: null
  };

  try {
    let store = (await storage.getState('agentDecisions')) || [];
    if (!Array.isArray(store)) store = [];
    store.push(row);

    // Retention: drop entries older than RETENTION_DAYS.
    const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    store = store.filter(function (r) {
      const ts = Date.parse(r.timestamp || 0);
      return Number.isFinite(ts) && ts >= cutoff;
    });

    // Pathological runaway guard
    if (store.length > MAX_ENTRIES_HARD_CAP) {
      store = store.slice(-MAX_ENTRIES_HARD_CAP);
    }

    await storage.setState('agentDecisions', store);
  } catch (_e) {
    // Non-fatal
  }
}

module.exports = { appendDecision };

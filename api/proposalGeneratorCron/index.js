// proposalGeneratorCron — every 6h. Deterministic proposal generation.
//
// Reads campaigns/objectives/tasks/strategicDigest/socialAccountStats, computes
// whether the company state warrants a new campaign and/or objective, and appends
// the proposal(s) to approvalQueue for CEO approval. Never auto-executes; capped at
// <=1 of each type per 24h.
//
// Exists because agents never emit propose-campaign/-objective (structural routing
// bug, confirmed zero on Gemini AND Claude). See
// docs/superpowers/specs/2026-06-20-deterministic-proposal-generator-design.md
//
// Failure mode: any error is a no-op — nothing else depends on this cron succeeding.

const storage = require('../_utils/companyStorage');
const { runProposalGenerator } = require('../companyHeartbeat/proposal-generator');

module.exports = async function (context, timer) {
  context.log('[proposalGeneratorCron] Starting deterministic proposal scan');
  const result = await runProposalGenerator({
    storage: storage,
    nowMs: Date.now(),
    log: function () { context.log.apply(context, arguments); }
  });
  context.log('[proposalGeneratorCron] Complete:', JSON.stringify({ ok: result.ok, created: result.created, types: result.types }));
  return result;
};

// rewardsEngineCron — runs at :30 each hour. Deterministic agent XP/reward engine.
//
// Reads already-logged outcomes (approvals, ships, engagement, completed tasks,
// followers, revenue) and updates the `agentRewards` ledger. Writes ONLY agentRewards;
// never auto-executes; no-op on error. See
// docs/superpowers/specs/2026-06-20-agent-xp-reward-system-design.md

const storage = require('../_utils/companyStorage');
const { runRewardsEngine } = require('../companyHeartbeat/rewards-engine');

module.exports = async function (context, timer) {
  context.log('[rewardsEngineCron] Starting reward scan');
  const result = await runRewardsEngine({
    storage: storage,
    nowMs: Date.now(),
    log: function () { context.log.apply(context, arguments); }
  });
  context.log('[rewardsEngineCron] Complete:', JSON.stringify(result));
  return result;
};

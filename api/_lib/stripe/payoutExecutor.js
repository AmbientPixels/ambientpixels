// payoutExecutor.js — Shared payout execution logic used by both manual trigger and timer
//
// Flow:
// 1. Idempotency check (skip if already ran this month)
// 2. Snapshot monthly runs (delta from previous month)
// 3. Count Pro subscribers → calculate pool
// 4. Load creator profiles → calculate per-creator payouts
// 5. Platform balance check
// 6. Execute Stripe Transfers for eligible creators
// 7. Save payout run record + update creator profiles + save payout history

const storage = require('../../_utils/companyStorage');
const { snapshotMonthlyRuns, calculateCreatorPayouts } = require('./payoutCalculation');
const { createTransfer, getPlatformBalance } = require('./stripeConnect');
const { loadCreatorProfile, saveCreatorProfile } = require('./creatorProfiles');

async function executePayoutRun({ month, triggeredBy, dryRun, context }) {
  var now = new Date();
  if (!month) {
    // Default to previous month
    var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    month = prevMonth.getFullYear() + '-' + String(prevMonth.getMonth() + 1).padStart(2, '0');
  }

  var payoutRunKey = 'payout-runs/' + month;
  var snapshotKey = 'payout-snapshots/' + month;

  // 1. Idempotency check
  var existingRun = await storage.getState(payoutRunKey).catch(function () { return null; });
  if (existingRun && !dryRun) {
    context.log('[Payout] Run already exists for ' + month + ', skipping');
    return { skipped: true, reason: 'Already executed for ' + month, existing: existingRun };
  }

  // 2. Snapshot monthly runs
  var currentStats = (await storage.getState('pixelAgentCreatorStats')) || {};

  // Find previous month's snapshot
  var monthParts = month.split('-');
  var prevDate = new Date(parseInt(monthParts[0]), parseInt(monthParts[1]) - 2, 1);
  var prevMonthKey = 'payout-snapshots/' + prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');
  var previousSnapshot = await storage.getState(prevMonthKey).catch(function () { return null; });

  var monthlyRuns = snapshotMonthlyRuns(currentStats, previousSnapshot);

  context.log('[Payout] Monthly runs computed for ' + month + ':', Object.keys(monthlyRuns).length, 'creators');

  // 3. Load all creator profiles
  var creatorProfiles = {};
  var creatorIds = Object.keys(monthlyRuns);
  for (var i = 0; i < creatorIds.length; i++) {
    var profile = await loadCreatorProfile(creatorIds[i]).catch(function () { return null; });
    if (profile) creatorProfiles[creatorIds[i]] = profile;
  }

  // 4. Calculate payouts
  var calculation = await calculateCreatorPayouts({
    monthlyRuns: monthlyRuns,
    creatorProfiles: creatorProfiles,
    context: context
  });

  context.log('[Payout] Pool: $' + calculation.pool.creatorPool.toFixed(2) +
    ' | Creators: ' + Object.keys(calculation.creators).length +
    ' | Total weighted runs: ' + calculation.totalWeightedRuns);

  // If dry run, return calculation without executing
  if (dryRun) {
    return {
      dryRun: true,
      month: month,
      calculation: calculation,
      summary: buildSummary(calculation)
    };
  }

  // 5. Platform balance check
  var balance = await getPlatformBalance();
  var availableBalance = 0;
  if (balance && balance.available) {
    var usdBalance = balance.available.find(function (b) { return b.currency === 'usd'; });
    availableBalance = usdBalance ? usdBalance.amount : 0; // in cents
  }
  context.log('[Payout] Platform balance: $' + (availableBalance / 100).toFixed(2));

  // Sort by payout amount descending (priority order for insufficient balance)
  var eligibleCreators = Object.keys(calculation.creators)
    .filter(function (cid) { return calculation.creators[cid].eligible; })
    .sort(function (a, b) { return calculation.creators[b].totalPayout - calculation.creators[a].totalPayout; });

  // 6. Execute transfers
  var totalTransferred = 0;
  for (var j = 0; j < eligibleCreators.length; j++) {
    var cid = eligibleCreators[j];
    var detail = calculation.creators[cid];

    // Check if we have enough balance
    if (totalTransferred + detail.transferAmount > availableBalance) {
      detail.status = 'deferred_insufficient_balance';
      context.log.warn('[Payout] Insufficient balance for ' + cid + ', deferring $' + detail.totalPayout.toFixed(2));
      continue;
    }

    try {
      var transfer = await createTransfer({
        amount: detail.transferAmount,
        destination: detail.stripeConnectAccountId,
        metadata: {
          payoutMonth: month,
          creatorId: cid,
          monthlyRuns: String(detail.monthlyRuns)
        }
      });
      detail.transferId = transfer.id;
      detail.status = 'paid';
      totalTransferred += detail.transferAmount;
      context.log('[Payout] Transferred $' + detail.totalPayout.toFixed(2) + ' to ' + cid + ' (' + transfer.id + ')');
    } catch (err) {
      detail.status = 'failed';
      detail.error = err.response && err.response.data && err.response.data.error
        ? err.response.data.error.message
        : err.message;
      context.log.error('[Payout] Transfer failed for ' + cid + ':', detail.error);
    }
  }

  // 7. Save snapshot (for next month's delta)
  await storage.setState(snapshotKey, currentStats);

  // 8. Save payout run record
  var summary = buildSummary(calculation);
  var payoutRun = {
    month: month,
    executedAt: now.toISOString(),
    triggeredBy: triggeredBy || 'manual',
    pool: calculation.pool,
    totalWeightedRuns: calculation.totalWeightedRuns,
    creators: calculation.creators,
    summary: summary,
    platformBalance: availableBalance / 100
  };
  await storage.setState(payoutRunKey, payoutRun);

  // 9. Update creator profiles + payout history
  for (var k = 0; k < creatorIds.length; k++) {
    var creatorId = creatorIds[k];
    var cd = calculation.creators[creatorId];
    if (!cd) continue;

    var prof = creatorProfiles[creatorId];
    if (!prof) continue;

    if (cd.status === 'paid') {
      prof.totalEarnings = (prof.totalEarnings || 0) + cd.totalPayout;
      prof.totalPaidOut = (prof.totalPaidOut || 0) + cd.totalPayout;
      prof.pendingBalance = 0;
      prof.lastPayoutAt = now.toISOString();
    } else if (cd.status === 'deferred_insufficient_balance' || cd.status === 'failed') {
      // Rollover
      prof.totalEarnings = (prof.totalEarnings || 0) + cd.calculatedPayout;
      prof.pendingBalance = (prof.pendingBalance || 0) + cd.calculatedPayout;
    } else {
      // Not eligible (below threshold or no payouts enabled)
      prof.totalEarnings = (prof.totalEarnings || 0) + cd.calculatedPayout;
      prof.pendingBalance = (prof.pendingBalance || 0) + cd.calculatedPayout;
    }
    await saveCreatorProfile(creatorId, prof);

    // Save payout history entry
    var historyKey = 'payout-history/' + creatorId;
    var history = (await storage.getState(historyKey).catch(function () { return null; })) || [];
    history.push({
      month: month,
      calculatedPayout: cd.calculatedPayout,
      pendingCarryover: cd.pendingBalance,
      transferAmount: cd.status === 'paid' ? cd.totalPayout : 0,
      transferId: cd.transferId || null,
      status: cd.status,
      paidAt: cd.status === 'paid' ? now.toISOString() : null
    });
    await storage.setState(historyKey, history);
  }

  context.log('[Payout] Run complete for ' + month + ': $' + summary.totalPaid.toFixed(2) +
    ' paid to ' + summary.eligibleCreators + ' creators');

  return payoutRun;
}

function buildSummary(calculation) {
  var creators = calculation.creators;
  var cids = Object.keys(creators);
  return {
    totalCreators: cids.length,
    eligibleCreators: cids.filter(function (c) { return creators[c].eligible; }).length,
    totalPaid: cids.reduce(function (sum, c) { return sum + (creators[c].status === 'paid' ? creators[c].totalPayout : 0); }, 0),
    totalRolledOver: cids.reduce(function (sum, c) {
      return sum + (creators[c].eligible ? 0 : creators[c].calculatedPayout + creators[c].pendingBalance);
    }, 0)
  };
}

module.exports = { executePayoutRun };

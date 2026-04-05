// payoutCalculation.js — Monthly payout math for Pixel Agents creator revenue share
//
// Revenue model:
//   40% of PA Pro subscription revenue → monthly creator pool
//   Free creators keep 50% of their share, Pro creators keep 70%
//   Pro creators get 1.5x run weight multiplier
//   $25 minimum payout threshold, below-threshold rolls over

const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { loadEntitlements, isProActive } = require('./entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const POOL_PERCENT = 0.40;
const PRO_MONTHLY_PRICE = 12;
const PRO_YEARLY_MONTHLY_EQUIV = 10; // $120/yr = $10/mo
const FREE_RUN_WEIGHT = 1.0;
const PRO_RUN_WEIGHT = 1.5;
const FREE_REVENUE_SHARE = 0.50;
const PRO_REVENUE_SHARE = 0.70;
const MIN_PAYOUT = 25;

// ── Get blob container client ─────────────────────────────────

async function getContainerClient() {
  var blobServiceClient;
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  } else {
    blobServiceClient = new BlobServiceClient(
      'https://' + STORAGE_ACCOUNT_NAME + '.blob.core.windows.net',
      new DefaultAzureCredential()
    );
  }
  return blobServiceClient.getContainerClient(CONTAINER_NAME);
}

// ── Snapshot: compute monthly runs from all-time delta ─────────

function snapshotMonthlyRuns(currentStats, previousSnapshot) {
  var monthly = {};
  if (!currentStats) return monthly;

  var prev = previousSnapshot || {};

  Object.keys(currentStats).forEach(function (creatorId) {
    var creatorCurrent = currentStats[creatorId];
    var creatorPrev = prev[creatorId] || {};

    if (typeof creatorCurrent !== 'object') return;

    monthly[creatorId] = {};
    Object.keys(creatorCurrent).forEach(function (agentId) {
      var current = creatorCurrent[agentId] || 0;
      var previous = creatorPrev[agentId] || 0;
      var delta = Math.max(0, current - previous);
      if (delta > 0) monthly[creatorId][agentId] = delta;
    });

    // Compute _total from deltas
    monthly[creatorId]._total = Object.keys(monthly[creatorId])
      .filter(function (k) { return k !== '_total'; })
      .reduce(function (sum, k) { return sum + monthly[creatorId][k]; }, 0);
  });

  // Remove creators with 0 monthly runs
  Object.keys(monthly).forEach(function (cid) {
    if (!monthly[cid]._total) delete monthly[cid];
  });

  return monthly;
}

// ── Count active PA Pro subscribers ───────────────────────────

async function countActiveProSubscribers(context) {
  var containerClient = await getContainerClient();
  var monthlyCount = 0;
  var yearlyCount = 0;

  try {
    var iter = containerClient.listBlobsFlat({ prefix: 'billing/entitlements/' });
    for await (var blob of iter) {
      try {
        var blobClient = containerClient.getBlockBlobClient(blob.name);
        var downloadResponse = await blobClient.download(0);
        var chunks = [];
        for await (var chunk of downloadResponse.readableStreamBody) {
          chunks.push(chunk);
        }
        var record = JSON.parse(Buffer.concat(chunks).toString('utf8'));

        if (isProActive(record)) {
          // Check if this is a PA subscription (has PA flags or purchases)
          var hasPa = record.purchases && record.purchases.some(function (p) {
            return p.productId && p.productId.startsWith('pa-');
          });
          // Also count if they have PA flags active
          if (!hasPa && record.flags && record.flags.paUnlimitedRuns) hasPa = true;
          // For now, count all Pro subscribers — they all contribute to the pool
          if (record.subscriptionId) {
            // Determine if monthly or yearly (check purchase history)
            var isYearly = record.purchases && record.purchases.some(function (p) {
              return p.productId && p.productId.includes('yearly');
            });
            if (isYearly) yearlyCount++;
            else monthlyCount++;
          }
        }
      } catch (e) {
        // Skip malformed blobs
      }
    }
  } catch (e) {
    if (context) context.log.warn('[PayoutCalc] Error scanning entitlements:', e.message);
  }

  return {
    monthlyCount: monthlyCount,
    yearlyCount: yearlyCount,
    totalCount: monthlyCount + yearlyCount,
    estimatedMonthlyRevenue: (monthlyCount * PRO_MONTHLY_PRICE) + (yearlyCount * PRO_YEARLY_MONTHLY_EQUIV)
  };
}

// ── Calculate pool + per-creator payouts ──────────────────────

async function calculateCreatorPayouts({ monthlyRuns, creatorProfiles, context }) {
  var containerClient = await getContainerClient();
  var subscribers = await countActiveProSubscribers(context);
  var creatorPool = subscribers.estimatedMonthlyRevenue * POOL_PERCENT;

  if (context) context.log('[PayoutCalc] Pool: $' + creatorPool.toFixed(2) +
    ' (monthly: ' + subscribers.monthlyCount + ', yearly: ' + subscribers.yearlyCount + ')');

  // Calculate weighted runs per creator
  var creatorDetails = {};
  var totalWeightedRuns = 0;

  var creatorIds = Object.keys(monthlyRuns);

  for (var i = 0; i < creatorIds.length; i++) {
    var creatorId = creatorIds[i];
    var runs = monthlyRuns[creatorId]._total || 0;
    if (runs === 0) continue;

    // Look up creator's Pro/Free status from entitlements
    var entRecord = null;
    try {
      entRecord = await loadEntitlements(containerClient, creatorId);
    } catch (e) { /* not found = free */ }

    var isPro = isProActive(entRecord);
    var runWeight = isPro ? PRO_RUN_WEIGHT : FREE_RUN_WEIGHT;
    var weightedRuns = runs * runWeight;
    totalWeightedRuns += weightedRuns;

    var profile = creatorProfiles[creatorId] || null;
    var pendingBalance = profile ? (profile.pendingBalance || 0) : 0;

    creatorDetails[creatorId] = {
      monthlyRuns: runs,
      isPro: isPro,
      runWeight: runWeight,
      weightedRuns: weightedRuns,
      pendingBalance: pendingBalance,
      payoutsEnabled: profile ? !!(profile.payoutsEnabled && profile.stripeConnectAccountId) : false,
      stripeConnectAccountId: profile ? profile.stripeConnectAccountId : null
    };
  }

  // Distribute pool
  Object.keys(creatorDetails).forEach(function (cid) {
    var detail = creatorDetails[cid];
    if (totalWeightedRuns === 0) {
      detail.poolShare = 0;
      detail.calculatedPayout = 0;
    } else {
      detail.poolShare = creatorPool * (detail.weightedRuns / totalWeightedRuns);
      var revenueSharePercent = detail.isPro ? PRO_REVENUE_SHARE : FREE_REVENUE_SHARE;
      detail.revenueSharePercent = revenueSharePercent;
      detail.calculatedPayout = detail.poolShare * revenueSharePercent;
    }

    // Add pending balance from previous months
    detail.totalPayout = detail.calculatedPayout + detail.pendingBalance;

    // Check eligibility
    detail.eligible = detail.totalPayout >= MIN_PAYOUT && detail.payoutsEnabled;
    detail.transferAmount = detail.eligible ? Math.round(detail.totalPayout * 100) : 0; // cents for Stripe
    detail.status = 'pending';
  });

  return {
    pool: {
      monthlySubscribers: subscribers.monthlyCount,
      yearlySubscribers: subscribers.yearlyCount,
      monthlyRevenue: subscribers.estimatedMonthlyRevenue,
      creatorPool: creatorPool
    },
    totalWeightedRuns: totalWeightedRuns,
    creators: creatorDetails,
    minPayout: MIN_PAYOUT
  };
}

module.exports = {
  snapshotMonthlyRuns,
  countActiveProSubscribers,
  calculateCreatorPayouts,
  POOL_PERCENT,
  MIN_PAYOUT,
  FREE_RUN_WEIGHT,
  PRO_RUN_WEIGHT,
  FREE_REVENUE_SHARE,
  PRO_REVENUE_SHARE
};

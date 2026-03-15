// entitlements.js — Per-user entitlement management on Azure Blob
// Stored at billing/entitlements/{userId}.json in the cardforge container.

const { getProduct } = require('./productCatalog');

const PRO_FLAGS = ['hdExport', 'premiumEffects', 'extraCardSlots', 'sfAllGenres', 'sfUnlimitedAdventures', 'sfAllImages', 'sfExtraSaves', 'paUnlimitedRuns', 'paPriorityQueue', 'paEarlyAccess'];

// Admin user IDs that always get Pro entitlements (for dev/testing)
const ADMIN_USER_IDS = (process.env.ENTITLEMENTS_ADMIN_IDS || '').split(',').filter(Boolean);

function isAdminUser(userId) {
  return userId && ADMIN_USER_IDS.includes(userId);
}

function defaultRecord(userId) {
  return {
    userId: userId,
    tier: 'free',
    stripeCustomerId: null,
    subscriptionId: null,
    subscriptionStatus: null,
    flags: {},
    purchases: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function blobPath(userId) {
  return 'billing/entitlements/' + userId + '.json';
}

// ── Load / Save ────────────────────────────────────────────────

async function loadEntitlements(containerClient, userId) {
  const blobClient = containerClient.getBlockBlobClient(blobPath(userId));
  const exists = await blobClient.exists();
  if (!exists) return null;

  const downloadResponse = await blobClient.download(0);
  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function saveEntitlements(containerClient, userId, record) {
  record.updatedAt = new Date().toISOString();
  const blobClient = containerClient.getBlockBlobClient(blobPath(userId));
  const content = JSON.stringify(record, null, 2);
  await blobClient.upload(content, Buffer.byteLength(content), {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
  return record;
}

// ── Queries ────────────────────────────────────────────────────

function isProActive(record) {
  return record && record.tier === 'pro' && record.subscriptionStatus === 'active';
}

function hasFlag(record, flag) {
  if (!record) return false;
  if (isProActive(record) && PRO_FLAGS.includes(flag)) return true;
  return !!(record.flags && record.flags[flag]);
}

// Safe subset for client (no Stripe IDs or purchase history)
function toClientSafe(record) {
  if (!record) {
    return { tier: 'free', flags: {}, subscriptionStatus: null, hasActiveSubscription: false };
  }
  // Compute effective flags (merge Pro defaults with individual grants)
  const effectiveFlags = { ...(record.flags || {}) };
  if (isProActive(record)) {
    for (const f of PRO_FLAGS) {
      effectiveFlags[f] = true;
    }
  }
  return {
    tier: record.tier || 'free',
    flags: effectiveFlags,
    subscriptionStatus: record.subscriptionStatus || null,
    hasActiveSubscription: isProActive(record)
  };
}

// ── Mutations ──────────────────────────────────────────────────

async function grantProduct(containerClient, userId, productId, stripeSessionId) {
  let record = await loadEntitlements(containerClient, userId);
  if (!record) record = defaultRecord(userId);

  // Idempotency: check if this session was already processed
  const alreadyGranted = record.purchases.some(p => p.stripeSessionId === stripeSessionId);
  if (alreadyGranted) return record;

  const product = getProduct(productId);
  if (!product) return record;

  // Add purchase record
  record.purchases.push({
    productId,
    grantedAt: new Date().toISOString(),
    stripeSessionId
  });

  // Apply entitlements from product
  if (product.entitlements) {
    if (product.entitlements.tier) {
      record.tier = product.entitlements.tier;
    }
    if (product.entitlements.flags) {
      for (const flag of product.entitlements.flags) {
        record.flags[flag] = true;
      }
    }
  }

  return saveEntitlements(containerClient, userId, record);
}

async function activateSubscription(containerClient, userId, subscriptionId, customerId) {
  let record = await loadEntitlements(containerClient, userId);
  if (!record) record = defaultRecord(userId);

  record.tier = 'pro';
  record.subscriptionId = subscriptionId;
  record.subscriptionStatus = 'active';
  if (customerId) record.stripeCustomerId = customerId;

  // Grant all Pro flags
  for (const flag of PRO_FLAGS) {
    record.flags[flag] = true;
  }

  return saveEntitlements(containerClient, userId, record);
}

async function deactivateSubscription(containerClient, userId) {
  let record = await loadEntitlements(containerClient, userId);
  if (!record) return null;

  record.tier = 'free';
  record.subscriptionStatus = 'canceled';

  // Remove Pro-granted flags (keep individually purchased ones)
  for (const flag of PRO_FLAGS) {
    // Only remove if no individual purchase granted this flag
    const hasIndividualGrant = record.purchases.some(p => {
      const prod = getProduct(p.productId);
      return prod && prod.entitlements && prod.entitlements.flags && prod.entitlements.flags.includes(flag);
    });
    if (!hasIndividualGrant) {
      delete record.flags[flag];
    }
  }

  return saveEntitlements(containerClient, userId, record);
}

async function markSubscriptionAtRisk(containerClient, userId) {
  let record = await loadEntitlements(containerClient, userId);
  if (!record) return null;

  record.subscriptionStatus = 'past_due';
  return saveEntitlements(containerClient, userId, record);
}

module.exports = {
  defaultRecord,
  loadEntitlements,
  saveEntitlements,
  isProActive,
  hasFlag,
  toClientSafe,
  grantProduct,
  activateSubscription,
  deactivateSubscription,
  markSubscriptionAtRisk,
  isAdminUser,
  PRO_FLAGS
};

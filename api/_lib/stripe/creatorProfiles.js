// creatorProfiles.js — Creator profile CRUD for Pixel Agents payout system
// Stored via companyStorage at creatorProfiles/{creatorId}

const storage = require('../../_utils/companyStorage');

function profileKey(creatorId) {
  return 'creatorProfiles/' + creatorId;
}

function defaultProfile(creatorId, email) {
  return {
    creatorId: creatorId,
    email: email || null,
    displayName: null,
    bio: null,
    avatarUrl: null,
    website: null,
    twitter: null,
    stripeConnectAccountId: null,
    onboardingComplete: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    totalEarnings: 0,
    totalPaidOut: 0,
    pendingBalance: 0,
    lastPayoutAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// ── Load ──────────────────────────────────────────────────────

async function loadCreatorProfile(creatorId) {
  try {
    return await storage.getState(profileKey(creatorId));
  } catch {
    return null;
  }
}

// ── Save ──────────────────────────────────────────────────────

async function saveCreatorProfile(creatorId, profile) {
  profile.updatedAt = new Date().toISOString();
  await storage.setState(profileKey(creatorId), profile);
  return profile;
}

// ── Payout Readiness Check ────────────────────────────────────

function isPayoutReady(profile) {
  return profile &&
    profile.payoutsEnabled === true &&
    profile.chargesEnabled === true &&
    profile.onboardingComplete === true &&
    profile.stripeConnectAccountId;
}

// ── Client-Safe View ──────────────────────────────────────────

function toClientSafe(profile) {
  if (!profile) {
    return { enrolled: false };
  }
  return {
    enrolled: true,
    displayName: profile.displayName || null,
    bio: profile.bio || null,
    avatarUrl: profile.avatarUrl || null,
    website: profile.website || null,
    twitter: profile.twitter || null,
    onboardingComplete: profile.onboardingComplete,
    chargesEnabled: profile.chargesEnabled,
    payoutsEnabled: profile.payoutsEnabled,
    payoutReady: isPayoutReady(profile),
    totalEarnings: profile.totalEarnings || 0,
    totalPaidOut: profile.totalPaidOut || 0,
    pendingBalance: profile.pendingBalance || 0,
    lastPayoutAt: profile.lastPayoutAt,
    createdAt: profile.createdAt
  };
}

// Public view — no email, no Stripe data, no earnings
function toPublicSafe(profile) {
  if (!profile) return null;
  return {
    displayName: profile.displayName || null,
    bio: profile.bio || null,
    avatarUrl: profile.avatarUrl || null,
    website: profile.website || null,
    twitter: profile.twitter || null
  };
}

module.exports = {
  defaultProfile,
  loadCreatorProfile,
  saveCreatorProfile,
  isPayoutReady,
  toClientSafe,
  toPublicSafe
};

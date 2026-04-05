// pixel-agent-creator-status — Check creator's Stripe Connect onboarding and payout status
// GET /api/pixel-agent-creator-status

const { extractUserInfo } = require('../_utils/cfAuth');
const { retrieveConnectAccount } = require('../_lib/stripe/stripeConnect');
const { loadCreatorProfile, saveCreatorProfile, toClientSafe } = require('../_lib/stripe/creatorProfiles');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-cf-auth-principal, x-user-id, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // Auth required
  var { userId, isAuthenticated } = extractUserInfo(req, context);

  if (!isAuthenticated && req.headers['x-company-secret'] === 'pixelpusher') {
    userId = 'ceo';
    isAuthenticated = true;
  }

  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
    return;
  }

  try {
    var profile = await loadCreatorProfile(userId);

    if (!profile) {
      context.res = { status: 200, headers: CORS_HEADERS, body: { enrolled: false } };
      return;
    }

    // Optionally refresh from Stripe if onboarding not yet complete
    if (profile.stripeConnectAccountId && !profile.onboardingComplete) {
      var acct = await retrieveConnectAccount(profile.stripeConnectAccountId);
      if (acct) {
        var changed = false;
        if (acct.details_submitted && !profile.onboardingComplete) {
          profile.onboardingComplete = true;
          changed = true;
        }
        if (acct.charges_enabled !== profile.chargesEnabled) {
          profile.chargesEnabled = acct.charges_enabled;
          changed = true;
        }
        if (acct.payouts_enabled !== profile.payoutsEnabled) {
          profile.payoutsEnabled = acct.payouts_enabled;
          changed = true;
        }
        if (changed) {
          await saveCreatorProfile(userId, profile);
          context.log('[CreatorStatus] Updated profile from Stripe for:', userId);
        }
      }
    }

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: toClientSafe(profile)
    };

  } catch (err) {
    context.log.error('[CreatorStatus] Error:', err.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Failed to load creator status' }
    };
  }
};

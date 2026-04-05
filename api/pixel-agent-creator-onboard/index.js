// pixel-agent-creator-onboard — Initiate Stripe Connect Express onboarding for creators
// POST /api/pixel-agent-creator-onboard

const { extractUserInfo } = require('../_utils/cfAuth');
const { createConnectAccount, createAccountLink } = require('../_lib/stripe/stripeConnect');
const { loadCreatorProfile, saveCreatorProfile, defaultProfile } = require('../_lib/stripe/creatorProfiles');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-cf-auth-principal, x-user-id, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // Auth required
  var { userId, email, isAuthenticated } = extractUserInfo(req, context);

  // CEO fallback
  if (!isAuthenticated && req.headers['x-company-secret'] === 'pixelpusher') {
    userId = 'ceo';
    email = 'ceo@ambientpixels.ai';
    isAuthenticated = true;
  }

  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
    return;
  }

  try {
    // Load or create creator profile
    var profile = await loadCreatorProfile(userId);

    if (profile && profile.onboardingComplete) {
      // Already onboarded — return status
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { alreadyOnboarded: true, payoutsEnabled: profile.payoutsEnabled }
      };
      return;
    }

    // Create Stripe Connect account if needed
    if (!profile || !profile.stripeConnectAccountId) {
      profile = profile || defaultProfile(userId, email);

      context.log('[CreatorOnboard] Creating Connect account for:', userId);
      var account = await createConnectAccount({ email: email, userId: userId });
      profile.stripeConnectAccountId = account.id;
      profile.email = email;
      await saveCreatorProfile(userId, profile);
      context.log('[CreatorOnboard] Connect account created:', account.id);
    }

    // Generate onboarding link (links expire, so always generate fresh)
    context.log('[CreatorOnboard] Creating account link for:', profile.stripeConnectAccountId);
    var accountLink = await createAccountLink({
      accountId: profile.stripeConnectAccountId
    });

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        onboardingUrl: accountLink.url,
        accountId: profile.stripeConnectAccountId
      }
    };

  } catch (err) {
    context.log.error('[CreatorOnboard] Error:', err.message, err.stack);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Failed to start onboarding: ' + err.message }
    };
  }
};

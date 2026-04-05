// pixel-agent-connect-webhook — Handles Stripe Connect account webhooks
// POST /api/pixel-agent-connect-webhook
// Separate from pixel-agent-billing-webhook because Connect uses a different signing secret

const { verifyWebhookSignature } = require('../_lib/stripe/stripeClient');
const { loadCreatorProfile, saveCreatorProfile } = require('../_lib/stripe/creatorProfiles');
const storage = require('../_utils/companyStorage');

const CONNECT_WEBHOOK_SECRET = process.env.PA_STRIPE_CONNECT_WEBHOOK_SECRET;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // Verify webhook signature
  var rawBody = req.rawBody || req.body;
  if (typeof rawBody === 'object') rawBody = JSON.stringify(rawBody);
  var signature = req.headers['stripe-signature'];

  if (!verifyWebhookSignature(rawBody, signature, CONNECT_WEBHOOK_SECRET)) {
    context.log.warn('[ConnectWebhook] Invalid signature');
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid signature' } };
    return;
  }

  var event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid JSON' } };
    return;
  }

  var eventType = event.type;
  var obj = event.data && event.data.object;

  context.log('[ConnectWebhook] Event:', eventType, obj ? obj.id : '(no object)');

  try {
    switch (eventType) {
      case 'account.updated': {
        var accountId = obj.id; // acct_xxx
        var chargesEnabled = obj.charges_enabled;
        var payoutsEnabled = obj.payouts_enabled;
        var detailsSubmitted = obj.details_submitted;

        // Find creator profile by stripeConnectAccountId
        // Check metadata first for userId
        var creatorId = obj.metadata && obj.metadata.userId;
        var profile = creatorId ? await loadCreatorProfile(creatorId) : null;

        // Fallback: scan known profiles (expensive, but Connect webhooks are rare)
        if (!profile) {
          context.log('[ConnectWebhook] No profile found by metadata, scanning...');
          // We can't easily scan companyStorage keys, so log and skip
          context.log.warn('[ConnectWebhook] Could not find creator for account:', accountId);
          break;
        }

        // Verify this profile matches the account
        if (profile.stripeConnectAccountId !== accountId) {
          context.log.warn('[ConnectWebhook] Account mismatch:', profile.stripeConnectAccountId, '!==', accountId);
          break;
        }

        var updated = false;
        if (detailsSubmitted && !profile.onboardingComplete) {
          profile.onboardingComplete = true;
          updated = true;
        }
        if (chargesEnabled !== profile.chargesEnabled) {
          profile.chargesEnabled = chargesEnabled;
          updated = true;
        }
        if (payoutsEnabled !== profile.payoutsEnabled) {
          profile.payoutsEnabled = payoutsEnabled;
          updated = true;
        }

        if (updated) {
          await saveCreatorProfile(creatorId, profile);
          context.log('[ConnectWebhook] Updated creator profile:', creatorId, '| payouts:', payoutsEnabled, '| charges:', chargesEnabled);
        }
        break;
      }

      case 'transfer.failed': {
        var transferId = obj.id;
        var destination = obj.destination; // acct_xxx
        context.log.warn('[ConnectWebhook] Transfer failed:', transferId, 'to:', destination);
        // Payout history update handled in Phase 2
        break;
      }

      default:
        context.log('[ConnectWebhook] Unhandled event type:', eventType);
    }

    context.res = { status: 200, headers: CORS_HEADERS, body: { received: true } };

  } catch (err) {
    context.log.error('[ConnectWebhook] Error:', err.message, err.stack);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Webhook processing failed' } };
  }
};

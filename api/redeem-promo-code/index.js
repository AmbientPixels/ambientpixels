// redeem-promo-code — Logged-in users redeem a code; founder flag goes on entitlements.flags.
// POST /api/redeem-promo-code  { code: "FOUNDER-XXXX-XXXX" }
//
// Flow:
//   1. demoGuard — block POSTs in demo/expired environments
//   2. extractUserInfo — must be authenticated
//   3. checkAttempts — rate limit (5 fails / 15 min rolling, per userId)
//   4. findCode — case-insensitive lookup, trim
//   5. expiry → 410 + flip status to 'expired' in blob
//   6. status !== 'unredeemed' → 409
//   7. write entitlements.flags.founder = true (idempotent — re-running is safe)
//   8. mark code redeemed + clear attempts
//
// Cross-blob consistency: step 7 is idempotent, so if step 8 fails on retry,
// re-running redemption is a no-op for entitlements but successfully marks
// the code. Worst case on permanent failure: user has founder, code stays
// unredeemed → could be claimed twice. Acceptable for v1; logged on failure.

const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { extractUserInfo } = require('../_utils/cfAuth');
const demoGuard = require('../_utils/demoGuard');
const promo = require('../_lib/promo-codes');
const { loadEntitlements, saveEntitlements, defaultRecord } = require('../_lib/stripe/entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const ENTITLEMENTS_CONTAINER = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-cf-auth-principal'
};

async function getEntitlementsContainer() {
  let client;
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    client = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  } else {
    client = new BlobServiceClient(
      `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
      new DefaultAzureCredential()
    );
  }
  return client.getContainerClient(ENTITLEMENTS_CONTAINER);
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  const blocked = demoGuard.httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'sign in to redeem a code' } };
    return;
  }

  const rawCode = (req.body && req.body.code) || '';
  const code = String(rawCode).trim().toUpperCase();
  if (!code) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'code is required' } };
    return;
  }

  try {
    // Rate limit check
    const attemptsRecord = await promo.loadAttempts();
    const attemptCheck = promo.checkAttempts(attemptsRecord, userId);
    if (!attemptCheck.allowed) {
      context.res = {
        status: 429,
        headers: CORS_HEADERS,
        body: {
          error: 'too many tries',
          retry_after_minutes: attemptCheck.retry_after_minutes
        }
      };
      return;
    }

    const codesRecord = await promo.loadCodes();
    const entry = promo.findCode(codesRecord, code);

    // 404 — not found
    if (!entry) {
      promo.recordFailedAttempt(attemptsRecord, userId);
      await promo.saveAttempts(attemptsRecord);
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'code not found' } };
      return;
    }

    // 410 — expired (and flip status if it wasn't already)
    if (entry.status === 'unredeemed' && promo.isExpired(entry)) {
      entry.status = 'expired';
      await promo.saveCodes(codesRecord);
      promo.recordFailedAttempt(attemptsRecord, userId);
      await promo.saveAttempts(attemptsRecord);
      context.res = { status: 410, headers: CORS_HEADERS, body: { error: 'code expired', status: 'expired' } };
      return;
    }

    // 409 — already in a non-claimable state
    if (entry.status !== 'unredeemed') {
      promo.recordFailedAttempt(attemptsRecord, userId);
      await promo.saveAttempts(attemptsRecord);
      context.res = { status: 409, headers: CORS_HEADERS, body: { error: 'code is not redeemable', status: entry.status } };
      return;
    }

    // Grant: write entitlements first (idempotent on retry)
    const grantType = (entry.grant && entry.grant.type) || 'founder_flag';
    if (grantType !== 'founder_flag') {
      // Future-proofing: only founder_flag is wired today.
      context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'unsupported grant type: ' + grantType } };
      return;
    }

    const container = await getEntitlementsContainer();
    let entitlements = await loadEntitlements(container, userId);
    if (!entitlements) entitlements = defaultRecord(userId);
    if (!entitlements.flags) entitlements.flags = {};

    const redeemedAt = new Date().toISOString();
    entitlements.flags.founder = true;
    entitlements.flags.founder_redeemed_at = entitlements.flags.founder_redeemed_at || redeemedAt;
    entitlements.flags.founder_code = entry.code;
    await saveEntitlements(container, userId, entitlements);

    // Mark code redeemed
    promo.markRedeemed(codesRecord, code, userId);
    await promo.saveCodes(codesRecord);

    // Clear failed attempts on success
    promo.clearAttempts(attemptsRecord, userId);
    await promo.saveAttempts(attemptsRecord);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        success: true,
        grant: {
          type: grantType,
          redeemed_at: redeemedAt
        }
      }
    };
  } catch (err) {
    context.log.error('[redeem-promo-code] ' + err.message);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'internal error' } };
  }
};

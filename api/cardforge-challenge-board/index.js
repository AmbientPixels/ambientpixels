/**
 * cardforge-challenge-board — GET open Skull Ante challenges
 *
 * Lists individual challenge blobs from skull-board/ prefix,
 * filters by caller's rank range, lazy-deletes expired entries.
 */

const { BlobServiceClient } = require('@azure/storage-blob');
const { isWithinRankRange } = require('../_utils/pvpRanks');
const { checkWagerStaleness } = require('../_utils/wagerResolve');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      const clientPrincipal = JSON.parse(decoded);
      const userId = clientPrincipal.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      if (context && context.log) context.log.warn(`Failed to parse client principal: ${err.message}`);
    }
  }
  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') return { userId: principalId, isAuthenticated: true };
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) { context.log(`[DEV AUTH] Using X-User-ID: ${devUserId}`); return { userId: devUserId, isAuthenticated: true }; }
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const { DefaultAzureCredential } = require('@azure/identity');
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, new DefaultAzureCredential());
}

async function downloadJsonBlob(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;
  const download = await blobClient.download(0);
  const chunks = [];
  for await (const chunk of download.readableStreamBody) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS_HEADERS, body: '' }; return; }
  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS_HEADERS, body: { error: 'Method Not Allowed' } };
    return;
  }

  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Sign in to view the challenge board' } };
    return;
  }

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // Lazy staleness check for caller's active wagers
    try { await checkWagerStaleness(userId, containerClient, context); } catch (e) { /* non-critical */ }

    // Load caller's profile for rank filtering
    const myProfile = await downloadJsonBlob(containerClient, `blindspot/profiles/${userId}.json`) || { peakRank: 'Iron' };
    const myPeakRank = myProfile.peakRank || 'Iron';

    // List all blobs with skull-board/ prefix
    const challenges = [];
    let myChallenge = null;
    const now = Date.now();
    const expiredBlobs = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix: 'skull-board/' })) {
      try {
        const data = await downloadJsonBlob(containerClient, blob.name);
        if (!data) continue;

        // Check expiry
        if (data.expiresAt && new Date(data.expiresAt).getTime() < now) {
          expiredBlobs.push(blob.name);
          continue;
        }

        // Is this the caller's own challenge?
        if (data.challengerId === userId) {
          myChallenge = data;
          continue; // Don't show own challenge in the list
        }

        // Rank filter: only show challenges within ±1 rank of caller
        if (!isWithinRankRange(myPeakRank, data.peakRank || 'Iron')) {
          continue;
        }

        challenges.push(data);
      } catch (e) {
        context.log.warn(`[ChallengeBoard] Error reading ${blob.name}: ${e.message}`);
      }
    }

    // Lazy-delete expired blobs
    for (const blobName of expiredBlobs) {
      try {
        const blobClient = containerClient.getBlockBlobClient(blobName);
        await blobClient.deleteIfExists();
        context.log(`[ChallengeBoard] Lazy-deleted expired challenge: ${blobName}`);
      } catch (e) { /* non-critical */ }
    }

    // Sort by most recent first
    challenges.sort((a, b) => new Date(b.postedAt || 0).getTime() - new Date(a.postedAt || 0).getTime());

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        challenges,
        myChallenge,
        myPeakRank,
        totalVisible: challenges.length
      }
    };
  } catch (err) {
    context.log.error(`[ChallengeBoard] Error: ${err.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Server error', details: err.message } };
  }
};

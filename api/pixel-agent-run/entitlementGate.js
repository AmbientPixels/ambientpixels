// entitlementGate.js — run-time billing lookup for pixel-agent-run.
// Wraps the shared entitlements blob (cardforgeblobdata/cardforge) so the
// endpoint — and its smoke tests — talk to one small surface instead of the
// raw Azure SDK. Smoke tests stub these exports directly.

const { loadEntitlements, saveEntitlements, hasFlag, isAdminUser } = require('../_lib/stripe/entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

let _containerClient = null;
async function getContainer() {
  if (_containerClient) return _containerClient;
  const { BlobServiceClient } = require('@azure/storage-blob');
  let serviceClient;
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    serviceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  } else {
    const { DefaultAzureCredential } = require('@azure/identity');
    serviceClient = new BlobServiceClient('https://' + STORAGE_ACCOUNT_NAME + '.blob.core.windows.net', new DefaultAzureCredential());
  }
  _containerClient = serviceClient.getContainerClient(CONTAINER_NAME);
  return _containerClient;
}

async function loadPaEntitlements(userId) {
  return loadEntitlements(await getContainer(), userId);
}

// Decrement credits with a fresh read so a stale pre-run record can't
// resurrect already-spent credits. Returns the new balance.
async function consumePaCredits(userId, cost) {
  const container = await getContainer();
  const record = await loadEntitlements(container, userId);
  if (!record) return 0;
  record.paCredits = Math.max(0, (record.paCredits || 0) - cost);
  await saveEntitlements(container, userId, record);
  return record.paCredits;
}

module.exports = { loadPaEntitlements, consumePaCredits, hasFlag, isAdminUser };

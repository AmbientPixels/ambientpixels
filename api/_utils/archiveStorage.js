// archiveStorage.js — Cold-storage helper for archived action history (and future archival use cases).
//
// Writes to a separate `company-archive` blob container (distinct from the live `company-state`
// used by companyStorage.js). Keys are date-partitioned (e.g. `actions-2026-04.json`) so each
// month gets its own blob — makes pagination + cost analysis cleaner than a single growing file.
//
// Azure Blob Storage auto-creates the container on first write. No manual provisioning needed.
//
// Public API:
//   appendArchive(key, entries)    Append an array of entries to the archive blob at `key`.
//                                  Creates the blob if missing. Returns the updated total count.
//   readArchive(key, opts)         Read a specific archive blob. opts = { limit, offset }.
//   listArchiveKeys(prefix)        Enumerate archive blob keys starting with `prefix`
//                                  (e.g. 'actions-' returns all monthly partitions).

const path = require('path');
const fs = require('fs');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const ARCHIVE_CONTAINER = 'company-archive';

// ── Blob client (lazy) ──
let archiveClient = null;

async function _createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    const { BlobServiceClient } = require('@azure/storage-blob');
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { BlobServiceClient } = require('@azure/storage-blob');
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

async function _initArchive() {
  if (archiveClient) return archiveClient;
  try {
    const svc = await _createBlobServiceClient();
    archiveClient = svc.getContainerClient(ARCHIVE_CONTAINER);
    await archiveClient.createIfNotExists();
    return archiveClient;
  } catch (err) {
    console.error('[ArchiveStorage] Blob init failed:', err.message);
    return null;
  }
}

// ── Local fallback (dev) ──
const LOCAL_DIR = path.join(__dirname, '..', '_company-archive');

function _ensureLocalDir() {
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

function _localPath(key) {
  var sanitized = String(key).replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json';
  return path.join(LOCAL_DIR, sanitized);
}

// ── Internal read/write ──
async function _readBlob(key) {
  const client = await _initArchive();
  if (!client) {
    // Local fallback
    _ensureLocalDir();
    const p = _localPath(key);
    if (!fs.existsSync(p)) return [];
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return []; }
  }
  const blob = client.getBlockBlobClient(String(key) + '.json');
  try {
    const exists = await blob.exists();
    if (!exists) return [];
    const download = await blob.download(0);
    const body = await _streamToString(download.readableStreamBody);
    return JSON.parse(body || '[]');
  } catch (err) {
    console.warn('[ArchiveStorage] Read failed for', key, err.message);
    return [];
  }
}

async function _writeBlob(key, arr) {
  const client = await _initArchive();
  const payload = JSON.stringify(arr || []);
  if (!client) {
    _ensureLocalDir();
    fs.writeFileSync(_localPath(key), payload);
    return;
  }
  const blob = client.getBlockBlobClient(String(key) + '.json');
  await blob.upload(payload, Buffer.byteLength(payload, 'utf8'), {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

async function _streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ── Public API ──

// Append entries to archive partition at `key`. Creates partition if missing.
// Returns updated total count in the partition.
async function appendArchive(key, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    const existing = await _readBlob(key);
    return existing.length;
  }
  const existing = await _readBlob(key);
  const combined = existing.concat(entries);
  await _writeBlob(key, combined);
  return combined.length;
}

// Read an archive partition. opts = { limit, offset } for pagination.
async function readArchive(key, opts) {
  const arr = await _readBlob(key);
  opts = opts || {};
  const offset = Number.isFinite(opts.offset) ? opts.offset : 0;
  const limit = Number.isFinite(opts.limit) ? opts.limit : arr.length;
  return { total: arr.length, entries: arr.slice(offset, offset + limit) };
}

// Enumerate archive blob keys starting with `prefix` (e.g. 'actions-').
async function listArchiveKeys(prefix) {
  const client = await _initArchive();
  if (!client) {
    _ensureLocalDir();
    return fs.readdirSync(LOCAL_DIR)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  }
  const keys = [];
  try {
    const iter = client.listBlobsFlat({ prefix: prefix });
    for await (const blob of iter) {
      keys.push(blob.name.replace(/\.json$/, ''));
    }
  } catch (err) {
    console.warn('[ArchiveStorage] listArchiveKeys failed:', err.message);
  }
  return keys;
}

module.exports = {
  appendArchive: appendArchive,
  readArchive: readArchive,
  listArchiveKeys: listArchiveKeys,
  ARCHIVE_CONTAINER: ARCHIVE_CONTAINER
};

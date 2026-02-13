// companyStorage.js — Server-side persistent storage for Company Module
// Uses Azure Blob Storage when AZURE_STORAGE_CONNECTION_STRING is set,
// otherwise falls back to local JSON file storage (for dev).

const path = require('path');
const fs = require('fs');

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = 'company-state';
const WRITE_SECRET = process.env.COMPANY_WRITE_SECRET || '';

// ── Blob Storage (production) ──
let blobServiceClient = null;
let containerClient = null;

async function _initBlob() {
  if (containerClient) return containerClient;
  if (!CONNECTION_STRING) return null;

  try {
    const { BlobServiceClient } = require('@azure/storage-blob');
    blobServiceClient = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
    containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    await containerClient.createIfNotExists();
    return containerClient;
  } catch (err) {
    console.error('[CompanyStorage] Blob init failed:', err.message);
    return null;
  }
}

// ── Local file fallback (dev) ──
const LOCAL_DIR = path.join(__dirname, '..', '_company-data');

function _ensureLocalDir() {
  if (!fs.existsSync(LOCAL_DIR)) {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
  }
}

function _localPath(key) {
  // Sanitize key for filesystem
  return path.join(LOCAL_DIR, key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
}

// ── Public API ──

async function getState(key) {
  const container = await _initBlob();

  if (container) {
    try {
      const blob = container.getBlockBlobClient(key + '.json');
      const download = await blob.download(0);
      const body = await streamToString(download.readableStreamBody);
      return JSON.parse(body);
    } catch (err) {
      if (err.statusCode === 404) return null;
      console.error('[CompanyStorage] Blob read error:', key, err.message);
      return null;
    }
  }

  // Local fallback
  _ensureLocalDir();
  const filePath = _localPath(key);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error('[CompanyStorage] Local read error:', key, err.message);
    return null;
  }
}

async function setState(key, value) {
  const container = await _initBlob();

  if (container) {
    try {
      const blob = container.getBlockBlobClient(key + '.json');
      const content = JSON.stringify(value, null, 2);
      await blob.upload(content, Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        overwrite: true
      });
      return true;
    } catch (err) {
      console.error('[CompanyStorage] Blob write error:', key, err.message);
      return false;
    }
  }

  // Local fallback
  _ensureLocalDir();
  try {
    fs.writeFileSync(_localPath(key), JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[CompanyStorage] Local write error:', key, err.message);
    return false;
  }
}

async function appendLog(logEvent) {
  const logs = (await getState('logs')) || [];
  logs.push(logEvent);
  // Cap at 1000 entries
  const trimmed = logs.length > 1000 ? logs.slice(-1000) : logs;
  await setState('logs', trimmed);
  return logEvent;
}

async function getLogs(options) {
  options = options || {};
  let logs = (await getState('logs')) || [];

  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    logs = logs.filter(l => new Date(l.timestamp).getTime() >= sinceMs);
  }
  if (options.type) {
    logs = logs.filter(l => l.type === options.type);
  }
  if (options.limit) {
    logs = logs.slice(-options.limit);
  }
  return logs;
}

// Validate write secret (returns true if valid or no secret configured)
function validateSecret(headerValue) {
  if (!WRITE_SECRET) return true; // no secret configured = open writes
  return headerValue === WRITE_SECRET;
}

// Helper: stream to string for blob downloads
async function streamToString(stream) {
  if (!stream) return '';
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = {
  getState,
  setState,
  appendLog,
  getLogs,
  validateSecret
};

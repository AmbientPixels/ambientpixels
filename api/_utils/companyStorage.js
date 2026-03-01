// companyStorage.js — Server-side persistent storage for Company Module
// Uses Azure Blob Storage (cardforgeblobdata) via Managed Identity or connection string,
// falls back to local JSON file storage for dev.

const path = require('path');
const fs = require('fs');
const { prefixBlobKey, getBlobPrefix } = require('./demoGuard');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'company-state';
const WRITE_SECRET = process.env.COMPANY_WRITE_SECRET || '';

// ── Blob Storage (production) ──
let blobServiceClient = null;
let containerClient = null;

async function _createBlobServiceClient() {
  // Prefer connection string when available (local or explicit config)
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    const { BlobServiceClient } = require('@azure/storage-blob');
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  // Fallback to Managed Identity via DefaultAzureCredential
  const { BlobServiceClient } = require('@azure/storage-blob');
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

async function _initBlob() {
  if (containerClient) return containerClient;

  try {
    blobServiceClient = await _createBlobServiceClient();
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
  var prefix = getBlobPrefix();
  var sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  return prefix ? path.join(LOCAL_DIR, prefix, sanitized) : path.join(LOCAL_DIR, sanitized);
}

// ── Public API ──

async function getState(key) {
  const container = await _initBlob();

  if (container) {
    try {
      const blob = container.getBlockBlobClient(prefixBlobKey(key + '.json'));
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
      const blob = container.getBlockBlobClient(prefixBlobKey(key + '.json'));
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

// ═══════════════════════════════════════════════════
// ── Company Store v1 — Collection helpers ──
// ═══════════════════════════════════════════════════

const AUDIT_TYPES = ['action', 'worker', 'planner', 'calibration', 'priority'];
const AUDIT_MAX = 5000;
const AUDIT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const QUEUE_TERMINAL_MAX = 1000;
const ARTIFACTS_MAX = 20;
const ACTIVE_STATUSES = ['pending_approval', 'approved_ready', 'executing'];

const SETTINGS_ALLOW_LIST = [
  'actionsEnabled', 'taskEnabled', 'socialEnabled', 'emailEnabled',
  'configChangesEnabled', 'plannerEnabled', 'calibrationEnabled',
  'workerEnabled', 'priorityWeights', 'plannerThresholds',
  'plannerCadenceDays', 'calibrationCadenceDays',
  'timezone'
];

function _storeKey(collection, subtype) {
  return subtype ? `store-${collection}-${subtype}` : `store-${collection}`;
}

// ── Audits ──
async function getStoreAudits(type, options) {
  options = options || {};
  if (AUDIT_TYPES.indexOf(type) === -1) return [];
  let events = (await getState(_storeKey('audits', type))) || [];
  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() >= sinceMs);
  }
  const limit = options.limit || 500;
  if (events.length > limit) events = events.slice(-limit);
  return events;
}

const DEDUP_TAIL = 2000;

async function appendStoreAudits(type, newEvents) {
  if (AUDIT_TYPES.indexOf(type) === -1) return { received: 0, appended: 0, droppedDuplicate: 0, reason: 'invalid type' };
  if (!Array.isArray(newEvents) || newEvents.length === 0) return { received: 0, appended: 0, droppedDuplicate: 0 };
  const received = newEvents.length;
  const key = _storeKey('audits', type);
  let existing = (await getState(key)) || [];
  // Assign server-side eventId to any event missing one
  newEvents.forEach(e => {
    if (!e.eventId) e.eventId = 'srv_' + type + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  });
  // Build dedup set from tail of existing (bounded)
  const tail = existing.length > DEDUP_TAIL ? existing.slice(-DEDUP_TAIL) : existing;
  const seen = new Set();
  tail.forEach(e => { if (e.eventId) seen.add(e.eventId); });
  // Filter duplicates
  const unique = newEvents.filter(e => !seen.has(e.eventId));
  const droppedDuplicate = received - unique.length;
  existing = existing.concat(unique);
  // Prune by age
  const cutoff = Date.now() - AUDIT_MAX_AGE_MS;
  existing = existing.filter(e => new Date(e.timestamp || 0).getTime() >= cutoff);
  // Prune by count
  if (existing.length > AUDIT_MAX) existing = existing.slice(-AUDIT_MAX);
  await setState(key, existing);
  return { received, appended: unique.length, droppedDuplicate, total: existing.length };
}

// ── Queue ──
async function getStoreQueue() {
  const raw = (await getState(_storeKey('queue'))) || [];
  // Dedup by id (last occurrence wins)
  const seen = {};
  const deduped = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    if (!raw[i].id || seen[raw[i].id]) continue;
    seen[raw[i].id] = true;
    deduped.unshift(raw[i]);
  }
  return deduped;
}

async function upsertStoreQueue(upserts, tombstones) {
  const key = _storeKey('queue');
  let queue = (await getState(key)) || [];
  const result = { upserted: 0, removed: 0 };
  // Apply tombstones (remove by id)
  if (Array.isArray(tombstones) && tombstones.length > 0) {
    const removeSet = {};
    tombstones.forEach(id => { removeSet[id] = true; });
    const before = queue.length;
    queue = queue.filter(item => !removeSet[item.id]);
    result.removed = before - queue.length;
  }
  // Apply upserts (by id)
  if (Array.isArray(upserts) && upserts.length > 0) {
    const idMap = {};
    queue.forEach((item, i) => { idMap[item.id] = i; });
    upserts.forEach(item => {
      if (!item || !item.id) return;
      if (idMap[item.id] != null) {
        queue[idMap[item.id]] = item;
      } else {
        queue.push(item);
        idMap[item.id] = queue.length - 1;
      }
      result.upserted++;
    });
  }
  // Prune terminal items
  const active = queue.filter(item => ACTIVE_STATUSES.indexOf(item.status) !== -1);
  const terminal = queue.filter(item => ACTIVE_STATUSES.indexOf(item.status) === -1);
  const prunedTerminal = terminal.length > QUEUE_TERMINAL_MAX ? terminal.slice(-QUEUE_TERMINAL_MAX) : terminal;
  queue = active.concat(prunedTerminal);
  await setState(key, queue);
  result.total = queue.length;
  return result;
}

// ── Settings ──
async function getStoreSettings() {
  return (await getState(_storeKey('settings'))) || {};
}

async function patchStoreSettings(patch) {
  if (!patch || typeof patch !== 'object') return { ok: false, reason: 'invalid patch' };
  const key = _storeKey('settings');
  const current = (await getState(key)) || {};
  let applied = 0;
  const rejected = [];
  for (const k in patch) {
    if (SETTINGS_ALLOW_LIST.indexOf(k) === -1) {
      rejected.push(k);
      continue;
    }
    current[k] = patch[k];
    applied++;
  }
  current._updatedAt = new Date().toISOString();
  await setState(key, current);
  return { ok: true, applied, rejected, settings: current };
}

// ── Artifacts ──
async function getStoreArtifacts(type) {
  return (await getState(_storeKey('artifacts', type))) || [];
}

async function upsertStoreArtifacts(type, items) {
  if (!Array.isArray(items) || items.length === 0) return { upserted: 0 };
  const key = _storeKey('artifacts', type);
  let existing = (await getState(key)) || [];
  const idMap = {};
  existing.forEach((a, i) => { idMap[a.id] = i; });
  items.forEach(item => {
    if (!item || !item.id) return;
    if (idMap[item.id] != null) {
      existing[idMap[item.id]] = item;
    } else {
      existing.push(item);
    }
  });
  // Prune to max
  if (existing.length > ARTIFACTS_MAX) existing = existing.slice(-ARTIFACTS_MAX);
  await setState(key, existing);
  return { upserted: items.length, total: existing.length };
}

// ── Snapshot (read all collections) ──
async function getStoreSnapshot(options) {
  options = options || {};
  const audits = {};
  for (const type of AUDIT_TYPES) {
    audits[type] = await getStoreAudits(type, { since: options.since, limit: options.limit });
  }
  const queue = await getStoreQueue();
  const settings = await getStoreSettings();
  const plannerArtifacts = await getStoreArtifacts('planner');
  const calibrationArtifacts = await getStoreArtifacts('calibration');
  return {
    settings,
    actionQueue: queue,
    audits,
    artifacts: {
      plannerLatest: plannerArtifacts.length > 0 ? plannerArtifacts[plannerArtifacts.length - 1] : null,
      calibrationLatest: calibrationArtifacts.length > 0 ? calibrationArtifacts[calibrationArtifacts.length - 1] : null
    }
  };
}

// ── Migrate (bulk import) ──
async function migrateStore(payload) {
  const summary = { audits: {}, queue: null, settings: null, artifacts: {} };
  // Audits
  if (payload.audits) {
    for (const type of AUDIT_TYPES) {
      if (Array.isArray(payload.audits[type]) && payload.audits[type].length > 0) {
        summary.audits[type] = await appendStoreAudits(type, payload.audits[type]);
      }
    }
  }
  // Queue
  if (Array.isArray(payload.actionQueue) && payload.actionQueue.length > 0) {
    summary.queue = await upsertStoreQueue(payload.actionQueue, []);
  }
  // Settings
  if (payload.settings && typeof payload.settings === 'object') {
    summary.settings = await patchStoreSettings(payload.settings);
  }
  // Artifacts
  if (payload.artifacts) {
    if (payload.artifacts.plannerLatest) {
      summary.artifacts.planner = await upsertStoreArtifacts('planner', [payload.artifacts.plannerLatest]);
    }
    if (payload.artifacts.calibrationLatest) {
      summary.artifacts.calibration = await upsertStoreArtifacts('calibration', [payload.artifacts.calibrationLatest]);
    }
  }
  return summary;
}

// ── Gemini API Usage Tracking ──
// Gemini 2.0 Flash pricing (per 1M tokens)
const GEMINI_PRICING = {
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-lite': { input: 0.025, output: 0.10 },
  'default': { input: 0.10, output: 0.40 }
};

async function logGeminiUsage(entry) {
  // entry: { caller, model, promptTokens, completionTokens, totalTokens, timestamp, agentId? }
  try {
    const usage = (await getState('geminiUsage')) || [];
    const model = entry.model || 'gemini-2.0-flash';
    const pricing = GEMINI_PRICING[model] || GEMINI_PRICING['default'];
    const inputCost = (entry.promptTokens || 0) * pricing.input / 1000000;
    const outputCost = (entry.completionTokens || 0) * pricing.output / 1000000;

    usage.push({
      id: 'gu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      caller: entry.caller || 'unknown',
      model: model,
      agentId: entry.agentId || null,
      promptTokens: entry.promptTokens || 0,
      completionTokens: entry.completionTokens || 0,
      totalTokens: entry.totalTokens || 0,
      inputCost: Math.round(inputCost * 1000000) / 1000000,
      outputCost: Math.round(outputCost * 1000000) / 1000000,
      totalCost: Math.round((inputCost + outputCost) * 1000000) / 1000000,
      timestamp: entry.timestamp || new Date().toISOString()
    });

    // Retention: keep last 5000 entries, max 30 days
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const pruned = usage.filter(u => u.timestamp >= cutoff).slice(-5000);
    await setState('geminiUsage', pruned);
  } catch (err) {
    console.error('[CompanyStorage] logGeminiUsage failed:', err.message);
  }
}

async function getGeminiCostSummary(days) {
  days = days || 30;
  const usage = (await getState('geminiUsage')) || [];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const recent = usage.filter(u => u.timestamp >= cutoff);

  // Aggregate by day
  const byDay = {};
  const byCaller = {};
  const byAgent = {};
  let totalInput = 0, totalOutput = 0, totalCost = 0;

  recent.forEach(function (u) {
    var day = u.timestamp.substring(0, 10);
    if (!byDay[day]) byDay[day] = { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    byDay[day].calls++;
    byDay[day].promptTokens += u.promptTokens;
    byDay[day].completionTokens += u.completionTokens;
    byDay[day].cost += u.totalCost;

    var caller = u.caller || 'unknown';
    if (!byCaller[caller]) byCaller[caller] = { calls: 0, cost: 0 };
    byCaller[caller].calls++;
    byCaller[caller].cost += u.totalCost;

    if (u.agentId) {
      if (!byAgent[u.agentId]) byAgent[u.agentId] = { calls: 0, cost: 0 };
      byAgent[u.agentId].calls++;
      byAgent[u.agentId].cost += u.totalCost;
    }

    totalInput += u.promptTokens;
    totalOutput += u.completionTokens;
    totalCost += u.totalCost;
  });

  return {
    period: days + 'd',
    totalCalls: recent.length,
    totalTokens: totalInput + totalOutput,
    totalPromptTokens: totalInput,
    totalCompletionTokens: totalOutput,
    totalCost: Math.round(totalCost * 100) / 100,
    byDay: byDay,
    byCaller: byCaller,
    byAgent: byAgent
  };
}

module.exports = {
  getState,
  setState,
  appendLog,
  getLogs,
  validateSecret,
  // Company Store v1
  AUDIT_TYPES,
  SETTINGS_ALLOW_LIST,
  getStoreAudits,
  appendStoreAudits,
  getStoreQueue,
  upsertStoreQueue,
  getStoreSettings,
  patchStoreSettings,
  getStoreArtifacts,
  upsertStoreArtifacts,
  getStoreSnapshot,
  migrateStore,
  // Gemini Usage
  logGeminiUsage,
  getGeminiCostSummary,
  GEMINI_PRICING
};

// promo-codes.js — Storage helpers for the Pixel Agents promo code system.
//
// Two state keys (companyStorage, container `company-state`):
//   promoCodes     — { version: 1, codes: [...] }
//                    code entry: { code, status, grant, campaign, created_at, expires_at, redeemed_by, redeemed_at }
//                    status ∈ {unredeemed, redeemed, revoked, expired}
//                    expires_at is the redemption deadline (when the code can no longer be claimed).
//                    The grant itself (e.g. founder_flag) has no expiry.
//   promoAttempts  — { attempts: { <userId>: { count, window_started_at } } }
//                    Rolling 15-min window for brute-force protection. Pruned >24h on each load.
//
// loadCodes() / loadAttempts() return a default-if-null seed, so the blob materializes
// on first write — no separate seed script required.

const storage = require('../_utils/companyStorage');

const PROMO_CODES_KEY = 'promoCodes';
const PROMO_ATTEMPTS_KEY = 'promoAttempts';

const ATTEMPT_LIMIT = 5;          // 6th failure in window → block
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_PRUNE_MS = 24 * 60 * 60 * 1000;

function defaultCodesRecord() {
  return { version: 1, codes: [] };
}

function defaultAttemptsRecord() {
  return { attempts: {} };
}

async function loadCodes() {
  const record = await storage.getState(PROMO_CODES_KEY);
  if (!record || !Array.isArray(record.codes)) return defaultCodesRecord();
  return record;
}

async function saveCodes(record) {
  return storage.setState(PROMO_CODES_KEY, record);
}

async function loadAttempts() {
  const record = await storage.getState(PROMO_ATTEMPTS_KEY);
  if (!record || !record.attempts || typeof record.attempts !== 'object') {
    return defaultAttemptsRecord();
  }
  // Prune entries older than 24h on read.
  const cutoff = Date.now() - ATTEMPT_PRUNE_MS;
  let pruned = false;
  Object.keys(record.attempts).forEach(function (uid) {
    const entry = record.attempts[uid];
    const ts = entry && entry.window_started_at ? new Date(entry.window_started_at).getTime() : 0;
    if (!ts || ts < cutoff) {
      delete record.attempts[uid];
      pruned = true;
    }
  });
  // Pruned in memory; caller's saveAttempts (if it runs) will persist.
  // We deliberately don't auto-save here — keeps loadAttempts side-effect-free.
  void pruned;
  return record;
}

async function saveAttempts(record) {
  return storage.setState(PROMO_ATTEMPTS_KEY, record);
}

function _normalize(code) {
  return String(code || '').trim().toUpperCase();
}

function findCode(record, code) {
  const target = _normalize(code);
  if (!target) return null;
  return (record.codes || []).find(function (c) { return _normalize(c.code) === target; }) || null;
}

function isExpired(entry) {
  if (!entry || !entry.expires_at) return false;
  const ts = new Date(entry.expires_at).getTime();
  if (!ts) return false;
  return ts < Date.now();
}

function markRedeemed(record, code, userId) {
  const entry = findCode(record, code);
  if (!entry) return null;
  entry.status = 'redeemed';
  entry.redeemed_by = userId;
  entry.redeemed_at = new Date().toISOString();
  return entry;
}

function checkAttempts(record, userId) {
  const entry = record.attempts[userId];
  if (!entry) return { allowed: true, retry_after_minutes: 0 };
  const windowStart = entry.window_started_at ? new Date(entry.window_started_at).getTime() : 0;
  const elapsed = Date.now() - windowStart;
  if (elapsed >= ATTEMPT_WINDOW_MS) {
    // Window has rolled — entry is effectively reset on next failure.
    return { allowed: true, retry_after_minutes: 0 };
  }
  if ((entry.count || 0) < ATTEMPT_LIMIT) {
    return { allowed: true, retry_after_minutes: 0 };
  }
  const remaining = ATTEMPT_WINDOW_MS - elapsed;
  return { allowed: false, retry_after_minutes: Math.max(1, Math.ceil(remaining / 60000)) };
}

function recordFailedAttempt(record, userId) {
  if (!record.attempts) record.attempts = {};
  let entry = record.attempts[userId];
  const now = Date.now();
  if (!entry || !entry.window_started_at || (now - new Date(entry.window_started_at).getTime() >= ATTEMPT_WINDOW_MS)) {
    entry = { count: 1, window_started_at: new Date(now).toISOString() };
  } else {
    entry.count = (entry.count || 0) + 1;
  }
  record.attempts[userId] = entry;
  return entry;
}

function clearAttempts(record, userId) {
  if (record.attempts && record.attempts[userId]) {
    delete record.attempts[userId];
  }
}

function summarize(record) {
  const codes = (record && record.codes) || [];
  const summary = {
    total: codes.length,
    unredeemed: 0,
    redeemed: 0,
    expired: 0,
    revoked: 0,
    expiring_soon: 0
  };
  const campaigns = {};
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  codes.forEach(function (c) {
    const status = c.status || 'unredeemed';
    if (summary[status] != null) summary[status]++;

    const camp = c.campaign || '(no campaign)';
    if (!campaigns[camp]) campaigns[camp] = { total: 0, unredeemed: 0, redeemed: 0, expired: 0, revoked: 0 };
    campaigns[camp].total++;
    if (campaigns[camp][status] != null) campaigns[camp][status]++;

    if (status === 'unredeemed' && c.expires_at) {
      const exp = new Date(c.expires_at).getTime();
      if (exp > now && exp - now <= sevenDaysMs) summary.expiring_soon++;
    }
  });

  return { summary, campaigns };
}

function recentRedemptions(record, limit) {
  const codes = (record && record.codes) || [];
  const max = limit || 10;
  return codes
    .filter(function (c) { return c.status === 'redeemed' && c.redeemed_at; })
    .sort(function (a, b) { return new Date(b.redeemed_at) - new Date(a.redeemed_at); })
    .slice(0, max)
    .map(function (c) {
      const uid = c.redeemed_by || '';
      const truncated = uid.length > 8 ? uid.slice(0, 8) + '…' : uid;
      return {
        code: c.code,
        redeemed_by: truncated,
        redeemed_at: c.redeemed_at,
        campaign: c.campaign || null
      };
    });
}

module.exports = {
  defaultCodesRecord,
  defaultAttemptsRecord,
  loadCodes,
  saveCodes,
  loadAttempts,
  saveAttempts,
  findCode,
  isExpired,
  markRedeemed,
  checkAttempts,
  recordFailedAttempt,
  clearAttempts,
  summarize,
  recentRedemptions,
  ATTEMPT_LIMIT,
  ATTEMPT_WINDOW_MS,
  PROMO_CODES_KEY,
  PROMO_ATTEMPTS_KEY
};

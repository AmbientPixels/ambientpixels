// platformRetry.js — Exponential backoff retry wrapper for social platform HTTP calls.
//
// Handles transient 429 (rate limit) and 5xx (server) responses by:
//   1. Reading the platform's Retry-After header if present (seconds or HTTP-date)
//   2. Otherwise using exponential backoff: 60s / 120s / 240s (capped at 240s)
//   3. Logging each retry as an `action-retry` event in governanceLog so CEO sees it in
//      the action-audit dashboard
//   4. Throwing the final captured error after maxRetries exhausted
//
// What this does NOT retry on:
//   - 4xx auth errors (401, 403) — token refresh is already handled upstream
//   - 400 bad request — retry with same payload won't help
//   - Network errors — router's existing 3-attempt/5-min cooldown handles those
//     at a different layer
//
// Usage:
//   const { retryOn429 } = require('../../_utils/platformRetry');
//   const result = await retryOn429(
//     async () => await _doHttpCall(),      // must return { statusCode, headers, body } or throw
//     { platform: 'bluesky', actionId: action.id }
//   );

const BASE_DELAY_MS = 60000;   // 1 minute
const MAX_DELAY_MS = 240000;   // 4 minutes
const DEFAULT_MAX_RETRIES = 3;

// Storage is optional — if unavailable (e.g., local dev), retries still work, just without logging.
let _storage = null;
function _getStorage() {
  if (_storage === null) {
    try { _storage = require('./companyStorage'); } catch (_) { _storage = false; }
  }
  return _storage || null;
}

function _parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  // Retry-After can be either seconds (integer) or HTTP-date.
  const asNum = parseInt(headerValue, 10);
  if (Number.isFinite(asNum) && asNum > 0) return Math.min(asNum * 1000, MAX_DELAY_MS);
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) {
    const diff = asDate - Date.now();
    if (diff > 0) return Math.min(diff, MAX_DELAY_MS);
  }
  return null;
}

function _shouldRetry(statusCode) {
  if (!Number.isFinite(statusCode)) return false;
  if (statusCode === 429) return true;
  if (statusCode >= 500 && statusCode <= 599) return true;
  return false;
}

function _getStatus(resOrErr) {
  if (!resOrErr) return null;
  if (Number.isFinite(resOrErr.statusCode)) return resOrErr.statusCode;
  if (Number.isFinite(resOrErr.status)) return resOrErr.status;
  // Some executors throw an error object with .code like 'BLUESKY_API_ERROR_429'
  if (resOrErr.code && typeof resOrErr.code === 'string') {
    const m = resOrErr.code.match(/_(\d{3})$/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function _getHeader(res, name) {
  if (!res || !res.headers) return null;
  const lower = String(name).toLowerCase();
  const headers = res.headers;
  // Headers may be keyed case-sensitively or lowercased
  for (const k in headers) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return null;
}

async function _logRetry(platform, actionId, statusCode, waitMs, attempt) {
  const storage = _getStorage();
  if (!storage) return;
  try {
    const log = (await storage.getState('governanceLog')) || [];
    log.push({
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      type: 'action-retry',
      agentId: null,
      summary: 'Platform ' + platform + ' returned ' + statusCode + ' — retrying in ' + Math.round(waitMs / 1000) + 's (attempt ' + attempt + ')',
      timestamp: new Date().toISOString(),
      details: {
        platform: platform,
        actionId: actionId || null,
        statusCode: statusCode,
        waitMs: waitMs,
        attempt: attempt
      }
    });
    if (log.length > 500) log.splice(0, log.length - 500);
    await storage.setState('governanceLog', log);
  } catch (_) { /* logging is best-effort */ }
}

function _sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * Wrap an HTTP-calling function with exponential backoff on 429 and 5xx responses.
 *
 * @param {Function} httpCallFn — async function that performs the HTTP call. Must either:
 *   (a) return { statusCode, headers, body } — then retry triggers on statusCode 429 or 5xx
 *   (b) throw an error — then retry triggers only if the error's status code (via .statusCode,
 *       .status, or code suffix _XXX) matches 429/5xx. All other errors re-thrown immediately.
 * @param {Object} opts — { platform: 'x'|'bluesky'|'linkedin', actionId, maxRetries, baseDelayMs }
 * @returns whatever httpCallFn returned on success
 * @throws the last error after retries are exhausted, or immediately for non-retryable errors
 */
async function retryOn429(httpCallFn, opts) {
  opts = opts || {};
  const platform = opts.platform || 'unknown';
  const actionId = opts.actionId || null;
  const maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : DEFAULT_MAX_RETRIES;
  const baseDelay = Number.isFinite(opts.baseDelayMs) ? opts.baseDelayMs : BASE_DELAY_MS;

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await httpCallFn();
      const status = _getStatus(result);
      if (status != null && _shouldRetry(status)) {
        // Response came back but indicated retry-worthy status (e.g., executor returns instead of throws)
        lastResponse = result;
        if (attempt >= maxRetries) break;
        const retryAfterMs = _parseRetryAfter(_getHeader(result, 'Retry-After'));
        const waitMs = retryAfterMs != null ? retryAfterMs : Math.min(baseDelay * Math.pow(2, attempt), MAX_DELAY_MS);
        await _logRetry(platform, actionId, status, waitMs, attempt + 1);
        await _sleep(waitMs);
        continue;
      }
      return result;  // success (or non-retryable 2xx/3xx/4xx)
    } catch (err) {
      lastError = err;
      const status = _getStatus(err);
      if (status == null || !_shouldRetry(status)) {
        // Not a retryable error — re-throw immediately (auth, bad request, network, etc.)
        throw err;
      }
      if (attempt >= maxRetries) break;
      // Some errors carry headers in err.response or err.headers
      const headers = (err.response && err.response.headers) || err.headers || null;
      const retryAfterMs = headers ? _parseRetryAfter(_getHeader({ headers: headers }, 'Retry-After')) : null;
      const waitMs = retryAfterMs != null ? retryAfterMs : Math.min(baseDelay * Math.pow(2, attempt), MAX_DELAY_MS);
      await _logRetry(platform, actionId, status, waitMs, attempt + 1);
      await _sleep(waitMs);
    }
  }

  // Exhausted retries — throw the last error (or synthesize one from the last response)
  if (lastError) throw lastError;
  if (lastResponse) {
    const synthetic = new Error('Platform ' + platform + ' returned ' + _getStatus(lastResponse) + ' after ' + (maxRetries + 1) + ' attempts');
    synthetic.statusCode = _getStatus(lastResponse);
    synthetic.response = lastResponse;
    throw synthetic;
  }
  throw new Error('retryOn429 exhausted without a final result (should not happen)');
}

/**
 * Idempotency guard — returns an existing receipt if this action has already published
 * the same content. Prevents double-posts when a retry fires after a successful API call
 * but before the receipt was persisted (network timeout between POST → setState).
 *
 * Returns the existing receipt (signaling caller should skip the API call) when:
 *   - action.execution.receipt exists AND
 *   - receipt.content_hash matches the currentContentHash passed in
 *
 * Returns null (signaling caller should proceed with the API call) when:
 *   - no existing receipt, OR
 *   - receipt exists but content_hash diverges (CEO edited the text → new attempt)
 *
 * @param {Object} action — the full action object
 * @param {string} currentContentHash — sha256 of the current post text (whatever the
 *                                      executor is about to send to the platform)
 * @returns {Object|null} existing receipt to return immediately, or null to proceed
 */
function shouldSkipDueToExistingReceipt(action, currentContentHash) {
  if (!action || !action.execution || !action.execution.receipt) return null;
  const receipt = action.execution.receipt;
  if (!receipt.content_hash) return null;  // no hash to compare against — safer to re-post
  if (receipt.content_hash === currentContentHash) return receipt;
  return null;
}

module.exports = {
  retryOn429: retryOn429,
  shouldSkipDueToExistingReceipt: shouldSkipDueToExistingReceipt,
  _parseRetryAfter: _parseRetryAfter,
  _shouldRetry: _shouldRetry,
  _getStatus: _getStatus
};

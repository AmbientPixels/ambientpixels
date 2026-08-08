// productAnalytics.js — Server-side product analytics event emitter
// Mirrors the socialMetrics/telemetry.js pattern but for product events.
// Daily-sharded blobs: pa/events-YYYY-MM-DD.json in company-state container.

const storage = require('./companyStorage');

var MAX_EVENTS_PER_DAY = 50000;

function _id() {
  return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function _today() {
  return new Date().toISOString().substring(0, 10);
}

function _blobKey(date) {
  return 'pa/events-' + (date || _today());
}

/**
 * Build a product analytics event.
 * @param {string} product — product identifier (e.g. 'blindspot', 'ambientscore')
 * @param {string} event — event name (e.g. 'battle_end', 'purchase_confirmed')
 * @param {object} [props] — freeform event properties
 * @param {object} [meta] — meta fields (userId, sessionId, category, source)
 * @returns {object} event object
 */
function buildEvent(product, event, props, meta) {
  meta = meta || {};
  return {
    id: meta.id || _id(),
    product: product,
    event: event,
    category: meta.category || 'engagement',
    ts: new Date().toISOString(),
    sessionId: meta.sessionId || '',
    userId: meta.userId || '',
    // A server emitter often knows an anonymous id (the browser's pa_anon_id,
    // forwarded on the request) — that is an identity, not a login. Deriving
    // isAuth from "we have a userId" reported every anonymous run as an
    // authenticated user. Callers who know may say so; the old default stands
    // for callers who don't.
    isAuth: meta.isAuth !== undefined ? !!meta.isAuth : !!meta.userId,
    page: meta.page || '',
    source: meta.source || 'server',
    // Our own devices, flagged via ?pa_internal=1. Only the browser knows, so a
    // server emitter can only carry the flag the client sent it — but carry it
    // it must, or server-side truth becomes the one place our own testing still
    // reads as demand. Matches the ingest's shape: absent, never false.
    internal: meta.internal === true || undefined,
    props: props || {}
  };
}

/**
 * Emit (append) one or more events to the daily blob.
 * Non-blocking: callers should wrap in try/catch — analytics must never break APIs.
 * @param {string} product
 * @param {string} event
 * @param {object} [props]
 * @param {object} [meta]
 */
async function emitEvent(product, event, props, meta) {
  var evt = buildEvent(product, event, props, meta);
  await _appendToDay([evt]);
  return evt;
}

/**
 * Append events to today's shard under optimistic concurrency.
 *
 * Was getState → push → setState, which has two failure modes that both read as
 * "the traffic wasn't there". A concurrent writer (the batched client beacon and
 * a server emitter land on the SAME daily blob) loses whichever write finishes
 * first. And a transient read error resolved to `|| []`, so the next write
 * replaced a whole day of events with one — the loudest possible version of the
 * bug this file exists to prevent. mutateState re-runs the append against fresh
 * state on conflict and refuses to write at all when the read failed.
 *
 * The mutator may run more than once, so it must only touch its arguments — the
 * caller's accepted-event list is computed before we get here.
 */
async function _appendToDay(events) {
  var key = _blobKey();
  await storage.mutateState(key, function (current) {
    var next = Array.isArray(current) ? current.slice() : [];
    for (var i = 0; i < events.length; i++) next.push(events[i]);
    if (next.length > MAX_EVENTS_PER_DAY) next = next.slice(-MAX_EVENTS_PER_DAY);
    return next;
  });
}

/**
 * Emit a batch of pre-built events (used by the ingest API).
 * @param {Array} events — array of event objects
 */
async function emitBatch(events) {
  if (!Array.isArray(events) || events.length === 0) return { appended: 0 };
  // Accepted set is built HERE, not inside the mutator — _appendToDay may re-run
  // its callback after a write conflict, and a counter incremented in there
  // would report one batch as several.
  var accepted = [];
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (!e || !e.product || !e.event) continue;
    if (!e.id) e.id = _id();
    if (!e.ts) e.ts = new Date().toISOString();
    if (!e.source) e.source = 'client';
    accepted.push(e);
  }
  if (accepted.length === 0) return { appended: 0 };
  await _appendToDay(accepted);
  return { appended: accepted.length };
}

/**
 * Read events for a specific date (for aggregation/query APIs).
 * @param {string} date — YYYY-MM-DD
 * @returns {Array} events
 */
async function readEvents(date) {
  return (await storage.getState(_blobKey(date))) || [];
}

/**
 * Read events for a date range.
 * @param {string} startDate — YYYY-MM-DD
 * @param {string} endDate — YYYY-MM-DD (inclusive)
 * @returns {Array} all events in range
 */
async function readEventRange(startDate, endDate) {
  var start = new Date(startDate);
  var end = new Date(endDate);
  var dates = [];
  for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().substring(0, 10));
  }
  // Parallel fetch
  var results = await Promise.all(dates.map(function (dt) { return readEvents(dt); }));
  var all = [];
  for (var i = 0; i < results.length; i++) {
    all = all.concat(results[i]);
  }
  return all;
}

module.exports = {
  buildEvent: buildEvent,
  emitEvent: emitEvent,
  emitBatch: emitBatch,
  readEvents: readEvents,
  readEventRange: readEventRange
};

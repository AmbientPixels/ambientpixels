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
    isAuth: !!meta.userId,
    page: meta.page || '',
    source: meta.source || 'server',
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
  var key = _blobKey();
  var current = (await storage.getState(key)) || [];
  current.push(evt);
  if (current.length > MAX_EVENTS_PER_DAY) {
    current = current.slice(-MAX_EVENTS_PER_DAY);
  }
  await storage.setState(key, current);
  return evt;
}

/**
 * Emit a batch of pre-built events (used by the ingest API).
 * @param {Array} events — array of event objects
 */
async function emitBatch(events) {
  if (!Array.isArray(events) || events.length === 0) return { appended: 0 };
  var key = _blobKey();
  var current = (await storage.getState(key)) || [];
  var count = 0;
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (!e || !e.product || !e.event) continue;
    if (!e.id) e.id = _id();
    if (!e.ts) e.ts = new Date().toISOString();
    if (!e.source) e.source = e.source || 'client';
    current.push(e);
    count++;
  }
  if (current.length > MAX_EVENTS_PER_DAY) {
    current = current.slice(-MAX_EVENTS_PER_DAY);
  }
  await storage.setState(key, current);
  return { appended: count };
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

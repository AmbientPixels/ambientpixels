'use strict';

/**
 * Revenue Ledger — the single central record of company INCOME.
 *
 * Every Stripe money moment (one-time purchase, subscription start/cancel,
 * refund, dispute) appends one idempotent entry here. Written/read via the
 * low-level companyStorage blob interface (same as pingLog) so it does NOT
 * need a company-state VALID_KEYS entry and never touches the high-blast-radius
 * company-state/index.js.
 *
 * Design rules:
 *  - IDEMPOTENT on Stripe `event.id`. Stripe retries webhooks; without this the
 *    same payment double-counts. This is the whole point — never remove it.
 *  - APPEND-ONLY. Revenue is low-volume and durable; we keep every entry.
 *  - NON-FATAL by contract. recordRevenue swallows storage errors and returns a
 *    result object; call sites additionally wrap in try/catch so a ledger
 *    failure can NEVER break a customer's unlock/entitlement.
 *
 * Note: getState/setState are not transactional. Concurrent webhooks for
 * DIFFERENT events could in theory race the read-modify-write. At this revenue
 * volume (target 0->1 paying customer) that is acceptable; Stripe retries of the
 * SAME event are spaced far enough apart that the dedup catches them.
 */

const LEDGER_KEY = 'revenueLedger';

// Entries that represent positive inbound money (used by revenue-intel too).
const POSITIVE_TYPES = ['one_time', 'subscription_initial', 'subscription_renewal'];
const VALID_TYPES = POSITIVE_TYPES.concat(['subscription_canceled', 'refund', 'dispute']);

let _defaultStorage = null;
function _storage(override) {
  if (override) return override;
  if (!_defaultStorage) _defaultStorage = require('../../_utils/companyStorage');
  return _defaultStorage;
}

function _emptyLedger() {
  return { entries: [], updatedAt: null };
}

/**
 * Load the ledger, always returning a well-formed { entries: [], updatedAt }.
 * Never throws — returns an empty ledger on any read error.
 */
async function getLedger(storageOverride) {
  const storage = _storage(storageOverride);
  let ledger = null;
  try {
    ledger = await storage.getState(LEDGER_KEY);
  } catch (_e) {
    ledger = null;
  }
  if (!ledger || !Array.isArray(ledger.entries)) return _emptyLedger();
  return ledger;
}

/**
 * Append one revenue entry, idempotent on entry.id (the Stripe event.id).
 * Returns { recorded: boolean, reason: string, id?, entry? }. Never throws.
 *
 * @param {object} entry
 * @param {string} entry.id            Stripe event.id (IDEMPOTENCY KEY, required)
 * @param {string} entry.product       'ambientscore'|'cardforge'|'storyforge'|'pixelagents'
 * @param {string} entry.type          one of VALID_TYPES
 * @param {string} [entry.plan]        productId / priceType ('cf-pro'|'pack'|'single'|...)
 * @param {string} [entry.interval]    'month'|'year' (for subscriptions)
 * @param {number} entry.amountCents   integer cents; negative for refund/dispute; 0 ok for cancel marker
 * @param {string} [entry.currency]    'usd'
 * @param {string} [entry.customerEmail]
 * @param {string} [entry.customerId]  Stripe customer id (preferred for distinct-count)
 * @param {string} [entry.subscriptionId] links initial<->cancel for the active-sub set
 * @param {string} [entry.sourceId]    session.id / invoice.id / charge.id
 * @param {string} [entry.occurredAt]  ISO of the Stripe event (event.created)
 * @param {object} [storageOverride]   for tests — { getState, setState }
 */
async function recordRevenue(entry, storageOverride) {
  if (!entry || typeof entry !== 'object') return { recorded: false, reason: 'invalid-entry' };
  if (!entry.id) return { recorded: false, reason: 'missing-id' };

  const storage = _storage(storageOverride);
  const ledger = await getLedger(storageOverride);

  if (ledger.entries.some(function (e) { return e && e.id === entry.id; })) {
    return { recorded: false, reason: 'duplicate', id: String(entry.id) };
  }

  const nowIso = new Date().toISOString();
  const normalized = {
    id: String(entry.id),
    product: entry.product || null,
    type: VALID_TYPES.indexOf(entry.type) !== -1 ? entry.type : 'one_time',
    plan: entry.plan || null,
    interval: entry.interval || null,
    amountCents: Number.isFinite(entry.amountCents) ? Math.round(entry.amountCents) : 0,
    currency: (entry.currency || 'usd').toLowerCase(),
    customerEmail: entry.customerEmail || null,
    customerId: entry.customerId || null,
    subscriptionId: entry.subscriptionId || null,
    sourceId: entry.sourceId || null,
    // Campaign attribution (revenue-visibility Gap 2): utmContent is the originating
    // campaign post's action id, carried through Stripe checkout metadata. The heartbeat
    // maps it to a campaign id at digest time so revenue rolls up per campaign.
    utmContent: entry.utmContent || null,
    utmSource: entry.utmSource || null,
    occurredAt: entry.occurredAt || nowIso,
    recordedAt: nowIso
  };

  ledger.entries.push(normalized);
  ledger.updatedAt = nowIso;

  let ok = false;
  try {
    ok = await storage.setState(LEDGER_KEY, ledger);
  } catch (e) {
    return { recorded: false, reason: 'storage-error', error: e && e.message };
  }
  return { recorded: !!ok, reason: ok ? 'appended' : 'storage-error', id: normalized.id, entry: normalized };
}

module.exports = {
  LEDGER_KEY: LEDGER_KEY,
  POSITIVE_TYPES: POSITIVE_TYPES,
  VALID_TYPES: VALID_TYPES,
  getLedger: getLedger,
  recordRevenue: recordRevenue
};

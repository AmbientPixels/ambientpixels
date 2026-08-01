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

  // Stamp internal/external at write time so the classification survives an email
  // later changing hands. Consumers still derive-on-read (isInternalEntry checks the
  // email too), so this is belt-and-braces, not the only line of defence. Non-fatal:
  // a config read failure must never block recording real money.
  try {
    const _internalEmails = await resolveInternalEmails(storageOverride);
    if (_internalEmails.length) normalized.internal = isInternalEntry(normalized, _internalEmails);
  } catch (_intErr) { /* leave unstamped — derive-on-read still classifies it */ }

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

/**
 * ── Internal vs external revenue (2026-08-01) ──
 *
 * The company recorded two $199 founder self-purchases as customer revenue. They
 * were LIVE-mode Stripe charges, so nothing downstream could tell them apart: they
 * counted as "first revenue" in revenueDigest, as-funnel, the Seasons dashboard and
 * the XP economy, which paid 316 revenue XP for them and made echo season champion.
 * For a system whose purpose is measuring whether it makes money, that is the most
 * expensive kind of wrong.
 *
 * DERIVE-ON-READ by design: classification comes from the email at read time, so the
 * two historical entries are corrected with NO mutation of the financial record.
 * Entries written from now on are also stamped with `internal` so the flag survives
 * an email changing hands later.
 *
 * Configured in systemConfig.internalRevenueEmails (CEO-owned, no deploy, no app
 * restart), falling back to the INTERNAL_REVENUE_EMAILS / CEO_EMAILS env vars.
 * NOTE: CEO_EMAILS is NOT currently set on the Function App — systemConfig is the
 * live path. An unconfigured list classifies NOTHING as internal: "we do not know"
 * must never silently become "it is all real".
 */
function parseInternalEmails(systemConfig, envValue) {
  var out = [];
  var raw = (systemConfig && systemConfig.internalRevenueEmails) || null;
  if (Array.isArray(raw)) out = raw.slice();
  else if (typeof raw === 'string') out = raw.split(',');
  else if (envValue) out = String(envValue).split(',');
  return out
    .map(function (s) { return String(s == null ? '' : s).trim().toLowerCase(); })
    .filter(Boolean);
}

function isInternalEntry(entry, internalEmails) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.internal === true) return true;
  var list = Array.isArray(internalEmails) ? internalEmails : [];
  if (!list.length) return false;
  var em = entry.customerEmail;
  if (typeof em !== 'string') return false;
  return list.indexOf(em.trim().toLowerCase()) !== -1;
}

/**
 * Split positive-type entries into external (real customers) and internal
 * (self-purchases / tests). Internal entries are RETAINED, never dropped —
 * hiding them would repeat the original mistake in the opposite direction.
 */
function splitRevenue(entries, internalEmails) {
  var external = [], internal = [], externalCents = 0, internalCents = 0;
  var list = Array.isArray(entries) ? entries : [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || POSITIVE_TYPES.indexOf(e.type) === -1) continue;
    var cents = Number.isFinite(e.amountCents) ? e.amountCents : 0;
    if (isInternalEntry(e, internalEmails)) { internal.push(e); internalCents += cents; }
    else { external.push(e); externalCents += cents; }
  }
  return {
    external: external, internal: internal,
    externalCents: externalCents, internalCents: internalCents,
    configured: Array.isArray(internalEmails) && internalEmails.length > 0
  };
}

/** IO wrapper: resolve the internal-email list from systemConfig, then env. */
async function resolveInternalEmails(storageOverride) {
  var cfg = null;
  try { cfg = await _storage(storageOverride).getState('systemConfig'); } catch (_e) { cfg = null; }
  return parseInternalEmails(cfg, process.env.INTERNAL_REVENUE_EMAILS || process.env.CEO_EMAILS || '');
}

module.exports = {
  LEDGER_KEY: LEDGER_KEY,
  POSITIVE_TYPES: POSITIVE_TYPES,
  VALID_TYPES: VALID_TYPES,
  getLedger: getLedger,
  recordRevenue: recordRevenue,
  parseInternalEmails: parseInternalEmails,
  isInternalEntry: isInternalEntry,
  splitRevenue: splitRevenue,
  resolveInternalEmails: resolveInternalEmails
};

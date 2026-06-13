# Handoff — Revenue Visibility Pipe (2026-06-13)

**Goal:** Make the autonomous company able to *see its own income*. Today the agents optimize engagement because that is the only number they have. Wire Stripe revenue into the shared world model + Cipher's finance + the strategy north-star so the agents (and the CEO dashboard) reason about dollars earned, not just dollars spent.

**Why now:** This is the #1 cross-cutting gap in the System Codex (autonomy 7.2/10, monetization 5.5/10) and fix-list item #4. It is also the unlock for the Strategic Engine: the PRIMARY north star `paying_customers` is currently `source: 'manual'` — this pipe makes it self-measuring.

**Status:** NOT STARTED. This is a design handoff. Plan-before-code, offline-test discipline, same as the Strategic Engine / Emergence work. Estimated 1–2 sessions.

---

## 1. Current state (verified 2026-06-13)

**The money moment happens and stops.** Five Stripe integrations exist; each writes a product-local entitlement and records revenue NOWHERE central:

| Product | Webhook | Money event(s) | Writes |
|---|---|---|---|
| AmbientScore | `api/as-webhook/index.js` | `checkout.session.completed` (one-time $29 single / $89 pack, `metadata.priceType`) | `cc_report_<id>` (unlock + `paidAt`); pack → `creditUtils.grantPackCredits` |
| CardForge | `api/cardforge-billing-webhook/index.js` | `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed` | `cardforge` entitlement (cf-pro $4.99/mo or yearly) |
| StoryForge | `api/storyforge-billing-webhook/index.js` | same set | sf-pro $9.99/mo entitlement |
| Pixel Agents | `api/pixel-agent-billing-webhook/index.js` | same set | pa-pro sub + pa-credit packs; **plus** `pixel-agent-connect-webhook` (Stripe Connect creator payouts) |

Shared libs: `api/_lib/stripe/` (`stripeClient.js`, `entitlements.js`, `productCatalog.js`, `stripeConnect.js`) and `api/_lib/ambientScore/` (`stripeClient.js`, `creditUtils.js`). All webhooks write via `_utils/companyStorage` directly (NOT the `company-state` HTTP API).

**The three consumers are all spend-only:**
- `finance-intel.js` `buildFinanceDigest(...)` — `budget` is 100% `geminiUsage` (LLM spend). No revenue input exists.
- `world-state-intel.js` — the `finance` object (lines ~149-157) is spend %, burn trend, status. `computeRunwayDays` = budget − spend only. `computeHeroLine` shows "Finance <status>".
- `strategy-intel.js` — `METRIC_RESOLVERS` (line 19) has `bluesky_followers` + `blog_views_week` only. `paying_customers` and `weekly_active_users` fall through line 46 `entry.source === 'manual'` → never auto-resolved.

---

## 2. Design — one ledger, three consumers

```
Stripe webhooks ──recordRevenue()──▶  revenueLedger (blob, append-only, idempotent)
                                              │
                              revenue-intel.js  buildRevenueDigest()
                                              │
        ┌─────────────────────┬───────────────┴───────────────┬────────────────────┐
   financeDigest.revenue   worldState.finance          strategy resolver        /api/revenueDigest
   (Cipher: income vs spend) (all agents see it)   (paying_customers auto)        + CEO dashboard
```

**Key architectural choice:** the ledger is written/read via `_utils/companyStorage` (like `pingLog`), so it does **NOT** need a `VALID_KEYS` entry and **`company-state/index.js` (high blast radius) is never touched.** The heartbeat reads it via `companyStorage.getState('revenueLedger')`; the dashboard reads it via a new dedicated `/api/revenueDigest` endpoint (same pattern as `outcomeDigest` / `allocationDigest`).

### Ledger schema (`revenueLedger` — keep ALL entries; revenue is low-volume, durable)
```js
{
  entries: [{
    id: '<stripe event.id>',          // IDEMPOTENCY KEY — dedup on this; Stripe retries webhooks
    product: 'ambientscore'|'cardforge'|'storyforge'|'pixelagents',
    type: 'one_time'|'subscription_initial'|'subscription_renewal'|'refund'|'dispute',
    amountCents: 2900,                 // negative for refund/dispute
    currency: 'usd',
    customerEmail: '...'|null,
    customerId: 'cus_...'|null,        // prefer Stripe customer id for distinct-count
    stripeSessionId/invoiceId: '...',
    occurredAt: '<event created ISO>',
    recordedAt: '<now ISO>'
  }],
  updatedAt: '...'
}
```

### `recordRevenue(entry)` — new `api/_lib/stripe/revenueLedger.js`
Pure-ish helper: load ledger, **return early if `entries.some(e => e.id === entry.id)`** (idempotent — the whole point; without it Stripe retries double-count), append, save. Wrap every call site in `try/catch` and log non-fatal (mirror the email-send pattern in `as-webhook` lines 70-77) — a ledger failure must NEVER break the customer's unlock/entitlement.

---

## 3. Build tasks (ordered)

1. **Ledger helper + schema** — `_lib/stripe/revenueLedger.js` (`recordRevenue`, `getLedger`). Offline test: idempotent append (same `id` twice → one entry), negative amounts, empty-ledger init. `c:/tmp/test-revenue-ledger.cjs`.
2. **Hook the 5 webhooks** at their payment-success path. AmbientScore = `checkout.session.completed` (amount from `session.amount_total`, type one_time, product ambientscore). The 3 subs = `checkout.session.completed` (subscription_initial). **VERIFY each webhook's exact events first** — the grep shows they handle `subscription.updated/deleted` + `payment_failed` but renewals may arrive as `invoice.payment_succeeded` (confirm; if absent, derive MRR from active entitlements instead — see task 3). Idempotent, non-fatal try/catch.
3. **`revenue-intel.js`** (pure, `api/companyHeartbeat/`) — `buildRevenueDigest(revenueLedger, entitlements, productCatalog, nowMs)`:
   - `mtdRevenueCents`, `byProduct`, `oneTimeVsRecurring`
   - `mrrCents` — sum of ACTIVE subscription entitlements × `productCatalog` monthly price (robust to missing renewal webhooks). Read prices from `_lib/stripe/productCatalog.js`.
   - `payingCustomers` — distinct count (see Open Question A)
   - `netCents` = revenue − LLM spend (pass `financeDigest.budget.monthly.actual`)
   - trend vs prior month. Offline tests with one-time/sub/refund/dup fixtures.
4. **Wire consumers:**
   - `finance-intel.js`: add a `revenue` block to the digest + a REVENUE section to `_buildFinancePromptBlock` (Cipher sees income vs spend, net burn).
   - `world-state-intel.js`: extend the `finance` object with `monthlyRevenue`, `mrr`, `payingCustomers`, `netBurn`; update `computeHeroLine` ("Finance GREEN · $X MRR · N paying") and `computeRunwayDays` → **net** runway (burn − revenue). Mind the 1500-char WORLD STATE cap (it `throw`s on overflow — keep additions terse).
   - `strategy-intel.js`: add a `paying_customers` resolver to `METRIC_RESOLVERS` reading `sources.revenueDigest.payingCustomers`; thread `revenueDigest` into the `sources` bag where `buildStrategyDigest`/`resolveMetric` are called (mirror how `bluesky_followers` reads `sources.socialAccountStats`). Then flip the `companyStrategy.northStar` `paying_customers` entry `source: 'manual'` → `'auto'` via `scripts/seed-company-strategy.cjs`.
5. **Endpoint + dashboard** — `/api/revenueDigest` (GET, on-demand fallback, pattern of `api/outcomeDigest/`) + a revenue panel on a CEO dashboard (new `modules/company/revenue.html` or extend `allocation.html`). Sidebar under System.
6. **(Optional, folds in codex fix #5)** refund/dispute: handle `charge.refunded` + `charge.dispute.created` → negative ledger entries. Cheap here, natural home.

---

## 4. Open questions for CEO (flag at session start)

- **A. `paying_customers` definition** — lifetime distinct payers (anyone who ever paid, non-refunded) vs currently-active (active sub + one-time in last N days)? Affects the PRIMARY north-star number. *Recommend: lifetime distinct non-refunded customers* — honest "have we won real customers yet" signal; the strategy target is `0→1`.
- **B. Backfill** — seed the ledger from existing paid records (`cc_report_*` with `paidAt`, current entitlements), or start fresh from deploy? *Recommend: one-time backfill script* so the first revenue number isn't a false zero.
- **C. Refund handling in v1?** *Recommend: yes* (task 6) — it's the same ledger and closes a known trust gap.
- **D. Net runway** — should `computeRunwayDays` subtract revenue? *Recommend: yes conceptually*, but at current revenue it barely moves — low stakes either way.

---

## 5. Verification

- **Offline:** `.cjs` tests for ledger idempotency (dup `event.id` → 1 entry, no double-count) and digest math (MTD sum, MRR from active subs, paying-customer distinct, net = revenue − spend). Fixtures: one-time, sub-initial, renewal, refund, duplicate-event.
- **Live (Stripe test mode):** run a test checkout on each product → confirm one ledger entry (retry the webhook → still one) → next heartbeat: `financeDigest.revenue` populated, `worldState.finance` shows revenue, `strategy` `paying_customers` resolves `auto` → `/api/revenueDigest` + dashboard render.
- **Rollback:** pipe is purely additive (new key, new module, new endpoint, hooks in try/catch). Removing the `recordRevenue` calls reverts cleanly; no customer-facing path depends on the ledger.

---

## 6. Kickoff prompt (verbatim)

```
Read ambientpixels/docs/superpowers/handoffs/2026-06-13-revenue-visibility-pipe-handoff.md.
Answer Open Questions A–D with the CEO first (recommendations are in the doc). Then build
the revenue ledger + revenue-intel + wiring per section 3, plan-before-code, pure modules
with offline .cjs tests (same discipline as Emergence Signal 6 / Strategic Engine). Do NOT
touch company-state/index.js (use companyStorage for the ledger). Verify with a Stripe
test-mode checkout end-to-end before claiming done.
```

---
*Generated 2026-06-13. Grounded in a live code sweep (5 webhooks, finance/world/strategy intel, VALID_KEYS). Related: System Codex `monetization-readiness.md` (fix #4), `project_strategic_engine` (paying_customers north star), `project_agentregistry_overrides_constants` (a runtime-override gotcha caught the same session — watch for similar state-vs-code divergence).*

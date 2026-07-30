# AmbientScore Conversion Teardown ($199) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Rung 2 of the revenue-engine spec (`docs/superpowers/specs/2026-07-30-revenue-engine-design.md`): a $199 done-for-you teardown sold via Stripe, fleet-drafted, CEO-reviewed via tokened link, ACS-delivered in 48h.

**Architecture:** Reuse every existing rail: inline `price_data` Stripe checkout (no dashboard/env setup), `as-webhook` fulfillment branch → `as_teardown_queue` (storage-direct), a 15-min timer (`asTeardownRunner`) that runs the existing `analyzer.analyze(url)` + one composition Claude call, HMAC preview/deliver links (FORM_INTAKE_SALT pattern from as-confirm), Discord CEO alerts (`fleetAlerts.dispatchDiscord`), ACS emails (`emailSender.js`). Editorial design system throughout; no em dashes in user-visible strings.

**Tech stack:** Azure Functions (Node), raw-axios Stripe, companyStorage, ACS email, vanilla-JS editorial frontend.

## Verified facts (checked 2026-07-30 — do not re-derive)

1. `analyzer.analyze(url)` (api/_lib/ambientScore/analyzer.js:91) is self-contained: scrape → extract → classify → 2 evals → score/synthesize, ~5 Claude calls ≈ $0.04-0.10. Returns the full report object as-analyze stores at `cc_report_<id>`.
2. Stripe checkout via `stripeClient.createCheckoutSession` uses env price IDs, but Checkout supports inline `line_items[0][price_data][...]` (currency/unit_amount/product_data[name]) — no pre-created Price needed for the teardown. Keep `allow_promotion_codes=true` so a 100%-off test code works (PLUMBING-TEST pattern, 07-04).
3. `as-webhook` verifies signature then branches on `checkout.session.completed`; teardown sessions carry NO `reportId` so the existing unlock branch skips them naturally. `recordCheckoutRevenue` takes `plan` + `fallbackCents`.
4. HMAC pattern: `crypto.createHmac('sha256', FORM_INTAKE_SALT)` (as-confirm/index.js:35; env has default fallback).
5. `fleetAlerts.dispatchDiscord(embed)` exists (api/_utils/fleetAlerts.js:23); no-ops without `DISCORD_ALERT_WEBHOOK`.
6. `emailSender.js` exports only `sendReportEmail`; ACS sender works (ACS_SENDER_EMAIL fixed 07-02).
7. Cron grid in use: heartbeat :00 even hours, asScanRunner :10s grid, asProspectCron :25 even hours, outcomeRefresh 14:35. Teardown runner takes `0 5/15 * * * *` (clears all).
8. Existing real files under `/ambientscore/` are served (report.html works); the index-rewrite gotcha applies to non-existent paths only. VERIFY new pages post-deploy anyway.
9. CEO email env: `CEO_EMAILS` (Vale). May be unset — Discord alert is the guaranteed channel; email CEO-notify is best-effort.

## Store shapes

- `as_teardown_queue` (storage-direct array, cap 200 FIFO): `{ orderId: 'td_<ts>_<rand4>', url, goal (≤500), email, sessionId, utmContent, utmSource, paidAt, status: 'paid'|'processing'|'draft_ready'|'delivered'|'failed', processingAt, retryCount, deliveredAt, error }`
- `as_teardown_<orderId>` (storage): `{ orderId, url, goal, email, score, grade, siteType, teardown: { summary, killers: [{ title, why, before, after, impact }×5], fixOrder: [{ week: 1|2|3|4, items: [] }], confidence }, reportRaw (analyzer output), createdAt, deliveredAt }`

## Tasks

### Task 1 — `api/_lib/ambientScore/teardownComposer.js` [NEW, pure]
- `composeTeardown(report, goal, callClaude)` → teardown JSON above. One Claude call (injected for tests): prompt takes the analyzer's dimensions/findings/rewrites + buyer goal, demands STRICT JSON with exactly 5 killers (each with verbatim `before` quoted from the site and rewritten `after`), 4-week fix order. Validate shape; on parse failure retry once at temp 0.2; then throw.
- `buildTeardownToken(orderId)` → HMAC (fact 4) `'teardown:'+orderId`, hex, first 32 chars. Export for endpoint + tests.
- `queueTeardownOrder(session, queue, nowIso)` → pure: builds order entry from a Stripe session object (metadata.teardown==='1'), dedups on sessionId, enforces cap 200. Returns `{queue, order|null}`.
- `advanceQueue(queue, nowMs)` → pure self-heal used by the runner each tick: `processing` older than 2h → `paid` + retryCount++; retryCount>2 → `failed`. Returns `{queue, resets, failed}`.

### Task 2 — `stripeClient.js` [MODIFY] — `createTeardownCheckout({url, email, goal, utmContent, utmSource})`
Inline price_data ($19900, name 'AmbientScore Conversion Teardown', description '48-hour done-for-you audit with rewrites'), `allow_promotion_codes`, metadata `{teardown:'1', url, goal≤500, utm_content, utm_source}`, success `/ambientscore/teardown-thanks.html?session_id={CHECKOUT_SESSION_ID}`, cancel `/ambientscore/?cancelled=1`, `customer_email` when given.

### Task 3 — `api/as-webhook/index.js` [MODIFY]
In the `checkout.session.completed` branch, BEFORE the reportId block: if `session.metadata?.teardown === '1'` → load queue, `queueTeardownOrder`, save, ack email (non-fatal), Discord embed 'Teardown order paid' (non-fatal), revenue record `{plan:'teardown', fallbackCents:19900}`, then `return` 200 (do not fall through to reportId logic). Keep everything non-fatal per house webhook style.

### Task 4 — `api/asTeardownRunner/` [NEW timer `0 5/15 * * * *`]
Each run: load queue. (a) Self-heal: `processing` older than 2h → `paid` + retryCount++; retryCount>2 → `failed` + Discord. (b) Take FIRST `paid` order (cap 1/run): set `processing`+`processingAt`, save (crash marker), `analyzer.analyze(url)` → `composeTeardown` (use the same Claude client analyzer uses: `require('../_lib/ambientScore/claudeClient')`-equivalent — check analyzer's import and reuse) → store `as_teardown_<orderId>` → status `draft_ready` → Discord embed with preview link `/ambientscore/teardown.html?id=<orderId>&key=<token>` + best-effort CEO email. Failures → status `paid` + retryCount++ (self-heal path owns the terminal transition). Log one summary line.

### Task 5 — `api/as-teardown/index.js` [NEW endpoint, function.json GET+POST]
- `POST {action:'checkout', url, email, goal}` → validate `new URL(url)` + email regex → `createTeardownCheckout` → `{checkoutUrl}`. Rate-limit lightly (reuse cc_ratelimit pattern: 5/hour/IP).
- `GET ?id&key` → token check → return `as_teardown_<orderId>` minus `reportRaw`, plus queue status.
- `POST {action:'deliver', id, key}` → token check + status `draft_ready` → `sendTeardownDeliveryEmail(email, order, viewLink)` → queue status `delivered`+`deliveredAt`, doc `deliveredAt` → governance `logEvent`-style entry via storage governanceLog append is heartbeat-owned; instead Discord embed 'Teardown delivered' (sufficient v1).

### Task 6 — `emailSender.js` [MODIFY] — three senders, same table-layout template family, editorial voice, no em dashes
- `sendTeardownAckEmail(email, orderId)` — 'Order received. Your teardown arrives within 48 hours.'
- `sendTeardownCeoNotify(order, previewLink)` — to `CEO_EMAILS` (skip silently if unset).
- `sendTeardownDeliveryEmail(email, order, viewLink)` — score + top killer teaser + view link.

### Task 7 — Frontend (editorial system; search ambientscore.css before adding classes)
- `ambientscore/teardown-thanks.html` [NEW] — static filed-order confirmation.
- `ambientscore/teardown.html` + `js/teardown.js` [NEW] — viewer: masthead, score block, 5 killers (before/after in bordered panels, mono codes K-01..K-05), 4-week fix table, signature block. If `status==='draft_ready'` show a 'Deliver to client' button → POST deliver (the only person holding the link pre-delivery is the CEO).
- `ambientscore/index.html` [MODIFY] — `#teardown` section: offer copy + URL/email/goal mini-form → POST checkout → redirect to Stripe. Anchor is the outreach link target.
- `js/report.js` [MODIFY] — paywall gains one quiet line under the $29 unlock: 'Want it done for you. $199 teardown, delivered in 48 hours.' → `/ambientscore/#teardown`.

### Task 8 — Tests `api/_lib/ambientScore/teardown.test.js` [NEW, no-dependency runner like smoke tests]
Cases: queueTeardownOrder maps metadata/dedups sessionId/caps 200; token stable + rejects tampered id; composeTeardown happy path with fake LLM, retry-once on bad JSON, throws after 2; runner transitions via extracted pure `advanceQueue(queue, nowMs)` helper (stale processing→paid, retry cap→failed); composer validates exactly 5 killers.

### Task 9 — Wire, test, commit, deploy, DRY-RUN
1. `node api/_lib/ambientScore/teardown.test.js` green + full house suites green.
2. Commit (explicit paths) + push.
3. Post-deploy: create 100%-off code via as-offer-create (`TDPLUMB1`, max 1) → buy through the real form → verify webhook queued → runner drafts within 15 min → Discord alert → preview link renders → deliver → email arrives → revenueLedger entry (teardown, $0 after promo). Then EXPIRE the code.
4. Point outreach at it: add teardown line to prospect-reply CTA copy (separate small commit in prospect-pipeline reply template — keep out of this deploy).

## Gotchas
1. Webhook must never 500 (Stripe retries) — every new call non-fatal, always 200.
2. `as_teardown_queue` is storage-direct (NOT a company-state VALID_KEY — do not touch company-state/index.js).
3. Runner processes ONE order per tick (5 Claude calls each) — SLA math: 4 orders/hour max, fine at current volume; revisit cap at scale.
4. analyzer throws on scrape/extraction failure — runner must catch and use the retry path, never crash the timer.
5. No em dashes in ANY user-visible string (editorial house rule). Use periods, colons, `›`.
6. staticwebapp.config.json is do-not-touch; new real files under /ambientscore/ serve fine (fact 8) — verify live after deploy.
7. Buyer email comes from `customer_details.email` on the session (Stripe collects it) — prefer it over the form email if both exist.
8. Repo auto-commits/pushes from parallel loops — stage explicit paths only.

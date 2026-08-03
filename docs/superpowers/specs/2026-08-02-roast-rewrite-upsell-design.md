# Deep Roast Rewrite — $9 Post-Roast Upsell (Design)

**Date:** 2026-08-02
**Status:** Approved direction, pending CEO spec review
**Owner:** CEO + Claude session
**Doctrine fit:** REVENUE FIRST (07-31). Closest-action-to-money: monetizes existing roast traffic at peak intent. Serves `obj-revenue-engine` (1 real paying customer by 08-31). First paid rung of the career-vertical offer ladder: free roast → **$9 rewrite** → ($199 teardown / $149 packs remain the AS-side ladder). Does NOT replace the distribution work — agency white-label packs remain next big build.

## 1. Product

After a free Resume Roast run completes, the result page shows an upsell card directly under the roast score:

> **Get your resume professionally rewritten** — ATS-optimized, ready to send. Based on this exact roast. **$9**

Clicking starts Stripe Checkout (one-off, $9). After payment the buyer lands on a delivery page ("Your rewrite is being prepared…") that polls until the rewrite is ready (~1–2 min typical).

- **v1 scope: `resume-roast` agent only.** LinkedIn/site roast variants may reuse the machinery later if this converts.
- Works for **anonymous users** — no sign-in required (this is why the order-based flow was chosen over the credits flow).
- Buyer email is captured by Stripe Checkout automatically (receipt + list).

## 2. Deliverable

A complete rewritten resume, delivered on the web delivery page:

1. **Rewritten resume** — same real experience/facts, restructured and rephrased for impact and ATS compatibility.
2. **"What changed and why"** — short section explaining the major changes.
3. **ATS keyword summary** — keywords present/missing for the candidate's apparent target role.

Rendering: clean HTML on the delivery page + copy button + `.md` and `.txt` download + print-friendly view. No PDF/DOCX generation in v1.

### Hard integrity constraint (non-negotiable)
The rewrite prompt MUST forbid inventing jobs, employers, titles, degrees, dates, certifications, or metrics. It only restructures and rephrases content present in the source resume. If the source lacks quantified results, the rewrite may add `[add metric]` placeholders — never fabricated numbers. This is the trust line that keeps a $9 AI rewrite defensible.

## 3. Architecture — reuse the teardown pipeline

Mirror the proven $199 teardown machine (`api/as-teardown/index.js`, `api/_lib/ambientScore/teardownComposer.js`, `api/asTeardownRunner/index.js`, `api/as-webhook/index.js`) with a smaller engine. No new agent, no heartbeat changes, no edits to high-blast-radius files.

### Order lifecycle
```
created → paid → composing → delivered   (failure: compose_failed → requeue → composing)
```

1. **Create order** — `POST /api/roast-rewrite {action:'create', resumeText, roastResult}` from the run page. Stores an order blob: `{id, token, status:'created', resumeText, roastResult, createdAt}`. Returns a Stripe Checkout URL. Only the **order id** goes into Stripe metadata — resume text never touches Stripe.
2. **Webhook** — extend the existing `as-webhook` (it already verifies Stripe signatures and routes teardown orders): flips the order to `paid` and writes the ledger entry. It does **not** compose inline.
3. **Composer + runner** — new `roastRewriteComposer` in `api/_lib/` following `teardownComposer.js`: Claude call with the integrity-constrained prompt, **retry with 2s/8s backoff on 5xx/429/timeout** (the exact failure that killed teardown order td_…2faa must not eat a $9 order). A timer runner (mirror `asTeardownRunner`, or extend it to handle both order types) picks up `paid` orders, composes, stores output on the order blob; status → `delivered`.
4. **Requeue** — `POST /api/roast-rewrite {action:'requeue', id}` (secret-gated) flips `compose_failed` → `paid` for the runner, mirroring the teardown requeue.
5. **Delivery page** — `/resume-roast/rewrite.html?o=<token>` polls `GET /api/roast-rewrite?token=…` (unguessable token, not the order id) until `delivered`, then renders. Refund promise on the page: "Not happy? Reply to your receipt — we refund, no questions."

### Storage
Order blobs in the existing billing/orders storage account, new container or prefix `roast-rewrite-orders/`. Retention: keep resume text 30 days post-delivery, then the runner scrubs `resumeText` from delivered orders (privacy hygiene; the rewrite itself persists for the buyer's token URL).

## 4. Pricing & price test

- Launch at **$9** (maximize first-conversion probability).
- Price lives in config (`systemConfig.roastRewrite.priceCents`, default 900) — not hardcoded — so a **$19 test** can run once there is any conversion signal. Low-ticket impulse offers often 2x with little conversion loss; don't anchor at $9 forever.
- New Stripe Product/Price created by CEO or via existing Stripe tooling; price id in config.

## 5. Instrumentation

Three events via the existing ProductAnalytics pipeline:
- `rewrite_upsell_view` — upsell card rendered after a roast
- `rewrite_upsell_click` — CTA clicked (before checkout)
- `rewrite_purchase` — webhook-confirmed payment (server-side emit)

**The PA ingest event whitelist MUST be updated in the same commit** that introduces these events (lesson: pixelagents events silently dropped for 30+ days). Purchases also land in the revenue ledger exactly as teardowns do, so `revenueDigest` and `obj-revenue-engine`'s paying_customers metric pick them up with zero new wiring.

## 6. Controls

- **Kill switch:** `systemConfig.roastRewrite.enabled` (default false until live-verified). systemConfig is read-modify-write — GET first, always.
- Upsell card renders only when the kill switch is on (config surfaced to the run page the same way existing tier/credits info is).
- ~~Webhook rejects orders when disabled (no orphan payments while dark)~~ **Amended at implementation:** the webhook honors payments regardless of the kill switch, and already-paid orders still compose after the switch goes dark. Rationale: while disabled, `create` 503s so no rewrite checkout session can exist; the only reachable case is a buyer paying an existing session (≤24h old) right after the switch flips off — and delivering something a customer paid for is correct. The switch stops NEW checkouts, not paid obligations.
- CEO test purchase policy: any CEO/test checkout gets refunded and pruned (`prune-test-entries` pattern) — **never counted or narrated as revenue** (07-31 lesson).

## 7. Success gate

If **~50 free roasts** flow past a live upsell with **zero purchases**, stop — the offer or price is wrong; revisit rather than build more (matches the 07-30 gate style). If it converts, candidates for the next iteration: $19 test, LinkedIn-roast variant, signed-in instant flow.

## 8. Out of scope (v1)

- PDF/DOCX export, cover letters, job-posting tailoring
- LinkedIn / site-roast variants
- Signed-in instant credits flow
- Any marketing beyond the in-product card (prospect-lane copy may mention it later — separate decision)
- Affiliate rails (separate parked design)

## 9. Test/verification plan

- Smoke: order create → mock-paid → compose → delivered, plus requeue path (`node api/pixel-agent-run/smoke-test.js` still green; new smoke for roast-rewrite lifecycle).
- Live verify before enabling: one real $9 checkout end-to-end (CEO card), then refund + prune. Promo-code lesson applies: verify actual browser checkout, not just API.
- Verify `rewrite_purchase` event arrives in analytics (ingest whitelist check) and ledger entry appears in `revenueDigest`.

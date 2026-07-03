# Revenue Pivot — Phase 2 Handoff

**Date:** 2026-07-03
**From:** Claude (Fable 5) after auditing + executing Phases 0-1
**For:** The next agent (any capable model — tasks are scoped tight; work lean, no re-auditing)
**Prior docs:** `docs/revenue-pivot-handoff-2026-07-02.md` (original plan — partially superseded by the audit), CEO memory `project_revenue_pivot_audit_2026_07_02.md` (audit verdicts + execution status — the single best context file).

---

## 1. Context in 10 lines

- The fleet's objective switched from followers to **paying customers** (still $0 lifetime, ledger empty). Focus product: **AmbientScore** ($29 audit, https://ambientpixels.ai/ambientscore/) — the only funnel a stranger can pay through in one session (CardForge/StoryForge checkouts 401 for everyone; Pixel Agents fulfillment is hollow — do NOT market those until fixed).
- **Phase 0 (shipped, verified live):** REVENUE line now unconditional in every agent's WORLD STATE (verified: block 1300→1361 chars); blogViews30d fixed (0→47); product-analytics beacons unbroken (SWA rewrite 405'd ALL POSTs since launch — now direct-to-Function-App; ingest round-trip verified); socialMetricsEvents dead-pipe fixed (scheduler + heartbeat auto-exec now emit); locked report page shows teaser findings + direct $29 checkout (was a dead-end); landing auto-scans `?url=`; email capture → `as_leads` blob + ACS email (Azure setting `ACS_SENDER_EMAIL` added — was typo'd `ACS_SENDER_EMAI`); /ambientscore/ added to sitemap + llms.txt.
- **Phase 1 (shipped):** Echo = **Conversion Owner** (live `agentRegistry` doctrine + prompt contract); Scout's `systemConfig.blueskyKeywords` repointed to buyer intent; new `run-ambientscore-scan` action (echo/scout/nova) → `asScanQueue` → `api/asScanRunner` timer (10 min, 2/run, `systemConfig.ambientScoreScans.dailyCap` default 8) → results comment on the task with a shareable report link; proposal fixes (cron no longer consumes Nova's 1/day quota; gate blocks emit `policy-violation` events; proposals-array propose-* rerouted instead of payload-lost; pending proposals listed in the proposal prompt block). Proposal-generator cron stays ON as backstop (CEO decision).
- Commits: `b504c583`, `1695cf5b`, `54b2784f` (Phase 0), `9ee239b7` (Phase 1).

## 2. Environment (non-negotiable)

- Code root `c:/Dev/Ambientpixels/ambientpixels` (NOT repo root). Git repo at `ambientpixels/.git`, branch `master`. Deploy = commit + push → GitHub Actions (~3-5 min).
- Node.js only (no Python, no jq — pipe JSON to `node -e`). Windows/Git Bash; `MSYS_NO_PATHCONV=1` for Azure CLI.
- Live state: `GET https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=KEY`, header `x-company-secret: pixelpusher`. `systemConfig` POSTs are FULL-VALUE REPLACE — always read-modify-write the whole object.
- High-blast-radius files (CLAUDE.md list) need explicit CEO permission. NEVER reset/wipe state keys. NEVER disable the proposal cron without CEO sign-off.
- `agentRegistry` STATE overrides `constants.js` at runtime — doctrine changes must be made in BOTH places.

## 3. Phase 2 tasks (do in this order — safest/highest-leverage first)

### 2.1 ZERO-CODE: Directory launch prep (highest traffic leverage)
Nothing has ever been listed anywhere. Draft listing copy for Product Hunt, Uneed, BetaList, and 2-3 free-tools directories (AmbientScore: free instant website audit, no login). The CEO submits manually. Assets (OG image, schema, screenshots) already exist on `/ambientscore/`. Optionally have the fleet draft copy via a task.

### 2.2 ZERO-CODE: Stripe promo experiment
`allow_promotion_codes` is already live in every checkout. CEO creates a coupon in the Stripe dashboard (e.g. launch discount, or 100%-off codes as outreach gifts). No deploy.

### 2.3 CEO-ACTION: Validate the money path
Stripe webhook registration is UNVERIFIED — "0 sales" and "webhook misconfigured" are currently indistinguishable. CEO checks the Stripe dashboard: webhook endpoints for `as-webhook` (+ the other 3) subscribed to `checkout.session.completed`; `charge.refunded`/`charge.dispute.created` still unsubscribed per 06-13 memory. Ideal proof = one real $29 purchase + refund (CEO declined earlier — re-offer, don't do it unilaterally). After any purchase: `revenueLedger` must gain an entry (read via `/api/revenueDigest`).

### 2.4 CODE: Revenue into the learning loop
- `api/companyHeartbeat/outcome-intel.js` — perAgent rollup (~lines 105-112) and perCampaign rollup (~185-196) have engagement/blogViews/formSubmits but NO revenue. Add `revenueAttributed` per campaign AND per agent by joining `revenueDigest.byCampaign` / raw ledger entries (`utmContent` = originating action id → action → `created_by` agent + `task.campaign_id`).
- The action→campaign map is built in `companyHeartbeat/index.js` ~364-373 from LIVE actions only.
- **Attribution decay bug:** `api/actionsArchiver/index.js` (RETENTION_DAYS = 7) moves finished actions to cold storage, but frontend UTM attribution is first-touch and persists in localStorage indefinitely (`js/product-analytics.js` ~75-84). A purchase >7d after the post → utmContent misses the live-actions map → unattributed. Fix: persist a compact `actionId → {agent, campaignId}` map at archive time (e.g. `actionAttributionIndex` blob, append-only, capped), and fall back to it in the revenue join.
- Test offline first (pure functions), then one commit, then verify next heartbeat's `runtimeMemory.outcomeDigest`.

### 2.5 WATCHLIST: Confirm Phase 0/1 behavior (cheap curls, no code)
- `asScanQueue` gets entries + `scan-queued` events in governanceLog once Echo/Scout use the scan action; `asScanRunner` marks them done and comments on tasks.
- `socialMetricsEvents` gains entries on the next scheduler-published post (was frozen at 55 since 06-11).
- `as_leads` starts collecting emails; `cc_analytics` shows scans; `productAnalyticsQuery?product=ambientscore&metric=funnels` shows real visitor events.
- Echo's next heartbeats: does she brief conversion work / use the scan tool? Do agent-sourced proposals appear (`proposal-created` events with `source:'agent'`)? Gate blocks now visible as `policy-violation` with `gate: proposal_*`.

## 4. Phase 3 (after Phase 2) — the ceiling test

Agree on thresholds with the CEO BEFORE the sprint, e.g.: over 2 weeks — if scans ≥ 30 and purchases = 0 → product/pricing problem (human decision); scans < 30 → distribution still broken; both rise → generalize. Measure via `productAnalyticsQuery` (landing views, scan funnel) + `cc_analytics` (scans by tier) + `revenueDigest`. Only after a proven revenue lever: graduated autonomy per `docs/superpowers/plans/2026-06-10-full-autonomy-roadmap.md`.

## 5. Verification command crib

```bash
API=https://ambientpixels-nova-api.azurewebsites.net/api ; H='x-company-secret: pixelpusher'
curl -s "$API/worldState" -H "$H"                    # REVENUE fields + blogViews30d
curl -s "$API/revenueDigest" -H "$H"                 # ledger totals (still 0 until a sale)
curl -s "$API/productAnalyticsQuery?range=7d&product=ambientscore&metric=funnels" -H "$H"
curl -s "$API/company-state?key=asScanQueue" -H "$H"
curl -s "$API/company-state?key=as_leads" -H "$H"    # NOTE: companyStorage-direct key; if company-state rejects it, it is not a VALID_KEY — read via a node script hitting blob or add a tiny reader only if needed
curl -s "$API/company-state?key=governanceLog" -H "$H"   # filter proposal-created source + policy-violation gate:proposal_*
```

## 6. Do-not list

- Do NOT re-audit Phases 0-1 or refactor shipped code.
- Do NOT touch heartbeat `index.js`, `company-state/index.js`, `staticwebapp.config.json`, CI/CD without explicit CEO ask.
- Do NOT flip `systemConfig.proposalGenerator.enabled` to false.
- Do NOT market CardForge/StoryForge/PixelAgents (broken/hollow checkouts) — fixing those is separate, CEO-prioritized work.
- Do NOT reset any state key, ever.

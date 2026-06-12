# API Layer

**Location:** `ambientpixels/api/` · **165 function directories** (150 HTTP + 15 timer crons) · Runtime: Node 20, Azure Functions (Linux Consumption), app `ambientpixels-nova-api`.

Auth model: `x-company-secret` header OR SWA `x-ms-client-principal` for user-scoped endpoints. **Caveat:** `validateSecret('')` returns true when the `COMPANY_WRITE_SECRET` env var is unset — the secret gate is currently a no-op on most endpoints (known since Apr 2026).

## Cron timers (15)

| Function | Schedule (UTC) | Purpose |
|----------|---------------|---------|
| `companyHeartbeat` | hourly :00 | Main agent cycle |
| `autoPublishGrace` | hourly :30 | 48h grace auto-publish of QG-passed advisory posts (core: `_utils/graceWindow.js`) |
| `actionsScheduler` | every 5 min | Execute approved/scheduled action queue |
| `actionsMetricsPull` | every 15 min | Pull action metrics |
| `companyTrendIngest` | every 6h | Trend radar ingest |
| `socialEngagementPull` | every 6h | Social engagement metrics |
| `productAnalyticsRollup` | daily 03:00 | Product analytics rollup |
| `outcomeRefresh` | daily 14:00 | t1/t7/t30 engagement samples (X, Bluesky, Reddit), decision-outcome backfill |
| `memoryConsolidate` | daily 15:00 | Collapse 5+ similar memories → `consolidated_belief` |
| `companyMorningReport` | daily 15:30 | Morning brief |
| `emergenceCheckCron` | daily 16:00 | Emergence digest + governance signal append |
| `formIntakeDigestTimer` | daily 17:00 | Form intake digest |
| `actionsArchiver` | weekly Sun 04:00 | Archive old actions |
| `companyWeeklyReport` | weekly Sun 16:00 | Cipher/Forge/Nova weekly reports → `weeklyReports` (own endpoints, not in VALID_KEYS) |
| `pixel-agent-payout-timer` | monthly 1st 06:00 | Creator payout run (Stripe Connect) |

External crons (GitHub Actions): `keepalive.yml` every 5 min → `/api/healthz` → `/api/keepalive-record` (100-entry ring at `pingLog`, also outside VALID_KEYS); `daily-standup.yml` weekdays 15:30 UTC → `/api/company-standup-run`.

## Endpoint categories (counts)

- **Company state & storage (12):** `company-state` (the 60-key KV hub), `company-logs`, `company-store-*`, resets, `export-snapshot`, `worldState`
- **Heartbeat & cron triggers (15+):** manual `-trigger` twins for heartbeat, morning/weekly report, trend ingest, grace window, standup
- **Agent/AI (8):** `agentchat`, `novachat`, `geminiproxy`, `generatetext`, `agentPublicProfile` (60s in-memory cache → ~60s stale-shape window after deploys), `nova-voice-tts`
- **Social & publishing (11):** `blogPosts`, `blogSSR`, `blogViews`, `publishedDocs`, `socialMetrics/AccountStats/Engagement*`, `blueskySearch`
- **Documents/content (6):** `documentsExecute`, `contentIndex/Package/QuickGenerate/Retry`
- **Analytics/telemetry (8):** `azureCosts`, `geminiCosts`, `claudeCosts`, `telemetrySummary`, `productAnalytics*`, `pulseStats`, `allocationDigest`
- **Governance (5+):** `approveProposal` (product_* + agent_* side effects, idempotent), `fleetProposalCreate`, `governanceReport`, `awarenessDigest`, `emergenceMonitor`, `outcomeDigest`
- **Forms (3):** `formIntake`, digest + timer
- **Products:** CardForge (~30), Blindspot (14), StoryForge (7), Pixel Agents/Agent Forge (22), AmbientScore (5) — see [products.md](products.md)
- **Utility:** `healthz`, `api-health-check`, `sitemapXml`, `toolsWebSearch`, `memoryStack` (L1-L9 stack)

## Shared modules

**`_utils/` (14):** `companyStorage.js` (blob KV + local fallback + secret validation), `demoGuard.js`, `cfAuth.js` (SWA principal extraction + dev `X-User-ID` fallback), `companyContextLoader.js` + `companyContextFormatters.js` (anti-hallucination shared context for chat/standup/morning-report), `graceWindow.js` (auto-publish core + breaker), `callGemini.js`, `blueskyDiscovery.js`, `productAnalytics.js`, `pvpRanks.js`, `wagerResolve.js`, `platformRetry.js`, `archiveStorage.js`, `getTelemetry.js`.

**`_lib/stripe/` (7):** `stripeClient.js`, `productCatalog.js` (cf_pro, sf_pro, pa_pro subscriptions + pa-credit-10/50; AmbientScore handled separately), `entitlements.js` (blob `billing/entitlements/{userId}.json`, shared PRO_FLAGS across all products, admin override via `ENTITLEMENTS_ADMIN_IDS`), `creatorProfiles.js`, `payoutCalculation.js` ($0.02/run, 40% Pro-revenue pool, 50%/70% creator splits, $25 minimum), `payoutExecutor.js`, `stripeConnect.js`.

**`_lib/ambientScore/` (9):** analyzer, scraper (SSRF-hardened), dimensions, scorer (decompression curve), promptBuilder, creditUtils, stripeClient, emailSender (Azure Communication Services), reportRenderer. **Runs on Claude Sonnet 4** (migration from Gemini complete).

## State keys

`company-state/index.js` VALID_KEYS — 60 keys as of 2026-06-11, including newer: `outcomeSnapshots`, `agentDecisions`, `capitalAllocation`, `agentRegistry`, `emergenceDigest`, `companyStrategy`, `blueskyCandidates`, `agentMessages`, `socialWeeklySnapshots`. Keys deliberately OUTSIDE the API (own endpoints write via `companyStorage` directly): `pingLog`, `weeklyReports`, `heartbeatLock`.

Webhook surface: `cardforge-billing-webhook`, `storyforge-billing-webhook`, `pixel-agent-billing-webhook`, `pixel-agent-connect-webhook`, `as-webhook` — all handle subscription created/updated/deleted + payment_failed (AmbientScore: checkout.session.completed only; **no refund/dispute events anywhere**).

# Public Site, Shared Infrastructure & Ops

## Site map (non-product directories)

`ambientos/` (platform hub + 8 agent profile pages + live-pulse widget), `products/` (lineup), `blog/`, `log/` (public daily standup feed), `pulse/` (telemetry dashboard), `nova-core/` (Nova chat), `about/`, `services/` (+ rates), `skills/` (resume), `support/`, `projects/` (34 portfolio pages), `account/`, `pages/` (login/401), plus empty scaffolds (`lab/`, `playground/`, `tools/`, `templates/`, `help/`).

## Shared JS (64 files in `js/`)

Clusters: navigation/layout (nav, init-header-footer — runtime header/footer injection, theme persistence) · auth (`authUI.js` — `/.auth/me` → sessionStorage → `data-auth-state`) · company store (`company-store.js` hybrid localStorage/server dual-write) · Nova AI stack (nova-soul/chat-ui/mood/awareness/voice — 10+ files) · analytics (`product-analytics.js` — buffered, dual-write App Insights + blob ingest, silent-fail) · `agent-profile-live.js` (live status band, `formatRelativeTime`) · content widgets (modal, lightbox, comparison slider, form intake) · legacy generative toys (dreamEngine, luma, nebulight, echogrid).

## CSS (39 files)

Token source of truth: `ap-tokens.css` — `--color-*` system (NOT `--aura-*`, which is CardForge's separate brand), per-product accents `--pc-*`, Archivo/Archivo Black/JetBrains Mono, clamp-based fluid type scale. Theme overrides in `theme.css`. Product CSS lives with each product. Tier-2 products (CardForge, Blindspot, StoryForge, Pixel Agents) are deliberately separate brands — never reskin to the AP design system.

## Static data (`data/`, 43 files)

Highlights: `company-agents.json` (agent registry seed), `company-actions.json` (action taxonomy: risk levels, handlers, approval requirements), `pixel-agents.json`, `agent-profiles.json`, `site-manifest.json` (~140 pages, generated) + `.digest` (compact, injected into agent context), `version.json` (build stamp), nova-* state/behavior files, `api-monitor.json`.

## Scripts (`scripts/`, 34 files)

- **Build-time:** `buildSiteManifest.js` (CI step), `syncProductBriefs.js` (pre-commit: SKILL.md → `api/_data/skills.json` — keeps agent prompt knowledge fresh)
- **Quality/autonomy:** `backtest-quality-gate.cjs` (+ labels/results JSONs — the Phase A harness, 90.2% recall), `test-quality-gate-circuit-breaker.js`, `validateAgentIdentity.js`
- **Seeds/migrations:** `seedOutcomeSnapshots.js`, `prefillAgentMemories.js`, `seed-company-strategy.cjs`, `retrofit-objectives-se2.cjs`
- **Asset gen:** agent portraits, Blindspot icons/items/move art, OG images, blog hero regen, boss page builder
- **Hygiene:** `unusedCSS.js`, `imageAudit.js`

## CI/CD (`.github/workflows/`)

1. **azure-static-web-apps-calm-sky-05cc8e110.yml** — push to master: buildSiteManifest → rsync static to `app_build/` → stamp `version.json` → SWA deploy; API deployed via Kudu zip-deploy from publish profile (the official action path is bypassed). NEVER use `az functionapp deployment source config-zip` manually — it corrupts `WEBSITE_RUN_FROM_PACKAGE`.
2. **keepalive.yml** — every 5 min → `/api/healthz` → POST `/api/keepalive-record` (eliminates cold starts; surfaces as KEEPALIVE pill).
3. **daily-standup.yml** — weekdays 15:30 UTC → `/api/company-standup-run`.

## staticwebapp.config.json

Node 20 · SPA fallback to `/index.html` · 401→`/pages/401.html` · CSP allows Stripe/Cloudflare/Azure Monitor/CIAM/blob · `/api/*` route rewrites proxy product + company APIs to the Function App (SWA-managed functions don't support POST for these) · protected routes: `/modules/company/*` + `/docs/published/*` (authenticated), `/hanson*` (hansonuser role) · 301s: legacy nova/gridos/ambientcore/conversioncore paths, cardforge arena → blindspot · static asset cache: 7d immutable.

## Auth

Azure AD B2C CIAM (tenant `ambientpixelsid`), OpenID Connect SignUpSignIn, Google login configured. SWA handles tokens at `/.auth/*`; clients read `/.auth/me`. Product APIs extract `x-ms-client-principal` via `cfAuth.js` (dev fallback `X-User-ID`).

## Active planning docs (`docs/superpowers/`)

Plans: full-autonomy-roadmap (2026-06-10, phases A/B/C shipped), nova-voice, strategic-engine SE1-SE2. Specs: full-system-audit, qg-backtest-report, nova-voice-design. Handoffs: SE3 strategy brief, strategic-engine, self-sufficiency-tightening, full-autonomy-kickoff.

# Products

Six products on shared Azure SWA + Functions infra. Monetization detail and scores: [monetization-readiness.md](monetization-readiness.md).

---

## CardForge — RPG card creator (`/cardforge/`)

- **Frontend:** 44 JS modules, 11 pages. Monolith: `card-forge-editor.js` (5,345 lines — render engine + state + all UI bindings). Entry points: splash → editor (3-col obsidian layout, 10 presets, 6-tier modular design system), gallery, deck builder, My Forge dashboard, admin (hero fan config).
- **APIs (~30):** card/deck CRUD + publish, favorites/ratings (hybrid anon hearts + auth favorites, 2000 hard cap), OG share images, admin stats, Stripe (`cardforge-checkout`, `-billing-webhook`, `-entitlements`, `-billing-portal`).
- **Storage:** `cardforgeblobdata` container — `published-cards.json`, `user/{userId}/cards.json|favorites.json|saved-decks.json`, `billing/entitlements/{userId}.json`.
- **Monetization:** Stripe **LIVE** (cf-pro monthly $4.99 / yearly). Enforced: AI generation cap (free 5/24h, pro unlimited), HD export (pro 2x+). **Not enforced:** `premiumEffects` (config.js EffectTiers shim unlocks ALL effects for everyone), `extraCardSlots` (no draft limit at all). One-time effect packs / XP boosters are commented-out stubs.
- **Tech debt:** editor monolith; mount-API asymmetry (my-published-cards + my-favorites auto-bind to editor selectors, no `mount()` — editor.html and forge.html must change in lockstep); arena legacy HTML still rendered in lightbox (arena removed Apr 2026, redirects to Blindspot); avatars stored full-size (2–4MB) server-side.

## Blindspot — arena combat game (`/blindspot/`)

- **Frontend:** ~19.4K LOC — `blindspot-flow.js` (3,382-line state machine) + 54 lib modules (`bs-*`), 20 pages incl. public profile + stats + admin panel (5 tabs). Fully decoupled from CardForge since Mar 2026 (own CSS/JS/images/audio; still shares `cardforgesavecards`/`cardforgepublish` storage APIs by design).
- **APIs (14):** profile/profileview/leaderboard/stats (public, cached 5–10 min), battle + asyncbattle (PvP vs AI defender, Elo K=32/16), defensequeue, resultsinbox, bosses, hero/cardview (slim feeds — fixed the 8s cold start), adminconfig.
- **Game systems:** 10-boss campaign + ascension + weekly boss; CYOA adventures; stamina/cooldown/stance/element combat; 26 cosmetics + 9 card-title milestones; daily bounties + login bonus; async PvP with revenge; 5 crate types; 12 drop pools (~150 items).
- **Monetization:** **NONE** — 100% Sparks soft currency (earned 3–25/battle, spent 10–200/item). Zero Stripe code. Wishlist + loyalty milestones (250→5000 lifetime spend) exist but grant nothing yet. Estimated 3–5 days to first real-money path (Sparks packs or cosmetic packs).
- **Tech debt:** O(N)-blob leaderboard/stats aggregation (fine <500 players, precompute planned); localStorage quota mitigated; boss data triplicated across 3 JSONs (smoke-tested).

## StoryForge — AI interactive fiction (`/storyforge/`)

- **Frontend:** 11 JS files (~5,900 lines), 3 pages (hub, play, gallery). `adventure-engine.js` 2,762-line IIFE = wizard (3 steps) + turn loop + saves. 6 genres (3 free / 3 Pro), 8 art styles, RPG layer (d20 checks, XP, inventory, companions).
- **APIs (7):** save/load (entitlement-checked slots), gallery (publish/browse), share (OG meta), entitlements, checkout, billing-webhook.
- **AI:** 4 Gemini call types per session via geminiproxy — story (`gemini-2.5-flash`), scene + portrait images (`gemini-2.5-flash-image`), TTS (`gemini-2.5-flash-preview-tts`). ~25 story calls/adventure. Single-provider dependency.
- **Monetization:** Stripe **LIVE** (sf-pro monthly $9.99 / yearly). Enforced: genre locks, save slots (server-side 403). **Gaps:** daily limit (3 free adventures/day) is client-side localStorage only — clearable; entitlements endpoint treats authenticated ≈ pro in its defaults path (verify before scaling paid marketing); no per-session AI cost tracking.

## Pixel Agents + Agent Forge (`/pixel-agents/`, `/agent-forge/`)

- **Pixel Agents:** 24 built-in agents, 12 categories, 5 tiers. 11 pages + 4 JS files (~1,840 lines). Dual JSON registries (frontend + `api/_data/`) must be manually synced — currently in sync.
- **Agent Forge:** 3-column drag-and-drop builder (`agent-forge.js`, 1,429 lines). Pipeline: build → draft (blob per-user) → test (`agentId:'_test'`) → submit (portrait → WebP) → AI gatekeeper (quality/uniqueness/safety, 0–100 each) → auto-approve if all ≥70 (cap 5 live agents/user) else CEO queue → live. Cosmetic edits instant; prompt/name/category edits re-review.
- **APIs (22):** run (Claude Sonnet 4.6 + web search + URL fetch + Gemini image), catalog (7-day trending), submit/review/approve/remove, drafts, analytics, creator profile/onboard/status (Stripe Connect Express), checkout/entitlements/billing-webhook/connect-webhook, payout run/timer/admin, share + share-card (satori OG images).
- **Monetization:** Stripe + Connect payouts **coded but not enforced**: `pixel-agent-run` checks only flat rate limits (5 anon / 25 auth per day) and never consults entitlements — `paUnlimitedRuns` and purchased credits (`pa-credit-10/50`) are dead flags; `FREE_DEFAULTS.dailyLimit: 3` contradicts `RATE_LIMIT_AUTH: 25`. Creator revenue share fully implemented in `payoutCalculation.js` ($0.02/run, 40% pool, 50%/70% splits, $25 floor, monthly timer).

## AmbientScore — website conversion audit (`/ambientscore/`)

- **Engine:** `api/_lib/ambientScore/` (~1,655 lines, 10 files). Pipeline: scrape (SSRF-hardened: DNS-rebinding check, private-IP/IMDS/protocol blocklists) → extraction → site-type classification (7 weight profiles) → 2 parallel dimension evals (8 dimensions, 4+4) → synthesis. **5 Claude Sonnet 4 calls per scan (~$0.04)** — the Gemini→Claude migration is COMPLETE despite older docs.
- **Scoring:** weighted 1–10 sub-criteria → decompression curve (raw 5 → 60; counters LLM score compression) → 0–100 + grade.
- **APIs (5):** as-analyze (free scan 5/hr/IP, checkout creation, session verification unlock), as-report (teaser vs full), as-credits (check/redeem by email hash), as-webhook (signature-verified, idempotent, 3-pack credit grant + auto-redeem), as-confirm (strategy-session slot, HMAC token).
- **Monetization:** **LIVE end-to-end** — $29 single / $89 3-pack, hosted Stripe checkout, paywall enforced server-side, credit ledger (`cc_credits_<emailHash>`), ACS email delivery. **Gaps:** no refund/dispute webhook handling; no receipts/invoices; unlock path doesn't verify sessionId ↔ reportId binding (minor exploit); failed-webhook = locked report despite success page.

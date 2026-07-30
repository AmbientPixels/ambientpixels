# Pixel Agents — Run-Level Billing Enforcement (Design)

**Date:** 2026-07-29
**Status:** CEO greenlit scope 2026-07-29 ("get PA ready to receive Stripe / start promoting"); implements the 06-11 codex activation checklist.
**Problem:** Stripe checkout, webhook, and entitlements all work, but `pixel-agent-run` only checks flat rate limits — `paUnlimitedRuns` and purchased `paCredits` are dead flags. A paying customer gets exactly what a free user gets (chargeback risk; creator rev-share unmarketable).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Free authed daily limit | **10/day** (was code 25 / entitlements-API 3) | 25 makes credit packs + Pro pointless; 3 is punitively low to promote with. 10 keeps "sign in = 2× anon allowance". One-line change if CEO wants different: `PA_LIMITS.freeDaily`. |
| Anonymous limit | 5/day per IP (unchanged) | Trial funnel, already public. |
| Pro / admin | Unlimited daily runs (skip rate-limit bookkeeping entirely) | `paUnlimitedRuns` flag via `isProActive` or admin override. |
| Credits | Consumed only AFTER the free allowance is exhausted, only on run success, fresh-read decrement | Free-first preserves goodwill; post-success means a Claude 502 never eats a credit. |
| Billing outage | **Fail-open to free tier** | Availability over strictness (house QG norm). Lookup error → user treated as free, run proceeds under free limits. |
| Enforcement point | `pixel-agent-run` only | Single execution path; `_scaffold`/`_test` meta-agents ride the same limits as before. |

## Architecture

- `api/_lib/stripe/entitlements.js` — add exported `PA_LIMITS = { anonDaily: 5, freeDaily: 10, proDaily: 999 }` (single source of truth; imported by both endpoints).
- `api/pixel-agent-run/entitlementGate.js` [NEW, small] — wraps blob container (`cardforgeblobdata/cardforge`) + `loadPaEntitlements(userId)` and `consumePaCredits(userId, cost)` (fresh read → decrement → save, returns new balance). Smoke tests stub this module's exports, same pattern as the storage mock.
- `api/pixel-agent-run/index.js` — after agent/input validation: CEO bypass unchanged; authed users get one entitlement lookup (admin → pro). `unlimited` (CEO/admin/Pro) skips rate limiting. Free path: if `userRuns + cost > dailyLimit` and authed with `credits >= cost` → mark `usingCredits`; else 429 with `{ error, message, remaining: 0, credits, tier, upgradeUrl }` (message varies: anon → sign-in upsell; credits-short → top-up; zero → run pack/Pro). Post-success: `usingCredits` → `consumePaCredits` (warn-only on failure — run already delivered); else existing rate-limit increment. Response gains `credits` (authed) + `tier`; `remaining` stays "free runs left today" (999 for unlimited).
- `api/pixel-agent-entitlements/index.js` — `FREE_DEFAULTS.dailyLimit` / `PRO_VALUES.dailyLimit` now read `PA_LIMITS` (3 → 10 fix).
- Frontend `pixel-agents/js/pixel-agent-run.js` — remaining line shows "Pro — unlimited runs" for pro tier, appends "· N credits" when credits > 0; 429 reveals an upsell CTA (class toggle, no inline styles) linking `upgrade.html`. `run.html` gains the CTA anchor inside `#pa-error`; `pixel-agent-run.css` gains `.pa-error-upsell` (+`.is-visible`) rules.
- Public copy 25 → 10: `docs.html`, `faq.html` (prose + JSON-LD), `upgrade.html` FAQ, `index.html` JSON-LD.

## Testing

Extend `api/pixel-agent-run/smoke-test.js` (mock `entitlementGate` exports + base64 `x-cf-auth-principal` helper): authed free 10-then-429 (with upsell fields); credits extend past allowance (consume called, balance decremented, remaining 0); Pro unlimited past limit (no rate-limit write); insufficient credits for cost-2 agent → 429; entitlement lookup throw → fail-open 200; existing 22 tests stay green (anon limit unchanged).

## Out of scope

`paPriorityQueue` behavior (no queue exists), creator rev-share marketing (still gated on this shipping + real revenue), StoryForge/CardForge billing gaps, upgrade-page redesign.

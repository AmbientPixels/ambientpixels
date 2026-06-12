# Monetization Readiness Scorecards

**Question:** The company has pivoted to monetize and gain customers across all products. How ready is each product to take money, and what should be fixed first?
**Assessed:** 2026-06-11.

## Overall: 5.5 / 10 — "Plumbing mostly exists, enforcement and funnel don't"

Four of six products have Stripe code; two can genuinely charge a customer end-to-end today (AmbientScore, CardForge; StoryForge nearly). But feature gating is inconsistently enforced, there is **no revenue telemetry reaching the agents or the CEO dashboard**, no refund handling anywhere, and no product has a measured free→paid funnel. The marketing engine (agents) and the billing machinery are not yet connected by data.

## Per-product scorecards

### AmbientScore — 8/10 (flagship: charge money today)
| | |
|---|---|
| Payments | ✅ $29 single / $89 3-pack, hosted checkout, signature-verified idempotent webhook, credit ledger, ACS email |
| Paywall | ✅ Server-enforced teaser/full split; unguessable report IDs |
| Unit economics | ✅ ~$0.04/scan (5 Claude Sonnet 4 calls) vs $20–26 gross margin — healthy at ≥1–2% conversion |
| Gaps | ❌ No refund/dispute webhook (disputed customers keep access) · ❌ No receipts/invoices · ⚠️ sessionId↔reportId binding not verified on unlock · ⚠️ free-scan limit is IP-based only · ⚠️ failed webhook = paid-but-locked report |

### CardForge — 6.5/10 (live subs, half the value props ungated)
| | |
|---|---|
| Payments | ✅ cf-pro monthly ($4.99) / yearly via Stripe + billing portal + webhook |
| Enforced gating | ✅ AI generation (5/day free vs unlimited) · ✅ HD export (2x+) |
| Broken gating | ❌ `premiumEffects` — EffectTiers shim in config.js unlocks ALL effects for everyone · ❌ `extraCardSlots` — no draft limit exists at all · ❌ one-time effect packs / XP boosters are commented-out stubs |
| Gaps | 5 finished border PNGs unwired; no upgrade surface beyond settings modal; no conversion tracking |

### StoryForge — 6.5/10 (live subs, one leaky limit)
| | |
|---|---|
| Payments | ✅ sf-pro monthly ($9.99) / yearly via Stripe + webhook |
| Enforced gating | ✅ Pro genre locks · ✅ save-slot limit (server 403) · ✅ entitlements verified correct 2026-06-11 (`hasActiveSubscription` requires tier=pro AND subscriptionStatus=active; the "signed-in ≈ pro" finding was a false alarm — only the admin-override branch returns unconditional Pro) |
| Leaks | ❌ 3-adventures/day free cap is client-side localStorage — clear it, play free forever (each free adventure costs ~$0.03–0.05 in Gemini) |
| Gaps | No AI cost tracking per user; single-provider Gemini dependency (incl. preview TTS model) |

### Pixel Agents + Agent Forge — 5/10 (most complete plumbing, zero enforcement)
| | |
|---|---|
| Payments | ✅ pa-pro subs + pa-credit-10/50 products defined · ✅ checkout + billing webhook · ✅ Stripe Connect creator payouts fully implemented ($0.02/run, 40% pool, 50/70% splits, $25 floor, monthly timer) |
| Enforcement | ❌ `pixel-agent-run` never consults entitlements: `paUnlimitedRuns`, `paPriorityQueue`, and purchased credits are dead flags — a paying Pro user gets exactly what a free user gets · ❌ `FREE_DEFAULTS.dailyLimit: 3` vs `RATE_LIMIT_AUTH: 25` contradiction |
| Note | The creator payout system is a liability switch: don't market revenue share until run-level billing enforcement exists, or payouts can exceed revenue |

### Blindspot — 2/10 (healthy economy, no cash register)
| | |
|---|---|
| Payments | ❌ None. 100% Sparks soft currency. No Stripe code, no checkout, no entitlements |
| Foundation | ✅ Best retention systems in the portfolio (streaks, crates, daily bounties, PvP Elo, cosmetics, loyalty milestones) — a monetization-ready economy missing only the till |
| Path | ~3–5 days: Sparks packs or cosmetic packs via the existing `_lib/stripe` pattern. Recommendation in codebase audit: wait for 50–100 DAU before adding payment overhead |

### AmbientOS platform — N/A (the engine, not a product)
Monetizes indirectly as the marketing/ops engine and brand story ("build in public"). Pulse/agents pages are top-of-funnel.

## The cross-cutting gaps (these matter more than any single product)

1. **No revenue telemetry.** Stripe events go to blob entitlements and stop. Nothing feeds `financeDigest`, world state, Cipher, or the CEO dashboard. The autonomous company cannot see its own income — agents optimize engagement because that's the only number they have.
2. **No funnel measurement.** UTM attribution reaches blog views and form submits, not checkouts. Free→paid conversion is unmeasured on every product.
3. **No refund/dispute handling** on any of the 5 webhook endpoints.
4. **Entitlements enforcement drift** — flags exist that nothing checks (CardForge premiumEffects/slots, all Pixel Agents flags). Selling a flag that isn't enforced is a refund/chargeback risk.
5. **No pricing page consistency / upgrade surfaces** — upsell exists only at limit-hit moments.

## Prioritized fix list (effort vs revenue impact)

| # | Fix | Product | Effort | Why first |
|---|-----|---------|--------|-----------|
| 1 | ✅ DONE 2026-06-11 — verified entitlements correct (false alarm; Pro requires an active Stripe sub) | StoryForge | — | Was flagged as a potential 100% revenue leak; code review cleared it |
| 2 | Enforce entitlements + credits in `pixel-agent-run`; reconcile 3-vs-25 limits | Pixel Agents | 1–2 days | Activates two already-built revenue streams (Pro + credits) |
| 3 | Move StoryForge daily cap server-side | StoryForge | ~1 day | Stops paying Gemini for unlimited free play |
| 4 | Revenue → financeDigest/worldState pipe (Stripe events → state key → Cipher/CEO) | Platform | 1–2 days | Unlocks revenue-aware autonomy; prerequisite for "monetize across all products" as a strategy the agents can act on |
| 5 | Refund/dispute webhook handling (shared handler in `_lib/stripe`) | All | ~1 day | Trust + accounting hygiene before scale |
| 6 | Real `premiumEffects` gating (replace EffectTiers shim) + wire 5 unused borders | CardForge | ~1 day | Makes the Pro flag worth paying for |
| 7 | AmbientScore: sessionId↔reportId check + refund events + receipts | AmbientScore | ~1 day | Hardens the one fully-working funnel |
| 8 | Conversion funnel events (`checkout_started`/`completed` → productAnalytics) | All | ~1 day | Measure before spending agent marketing on any product |
| 9 | Blindspot Sparks/cosmetic packs | Blindspot | 3–5 days | Defer until DAU justifies (per existing recommendation) |

**Strategic read:** the fastest path to "monetize across all products" is not building new monetization — it's enforcing what's already built (items 1–3, ~3 days of work) and giving the autonomous company eyes on revenue (item 4). After that, the agents' existing marketing machinery is pointed at funnels that can actually convert and be measured.

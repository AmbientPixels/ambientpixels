# AmbientPixels Revenue Engine — Offer Ladder Design

**Date:** 2026-07-30
**Status:** DRAFT for CEO review — brainstormed and lane-selected 07-29/30 (CEO picked: done-for-you teardown + agency white-label; YouTube kept open as distribution; wedge-agents-as-doorways strategy agreed).
**Problem:** $0 lifetime revenue. All current pricing ($29 self-serve, $12/mo subs) assumes traffic that doesn't exist. The one working motion is outbound (prospect pipeline → warm replies), and outbound can't profitably sell $29. Budget math: $110/mo burn = one ~$150+ sale/mo to break even.

## Strategy

**Sell where the distribution already is.** Three rungs on one engine (the AmbientScore analyzer + fleet delivery), each priced for its channel:

| Rung | Offer | Price | Channel | Who brings distribution |
|---|---|---|---|---|
| 1 | Self-serve audit report (exists) | $29 (3-pack $89) | Inbound / lead magnet | Nobody (keep as capture, stop treating as the product) |
| 2 | **Done-for-you Conversion Teardown** | **$199** (anchor $299 "launch pricing") | Outbound prospect pipeline + LinkedIn | Us, 1:1 — price justifies it |
| 3 | **Agency white-label audit packs** | **$149 / 10 branded audits** (~$15/ea) | Outbound to agencies | The agency — recurring B2B |

Wedge-agent doctrine (agreed 07-30): individual agents (Resume Roast, Roast My Site) are **doorways, not products** — campaigns market a wedge, funnels land on the marketplace, success includes second-agent runs. Phase-2 of Rung 3 generalizes to **embeddable branded agents** (lead-magnet widgets, ~$29-49/mo per embed) — the whole catalog becomes B2B inventory (agencies↔site roast, career coaches/HR outplacement↔resume roast, dev tools↔code roast).

## Rung 2 — Done-for-you Conversion Teardown ($199)

**The offer:** "We audit your site with our AI fleet, then a human strategist reviews, prioritizes, and rewrites. You get a teardown doc: top 5 conversion killers, before/after copy rewrites for each, and a 30-day fix order. Delivered in 48h."

**Delivery flow (fleet does ~95%):**
1. Buyer → Stripe checkout (new product `as-teardown-199`, mode payment) → success page intake form (URL, business goal, primary conversion action) → `as_teardown_queue` (storage-direct key).
2. Fleet: full AmbientScore scan (existing analyzer, no rate limit internally) → Scribe drafts the teardown doc from scan JSON via a dedicated prompt (product-facts grounded, composeQualityVerdict gate — house rule for new content paths) → doc lands in CEO approval queue.
3. CEO: 15-20 min review/edit pass (the "human strategist" — this is real, not theater; it's also the QG of last resort).
4. Delivery: ACS branded email (sender exists) with PDF/report link + the $29-report upsell removed for this buyer. Mark ledger entry in `revenueLedger`.

**Outbound integration:** prospect-cron reply CTA gains the paid rung ("free scan → want the full teardown?"). Add teardown mention to the report paywall page as the upgrade path above the $29 buy.

**What must be true before selling:** Stripe product + webhook fulfillment path; intake form; Scribe teardown prompt + QG; ONE dry-run end-to-end on a real site (use a friendly founder or Chad-owned property). NO new dashboard v1 — queue is CEO-visible via existing state reads.

**Not in v1:** subscriptions, retainers, call time. If a buyer wants implementation help → consulting conversation, priced ad hoc.

## Rung 3 — Agency white-label packs ($149/10)

**The offer to agencies:** "Your foot-in-the-door tool: send prospects a conversion audit with YOUR logo on it. 10-pack $149. You look like you did a week of analysis; it took you 3 minutes."

**V1 mechanics (deliberately manual-ish):**
- Stripe product `as-agency-10` → grants 10 audit credits on the agency's entitlement record (reuse `paCredits`-style counter, separate key `asAgencyCredits`).
- Branding: agency uploads logo + name once (intake form); report renderer gains a white-label header variant (logo swap + "prepared by {agency}" — no AmbientPixels brand on the buyer-facing artifact; footer keeps "powered by AmbientScore" unless they pay the $299 unbranded tier later).
- Agency runs audits via a tokened URL (no auth build v1: signed link with credit check).
- **Outbound:** re-aim a prospect-cron variant at agency-intent keywords ("just signed a client", "web design agency", "freelance web designer") offering ONE free branded sample audit — the sample IS the demo.

**Phase 2 (only after first agency pays):** embeddable widget version, more agent categories (career coaches for Resume Roast — including HR outplacement packages), self-serve agency dashboard.

## Supporting lanes (kept open, not built now)

- **YouTube Shorts (distribution)** — crawl phase per growth-strategy notes: weekly build-in-public Short from real fleet events; feeds every funnel; never counted as revenue.
- **Benchmark data products** — free authority reports from accumulated scan data; cite in outreach; build when scan volume justifies (>100 scans).
- **Affiliate rails in agent outputs** — wire when traffic exists; pennies until then.
- **AmbientOS knowledge/consulting** — open a LinkedIn consulting lane anytime with zero build; CEO-driven, not fleet-driven.

## Sequencing & success gates

1. Rung 2 build (one session) → dry-run → point prospect pipeline at it. **Gate: 1 teardown sale in 30 days.**
2. Rung 3 build (one session: credits + white-label header + agency outreach keywords). **Gate: 1 agency pack in 45 days.**
3. If both gates miss with real outbound volume (≥60 touches each): the problem is offer/market, not plumbing — stop building, rethink with data.
4. Resume Roast outreach lane (already queued) proceeds in parallel as a marketplace doorway — it feeds Rung 2/3 indirectly (job-seeker traffic sees the catalog).

## Open questions for CEO

1. Price points OK? ($199 teardown / $149 agency 10-pack — both one-line changes.)
2. 48h SLA acceptable given your review availability? (Fleet drafts in minutes; the SLA is your calendar.)
3. Teardown branding: sold as AmbientScore or AmbientPixels? (Recommend AmbientScore — it's the product with a face.)

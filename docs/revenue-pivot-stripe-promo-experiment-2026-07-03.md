# Stripe Promo-Code Experiment — Setup Guide

**Date:** 2026-07-03 · **Phase 2.2 (revenue pivot)** · **Action: CEO does this in the Stripe dashboard (zero code, no deploy)**

## Why this is already wired

`allow_promotion_codes: true` is live in both checkout builders:
- `api/_lib/ambientScore/stripeClient.js:25` (AmbientScore $29 / 3-pack)
- `api/_lib/stripe/stripeClient.js:45` (shared)

That means the AmbientScore Stripe Checkout page **already shows an "Add promotion code" field**.
No code, no deploy — any coupon you create in the dashboard works immediately.

## Coupon vs. Promotion Code (Stripe's two-layer model)

1. **Coupon** = the discount rule (e.g. "50% off" or "100% off, once"). Internal.
2. **Promotion code** = the customer-facing string that maps to a coupon (e.g. `LAUNCH50`).
   One coupon can have many promotion codes.

Create the coupon first, then attach one or more promotion codes to it.

**Where:** Stripe Dashboard → **Product catalogue → Coupons** → *New*. After creating, open the
coupon and click *Add promotion code*. Set the code string, optional max redemptions, and expiry.

## Recommended experiments (pick per goal)

| Goal | Coupon | Promotion code | Settings |
|---|---|---|---|
| **Launch discount** (directory/PH traffic) | 50% off, one-time | `LAUNCH50` → $14.50 | Expires in 2–4 weeks; unlimited redemptions |
| **Outreach gifts** (roast-my-startup, beta users, influencers) | 100% off, one-time | `GIFT-XXXX` (one per recipient) | Max redemptions = 1 each; short expiry |
| **First-10 founders** | 30% off | `FIRST10` → $20.30 | Max redemptions = 10 |

Keep it to **one active discount at a time** so redemptions are cleanly attributable to a channel.

## Bonus: a 100%-off code doubles as a FREE money-path test (ties to Phase 2.3)

A single-use **100%-off** promotion code lets you validate the *entire* fulfillment plumbing —
checkout → `checkout.session.completed` webhook → report unlock → ACS "your scorecard" email —
**without spending $29.** Steps:
1. Create a 100%-off, max-redemptions-1 code (e.g. `PLUMBING-TEST`).
2. Run a real scan on the live site, hit "Unlock full report $29", apply the code, complete checkout.
3. Confirm: (a) the report unlocks, (b) the ACS email arrives, (c) a governance/webhook event fires.

**Caveat (be honest about what it proves):** a $0 checkout exercises the webhook + fulfillment path,
but the charge is $0, so it will **not** add real revenue to `revenueLedger` / `revenueDigest`. It
proves "the pipes are connected," not "a paid dollar lands attributed." The only test that proves the
full revenue-attribution path is one **real $29 purchase** (see Phase 2.3). Use the 100%-off test as
the zero-cost first check; decide separately on a real purchase.

## How to measure redemptions

- **Stripe Dashboard → Coupons → [coupon]** shows redemption count and the sessions.
- Any *paid* redemption ($14.50, $20.30, etc.) flows through the existing webhook into
  `revenueLedger`, visible via `GET /api/revenueDigest` (`mtdRevenueCents`, `byProduct`, `byCampaign`).
- A $0 (100%-off) redemption will show in Stripe but not in `revenueDigest` revenue totals.

## Do-not / cautions

- Don't stack this with a price change — keep the base price $29 so discount math stays legible.
- 100%-off codes are unmetered free reports; cap **max redemptions** on every gift code.
- No code or deploy is required for any of this. If a code ever *doesn't* show the field at checkout,
  that's a signal the deploy reverted `allow_promotion_codes` — ping the dev side, don't work around it.

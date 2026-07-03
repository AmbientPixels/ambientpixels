# Stripe Webhook Validation — Re-offer

**Date:** 2026-07-03 · **Phase 2.3 (revenue pivot)** · **Action: CEO decision required**

## The problem this closes

Right now, "$0 sales" and "the webhook is silently misconfigured" are **indistinguishable**. If
`STRIPE_WEBHOOK_SECRET` were unset or the endpoint weren't subscribed, every `checkout.session.completed`
event would 401 and vanish — the fleet would read "no demand" when the truth is "no plumbing." Until
one real payment round-trips, we cannot tell these apart. This is the last unverified link in the money path.

## What the AmbientScore webhook expects (`api/as-webhook/index.js`)

It handles three event types:
- `checkout.session.completed` → **unlocks the report + sends the ACS scorecard email + writes the ledger entry** (the one that must work)
- `charge.refunded` → reverses
- `charge.dispute.created` → flags

Per the 06-13 memory, `charge.refunded` / `charge.dispute.created` were intentionally left
**unsubscribed** in the dashboard. That's fine — only `checkout.session.completed` is required for fulfillment.

## CEO dashboard check (2 minutes, no purchase)

Stripe Dashboard → **Developers → Webhooks**:
1. Is there an endpoint pointing at `https://ambientpixels-nova-api.azurewebsites.net/api/as-webhook`?
2. Is it subscribed to **`checkout.session.completed`**?
3. Does its signing secret match the `STRIPE_WEBHOOK_SECRET` app setting on `ambientpixels-nova-api`?
4. (The other three product webhooks — cardforge / storyforge / pixel-agent — are separate; not needed for this pivot.)

If all three are green, the config is correct and we only need one live event to prove it end-to-end.

## The proof (re-offering — your call, I will NOT do this unilaterally)

Two ways to get a real `checkout.session.completed` through the live endpoint:

- **Option A — zero cost:** the 100%-off promo-code test from the Phase 2.2 doc. Proves the webhook
  fires, the report unlocks, and the ACS email sends. **Does not** prove a paid dollar lands in the
  ledger (a $0 charge → $0 revenue).
- **Option B — full proof ($29, self-refundable):** one real $29 purchase on the live site, then
  refund it. This is the **only** test that proves the complete revenue-attribution path:
  `checkout.session.completed` → `revenueLedger` entry → `revenueDigest` shows `payingCustomers ≥ 1`
  and `mtdRevenueCents = 2900`. You declined this earlier — **re-offering now**, because it's the
  cleanest way to flip the money path from "unverified" to "proven," and the refund makes it net-zero cost.

**I am not making any purchase.** Tell me which (A, B, both, or neither) and I'll help you read the
resulting state. After any successful event, verify with:

```bash
curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/revenueDigest" \
  -H "x-company-secret: pixelpusher"
# expect: payingCustomers >= 1, mtdRevenueCents > 0 (Option B) — or an unlock/email with $0 (Option A)
```

## Recommendation

Do the **2-minute dashboard check first** (free, rules out the silent-misconfig case). Then do the
**100%-off plumbing test (A)** since it's zero-cost and exercises fulfillment. Reserve the **real
$29 self-refunded purchase (B)** for when you want the definitive revenue-attribution proof — ideally
right before the directory launch so the very first organic buyer hits a verified path.

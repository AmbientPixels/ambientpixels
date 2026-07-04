# AmbientScore — Launch Run-of-Show (Product Hunt, Tue Jul 7)

**Product:** AmbientScore · **PH launch:** Tue Jul 7 @ 12:01am PT · **URL:** https://ambientpixels.ai/ambientscore/
**Tagline:** Find where your landing page loses money

Follow this top to bottom. Everything is prepped; this is just the order of operations.

---

## ✅ Money-path status (checked 2026-07-03)
- Server config is **GO**: `STRIPE_SECRET_KEY` (LIVE), `STRIPE_WEBHOOK_SECRET` (valid), $29 + $89 price IDs, sender email — all set.
- **Still your step before launch:** confirm the Stripe dashboard has a webhook endpoint at
  `…/api/as-webhook` subscribed to `checkout.session.completed`. Prove it with the free 100%-off
  test unlock (see the promo doc) OR one $29 self-refunded purchase. **Do NOT launch unverified** —
  a real buyer hitting a dead webhook is the worst launch-day outcome.

---

## Phase 1 — This weekend (Sat Jul 4 → Mon Jul 6): warm-up

- [ ] **Verify the money path** (the check above) — highest priority.
- [ ] **Submit evergreen directories** (no launch-day mechanic, so the holiday doesn't hurt):
      SaaSHub, There's An AI For That, Toolify, Futurepedia, AlternativeTo, BetaList, Fazier.
      Copy is in `revenue-pivot-directory-listings-2026-07-03.md`.
- [ ] **Fill in the Product Hunt page** (should already be set — confirm): name, tagline, topics
      (Marketing / SaaS / Artificial Intelligence), gallery images from `products/ambientscore/img/`
      (01-landing, 02-results, 04-report-unlocked + mobiles), and the description.
- [ ] **Gather "Notify me" followers** — the single biggest lever on launch day. Every follower gets
      pinged the second you go live, which drives the first-hour upvote burst that sets your ranking.
      - Post the pre-launch link on X / LinkedIn / Bluesky: "Launching Tue on Product Hunt — click Notify."
      - **DM 10–20 people directly** (SaaS/marketing friends, past colleagues). Personal asks >> public posts.
- [ ] **Line up 5–10 real supporters** who'll upvote AND comment in the **first hour** Tuesday. Keep it
      genuine — PH aggressively penalizes vote rings. Ask them to try a real scan and comment honestly.
- [ ] **Draft your launch social posts** now (see §7 tags in the listings doc) so Tuesday is copy-paste.

---

## Phase 2 — Launch morning (Tue Jul 7, from 12:01am PT)

> You don't need to be awake at 12:01am, but the first 2–3 hours matter most. If you can, post the
> maker's comment right at launch and again check in by ~6–7am PT when the US wakes up.

**At launch (12:01am PT / whenever you start):**
1. [ ] Confirm the listing went live at the PH URL.
2. [ ] **Post the maker's first comment** (pre-written in the listings doc §1) and **pin it**.
3. [ ] **Ping your line-up** of supporters (the DM list) — "we're live, here's the link."
4. [ ] **Announce on socials** — X, LinkedIn, Bluesky — with the launch copy + §7 tags. Link to the PH page.

**First few hours:**
5. [ ] **Reply to every PH comment** fast and personally — engagement velocity feeds ranking.
6. [ ] When someone says they tried it, ask what grade they got — turns commenters into a thread.
7. [ ] Watch for the first real scan/sale (dashboards below).

**Midday US (9am–12pm PT):**
8. [ ] Second social push ("we're #X on Product Hunt today — try a free scan").
9. [ ] Keep replying to comments.

---

## Phase 3 — What to watch (live dashboards)

| What | Where |
|------|-------|
| Visitors + scan funnel | `GET /api/productAnalyticsQuery?range=1d&product=ambientscore&metric=funnels` |
| Scans by tier | `cc_analytics` |
| **Sales + which agent earned them** | Revenue page + **Attribution page** (per-agent revenue, now live) |
| Ledger totals | `GET /api/revenueDigest` (`payingCustomers`, `mtdRevenueCents`) |
| Email leads | `as_leads` blob |

**The moment to celebrate:** first `page_view` → first `scan_started` → first `checkout_started` →
first `revenueDigest.payingCustomers = 1`. On the Attribution page, the earning agent turns green.

---

## Phase 4 — After launch → the ceiling test (2 weeks)

Once traffic is flowing, the pre-agreed decision rule (pending your final sign-off):
- **≥30 scans & 0 purchases** → product/pricing problem (human decision).
- **<30 scans** → distribution still the bottleneck (more listings / outbound).
- **Both rising** → the lever works; generalize it.

---

## If something breaks
- **Scans erroring on launch day** → check `productAnalyticsQuery` for `scan_started` with no
  `scan_completed`; likely the analyzer/Gemini. Ping the dev side, don't hot-patch mid-launch.
- **A sale shows in Stripe but not in `revenueDigest`** → webhook delivered but ledger write failed;
  the endpoint/secret check above should have caught it. Capture the Stripe event ID.
- **Buyer says they paid but got no report** → check `as_leads` + the report `id`; the webhook may not
  be registered (the exact thing to verify this weekend).

# Autonomy plan: synthesis of three external reviews

**Date:** 2026-10-06

**Inputs:**
- [`../specs/2026-10-06-autonomy-brief.md`](../specs/2026-10-06-autonomy-brief.md)
- Three Fable 5.1 reviews: critic, architect, growth.

**Status:** proposed. Awaiting CEO decisions (see the end of this document).

## Verified facts the reviews surfaced (checked in code and production, 2026-10-06)

1. **Blog posts are invisible to crawlers and link unfurlers.**
   - `staticwebapp.config.json` rewrites `/blog/*` to `/blog/index.html`, a JavaScript shell.
   - A Googlebot request for a real post returns the title "Journal — AmbientPixels", a generic og:title, and "Loading…".
   - Server-rendered `api/blogpage` exists but is not routed.
   - Every blog post ever written has had zero search value, and every shared link has shown a generic card.
2. **The objective metric is narrower than intended.**
   - `qualified_visitors_week` counts `funnel.publicScans7d`: AmbientScore scans with `tier !== 'agent'`.
   - It does not count Resume Roast runs.
   - It has no per-campaign attribution, and no crawler or CEO-test exclusion was found.
3. **No kill-rule machinery exists.** Campaigns end only by `endDate` or when their tasks are done (`campaign-lifecycle.js`).
4. **A campaign marked `complete` before its `endDate` is reactivated** on the next cycle (`campaign-lifecycle.js` ~L142). An auto-kill needs a terminal status that loop ignores.
5. **Duplicate checks are easy to dodge.** Proposal dedup is title similarity ≥ 0.6, and the reject cooldown matches the exact name only. A reworded proposal bypasses both, which is the mechanism behind the 13 near-identical proposals.
6. **The quality gate fails open** when the Haiku call returns null.
7. **The grace-window daily cap counts only grace-published posts,** not all posts.

## Principles every reviewer converged on

- **The CEO approves direction (campaigns and bets), not items (posts).**
- **Every control that must hold is code.** Prompt text is a preference.
- **Every campaign is a pre-registered bet** with a kill rule computed in code against a per-campaign number. When that number is unmeasured the result is `null`, never a zero.
- **Breakers must trip on telemetry,** not only on CEO rejections, because the CEO is absent for weeks.
- **Replies to named people never auto-publish,** enforced by action type in code.
- **Stop daily broadcast.** Volume is disproven. One weekly scoreboard post replaces it.

## Plan

### Phase 0: foundations (week 1)

1. **Route `/blog/*` to `api/blogpage` (server-side rendering).**
   - Verify with a Googlebot curl and a link-unfurl check.
   - *`staticwebapp.config.json` is a do-not-touch file, so this needs explicit CEO OK.*
2. **Fix the north-star metric.**
   - Count completed Resume Roast runs plus AmbientScore scans.
   - Exclude bots, fleet sessions, and CEO sessions.
   - Return `null` when unmeasured.
   - Retarget: checkpoint of 3/week by 11-05, 10/week by 12-03.
3. **Per-campaign attribution.**
   - Add `utm_campaign=<campaignId>` on every outbound link at the publish rail.
   - Capture `document.referrer` on the first product event.
   - Add a resolver `campaign_visitors_14d(campaignId)`.
4. **Scribe prompt under the 30K ceiling.** It was degraded in 100/100 cycles.

### Phase 1: controls, then publishing autonomy (weeks 1–2)

5. **Bet schema enforced by `validateBet()` in code.**
   - Fields: mechanism (closed enum), hypothesis, evidence with `n` and source, baseline, expected, kill rule, scale rule, credits.
   - Add `betKey` fingerprint dedup in place of title similarity. A `lost` betKey is blocked for 60 days unless there is newer evidence.
6. **Evidence block in the proposal prompt.**
   - Per channel, 30 days: posts n, attributed people k/n, followers.
   - Last 10 bet verdicts.
   - **Mechanisms never tried.**
7. **Kill rule evaluated every cycle,** writing a terminal `killed` status that is excluded from the reactivation loop.
8. **`scoreBet` at campaign end:** a verdict of won, lost, killed, or inconclusive, appended to the `betLedger`, fed back into steps 5 and 6, and fed to rewards.
9. **Publish safety in code:**
   - An account-wide per-platform publish budget at `actionsScheduler`, default 1/day/platform, counting every path.
   - Replies are never auto-publishable.
   - The quality gate fails closed when auto-publish is on.
   - A first-person lint on original brand posts.
   - A metric breaker: 6 or more posts in 14 days with 0 attributed people pauses the campaign.
10. **Then:** auto-publish inside approved campaigns, Bluesky first.

### Phase 2: minimal-attention operation (weeks 3–6)

11. **Absence mode.**
    - Stamp `ceoLastWriteAt` on CEO writes.
    - After 14 days with no CEO write: no new campaigns, a 1/day cap, the quality gate fails closed, and nothing reply-shaped publishes.
12. **Vale's weekly board minute,** decisions only. The CEO's routine is a 20-minute session every 2 weeks:
    - read the digest;
    - decide on at most 3 proposals, each with sample posts;
    - audit 5 random published posts, recording "would have rejected" plus a reason (this keeps the revision signal alive);
    - renew the absence lease.
13. **Lane trust ladder** (agent × action type × platform). Promotion is based on sample size and won bets; demotion comes from telemetry, through a post-publish quality re-check and breakers.
14. **Optional: a CEO envelope** (`systemConfig.ceoEnvelope`). Bets inside the envelope auto-launch after a 72-hour veto window. Branch `autonomy-restart` (`api/_utils/campaignAutonomy.js`) is the starting point.

### First bets to approve (Growth review)

| Bet | Why | Gate | Kill rule |
|---|---|---|---|
| **E1: role-intent pages for Resume Roast** (12 pages) | The only channel that works while the CEO is away | Needs step 1. Search Console must be confirmed. | No page over 50 impressions by week 4 |
| **E2: launch-day teardown gift** (Bluesky) | A founder posts "launched my landing page", and the agent replies with a real AmbientScore grade and 2 findings, no link. Uses only capability that is already built. | Targeting in code. These are replies to named people, so they are CEO-approved; cap 3/day. | Under 2 recipient scans per 40 replies |
| **E5: weekly scoreboard post** | Replaces all daily broadcast | — | No post beats 5 clicks by week 4 |
| **E6: listing sprint** | Agents draft listings for Product Hunt, AI directories, and top.gg; the CEO submits in one batch | `utm_source` per directory | One-shot |

### Skip

- Daily broadcast on X, LinkedIn, Facebook, and Instagram.
- Cold replies carrying links.
- Git or infrastructure access for Forge.
- An LLM "devil's advocate". Use the code validator instead.
- Partnerships inside 8 weeks.

## CEO decisions needed

1. OK to edit `staticwebapp.config.json` for the blog route.
2. Retarget the objective: completed roast or scan, 3/week by 11-05, 10/week by 12-03.
3. Auto-publish waits for the Phase 1 controls, roughly 1–2 weeks.
4. Envelope (bets inside CEO-set bounds auto-launch after 72 hours), or approve every campaign individually.
5. Approve E2 as the first bet. Its replies are CEO-approved, about 3/day for 2 weeks.

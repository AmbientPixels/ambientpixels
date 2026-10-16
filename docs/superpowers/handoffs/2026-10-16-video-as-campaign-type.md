# Handoff: video becomes a campaign type (for the video pipeline session)

**Date:** 2026-10-16 · **From:** the HQ simplification session · **Decided with Chad tonight.**
**Plan:** `docs/superpowers/plans/2026-10-16-hq-simplification-plan.md`, phase 4 (rows 4.1 and 4.4, and the
"Campaigns hold all work" note under them). Nothing below is built yet.

## The decision
- Work hangs off campaigns, campaigns hang off goals. **Every work task belongs to a campaign**, including video
  requests. The only exception is a task assigned to Chad himself.
- **A video is a campaign type, like a blog post** (`video_request`). A campaign can mix types — e.g. Monthly Journal
  = 1 blog post + 1 video a month — with a volume per type.
- No standing "Video" campaign: every video serves a campaign. Releasing a video (its post, its promotion) stays in
  the same campaign.

## What the HQ session will build (don't duplicate)
`campaign-lifecycle.js` (`_validTaskTypes`, agent + label maps, replenish per type), `proposalDecide/materialize.js`
(`VALID_TASK_TYPES`), the campaigns page "Video" checkbox, the create-task campaign guard, promotion inheriting the
post's campaign, per-type volume and pace (`api/_shared/metrics.js`).

## What belongs to the video pipeline (yours)
1. **Requests made by a campaign.** When a campaign's video is due, replenish will create a `video_request` task with
   `campaign_id` and `objective_id` but **no `video-request` block** (product, format, style, mood, seconds, audience).
   `desk.js` `parseRequest` / the Actions Video panel need to handle that: fill what they can from the campaign
   (title, description, bet product/audience) and ask Chad/Pixel for the rest at triage. Please say how you want it.
2. **Requests made by hand or by agents** should carry `campaign_id` on the TASK (not only `trigger.campaignId` inside
   the block, `video-desk.js:102`), so the board, pace and Today count them under their campaign.
3. **Today counts open video requests in `todo` as waiting on Chad** (`api/_shared/metrics.js` `pendingDecisions`,
   from the task board). If requests also go into the approval queue, tell the HQ session so they are not counted twice.

## The two open requests
- #1275 *Inside AmbientOS, episode 01: the crew* → Monthly Journal, once it allows Video (pairs with #1260 "the
  company gets a video team").
- #1274 *AmbientScore: what a free scan shows you* → an AmbientScore campaign to be proposed, or it waits. **Chad picks.**
Neither has been moved; no data changed.

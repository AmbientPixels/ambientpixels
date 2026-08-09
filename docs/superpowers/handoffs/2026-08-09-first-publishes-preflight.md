# Preflight — the two first-ever publishes (Facebook Aug 10, Instagram Aug 11)

**Session:** 2026-08-09, 16:45–17:00 UTC
**Suite:** 87/87 green. `company-state?key=socialCredentials` → 403.
**Code changed:** none. This session verified a path and queued a proposal.

---

## Facebook: nothing was wrong, and it has not fired yet

`act_1786248483667_fbsched_mechanism` is `approved`, `scheduled_for 2026-08-10T16:00:00Z`,
with **no `execution` block at all**. At the time of checking it was 2026-08-09T16:45Z, so
the schedule was still ~23h away. Absent receipt + absent metrics row is the CORRECT state
for an action whose time has not come, not evidence of the failure the last handoff warned
about.

The useful thing to do that far ahead of the deadline is not to wait and then diagnose — it
is to walk the chain while there is still time to fix it. Every link verified:

| # | Link | Verified |
|---|---|---|
| 1 | `actionsScheduler` cron actually runs | Not in the `AzureWebJobs.*.Disabled` set; `function.json` = `0 */5 * * * *` |
| 2 | Action is approved | `approval.status: approved` |
| 3 | `scheduled_for` gate | Valid ISO, passes at 16:00Z; <7d staleness bound not in play |
| 4 | Not treated as manual | `_manualPlatforms` is `['reddit']` only |
| 5 | ALLOW list | `SOCIAL_PLATFORMS_ENABLED` = `x,linkedin,bluesky,facebook,instagram` |
| 6 | Executor exists | `EXECUTORS['social_post.publish'].facebook` → `publishToFacebook` |
| 7 | **Metrics row will be written** | `socialMetrics/telemetry.js SOCIAL_PLATFORMS` includes `facebook` |

Link 7 is the one the kickoff was really asking about — "a receipt with no metrics row means
the funnel is blind even though the post went out". The scheduler's success branch writes
`execution.receipt` AND emits `appendSocialMetricEvent`, and `isSocialAction` accepts
`facebook`, so a successful post produces both. There is nothing to fix before tomorrow.

**Still to do after 16:00Z on Aug 10:** confirm both artifacts actually appeared. A verified
path is not a verified outcome.

---

## Instagram: one post proposed, waiting on the CEO

Queued through the normal queue as `act_1786294464044_igfirst` —
`social_post.schedule`, platform `instagram`, `approval.status: pending`,
`scheduled_for 2026-08-11T16:00:00Z`. It is the only pending action in the store.

Deliberately a day AFTER the Facebook post: both are first-ever publishes to their channel,
and two on the same day means neither gets observed cleanly.

Approve or reject it on the Actions page. Nothing was bypassed — the pending panel is
`AE.getActions()` filtered on `approval.status === 'pending'`, so no `approvalQueue` entry
was written; one would have been an orphan row.

**Preview of the actual image:** `c:/Dev/Ambientpixels/ig-first-post-preview.jpg`
(outside the repo). Rendered locally through the real `cardEngine`, so it is what will
publish, not an impression of it. Worth a look before approving: the pipeline approves
WORDS, and on Instagram the picture is the post.

Checks run against the caption before it was written anywhere:

- `instagram.checkPublishable()` → OK. **0 URLs** — the adapter refuses any caption
  containing one, by design, and the guard is a URL scan rather than `post_shape`.
- 366 chars (limit 2200), 0 hashtags (limit 30).
- 9 lines, all 9 render (the card takes the first 14); fitted type 48px, nothing dropped.
- `composeQualityVerdict` deterministic detectors all clear: no refusal leak, no meta leak,
  no placeholder, **no agent persona**, no fabricated URL, no ungrounded offer, no numeric
  claims needing grounding.
- `payload.media` is `[]` on purpose. cardEngine renders the card at publish time for $0.

The claim the post makes about itself was checked against the code before writing it:
`cardEngine.js` states "No model runs here", renders via satori + resvg, and stamps
`estimated_cost: 0`. The post says nothing this repo cannot back.

`allowBlobPublicAccess` on `cardforgeblobdata` re-confirmed `true` — Instagram fetches the
image by URL, so a private container breaks publishing with an error that points nowhere
near the container.

**Authorship is `created_by: 'claude-session'`, not an agent id.** Outcome attribution and
the rewards engine both key on `created_by`; crediting Scribe for copy Scribe did not write
would put fiction into the metrics. It also means the post carries no pipeline-trust badge,
which is honest: it did not go through Echo → Scribe → Quill.

---

## Two observations, deliberately not acted on

**`socialMetrics/telemetry.js` keeps its own hand-copied platform list** (line 3) instead of
importing `_shared/socialPlatforms.js`. It is currently CORRECT — facebook and instagram are
both present — but it is another copy of the list whose duplication has already caused two
silent channel drops. Consolidating it is right, and the day before the first-ever Facebook
post is the wrong day to edit the module that proves the post happened. Worth doing once
both publishes are confirmed.

**`cardEngine.fitSize` is conservative enough to leave real slack.** On this caption it
picked 48px and the copy filled roughly three quarters of the frame, with the bottom quarter
empty above the lockup. The estimator assumes a 0.62em advance and counts more wrapped rows
than Archivo Black actually produces. The comment anticipates being "one size step
conservative"; here it is nearer three. Cosmetic, and the card still reads as designed.

---

## Facts worth keeping

- **An absent receipt before the scheduled time is not a failure.** Read the clock before
  reading the state, or you will diagnose a bug that is just the future.
- **Being early is leverage.** Walking all seven links 23h ahead is cheap; the same walk at
  16:05 the next day is a post-mortem.
- **Verify the claim the copy makes, in the code, before proposing the copy.** "Not made by
  an image model" is only publishable because `cardEngine.js` says so.
- **Do not credit an agent for work it did not do**, even when the field expects an agent id.
  Attribution is data, and metrics read it.

# Handoff — Instagram is wired, the analytics hub tells the truth, the XP economy is running again

**Session:** 2026-08-09 (05:00–06:40 UTC)
**Commits:** `eae08d31` → `3350abe0` (7 mine, on top of `21e5a396`), all pushed, HEAD in sync
**Suite:** 87/87 green throughout

---

## The find that mattered most

**Facebook scheduling was silently broken and nobody would have noticed.**

`SOCIAL_PLATFORMS_ENABLED` was `x,linkedin,bluesky`. The 08-08 session correctly removed
facebook from the SKIP list (`actionsScheduler._manualPlatforms`) but never added it to the
ALLOW list — and **that list is an Azure app setting, not in the repo**, so the handoff's own
"grep the SKIP lists too" rule could not have caught it.

All four CEO-approved posts would have hit `actionsScheduler/index.js:161`, logged one line,
and sat `pending` forever. Nothing marked failed. No alert. Zero Facebook telemetry events and
zero governance entries confirmed the pipeline had **never** executed a Facebook action — the
one live post went out some other way.

Found ~35h before the first post was due. Fixed with CEO approval, verified twice.

> **RULE: grep the SKIP lists AND the ALLOW lists — then check the env vars, because one ALLOW
> list is not in the repo at all.**
> **RULE: a silent `continue` on a public-posting path is a bug.** A gate that skips a
> CEO-approved action must mark it failed or alert, never leave it `pending`.

---

## Live state

| Thing | Value |
|---|---|
| Instagram | `17841442391762826` `@ambientpixels2022`, **0 followers, 0 media**, adapter LIVE, **never published** |
| Facebook | Page live, 2 posts, **0 comments, 0 likes** (probed) |
| 4 FB scheduled posts | `approved`, due **Aug 10 / 12 / 14 / 16 at 16:00 UTC** |
| `SOCIAL_PLATFORMS_ENABLED` | `x,linkedin,bluesky,facebook,instagram` |
| Analytics hub | 5/5 platforms connected, 0 errors |
| `rewardsEngineCron` | **RE-ENABLED**, timer verified firing (06:30:02Z) |
| `milestoneHeraldCron` | still **disabled** — deliberate |
| Meta data-access expiry | **2026-11-07T05:18:26Z** |

---

## What shipped

**Facebook comments reach the Engagement Inbox** (`eae08d31`). Harvest hosted in the
`socialEngagementPull` cron; `companyHeartbeat/index.js` untouched. The guard mattered more
than the harvest: `buildEngagementReplyTask` hardcodes `taskType: 'bluesky_reply'` and puts
`replyUri` into `threadContext.uri`, so a Facebook comment reaching it would have aimed a
Bluesky reply at a Graph comment id. `filterCandidates` now refuses non-Bluesky platforms,
covering all three drafting paths at once. `replyToComment` stays unwired.

**Instagram, end to end** (`edd5ccc1`, `84101993`). The adapter is mostly about what it
*won't* do: it **refuses any caption containing a URL**, before the card render and before any
Graph call. The detector is a URL scan, **not** `post_shape` — that field lives on the TASK and
never reaches the action an executor receives, so checking it alone would have been a guard
that silently never fires.

Publishing is two calls. A container that is never published is inert, so container failures
retry safely; `media_publish` is not — if the POST lands and the response is lost, the post is
live and we don't know it. Timeouts now set `requires_manual_review`, and `actionsScheduler`
honours that flag from any adapter (it previously only set it on its own stuck path).

**The analytics hub was dropping data it already had** (`b971b2c8`). `socialAccountStats` had
been pulling Facebook and caching it for a day; two frontend lists said
`['x','linkedin','bluesky']` and threw it away. Also fixed a hardcoded `/3` denominator and
`pl.followers || 0`, which rendered a **failed read as "0 followers"**.

**One shared platform list** (`eb4b9b88`). `api/_shared/socialPlatforms.js`, with lists named
for the question they answer. `LINK_CAPABLE` excludes Instagram — blog promo must use it, not
`AUTO_PUBLISH`. Consolidating `social-intel.js`'s six inline copies exposed three latent bugs:
a missing `byPlatform` bucket (throws, not degrades), reddit's `posts7d` never computed, and a
follower total that summed four named keys so later platforms contributed nothing.

**The rewards economy is running again** (`ebb6d547`). See below.

**The system bible was lying to every agent** (`3350abe0`). It is injected into all 9 prompts,
truncated to **20,026 of 146,586 chars**, changelog pulled to the top. It opened with "8
agents" and "every hour" (it is 9 and 6h), and stated `FINANCE_BUDGET_MONTHLY` as **$15 when
constants.js says $110** — an agent judging affordability was reading a figure off by 7x.

---

## The rewards engine — audited, not broken

Re-enabled at the CEO's call. Manual trigger cleared a 4-day backlog cleanly: **1,206 events,
88 awards**. Timer verified firing on its own schedule.

It is **deterministic and makes no model calls**, so running it costs no tokens. The "disable
it to save tokens" rationale never applied to the engine — the only cost is the ~848-char
progression block (~$0.70/mo across 9 agents), **which was still being paid the whole time it
was off.**

- Streaks rebuild correctly from event history on backfill (Echo 13, Forge 10) — an outage does
  not unfairly flatten them.
- Ranks are level-derived; `Operator` needs L10, so everyone at `Rookie` is correct.
- `budgetPlan.poolDollars: 110` matches `FINANCE_BUDGET_MONTHLY`.
- ⚠️ The field is `perAgent[id].streakDays`, **not** `.streak.current`. I misread it once and
  nearly reported a false "all streaks reset".

**The real defect was the prompt, not the engine.** For four days every agent was told, with
total confidence, *"Level 6 Rookie. 36-day streak. Rank #1 of 9. 23 days left."* — all frozen on
08-05, with nothing saying so. `buildProgressionPromptBlock` now refuses to render standings
when the ledger is >26h old and says `NOT BEING SCORED`, keeping the earning doctrine because a
**rule** stays true whether or not anyone is scoring. Unknown age fails **closed**.

Five existing tests broke on this and every one was the guard working — their fixtures had no
`updatedAt`. Fixing the fixtures was the fix; making unknown-age render would have been the bug.

---

## Next up, in order

### 1. Watch the Aug 10 16:00 UTC Facebook post
**Nothing has ever published to Facebook through this pipeline.** Confirm it produces BOTH a
receipt and a `socialMetricsEvents` row. If it produced neither, check
`SOCIAL_PLATFORMS_ENABLED` first.

### 2. Instagram's first post
The whole IG path is verified up to the publish call — credentials reach the real account,
`allowBlobPublicAccess: true` so `cardEngine` can create its public container. Only a real post
proves container → `media_publish`. It is a public post, so it needs a CEO decision.

### 3. Milestone Herald (CEO decision)
Correct but dormant. Needs: `milestoneHeraldCron.Disabled=false`, unpause
`camp-milestone-herald`, and add `social_facebook`/`social_instagram` to its
`allowedTaskTypes` (currently `["social_bluesky","social_x"]`). **Do the last two only after XP
has run long enough to produce REAL milestones**, or its first public announcement could be a
stale one.

### 4. Smaller
- `_paceSocialTypes` (`companyHeartbeat/index.js:3921`) lacks `social_instagram`. It already has
  `social_facebook`, and the check is `.some()`, so only an **Instagram-only** campaign fails to
  escalate when behind pace. One word, in an off-limits file.
- `checkTokenHealth()` still has no schedule before the **Nov 7** cliff. When it lapses,
  publishing keeps working while comments and insights quietly return empty.
- The stale prose deeper in SKILL.md still says $15 / 8 agents / hourly. Only the changelog was
  corrected.
- `socialAccountStats`'s demo mock and a few `social-intel` cousins were swept; the frontend
  lists are duplicated by hand because the browser cannot `require()`.

---

## Rules that earned their place this session

- **Grep the SKIP lists AND the ALLOW lists — then check the env vars.** One ALLOW list is an
  Azure app setting no grep will ever find.
- **A silent `continue` on a public-posting path is a bug.**
- **"Enabled" in config is not "running".** Three layers can switch a feature off: the Azure
  function binding, the feature's own config, and a gating entity. `systemConfig.x.enabled:true`
  says nothing. Probe `?dryRun=1`.
- **A stopped system must not keep asserting live numbers.** Frozen data stated as current is
  worse than no data — the reader cannot tell it is history.
- **When adding a capability, state what the agent must KNOW, not just what the code DOES.** A
  prohibition (Instagram takes no links) needs stating more urgently than a feature.
- **Pick the platform list by CAPABILITY.** `LINK_CAPABLE` ≠ `AUTO_PUBLISH`. Getting it wrong is
  how Instagram is handed a link it cannot render.
- **Render it and count the elements.** A string replace on an indented HTML line matched a
  *substring* of a deeper-indented line and duplicated a checkbox into the wrong group. The CEO
  caught it on screen; the diff looked fine.
- **Verify the field name before reporting a finding.** `.streak.current` vs `.streakDays`
  nearly became a false "all streaks reset" bug report.
- **A cached dashboard can hide a successful deploy.** Instagram looked "not connected" for 15
  minutes after it was live; `?refresh=1` proved the backend and rewrote the cache.

---

## Kickoff prompt for the next session

```
Read docs/superpowers/handoffs/2026-08-09-instagram-analytics-rewards-handoff.md in full.

BEFORE ANYTHING ELSE: the Aug 10 16:00 UTC Facebook post is the first thing to EVER publish
to Facebook through this pipeline. Check act_1786248483667_fbsched_mechanism. It must have
BOTH execution.receipt AND a socialMetricsEvents row — a receipt with no metrics row means
the funnel is blind even though the post went out. If neither exists, read
SOCIAL_PLATFORMS_ENABLED (an Azure app setting, NOT in the repo) before anything else.

THEN, in order:

1. Instagram has never published. Everything up to the publish call is verified. Propose ONE
   engagement-shaped post to the CEO and ship it through the normal approval queue. Do not
   bypass the queue. The caption must contain NO URL — the executor rejects it otherwise, by
   design. You do not supply media; cardEngine renders it.

2. Report on the Milestone Herald only if the CEO raises it. It is correct but dormant and
   turning it on is a product decision, not a fix.

DO NOT:
- Touch companyHeartbeat/index.js, company-state/index.js beyond SENSITIVE_KEYS,
  staticwebapp.config.json, or data/company-actions.json.
- Wire any comment-reply lane to automation. There is still no fabrication guard on it.
- Re-enable any AzureWebJobs.*.Disabled cron without the CEO asking. They were turned off
  deliberately for burn.
- Rotate credentials. The CEO declined; it is recorded.
- Return 0 from a read that failed. Return null.

RULES:
- Grep SKIP lists AND ALLOW lists, then check env vars.
- "Enabled" in config is not "running" — probe ?dryRun=1.
- Pick platform lists by capability from api/_shared/socialPlatforms.js. LINK_CAPABLE
  excludes Instagram.
- Render it and count the elements before claiming a UI change works.
- Writes go through storage.mutateState, never a whole-array setState.
- Verify a field name before reporting a finding based on it.

VERIFY WITH:
  for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
  curl -s -o /dev/null -w "%{http_code}\n" "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=socialCredentials"   # MUST be 403

Commit and push as you go, with real reasoning in the messages.
```

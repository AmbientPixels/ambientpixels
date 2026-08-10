# Handoff — Facebook and Instagram both published for the first time, and the fleet's block counts were lying by 13x

**Session:** 2026-08-09 16:45 → 2026-08-10 03:30 UTC
**Commits:** `f57a603a` → `7fd9c1ed` (7 mine, on top of `08be8c46`), all pushed, HEAD in sync
**Suite:** 89/89 files green (was 87 — two new suites added)

---

## The headline

**Both first-ever publishes happened tonight, ~6h apart, and both produced full telemetry.**

| | Instagram | Facebook |
|---|---|---|
| Published | 2026-08-09 21:25:54Z | 2026-08-10 03:28:17Z |
| URL | `instagram.com/p/Db1ZlurEp54/` | `facebook.com/122105341017424861/posts/122106515859424861` |
| `execution.receipt` | ✅ real permalink | ✅ real permalink, `post_url_source: graph` |
| `socialMetricsEvents` row | ✅ | ✅ (facebook events: **0 → 2**) |
| `outcomeSnapshots` t0 | ✅ | ✅ |
| Attempts | 2 (one real bug, below) | 1, 3.5s, clean |

That was the mandate the session opened with — **a receipt AND a metrics row**, because a receipt alone means the post went out while the funnel stayed blind. Both have both. Facebook had never produced a single telemetry event before tonight; the two posts already on the Page went out some other way.

Five channels now have working receipts: Bluesky, X, LinkedIn, Facebook, Instagram.

---

## The bug that only a real attempt could find

Instagram's first publish failed with **"Media ID is not available" (9007/2207027)**. The adapter created the media container and called `media_publish` on the very next line. An id in the container response means *accepted*, not *ready* — Instagram fetches `image_url` on its own side, asynchronously, and the container sits `IN_PROGRESS` until that completes.

Ruled out the alternatives before changing anything: `media_count` was 0 (so nothing published and the 400 was a definite answer), and an anonymous GET of the rendered card returned `200 image/jpeg` (so the image was reachable). That left readiness. Now polled — `status_code` every 3s up to 60s, publish only on `FINISHED` (`b36461f0`).

**Everything the wait throws is retryable and deliberately never sets `requires_manual_review`.** That flag is for the opposite case one step later, where a `media_publish` of unknown outcome could double-post. Here nothing has been attempted, so nothing can be live, and an unpublished container expires by itself in 24h. A test asserts the flag never appears in that helper.

**This would have hit the Aug 11 scheduled run identically.** It surfaced only because the CEO tried it manually with two days of slack instead of none.

---

## The measurement that was wrong

`heartbeatRuns[].perAgent[].actionsBlocked` **under-reports blocking by 13x.** Measured: five runs reported **2** blocks where governanceLog held **26**. Over 7 days: **294 blocks across 9 agents.**

It sums two partial counters — gates living in `index.js`, plus five named guardrails. There are ~21 gates. Everything enforced inside `agent-runner.js` (`campaign_freeze` in all five forms, `agent_cooldown`, `quality_gate`, `tier4_forbidden`, `summary_dedup`, `memory_schema`) blocks with a bare `continue` and touches neither.

That is not cosmetic. It reads as *an agent that attempted work and produced nothing for no reason* — which is exactly how I misdiagnosed Scribe mid-session as silently dropping actions, when every one had been refused by a gate and logged correctly. `ops-intel.js` and the agent-performance block rate both read that field, so Forge's health view was reading the same fiction.

Readers now count from governanceLog (`_utils/blockCounts.js`). Forge's per-agent view went from ~0 to echo 36 / nova 21 / scribe 15, each naming the gate responsible.

**The run-record field itself is still wrong.** Fixing it at source means editing `companyHeartbeat/index.js`, which is off-limits without an instruction naming that file. Anyone reading that field raw is still misled.

---

## Why the fleet kept walking into gates

`campaign_status` (paused) or `campaign_freeze` was the top gate for **six of nine agents** — Echo alone hit `campaign_freeze` 30 times. The prompt has carried *"do NOT create tasks for paused campaigns"* as a static rule for months. **A rule without the list is unactionable.**

They now get the list, computed from the same gate logic before the tokens are spent (`_utils/campaignAvailability.js`, injected via `agent-runner` → `prompt-builders`).

The block **leads with what is OPEN**. My first version listed the closed ones; against live data that was 36 of 37 campaigns — a wall of prohibitions to convey one usable fact. Paused is still named individually because it freezes every mutation on tasks already inside it.

**First post-deploy run (00:03Z), against the four before it:**

| run | attempted | executed | true blocks |
|---|---|---|---|
| 08-09 18:02 | 16 | 6 | 5 |
| **08-10 00:03** | **11** | **5** | **3** |

Directionally right — fewer wasted attempts, same output. **This is n=1. Do not call it proven.** Watch the next three or four runs.

---

## Everything else that shipped

**Animated cards work with NO ffmpeg** (`f32d182f`). satori/resvg draw the frames, `sharp(frames, {join:{animated:true}})` joins them. Animated WebP ~118KB against ~76KB for the still — **motion costs ~1.5x a still**; the same frames as GIF are ~3MB. `ANIMATED_IMAGE_FORMAT` lists **x only**: X maps `image/webp` to a STILL, Bluesky's animation support is UNVERIFIED, Instagram needs Reels/MP4. **Nothing publishes animated yet** — capability only, a caller must opt in.
⚠️ **A scalar frame delay on the join path applies to frame 0 only** (`[80,0,0,0]`) — pass an array.

**Card type was one step too small** (`f34324a6`). `fitSize` assumed 0.62em per character; measured, Archivo Black is **0.5415em** — 14.5% too wide, so it overcounted rows. Real captions gained a step (IG 48→50, FB 50→52). `scripts/measure-card-advance.js` re-derives it. The remaining whitespace is `LOCKUP_H` reserving 150px for a ~60px lockup — a deliberate breathing gap, CEO chose to keep it.

**Telemetry stopped keeping its own platform list** (`1e0ccb43`) — now reads `AUTO_PUBLISH`. It was correct at the time, which is why it was worth removing before it went stale.

**Milestone Herald is LIVE, Bluesky only.** All three gates opened; it produced 3 grounded draft tasks (echo level-up, forge achievement, scribe notable week). **It fired IMMEDIATELY on the app restart, not at its 16:10 schedule** — Azure timers catch up on occurrences missed while disabled. As of 00:03 one task reached `review`, two remain `todo`.
Correction to the record: the earlier note that it had *never run* was **wrong** — it ran Jul 18 → Aug 1 and produced real tasks. The evidence was in `tasksArchive`, not `tasks`.

**The Actions page now says when its writes are dead** (`7fd9c1ed`). See below — the underlying problem is NOT solved.

---

## OPEN — the thing to fix first

### 1. The CEO's browser cannot execute actions. Root cause unknown.

He clicked "Post Now" **twice**, ~40 minutes apart, and both times the request never reached the server — all four FB actions stayed at `attempts: 0`, nothing published, no telemetry.

**The server is fine.** Proved without publishing: `POST /api/actions/execute` with the write secret returns `404 Action not found` (endpoint healthy, auth accepted); without it, `401`. The Facebook post then published first-try from a shell using that same secret.

**Not caching** — the page serves `Cache-Control: no-store` and `Last-Modified` matched the deploy.

The working hypothesis was an expired write key: the secret lives in **`sessionStorage`, which the browser wipes when the tab closes**, and `actions.html` was the *only* page with no write-status indicator (`dashboard.html` has had one for months). The sole signal was a toast that self-removes after 8 seconds. That gap is now fixed — a banner appears before anything is clicked, and a 401 raises a persistent red banner instead of only a toast. A 401 also no longer calls `AE.failAction`, because the server never looked at the action and stranding an approved post over an expired browser session is wrong.

**But this is unconfirmed.** The banner fix was verified in a local browser (Playwright, screenshot reviewed), never against the live authenticated page — `/modules/company/` is B2C-gated, so an unauthenticated fetch returns a 4.4KB "401 access restricted" stub, not the page. **Until the CEO reports what he sees on load, every Post Now from the dashboard may still be dead.**

**First question next session: does a coloured banner appear at the top of the Actions page?** If yes, it was the key. If no, the request is failing before `fetch` and needs the Network tab.

### 2. Watch the block counts across the next few runs
n=1 so far. If attempted stays down and executed holds, the campaign-availability block is earning its ~227 tokens.

### 3. A Bluesky reply is pending CEO approval — and that lane still has no fabrication guard
`act_1786320096768_bsreply_npg9p`, drafted by Scribe at 00:01Z. **I read it: it is clean** — a plain acknowledgement of a user's bug report ("you're right about the pricing hallucination, that's a bug"), no invented anecdote. It does contain an em dash, against founder-voice rules. Worth knowing the reply lane is active again, since a fabricated first-person anecdote once passed QG at 95%.

### 4. Three Facebook posts still scheduled
Aug 12 (roast), Aug 14 (pulse), Aug 16 (honest) — all `approved`, `attempts: 0`, untouched. The Aug 10 mechanism post is `success`, so the scheduler will skip its 16:00 slot rather than double-post.

### 5. Smaller, unchanged
- `milestone-herald.js` writes tasks with a whole-array `setState('tasks')` — latent clobber, now live code.
- `checkTokenHealth()` still has no schedule before the **Nov 7** Meta data-access cliff.
- `_paceSocialTypes` lacks `social_instagram` (one word, in an off-limits file).
- **Do not unfreeze campaigns.** Investigated in depth: 9 of 12 pauses are the CEO's 08-05 "search-findable content only" decision, made on measured evidence (followers 82, outbound 40 replies / 0 clicks), and the 08-08 distribution diagnosis independently disproved volume. The SEO lane is delivering — 2 articles published 08-07 and 08-08. The two Nova pauses cite a "139–160% budget overrun" measured against the **stale $15 figure**, not the real $110; that reasoning is void even if the pause is right.
- Stray keystroke `"You can't le"` at the end of `docs/superpowers/handoffs/2026-08-09-instagram-analytics-rewards-handoff.md` — the CEO's, left untouched.

---

## Rules that earned their place

- **Read the clock before you read the state.** An absent receipt before the scheduled time is not a failure. I nearly diagnosed a non-existent scheduler bug this way, twice.
- **The sandbox clock drifts. Trust server timestamps.** `date -u` read 23:20Z while the Function App stamped 03:28Z. The GitHub-Actions keepalive `pingLog` is an external clock nothing local can fake.
- **A partial counter read as a total is worse than no counter.** `actionsBlocked` counts 5 of ~21 gates and made refused agents look idle.
- **A rule without the list is unactionable.** "Don't post to paused campaigns" sat in the prompt for months while agents hit that gate 100+ times a week.
- **Lead with what's allowed, not what's forbidden.** 36 prohibitions to convey 1 permission is a worse prompt than naming the 1.
- **Verify the field name before reporting a finding.** Cost me three false alarms in one session: `actionsBlocked`, `agentRewards` (not a `company-state` key — a failed read read as an empty ledger), and `publishedAt` vs `published_at` (which made a healthy SEO lane look dead).
- **`tasks` holds only recent items.** Absence there is not absence — check `tasksArchive` before concluding something never happened.
- **A verified path is not a verified outcome.** Instagram's seven links all checked out and it still failed on the first real publish.
- **Check that a regression test actually fails.** Both new guards were confirmed by reverting the fix and watching them go red.
- **Render it and look at it.** The card, the contact sheet, the banner — all screenshotted before claiming they worked. The first band-detection harness was silently measuring the gold rule against the wordmark and reporting an identical gap for every caption.

---

## Kickoff prompt for the next session

```
Read docs/superpowers/handoffs/2026-08-10-first-publishes-and-block-truth.md in full.

BEFORE ANYTHING ELSE, ask the CEO one question: when he loads
/modules/company/actions.html, does a coloured banner appear at the top?

That is the open unknown. He clicked "Post Now" twice and the request never
reached the server both times — all four Facebook actions stayed at attempts:0.
The server is proven healthy (POST /api/actions/execute returns 404 with the
write secret, 401 without; the FB post then published first-try from a shell).
A banner + persistent 401 handling shipped in 7fd9c1ed but was only verified in
a local browser, never against the live B2C-gated page. Until he answers, assume
every dashboard Post Now is still dead.
  - Banner appears  -> it was an expired sessionStorage write key. Confirm he can
    set it inline and execute.
  - No banner       -> the request dies before fetch. Ask for the Network tab
    entry for actions/execute, and check for a JS error before line ~2500 of
    modules/company/actions.html.

THEN, in order:

1. Measure the campaign-availability block across the runs since 00:03Z. Baseline
   pre-deploy: ~16 attempted / 6 executed / 5 true blocks per run. First
   post-deploy run: 11 / 5 / 3. That is n=1 — do NOT call it proven. Count true
   blocks with _utils/blockCounts.js, never perAgent.actionsBlocked.

2. Check the 3 Milestone Herald tasks (one was in review at 00:03). If they reach
   the approval queue as grounded first-person posts, the Herald works end to end
   for the first time. If they stall or close without publishing, that is the same
   shape as the July run and worth tracing.

3. Report on the pending Bluesky reply act_1786320096768_bsreply_npg9p only if the
   CEO raises it. I read it and it is clean.

DO NOT:
- Touch companyHeartbeat/index.js, company-state/index.js beyond SENSITIVE_KEYS,
  staticwebapp.config.json, or data/company-actions.json.
- Unfreeze campaigns. The 08-05 pauses are a measured CEO decision and the SEO
  lane they protect is delivering. Read that section before arguing otherwise.
- Wire the comment-reply lane to automation. Still no fabrication guard.
- Re-enable any AzureWebJobs.*.Disabled cron without the CEO asking — and know
  that enabling one fires it IMMEDIATELY on restart, not at its next schedule.
- Publish anything animated. The capability exists, X-only, and nothing opts in.
- Return 0 from a read that failed. Return null.

RULES:
- Read the clock before the state, and trust server timestamps over date -u.
- Verify the field name before reporting a finding. agentRewards and
  milestoneHeraldState are NOT company-state keys; the blog date field is
  published_at.
- perAgent.actionsBlocked counts 5 of ~21 gates. Use governanceLog.
- Absence in `tasks` is not absence — check `tasksArchive`.
- Pick platform lists by capability from api/_shared/socialPlatforms.js.
- Render it and look at it before claiming a UI change works.
- Writes go through storage.mutateState, never a whole-array setState.
- Check that a new regression test actually fails without the fix.

VERIFY WITH:
  for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
  curl -s -o /dev/null -w "%{http_code}\n" "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=socialCredentials"   # MUST be 403

Commit and push as you go, with real reasoning in the messages.
```

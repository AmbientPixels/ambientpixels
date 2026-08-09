# Handoff — Facebook is live, video is in the pipeline, one leak is closed

**Session:** 2026-08-09
**Commits:** `8f210329` → `cc2317da` (11), all pushed, HEAD in sync with origin/master

---

## What changed

**Facebook went from a manual outbox to a real channel.** There was never an AmbientPixels
Facebook Page — the "existing followers" the whole idea rested on were on a *personal
profile*, which the Graph API cannot post to at all. Created a Business Portfolio and a real
Page, wired the adapter, published the first post through it.

**Video generation exists, locally and in the fleet.** A workstation script for brand clips
and talking-character clips, and a server-side engine Pixel can request through the approval
queue.

**Credentials were publicly readable and are not any more.** See the incident section; this
is the item with residual risk.

---

## Live state

| Thing | Value |
|---|---|
| Page | **AmbientPixels**, id `1250918731441250`, 0 followers |
| Meta app | `1084528867254262`, Development Mode, business unverified (fine — own-Page access needs no review) |
| Page token | never expires. In Function App settings + `c:/Dev/Ambientpixels/FB_PAGE_TOKEN.txt` (outside repo) |
| **Data access expires** | **2026-11-07** — see below, this one bites |
| Published | 1 post, live |
| Scheduled | 4 posts, Aug 10 / 12 / 14 / 16 at 16:00 UTC, all `approved` |
| Instagram | `@ambientpixels2022`, Business, linked to the Page, **0 followers**, 0% wired in code |
| Video cap | 2 clips/day, CEO-set. Approval-gated. |

### The Facebook expiry that will bite

`debug_token` reports two clocks. The Page token **never expires**, but
`data_access_expires_at` is a separate 90-day one landing **2026-11-07**. When it lapses the
failure is asymmetric: **publishing keeps working while insights, followers and comments
return empty**. Posts go out, numbers go to zero, nothing looks broken.
`facebook.js:checkTokenHealth()` reports both clocks and warns 21 days out. **Nothing calls
it on a schedule yet** — wiring that alert is worth doing before November.

---

## 🚨 Security incident — closed, with residual risk

Unauthenticated `GET /api/company-state?key=socialCredentials` returned HTTP 200 with the
live LinkedIn access token, LinkedIn client secret, Facebook Page token and Meta app secret,
**in full, to the open internet**. LinkedIn's had been exposed since roughly March. The repo
is public and `company-state/index.js` publishes both the endpoint and the key list, so
discovery never depended on site traffic.

Found only because the CEO asked "did you use the key inline or in Azure env vars?" — a
design question. **The answer to a design question is not a substitute for probing the
endpoint.**

**Fixed:** secrets → Function App app settings (both adapters already did blob-first /
env-fallback, so no code change was needed), blob values stripped, and a `SENSITIVE_KEYS`
gate added to the GET path. Verified: unauth GET → **403**.

**Stripping alone lasted 60 seconds.** Blob cleaned at 03:51:02; LinkedIn's
`_refreshAccessToken` fired and wrote a brand-new access + refresh token straight back into
the still-public blob at 03:52:03. **A self-repopulating leak is not fixed by deleting the
data — you must close the read path.** That is also why the key could not simply be removed
from `VALID_KEYS`: linkedin.js needs it as a persistence target.

**⚠️ NOT ROTATED, by explicit CEO decision.** Anything harvested while public stays valid:
LinkedIn access token (to 2026-10-08), refresh token (to 2027-03-01), Meta app secret, FB
Page token (never expires). A **zero-effort** partial cleanup is still available and was
offered twice: force a LinkedIn refresh now that the blob is private, so live credentials are
ones that were never public. The Meta app secret needs the Reset button and is CEO-only.

---

## Next up, in order

### 1. Facebook comment poller — the half-built one

`fetchPostComments` and `replyToComment` exist on the adapter, and the inbox now carries a
real per-entry platform with per-platform links. **Nothing writes Facebook comments into
`engagementReplies`, so they still do not appear in the inbox.**

The Bluesky equivalent is `companyHeartbeat/bluesky-sensor.js`, but wiring a new heartbeat
module means touching `companyHeartbeat/index.js`, which is off-limits. **Preferred: host it
inside the existing `socialEngagementPull` cron**, which already iterates recent posts on a
schedule and needs no change to the pump. Decide this properly before building.

Entries must carry `platform: 'facebook'`, `permalink`, and `ourPostPermalink` — the inbox
already reads all three.

**Do NOT wire `replyToComment` to any automation.** The reply lane has no fabrication guard;
a model-invented first-person anecdote passed the quality gate at 95%. Human decides each one.

### 2. Instagram — 0% wired

`@ambientpixels2022` is Business and linked, and the same Meta app covers it. But in code
Instagram is *nothing*: no task type, no adapter, no metrics, no campaign option. The only
mentions in `api/` are imageEngine size presets.

Two real obstacles: **Instagram cannot post text-only** — every post needs media, and the
whole social pipeline is text-first with images optional. And publishing is a two-step
container → `media_publish` flow, not one call. This is a project, not an afternoon.

Upside: IG Reels reach non-followers, which Facebook Pages structurally do not. It is the
one surface where 0 followers is not a dead end.

### 3. Smaller, worth doing

- Schedule `checkTokenHealth()` so the Nov 7 data-access cliff raises a Discord alert.
- `socialMetrics`/`socialEngagementPull` accept `'facebook'` now, but **verify the first
  scheduled post actually produces a metrics row** before trusting the funnel.
- Correct `VIDEO_COST_PER_CLIP` (currently a conservative $1.20 guess) once AI Studio billing
  shows a real number, exactly as `IMAGE_COST_PER_IMAGE` went 0.01 → 0.039.

---

## Video pipeline

Full detail in `docs/superpowers/specs/2026-08-09-video-pipeline.md`. Short version:

**Local** — `node scripts/generate-brand-video.js [slug|all]`. Brand clips (Veo background +
hook text overlay + audio stripped) and character clips (agent portrait animated, speech
kept). Backgrounds cache in `work/`, so re-running to fix an overlay costs nothing.

**Server-side** — `api/_lib/contentEngine/videoEngine.js`, character clips only. Pixel emits
`generate-video` → queued for approval → **approving is what spends the money** →
`generate_video/character` executor → blob mp4 → approval card plays it inline.

**Why character-only server-side:** the Function App has no ffmpeg and no Playwright, so
text-overlaid clips cannot be composited there. Character clips need no compositing at all.

---

## Rules that earned their place this session

- **Probe the endpoint. A design answer is not evidence.** "Reads are public by design" was
  true for every key except the one holding credentials.
- **A self-repopulating leak is not fixed by deleting the data.** Close the read path.
- **Verify the audience asset exists and is API-reachable BEFORE scoping a channel.** Ask
  "Page or profile", "how many followers", "can the API touch it" before estimating work.
- **Read paths return null, never 0.** `followers: 0` and "we lost access" render identically.
- **Difference cumulative metrics, never sum.** Facebook post counts are lifetime totals.
- **Test against the real API.** `_permalink()` was a perfectly reasonable, self-consistent
  guess that no unit test would ever have caught — New Pages publish under an actor id that
  is not the Page id.
- **When adding a platform, grep the SKIP lists too.** `actionsScheduler` silently skipped
  every Facebook action via a stale `_manualPlatforms` array.
- **Update the prompt enum alongside the handler.** A capability wired in the executor whose
  enum was never touched is invisible to the agent forever.
- **Cover-crop, never pad, when conditioning 9:16 on a square portrait.** Veo animates the
  padding too.
- **Money actions: cap before submit, fail closed, log spend at commit not success.**

---

## Kickoff prompt for the next session

```
Read docs/superpowers/handoffs/2026-08-09-facebook-and-video-handoff.md in full, then
docs/superpowers/specs/2026-08-09-video-pipeline.md. Between them they name every file you
need and several things already ruled out.

THE JOB, in order:

1. Facebook comments do not reach the Engagement Inbox. api/actionsExecute/executors/social/
   facebook.js already has fetchPostComments, and engagementInbox/index.js already reads a
   per-entry `platform`, `permalink` and `ourPostPermalink`. What is missing is the thing
   that writes them into engagementReplies. Host it in the socialEngagementPull cron rather
   than adding a heartbeat module — companyHeartbeat/index.js is off-limits. If that turns
   out not to fit, STOP and report rather than touching the pump.

2. Then Instagram. @ambientpixels2022 is a Business account linked to the Page and the same
   Meta app covers it, but the codebase has NOTHING: no task type, no adapter, no metrics.
   Before writing code, resolve the shape problem: Instagram cannot post text-only and the
   social pipeline is text-first. Propose how a post gets its image before you build the
   adapter.

DO NOT:
- Wire replyToComment to any automation. No fabrication guard exists on the reply lane.
- Touch companyHeartbeat/index.js, company-state/index.js beyond the SENSITIVE_KEYS list,
  staticwebapp.config.json, or data/company-actions.json.
- Sum Facebook engagement counts. They are lifetime cumulative. Difference them.
- Return 0 from a read that failed. Return null.
- Rotate credentials — the CEO declined. Do not re-litigate it, it is recorded.

RULES THAT EARNED THEIR PLACE:
- Probe the endpoint before believing a claim about it, including your own.
- Say WHICH nothing you mean. "Store never written" is not "no comments" is not "all answered".
- When adding a platform, grep the SKIP lists as well as the ALLOW lists.
- Update the prompt enum in the same commit as the handler, or the agent can never emit it.
- Render it and look at it before claiming a visual change works.
- Writes go through storage.mutateState, never a whole-array setState.

VERIFY WITH:
  for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
  curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=socialCredentials"   # MUST be 403

BEFORE ANYTHING ELSE: check whether the Aug 10 16:00 UTC scheduled Facebook post actually
published. Its action id starts act_1786248483667_fbsched_mechanism. If execution_status is
not 'success', that is the first thing to understand — the scheduler fix (78eccefe) shipped
only hours before it was due.

Commit and push as you go, with real reasoning in the messages.
```

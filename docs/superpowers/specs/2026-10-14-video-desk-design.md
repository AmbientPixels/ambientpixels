# Video Desk — the relay between the fleet and the video crew

**Status:** BUILT and live 2026-10-15. **§8 supersedes the ticket design in §2:** the Video department works through the company task board (Chad, 2026-10-15).
**Ask (Chad):** fleet agents can suggest videos as content for campaigns and goals, rarely (releases, updates,
bet decisions, not every post); the suggestions become data that improves the pipeline's video types, moods,
styles and designs; the video crew and the marketing/web team pass ideas both ways without Chad relaying them.
Approved idea #5 ("fleet lane for video briefs", overnight queue item J) is the seed; J was never started.

---

## 1. What exists today (verified 2026-10-14)

| Piece | Where | Relevant fact |
|---|---|---|
| Bet ledger | `api/companyHeartbeat/bet-schema.js`, `bet-ledger.js` | Bets live on `campaign_proposal` → `campaigns[].bet`; scored by code; verdicts become `auto:bet-verdict` memories; ledger at `runtimeMemory.outcomeDigest.betLedger`. 9 closed `MECHANISMS`, no video. **0 bets in prod** (no campaign proposed since the restart). |
| Campaign routing | `materialize.js:37` | `allowedTaskTypes`; no video type. |
| Memory stack | `api/memoryStack/index.js` | L1–L9. Closest model for a catalogue = `api/_data/product-facts.json` (per-agent allowlist block in `prompt-builders.js:1708-1753`). |
| Prompt ceiling | `agent-runner.js:504-536` | 30K tokens → degrade → skip. Scribe already near it. |
| Release signal | — | **None.** Only "RECENT ACTIVITY" (48h tasks/posts). `data/changelog.json` dead since April, `site-manifest.digest.json` stale since May. |
| `generate-video` action | `agent-runner.js:4927` | Veo 8 s character clips, Pixel only (dormant), missing from `KNOWN_ACTION_TYPES`. A different thing; leave it out of this. |
| Studio cloud | `api/studio/` + blob `studio` | Inbox of events (note/pick/answer/decision) + jobs; PC `harness/worker.mjs` syncs down and acks. **No brief/ticket event yet** — the natural extension point. |
| Studio local | `harness/`, `localhost:4310/studio/` | `tracker.json` per project (stages script→deliver, owners = chad + 8 roles, sessions never move to done). |
| Pipeline catalogue | `ai-video-pipeline` | Kinds: walkthrough/series/promo/other. Styles: ap-monolith, as-editorial, rr, kit, client. Moods: ambient/lofi/upbeat/cinematic/tense. Voices: narrator + 8 agents. Output 1920x1080/30 only (vertical = queue I, not built). |

Rules that already bind this design: each video wears its **subject's** brand; agents never appear to *make*
videos and never host product walkthroughs; claims only from product-facts, public pages, `/pulse/`;
prompt rules lose to objectives, so every limit below is **code**, not prompt text.

---

## 2. The shape — three pieces

```
 AmbientOS fleet (cloud)                     Studio cloud (blob)            Studio local (PC)
 ───────────────────────                     ──────────────────             ─────────────────
 L10 Video Catalogue ──► agent sees what
                         the crew can make
 trigger (release / bet) ─► suggest-video ──► ticket (inbox) ──sync──► Desk: accept / decline(reason)
                              (code gates)                                    │ accept
                                                                              ▼
 ticket status in prompt ◄──── status ◄──────── ticket.status ◄──sync── tracker tasks (STANDARD path)
 release → Echo/Scribe task ◄─ "released" ◄──────────────────────────── finisher + Chad releases
 crew asks fleet (claims check, launch posts, research) ◄── crew ticket ◄── Studio role
```

### 2a. L10 — Video Catalogue (memory layer)

`api/_data/video-catalog.json`, inside the function bundle, product-facts pattern. Generated from the pipeline
repo (one script, `ai-video-pipeline/tools/catalog/export.mjs`), never hand-edited in two places.

- `formats[]` — id, name, length range, aspect, best-for, status `available | planned`
  (walkthrough, teardown, inside-ambientos, whats-new, trailer, sizzle, help-series; vertical-short = planned).
- `styles[]` — id, which subjects wear it (ap-monolith → agents/AP/services; as-editorial → AmbientScore;
  rr → Resume Roast; tier-2 products → own brand, status planned until a kit exists).
- `moods[]` — the 5 presets with one-line feel; `voices[]` — narrator + agent voices (agents only in Inside AmbientOS).
- `rules[]` — the truth rules above, verbatim.
- `demand{}` — written back by the Desk (section 4), so agents see "walkthrough: 4 asked, 3 made".

Injected only for **nova, echo, scout** (the proposers who think in campaigns), capped ~800 chars, added to
`_sizeStats`. Scribe/Quill don't get it (ceiling). Explorer: add L10 to `VALID_LAYERS`.

### 2b. The ticket — `suggest-video`

New agent action. A ticket is not a script; it is a **why-now + what + proof** the crew can triage in 30 s.

```
id vt_*, createdAt, from (agent), campaignId?, objectiveId?, betKey?,
trigger   { type: release | bet_won | bet_scale | campaign_launch | crew_request, ref, evidence }
format    (catalogue id)          style  (derived from subject, not chosen)
mood      (catalogue id)          length (s)        audience (≤140)
goal      (≤200: what the viewer can do after)     hook (≤140)
mustSay[] (≤5)  mustNotSay[] (≤5)
claims[]  { claim, source }       — source must be product-facts key, public URL or /pulse/
wish      { format?, mood?, style?, note } — "what I'd want if the crew could make it" (free text)
status    proposed → accepted | declined(reason) → scripting → in_production → review → released | dropped
studio    { project, video, trackerIds[] }   release { url, at }
```

`wish` is the most valuable field for the pipeline: it records demand for things the catalogue does **not** yet
offer (a 9:16 cut, a calmer mood, a CardForge look), counted per value.

### 2c. "Once in a while" — code gates, not prompt text

`suggest-video` is accepted by the runner only when **all** hold (checked in `agent-runner.js`, like the bet gates):

1. **A trigger exists and is cited:** a release entry ≤14 days old, a bet that scored `won` or went
   `scaleEligible`, a newly approved campaign (≤7 days), or an open crew request addressed to the agent.
   No trigger ⇒ gate `video_no_trigger`.
2. **Rarity:** fleet max **2 open tickets** (proposed + accepted-not-released); **1 per agent per 21 days**;
   1 per trigger ref (no two tickets for the same release).
3. **Catalogue:** `format`/`mood` must be catalogue ids (`planned` allowed, it counts as demand);
   style is derived from the subject, never free.
4. **Claims:** ≥1 claim, every source resolves; product names must exist in product-facts.
5. **Truth lint:** no agent-as-maker phrasing ("I'll make/render/edit"), no agent host unless format = inside-ambientos.

Every rejection is a governance event with the gate name, so we can count how often agents *tried*.

### 2d. The relay (both directions)

**Fleet → crew.** Accepted proposals go straight into the Studio inbox as a new event type `ticket`
(`api/studio` route `tickets`, server-to-server with the worker-token style secret). Chad sees them on the
Studio **Desk** (local and hosted): **Accept** (one click — creates the video id + the STANDARD tracker tasks,
`by: chad`) or **Decline with a reason** (required). This is not Chad relaying; it is one decision where he
already works, and the decline reason is the fleet's training signal (same lesson as
`project_agent_autonomy_verdict`): it returns as an `auto:ceo-revision` memory carrying the ticket's format/mood.

**Crew → fleet.** A Studio role (Writer, Researcher, Finisher) files a crew ticket:
- `claims_check` → Quill task (review a script's SOURCES table against product-facts);
- `research` → Scout task;
- `launch_posts` → automatic when a video is **released**: Echo gets a task in the linked campaign
  (or the video's own mini campaign) with the URL, transcript and claims table as grounding.
Crew tickets become fleet tasks through the existing `create_task` path, so lanes/backpressure still apply.

**Status back.** The worker syncs tracker stage → `ticket.status`. Agents see a 3-line block
"YOUR VIDEO TICKETS" (status + decline reasons), only when they have one.

---

## 3. Release signal (missing, needed for trigger 1)

Nothing in AmbientOS knows "we shipped". Options, cheapest first:
- **A. `releaseLog`** — append-only list `{id, at, product, title, summary, url, kind: feature|fix|launch|video}`,
  written by a "Log a release" button on the Studio Desk / CEO dashboard and by Claude sessions after a ship
  (one `curl` in the handoff routine). Video releases append automatically.
- **B.** Same, plus Nova may *propose* entries from RECENT ACTIVITY (CEO approves).
- **C.** Derive from commit messages at deploy — needs the CI workflow (do-not-touch) — not recommended.

Recommend **A**. Also feeds the approved monthly "What's new" (idea #6) and Nova's product-facts upkeep.

### 3a. Automated — the Release Watcher (Chad 2026-10-14: "we need an automated way")

Not an LLM agent with goals (an agent shown "nothing shipped" will invent a release). A deterministic watcher
plus one cheap classifier call, writing facts the agents then read.

1. **What is live, not what was committed.** Every 6 h (offset from the heartbeat, e.g. 03/09/15/21 UTC) a new
   timer function `releaseWatchCron` reads the deployed sha from `https://ambientpixels.ai/data/version.json`
   (already written by the deploy workflow) and calls GitHub
   `GET /repos/AmbientPixels/ambientpixels/compare/{watermark}...{deployedSha}` — one call returns commits +
   changed files. The repo is public; no token needed (60 req/h), optional `GITHUB_TOKEN` setting for headroom.
2. **Path → product map** (code, in `api/_data/release-paths.json`): `ambientscore/` → AmbientScore,
   `cardforge/` → CardForge, `storyforge/`, `blindspot/`, `pixel-agents/` + `agent-forge/` → Pixel Agents,
   `ambientos/` + `pulse/` → AmbientOS (public); `studio/`, `api/companyHeartbeat/`, `modules/company/`,
   `docs/`, `scripts/`, `lab/` → internal. A commit touching only internal/doc paths is skipped.
3. **Group** the public commits per product per run → one candidate entry each.
4. **Classify** with Haiku (≈1 call per run, cents a month): `{title, summary (public wording), kind:
   feature|fix|launch|content, significance: minor|major, public: bool}`; it may only restate what the commit
   subjects say (no invented features — the classifier sees subjects + paths, nothing else). Fail-closed:
   classifier error ⇒ entry saved as `significance: minor, status: unreviewed`.
5. **Commit trailers override** — sessions can write `Release: major`, `Release: none` or `Release-Note: …` in a
   commit body; the watcher honours them before the classifier. (Cheap way for Claude sessions to steer it.)
6. **Write** `releaseLog` entries `{id rel_*, at, product, title, summary, kind, significance, shas[], source:
   auto|manual|video, status: unreviewed|confirmed|hidden}`; advance the watermark only after the write.
7. **Video releases** (private pipeline repo) append automatically when a ticket reaches `released`.

**Who sees it:** a `RECENT RELEASES (14d)` block for nova/echo/scout (≤6 lines). Only `major` or `launch`
entries are video triggers; `minor` ones roll into the monthly What's new. Nova gets a real signal for
product-facts upkeep ("a release names a feature product-facts doesn't list → propose the update").
Chad can confirm/hide/edit entries on the Studio Desk; a hidden entry stops being a trigger.

**Verification:** run the watcher against 2026-09-01…now — expected: Studio commits skipped as internal,
AmbientScore/heartbeat-free product commits grouped; count skipped vs kept and read every kept title.

---

## 4. Suggestions as pipeline data — the Video Demand Ledger

The worker (or a weekly cron) aggregates tickets into `ai-video-pipeline/projects/ambientpixels/docs/DEMAND.md`
and back into `catalog.demand`:

| Signal | Tells the pipeline |
|---|---|
| asked / accepted / declined per **format, mood, style** | what the fleet thinks the market needs vs what Chad agrees to |
| `wish` values counted | what to build next (e.g. 5 wishes for vertical ⇒ queue I moves up) |
| decline reasons, clustered | where the fleet misunderstands the crew |
| per released video: qualified uses attributed via `utm_content=vt_id` | which formats actually move the north star |

Monthly, the Studio Dashboard shows a "Demand" strip; Chad decides kit work from it. A won video ticket can
also feed the bet ledger: add mechanism `explainer_video` to `MECHANISMS` so a campaign can bet on a video
as its channel and get scored like any other bet.

---

## 5. Phases

| # | Phase | Touches | Risk |
|---|---|---|---|
| 0 | Catalogue export + `video-catalog.json` + L10 in explorer (read-only, no prompt yet) | pipeline repo, `api/_data`, `memoryStack` | none |
| 1 | Studio `ticket` event, Desk page (accept/decline), worker sync → tracker | `api/studio`, `studio/`, `harness/` | low |
| 2 | `releaseLog` + "Log a release" | studio API or new key | low (new key needs `company-state` VALID_KEYS — do-not-touch, needs your OK) |
| 3 | `suggest-video` action, gates, catalogue + ticket blocks in prompts | `agent-runner.js`, `prompt-builders.js`, `constants.js` | medium — changes every cycle for nova/echo/scout |
| 4 | Crew → fleet tickets, release → Echo launch task | `campaign-lifecycle.js`, studio | medium |
| 5 | Demand ledger + `explainer_video` mechanism | bet-schema, harness | low |

Each phase is verifiable alone: 0 by the explorer showing L10; 1 by a hand-filed ticket landing on the
local Board; 3 by a forced trigger producing exactly one ticket and a second attempt hitting `video_rarity`.
Telemetry: every gate → governance event; ticket transitions → `studio` event log; prompt cost via `_sizeStats`.

**Possible `index.js` touch:** staged agent results are applied in the heartbeat; if the ticket write cannot
live entirely in `agent-runner.js` (writing straight to the studio API), phase 3 needs one `index.js` edit.
To be confirmed by reading that section before building.

---

## 6. Decisions for Chad

**DECIDED 2026-10-14 — Chad: "agree with all, go with your recommended"** → Desk accept/decline with required
reason · release log A + automated Release Watcher (§3a) · Echo + Nova + Scout suggest · 2 open / 1 per agent
per 21 d / 1 per trigger · tickets in the Studio blob.

1. **Gate keeper:** you accept/decline tickets on the Desk (recommended, decline needs a reason) — or auto-accept
   into the tracker and you only judge the script?
2. **Release signal:** A (log button + sessions log ships) — recommended — or B?
3. **Who may suggest:** Echo + Nova + Scout (recommended); add Scribe later if the ceiling allows.
4. **Rarity numbers:** 2 open fleet-wide, 1 per agent per 21 days, 1 per trigger — ok?
5. **Store:** tickets in the Studio blob (no `company-state` change) — recommended — vs a new company-state key.

---

## 7. Build log (2026-10-15, all verified live)

| Phase | Shipped | Where |
|---|---|---|
| 0 Catalogue (L10) | `catalog/video-catalog.json` + `tools/catalog/export.mjs` (checks every id against the pipeline's registries; `--check` fails on a stale copy) → `api/_data/video-catalog.json`; Memory Stack Explorer shows L10 | pipeline `7887fd4`, AP `d3e57d49` |
| 2 Release Watcher | `releaseWatchCron` 03:20/09:20/15:20/21:20 UTC, `/api/release-watch` (GET, run/dryRun, add, status), `releaseLog` key; first run 2026-10-15 02:34Z set the watermark: 29 commits in 14 days, all internal, 0 releases | AP `5a2587af` |
| 1 Desk (cloud) | tickets in `studio` blob `desk/tickets/`; routes desk, desk-decide, desk-ticket, desk-releases, desk-release, desk-release-status, desk-release-url (key or PC token), desk-sync, desk-update (PC) | AP `42ba0e50` |
| 1 Desk (PC) | accepted ticket → video (slate + standard Board tasks) + `docs/briefs/<video>.md`; Board progress → ticket status; local server relays the Desk with the worker token | pipeline `5f2580d` |
| 1 Desk (UI) | Desk. in the studio nav: decide tickets, in production / closed, ask the fleet, releases, demand | AP `a3073f72` |
| 3 Fleet suggests | `suggest-video` action, gates in `companyHeartbeat/video-desk.js`, VIDEO DESK + RECENT RELEASES prompt blocks (empty unless a trigger or a ticket exists) — no `index.js` change | AP `6366afdf` |
| 4 Crew → fleet | crew asks become one task per cycle for Quill/Scout/Echo/Nova (`[video-desk:<id>]` marker), taken/done flow back; a released video's link files Echo's launch-posts ask + a `video` release entry | AP `b5cb29d4`, pipeline `bcf5cd4` |
| 5 Demand | `desk.demand()` on GET desk, § 05 Demand on the Desk, `DEMAND.md` written by the worker | AP `069babdb`, pipeline `5991b9f` |

**Deferred on purpose: the `explainer_video` bet mechanism.** A campaign whose mechanism is a video can't be
scored until a released video's link carries attribution (`utm_content=<ticket id>` → qualified uses), and no
campaign task type can produce a video, so a video bet today would only ever be killed for zero uses. Tickets
already carry `campaignId` and `betKey`, and launch posts run inside the ticket's campaign, so a video's effect
lands on the bet it serves. Revisit after the first released video has a measured link.

**Found, not fixed (out of scope):** `generate-video` (Veo character clips) is still missing from
`KNOWN_ACTION_TYPES`, so the normalizer drops it; Pixel is dormant anyway.

**To pick up the PC half:** restart the studio worker and local server (OPEN-STUDIO.cmd) so they load the new
harness code.

---

## 8. The Video department (2026-10-15, supersedes the ticket store)

Chad: "we don't need a separate video ticketing system — use the board and commenting system we already have", then
"look at the video team as a department in AmbientPixels", and chose **the Studio crew as the department, no new
agent** (the site's "Eight agents" stays true; no new LLM cost).

| Piece | How |
|---|---|
| The department | The Studio's eight roles on Chad's PC (Claude Code sessions); the Editor/director heads it. Its office is the Studio, its internal board is `tracker.json`. |
| Inbox | Assignee `studio` on the company task board (`NON_AGENT_ASSIGNEES`): takes tasks, never runs in the heartbeat, never falls back to Nova. |
| A request | `suggest-video` (same code gates as §2c) → a `video_request` task: readable brief + a fenced `video-request` JSON payload (`studio/desk.js requestTask/parseRequest`). |
| Chad's call | On the company board: in-progress = accepted; canceled + a comment = declined, and that comment is what the agent sees next. |
| The department speaks | `/api/studio desk-comment` (PC only; refused :00–:12 of heartbeat hours): "[studio:<stage> video=…]" progress, an automatic **@Quill** claims check on acceptance, the release with its link tagging **@Echo** (done = released). Sessions use `node harness/fleet.mjs <task> "@Scout …"`. |
| The fleet answers | An @mention wakes an idle agent (`shouldRunAgent`); the VIDEO DEPARTMENT block shows it the comment and asks for a `comment-task` reply. Agents may only comment on requests (move/update/execute/review blocked; requests hidden from task lists). |
| Kept | Catalogue (L10), Release Watcher, the code gates, demand ledger (now computed from requests), DEMAND.md. Studio page "Video." = the department's dashboard. |
| Removed | The `desk/tickets` blob store, crew tickets, the Nova courier, desk-decide/ticket/release/release-url/update routes, both manual forms. |

Commits: AP `7f65e07f`, pipeline `215fad8` (plus the form removal `bef4a59e`).

---

## 9. The department joins the fleet (2026-10-15)

Chad: the Studio's Desk page had no use, and the Video department belongs with the regular fleet.

- **HQ Fleet page** (`modules/company/fleet.html`): a VIDEO DEPARTMENT section beside the agents (`js/fleet-video.js`,
  `css/fleet-video.css`) — the crew (from the catalogue's `crew`, exported from `harness/team/roles.json`; the Editor
  and director heads it), requests with stage + latest comment (links to the board task), what shipped (Hide a wrong
  entry via `/api/release-watch?action=status`), demand. Data: `GET /api/video-department` (company secret, read-only).
- **Task board**: assignee `studio` renders as "Video department" (`DEPARTMENT_ASSIGNEES` in tasks.html).
- **Studio**: the Video page is gone; `/api/studio` keeps only the PC's `desk`, `desk-sync`, `desk-comment`.

Commits: AP `a7eda9c0`, pipeline `98a68c0` (crew export) + `8cd9353`.

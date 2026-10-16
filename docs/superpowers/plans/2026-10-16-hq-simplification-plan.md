# HQ simplification plan: one calm dashboard, a small UI kit, and numbers you can trust

**Date:** 2026-10-16 · **Owner:** Chad · **Builds on:** `docs/superpowers/specs/2026-10-16-hq-evaluation-and-plan.md`
(the evaluation — read its §2 for the evidence behind every item here).
**Chad's ask:** "Simplify the visual UI system, it's gotten way too overblown. I'm overwhelmed. I want a simple, easy to
read dashboard to see what's going on with the system… and incorporate all your suggested changes from the audit."

**Decisions taken (Chad 2026-10-16: "incorporate all your suggested changes"):**
1. Order: stop the bleeding → a calm **Today** page first (Chad wants to see what's going on) → one Inbox → trusted
   writes → fewer decisions → the rest of HQ → retire.
2. The heartbeat (`api/companyHeartbeat/index.js`, normally do-not-touch) may be changed **only** for version-checked
   saves (phase 3.4). Nothing else in that file.
3. Inside an approved campaign, the fleet publishes posts and link-shares **without per-post approval**, with a weekly
   sampled audit. Still per-item to Chad: replies to named people, anything that spends money, first-person claims,
   blog articles.
4. One daily digest on Discord at **14:00 UTC (7:00 am Pacific)** — a default; change any time in systemConfig.
5. Retire pages one by one **as their replacement ships**, from the list in phase 6.

Everything below is ordered so each phase ships alone and leaves HQ working.

---

## 0. What "simple" means here (the bar every phase is judged against)

- **One screen answers "what's going on?"** in under 30 seconds, without scrolling on a laptop.
- **Every number is honest:** one definition, computed by the server, with "as of" and the denominator.
- **Looking never changes anything.** Reading a page writes nothing.
- **Five places, not fifty-two:** Today · Inbox · Plan · Team · Results. Everything technical lives behind one
  **Workshop** link.
- **One visual kit:** ~8 components, the AmbientOS v1.1 tokens, no inline styles, no page-specific look.
- **Calm by default:** green unless something is actually wrong; at most 3 warnings visible; nothing blinks.

---

## 1. The visual system: from overblown to a small kit

### 1a. What's there now (measured)
- 22,400 lines of CSS for HQ: `css/components.css` 4,776 · `modules/company/css/dashboard.css` 2,678 ·
  `company.css` 1,847 · `css/ap-components.css` 1,699 · `css/ap-skin.css` 1,469 · `analytics-hub.css` 1,280 ·
  `config.css` 1,230 · `tasks.css` 1,015 · 15 more.
- Pages also carry **~1,500 inline `style=` attributes** (dashboard 538, actions 327, governance 99, meetings 72,
  standup 64, cost-overview 64, tasks 60…), against the house rule "no inline styles, ever".
- Two token systems side by side (`--c-*` in `company.css` = AmbientOS v1.1; `--ap-*` in `css/ap-tokens.css` = the
  public site's Monolith) and two component families (`.sys-section`/`.fl-*`/`.dash-*` page-local styles vs the newer
  `ap-kpi`/`ap-state` primitives in `company.css:1620+`, used well only by cockpit, agents, agent-performance).
- Three UI modes (executive / operator / admin) that hide nav items and page parts — so the same page looks different
  depending on a localStorage flag.

### 1b. The kit (HQ Kit v2 — built on what already works)
**Tokens:** keep AmbientOS v1.1 (`--c-*` in `company.css`). The HQ never uses `--ap-*` site tokens. Color is for
**status only**: green ok, amber needs attention, red broken, blue in progress; everything else is text greys.
**Type:** four sizes only — page title, section title, body, small/label (map to existing `--c-text-*` sizes).
**Spacing:** the existing `--c-pad`/`--c-gap` pair; no other values.

**Eight components** (new file `modules/company/css/hq-kit.css`, ≤ 300 lines; reuse/move the existing
`ap-kpi`/`ap-state`/panel rules from `company.css` rather than rewriting them — search before creating):

| # | Component | Class | What it is |
|---|---|---|---|
| 1 | Page header | `.hq-head` | Title, one plain sentence of purpose, "as of 06:00 UTC" |
| 2 | Stat | `.ap-kpi` (existing) | One number, its label, its denominator or target ("3 of 10"), an optional delta |
| 3 | Status chip | `.ap-state` (existing) | ok / attention / broken / in progress / frozen |
| 4 | Row | `.hq-row` | Title, one meta line, a chip, at most one action; whole row is the link |
| 5 | Section | `.hq-section` | Section title + up to 7 rows + "See all (N) →" |
| 6 | Empty state | `.hq-empty` | Says what's normal ("Nothing waiting. The fleet runs at 00/06/12/18 UTC.") |
| 7 | Button | `.hq-btn`, `--primary`, `--quiet` | Two weights only |
| 8 | Health line | `.hq-health` | One line: green "All systems normal", or the one thing that isn't |

A living reference page replaces `components.html`: `modules/company/workshop/kit.html` showing each component in every
state (empty, normal, attention, broken, loading), used for screenshot checks.

**Rules (written into the `ambientos-design` skill when phase 1 ships):**
- No inline styles, no `<style>` blocks in pages, no `el.style.*` in JS — classes only.
- A page loads exactly: `company.css`, `sidebar.css`, `hq-kit.css`, and at most one page stylesheet ≤ 150 lines.
  New pages never load `components.css`, `dashboard.css`, `ap-components.css` or `ap-skin.css`.
- Max 7 rows per section, max 4 stats per row of stats, max 4 sections above the fold.
- No tabs inside tabs, no hidden "views", no UI modes. Things that aren't for daily use go to Workshop.
- Every number names its window and its source ("qualified uses, last 7 days"); a missing number says
  "not measured", never 0.
- Icons: none in rows; one per nav item.

### 1c. Navigation (replaces `sidebar.js`'s 5 categories × 40 links × 3 modes)
Rail with six items, no sub-bar:

| Item | Page | Replaces (merged, not deleted until phase 6) |
|---|---|---|
| **Today** (landing) | `modules/company/today.html` | index (marketing hero), dashboard CEO view, cockpit, office (Vale brief), morning brief tab |
| **Inbox** (with count badge) | `inbox.html` | actions approvals, goals.html (products), allocation, fleet proposals, meetings decisions, content-hub approvals, engagement drafts, dashboard daily-log drafts |
| **Plan** | `plan.html` | objectives, campaigns, directives, calendar (as a view), tasks (as the drill-down) |
| **Team** | `team.html` | agents, fleet, agent-performance, agent-intelligence, agent-progress, awareness, memories (read), the Video/Design section |
| **Results** | `results.html` | attribution, bet ledger, cost-overview, allocation ROI, analytics hub, revenue |
| **Workshop** | `workshop/index.html` | a plain list of every technical tool page (heartbeat, memory stack, governance report, action audit, config, workspace, trends, image engine, gallery, Bluesky discovery, promo codes, emergence, world state, kit) |

The UI-mode cycle is removed; the theme toggle stays (tokens already cover it). Wiki stays in the rail footer.

---

## 2. Today: the one dashboard

### 2a. What it shows (top to bottom, one laptop screen)

```
 Today                                              as of 12:00 UTC · next fleet run 18:00
 ─────────────────────────────────────────────────────────────────────────────────────────
 [ All systems normal ]                                   ← health line (one line, green)

 WAITING ON YOU  2                 THE GOAL                        THIS WEEK
 Publish: "How to build…"  1d      Qualified uses                  Posts published   3
 Campaign: AgentForge…     3h      3 of 10  ▓▓▓░░░░░░░             Tasks done       11
 Open inbox →                      target 10/wk by Dec 3           Spend          $4.20
                                                                   (of $X budget)
 CAMPAIGNS                                        WHAT HAPPENED SINCE YOUR LAST VISIT
 Monthly Journal          on pace   1/1 this mo   ✓ Blog post approved → 8 promo tasks
 Weekly Scoreboard        behind    0/2 this wk   ✓ Scribe made 2 hero images
                                                  • Nova proposed a campaign
 THE FLEET                                        • 1 reply expired (3-day limit)
 Scribe   16 queued · ~0.9/day · busy to Nov 9    See full activity →
 Echo      5 queued · ~0.7/day
 Nova, Quill on call · Pixel, Cipher dormant
```

Five blocks, each answering one question:
1. **Health line** — green unless something is actually wrong: heartbeat missed its 6 h slot (+30 min grace),
   write failures, a routing gap, a stalled lane with work waiting. Thresholds come from the real schedule.
2. **Waiting on you** — real count from the Inbox endpoint, the 3 oldest, one link.
3. **The goal** — `qualified_uses_week` vs target with denominator and date; "not measured" if null.
4. **Campaigns** — each active campaign: on pace / behind / ahead, done vs planned this period.
5. **The fleet** — who's carrying work, queue and real pace, who's dormant; **What happened** — the 5 most important
   events since the last visit (stored per viewer server-side, not in localStorage).

### 2b. How it's built (so it can't lie)
- **`GET /api/hq-summary`** (new function `api/hq-summary/`, company secret, read-only): computes all five blocks on the
  server from `tasks`, `campaigns`, `objectives`, `approvalQueue`, `heartbeatRuns`, `governanceLog`, `releaseLog`,
  `agentRegistry`, cost logs — using the shared definitions (`api/_shared/taskStatus.js` and new
  `api/_shared/metrics.js`: active task, overdue, pending decision, campaign pace, agent pace, spend). Returns
  `{ asOf, blocks: {...} }`, each block with its own `asOf` and `source`.
- **`modules/company/today.html` + `js/today.js`** render that JSON with the kit. No `AgentEngine`, no `CompanyStore`,
  no writes, no `company-state` reads from the page.
- Refresh: on load and every 2 minutes while visible.
- Telemetry: `hq_today_view` (load time, blocks rendered, errors) via the existing `app-insights.js`.

---

## 3. The plan in phases

Each task lists files, the check that proves it, and how to roll back. Tests: `api` → run every `*.test.js` +
`node companyHeartbeat/smoke-test.js`; UI → Playwright with `channel:'msedge'` screenshots at 1440 and 390, zero
console errors, no horizontal overflow, before/after attached in the commit message.

### Phase 0 — Stop the bleeding (1 session)
| # | Task | Files | Check | Rollback |
|---|---|---|---|---|
| 0.1 | Pages stop writing on load: remove `reconcileProposals()`, `reconcileApprovalQueue()`, `reconcileArtifacts()` and `_normalizeTaskNumbers` writes from page renders; anything still needed becomes a server job later (0.1 just stops the browser doing it) | `js/agent-engine.js:2090-2107, 3151-3365`; `dashboard.html:1256-1259`; `actions.html:692-696` | Load dashboard/actions with the network tab open: zero POSTs on load; directive with `pending-approval` stays pending | revert the commit |
| 0.2 | No write before the first sync: `setState/setStateSync` refuse (and say so) until `syncFromServer` has completed for that key | `js/company-store.js` | Unit test with a stubbed fetch; manual: throttle network, try a drag on Tasks → refused message | revert |
| 0.3 | A failed read is never empty: `company-state` GET returns 503 on a storage error (not `{value:null}`); the browser keeps its cache and shows "couldn't refresh" | `api/company-state/index.js` (do-not-touch file — **this edit is part of Chad's 10-16 approval of the audit fixes; keep it to the read-error branch only**), `js/company-store.js:315-319` | Test with a storage stub throwing → 503; browser keeps data | revert |
| 0.4 | Saves report the truth: `setState` counts failures like `setStateSync`; "Run Heartbeat" shows the real HTTP result | `js/company-store.js:261-263`; `dashboard.html:1160-1171` | Force a 403 → visible error | revert |

### Phase 1 — Today + the kit (2 sessions)
| # | Task | Files | Check |
|---|---|---|---|
| 1.1 | Shared metric definitions (server + browser twins) | `api/_shared/metrics.js` (+ test), extend `api/_shared/taskStatus.js` | Tests pin each definition to tonight's live numbers |
| 1.2 | `GET /api/hq-summary` | `api/hq-summary/{function.json,index.js,index.test.js}` | Returns 5 blocks with `asOf`; 403 without secret; numbers match a hand count on the live board |
| 1.3 | HQ Kit v2 | `modules/company/css/hq-kit.css`; move `ap-kpi`/`ap-state` rules out of `company.css`; `workshop/kit.html` | Kit page screenshots in every state; zero inline styles |
| 1.4 | Today page | `modules/company/today.html`, `js/today.js`, ≤150-line page CSS if needed | Playwright: fits one 1440×900 screen; reads correctly with empty, normal and broken data (mocked) |
| 1.5 | New rail (6 items) + land on Today; UI modes removed; old pages still reachable from Workshop | `modules/company/js/sidebar.js`, `index.html` → redirect to today | Every old page reachable in ≤2 clicks; no 404s (link crawl) |
| 1.6 | Update the `ambientos-design` skill with the kit and rules | `.claude/skills/ambientos-design/SKILL.md` | — |

### Phase 2 — One Inbox (2 sessions)
| # | Task | Files | Check |
|---|---|---|---|
| 2.1 | `GET /api/ceo-inbox`: every pending decision normalized `{id, type, title, why, from, since, expiresAt, actions[]}` from approvalQueue, video requests, fleet/product/budget proposals, engagement drafts, daily-log drafts | `api/ceo-inbox/` | Count equals the sum of the old pages' pending items minus phantoms; unit tests per type |
| 2.2 | `POST /api/ceo-decide`: routes approve / decline-with-reason / revise / defer to the existing handlers (proposalDecide, approveProposal, actions/execute, tasksPatch, engagement draft) | `api/ceo-decide/` | Each type decided end-to-end in a test against stubs; decline requires a reason |
| 2.3 | Remove phantoms: stop creating untyped "task approval" escalations; render or stop creating campaign/objective cancellation proposals (decide in the Inbox); drop `generate.video` and Cipher-tier budget items from counts | `api/companyHeartbeat/task-mutations.js`, `agent-runner.js` (cancellation creators), `approvalQueue` writers | No pending item without a decide path (test) |
| 2.4 | Expiry for every type (posts/briefs 7 d, proposals 14 d, replies 3 d as today) with an "expired" record agents see; the 100-cap never drops pending items | queue writers; one `api/_shared/expiry.js` | Tests; an expired item shows in its agent's next prompt |
| 2.5 | `inbox.html`: one list, filters by type, decide in place (approve / decline with reason / revise / later); nav badge with the real count | `modules/company/inbox.html`, `js/inbox.js`, `sidebar.js` badge | Playwright: decide one of each type on mocked data; badge matches |
| 2.6 | Daily digest (Discord, 14:00 UTC; `systemConfig.digest.{enabledAt,hourUtc}`): N waiting, oldest, goal number, health; replaces the per-item ping except urgent types | `api/ceoDigestCron/`, `_utils/approvalAlerts.js` | Dry-run endpoint prints the message; cron schedule test |

### Phase 3 — Trusted writes (2 sessions)
| # | Task | Files | Check |
|---|---|---|---|
| 3.1 | `tasksPatch` uses `mutateState` (version-checked) | `api/tasksPatch/index.js` | Concurrent-patch test: both survive |
| 3.2 | `campaignsPatch`, `objectivesPatch` (same shape) | new functions | tests |
| 3.3 | Browser edits go through the patch endpoints; `AgentEngine` whole-array writes removed for tasks/campaigns/objectives/queue/actions | `js/agent-engine.js`, `tasks.html`, `campaigns.html`, `objectives.html` (until they're replaced) | Network tab: an edit sends one item; a stale tab can't revert newer data (test with two tabs) |
| 3.4 | Heartbeat saves tasks/campaigns/objectives with a version check and re-applies only its own changes on conflict (approved exception to do-not-touch; touch only the persist points `index.js:208, 1325, 4123-4125, 4181` and the `|| []` read at `:146`) | `api/companyHeartbeat/index.js` | Test harness: CEO edit during a simulated run survives; full heartbeat suite + smoke green; one manual trigger watched end to end |
| 3.5 | One API-base + secret helper everywhere (`CompanyStore.getServerBase()`); delete the `'pixelpusher'` fallbacks | ~28 files | grep finds no old pattern; writes work on the SWA host |

### Phase 4 — Fewer decisions (2 sessions)
| # | Task | Files | Check |
|---|---|---|---|
| 4.1 | **Every work task belongs to a campaign** (decided with Chad 10-16, see "Campaigns hold all work" below). Content tasks require an active campaign that allows the type (agent create-task, pipelines inherit the parent's campaign; blocked attempts tell the agent to propose a campaign). **Video is a campaign type like Blog** (`video_request`, routed to the Video department): add it to `_validTaskTypes` + agent/label maps, materialize `VALID_TASK_TYPES`, and a "Video" checkbox on the campaigns page (screenshot to Chad first). Only exception: tasks assigned to Chad himself. | `agent-runner.js` create-task guard, `campaign-lifecycle.js`, `proposalDecide/materialize.js`, `publishDocument.js` (promotion), hero creation, `campaigns.html` | Test: Scribe can't create a blog task outside a campaign; promotion inherits; a campaign allowing Blog + Video creates both |
| 4.2 | Bluesky replies and engagement replies become capped campaigns Chad approves (cap e.g. 3/week) | `bluesky-participation.js`, `engagement-reply.js`, a campaign seed proposal | Lane stops when the campaign is paused or capped |
| 4.3 | Publish inside approved campaigns without per-post approval (decision 3 boundary), with a weekly 5-post sample in the Inbox; kill switch in systemConfig | `_utils/graceWindow.js` / actions scheduler, campaign flag `autoPublish` | Test matrix by item type; kill switch stops it |
| 4.4 | Campaign approval carries volume **per type** ("1 blog post + 1 video a month", "3 X posts a week") instead of one `frequency` for the whole campaign, shown in the Inbox card; pace (metrics.js `campaignPace`) and auto-replenish count per type | `proposalDecide`, materialize, `campaign-lifecycle.js` replenish, `api/_shared/metrics.js` | Test: a Blog + Video campaign is on pace only when both are |
| 4.5 | Spread load off Scribe: Quill does copy editing for real; Echo holds design (routing.js already); reply lane capped | routing / prompts | Scribe's queue days drops (Today shows it) |
| 4.6 | One-time board clean (approved 10-16): cancel Scribe's 6 self-made blog drafts + 3 hero images; link the live post's promotion to a campaign | data script with backup | Today shows only campaign work |

**Campaigns hold all work (Chad, 2026-10-16).** The board on 10-16 had 22 open tasks and only 2 in a campaign: 6 blog
drafts Scribe gave itself (two the same post; one already published), 6 Bluesky reply drafts from the reply lane, 6
promotion tasks for the published post (publishing makes them with no campaign), 2 video requests. The model is
goal → campaign → task, so nothing may hang off a goal directly. Decisions:
- A video is a campaign type, like a blog post. A campaign can mix types (e.g. Monthly Journal = 1 post + 1 video a
  month), each with its own volume (4.4). No standing "Video" campaign; every video serves a campaign.
- Current videos: #1275 *Inside AmbientOS ep 01* → Monthly Journal (pairs with its "the company gets a video team"
  post) once that campaign allows Video. #1274 *AmbientScore walkthrough* → an AmbientScore campaign (to be proposed),
  or it waits. Chad picks.
- A campaign-made video request needs the request details (product, format, seconds, audience). Filling them from the
  campaign belongs to the video pipeline (`api/studio/desk.js`, Actions Video panel) — handoff
  `handoffs/2026-10-16-video-as-campaign-type.md`.

### Phase 5 — Plan, Team, Results (3 sessions)
- **Plan** (`plan.html`): goal → its campaigns (pace, volume, bet) → open work per campaign; calendar as a toggle;
  "all tasks" as the drill-down (the old Tasks board stays reachable from Workshop until replaced). Uses patch endpoints.
- **Team** (`team.html`): one roster from `agentRegistry` + routing (who holds which role, queue, pace, dormant), the
  Design department with its Video division (per `handoffs/2026-10-15-video-team-into-design.md`), agent memory read view.
- **Results** (`results.html`): the goal over time, bets won/lost/killed (bet ledger), people per campaign, cost per
  result, spend by provider (fix Claude-logged-as-Gemini first: `companyHeartbeat/gemini.js:111-118`).
- Each page: kit only, server endpoint per page (`/api/hq-plan`, `/api/hq-team`, `/api/hq-results`), screenshots.

### Phase 6 — Retire and tidy (1 session, then ongoing)
Retire each as its replacement ships (redirect to the new place, then delete after one week):
- **Now (no replacement needed):** redirect stubs (board, ops-overview, plan-overview, work-overview), directives.html
  legacy code, seasons.html, revenue.html (fold the true $0 into Results), the Milestone Herald panel on campaigns,
  experiment panels (agent-performance, agent-intelligence, attribution, allocation, world-state), meetings "auto-run"
  toggle (cron off), "Accuracy = CEO approval rate" tiles, emergence (or label frozen in Workshop), components.html
  (→ workshop/kit.html), inbox-demo.html (→ lab/), index.html marketing hero.
- **With Today:** dashboard.html (all three views), cockpit.html, office.html (Vale brief becomes a Today block).
- **With Inbox:** actions.html approvals tab, goals.html, allocation decisions, fleet proposals, meetings decisions,
  content-hub approvals, engagement approvals (engagement thread view stays in Workshop).
- **With Plan / Team / Results:** objectives, campaigns, calendar, tasks; agents, fleet, agent-performance,
  agent-intelligence, agent-progress, awareness; attribution, cost-overview, analytics-hub, allocation.
- Delete CSS that only retired pages used (`dashboard.css`, large parts of `components.css` for HQ) once no page links it.

**Size:** ~13 sessions total; the visible change (Today + kit + new rail) lands in the first 3.

---

## 4. How we'll know it worked
- Chad can answer "what's going on?" from Today in under 30 seconds (ask him after phase 1).
- Pending decisions live in one place: the Inbox count equals the badge equals the digest equals Today.
- A week of logs shows zero browser POSTs on page load and zero lost updates (version conflicts are retried, logged).
- HQ pages in daily use: 5 (+ Workshop). CSS loaded by a daily page: ≤ 4 files. Inline styles on new pages: 0.
- Scribe's queue in days falls below 7 and stays there.

## 5. Risks and guards
- **Do-not-touch files** (`company-state/index.js` for 0.3, `companyHeartbeat/index.js` for 3.4) are touched only in the
  named lines, each in its own commit with its own test, and watched through one live heartbeat.
- **Another Claude session may be editing the same tree** (seen 10-15/16: video-desk, task-mutations, studio). Stage by
  path, re-diff the index before each commit.
- **Heartbeat write window:** no prod data writes 00/06/12/18 UTC :00–:12.
- **Nothing is deleted before its replacement has shipped and been used for a week.**

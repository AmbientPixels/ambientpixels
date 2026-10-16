# HQ evaluation and plan: make the company runnable by one person

**Date:** 2026-10-16 · **Asked by:** Chad ("way too complicated… overwhelming, not intuitive… quite a mess… need a full
evaluation") · **Status:** evaluation done, plan for discussion — nothing in §5 is built yet.
**Method:** three read-only audits of the live code (every HQ page; how data reaches and leaves each screen; every
place Chad is asked to decide and how the company loop runs) plus tonight's board/routing work. Evidence is file:line
in the audit notes; the essentials are quoted here.

---

## 1. The verdict

HQ grew one fix at a time. Every problem got its own page, panel, counter or approval type, and nothing was ever
retired. The result is not a dashboard problem, it is three problems stacked:

1. **The numbers can't be trusted.** Screens compute the same thing in different ways, show old data as if it were
   current, and — worse — *write* to the company while you only look at them.
2. **Your job is scattered.** About **34 kinds of decision** live on **11 different pages**, and 5 of them can't be
   decided anywhere. Six summary screens count "what's waiting" six different ways.
3. **The machine produces more than it should.** Work is created outside campaigns, one agent (Scribe) carries almost
   everything, and every low-stakes item still needs your click, so approving a campaign doesn't actually control
   your workload.

Fixing the look of the dashboards first would be wasted effort: a clean screen over wrong numbers is still wrong.
The order has to be **trust → one inbox → fewer decisions → a simpler HQ**.

---

## 2. What the audits found

### 2a. Trust: the screens don't match reality (and can change it)

| # | Problem | Evidence | Effect |
|---|---|---|---|
| T1 | **Opening the dashboard makes decisions for you.** Every render runs `reconcileProposals()`: pending standup/meeting tasks → todo, pending directives → active "approved by ceo". It also runs queue and artifact "reconcilers" that edit the approval queue and mark actions failed/succeeded from the browser's copy. | `js/agent-engine.js:3151-3199`, `:3203-3365`; called from `dashboard.html:1256-1259` and `actions.html:692-696` | Looking ≠ deciding is broken. Items can appear approved or vanish. |
| T2 | **The browser saves whole lists over the server.** Every task/campaign/goal/queue edit POSTs the *entire* array from the page's copy, which can be up to 60 s old or trimmed to 80 tasks before the first sync. No version check. Even reading tasks triggers a full write when a task lacks a `taskNumber` (none get one server-side). | `js/company-store.js:219-286`, `:162-167`; `agent-engine.js:2090-2107`; tasks ≈ 0.42 MB, so these writes succeed | A stale tab can quietly undo agent work or your own changes. |
| T3 | **A failed read can look like "empty" and get saved.** A storage read error returns `null`; the browser treats it as no data and the next save writes `[]` + one item. The heartbeat does the same (`|| []`). | `api/_utils/companyStorage.js:71-74`; `company-store.js:315-319`; `companyHeartbeat/index.js:146` | Rare, catastrophic (whole board lost). |
| T4 | **Saves fail silently.** Campaign/goal saves swallow errors; pages show "saved" before the server answers; "Run Heartbeat" says "Done!" even on 401. | `company-store.js:261-263`; `actions.html:3140-3162`; `dashboard.html:1160-1171` | "It's not syncing" — the change never landed. |
| T5 | **Same number, many definitions.** Overdue (fixed tonight, `bc0e02b2`: dashboard showed 27, all canceled), active tasks (4 definitions), approvals pending (5), costs (Claude spend logged as Gemini), agent status (4 sources). | audit 2, §6 | Every screen disagrees a little; none can be believed. |
| T6 | **Old data shown as current.** The heartbeat runs every 6 h but the dashboard calls anything over 90 min "stale — timer may have stopped" (red ~75% of the time). Backlog numbers have no timestamp. Emergence is frozen since 08-04; weekly report, meetings, reflections, memory consolidation crons are off but their pages still look live. | `dashboard.html:1405,2093,3329`; audit 2 §7 | You learn to ignore the warning lights. |
| T7 | ~28 files still build the API address the old way (writes 405 on the SWA host); 63 places fall back to a stale hardcoded secret. | audit 2 §8 | Some buttons silently do nothing on some hosts. |

### 2b. Your job: decisions are scattered

- **~34 decision types on 11 pages.** The approval queue alone holds ~26 types (posts, blog publishes, revisions, replies,
  research briefs, campaign/goal/product/agent proposals, budget requests, escalations…). Others live on the task board
  (video requests), Fleet (agent proposals, admin-only), Goals-the-second (product proposals), Allocation (budgets),
  Meetings, Content Hub, Engagement, Bluesky Discovery, the dashboard (daily-log drafts) and agent chat.
- **5 types can't be decided anywhere** yet still count as "waiting": campaign/objective *cancellation* proposals,
  untyped "task approval" escalations, `generate.video` (dead path), Cipher-tier budget requests (Cipher is dormant).
- **Every summary sends you to Actions**, which can't decide product, fleet, budget, meeting or cancellation items.
- **Nothing expires except replies (3 d), generator proposals (7 d) and convergence (48 h)**; the queue silently drops
  its oldest entries at 100 — including undecided ones.
- **Notifications:** no email; no approval badge in the nav; Discord pings once per *new* item and never reminds;
  Vale's brief probably never reaches Discord (no webhook set) and its page (Office) isn't in the nav.
- **You approve the same thing twice**: some items need Approve then Execute; your own manual replies and your own
  fleet proposals come back to you for approval.

### 2c. The machine: work doesn't line up with campaigns

- Tonight's board: **2 of 25 open tasks belonged to an active campaign.** The rest came from Scribe creating its own
  blog work, pipelines (hero images, blog promotion ×5 platforms), the Bluesky reply lane, trend briefs, revisions.
  The rule "tasks need a campaign" is enforced only as "tasks need a goal".
- **Scribe carries blog, social copy, every reply lane, revisions and promo copy** at ~0.9 tasks/day with a degraded
  prompt; its queue runs to 11-09. Scout, Vale, Forge mostly sit idle; Pixel and Cipher are dormant.
- **The 10-06 decision "agents publish inside approved campaigns; you approve campaigns, not posts" was never built**
  (grace auto-publish is off), so every post, reply, promo and brief is still a separate click.

### 2d. The HQ itself

- **52 pages, ~33,000 lines; 40 nav links in 5 categories** (+ 3 UI modes that hide some of them). Dashboard alone is
  5,822 lines with ~30 panels in 3 views; Actions 3,278 lines with 14 sections.
- **The same question is answered in many places:** "what needs me?" ~12, "how are agents doing?" ~14 (agents.html
  was built in July to replace 7 pages; none were retired), costs 8, system health 7, tasks 6, memory 6, experiments 6.
- **Confusing names:** two pages called "Goals" (quarterly goals vs product launch/retire proposals); Goals /
  Objectives / Campaigns / Projects / Directives for overlapping ideas; "Governance" next to "Playbook".
- **Dead or misleading:** Seasons ("revenue-first", 4th item in your first menu), Revenue (only refunded test buys),
  Herald panel (off), experiment panels (evaluator deleted), Emergence (frozen 08-04), meetings auto-run (cron off),
  "Accuracy = CEO approval rate" (measures your absence), redirect stubs, Resume Roast filters.
- **You land on a marketing page** (index.html: hero, org chart, proof cards). Cockpit — built to answer "what needs a
  decision right now" — is not the landing page.

---

## 3. Principles for the fix

1. **Looking never changes anything.** Pages read. All writes are explicit, per item, done by the server, and checked.
2. **One number, one definition, one source,** computed by the server with an "as of" time, shown the same everywhere.
3. **One inbox.** Everything that needs Chad is in one list, decidable in place, with a reason and an expiry. If it
   can't be decided, it isn't in the list.
4. **Decide the few big things, not the many small ones.** Chad approves goals, campaigns (with their volume) and
   anything that speaks for a named person or spends money; inside an approved campaign, the fleet works.
5. **All work belongs to a campaign.** Approving a campaign is how Chad controls volume.
6. **HQ is shaped by Chad's questions,** not by the system's internals. Internals move to a separate workshop.

---

## 4. Target shape (what it should feel like)

**Five places, one question each:**

| Place | The question | Built from (keep / merge) |
|---|---|---|
| **Today** (landing) | What needs me, what changed, is anything broken? | Cockpit (evolved) + dashboard alerts + Vale brief + morning report |
| **Inbox** | Decide things | One list over *all* decision types (today: Actions + 10 other pages) |
| **Plan** | Goals → campaigns → work, and is it on pace? | objectives + campaigns + tasks (one drill-down, not three pages) + calendar as a view |
| **Team** | Who's working on what, who's stuck, and the departments (incl. Video in Design) | agents.html + fleet + the Video section; one roster |
| **Results** | Is it working? People reached, bets won/lost, cost per result | attribution + bet ledger + cost-overview + analytics hub |

Everything else (heartbeat, memory stack, governance report, action audit, config, workspace, promo codes, image
engine, gallery, Bluesky discovery, trends, components, demos) moves under one **Workshop** link — still there, out of
the way. Dead pages are removed (list in §5, phase 4).

**Today page, concretely:** ① "Waiting on you: N" with the 3 oldest and one click into Inbox; ② the one goal and its
number vs target ("qualified uses this week: x of 10, as of 06:00"); ③ campaigns on/behind pace; ④ what shipped and
what the fleet did since your last visit (5 lines); ⑤ one health line that is green unless something is actually
wrong (thresholds from the real 6 h schedule).

---

## 5. The plan

### Phase 0 — Trust (do first; the root of "the dashboards aren't syncing")
1. **Pages stop writing on load.** Remove the browser reconcilers (proposal auto-activation, queue/artifact
   reconciliation, task numbering) from page renders. Anything still needed moves server-side.
2. **Per-item writes only.** Task/campaign/goal/queue edits go through small server endpoints that change one item
   with a version check (tasksPatch generalized, using `mutateState`). The whole-array POSTs from the browser go away.
   Until then: no write before the first sync completes.
3. **A failed read is never empty.** Storage reads that fail return an error, not `null`; nothing saves after a
   failed read (browser and heartbeat).
4. **Saves report the truth.** Every button waits for the server; failures show and roll back.
5. **The heartbeat stops overwriting concurrent edits** — it applies its own changes with a version check instead of
   saving its 6-minute-old copy. *(Needs Chad's OK: `companyHeartbeat/index.js` is on the do-not-touch list.)*
6. **One API address + secret helper** everywhere (`CompanyStore.getServerBase()`); remove the stale fallback.

### Phase 1 — One inbox
1. **`/ceo-inbox`** returns every pending decision, normalized: what, who asks, why, since when, what you can do
   (approve / decline-with-reason / revise / defer), and when it expires. **`/ceo-decide`** routes each decision to
   the existing handler.
2. Fix or remove the 5 phantom types; stop creating untyped escalations; the 100-cap never drops pending items.
3. **Expiry for everything** (e.g. posts 7 d, briefs 7 d, proposals 14 d) with a visible "expired" record so agents
   learn and the list stays honest.
4. **One daily digest** (Discord, and email if wanted) at a time Chad picks, plus an immediate ping only for urgent
   types; a nav badge with the real count.
5. Every summary links into the Inbox filtered to that item.

### Phase 2 — Fewer decisions (the workload, not the screens)
1. **Content must belong to an active campaign** (Chad approved 2026-10-16): enforce at task creation; pipelines
   (hero image, promotion, revisions) inherit the parent's campaign.
2. **Bluesky replies become a capped campaign** Chad approves (approved 10-16); engagement replies the same.
3. **Inside an approved campaign, the fleet publishes** posts and link-shares without per-post approval (the 10-06
   decision, finally built), with a weekly sampled audit; replies to named people, money and first-person claims
   still come to Chad. *(Confirm the boundary — see §6.)*
4. **Campaign approval sets the volume** (posts/week, platforms), so approving a campaign is approving the workload.
5. **Spread the load off Scribe:** Echo takes design (already routed), Quill takes copy editing for real, replies
   capped; revisit waking Pixel with the Design/Video plan.
6. Clean the board once (approved 10-16): cancel Scribe's self-made drafts and their hero images; link the live
   post's promotion to a campaign.

### Phase 3 — The new HQ
1. Build **Today**, **Inbox**, **Plan**, **Team**, **Results** (§4) on the server digests from phases 0–1.
2. New nav: five items + Workshop. Land on Today.
3. Rename: product lifecycle page → "Products"; one word for goals, one for campaigns everywhere.
4. Every number shows "as of"; staleness thresholds come from real schedules; frozen data is labelled frozen.

### Phase 4 — Retire and tidy
- Remove: redirect stubs, legacy directives code, Seasons (revenue-first), Herald panel, experiment panels, Emergence
  (or label frozen), meetings auto-run toggle, "Accuracy = approval rate", duplicate agent pages folded into Team,
  duplicate cost panels folded into Results, the hidden dashboard sections, components/inbox-demo out of HQ.
- Move inline styles of kept pages into CSS as they're rebuilt (dashboard has 538, actions 327).

**Rough size:** phase 0 ≈ 2–3 sessions, phase 1 ≈ 2, phase 2 ≈ 2, phase 3 ≈ 3–4, phase 4 ≈ 1. Each phase ships on its
own and leaves HQ working; nothing waits for the redesign to be useful.

---

## 6. Decisions for Chad

1. **Order:** trust → inbox → fewer decisions → new HQ → retire. OK, or do you want the new Today page sooner
   (built on today's data, then switched to the trusted digests)?
2. **Heartbeat edit** for phase 0.5 (version-checked saves in `index.js`, a do-not-touch file): allowed?
3. **Publishing inside approved campaigns without per-post approval** (phase 2.3): which items still come to you?
   Recommended: replies to named people, anything spending money, first-person claims, blog articles; everything
   else inside an approved campaign publishes, with a weekly sample you review.
4. **Notifications:** one daily digest — what time, Discord only or email too?
5. **Retire list** (phase 4): approve as a list, or page by page as each replacement ships?

## 7. Parked from tonight (folded into this plan)

- Content-must-be-in-a-campaign rule → phase 2.1 (approved).
- Cancel Scribe's 6 self-made blog drafts + 3 hero images; link the live post's promotion → phase 2.6 (approved).
- Bluesky reply lane as a capped campaign → phase 2.2 (approved).
- Video team into Design under Pixel (`docs/superpowers/handoffs/2026-10-15-video-team-into-design.md`) → with
  phase 2.5 / Team page.

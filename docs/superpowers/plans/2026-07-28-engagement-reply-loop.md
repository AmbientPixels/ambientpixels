# Engagement Reply Loop — Implementation Plan

**Date:** 2026-07-28
**Status:** CEO-approved approach, ready to implement
**Author:** Claude (monitoring mission session) — handover doc for a fresh session
**Estimated scope:** one focused session (~4 files new/edited + tests)

## Problem

People are replying to our Bluesky posts — including hot prospect conversations — and
the system does nothing with them. Verified live during planning (2026-07-28):

- `@alvaromartincrespo.bsky.social` asked a follow-up question on a prospect reply
  (in Spanish: "what would an example rewrite of the headline look like?") — an
  interested lead asking us to keep teaching. **Unanswered.**
- `@vocalai.bsky.social` replied *"Thank you, I implemented the suggestions."* —
  a warm prospect who acted on our audit. **Unanswered.**

Today these become a comment COUNT on analytics-hub.html and die. Conversation
continuation is the next step of the outbound funnel (asProspectCron → scan → reply →
**their reply back → [nothing]**). This plan closes that gap.

## Relationship to the 2026-06-15 plan (read it, don't build it)

`docs/superpowers/specs/2026-06-15-autonomous-bluesky-replies-design.md` is a
CEO-approved design for auto-SELECTING which *strangers' discovered threads* get
replies (outbound). **This plan is the inbound sibling** — replying to comments on OUR
OWN posts. CEO-agreed sequencing: build inbound FIRST (warmer audience, lower risk,
less new code). Reuse the June design's principles (deterministic pre-filter, ships-dark
config, CEO gate, breaker) but NOT its Haiku fit-judge — at current volume
(~7 comments/week) a deterministic filter + CEO approval IS the judge. Add the LLM
judge only if volume outgrows the CEO.

## Verified facts (Phase-0 dependency checks DONE during planning — do not re-derive)

1. **Harvest is nearly free.** `outcomeRefresh` (api/outcomeRefresh/index.js:123)
   already calls `public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=<atUri>&depth=0`
   per snapshot. `depth=1` on the same free public endpoint returns
   `thread.replies[].post` with `author.handle`, `author.did`, `uri`, `cid`,
   `record.text`, `indexedAt`. **Live-tested 2026-07-28 against both real posts —
   works.** Use `snapshot.atUri` (full at:// URI), NOT `snapshot.postId` (bare rkey —
   this bit us during planning).
2. **`outcomeSnapshots`** (state key, map keyed by actionId) covers BOTH original posts
   AND our posted replies (reply actions get t0 snapshots via the scheduler hook).
   Fields used: `platform`, `atUri`, `postUrl`, `publishedAt`, `samples[].comments`.
   62 entries as of planning; only bluesky entries with `samples[].comments > 0` need
   thread fetches (2 today) — cheap.
3. **The entire downstream exists** and is battle-hardened by the prospect pipeline:
   `bluesky_reply` task → Scribe drafter (agent-runner.js `_isBsReply` block, ~line
   2021) → `QGV.composeQualityVerdict` reply gate → approval-queue REPLY panel
   (actions.html renderBlueskyReplies) → `social_post.reply` executor (root/parent
   uri+cid) via actionsScheduler. A task with `tags: ['bluesky-reply']` +
   `threadContext {uri, cid, author}` rides ALL of it unchanged.
4. **`repairReplyLink` no-ops safely** for these tasks (prospect-pipeline.js): it only
   fires when a `[SCAN RESULT]` comment exists on the task. Engagement replies have
   none → no link injection. Correct: conversation replies must not carry links
   unless the human asks for one (then Scribe cites the scan comment we provide —
   see task template below).
5. **X reply content is NOT readable** on our API tier (only counts via
   public_metrics). X comments stay manual — out of scope, documented on the
   dashboard via existing link-outs.

## Locked design decisions (CEO-approved 2026-07-28)

| Decision | Choice |
|---|---|
| Autonomy | Auto-draft, **CEO approves every reply** (house rule: every external touch through the queue). Grace-window graduation documented, OFF. |
| Selection | Deterministic filter only, no LLM judge in v1 |
| Volume | `maxPerDay: 3` drafts; one reply per person per thread ever; `perAuthorCooldownDays: 14` across threads |
| Platform | Bluesky only |
| Tone | Answer/thank/continue. **No links, no pitch** — unless the human explicitly asked a product/report question, then cite ONLY grounded facts |
| Config | `systemConfig.engagementReply = { enabled: true, maxPerDay: 3, maxAgeHours: 72, perAuthorCooldownDays: 14 }` — runtime-tunable, MERGE semantics |
| Ships | ENABLED (not dark) — CEO wants the two live conversations answered; the CEO gate is the safety net |

## Architecture

```
outcomeRefresh cron (daily 14:00 UTC — EXTEND, do not fork)
  bluesky snapshots with samples[].comments > 0
    → getPostThread depth=1 (public, free)
    → harvest thread.replies[] → engagementReplies store [NEW state key]
    → filter (deterministic, pure, unit-tested):
        · author.did != our DID (resolve once via session or env handle compare)
        · reply age <= maxAgeHours (72)
        · text >= 15 chars after strip (no bare emoji/"nice")
        · reply.uri not already in store as drafted/answered/skipped
        · author not answered within perAuthorCooldownDays (any thread)
        · daily budget: stop at maxPerDay tasks
    → for each survivor: create bluesky_reply task (assignee scribe, status todo)
    → EXISTING: Scribe drafts → QG → approval queue → CEO → executor posts
    → post-approval: mark store entry answered (reconcile pass, see Task 4)
```

## Implementation tasks

### Task 1 — `api/companyHeartbeat/engagement-reply.js` [NEW, pure module]
Mirror prospect-pipeline.js style (pure functions + IO shell, unit-testable):
- `harvestReplies(snapshots, fetchThread, cfg, nowMs)` → new candidate entries.
  `fetchThread` injected for tests.
- `filterCandidates(candidates, store, cfg, nowMs)` → survivors after ALL rules above.
  Count + return drop reasons per rule (observability — no silent caps).
- `buildEngagementReplyTask(candidate, originalPost, nowMs)` → task shaped like
  prospect-pipeline `buildReplyTask` BUT:
  - `title`: `Reply to @<handle> (engagement — they replied to our post)`
  - `threadContext`: `{ uri: reply.uri, cid: reply.cid, author, authorDid,
    originalText: reply.text, indexedAt }` — **root vs parent matters**: executor
    payload needs `root` = the ORIGINAL post's `{uri, cid}` and `parent` = the
    REPLY's `{uri, cid}`. The existing drafter sets root=parent=threadContext.uri
    (top-level replies). For threaded replies that is WRONG — carry
    `threadContext.root = {uri, cid of our original post}` on the task and extend
    the `_isBsReply` action assembly (agent-runner ~2107) with
    `root: _tc.root || {uri: _tc.uri, cid: _tc.cid}` (backward compatible,
    one-line change — VERIFY against a real threaded post before shipping).
  - `description` includes: our original post text (from the snapshot's action or
    postUrl), their reply verbatim, the conversation rules (answer the question,
    thank genuinely, founder voice, under 280 chars, NO links/pitch unless they
    asked — if they asked about the report, the [SCAN RESULT] comment from the
    PARENT prospect task is copied onto this task so link repair + grounding work),
    reply in the same language they used (the live Spanish example).
  - `tags: ['bluesky-reply', 'engagement-reply']`, `source: 'engagementReply'`,
    `objective_id: 'obj-first-customer'`, `status: 'todo'` (not backlog — no scan
    wait), `assignee: 'scribe'`.
- Store shape (`engagementReplies`, array, cap 500 FIFO):
  `{ id, replyUri, replyCid, rootUri, author, authorDid, text (500), ourPostActionId,
    discoveredAt, status: 'new'|'task_created'|'answered'|'skipped', taskId,
    skipReason }`

### Task 2 — wire into `api/outcomeRefresh/index.js`
After the existing snapshot refresh loop: load `engagementReplies` + `systemConfig` +
`tasks`, run harvest+filter+create, save store + tasks. Respect `execution_mode`
(`observe`/`frozen` → harvest only, no task creation). Change `depth=0` → `depth=1`
in `fetchBlueskyMetrics` and pass the replies array out (keep metrics extraction
unchanged). Non-fatal try/catch around the whole block — outcome refresh must never
die because of harvesting.

### Task 3 — `engagementReplies` read access
Add to company-state VALID_KEYS? **NO — do not touch company-state/index.js
(do-not-touch list).** Use companyStorage-direct pattern (like pingLog /
governanceLogArchive): the cron reads/writes via storage lib. Dashboard visibility
v1 = governance log lines only (see Observability).

### Task 4 — answered/skip reconciliation (same cron, next run)
For store entries `task_created`: if the task's linked reply action shipped
(`social_post.reply` with `_parentTaskId` = taskId, execution success) → `answered`.
If task closed without action (declined/QG-dead) → `skipped` + reason. Prevents
re-drafting and makes the per-author cooldown real.

### Task 5 — tests (`api/companyHeartbeat/engagement-reply.test.js`)
Prospect-pipeline test harness style. Minimum cases: harvest maps thread shape
correctly; self-replies excluded (our DID); short/emoji replies dropped; age window;
per-author cooldown across threads; daily cap; dedup on replyUri across runs; task
shape (root carried, tags, scribe, todo); reconcile flips answered/skipped; filter
drop-reason counts. Also extend `smoke-test.js` only if it asserts task-type routing
maps (check `_taskTypeToAgent` — `bluesky_reply` already → scribe, so no map change).

### Task 6 — observability (required — platform norm)
- Cron log line per run: harvested N, filtered breakdown by reason, created M.
- `logEvent('engagement-reply-drafted', 'system', ...)` per task into governanceLog
  (mirrors `prospect-discovered` events) + one aggregate per run, not per candidate.
- The approval-queue entry already carries threadContext → the REPLY panel shows the
  conversation for free. Verify the original-post quote renders for these entries.

## Gotchas a fresh session must know (paid-for lessons — do not relearn)

1. **Any new content path MUST use `QGV.composeQualityVerdict`, never bare
   `_validateContentQuality`** — the `_isBsReply` path already does; don't fork it.
2. **Comment truncation:** the execute prompt caps task comments at 200 chars except
   `[SCAN RESULT]`/`[SCAN FAILED]`/`cmt-qgbrief-` (execution-engine.js). Put
   conversation context in the DESCRIPTION (full), not comments.
3. **`capitalizeSentences` + 280-char cap** run on the draft (agent-runner ~2074);
   Bluesky hard cap 300 — the QG enforces on final text. Keep templates under budget.
4. **Crash-dedup:** the pending-reply guard (agent-runner ~2082) closes a task if a
   pending reply action already exists — engagement tasks inherit this. Good.
5. **approvalQueue writers race** (2026-07-28 boomerang incident). This plan only
   APPENDS reply-kind AQ entries via the existing drafter — do not add new
   whole-queue rewrite passes.
6. **Echo parking:** tasks with `_social_action_created` are hidden from Echo — not
   relevant here (scribe-assigned), noted so nobody "fixes" invisible tasks.
7. The **repo auto-commits + pushes** from parallel loops — commit your own files
   explicitly by path; expect new commits mid-session.
8. Run the FULL suite set before commit: smoke, prospect (50), QG (25), generator
   (60), composer (39), envelope (6), rewards (19) + the new test file.

## Rollout & verification

1. Ship with `engagementReply.enabled: true` (CEO call — there are two live
   conversations waiting). Deploy = git push origin master.
2. `outcomeRefresh` runs daily 14:00 UTC; for day-one verification trigger it via
   Azure portal Functions test OR wait for the cron — then verify:
   - `engagementReplies` store has the 2 live candidates (alvaromartincrespo +
     vocalai) with `task_created`.
   - 2 `bluesky_reply` tasks assigned scribe; next heartbeat drafts them; QG passes;
     2 entries in the CEO's REPLY panel with thread context visible.
   - CEO approves → replies post threaded correctly (parent = THEIR reply, root =
     our original post — check on bsky.app that it nests under their comment, not
     beside it).
3. Watch one week: drop-reason distribution sane, no double-replies, cooldowns hold.
4. Rollback: revert the commit (plan carries no state migrations; the store key is
   additive and inert when the code is reverted).

## Out of scope (v1)
- X/LinkedIn reply reading (API tier), LLM fit judge (June design — add when volume
  demands), grace-window auto-posting, new dashboard page (governance lines + REPLY
  panel suffice), multi-turn threads (one reply per person per thread; deeper
  conversation = CEO manual).

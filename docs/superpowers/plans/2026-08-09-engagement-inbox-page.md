# Plan — promote the Engagement Inbox from a hub section to its own page

**Status:** proposed, CEO-approved in principle 2026-08-09. Not started.
**Prerequisite:** everything below already exists and is live — this is a promotion, not a rebuild.

---

## The case for a page

The Engagement Inbox was built as zone 2 of the Analytics Hub, alongside four other zones
that answer "how are we doing". It does not answer that question. It answers **"who is
talking to us and what are we going to say back"**, which is not analytics — it is a
workspace, and it is the only place in the platform where a stranger's words reach a human.

Three concrete things prove it has outgrown a section:

1. **It has actions now.** Every other hub zone is read-only. This one creates tasks
   (`Draft a reply`), and the next obvious step — approving the drafted reply in context —
   does not fit in a tab that also has to leave room for a traffic chart.
2. **It has state that needs filtering.** Nine conversations across five statuses already
   render as one flat list, and the reactions had to be collapsed into a single rolled-up
   line purely for vertical space. That is a section constraint deciding a product question.
3. **It is the last mile of the entire distribution stack.** 195 posts produced 65
   interactions in four months. The posts have a campaign system, a shape system, a quality
   gate and an approval queue. The *replies* — the only two-way part — had no reader at all
   until today. The asymmetry is the point.

**The hub keeps a summary, not a copy.** Zone 2 becomes a compact card: the counts, the
newest one or two conversations, and a link. At-a-glance value stays where people already
look; the work happens on the page.

---

## What already exists (do not rebuild)

| Thing | Where | Notes |
|---|---|---|
| Inbox API | `api/engagementInbox/` | GET `/api/engagement-inbox?days=&limit=`. Returns `replies`, `reactions`, `counts`, `coverage`, `meta`. Exports `_buildReplyRows`, `_buildReactionRows`, `_annotateBlocked` for tests. |
| Draft-on-demand API | `api/engagementReplyDraft/` | POST `/api/engagement-reply-draft {id}`. Exports `OVERRIDE_CONFIG` — **import it, never re-declare it.** |
| Rule engine | `api/companyHeartbeat/engagement-reply.js` | `filterCandidates`, `buildEngagementReplyTask`, `reconcileEngagement`, `loadConfig`, `DEFAULTS`. Pure functions with 35 tests. |
| Renderer | `modules/company/js/engagement-inbox.js` | Rows, statuses, draft button, click handler. |
| Styles | `modules/company/css/analytics-hub.css` | All `.ei-*` rules, at the end of the file. |
| Section markup | `modules/company/analytics-hub.html` | `#ah-zone-inbox`, including a written About tab worth reusing verbatim. |
| Shared helpers | `modules/company/js/analytics-hub-shared.js` | `AHShared.fetchJSON` now merges `secretHeaders` — this is what authenticates. |

Store: `engagementReplies` (companyStorage-direct, NOT a `company-state` VALID_KEY), written
by the daily `outcomeRefresh` cron via `engagement-reply.js`. Cap 500 FIFO.

---

## Phase 1 — the page itself

**New:** `modules/company/engagement.html` + `modules/company/js/engagement-page.js` +
`modules/company/css/engagement.css` (move the `.ei-*` block out of analytics-hub.css;
leave a pointer comment behind).

1. **Sidebar entry** under **Content**, after Analytics Hub. Icon `fa-comments`.
   `modules/company/js/sidebar.js` around line 97. The sidebar already supports a numeric
   badge — wire it to `counts.needsAttention`, the way the Emergence badge works.
2. **Segments, not a flat list.** Tabs or pills: `Needs a reply` (default) · `In progress`
   (drafting + awaiting approval) · `Answered` · `Skipped` · `All`. Every row already carries
   `status` and `draft_state`; no API change needed.
3. **Search** across author handle, their text, and our post text. Client-side over the
   loaded set is fine at this volume; say so in a comment rather than pretending it scales.
4. **Deep links.** `engagement.html#er_abc123` scrolls to and highlights one conversation.
   This is what makes the Discord approval ping able to point at a specific person instead of
   at a dashboard.
5. **Reactions as a real list**, not the rollup — sortable by engagement, filterable by
   platform. The rollup exists only because a section had no room. Keep the "text not
   captured" honesty for pre-2026-08-09 rows.
6. **A counts strip** at the top: needs a reply · drafting · awaiting approval · answered
   (30d) · **median response time**. See Phase 1b.
7. **Reduce the hub zone to a summary card** linking here. Do not leave two full copies.

### Phase 1b — response time (small, and nothing else measures it)

`indexedAt` on the reply and `answeredAt` on the entry are both already stored. Median hours
between them is the only number that says whether we are actually conversational rather than
merely present. Compute it in `engagementInbox` (pure function, testable), return it in
`counts`. Null when fewer than 3 samples — **never a confident zero**, same rule as
`roast-funnel-reconcile.js`.

---

## Phase 2 — the reason this is a higher-tier feature

**This is the payoff. Phase 1 without Phase 2 is a nicer list.**

1. **Read the draft where you read the conversation.** Today: see the reply here → click
   Draft → wait for the heartbeat → go to the Actions page → find it among unrelated action
   types → approve. The page should show the drafted reply *underneath the comment it
   answers*, with Approve / Reject / Request revision in place.
   - Reuse `AE.approveAction(id)` from `js/agent-engine.js` and whatever execute call
     `modules/company/actions.html` makes after it (see ~line 2322 and ~line 2507).
     **Do not invent a second approval path.** If the existing one cannot be reused cleanly,
     stop and say so rather than writing a parallel one.
   - The quality-gate verdict is already attached to the action — show it.
2. **Full thread context.** A row currently shows our post and their reply. Judging a reply
   needs the whole exchange, especially now that two turns are allowed. `entry.rootUri` and
   `entry.ourPostAtUri` are stored; `api/outcomeRefresh/index.js` (~line 126) already fetches
   `app.bsky.feed.getPostThread` from the free public endpoint. Extract that into
   `_utils/blueskyThread.js` and reuse it — do not write a third copy.
   - Cache per request. Do not fetch on every render.
   - Bluesky only, as ever. Say so where an X row would have shown one.

---

## Phase 3 — only if Phase 2 lands well

- **Person view.** Group by author: everyone who has talked to us, their history, whether
  they are inside the 14-day cooldown. @fberrez.co has given us two genuinely useful replies
  and is effectively an ally; nothing in the system currently notices that.
- **Keyboard flow.** `j`/`k` to move, `d` to draft, `o` to open on Bluesky. An inbox earns it.
- **Auto-refresh** on a visibility-aware interval — the pattern already exists in
  `js/agent-profile-live.js` (60s poll, cleared on `visibilitychange`). Copy that, do not
  invent a new poller.

---

## Rules this work inherits

- **`AHShared.fetchJSON` is the authenticated fetch.** It merges `secretHeaders`;
  `keyHeaders` alone sends an `X-AmbientOS-Key` that nothing validates. That bug cost a
  debugging cycle on 2026-08-09.
- **Azure Functions answers CORS preflight at the PLATFORM level from an origin allowlist.**
  A random `127.0.0.1:PORT` test harness can never preflight against the function app. Test
  cross-origin behaviour through a same-origin proxy; that failure is the harness, not the code.
- **A header missing from `Access-Control-Allow-Headers` fails preflight** and surfaces as a
  dead panel with no status code — much worse to debug than a 403.
- **`Number.isFinite(Infinity)` is `false`.** `filterCandidates` guards its config with it, so
  passing Infinity silently restores the DEFAULT. Use large finite numbers.
- **Writes go through `storage.mutateState`**, never a whole-array `setState`.
- **Never weaken an approval gate.** Nothing on this page may post without a human decision.
- **Reply coverage is Bluesky only.** An absent X section must never read as "nobody replied".
- **Say which nothing you mean.** "Store never written" ≠ "no interactions" ≠ "all answered".
  This panel has already shipped three bugs of exactly that shape; assume a fourth is hiding.

## Non-goals

- No new harvesting. The cron owns that.
- No auto-posting, no auto-approving, no raising `maxRepliesPerThread` for the automation.
- No X/LinkedIn reply harvesting — that is a separate piece of work with a real API cost.
- Do not touch `companyHeartbeat/index.js`, `company-state/index.js`,
  `staticwebapp.config.json`, or `data/company-actions.json`.

## Verification

```bash
for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
# 79 suites green as of 2026-08-09.
GET /api/engagement-inbox?days=60&limit=50   (secret-gated)
```

Render the page in a browser against the live payload before claiming it works — the section
version shipped two visual bugs (17 identical empty rows, a chip that named the wrong guard)
that only a screenshot caught.

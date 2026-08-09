# Handoff — give the Engagement Inbox its own page

**Written 2026-08-09.** The inbox shipped tonight as zone 2 of the Analytics Hub and
immediately outgrew it. The plan is written and CEO-approved in principle. This handoff
exists so a fresh context can execute it without rediscovering the evening.

> **Committed markdown under `docs/` is served publicly as raw text.** Safe for anyone to
> read: no secrets, no balances, no client names.

**Read first, in full:** `docs/superpowers/plans/2026-08-09-engagement-inbox-page.md`.
It has the phasing, the file map, and the inherited rules. This document is the context
around it.

---

## What you are inheriting

A working feature, built and deployed in one evening, that surfaced nine real human
conversations nobody had ever seen. The `engagementReplies` store had been filling since
2026-07-28 with the author, full text and thread context of every reply to our Bluesky posts,
and **had zero readers** — no endpoint, no dashboard, no prompt.

Live now:

- `GET /api/engagement-inbox` — replies + reactions + counts + coverage
- `POST /api/engagement-reply-draft` — push one conversation into the Scribe drafting
  pipeline on demand (CEO override; lifts the 72h age gate and raises the per-thread reply
  limit 1 → 2, nothing else)
- Zone 2 of `modules/company/analytics-hub.html`, rendered by
  `modules/company/js/engagement-inbox.js`

79 suites green.

## Four bugs this feature shipped in one evening, and what they have in common

Read these before writing code here. Every one is the same mistake wearing a different hat:
**a state that means one thing being reported as another.**

1. **Blank rows.** `text_preview` resolved post text from `actions`, a store trimmed to about
   a week, while snapshots live 60 days. Every older post rendered as an empty line with a
   number beside it. Text is now stamped onto the snapshot at capture.
2. **Seventeen identical "text not captured" rows.** The honest fix for (1) became most of
   the panel's height saying nothing. Now rolled into one line.
3. **The chip named the wrong guard.** `filterCandidates` reports drops in a fixed order and
   `too_old` runs first, masking whatever came after — and the age gate is exactly what the
   Draft button lifts. The panel would have said "aged out" when the real blocker was
   something else entirely.
4. **"Waiting on your approval" for three cancelled tasks.** `task_created` only ever meant a
   task exists for Scribe, not that anything reached the approval queue. Three tasks had been
   cancelled in a bulk operation and `reconcileEngagement` recognised only `done` as
   terminal, so the entries sat there forever promising a draft that could never arrive.

**Assume a fifth is hiding.** When this panel says nothing, make it say *which* nothing.

## Two traps that cost real time

- **`Number.isFinite(Infinity)` is `false`.** `filterCandidates` guards its config with it, so
  `maxAgeHours: Infinity` silently restored the 72h **default**. The Draft button would have
  existed, looked correct, and refused every item it was built for. Tests caught it. Use large
  finite numbers, and import `engagementReplyDraft.OVERRIDE_CONFIG` rather than re-declaring it.
- **Azure Functions answers CORS preflight at the PLATFORM level from an origin allowlist.**
  A Playwright harness on `127.0.0.1:<random>` can never preflight against the function app,
  and the failure looks exactly like a broken endpoint. Test cross-origin behaviour through a
  same-origin proxy.

And one that was already there: **`AHShared.fetchJSON` could not authenticate.** It sent only
`APApi.keyHeaders()` — an `X-AmbientOS-Key` no endpoint validates and which is never even
populated. It worked by accident because every hub zone until now read an ungated endpoint. It
now merges `secretHeaders`. Use `AHShared.fetchJSON`; do not hand-roll auth.

## The judgement calls already made — do not silently reverse them

- **The automation still replies once per thread.** Only the manual button reaches two. A test
  asserts `loadConfig({}).maxRepliesPerThread === 1` precisely so this cannot drift into
  autonomous behaviour unnoticed.
- **The per-author cooldown is scoped to OTHER threads.** Answering inside a thread someone is
  already talking in is not a new approach. Without this the 2-exchange limit was unreachable:
  the cooldown counted our own reply in the very thread we were continuing.
- **Rows, not charts.** 195 posts produced 65 interactions in four months. At that volume an
  average rounds to noise and the useful act is reading every one. Do not add a sparkline
  because a page has room for one.
- **Reply coverage is Bluesky only.** X and LinkedIn contribute counts, not conversation. The
  response says so in `coverage.note`. An absent X section must never read as "nobody replied".

## Where the real value is

Phase 1 is a nicer list. **Phase 2 is why the CEO asked for a page.**

Today the loop is: see the reply here → click Draft → wait for the heartbeat → go to the
Actions page → find it among unrelated action types → approve. The page should show the
drafted reply *underneath the comment it answers*, with the quality-gate verdict, and let the
decision happen there.

Reuse `AE.approveAction(id)` from `js/agent-engine.js` and the execute call
`modules/company/actions.html` makes after it (~line 2322, ~line 2507). **If the existing
approval path cannot be reused cleanly, stop and say so.** A second approval path is worse
than a page that still links out.

## Do not

- Weaken any approval gate, or post anything without a human decision.
- Raise `maxRepliesPerThread` for the automation.
- Touch `companyHeartbeat/index.js`, `company-state/index.js`, `staticwebapp.config.json`, or
  `data/company-actions.json`.
- Write a third copy of the Bluesky thread fetch — extract the one in
  `api/outcomeRefresh/index.js` (~line 126) into `_utils/blueskyThread.js`.
- Leave two full copies of the inbox. The hub zone becomes a summary card that links out.
- Add X/LinkedIn reply harvesting. Separate work, real API cost.

## Verify with

```bash
for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
# 79 suites green as of 2026-08-09.
```

Render the page in a browser against the live payload before claiming it works. Two of the
four bugs above were only visible in a screenshot.

---

## Kickoff prompt for the next context

```
Read docs/superpowers/handoffs/2026-08-09-engagement-page-handoff.md and then
docs/superpowers/plans/2026-08-09-engagement-inbox-page.md, both in full. Between them they
name every file you need and several things already ruled out.

THE JOB: the Engagement Inbox shipped last night as a section of the Analytics Hub and has
outgrown it. It is the only place in the platform where a stranger's words reach a human, it
creates tasks rather than just displaying numbers, and the next step (approving a drafted
reply in context) does not fit in a tab that also has to leave room for a traffic chart.
Promote it to modules/company/engagement.html: sidebar entry under Content with a
needs-a-reply badge, segments (needs a reply / in progress / answered / skipped / all),
search, deep links to a single conversation, the reactions list unrolled, and a counts strip
including median response time (null under 3 samples, never a confident zero). Then reduce the
hub zone to a summary card that links to it.

Then Phase 2, which is the actual point: show the drafted reply underneath the comment it
answers, with its quality-gate verdict, and let Approve / Reject happen there instead of on
the Actions page. Reuse AE.approveAction and the existing execute call. If the existing
approval path cannot be reused cleanly, STOP and report that rather than writing a second one.

DO NOT:
- Weaken any approval gate or post anything without a human decision.
- Raise maxRepliesPerThread for the automation (a test pins it at 1 on purpose).
- Touch companyHeartbeat/index.js, company-state/index.js, staticwebapp.config.json, or
  data/company-actions.json.
- Re-declare engagementReplyDraft.OVERRIDE_CONFIG — import it.
- Write a third Bluesky thread fetch; extract the one in api/outcomeRefresh/index.js.
- Add a chart because the page has room. 65 interactions in 4 months: rows, not averages.

RULES THAT EARNED THEIR PLACE:
- Say WHICH nothing you mean. "Store never written" is not "no interactions" is not "all
  answered". This panel shipped four bugs of exactly that shape in one evening.
- AHShared.fetchJSON is the authenticated fetch (it merges secretHeaders). keyHeaders alone
  authenticates nothing.
- Number.isFinite(Infinity) is FALSE, and filterCandidates guards its config with it.
- Azure answers CORS preflight at the platform level from an origin allowlist — a localhost
  harness can never preflight. Use a same-origin proxy.
- Writes go through storage.mutateState, never a whole-array setState.
- Render it in a browser against the live payload before claiming it works.

VERIFY WITH:
  for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
  GET /api/engagement-inbox?days=60&limit=50   (secret-gated)

Commit and push as you go, with real reasoning in the messages.
```

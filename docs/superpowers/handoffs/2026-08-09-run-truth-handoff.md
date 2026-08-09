# Handoff — the API now says what it did; come back in a day and read it

**Session 2026-08-09, early.** The funnel can now tell our failures from their
abandonment. It cannot yet tell you which one we have, because that needs a day of
data — that is the next session's first job and it is a reading job, not a building one.

> **Committed markdown under `docs/` is served publicly as raw text.** Safe for anyone
> to read: no secrets, no balances, no client names.

---

## The correction that came before the code

The headline everyone has been quoting — **25 roast starts → 5 completions, an 80%
drop** — is event volume. The same window is **9 distinct people starting and 5
completing**. 25 starts from 9 people is ~2.8 attempts each: a retry pattern, not
twenty people walking away.

`metric=events` counts retries. `metric=funnels` counts distinct userIds. They answer
different questions and the difference here is the difference between "the product is
broken for almost everyone" and "nine people tried it and five got an answer".

Both numbers are real. Only one of them is a people number.

## What shipped (all deployed, 76 suites green, verified in production)

1. **Server-side run truth.** `api/pixel-agent-run` emits `run_delivered` right before
   it answers, and `run_failed` on every path that ends without one, carrying
   `props.reason` — `rate_limited`, `llm_unavailable`, `input_too_long`,
   `server_error`, `unknown_agent`, `empty_input`, `invalid_url`,
   `secondary_too_long`, `offline`. So:
   - `started → delivered` = **our failure rate**
   - `delivered → completed` = **their abandonment rate**
2. **Identity forwarding.** The browser sends its analytics id with the run
   (`ProductAnalytics.getIdentity()` → `body._pa`) and the server files under it.
   Without this the two halves of the funnel describe different people. Missing `_pa`
   (stale cached JS) falls back to an IP hash and stamps `identity_source: 'ip'`.
   The `pa_internal` device flag rides the same channel — it lives on the device, so
   only the device can tell the server a run is ours.
3. **Double counting, decided explicitly.** `pa-metrics` counts DISTINCT runIds across
   `agent_run_completed` and `run_delivered`. Counting both inflates the kill gate ~2x;
   counting only the server drops every roast delivered before today and would read
   `resume_roast_runs_14d` near zero on 08-22 for a lane that is working.
4. **The analytics write path.** `_utils/productAnalytics` appended with
   `getState → push → setState`: two writers on the same daily blob lost one, and a
   transient read error resolved to `|| []` and could replace a whole day of events
   with a single one. Both paths now go through `storage.mutateState`.
5. **A failed public post now reaches a human.** `actionsExecute` pings Discord on
   social execution failure, the way it already did for receipt-loss and pending link
   replies.
6. **`scripts/roast-funnel-reconcile.js`** — prints RUNS and PEOPLE as separate tables
   and refuses to print a confident zero.

## Why X was quiet for 8 days — answered, and it was not one bug

Last successful X post before tonight: **2026-07-31 13:00Z**. Next: **2026-08-08
23:18Z** (with its link reply — shape 4 works). In between, X received **4 posts total**:

- The campaigns run at **3 and 2 posts per WEEK across three platforms**, so ~1 X post
  per week per campaign is the designed cadence. That is the anti-flood discipline, not
  a stall. Bluesky only looks dominant because 37 of its 49 actions are Scout *replies*
  from a separate uncapped lane; the campaign lane is roughly bluesky 12 / linkedin 7 / x 4.
- **The CEO rejected 2 of the 4.**
- **One died on HTTP 401 (08-07 21:27) and nothing surfaced it** — only a comment on the
  parent task. Its telemetry event is missing from `socialMetricsEvents` entirely,
  consistent with the whole-array clobbering closed the night before. Now alerted.

**Rule earned: before calling a channel broken, count what was CREATED for it.** A
silent channel with four attempts is a supply and approval story.

## READ THIS — two agent replies, read as a person

No shaped engagement post has reached the queue yet (no task carries `post_shape`;
both campaigns are still at their weekly cap), so that part of the last handoff is
still open. But two Bluesky replies were pending at 00:00 and both are bad:

> *"I remember getting that exact advice. Walked into a tech company lobby and the
> security guard looked at me like I had three heads. Never again."*

That is a **fabricated first-person anecdote** — the exact thing banned on 2026-06-10.
It passed the composed quality gate at **95% confidence**.

> *"I love that your parents have the physical photos of felix and fluff. It's so
> special to have those printed memories that you can actually hold."*

A brand account replying to a stranger's pet-photo thread. It reads as an engagement
bot, and it passed at **100%**. (Also note `felix and fluff` — `capitalizeSentences()`
only fixes sentence starts, so proper nouns lifted from a thread stay lowercase.)

**Cause:** the truth rule *"NEVER invent an anecdote, a statistic, or a customer"* lives
in `api/_lib/socialCopy/shape.js`, which is the **campaign lane only**. The Bluesky
reply drafter has no fabrication guard at all, and the quality gate checks claims
against product-facts — not whether a lived experience is real, or whether replying to
this thread is something a person would do.

Left for the CEO to decide rather than patched at 00:30: the fix belongs in the reply
prompt, not a regex. *"I built a tool"* is true founder voice and *"I walked into a
lobby"* is not, and no pattern separates them.

## The next session's job

1. **Reconcile a full day.** `node scripts/roast-funnel-reconcile.js 1d` on 08-10, once
   a whole UTC day of server events exists. Then say which problem we have: if
   `rate_limited` dominates, the 5/day anonymous cap keyed on an IP HASH is eating
   shared-wifi and mobile visitors and the fix is the cap. If `llm_unavailable`
   dominates, it is capacity. If neither and delivered ≈ started, the gap was always
   abandonment and the fix is the wait (a delivered roast took **21 seconds** in
   production tonight) or the run page.
2. **Watch `identity_source`.** Until browsers pick up the new JS, some server events
   land under IP hashes and will not join to client events. The script warns when the
   PEOPLE table starts double-identifying; trust the RUNS table while it does.
3. **Read the first shaped engagement post as a person** when a campaign slot opens.
   Still nobody has seen one.
4. **Decide the reply-lane fabrication guard** (above).

## Verify with

```bash
for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
node scripts/roast-funnel-reconcile.js 1d
# server events, ours included:  ?metric=events&include_internal=1
# a green GH run can still have SKIPPED the API deploy — check the step list, or probe:
#   the resumeroast funnel contains a run_delivered step only when the API is live
```

## Gotchas that earned their place tonight

- **`metric=events` is retries; `metric=funnels` is people.** Quoting one as the other
  turns nine users into twenty-five.
- **An un-awaited analytics write is a coin flip.** Azure ends the invocation when the
  handler returns. Same bug that made the free-run cap not hold; asserted here by
  inspecting the store with no extra ticks after `await handler()`.
- **A server event is only comparable if it carries the client's identity.** Distinct
  userIds are the unit; a fresh id makes one run look like two people.
- **The device owns the internal flag.** Move truth to the server without forwarding it
  and our own testing becomes the one thing that still counts as demand.
- **A quality gate that checks facts does not check judgement.** Both replies above are
  factually spotless.

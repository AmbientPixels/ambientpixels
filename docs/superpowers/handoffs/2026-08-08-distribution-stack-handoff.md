# Handoff — the distribution stack is built; now make the numbers trustworthy

**Session close 2026-08-08 late.** One evening, four workstreams: post shapes went live end-to-end,
the duplicate-post root cause is closed, the CEO's approval loop rings his phone, and the analytics
that will judge all of it got two honesty fixes. Also one self-inflicted 15-minute API outage,
documented below, with the rule that prevents the next one.

> **Committed markdown under `docs/` is served publicly as raw text.** Safe for anyone to read:
> no secrets, no balances, no client names.

---

## What is LIVE as of tonight (all deployed, 76 suites green)

1. **Post shape mix (Phase A).** Every campaign social task gets a `post_shape` decided at the
   copy-brief choke point: 2 no-link engagement posts per 1 link post, per campaign per platform.
   Variants follow the campaign — `camp-agent-build-log` asks questions, `camp-resume-roast-launch`
   makes craft points (`shapeProfile` on the campaign object; defaults in `_lib/socialCopy/shape.js`).
   All three URL gates are shape-aware, including the AUTO-POST safety net that used to re-append
   the URL. First shaped tasks appear as campaign slots open (both campaigns were at their weekly
   frequency cap tonight — that is the anti-flood discipline working, not a bug).
2. **Shape 4 — X link-in-self-reply.** The pipeline is untouched (the CEO approves the same text
   with the URL visible); the X executor splits at delivery: clean tweet, URL threaded under it.
   Receipt-driven and conservative: only a TRAILING url splits, threaded replies never split, a
   complete receipt never re-posts, a failed link reply marks `link_reply_pending` and pings
   Discord — re-executing then posts ONLY the missing reply (the 409 gate admits exactly that case).
3. **Stuck-execution ROOT CAUSE closed.** `actionsExecute` used to write a whole-array snapshot
   held across the 15–60s platform call, clobbering concurrent writers — that is what stranded
   successful posts at `running` and caused the morning's duplicate replies. All execution-state
   writes now go through `actionsExecute/action-persist.js` (surgical per-action `mutateState`).
   Two new rules on top: no persistence of `running` ⇒ REFUSE to post (503); success that cannot be
   recorded ⇒ loud Discord alert, never silence.
4. **Discord loop.** Approval pings (`_utils/approvalAlerts.js`, keepalive cadence, edge-triggered
   on NEW pending items, 30-min cooldown). Purchase alert already existed in `as-webhook` (green
   "Rewrite order paid: $9" embed) — nothing was built twice. The `/roast` bot is LIVE (app created
   by the CEO; endpoint verified rejecting unsigned requests).
5. **Analytics honesty, two fixes.**
   - `resume_roast_runs_14d` — the kill-gated objective's north star — was computed NOWHERE and
     read a phantom 0 for a week. Now `companyHeartbeat/pa-metrics.js` counts COMPLETED roasts and
     resolves null (unmeasured) when the pipe is down, never a fake zero.
   - Internal-traffic flag: visiting any page once with `?pa_internal=1` marks that device; its
     events carry `internal:true` and are excluded from queries and the kill-gate counter by
     default (`?include_internal=1` to see everything; `?pa_internal=0` to unflag).
6. **Blog share cards.** `og-blog.png` had been swallowed by the `/blog/*` SPA rewrite since it
   shipped — every card ever posted went out imageless. Fixed: the image serves from
   `/images/og/og-blog.png` (+ a `/blog/*.png` passthrough). Monday's article promo gets a real
   card. Per-article titles/heroes are PARKED — see the outage below.

## The outage, and the rule (read before touching Azure)

To make `/blog/<slug>` server-render per-article meta, the function app was linked as the SWA's
backend (`az staticwebapp backends link`) — the only mechanism SWA offers for internal `/api/*`
rewrites. **~30 minutes later, asynchronously, Azure applied EasyAuth to the function app** and
every direct caller got 401: dashboards, the heartbeat trigger, webhooks. Unlink does NOT remove
the auth it injects; the fix was `authsettingsV2 platform.enabled=false` via `az rest`. Full
recovery verified the same night.

- **NEVER link a backend to this SWA.** The architecture depends on the function app being
  directly reachable.
- **An Azure control-plane change that passes its immediate check can still break you minutes
  later.** Re-verify after 5–10 minutes.
- Per-article blog SSR therefore needs a different mechanism. The `api/blogpage` function is
  built, tested, and correct (it rendered live for ~10 minutes) — the recommended path is
  **publish-time static article HTML**, designed fresh, not rushed.

## Measured reality (know these numbers)

- 195 posts → 65 interactions over 4 months; 79–89% zero engagement; volume DISPROVEN (3.6x
  output halved per-post engagement). Followers: Bluesky 82, X 52, LinkedIn 2.
- Resume Roast, 2 clean days since the 08-07 product split: 12 users, 72 page views,
  **25 roast starts → 5 completions**, 4 upsell views, 0 purchases.
- The 08-07 traffic spike (~230 views) coincides with our own all-day fix session; top referrers
  included `127.0.0.1` and `localhost`; ZERO UTM-tagged arrivals. Real external signal: LinkedIn 6,
  Bluesky 3. Treat the spike as our own wake until devices are tagged.
- Kill gate: `obj-resume-roast-demand`, 50 runs by 08-22, kill below 15. At ~2.5 completions/day
  that lands ~35 — above kill, below target — IF the pace holds and the completion gap is not
  eating real users.

## THE OPEN QUESTIONS (next session's job)

1. **The 25→5 start/complete gap.** Both funnel events are CLIENT-side (`pixel-agents/js/`
   `pixel-agent-run.js` ~363/~425); completion only fires if the tab stays open for the result. So
   the 80% drop is an unknown mix of real failures, impatience, and our own testing. **Build
   server-side truth: emit run-delivered and run-failed events from `api/pixel-agent-run` itself
   (source:'server'),** then the gap splits into failure rate vs abandonment rate — different
   problems, different fixes. Note `pixelAgentRuns` state is NOT readable via company-state.
2. **X has not posted in 8 days** (visible on the analytics hub) despite being in
   `camp-resume-roast-launch`'s platforms. Find out why before assuming shape 4 will get traffic.
3. **Read the first engagement posts as a person** when campaign slots open. The gate is fail-open;
   nobody has seen a no-link post from this system yet. If one names a product or carries a URL,
   reject it and fix the brief.
4. CEO manual items: tag his devices (`?pa_internal=1` once per device), Discord mod outreach for
   the bot, LinkedIn invite credits + first-hour engagement from his profile.

## Gotchas that earned their place tonight

- **A passing check right after an Azure infra change proves nothing** — EasyAuth arrived 30
  minutes later. Re-verify.
- **`{path}` tokens do not interpolate on internal SWA rewrites**, and cross-origin rewrites on
  non-`/api` routes are silently dropped by the deploy validator (a duplicate `/blog` vs `/blog/`
  route FAILS the whole deploy — SWA treats them as the same route).
- **Whole-array read-modify-write + a long network call in the middle = clobbered state.** Use
  `storage.mutateState` with a surgical patch. `persistActionsWithTrim` was deleted on purpose;
  do not reintroduce it.
- **Client-side funnel events lie about completion.** Anything that matters must also be emitted
  by the server that did the work.
- **A kill-gate metric nobody computes reads as 0 and kills a working lane.** When adding an
  objective, grep that its north-star metric has a resolver the same day.
- **A stale file in `C:\tmp` can shadow a fresh API pull** — write fetches to the session
  scratchpad, never `/tmp`.
- The `/roast` bot's resume input must stay in the modal (privacy) and its caps (3/person/day,
  300/day global) are load-bearing — they are what stands between one large server and the model
  budget.

## Where tonight's code lives

```
api/_lib/socialCopy/shape.js(+test)        shape selection, variants, engagement brief lines
api/companyHeartbeat/agent-runner.js       shape decision + brief branch (~2694-2760); no-URL gate (~3075)
api/companyHeartbeat/index.js              AUTO-POST append guard (~3408); SE-2 sources (+resumeRoastRuns14d)
api/companyHeartbeat/pa-metrics.js(+test)  kill-gate run counter (internal-excluded)
api/actionsExecute/action-persist.js(+test) surgical execution-state writes
api/actionsExecute/index.js                409 gate link-reply exception; loud sync-failure alerts
api/actionsExecute/executors/social/x.js   splitLinkForReply / decideXDelivery / link self-reply (+x.linkreply.test)
api/_utils/approvalAlerts.js(+test)        approval pings (keepalive-record wires it)
api/blogpage/                              per-article page renderer — built, UNROUTED (parked)
js/product-analytics.js                    pa_internal device flag
api/productAnalyticsIngest|Query           internal field + default exclusion
```

Verify anything with:

```bash
for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
# deploys: check the workflow's step list for "Deploy API to Azure Functions (Kudu zip-deploy)" —
# a green run can still have skipped it. Never trigger a heartbeat mid-deploy (502, no run).
```

---

## Kickoff prompt for the next context

Paste this into a fresh session.

```
Read `ambientpixels/docs/superpowers/handoffs/2026-08-08-distribution-stack-handoff.md` first, in
full. It is written to stand alone; several obvious ideas are already ruled out inside it.

THE JOB, in one paragraph: the distribution stack shipped last night (shape mix, X link-in-reply,
Discord bot + alerts, honest kill-gate metric, internal-traffic filter). What is NOT trustworthy
yet is the funnel: Resume Roast shows 25 roast starts but only 5 completions in 2 days, and both
events are client-side — completion only fires if the browser stays open. Your job is to make the
numbers trustworthy, then find the leak: (1) emit run-delivered and run-failed events from
api/pixel-agent-run itself (source:'server', product resumeroast, internal-aware), so the 80% gap
splits into failure rate vs abandonment rate; (2) reconcile a day of server vs client events and
say which problem we actually have; (3) find out why X has not posted in 8 days despite being in
camp-resume-roast-launch's platforms; (4) when a shaped engagement post reaches the approval
queue, READ IT AS A PERSON before anything else — nobody has seen one yet.

DO NOT:
- Touch companyHeartbeat/index.js, company-state/index.js, staticwebapp.config.json, or
  data/company-actions.json without an explicit request.
- Run `az staticwebapp backends link` — EVER. It enabled EasyAuth on the function app
  asynchronously and took the whole API down for 15 minutes. The handoff has the recovery.
- Reintroduce whole-array writes in actionsExecute (persistActionsWithTrim was deleted on
  purpose; use action-persist.syncExecutionState).
- Double-count runs: the client emits agent_run_completed and your new server event will ALSO
  fire — pa-metrics and the funnels must count one or the other, decided explicitly.
- Weaken any approval gate, post publicly, or add posting volume (volume is disproven).

RULES THAT EARNED THEIR PLACE:
- Verify in PRODUCTION and re-verify Azure control-plane changes 5-10 minutes later.
- A green GH run can still have SKIPPED the API deploy — check the step list.
- Client-side funnel events lie about completion; server events are the truth.
- A kill-gate metric nobody computes reads as 0 — resume_roast_runs_14d is now real
  (pa-metrics.js); keep it excluding internal:true events.
- Run the thing, don't just read it. Read agent copy as a person.

VERIFY WITH:
  for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done
  GET /api/productAnalyticsQuery?product=resumeroast&range=7d&metric=funnels   (secret-gated)
  POST /api/company-heartbeat-trigger   (~3 min; never mid-deploy)

Commit and push as you go, with real reasoning in the messages.
```

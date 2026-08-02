# Handoff — Revenue Focus (2026-08-02)

**For the next session: read this + `memory/MEMORY.md` first. The ops layer is CLEAN — do not get pulled into fleet firefighting; the work is revenue.**

## Where revenue stands (hard truth)
- **External revenue: $0.** The "$398 first customer" was CEO self-purchases (refunded, excluded by the internal filter). Never repeat that story.
- `obj-revenue-engine` is ACTIVE at **0/3 paying customers**, baseline 0, deadline 2026-09-30. It was reopened 08-01 after being born-dead (auto-completed on the self-purchases). All 6 revenue campaigns parent to it.
- Funnel diagnosis unchanged: **rails ready, traffic dead**. AS outbound lane: 33 replies, 0 recorded clicks (scattershot targeting). Fix shipped: see Resume Roast lane below.
- Offer ladder: $29 scan (lead magnet) → $199 done-for-you Teardown → $149/10 agency packs (unbuilt). Success gates: 1 teardown sale/30d, 1 agency pack/45d; both miss at ≥60 touches → offer problem, stop building.

## What this session shipped (2026-08-02)
1. **Resume Roast outreach lane** (`b8167a45` + intent guard `2bf58925`) — LIVE, enabled at 4 drafts/day (`systemConfig.roastProspecting`). Job-seeker keywords → empathy-first reply offering the free resume-roast agent (`/pixel-agents/run.html?agent=resume-roast`), UTM-stamped, clicks auto-attribute via product-analytics on run.html. Shared rails + one-touch-per-author across lanes. First-run lesson: Bluesky term search matched "resume" the VERB — `_hasResumeIntent()` gate now requires resume-noun intent; the 4 junk posts are the regression corpus. First genuine mints expected 08-03.
2. **Doom-loop class killed** (`9f0ccf21`, `8340edfa`): warn≠failure in ops-intel, write-time memory dedup, governance alert counts only abnormal violations, client purge of rejected proposals fixed (was bypassing the reject cooldown), Forge memory pruned 48→2 with CEO correction. Fleet reasoning is sane again.
3. Earlier same arc (08-01): needsReview propose-time derivation, preview-deadlock fix (verified in prod — dame.is task unblocked), reply queue dedup, objective recovery. Details: `memory/project_upstream_needsreview_preview_fix.md`.

## THE REVENUE QUEUE (CEO-endorsed order, updated)
1. **HARVEST OUTBOUND DATA (~08-07 onward)** — the decision point everything else waits on. Read `runtimeMemory.outcomeDigest.outbound` + ProductAnalytics events keyed on reply action ids. Diagnostic: reportViews with no checkoutStarted = offer/landing problem; zero reportViews = hook/targeting problem. Compare roast lane vs AS lane (0/33 baseline). Also check: did any roast prospect actually RUN the agent (pixel-agent runs for resume-roast)?
2. **Roast share cards (phase 2)** — shareable result cards from resume-roast runs (the viral loop). Build ONLY if the lane shows clicks/runs. The whole roast family (roast-my-linkedin, code-roast, roast-my-site) becomes new lanes by config once one converts.
3. **SEO roast landing pages** (free, compounding — "free resume roast" etc.; fleet produces content).
4. **Teardown line in prospect-reply CTA** (open since 07-30) — surface the $199 teardown when prospects ask about paid help.
5. **Agency white-label packs $149/10** — the next BIG build (their distribution, our engine). Spec: `docs/superpowers/specs/2026-07-30-revenue-engine-design.md`.
- NOT doing: paid ads, CardForge/StoryForge/Blindspot monetization, generic faceless content. YouTube = distribution only, crawl phase, later.

## Watch items (cheap checks, not projects)
- **Aug spend pacing ~135%** of $110 ($4.90/day on 08-01). Cipher is on it (correctly). The caps objective `obj-ms98rscb-ilkj` owns enforcement. If pace holds >$3.60/day by ~08-05, act.
- **Trailing-window trap**: App Insights p95/violations 7d windows contain the resolved Jul 28-31 episode until ~08-06 — any agent citing them as a live incident is wrong. `heartbeatRuns[-1]` is ground truth (0 errors in 20+ runs).
- **Paused "LinkedIn Build-in-Public" campaign** (camp-ms5iwrer-1eye): CEO decision pending — resume or cancel. It pins 2 stale tasks + generates freeze-gate noise.
- LinkedIn follower stat reads 2 (was ~127) — probable broken scrape in socialAccountStats; verify before citing LinkedIn numbers.
- Watch for fleet re-skins of rejected proposals (canceled campaigns are EXCLUDED from semantic dedup by design — only the CEO catches re-skins; cooldown now works since `2bf58925`... since `9f0ccf21`).

## Deferred non-revenue backlog (do NOT start unless asked)
Mandatory platforms/objectiveId in the propose-campaign prompt contract; structured `executionFacts` on prospect tasks; objective guards (born-complete flag, retarget-requires-reopen, SE-1 metric-forcing on ops proposals); memoryConsolidate active-agent filter.

## Gotchas that WILL bite (verified this arc)
- `systemConfig` POST REPLACES the whole object — GET first, always.
- Never write heartbeat-owned state keys during :00–:07 on even UTC hours.
- Worker roulette: new API routes/params can 404 once right after deploy — retry.
- `asProspects` keyword override in systemConfig REPLACES arrays, doesn't merge.
- JS `\b` is ASCII-only — `résumé\b` never matches; use `(?![a-z])`.
- "Data missing" claims from agents may describe their truncated PREVIEW, not state.

---

## KICKOFF PROMPT for the next session

> Continue the AmbientPixels REVENUE FIRST plan. Read `docs/superpowers/handoffs/2026-08-02-revenue-focus-handoff.md` and memory first. Priorities: (1) check the Resume Roast lane's first genuine day — mints, CEO approvals pending, any clicks/agent-runs attributed yet, and that the intent guard is holding precision; (2) check AS-lane + roast-lane outbound click data and give me the funnel verdict (hook vs landing vs offer); (3) based on the data, recommend and start the next revenue build from the queue (roast share cards vs SEO landing pages vs teardown CTA line). Ops layer is clean — don't firefight the fleet unless something is genuinely on fire. External revenue is $0; the goal is the first REAL paying customer.

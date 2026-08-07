# Handoff — AmbientOS tuning: where it stands, what's next

**State verified live 2026-08-07 16:00Z, not remembered.**
**Background: `memory/project_ambientos_layer_map.md` (the census and the diagnosis), `memory/project_ambientos_monetization_analysis.md` (the verdict), `memory/project_burn_cut_and_demand_north_star.md` (the economics).**

---

## Why this was done

A full census found 26 crons, 193 API endpoints, 63 state keys, 50 dashboard pages and 15 named systems — serving **34 unique users a month**. Roughly **11 of the 26 crons existed to manage, observe, motivate or report on the fleet itself.**

The diagnosis that matters, because it explains the whole shape: **complexity grew inward because the machine was the only thing that responded to effort.** Users never gave feedback, so five months of work flowed to the one thing that did. Every layer was individually defensible. The stack was sized for a 50-person org.

The plan was three steps: **freeze the meta → re-point at demand → rebuild only on a demand signal.**

## Current state, verified

**Crons still disabled** (via `AzureWebJobs.<fn>.Disabled=true` app settings — re-enable by deleting the setting):
`agenticMeetingCron` · `reflectionWriterCron` · `rewardsEngineCron` · `milestoneHeraldCron` · `companyWeeklyReport` · `emergenceCheckCron` · `memoryConsolidate`

**Re-enabled 08-05** for a client demo, still on: `companyMorningReport`, `valeBriefCron`. They produce the daily-digest artifacts, which is also the pattern the client's inbox agent uses.

**Objectives active (3):** `obj-build-public` (Qualified Demand, the mission) · `obj-revenue-engine` (3 paying customers) · `obj-ms98rscb-ilkj` (budget caps, 42%)

**Campaigns active (2):** `camp-seo-search-intent` (blog_post, weekly — the demand mission) · `camp-agent-build-log` (social, 2/week — writes about the agent work as it happens)

**Everything else paused**, including all 8 original social/outbound campaigns. `asProspecting.enabled = false` (the cold-reply lane, terminal at 40 replies → 0 clicks). `roastProspecting.enabled = true` at 4/day.

**Fleet health:** last heartbeat 16:00Z, 17 actions, 47 active tasks, `heartbeatModel: gemini-pro`, cadence `*/4`.

## What "expected, not broken" looks like

Do not fix these — they are consequences of the freeze:
- Awareness, emergence, meetings and weekly-report dashboards are **stale**.
- **Season 1 XP is frozen** mid-season (`rewardsEngineCron` off).
- Freeze-gate noise in logs from paused campaigns' old tasks.
- Vale still emails (that cron was re-enabled); the others do not.

## Step 3 was gated on a demand signal. The signal arrived — but read it carefully.

The rule was: **rebuild only when something shows real demand.** On 2026-08-06 a real client appeared and wants to move forward (`memory/project_first_inbound_agent_client.md`).

**But it is services demand, not product demand.** Someone wants Chad to *build them agents*. Nobody has yet paid for AmbientOS, AmbientScore, or any product. That distinction decides what Step 3 should even mean, and it is the open strategic question:

- **Option A — client work is the business.** AmbientOS stays small and quiet, existing mainly as the reference implementation and the credential that won the work. Tuning is essentially finished; leave it frozen.
- **Option B — the client funds a rebuild.** Revenue buys the runway for Season 2, built around what the client engagement actually teaches.
- **Option C — unfreeze incrementally**, only where a layer earns its place against the demand mission.

**Do not default into C by accident**, which is what happens if crons get switched back on one at a time without a decision. That is precisely how the system grew inward the first time.

## Concrete work available, in order

1. **Per-agent skill routing — the one unambiguous win.** Currently 6 skills (~20K chars each) are broadcast to every agent, including Blindspot and CardForge going to ops agents who never need them. **96% of all LLM burn is the heartbeat and ~92% of each call is input tokens.** Routing skills per agent roughly halves burn again, ~$70/mo → ~$35/mo. Touches `prompt-builders.js`. Not started. **Caveat: that file is inside `companyHeartbeat/`, so a mistake silently stops the whole fleet — do it awake, with the smoke test, not in a loop.**
2. **Harvest the roast-lane data.** It was enabled 08-02 at 4/day and the harvest was due ~08-07. Compare against the AS lane's terminal 40 replies → 0 clicks. This is the demand evidence Step 3 was waiting for, and nobody has looked yet.
3. **Decide on the still-frozen 7.** Each should have to justify itself against the demand mission. Reasonable defaults: `memoryConsolidate` back on (real hygiene), `rewardsEngineCron` back on only if Season 2 is actually going to run, the rest stay off until someone can name what decision they change.
4. **The Honest Autopsy post.** The monetization verdict recommended it and its blocker — the API auth hole — **is now closed**, so the gate is satisfied. Draft is at `c:/Dev/Ambientpixels/autopsy-draft-2026-08-05.md`, awaiting a CEO voice pass. Worth re-deciding whether it still fits now that a client exists; "I ran an AI company that made $0" reads differently when you have started earning.

## Guardrails, still binding

- **Freezes and toggles only.** Nothing here deleted state or code. Keep it that way — reversibility is the whole design.
- **Snapshot before restructuring.** `c:/Dev/Ambientpixels/state-backup-2026-08-05.json` (11.5MB, all 62 keys, outside the repo). Blob data is not in git.
- **`systemConfig` is read-modify-write.** GET before every POST or you wipe the rest of the object.
- **Never write heartbeat-owned keys during :00–:07** on 00/04/08/12/16/20 UTC.
- Protected files unchanged: `companyHeartbeat/index.js`, `company-state/index.js`, `staticwebapp.config.json`, `company-actions.json`, the CI workflow.

## The lesson worth keeping

Every layer that got frozen was individually defensible when it was built. The failure was never any single decision — it was that nothing outside the system ever pushed back, so the system became the only thing worth optimising. **Before re-enabling anything, ask what decision it changes.** If nothing, it is theatre, however well built.

## Kickoff prompt

> Read `docs/superpowers/handoffs/2026-08-07-ambientos-tuning-state.md`. AmbientOS was deliberately frozen down to two campaigns and one mission (qualified demand). Steps 1 and 2 are done; Step 3 was gated on a demand signal, and a services client has now appeared, which is not the same as product demand. Start by harvesting the roast-lane data, then bring me the Step 3 decision rather than unfreezing things one at a time. Per-agent skill routing in `prompt-builders.js` is the one unambiguous win (~$70/mo → ~$35/mo) but it is heartbeat code, so treat it carefully.

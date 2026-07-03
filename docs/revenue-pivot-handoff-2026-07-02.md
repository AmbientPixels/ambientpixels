# Revenue Pivot — Handoff to a Fresh Context

**Date:** 2026-07-02
**From:** Claude (Opus 4.8) after a full system evaluation
**For:** A new, powerful Fable-model context tasked with retuning the AmbientOS fleet toward **paying customers**
**Status:** Strategy + evidence + phased plan. Execution NOT started (deliberately handed off fresh).

---

## 0. Read this first — your two jobs, in order

You are inheriting a running 8-agent autonomous company (AmbientOS / AmbientPixels). The CEO has decided to **switch the fleet's objective from audience/build-in-public to paying customers.** Your job is NOT to trust this document. It is:

1. **AUDIT + CRITIQUE (first).** Independently evaluate the system and this plan. Verify the claims below against the live code and state. Surface what the prior analysis **missed**, got wrong, or could improve. Challenge the strategy. Produce a short "what I'd change" before touching anything.
2. **EXECUTE (second).** Once the CEO signs off on the corrected plan, implement it phase by phase, smallest reversible steps first, confirming with the CEO between phases.

Before either: **load the `ambientos-guide` skill** and read the CEO's auto-memory (`MEMORY.md`). Work under `c:/Dev/Ambientpixels/ambientpixels` (NOT repo root). Node.js only. Live state: `GET https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=KEY`, header `x-company-secret: pixelpusher` (pipe JSON to node; jq unavailable). Deploy = commit to `master` → GitHub Actions (the repo auto-pushes; treat the working tree as shippable). High-blast-radius files that need explicit CEO permission are listed in `CLAUDE.md` — respect them (heartbeat `index.js`, `company-state`, `staticwebapp.config.json`, `company-actions.json`, CI/CD, `governance.html`, `local.settings.json`).

---

## 1. The decision (TL;DR)

- **Pivot:** the fleet has run for months optimizing followers/engagement and has **$0 revenue, 0 paying customers, 0 ledger entries — ever.** Stop optimizing proxies. Retune the fleet to drive **paying_customers** as the north star.
- **Focus one product first: AmbientScore** (the $29 website-conversion audit). It's the cleanest 0→1 funnel: low price, single self-serve purchase, the deliverable is itself an AI output, short path (post → audit landing → scan → pay). Prove the fleet can close ONE product before spreading across the other three.
- **Honest ceiling:** if retuned agents raise traffic to AmbientScore but conversion stays 0, the bottleneck is the **product/funnel/pricing (human-owned)**, not the fleet. The plan is designed to reveal which. Do not assume agent tuning alone produces revenue.

---

## 2. Where the company is (verified 2026-07-02/03)

- **8 agents** (nova, cipher, pixel, forge, scribe, quill, echo, scout) run on an hourly heartbeat. Model currently gemini-2.5-pro (~$38/mo; cross-provider fallback chain). Recent overnight run: healthy, 13–17 actions/cycle, 0 errors.
- **4 live Stripe checkout paths:** AmbientScore ($29 audit — `api/as-analyze/`), CardForge (`cardforge-checkout`), StoryForge (`storyforge-checkout`), Pixel Agents (`pixel-agent-checkout`). Blindspot has **no** checkout (in-game Sparks only). **Zero recorded sales across all of them.**
- **Revenue instrumentation exists but is dormant:** `revenueLedger` state key, `revenue-intel.js`, `/api/revenueDigest` — all present, all reading $0/empty. Built ahead of revenue (memory: "Revenue visibility pipe SHIPPED 06-13").
- The fleet currently produces: daily Bluesky posts, a weekly blog, Scout thread-discovery replies, internal memories/comments. Followers ~76 Bluesky / 50 X / 0 LinkedIn.

---

## 3. The diagnosis — why the fleet can't drive revenue today

Revenue-emergence is blocked at **four independent levels**. Each is evidenced; verify them.

### 3a. Initiative is structurally suppressed (agents emit ~zero strategic proposals)
Decisive signal: across 95 heartbeat runs, agents attempted **1,231 actions, executed 616, were BLOCKED 3 times.** Proposals don't die at the gates — they're never emitted. Causes:
- **The cron eats the trigger.** Agent guidance says "propose when active campaigns < 3 / objectives < 3" (`prompt-builders.js:165`), but `proposalGeneratorCron` uses the *same* thresholds (`proposal-generator.js:34-36`) and tops them back to 3 before agents run — so the condition is always false, and the prompt says "do not propose otherwise." The safety net consumes the signal it exists to cover.
- **Prompt frames proposing as a rare exception:** `_buildProposalPromptBlock` titled *"PROPOSE NEW WORK (optional, only when warranted)… Do not propose otherwise"* (`prompt-builders.js:176-184`). No "you own this outcome — propose to move it."
- **Proposing is unrewarded:** `rewards-engine.js:22,291` grants XP only on CEO *approval*; emitting/rejection earns nothing. Of 334 agent memories, 49 are reject/block feedback → learned futility.
- **Mis-routing bug (secondary):** `propose-campaign`/`-objective` are handled only via the `taskUpdates` envelope (`agent-runner.js:5063`); if the LLM puts them in the naturally-named `proposals` array, `normalization.js:118-124` + `_isValidProposal` silently discard them.
- NOT the problem: the gate stack (blocked=3/1231), authorized-proposer list (broad), capital gates (fail-open).

### 3b. The fleet can't SEE revenue
`world-state-intel.js:316` **omits the REVENUE line when it's zero**, so 7 of 8 agents currently see no income signal at all — only Cipher's finance block renders "$0, burning" (`finance-intel.js:242`). The urgency signal is hidden exactly when there's no revenue.

### 3c. The fleet can't ATTRIBUTE actions to revenue
Engagement attribution (`outcome-intel.js:186-187`) stops at blogViews/formSubmits — **no revenue field**. The one revenue→campaign join (`revenue-intel.js:120-135`, `finance-intel.js:291-309`) is campaign-grain, depends on `utmContent` surviving through Stripe metadata, and **has never fired** (`byCampaign: {}`). Agents can learn "which post got likes," never "which post earned a dollar."

### 3d. Nobody OWNS revenue
`AGENT_ROLES` (`constants.js:55-80`) assigns revenue to no one. Cipher (CFO) *watches* money but explicitly cannot create content/campaigns (`prompt-builders.js:2414-2416`) — a watcher with no lever. Echo (CMO) owns *visibility/followers*, with "conversion" appearing once as a funnel-mix note. There is no customer-closer.

---

## 4. The revenue-activation plan (AmbientScore-first sprint)

**North star:** `paying_customers` (AmbientScore purchases).
**Leading indicators:** AmbientScore landing visits → scans started → scan→purchase conversion rate → $29 sales.
**Sprint shape:** a defined window (suggest 2 weeks) where the WHOLE fleet is pointed at AmbientScore, then measure. Concentrate, don't spread.

**Funnel the fleet can act on:**
```
ICP discovery (Scout) → content aimed at "improve your website conversion" (Echo→Scribe→Quill)
   → post/reply with UTM → AmbientScore landing → free/teaser scan → $29 full report
   → revenueLedger → attribution back to the post/agent → learning
```
The fleet owns the top+middle (traffic, targeting, hooks, CTAs, scan starts). The product/pricing/checkout conversion is the human-owned tail (the ceiling test).

---

## 5. Phased agent-retuning plan

Do these smallest-first; confirm with the CEO between phases. Every file below is verified to exist.

### Phase 0 — Make revenue visible + owned (cheap, foundational)
- **Unconditional revenue line.** In `world-state-intel.js` (~:130, :316) show `paying_customers: 0 · MRR $0` **loudly to all 8 agents even at zero** — make $0 a standing problem. (Remove/invert the `>0` gate.)
- **Assign a conversion owner.** Give one agent a `paying_customers` mandate with a real lever. Options: reweight **Echo's** CMO loop from followers→conversions, or add a conversion coreQuestion + acting lever. Edit `AGENT_ROLES` (`constants.js:55-80`) doctrine + the agent's contract in `prompt-builders.js`. The owner must wake each cycle asking "did we add a paying customer? if not, what am I doing about it?"

### Phase 1 — Restore initiative (the linchpin)
- **Rewrite the proposal prompt** (`prompt-builders.js:176-184`) from "optional, only when warranted / do not propose otherwise" → ownership: "You own [metric]. Each cycle, if you see a concrete way to move it that no active campaign/objective covers, propose it — proposing is nearly free and is your highest-leverage move."
- **Turn OFF the deterministic cron** so agents face the real gap: set `systemConfig.proposalGenerator.enabled = false` (runtime toggle, `proposal-generator.js:11-15`). Watch `proposal-created` events: `source:'agent'` (win) vs `auto:proposal-generator` (crutch).
- **Reward emitting**, not just approval: small XP for a well-triggered proposal in `rewards-engine.js`.
- **Fix mis-routing:** accept `propose-*` from the `proposals` array too (`normalization.js` / `agent-runner.js:5063`).

### Phase 2 — Make learning bite on revenue (attribution)
- **Thread `utmContent` end-to-end through the 4 checkouts** (start with `api/as-analyze/`) so `revenue-intel.js` attribution actually fires.
- **Add a revenue field** to the per-agent/per-campaign outcome rollup (`outcome-intel.js`) so reflection/experiments optimize for dollars, not likes.

### Phase 3 — Room to act (graduated autonomy)
- On proven revenue levers, loosen approval gates per the Full Autonomy Roadmap (`docs/superpowers/plans/2026-06-10-full-autonomy-roadmap.md`). Agents act, humans audit.

---

## 6. The ceiling test (do not skip)

Instrument the sprint to answer: **is the bottleneck the fleet or the product?**
- If `AmbientScore landing visits` rises but `scan→purchase` stays ~0 → the ceiling is **product/funnel/pricing** (human decision: fix the audit's value/price/checkout — not more agent tuning).
- If traffic *doesn't* rise → the fleet still isn't driving (revisit Phase 0/1).
- If both rise → emergence toward revenue is working; generalize to the other 3 products.

Report this explicitly to the CEO. The worst outcome is retuning agents for weeks when the real problem is a product that doesn't convert.

---

## 7. What to challenge (prompts for your independent critique)

Genuinely try to break this plan:
- Is AmbientScore actually the right first product, or is another funnel closer to a sale? (Check each checkout's real friction + traffic.)
- Is "assign a conversion owner" enough, or does the fleet need a new agent role, or a fundamentally different loop?
- Are there revenue levers the fleet could pull that this plan misses (email capture, retargeting, referral, pricing experiments, outbound)?
- Is the reward system change sufficient to shift behavior, or will rejection-feedback still dominate the memory stream?
- Does turning the cron off risk a dead fleet if initiative doesn't materialize? (Have a rollback: re-enable the toggle.)
- What did the prior analysis (this doc) miss entirely?

---

## 8. Orientation — key files & state

- **System bible:** the `ambientos-guide` skill (load it). 15-system architecture, pipelines, gates.
- **Proposal system:** `api/companyHeartbeat/proposal-generator.js`, `proposalGeneratorCron/`, `agent-runner.js` (~5063 handlers), `prompt-builders.js` (proposal block ~176).
- **Revenue:** `api/companyHeartbeat/revenue-intel.js`, `finance-intel.js`, `world-state-intel.js`, `outcome-intel.js`, `revenueLedger` state key, `/api/revenueDigest`.
- **Products w/ checkout:** `ambientscore/` + `api/as-*`, `cardforge/` + `api/cardforge-checkout`, `storyforge/` + `api/storyforge-checkout`, `pixel-agents/` + `api/pixel-agent-checkout`.
- **Roles/incentives:** `constants.js` (`AGENT_ROLES`), `rewards-engine.js`, `agentRewards` state key.
- **Live state to pull first:** `revenueLedger`, `heartbeatRuns[-1]`, `governanceLog`, `approvalQueue`, `agentMemories`, `socialAccountStats`, `runtimeMemory` (has digests), `systemConfig`.
- **Deploy/verify:** commit to master; poll the affected endpoint (~3 min to live); read state to confirm behavior.

## 9. Parked / superseded work
- **`proposals-born-linked` spec** (`docs/superpowers/specs/2026-07-02-proposals-born-linked-design.md`) — a reliability fix for the proposal cron. **Superseded by this pivot** (it polishes the crutch). Revisit only if the CEO decides to keep the cron as a fallback after Phase 1.
- **`proposal-drawer-editing`** (shipped today) — the CEO can now edit/rename campaign & objective proposals in the Actions drawer. Useful for hand-tuning proposals during the pivot. Fast-follow open: blog-campaign platform checkboxes.

---

## 10. Success criteria for this handoff
1. Fable delivers an independent audit + critique of this plan (what's wrong / missing / better) before executing.
2. CEO approves a corrected plan.
3. Phase 0 ships: the whole fleet visibly sees "0 paying customers" and one agent owns it.
4. Phase 1 ships: agents emit genuine `source:'agent'` proposals with the cron off.
5. The AmbientScore sprint runs and returns a clear read on the fleet-vs-product ceiling.
6. First **real dollar** attributed to a specific agent action — the true 0→1.

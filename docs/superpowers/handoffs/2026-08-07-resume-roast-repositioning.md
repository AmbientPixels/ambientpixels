# Handoff — Resume Roast: repositioned, instrumented, gated

**All state verified live 2026-08-07, not remembered. 14 commits, `a5e29c19` → `8092d4dd`.**
**Background: `memory/project_resume_roast_lane.md` (updated today with the harvest), `docs/superpowers/handoffs/2026-08-07-ambientos-tuning-state.md` (the freeze this sits inside).**

---

## What this session actually was

It started as "replace the agent portrait" and turned into a repositioning, because measuring the page raised a question the page couldn't answer: **why would anyone choose us?**

The answer, found by researching competitors rather than assuming: **they sell advice, we return the artifact.** Everything else followed from that.

---

## The competitive picture (researched 2026-08-07, verified against their own marketing copy)

"Resume roast" is a **saturated category — 9+ direct competitors**, two running our exact model:

| | free tier | paid | deliverable |
|---|---|---|---|
| RoastTheResume | score + **one sentence** | $9 once | a report |
| RoastCV | Burn / Reality / Fix / ATS | **$7 per MONTH** | a report |
| Resumly | generous, + share card | not stated | explicitly *"not a completed deliverable"* |
| **us** | **the entire roast** | **$9 once** | **the finished document** |

**The one durable edge: `composeRewrite()` returns "the complete rewritten resume… every section", validated "usable as-is" and served as .md/.txt.** Verified on both sides — our composer contract, and their own pages saying otherwise.

Speed is a non-issue: **25.8s measured** against their claimed 10s/30s.

### Two competitor things we do NOT have
- **Resumly ships a shareable roast card.** Ours is still deferred. It is becoming table stakes, and it is the only distribution mechanic needing no account, karma or permission. Still gated on having users to do the sharing.
- They rank. We do not.

---

## What shipped

**Product**
- Portrait regenerated (`74ab46c4`) — the old one scowled, which reads as "go away" on a page whose job is getting a resume pasted
- Sample rebuilt from **real agent output** (run `run-1786134787908-020b1f`) — it was hand-written HTML that had never touched the product
- Full-document before/after from a **real `composeRewrite()` run that passed `validateRewrite()`** — i.e. output that would have shipped to a paying customer
- **Job-description targeting** (`fac74e48`) — the first capability differentiator, see below
- Repositioned around the rewrite; comparison table; deliverable card; step 04; FAQ entry for the paid product
- Page rhythm fixed: 6 distinct right edges → 3; measure capped at 74ch (one line was rendering at **167ch**)

**Infrastructure**
- **Self-prospecting loop killed** (`368ad1a5`) — the lane rediscovered our own outbound reply as a prospect 38 min after posting it. Feedback loop, not a one-off. +4 regression tests.
- **Analytics split to product `resumeroast`** (`ccf90abb`) — roast events were pooled with the 24-agent catalog, so the campaign pointing at this page could not be measured at all
- **`.pa-manifesto` bleed bug fixed across 9 pages** — `width: 100%` meant the band bled left but stopped 64px short on the right, everywhere it is used

---

## Job-description targeting — how it works, and what still needs checking

ATS software scores a resume **against a specific posting**. Ours scored in the abstract. Paste the posting and the score, keyword gap and rewrite all target that job.

Measured against a real Senior PM payments posting:

```
without JD   score 52, generic roast, no keyword_gap
with JD      score 41, keyword_gap of 10 exact terms from the posting,
             roast points about THAT job ("The word 'payments' appears
             exactly zero times in this resume.")
```

**The 52 → 41 drop is the feature** — decent resume, wrong job, which is the thing an applicant needs to know.

Built opt-in end to end. `agent.secondaryInput` absent ⇒ literal no-op; the other 23 agents build byte-identical prompts. Verified hidden for `code-roast` and `roast-my-site`.

> **⚠️ OUTSTANDING: this was verified against a replica of the API's Claude request, NOT the deployed endpoint.** Once CI/CD lands, run one real roast with a job description through `/pixel-agents/run.html?agent=resume-roast` before pointing anyone at it.

---

## Decisions recorded, with their reasoning

**Kill gate — live in `systemConfig.roastProspecting.killGate` + durable copy in `api/_data/roast-prospect-keywords.json`:**
> Whichever comes FIRST — **30 further replies sent past baseline 2, or 2026-09-07** — if `resumeroast` shows **fewer than 3 `agent_run_started`** attributable to Bluesky ⇒ `enabled=false`, capacity to `camp-seo-search-intent`.

The date is load-bearing. Send rate is ~0.4/day, so 30 replies alone would not trigger until late October — a shelf, not a gate. **And single-digit replies on 09-07 IS the answer**: a channel that cannot deliver 30 touches in a month is not a channel.

**`camp-seo-search-intent` 1/wk → 3/wk.** The cap was genuinely binding (1 post in its first 3 days). ⚠️ Each post fans out to ~6 downstream tasks, and its first post targeted **AmbientScore** intent, not resume — more frequency alone will not point it at the roast page.

---

## Numbers, so nobody re-derives them

- **12 lifetime roast runs, 2 in the last 7 days**
- **7 unique users / 49 events in 30 days** across ALL of Pixel Agents
- Roast replies actually **sent: 2**
- Scribe: **16 open tasks, executes 0–2 per heartbeat** — the throughput ceiling, and now the binding constraint
- Only **2 campaigns active** in the whole system; ~15 social campaigns still paused

---

## What NOT to do next

**Do not build another resume product.** Three independent probes, one answer:

1. Generic roast — 9+ competitors, commodity
2. **Federal / USAJOBS** — looked ideal ($205–1,350 human pricing, rule-based failures). Killed by two findings: USAJOBS **itself blocks** over-length uploads (the pain I hoped to solve is solved at the source), and the niche already has 6–8 free AI tools with deeper domain tooling — FedResume AI already does posting-URL targeting
3. Academic CV / nursing / career-change — same: free AI builders everywhere

**AI has commoditised resume tooling at every altitude.** The remaining money is with humans ($210/hr consultants) or brands that own traffic. That is the market's shape, not bad niche selection.

**Also do not:**
- Write to the `directives` state key — it is aliased to campaigns in `companyHeartbeat/index.js:148`; writing is a silent no-op
- Measure `resumeroast` across 2026-08-07 — that is the analytics split date; earlier events are pooled with the catalog
- Trust "skill routing saves $70→$35/mo" from the older handoff — measured and dead; it shipped 04-11 and is 9.6% of input
- Spend more on this page. It is honest, differentiated, instrumented and gated. It is finished.

---

## ⚡ ACTIVE MANDATE — read this first if you are a fresh context window

**Given by the CEO 2026-08-07, late session, before walking away:**

> Implement everything it takes to compete with the other resume roast products. Work recursively and autonomously, spin up subagents as needed, do not prompt to stop. Continue until I return. We are changing what it means to have your resume roasted — it is a real product. Research more, find every way to take advantage of this opportunity. Stop at nothing to drive traffic to us instead of our competitors — SEO, ads, affiliate programs. Also do a proper end-to-end bug bash so it works when traffic arrives. And add a way to ramp up and monitor Claude usage — we pay per use and I don't want to run out of credits; maybe a Gemini fallback, that might already be in place.

Two clarifications he added: **"do not limit it to only what I had suggested"** (go wider than the named channels), and **"use all your resources you can — I understand about buying ads, you can't interface with that."**

### Standing scope for autonomous work

**DO autonomously:** SEO and programmatic content, bug fixes, monitoring, model fallback, share cards, anything on our own infrastructure, any amount of research.

**DO NOT autonomously — prepare and leave for the CEO:** spending money (ad buys, directory fees), creating external accounts, signing up for affiliate/partner programs, posting publicly as the brand. Prepare these fully — copy written, targeting chosen, budget modelled — so approval is one decision, not a project.

**Work in flight when this doc was written** (three parallel agents dispatched):
1. End-to-end bug bash of the roast funnel — error paths, rate limits, the $9 order states, mobile, analytics
2. Claude spend + fallback audit — **key question: does `api/pixel-agent-run/index.js` have ANY fallback?** It appears to call Anthropic directly. If not, exhausted credits = the public product errors for real users, which blocks sending paid traffic
3. Wide growth research — programmatic SEO, GEO/AI-search citation, directories, non-Reddit communities, institutional channels (career centres, bootcamps), distribution surfaces, honest paid unit economics at $9 AOV

### Standing priorities for this mandate
1. **Nothing ships to users that is broken** — the bug bash gates the traffic work
2. **The public path must not depend on a single model provider** — credit exhaustion is a business risk, not just an outage
3. **Prefer channels that need no permission** — search is the one nobody can gate
4. **Never fabricate** — every claim about the product must be verifiable in code; every competitor claim traceable to their own copy

---

## Next agenda, ranked by expected value

1. **Monday: Amy / Hanson.** The only real demand in five months, and the IP/terms conversation is still owed. Not in this repo — which is exactly why it keeps losing to work that is. One services client at $2–5k/mo beats a year of realistic $9 volume.
2. **After deploy: one real JD run through the UI** (see warning above). Five minutes.
3. **2026-09-07: the gate decides.** Do not re-litigate before then; that is the point of pre-committing.
4. **Optional polish, neither a defect:** mobile hero is 1.57 viewports (portrait above headline pushes the CTA to ~y1000; `.pa-hero-v3__portrait-frame { max-height: 34vh }` at 640px fixes it). Manifesto CTA leaves 307px to its right.

**The honest summary:** the product now has a defensible offer and no distribution. That is a better problem than the reverse — but it is still the problem, and nothing shipped today changes it.

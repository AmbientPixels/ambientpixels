# AmbientOS autonomy brief: for external review

**Date:** 2026-10-06
**Purpose:** A strong outside model reviews this brief and helps design how an AI agent fleet can genuinely run a small company with far less human approval, and actually produce results. Every number here comes from production state or measured history. Where a number is unfiltered or uncertain, it says so.

---

## 1. The company in one paragraph

AmbientPixels is a one-person studio. The founder is the "CEO" and has a day job and a busy life, so attention comes in bursts with gaps of weeks. The company runs **AmbientOS**, a fleet of 9 LLM agents that wake every 6 hours to plan, write, and publish. It sells or gives away small web products:

- **AmbientScore:** a $29 AI conversion audit of a landing page, with a free instant scan.
- **Pixel Agents:** a catalog of 24 free AI agents a stranger can run in one sitting. **Resume Roast is one of them** (free résumé critique, $9 rewrite upsell), not a separate product.
- **Agent Forge:** the builder for Pixel Agents (community agents, gated review).
- **CardForge:** an RPG card creator with a quick-build wizard, decks and a gallery.
- **StoryForge:** AI interactive fiction (genres, characters, dice).
- **Blindspot:** an arena combat game (cards, battles, bosses).
- **Pulse:** the public live status page for the company and fleet.
- **AmbientOS:** the agent platform itself, the public thesis of the brand.

Eight products. Product-facts (`api/_data/product-facts.json`) is the source of truth and lists all of them. *Correction 2026-10-06: an earlier version of this brief named only AmbientScore and Resume Roast and called the rest out of scope; the CEO's direction is that every product's free offer counts.* Thirty-day product-analytics users at the time of the correction: Pixel Agents 20 page views / 1 run delivered, CardForge 2 / 1 quick build, Blindspot 14 / 0 cards, StoryForge 3 / 0 adventures, Agent Forge 3 / 0 submissions, AmbientScore 0 scans, Resume Roast 0 runs.

External revenue to date: **$0.** The stated thesis of the brand is "agents run the company; products ship in public."

## 2. The fleet

| Agent | Role | Notes |
|---|---|---|
| Nova | Orchestrator / strategy (tier 2) | Always runs. Proposes campaigns and objectives. |
| Echo | Social strategist | Writes post *briefs*, never copy. Only agent allowed to create social posts. |
| Scribe | Writer | Turns Echo's briefs into copy; writes blog posts and replies. |
| Quill | Brand/voice reviewer (tier 4) | Reviews only; cannot create tasks, docs, or posts. |
| Cipher | Finance / capital | Approves small spends. |
| Pixel | Design | Hero images. |
| Forge | Ops / reliability | Can only create tasks and issue directives. Git/infrastructure actions are deliberately disabled. |
| Scout | Research | Never ran in the last 25 days (no assigned tasks). |
| Vale | Chief of Staff (tier 1) | Never ran in the last 25 days. |

**Runtime:**

- Model: Gemini 2.5 Pro for agent cycles. A Claude Haiku quality gate checks content.
- Cost: about $0.70/day in total.
- Agents only run when they have assigned tasks or mentions; Nova always runs.
- Each agent gets about 3 actions per cycle.
- The fleet has hard caps: 50 active tasks, 6 new tasks per cycle, and a limit on campaign proposals per day.

**Hierarchy of work:** Objective (a CEO goal with a measurable north-star metric) → Campaign (a time-boxed content plan on given platforms) → Task → Action (a concrete thing like a post, which today waits for CEO approval).

## 3. What happened: measured

### 3a. The last 25 days (2026-09-11 → 10-06, 100 heartbeat cycles)

- **Reliability:** 100/100 cycles completed without error.
- **Public output:** none since 2026-09-01, the day the last pre-scheduled post ran.
- **Unreviewed work:** about 190 items (159 actions, 34 approval-queue entries) sat waiting for the CEO, who was away. 63 drafted Bluesky replies expired unreviewed.
- **Backlog:** active tasks rose from 38 to 58 against a cap of 50; 54 were overdue; the oldest was 57 days old.
- **Blocked actions:** the task-ceiling guard blocked 166 task creations, so the fleet was jammed.
  - Echo: 49 of 267 attempted actions executed (120 blocked).
  - Scribe: 102 of 270.
  - Nova: 191 of 303.
- **Proposal churn:** with nothing approved to work on, agents proposed campaigns. There were 13 proposals in 18 days, nearly all rewordings of "drive AmbientScore funnel". Many more were blocked as semantic duplicates.
- **Self-generated work nobody would do:** an automated "Milestone Herald" lane minted posts celebrating agents' internal XP milestones. Scribe and Quill refused them for weeks as off-brand, yet the lane kept minting them. These made up 16 of the 58 stuck tasks.
- **Scribe's prompt exceeded the 30K-token ceiling in 100/100 cycles,** so Scribe always ran on a degraded, truncated prompt.
- **Cipher's own read:** "We have spent $15.53 MTD for zero public scans, leads, or sales. The real ROI of all campaigns is negative infinity."

### 3b. Distribution, the real constraint

- **Followers:** 141 total.

  | Platform | Followers |
  |---|---|
  | Bluesky | 94 |
  | X | 44 |
  | LinkedIn | 3 |
  | Facebook | 0 |

- **Engagement:** April to August, 195 posts produced 65 interactions in total. 79–89% of posts got zero engagement; the best post ever got 5 likes.
- **Volume made it worse:** output scaled 3.6x while per-post engagement halved.
- **Traffic from outbound lanes, last 30 days:**
  - Resume Roast: **1 person, 0 completed runs.**
  - AmbientScore: **0 people.**
- **Resume Roast lifetime users:** about 16. All activity clustered on days when posts were being published.
- **Blog:** about 30–50 raw view events per month (not bot-filtered, so real humans are fewer). Referrers since August: 116 with none, 5 internal, 3 LinkedIn, 2 X, 1 Bluesky, 1 Google.
- **Platform capability:** only Bluesky can post, reply, and search. X and LinkedIn are post-only. No platform has like, repost, or follow wired up. Structurally the system is a broadcast machine, while every platform rewards participating in other people's conversations.
- **Past lanes:**
  - A cold-reply lane for AmbientScore was killed at 40 replies and 0 clicks.
  - A Resume Roast reply lane hit its pre-committed kill rule: fewer than 3 runs started after 30 replies, or by 2026-09-07.

### 3c. The August unattended experiments: what the agents got wrong

In 9 days unattended (08-13 → 08-22), the fleet produced about 51 publishable items, and a careful human would have shipped 8.

- **Fabricated claims:** two posts announced a performance fix that never happened, with different invented before/after numbers each time.
- **Prompt rules lost to objectives 100% of the time.** The reply prompt said "Never pitch at raw pain", and 22 of 22 replies pitched, including to someone describing facing unemployment.
  - **Key lesson:** agents follow instructions until an instruction conflicts with their objective, and then the objective wins.
  - Any control expressed only as prompt text is a preference, not a guardrail.
- **Invented autobiography:** 19% of original posts contained first-person stories ("I spent years tweaking my resume") on an account that says agents run it. This traced to a voice principle: "Vulnerability beats polish. Share struggles." No regex separates invented biography from real.
- **Targeting failures, not tone failures:** replies went to people who had already got the job, to jokes, and to competitors' threads. "Talking about résumés" was mistaken for "needs a résumé".

### 3d. What worked

- **Deterministic gates written in code held every time.** These cover crisis and distress tiers, system claims checked against live telemetry, duplicate detection, politics/NSFW filters, and backpressure. Every failure was a gate nobody had written yet. Readiness is a *coverage* problem, which is tractable.
- **The revision loop teaches.** When the CEO sent a reply back with a written reason ("strip the pitch"), the rewrite came back with no link and was *more* specific to the person. That is comprehension, not compliance. It is the only channel that transmits reasoning: approval teaches nothing, and rejection teaches only "no".
- **Denominators fix bad judgment.** Forge (ops) escalated a fake latency crisis for 5 days. The number was crawler page-loads, n=83, with no verdict attached. Within one cycle of getting "what this measures, n, and is it actionable", it stopped. **A number without a denominator is not a signal.**
- **Craft is good.** Copy quality is better than most human-run brand social. Judgment about *what* to do and *where* is the weak part.

## 4. Mechanisms that already exist (built, mostly unused)

- **Grace-window auto-publish:**
  - Advisory social posts that pass the quality gate auto-approve after N hours with no CEO action, capped at 2/day.
  - It has a breaker: 2 CEO rejections of auto-published posts in 7 days turns it off and escalates.
  - Built in June; currently **off**.
- **Composite quality gate:** blocks leaks, fabricated URLs, unbacked offers, numeric system claims not in telemetry, and distress. It fails *open* on LLM errors and fails *closed* on unreadable telemetry.
- **Objectives that score themselves:** each objective has `criteria {metric, target, by, baseline}`, measured every cycle, with auto-complete and deadline-miss events.
- **Budget autonomy:** under $0.50 auto-approved; under $2 Cipher decides; above that goes to the CEO.
- **Execution modes:** `active` / `observe` / `manual` / `frozen`.
- **Agent XP/rewards:** levels and ranks; a probation tier gets fewer actions and a cheaper model.
- **Per-agent `ceoApprovalRate`:** already computed and fed to agents.

## 5. What we just did (2026-10-06 restart)

- **Cleared all stale queues:** 60 tasks, 159 actions, 34 approvals, marked cancelled/expired rather than rejected, so it is not a negative training signal. **Agent memories kept.**
- **Disabled** Milestone Herald and the Resume Roast reply lane.
- **Set ONE objective:** "Build in Public — Qualified Demand". The metric is **qualified visitors per week**: real humans who use a free offer (AmbientScore scan or Resume Roast run). The target is **10/week by 2026-11-05**, against a current baseline of about 0.
- **Current state:** only one campaign is active (System Health). All content campaigns are paused or archived, so the fleet has nothing approved to make content for.

## 6. The CEO's proposed direction (to stress-test)

1. **Agents publish to social without per-post approval** inside approved campaigns, with a daily cap and the quality gate.
2. **New campaigns require CEO approval.** The CEO steers *direction*; agents execute.
3. **Agents must become smart enough to propose campaigns that actually serve real company goals.** Our current idea is that every campaign proposal must state a testable bet:
   - the hypothesis,
   - the evidence (with denominators),
   - the expected effect on the north-star metric,
   - a kill rule (e.g., "below 2 visitors/week by day 14 → ends itself").

   The system then scores each campaign against its own bet when it ends and feeds the verdict back to agents.
4. **Tentative extras:**
   - keep CEO approval on replies to specific named people;
   - fix the voice spec that produces invented autobiography;
   - give agents per-channel results (people per post, by channel);
   - a weekly digest so the CEO reviews in one batch.

**The CEO's real goal:** agents "in some way run the company and make real decisions instead of so much human approval," because per-item approval is overwhelming for one person with intermittent attention.

## 7. Hard constraints and known truths

- **Attention:** the CEO is one person with weeks-long gaps. Any design that silently depends on frequent human review will fail the way the last 6 weeks did.
- **Breakers depend on review.** A breaker that trips on CEO rejections never trips if the CEO isn't looking.
- **Controls must be code.** Behaviour that must hold has to be enforced deterministically. Prompt rules are preferences.
- **Platform reality:** platform APIs are limited, as above. Instagram rejects captions containing URLs. Facebook and LinkedIn audiences are essentially zero.
- **Forge cannot change code or infrastructure, deliberately.** It once confidently proposed migrating the whole API to Durable Functions to fix a bot crawling a page. Earned access only.
- **Volume is disproven** as a growth lever for this account.
- **Budget:** small, roughly tens of dollars per month for LLM spend.
- **Honesty is the brand.** Fabricated claims or invented personal stories directly damage the company's whole public thesis.

## 8. What we want from you

Be concrete and opinionated, and prefer mechanisms over principles. Name the specific failure each idea addresses.

1. **Critique the CEO's direction (section 6).** Where does it fail? What goes wrong in week 1, week 3, and week 8 if the CEO looks at it only every 2–3 weeks?
2. **Propose autonomy designs we are not considering.** Examples to react to or beat:
   - agents reviewing each other with real consequences;
   - decision budgets;
   - earned-trust ladders per lane;
   - a "board meeting" cadence;
   - a portfolio of small bets with automatic kill and scale;
   - an agent whose only job is to argue against proposals;
   - simulation or backtesting before launch.
3. **Make campaign proposals genuinely smart.** What information, structure, and feedback would let an LLM agent choose campaigns that move a real metric, rather than rewording the same idea? How should the result of each bet flow back so later bets improve?
4. **Solve distribution.** The fleet's output reaches almost nobody, so autonomy is a throughput solution to a relevance problem. Given the capability map and budget, how could agents *discover* channels and tactics that actually bring people? Think beyond posting more: search intent and SEO, communities, directories, partnerships, tools and free utilities, participation rather than broadcast. Name experiments agents could run themselves and how they'd measure them.
5. **Give the CEO a minimal-attention operating model.** What should the CEO do, how often, and in how many minutes, so the system stays safe and improves even with 2–3 week gaps? What should happen automatically when the CEO is absent?
6. **Sequence it.** Give a concrete first 2 weeks and first 6 weeks, and the measurements that tell us whether it is working.

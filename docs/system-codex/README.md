# AmbientPixels System Codex

**Generated:** 2026-06-11 (full-codebase sweep: 9 parallel exploration passes + live production state reads)
**Scope:** Every script, API, dashboard, product, and pipeline in the AmbientPixels platform.

## What this is

The single place to understand the entire system: what exists, what it does, how the pieces connect, and where the gaps are. Each chapter is self-contained; this README is the high-level write-up.

| Chapter | Covers |
|---------|--------|
| [heartbeat-engine.md](heartbeat-engine.md) | The AmbientOS heartbeat — 24 modules, ~19.5K lines, 15 systems, all gates |
| [api-layer.md](api-layer.md) | All 165 Azure Functions, 15 cron timers, shared libs, state keys, Stripe plumbing |
| [governance-and-dashboard.md](governance-and-dashboard.md) | The CEO dashboard — what the human can see and control without code |
| [products.md](products.md) | All 6 products: CardForge, Blindspot, StoryForge, Pixel Agents + Agent Forge, AmbientScore |
| [public-site-and-infra.md](public-site-and-infra.md) | Public site, shared JS/CSS, build scripts, CI/CD, auth |
| [autonomy-readiness.md](autonomy-readiness.md) | **The rating:** how close the system is to full autonomy under light human governance |
| [monetization-readiness.md](monetization-readiness.md) | **The scorecards:** per-product monetization readiness + prioritized fix list |

---

## The system in one page

AmbientPixels is a one-human company run by software. The human (CEO) owns strategy and final approval; everything else — task creation, content writing, peer review, social posting, financial monitoring, research, infrastructure watch, even proposals to hire/retire agents — is executed by 8 AI agents driven by an hourly **heartbeat**.

### The engine

Every hour, an Azure Function (`companyHeartbeat`) wakes up, takes a concurrency lock, loads all company state from Azure Blob, builds ~10 intelligence digests (finance, ops, social, outcomes, reflection, allocation, strategy, world-state…), then runs each of the 8 agents in a fixed order (nova → cipher → pixel → forge → scribe → quill → echo → scout). Each agent gets a layered prompt: an identical ~1KB **World State** snapshot at top, then its identity/doctrine, memories, role-specific dashboard, task queue, and cadence nudges. The LLM's output is normalized into task mutations, proposals, and memory writes — every one of which passes through **20+ deterministic gates** (dedup, ceilings, orphan checks, quality gates, attempt caps, rate limits) before touching state.

### The control loop

Work flows **propose → approve → execute → audit**:
- **Internal actions** (comments, memories, task moves, wiki docs) auto-execute.
- **External actions** (social posts, blog publishes, product/fleet/budget proposals) land in an **approval queue** the CEO reviews on the dashboard.
- Since 2026-06-10, advisory social posts that pass the composed quality gate can **auto-publish after a 48h grace window** with a 2-rejects-in-7-days circuit breaker — the first real autonomy on external actions.
- Everything is logged to `governanceLog`; an **emergence monitor** (daily cron) watches for compound patterns (proposal floods, reject-rate spikes, fleet churn, budget streaks) that no single gate would catch.

### The 15 systems

Each agent is the same machinery with a different identity. The platform is built as 15 layered systems: Identity, Execution, Memory, Task Pipeline, Intelligence, Governance, Actions, Self-Correction, Outcome Attribution, Self-Awareness/Reflection, Shared World Model, Capital Allocation (Cipher can deny spend), Goal Generation (Nova can propose product launch/pivot/retire), Agent Identity Evolution (the fleet itself is mutable via proposals), and Emergence Monitoring (the immune system — observes, never acts).

### The products

Six products ride on the same Azure SWA + Functions infra, marketed by the agents:

| Product | What it is | Monetization today |
|---------|-----------|--------------------|
| **AmbientScore** | AI website conversion audit | **LIVE** — $29 single / $89 3-pack, Stripe end-to-end |
| **CardForge** | RPG card creator | **LIVE** — Pro subscription (Stripe), partial feature gating |
| **StoryForge** | AI interactive fiction | **LIVE** — Pro subscription (Stripe), enforcement gaps |
| **Pixel Agents** | AI agent marketplace (24 built-in + community) | Groundwork laid — Stripe + creator payouts coded, not enforced at run time |
| **Agent Forge** | Visual agent builder feeding Pixel Agents | Indirect (creator revenue share, 50/70% splits) |
| **Blindspot** | Arena combat game | None — 100% soft currency (Sparks), no real-money path |

### Where it stands (live production, 2026-06-11)

- Heartbeat: 10/10 recent runs OK, ~15s duration. **Currently running on Gemini** (`systemConfig.heartbeatModel: "gemini"`), which is the documented low-compliance model — agent throughput is near zero (2 actions total last cycle).
- Auto-publish: enabled (48h grace, max 2/day) — **zero grace publishes have occurred yet**; the path is live but unexercised.
- Approval queue: clear. Capital: GREEN ($10.50 of $35 monthly). Emergence: 0 signals.
- Fleet: 8 active agents + 1 archived (`testbot` — proof System 14 hire/retire was exercised end-to-end).
- Known broken: reflection system (1 reflection total across the fleet despite the 3-day cadence; evidence-gate fix shipped 06-10, still not producing).

Full analysis: [autonomy-readiness.md](autonomy-readiness.md) and [monetization-readiness.md](monetization-readiness.md).

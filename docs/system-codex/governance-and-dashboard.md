# Governance & the CEO Dashboard

**Location:** `ambientpixels/modules/company/` (20+ pages) + `js/sidebar.js` · Auth: SWA `authenticated` role on `/modules/company/*` routes.

Three UI access modes (localStorage `ap_ui_mode`, cycled in sidebar footer): **executive** (default — approvals), **operator** (+ run heartbeat, dev view), **admin** (+ audit pages: world-state, fleet, emergence, governance-report, action-audit, memory-stack, awareness, promo-codes).

## What the CEO can do from the dashboard alone

| Surface | Page | Controls |
|---------|------|----------|
| **Approval queue** | `actions.html` | Approve / reject / request-revision / bulk ops / edit payload before approval. Panels: pending actions, content packages, Bluesky reply drafts, needs-attention (convergence), campaign + objective proposals, Agent Forge submissions, failures, platform rate-limit status. Pipeline trust badges (Full/Partial/Flagged) |
| **Fleet lifecycle** | `fleet.html` (admin) | Approve/reject hire, retire, evolve proposals → mutates `agentRegistry` with idempotent side effects |
| **Product lifecycle** | `goals.html` | Approve/reject product launch / pivot / retire proposals (System 13) |
| **Budget** | `allocation.html` | Approve/reject budget requests; per-agent spend bars; campaign + experiment ROI |
| **Kill switch** | `config-overview.html` | `execution_mode`: active / observe / manual / frozen — immediate enforcement at heartbeat entry |
| **Model switch** | dashboard Dev View | `systemConfig.heartbeatModel` pill toggle (Sonnet / Haiku / Gemini Flash) — runtime, no deploy |
| **Memory** | memories/workspace pages | Edit L3 seed memories + L5 CEO notes (the two human leverage layers of the memory stack) |
| **Discovery curation** | `bluesky-discovery.html` | Draft reply / post manually / dismiss Scout's thread candidates; live keyword editor |

Observational-only surfaces: `world-state.html`, `emergence.html`, `awareness.html`, `attribution.html`, `governance-report.html` (violation filters + dead-gate detection), `analytics-hub.html`, `agent-performance.html`.

## What still requires CLI/API/deploy

- Editing agent doctrine/personality (hardcoded prompt branches in `prompt-builders.js`)
- Changing budget caps directly (only request approval; caps live in `constants.js`)
- Changing gate thresholds / adding gates (code)
- Conditional or delegated approvals (no rules engine, no second approver)
- Forcing reflections; editing L4 runtime memories
- The grace-window config (`systemConfig.autoPublish`) — settable via API POST only; **must MERGE, never overwrite** systemConfig

## Governance architecture recap

- **Decision classes:** internal auto-execute → advisory (AQ + 48h grace auto-publish if QG pass) → executive-required (cancel campaign/objective, product/fleet/budget >$2) → human-only forever (launch/pivot/retire products, fleet changes final say, budget >$2k)
- **Trust tiers:** Nova lifecycle authority (pause/resume/complete auto-execute), Echo propose-campaign, Forge+Nova system directives, Cipher budget approval $0.50–$2, Forge-only fleet proposals (CEO bypass via `fleetProposalCreate`)
- **Protected:** `PROTECTED_AGENTS = {nova, cipher}` cannot be retired; FLEET_MIN 5 / MAX 12; ID reuse forbidden; archived agents keep memories
- **Blast radius tiers** (`EMERGENCE_BLAST_RADIUS`, mirrored in emergence.html JS — update both): critical = agent_retire/product_retire/agent_hire; high = pivot/evolution; medium = product/budget_request; low = campaign/objective
- **Breaker:** 2 CEO rejects of grace-published posts within 7d → auto-publish self-disables + AQ escalation
- **Audit:** every gate writes `policy-violation` w/ `details.gate`; `governanceLog` retains ~200 entries (FIFO — long-horizon audit relies on the emergence digest and weekly reports, not raw log)

## Known governance gaps (from this audit)

1. No conditional auto-approval rules (e.g. "auto-approve posts <200 chars from trusted pipeline") — everything advisory waits 48h or for the CEO.
2. No approval delegation / second human.
3. `governanceLog` ~200-entry retention is short for forensic audit.
4. Secret auth is a no-op while `COMPANY_WRITE_SECRET` is unset — the dashboard effectively trusts the network/SWA layer.
5. Doctrine and thresholds are deploy-time; the CEO can stop the system instantly but can only re-tune it via code.

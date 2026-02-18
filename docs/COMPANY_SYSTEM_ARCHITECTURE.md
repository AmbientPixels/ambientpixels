# AmbientPixels — Company Module System Architecture

_Last updated: February 18, 2026_

This document describes the full architecture of the AmbientPixels Company Module — an AI orchestration platform where autonomous agents run every department, governed by human approval workflows and audit trails.

---

## Table of Contents

1. [Platform Overview](#platform-overview)
2. [Infrastructure](#infrastructure)
3. [Data & Persistence](#data--persistence)
4. [Governance & Automation Engine](#governance--automation-engine)
5. [AI Agents](#ai-agents)
6. [Agent Memory & Personality System](#agent-memory--personality-system)
7. [Social Post Execution Pipeline](#social-post-execution-pipeline)
8. [Server API Endpoints](#server-api-endpoints)
9. [UI Pages](#ui-pages)
10. [Config Overview — Control Room](#config-overview--control-room)
11. [Safety Architecture](#safety-architecture)
12. [Data Persistence v1](#data-persistence-v1)

---

## Platform Overview

AmbientPixels operates as a "virtual company" where AI agents autonomously handle planning, execution, calibration, and reporting — all under human governance. The core principle: **agents propose, humans approve, the system executes, and everything is audited**.

```
Agents Propose → Queue for Approval → Human Approves → System Executes → Audit Trail
```

---

## Infrastructure

| Component        | Stack                                                        |
|------------------|--------------------------------------------------------------|
| **Hosting**      | Azure Static Web Apps (`staticwebapp.config.json`)           |
| **API**          | Azure Functions (Node.js, ~40 endpoints)                     |
| **Storage**      | Azure Blob Storage + localStorage fallback                   |
| **AI**           | Gemini API (via `geminiproxy`, `novachat`, `agentchat`)      |
| **Auth**         | Azure B2C + `x-company-secret` header for internal APIs      |
| **CI/CD**        | GitHub Actions → Azure SWA deploy                            |

---

## Data & Persistence

### CompanyStore (`js/company-store.js`)

The hybrid persistence layer. Probes for server availability at init, uses Azure Blob via API when online, falls back to localStorage.

Key collections: tasks, workspace memory (CEO Notes), agent configs, identity, tools, directives, objectives, metrics, session logs, standup logs, governance logs, documents, artifacts, agent memories, agent seed memories.

### CompanyStoreAdapter (`js/company-store-adapter.js`)

Server-side persistence for operational data (audits, queue, settings). Added in Data Persistence v1.

- Buffers writes in-memory, flushes in batches (500ms debounce)
- Failed batches go to localStorage outbox (capped at 200)
- Supports delta sync via `lastSync` + `?since=` with `eventId` dedup
- Default: **OFF** — must be explicitly enabled in Config UI

### StorageManager (`js/storage-manager.js`)

localStorage health layer — safe writes with quota detection, pruning, usage estimation, diagnostics export.

---

## Governance & Automation Engine

This is the heart of the system — a propose → approve → execute → audit pipeline.

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     PROPOSE (Read-Only Analysis)                  │
│                                                                   │
│  PlannerLoop           CalibrationLoop         WorkerManager      │
│  (weekly planning)     (self-improvement)      (pressure-based)   │
│       │                      │                       │            │
│       ▼                      ▼                       ▼            │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │               ActionQueue (localStorage-backed)            │   │
│  │    pending_approval → approved_ready → executing            │   │
│  │                         → executed | failed | blocked       │   │
│  └─────────────────────────┬─────────────────────────────────┘   │
│                             │                                     │
│                   ┌─────────▼──────────┐                         │
│                   │   HUMAN APPROVAL    │  ← CEO / Config UI      │
│                   │  (approve / reject) │                         │
│                   └─────────┬──────────┘                         │
│                             │                                     │
│                   ┌─────────▼──────────┐                         │
│                   │   ActionRouter      │  Kill switches,         │
│                   │                     │  registry, verification │
│                   └─────────┬──────────┘                         │
│                             │                                     │
│                   ┌─────────▼──────────┐                         │
│                   │  ActionExecutors    │  task, system,           │
│                   │                     │  social, email           │
│                   └─────────────────────┘                         │
│                                                                   │
│                          EXECUTE                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Module Reference

#### PriorityEngine (`js/priority-engine.js`)

Deterministic task scoring (0–15+). Never uses LLM. Never mutates tasks. Fail-closed on errors.

- **Factors:** impact, urgency, strategic alignment, aging, risk penalty
- **Weights:** configurable (0–5 each), persisted to localStorage + server
- **Buckets:** low (0–5), medium (6–10), high (11–17), critical (18+)
- **Cache:** `ap_priority_cache` — recalculated on demand

#### PlannerLoop (`js/planner-loop.js`)

Deterministic weekly executive planning. Propose-only — never mutates tasks, never executes actions.

- **Cadence:** configurable (default 7 days), auto-run check via `shouldAutoRun()`
- **Outputs:** focus list (top N by score), stuck list, recommendations
- **Thresholds:** `stuckInReviewDays`, `stuckInProgressDays`, `recommendationsMax`, etc.
- **Enqueues** all recommendations as `pending_approval` into ActionQueue
- **Audit:** logged via PlannerAudit

#### CalibrationLoop (`js/calibration-loop.js`)

Bounded self-improvement. Analyzes approval rates, success rates, and rejection patterns to propose weight/threshold adjustments.

- **Metrics computed:** approval rate, rejection rate, success rate, critical resolution rate, avg time to approval
- **Rules:** low approval rate → reduce planner aggressiveness, frequent "too early" rejections → increase aging weight, low critical resolution → increase urgency weight, low success rate per action type → flag for review
- **Caps:** max ±0.5 weight adjustment, weight range 0–5, planner recommendations 2–12
- **All proposals require human approval** — never auto-adjusts

#### ActionRouter (`js/action-router.js`)

Governed execution layer. Depends on: ActionAudit, ActionQueue, ActionExecutors, TaskVerifier.

- **Kill switches:** global (`actionsEnabled`, default: **false**), per-tool (task, social, email, configChanges)
- **Registry:** loaded from `/data/company-actions.json` — defines action types, risk levels, approval requirements
- **Verification gates:** TaskVerifier checks task state before completion transitions
- **Execution limits:** max 5 per cycle, max 2 retry attempts
- **Priority sorting:** uses PriorityEngine scores to order execution queue

#### ActionQueue (`js/action-queue.js`)

localStorage-backed queue with 6 statuses: `pending_approval`, `approved_ready`, `executing`, `executed`, `failed`, `blocked`.

- **Max items:** 200
- **Dedup:** same actionType + targetId within 30s window
- **Batch operations:** `approveMany()`, `rejectMany()`, `approveAllLowRisk()`
- **Grouped pending:** groups by correlationId, targetId, source, or risk level
- **Synced to server** via `CompanyStoreAdapter.markQueueDirty()`

#### ActionExecutors (`js/action-executors.js`)

Dispatches execution by type:

- **Task executor:** move task status, update fields
- **System adjustment executor:** `adjust_priority_weight`, `adjust_planner_threshold`, `flag_action_type`
- **Social / email executors:** (wired but gated by kill switches)
- All adjustments write backups before applying changes

#### WorkerManager (`js/worker-manager.js`)

Pressure-based worker spawning. Evaluates system load and dispatches specialized workers.

- **Pressure thresholds:** reviewCount ≥ 20, overdueCount ≥ 5, pendingApprovals ≥ 10, oldestInReviewHours ≥ 48, criticalCount ≥ 3
- **Worker types:** triage, scribe, research, QA
- **Caps:** global max 6, per-owner max 3, budget-based rate limiting
- **State machine:** spawning → active → reporting → terminated
- **Timeout enforcement:** TTL per worker type
- **Consecutive low-pressure cycles** → auto-terminate workers

#### TaskVerifier (`js/task-verifier.js`)

Verification gates for task transitions. Returns pass/fail/manual with reasons. Used by ActionRouter to block invalid transitions (e.g., incomplete tasks → done).

### Audit Trail (5 Parallel Logs)

| Module             | Storage Key              | Tracks                                              |
|--------------------|--------------------------|------------------------------------------------------|
| **ActionAudit**    | `ap_action_audit`        | Enqueue, approve, reject, execute, fail, block        |
| **WorkerAudit**    | `ap_worker_audit`        | Spawn, report, error, budget, terminate               |
| **PlannerAudit**   | `ap_planner_audit`       | Plan runs, recommendations, enqueue                   |
| **CalibrationAudit** | `ap_calibration_audit` | Calibration runs, proposals, metrics                  |
| **PriorityAudit**  | `ap_priority_audit`      | Score changes, bucket transitions                     |

All 5 logs:
- Are append-only and immutable once written
- Generate `eventId` for idempotent server sync (v1.0.1)
- Are capped at 500 entries locally
- Sync to server with 30-day / 5000-event retention

---

## AI Agents

### AgentEngine (`js/agent-engine.js`)

Multi-agent client engine. Manages conversation history (max 30 per agent), agent registry, and communication with the `agentchat` API. Uses CompanyStore for persistence with localStorage fallback.

### Server-Side Agent APIs

| Endpoint                       | Purpose                                |
|--------------------------------|----------------------------------------|
| `/api/agentchat`               | Multi-agent conversation (Gemini)      |
| `/api/novachat`                | Nova personality chat                  |
| `/api/novaopenai`              | OpenAI-backed Nova                     |
| `/api/novavision`              | Vision capabilities                    |
| `/api/company-standup-run`     | Automated daily standups               |
| `/api/companyHeartbeat`        | System heartbeat + automation trigger  |
| `/api/companyMorningReport`    | Daily morning report generation        |
| `/api/actionsExecute`          | Server-side action execution (social posts, etc.) |

---

## Agent Memory & Personality System

_Added February 17, 2026_

Agents operate with a 4-layer context stack, injected into every heartbeat prompt in order:

```
┌─────────────────────────────────────────────┐
│  Layer 3: PERSONALITY (systemPrompt)        │  ← WHO they are
│  Source: data/company-agents.json           │
│  Editable: JSON file (requires deploy)      │
├─────────────────────────────────────────────┤
│  Layer 2: CEO KNOWLEDGE BASE (seed memory)  │  ← WHAT the CEO teaches them
│  Source: Azure Table (agentSeedMemories)    │
│  Editable: /modules/company/memories.html   │
│  Char limits: 2000 global, 1500 per agent   │
├─────────────────────────────────────────────┤
│  Layer 1: YOUR MEMORY (runtime memory)      │  ← WHAT they learn on their own
│  Source: Azure Table (agentMemories)        │
│  Written by: agents via 'remember' action   │
│  Auto-written: CEO rejection feedback       │
│  Cap: 20 memories/agent, last 10 shown      │
├─────────────────────────────────────────────┤
│  Layer 0: TASK BOARD (shared context)       │  ← WHAT's happening now
│  Tasks, directives, objectives, dates       │
│  Always present in every heartbeat          │
└─────────────────────────────────────────────┘
```

### Layer 3 — Personality

- Loaded from `data/company-agents.json` at module init (`_agentPersonalities`)
- Each agent's `systemPrompt` injected as `PERSONALITY:` block
- Defines voice, tone, and role identity

### Layer 2 — Seed Memory (CEO Knowledge Base)

- Stored in Azure Table under key `agentSeedMemories`
- Structure: `{ _global: "markdown...", nova: "markdown...", echo: "...", ... }`
- `_global` shown to ALL agents (company context, org chart, decision flow)
- Per-agent entries shown only to that agent (role-specific rules)
- Editable from browser at `/modules/company/memories.html` — no git/deploy needed
- Injected as `CEO KNOWLEDGE BASE:` block in prompt

### Layer 1 — Runtime Memory

- Stored in Azure Table under key `agentMemories`
- Structure: `{ agentId: [{ id, type, text, source, timestamp }] }`
- Types: `learning`, `feedback`, `preference`, `context`
- Written two ways:
  1. **Manual** — Agent uses `remember` action (max 300 chars per memory)
  2. **Auto** — CEO revision feedback saved when agent processes `revise-action`
- Cap: 20 memories per agent (`MAX_MEMORIES_PER_AGENT`), FIFO eviction
- Last 10 shown in prompt as `YOUR MEMORY:` block
- Persisted to Azure at end of each heartbeat cycle

### Memory Editor UI

- Page: `/modules/company/memories.html`
- Global tab + per-agent tabs (Nova, Cipher, Pixel, Forge, Echo, Scribe, Quill, Scout)
- Markdown textarea with live preview + character counter
- Read-only runtime memory viewer per agent
- Saves directly to Azure via `company-state` API
- Accessible from sidebar: Config → Memory

### Heartbeat Prompt Order

```
You are {Name}, {Role} at AmbientPixels. Your focus: {Focus}.
{PERSONALITY block}
{OPERATING DOCTRINE block}
{CEO KNOWLEDGE BASE block — global + per-agent}
{YOUR MEMORY block — last 10 runtime memories}
This is an automated heartbeat check...
{YOUR TASKS}
{OTHER ACTIVE TASKS}
{TASKS AWAITING REVIEW}
{CEO DIRECTIVES}
{CEO NOTES — pinned workspace context}
{REVISION REQUESTS}
{SITE CONTEXT}
CURRENT TIME: ...
{JSON response schema + action type docs + rules}
```

---

## Social Post Execution Pipeline

_Added February 17, 2026_

### Flow

```
CEO creates task → Nova triages → Echo drafts social post
→ create-social-action → CEO approval queue → CEO approves
→ Execute button → api/actionsExecute → Platform adapter
→ Success: task auto-completes | Failure: comment + retry (max 3)
```

### LinkedIn Adapter (`api/actionsExecute/executors/social/linkedin.js`)

- **API**: LinkedIn UGC Posts API (`/v2/ugcPosts`)
- **Auth**: OAuth 2.0 Bearer Token, requires `w_member_social` scope ("Share on LinkedIn" product)
- **URN Resolution**: Auto-resolves numeric member ID via `/v2/me` — env var may contain encoded hash URN which the API rejects
- **Pre-flight**: Token validation via `/v2/userinfo` before every publish attempt
- **Media**: Supports article URL attachments
- **Char limit**: 3000 chars

### Env Vars

- `LINKEDIN_ACCESS_TOKEN` — OAuth 2.0 token (expires ~60 days)
- `LINKEDIN_PERSON_URN` — Fallback URN (adapter auto-resolves numeric ID)

### Success Handling (`api/actionsExecute/index.js`)

- Action marked `success` with receipt (post URL, URN, timestamp)
- Parent task auto-completed with system comment including post URL
- Governance log entry: `action-executed`

### Failure Handling

- System comment added to parent task: attempt N/3, error message, retryable flag
- After 3 failed attempts: parent task status → `blocked`
- Governance log entry: `action-failed`

### Dedupe Guard (companyHeartbeat)

- Per-task: only blocks duplicate social actions for the same `_parentTaskId`
- Completed, rejected, and cancelled actions don't block new ones
- Only Echo may use `create-social-action`

---

## Server API Endpoints

### Company Core
- `company-state` — GET/POST key-value state (Blob Storage)
- `company-heartbeat-trigger` — Trigger heartbeat cycle
- `companyHeartbeat` — Heartbeat execution
- `companyMorningReport` — Generate morning report
- `company-standup-run` — Run daily standup
- `company-logs` — Read/write logs
- `company-report` — Generate reports

### Data Persistence (v1)
- `company-store-snapshot` — GET snapshot (supports `?since=` for delta)
- `company-store-append` — POST batch append (audits, queue, artifacts, settings)
- `company-store-upsert-settings` — POST settings patch with allow-list
- `company-store-migrate` — POST bulk import from localStorage

### Actions
- `actionsExecute` — Server-side action execution
- `actionsMetricsPull` — Pull action metrics
- `actionsScheduler` — Scheduled action processing
- `documentsExecute` — Document generation execution

### AI / Chat
- `agentchat` — Multi-agent chat
- `novachat`, `novaopenai`, `novavision` — Nova interfaces
- `geminiproxy` — Gemini API proxy
- `generatetext` — Text generation
- `synthesizeNovaMood` — Mood synthesis
- `FetchLatestMood`, `GenerateMoodInsights` — Mood tracking

### CardForge
- `cardforgesavecards`, `cardforgeloadcards`, `cardforgepublish`
- `cardforgetemplate`, `cardshare`, `deckshare`
- `cardforgedeckload`, `cardforgedeckdelete`, `cardforgedeckpublish`, `cardforgedeletecard`

### Content
- `blogPosts` — Blog post management
- `publishedDocs` — Published document access

### Utilities
- `_utils/companyStorage.js` — Blob Storage abstraction + store collection helpers
- `_utils/callGemini.js` — Gemini API wrapper
- `_utils/getTelemetry.js` — Telemetry helpers

---

## UI Pages (Company Module)

All pages live in `/modules/company/` and share a common sidebar navigation (`js/sidebar.js`, `css/sidebar.css`).

| Page                  | Purpose                                           |
|-----------------------|---------------------------------------------------|
| `index.html`          | HQ landing — hero, CTAs, system overview          |
| `dashboard.html`      | Observability — metrics, tokens, costs, logs      |
| `tasks.html`          | Task board with priority scoring                  |
| `actions.html`        | Action queue — approve/reject/execute             |
| `governance.html`     | Governance log and approval history               |
| `config-overview.html`| System control room — all settings, kill switches, storage, server persistence |
| `workspace.html`      | Identity, CEO Notes, agent configs, tools, dates  |
| `memories.html`       | Agent Memory Editor — seed memories per agent     |
| `agent-chat.html`     | Direct conversation with agents                   |
| `standup.html`        | Daily standups                                    |
| `meetings.html`       | Meeting management                                |
| `calendar.html`       | Calendar view                                     |
| `directives.html`     | Strategic directives                              |
| `objectives.html`     | OKRs / objectives                                 |
| `board.html`          | Quarterly board review                            |
| `documents.html`      | Document management                               |
| `cost-overview.html`  | Cost analysis and budget tracking                 |
| `plan-overview.html`  | Planner output viewer                             |
| `ops-overview.html`   | Operations overview                               |
| `work-overview.html`  | Work summary                                      |

---

## Config Overview — Control Room

_Added February 18, 2026_

`/modules/company/config-overview.html` — the central settings page for all workspace configuration. Every automation toggle, storage control, and system tool lives here.

> Full per-panel documentation: [`docs/CONFIG_OVERVIEW_GUIDE.md`](./CONFIG_OVERVIEW_GUIDE.md)

### Panel Layout

```
┌─────────────────────────────────────────────┐
│  System Status Checklist                     │  ← Health at a glance
│  (API, Agents, Store, Auth, Sync, Heartbeat)│
├─────────────────────────────────────────────┤
│  Agent Memory Stack                          │  ← 6 knowledge layers (L1–L6)
├─────────────────────────────────────────────┤
│  Agent Health Grid                           │  ← Per-agent status tiles
├─────────────────────────────────────────────┤
│  Worker Automation                           │  ← Background job framework
│  Verification Engine                         │  ← Output quality gate
│  Autonomy Controls                           │  ← Per-channel trust dials
│  Planner Automation                          │  ← Strategic planning loop
│  Calibration Automation                      │  ← Self-improvement loop
├─────────────────────────────────────────────┤
│  System Storage                              │  ← localStorage health
│  Server Persistence                          │  ← Azure sync layer
├─────────────────────────────────────────────┤
│  System Tools                                │  ← Export, Sync, Kill switch
│  Quick Access                                │  ← Navigation shortcuts
│  Danger Zone                                 │  ← Destructive resets
└─────────────────────────────────────────────┘
```

### Autonomy Controls

The policy layer for agent freedom. Each channel can be independently toggled:

- **OFF** = CEO Approval required (all actions enter approval queue)
- **ON** = Autonomous (agents act freely, logged for visibility)

| Group | Channel | Default | localStorage Key |
|---|---|---|---|
| Internal | Tasks | ON | `ap_actions_task_enabled` |
| Internal | Config | OFF | `ap_config_changes_enabled` |
| External | Social | OFF | `ap_actions_social_enabled` |
| External | Content | OFF | `ap_actions_content_enabled` |
| External | Email | OFF | `ap_actions_email_enabled` |
| External | Git | OFF | `ap_actions_git_enabled` |

Channel toggle overrides the registry's `requiresApproval` flag. When a channel is OFF, all actions are forced to CEO approval regardless of individual action settings.

### Automation Loops

| Loop | Purpose | Cadence Key | Default |
|---|---|---|---|
| **Planner** | Weekly strategic planning, recommendations, standup scheduling | `ap_planner_cadence_days` | 7 days |
| **Calibration** | System health analysis, weight/threshold tuning proposals | `ap_calibration_cadence_days` | 7 days |
| **Worker** | Pressure-based background job spawning | `ap_workers_enabled` | OFF |

All loops are **propose-only** — they enqueue `pending_approval` items into the ActionQueue. They never execute directly.

### Storage & Persistence

| Layer | What | Key |
|---|---|---|
| **System Storage** | localStorage health monitoring, auto-prune at 80% capacity | Managed by `StorageManager` |
| **Server Persistence** | Azure sync via `CompanyStoreAdapter` | `ap_server_persistence_enabled` |

Server Persistence authenticates via two methods:
1. **Azure SWA auth** — automatic when logged in (`/.auth/me` → `x-ms-client-principal`)
2. **Manual key** — dev console: `CompanyStoreAdapter.setKey("...")`  → `x-company-secret`

### System Tools

| Tool | What it does |
|---|---|
| Memory Reset | Clears shared workspace memory (`ap_workspace_memory`) |
| Kill All Automation | Emergency stop — disables Worker, Action Router, Planner, Calibration at once |
| Export State | Downloads all `ap_*` keys as dated JSON backup |
| Force Server Sync | Triggers `deltaSync()` to pull latest from Azure |
| Flush Outbox | Retries pending sync batches |

### Danger Zone

All destructive actions require typing "DELETE" to confirm. Organized by severity:

| Group | Actions |
|---|---|
| **Data Resets** | Tasks (+archive), Directives, Objectives, Action Queue (+rate counts) |
| **Audit & Logs** | All audit logs (action, worker, planner, calibration, priority), Governance log |
| **Nuclear** | Clear All Company Data — removes all `ap_*` keys (preserves Nova/browser state) |

---

## Safety Architecture

The system is **fail-closed** at every layer:

1. **ActionRouter defaults to OFF** — `actionsEnabled: false`. Nothing executes until explicitly turned on.
2. **Per-tool kill switches** — task, social, email, configChanges each independently togglable.
3. **All automation is propose-only** — PlannerLoop, CalibrationLoop, and WorkerManager only enqueue `pending_approval` items. They never execute anything directly.
4. **Calibration caps** — Weight adjustments bounded to ±0.5 per cycle, total range 0–5. Planner recommendations capped at 2–12.
5. **Worker limits** — Global max 6 workers, per-owner max 3, budget-based rate limiting, TTL timeout enforcement.
6. **Verification gates** — TaskVerifier blocks invalid transitions (e.g., incomplete task → done).
7. **Audit trail** — Every action, approval, rejection, execution, and failure is logged with correlation IDs across 5 parallel logs.
8. **Server persistence defaults OFF** — Requires explicit enable + secret key. Outbox prevents data loss. Idempotent retries via eventId dedup.
9. **Registry validation** — Action types must exist in `company-actions.json` and be marked enabled. Unknown types are rejected and audited.
10. **Retry limits** — Max 2 attempts per action. After that, permanently failed.
11. **Danger Zone type-to-confirm** — All destructive config actions require typing "DELETE" before execution. Scoped to `ap_*` keys only — Nova and browser state are never touched.
12. **Auto-prune** — StorageManager triggers automatic pruning at 80% localStorage capacity with 5-minute cooldown.

---

## Data Persistence v1

Added February 2026. Server-side storage for audits, queue, settings, and artifacts.

### Storage Model (Azure Blob Storage)

- `store-audits-{type}.json` — per-type audit arrays (action, worker, planner, calibration, priority)
- `store-queue.json` — full action queue array
- `store-settings.json` — settings object with allow-list validation
- `store-artifacts-{type}.json` — per-type artifact arrays

### Retention Policy

- **Audits:** 5000 max per type, 30-day max age, pruned on every append
- **Queue:** all active statuses kept, terminal items capped at 1000
- **Artifacts:** 20 max per type

### Idempotency (v1.0.1)

- Client generates `eventId` per audit event (type + timestamp + correlationId + random suffix)
- Server deduplicates against tail-2000 of existing events (bounded O(tail + batch))
- Legacy events without `eventId` are assigned server-side `srv_*` IDs
- Queue upserts are naturally idempotent by `item.id` (replace by id, last write wins)

### Delta Sync (v1.0.1)

- Client persists `ap_server_last_sync` (ISO timestamp)
- `deltaSync()` calls snapshot with `?since=lastSync`
- Server returns audits newer than `since`, plus full settings and queue
- Client merges: settings (server wins), queue (server wins + preserve local pending), audits (append new with eventId dedup)

### Auth

- `x-company-secret` header on all requests
- `COMPANY_WRITE_SECRET` environment variable on server
- Key stored in `sessionStorage` only on client (never persisted to localStorage)

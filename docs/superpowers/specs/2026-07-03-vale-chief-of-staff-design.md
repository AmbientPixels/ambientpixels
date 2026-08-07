# Vale — Chief of Staff (Office of the CEO) — Design Spec

**Date:** 2026-07-03
**Status:** Draft for CEO review
**Scope:** Foundation only. The Career/Recruiter agent is a separate spec.

---

## 1. Goal

Give the CEO a personal agent — **Vale**, a Chief of Staff — whose principal is the
CEO, not AmbientPixels. Vale runs the CEO's interface to the fleet: outbound Discord
briefs, a web chat like the other agents, internal scheduling + meeting scheduling, a
personal CEO action-list, and a dedicated "Office" cockpit in the dashboard. Vale also
appears as a first-class agent in the org tree and the agent-profile hub.

Vale is the first agent that serves the human directly, so it carries its own persona,
its own isolated personal-memory store, and its own runtime — completely separate from
the fragile heartbeat pump.

## 2. Scope

**In scope (this spec):**
- Vale identity + persona (Chief of Staff), isolated from the heartbeat runtime.
- Isolated, CEO-only personal-memory store (never on the shared `company-state` surface).
- `valechat` web-chat endpoint + an Office chat panel reusing the existing chat UI.
- Outbound Discord briefs (morning brief + evening wrap) via the existing webhook util.
- Internal scheduling: CEO action-list CRUD + scheduling agentic meetings.
- The **Office** dashboard section (`office.html`) + nav entry.
- Presentation surfaces: org-tree card, agent profile page + hub card, portrait asset.

**Out of scope (deferred / next spec):**
- Two-way Discord bot (conversation + approval buttons in Discord).
- Real calendar sync (Google / Outlook OAuth).
- The Career/Recruiter agent: job sourcing, scoring, applications, "hire me" page,
  applying-as-agent experiments, deep use of `ceoProfile`.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Build order | Foundation first (this spec); Career agent is a later, separate spec. |
| Discord | Outbound briefs now (webhook); **plus** a web chat like other agents. Two-way bot deferred. |
| Calendar | Internal scheduling only. No external calendar. |
| Name | **Vale.** |
| Architecture | Isolated standalone subsystem (not embedded in the fleet plumbing). |
| Org-tree tier | Tier 1 (Executive), "Office of the CEO / Chief of Staff" — recommended, adjustable. |

## 4. Architecture — isolated standalone

Vale is its own subsystem. It reuses shared *utilities* and *UI*, but shares none of the
fleet's runtime. This mirrors how Agentic Meetings and the rewards engine already run on
their own crons, isolated from the heartbeat.

**The three-registry seam (the core isolation guarantee):**

| Registry | File | Drives | Vale |
|---|---|---|---|
| Runtime | `api/companyHeartbeat/constants.js` (`AGENT_IDS`) | heartbeat pump, budgets, rewards, proposals, standups | **excluded** |
| Org tree | `data/company-agents.json` | hierarchy at `/modules/company/` (via `js/agent-engine.js` `loadRegistry`) | added (presentation) |
| Profiles | `data/agent-profiles.json` → `scripts/build-agent-profiles.js` | `/ambientos/agents/vale` + hub | added (presentation) |

Vale appears in the two presentation registries and never in the runtime registry.
Adding Vale to the presentation files cannot enroll it in the heartbeat.

## 5. Components

### A. Identity & isolation

- Vale is a named agent whose principal is the CEO. Persona: a sharp, warm Chief of
  Staff — filters noise, prepares the CEO, drafts and proposes, and **always confirms
  before any action that writes into the fleet.**
- Persona/system prompt lives in Vale's own endpoint (same pattern as the
  `AGENT_PROMPTS` map in `api/agentchat/index.js`, but Vale-owned).
- **Hard isolation:** Vale is excluded from `AGENT_IDS`, the heartbeat pump,
  `PROPOSAL_AUTHORIZED_AGENTS`, the rewards engine, per-agent budget caps, and
  standups. It has no entry in `companyHeartbeat/constants.js`.

### B. Memory architecture — Vale as a real employee

Vale's memory mirrors how the fleet actually remembers (two-store split + auto-capture of
CEO corrections) but fixes the gaps the fleet has (no write-time dedup; an inconsistent
seed shape). All of it lives in an **isolated CEO-only store** (see the privacy boundary
below) — never in the L1–L9 Memory Stack, which is fully readable by any dashboard login.

- **Public identity (no private data).** Vale's persona/voice in `data/company-agents.json`
  + `data/agent-profiles.json`. These files are world-readable, so they carry public-safe
  voice only — never CEO-private facts.
- **Seed memory (onboarding, durable):** `valeSeed` — CEO-authored knowledge Vale has on
  day one: who you are, your goals, your job-search context, standing preferences, how you
  like to be communicated with. Permanent, injected verbatim, one enforced shape
  (`[{topic, text}]` — avoids the string-vs-array seed bug the fleet carries). You curate
  it; Vale may propose additions.
- **Earned memory (learns over time):** `valeMemory` — typed records
  `{id, type, text(≤300), source, timestamp, expiresAt, evidence}`, modeled on the fleet's
  `agentMemories`. Tiered TTL by type: `preference`/`constraint`/`decision` long or
  permanent; `context` short. **Write-time dedup** (skip near-identical same-type text) —
  the safeguard the fleet only half-built — plus periodic consolidation of repeats.
- **CEO corrections (permanent, high-salience):** the pattern that makes Vale feel like an
  employee. When you correct Vale, change a to-do she proposed, or give feedback, the
  system auto-captures it as `source: auto:ceo-correction` — **permanent** (exempt from TTL
  and consolidation) and injected in a dedicated "WHAT THE CEO HAS TOLD ME" prompt block.
  (Mirrors the fleet's `auto:ceo-edit`/`auto:ceo-revision`, its most durable memories.)
- **Conversation memory:** `valeConversations` — a ring buffer of recent turns for
  continuity. Neither existing chat endpoint persists conversation, so this is new work;
  durable takeaways get distilled up into `valeMemory`.

**Write policy (classify-and-route):** business/role facts → earned memory; personal /
off-record CEO context → the private store; **default-deny** writing any personal content
into a shared company-wide layer. Vale is a **read-only** consumer of company-wide memory
(`workspaceMemory`, `researchIntel`, `runtimeMemory`) for fleet awareness — never a writer.

Other personal keys (same isolated store): `ceoActionList` (manual to-dos, e.g. PH Jul 7 —
`{id, title, detail, deadline, status, source, createdAt}`), `valeBriefs` (brief history),
`ceoProfile` (stub now; the Career agent fills it next spec).

**Privacy boundary (hardened after the study):** `company-state` GET has **no auth at all**
— any anonymous caller can read any `VALID_KEYS` blob. So the boundary is structural:
1. Vale's keys are **never** added to `company-state` `VALID_KEYS` (the same mechanism that
   already hides `claudeUsage`), never added to `js/company-store.js`, and never read by
   `api/memoryStack/index.js` (so the Memory Stack Explorer never surfaces them).
2. Vale's blobs live in an **isolated location** (a separate `vale-state` container or a
   `vale/` blob prefix) so a future accidental `VALID_KEYS` addition can't expose them.
3. Access goes through a **new dedicated endpoint** (`vale-state`) that verifies **CEO
   identity** by decoding `x-ms-client-principal` via `api/_utils/cfAuth.js` and checking
   the email against a `CEO_EMAILS` allowlist — **not** `x-company-secret` (shared/
   fail-open) and **not** mere presence of a principal. The enforcement *strength* is the
   one open decision (see §11) because the stronger option touches a protected file.

### C. `valechat` endpoint

New Azure Function `api/valechat` (HTTP), modeled on **`novachat`** (single persona, no
action-JSON pipeline in Phase 1).

- **Reuse verbatim:** the `_useClaude()` model resolver + Gemini/Claude dual-path fetch +
  `history[] → contents[]` mapping (from `novachat`); `loadCompanyState()` +
  `formatCoreContext(state, null)` (`agentId=null` → fleet-wide view, avoids an empty
  "your tasks" block) + `formatIntelDigests()` for finance/ops/social; `demoGuard`; and
  usage logging (`logClaudeUsage` on the Claude path, `logGeminiUsage` on Gemini,
  `caller:'valechat'`).
- **New:** a `VALE_SYSTEM_INSTRUCTION` persona const (its own — **not** added to
  `agentchat`'s `AGENT_PROMPTS`, which is the fleet surface); the CEO auth gate
  (`cfAuth.extractUserInfo` → `CEO_EMAILS` allowlist, 403 otherwise); loading Vale's
  personal store (`valeSeed` + `valeMemory` + open `ceoActionList`) into the prompt as
  weighted blocks incl. the "WHAT THE CEO HAS TOLD ME" corrections block; and
  **persisting the exchange** to `valeConversations` + distilling durable notes to
  `valeMemory`.
- **CORS:** widen `Access-Control-Allow-Headers` to include `x-ms-client-principal` (both
  existing chat endpoints omit it, which would block the SWA principal on preflight).
- **Fleet-read safety:** wrap the fleet snapshot in try/catch; on failure tell the CEO the
  read is unavailable rather than fabricating numbers.
- **Model:** MVP inherits the fleet toggle via `_useClaude()`; a `systemConfig.valeModel`
  override to pin Vale independently is an easy later add.

### D. `valeBriefCron` (outbound Discord)

- New Azure Function timer `valeBriefCron` — produces the morning brief and evening wrap.
- Gathers facts deterministically (what the fleet shipped, items needing the CEO,
  upcoming `ceoActionList` deadlines, finance signal), then has Vale write the human
  summary in the CEO's voice.
- Dispatches via the existing `dispatchDiscord()` in `api/_utils/fleetAlerts.js`, to a
  **dedicated** `DISCORD_VALE_WEBHOOK` (separate channel from `#ambientos-alerts`;
  no-op if the env var is unset — safe in any environment).
- Writes each brief to `valeBriefs`.
- Schedule is UTC (Azure NCRONTAB). Target ~7am PT (morning) and ~6pm PT (evening);
  the PT→UTC offset and DST are handled in the implementation (documented caveat).
- Cost note: 2 runs/day on a light model — negligible; does not touch the heartbeat
  budget or Nova's quota.

### E. Liaison action scope (Phase 1)

What Vale can do, safest-first:
1. **Read & report** fleet state (read-only): status, burn, what's waiting on the CEO.
2. **CEO action-list CRUD** (personal store): add / complete / edit / nag on to-dos.
3. **Schedule an agentic meeting** — reuse the existing `api/agentic-meeting-trigger`.
4. **Surface the approval queue** read-only. *Actioning* approvals from chat (reusing
   `api/approveProposal` / `api/proposalDecide`) is an optional Phase 1b toggle — called
   out because it writes into the fleet. Vale always confirms before any fleet write.

### F. The Office dashboard section

- New nav entry **Office** in `modules/company/index.html`.
- New page `modules/company/office.html` — the CEO cockpit, reusing the existing
  `agent-chat.html` chat component + AmbientOS design-system CSS (no new patterns where
  existing ones fit). Panels:
  - Vale chat (points at `valechat`).
  - CEO action-list (with the PH Jul 7 item surfaced), backed by `ceoActionList`.
  - Read-only approval inbox (from `approvalQueue`).
  - Latest brief + brief history (from `valeBriefs`).
  - Quick links to the existing `calendar.html` / `meetings.html`.

### G. Presentation surfaces (the three additions)

1. **Org tree** — add a Vale entry to `data/company-agents.json` at Tier 1
   (Executive), `avatar: /ambientos/img/vale.webp`, its own color + icon, divisions
   (e.g. "Chief of Staff", "CEO Liaison"), `isHuman: false`. Renders in the hierarchy at
   `/modules/company/` with zero runtime effect.
2. **Profile page** — add a Vale entry to `data/agent-profiles.json` (`id`, `name`,
   `role`, `tier`, `portrait`, `pullQuote`, `bio`, `owns`, `statSource`, `statLabel`,
   `auraColor`) and run `scripts/build-agent-profiles.js` to generate
   `/ambientos/agents/vale` and refresh the hub. Vale's live stat reads from the
   personal store (e.g. `ceoActionList` open count); if the live-stat plumbing
   (`js/agent-profile-live.js`) only reads `company-state`, Vale uses a static stat
   label to preserve the privacy boundary.
3. **Portrait (low-pri)** — generate `/ambientos/img/vale.webp` matching the existing
   character-portrait style of the other `ambientos/img/*.webp` files. Placeholder icon
   until generated. Exact generation mechanism decided during implementation.

## 6. Data flow

- **Brief:** `valeBriefCron` → read `company-state` (fleet) + personal store → LLM
  summary → `dispatchDiscord(DISCORD_VALE_WEBHOOK)` + append to `valeBriefs`.
- **Chat:** Office page → `valechat` (CEO-authed) → assemble persona + personal store +
  read-only fleet snapshot → model → reply → persist to `valeConversations`.
- **Action-list:** Office page ↔ CEO-authed personal endpoint ↔ `ceoActionList` blob.
- **Meeting scheduling:** Vale (on CEO instruction, after confirming) → existing
  `agentic-meeting-trigger`.

## 7. Error handling

- Discord dispatch never throws (existing `dispatchDiscord` returns false on failure);
  brief still records to `valeBriefs` with a delivered flag.
- `valechat` degrades gracefully if the fleet snapshot read fails (answers from personal
  store + says the fleet read is unavailable) — never fabricates fleet numbers.
- Personal endpoints reject requests without a valid CEO principal.
- All new crons/functions are self-contained; a Vale failure cannot affect the heartbeat.

## 8. Testing

- Unit-test the deterministic brief fact-gathering and the `decide`-style pure helpers
  (mirroring `fleetAlerts` / `meeting-core` test style).
- Unit-test `ceoActionList` CRUD and the privacy-boundary guard (personal keys rejected
  by `company-state`; served only by the CEO-authed endpoint).
- Smoke-test `valechat` request/response shape.
- Verify Vale renders in the org tree + profile hub and is **absent** from the heartbeat
  (`AGENT_IDS`), budgets, rewards, and standups.

## 9. Isolation guarantees (checklist)

The single runtime chokepoint is `AGENT_IDS`, whose true source is the **`agentRegistry`
blob** (the `constants.js` literal is only the fallback). Keep Vale out of every enrollment
surface:

- [ ] `vale` is not in the `agentRegistry` blob, nor in `constants.js` `AGENT_IDS` /
      `AGENT_ROLES`.
- [ ] `vale` is not in any authorization Set (`PROPOSAL_` / `PRODUCT_PROPOSAL_` /
      `FLEET_MUTATION_` / `CAPITAL_` / `DIRECTIVE_AUTHORIZED_AGENTS`, `PROTECTED_AGENTS`,
      `TIER4_SUB_AGENTS`, `DOMAIN_LEAD_MAP`).
- [ ] `vale` is not in the standup roster (`api/company-standup-run/index.js`) and not
      added to `agentchat`'s `AGENT_PROMPTS`.
- [ ] **Rewards side-channel:** nothing Vale writes ever lands `vale` as `assignee` /
      `author` / `proposedBy` on tasks / blogPosts / approvalQueue / actions — otherwise
      `rewardsEngineCron` mints a public `vale` XP record. Meetings/tasks Vale arranges on
      the CEO's behalf attribute to the CEO/Nova, not Vale.
- [ ] Personal keys are not in `company-state` `VALID_KEYS`, not in `js/company-store.js`,
      and not read by `api/memoryStack/index.js`.
- [ ] No edits to protected files without explicit approval: `companyHeartbeat/index.js`,
      `company-state/index.js`, `staticwebapp.config.json`, `company-actions.json`,
      the CI workflow, `governance.html`, `_`-prefixed files.
- [ ] Vale's briefs run on their own cron, off the heartbeat, on their own webhook.

**Observable post-wiring checks:** `C.AGENT_IDS` contains no `vale`; `agentRewards` has no
`vale` key; `heartbeatProgress.agents` has no `vale` entry.

## 10. Future phases (not this spec)

- Two-way Discord bot: conversation + approve/reject/direction buttons (interactions
  endpoint on an Azure Function).
- Real calendar sync (Google / Outlook OAuth).
- Career/Recruiter agent (separate spec): aggregator + ATS-watchlist job sourcing,
  scoring against `ceoProfile`, tailored application drafts, pipeline board, interview
  prep, "hire me" / meet-my-agents page.

## 11. Decisions

**Resolved:**
1. **CEO-auth strength → MVP email-gate.** The new `vale-state` endpoint verifies the
   decoded `x-ms-client-principal` email against a `CEO_EMAILS` allowlist; keys isolated +
   out of `VALID_KEYS`; the Vale UI sits under the existing `/modules/company/*`
   authenticated gate. No protected-file edits. (Hardened SWA `ceo` role deferred to a
   fast-follow if wanted.)
2. **Model → inherit** the fleet `_useClaude()` toggle for MVP; `systemConfig.valeModel`
   is an easy later add.
3. **Org-tree tier → Tier 1 (Executive)**, "Office of the CEO / Chief of Staff."

**Still open (settle during planning/implementation):**
4. **Profile live-stat** — confirm `agent-profile-live.js` can show a Vale stat without
   crossing the privacy boundary; else use a static label.
5. **Portrait generation** — mechanism (Pixel's image path vs. other) decided in the plan.

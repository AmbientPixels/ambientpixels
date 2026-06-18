# Fleet Command — Agent Evolution Control Panel (Design Spec)

**Date:** 2026-06-17
**Surface:** `ambientpixels/modules/company/fleet.html`
**Status:** Design approved (visuals + technical), pending implementation plan

## Problem

The Fleet page's "Evolve" button is a chain of `window.prompt()` dialogs that asks the CEO to *guess* field names and even hand-type raw **JSON** for `doctrine` and `expectedActionMix` ([fleet.html](../../../modules/company/fleet.html) `openEvolveFlow`, ~line 268). It's unusable without reading the backend. The Retire flow has the same prompt-box problem. There is no way to see an agent's current configuration, its history, or how it's actually behaving versus its intended role.

## Goal

Turn the Fleet page into a **Fleet Command** control panel: each agent is a "character sheet," evolving an agent is a guided modal (dropdowns, segmented pickers, sliders, chip editors — no JSON), and the experience is lightly gamified using **real signals the system already produces** (no fake mechanics). Make evolving agents genuinely easy and make their progression visible.

## Decisions (locked)

- **Scope:** full panel now (character sheet + evolve modal + lineage), built in phases.
- **Mechanics:** hybrid — real-signal character sheet + one derived "experience" number.
- **Apply flow:** both "⚡ Evolve now" (instant) and "Propose for review" (queued).
- **Card direction:** B — full character sheet (traits, loadout, alignment, level, lineage all visible).
- **XP source:** windowed activity from existing `heartbeatRuns` (no backend). Labeled as recent momentum, not lifetime.
- **No backend changes required.** Frontend-only against existing endpoints.

## Backend contract (verified, unchanged)

`agent_evolution_proposal` is validated server-side in `agent-runner.js` (`propose-role-evolution`, ~line 5644):

- **Editable fields (`changes`):** `focus`, `monthlyCap`, `doctrine`, `expectedActionMix` (at least one required).
- **`doctrine` shape:** `{ strategicBias, riskTolerance, timeHorizon, coreQuestion, escalationTriggers[] }` (free-text values).
- **`expectedActionMix` shape:** `{ <action-type>: 'high'|'medium'|'low'|'none' }`.
- **Protected (rejected if present):** `id`, `name`, `tier`, `status`, `hiredAt`, `retiredAt`, `reportsTo`.
- **`monthlyCap`:** number, `0 < cap ≤ FLEET_PROPOSAL_COST_CEILINGS['propose-role-evolution']`.
- On approve: a `snapshot` of pre-change values is preserved as `doctrineHistory` (powers the lineage timeline). 14-day cooldown on rejected same-target proposals.

Payload: `{ type:'agent_evolution_proposal', proposedBy:'ceo', evolution:{ targetAgent, changes, rationale, estimatedCostDelta } }`.

## Architecture

Enhance `fleet.html` in place. Vanilla JS matching the file's existing style and the company design system (`--color-*` tokens, dark dashboard aesthetic, amber accent). No new route, no framework.

### Components

1. **Character-sheet card** (replaces the current compact card). Renders from the roster the page already loads (`agentRegistry`): portrait, name, role, tier, version, traits (doctrine chips), loadout (action-mix mini bars), alignment meter, budget bar, XP/level badge, lineage indicator. Buttons: **Evolve**, **Propose**, **Retire** (Retire disabled for protected agents).
2. **Evolve modal** — prefilled from current values. Sections: Archetype presets · Identity (focus textarea, monthlyCap slider with `$X / $15 fleet budget` context) · Doctrine (`riskTolerance`/`timeHorizon` segmented pickers + custom, `strategicBias`/`coreQuestion` text, `escalationTriggers` chip editor) · Loadout (action-mix matrix: row per action, None/Low/Med/High) · Rationale (required). A live **diff rail** shows only changed fields. Footer: Cancel · **Propose for review** · **⚡ Evolve now**.
3. **Archetype presets** — client-side config object mapping a preset name to a bundle of field values that pre-fill the form (then the user fine-tunes). Examples: Aggressive, Conservative, Output-focused, Reset-to-default.
4. **Lineage drawer** — opens from the card; renders `doctrineHistory` snapshots as a vertical timeline (version, date, changed-fields diff, rationale, proposer/approver, instant vs reviewed). "Compare to current" side-by-side.

### Data flow

- **Diff builder:** compare edited form state against the agent's current values; emit a `changes` object containing only modified fields. `estimatedCostDelta = newCap − currentCap` when `monthlyCap` changed, else `0` (**fixes** the current bug that sends the full cap).
- **Propose for review:** `POST /api/fleetProposalCreate` → pending proposal appears in the existing queue panel.
- **⚡ Evolve now:** `POST /api/fleetProposalCreate` → take returned proposal `id` → `POST /api/approveProposal {id, decision:'approved', ceoNote}`. Instant apply; both governance events fire; `doctrineHistory` snapshot preserved. If the approve call fails, the proposal remains pending (recoverable) and the error is surfaced.
- Client mirrors server validation: blocks protected fields, enforces `0 < cap ≤ ceiling`, requires rationale ≥ 20 chars.

### Real-data stat sources

| Stat | Source |
|------|--------|
| Traits / Loadout (intended) / focus / cap | `agentRegistry` (already loaded) |
| Alignment meter (intended vs actual action mix) | `awarenessDigest` (reflection `roleAdherence`) |
| Budget bar (spend vs cap, vs $15 fleet) | `allocationDigest` + `agentRegistry` |
| Version / level | `doctrineHistory.length + 1` |
| XP (windowed activity) | sum of the agent's `perAgent[id].actionsExecuted` across retained `heartbeatRuns` (~100 runs); labeled as recent momentum, not lifetime |
| Lineage timeline | `doctrineHistory` |

## Build phases

- **P1 — core (kills the pain):** character-sheet card (B) + Evolve modal + both apply paths + live diff + cost-delta fix + client validation. Replaces `openEvolveFlow` prompt chain.
- **P2 — real stats:** alignment meter, budget bar, loadout actual-vs-intended overlay, XP (windowed) + level/version badge. Wire `awarenessDigest` / `allocationDigest` / `heartbeatRuns`.
- **P3 — depth:** lineage drawer + archetype presets.

## Error handling & guardrails surfaced

- Protected agents (nova, cipher) are evolvable (evolution never touches protected fields) but **Retire** stays disabled with a "PROTECTED" tag.
- Locked fields (name/tier/reports-to) shown read-only in the card, never in the editable form.
- monthlyCap slider clamped to `(0, ceiling]`; a warning if the sum of all caps would exceed the $15 fleet budget.
- Instant-apply: chained-call failure leaves a recoverable pending proposal; surface a clear error, never silently lose the edit.
- 14-day cooldown note shown on the modal (applies if a proposal is rejected).

## Out of scope (YAGNI)

- No new backend endpoints or state keys; no heartbeat/`index.js` changes.
- No persistent lifetime XP counter (windowed only).
- No changes to the Forge-proposed evolution path (heartbeat) or to hire/retire logic beyond the card's existing buttons.
- No real-time updates; the panel refreshes on load / action like the current page.

## Verification

- Evolve modal produces a `changes` object containing only edited fields; protected fields never included.
- `estimatedCostDelta` equals the cap delta (regression test the old full-cap bug).
- "Propose for review" creates a pending proposal; "⚡ Evolve now" results in an applied evolution + a new `doctrineHistory` entry.
- Manual render check (screenshot) of card, modal, and lineage against the approved mockups before claiming done.

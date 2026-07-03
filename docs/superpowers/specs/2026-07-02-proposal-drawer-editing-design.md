# Editable Campaign & Objective Proposals in the Actions Drawer — Design

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan
**Author:** CEO + Claude

## Problem

Campaign and objective proposals land in `approvalQueue` and are surfaced on the
Actions page (`modules/company/actions.html`) with read-only detail drawers and
Approve / Reject buttons. The CEO can only accept a proposal as-is or reject it —
there is no way to **rename or edit** a proposal before approving.

This bites in practice: the deterministic generator can anchor a real metric
(e.g. an objective "grow bluesky followers 76→101") but produces generic titles
("Establish a measurable growth objective") and low-substance campaigns
(`product: ""`, name "Revive audience growth" fired only because active-campaign
count < 3). Today the only options are approve-the-generic or reject-and-wait.
The CEO wants to sharpen a proposal in place — fix the title, set a product, adjust
a metric target — then approve.

## Goal

Let the CEO edit the substantive fields of a **pending** campaign or objective
proposal directly in the existing Actions drawer, persist the edit, then approve
the refined proposal.

## Scope

**In scope**
- Editable substantive fields on `campaign_proposal` and `objective_proposal`
  entries while `status === 'pending'`.
- A new server endpoint that validates + persists edits to the queue entry.
- Editable inputs + a "Save changes" button in the two existing proposal drawers.

**Out of scope (YAGNI)**
- Editing resolved proposals (approved / rejected / expired).
- Editing action-type queue entries (social actions keep their existing
  approve / revision flow).
- Adding new proposal fields beyond what proposals already carry.
- Refactoring the materialize triplication (`proposalDecide/materialize.js` +
  client-side approve in `actions.html` + generator) — separate debt. The new
  validated endpoint is a step toward consolidation but does not tackle it here.

## Decisions (from brainstorming)

1. **Edit scope:** substantive set, not rename-only and not every field.
   - Campaign: `name`, `description`, `platforms`, `frequency`, `cadence`,
     `duration`, `product`, `kpiTarget`, `northStarMetric`.
   - Objective: `title`, `description`, `successCriteria`, `northStarMetric`,
     `metricTarget`, `metricDeadline`, `timeHorizon`.
   - Read-only provenance: `source`, `proposedBy`, `rationale`, `createdAt`,
     `id`, `type`, `status`.
2. **Save model:** explicit **Save changes** button (persists to the queue,
   proposal stays pending) + separate Approve / Reject (unchanged, act on the
   saved values). No auto-save.
3. **Architecture:** small validated **server endpoint** (`proposalEdit`), sibling
   to `proposalDecide`. Server is authoritative for validation; the browser stays
   thin.

## Architecture

### Component 1 — `POST /api/proposalEdit`

New Azure Function `api/proposalEdit/index.js`, modeled on `api/proposalDecide/`.

- **Auth:** `x-company-secret` OR SWA `x-ms-client-principal` (same guard as
  `proposalDecide`). 403 otherwise.
- **Request body:** `{ id: string, patch: object }`.
- **Flow:**
  1. Load `approvalQueue`.
  2. Find `target = queue.find(q => q.id === id && q.status === 'pending')`.
     - Not found → `404 { error: 'proposal not found' }`.
     - Found but resolved (defensive) → `409 { error: 'proposal not pending' }`.
  3. Guard `target.type ∈ { 'campaign_proposal', 'objective_proposal' }`, else
     `400 { error: 'not an editable proposal type' }`.
  4. `const { clean, error } = validatePatch(target.type, patch)` (pure module,
     below). If `error` → `400 { error }`.
  5. `Object.assign(target, clean)`; stamp `target.editedAt = nowIso`,
     `target.editedBy = 'ceo'`, `target._edited = true`.
  6. **Metric-flag consistency (objective only):** after merge, if
     `northStarMetric && metricTarget != null` → `target.strategyFlag = null`;
     else `target.strategyFlag = 'no-north-star-metric'`.
  7. `setState('approvalQueue', queue)`.
  8. Emit governance event `proposal-edited` (append to `governanceLog`, cap 5000)
     with `details: { proposalId, proposalType, fields: Object.keys(clean) }`.
  9. `200 { ok: true, entry: target }`.
- **Failure:** any thrown error → `500 { error }`. No partial writes (single
  `setState` at the end).

`proposal-edited` is added to `_GOVERNANCE_TYPES` in
`api/companyHeartbeat/helpers.js` so it routes to `governanceLog`.

### Component 2 — `api/proposalEdit/validate.js` (pure, unit-tested)

```
validatePatch(type, patch) -> { clean: object, error: string|null }
```

- Field allowlist per type (unknown keys dropped, never an error).
- Per-field coercion / clamping:
  - `name` / `title`: `String`, trim, 1–100 chars. Empty after trim → `error`
    ("name is required" / "title is required").
  - `description`: String, ≤1000.
  - `successCriteria`: String, ≤300.
  - `kpiTarget`: String, ≤200.
  - `product`: String, ≤50.
  - `duration` / `timeHorizon`: String, ≤50.
  - `northStarMetric`: String ≤50, or `null` (empty string → `null`).
  - `platforms`: Array; keep only values in `VALID_SOCIAL_TASK_TYPES`
    (`social_x`, `social_linkedin`, `social_bluesky`, `social_facebook`,
    `social_reddit`). If the array becomes empty, omit it from `clean` (keep the
    proposal's prior value rather than blanking).
  - `frequency`: integer, clamp to `[1, 14]`; non-numeric → omit.
  - `cadence`: must be in `{ daily, weekly, biweekly }`; else omit.
  - `metricTarget`: finite number ≥ 0, or `null`; non-numeric non-null → omit.
  - `metricDeadline`: matches `^\d{4}-\d{2}-\d{2}$`, or `null`; else omit.
- Only required-field emptiness is a hard `error`; every other bad value is
  silently coerced or omitted so a partial/typo patch never 400s the whole save.

This module has **no IO** — imported by the endpoint and by the test file, run
with `node api/proposalEdit/validate.test.js`.

### Component 3 — Editable drawer (`modules/company/actions.html`)

Two existing functions gain edit inputs:
- `openProposalDrawer(idx)` (campaign, ~line 1321)
- the objective drawer (~line 1552)

Changes:
- Substantive fields render as form controls (text / textarea / number / select /
  date / platform checkboxes) pre-filled from the proposal. Provenance stays as
  read-only text.
- A new **Save changes** button sits with Approve / Reject in the actions row.
- `saveProposalEdit(proposalId, type)`:
  1. Read the field values from the drawer inputs into a `patch` object.
  2. `POST /api/proposalEdit { id, patch }`.
  3. On `200`: merge `entry` back into the cached `window._campaignProposals` /
     `window._objectiveProposals` item, show an inline "saved ✓" note, keep the
     drawer open, and refresh the list count/label. On error: show the message.
- Approve / Reject are unchanged; because Save already patched the queue entry,
  approval materializes the edited values.
- A light client-side check mirrors the required-field rule (disable Save with a
  hint if name/title is blank) purely for instant feedback — the server remains
  authoritative.
- Styling reuses `act-drawer-section`, `act-drawer-kv`, and existing button
  classes; inputs get minimal dark-theme styling consistent with the page.

## Data flow

```
CEO edits fields in drawer
   → Save changes → POST /api/proposalEdit { id, patch }
        → validatePatch (allowlist + coerce)  [pure]
        → merge into approvalQueue entry (stamp editedAt/editedBy/_edited)
        → strategyFlag reconciled (objective)
        → setState(approvalQueue) + governanceLog 'proposal-edited'
        → 200 { entry }
   → drawer updates cached entry, shows "saved ✓" (stays pending)
CEO clicks Approve → existing approve path materializes the *edited* entry
```

## Error handling

- Missing/blank required field → `400`, drawer surfaces the message, nothing
  written.
- Proposal no longer pending (heartbeat/another tab resolved it) → `404/409`,
  drawer tells the CEO to reload.
- Network/500 → drawer shows a non-destructive error; the proposal is unchanged.
- Read-modify-write on `approvalQueue`: the endpoint reads immediately before the
  single write to minimize the clobber window against the hourly heartbeat; the
  operation is a manual, low-frequency action so a lost-update race is acceptable
  and self-heals on the next save/reload.

## Testing

- **Unit (`validate.test.js`, pure):** allowlist drops unknown keys; each field's
  coercion/clamp; required-field emptiness returns `error`; platforms filter to
  valid set; empty platforms omitted; metric-flag reconciliation
  (fill → `strategyFlag=null`, clear → `'no-north-star-metric'`).
- **Manual:** open the live pending objective, rename + change `metricTarget`,
  Save, confirm the `approvalQueue` entry changed via
  `GET /api/company-state?key=approvalQueue`, then Approve and confirm the
  materialized objective reflects the edits.

## Files touched

- `api/proposalEdit/index.js` — new endpoint (function.json + index.js).
- `api/proposalEdit/validate.js` — new pure validator.
- `api/proposalEdit/validate.test.js` — new unit tests.
- `api/companyHeartbeat/helpers.js` — add `proposal-edited` to `_GOVERNANCE_TYPES`.
- `modules/company/actions.html` — editable inputs + Save in both proposal
  drawers, `saveProposalEdit()`.

## Rollback

Purely additive. Revert the commit to remove the endpoint + drawer edits; existing
approve/reject behavior is untouched. No state migration.

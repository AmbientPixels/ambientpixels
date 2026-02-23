# GridOS Form Intake v1.5

## Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/formIntake` | Submit form (contact/demo/newsletter) |
| GET | `/api/formIntake/recent?days=7&limit=50` | Recent submissions from daily index |
| GET | `/api/formIntake/item?id=fi_...` | Single canonical record |
| GET | `/api/formIntakeDigest?date=YYYY-MM-DD` | Generate daily intake digest (on-demand) |
| Timer | `formIntakeDigestTimer` (daily 9:00 AM PT / 17:00 UTC) | Auto-generate yesterday's digest |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORM_INTAKE_SALT` | Recommended | Salt for IP hashing (rate limiter). Defaults to a static fallback. |
| `AZURE_STORAGE_CONNECTION_STRING` | Yes (prod) | Blob storage connection. Falls back to local file storage in dev. |

## Storage Paths (Blob)

- **Canonical record:** `formIntake-YYYY-MM-fi_YYYY-MM-DD_xxx.json`
- **Daily index:** `formIntake-index-YYYY-MM-DD.json`
- **Rate limit:** `formIntake-ratelimit-{ipHash}-{bucket}.json`
- **Dedupe index:** `formIntake-dedupe-{sha256hash}.json`

## Anti-Spam

- **Honeypot:** hidden `hp` field — if filled, returns `200 { ok:true }` silently (no storage)
- **Min submit time:** 2500ms from first interaction (production origins only)
- **Rate limit:** 10 submissions per 15 min per IP hash (sha256)

## Task Spawning

- `contact` → task assigned to Nova, priority: low
- `demo` → task assigned to Scout, priority: medium
- `newsletter` → no task (store-only)

## Duplicate Suppression (v1.1)

**Key:** `sha256(lower(email) + "|" + type)` (first 20 chars)
**Window:** 60 minutes rolling

**Behavior:**
- Every submission is **always stored** (canonical JSON + daily index) for audit trail.
- Before task spawning, the system checks the dedupe index blob.
- If a matching submission with a `taskId` exists within the last 60 minutes:
  - **No new task** is created.
  - The new record is marked `status: "duplicate"`, `duplicateOf: <existingId>`, reuses the same `taskId`.
  - A comment is appended to the existing task noting the duplicate.
- If no match (or window expired): task is created normally, dedupe index is updated.

**Dedupe blob schema:**
```json
{
  "key": "user@example.com|contact",
  "hash": "abc123...",
  "lastSubmissionId": "fi_2026-02-23_xxx",
  "lastTaskId": "task-123...",
  "lastReceivedAt": "2026-02-23T22:00:00Z",
  "lastPageUrl": "/support",
  "countInWindow": 2
}
```

**Record fields added:**
- `status`: `"task_created"` | `"duplicate"` | `"stored"` | `"new"`
- `duplicateOf`: submission ID of the original (null if not duplicate)

## Echo Auto-Draft Reply (v1.2)

For new inbound tasks (`status === "task_created"`), the system automatically generates a template-based reply draft and creates it as a **child task assigned to Echo**.

**Trigger conditions:**
- Only when `status === "task_created"` AND `taskId` exists
- Skipped for `duplicate`, `stored` (newsletter), and `new` statuses
- No duplicate drafts — guard via `status` check (drafts only fire on first task creation)

**Draft templates (v1 — deterministic, no LLM):**
- **contact**: Acknowledgement + 2 clarifying questions + response window promise
- **demo**: Thank you + suggest next steps (portfolio link) + ask for use case + schedule promise
- Incorporates `message.subject` if present
- Personalizes greeting with first name if available
- Signed: `— AmbientPixels / GridOS`
- Target: ~120–160 words

**Child task schema:**
- Title: `"Draft reply — <Inbound Task Title>"`
- Description starts with `[AUTO_DRAFT_REPLY]` marker
- `assignee: "echo"`
- `origin: "form_intake_auto_draft"`
- `badge: "✉️ Draft Reply"`
- `parentTaskId: <inbound taskId>`
- Includes submission ID, type, and clearly labeled draft block
- Footer: "Review and send manually. Do NOT auto-send."

**Record fields added:**
- `draftReplyCreated`: boolean
- `draftTaskId`: child task ID (null if no draft)

## Manual Test Checklist

```
[ ] contact submit    → record + index + task created, status=task_created
[ ] demo submit       → record + index + task created (medium priority)
[ ] newsletter submit → record + index, NO task, status=stored
[ ] honeypot filled   → 200 ok:true, NO record, NO task
[ ] too-fast submit   → 400 invalid_request (prod origins, <2.5s)
[ ] rate limit hit    → 429 rate_limited (>10 in 15min from same IP)
[ ] missing email     → 400 validation_failed
[ ] missing privacy   → 400 validation_failed (contact/demo types)
[ ] Inbound page      → loads, shows table, filters work, drawer opens
[ ] Contact modal     → submits to GridOS (not Formspree), shows success
[ ] DEDUPE: 2nd contact submit within 60min → record stored, status=duplicate,
    duplicateOf populated, same taskId, NO new task, comment on existing task
[ ] DEDUPE: submit after 61min → new task created normally
[ ] DEDUPE: Inbound UI shows 'Duplicate (linked)' pill for duplicates
[ ] DRAFT: contact submit → inbound task + draft reply child task created
[ ] DRAFT: demo submit → inbound task + draft reply child task created
[ ] DRAFT: newsletter submit → NO draft (no task at all)
[ ] DRAFT: duplicate submit → NO new draft, original draft untouched
[ ] DRAFT: canonical record has draftReplyCreated:true + draftTaskId
[ ] DRAFT: child task has [AUTO_DRAFT_REPLY] marker, assignee=echo, parentTaskId set
[ ] DRAFT: Inbound drawer shows 'Draft Reply' link when draftTaskId present
[ ] DIGEST: GET /api/formIntakeDigest?date=<today> after 3+ submissions → task created
[ ] DIGEST: Nova task has correct counts (total, byType, uniqueTasks, duplicates, filtered)
[ ] DIGEST: Notables list shows @domain.com only (no full emails)
[ ] DIGEST: Notables intent summaries do not contain verbatim message bodies
[ ] DIGEST: Task links present in notable items
[ ] DIGEST: Runtime memory entry (intake_digest_<date>) has no full emails or bodies
[ ] DIGEST: Calling digest twice for same date returns alreadyExists:true (idempotent)
[ ] DIGEST: ?force=true regenerates even if existing digest found
[ ] DIGEST: Empty day → task created with "No inbound" action suggestion
[ ] TIMER: Timer fires at 17:00 UTC (9:00 AM PT), generates yesterday's digest
[ ] TIMER: If digest already exists for yesterday, timer logs skip and exits cleanly
[ ] TIMER: No force regeneration — timer never overwrites existing digest
[ ] STATUS: Newsletter row → Stored Only (gray pill)
[ ] STATUS: Contact row with task + draft → Draft Ready (purple pill)
[ ] STATUS: Mark inbound task done → row shows Closed (muted green pill)
[ ] STATUS: Duplicate row → Duplicate (linked) (orange pill)
[ ] STATUS: Contact row with task, no draft → Task Created (blue pill)
[ ] STATUS: Detail drawer shows computed status pill + reason
[ ] STATUS: Stats count excludes stored_only and duplicate from task total
```

## Files Created

- `api/formIntake/function.json` — HTTP trigger config
- `api/formIntake/index.js` — Backend function (write + read endpoints)
- `api/formIntakeDigest/function.json` — Digest HTTP trigger config
- `api/formIntakeDigest/index.js` — Daily digest generator (stats, notables, task, memory)
- `api/formIntakeDigestTimer/function.json` — Timer trigger config (daily 9 AM PT)
- `api/formIntakeDigestTimer/index.js` — Timer wrapper calling shared digest logic
- `js/form-intake.js` — Frontend submit helper (binds to `data-gridos-intake`)
- `modules/company/inbound.html` — Inbound viewer page
- `modules/company/js/inbound-intake.js` — Viewer client logic

## Files Modified

- `modules/contact-modal.html` — Removed Formspree, added `data-gridos-intake`
- `js/init-contact-modal.js` — Dynamic `form-intake.js` loader after modal inject
- `modules/company/js/sidebar.js` — Added Inbound nav item
- `staticwebapp.config.json` — Added formIntake + formIntakeDigest route rewrites
- `support/index.html` — Migrated engage form from Formspree to GridOS intake

## v1.1 Changes (Dedupe)

- `api/formIntake/index.js` — Added dedupe section: `_dedupeHash`, `_readDedupe`, `_writeDedupe`, `_checkDedupe`, `_appendTaskComment`. POST handler checks dedupe before task spawn, marks duplicates, appends task comments.
- `modules/company/js/inbound-intake.js` — `getStatus()` shows 'Duplicate (linked)' pill, drawer shows `duplicateOf` field, stats count unique tasks only.
- `modules/company/inbound.html` — Added `.inb-status--duplicate` CSS.

## v1.2 Changes (Echo Auto-Draft Reply)

- `api/formIntake/index.js` — Added `_generateDraftReply(record)` (template engine for contact/demo), `_createReplyDraft(parentTaskId, parentTitle, record)` (child task creator assigned to Echo). POST handler creates draft after task spawn when `status === 'task_created'`. Stores `draftReplyCreated` + `draftTaskId` on canonical record and index entry.
- `modules/company/js/inbound-intake.js` — Detail drawer shows 'Draft Reply' link when `draftTaskId` present, shows 'Draft exists on original' note for duplicates.

## v1.3 Changes (Daily Intake Digest)

- **Created** `api/formIntakeDigest/function.json` + `index.js` — On-demand GET endpoint that reads daily index, computes stats (total, byType, uniqueTasks, duplicates, filtered), selects top 3 notable items with PII redaction, creates a Nova digest task, and appends a redacted L4 runtime memory entry.
- `staticwebapp.config.json` — Added `/api/formIntakeDigest` SWA route rewrite.

### Digest Endpoint

```
GET /api/formIntakeDigest?date=2026-02-23
GET /api/formIntakeDigest              (defaults to yesterday)
GET /api/formIntakeDigest?date=2026-02-23&force=true  (regenerate)
```

**Response:**
```json
{
  "ok": true,
  "date": "2026-02-23",
  "stats": { "total": 5, "byType": {...}, "uniqueTasks": 3, "duplicates": 1, "filtered": 0 },
  "notables": [ { "type": "demo", "name": "Jane", "emailDomain": "@acme.com", "intent": "..." } ],
  "taskId": "task-...-digest-...",
  "memoryKey": "intake_digest_2026-02-23",
  "alreadyExists": false
}
```

### Redaction Rules

- Email → domain only (`jane@acme.com` → `@acme.com`)
- Name → first name only
- Message body → 1-line intent summary (never verbatim)
- Phone numbers → stripped
- Runtime memory entry marked `_redacted: true`

### Digest Task (Nova)

- Title: `"Daily Intake Digest — YYYY-MM-DD"`
- Assignee: `nova`, Origin: `form_intake_digest`, Badge: `🧾 Intake Digest`
- Description: stats bullets, notable items (redacted), suggested actions, PII notice
- Idempotent: one digest per date (unless `?force=true`)

## v1.4 Changes (Scheduled Timer)

- **Created** `api/formIntakeDigestTimer/function.json` — Timer trigger at `0 0 17 * * *` (17:00 UTC = 9:00 AM America/Los_Angeles).
- **Created** `api/formIntakeDigestTimer/index.js` — Lightweight timer that calls shared digest logic from `formIntakeDigest`. Date = yesterday, force = false. Idempotency guard prevents duplicates if timer reruns or if on-demand digest was already generated. Logs run start, skip (if exists), or completion with taskId + memKey.
- **Modified** `api/formIntakeDigest/index.js` — Exported core functions (`_readIndex`, `_buildDigest`, `_createDigestTask`, `_appendRuntimeMemory`, `_digestTaskExists`) for timer reuse.

### Schedule Details

| Timer | CRON | UTC | PT (America/Los_Angeles) |
|---|---|---|---|
| `formIntakeDigestTimer` | `0 0 17 * * *` | 17:00 daily | 9:00 AM daily |
| `companyMorningReport` (ref) | `0 30 15 * * *` | 15:30 daily | 7:30 AM daily |

The digest timer runs 90 minutes after the morning report, ensuring overnight submissions are captured before the digest is generated.

## v1.5 Changes (Inbound Status Sync)

- **Modified** `api/formIntake/index.js` — GET `/recent` endpoint now computes lifecycle `computedStatus` per item at read-time by batch-fetching tasks and checking their state. Single `getState('tasks')` call for all items. Fail-soft: if enrichment fails, items returned without `computedStatus`.
- **Modified** `modules/company/js/inbound-intake.js` — `getStatus()` prefers `computedStatus` from backend, with fallback to legacy `status` field. New `STATUS_PILL_MAP` drives all pill rendering. Detail drawer shows computed status pill with reason tooltip. Stats exclude `stored_only` and `duplicate` from task count.
- **Modified** `modules/company/inbound.html` — Added `.inb-status--stored` (gray), `.inb-status--draft` (purple), `.inb-status--closed` (muted green) CSS classes.

### Computed Statuses

| `computedStatus` | Condition | Pill Color |
|---|---|---|
| `stored_only` | No task spawned (newsletter, etc.) | Gray |
| `task_created` | Task exists, open, no draft | Blue |
| `draft_ready` | Task exists + `draftTaskId` present | Purple |
| `closed` | Linked task status is `completed` or `done` | Muted green |
| `duplicate` | Record has `duplicateOf` or `status === 'duplicate'` | Orange |

Statuses are computed at read-time from live task state — no blob rewrites needed. Backward compatible: older clients ignore `computedStatus` fields.

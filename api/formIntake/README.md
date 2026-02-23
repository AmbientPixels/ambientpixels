# GridOS Form Intake v1.1

## Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/formIntake` | Submit form (contact/demo/newsletter) |
| GET | `/api/formIntake/recent?days=7&limit=50` | Recent submissions from daily index |
| GET | `/api/formIntake/item?id=fi_...` | Single canonical record |

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
```

## Files Created

- `api/formIntake/function.json` — HTTP trigger config
- `api/formIntake/index.js` — Backend function (write + read endpoints)
- `js/form-intake.js` — Frontend submit helper (binds to `data-gridos-intake`)
- `modules/company/inbound.html` — Inbound viewer page
- `modules/company/js/inbound-intake.js` — Viewer client logic

## Files Modified

- `modules/contact-modal.html` — Removed Formspree, added `data-gridos-intake`
- `js/init-contact-modal.js` — Dynamic `form-intake.js` loader after modal inject
- `modules/company/js/sidebar.js` — Added Inbound nav item
- `staticwebapp.config.json` — Added formIntake route rewrites
- `support/index.html` — Migrated engage form from Formspree to GridOS intake

## v1.1 Changes (Dedupe)

- `api/formIntake/index.js` — Added dedupe section: `_dedupeHash`, `_readDedupe`, `_writeDedupe`, `_checkDedupe`, `_appendTaskComment`. POST handler checks dedupe before task spawn, marks duplicates, appends task comments.
- `modules/company/js/inbound-intake.js` — `getStatus()` shows 'Duplicate (linked)' pill, drawer shows `duplicateOf` field, stats count unique tasks only.
- `modules/company/inbound.html` — Added `.inb-status--duplicate` CSS.

# Daily Standup Runner

Automated daily standup via `/api/company-standup-run` on the Azure Function App.

## Architecture

| Layer | Hostname | Supports POST? |
|---|---|---|
| **Azure Function App** (canonical) | `ambientpixels-nova-api.azurewebsites.net` | ✅ Yes |
| **Azure Static Web App** (UI host) | `ambientpixels.ai` | ❌ GET only |

> **Why?** Azure SWA external rewrites (`staticwebapp.config.json` route rules) only proxy
> GET/HEAD/OPTIONS requests. POST is never forwarded. All client-side code and server-to-server
> calls must use the Function App hostname directly for POST operations.

The SWA route entry for `/api/company-standup-run` exists in `staticwebapp.config.json`
for GET/OPTIONS visibility only. It is **not** the canonical POST path.

## Endpoint

```
POST https://ambientpixels-nova-api.azurewebsites.net/api/company-standup-run
Header: x-standup-key: <STANDUP_API_KEY>
```

## Auth

Requires `x-standup-key` header matching `STANDUP_API_KEY` environment variable on the Function App.
The same value is stored as a GitHub Actions secret for the cron workflow.

## Responses

| HTTP | Body | Meaning |
|---|---|---|
| 200 | `{ "ok":true, "skipped":false, "standupId":"...", "agentsCount":8, ... }` | Standup ran successfully |
| 200 | `{ "ok":true, "skipped":true, "reason":"already_ran" }` | Already ran today — idempotent skip |
| 409 | `{ "ok":false, "error":"standup_running" }` | Another run is in progress |
| 401 | `{ "ok":false, "error":"unauthorized" }` | Invalid or missing API key |
| 500 | `{ "ok":false, "error":"standup_failed", "message":"..." }` | Server error |

## Cron Schedule

Workflow: `.github/workflows/daily-standup.yml`

- **Schedule:** Mon–Fri at 15:30 UTC (7:30am PST / 8:30am PDT)
- **Manual trigger:** `workflow_dispatch` enabled
- **Exit codes:** 200 and 409 = success; 401, 5xx, network errors = failure

## Testing (PowerShell)

```powershell
# Run standup (or get skipped/401)
curl.exe -i -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-standup-run" `
  -H "x-standup-key: <YOUR_KEY>"

# Expected: 200 (ran or skipped), 409 (in progress), or 401 (bad key)
```

```powershell
# Verify SWA POST does NOT work (expected 405)
curl.exe -i -X POST "https://ambientpixels.ai/api/company-standup-run" `
  -H "x-standup-key: <YOUR_KEY>"

# Expected: 405 Method Not Allowed — this is correct behavior
```

## Files

| File | Purpose |
|---|---|
| `api/company-standup-run/function.json` | Azure Function HTTP trigger config |
| `api/company-standup-run/index.js` | Server-side standup runner (calls Gemini, saves to standupLog) |
| `.github/workflows/daily-standup.yml` | Cron workflow (weekday 7:30am PT) |
| `staticwebapp.config.json` (line ~170) | SWA proxy route — **GET only**, not for POST |

## Guardrails

- Standup runs once per day (checks `standupLog` for today's `dateLabel`)
- In-memory lock prevents concurrent runs
- All proposals remain `Pending` — never auto-approved
- `STANDUP_ORDER`, `CFO_THRESHOLD`, and governance rules are unchanged
- Governance audit entry written to `governanceLog` on every invocation

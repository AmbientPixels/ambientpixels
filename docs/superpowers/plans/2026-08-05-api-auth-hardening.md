# Plan — API Auth Hardening

**Status:** approved in principle (approach A), not started.
**Gates:** the AmbientOS monetization post. The post invites developers to read the architecture; the repo is public; the API is currently unauthenticated. Publishing before this lands is inviting the exact audience that can exploit it.

---

## The problem, with evidence

**1. There is no API authentication at all.**
`api/_utils/companyStorage.js:251`:
```js
function validateSecret(headerValue) {
  if (!WRITE_SECRET) return true; // no secret configured = open writes
  return headerValue === WRITE_SECRET;
}
```
`COMPANY_WRITE_SECRET` is **absent** from the Function App app settings — confirmed directly:
```
az functionapp config appsettings list --name ambientpixels-nova-api \
  --resource-group ambientpixelsV2 --query "[?contains(name,'SECRET')].name"
# COMPANY_WRITE_SECRET is not in the returned list
```
Confirmed behaviourally — a wrong secret and no secret both succeed:
```
"pixelpusher"                 -> 200
"definitely-wrong-secret-xyz" -> 200
"(none)"                      -> 200
```
54 endpoints call `validateSecret`. All are open. `company-state` is publicly **readable and writable**: `tasks`, `objectives`, `agentMemories`, `approvalQueue` can be read, poisoned, or wiped by anyone with the URL. Git restores code, not blob state.

**2. The repo is public.** `AmbientPixels/ambientpixels` — `private: false`. `pixelpusher` appears in 47+ tracked files and in full git history. **No secret can ever live in a client-side file in this repo.** This is the binding design constraint: any secret introduced into browser-served code is burned by the commit that introduces it.

**3. `x-ms-client-principal` is trusted without verification.** Read directly from headers in `actionAudit/index.js:111`, `actionsExecute/index.js:88`, `agentforge-drafts/index.js:21`, `agentforge-portrait`. `jsonwebtoken` exists only as a transitive dep in `node_modules` — no app code validates a token. Because the Function App is directly reachable (bypassing SWA), **the header is forgeable**: `curl -H "x-ms-client-principal: <base64 of anything>"` impersonates any user. Any design that gates on this header inherits the hole.

**4. Not found (good):** no Stripe keys, GitHub PATs, Google API keys, or Slack tokens in tracked files. `local.settings.json` is untracked. Real credentials are in Azure env vars as designed. The exposure is specifically the company API secret and the missing enforcement.

---

## Caller inventory — verified complete (CEO confirmed no others)

| Caller | Count | Sends | Notes |
|---|---|---|---|
| Dashboard `modules/company/*` | 47 literal + 30 `SECRET` var + 7 `CompanyStore._writeSecret` | `pixelpusher` | Behind SWA `allowedRoles: ["authenticated"]` |
| GitHub Actions keepalive | 1 | `${{ secrets.COMPANY_WRITE_SECRET }}` | Already correct; value unknowable (GH secrets are write-only) |
| Blindspot public JS | 3 files | `pixelpusher` hardcoded | **Publicly served.** All call `content-quick-generate` |
| `js/agent-engine.js` | 1 | `pixelpusher` hardcoded | Calls `agentchat`, which does **not** validate — header is vestigial |

Crons and heartbeat call storage **in-process**, never over HTTP. Unaffected by any of this.

Dashboard call paths are inconsistent: mostly relative `/api/`, at least one direct Function App URL, and **six different `API_BASE` definitions**. Direct calls bypass SWA, so SWA-injected headers are not available on them.

---

## Design — A4 (recommended refinement of approach A)

The originally-sketched "bootstrap endpoint returning the secret to authenticated users" is **unsound**: gated on the forgeable principal header, and directly reachable on the Function App. Hardening it would require real B2C JWT validation (JWKS, issuer/audience config) plus confirming the dashboard can even obtain a usable B2C access token through SWA — an unverified assumption and a much larger build.

**A4 removes the problem instead of hardening it: serve the secret as a deploy-generated static asset behind SWA's static-route auth.**

- GitHub Actions writes `modules/company/runtime-config.js` at deploy time from `secrets.COMPANY_WRITE_SECRET`.
- The file is **gitignored** — never committed, never in history.
- `staticwebapp.config.json` already gates `/modules/company/*` to `allowedRoles: ["authenticated"]`. SWA enforces this **at the edge on a static asset**, and static files have no direct-to-origin bypass the way the Function App does.
- The dashboard reads `window.AP_SECRET` from it and passes it in `x-company-secret` exactly as today.

Why this beats the endpoint variant: no new API surface, no JWT validation, no forgeable header, no reliance on unverified B2C token plumbing. The enforcement point is SWA static routing, which is not bypassable.

**Residual risk, stated plainly:** any authenticated dashboard user can read the secret from that file. Acceptable — the only authenticated user is the CEO, and this is a shared-secret model regardless. It removes *public* access, not *insider* access. If additional users are ever added, revisit with approach B.

---

## Sequence — ordered so the CEO is never locked out

Each step is independently deployable and reversible. **Order matters:** the secret is enabled last.

**Step 0 — Spike (no production change).** Confirm GitHub Actions can write a file into the SWA build output and that SWA serves it under the authenticated route. Verify anonymous fetch of `runtime-config.js` returns 401/302, not 200. *If this fails, stop — the whole design rests on it.*

**Step 1 — Generate the config file.** Add the generation step to the workflow + a `.gitignore` entry. Deploy. Nothing consumes it yet.
*Verify:* authenticated fetch returns the file; anonymous fetch does not.
*Rollback:* remove the workflow step.

**Step 2 — Dashboard consumes it, with fallback.** Central getter reads `window.AP_SECRET`, **falling back to the current hardcoded value** if absent. Replace the 47 literals + `SECRET` vars + `CompanyStore._writeSecret` with the getter. Deploy.
*Verify:* every dashboard page still loads and writes. The fallback means this is non-breaking either way.
*Rollback:* revert the commit.

**Step 3 — Free the public callers.** Change `contentQuickGenerate` auth to permit anonymous (already bounded by the 25/day anon cap shipped in `b791efc1`), then strip the secret from the 3 Blindspot files and `agent-engine.js`.
*Verify:* anonymous Blindspot image generation works with **no** secret header.
*Rollback:* revert.
*This step must precede Step 4 or Blindspot breaks the moment the secret becomes real.*

**Step 4 — Turn on enforcement.** Generate a strong secret. Set the GitHub secret `COMPANY_WRITE_SECRET`, then the Azure app setting. Redeploy so the config file regenerates with the new value.
*Verify, in order:* unauthenticated `curl` to `company-state` now returns 403 (**the actual objective**) · dashboard loads and writes · keepalive workflow green · Blindspot image generation still works.
*Rollback:* delete the Azure app setting — `validateSecret` returns to fail-open instantly, restoring today's behaviour.

**Step 5 — Remove the fallback** from Step 2 so the hardcoded value is gone from the codebase. Deploy.
*Verify:* `git grep pixelpusher` returns nothing in shipped code.

---

## Verification gate (all must pass before the post publishes)

```bash
# 1. THE objective — must be 403
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=tasks"

# 2. wrong secret must also be 403
curl -s -o /dev/null -w "%{http_code}\n" -H "x-company-secret: pixelpusher" \
  "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=tasks"

# 3. no secret left in shipped code
git grep -n pixelpusher -- . ':!docs' ':!*.md'
```

---

## Out of scope (deliberately)

- Approach B (route all 54 endpoints through the SWA proxy + verified principal). Correct long-term; blast radius too large now. Revisit if more users are added.
- Fixing the forgeable `x-ms-client-principal` in the 4 endpoints that trust it. **Real and unfixed by this plan** — worth its own pass, and it should be logged as a known issue rather than silently carried.
- Adding `anonImageGenDaily` to `company-state` VALID_KEYS for observability (touches a protected file; low value).

## Open questions

1. Does the SWA build pipeline permit generated files in the output? Step 0 answers this; everything depends on it.
2. ~~What is currently in the GitHub `COMPANY_WRITE_SECRET`?~~ **ANSWERED at Step 1.** It is set, to `pixelpusher` — surfaced by the generated file itself (unknowable from the GitHub UI, but the deploy pipeline reveals it). This de-risks Step 4: CI has been sending `pixelpusher` all along, so the Azure app setting and the GitHub secret must be changed **together**, and CI picks the new value up on the next deploy with no workflow edit.
3. Should the secret rotate on a schedule afterward? A4 makes rotation cheap (change the GH secret + Azure setting, redeploy). Not automated in v1.

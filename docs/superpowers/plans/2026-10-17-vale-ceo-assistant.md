# Vale CEO Assistant (Stage 0 + 1) Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (Chad's choice: build normally on master tonight). Steps use checkbox (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-10-17-vale-ceo-assistant-design.md` (rev 3).

**Goal:** Real sign-in lock for Vale, then a read-only mail + calendar morning brief emailed from `vale@ambientpixels.ai`, and mail context in Vale's chat.

**Architecture:** Pure modules under `api/_lib/vale/` (JWT verify, token crypto, schedule, OAuth, token store, Graph client, triage, brief, mailer, brief run) each with a `node file.test.js` test in the repo's PASS/FAIL harness style. Thin Azure Function wrappers (`vale-connect`, `valeMorningBrief`) inject real deps. Existing `valeAuth`, `valeStorage`, `vale-state`, `valechat`, `valeBriefCron`, `office.html` are extended, never rewritten.

**Tech stack:** Node 20 Azure Functions (v3 `module.exports = async (context, req)`), `node:crypto`, global `fetch` (fallback `node-fetch`), Microsoft Graph v1.0, `api/_lib/llm` `callModel`. **No new npm dependencies.**

**Rules for every task:** write the whole change and its tests in one go; run the task's tests plus `node api/_utils/valeStorage.test.js`; commit **by path** immediately (`Release: none`); never touch `companyHeartbeat/index.js`, `company-state`, `staticwebapp.config.json`, `package-lock.json`; never write to Entra, Exchange or app settings.

---

## File map

| File | Responsibility |
|---|---|
| `api/_lib/vale/jwt.js` | `decodeJwt`, `verifyAccessToken(token, opts)` → `{ok, claims}` / `{ok:false, reason}` |
| `api/_lib/vale/tokenCrypto.js` | `encrypt(text, keyB64)` / `decrypt(box, keyB64)`, AES-256-GCM |
| `api/_lib/vale/schedule.js` | `pacificParts(ms)`, `shouldSendBrief(ms, log)` |
| `api/_utils/valeStorage.js` | key classes (`gate`/`bearer`/`rules`/`never`), `accessFor`, `getValeWithMeta`, `mutateVale` |
| `api/_utils/valeAuth.js` | + `valeConfig`, `bearerFrom`, `requireCeoAsync(req, ctx, opts, deps)` with JWKS cache |
| `api/vale-state/index.js`, `api/valechat/index.js` | switch to `requireCeoAsync`, CORS `Authorization`, per-class key access, `rules.get/set` |
| `api/_lib/vale/oauth.js` | `SCOPES`, `makePkce`, `makeState`, `authorizeUrl`, `tokenRequest`, `idTokenClaims` |
| `api/_lib/vale/tokenStore.js` | `getAccessToken(deps)`, `ReconnectError`, `StoreError` |
| `api/vale-connect/` | `status`, `start`, `callback`, `disconnect`, `forget`; 503 until configured |
| `api/_lib/vale/graph.js` | `createGraph({fetch, token, sleep})` → `listInbox`, `listSent`, `calendarView` |
| `api/_lib/vale/fixtures.js` | synthetic inbox / sent / calendar |
| `api/_lib/vale/triage.js` | `isExcluded`, `ruleLabel`, `projectOf`, `buildTriagePrompt`, `parseTriage`, `triage`, `waitingOnOthers` |
| `api/_data/vale-mail-rules.seed.json` | seed VIP / muted / receipts / rules-only / projects |
| `api/_lib/vale/brief.js` | `buildBrief(input)`, `buildTakePrompt`, `parseTake`, `esc` |
| `api/_lib/vale/mailer.js` | `sendBrief(deps, msg)` via app-only token |
| `api/_lib/vale/briefRun.js` | `runBrief(deps)` orchestration |
| `api/valeMorningBrief/` | timer `0 30 13,14,15 * * *` → `runBrief` |
| `api/_lib/vale/mailContext.js` | `formatMailContext(state, rules)` for chat |
| `js/vendor/msal-browser.min.js`, `data/vale-config.json`, `modules/company/js/vale-mail.js`, `office.html` | sign-in + Mail card behind `?vale=1` |
| `api/valeBriefCron/index.js` | skip Discord morning brief if the email brief was sent today |
| `docs/superpowers/plans/2026-10-17-vale-setup-checklist.md` | Chad's exact setup commands |

---

### Task 1: JWT verification
- [ ] Create `api/_lib/vale/jwt.js`: base64url decode; reject `alg !== 'RS256'`; find JWK by `kid` (`unknown_kid`); `crypto.createPublicKey({key:{kty,n,e},format:'jwk'})` + `crypto.verify('RSA-SHA256')`; then `iss === https://login.microsoftonline.com/<tid>/v2.0`, `tid`, `aud === clientId`, `azp === clientId`, `exp`/`nbf` ±300 s, `scp` contains `access_as_user`, `oid === ceoOid`. Never reads `roles`.
- [ ] `api/_lib/vale/jwt.test.js` (generate an RSA keypair in-test): valid → ok; wrong oid → `not_ceo`; wrong aud → `bad_aud`; wrong tid → `bad_tid`; wrong azp → `bad_azp`; wrong iss → `bad_iss`; expired → `expired`; `alg:none` → `bad_alg`; tampered payload → `bad_signature`; unknown kid → `unknown_kid`; missing scope → `bad_scope`; garbage → `malformed`.
- [ ] Run `node api/_lib/vale/jwt.test.js` → all PASS. Commit.

### Task 2: Token crypto
- [ ] `api/_lib/vale/tokenCrypto.js`: 12-byte IV, `aes-256-gcm`, box `{v:1, iv, tag, ct}`; key must decode to 32 bytes.
- [ ] Test: round-trip; tampered `ct` throws; wrong key throws; 16-byte key rejected; two encryptions differ (random IV).
- [ ] Run, commit.

### Task 3: Brief schedule
- [ ] `api/_lib/vale/schedule.js`: `pacificParts` via `Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hourCycle:'h23',…})`; window 06:30 ≤ t < 09:00; `log.days[date].status` `sent` → no; `sending` < 30 min old → no.
- [ ] Test: 2026-07-15T13:30Z (06:30 PDT) send; 2026-01-15T13:30Z (05:30 PST) no; 2026-01-15T14:30Z send; 2026-01-15T17:00Z (09:00) no; catch-up 2026-07-15T14:30Z send; already sent no; fresh `sending` no; stale `sending` (45 min) send; DST day 2026-03-08T14:30Z send; 2026-11-01T14:30Z send.
- [ ] Run, commit.

### Task 4: Storage key classes
- [ ] `valeStorage.js`: `KEY_CLASS` per spec §4.4; `ALLOWED_KEYS` derived; `keyClass(key)`; `accessFor(key, mode, via)` → `'allow'|'deny'` where `gate` read+write allow for `principal`/`bearer`, `bearer` read allow only for `bearer` and write never, `rules` and `never` always deny through `vale-state`; `getValeWithMeta`, `mutateVale`.
- [ ] Update `valeStorage.test.js` deliberately: exact 13 keys; class of each; `accessFor` matrix incl. rollback case (`via:'principal'` can't read `valeConversations`, `valeMailState`, `valeMailBriefs`, `valeMailRules`, `valeMailToken`).
- [ ] Run, commit.

### Task 5: `requireCeoAsync` + callers + CORS (one commit)
- [ ] `valeAuth.js`: `valeConfig(env)`, `bearerFrom(req)`, JWKS cache (24 h; unknown-kid refetch ≤ 1 per 5 min), `requireCeoAsync(req, ctx, {bearerOnly}, deps)` → `{ok, via:'bearer'|'principal'|null, claims|userInfo, reason}`. Bearer present → verify only bearer. No bearer → deny if `bearerOnly` or strict; else legacy `requireCeo`.
- [ ] `vale-state`: `await requireCeoAsync`; GET uses `accessFor(key,'read',gate.via)`; `set` uses `accessFor(key,'write',…)`; new ops `rules.get` / `rules.set` (bearer only; `rules.set` validates arrays of strings and the `projects` map); CORS adds `Authorization`.
- [ ] `valechat`: `await requireCeoAsync`; CORS adds `Authorization`.
- [ ] `api/_utils/valeAuth.test.js`: no bearer + strict off → principal path; no bearer + strict on → deny; no bearer + bearerOnly → deny; valid bearer → `via:'bearer'`; bad bearer + valid principal → deny (bearer wins); unknown kid → one refetch then ok; JWKS fetch failure → deny `jwks_unavailable`; not configured → deny `not_configured`.
- [ ] Run valeAuth + valeStorage tests. Commit together.

### Task 6: OAuth, token store, `vale-connect`
- [ ] `oauth.js`: `SCOPES = 'openid profile offline_access User.Read Mail.Read Calendars.Read'`; PKCE S256; `authorizeUrl(cfg, state, challenge)`; `tokenRequest(fetch, cfg, params)` → `{status, body}`; `idTokenClaims(idToken)` (decode only; received directly from the token endpoint over TLS).
- [ ] `tokenStore.js`: `getAccessToken({cfg, fetch, store, now})`: read meta (`failed` → `StoreError`); missing/`needsReconnect` → `ReconnectError`; refresh; `invalid_grant` → mark `needsReconnect` + `ReconnectError`; rotated token re-encrypted and saved with `lastSuccessAt`.
- [ ] `api/vale-connect/function.json` route `vale-connect/{op?}`, GET/POST/OPTIONS; `index.js` exports handler + `handle(context, req, deps)`. Config check (client id/secret/tenant/ceo oid/32-byte token key) else 503. `status`/`start`/`disconnect`/`forget` bearer-only; `callback` validated by single-use state (10 min), PKCE, `oid`. Redirect to `VALE_OFFICE_URL?vale=1&connect=ok|error&reason=…`.
- [ ] Tests (`oauth.test.js`, `tokenStore.test.js`, `vale-connect/connect.test.js`) with in-memory store + stubbed fetch: 503 when unconfigured; 401 without bearer; start stores pending + returns URL with S256; callback bad state → error redirect, nothing saved; expired state → error; wrong oid → error, nothing saved; good callback saves an encrypted box (no plaintext refresh token in the store); disconnect clears; refresh rotates; `invalid_grant` marks reconnect; store read failure ≠ not connected.
- [ ] Run, commit.

### Task 7: Graph client + fixtures
- [ ] `graph.js`: `get` with retry on 429/5xx (honor `Retry-After`, cap 10 s, max 3 retries) else `GraphError{status}`; `getPaged(url, cap)` follows `@odata.nextLink`; `listInbox(sinceIso, cap=200)`, `listSent(sinceIso, cap=200)`, `calendarView(startIso, endIso)` with `Prefer: outlook.timezone="Pacific Standard Time"`. Exact `$select` per spec §5.1.
- [ ] `fixtures.js`: ~10 synthetic inbox messages (VIP, flagged, newsletter with List-Unsubscribe, receipt, Outlook-Other, client domain, injection attempt, Vale's own brief, normal person, unknown), sent items (one stale thread, one answered), calendar (external meeting in work hours, internal, unanswered invite, cancelled).
- [ ] `graph.test.js`: paging + cap; 429 then success; 500 ×4 → throws; query strings contain the right `$select`/`$filter` and no `meetingMessageType`.
- [ ] Run, commit.

### Task 8: Triage
- [ ] `api/_data/vale-mail-rules.seed.json`.
- [ ] `triage.js` per spec §5.2–5.3. Rules-only domains never go to the model (unread → `needs_you`, else `fyi`). Model: one batched `callModel({model:'claude-haiku', caller:'vale-triage', json:true, temperature:0})`; prompt fences emails as untrusted data; `parseTriage` only accepts `needs_you|fyi|noise|unsure`, reason ≤ 120 chars, ignores extra fields; any failure → `unsure`. `waitingOnOthers(inbox, sent, nowMs)`.
- [ ] `triage.test.js`: each rule; exclusions (vale@, brief subject); rules-only never in the model prompt; injection email stays data (prompt fences it; malicious model output with extra keys/labels → ignored/`unsure`); model throws → `unsure`; waiting detection; project tagging.
- [ ] Run, commit.

### Task 9: Brief rendering
- [ ] `brief.js`: `buildBrief({nowMs, events, triaged, waiting, take, status, workHours})` → `{subject, html, text, needsYouIds}`; Today (meetings, unanswered invites, free blocks ≥ 60 min 08:00–18:00, day-job flag for external meetings in `workHours`, note once if `workHours` unset); Needs you by project; Waiting; Can wait counts; Vale's take; per-section "couldn't load"; reconnect-only variant. Escape everything; only `https://outlook.office365.com/…` / `https://outlook.office.com/…` webLinks become links; raw sender + `external` marker. `buildTakePrompt(facts)` / `parseTake(text)` (≤ 3 strings, ≤ 240 chars).
- [ ] `brief.test.js`: escaping (`<script>` subject), no message-text URLs rendered, day-job flag, unanswered invite, free blocks, failed section text, reconnect variant, subject line counts.
- [ ] Run, commit.

### Task 10: Mailer
- [ ] `mailer.js`: client-credentials token (`scope=https://graph.microsoft.com/.default`), `POST /users/{sender}/sendMail`, expect 202; never takes a sender from input other than `cfg.senderAddress`.
- [ ] `mailer.test.js`: posts to `/users/vale@ambientpixels.ai/sendMail`; non-202 throws; token failure throws.
- [ ] Run, commit.

### Task 11: Brief run + timer
- [ ] `briefRun.js` `runBrief(deps)`: flags → log meta (`failed` → stop) → `shouldSendBrief` → mark `sending` → token (reconnect variant on `ReconnectError`) → Graph sections (each may fail independently) → rules → triage → waiting → take → `buildBrief` → save `valeMailState` (derived, TTL 14 d, no bodies) → send → mark `sent` + watermark + `needsYouIds` → append `valeMailBriefs` (cap 60) → one audit entry (cap 500). Send failure → `delivery:failed`, mark `failed`, Discord fallback if webhook set.
- [ ] `api/valeMorningBrief/function.json` (timer `0 30 13,14,15 * * *`) + `index.js` (real deps).
- [ ] `briefRun.test.js` end-to-end on fixtures with in-memory store, fake fetch, fake `callModel`, fake mailer: flags off → no I/O; sends once; second run same day doesn't; reconnect variant; inbox failure → section says couldn't load; send failure → marked failed and retried next run; state holds no bodies.
- [ ] Run, commit.

### Task 12: Chat mail context
- [ ] `mailContext.js` `formatMailContext(state, rules)`: needs_you / waiting lines; rules-only domains → sender + date only; fenced as data.
- [ ] `valechat`: only when `gate.via === 'bearer'` and both flags on, append the block.
- [ ] `mailContext.test.js`: rules-only items show no subject/reason; empty state → empty string; fence present.
- [ ] Run, commit.

### Task 13: Office page (behind `?vale=1`) — **screenshot to Chad before commit**
- [ ] Copy `C:\Dev\hanson-agents\portal\js\vendor\msal-browser.min.js` → `js/vendor/msal-browser.min.js`.
- [ ] `data/vale-config.json` `{ "tenantId": "96bfe658-4094-4192-88f8-5b0874471c7e", "clientId": "", "scope": "" }` (filled at setup).
- [ ] `modules/company/js/vale-mail.js`: MSAL redirect sign-in, `window.ValeAuth.getToken()`; Mail card (status, Connect/Disconnect, last brief sent, recent runs, rules editor, provider note); "not configured yet" when `clientId` is empty.
- [ ] `office.html`: load `vale-mail.js` only with `?vale=1`; `authHeaders()` adds `Authorization` when `ValeAuth` has a token.
- [ ] Playwright (Edge) screenshot of the page with `?vale=1`, show Chad, then commit.

### Task 14: Retire the duplicate Discord morning brief
- [ ] `valeBriefCron`: on the 14:00 UTC morning run, skip Discord when `valeBriefLog.days[<today Pacific>].status === 'sent'`. Evening wrap unchanged.
- [ ] Test via a pure helper `skipDiscordMorning(kind, log, nowMs)`. Run, commit.

### Task 15: Setup checklist
- [ ] `docs/superpowers/plans/2026-10-17-vale-setup-checklist.md`: app registration (`az ad app create …` with exact manifest bits), admin consent, client secret + expiry reminder, shared mailbox, Exchange RBAC for Applications commands incl. `Test-ServicePrincipalAuthorization` for `vale@` (allowed) and `chad@` (denied), app settings list, sign-in → strict → Connect → mail order, seeding `ceoProfile.workHours` and rules. Commit.

---

## Self-review
- Spec coverage: §4.1 → T13; §4.2 → T1, T5; §4.3 → T5, T6, T11, T12; §4.4 → T4, T5; §4.5 → T6; §4.6 → T11; §5.1 → T7; §5.2 → T8; §5.3 → T8, T9; §5.4 → T3, T9–T11, T14; §5.5 → T12, T13; §7 → T6, T11; §9 → T15; §10 → each task's tests.
- Names used across tasks: `requireCeoAsync`, `accessFor`, `getValeWithMeta`, `mutateVale`, `getAccessToken`, `ReconnectError`, `StoreError`, `createGraph`, `triage`, `waitingOnOthers`, `buildBrief`, `sendBrief`, `runBrief`, `formatMailContext`, `shouldSendBrief` — defined in T1–T12 as listed.

# Vale Mail — Overnight Build + Evaluation Loop — Implementation Plan

> **For agentic workers:** this plan is executed by an overnight **Workflow** (build agents + reviewer agents, in rounds). Each builder task lists exact files, interfaces and tests; the builder writes the code, TDD, and commits by path. Steps use checkbox (`- [ ]`) syntax for tracking. REQUIRED SUB-SKILL for a human-driven run instead: superpowers:subagent-driven-development.

**Goal:** Ship Vale Mail — an AmbientPixels email client with Vale built in — to `/modules/company/mail.html`, fully working against a realistic **demo mailbox** tonight, and ready to switch to Chad's real mailbox in the morning with two setup steps.

**Architecture:** Plain JS + CSS, no framework, no build step, no new npm deps (matches the site). Pure logic lives in UMD modules that run in the browser **and** under `node` tests. The browser talks to Microsoft Graph through one adapter with two backends: **real** (MSAL token, `https://graph.microsoft.com`) and **demo** (an in-memory fake Graph over a fixture mailbox). Vale's judgments come from the existing `vale-state` (labels/rules) and a new bearer-only `vale-draft` API.

**Tech Stack:** Vanilla JS (ES2018, `'use strict'`, IIFE/UMD), MSAL Browser (vendored `/js/vendor/msal-browser.min.js`), Azure Functions (Node, CommonJS), existing `api/_lib/llm` `callModel`, Playwright via `C:/tmp/node_modules` with `chromium.launch({channel:'msedge'})`.

**Spec:** `docs/superpowers/specs/2026-10-17-vale-mail-client-design.md` (rev 2) — this plan implements scope B **plus** the roadmap items Chad asked for tonight ("the ultimate Vale Mail"), see §2.

---

## 0. Chad's decisions (2026-10-17, ~00:30 PT)

| Question | Answer |
|---|---|
| Where it lands | **Straight to the live site** (each round commits + pushes to `master`). Safe tonight because sending is impossible until the morning setup — the live page runs the demo mailbox. |
| Remote images | **Block, with a "Show images" button** per email. (Needs `img-src https:` in the CSP — added to the morning's one CSP change.) |
| How long | **Until every reviewer scores ≥ 9/10, or 8 rounds**, whichever first. |
| Product | **AmbientPixels product, Hanson-ready**: names, colors, copy and tenant settings in one product config, so a Hanson version is a re-skin. No Hanson data, code or branding. |
| Earlier (spec §3) | CSP `connect-src` += Graph = YES · client-thread drafts on explicit click, **Claude only, no fallback** = YES. |

## 1. Guardrails for every agent (non-negotiable)

1. **Never edit** protected files: `staticwebapp.config.json`, `api/companyHeartbeat/**`, `api/company-state/**`, `data/company-actions.json`, `package.json`, `package-lock.json`, `.github/**`, `local.settings.json`, any file starting with `_` (except the new `api/_lib/vale/*` and `api/_data/vale-*.json` named below). The CSP change is prepared as a **proposed diff in the morning handoff**, never applied.
2. **Never stage other sessions' files.** Stage by explicit path only. Before every commit run `git status --short` and `git diff --cached --name-only`; the index must contain only files this plan names. Known foreign edits: `api/companyHeartbeat/index.js`, `docs/superpowers/handoffs/2026-08-09-instagram-analytics-rewards-handoff.md`.
3. **No Azure / Entra / Exchange / DNS changes, no `az` writes, no Graph calls against the real mailbox, no POSTs to live APIs.** Never change the **Vale** app's scopes.
4. **No new npm dependencies.** No CDN scripts beyond what the CSP already allows (prefer none).
5. **Hanson:** re-implement patterns only. Never copy code from `C:\Dev\hanson-agents`, never use "Clerk", "Hanson", their tenant/client IDs, colors or copy.
6. **Mail content is never logged, stored or committed** (server: log error codes only; fixtures are invented people at invented companies with `.example` domains — never real names other than Chad and Vale).
7. **CSS:** no inline `style=` and no `el.style.*` in new code; classes in `modules/company/css/vale-mail.css`. Company pages use `.ap-btn` / `.ap-btn--primary` / `.ap-input` / `.ap-panel` (company.css). Never `!important`.
8. Every commit message ends with `Release: none` and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after each green commit (`git push origin master`); if the push is rejected, `git pull --rebase origin master` then push — never force.
9. Never commit with a failing test. Run the whole Vale suite before each commit (§7).

## 2. Product vision — what "AAA" means here

A calm, fast, three-column mail client where **Vale is the reason to use it**:

- **Vale-sorted inbox.** Filter chips: **Needs you · Waiting on others · Everything · Newsletters · Set aside**, each with an honest count ("12 of the latest 50"). Every row: sender, subject, one-line preview, Vale's label chip + her one-line reason (from the last triage; newer mail says "not sorted yet" — never a guess). Client-domain mail carries a small "client" marker.
- **Reader** in a strict sandbox; Show images button only when the email has remote images; attachments listed (name · size) with download via Graph → `blob:`.
- **Vale panel** (periwinkle, `#9b8cff`, her signature): why it matters · who you're really replying to (**Reply-To ≠ From warning**) · thread strip ("Thread of 6, 2 from you, latest yesterday") · last time you and this sender spoke · "waiting on you since …" · **one-tap stances**: the question Vale found, quoted, then **Yes · No · Later · Need more** (or **Acknowledge**) — each press drafts that answer · free-text "Tell Vale what to say" · **Draft reply**.
- **Editor**: Vale's draft lands editable above the quoted original; **Send** → 10-second **Undo** bar → sent. Never a half-sent state. Compose new (Vale can draft from a one-line brief).
- **Actions**: mark read/unread, flag, archive (to Archive, never delete), each with an **Undo strip**. **Search** (Graph `$search`). **Keyboard**: `j/k` move, `Enter` open, `e` archive, `r` reply, `d` draft with Vale, `f` flag, `u` unread, `/` search, `?` shortcut sheet, `Esc` close.
- **Today rail**: today + tomorrow's meetings (read-only), with the day-job-hours clash flag from `ceoProfile.workHours`.
- **Honest states everywhere**: "Checked at 6:41 AM" stamp; loading skeletons; empty states that say *why* empty; errors in plain words with a retry.
- **Demo mode**: the whole product works on a fixture mailbox (`?demo=1`, and automatically while Vale Mail isn't configured), with a slim banner "Demo mailbox — nothing here is real; sending is simulated."
- **Hanson-ready**: product name, agent name/color/icon, tenant + client IDs, own domain, client domains and copy live in `data/vale-mail-product.json`. The code reads them; nothing product-specific is hard-coded.
- Responsive: three columns ≥ 1100px; two (list + reader, folders in a menu) ≥ 720px; one column with back button on phones. Keyboard focus visible. WCAG AA contrast.

Out of scope tonight (roadmap): forward, folder management, attachment upload, delete, accept/decline invites, Gmail, voice learning from edits, Outlook add-in.

## 3. File structure

| File | Responsibility |
|---|---|
| `data/vale-mail-product.json` | **Create.** Product config: `{ productName, agent:{name,color,icon}, tenantId, clientId (Vale Mail, "" until setup), valeScope, ownDomain, graphScopes[], demoDefault:true }` |
| `data/vale-mail-demo.json` | **Create.** Fixture mailbox: ~45 messages (inbox + sent + archive), 3 folders, threads, attachments, remote-image newsletter, a Reply-To phishing case, a client-domain thread (`@clientco.example`), calendar for today+tomorrow, Vale labels+reasons for most messages. Invented people only. |
| `modules/company/js/vale-mail-core.js` | **Create.** UMD, pure, no DOM: `safeBodyDoc`, `hasRemoteImages`, `htmlToText`, `textToHtml`, `replyTargets`, `replyToMismatch`, `findQuestion`, `threadStrip`, `waitingOnYou`, `bucketOf`, `counts`, `searchQuery`, `sendMachine`, `shortcutFor`. |
| `modules/company/js/vale-mail-core.test.js` | **Create.** node tests for every core export. |
| `modules/company/js/vale-graph-browser.js` | **Create.** UMD: `createGraphClient({fetch, getToken, sleep})` — list/get/search/attachments/patch/move/createReply/patchDraft/send/calendarView; `Prefer: IdType="ImmutableId"`; retry 429/5xx with Retry-After; paging cap. |
| `modules/company/js/vale-graph-browser.test.js` | **Create.** fake-fetch tests (headers, URLs, order createReply→PATCH→send, retry). |
| `modules/company/js/vale-mail-demo.js` | **Create.** UMD: `createDemoGraph(fixture)` — same interface as the real client, in memory, mutations work (archive/flag/read/send moves to Sent). |
| `modules/company/js/vale-mail-demo.test.js` | **Create.** interface parity + mutation tests. |
| `modules/company/js/vale-mail-client.js` | **Create.** The UI (DOM). Boots config → picks backend → renders; no business logic that core could hold. |
| `modules/company/mail.html` | **Create.** Page shell (head like `office.html`, company.css + vale-mail.css, sidebar.js). |
| `modules/company/css/vale-mail.css` | **Create.** All styles; tokens on `.vmail` root; periwinkle Vale accents. |
| `api/_lib/vale/jwt.js` | **Modify.** `azp` → allow-list (`opts.allowedClients` array, falls back to `[opts.clientId]`). |
| `api/_utils/valeAuth.js` | **Modify.** `valeConfig().allowedClients` from `VALE_ALLOWED_CLIENTS` (comma list) else `[clientId]`; pass to jwt verify. |
| `api/vale-connect/index.js` | **Modify (tiny).** Require `azp === VALE_CLIENT_ID` (Vale app only) even when the allow-list has more. |
| `api/_lib/llm/index.js` | **Modify.** `opts.noFallback` → chain is `[primary]` only. |
| `api/_lib/vale/graph.js` | **Modify.** Add `Prefer: IdType="ImmutableId"` to every request. |
| `api/_lib/vale/draft.js` | **Create.** Pure: `validateDraftRequest`, `buildDraftPrompt`, `parseDraft`, `isClientThread`. |
| `api/_lib/vale/draft.test.js` | **Create.** |
| `api/vale-draft/index.js` + `function.json` | **Create.** Bearer-only POST; validate; rate limit 30/hour (counts only, `valeDraftRate` key); `callModel` (client thread → `{model:'claude-sonnet', noFallback:true}`); returns `{draft}`; logs codes only. |
| `api/vale-draft/draft-endpoint.test.js` | **Create.** auth, validation, rate limit, client-thread routing, no-content logging (canary). |
| `api/_utils/valeStorage.js` | **Modify.** Register `valeDraftRate: 'never'`. |
| `api/_data/vale-voice.json` | **Create.** Chad's voice v1: tone, sign-off, use/avoid phrases, register by audience. |
| `modules/company/js/vale-mail.js` | **Modify.** "Open Vale Mail →" link on the Office Mail card. |
| `scripts/vale-mail-e2e.cjs` | **Create.** Playwright E2E on the demo mailbox (local static server, Edge); writes screenshots to a folder passed as argv. |
| `docs/superpowers/handoffs/2026-10-17-vale-mail-morning.md` | **Create (final step).** Results, scores per round, screenshots, the proposed CSP diff, Chad's setup checklist. |

## 4. Build tasks (Round 0 — sequential, one builder at a time)

### Task 1: Server — azp allow-list, noFallback, immutable IDs

**Files:** Modify `api/_lib/vale/jwt.js`, `api/_utils/valeAuth.js`, `api/vale-connect/index.js`, `api/_lib/llm/index.js`, `api/_lib/vale/graph.js`; tests in `api/_lib/vale/jwt.test.js`, `api/_utils/valeAuth.test.js`, `api/vale-connect/connect.test.js`, `api/_lib/vale/graph.test.js`, `api/_lib/llm/*.test.js` (if present, else `api/_lib/llm/noFallback.test.js`).

- [ ] Write failing tests:
  - jwt: token with `azp` = Vale → ok; `azp` = Vale Mail with `allowedClients:[vale, valeMail]` → ok; unknown `azp` → `bad_azp`; no `allowedClients` → only `clientId` accepted (back-compat).
  - valeAuth: `valeConfig({VALE_CLIENT_ID:'a', VALE_ALLOWED_CLIENTS:'a, b'}).allowedClients` → `['a','b']`; unset → `['a']`; the allow-list must always contain `clientId` (if missing, add it).
  - vale-connect: a valid token whose `azp` is Vale Mail → 403 `wrong_client`.
  - llm: `callModel({prompt:'x', model:'claude-sonnet', noFallback:true})` with the Claude provider failing → throws `LlmUnavailableError` after exactly **one** attempt (inject provider stubs the way existing llm tests do; read `api/_lib/llm/index.js` for the test seam).
  - graph: every request carries `Prefer` containing `IdType="ImmutableId"`; calendarView keeps its `outlook.timezone` preference too (both in one `Prefer` header, comma-separated).
- [ ] Run each test file, see the new cases fail.
- [ ] Implement minimal code. In `jwt.js` replace `if (c.azp !== opts.clientId) return fail('bad_azp');` with an allow-list check.
- [ ] Run the full Vale suite (§7) — all green.
- [ ] Commit by path: `Vale: azp allow-list for Vale Mail, llm noFallback, immutable Graph IDs`. Push.

### Task 2: Server — vale-draft API + voice profile

**Files:** Create `api/_lib/vale/draft.js`, `api/_lib/vale/draft.test.js`, `api/vale-draft/index.js`, `api/vale-draft/function.json` (copy shape from `api/vale-state/function.json`, route `vale-draft`, methods `post, options`), `api/vale-draft/draft-endpoint.test.js`, `api/_data/vale-voice.json`; modify `api/_utils/valeStorage.js` (+ its test's key list).

Interfaces:
```js
// draft.js
validateDraftRequest(body) → { ok:true, req:{ from, fromName, subject, latest, prior:[≤2], instruction, stance, mode:'reply'|'compose', to } } | { ok:false, code }
//   latest ≤ 6000 chars, each prior ≤ 3000 (truncate, don't reject); instruction ≤ 500; stance ∈ ['yes','no','later','more','ack', null]
isClientThread(req, rules) → boolean   // uses triage.matches(rules.rulesOnlyDomains, from|to)
buildDraftPrompt(req, voice) → { system, prompt }  // email fenced in <email>…</email> as DATA; stance + instruction as Chad's intent
parseDraft(text) → string  // trims, strips "Subject:" lines and code fences, ≤ 4000 chars
```
Endpoint: `requireCeoAsync` with **bearer only** (else 403) → `validateDraftRequest` (400 with code) → rate limit `mutateVale('valeDraftRate', …)` storing `{hour:'YYYY-MM-DDTHH', count}` only (429 past 30) → rules from `valeMailRules` (seed fallback) → `callModel({ system, prompt, model:'claude-sonnet', caller:'vale-draft', maxTokens:800, temperature:0.4, noFallback: isClientThread })` → `{ draft }`. Errors: log `'[vale-draft] ' + code` only.

- [ ] Tests first (draft.test.js): truncation, stance validation, client-thread detection both directions, prompt fences email and contains the voice sign-off, `parseDraft` strips fences. Endpoint test: no bearer → 403; bad body → 400; 31st call in an hour → 429; client thread passes `noFallback:true`; a canary string in the email never appears in any `context.log*` call.
- [ ] Implement; full suite green; commit `Vale: vale-draft API (bearer-only, Claude-only for client threads)`; push.

### Task 3: Product config, demo fixture, core logic

**Files:** Create `data/vale-mail-product.json`, `data/vale-mail-demo.json`, `modules/company/js/vale-mail-core.js` (+ test).

Core interfaces (all pure):
```js
safeBodyDoc(body:{contentType,content}, allowImages:boolean) → string  // full HTML doc for iframe srcdoc:
  //   <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:[ https:] ; font-src data:">
  //   <base target="_blank">; strips <script>, <meta http-equiv=...>, on* attributes, javascript: URLs; text bodies escaped in <pre>
hasRemoteImages(html) → boolean        // <img src="http(s)://…|//…">, srcset, CSS url(http…)
htmlToText(html) → string; textToHtml(text) → string (escaped, \n → <br>)
replyTargets(msg) → [{name,address}]   // replyTo if present else from
replyToMismatch(msg) → null | { from, replyTo }   // different address (case-insensitive)
findQuestion(text) → string|null       // first sentence ending '?' in the newest part (above quoted history), ≤ 200 chars
threadStrip(threadMsgs, me) → { count, fromMe, latestAt }
waitingOnYou(msg, sentInThread, nowMs) → null | { since }  // external, unanswered, > 24h
bucketOf(msg, label) → 'needs_you'|'waiting'|'newsletter'|'set_aside'|'other'   // newsletter = List-Unsubscribe header or label 'noise'
counts(msgs, labels) → { needs_you, waiting, newsletter, set_aside, all }
searchQuery(input) → string|null       // sanitize to [A-Za-z0-9@._\- "] ≤ 80
sendMachine() → { state, can(action), next(action) }  // states: idle→drafting→ready→countdown→sending→sent | countdown→undone→ready | sending→failed→ready
shortcutFor(event) → action|null       // ignores when ctrl/meta/alt or focus in input/textarea/contenteditable
```
- [ ] Tests first for every export (≥ 40 cases, including: script and onerror stripped; `<meta http-equiv=refresh>` stripped; remote images blocked unless allowImages; Reply-To mismatch; question inside quoted history ignored; send machine rejects `send` from `idle`).
- [ ] Fixture: realistic, varied, includes every edge the UI must show. Product config with `clientId: ""`.
- [ ] Implement; tests green; commit; push.

### Task 4: Graph adapters (real + demo)

**Files:** Create `modules/company/js/vale-graph-browser.js` (+ test), `modules/company/js/vale-mail-demo.js` (+ test).

Shared interface (both backends):
```js
listMessages({ folder:'inbox'|'sentitems'|'archive'|id, top, skipToken }) → { items, next }
getMessage(id) → full message incl. body, replyTo, internetMessageHeaders, hasAttachments
listAttachments(id) → [{ id, name, size, contentType, isInline, contentId }]
getAttachmentBytes(id, attId) → ArrayBuffer
search(query) → items
patchMessage(id, { isRead?, flag? }) ; move(id, destination) → newMessage
createReply(id) → draft ; patchDraft(draftId, { bodyHtml, toRecipients? }) ; sendDraft(draftId)
createDraft({ to, subject, bodyHtml }) → draft
calendarView(startIso, endIso) → events
me() → { displayName, mail }
```
Real: base `https://graph.microsoft.com/v1.0`, headers `Authorization: Bearer`, `Prefer: IdType="ImmutableId"` (+ timezone for calendar), retry 429/5xx ×3 honoring Retry-After (cap 10 s), `getToken()` injected. Demo: deep-clones the fixture, simulates 150–400 ms latency (injectable), mutations persist for the page session, `sendDraft` moves to Sent.
- [ ] Tests first (fake fetch / fixture), then implement; commit; push.

### Task 5: The client UI (demo mode end to end)

**Files:** Create `modules/company/mail.html`, `modules/company/js/vale-mail-client.js`, `modules/company/css/vale-mail.css`; modify `modules/company/js/vale-mail.js` (Office card link).

- Boot: load product config → `?demo=1` or empty `clientId` → demo backend + demo banner; else MSAL (one instance, `sessionStorage`, redirect to `/pages/vale-auth.html` like vale-mail.js) → real backend + Vale API token for `vale-state`/`vale-draft`.
- Implement §2 features. Sandbox iframe exactly: `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc=…>`. Draft in demo mode → canned drafts per stance from the fixture (no network).
- Typed text kept in `sessionStorage` until sent/discarded. Focus management + ARIA roles (`listbox` rows, `aria-selected`).
- [ ] `scripts/vale-mail-e2e.cjs`: open `?demo=1`, assert counts render, open the phishing email → Reply-To warning visible, open newsletter → Show images button present and iframe CSP blocks remote by default, press "Yes" stance → draft appears in editor, Send → Undo bar → Undo → still a draft; Send again → appears in Sent; `j/k/e` shortcuts work; search finds a fixture subject; phone viewport (390×844) single column. Screenshots: inbox, reader+panel, editor, undo bar, phone, empty state, shortcut sheet.
- [ ] Run E2E green; full suite green; commit; push. Then confirm deploy (`gh run watch`) and that `https://ambientpixels.ai/modules/company/css/vale-mail.css` serves 200.

## 5. Evaluation loop (Rounds 1–8)

Each round, **four reviewer agents in parallel** (read-only; they may run tests and Playwright, never edit or commit) score 1–10 against their rubric and return a **ranked must-fix list** (max 8 items, each with file, problem, concrete fix, acceptance check):

| Reviewer | Rubric (what 9+ means) |
|---|---|
| **Product & UX** | A first-time user understands the inbox in 5 s; Vale's value is obvious on every email; every state honest; flows (triage → read → stance → edit → send → undo) take ≤ 4 clicks; copy plain and warm; nothing confusing or dead-ended. Uses the E2E screenshots + clicks through the demo. |
| **Visual design** | Feels like a premium product (Superhuman/Linear calm), consistent with AmbientOS company pages; periwinkle Vale identity; rhythm, alignment, density, typography, hover/focus states, dark theme quality, responsive at 1440/1024/390. Must look at real screenshots. |
| **Security & privacy** | Sandbox exact; `safeBodyDoc` resists a battery of hostile emails (script, svg onload, meta refresh, `javascript:` links, CSS exfil `url()`, form posts); Reply-To guard; no token or mail text in logs/URLs/localStorage; bearer-only draft; Claude-only client threads; Vale app untouched; no protected file touched. |
| **Engineering & reliability** | Tests meaningful and green (core ≥ 40 cases); E2E green; no console errors; error/empty/loading states exist; code follows site idioms (no inline styles, `.ap-*` classes, UMD pure core); performance (inbox interactive < 1 s on demo); accessibility (keyboard-only full flow, focus visible, AA contrast). |

Then **one fixer agent** takes the merged must-fix list (dedupe; order: security → broken → UX → visual → polish), fixes as many as fit, keeps everything green, commits by path, pushes. **Stop** when all four scores ≥ 9, or after round 8. A round where the fixer can't keep tests green reverts its own uncommitted work and the next round re-tries with the same list.

## 6. Morning handoff (final step)

Write `docs/superpowers/handoffs/2026-10-17-vale-mail-morning.md`: score table per round, what shipped, open must-fixes, screenshot paths, **the proposed CSP diff** (in `staticwebapp.config.json` `connect-src` add `https://graph.microsoft.com`; `img-src` add `https:` for Show images — nothing else), and Chad's setup checklist:
1. Create app registration **Vale Mail** (SPA, single tenant, redirect `https://ambientpixels.ai/pages/vale-auth.html`), delegated `User.Read Mail.ReadWrite Mail.Send Calendars.Read` + Vale `access_as_user`; add it to Vale's `preAuthorizedApplications`; admin consent.
2. Verify the **Vale** app still has only its six read-only scopes.
3. Function App setting `VALE_ALLOWED_CLIENTS=<Vale>,<Vale Mail>`; put Vale Mail's client ID in `data/vale-mail-product.json`.
4. Approve + apply the CSP diff.
5. Live test: read, draft, send a reply to `thechadmartin@gmail.com`.
Commit the handoff; push.

## 7. Verification commands

```bash
cd /c/Dev/Ambientpixels/ambientpixels
for f in api/_lib/vale/*.test.js api/_utils/vale*.test.js api/vale-connect/connect.test.js api/valeBriefCron/skip.test.js api/vale-draft/*.test.js modules/company/js/vale-mail-*.test.js modules/company/js/vale-graph-browser.test.js; do node "$f" 2>&1 | tail -1; done
NODE_PATH="C:/tmp/node_modules" node scripts/vale-mail-e2e.cjs <screenshot-dir>
```
Expected: every line `N passed, 0 failed`; E2E prints `E2E OK`.

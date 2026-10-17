# Handoff — Vale is live; next: tune her, route real mail to her, build Vale Mail

**Date:** 2026-10-17 (written ~22:30 PT Fri 10-16) · **From:** the session that built and launched Vale's mail brief · **For:** the next Claude session working with Chad
**Kickoff prompt:** at the bottom.

---

## 1. Where things stand (verified, not assumed)

**Vale (CEO assistant) Stage 0 + 1 is LIVE.**
- Real Microsoft sign-in lock on every Vale endpoint (`VALE_STRICT_AUTH=1`). A forged `x-ms-client-principal` admin header is refused with `bearer_required` — tested live.
- Read-only access to `chad@ambientpixels.ai` mail + calendar (delegated, refresh token AES-GCM encrypted in blob `vale/valeMailToken`). Connected on the Office page.
- Morning brief emailed **from `vale@ambientpixels.ai`** at 06:30 Pacific (timer 13:30/14:30/15:30 UTC; catch-up to 09:00; DST-correct). A **test brief was delivered successfully at 22:14 PT 10-16** (real mail, real calendar, real send). **The first scheduled brief is Sat 10-17 06:30 PT — check it landed** (Office → Mail card → "Last brief sent" / Recent runs).
- Vale can send **only** as `vale@` (Exchange RBAC for Applications; `Test-ServicePrincipalAuthorization` = True for vale@, False for chad@).
- The Discord morning brief turns itself off once the email brief has delivered (it will send one last time 10-17).

**Docs (read these, in this order):**
1. Spec — `docs/superpowers/specs/2026-10-17-vale-ceo-assistant-design.md` (rev 3; two independent reviews)
2. Plan (done) — `docs/superpowers/plans/2026-10-17-vale-ceo-assistant.md`
3. Setup checklist (done) — `docs/superpowers/plans/2026-10-17-vale-setup-checklist.md`
4. Next spec — `docs/superpowers/specs/2026-10-17-vale-mail-client-design.md` (rev 2; reviewed 6.5/10 → fixes folded in)
5. Memory: `project_vale_ceo_assistant_mail.md`, `project_ambientpixels_m365_email.md`

**Code map:** `api/_lib/vale/` (jwt, tokenCrypto, schedule, oauth, tokenStore, audit, graph, fixtures, triage, brief, mailer, briefRun, briefDeps, mailContext) · `api/vale-connect/` (status/start/callback/disconnect/forget/test-brief) · `api/valeMorningBrief/` · `api/_utils/valeAuth.js` (`requireCeoAsync`) · `api/_utils/valeStorage.js` (key classes gate/bearer/rules/never) · `api/vale-state/` (+ `rules.get/set`) · `api/valechat/` (mail context) · `modules/company/office.html` + `modules/company/js/vale-mail.js` (Mail card, always on) · `pages/vale-auth.html` (public sign-in return page) · `data/vale-config.json`.
**Tests:** 166, run each with `node <file>.test.js` (`api/_lib/vale/*.test.js`, `api/_utils/vale*.test.js`, `api/vale-connect/connect.test.js`, `api/valeBriefCron/skip.test.js`).

**Identities / IDs**
| Thing | Value |
|---|---|
| Tenant | `c4ssinilive.onmicrosoft.com` · `96bfe658-4094-4192-88f8-5b0874471c7e` |
| Vale app (read-only, server) | client `b3abb7ff-5838-4bd7-97f1-205ab3237185` · app obj `92491658-eef3-4cfd-8a9d-89649fd0e25a` · SP `d3f7ec40-69af-40aa-aa12-f1450cb3bd3b` |
| Chad (`chad@ambientpixels.ai`) oid | `48f3d837-b679-4707-989b-cfef5d7c7847` |
| Client secret | created 2026-10-17, 24 months → **expires ~2028-10** (Chad has a reminder to set) |
| Exchange | shared mailbox `vale@ambientpixels.ai`; scope "Vale mailbox only"; role "Application Mail.Send"; org customization enabled |
| Function App settings | `VALE_TENANT_ID, VALE_CLIENT_ID, VALE_CLIENT_SECRET, VALE_CEO_OID, VALE_TOKEN_KEY, VALE_STRICT_AUTH=1, VALE_MAIL_ENABLED=1` |
| Exchange script | `C:\Dev\Ambientpixels\vale-exchange-setup.ps1` (outside repo; idempotent; Windows PowerShell must sign in interactively — `-Device` is PS7-only) |

**Four sign-ins (Chad was confused once — say it plainly):** site/HQ login = unchanged · Azure portal = `c4ssini@live.com` · M365 admin = `admin@c4ssinilive.onmicrosoft.com` · Vale's "Sign in with Microsoft" button = `chad@ambientpixels.ai` only.

---

## 2. Rules that bit us tonight (don't relearn them)

- **Cross-site returns lose the site cookie.** Anything coming back from `login.microsoftonline.com` or the API host to `/modules/company/*` gets a 401. All Microsoft returns land on the public `/pages/vale-auth.html`, which forwards in-site. Keep it that way for Vale Mail.
- **Never grant any write scope (Mail.Send, Mail.ReadWrite, Calendars.ReadWrite…) to the *Vale* app.** A refresh token can mint any scope consented to its client ID, and Exchange RBAC is additive. Write scopes belong to the separate **Vale Mail** app (spec §2).
- **Company pages use `.ap-btn` / `.ap-btn--primary` and the shared `.ap-input`** (company.css), never `.btn` (public-site class from ap-skin.css).
- **The repo auto-commits and pushes.** Write each change complete + tested, commit by path immediately (`Release: none`), then watch the deploy for the new sha. Another session has uncommitted edits in `api/companyHeartbeat/index.js` and an Instagram handoff doc — never stage them.
- **Protected files** need Chad's explicit OK: `staticwebapp.config.json`, `companyHeartbeat/index.js`, `company-state`, `package-lock.json`, `data/company-actions.json`, CI workflow. **No new npm deps.**
- **Show visible changes first** (screenshot via Playwright with `chromium.launch({channel:'msedge'})`, local static server) before shipping anything Chad will see; nav changes always.
- **Chad prefers one question at a time**, plain language, and short status. He delegates technical choices ("A") but decides anything visible, costly or touching clients.

---

## 3. The plan for the next session

### Task 1 — Day-job hours (so the brief flags clashing client meetings)
**Why:** the brief's tip line asks for it; `ceoProfile.workHours` is unset, so the day-job flag is skipped.
**Ask Chad (one question):** his Microsoft working days and hours, Pacific (e.g. Mon–Fri 08:00–17:00).
**Build (small, visible → screenshot first):**
1. In the Mail card (`modules/company/js/vale-mail.js`), add a "Your day-job hours" row: day checkboxes Mon–Sun + start/end `<input type="time" class="ap-input">` + Save (`.ap-btn--primary`).
2. Save = read-modify-write of `ceoProfile` through `vale-state` (`GET ?key=ceoProfile` then `POST {op:'set', key:'ceoProfile', value:{...existing, workHours:{days:[1..5], start:'08:00', end:'17:00'}}}`) — `ceoProfile` is a `gate` key, so the existing ops work. Validate `HH:MM`, start < end, days ⊂ 1..7. Never overwrite other `ceoProfile` fields.
3. Tests: a pure `cleanWorkHours()` helper (node test). The brief already consumes `workHours` (`brief.todayView`, weekday-aware — 10-17 is a Saturday, so no flag that day by design).
**Done when:** Chad's hours saved; next brief/test brief shows no "set your day-job hours" tip.

### Task 2 — Important people (VIPs) + client domains
**Why:** VIP mail is always "needs you"; client domains are sorted by rules only (never sent to a model).
**Do:** Chad types them into Mail card → Sorting rules → Save (UI exists; `vale-state rules.set`, bearer-only, validated). Ask him one question: "Who should always be 'needs you'?" Suggest from memory (confirm, don't assume): Alyssa at Evergreen (`evergreengoodwill.org`), Amy/Anne/Taryn at Hanson (`hansonconsultgroup.com`) — note Hanson/Evergreen are already in **client domains (rules only)**; a VIP entry there still keeps them rules-only.
**Optional build:** a "Suggest from my sent mail" button that lists the top 10 people Chad has emailed in 30 days (Graph Sent Items via the server's read-only token; derived names/addresses only) for him to tick. Only if he wants it.
**Done when:** rules saved; the next brief puts their mail under "Needs you".

### Task 3 — Route real mail to `chad@ambientpixels.ai`
**Why:** the mailbox is brand new (one email in it); the brief has nothing to work with.
**3a. The site's own addresses (biggest, free, do first).** The public site links `hello@ambientpixels.ai` (93×), `press@` (63×), `privacy@` (1×), `legal@` (1×). **None exist — all bounce.**
- Recommended: add them as **email aliases on Chad's mailbox** (free; M365 admin → Users → Active users → Chad → Manage username and email → Aliases), or via Exchange PowerShell `Set-Mailbox chad@ambientpixels.ai -EmailAddresses @{add='hello@ambientpixels.ai','press@ambientpixels.ai','privacy@ambientpixels.ai','legal@ambientpixels.ai'}` (same interactive sign-in as the setup script). Ask Chad first — it's his inbox.
- Alternative (spec roadmap): `hello@`/`support@` as **shared mailboxes** Vale also triages — more setup; not needed yet.
- Verify: send a test to `hello@` from Gmail; it should arrive in Chad's inbox and appear in the next brief.
**3b. Gmail (`thechadmartin@gmail.com`) → optional.** Gmail Settings → Forwarding → add `chad@ambientpixels.ai` (confirmation code arrives in his new inbox) → forward all, or a filter for business mail only. Chad's call — Gmail is personal; the spec plans a native Gmail connection later (Stage 2).
**3c. Never route Hanson mail here** (out of scope; client data; Anne/Amy would have to agree).
**3d. Tell people:** email signature / LinkedIn / Evergreen thread can move to `chad@ambientpixels.ai` — Chad's choice, no code.

### Task 4 — Build Vale Mail (small email client with Vale built in, scope B)
**Spec:** `docs/superpowers/specs/2026-10-17-vale-mail-client-design.md` rev 2. **Wait until a few real briefs have run** (sorting quality is the foundation).
**Decisions already made by Chad (§3):** add `https://graph.microsoft.com` to CSP `connect-src` = **YES**; Vale drafts client mail only on an explicit click, **Claude only, no fallback** = **YES**. **Remote images = block** (recommended default; Chad didn't object — confirm once).
**Steps:**
1. Re-read the spec; run `superpowers:writing-plans` to produce `docs/superpowers/plans/<date>-vale-mail-client.md` (bite-sized, TDD, follow §8 tests).
2. **Setup (main session with Chad's go-ahead, like tonight):** create the **"Vale Mail"** app registration (single-page app, public client, single tenant; SPA redirect `https://ambientpixels.ai/pages/vale-auth.html` + mail page; delegated `User.Read Mail.ReadWrite Mail.Send Calendars.Read` + Vale's `api://b3abb7ff…/access_as_user`); add Vale Mail's client ID to the **Vale** app's `api.preAuthorizedApplications` for `access_as_user`; admin consent. **Then verify the Vale app still has only its six read-only scopes** (`GET /applications/92491658…` → resolve names; fail if any write scope).
3. **Server:** `jwt.js` `azp` check → allow-list (`VALE_ALLOWED_CLIENTS = <Vale>,<Vale Mail>`); `vale-connect` stays Vale-azp-only; add `Prefer: IdType="ImmutableId"` to `api/_lib/vale/graph.js`; new `api/vale-draft/` (bearer-only, no content stored/logged, 30/hour, Claude-only for client threads via `callModel` with no fallback — add that option to `_lib/llm` if missing); `api/_data/vale-voice.json`.
4. **CSP:** one edit to `staticwebapp.config.json` `connect-src` (+ nothing else) — already approved; still show Chad the one-line diff before committing.
5. **Client:** `modules/company/mail.html`, `js/vale-mail-client.js`, `js/vale-graph-browser.js`, `css/vale-mail.css` per spec §5 (inbox with Vale labels, sandboxed reader `sandbox="allow-popups allow-popups-to-escape-sandbox"`, Vale panel with Reply-To warning, draft → edit → createReply→PATCH (keep quote)→10 s undo→send, today+tomorrow calendar). Link from the Office Mail card.
6. Playwright screenshots to Chad before merge; then a live test (read, draft, send a reply to his Gmail).

### Housekeeping (when there's a quiet moment)
- **Function App runs Node 20, which is end-of-life (2026-04-30)** — az warns on every call. Plan an upgrade to Node 24 separately (affects the whole API; test the heartbeat).
- Memory index `MEMORY.md` is ~20.5 KB (limit 24.4 KB) — compact to <17 KB when Chad OKs.
- Stage 1b backlog (spec §11): Teams nudges, commitments from Sent Items, weekly accuracy report from logged `needsYouIds`.
- The other session's uncommitted `companyHeartbeat/index.js` changes are not ours.

---

## Kickoff prompt (paste into a new session)

```
We're continuing work on Vale, the CEO assistant agent in AmbientPixels (repo C:\Dev\Ambientpixels\ambientpixels).
Vale's mail brief went LIVE on 2026-10-17: she reads chad@ambientpixels.ai (read-only) and emails a 06:30 Pacific brief
from vale@ambientpixels.ai. Start by reading:
  1. docs/superpowers/handoffs/2026-10-17-vale-live-next-steps.md  (this handoff — state, IDs, rules, plan)
  2. the memory files project_vale_ceo_assistant_mail.md and project_ambientpixels_m365_email.md
Then:
  - First, check this morning's brief actually went out: Office page → Mail card → "Last brief sent" / Recent runs
    (or ask me). If it failed, debug that before anything else.
  - Then work through the handoff's Tasks 1–3 with me, one question at a time:
      1) my day-job hours (add the hours row to the Mail card, screenshot first),
      2) my important people (VIPs) in Sorting rules,
      3) routing real mail: hello@/press@/privacy@/legal@ as aliases on my mailbox (ask me first), Gmail forwarding optional.
  - Task 4 (Vale Mail client) comes after a few real briefs: write the implementation plan from
    docs/superpowers/specs/2026-10-17-vale-mail-client-design.md, then build it in the main checkout.
Rules: commit + push by path after verifying (the repo auto-pushes); never stage other sessions' files;
show me visible changes before shipping; never give the Vale app any write scope; protected files need my OK.
```

# Vale Mail — a small email client with Vale built in (Stage 1c) — Design

**Date:** 2026-10-17 · **Owner:** Chad (CEO) · **Status:** rev 2 after independent review (6.5/10, no-go on rev 1: the single sign-in failed our own `azp` check) — awaiting Chad's decisions in §3
**Builds on:** `2026-10-17-vale-ceo-assistant-design.md` (Stage 0+1, built) and hanson-agents `portal/js/mail.js`, `auth.js`, `views/email-inbox.js`.
**Build after:** Vale's Stage 1 setup is done and the first real briefs have run.

## 1. Goal

A small email client at `/modules/company/mail.html` with Vale beside every email: Chad reads his `chad@ambientpixels.ai` inbox sorted by Vale, opens a message, sees why it matters, asks Vale for a reply in his voice, edits it, and sends from his own account — only when he clicks Send. Scope **B** (read + reply). **C** (full client) is the roadmap (§10).

## 2. The safety split

| | Vale (Stage 1, unchanged) | Vale Mail (new) |
|---|---|---|
| App registration | **Vale** — confidential server app | **Vale Mail** — separate single-page app, public client, no secret |
| Scopes | `Mail.Read Calendars.Read User.Read offline_access` | `Mail.ReadWrite Mail.Send Calendars.Read User.Read` + Vale's `access_as_user` |
| Token lives | encrypted on the server; works while Chad sleeps | only in Chad's browser tab (MSAL `sessionStorage`) |
| Can send | **No** | only when Chad clicks Send |

A refresh token can be exchanged for any scope consented to **its own client ID**. With write scopes consented only on Vale Mail, Vale's server token can never mint `Mail.Send`. This holds only while nobody grants write scopes to Vale, so setup includes a **check that lists Vale's consented scopes and fails if `Mail.Send` or `Mail.ReadWrite` appears**.

## 3. Decisions for Chad (before build)

1. **One protected-file change (`staticwebapp.config.json` CSP):** add `https://graph.microsoft.com` to `connect-src`, so the browser can call Microsoft's mail service. Recommended; nothing else in the policy changes. (Alternative: proxy all mail through the Function App — slower, and puts the send-capable token on the server path.)
2. **Remote images in emails:** a sandboxed email inherits the site's `img-src`, which only allows a few hosts. **Recommended: no remote images** (tracking pixels blocked as a bonus); inline images embedded in the email still show. Alternative: also add `img-src https:` in the same CSP change.
3. **Drafting replies to client mail (Hanson, Evergreen):** drafting sends that email's text to a model. **Recommended:** only on an explicit click, **Claude only — no fallback to another provider** for client threads (if Claude is down, no draft), with a notice on client threads saying so. Alternative: no Vale drafts for client mail.

## 4. Architecture

```
mail.html — ONE MSAL instance, client = Vale Mail
  ├─ token for Graph (Mail.ReadWrite, Mail.Send, Calendars.Read) → Graph directly
  └─ token for api://<Vale>/access_as_user (acquireTokenSilent, same sign-in)
        → vale-state (labels, rules) and vale-draft (new)
```

- **Vale's API accepts tokens requested by either app:** `aud === VALE_CLIENT_ID` stays required; the `azp` check becomes an allow-list `VALE_ALLOWED_CLIENTS = <Vale>,<Vale Mail>` (`jwt.js` + `valeAuth.valeConfig`, with tests for both apps and for an unknown `azp`). Vale's registration lists **Vale Mail as a pre-authorized client** for `access_as_user`, so there is no extra consent prompt.
- **`vale-connect` stays Vale-app-only** (its `azp` must be Vale) — the mailbox connection can't be started from the mail client.
- **Immutable IDs everywhere:** `Prefer: IdType="ImmutableId"` in the browser Graph client **and** `api/_lib/vale/graph.js`, so archive/move don't change message IDs and Vale's labels stay attached.
- Files: `modules/company/mail.html`, `modules/company/js/vale-mail-client.js` (UI), `modules/company/js/vale-graph-browser.js` (Graph + retry + immutable IDs), `modules/company/css/vale-mail.css` (AmbientOS panel/button tokens), `api/vale-draft/` + `api/_lib/vale/draft.js`, `api/_data/vale-voice.json`.
- Linked from the Office Mail card ("Open Vale Mail"). No change to the site nav rail.

## 5. Features (scope B, trimmed)

### 5.1 Inbox
- Inbox and Sent; latest 50, paged.
- Each row: Vale's label from the last triage + her one-line reason; newer mail shows "not sorted yet" (no model call per row). Client-domain mail marked.
- Filters: Needs you · Waiting on others · Everything.
- Actions: mark read/unread, flag, archive.

### 5.2 Reading
- Message HTML in an iframe with **`sandbox="allow-popups allow-popups-to-escape-sandbox"` — never `allow-scripts` or `allow-same-origin`** (the page's CSP allows inline script and a send-capable token sits in `sessionStorage`). Built with hanson's `safeBodyDoc` approach (`mail.js` ~L430): its own CSP meta, `<base target="_blank">`, `<script>` and CSP metas stripped.
- Inline (`cid:`) images rendered as `data:`; remote images per decision §3.2. Attachments listed; download via Graph to a `blob:` link.
- **Vale panel:** label + reason; sender (raw address, external marker, project); **actual reply recipients, with a warning when Reply-To differs from From** (phishing guard); last 3 threads with this sender; "waiting on you since …"; **Draft reply** and a box "Tell Vale what to say".

### 5.3 Replying — Vale drafts, Chad sends
- **Draft reply** → `POST /api/vale-draft` (Vale API token): sender, subject, latest message as plain text (≤ 6k chars), up to 2 prior messages (≤ 3k each), optional instruction. Prompt = voice profile + email fenced as untrusted data. Returns `{ draft }` (plain text). Nothing from the request is stored or logged (errors log a code, never content). Rate limit 30/hour/oid — counter stored as counts only.
- **Voice profile v1:** `api/_data/vale-voice.json` (tone, sign-off, phrases to use/avoid, register per audience) + `founder-voice-examples.json`. Learning from Sent Items and Chad's edits is Stage 4.
- **Send flow:** `createReply` → the draft (with Graph's quoted original) exists in Drafts **before** the countdown → Chad's text is inserted **above** the quote (PATCH body = Chad's HTML + existing quoted body) → 10-second **Undo** → `send`. Undo or closing the tab leaves it in Drafts; never a half-sent state.
- **Compose new:** same editor, Vale can draft from an instruction. (Forward → C.)
- An email can at worst bend the draft text, which Chad reads before sending; `vale-draft` returns text only and holds no write token.

### 5.4 Calendar
- Today + tomorrow (read-only), matching the brief: times, attendees, join link, response status, day-job-hours flag.

## 6. Security summary

Separate public app; one MSAL instance; `azp` allow-list + pre-authorization; Vale-scope audit at setup; strict iframe sandbox; no remote images by default; immutable IDs; Reply-To warning; `vale-draft` bearer-only, size caps, no content persisted or logged, Claude-only for client threads. Note: the client-side `oid` pin is cosmetic (Graph `/me` only ever reads the signed-in user's mailbox); the real controls are the tenant-only app and Vale's server-side `oid` check.

## 7. Error handling

Graph 401 → sign in again; 429/5xx → retry with Retry-After; send failure → message stays in Drafts with a visible error; `vale-draft` failure → "Vale couldn't draft this one", editor stays usable; typed text kept in `sessionStorage` until sent or discarded.

## 8. Testing

`node file.test.js`: `jwt.js` `azp` allow-list (Vale ok, Vale Mail ok, unknown denied, `vale-connect` Vale-only); voice-prompt builder; draft request validation + truncation + no-content logging; client-thread Claude-only routing; label merge on immutable IDs; `safeBodyDoc` (scripts stripped, CSP meta present); Reply-To mismatch detection; send-flow state machine (draft-before-undo, quote preserved); browser Graph client with a fake fetch (immutable-ID header, paging, retry, createReply→PATCH→send order). Playwright (Edge): inbox, reading view with Vale panel, editor; confirm `srcdoc` and `blob:` work under the live CSP. Screenshots to Chad before merge.

## 9. Build rules

Main checkout, each change complete + tested, committed by path. **No CSP change without Chad's explicit OK** (one combined request). App registrations, consent and pre-authorization are Chad's (checklist added to the plan).

## 10. Roadmap

- **Scope C:** forward, folders, Drafts/Archive views, search, attachment upload, delete with undo, 7-day calendar, accept/decline/propose times, create events with Vale-suggested slots, `hello@`/`support@` in the same client, keyboard shortcuts, Vale-drafted follow-ups for "waiting on others", Gmail, voice learning (Stage 4).
- **Considered, not chosen (yet): an Outlook add-in** — Vale as a side pane inside Outlook web/desktop/mobile, sideloaded for this tenant. No client to build and sending stays native, but it needs its own CSP/Office.js setup and doesn't give Chad the Vale-first inbox he asked for. Worth revisiting after B if Chad mostly lives in Outlook.

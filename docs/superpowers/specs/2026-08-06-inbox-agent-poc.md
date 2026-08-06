# Inbox triage agent — POC as built, and what a real build changes

**Status:** proof of concept, working in production, 2026-08-05/06.
**Purpose:** hand a future session enough context to build the real thing without re-deriving any of it.
**Client context is deliberately not in this file** — the repo is public. See `memory/project_first_inbound_agent_client.md` and `c:/Dev/Ambientpixels/hanson-meeting-INTERNAL-crib.md`.

---

## What exists right now

An agent that reads a mailbox, decides which messages need the owner's attention, and reports. It files nothing. Read-only end to end.

| Piece | Path | Does |
|---|---|---|
| API | `api/inbox-demo/index.js` | Refresh token → Graph read → classify → JSON. Caches last good run. |
| Demo page | `modules/company/inbox-demo.html` | Client-branded UI. Run button, agent summary, results, settings preview. |
| Local spike | `c:/Dev/Ambientpixels/spike-inbox/` (outside repo) | Where it started. `spike.mjs` device-code auth + fetch, `classify.mjs`, `render-digest.mjs`, `server.mjs`. Superseded by the hosted version. |

**Measured:** 25 messages, ~8s, ~$0.009 on Claude Haiku 4.5. About $1 per 3,000 emails.

**Live:** `/modules/company/inbox-demo.html` (behind SWA auth) · `/lab/inbox-digest-demo.html` (static, public, no login — the backup).

## How auth works

Microsoft Graph, delegated, via device-code flow.

- **App registration `894d8c2e-e2ad-40a8-a0a6-5a0b68b9979d`** — `AzureADandPersonalMicrosoftAccount`, public client, **delegated `Mail.Read` and nothing else**. There is no write path to the mailbox, by construction rather than by policy. That is a selling point; do not casually add scopes.
- **Authority is `/consumers/`**, not `/common/`. That endpoint only accepts personal Microsoft accounts, so the POC *cannot* authenticate a work tenant even by mistake. Deliberate. Changing it for a real tenant build is fine, but do it knowingly.
- **Refresh token lives in blob** under `inboxDemoToken`, a key deliberately absent from `company-state`'s `VALID_KEYS`, so it is unreachable through the public state API (same trick as `pingLog`). Microsoft **rotates refresh tokens on every use** — the code writes the new one back each refresh. Remove that and the next call fails.
- Seeded once via `POST {action:'seed', refresh_token}` from the local spike's `.token.json`.

## Gotchas already paid for

Every one of these cost real time. Do not rediscover them.

1. **SWA does not proxy unlisted `/api/` paths.** `staticwebapp.config.json` only forwards routes it names explicitly; anything else falls through to `navigationFallback` and returns the **homepage HTML**. A relative `fetch('/api/inbox-demo')` therefore dies on `.json()` with "Unexpected end of JSON input". Call the Function App absolutely, as the other dashboard pages do. Do not edit the routing config — it is a protected file.
2. **`/me/messages` is the wrong endpoint.** It spans every folder including archive and sent: slower, and not what triage means. Use `/me/mailFolders/inbox/messages`.
3. **Graph 504s readily** on consumer mailboxes, especially the first call after a cold token. Retry with backoff — already implemented.
4. **Azure serves stale function code for minutes** after a successful deploy. New fields returning empty is usually propagation, not a bug. Wait, re-test, then investigate.
5. **Long tokens get mangled through the shell.** Seeding a 393-char refresh token via `curl` in bash silently produced an empty body; the same request from Node worked. Post JSON from Node.
6. **`storage.setState` accepts any key** — it writes straight to blob with no `VALID_KEYS` check. That is how the token and cache keys work without touching `company-state/index.js`.
7. **Classification wobbles at the boundary.** The same security alert was `needs_you` on one run and `transactional` on the next. Not a defect; it is the argument for shadow mode, and it is why the taxonomy needs the user's input.

## Design decisions worth keeping

- **Shadow mode first.** Touch nothing for the first week; show what it *would* have filed. These projects fail by burying one important message in week one, not by being technically wrong. Corrections during shadow week are also the tuning data.
- **Never delete. Move and label only.**
- **Never send.** The permission was never granted, so it is not a setting anyone can toggle.
- **Four categories, not two.** `needs_you` / `transactional` / `promotional` / `newsletter`. "Important vs junk" is too coarse: a receipt and a security alert are both keepers, and only one may need action.
- **The summary is the product.** A plain-language brief — what needs you and who from, then one line on the rest — is what makes it feel like an assistant. It comes back in the same model call, so it is free.
- **Cache the last good run** and degrade to it, clearly labelled, when the mailbox is unreachable. Verified by deliberately breaking the token.

## What a real build changes

The POC is single-user, single-mailbox, read-only. Production differs on five axes:

1. **Whose mailbox.** Per-user delegated consent through the client's own tenant, not one seeded personal token. Needs an app registration in *their* directory and admin consent. **This is the long pole and it is organisational, not technical.**
2. **Where the model runs.** The POC calls Anthropic. If message content cannot leave the tenant, the answer is **Azure OpenAI inside the client's own subscription** — same architecture, different endpoint. Confirm before building; it is the question that shapes everything.
3. **Actually filing.** Requires `Mail.ReadWrite` and folder/category management. Only add this scope after shadow mode has earned trust, and never `Mail.Send`.
4. **Rules before the model.** Cheaper and more predictable: handle list-unsubscribe headers, known domains and VIP senders deterministically, and spend model calls only on the ambiguous remainder.
5. **State per user.** Settings, VIP lists, folder names, corrections. None of that exists yet — the settings panel is a preview and is wired to nothing.

## Open questions that block the real build

Answers come from the client, not from code. Full list in the meeting crib.

1. Which mail platform, confirmed out loud.
2. **Can message content leave their environment?** Picks the model and therefore the architecture.
3. Who grants mailbox permission, and does IT/security need to approve it.
4. What "important" means to them, concretely — names, clients, phrases.
5. What success looks like in week one.

## Do not

- Do not add `Mail.Send`, or any write scope, without an explicit decision. The absence of it is a promise already made to the client in writing.
- Do not edit `staticwebapp.config.json` to route the API — call the Function App directly.
- Do not point this at a work or corporate tenant you have not been granted access to.
- Do not put client-identifying material in this repo. It is public.

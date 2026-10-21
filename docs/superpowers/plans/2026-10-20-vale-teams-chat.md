# Vale in a Teams chat (two-way)

*2026-10-20. Decided by Chad: a Teams **channel** for Vale's notifications (shipped `b887b626`), a Teams **chat** for conversation (this plan).*

## What it is
Chad messages "Vale" in Teams like a person. She answers with the same brain as her Office chat (`api/valechat`): the team in HQ's numbers, what's waiting on him, his action list, her memory. One person only: every message must be signed by Microsoft's Bot Framework **and** come from Chad's Entra object id (`VALE_CEO_OID`); anything else is refused.

## Constraints
- **No new npm packages** (`package-lock.json` is protected). Bot Framework tokens are verified with `node:crypto`, like `_lib/vale/jwt.js`; replies go out with `node-fetch`.
- **Never add scopes to the "Vale" Entra app.** The bot gets its own app registration, "Vale Bot", with no Graph permissions at all.
- **Mail stays out of the Teams chat** until Chad says otherwise (default off: `VALE_BOT_MAIL=0`). The Office chat keeps reading mail behind his sign-in.
- Dormant until `VALE_BOT_APP_ID`, `VALE_BOT_APP_SECRET` and `VALE_BOT_TENANT_ID` are set.

## Build (Claude)
1. `api/_lib/vale/chatCore.js`: the part of `api/valechat` that turns a message + history into Vale's answer (persona, memory, fleet snapshot, team summary, optional mail), so the Office chat and the Teams chat cannot drift. `api/valechat` keeps its gate and mail logic and calls it.
2. `api/_lib/vale/botAuth.js`: verify the Bot Framework JWT on each incoming activity (issuer `https://api.botframework.com`, audience = bot app id, keys from `https://login.botframework.com/v1/.well-known/openidconfiguration`, cached), and fetch the bot's outbound token (client credentials against the bot's tenant, scope `https://api.botframework.com/.default`).
3. `api/vale-teams-bot`: POST `/api/vale-teams-bot`. Verify the token, check `from.aadObjectId === VALE_CEO_OID` and the tenant, ignore non-message activities, answer via chatCore with the last few turns of the Teams conversation (stored under a new `valeTeamsChat` key, class never), reply to `serviceUrl` (allow-listed to `*.botframework.com` / `smba.trafficmanager.net`).
4. Teams app package: `teams/vale/manifest.json` + two icons, zipped for upload.
5. Tests for each, offline, with fake keys and fake fetch.

## Setup (Chad, ~15 min)
1. **App registration** (Entra admin center, signed in to the c4ssinilive tenant): New registration → name **Vale Bot** → *Accounts in this organizational directory only* → Register. Copy the **Application (client) ID**. Certificates & secrets → New client secret (24 months) → copy the **value**. Add no API permissions.
2. **Azure Bot** (Azure portal → Create a resource → *Azure Bot*): name `vale-bot`, resource group `ambientpixelsV2`, pricing **F0 (free)**, type **Single Tenant**, *Use existing app registration* → paste the client ID. After it's created: Configuration → Messaging endpoint `https://ambientpixels-nova-api.azurewebsites.net/api/vale-teams-bot` → Apply. Channels → **Microsoft Teams** → accept → Apply.
3. Give Claude the client ID and secret; they become Function App settings (never in code).
4. **Upload the Teams app** Claude packages: Teams → Apps → Manage your apps → *Upload an app* → *Upload a custom app*. If custom upload is blocked: Teams admin center → Teams apps → Setup policies → Global → *Upload custom apps* = On (can take a few hours).
5. Open the Vale app in Teams and say hello.

## Later
- Mail in the Teams chat (Chad's call).
- Approve/Reject buttons on her channel cards, allow-listed per spec §11 Stage 5.
- "Tell the team…" relay to board tasks, with confirmation.

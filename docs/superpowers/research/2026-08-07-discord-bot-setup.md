# Discord bot — built, not switched on

**Everything on our infrastructure is done and tested. What is left is a Discord application,
which needs an account, so it is yours to create. About 10 minutes.**

---

## What it does

Someone types `/roast` in a Discord server. A private box opens, they paste their resume, and
~25 seconds later a card appears **in the channel** with their ATS score, the verdict, two roast
lines, the keywords they are missing, and a button to the site.

That last part is the point. Everyone watching the channel sees a number and wants their own — the
same mechanic as the share card, except it happens where job seekers already are instead of
requiring them to have found us first.

## Two things it deliberately does

**The resume never touches the channel.** Discord renders a slash command's option values into the
channel for everyone to read, so `/roast resume:<text>` would publish someone's name, email, phone
and address to the whole server. Input comes through a modal, which is private to the person typing.
The public card carries the score and the roast — never the document. There is a test asserting the
resume cannot appear in the outgoing message.

**It cannot drain the balance.** Three roasts per person per day, and a hard ceiling of 300 per day
across every server it is ever added to. Without the global cap, one large server could empty the
Anthropic balance in an afternoon. Both caps are checked *before* any model call, and a refusal is
shown only to the person who asked rather than cluttering the channel.

---

## Setup — 5 steps

**1. Create the application.** https://discord.com/developers/applications → New Application. Name it
Resume Roast. From **General Information**, copy the **Public Key**. From **Bot**, copy the **Token**.

**2. Add three app settings** to the Function App (`ambientpixels-nova-api`):

| Setting | Value |
|---|---|
| `DISCORD_PUBLIC_KEY` | the Public Key from step 1 |
| `DISCORD_APPLICATION_ID` | the Application ID from step 1 |

The bot token is deliberately **not** deployed — the endpoint never needs it. Followups are
authenticated with the per-interaction token Discord sends. The token is only used once, locally, in
step 4.

**3. Point Discord at the endpoint.** On **General Information**, set **Interactions Endpoint URL** to:

```
https://ambientpixels-nova-api.azurewebsites.net/api/discord-interactions
```

Discord will immediately send test requests with deliberately-invalid signatures and refuse the URL
unless they are rejected with 401. Ours does — that path has its own tests, because a mistake here
looks like "Discord just won't accept the URL" with no other explanation.

**4. Register the command** (once, locally):

```bash
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.js
```

Add `DISCORD_GUILD_ID=<a test server>` to register instantly to one server instead of waiting up to
an hour for the global rollout. Do that first and try it somewhere private.

**5. Invite it.** OAuth2 → URL Generator → scope `applications.commands` (the bot does not need the
`bot` scope or any message permissions — it only answers interactions).

---

## Before adding it to anyone else's server

The distribution research is blunt about this: essentially every job-seeker community bans unsolicited
self-promotion, and a bot arriving unannounced is the loudest possible version of that. **Ask the
server owner first.** A free tool with no signup is the best possible case for a yes, but it is still
a yes you have to get.

Servers you own are free — that is also the right place to see whether anyone actually uses it before
asking a stranger.

---

## What it costs

Each roast is one model call, the same as the website's. The global cap of 300/day bounds the worst
case; the realistic case is far smaller. It shows up in the spend monitor as `caller: discord-bot`,
so it can be measured separately from the site, and `GET /api/llm-spend` breaks burn down by caller.

If it ever needs turning off in a hurry, remove `DISCORD_PUBLIC_KEY` from the app settings —
every interaction then fails signature verification and the bot goes quiet without a deploy.

---

## Code

| File | What |
|---|---|
| `api/discord-interactions/index.js` | the endpoint |
| `api/_lib/discord/verify.js` | Ed25519 verification, modal, embed — all pure |
| `api/_lib/discord/verify.test.js` | 14 tests |
| `api/discord-interactions/bot.test.js` | 15 tests, full interaction lifecycle |
| `scripts/register-discord-commands.js` | one-time command registration |

No new dependencies — Node verifies Ed25519 natively.

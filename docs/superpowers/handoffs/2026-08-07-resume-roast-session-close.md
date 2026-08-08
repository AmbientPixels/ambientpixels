# Handoff — Resume Roast: the product is fixed, distribution is the open problem

**Read this first. It supersedes `2026-08-07-resume-roast-traffic-readiness.md`**, which covers the
first 7 commits in more depth and is still worth reading for those.

**22 commits, `130e319b` → `d60dfd76`. All pushed, all deployed, working tree clean.**
**201 tests across 10 suites, green. Full funnel verified live in production, 15/15.**

> **Committed markdown under `docs/` is served publicly as raw text** — verified, these files return
> HTTP 200 to anyone. No balances, credentials or customer data in here. Live spend figures are behind
> `GET /api/llm-spend`, which is secret-gated.

---

## The one-paragraph version

The previous session concluded "a defensible offer and no distribution." That was true and
incomplete. The product *also* had a viral loop broken in three separate places, no model fallback on
any public path, a paid claim the code did not keep, analytics that would have reported a working
channel as dead, and a cost model with no ceiling and no alarm. All of that is fixed and verified in
production. **What remains is genuinely a distribution problem, and it is harder than it looked** —
the category is saturated by evidence, and the launch surfaces that would lend us an audience are
gated per-domain, which means this product competes with AmbientScore, CardForge, StoryForge and
Blindspot for the same slots.

---

## What is live now that was not this morning

**The share loop works end to end for the first time since launch.** It was broken in three places,
all of which had to work for any of it to matter:
1. The share-card endpoint returned **HTTP 500 on every request, always** — `require('satori')` returns
   `{default, init}` in 0.10.x, so calling it threw, and the endpoint's own try/catch reported a
   generic 500. No card had ever rendered.
2. The share **link** resolved to the AmbientPixels homepage, because it was the one call in the file
   built from `window.location.origin` instead of `getApiBase()`, and the SWA proxy does not route
   `/api/pixel-agent-share`.
3. The card was **never shown to the person it was about** — the frontend had no reference to the card
   endpoint at all.

**Every public path now has a cross-provider model fallback** (`api/_lib/llm`). Before, one
unconditional Anthropic call served all 24 agents, the $9 rewrite, the free scan and the $199
teardown; exhausted credits took all of it down at once. Verified against the live Gemini API.

**The $9 rewrite now receives the job description** it is advertised to use. It shaped the free score
only, so customers paid for a rewrite that had never seen the posting.

**A Discord bot is live** (`/roast` in Delchron's server). Private modal in, public score card out.

**Spend is watched** (`api/llmSpendMonitorCron`), with Discord alerts on runway, burn spike, credit
fallback and total chain failure.

---

## The three decisions waiting on the CEO

**1. The www / non-www split.** The site answers on BOTH hostnames with HTTP 200, identical bytes, and
no redirect. Sitemap, robots.txt and the homepage canonical all say `www`; 30 other pages still say
non-www. The roast funnel was aligned to `www`. **The 301 needs `staticwebapp.config.json` or DNS —
both do-not-touch** — and SWA route rules match paths, not hosts, so this may need a DNS/Front Door
change. Until it exists, every page on the domain splits its own ranking signals.

**2. Top up Anthropic before pointing a channel at this.** The monitor warns at 10 days of runway,
which is a short fuse at volume. Live figure: `GET /api/llm-spend` with `x-company-secret`.

**3. Which product gets the one Product Hunt slot.** PH enforces a six-month gap between products
sharing a root domain. Launching Resume Roast costs the other four their slot. Resume Roast is the
newest product in the most saturated category — the honest case is that this is *not* the one to
spend it on.

---

## Distribution: what the research actually found

A subagent ran its own census against the HN Algolia API rather than recycling blog statistics, and
separately audited the ecosystem of "launch statistics" content — finding that most of it launders
through blogs citing blogs citing nothing. Full report: `docs/superpowers/research/2026-08-07-distribution-kit.md`.

**The category is saturated, by direct measurement:**
- 17 resume/ATS tools posted to Show HN in 2026. **None cleared 5 points.**
- Three prior AI resume-roast tools scored **3, 3 and 4**.
- "Roast my X" peaked mid-2024 at 39 points; nothing above 4 in 2026.
- AI-titled Show HN posts break through at **half** the rate of non-AI ones, and are 30.8% of all Show HN.

**Two beliefs that turned out to be folklore, both in our favour:**
- "HN punishes paid products" — HN's moderator has explicitly blessed paid features, and free/no-signup
  framing performs identically to baseline. Our shape is close to ideal for their rules.
- Launch timing barely matters on HN (day-of-week variation sits inside the noise).

**One live liability:** six weeks ago HN spent 1,032 points concluding ATS scores are
"non-deterministic noise dressed up as measurement." **We tested ours and they were right** — the same
resume scored 42, 38, 38, 42 across four production runs. The FAQ now says so plainly. Lead with the
roast (subjective, honest) rather than the score (objective-looking, indefensible).

**The competitive table went stale in about a day.** RoastCV is dead (domain parked for sale). The
Resumly quote could not be reproduced. RoastTheResume advertises "bullet rewrites", so our difference
is narrower than "advice vs artifact" — it is *rewritten bullets you paste in yourself* versus *the
whole document handed back*. **Re-verify competitor copy at the moment you use it, not when you gather it.**

**Launch surfaces are queue- or domain-gated**, so the portfolio competes with itself. Uneed's free
tier is one line and AmbientScore is already in it (~110 days out); paid is $14.99 fast-track or
$29.99 for a chosen date. Lobsters should be skipped outright — 2,838 monthly active users, and their
spam policy covers commercial *and* AI-authored content.

**Recommended spend: $0.** The only vendor publishing a click estimate offers 50–100 first-week clicks
for $49 — roughly $27 of revenue at a generous conversion rate.

---

## Unblocked work, ranked

1. **Two open bug-bash items on the money path.** Inline compose can exceed Azure's 230s HTTP gateway
   limit (it self-heals, but the buyer waits ~13 minutes), and nothing prevents a customer paying
   twice for the same roast.
2. **PitchWall** — the last genuinely free directory. Verify it is not queue-gated like Uneed first.
3. **Comparison page vs RoastTheResume** — defensible on today's verified copy, and the only competitor
   claim that survived re-checking. Must say "rewritten bullets vs the whole document", not "advice vs artifact".
4. **Do NOT build programmatic SEO yet.** Google's test is user value, "no matter how it's created".
   With 12 lifetime runs there is no proprietary data to make such pages non-thin, and the domain also
   carries four other products. This is a considered no, not an oversight.

---

## Gotchas that will bite the next session

- **`require('satori')` is not callable** — 0.10.x is an ESM-interop build exporting `{default, init}`.
  A try/catch reporting a generic 500 hid this for the endpoint's entire life.
- **CSP blocks the API host in `img-src`.** `connect-src` allows it, `img-src` does not, but `blob:` is
  allowed — so fetch the image and hand the browser an object URL. **Local harnesses serve pages
  without the CSP header, so this class of bug is invisible until you test production.**
- **Pick a deploy sentinel that exists ONLY in the new code.** I waited on a string the old code also
  contained, "verified" a fix that was not live, and then misdiagnosed the result.
- **Anthropic reports credit exhaustion as a 400**, not 402 — only the message body says so.
- **`context.log` has no `.log`.** It is callable, with `.error`/`.warn`/`.info`.
- **Only 1 of 10 scoring agents uses the key `score`.** Resolve through the agent's declared
  `outputSections`, never `result.score`.
- **A tool result cannot tell you whether a permission prompt fired.** Auto-allowed and user-approved
  look identical from the assistant side.
- **`WebFetch` needs `WebFetch(domain:*)`**, and permission rules only load at session start.
- Do not measure `resumeroast` analytics across 2026-08-07 — two tagging changes landed that day.

---

## Map of what was built

| Path | What |
|---|---|
| `api/_lib/llm/` | cross-provider model chain + spend monitor (pure, tested) |
| `api/_utils/runScore.js` | score/verdict resolution via declared `outputSections` |
| `api/discord-interactions/`, `api/_lib/discord/` | the bot |
| `api/llmSpendMonitorCron/`, `api/llm-spend/` | the alarm and its on-demand read |
| `scripts/register-discord-commands.js` | one-time slash-command registration |
| `resume-roast/launch/` | PH gallery images, icons, all from the real product |
| `docs/superpowers/research/2026-08-07-distribution-kit.md` | the approve-or-skip distribution checklist |
| `docs/superpowers/research/2026-08-07-discord-bot-setup.md` | bot setup + kill switch |

Browser harnesses live in the session scratchpad (retry/recovery 17, JD payload 5, mobile 12,
share 4, production walk 15). They are not committed — recreate from the patterns in the test files
if needed.

---

## The honest summary

Everything that was broken is fixed, and most of it was broken in ways that produced no error anyone
would see — a 500 behind a generic catch, a link that resolved to the wrong page, a score read from a
key nine agents do not use, analytics that would have quietly justified killing a working channel.
That class of failure is the real lesson from this session: **the product looked fine and was not, and
the only thing that found it was walking the funnel in production rather than trusting the tests.**

The distribution problem is now the whole problem, and it is not a tactics shortage. The two channels
that need nobody's permission — the share loop and the Discord bot — are live. Everything else is
either gated, queued, or competing with your own other products for the same slot.

---

## Kickoff prompt for the next context

Paste this into a fresh session, editing the one marked line.

```
Read `ambientpixels/docs/superpowers/handoffs/2026-08-07-resume-roast-session-close.md` first.
That is the full context for where Resume Roast stands — 23 commits shipped and verified live on
2026-08-07. Don't re-derive it, and don't re-investigate anything it marks as verified.

Short version so you can sanity-check the doc against reality: the product was broken in ways that
produced no visible error (share card 500 since launch, share link resolving to the homepage, no
model fallback on any public path, the $9 rewrite never receiving the job description it advertises,
analytics that would have justified killing a working channel). All fixed. 201 tests green. The
Discord bot is live. Distribution is now the whole problem.

WHAT I WANT FROM THIS SESSION:
[EDIT THIS LINE — options below, pick one or write your own]
  (a) Keep going on the ranked unblocked work in the handoff, autonomously.
  (b) Close the two remaining bug-bash items on the $9 money path, then stop.
  (c) Step back: given the saturation evidence, tell me whether Resume Roast deserves more
      investment at all, or whether the slot and the effort belong to another product.

DO NOT DO WITHOUT ASKING ME:
- Spend money, create external accounts, or sign up for anything.
- Post publicly as the brand anywhere.
- Launch on Product Hunt. It locks the whole ambientpixels.ai domain for six months and costs
  AmbientScore, CardForge, StoryForge and Blindspot their slot. That is my call, not a session's.
- Touch staticwebapp.config.json, companyHeartbeat/index.js, company-state, or company-actions.json.
- Build programmatic SEO. The handoff explains why that is a considered no, not an oversight.

RULES THAT EARNED THEIR PLACE TODAY — these cost real time, so start with them:
- Verify in PRODUCTION, not just locally. Almost every bug found today was invisible to local tests:
  a 500 behind a generic catch, a CSP rule that only exists on the live host, a link that resolved
  to the wrong page. Walk the funnel as a user before believing anything works.
- When you check whether a deploy landed, grep for a string that exists ONLY in the new code. I
  waited on one the old code also contained, "verified" a fix that wasn't live, and misdiagnosed the
  result from there.
- Re-verify competitor claims at the moment you use them. The competitive table went stale in about
  a day: one competitor's domain is now parked for sale, one quote could not be reproduced, and the
  closest live one turned out to offer more than we credited — which narrowed our own claim.
- Never fabricate. Every product claim checkable in code, every competitor claim traceable to their
  own copy with a URL. If you can't verify it, say so rather than softening it.
- Committed markdown under docs/ is served publicly as raw text. No balances, no credentials.

Commit and push as you go, with real reasoning in the messages.
```

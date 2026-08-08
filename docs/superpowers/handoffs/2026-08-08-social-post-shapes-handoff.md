# Handoff — Social post shapes: we have one, and it is the wrong one on two of three platforms

**This is a design brief, not a build ticket.** The plumbing questions are answered; the open
questions are editorial and they belong to the CEO. Read the whole thing before proposing anything —
several obvious ideas are already ruled out by measurement further down.

> **Committed markdown under `docs/` is served publicly as raw text.** This file is safe for anyone
> to read. Keep it that way: no credentials, no balances, no runway figures, no customer or client
> names. Follower counts below are public on the platforms themselves.

---

## The one-paragraph version

Every scheduled social post AmbientPixels publishes has the same shape: **prose plus a product
link**. That is not a stylistic habit, it is enforced — `validate.js` requires a URL and Scribe's
brief says the post *"MUST include the product URL"*. It is also the single most algorithmically
demoted shape on X and LinkedIn, and we apply it uniformly to every platform. Meanwhile the shapes
those platforms actually reward — no-link value posts, replies, native media, threads — are either
forbidden by our own rules or unbuilt. **The task is to make post shape a first-class, per-platform
decision instead of one hardcoded template.** Step 1 is mechanical and scoped below. Steps 2–4 need
editorial decisions nobody has made yet.

---

## Measured reality — read this before proposing anything

Pulled from `socialEngagementSnapshots` (10,768 snapshots, latest-per-post) on 2026-08-08, covering
**195 posts from 2026-04-15 to 2026-08-08**:

| platform | posts | zero engagement | likes | comments | reposts | best post ever |
|---|---|---|---|---|---|---|
| bluesky | 139 | **110 (79%)** | 28 | 15 | 4 | 5 |
| x | 28 | **22 (79%)** | 10 | 5 | 0 | 5 |
| linkedin | 28 | **25 (89%)** | 2 | 1 | 0 | 1 |

**195 posts produced 65 total interactions in four months.** Live follower counts: Bluesky 82,
X 52, LinkedIn 2.

And the finding that kills the obvious idea — engagement by publish month:

```
2026-04    34 posts    18 interactions    0.53 per post
2026-07   124 posts    39 interactions    0.31 per post
2026-08    35 posts     8 interactions    0.23 per post
```

**Posting more has already been tried.** Volume went up 3.6x and per-post engagement halved. Do not
propose "increase cadence" — it is the one intervention with evidence against it.

### The honest caveat that should shape your ambition

At 82 / 52 / 2 followers, **post-shape optimisation is a multiplier on a small number.** Removing a
30–50% demotion penalty from a post that reaches ~40 people returns ~15 people. This work is worth
doing because it compounds and because it is cheap, *not* because it will move revenue this month.
The lever that is not bounded by our follower count is **replies into other people's threads**, and
that already shipped (see "What already exists").

---

## What the system can actually do

Verified against the executors on 2026-08-08. Do not design around capabilities in the ✗ column
without costing the build.

| | post | reply | search | like | repost | follow | media |
|---|---|---|---|---|---|---|---|
| Bluesky | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| X | ✓ | ✓ *(new, unwired)* | ✗ | ✗ | ✗ | ✗ | ✓ |
| LinkedIn | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Reddit | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | — |

Two things worth noticing: **there is no like/repost/follow primitive anywhere in the repo**, and
**media upload already works on every platform that matters** and is almost entirely unused.

---

## What each platform actually rewards

| | link in post body | rewards | punishes |
|---|---|---|---|
| **Bluesky** | **no penalty** | replies, custom-feed tags, quote posts | little algorithmically — the Following feed is reverse-chronological |
| **X** | **heavy demotion** | replies (especially early, to large accounts), native media, dwell time, follows-from-post | outbound links, multiple hashtags |
| **LinkedIn** | **heavy demotion** | comments, dwell time, native video, document carousels, first 60–90 min velocity | outbound links; company pages get roughly an order of magnitude less reach than personal profiles |
| **Reddit** | context-dependent | genuine participation, text posts with real substance | any whiff of self-promotion |

The useful reframe: **Bluesky is where links are free. X and LinkedIn are where reach must be earned
first and cashed in later.** We currently treat all three identically.

---

## The shapes worth having

1. **No-link engagement post** — pure value, no ask. Grows the follower base every future link post
   depends on. *Currently forbidden by our own validation.*
2. **Link post** — the conversion ask. Cheap on Bluesky, expensive on X and LinkedIn. *This is the
   only shape we have.*
3. **Participation reply** — reach borrowed from someone else's audience, not bounded by our
   follower count. **Already built and live** (see below).
4. **Link-in-first-reply** — the standard X/LinkedIn workaround: clean post, link in a follow-up.
   X reply capability shipped 2026-08-08 but nothing calls it.
5. **Thread / multi-part** — dwell time on X and Bluesky. Unbuilt.
6. **Native media** — X and LinkedIn reward it disproportionately, and `media.js` already works.
   Probably the largest unused lever we own. Needs image generation wired into the social path.
7. **Question post** — comments are the strongest LinkedIn signal, and we currently ask for nothing.

---

## The constraint that blocks all of it

Two places make the URL mandatory. Both must become per-platform before any other shape is
expressible:

- `api/_lib/socialCopy/validate.js` — rejects copy without the URL, and rejects it appearing more
  than once.
- `api/companyHeartbeat/agent-runner.js`, the `copyTask` description — the literal line
  `- MUST include the product URL: …` handed to Scribe.

### Step 1 — the mechanical part, already scoped

`PLATFORM_RULES` in `api/_lib/socialCopy/voice.js` already carries per-platform `maxLen` and
`maxTags`, and `validate.js` already reads that object. A `linkPolicy` field is a natural sibling:

```js
social_bluesky:  { maxLen: 300,  maxTags: 3, linkPolicy: 'allowed'  },  // no penalty here
social_x:        { maxLen: 280,  maxTags: 1, linkPolicy: 'reply'    },  // link in a follow-up
social_linkedin: { maxLen: 1500, maxTags: 3, linkPolicy: 'comment'  },  // link in first comment
```

This is well-tested territory (`voice.test.js`, `validate.test.js`) and it unblocks shapes 1, 2 and
4 without deciding anything editorial. **Do this first regardless of what is decided below.**

---

## The open questions — these are the CEO's, not yours

Do not infer answers to these from the code. They are brand and strategy decisions.

1. **What does a no-link AmbientPixels post actually say?** We have never written one. The voice
   spec (`voice.js`) covers tone but assumes a CTA exists.
2. **What ratio?** Something like 3 engagement posts : 1 link post is conventional, but the right
   number depends on how impatient we are for clicks versus followers.
3. **Is LinkedIn worth anything at all** while it is a 2-follower *company page*? 28 posts have
   produced 2 lifetime likes. The realistic options are (a) the CEO posts from his personal profile,
   (b) pursue `w_member_social` scope to post as a member, or (c) stop spending cycles on it. This
   is the highest-value decision in this document and it needs a human.
4. **Do we want media posts enough to build image generation into the social path?** Highest
   ceiling, largest build.
5. **What is the success metric?** Follower growth and engagement rate are the honest ones for
   shapes 1/3/5/6. Clicks are only honest for shape 2. Measuring the whole programme on clicks will
   make the correct strategy look like a failure.

---

## What already exists — do not rebuild these

Shipped 2026-08-08, all green, all deployed:

- **Participation reply lane** — `companyHeartbeat/bluesky-participation.js`. Auto-drafts replies
  into discovered threads. **No link, no product mention, ever** — that constraint is what separates
  it from the outbound sales lane that was switched off after 40 replies produced 0 clicks. Capped
  at 2/day, 14-day per-author cooldown, CEO-gated. Enabled via
  `systemConfig.blueskyParticipation.enabled`.
- **Relevance filter** — `companyHeartbeat/bluesky-relevance.js`. Deterministic "do we belong in
  this thread", high-precision by design.
- **Discovery sensor** — `companyHeartbeat/bluesky-sensor.js`, running on `asProspectCron`.
- **X reply capability** — `actionsExecute/executors/social/x.js`, `buildTweetBody`. Built,
  **nothing calls it yet.** This is what shape 4 needs.
- **Bluesky hashtag facets** — `executors/social/bluesky.js`. Tags are only real tags if the post
  carries a `facet#tag`; ours never did until this fix, which made us invisible to every tag-driven
  custom feed.
- **Product URL resolution** — `_utils/productUrl.js`. Repairs a bare-homepage link to the product
  page the copy is about.

---

## Gotchas that will bite you

Each of these cost real debugging time on 2026-08-08.

- **A sensor must never live inside an agent's deliberation path.** Bluesky discovery sat inside
  `runAgentHeartbeat` under `if (agentId === 'scout')`. The idle-agent gate skips agents with no
  assigned tasks *before* that runs, so discovery silently died for five weeks. A sensor that stops
  producing looks exactly like a quiet week.
- **Substring matching is not word matching.** `"ats"` matches inside `"cats"`; `"ui"` matches
  inside `"build"`. The first live participation draft targeted an International Cat Day photo
  thread because of this. Anchor domain vocabularies with `\b`.
- **A falsy `0` is not "absent".** `(opts.x) || DEFAULT` silently discards a legitimate zero. Bit us
  twice in one day — a cooldown override and a tweet id.
- **Discovery keywords and relevance domains must agree.** They did not: every keyword targeted
  builders while the revenue objective targets job seekers, so the sensor filled a 200-slot store
  with threads the filter was guaranteed to reject. `bluesky-keywords.test.js` now fails on drift.
- **A written refusal is not a decline.** `agent-runner` treats a deliverable under 5 characters as
  "the agent chose not to post". A brief that says *answer "NOTHING TO ADD"* produces 14 characters,
  which sails through and gets **posted verbatim**. Briefs must ask for an *empty* deliverable.
- **Two link-injection paths will silently turn a no-pitch reply into an ad.** `agent-runner`
  appends a product URL to any `bluesky-reply` task carrying a `[SCAN RESULT]` comment or a
  `destinationUrl`. Any new no-link shape must carry neither.
- **Deploys restart the Function App.** Triggering a heartbeat while a deploy is in flight returns
  502 and produces no run. Wait for the workflow to complete first.
- **A green CI run can still have skipped the API deploy.** Check the job's step list for
  `Deploy API to Azure Functions (Kudu zip-deploy)`.

---

## Where the code lives

```
api/_lib/socialCopy/voice.js        PLATFORM_RULES — maxLen, maxTags, and the home for linkPolicy
api/_lib/socialCopy/validate.js     deterministic pre-checks; enforces the mandatory URL today
api/_lib/socialCopy/prompt.js       worker prompt builder (~600 tokens)
api/_lib/socialCopy/index.js        stateless copy worker — built, NOT wired to any caller
api/companyHeartbeat/agent-runner.js
                                    copyTask brief (the "MUST include the product URL" line),
                                    social action finalisation, reply routing
api/companyHeartbeat/bluesky-*.js   sensor / relevance / participation lane
api/companyHeartbeat/reply-normalize.js
                                    strip scaffolding, sentence-case, cap length — shared
api/actionsExecute/executors/social/ bluesky.js, x.js, linkedin.js, reddit.js, media.js
api/_utils/productUrl.js            resolve + repair product links
api/_utils/socialUtm.js             UTM injection, own-domain URL patterns
```

Do **not** edit without an explicit request: `companyHeartbeat/index.js`, `company-state/index.js`,
`staticwebapp.config.json`, `data/company-actions.json`.

---

## How to verify anything you build

```bash
# full suite (note the *smoke-test.js glob — a plain *.test.js sweep misses suites)
for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done

# exercise the social lanes without waiting for the 2h timer
POST /api/as-prospect-trigger?lane=bluesky&force=1     # force bypasses the discovery cooldown
POST /api/as-prospect-trigger?lane=participation

# a full cycle (~3 min; 502 after ~120s means a deploy was in flight)
POST /api/company-heartbeat-trigger
```

Read the copy it produces **as a person** before believing any of it works. The quality gate is
fail-open and a 200 plus a green suite cannot tell you whether the writing is any good.

---

## Suggested order

1. **Step 1 above** — per-platform `linkPolicy`. Mechanical, unblocks everything, decides nothing.
2. **Get answers to the five open questions**, especially LinkedIn.
3. **Shape 1 (no-link posts) and the ratio** — the compounding play.
4. **Shape 4 (link-in-first-reply) on X** — cheap now that reply capability exists.
5. **Shape 6 (media)** — highest ceiling, real project, only worth it after 1–4 show signal.

And keep the honest frame in view: **the participation lane is a bigger lever than any of this**,
because borrowed reach is not capped by a follower count of 82.

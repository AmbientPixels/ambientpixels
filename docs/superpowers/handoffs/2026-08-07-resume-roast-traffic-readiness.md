# Handoff — Resume Roast: made ready for traffic

**Session of 2026-08-07 (evening). 7 commits, `130e319b` → `c0f42c70`, all pushed and deployed.**
**Prior context: `docs/superpowers/handoffs/2026-08-07-resume-roast-repositioning.md`.**

---

## The headline

The previous session's conclusion was "a defensible offer and no distribution." That was true, but
incomplete. **The product also had a broken viral loop, no model fallback, a paid claim the code did
not keep, and analytics that would have reported a working channel as dead.** All four are fixed.

The single most surprising finding: **the share-card endpoint had never worked once.** Not degraded —
HTTP 500 on every request since it shipped, verified against production.

---

## What shipped, in order

### 1. Share cards — `da922f3e`

Two bugs stacked, both silent.

`require('satori')` returns `{ default, init }` in 0.10.x, not the function. `await satori(...)` threw
`satori is not a function` on every request, caught by the endpoint's own try/catch and reported as a
generic 500. **Every shared link has always had a dead `og:image`.**

Underneath that, the score was read as `result.score` — a key exactly **one of the ten scoring agents**
uses. The other nine each have their own (`ats_score`, `quality_score`, `viability_score`,
`persuasion_score`, `design_score`, `standout_score`, `original_score`, `productivity_score`,
`their_score`). Confirmed live: the deployed OG description for a real run came back as the verdict
quote alone, no score.

Rather than hardcode a key list that drifts, it now resolves through each agent's own declared
`outputSections` (`{ "key": "ats_score", "type": "score" }`) — authoritative, since the product UI
renders from it. That also recovered five verdict keys no pattern match could reach:
`cause_of_death`, `rating`, `send_confidence`, `shock_factor`, `goal_summary`.

**Verified in production after deploy:** card returns 200, renders `52 / out of 100` over the verdict,
and the OG description leads with `Score: 52/100`.

### 2. Model fallback + cost ceiling — `5560b0b7`

`pixel-agent-run` and `_lib/ambientScore/analyzer.callClaude` each made **one unconditional call to
Anthropic with no fallback**. A 429, a 529, or an exhausted balance returned 502 to every user of all
24 agents *and* the $9 rewrite *and* the $199 teardown, simultaneously. This is what made pointing
traffic anywhere unsafe.

`api/_lib/llm` now walks a cross-provider chain. It **reuses** `companyHeartbeat/model-registry.js`
(the chain build, dedup-by-resolved-id and thinking-budget rules are subtle and already proven) but
has its own provider callers, because the fleet's drop the system prompt, drop temperature on the
Claude leg, and return no usage — all three disqualifying for a public product.

**Verified against the live Gemini API, not just mocks:** with a deliberately invalid Anthropic key, a
real resume-roast prompt fell through to gemini-2.5-flash and returned valid JSON with all six
contract fields in 4.3s.

Failures are classified. Anthropic reports credit exhaustion as a **400 whose message is the only
signal**, so status codes alone cannot detect the case that matters most.

Also closed the cheapest denial-of-wallet available: input was **uncapped** on a free anonymous
endpoint (200k context ≈ $0.60/request, and one person gets 15/day across the separate IP and userId
buckets). Now capped at 20,000 — the same limit the paid rewrite enforces, which it previously
disagreed with, so a 50k paste roasted fine and then the $9 button rejected it with a browser alert.

### 3. The job description reaches the thing you pay for — `1895d0b5`

The help text under the box, on the same screen as the buy button, says the posting shapes *"the
score, the keyword gap and the rewrite."* It shaped the free score only. Customers paid $9 for a
rewrite that had never seen the posting.

Found while fixing it: the 30-day PII scrub is **not** in `composer.js` — it was two inline lines in
the runner, so storing the posting without touching that would have left it in blob storage forever.
The field list is now one function next to the pass that schedules it.

### 4. Analytics that would have killed a working channel — `203f42b8`

A pre-committed gate reads this funnel on **2026-09-07** and switches a channel off if the numbers are
low. Four ways it was under-reporting:

- The **only** purchase signal was emitted as product `pixelagents` with **no userId** — and
  `computeFunnels` counts distinct userIds and drops events without one, so sales read as zero.
- `page_view` was one step but **three pages** init as `resumeroast`, so step 1 read 3x high and every
  step below looked like a collapse that never happened.
- The Hub dashboard **could never render `resumeroast` at all** — it derives products from path
  prefixes and `/resume-roast` was missing, so it returned `other` and was discarded. Hard zero on
  every tab, permanently.
- `paid → delivered` had **no telemetry at all**, so a broken delivery and an unopened one looked
  identical.

Also: the gate's own documented query spelling (`metric=funnel`, singular) would have 400'd on the one
day it is read.

### 5. Spend monitoring — `c044541c`

Nothing watched the meter. And the Gemini fallback makes credit exhaustion *quieter*, not louder — the
product keeps answering on the backup model and nobody finds out. So the fallback log is the primary
alarm: `reason=credits` fires while everything still looks fine from outside.

Four conditions, edge-triggered with a 12h cooldown: chain exhausted, credit fallback, runway (<10d
warn, <3d critical), burn spike (3x weekly average with a $5/day floor).

**Measured against production while building it:** $11.55 over 7 days, $1.65/day, 56 days of runway —
and AmbientScore is $11.36 of that. `pixel-agent-run` is 4 calls and $0.065. At 1,000 roasts/day the
burn is ~$20-27/day and the current balance is gone in under four days.

`GET /api/llm-spend` is **secret-gated**, unlike most reads here: remaining balance plus per-caller
burn tells an anonymous caller exactly what it costs to take the product down.

### 6. Conversion blockers — `187ae53f`

Measured at 390×844:

| | before | after |
|---|---|---|
| $9 button position | y≈1602 (of an 1838px result) | **y=571** |
| resume input font | 15.2px → iOS force-zoom | **16px** |
| result after render | y=-49 (score off-screen) | **y=56**, score at y=211 |
| run button height | 38.9px | **44px** |

The button moved directly under the score, with **6 roast cards still below it** — deliberate, since
the full free roast is the differentiator against competitors who tease a score and charge for the rest.

Cancelling Stripe checkout returned to a blank page: resume gone, roast gone, and one of five daily
free runs burnt to get back. Now stashed before redirect and restored on return.

One flaky config fetch used to disable the $9 button for the life of the page, cached as
`{enabled:false}` — indistinguishable from the kill switch being off, with no `rewrite_upsell_view` to
say otherwise.

The anonymous rate-limit message said *"You've used all 5 free runs for today"* — but that bucket is
keyed on an **IP hash**, so on carrier CGNAT, office NAT or cafe wifi it fires on someone's **first
visit**. Mobile and social traffic is the most NAT-shared there is.

### 7. Canonical hostname — `c0f42c70`

The site answers on **both** `ambientpixels.ai` and `www.ambientpixels.ai`, 200 each, identical bytes,
**no redirect**. The signals disagreed: sitemap (49 URLs), robots.txt and the homepage canonical all
say www; the entire roast funnel and the share endpoint said non-www. Google's crawl entry point was
sent to the www copy, which then declared the non-www copy canonical.

Funnel aligned to www. Also declared the $9 offer in the `WebApplication` schema, which previously
described a product that charges for nothing.

---

## ⚠️ Needs a decision from you

**1. The site-wide canonical split.** 30 pages still carry non-www canonicals against a www sitemap,
and nothing 301s one host to the other. Two parts:
- The canonicals are a mechanical find-and-replace across 30 files.
- The **301 belongs in `staticwebapp.config.json` or DNS**, which this repo treats as do-not-touch —
  and SWA route rules match paths, not hosts, so this may need a DNS/Front Door change.

Until one host 301s to the other, duplicate content persists no matter what the tags say. This
suppresses every page on the site, not just the roast.

**2. Anthropic balance is $93 with 56 days of runway** at current (near-zero) traffic. That number is
manual — you type it on the Costs page and it only stays true until spend moves. If a channel lands,
top it up first; the monitor will warn at 10 days but that is a short fuse at volume.

---

## Programmatic SEO — the honest answer

I checked Google's actual spam policy rather than relying on folklore. The test is stated plainly:

> "Scaled content abuse is when many pages are generated for the primary purpose of manipulating
> search rankings and not helping users... typically focused on creating large amounts of unoriginal
> content that provides little to no value to users, **no matter how it's created**."
> — [Google Search spam policies](https://developers.google.com/search/docs/essentials/spam-policies)

So the constraint is **user value, not production method**. AI generation is not itself the problem.

**Which means the question is: what could our pages contain that nobody else's could?**

The honest inventory:
- We have a real ATS scoring engine and real keyword-gap extraction.
- We have **12 lifetime runs**, so there is no aggregate data to mine. The "pages powered by our own
  run data" idea is genuinely good and genuinely **not buildable yet** — it needs volume first.
- We do **not** have a job-posting corpus, and building a scraper for one is a legal/ToS question, not
  a technical one.

Generating a thousand "ATS keywords for {job title}" pages from a model's general knowledge is exactly
the "unoriginal content, little value" the policy describes. I did not build it, and I would advise
against it — it risks the whole domain, and the domain is also what AmbientScore, CardForge,
StoryForge and Blindspot rank on.

**What I would build instead, in order:**
1. **Comparison pages** (5-9, not thousands). High commercial intent, genuinely differentiated, and our
   claim is unusual and verifiable: they sell advice, we return the artifact. Small enough that no
   scaled-content risk applies. Every competitor claim must stay traceable to their own copy.
   **I started building these and stopped — see below.**
2. **A per-job-title page only once the tool is the value** — the page pre-fills job-description
   targeting and runs the real product. The utility is the content. Still worth waiting until there is
   run data to make each one non-thin.
3. Fix the canonical split first. There is no point ranking pages on a domain that splits its own
   signals.

### 🔴 The competitive table is stale — re-verify before quoting it anywhere

I went to build the comparison pages and re-checked each competitor against their own live site first.
Two of the four rows did not survive, so the pages were **not** shipped: publishing them would have
meant asserting things I cannot substantiate, and every competitor claim is supposed to be traceable
to their own copy.

| | prior handoff said | verified 2026-08-07 |
|---|---|---|
| RoastTheResume | score + one sentence; $9 once; "a report" | **Holds.** Free is *"Instant AI score and one brutal sentence about your biggest problem."* Paid is *"$9 one-time"* for *"Every issue, every fix, ATS analysis, bullet rewrites — instantly."* |
| RoastCV | Burn/Reality/Fix/ATS; **$7 per MONTH** | **DEAD.** `roastcv.com` 307-redirects to a GoDaddy "for sale" parking page. The one competitor described as running our exact model no longer exists. |
| Resumly | *"not a completed deliverable"* | **UNVERIFIABLE.** The cited URL 404s and the wording does not surface in search. Do not repeat this quote until someone finds it live. |
| us | the entire roast; $9 once; the finished document | Holds — `composeRewrite()` returns every section, validated, served as .md/.txt. |

Note the nuance the re-check surfaced: RoastTheResume *does* advertise **"bullet rewrites"**. Our
difference is real but narrower than "advice vs artifact" — it is *rewritten bullets inside a report*
versus *the complete rewritten resume as a document you can send*. Any comparison page has to say it
that precisely or it is overclaiming.

**Recommendation:** one comparison page against RoastTheResume is defensible today on verified copy.
Anything broader needs a fresh competitor sweep first — this category churns fast enough that a
four-competitor table went stale in about a day.

**Not researched, because the agents doing it were lost to a session limit:** AI-tool directories,
Product Hunt / Show HN specifics, non-Reddit communities, institutional channels, real CPC data and
affiliate viability. These are still open and still worth doing — treat the earlier brief as the spec.

---

## Test suites (all green)

```
_lib/llm/llm.test.js                    27      pixel-agent-run/smoke-test.js         33
_lib/llm/spendMonitor.test.js           20      _lib/roastRewrite/composer.test.js    33
_utils/runScore.test.js                 27      productAnalyticsQuery/…funnel.test.js 10
pixel-agent-share/share-og.test.js       9      pixel-agent-share-card/…test.js        8
```
Plus browser harnesses in the session scratchpad: retry/recovery 17/17, JD payload 5/5, mobile 12/12.

---

## Gotchas worth carrying forward

- **`require('satori')` is not callable.** 0.10.x is an ESM-interop build exporting `{default, init}`.
  Anything wrapped in a try/catch that reports a generic 500 can hide this for months.
- **Anthropic reports credit exhaustion as a 400**, not a 402, and only the message body says so.
- **`context.log` has no `.log`.** It is callable with `.error`/`.warn`/`.info`. `context.log['log']`
  throws — caught only because the monitor's own test drove the real handler.
- **A tool result cannot tell you whether a permission prompt fired.** Auto-allowed and user-approved
  look identical from the assistant side.
- **`WebFetch` needs `WebFetch(domain:*)`** — a bare `WebFetch` allow rule does not match, and
  permission rules only load at session start. See `memory/project_webfetch_permission_rule.md`.
- Do not measure `resumeroast` across 2026-08-07 — analytics split date, and now a second one
  (server-side purchase retag) lands the same day.

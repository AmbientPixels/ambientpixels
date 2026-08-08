# Resume Roast — Distribution Kit

---

## ⚠️ PORTFOLIO CONSTRAINT — launch slots are shared, and mostly already spent

**Found 2026-08-07 by the CEO, and it invalidates part of the ranking below.** Five products live on
one root domain, and the launch surfaces are gated per-domain or per-queue. So every slot spent on one
product is denied to the other four. This is not a Resume Roast question, it is a portfolio question.

| Surface | The gate | Status |
|---|---|---|
| **Product Hunt** | *"Products that share the same root domain must adhere to a six-month submission gap."* | Launching Resume Roast costs AmbientScore, CardForge, StoryForge and Blindspot their slot for six months |
| **Uneed** | Free tier is *"Join the line"* — next available slot | **AmbientScore is already queued, launching in ~110 days.** Resume Roast on the free tier lands behind it |

**Uneed pricing, verified against their own pricing page 2026-08-07:** free = join the line;
**"Fast-track" $14.99** (~2 weeks out); **"Skip the line" $29.99** (choose the date); relaunch $15;
Uneed Pro $99/year. All tiers give a do-follow backlink from a 75DR site.

So Uneed is **not** the ~30-minute free win it is ranked as below. It is either a four-month wait or a
spend decision, and the near-term slot is already AmbientScore’s.

**The real question this raises:** with a shared domain and five products, which product deserves the
one Product Hunt slot and the one near-term Uneed slot? Resume Roast is the newest and the most
saturated category (17 resume tools on Show HN this year, none above 5 points). AmbientScore already
holds the Uneed slot. That ordering may already be the right one.

> 🔒 **DO NOT COMMIT THIS FILE AS-IS — it will be publicly readable the moment it deploys.**
> Verified 2026-08-07: markdown under `docs/superpowers/` is served as **raw public content**, e.g.
> `https://www.ambientpixels.ai/docs/superpowers/handoffs/2026-08-07-resume-roast-traffic-readiness.md`
> returns 200 with its actual text. `robots.txt` disallows only `/docs/published/`, **not**
> `/docs/superpowers/`. This file currently 404s to the SPA fallback because it is uncommitted — that
> changes the moment it is committed, **and this repo auto-commits and pushes.**
> It contains the Anthropic balance and burn rate, the pre-committed kill-gate date, and a competitive
> assessment naming live competitors. Either move it outside the repo, add
> `Disallow: /docs/superpowers/` to robots.txt first, or accept that it is a public document.

**Researched 2026-08-07. Nothing here has been executed.** No account was created, nothing was
submitted, nothing was posted, no money was spent. Every row below is a decision waiting on you.

**Product:** https://www.ambientpixels.ai/resume-roast/
**Closes the open item** from `docs/superpowers/handoffs/2026-08-07-resume-roast-traffic-readiness.md`
("Not researched, because the agents doing it were lost to a session limit: AI-tool directories,
Product Hunt / Show HN specifics, non-Reddit communities").

---

## The 5 highest-value actions

Ranked by expected value per unit of your time, not by list position.

| # | Action | Cost | Time | Why it ranks here |
|---|---|---|---|---|
| 1 | **Clear the pre-flight blockers** — top up Anthropic, decide the PH domain question, accept that the HN post must be hand-typed | $0 + a top-up | ~30 min | Every row below is unsafe, wasted, or actively harmful until these are settled |
| 2 | **SaaSHub + PitchWall** (Uneed now blocked — see portfolio constraint above) — §1.1 A/B/C | **$0** | ~30 min total | Three genuinely free listings, two with do-follow backlinks. **Uneed has a free tier — the July "payment required" note was wrong.** Lowest effort per unit of value on the page |
| 3 | **Show HN** — brief in §2.1 | **$0** | 1 h (must be **hand-written**) | Our no-signup model is literally what the Show HN guidelines ask for. But measured base rate for this category is **2-5 points**. Do it because it is cheap, not because it will work |
| 4 | **Indie Hackers** — post written, §2.3 | **$0** | 30 min | Verified alive. The one surface where being in a saturated category is *material for the post* rather than a handicap |
| 5 | **Product Hunt** — post written, §2.2 | $0 | 2-3 h | Free, but needs 2 gallery images at 1270×760 that do not exist, **and burns the PH slot for every ambientpixels.ai product for six months.** Approve the trade deliberately |

**Total cost if every PAID item were approved: $697** (TAAFT $49 + TopAI.tools $47 + Toolify $99 +
Futurepedia $497 + AlternativeTo $5), excluding TAAFT's $347 tier and BetaList's undisclosed fee.
**Recommendation: approve $0 of it.** The arithmetic is in §1.2 — the only vendor publishing a click
estimate offers 50-100 first-week clicks for $49, which at a $9 price and a generous 3% conversion is
~$27 of revenue against a $49 fee.

**What to skip outright, with reasons in §1.3:** AlternativeTo (their FAQ names "resume/CV builders,
ATS resume checkers" in the decline list), G2 and Capterra (B2C is ineligible — you were right),
Futurepedia (no free tier, $497), BetaList (paid-only, price not published), Lobsters (invite-only and
off-topic), aitoolhunt.com (dead, 404), AI Scout (origin down since 2026-07-31).

---

## ⚠️ Pre-flight blockers — read before approving anything

**1. The Anthropic balance will not survive a successful launch.**
Measured today (`docs/superpowers/handoffs/2026-08-07-resume-roast-traffic-readiness.md`):
the balance is small and the burn at near-zero traffic is a rounding error, so the runway looks comfortable. But at
**1,000 roasts/day the burn rises roughly twentyfold and the balance is gone within days.** A front-page
day anywhere would do that. There is a Gemini fallback, and it makes the failure *quieter* rather than
louder — the product keeps answering on the backup model and nobody finds out.
→ **Top up before any launch, and watch `reason=credits` in the fallback log.**

**2. Both hostnames serve the product with no redirect.** Verified today:

```
https://ambientpixels.ai/resume-roast/      → 200
https://www.ambientpixels.ai/resume-roast/  → 200   (no 301 either way)
```

The sitemap lists the **www** URL. Directory listings are permanent backlinks, so submitting the wrong
host splits link equity forever and it cannot be cleaned up later.
→ **Every submission in this document uses `https://www.ambientpixels.ai/resume-roast/`. Use the www
form everywhere, without exception.**

**3. 🚨 Product Hunt locks your ENTIRE DOMAIN for six months.** From
https://help.producthunt.com/en/articles/484934-can-i-relaunch-my-product:

> "wait at least **six months** between posts for the same product **or from the same company**"
> "**Products that share the same root domain must adhere to a six-month submission gap.**"

Resume Roast lives on `ambientpixels.ai` — the same root domain as AmbientScore, Pixel Agents,
CardForge, StoryForge and Blindspot. So: **(a)** if anything on that domain launched on PH in the last
six months, Resume Roast is blocked right now, and **(b)** launching Resume Roast burns the PH slot for
every other product you own until roughly February 2027.
→ **Decide deliberately whether a $9 resume tool is what you want to spend the one domain-wide PH
launch on.** A search of PH found no prior ambientpixels launch, but a negative search is not proof —
check the PH dashboard before committing.

**4. 🚨 The Show HN post below cannot be copy-pasted.** HN's guidelines now state, verbatim
(https://news.ycombinator.com/newsguidelines.html):

> "**Don't post generated text or AI-edited text. HN is for conversation between humans.**"

And dang's official Show HN tips post, **edited 2026-03-28** (https://news.ycombinator.com/item?id=22336638):

> "**Write your text by hand. Don't use an LLM to generate any of it (not even a tiny bit, including to
> edit or spruce it up).** Reason: the community is super fussy about this right now, and LLM language
> leaves imprints on your text which are generating quite some backlash when it appears on HN itself.
> **This is a big dividing line at present!**"

→ **The Show HN draft in §2.1 is a structural brief, not paste-ready copy.** It shows which facts to
include, in what order, and what to disclose. You must retype it in your own voice. A model-written
Show HN post for a model-powered product is the single worst combination available on that surface
right now. This constraint does **not** apply to Product Hunt, directories or communities — everything
else in this document is genuinely paste-ready.

**5. The assets most submissions want do not exist yet.**

| Asset | Needed by | Have? |
|---|---|---|
| Square logo 240×240 | Product Hunt thumbnail | ✅ derive from `images/ambient-pixel-logo-rainbow.png` (1000×1000) |
| Square icon ~256×256 | most AI directories | ✅ same source |
| **2+ gallery images 1270×760** | **Product Hunt (required)** | ✅ **3 exist** — `resume-roast/launch/ph-gallery-{1-input,2-result,3-difference}.png`, screenshots of real output |
| 1200×630 OG card | social unfurls | ⚠️ exists but it is the **generic Pixel Agents card**, not Resume Roast (`pixel-agents/img/og-card.png`) |

Screenshots of the real roast output would cover the gallery requirement — the live page already shows
a full real output, so this is a screenshot job, not a design job.

---

## ⚠️ Competitive honesty — corrections to what we currently believe

I re-verified the competitive claim before writing any copy, because copy that overstates is worse
than no copy. Two of our working assumptions did not survive.

| Claim | Status as of 2026-08-07 |
|---|---|
| RoastTheResume: free = score + one brutal sentence; paid = $9 one-time for "Every issue, every fix, ATS analysis, bullet rewrites" | **Holds.** Verified against roasttheresume.com. They **do** advertise bullet rewrites. |
| "We give the whole roast free, no signup — nobody else does" | ❌ **FALSE.** At least three live competitors also give a full free analysis with no signup: [Resumly Resume Roast](https://www.resumly.ai/resume-roast) ("no signup or credit card required", includes concrete rewrites and a shareable card), [KudosWall](https://pro.kudoswall.com/resume-analyzer/) ("ATS score out of 100 in seconds, 100% free, no signup"), [NodeFlair](https://nodeflair.com/resume-checker). **Do not claim this is unique.** |
| "$9 for the finished document is the cheapest way to get a rewritten resume" | ⚠️ **Probably false.** [roast-my-resume.com](https://www.roast-my-resume.com/) appears to sell an "AI Resume Boost" tier at **$5** including "AI-powered rewrite" and "Download ready resume". Read off their live site today, but via automated extraction — **eyeball it yourself before putting any price comparison in public copy.** |

**What survives and is safe to say:** the entire roast is free with no signup or email; the job posting
shapes the score, the keyword gap *and* the paid rewrite; the $9 returns a complete rewritten resume as
a downloadable .md/.txt; and it will not invent numbers for you. That last one is the most genuinely
differentiating sentence we have and it is barely used.

**All copy in this document is descriptive, not comparative,** on purpose. Every comparative claim I
tested was either false or fragile, and this category churns fast enough that a four-competitor table
went stale in about a day.

---

## §1 — AI tool directories

Every price below came from the directory's own submit or pricing page, fetched 2026-08-07. Where a
page was behind a login or a Cloudflare check, it is marked **UNVERIFIED** with what was tried. No
account was created anywhere.

**The headline: there is no longer a free path into any of the big AI directories.** TAAFT, Futurepedia,
Toolify and TopAI.tools are all pay-to-list in 2026. Futurepedia says so outright
(https://www.futurepedia.io/submit-tool):

> "**We are no longer offering free submissions.** It's very important to us to maintain the quality of
> our directory and it became unmanageable to do so."

So the free plan is the launch platforms, not the AI directories. That is the opposite of what the
2026-07-03 AmbientScore listing pack assumed — **that document is now out of date and should not be
reused.** It listed TAAFT, Toolify and Futurepedia under "free tools / AI directories (submit to all —
each is free)". None of those three is free anymore.

### 1.1 FREE — approve individually

---

#### ☐ A. SaaSHub — **DO THIS FIRST** (5 minutes, genuinely free, no catch)

**Submit:** https://www.saashub.com/services/submit
**STATUS: ✅ SUBMITTED by the CEO, 2026-08-07.** · **Cost: $0** · **Effort: 5 min**

Their accept/reject rules, verbatim (same page): accepted are *"SaaS, IaaS & PaaS products and services.
Most software products and apps."* Rejected are *"Software development agencies. Landing pages with an
email form for a waiting list. Products that are not released yet … Products using free subdomains …
Products that are not in English."* **Resume Roast passes every one of these.** They even have a
`📄 Resume Builder` category.

The form is essentially one field — the website URL — then categories and competitors. Two rules worth
obeying, both verbatim: *"The submission will be slowed down and put to the bottom of the queue if there
are not listed competitors"* and *"Verifying your product will give it a higher priority. You will need
an email address on the product's domain."*

| Field | Paste this |
|---|---|
| Website URL | `https://www.ambientpixels.ai/resume-roast/` |
| Name | `Resume Roast` |
| Categories | `Resume Builder`, `Career`, `AI Tools` |
| Competitors (**required for queue priority**) | `Resumly`, `Enhancv`, `Kickresume`, `Resume Worded`, `FlowCV` |
| Short description (140) | Copy library `Desc 140` |
| Long description | Copy library long block |
| Pricing | Freemium — free roast, $9 one-time rewrite |

Approval: *"all submitted products go through an approval process"* — no timeframe published.
Traffic: **UNVERIFIED.** They publish *"236,067 products and growing"* and *"Join 28,200+ subscribed
experts"* but no visitor figure, and no third-party data was found.

---

#### ☐ B. Uneed — **the July decision was based on a wrong premise; re-decide**

**Submit:** https://www.uneed.best/submit-a-tool · **Cost: $0 for the free queue** · **Effort: 10 min**

⚠️ **You skipped Uneed in July 2026 with the note "Payment required - skipped until we can generate some
revenue." That premise is wrong.** From their own pricing page, verbatim:

> "Yes, **launching on Uneed is completely free.** You submit your product and join the waiting line at
> no cost, and you'll get an automatic launch date. If you want to choose your exact launch date, you
> can skip the waiting line for **$29.99**."

Paying only buys you a *date*. The launch itself is free. Other tiers: Fast-track $14.99, Relaunch $15,
Uneed Pro $99/yr.

Lowest-friction form anywhere in this document — it starts with just name + URL: *"Let our robots do the
work and gather all your product's data for you 🤩"* and *"No account needed to start — we'll scrape
your page first, then ask you to sign up to save it."*

| Field | Paste this |
|---|---|
| Name | `Resume Roast` |
| URL | `https://www.ambientpixels.ai/resume-roast/` |
| Tagline | `Get your resume roasted before a recruiter does it for you` (58) |
| Short description | Copy library `Desc 160` |
| Long description | Copy library long block |
| Category | `Career` / `Productivity` / `AI` |
| Pricing | Freemium |

Their self-reported traffic (primary source, their own pages, **not third-party audited**): *"661,402
Visits"* and *"2,120,112 Page views"* for 2026 on the homepage; *"90K monthly visitors"* on pricing;
*"19,000+ subscribers"*; *"do-follow backlink from a 75DR website."* Products are delisted only if
*"your total vote score is below 10."*

---

#### ☐ C. PitchWall (this is what "BetaPage" became) — free tier, 30-day wait

**Submit:** https://pitchwall.co/submit · **Cost: $0** · **Effort: 15 min**
Note: `betapage.co` now **301-redirects here**. Any list still naming BetaPage means this.

Free tier, verbatim: *"1-day homepage visibility / **Minimum 30-day waiting period** / Do-follow backlink
(DR 70) / Newsletter mention (50,000+ subscribers), not guaranteed / Tweet from Pitchwall's X account
(10,000+ followers)"*. Paid: Pro $49, Premium $99 (both shorten the wait).

Alive — newest products dated *"20 hours ago"*, footer reads *"PitchWall © 2026"*.
Self-reported: *"500,000+ Monthly Visitors"*, *"70 DR Ahrefs Domain Rating"*, *"65,000+ Products
Published Since 2015."* **Form fields are behind signup — UNVERIFIED.** Use the copy library.

**Verdict:** free, and a DR70 do-follow link is worth 15 minutes even if the traffic never materialises.
The 30-day wait costs nothing but patience.

---

#### ☐ D. Peerlist Launchpad — good audience fit, needs a verified personal profile

**Submit:** https://peerlist.io/launchpad · **Cost: $0** · **Effort: ~45 min (profile verification)**

Currently live — canonical URL `/launchpad/2026/week/32` resolves to *"Aug 3 - Aug 9"*, footer reads
*"© 2026 Peerlist, Inc."*

⚠️ **Do not read the "Become the first project to launch this week!" banner as low competition.** Weeks
25, 30, 31 and 32 all return a **byte-identical 48,065-byte static shell** — that string is a build-time
placeholder, not live data. Actual launch volume for the week is **UNVERIFIED**. (This is the same
false-positive class as the AmbientScore JS-counter bug: a scraper without a JS runtime reads the
initial state, not the value.)

Rules, verbatim (https://help.peerlist.io/individual/launchpad/introduction):
> "You must have a **Verified Peerlist Profile** to be able to launch a project"
> "Only projects that are **100% complete** are eligible"
> "**Launch as an individual:** Only individual profiles are allowed to launch projects … it should not represent a company."

Launches open Mondays and run a week; the first 2 days are ranked randomly *"to give equal exposure."*
Backlink: *"No, only the top 5 projects of the week are awarded a backlink."* Zero tolerance on DMing
for upvotes.

Fields: product name, tagline, cover image, demo link. No published character limits — use `Tagline 60`
and the long block.

**Why it ranks:** the audience is developers, designers and founders — people who write résumés, on a
platform *about* professional profiles. Better intent match than any generic AI directory here.

---

#### ☐ E. Fazier — free **only if you will carry their badge**

**Submit:** https://fazier.com/submit · **Cost: $0 with a badge, $29–$149 without** · **Effort: 15 min**

Free tier, verbatim: *"Reviewed & listed within 30 days / Featured on homepage (if selected) / **A
backlink to our site is required (on your homepage or footer)**"* — the button literally reads *"Submit
Free with embed badge."* Paid tiers (Lite $29, Premium $49, Super $149) state *"No backlink required."*

**This is the only decision here:** are you willing to put a Fazier badge in the site footer or on the
Resume Roast page? If no, this becomes a SKIP — there is no other free route. Traffic: **UNVERIFIED**,
they publish no visitor number.

---

#### ☐ F. Insidr.ai — marginal, 5 minutes if you are already in the flow

**Submit:** https://www.insidr.ai/submit-tools/ · **Cost: $0** · **Effort: 5 min**

Small: *"Browse 500+ AI tools in 78+ categories."* It is a contact form, not a listing engine — fields
are Name, Email, Message plus placeholders for the tool link, category and a short description. One
field is telling: *"Link to the AI tool (**Please put link to affiliate signup if possible**)."* Resume
Roast has no affiliate program, so expect low priority. Traffic **UNVERIFIED** — no claim anywhere on
the site. **Do it only if you are batching.**

---

#### ☐ G. AIToolHunt**.co** — marginal, badge required

**Pricing/submit:** https://aitoolhunt.co/pricing · **Cost: $0 with badge** · **Effort: 10 min**
Free tier: *"Reviewed & listed within 30 days"*, *"DR 37+ · 3 dofollow backlinks"*, requires *"Add the
AIToolHunt badge/link to your homepage."* Paid: $9.90 / $19 / $39.

⚠️ **This is a different domain from the `aitoolhunt.com` on the original candidate list, which is dead
(404).** No ownership relationship could be established between them. DR 37 is low.
**Only worth it if you have already accepted the Fazier badge and a second one is free.**

---

#### ☐ H. Startup Stash — **recommend SKIP**

**Submit:** https://startupstash.com/add-listing/ (a Typeform) · **Cost: UNVERIFIED**

Two blockers. Verbatim gate: *"**Sorry, we only accept work/business emails**"* — a gmail address is
rejected outright. And the form asks *"Available budget for this upcoming campaign?"* with bands from
"Less than $3,000" to "$20,000+", ending in *"Thank you for applying to get listed."* That is an ad-sales
qualification funnel wearing a directory costume. The category list is startup-ops tooling (Analytics,
CRM, Cap Table, Hosting, Raising Capital) with **no résumé, HR or careers category**. Wrong audience,
opaque cost. **Skip.**

### 1.2 PAID — recommend approving NONE of them

Every price verified from the vendor's own page on 2026-08-07.

| Directory | Price | What you get | Approval | Verdict |
|---|---|---|---|---|
| **There's An AI For That** | **$49** one-time review fee<br>**$347** "maximum exposure" | $49: *"50 - 100 estimated clicks (first week)"*, permanent listing. $347: *"700 - 10,000+ estimated clicks"* + guaranteed newsletter feature | *"1-2 days"* | **MARGINAL at $49 / SKIP at $347** |
| **TopAI.tools** | **$47** fast track<br>**$229** featured 7d | Live in 24-48h, no queue, permanent listing | 24-48 h | **MARGINAL** |
| **Toolify** | **$99** one-time | Listed within 48h, *"no less than 6 quality dofollow links"* | 48 h | **SKIP** |
| **Futurepedia** | **$247** (Sold Out)<br>**$497** verified | Published in 2-7 days, enhanced page | 2-7 days | **SKIP** |
| **AlternativeTo** priority | **$5** | Reviewed in 1-2 business days | 1-2 days | **SKIP — see below, our category is banned outright** |
| **Dang.ai** | **UNVERIFIED** | Pricing redirects to `/login?next=%2Fpricing`; could not view without creating an account | Unknown | **SKIP** |

**Total if every paid item above were approved: $49 + $47 + $99 + $497 + $5 = $697** (excluding TAAFT's
$347 tier and Dang.ai's unknown price). **The recommendation is to approve $0 of it.**

**Here is the arithmetic that kills all of them.** TAAFT is the only one publishing a click estimate,
and it is their own optimistic number: $49 buys *"50 - 100 estimated clicks (first week)."* At a $9
product and a generous 3% conversion, 100 clicks is **~$27 of revenue against a $49 fee**. Every other
paid tier needs between 5 and 56 conversions at $9 just to break even — in a category Product Hunt shows
as 197 products deep. Your standing rule from July ("payment required — skipped until we can generate
some revenue") is the correct call and nothing in this research changes it.

**One free lottery worth knowing about:** TAAFT states *"We run a thread on X once a month where indie
makers can submit their tool for free. We choose one tool from each thread and list it for free."*
Free, long odds, costs one reply.

**Brand-adjacency warning on Dang.ai:** their homepage runs a prominent NSFW AI shelf (nudify-type
tools). Putting a professional résumé product next to that is a risk independent of price.

### 1.3 DEAD, BROKEN, or DISQUALIFIED — do not spend time here

| Site | Status | Evidence |
|---|---|---|
| **AlternativeTo** | ⛔ **BANS OUR EXACT CATEGORY** | https://alternativeto.net/faq/ — *"In general we do not approve apps from … **resume/CV builders, ATS resume checkers**, invoice generators … **basic AI tools** … **AI wrappers for LLMs**"*. We are named twice. Paying the $5 priority fee does not change a category ban. |
| **G2** | ⛔ Disqualified | *"G2 does not accept business-to-consumer (B2C) products or products that are currently in the alpha or beta stage of development."* (https://documentation.g2.com/help/docs/finding-or-listing-a-product-on-g2). A $9 consumer résumé tool is textbook B2C. |
| **Capterra** | ⛔ Disqualified | Their own `/legal/product-listing-guidelines/` **404s**. Secondary sources (flagged as secondary) state they list prepackaged B2B software only, consistent with G2's stated policy. **You were right to suspect these two are not worth it — they are not merely low-value, they are ineligible.** |
| **aitoolhunt.com** | ☠️ **DEAD** | Root returns `HTTP 404` with a LiteSpeed default error page. Every path tested 404s. |
| **aiscout.net** | ☠️ **DOWN** | `HTTP 520` (www: 522), origin unavailable. Cached error page `last-modified: Fri, 31 Jul 2026` — down at least a week. |
| **betapage.co** | ↪️ Moved | `301` → pitchwall.co. Use PitchWall (§1.1 C). |
| **SideProjectors** | ↪️ Wrong tool | Alive, but it is *"a marketplace where developers can sell, buy, and showcase side projects"* — for **selling** Resume Roast, not distributing it. |

**On every traffic number in §1:** all of them are the directory's own self-reported marketing claims
from their own pages, labelled as such. **No independent Similarweb-style data or third-party case study
was found for any directory here, and none has been guessed at.** TAAFT's live counters are
JS-rendered and return nothing in the served HTML — the same class of trap that produced four wrong
AmbientScore findings in July: a scraper reading an animated counter sees its initial state, not its
value.

---

## §2 — Launch surfaces

### 2.1 Show HN — APPROVE (free, ~1 hour, low expected return, worth it anyway)

**URL:** https://news.ycombinator.com/submit (title must begin `Show HN:`)
**Cost:** $0 · **Effort:** ~1 h, because it must be **hand-written** · **Verdict: DO IT — but calibrate
expectations to ~3 points.**

#### The rules, verbatim

From https://news.ycombinator.com/showhn.html:

> "Show HN is for something you've made that other people can play with. HN users can try it out, give
> you feedback, and ask questions in the thread."

> "**The project should be non-trivial. Don't post quickly-generated one-offs; anybody can do that now.
> Share something that is deeply personal and interesting to you. Explain how and why.**"

> "**Please make it easy for users to try your thing out, ideally without barriers such as signups or
> emails. You'll get more feedback that way.**"

> "Off topic: blog posts, sign-up pages, newsletters, lists, and other reading material. Those can't be
> tried out, so can't be Show HNs."

> "Please don't ask friends to upvote or comment. That's not ok on HN."

From https://news.ycombinator.com/newsguidelines.html:

> "Please don't use HN primarily for promotion. It's ok to post your own stuff part of the time, but the
> primary use of the site should be for curiosity."

> "Don't solicit upvotes, comments, or submissions. Users should vote and comment when they run across
> something they personally find interesting—not for promotion."

> "Please don't do things to make titles stand out, like using uppercase or exclamation points, or
> saying how great an article is."

> "Please don't delete and repost."

**Read those two bolded clauses together.** The "no signups or emails" line is the single best fit
Resume Roast has anywhere in this document — the guidelines explicitly ask for the thing we built.
The "quickly-generated one-offs" line is the single biggest risk — it was written for exactly this
genre, and an AI resume roaster is presumptively one of them unless the post says otherwise.

**Freemium is allowed.** Nothing in either page bans a paid tier. The off-topic list is about things
that can't be *run*, and ours can be. Disclosing the $9 upfront is the norm and HN punishes the
omission far more than the price.

**Account caution — two hard rules.** "The primary use of the site should be for curiosity" means a
fresh account whose only submission is its own product reads as promotional. And from dang's tips post:

> "**Don't have your username be that of your company or project.** It creates a feeling of using HN
> for promotion and of not really participating as a person. You don't have to use your real name, just
> something to indicate that you're here as a human, not a brand."

→ Do **not** post from an `ambientpixels` account.

**The rest of dang's official tips** (https://news.ycombinator.com/item?id=22336638, edited 2026-03-28
— this is the page the Show HN guidelines link to under the word "tips", and it is the most useful
document on this surface):

> "Include text giving the backstory of how you came to work on this, and explaining what's different
> about it. That tends to seed discussion in a good direction."

> "**Include a clear statement of what your project is or does. If you don't, the discussion will
> consist of 'I can't tell what this is'.**"

> "**Drop any language that sounds like marketing or sales. On HN, that is an instant turnoff. Use
> factual, direct language. Personal stories and technical details are great.**"

> "**Make sure your friends and users do not add booster comments in the thread.** HN users are adept at
> picking up on those, they consider it spamming, and they will flame you for it."

> "If you're comfortable doing so, put your email address in your profile so we can contact you if we
> notice anything, and also so we can send you a repost invite. We do that sometimes."

**Volume context, measured 2026-08-07:** ~30 Show HN submissions landed in a 6h09m window on
`/shownew` — roughly **4.9/hour, ~117/day**. That is your competition for attention.

#### What the outcome data actually says

I measured this rather than guessed, via the HN Algolia API (`hn.algolia.com/api/v1/search`, retrieved
2026-08-07). **Every AI resume/ATS tool posted to Show HN since 2025 landed between 2 and 5 points.
There were no exceptions across ~45 sampled posts.**

| Show HN post | Points | Date |
|---|---|---|
| Resume Yay: The Free AI Resume Builder that also finds you jobs | 5 | 2025-04 |
| Free Resume Builder with no signup or login | 5 | 2025-01 |
| One resume for one job description | 4 | 2026-06 |
| I built a brutally honest AI resume reviewer that roasts your clichés | **4** | 2025-02 |
| Built an AI for Roasting Resumes | **3** | 2024-09 |
| Free ATS Resume Checker | 3 | 2025-12 |
| Resume Tailor – Fit your resume to any job | 2 | 2026-07 |
| ResumeForge – Free AI resume builder with real-time ATS scoring | 2 | 2026-03 |

The AI-roast genre itself has decayed: "Get your website copy and design roasted" took **39 points in
June 2024** — the best AI-roast result I could find anywhere — and equivalent 2026 posts take 3-4.

And here is what *does* work for resumes on HN, for contrast:

| Show HN post | Points | Date |
|---|---|---|
| Open-source resume builder and parser | 656 | 2023 |
| My AI Native Resume | 301 | 2025-05 |
| Leet Resumes – a free technical resume-writing service | 147 | 2021 |
| Resume maker with no sign-up or subscription | 119 | 2021 |

The pattern is unmistakable: HN rewards **open source, developer-controlled artifacts, and personal
projects with a story**. It does not reward "an AI critiques your resume," and note that "Resume maker
with no sign-up or subscription" took 119 points in 2021 while "Free Resume Builder with no signup or
login" took 5 in 2025 — same pitch, 24× collapse. That gap is the AI-slop tax, and we will pay it.

**Saturation verdict for HN: HURTS, badly.** This is the surface where saturation costs the most,
because HN's stated bar is novelty ("non-trivial", "not quickly-generated one-offs") and the audience
has seen dozens of these.

**So why post at all?** It costs 15 minutes and $0, the guidelines genuinely favour our no-signup
model, and the downside is a post that quietly gets 3 points. Do it — just do not build a plan on it.

#### The post — ⚠️ a BRIEF you must retype, not copy

**Do not paste the body below into HN.** Per the guidelines and dang's tips quoted in the pre-flight
section, generated or LLM-edited text is against the rules and is currently the thing HN reacts to most
harshly. What follows shows **which facts to include, in what order, and what to disclose** — the
structure is the deliverable. Retype it in your own words, in your own voice, from your own memory of
building the thing. If a sentence below sounds better than something you would write, that is the
sentence to cut.

**Title** (69 chars; HN enforces an 80-char limit — widely documented, but the submit form is behind a
login so I could not verify that from a primary source):

```
Show HN: Resume Roast – the whole AI resume review is free, no signup
```

Alternates, all under 80:
- `Show HN: Resume Roast – paste a resume, get the whole roast, no signup` (70)
- `Show HN: A resume roaster that does not paywall the diagnosis` (61)

**URL:** `https://www.ambientpixels.ai/resume-roast/`

**Body** — post this as the first comment immediately after submitting:

```
I watched a friend send out forty applications with "results-oriented, detail-oriented" in
the summary line and not one number anywhere in the document. This is the tool I wanted to
hand him.

You paste resume text and get the whole thing back: an ATS score out of 100, a
section-by-section teardown, what's actually working, and the keywords you're missing.
No signup, no email, no file upload — 5 runs a day per IP, 10 if you sign in. If you paste
the job posting as well, the score and the keyword gap are computed against that specific
posting rather than in the abstract.

Being upfront about the money, since it'll come up: there's a $9 one-time upgrade that
returns the whole resume rewritten as a .md or .txt you can actually send. Nothing above
is behind it. I deliberately didn't paywall the diagnosis, which is the opposite of most
of these — but I should also say plainly that this category is crowded and at least one
competitor sells rewrites at a similar price. The difference is narrower than I'd like:
they put rewritten bullets inside a report, this hands back the finished document.

Two implementation notes, in case they're the more interesting part:

It runs on Claude with a Gemini fallback. The original version made one unconditional call
to one provider, which meant a 429 or an exhausted balance returned a 502 to every user of
every path simultaneously. Worth knowing if you're building on a single provider: Anthropic
reports credit exhaustion as a 400 whose message body is the only signal, so status codes
alone won't detect the case you most need to detect.

Input is capped at 20,000 characters. An uncapped free endpoint in front of a 200k context
window is a denial-of-wallet button, and I'd left it uncapped for longer than I'd like to
admit.

The one thing I refused to ship: it will not invent numbers for you. Where a metric is
missing, it marks the spot rather than filling it with a plausible-sounding figure, because
a resume full of confident fake numbers is worse than the vague one you started with.

I'd genuinely like to know where the scoring feels wrong. Paste something and tell me if
the number is fair.
```

**Why it is written this way:** the guidelines ask for "deeply personal", "explain how and why", and
non-trivial. So it opens with a person, not a value proposition; it discloses the price before anyone
has to ask; it concedes the competitive point instead of overclaiming; and it puts real engineering
detail in the middle, because that is the only part of this that HN has not already seen fifty times.
There is no marketing language in it anywhere — no "brutally honest", no "instantly", no exclamation
points. Do not add any.

**When to post:** see §2.5. The short version is that the evidence for timing is much weaker than the
folklore, and for a post likely to get 3 points it does not matter.

---

### 2.2 Product Hunt — APPROVE, but only after the gallery images exist

**URL:** https://www.producthunt.com/posts/new
**Cost:** $0 · **Effort:** 2-3 h (mostly asset prep) · **Verdict: DO IT, second, after Show HN.**

#### The rules, verbatim

From https://help.producthunt.com/en/articles/9883485-product-hunt-featuring-guidelines — the four
featuring criteria are **"Useful"**, **"Novel"**, **"High Craft"** and **"Creative"**, and products
*"don't need to score high in every category."*

Not featured: waitlisted products without immediate access; directories, templates, boilerplates,
podcasts, courses, reports, events, books and services; commerce and deal sites; Kickstarter projects
unless fully functional; hardware without a prominent digital component. Also disqualifying: vaporware,
and — the clause that matters to us —

> minimal offerings focused primarily on **"immediate monetization rather than providing long-term value"**

From https://help.producthunt.com/en/articles/479557-how-to-post-a-product:

> **Name:** "Only the product's name, no description or emojis (unless it is a part of the name)"
> **Description:** "This is where you can give more information about what the product is and/or does **within 260 characters**."
> **Topics:** "It's best to include only a few that most strongly relate to the product"
> **URL:** "Direct link to the product page (avoid links to press or blogs)"
> **Thumbnail:** "Best to use an image with square dimensions. **We recommend 240x240.**"
> **Gallery:** "Recommended size for images in the gallery is **1270x760**." — and it "requires **2+ images** before it is viewable."
> **Scheduling:** "The site operates on 24-hour periods in PST so your post will go live on the site at **12:01 AM PST**."

⚠️ **Tagline limit — partially verified.** The 60-character tagline cap is what PH's help content and
every secondary source state, but the primary article I fetched describes the tagline only as a "very
short description" without giving a number. **All taglines below are ≤59 characters**, so this does not
matter in practice — but do not quote "60" as gospel.

#### Honest read on our odds

The **"immediate monetization"** disqualifier actually *helps* us: the entire diagnosis is free with no
email capture, which is the opposite of the pattern that clause targets. Lead with that.

**"Novel" is where we lose.** Product Hunt's own resumes category page states **"Showing 1-15 of 197
products"** (https://www.producthunt.com/categories/resumes), and a search for "resume roast" already
returns an existing *Roasted Resume* listing. We are entry ~198 in a solved-looking category.

**Saturation verdict for PH: hurts, but survivably.** PH is a different audience from HN — it rewards
polish and clear positioning more than novelty, and "don't need to score high in every category" gives
room to win on Useful and High Craft. Expect a modest launch, not a category-topping one.

**Blocker CLEARED 2026-08-07:** three 1270×760 images now exist in `resume-roast/launch/`, screenshotted from the real product (input with a job description, the scored result with keyword gap and the $9 offer, and the differentiation table). The remaining PH decision is the six-month domain lock, not the assets.
Screenshots of the live roast output (the page already renders a complete real example) will do.

#### The post — copy exactly

**Name:** `Resume Roast`

**Tagline** — pick one (all ≤59):
```
Get your resume roasted before a recruiter does it for you        (58)
The whole resume roast, free. ATS score in about a minute.        (58)
A brutally honest resume review — all of it free, no signup       (59)
```

**Description** (256 chars, under the verified 260 cap):
```
Paste your resume and get the whole roast free — an ATS score out of 100, a section-by-section teardown, and the keywords you are missing. No signup, no email. Paste the job posting too and it scores against that role. $9 once returns the rewritten resume.
```

**Link:** `https://www.ambientpixels.ai/resume-roast/`
**Topics:** `Career` · `Artificial Intelligence` · `Productivity`
**Thumbnail:** 240×240 square, from `images/ambient-pixel-logo-rainbow.png` (1000×1000)
**Gallery:** ≥2 images at 1270×760 — ✅ three ready in `resume-roast/launch/`

**First comment — pin this immediately:**

```
Hi Product Hunt 👋

Most resume tools show you a score and then charge you to find out what's wrong with it.
Resume Roast does the opposite: the entire review is free and there is no signup, no email
and no file upload. You paste your resume as text and get back an ATS score out of 100, a
section-by-section teardown, an honest list of what is already working, and the exact
keywords you are missing. 5 roasts a day without an account, 10 signed in.

Paste the job posting alongside it and the score, the keyword gap and the rewrite all
target that specific role instead of resumes in general.

There is one paid thing and I'll name it upfront: $9, once, returns the complete rewritten
resume — every section rewritten to lead with achievements and to parse cleanly through an
ATS, plus what changed and why — as a finished .md or .txt you can send. Not a list of
suggestions to go apply yourself. No subscription, and if it isn't good you reply to the
receipt and we refund it.

The rule I care most about: it never invents numbers for you. Where a metric is missing it
marks the spot instead of filling it with a plausible-sounding figure, because a resume
full of confident fake numbers is worse than the vague one you started with.

I know this is a crowded category — there are nearly 200 resume tools on PH alone. The bet
here is simply that the diagnosis shouldn't be the thing you pay for.

Try it on your own resume and tell me if the score feels fair. If it feels wrong I'd
rather hear it here than not hear it.
```

**Do not ask anyone for upvotes.** PH community guidelines, verbatim
(https://help.producthunt.com/en/articles/3615694-community-guidelines):

> "**Mass messaging users, asking for upvotes, using bots, incentivizing upvotes, and any other form of
> artificially increasing activity on your contribution is not acceptable.**"
> "Self-promoting in comments will also be removed. Only genuine activity will be accepted on the site."

From their launch checklist: *"The only real rule here is that you cannot ask people directly to upvote
your product. Instead, ask them to visit and comment."*

**Three more verified operational details:**

- **You do not need a hunter.** PH's own checklist: *"We encourage makers to hunt their own products,
  and there's no discernible advantage to using a third-party hunter."* Anyone selling hunter access is
  selling something PH says has no advantage.
- **Launch from a personal account.** *"Company accounts are prohibited."*
- **Pricing tag:** PH offers `free`, `paid`, and **`paid (with a free trial or plan)`**. Use the third.
  Tagging a product with a $9 upsell as "free" is exactly what draws comment-section hostility.

⚠️ **Description limit conflict, reported rather than resolved.** The help article says *"within 260
characters"*; the launch guide at https://www.producthunt.com/launch/preparing-for-launch says *"max 500
characters"*. A third PH page stated no limit. **The 256-char description above works under either
number** — do not plan on 500.

---

### 2.3 Indie Hackers — APPROVE (free, verified alive, best fit after Show HN)

**URL:** https://www.indiehackers.com/ · **Cost: $0** · **Effort: 30 min** · **Verdict: DO IT.**

**Alive — verified 2026-08-07.** Front page carried posts timestamped 1, 4, 7 and 10 hours old, dated
August 2026, with live titles like *"Why vibe-coded apps are still leaking user data in 2026"*. Sections
in use: Starting Up, Case Studies DB, Products DB, Ideas DB, Partner Up, The Build Board.

⚠️ **Posting rules — UNVERIFIED.** indiehackers.com is a client-side SPA; `/about`, `/tos` and
`/group/launch` all returned a bare JS shell to curl and empty content to WebFetch. **No verbatim IH
guideline is quoted here because none could be retrieved.** What *was* established: IH runs
**per-group posting guidelines set by group owners**, shown to you at post time
(https://www.indiehackers.com/product/indie-hackers/added-support-for-group-posting-guidelines--MHDC04726tqs6fDr-W5).
→ **Read the rules displayed in whichever group you post in.** There is no single site-wide rule to
pre-clear.

**Saturation verdict: NEUTRAL, arguably the only place it HELPS.** IH's audience cares about the build
and the business, not category novelty. "I launched a $9 tool into a category with 197 competitors and
here is what happened" is a legitimately interesting IH post *because* it is saturated. Saturation
becomes the content.

**Caveat on expectations:** IH's audience is founders, not job seekers. This is good for feedback,
backlinks and durable content — it is a poor channel for *customers*. Rank it high on effort-adjusted
value, not on conversion.

**Suggested post** (title + body, paste-ready — the HN no-LLM-text rule does **not** apply here):

**Title:** `I built a resume roaster that gives the whole critique away free. Here's the math.`

```
There are about 200 resume tools on Product Hunt alone. I built another one, and I made a
deliberate choice that most of them don't: the entire diagnosis is free.

The model most of this category uses is to show you a score, tell you something is wrong,
and charge you to find out what. I inverted it. You paste your resume, and you get the ATS
score out of 100, the section-by-section teardown, what's working, and the keyword gaps —
all of it, no signup, no email. The only paid thing is a $9 one-time upgrade that returns
the whole resume rewritten as a document you can send.

The reasoning: the diagnosis is the cheap part and the commodity part. Five competitors
give it away too. What's actually laborious is applying 15 fixes across every section of a
document at 11pm, and that's what I think is worth $9.

Honest accounting of where this is weak: it's a crowded category, at least one competitor
sells rewrites at a similar price, and my current lifetime run count is small enough that I
have no aggregate data to prove any of this works yet. I have distribution problems, not
product problems.

Things I got wrong building it that might save someone else time:
- I shipped a single-provider LLM call with no fallback. One 429 took down every paid and
  free path at once. Anthropic reports credit exhaustion as a 400, not a 402, and only the
  message body tells you — status codes alone won't catch the case that matters most.
- I left input uncapped on a free anonymous endpoint sitting in front of a 200k context
  window. That's a denial-of-wallet button and I left it exposed for weeks.
- My share-card endpoint returned 500 on every request since it shipped and I never knew,
  because a try/catch reported it as a generic error.

Happy to talk about the free-diagnosis bet specifically — I think it's right and I have no
evidence yet that it is.
```

---

### 2.4 BetaList — SKIP (paid-only, and the price is not even published)

**Submit:** https://betalist.com/submit — **redirects to sign-in.**
**Cost: PAID, amount UNVERIFIED** · **Verdict: SKIP.**

**Alive** — self-reports *"70,000+ newsletter subscribers, 500,000+ pageviews/month, 24,000+ startups
featured"* (https://betalist.com/advertise).

From their own FAQ (https://betalist.com/support), verbatim:

> "**All submissions are paid. There is no free submission option.** Current plans and prices are shown
> at the end of the submission form. If your startup isn't selected, you get a full refund automatically."

> "**Is there a free submission option?** — **No.** BetaList used to offer free submissions, but all
> submissions now require payment."

> "We feature **pre-launch and recently launched** startups with a clear value proposition, a good
> design, and an innovative idea."

> "We receive **thousands of submissions every month.** We prioritize startup submissions that have a
> clear value proposition, **have an idea we haven't seen before**, and have a well-designed landing page."

They refuse to state an approval time: *"It depends on the plan you paid for."*

⚠️ **The actual submission price could not be obtained.** It sits at the end of a form behind sign-in
plus a Cloudflare human check. Tried: `/submit`, `/submissions`, `/submissions/new`, `/plans`,
`/submissions/plans`, `/pricing`, `/submission-guidelines`, via curl with browser user-agents and via
WebFetch — all returned a sign-in redirect, a 404, or a JS shell. **Creating an account to read the
price would have broken the read-only rule, so it was not done.** The only public numbers are
*advertising* rates, which are **not** the submission fee: Sponsorship **$4,999/month**, Boost **from
$99/week** ("One week: $99/week", "Monthly: $199/month").

**Why skip:** paid-only at an undisclosed price, thousands of monthly submissions, an explicit
preference for *"an idea we haven't seen before"* (we are entry ~198), and we are already launched
rather than pre-launch. The one real prize is a **do-follow backlink** — *"The 'Visit Site' button … is
a do-follow link — it does not use rel='nofollow'"* — which is an SEO play, not a launch play, and
§1.1 gets you do-follow links from PitchWall and Uneed for $0.

---

### 2.5 Lobsters — DO NOT ATTEMPT

**URL:** https://lobste.rs/about · **Verdict: closed to us on four independent grounds.**

Verbatim, all from https://lobste.rs/about:

> "a **user invitation tree** to combat spam" … "The quickest way to receive an invitation is to talk to
> someone you recognize from the site."

> "Users are considered **'new' for their first 70 days** … New users **can't** send invites, **submit
> links to domains we haven't seen submitted before** … or **use tags for meta discussions or that are
> prone to off-topic stories (meta rant show announce satire job interview merkle-trees ask culture
> vibecoding)**."

> "**Self-promotion:** It's great to have authors participate in the community, but not to exploit it as
> a **write-only tool for product announcements or driving traffic to their work.** As a rule of thumb,
> **self-promo should be less than a quarter of one's stories and comments.**"

> "**Topicality:** … Some things that are **off-topic** here but popular on larger, similar sites:
> **entrepreneurship, management, … investing, world events, anthropology, self-help, personal
> productivity systems**"

> "Domains used for marketing analytics are banned and **tracking parameters are removed from links**."

Four blockers, any one of which is fatal: **(1)** invite-only and we have no invite; **(2)** a career
tool is off-topic by their own list — "self-help", "personal productivity systems"; **(3)** the `show`
tag is in the new-user forbidden list for 70 days, *and* new accounts cannot post a domain Lobsters has
not seen, which `ambientpixels.ai` almost certainly is; **(4)** UTM parameters are stripped, so you
could not attribute the traffic anyway. **Spend zero effort here.**

---

### 2.6 Timing — the evidence is much weaker than the folklore

**For Product Hunt, timing is real and mechanical.** Posts go live at **12:01 AM PST** and the
leaderboard runs a 24-hour cycle, so launching at 12:01 AM PST maximises your hours on the board. PH
states it themselves: *"12:01 am Pacific Time is the best time to launch for makers that are planning
ahead and don't have limitations or other opportunities."* This is the **only** timing claim in this
entire document backed by the platform itself.

**PH explicitly refuses to name a best day:** *"The best day to launch is the day on which you're most
prepared. There are pros and cons to launching on each day."* When the platform declines to name a day,
treat any blog that names one as noise. (Note: the July 2026 AmbientScore pack asserted Tuesday was
"best-traffic weekday" — that was not sourced and should not be carried forward.)

**For Hacker News, there is no trustworthy answer and the popular ones contradict each other.** One body
of analysis says post at low-competition times because fewer submissions compete; another says post at
high-activity times because that is when voters are present. These are opposite strategies derived from
the same public dataset — the signature of an underdetermined question, not a finding. Specific claims
("Sunday 6am UTC is 2.5× better than Wednesday 9am UTC") float around with no reproducible methodology,
most of the top-ranking sources are SEO content or vendors selling launch promotion, and the common
methodological error is fatal: measuring *when top posts were submitted* recovers the posting-volume
curve, not a success curve, unless you normalise by submissions-per-slot. Most do not.

**The honest instruction: do not spend an hour optimising HN timing.** Post when you can sit with the
thread for the next 3-4 hours and answer every comment personally — maker presence is what the format
actually rewards. The measured data shows AI-resume posts capped at 2-5 points regardless of when they
went up.

---

## §3 — Non-Reddit communities

The brief for this section was that a previous pass failed by copying dead communities out of old SEO
listicles. So: **every "alive" below rests on something fetched directly** — a dated post, a first-party
member count, or a live API response. Everything else is marked DEAD or UNVERIFIED with what was tried.

**The honest headline: most of this is a no.** Of roughly 55 candidate surfaces checked, **five are
worth your time**, about eight are tolerable through one specific door, and the rest are dead, closed,
login-walled, or empty.

### How the previous pass died — the traps, so they are not repeated

- `scale.jobs/blog/best-discord-communities-job-seekers` — "Top 8 Discord Communities for Job Seekers
  (2026)" — returns **HTTP 404**. It ranks in search and does not exist.
- Every "top LinkedIn Groups for job seekers" listicle traces back to a **HuffPost 2014** article and
  describes "20 subgroups" — LinkedIn deleted subgroups in **2018**. That detail is the tell.
- Listicle stats like "80% of job leads are shared in private communities" have **no primary source**.
  Do not repeat them.

**Four liveness traps worth internalising:**

1. **A stale marketing site ≠ a dead community.** cscareers.dev's *website* last blogged Dec 2023 —
   while its Discord has **160,968 members and 5,145 messages in 7 days**. Checking only the website
   would have wrongly killed the best target on the list.
2. **Member counts and "online" dots are not liveness.** Learn w/ Leon (100Devs) shows *73,224 members /
   5,382 online* but only **18 messages in the last 24 hours**. A ghost town wearing a crowd's clothes.
3. **HTTP headers expose zombies.** `laidoff.support` serves a healthy HTTP 200 — with
   `Last-Modified: Sat, 15 Feb 2025`. Untouched for 18 months.
4. **JS-rendered placeholders fabricate findings** — see the Peerlist note in §1.1 D.

### 3.1 Worth your time — ranked

| # | Community | Verified alive by | Size | Welcome? |
|---|---|---|---|---|
| 1 | **Show HN** (§2.1) | posts landing hourly | — | ✅ **WELCOME** — the rules ask for a no-signup tool |
| 2 | **Write the Docs Slack** `#community-showcase` | live signup form | *"over 22,500 people who have joined"* | ✅ **WELCOME** — a *sanctioned* self-promo channel |
| 3 | **CS Career Hub** (Discord) | Discord invite API: **38,401 members, 3,886 online**, 2,568 msgs/7d, stamped 2026-08-07 | 38.4k | 🟡 **TOLERATED via the Advertising channel only** |
| 4 | **Techqueria Slack** `#job-seeking` / `#resources` | "Techqueria Summit 2026" listed, signup open | *"19,000+ members"*, *"3,000+ weekly active"* | ✅ **WELCOME on the rules** — but application-gated |
| 5 | **cscareers.dev** (Discord) | Discord invite API: **160,968 members, 16,846 online**, 5,145 msgs/7d, stamped 2026-08-07 | 161k | ❓ **rules NOT public — DM a mod first** |

**#2 Write the Docs** — https://www.writethedocs.org/slack/. Rules verbatim, same URL:
> "Be transparent. Clearly explain what you are promoting, why it matters to documentarians, and your involvement."
> "Give more than you take. Make self-promotion a reasonable proportion of your participation… **aim to help others 10 times for every time you self-promote.**"
> "Avoid calls to action — attempts to prompt an immediate response or sale — such as requests to 'buy', 'subscribe', 'retweet', or 'share'."
> "Post publicly instead of sending direct messages (DMs)."

Channels: `#community-showcase` (explicitly for responsible self-promotion), `#career-advice`,
`#job-posts-only`. **The 10:1 rule is real — a zero-history drive-by lands badly.** Disclose the $9 tier.

**#3 CS Career Hub** — https://cscareerhub.com/community-rules, verbatim:
> **Rule 2:** "No spam or self-promotion (server invites, advertisements, etc) without permission from a staff member. This includes DMing fellow members."
> **Rule 5:** "No advertising outside of the channels in the Advertising channel category. Additionally, **#share-your-content is only for sharing content you created yourself and is not for services.**"

There *is* a sanctioned Advertising channel category — a documented, legitimate route. **Do not use
`#share-your-content`**; a hosted tool reads as a "service", which is a stated violation. Ask a mod.

**#4 Techqueria** — both the Slack Community Guidelines and the Code of Conduct were fetched and
**contain no self-promotion prohibition of any kind**. `#resources` (*"sharing helpful resources"*) and
`#job-seeking` (*"if you are looking for a job"*) are among the only channels found anywhere where the
readers *are* the people who need an ATS score. **Two caveats: membership is application-gated, and this
is a Latiné-in-tech community — respect that framing; it is not a generic distribution channel.**

**#5 cscareers.dev** — the largest career-specific audience found anywhere, and the rules are
**not publicly verifiable**: `/rules`, `/guidelines` and `/code-of-conduct` all 404. Search results kept
surfacing *CS Career Hub's* rules for "cscareers rules" queries — a **different server**, not
attributable here. Highest-value target, unknown policy. **DM a mod before posting anything.**

### 3.2 Tolerable through one specific door

| Community | Evidence it's alive | The door | Verdict |
|---|---|---|---|
| **The Job Hopper** (Substack, Alison Doyle) | newest post **12 h old**; "How To… Get Your Resume Noticed" Jul 27 2026 | *"Over 3,000 subscribers."* **Pitch the writer** for a free-tool mention — comments are worthless (4-13 likes/post) | ✅ WELCOME as a pitch |
| **Job Search Guide** (Jan Tegze) | "Why Was Your Resume Rejected So Quickly?" Jul 12 2026 | *"Over 9,000 subscribers."* Same play; topics are dead-centre (ATS, AI resumes) | ✅ WELCOME as a pitch |
| **northern.dev** (ex-Tech Career North) | Discord API: 13,807 members, **2,490 online — 18% concurrent, exceptional**; 2,569 msgs/7d. Actively rebranded | Rules not public; small enough that a mod DM is natural. Canada-gated | 🟡 ask first |
| **The Layoff Club** | "© 2026"; WARN filings Jul 17–Aug 7 2026; *"1,228 filings tracked"* | No forum — pitch to be on the **resource page**. Exact audience, no competing product | 🟡 partner pitch |
| **dev.to** `career` tag | API: `career` tag posting hourly | Terms: *"not designed primarily for the purposes of promotion or creating backlinks"*; *"Posts must contain substantial content — they may not merely reference an external link."* **Only as a real article.** Note the `jobsearch` tag is a wasteland — all 0 reactions | 🟡 article only |
| **LinkedIn main feed / #OpenToWork** | LinkedIn newsroom: *"+1.3B Members"*, ~8.2k applications/minute | Real link tax: a 2026 study of 1.3M posts found **one external link cuts median reach ~18.8%**, link-in-comment suppressed up to 80%. Resource-dense posts, not bare link drops | 🟡 tolerated |
| **Rands Leadership Slack** | *"As of late 2025, with over 30k members…"*; signup open, manually gated | CoC v5.0: *"Obvious commercial activities such as recruiting, lead generation, marketing, and other solicitation are prohibited except in channels dedicated to that purpose."* ⚠️ Their own doc counts **"for-pay, freemium, ad-supported, or even open-source software"** as commercial. `#i-built-something`, after asking. **But this is hiring managers, not job seekers** | 🟡 low fit |
| **Online Geniuses** | *"53,000+ manually vetted members"* | *"Do not post ads or promotions for your company/product/project/etc."* Their "Shameless Plugging" section explicitly covers **"free offers (trials, audits, feedback) designed to generate leads."** `#shameless_plug` only | 🟡 one channel |
| **Skool coaching communities** | Alex Career Coaching **6,076 members** (activity 2026-08-08); Career Systems 1,126 (2026-08-08) | These are **monetised coaching funnels** — owners sell what you give away free. **Owner partnership only**; cold posting is spam | 🟡 partnership |

### 3.3 Alive, perfect audience, door explicitly closed — do NOT post

| Community | Size / liveness | The rule that closes it |
|---|---|---|
| **Blind** (teamblind.com) | **12M+ professionals**; Layoffs channel 3.3M followers; posts 43 min old. Similarweb 13.8M visits/3mo to Jun 2026 | *"Do not SPAM our community… Do not artificially create accounts for commercial purposes, or **access our community to solicit or sell products or services**."* (https://www.teamblind.com/community-guidelines) — **independently re-verified**. The rule bans *accessing the community to solicit*; the $9 tier puts you inside it regardless of the free tier. **SPAM.** |
| **The Odin Project** (Discord) | 90,607 members, alive | Zero-tolerance, ban-on-sight list includes *"Unsolicited self-promotion"* and **"Link to a resource you created for personal or monetary gain."** The $9 upgrade is monetary gain by their own wording. **HARD NO.** |
| **Ask a Manager** | Very alive and **growing** — posts Aug 7 and Aug 8 2026, 459 comments on one open thread, 4.3M visits/3mo **+24.8% MoM** | *"You've probably triggered a moderation filter… by including a link."* Links auto-hold. Enormous, perfect audience, behind a door you cannot push on. **SPAM for direct promotion.** |
| **Glassdoor Community / Fishbowl** | Alive (app updated Jun 2026) | Prohibits *"commercial activities and/or promotions… advertising, affiliate links, and other forms of solicitation"*, enforced by a strike system. **SPAM.** |
| **LinkedIn Groups** | **Structurally dead** | LinkedIn gutted Groups in 2018 (removed Promotions tab, member email, subgroups). Caps from LinkedIn's own help page: **15 posts per group/week, 20 groups/week**. LinkedIn Help states cross-posting the same content *"could result in the post being reported as spam"* — which forbids the only tactic that would make the caps worthwhile. Group pages returned a **login wall with zero data**; no account was created, so no specific group is certified alive. |
| **HN "Ask HN: Who wants to be hired?"** | Alive — Aug 2026 thread (id 49156682), **497 comments**, ~500 job seekers/month | *"Please only post if you are personally looking for work. **Agencies, recruiters, job boards, and so on, are off topic here.**"* **Not a promo surface.** But note the moderator himself links to third-party companion tools that index the thread — *being listed as a companion tool* is a legitimate door; posting in-thread is not. |
| **Taro / Exponent / Interview Query** | Alive | All sell **resume review as a paid product**. Direct competitors. No. |

### 3.4 DEAD or DEBUNKED — delete these from every future list

| Target | Status | Evidence |
|---|---|---|
| **Bluesky job-seeker community** | 🔴 **MIRAGE** | See below — the most decisive finding in this section |
| **Elpha** (elpha.com) | ☠️ **DEAD** | `elpha.com` → expired certificate; `www.elpha.com` → ECONNRESET. **Independently re-confirmed:** curl returns `000` (connection failure). Shut down 2025 |
| **Polywork** | ☠️ **DEAD** | Domain no longer resolves. Founder announced shutdown Dec 30 2024; closed Jan 31 2025 |
| **CodeNewbie** | ☠️ **DEAD/DORMANT** | `community.codenewbie.org` → ECONNREFUSED. Newest podcast May 2024 |
| **People Geeks** (Culture Amp) | 🔒 **CLOSED** | *"We're pausing new Slack sign-ups as we roll out these changes."* ~35,000 members but **you cannot join** |
| **Tech Career Growth** | ❌ **NOT A DISCORD** | Their own page: *"No, we're not going to move to Discord as we're in way too deep."* Slack-only; newest content "Sessions Recap 2021" |
| **CS Career Hackers** | ❌ **DOES NOT EXIST** | No invite, no landing page, no listing. Likely a garbled conflation of cscareers.dev + CS Career Hub |
| **Otta** | ↪️ **GONE as a brand** | 301: `otta.com` → `uk.welcometothejungle.com` |
| **Candor layoff list** | ☠️ **DEAD** | `candor.co/layoffs` → 404. Company pivoted |
| **laidoff.support** | 🧟 **ZOMBIE** | HTTP 200 but `Last-Modified: Sat, 15 Feb 2025` |
| **Learn w/ Leon / 100Devs** Discord | 🧟 **ZOMBIE** | 73,224 members, 5,382 "online" — **498 msgs/7d, 18 in the last 24h** |
| **"#OpenForWork" servers** | ❓ **NOT VERIFIABLE** | Searched Disboard, Discadia, general web. None with confirmable activity. **Do not invent one** |
| **"FreeTechReferrals"** | ❌ **LIKELY FICTIONAL** | Named repeatedly in AI-written listicles; no invite link and no landing page exists |
| **Disboard as a source** | 🚫 **WRONG POND** | Tag `resume`: **3 servers total**, newest bump 2025-08-30. Tags `jobs`/`career`: ~48 listings, mostly FiveM roleplay, Robux giveaways and crypto |

#### 🔬 Bluesky — three competitors already ran this exact experiment

Verified via Bluesky's public profile API:

| Account | Created | Posts | Followers |
|---|---|---|---|
| `@superpowerresume.bsky.social` | Jun 11 2026 | **486** | **31** |
| `@resumeinminutes.bsky.social` | Jun 10 2026 | **343** | **96** |
| `@jobboardsearch.com` | Nov 14 2024 | **417,913** | **969** |

`@superpowerresume`'s bio is near-identical positioning to ours. **486 posts produced 7 total likes.**
For scale: the best general job-search feed has **51 likes**, while Bluesky's Gardening feed has
**13,791** and Discover has **39,319**. The best job-seeker starter pack has driven **4 joins in 20
months**. Of 244 career-professional accounts, **75% have not posted in 180+ days**.

**Bluesky is not hostile to links — it is empty of this audience.** Do not spend time there. (Narrow
exception if we ever target creative job seekers: the `Art: For Hire` feed is genuinely alive.)

### 3.5 Two patterns that change how we write everywhere

**1. "But it's free" is not a defence — three communities pre-empt it in writing.** Rands counts
*"for-pay, freemium, ad-supported, or even open-source software"* as commercial activity. Online Geniuses
explicitly names *"free offers (trials, audits, feedback) designed to generate leads"* as prohibited.
CS Career Hub's *"not for services"* and Odin's *"personal or monetary gain"* both catch the $9 tier.
→ **Disclose the upsell rather than leading with "totally free." In these rooms that phrasing is a known
spam tell**, and it is why every post drafted in this document names the $9 before anyone has to ask.

**2. There is no thriving layoff-support community to distribute into.** Every "layoff community"
checked turned out to be **one person with a dataset and a newsletter** — layoffs.fyi, layoffdata.com,
The Layoff Club, TrueUp. The real gathering places are Reddit (excluded) and Blind (which bans us).

**3. Audience mismatch is a bigger constraint than the rules.** Rands is 30k *engineering leaders*.
Indie Hackers, MLOps and Locally Optimistic are employed practitioners and founders. Only
**Techqueria `#job-seeking`**, **Write the Docs `#career-advice`**, and the two **CS-career Discords**
put this in front of people who actually need an ATS score.

### 3.6 Suggested order, if you do this at all

Show HN (once) → Write the Docs `#community-showcase` → CS Career Hub Advertising channel → newsletter
pitches to The Job Hopper and Job Search Guide → mod DM at cscareers.dev.
**Tag everything with UTMs against the `resumeroast` product split** — and remember the analytics split
date, so do not measure across 2026-08-07.

⚠️ **Every one of these requires joining a community as a person and participating.** Write the Docs
asks for 10 helpful contributions per self-promotion. That is a real ongoing time commitment, not a
submission. If you are not going to be a member, skip §3 entirely and do §1 and §2 instead — a
drive-by in any of these rooms costs more reputation than it earns clicks.

---

## §4 — Master approval checklist

One row per decision. Every row is independently approvable — approve, skip, or defer each on its own.

### Pre-flight (do these first or the rest is wasted)

| ☐ | Item | Cost | Decision |
|---|---|---|---|
| ☐ | Top up Anthropic balance (see GET /api/llm-spend, secret-gated, for the live figure) | your call | approve / skip |
| ☐ | Confirm no ambientpixels.ai product launched on PH in the last 6 months | $0 | verify |
| ☐ | Accept that the Show HN post must be **hand-typed**, not pasted | $0 | acknowledge |
| ✅ | Create 2× gallery images at 1270×760 — **DONE 2026-08-07**, 3 made, in `resume-roast/launch/` | $0 | done |
| ✅ | Create 240×240 thumbnail — **DONE 2026-08-07**, `resume-roast/launch/ph-thumbnail-240.png` | $0 | done |
| ☐ | Set up an `@ambientpixels.ai` mailbox (SaaSHub priority; some forms reject gmail) | $0 | approve / skip |

### FREE — directories

| ☐ | Site | URL | Cost | Copy ready? | Decision |
|---|---|---|---|---|---|
| ☐ | SaaSHub | https://www.saashub.com/services/submit | $0 | ✅ §1.1 A | approve / skip |
| ☐ | Uneed | https://www.uneed.best/submit-a-tool | $0 (free queue) | ✅ §1.1 B | approve / skip |
| ☐ | PitchWall | https://pitchwall.co/submit | $0 (30-day wait) | ✅ §1.1 C | approve / skip |
| ☐ | Peerlist Launchpad | https://peerlist.io/launchpad | $0 | ✅ §1.1 D | approve / skip |
| ☐ | Fazier | https://fazier.com/submit | $0 **+ badge on site** | ✅ §1.1 E | approve / skip |
| ☐ | Insidr.ai | https://www.insidr.ai/submit-tools/ | $0 | ✅ §1.1 F | approve / skip |
| ☐ | AIToolHunt.co | https://aitoolhunt.co/pricing | $0 **+ badge** | ✅ §1.1 G | approve / skip |
| ☐ | Startup Stash | https://startupstash.com/add-listing/ | unknown | ⛔ recommend skip | approve / skip |

### FREE — launch surfaces

| ☐ | Surface | URL | Cost | Copy ready? | Decision |
|---|---|---|---|---|---|
| ☐ | Show HN | https://news.ycombinator.com/submit | $0 | ⚠️ brief only, §2.1 — **retype by hand** | approve / skip |
| ☐ | Indie Hackers | https://www.indiehackers.com/ | $0 | ✅ §2.3 paste-ready | approve / skip |
| ☐ | Product Hunt | https://www.producthunt.com/posts/new | $0 | ✅ §2.2 — blocked on gallery images | approve / skip |

### FREE — communities (each requires being a member, not a drive-by)

| ☐ | Community | URL | Cost | Decision |
|---|---|---|---|---|
| ☐ | Write the Docs Slack `#community-showcase` | https://www.writethedocs.org/slack/ | $0 + 10:1 participation | approve / skip |
| ☐ | CS Career Hub Discord — **Advertising channel, ask a mod** | https://discord.com/invite/cscareerhub | $0 | approve / skip |
| ☐ | Techqueria Slack `#resources` (application-gated) | https://techqueria.org | $0 | approve / skip |
| ☐ | cscareers.dev Discord — **DM a mod first, rules unknown** | https://discord.com/invite/cscareers | $0 | approve / skip |
| ☐ | Pitch The Job Hopper newsletter (3,000 subs) | https://thejobhopper.substack.com | $0 | approve / skip |
| ☐ | Pitch Job Search Guide newsletter (9,000 subs) | https://newsletter.jobsearch.guide | $0 | approve / skip |
| ☐ | Pitch The Layoff Club resource page | https://www.thelayoffclub.com | $0 | approve / skip |
| ☐ | dev.to — as a substantive article only | https://dev.to | $0 | approve / skip |
| ☐ | Blind, Odin Project, Ask a Manager, Glassdoor, LinkedIn Groups, Bluesky | — | — | ⛔ **do not** |

### PAID — recommend skipping all

| ☐ | Site | Price | Decision |
|---|---|---|---|
| ☐ | There's An AI For That (basic) | **$49** | approve / **skip** |
| ☐ | There's An AI For That (max) | **$347** | approve / **skip** |
| ☐ | TopAI.tools | **$47** | approve / **skip** |
| ☐ | Toolify | **$99** | approve / **skip** |
| ☐ | Futurepedia | **$497** | approve / **skip** |
| ☐ | AlternativeTo priority | **$5** | **skip — category banned** |
| ☐ | BetaList | undisclosed | approve / **skip** |
| ☐ | Uneed pick-your-date | **$29.99** | approve / **skip** |

**Sum of all paid rows (excl. BetaList's unknown fee): $1,073.99.**
**Recommended spend: $0.**

---

## §5 — What was NOT verified, and what was tried

Listed so nobody later mistakes a gap for a finding.

| Item | Status | What was tried |
|---|---|---|
| BetaList submission price | **UNVERIFIED** | `/submit`, `/submissions`, `/submissions/new`, `/plans`, `/pricing`, `/submission-guidelines` via curl with browser UA and via WebFetch — sign-in redirect, 404, or JS shell each time. Creating an account would have broken the read-only rule |
| Dang.ai pricing | **UNVERIFIED** | Pricing page redirects to `/login?next=%2Fpricing` |
| Indie Hackers written posting rules | **UNVERIFIED** | `/about`, `/tos`, `/group/launch` return a JS shell to curl and empty content to WebFetch. IH uses per-group rules shown at post time |
| PitchWall / Fazier form fields | **UNVERIFIED** | Behind signup |
| PH description limit (260 vs 500) | **CONFLICTING** | Two PH pages disagree; a third states no limit. Copy is written to 260 so it is safe either way |
| PH tagline 60-char cap | **PARTIALLY VERIFIED** | Stated in the launch guide, absent from the help article. All taglines here are ≤59 so it does not bite |
| HN 80-char title limit | **UNVERIFIED** | The submit form is behind a login. Widely documented; all titles here are ≤75 |
| HN `formatdoc` | **UNVERIFIED** | HTTP 429 after four attempts (rate-limited) |
| Traffic figures for every directory | **SELF-REPORTED ONLY** | No independent Similarweb-style data or third-party case study was found for any directory in §1. Every number is the vendor's own marketing claim and is labelled as such |
| roast-my-resume.com $5 tier | **LOW CONFIDENCE** | Read off their live site today via automated extraction. Eyeball it before using it in public copy |
| Whether any ambientpixels.ai product already launched on PH | **UNVERIFIED** | A PH search found nothing, but a negative search is not proof. Check the PH dashboard |
| Peerlist weekly launch volume | **UNVERIFIED** | Page is a byte-identical static shell across weeks 25/30/31/32 |
| Community rules for cscareers.dev, northern.dev, Scrimba, freeCodeCamp, Frontend Mentor, Interview Query, all Skool communities | **UNVERIFIED** | Not publicly readable. Marked rules-unverified rather than guessed |
| Any specific LinkedIn Group being active | **UNVERIFIED** | Group URLs returned a login wall with zero group data, twice. No account was created |
| Discord's own Discovery directory | **UNVERIFIED** | `/api/v9/discoverable-guilds` and `/discovery/categories` return 401; `/discovery/search` returns 404. Cannot enumerate without an account |
| TrueUp | **UNVERIFIED** | HTTP 403 to both WebFetch and curl with browser headers. Probably bot-blocking, not dead — but the page was never seen, so nothing about it is certified |
| Data Angels | **UNVERIFIED** | Claims "3100+ members" with a live join form, but **not a single date anywhere on the site**. No 2025-26 activity confirmable |
| "No link penalty on Bluesky" | **UNVERIFIED** | Repeated by marketing blogs with no primary source |
| "220 million people using Open to Work" | ⛔ **DO NOT USE** | Traces only to SEO blogs, never to LinkedIn |
| Forbes' "60% LinkedIn link penalty" (Jul 30 2026) | ⛔ **APPEARS WRONG** | Cites only a marketing blog and appears to conflate "reach down 60% over two years" with a per-link penalty. The defensible number is **~18.8%** |

---

## §6 — Copy library (reusable blocks with exact character counts)

Use these to fill any field on any site. Counts verified programmatically.

| Key | Chars | Text |
|---|---|---|
| Name | 12 | `Resume Roast` |
| Name (long form) | 29 | `Resume Roast by AmbientPixels` |
| Tagline 40 | 29 | `Get your resume roasted, free` |
| Tagline 50 | 47 | `Brutally honest AI resume review, entirely free` |
| Tagline 60 | 58 | `Get your resume roasted before a recruiter does it for you` |
| Tagline 60 alt | 52 | `A brutally honest AI resume review — free, no signup` |
| Tagline 70 | 66 | `Paste your resume, get an ATS score and a section-by-section roast` |
| Tagline 100 | 95 | `Paste your resume, get a brutally honest AI review free — ATS score, section roast, keyword gap` |
| Desc 140 | 129 | `Paste your resume, get the whole roast free: ATS score out of 100, section-by-section teardown, keyword gap. No signup, no email.` |
| Desc 160 | 159 | `Paste your resume and get the whole roast free — an ATS score out of 100, a section-by-section teardown, and the keywords you are missing. No signup, no email.` |
| Desc 200 | 188 | `Paste your resume and get the whole roast free: an ATS score out of 100, a section-by-section teardown, and the keywords you are missing. No signup, no email. $9 buys the rewritten resume.` |
| Desc 260 | 256 | `Paste your resume and get the whole roast free — an ATS score out of 100, a section-by-section teardown, and the keywords you are missing. No signup, no email. Paste the job posting too and it scores against that role. $9 once returns the rewritten resume.` |

**Long description** (use where there is no limit, ~700 chars):

```
Resume Roast is a free AI resume review. Paste your resume as text and you get the whole
thing back: an ATS score out of 100, a section-by-section teardown of what is weak and why,
an honest list of what is already working, and the specific keywords you are missing. There
is no signup, no email and no file upload — 5 roasts a day without an account, 10 signed in.

Paste the job posting alongside it and the score, the keyword gap and the rewrite all target
that specific role rather than resumes in general.

The whole diagnosis is free. If you would rather not do the editing yourself, $9 one-time
returns the complete rewritten resume — every section rewritten to lead with achievements
and to parse cleanly through an ATS, plus what changed and why — as a finished .md or .txt
you can send. It never invents numbers for you; the handful of spots only you can fill get
marked. One payment, no subscription.
```

**Category, everywhere:** `Career` / `HR & Recruiting` / `Productivity` (fallback: `Writing`, `AI Tools`)
**Pricing to state, everywhere:** `Freemium — free roast, $9 one-time rewrite`
**Tags:** `resume` `cv` `ats` `job search` `career` `resume review` `ats score` `keyword optimization` `ai writing`
**Contact email:** use the one on the Stripe receipts so refund replies land in the same inbox.

**URL — use this exact form everywhere, no exceptions:**
```
https://www.ambientpixels.ai/resume-roast/
```
Add UTMs where the destination allows them, tagged to the `resumeroast` product split — e.g.
`?utm_source=saashub&utm_medium=directory&utm_campaign=launch`. **Lobsters strips UTMs**; some
directories strip query strings too, so treat the bare www URL as the fallback.

---

## §7 — After anything goes live

- **Watch the funnel, not the vanity number.** `productAnalyticsQuery?product=resumeroast&metric=funnels`
  (note: **plural** `funnels` — the singular spelling 400s).
- **Do not measure across 2026-08-07.** That is the analytics product-split date *and* the server-side
  purchase-retag date. Any comparison spanning it is meaningless.
- **The first thing to look for is a non-zero `page_view` from a referrer that is not us.** Fleet
  activity must stay excluded from the demand metric.
- **Watch `reason=credits` in the LLM fallback log.** The Gemini fallback makes credit exhaustion
  *quieter*, not louder — the product keeps answering on the backup model and nobody finds out.
- **The kill gate is pre-committed for 2026-09-07** (30 replies / <3 runs ⇒ channel off). Everything
  approved here should be tagged so that gate reads a real number rather than a zero caused by
  attribution rather than demand.

---

## Provenance

Every price, rule and character limit above was fetched from the named site on **2026-08-07**, mostly
via its own submit, pricing, help or guidelines page. Where a page was behind Cloudflare, a login, or a
JS shell, it is marked **UNVERIFIED** in §5 along with what was tried. Where a number is the vendor's own
marketing claim rather than independent data, it is labelled as such at the point of use.

**No account was created, nothing was submitted, nothing was posted, and no money was spent producing
this document.**

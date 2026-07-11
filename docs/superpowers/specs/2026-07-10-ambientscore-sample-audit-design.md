# AmbientScore Sample Audit — Design Spec

**Date:** 2026-07-10
**Status:** Approved (design), pending implementation plan
**Author:** Claude + CEO

## Problem

AmbientScore's bottleneck is trust and traffic, not the scan itself. It asks visitors to pay $29 for something they have never seen. A public "sample audit" de-risks that purchase (shows exactly what you get) and doubles as shareable marketing content (a URL to drop in posts, outreach, and the blog). This is the single highest-leverage conversion asset for a product whose funnel audit shows ~14 lifetime scans and 0 sales.

## Goal

Publish one fully-unlocked example report, linked from the AmbientScore landing page and usable as a standalone marketing URL, that:
- Shows the full depth of a paid report (all 8 dimensions, findings, headline/CTA rewrites, priority roadmap, editorial design).
- Looks relevant to the target buyer (a conversion-funnel business site, not a game or our own product).
- Reads as a credible, independent audit (avoids the "scoring your own homework" discount).

## Approach: purpose-built demo page

Rejected alternatives and why:
- **Feature a real product (e.g. StoryForge):** self-audited (credibility discount) and off-target (a consumer game, not the buyer's SaaS/business site). StoryForge scored 80/B with sharp findings, so it was a safe v1, but not the most persuasive.
- **Named recognizable brand teardown:** high appeal, but publicly critiques a named company.
- **Anonymized real site:** relevant and safe, but less controllable than a page we build.

A purpose-built fictional B2B SaaS landing page gives maximum buyer-relevance, no reputational risk, no self-homework problem, and control over the score band.

## Components

### 1. Demo target page (centerpiece — new)

A single self-contained landing page for a fictional B2B SaaS product (invented brand and product, e.g. a generic analytics or scheduling tool).

- **Hosting:** a public path on our domain so the scraper can reach it: `ambientpixels.ai/ambientscore/sample/` (exact path finalized in the plan). Must be publicly fetchable (the scraper blocks localhost/private IPs).
- **Styling:** a generic modern SaaS aesthetic with its own inline CSS. Deliberately NOT the AmbientScore editorial design system and NOT the AmbientPixels design system — it must look like an independent company's real page, or the audit reads as fake.
- **Content design — engineered to score ~68–76 (C+/B-) with rich findings.** Solid fundamentals (clear layout, hero, sections, a signup form, a logo bar) plus planted, realistic weaknesses the audit will catch:
  - Vague value-prop headline (no specific outcome/benefit).
  - Generic CTA ("Get Started" / "Sign Up") with no value language.
  - No pricing clarity.
  - Thin, unnamed social proof (generic logos, no named testimonials with outcomes).
  - A friction point or two (competing CTAs, a longer form).
- The page needs real content in the areas the scraper reads (headings, CTAs, forms, social proof, pricing, body text) so the audit has material. A too-sparse page scores like an empty placeholder (F).

### 2. Make the report permanently viewable (backend)

- Scan the demo page once via `/api/as-analyze` to produce a stored report (`cc_report_<reportId>`, `unlocked: false`).
- Add a small allowlist to `api/as-report/index.js`: `const SAMPLE_REPORT_IDS = new Set([...])` containing the demo report id. Change the lock gate from `if (!report.unlocked)` to `if (!report.unlocked && !SAMPLE_REPORT_IDS.has(id))` so sample ids return the full report.
- Rationale: the report is already stored and reports are never purged (no cleanup logic exists for `cc_report_*`), so no blob write and no payment are needed. This is ~3 additive lines on one endpoint, low blast radius.
- Result: `report.html?id=<demoReportId>` renders the full report to anyone, no paywall.

### 3. Link from the AmbientScore landing (frontend)

- Add a quiet secondary link beside the hero primary CTA in `ambientscore/index.html`: **"See a sample audit ›"** → `report.html?id=<demoReportId>`.
- Editorial design system, strictly: JetBrains Mono eyebrow/label, red `--stamp` `›` caret, no em dashes in any user-visible string, reuse existing `as-*` classes, no `!important`. It reads as a low-pressure "show me first" option beside the "scan your site" CTA.
- This is also the shareable marketing URL.

### 4. Sample-viewer banner (frontend)

- When the report loads as a sample, show a slim top banner (in `report.html` / `report.js`): **"Sample audit. Scan your own site for a personalized report ›"** with the caret linking back to the scanner landing.
- Converts sample-viewers into scanners — the point of the asset.
- `report.js` already hides the paywall/buy UI for unlocked reports, so no purchase UI leaks. Confirm this during implementation.

## Data flow and sequencing

Two deploys, because the page must be publicly live before it can be scanned:

1. **Deploy A:** build and deploy the demo target page. Verify it is publicly reachable.
2. **Tune:** scan it via `as-analyze`; if the score lands too high (boring) or too low (harsh), adjust the demo page content and re-scan until it sits in the target band with a good spread of findings. Record the final `reportId`.
3. **Deploy B:** add the `reportId` to the `as-report` allowlist, add the landing-page link, and add the viewer banner.

## Design system constraints (binding)

- AmbientScore editorial register only for the landing link and viewer banner: cream/ink/stamp palette, three typefaces, three emphasis marks (italic serif, red stamp, all-caps mono). No em dashes, no gradients/glow/emoji, no new emphasis mechanics.
- The demo target page is the exception: it uses its own generic-SaaS styling and must not import AmbientScore or AmbientPixels styles.
- Search `ambientscore.css` before adding any class; reuse existing `as-*` selectors.

## Out of scope (YAGNI)

- No new API endpoint, no admin/unlock tooling, no auto-refresh.
- No second sample or business-site sample in this pass (can follow later).
- No richer paywall "blurred own-report" reveal (separate future item).
- The sample is a pinned snapshot. Refresh procedure: re-scan the demo page, swap the new `reportId` into the allowlist and the two links.

## Testing / verification

- Demo page returns HTTP 200 at its public URL and is scrapeable (headings/CTAs/form present).
- A live scan produces a report in the target band (~68–76) with a full findings set and rewrites.
- `report.html?id=<demoReportId>` renders the full unlocked report (not the teaser) after the allowlist deploy.
- The landing "See a sample audit ›" link navigates to the unlocked report.
- The viewer banner appears on the sample and links back to the scanner; no buy/paywall UI shows.
- Editorial constraints hold: no em dashes, no `!important`, no new classes where an `as-*` exists.

## Risks / notes

- **Score is emergent** from the model; exact band is not guaranteed. Mitigation: design toward the band and iterate content + re-scan (built into sequencing step 2).
- **URL reveals our domain** in the report. Acceptable: the asset is labeled "sample," so an `ambientpixels.ai` path reads as our example, not a claimed customer.
- **Report persistence** depends on `cc_report_*` never being purged; confirmed no purge logic exists today. If a retention policy is ever added, exclude sample ids.

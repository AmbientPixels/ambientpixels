# Interactive Résumé, Design Spec

Date: 2026-07-07
Page: `/skills/chad-martin-resume.html`
Author: Chad Martin (content) + Claude (build)

## Goal

Rebuild the résumé into a single, self-contained interactive page that:
1. Absorbs the substance of the sidelined Xbox case-study pages as expandable project cards (the pages themselves stay retired / 301-redirected).
2. Restyles to the current ap-* polish used on the homepage and Work pages.
3. Incorporates the new July 2025 role, the updated prior role, and a new profile summary.

The page is Chad Martin's personal career portfolio. No studio/client framing.

## Non-negotiable style rules

- **No em dashes anywhere** (`—` / `&mdash;`). Use commas, colons, or sentence breaks. Date ranges may use a spaced en dash (`–`), which is not an em dash.
- **Attribution:** all Microsoft / Xbox work is Chad Martin as a **Hanson Consulting Group contractor**. Never AmbientPixels, never "client" or "studio" framing for the Xbox work.
- **Tense:** current role (Xbox Store) in present tense; the prior role and every completed project in past tense.
- **No new dependencies.** Reuse ap-* tokens/components; vanilla JS only.

## Client-framing audit (requested)

Grep of the résumé body for "client" returned **no matches**. The résumé text does not tag Xbox work as client/studio work. The only client-framed exposure was §01 linking out to the now-redirected case-study pages; inlining the content removes that. No copy to strip on this count.

## Page architecture

| # | Section | Change |
|---|---|---|
| Hero | `Chad Martin.` | Kept. Restyled to full polish (paper texture + glow + tonal + vignette). Add the new **profile summary** paragraph. Buttons kept (Download PDF, LinkedIn). |
| §01 | **SELECTED WORK** (was "FEATURED PROJECTS") | Replaced 4 dead links with an interactive gallery: category filter + ~10 expandable project cards. |
| §02 | **EXPERIENCE** | New current role (Xbox Store) + updated prior role (Xbox) + kept pre-2014 roles. Heading recount. |
| §03 | **SKILLS** | Kept, polished. Add JavaScript/Node.js automation + Content Packager tooling to reflect the systems-building shift. |
| §04 | **AWARDS** | Kept (Microsoft Impact Award, Hanson Superhero Award). |
| §05 | **EDUCATION** | Kept. |
| CTA + footer | | Kept, restyled, em dashes removed. |

Eyebrow separators change from em dash to middot, e.g. `§ 01 · SELECTED WORK`.

## Content: profile summary (new, verbatim)

> I've spent 18 years building, publishing, and automating content for Xbox: from hand-coding Xbox.com splash pages in 2008, to content readiness for the Xbox One global launch, to producing the weekly merchandising that ships to the Xbox Desktop and Mobile apps across 100+ locales today. My role kept evolving from producing content to building the systems that produce it: deep fluency in publishing pipelines, CMS systems, and localization at scale, combined with the JavaScript and Node.js skills to automate the parts that shouldn't be manual, and the AI workflow skills to scale what's left.

## Content: experience (new + updated)

**1. Producer, Xbox Store | Microsoft (via Hanson Consulting Group)** — present tense
July 2025 – Present · Seattle, WA (Remote)
- Produce and publish weekly promotional content for the Xbox Desktop and Mobile apps, high-visibility storefront surfaces within Microsoft's 500M+ player gaming ecosystem. Deliver localized, campaign-ready creative for major game launches, sales events, and seasonal beats across 100+ locales in every Xbox market worldwide.
- Built an internal tooling suite that automates Xbox Store creative production and localization. Designed and shipped the Content Packager, a Node.js engine and zero-dependency web app that transforms weekly merchandising campaigns into upload-ready packages for two CMSs across five storefront surfaces and up to 122 locales, reshaping dozens of campaigns into hundreds of localized slots in seconds with a human sign-off gate on everything that ships. Rounded out the suite with a browser-based editor for authoring and previewing localized store tiles, plus a readiness/QC dashboard that flags mismatches before publishing.
- Produce and animate developer tutorial videos for ID@Xbox, published on official Xbox channels, guiding studio partners through onboarding, tooling, and publishing workflows.

**2. Producer, Xbox | Microsoft (via Hanson Consulting Group)** — past tense
June 2014 – July 2025 · Kirkland, WA
- Microsoft Impact Award recipient for leadership in CMS migration and support platform innovation.
- Built and optimized Xbox support content across web, console, desktop, and mobile, reaching millions of players in 40+ languages.
- Led the end-to-end migration from Zendesk to Campsite CMS, delivering 100% content accuracy with zero downtime.
- Led AI initiatives through the Copilot Playground, using prompt engineering to scale and automate localized content creation and review. Integrated AI tools and custom agents into daily workflows, and supported leadership in bringing AI-driven improvements to the Xbox Support ecosystem.
- Shipped multiplatform help hubs for major studio titles, ensuring seamless global launches with consistent, localized support. Designed and published user flows for refunds and in-console game billboards.
- Produced animated videos to showcase team projects and strengthen internal training.
- Built Power BI dashboards and tooling pipelines that improved content visibility, reporting, and performance insights. Facilitated cross-functional workshops on support strategy, tooling, and UX, including hands-on Figma design reviews.

**3–5. Pre-2014 roles:** Kept as-is (Denny Mountain Media 2010–2014, Filter/A Merkle Company 2009–2010, Additional roles 1998–2009), unless their formatting breaks during the restyle. Em dashes in these will be removed.

§02 heading recount: "Twenty-five years, four chapters" is stale. Replace with a count that matches five roles and the ~28-year span, no em dash (e.g. "Nearly three decades, five chapters").

## Component: interactive project card

The core new component. Vanilla JS, no dependencies.

**Collapsed state** (`<article class="cv-project" data-cat="web|ai|data|video|design">`):
- Thumbnail: project hero image, or an icon tile (reusing the `thumb--icon` / `thumb--bg-*` pattern) for icon-only projects (Copilot Playground, Grand Central, Content Packager).
- Title + role line ("Producer, Microsoft Xbox, via Hanson Consulting Group" where relevant).
- Category tag.
- 2–3 headline metric chips.
- A "View case study" toggle (`<button aria-expanded>`).

**Expanded state** (revealed in place, accordion):
- One short story paragraph (past tense, no em dashes, Hanson framing).
- Metric grid (the hard numbers).
- Image gallery: thumbnails that open a **lightbox** (keyboard arrows + Esc, focus trap, swipe on touch, respects `prefers-reduced-motion`).
- Tech/tools chips.
- For video projects: embedded YouTube via `youtube-nocookie.com` (CSP already allows it) + behind-the-scenes frames.
- Live link to the public `support.xbox.com/...` surface where one exists.

**Interactions:**
- Accordion: each card toggles independently; multiple may be open.
- Category filter chips above the grid (All · Web · AI & Data · Video · Design) show/hide cards via `data-cat`.
- Accessibility: `button[aria-expanded]` + `aria-controls`; filter chips as a toggle group; lightbox is a modal dialog with focus management; all interactive elements keyboard reachable; motion gated by reduced-motion.

## Project set (10 cards)

Consolidated per the content inventory's merge map so no metric is double-counted. All copy past tense, Hanson framing, no em dashes.

1. **Xbox Support** · Web · role: Producer, Microsoft Xbox. Merges the hub + team + web case study. Metrics: 32M+ monthly support users, 40+ languages/regions, WCAG 2.1 AA. Story: platform publishing for support.xbox.com across web, console, mobile, desktop; refund flow; Instant Answer logic; Compass → Campsite CMS migration; PowerShell/C# content-scrub automation. Images: `/images/projects/xbox-support/screen-01..06`. Live: support.xbox.com.
2. **Content Packager (Xbox Store)** · AI & Data · role: Producer, Microsoft Xbox (current). Icon tile. Metrics: 122 locales, 5 storefront surfaces, 2 CMSs. Story: Node.js zero-dependency engine + web app that turns weekly merchandising campaigns into upload-ready localized packages in seconds, human sign-off gated; plus a tile editor and QC/readiness dashboard. No gallery (new/internal).
3. **Copilot Playground** · AI & Data · Metrics: 22 AI models, 10× publishing speed, 98.9% first-pass accuracy. Story: internal prompt-engineering toolkit, prompt chaining + guardrails, the C.R.E.A.T.E. method, localized content generation. Icon tile. Image OG: `/images/projects/copilot-playground/preview.jpg`.
4. **Grand Central 3.0** · AI & Data · Metrics: 7,490 assets tracked, 500K+ links indexed, 71K+ Contact Us modules across 75 locales. Story: Excel + Power Query + Power BI pipeline that replaced manual audits with a weekly-refreshed dashboard; flags isOffline error risk. Image: `/images/projects/grand-central/gc-dashboard.jpg`.
5. **Xbox Support App** · Video · Metrics: 30M+ console users/month, 35% fewer support calls, 45% faster resolution. Story: in-console support experience, QR sharing, AI search; React Native + Azure; produced the animated case-study video (Azure AI narration). Video: youtu.be/JwpnzA3LRkM. Gallery: `/images/projects/video/xbox-support-app-on console/screen-01..16` (note the space in the folder name).
6. **Hellblade, Ninja Theory** · Web + Video · Metrics: 1M+ monthly users, 35% fewer tickets, 45% faster resolution, +85% Help Center awareness. Story: support pages for both Hellblade titles launched simultaneously; produced the animated Help Center showcase (custom Azure voice "Ava"). Gallery: `/images/projects/ninja-theroy/screen01..06` + `/images/projects/video/ninja-theroy/video-screen-01..06`. Video: youtube.com/watch?v=zhcM5tEaSfM.
7. **Gears of War** · Web · Metrics: 28+ articles, 40+ languages, 3 days to under 12 hours deploy. Story: unified modular content framework; localization turnaround cut 60%. Gallery: `/images/projects/gow/screen-01..08`. Live: support.xbox.com/game/gears-of-war.
8. **South of Midnight, Compulsion** · Web · Metrics: 40+ languages, 100% WCAG 2.1 AA, 0 critical issues at launch. Story: launch-aligned support, reusable Compulsion templates (also covering We Happy Few, Contrast), 40% faster deploys. Gallery: `/images/projects/SoM/screen-01..08`.
9. **Microsoft Casual Games** · Web · Metrics: 12+ titles, 100% accessibility, zero downtime. Story: Zendesk to Xbox Support migration, dual-CMS parallel run with redirects, legacy sunset with no downtime; before/after comparison. Gallery: `/images/projects/microsoft-casual-games/screen-01,-02,-04,-06,-07` + slider `screen-01-1200.png` / `zendesk01-1200.png`.
10. **Figma Fleet** · Design · role: Contract UX designer, Microsoft (via Hanson). Metrics: 12 team members trained, 40% faster onboarding, 10+ walkthroughs. Story: visual-first Figma onboarding toolkit with annotated walkthroughs and a shortcut-overlay system. Gallery: `/images/projects/figma-fleet/figma-fleet-1..8`.

Order presents strongest/most-current first: Xbox Support, Content Packager, Copilot Playground, Grand Central, Xbox Support App, Hellblade, Gears of War, South of Midnight, Casual Games, Figma Fleet.

## Restyle details

- Body classes upgrade to the homepage set: `polish-glow polish-tonal polish-hairlines polish-vignette polish-type` + `data-texture="paper"` (résumé is currently `polish-hairlines polish-type`, `data-texture="none"`).
- New scoped CSS for `cv-project` (card), the lightbox, and the filter, reusing ap tokens. Keep the existing `cv-role`, `cv-skill-*`, `cv-award`, `cv-edu` styles (they are already on-system); remove em dashes from their content.
- Pull in the real project imagery (paths above already exist under `/images/projects/...`); verify each referenced asset exists during build, drop any missing image gracefully.
- A new small JS file (e.g. `/skills/resume.js` or inline) for accordion + lightbox + filter.

## Accessibility

WCAG 2.1 AA target (fitting for the subject matter). Keyboard-operable accordion, filter, and lightbox; visible focus; `aria-expanded`/`aria-controls`; alt text on all gallery images; `prefers-reduced-motion` respected.

## Verification

- Real Playwright screenshots at desktop + mobile widths after each major stage.
- Confirm: 10 cards render, filter works, one card expands with gallery + lightbox, video embeds load, no em dashes remain (grep), no "client"/"studio"/AmbientPixels framing on Xbox work, tense correct.
- Grep the final file for `—`/`&mdash;` to prove zero em dashes.

## Resolved content questions

- Audience number: use **500M+ player ecosystem** (Xbox-wide, matches the new copy) and **32M+ monthly** for the support site specifically. Both stated in their correct scope.
- Tenure/employer: resolved by the two-role split, both Hanson Consulting Group contractor.

## Resolved at spec review (2026-07-07)

- **Content Packager:** yes, its own project card (card #2).
- **Card count:** keep all 10.
- **ID@Xbox tutorial videos:** mentioned in the Xbox Store role bullet only, no separate card.

## Out of scope

- Editing the PDF résumé (`Chad-Martin-Resume-2025-June.pdf`); flag if it should be refreshed separately.
- Un-retiring any sidelined case-study pages (they stay 301-redirected).

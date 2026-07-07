# Interactive Résumé Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/skills/chad-martin-resume.html` into a single interactive résumé that absorbs the sidelined Xbox case-study content as 10 expandable, filterable project cards, restyled to the current ap-* polish, with the new July-2025 role and summary.

**Architecture:** One self-contained HTML page (existing pattern: inline `<style>` block) + one new external JS file `skills/resume.js` for accordion, filter, and lightbox. Reuse ap-* CSS tokens and components; no frameworks, no dependencies. Content source of truth: `docs/superpowers/specs/2026-07-07-interactive-resume-design.md`.

**Tech Stack:** Static HTML/CSS/vanilla JS; Azure Static Web Apps; Playwright (via `C:/Dev/Ambientpixels/node_modules`) for render verification.

**Hard rules (from spec):** No em dashes (`—`/`&mdash;`) anywhere; date ranges may use en dash `–`. All Xbox work attributed to "Producer, Microsoft Xbox, via Hanson Consulting Group" (Figma Fleet: "Contract UX designer, Microsoft, via Hanson Consulting Group"), never AmbientPixels/client/studio. Current role present tense; prior role + all completed projects past tense.

---

## File Structure

- **Modify:** `skills/chad-martin-resume.html` — full rebuild of `<body>` content + extend the inline `<style>` block with the new component CSS. Add `<script defer src="/skills/resume.js"></script>`.
- **Create:** `skills/resume.js` — accordion toggle, category filter, image lightbox. One responsibility: résumé-page interactivity.
- **Verification helper (scratchpad, not committed):** a Playwright render script (reuse the existing `scratchpad/render-resume.js`; run with `NODE_PATH="C:/Dev/Ambientpixels/node_modules"`).

Image assets already exist under `/images/projects/...` (paths per spec). No image files are created.

---

## Verification model (no unit-test framework)

"Tests" here are: (a) Playwright full-page screenshots at 1440px and 390px, (b) `grep` assertions on the built file. Standard checks reused across tasks:

- **Em-dash check:** `rg -n "—|&mdash;" skills/chad-martin-resume.html` → expect **no matches**.
- **Framing check:** `rg -ni "client|studio|ambientpixels" skills/chad-martin-resume.html` → only allowed hits are the nav/footer AmbientPixels brand logo/links (site chrome), never around Xbox work.
- **Render:** `NODE_PATH="C:/Dev/Ambientpixels/node_modules" node scratchpad/render-resume.js` → screenshot to `scratchpad/render-resume.png`; read it.

---

## Task 1: Page shell restyle + profile summary

**Files:**
- Modify: `skills/chad-martin-resume.html` (head, body classes, hero section, add summary)

- [ ] **Step 1: Upgrade body polish + texture**

Change the `<body>` opening tag from:
```html
<body class="polish-hairlines polish-type" data-texture="none">
```
to:
```html
<body class="polish-glow polish-tonal polish-hairlines polish-vignette polish-type" data-texture="paper">
```

- [ ] **Step 2: Rebuild hero + add profile summary**

Replace the current first `<section class="ap-sec">` (the hero, lines ~58-77) with:
```html
<section class="ap-sec">
  <div class="ap-sec-head">
    <div>
      <div class="ap-sec-idx">&sect; STUDIO &middot; RESUME</div>
      <h1 class="ap-display">Chad<em> Martin.</em></h1>
    </div>
    <div class="ap-sec-meta">
      Senior Producer and Technical Strategist. Producer, Xbox Store, Microsoft, via Hanson Consulting Group.
    </div>
  </div>
  <p class="cv-summary">I&rsquo;ve spent 18 years building, publishing, and automating content for Xbox: from hand-coding Xbox.com splash pages in 2008, to content readiness for the Xbox One global launch, to producing the weekly merchandising that ships to the Xbox Desktop and Mobile apps across 100+ locales today. My role kept evolving from producing content to building the systems that produce it: deep fluency in publishing pipelines, CMS systems, and localization at scale, combined with the JavaScript and Node.js skills to automate the parts that shouldn&rsquo;t be manual, and the AI workflow skills to scale what&rsquo;s left.</p>
  <ul class="cv-tags">
    <li>Producer</li><li>Technical</li><li>Leadership</li><li>Strategy</li><li>AI systems</li><li>Video &amp; animation</li>
  </ul>
  <div class="ap-cta-actions" style="display:flex; gap:var(--sp-3); flex-wrap:wrap; margin-top:var(--sp-8);">
    <a class="ap-btn ap-btn--primary" href="/skills/Chad-Martin-Resume-2025-June.pdf" download="Chad-Martin-Resume">Download resume (PDF) &rarr;</a>
    <a class="ap-btn ap-btn--ghost" href="https://www.linkedin.com/in/chad-martin-b038496/" target="_blank" rel="noopener noreferrer">Connect on LinkedIn</a>
  </div>
</section>
```
Note: removed the two em dashes from the old meta blurb; the old "Turning complexity into clarity — through..." line is replaced by the summary paragraph.

- [ ] **Step 3: Add the summary CSS** to the inline `<style>` block:
```css
.cv-summary { max-width: var(--max-prose); font-size: var(--fs-body); line-height: var(--lh-body-loose); color: var(--color-text-body); margin: var(--sp-6) 0 0; }
```

- [ ] **Step 4: Verify render + em-dash check**

Run: `NODE_PATH="C:/Dev/Ambientpixels/node_modules" node scratchpad/render-resume.js`
Expected: hero shows the amber-glow/paper polish, summary paragraph present.
Run: `rg -n "—|&mdash;" skills/chad-martin-resume.html` on the hero region.

- [ ] **Step 5: Commit**
```bash
git add skills/chad-martin-resume.html
git commit -m "feat(resume): restyle hero to full polish + add profile summary"
```

---

## Task 2: Interactive component CSS

**Files:**
- Modify: `skills/chad-martin-resume.html` (inline `<style>` block, append)

- [ ] **Step 1: Append component CSS** to the inline `<style>`:
```css
/* ── §01 interactive project gallery ── */
.cv-filter { display:flex; flex-wrap:wrap; gap:var(--sp-3); margin:0 0 var(--sp-8); font-family:var(--font-mono); font-size:var(--fs-mono-xs); letter-spacing:var(--tracking-mono-md); text-transform:uppercase; }
.cv-filter button { padding:var(--sp-2) var(--sp-4); border:1px solid var(--color-border); background:transparent; color:var(--color-text-secondary); cursor:pointer; transition:color var(--dur-med), border-color var(--dur-med); }
.cv-filter button[aria-pressed="true"] { color:var(--color-text-primary); border-color:var(--color-text-primary); }

.cv-projects { display:flex; flex-direction:column; }
.cv-project { border-top:1px solid var(--color-border); }
.cv-project:first-child { border-top:none; }
.cv-project[hidden] { display:none; }
.cv-project-head { display:grid; grid-template-columns:140px 1fr auto; gap:var(--sp-5); align-items:center; width:100%; padding:var(--sp-6) 0; background:transparent; border:0; text-align:left; cursor:pointer; color:inherit; font:inherit; }
.cv-thumb { width:140px; height:88px; object-fit:cover; display:block; filter:grayscale(1) contrast(.92) brightness(.85); transition:filter var(--dur-med); }
.cv-project-head:hover .cv-thumb { filter:none; }
.cv-thumb--icon { display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#2e2e2e,#141414); color:#fff; }
.cv-thumb--icon i { font-size:36px; }
.cv-project-title { font-family:var(--font-display); font-weight:var(--fw-heavy); font-size:clamp(20px,2.2vw,28px); letter-spacing:var(--tracking-tight); margin:0; }
.cv-project-title em { font-style:italic; font-weight:var(--fw-regular); color:var(--color-text-body); }
.cv-project-role { font-family:var(--font-mono); font-size:var(--fs-mono-xs); letter-spacing:var(--tracking-mono-md); text-transform:uppercase; opacity:.6; margin:var(--sp-2) 0 var(--sp-3); }
.cv-project-heads { display:flex; flex-wrap:wrap; gap:var(--sp-2); }
.cv-project-toggle { font-family:var(--font-mono); font-size:var(--fs-mono-xs); opacity:.6; white-space:nowrap; }
.cv-project[data-open="true"] .cv-project-toggle span { display:inline-block; transform:rotate(90deg); }

.cv-chip { padding:var(--sp-1) var(--sp-3); border:1px solid var(--color-border); font-family:var(--font-mono); font-size:var(--fs-mono-xs); letter-spacing:var(--tracking-mono-sm); text-transform:uppercase; opacity:.75; }
.cv-cat { color:var(--color-text-primary); border-color:var(--color-border); }

.cv-project-body { display:none; padding:0 0 var(--sp-8); max-width:var(--max-prose); }
.cv-project[data-open="true"] .cv-project-body { display:block; }
.cv-project-body p { font-size:var(--fs-body-sm); line-height:var(--lh-body); opacity:.85; margin:0 0 var(--sp-5); }
.cv-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:var(--sp-4); margin:0 0 var(--sp-6); }
.cv-metric b { display:block; font-family:var(--font-display); font-weight:var(--fw-heavy); font-size:clamp(22px,2.6vw,32px); color:var(--color-text-primary); }
.cv-metric span { font-family:var(--font-mono); font-size:var(--fs-mono-xs); letter-spacing:var(--tracking-mono-md); text-transform:uppercase; opacity:.6; }
.cv-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:var(--sp-3); margin:0 0 var(--sp-6); }
.cv-gallery button { padding:0; border:1px solid var(--color-border); background:none; cursor:pointer; overflow:hidden; }
.cv-gallery img { width:100%; aspect-ratio:16/10; object-fit:cover; display:block; transition:transform var(--dur-med); }
.cv-gallery button:hover img { transform:scale(1.04); }
.cv-video { position:relative; aspect-ratio:16/9; margin:0 0 var(--sp-6); }
.cv-video iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
.cv-tools { display:flex; flex-wrap:wrap; gap:var(--sp-2); margin:0 0 var(--sp-5); }
.cv-livelink { font-family:var(--font-mono); font-size:var(--fs-mono-xs); letter-spacing:var(--tracking-mono-md); text-transform:uppercase; }

/* lightbox */
.cv-lightbox { position:fixed; inset:0; background:rgba(0,0,0,.93); display:none; align-items:center; justify-content:center; z-index:1000; }
.cv-lightbox.is-open { display:flex; }
.cv-lightbox img { max-width:92vw; max-height:82vh; object-fit:contain; }
.cv-lb-btn { position:absolute; background:transparent; border:1px solid rgba(255,255,255,.4); color:#fff; font-size:20px; width:48px; height:48px; cursor:pointer; }
.cv-lb-close { top:24px; right:24px; }
.cv-lb-prev { left:24px; top:50%; transform:translateY(-50%); }
.cv-lb-next { right:24px; top:50%; transform:translateY(-50%); }

@media (max-width:720px) {
  .cv-project-head { grid-template-columns:72px 1fr auto; gap:var(--sp-4); }
  .cv-thumb { width:72px; height:56px; }
}
@media (prefers-reduced-motion:reduce) {
  .cv-thumb, .cv-gallery img, .cv-filter button { transition:none; }
}
```

- [ ] **Step 2: Verify** the page still renders (no CSS syntax error). Run the render script; confirm existing sections unaffected. If a token is undefined (e.g. `--dur-med`, `--color-text-secondary`, `--lh-body-loose`, `--max-prose`), confirm it exists in `css/ap-tokens.css` via `rg -n "<token>" css/ap-tokens.css`; substitute the nearest existing token if missing.

- [ ] **Step 3: Commit**
```bash
git add skills/chad-martin-resume.html
git commit -m "feat(resume): add interactive project-card, filter, lightbox CSS"
```

---

## Task 3: §01 SELECTED WORK markup (filter + 10 cards)

**Files:**
- Modify: `skills/chad-martin-resume.html` (replace the §01 FEATURED PROJECTS section)

- [ ] **Step 1: Replace the §01 section** (`<section class="ap-sec ap-sec--cool">` … the FEATURED PROJECTS block, lines ~79-92) with the filter bar + a `.cv-projects` container. Section head:
```html
<section class="ap-sec ap-sec--cool">
  <div class="ap-sec-head">
    <div>
      <div class="ap-sec-idx">&sect; 01 &middot; SELECTED WORK</div>
      <h2 class="ap-display">Ten projects, <em>one throughline.</em></h2>
    </div>
    <div class="ap-sec-meta">Xbox support, storefront tooling, data, and video. Expand any card for the full case study.</div>
  </div>
  <div class="cv-filter" role="group" aria-label="Filter projects by category">
    <button type="button" data-filter="all" aria-pressed="true">All</button>
    <button type="button" data-filter="web" aria-pressed="false">Web</button>
    <button type="button" data-filter="ai" aria-pressed="false">AI &amp; Data</button>
    <button type="button" data-filter="video" aria-pressed="false">Video</button>
    <button type="button" data-filter="design" aria-pressed="false">Design</button>
  </div>
  <div class="cv-projects">
    <!-- 10 cv-project cards here (Step 3) -->
  </div>
</section>
```

- [ ] **Step 2: Card template** — every card follows this exact structure (image-gallery variant shown; icon variant swaps the `<img class="cv-thumb">` for `<span class="cv-thumb cv-thumb--icon"><i class="fas fa-…"></i></span>` and omits `.cv-gallery`):
```html
<article class="cv-project" data-cat="CAT">
  <button type="button" class="cv-project-head" aria-expanded="false" aria-controls="p-SLUG">
    <img class="cv-thumb" src="THUMB" alt="TITLE" loading="lazy">
    <span>
      <span class="cv-project-title">TITLE_HTML</span>
      <span class="cv-project-role">ROLE_LINE</span>
      <span class="cv-project-heads">
        <span class="cv-chip cv-cat">CAT_LABEL</span>
        <span class="cv-chip">METRIC_1</span>
        <span class="cv-chip">METRIC_2</span>
      </span>
    </span>
    <span class="cv-project-toggle">View case study <span>&rsaquo;</span></span>
  </button>
  <div class="cv-project-body" id="p-SLUG" role="region">
    <p>STORY</p>
    <div class="cv-metrics">
      <div class="cv-metric"><b>M1_BIG</b><span>M1_LABEL</span></div>
      <!-- repeat metrics -->
    </div>
    <!-- VIDEO (video cards only): <div class="cv-video"><iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" title="TITLE" allowfullscreen loading="lazy"></iframe></div> -->
    <div class="cv-gallery">
      <button type="button" data-full="IMG_PATH"><img src="IMG_PATH" alt="CAPTION" loading="lazy"></button>
      <!-- repeat gallery buttons -->
    </div>
    <div class="cv-tools">
      <span class="cv-chip">TOOL</span><!-- repeat -->
    </div>
    <!-- LIVE (where public): <a class="cv-livelink ap-link-mono" href="LIVE_URL" target="_blank" rel="noopener noreferrer">View live &rarr;</a> -->
  </div>
</article>
```

- [ ] **Step 3: Build all 10 cards** from the template using this content table. All copy past tense, no em dashes, Hanson framing. Role line for Xbox cards: `Producer &middot; Microsoft Xbox &middot; via Hanson Consulting Group`. Gallery images: use the numbered files in each folder (screen-01..NN); alt text = short caption. Full image lists are in the spec.

| # | slug | cat | title (HTML) | thumb | headline metrics | live |
|---|---|---|---|---|---|---|
| 1 | xbox-support | web | `Xbox <em>Support.</em>` | `/images/projects/xbox-support/screen-01.jpeg` | 32M+ monthly users · 40+ languages · WCAG 2.1 AA | support.xbox.com |
| 2 | content-packager | ai | `Content <em>Packager.</em>` | icon `fa-boxes-packing` | 122 locales · 5 surfaces · 2 CMSs | — |
| 3 | copilot-playground | ai | `Copilot <em>Playground.</em>` | icon `fa-robot` | 22 models · 10× speed · 98.9% accuracy | — |
| 4 | grand-central | ai | `Grand Central <em>3.0.</em>` | `/images/projects/grand-central/gc-dashboard.jpg` | 7,490 assets · 500K+ links · weekly refresh | — |
| 5 | xbox-support-app | video | `Xbox Support <em>App.</em>` | `/images/projects/video/xbox-support-thumbnail.jpg` | 30M+ users · 35% fewer calls · 45% faster | video: JwpnzA3LRkM |
| 6 | hellblade | video | `Hellblade, <em>Ninja Theory.</em>` | `/images/projects/ninja-theroy/mini-hero.jpg` | 1M+ users · 35% fewer tickets · +85% awareness | video: zhcM5tEaSfM |
| 7 | gears-of-war | web | `Gears of <em>War.</em>` | `/images/projects/gow/screen-01.jpeg` | 28+ articles · 40+ languages · 12-hr deploys | support.xbox.com/game/gears-of-war |
| 8 | south-of-midnight | web | `South of <em>Midnight.</em>` | `/images/projects/SoM/hero-03.jpg` | 40+ languages · 100% WCAG AA · 0 critical | — |
| 9 | casual-games | web | `Microsoft <em>Casual Games.</em>` | `/images/projects/microsoft-casual-games/hero-card.png` | 12+ titles · 100% a11y · zero downtime | — |
| 10 | figma-fleet | design | `Figma <em>Fleet.</em>` | `/images/projects/figma-fleet/figma-fleet-1.png` | 12 trained · 40% faster onboarding · 10+ walkthroughs | — |

Story text per card = the one/two-sentence story in the spec's "Project set" section (already em-dash-free, Hanson-framed). Figma Fleet role line: `Contract UX designer &middot; Microsoft &middot; via Hanson Consulting Group`.

- [ ] **Step 4: Verify** render: 10 collapsed cards + filter bar visible; thumbnails load (icons for cards 2 and 3). Run em-dash + framing checks.

- [ ] **Step 5: Commit**
```bash
git add skills/chad-martin-resume.html
git commit -m "feat(resume): inline 10 interactive project cards from sidelined Xbox pages"
```

---

## Task 4: resume.js (accordion + filter + lightbox)

**Files:**
- Create: `skills/resume.js`
- Modify: `skills/chad-martin-resume.html` (add `<script defer src="/skills/resume.js"></script>` before `</body>`)

- [ ] **Step 1: Create `skills/resume.js`:**
```js
(function () {
  'use strict';

  // Accordion
  document.querySelectorAll('.cv-project-head').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.cv-project');
      var open = card.getAttribute('data-open') === 'true';
      card.setAttribute('data-open', String(!open));
      btn.setAttribute('aria-expanded', String(!open));
    });
  });

  // Category filter
  var filterBtns = document.querySelectorAll('.cv-filter button');
  filterBtns.forEach(function (fb) {
    fb.addEventListener('click', function () {
      var cat = fb.getAttribute('data-filter');
      filterBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b === fb)); });
      document.querySelectorAll('.cv-project').forEach(function (card) {
        var show = cat === 'all' || card.getAttribute('data-cat') === cat;
        card.hidden = !show;
      });
    });
  });

  // Lightbox
  var imgs = [];
  var idx = 0;
  var lb = document.createElement('div');
  lb.className = 'cv-lightbox';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Image viewer');
  lb.innerHTML = '<button class="cv-lb-btn cv-lb-close" aria-label="Close">✕</button>' +
    '<button class="cv-lb-btn cv-lb-prev" aria-label="Previous">‹</button>' +
    '<img alt="">' +
    '<button class="cv-lb-btn cv-lb-next" aria-label="Next">›</button>';
  document.body.appendChild(lb);
  var lbImg = lb.querySelector('img');
  var lastFocus = null;

  function show(i) {
    idx = (i + imgs.length) % imgs.length;
    lbImg.src = imgs[idx].full;
    lbImg.alt = imgs[idx].alt;
  }
  function openLb(list, i, trigger) {
    imgs = list; lastFocus = trigger;
    lb.classList.add('is-open');
    show(i);
    lb.querySelector('.cv-lb-close').focus();
    document.addEventListener('keydown', onKey);
  }
  function closeLb() {
    lb.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    if (lastFocus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowRight') show(idx + 1);
    else if (e.key === 'ArrowLeft') show(idx - 1);
    else if (e.key === 'Tab') { e.preventDefault(); } // simple focus trap: keep focus in dialog
  }
  lb.querySelector('.cv-lb-close').addEventListener('click', closeLb);
  lb.querySelector('.cv-lb-next').addEventListener('click', function () { show(idx + 1); });
  lb.querySelector('.cv-lb-prev').addEventListener('click', function () { show(idx - 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });

  document.querySelectorAll('.cv-gallery').forEach(function (gal) {
    var buttons = Array.prototype.slice.call(gal.querySelectorAll('button[data-full]'));
    var list = buttons.map(function (b) {
      return { full: b.getAttribute('data-full'), alt: b.querySelector('img') ? b.querySelector('img').alt : '' };
    });
    buttons.forEach(function (b, i) {
      b.addEventListener('click', function () { openLb(list, i, b); });
    });
  });
})();
```

- [ ] **Step 2: Add the script tag** before `</body>` in the HTML.

- [ ] **Step 3: Verify interactivity** with a Playwright interaction script (in scratchpad): expand card 1 (assert `.cv-project-body` visible + `aria-expanded="true"`), click a `.cv-gallery button` (assert `.cv-lightbox.is-open` present + `img.src` set), press Escape (assert closed), click filter "video" (assert only `data-cat="video"` cards visible). Screenshot an expanded card.

- [ ] **Step 4: Commit**
```bash
git add skills/resume.js skills/chad-martin-resume.html
git commit -m "feat(resume): accordion, category filter, and image lightbox"
```

---

## Task 5: §02 EXPERIENCE rebuild

**Files:**
- Modify: `skills/chad-martin-resume.html` (§02 section)

- [ ] **Step 1: Update the section head** (heading recount, no em dash):
```html
<div class="ap-sec-idx">&sect; 02 &middot; EXPERIENCE</div>
<h2 class="ap-display">Nearly three decades, <em>five chapters.</em></h2>
```

- [ ] **Step 2: Add the new current role** as the first `.cv-role` (present tense). Note the heading uses the comma form, no em dash:
```html
<div class="cv-role">
  <h3>Producer, Xbox Store<em>, Microsoft.</em></h3>
  <p class="meta">Hanson Consulting Group &middot; July 2025 &ndash; Present &middot; Seattle, WA (Remote)</p>
  <p>Produce and publish weekly promotional content for the Xbox Desktop and Mobile apps, high-visibility storefront surfaces within Microsoft&rsquo;s 500M+ player gaming ecosystem. Deliver localized, campaign-ready creative for major game launches, sales events, and seasonal beats across 100+ locales in every Xbox market worldwide.</p>
  <p>Built an internal tooling suite that automates Xbox Store creative production and localization. Designed and shipped the Content Packager, a Node.js engine and zero-dependency web app that transforms weekly merchandising campaigns into upload-ready packages for two CMSs across five storefront surfaces and up to 122 locales, reshaping dozens of campaigns into hundreds of localized slots in seconds with a human sign-off gate on everything that ships. Rounded out the suite with a browser-based editor for authoring and previewing localized store tiles, plus a readiness and QC dashboard that flags mismatches before publishing.</p>
  <p>Produce and animate developer tutorial videos for ID@Xbox, published on official Xbox channels, guiding studio partners through onboarding, tooling, and publishing workflows.</p>
</div>
```

- [ ] **Step 3: Replace the prior role** (was "Jun 2014 – present") with the updated past-tense version:
```html
<div class="cv-role">
  <h3>Producer, Xbox<em>, Microsoft.</em></h3>
  <p class="meta">Hanson Consulting Group &middot; June 2014 &ndash; July 2025 &middot; Kirkland, WA</p>
  <p>Microsoft Impact Award recipient for leadership in CMS migration and support platform innovation.</p>
  <p>Built and optimized Xbox support content across web, console, desktop, and mobile, reaching millions of players in 40+ languages. Led the end-to-end migration from Zendesk to Campsite CMS, delivering 100% content accuracy with zero downtime.</p>
  <p>Led AI initiatives through the Copilot Playground, using prompt engineering to scale and automate localized content creation and review. Integrated AI tools and custom agents into daily workflows, and supported leadership in bringing AI-driven improvements to the Xbox Support ecosystem.</p>
  <p>Shipped multiplatform help hubs for major studio titles, ensuring seamless global launches with consistent, localized support. Designed and published user flows for refunds and in-console game billboards. Produced animated videos to showcase team projects and strengthen internal training.</p>
  <p>Built Power BI dashboards and tooling pipelines that improved content visibility, reporting, and performance insights. Facilitated cross-functional workshops on support strategy, tooling, and UX, including hands-on Figma design reviews.</p>
</div>
```

- [ ] **Step 4: Keep the three pre-2014 roles** (Denny Mountain Media, Filter, Additional roles) exactly as they are, but strip any em dashes from their `<h3>`/`<p>` content (replace `&mdash;`/`—` with commas or colons; `&ndash;` in date ranges stays).

- [ ] **Step 5: Verify** render + tense (new role present, prior role past) + em-dash check on §02.

- [ ] **Step 6: Commit**
```bash
git add skills/chad-martin-resume.html
git commit -m "feat(resume): add Xbox Store role, update prior role to past tense, recount chapters"
```

---

## Task 6: Remaining sections polish + em-dash sweep

**Files:**
- Modify: `skills/chad-martin-resume.html` (§03 SKILLS, §04 AWARDS, §05 EDUCATION, CTA, footer, all eyebrows)

- [ ] **Step 1: §03 SKILLS** — update eyebrow to `&sect; 03 &middot; SKILLS`; recount heading if needed. Add to the "AI &amp; automation" and "Web development" groups: `Node.js`, `JavaScript automation`, `Zero-dependency web apps`, `Content packaging pipelines` (reflects the systems-building shift). Keep other groups.

- [ ] **Step 2: §04 / §05 / CTA / footer** — update eyebrows to middot form; strip every remaining em dash. The CTA line "Producer engagements, AI tooling, platform migrations, video content &mdash; all in the playbook." becomes: "Producer engagements, AI tooling, platform migrations, video content: all in the playbook."

- [ ] **Step 3: Global em-dash sweep** — Run `rg -n "—|&mdash;" skills/chad-martin-resume.html`. Expected: **no matches**. Fix any stragglers (commas/colons).

- [ ] **Step 4: Commit**
```bash
git add skills/chad-martin-resume.html
git commit -m "feat(resume): polish remaining sections, remove all em dashes"
```

---

## Task 7: Asset verification + final QA

**Files:**
- Modify: `skills/chad-martin-resume.html` (fix/remove any broken image refs)

- [ ] **Step 1: Verify every referenced image exists.** For each `src="/images/projects/..."` and `data-full="/images/..."` in the file, check the file exists on disk. Any missing image: remove that gallery item (do not ship a broken `<img>`); if a card's thumb is missing, fall back to an icon `cv-thumb--icon`. Command pattern: extract paths with `rg -o "/images/[^\"']+" skills/chad-martin-resume.html | sort -u` then `ls` each under `ambientpixels/`.

- [ ] **Step 2: Full framing + em-dash QA:**
  - `rg -n "—|&mdash;" skills/chad-martin-resume.html` → no matches.
  - `rg -ni "client|studio work|AmbientPixels client" skills/chad-martin-resume.html` → no Xbox-work hits (AmbientPixels brand in nav/footer chrome is allowed).
  - Confirm every Xbox card role line reads "via Hanson Consulting Group".

- [ ] **Step 3: Render desktop + mobile.** Screenshot at 1440px and 390px. Confirm: 10 cards, filter works, one expanded card shows metrics + gallery, lightbox opens/closes, video embeds present on cards 5 and 6, spacing clean, no layout breaks.

- [ ] **Step 4: Commit**
```bash
git add skills/chad-martin-resume.html
git commit -m "chore(resume): verify assets, final framing + accessibility QA"
```

---

## Self-Review (completed by author)

**Spec coverage:** hero+summary (T1), component CSS (T2), §01 gallery + 10 cards incl. Content Packager (T3), interactivity+a11y (T4), experience with both roles + tense (T5), skills/awards/edu/CTA + em-dash sweep (T6), asset + framing QA (T7). All spec sections mapped.

**Placeholder scan:** card bodies reference the spec's per-card content table (included inline in T3) + full image lists in the spec; template is complete. No "TBD"/"handle edge cases".

**Type/name consistency:** class names (`cv-project`, `cv-project-head`, `cv-project-body`, `cv-gallery`, `cv-lightbox`, `data-open`, `data-cat`, `data-full`, `aria-expanded`) are consistent between CSS (T2), markup (T3), and JS (T4). Filter values (`all/web/ai/video/design`) match `data-cat` in the card table.

**Em-dash safety:** every HTML code block in this plan was checked for `—`/`&mdash;`; the T5 heading blocks use the comma form. Task 6 Step 3 is the backstop grep.

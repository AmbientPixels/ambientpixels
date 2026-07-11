# AmbientScore Sample Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one fully-unlocked example AmbientScore report (built from a purpose-built fictional SaaS landing page), previewed by a live mini-card in the landing hero and viewable in full via the report page, to de-risk the $29 purchase and serve as shareable marketing.

**Architecture:** Build a self-contained fictional B2B SaaS page hosted on our domain, scan it once through the live pipeline to produce a stored report, then allowlist that report id in `as-report` so it renders fully unlocked. The landing hero's existing static scorecard is replaced with the real report's numbers (baked in) and made clickable; the report viewer shows a "sample" banner that funnels viewers back to the scanner.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework), Azure Functions (Node), `companyStorage` blob via `company-state`. Deploy = `git push origin master` → GitHub Actions. Node `assert` scripts under `scripts/` for unit tests.

---

## PATH CHANGE (2026-07-10, during execution)

The demo page is hosted at **`lab/oakroute.html`** (public URL **https://ambientpixels.ai/lab/oakroute.html**), NOT `ambientscore/sample.html`. Reason: `staticwebapp.config.json`'s `routes` array rewrites every unlisted `/ambientscore/*` path to `index.html`, and that file is high-blast-radius (do not edit). `/lab/*` is in `navigationFallback.exclude` and matches no route rule, so it serves static files directly with no config change. Substitute `lab/oakroute.html` / the lab URL wherever the tasks below say `ambientscore/sample.html`.

## Sequencing note (why order matters)

The page must be publicly live before it can be scanned, and the scan's `reportId` is needed by Tasks 3–4. So: Task 1 builds and deploys the page, Task 2 scans it and records the real `reportId`, and Tasks 3–5 consume that id. Do not reorder.

## File structure

- **Create** `ambientscore/sample.html` — the fictional "Oakroute" SaaS landing page (scan target). Self-contained, own inline CSS. Named `.html` (not a folder) so it serves like `report.html`, avoiding directory-index/navigation-fallback routing risk.
- **Create** `api/as-report/sampleReports.js` — tiny module: the sample-id allowlist + pure viewability predicate. One responsibility, unit-testable without loading the Azure handler.
- **Create** `scripts/test-as-report-sample.cjs` — node `assert` test for the predicate.
- **Modify** `api/as-report/index.js` — use the predicate to serve samples unlocked, and stamp `unlocked:true` + `isSample:true` on the sample response.
- **Modify** `ambientscore/index.html` — replace the static hero scorecard values with the real report's numbers and make the card link to the full sample report.
- **Modify** `ambientscore/js/report.js` — render a "sample" banner at the top of the full report when `report.isSample`.
- **Modify** `ambientscore/css/ambientscore.css` — only if a reused class needs a minor rule (checked in Task 5).

---

### Task 1: Build and deploy the demo target page

**Files:**
- Create: `ambientscore/sample.html`

- [ ] **Step 1: Confirm "oakroute.co" is safe to use as a fictional brand**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://oakroute.co`
Expected: a non-200 (000/404/timeout) indicating no real business site. If it returns 200 with a real company, choose a different invented brand (e.g. "Larkfield", "Tanager") and use it consistently everywhere below in place of "Oakroute"/"oakroute.co".

- [ ] **Step 2: Create the demo page**

Create `ambientscore/sample.html` with this exact content (a generic modern-SaaS landing with deliberately fixable weaknesses: vague headline, generic CTA, no pricing, thin/unnamed social proof, a 4-field form). It intentionally does NOT use AmbientScore or AmbientPixels styles.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oakroute</title>
  <meta name="description" content="Oakroute helps your team work smarter.">
  <style>
    :root { --brand:#4f46e5; --ink:#1f2430; --muted:#6b7280; --line:#e5e7eb; --bg:#ffffff; --soft:#f7f8fa; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); line-height: 1.5; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
    header.nav { border-bottom: 1px solid var(--line); }
    .nav-row { display: flex; align-items: center; justify-content: space-between; height: 64px; }
    .logo { font-weight: 700; font-size: 20px; color: var(--brand); }
    .nav-links a { color: var(--muted); text-decoration: none; margin-left: 22px; font-size: 14px; }
    .nav-links a.btn { color: #fff; background: var(--brand); padding: 8px 14px; border-radius: 6px; }
    .hero { text-align: center; padding: 84px 0 64px; }
    .hero h1 { font-size: 46px; line-height: 1.1; letter-spacing: -0.02em; margin-bottom: 18px; }
    .hero p { font-size: 19px; color: var(--muted); max-width: 620px; margin: 0 auto 28px; }
    .cta { display: inline-block; background: var(--brand); color: #fff; text-decoration: none; padding: 13px 26px; border-radius: 8px; font-size: 16px; font-weight: 600; }
    .cta.secondary { background: transparent; color: var(--brand); border: 1px solid var(--line); margin-left: 10px; }
    .logos { padding: 40px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); text-align: center; }
    .logos p { color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 22px; }
    .logo-row { display: flex; gap: 40px; justify-content: center; flex-wrap: wrap; }
    .logo-box { width: 108px; height: 34px; background: #e9ebf0; border-radius: 5px; }
    .features { padding: 72px 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; }
    .feature h3 { font-size: 19px; margin-bottom: 8px; }
    .feature p { color: var(--muted); font-size: 15px; }
    .quote { background: var(--soft); padding: 56px 0; text-align: center; }
    .quote blockquote { font-size: 22px; max-width: 720px; margin: 0 auto 14px; font-style: italic; }
    .quote cite { color: var(--muted); font-size: 14px; }
    .signup { padding: 72px 0; text-align: center; }
    .signup h2 { font-size: 30px; margin-bottom: 24px; }
    .form { max-width: 420px; margin: 0 auto; display: grid; gap: 12px; text-align: left; }
    .form label { font-size: 13px; color: var(--muted); }
    .form input, .form select { width: 100%; padding: 11px 12px; border: 1px solid var(--line); border-radius: 7px; font-size: 15px; }
    .form button { background: var(--brand); color: #fff; border: 0; padding: 13px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
    footer { border-top: 1px solid var(--line); padding: 40px 0; color: var(--muted); font-size: 14px; }
    .foot-row { display: flex; gap: 28px; flex-wrap: wrap; }
    .foot-row a { color: var(--muted); text-decoration: none; }
    @media (max-width: 760px) { .features { grid-template-columns: 1fr; } .hero h1 { font-size: 34px; } }
  </style>
</head>
<body>
  <header class="nav">
    <div class="wrap nav-row">
      <div class="logo">Oakroute</div>
      <nav class="nav-links">
        <a href="#features">Product</a>
        <a href="#">Solutions</a>
        <a href="#">Resources</a>
        <a href="#">Log in</a>
        <a href="#signup" class="btn">Get Started</a>
      </nav>
    </div>
  </header>

  <section class="hero">
    <div class="wrap">
      <h1>Analytics, reimagined.</h1>
      <p>Oakroute gives your team the insights it needs to move faster and work smarter.</p>
      <a href="#signup" class="cta">Get Started</a>
      <a href="#" class="cta secondary">Book a demo</a>
    </div>
  </section>

  <section class="logos">
    <div class="wrap">
      <p>Trusted by teams everywhere</p>
      <div class="logo-row">
        <div class="logo-box"></div>
        <div class="logo-box"></div>
        <div class="logo-box"></div>
        <div class="logo-box"></div>
      </div>
    </div>
  </section>

  <section class="features" id="features">
    <div class="wrap" style="display:contents;">
      <div class="feature">
        <h3>Beautiful dashboards</h3>
        <p>Powerful, flexible dashboards that give you a complete view of everything happening across your team.</p>
      </div>
      <div class="feature">
        <h3>Real-time data</h3>
        <p>Your numbers, always up to date. Oakroute syncs continuously so you are never looking at stale data.</p>
      </div>
      <div class="feature">
        <h3>Built for scale</h3>
        <p>From startups to enterprises, Oakroute grows with you. Robust, reliable, and ready for anything.</p>
      </div>
    </div>
  </section>

  <section class="quote">
    <div class="wrap">
      <blockquote>"Oakroute has completely changed the way our team works. We could not imagine going back."</blockquote>
      <cite>A happy customer</cite>
    </div>
  </section>

  <section class="signup" id="signup">
    <div class="wrap">
      <h2>Ready to get started?</h2>
      <form class="form" onsubmit="return false;">
        <div><label>Full name</label><input type="text" name="name" placeholder="Jane Doe"></div>
        <div><label>Work email</label><input type="email" name="email" placeholder="jane@company.com"></div>
        <div><label>Company</label><input type="text" name="company" placeholder="Company, Inc."></div>
        <div><label>Team size</label>
          <select name="teamsize"><option>1-10</option><option>11-50</option><option>51-200</option><option>200+</option></select>
        </div>
        <button type="submit">Get Started</button>
      </form>
    </div>
  </section>

  <footer>
    <div class="wrap foot-row">
      <a href="#">Product</a><a href="#">Pricing</a><a href="#">About</a><a href="#">Blog</a>
      <a href="#">Careers</a><a href="#">Contact</a><a href="#">Privacy</a><a href="#">Terms</a>
    </div>
  </footer>
</body>
</html>
```

- [ ] **Step 3: Verify the file has the elements the scraper reads**

Run: `grep -c -E "<h1|<h2|<h3|class=\"cta\"|<form|logo-box|blockquote" ambientscore/sample.html`
Expected: a count of at least 10 (headings, CTAs, form, social proof, testimonial all present).

- [ ] **Step 4: Commit and deploy**

```bash
git add ambientscore/sample.html
git commit -m "feat(ambientscore): add Oakroute demo landing page for sample audit"
git push origin master
```

- [ ] **Step 5: Wait for deploy, then verify the page is publicly reachable**

Run (poll until 200, deploy takes ~4-5 min):
`for i in $(seq 1 12); do c=$(curl -s -o /dev/null -w "%{http_code}" https://ambientpixels.ai/ambientscore/sample.html); echo "$c"; [ "$c" = "200" ] && break; sleep 30; done`
Expected: `200`. Also confirm it serves OUR page, not an app-shell fallback:
`curl -s https://ambientpixels.ai/ambientscore/sample.html | grep -c "Oakroute"`
Expected: `>= 1`. If it 404s or returns a different page, the static route is being caught by navigation fallback — inspect `staticwebapp.config.json` `navigationFallback.exclude` (do NOT edit without care) and report before proceeding.

---

### Task 2: Scan the demo page and record the reportId

**Files:** none (produces a stored report + a recorded id)

- [ ] **Step 1: Run a live scan of the demo page**

Run:
`curl -s -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/as-analyze" -H "Content-Type: application/json" -d '{"url":"https://ambientpixels.ai/ambientscore/sample.html"}' --max-time 280`
Expected: JSON with `reportId`, `score`, `grade`, `totalFindings`, and 3 `teaserFindings`. The scan takes ~140-210s.

- [ ] **Step 2: Check the score is in a good sample band and record the id**

Read the response. Target: score roughly 55-78 (C/B- range) with `totalFindings >= 15` and specific teaser findings.
- If score is too high (> 82, boring) or too low (< 45, harsh) or findings are thin: weaken/strengthen the demo page accordingly (e.g. add a clearer benefit to raise it, or make the headline vaguer to lower it), re-commit, re-deploy (Task 1 Steps 4-5), and re-scan. Repeat until in band.
- Record the final `reportId` value (looks like `ccr_1783...._xxxxxxxx`). This id is used verbatim in Tasks 3 and 4. Write it down here: `SAMPLE_REPORT_ID = <record it>`.

- [ ] **Step 3: Confirm the report is stored and currently locked (teaser)**

Run (substitute the recorded id):
`curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/as-report?id=<SAMPLE_REPORT_ID>" | grep -o '"unlocked":[a-z]*'`
Expected: `"unlocked":false` (proves it is stored and the paywall is currently active — Task 3 flips this for samples).

---

### Task 3: Serve the sample report unlocked (backend)

**Files:**
- Create: `api/as-report/sampleReports.js`
- Create: `scripts/test-as-report-sample.cjs`
- Modify: `api/as-report/index.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-as-report-sample.cjs`:

```js
const assert = require('assert');
const { SAMPLE_REPORT_IDS, isSample, isFullyViewable } = require('../api/as-report/sampleReports');

// The allowlist must contain at least one real sample id.
assert.ok(SAMPLE_REPORT_IDS.size >= 1, 'expected at least one sample id');
const sampleId = [...SAMPLE_REPORT_IDS][0];

// Paid/unlocked reports are viewable regardless of id.
assert.strictEqual(isFullyViewable({ unlocked: true }, 'ccr_notasample'), true);
// Locked, non-sample reports are NOT viewable (teaser).
assert.strictEqual(isFullyViewable({ unlocked: false }, 'ccr_notasample'), false);
// Locked reports whose id is on the allowlist ARE viewable (the sample).
assert.strictEqual(isFullyViewable({ unlocked: false }, sampleId), true);
// isSample reflects the allowlist.
assert.strictEqual(isSample(sampleId), true);
assert.strictEqual(isSample('ccr_notasample'), false);

console.log('as-report sample gate: all assertions passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-as-report-sample.cjs`
Expected: FAIL with `Cannot find module '../api/as-report/sampleReports'`.

- [ ] **Step 3: Create the module (use the real recorded id from Task 2)**

Create `api/as-report/sampleReports.js` (replace the placeholder id with `SAMPLE_REPORT_ID` from Task 2 Step 2):

```js
// Sample report allowlist. Ids listed here bypass the paywall and render fully.
// Refresh procedure: re-scan the demo page (ambientscore/sample.html), then replace
// the id below AND the id baked into ambientscore/index.html's hero mini-card.
// See docs/superpowers/specs/2026-07-10-ambientscore-sample-audit-design.md
const SAMPLE_REPORT_IDS = new Set([
  'ccr_REPLACE_WITH_REAL_ID_FROM_TASK_2'
]);

function isSample(id) {
  return SAMPLE_REPORT_IDS.has(id);
}

// A report is fully viewable if it was unlocked (paid) or it is an allowlisted sample.
function isFullyViewable(report, id) {
  return !!(report && report.unlocked) || isSample(id);
}

module.exports = { SAMPLE_REPORT_IDS, isSample, isFullyViewable };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-as-report-sample.cjs`
Expected: `as-report sample gate: all assertions passed`.

- [ ] **Step 5: Wire the predicate into the handler**

In `api/as-report/index.js`, add the require near the top (after the existing `const storage = require('../_utils/companyStorage');` line):

```js
const { isSample, isFullyViewable } = require('./sampleReports');
```

Then replace the lock gate. Change:

```js
    // If report is locked, return teaser only
    if (!report.unlocked) {
```

to:

```js
    // If report is locked and not an allowlisted sample, return teaser only
    if (!isFullyViewable(report, id)) {
```

And replace the full-report response block:

```js
    // Full report
    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify(report)
    };
```

with (stamp `unlocked:true` + `isSample` so the frontend renders full and can show the sample banner; does not mutate stored blob):

```js
    // Full report. For samples, force unlocked and flag isSample for the viewer.
    const fullBody = isSample(id)
      ? Object.assign({}, report, { unlocked: true, isSample: true })
      : report;
    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify(fullBody)
    };
```

- [ ] **Step 6: Syntax-check, commit, deploy**

```bash
node --check api/as-report/index.js && node --check api/as-report/sampleReports.js
git add api/as-report/sampleReports.js api/as-report/index.js scripts/test-as-report-sample.cjs
git commit -m "feat(ambientscore): serve allowlisted sample report unlocked"
git push origin master
```

- [ ] **Step 7: Verify the sample now returns the full report**

Run after deploy (~4-5 min; substitute the id):
`curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/as-report?id=<SAMPLE_REPORT_ID>" | grep -o -E '"unlocked":[a-z]*|"isSample":[a-z]*|"synthesis"'`
Expected: `"unlocked":true`, `"isSample":true`, and `"synthesis"` present (full report, not teaser). A non-sample locked id must still return `"unlocked":false` — verify with any other report id if available.

---

### Task 4: Replace the hero static scorecard with the live sample mini-card

**Files:**
- Modify: `ambientscore/index.html` (the `<aside class="as-scorecard">` block, lines ~86-126)

- [ ] **Step 1: Get the real numbers from the sample report**

Run (substitute the id):
`curl -s "https://ambientpixels-nova-api.azurewebsites.net/api/as-report?id=<SAMPLE_REPORT_ID>" | python -c "import sys,json; d=json.load(sys.stdin); print('score',d['score'],'grade',d['grade']); [print(k, round(v.get('score',0)), v.get('label')) for k,v in list(d.get('dimensions',{}).items())[:6]]"`
Record: the overall `score`, `grade`, and the first six dimensions' `label` + `score`. These replace the hard-coded mockup numbers.

- [ ] **Step 2: Replace the scorecard content and make it a link**

In `ambientscore/index.html`, replace the entire `<aside class="as-scorecard" ...> ... </aside>` block (currently the oakroute.co/C/62 mockup, lines ~86-126) with the real values below. Wrap the card in an anchor to the full report so it is clickable. Substitute `<SAMPLE_REPORT_ID>` and the recorded numbers (the example values shown are illustrative — use the real ones):

```html
        <a class="as-scorecard as-scorecard-link" href="/ambientscore/report.html?id=SAMPLE_REPORT_ID" aria-label="View the full sample audit report">
          <div class="as-sc-stamp">Live . Sample</div>
          <div class="as-sc-top">
            <div>
              <div class="as-sc-type">Conversion Audit . Form SC-1</div>
              <div class="as-sc-title">oakroute.co</div>
            </div>
            <div class="as-sc-ref">
              Sample<br>
              Real report
            </div>
          </div>

          <div class="as-sc-grade-row">
            <div class="as-sc-letter">GRADE</div>
            <div class="as-sc-right">
              <div>
                <div class="as-sc-score-line">SCORE<sub>/100</sub></div>
                <div class="as-sc-verdict">
                  Verdict
                  <b>See full report</b>
                </div>
              </div>
              <div class="as-sc-delta">Generated by AmbientScore</div>
            </div>
          </div>

          <div>
            <div class="as-sc-dim"><span class="as-sc-dim-name">DIM1_NAME</span><span class="as-sc-dim-bar"><span style="width:DIM1_PCT%"></span></span><span class="as-sc-dim-score">DIM1_SCORE</span></div>
            <div class="as-sc-dim"><span class="as-sc-dim-name">DIM2_NAME</span><span class="as-sc-dim-bar"><span style="width:DIM2_PCT%"></span></span><span class="as-sc-dim-score">DIM2_SCORE</span></div>
            <div class="as-sc-dim"><span class="as-sc-dim-name">DIM3_NAME</span><span class="as-sc-dim-bar"><span style="width:DIM3_PCT%"></span></span><span class="as-sc-dim-score">DIM3_SCORE</span></div>
            <div class="as-sc-dim"><span class="as-sc-dim-name">DIM4_NAME</span><span class="as-sc-dim-bar"><span style="width:DIM4_PCT%"></span></span><span class="as-sc-dim-score">DIM4_SCORE</span></div>
            <div class="as-sc-dim"><span class="as-sc-dim-name">DIM5_NAME</span><span class="as-sc-dim-bar"><span style="width:DIM5_PCT%"></span></span><span class="as-sc-dim-score">DIM5_SCORE</span></div>
            <div class="as-sc-dim"><span class="as-sc-dim-name">DIM6_NAME</span><span class="as-sc-dim-bar"><span style="width:DIM6_PCT%"></span></span><span class="as-sc-dim-score">DIM6_SCORE</span></div>
          </div>

          <div class="as-sc-foot">
            <span>Prepared by AmbientScore</span>
            <span>View full report &rsaquo;</span>
          </div>
        </a>
```

Notes for substitution: `GRADE` and `SCORE` are the real overall values; `DIMn_NAME` is the dimension label; `DIMn_SCORE` is its 0-100 score; `DIMn_PCT` equals `DIMn_SCORE` (bar width). Keep the `oakroute.co` display title (matches the demo brand). Do not introduce em dashes.

- [ ] **Step 3: Add minimal CSS so the linked card looks/behaves like the old aside**

First check whether a rule is even needed:
Run: `grep -n "as-scorecard" ambientscore/css/ambientscore.css | head`
The `.as-scorecard` block already styles the card. Because the element is now an `<a>`, add ONE small rule so link styling does not leak in. Append to `ambientscore/css/ambientscore.css`:

```css
/* Sample scorecard rendered as a link */
.as-scorecard-link { display: block; text-decoration: none; color: inherit; cursor: pointer; transition: transform 0.15s ease; }
.as-scorecard-link:hover { transform: translateY(-2px); }
```

- [ ] **Step 4: Commit and deploy**

```bash
git add ambientscore/index.html ambientscore/css/ambientscore.css
git commit -m "feat(ambientscore): replace hero mockup with live sample scorecard link"
git push origin master
```

- [ ] **Step 5: Verify rendered output**

After deploy, load `https://ambientpixels.ai/ambientscore/` in the webapp-testing (Playwright) browser. Confirm: the hero scorecard shows the real grade/score/dimensions (not 62/C), clicking it navigates to `report.html?id=<SAMPLE_REPORT_ID>`, and there is no link-blue text or underline on the card. Capture a screenshot.

---

### Task 5: Sample banner in the report viewer

**Files:**
- Modify: `ambientscore/js/report.js` (`renderFullReport`, after `var html = '';` at line ~311)
- Modify: `ambientscore/css/ambientscore.css` (only if `.as-pack-banner` needs a link tweak)

- [ ] **Step 1: Check the reusable banner class exists**

Run: `grep -n "as-pack-banner" ambientscore/css/ambientscore.css`
Expected: a rule exists (used by the 3-pack banner). We reuse it for the sample banner to avoid new CSS.

- [ ] **Step 2: Add the sample banner to renderFullReport**

In `ambientscore/js/report.js`, find in `renderFullReport`:

```js
    var findings = report.findings || [];
    var html = '';

    // Pack banner
```

Insert the sample banner immediately after `var html = '';` and before the `// Pack banner` comment:

```js
    var findings = report.findings || [];
    var html = '';

    // Sample banner
    if (report.isSample) {
      html += '<div class="as-pack-banner">';
      html += '<span>Sample audit. A real report generated by AmbientScore.</span>';
      html += '<a href="/ambientscore/">Scan your own site &rsaquo;</a>';
      html += '</div>';
    }

    // Pack banner
```

- [ ] **Step 3: Ensure the banner link is legible on the pack-banner background**

Run: `grep -n "as-pack-banner a" ambientscore/css/ambientscore.css`
If NO rule is returned, append to `ambientscore/css/ambientscore.css`:

```css
/* Sample banner link (reuses .as-pack-banner) */
.as-pack-banner a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
```

If a rule already exists, leave it.

- [ ] **Step 4: Commit and deploy**

```bash
git add ambientscore/js/report.js ambientscore/css/ambientscore.css
git commit -m "feat(ambientscore): sample banner funnels report viewers to the scanner"
git push origin master
```

- [ ] **Step 5: Verify rendered output**

After deploy, load `https://ambientpixels.ai/ambientscore/report.html?id=<SAMPLE_REPORT_ID>` in the Playwright browser. Confirm: the full report renders (all dimensions, findings, rewrites — NOT the paywall), a "Sample audit" banner shows at the top with a working "Scan your own site ›" link back to `/ambientscore/`, and no "Unlock full report . $29" buy button appears. Capture a screenshot.

---

### Task 6: End-to-end verification

**Files:** none

- [ ] **Step 1: Full-flow check**

In the Playwright browser: start at `https://ambientpixels.ai/ambientscore/`, click the hero sample scorecard, confirm it lands on the full unlocked report with the sample banner, then click "Scan your own site ›" and confirm it returns to the scanner landing.

- [ ] **Step 2: Constraint check**

Confirm no em dashes were introduced in any edited user-visible string, no `!important` was added, and no new `as-*` class duplicates an existing one:
Run: `grep -nE "\xE2\x80\x94|!important" ambientscore/index.html ambientscore/sample.html ambientscore/js/report.js` (the demo page `sample.html` is exempt from the editorial em-dash rule since it is a fictional third-party page, but it has none anyway).
Expected: no matches in `index.html` or `report.js`.

- [ ] **Step 3: Regression check on a normal (non-sample) report**

Confirm the paywall still works for ordinary reports: run a fresh scan of any site, take its `reportId`, and load `report.html?id=<that id>` — it must show the paywall (locked), proving the allowlist did not unlock everything.

---

## Self-review

**Spec coverage:**
- Demo target page → Task 1. ✓
- Make report permanently viewable (allowlist in as-report) → Task 3. ✓
- Link from landing → Task 4 (the live mini-card is itself the link; supersedes the separate "See a sample audit" link per the CEO's "replace with live mini-card" decision). ✓
- Sample-viewer banner → Task 5. ✓
- Two-deploy sequencing → enforced by task order + explicit note. ✓
- Score tuning → Task 2 Step 2. ✓
- Testing/verification → Tasks 5-6 (rendered) + Task 3 (unit) + Task 2 (scan). ✓
- Persistence/refresh note → captured in `sampleReports.js` header comment. ✓

**Placeholder scan:** The only intentional fill-ins are `<SAMPLE_REPORT_ID>` and the recorded dimension numbers, which are produced by Task 2 and consumed verbatim in Tasks 3-4 (unavoidable — the id does not exist until the scan runs). Every code block is otherwise complete.

**Type/name consistency:** `isSample`, `isFullyViewable`, `SAMPLE_REPORT_IDS` are defined in `sampleReports.js` (Task 3 Step 3) and used consistently in the test (Step 1), the handler (Step 5), and referenced by the `report.isSample` flag in report.js (Task 5 Step 2) which is set by the handler's `isSample(id)` response stamp. Consistent.

**Deviation from spec:** the spec described a separate quiet "See a sample audit ›" text link near the hero CTA. The CEO chose "replace the static hero scorecard with a live mini-card," so the clickable mini-card replaces that separate link. The report-viewer banner still links back to the scanner. This is the only change and it is intentional.

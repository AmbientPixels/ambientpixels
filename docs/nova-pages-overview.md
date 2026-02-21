# Nova Pages — Design Overview & Review Brief

**Prepared for:** Consultant Designer Review  
**Date:** Feb 21, 2026  
**Scope:** All active pages under `/nova/`  
**Brand Accent:** Purple `#a78bfa` on dark `#071019`

---

## Sitemap

```
/nova/                  ← Landing page (public)
/nova/preview.html      ← Operations preview (public)
/nova/agents.html       ← Agent roster (public)
/nova/dashboard.html    ← Internal dashboard (noindex)
/nova/awareness.html    ← System context (noindex)
/nova/logs.html         ← Founder log (noindex)
```

### Secondary / Legacy (not in active nav)

```
/nova/about.html        ← Nova bio page
/nova/core.html         ← Core systems console (legacy)
/nova/nova-vision.html  ← Image generation demo (legacy)
/nova/lore/             ← 10 narrative lore pages (legacy)
/nova/ai-mood-demo.html ← Mood demo (legacy)
/nova/mood-demo.html    ← Mood demo v1 (legacy)
/nova/mood-demo-V2.html ← Mood demo v2 (legacy)
/nova/twitch-background.html ← Twitch overlay (utility)
```

---

## 1. `/nova/index.html` — Nova Landing Page

**Audience:** Public  
**Purpose:** Introduce Nova as Prime Operator. Gateway to all sub-pages.  
**Hero:** Full mini-hero with CTA buttons ("Open Operator Console", "Explore GridOS")

### Sections

| Section | Description | Data Source |
|---|---|---|
| **Operator Overview** | One-liner about Nova's role | Static |
| **Operator Console (Demo)** | Live AI chat interface with quick prompts | NovaSoul + Gemini API |
| **Daily System Brief** | Structured brief of system activity | operator-brief.js |
| **Operator Tools** | 6 card grid linking to sub-pages | Static |

### Scripts
`nova-soul.js`, `operator-brief.js`, `nova-chat-ui.js`

### Issues / Recommendations

- **Body class `nova-home`** — still uses legacy class; should align to `data-theme="dark"` with `background:#071019` like other pages
- **Banner container** still present — other pages have removed it
- **CSS includes** `nova.css`, `nova-chat.css`, `nova-logs.css` — unique to this page but naming is legacy ("logs" = brief engine)
- **Chat avatar image** references "cosmic system diagram" filename — consider renaming
- **No nav footer** — only page without horizontal sibling nav links at bottom
- **Icon style is aligned** — already uses Cloudflare-style inline SVGs for section headings and tool cards

---

## 2. `/nova/preview.html` — Operations Preview

**Audience:** Public  
**Purpose:** Live operational snapshot. Shows real system data, not marketing copy. Distinct from `/modules/company/demo.html` which is the GridOS marketing page.  
**Hero:** "Operations Preview" — "Live snapshot from the GridOS multi-agent operating system."

### Sections

| Section | Description | Data Source |
|---|---|---|
| **System Status** | 4-cell grid: Version, Build, Operator State, Last Sync | `version.json` + `mood-scan.json` |
| **Recent Activity** | Feed of 5 most recent published daily log entries | `/api/dailyLog` |
| **Company Hierarchy** | Tiered org chart: CEO → Nova → 6 dept heads → Quill sub-agent | Static (from `company-agents.json` schema) |
| **Deep Links** | Buttons to GridOS Overview, Activity Log, Agent Roster | Static |
| **Nav Footer** | Horizontal links to sibling pages | Static |

### Scripts
Inline `<script>` only (no external JS files)

### Design Notes
- **Most refined page** — cleanest layout, purple accent throughout, Cloudflare SVG icons
- Self-contained styles (no external dashboard CSS)
- Hierarchy view has visual connector lines between tiers
- Quill nested under Scribe with left-border indent

### Issues / Recommendations

- **Status panel could show more** — consider adding "Agents Online" count or "Last Heartbeat" timestamp from the agent runtime
- **Activity feed empty on local** — `/api/dailyLog` only works in production; consider a static fallback for dev
- **Hierarchy is hardcoded** — could dynamically load from `company-agents.json` for future-proofing
- **No ticker** — dashboard and awareness have scrolling tickers; this page intentionally skips it (cleaner), but worth discussing consistency

---

## 3. `/nova/agents.html` — Agent Roster

**Audience:** Public  
**Purpose:** Public-safe agent profile cards showing mandate, ownership, and status.  
**Hero:** "Agent Roster (Preview)" — "A structured view of the autonomous team operating within GridOS."

### Sections

| Section | Description | Data Source |
|---|---|---|
| **Intro** | "GridOS Agent Team" with overview paragraph | Static |
| **Agent Cards** | 8 cards in 2-column grid (Nova, Forge, Cipher, Pixel, Echo, Scribe, Scout, Quill) | Static HTML |
| **CTA** | Operations Preview + GridOS Overview buttons | Static |
| **Nav Footer** | Horizontal links to sibling pages | Static |

### Scripts
None beyond core (init-header-footer, main, nav, theme)

### Issues / Recommendations

- **Cards are plain** — no icons, no agent colors, no tier badges. Every other page uses branded icons per agent. These cards should get the same treatment (icon + color accent per agent)
- **Tier labels are wrong** — Nova listed as "Tier 1", Forge/Cipher as "Tier 2", Pixel/Echo as "Tier 3". Actual hierarchy: CEO=T1, Nova=T2, all dept heads=T3, Quill=T4
- **No status indicators** — cards show static text like "Monitoring", "Building", "Scanning" but these aren't pulled from live data
- **Layout uses `grid-container`** — the only Nova page using the old grid-container + grid-col-6 pattern instead of custom layout. Makes it look different from siblings
- **Agent descriptions are generic** — could be tighter, more action-oriented
- **Missing: CEO card** — Pixelpusher (human founder) isn't represented here but is on the preview.html hierarchy

---

## 4. `/nova/dashboard.html` — Internal Dashboard

**Audience:** Internal (noindex)  
**Purpose:** Operational telemetry, system status, API health, memory stats.  
**Hero:** "Internal Dashboard" — "Operational telemetry, system status, and execution tools."

### Sections

| Section | Description | Data Source |
|---|---|---|
| **Scrolling Ticker** | "GRIDOS internal mode active" + system labels | Static |
| **Nova System Status** | 3 status cards: Nova Core, API Services, Memory Systems | `nova-status.js` + API health checks |
| **Daily System Brief Archive** | Brief history feed | `operator-brief.js` |
| **Memory & Activity** | 6-cell metric grid: chats, turns, snapshots, logs, briefs, days active | `NovaSoul.getMemoryStats()` |
| **System Info** | Key-value list: version, build, sync, state, aura, voice mode | `version.json` + `mood-scan.json` |
| **API Health** | Grid of API endpoint status dots with refresh button | `api-status-dashboard.js` |
| **Nav Footer** | Horizontal links to sibling pages | Static |

### Scripts
`nova-soul.js`, `nova-status.js`, `api-status-dashboard.js`, `operator-brief.js`, `nova-telemetry-logger.js`

### Issues / Recommendations

- **Status section titles** still use `<h2>` without `dashboard-title` class — inconsistent font rendering with the other sections below
- **"Nova System Status" section** has its own `nova-status-grid` layout that differs from the rest of the page's patterns
- **Brief Archive section** reuses `nova-dream-feed` / `nova-dream-loading` class names from the legacy "dream" era — should be renamed for clarity
- **Memory & Activity panel** data is localStorage-only — will show zeros for new visitors. Consider adding a "local session data" disclaimer
- **API Health grid** renders dynamically and can look empty on first load — loading state could be improved
- **Ticker sits between hero and content** — spacing works but the ticker's original `margin: 96px auto 0` was for when there was no hero. Now overridden with `margin-top:0` inline style which is fragile

---

## 5. `/nova/awareness.html` — System Context

**Audience:** Internal (noindex)  
**Purpose:** Operator state diagnostics, memory persistence audit, awareness signal inventory.  
**Hero:** "System Context" — "Operator state, memory continuity, and awareness telemetry."

### Sections

| Section | Description | Data Source |
|---|---|---|
| **Scrolling Ticker** | "GRIDOS system context" + awareness labels | Static |
| **Memory & Activity** | Same 6-cell metric grid as dashboard | `NovaSoul.getMemoryStats()` |
| **System Info** | Same key-value list as dashboard | `version.json` + `mood-scan.json` |
| **Awareness Detections** | Table with 11 signals (8 live, 3 planned) showing source + status dot | Static |
| **Daily System Brief Feed** | Brief history | `operator-brief.js` |
| **Nav Footer** | Horizontal links to sibling pages | Static |

### Scripts
`nova-soul.js`, `nova-status.js`, `operator-brief.js`, `nova-telemetry-logger.js`

### Issues / Recommendations

- **Duplicates dashboard** — Memory & Activity, System Info, and Brief Feed sections are identical to dashboard.html. This page should either differentiate or consolidate
- **Awareness Detections table is the unique value** — this is the only section not on the dashboard. Consider making this the primary focus with the other panels as compact support
- **Detection data is static HTML** — could be dynamically generated or at least pulled from a JSON source for maintainability
- **No unique content beyond the detections table** — needs a stronger reason to exist as a separate page

---

## 6. `/nova/logs.html` — Founder Log

**Audience:** Internal (but not explicitly noindex)  
**Purpose:** Operator journal, AI-generated notes, brief archive, system terminal, and roadmap.  
**Hero:** "Nova Founder Log" — "Operational notes, execution context, and daily founder support." (uses different hero image: holographic dashboard texture)

### Sections

| Section | Description | Data Source |
|---|---|---|
| **Today's Operator Note** | AI-generated daily note with refresh button | NovaSoul + Gemini API |
| **Add Operator Journal Entry** | Textarea + submit + 6 quick-prompt pills | NovaSoul |
| **Past Operator Entries** | Historical journal entries | NovaSoul localStorage |
| **Site Activity** | Git changelog timeline | `changelog.json` |
| **Brief Archive** | Published daily briefs | NovaSoul |
| **System Terminal** | Decorative terminal block | Static |
| **Awareness Detections** | Same detection table as awareness.html | Static |
| **Nova's Roadmap** | 8-item wishlist | Static |
| **Nav Footer** | Horizontal links to sibling pages | Static |

### Scripts
`nova-soul.js`, `nova-ai.js`, `nova-logs.js`

### Issues / Recommendations

- **Most content-heavy page** — 8 sections is a lot. Consider collapsible sections or splitting
- **Awareness Detections table duplicated** from awareness.html — remove from one location
- **System Terminal** is decorative only (static text ">> nova.log open") — either make it functional or remove
- **Roadmap section** has good content but is static. Could move to a dedicated planning page or pull from a JSON source
- **Hero image is different** from all other Nova pages (holographic texture vs. the shared `hero-1536x1024.png` or `mini-hero-03-neon-pulse.jpg`). Should unify
- **Missing `noindex` meta tag** — other internal pages have it
- **Class names still use legacy terms** — `nova-dream-list`, `nova-diary-input`, `nova-diary-send` should be renamed to match operator/log terminology
- **Quick-prompt pills** are useful UX — could be adopted on the dashboard too

---

## Cross-Page Design System Summary

### Consistent Elements (current)

| Element | Value |
|---|---|
| Background | `#071019` |
| Accent | `#a78bfa` (purple) |
| Text primary | `#e2e8f0` |
| Text secondary | `rgba(148, 163, 184, 0.6-0.78)` |
| Panel bg | `rgba(15, 20, 35, 0.65)` |
| Panel border | `rgba(167, 139, 250, 0.12)` |
| Font | Inter 400/500/600 |
| Icons | Cloudflare-style inline SVGs (preview) / Font Awesome (all others) |
| Mini hero | Present on all 6 pages |
| Nav footer | Present on 5 of 6 pages (missing on index.html) |

### Known Inconsistencies

| Issue | Pages Affected | Fix |
|---|---|---|
| **Icon system mixed** | index.html uses CF SVGs, dashboard/awareness/logs/agents use Font Awesome | Standardize to one system |
| **Body class** | index.html still uses `nova-home` | Switch to `data-theme="dark"` |
| **Banner container** | index.html still has it | Remove |
| **Hero images differ** | logs.html uses holographic texture, others use shared hero/neon-pulse | Unify to 1-2 hero images |
| **Layout containers differ** | agents.html uses `grid-container`, dashboard/awareness use `nova-dashboard`, preview uses custom `.gp` | Standardize |
| **Nav footer missing** | index.html | Add |
| **Legacy class names** | logs.html (`nova-diary-*`, `nova-dream-*`) | Rename |
| **Duplicate sections** | Memory & Activity + System Info on both dashboard and awareness | Deduplicate or differentiate |
| **Detection table duplicated** | awareness.html + logs.html | Keep on one page only |

---

## Recommended Next Steps (Priority Order)

1. **Align index.html** — Remove `nova-home`, banner container; add `data-theme="dark"` + `background:#071019`; add nav footer
2. **Unify icon system** — Pick one (Cloudflare SVGs or Font Awesome) across all pages. CF SVGs are higher quality but more verbose
3. **Redesign agents.html** — Add agent icons + brand colors, fix tier labels, consider hierarchy layout matching preview.html
4. **Differentiate awareness.html** — Make Awareness Detections table the hero content; reduce or remove duplicate panels
5. **Clean up logs.html** — Remove duplicate detection table, add `noindex`, rename legacy classes, unify hero image
6. **Consolidate hero images** — Pick 1-2 and use consistently
7. **Consider a shared Nova CSS file** — Extract the purple theme variables, panel styles, and nav footer pattern into a `nova-theme.css` that all pages import instead of duplicating inline styles
8. **Explore dynamic agent rendering** — Load from `company-agents.json` on agents.html and preview.html hierarchy instead of hardcoding

---

## Legacy Pages (Candidates for Removal or Archive)

| Page | Status | Recommendation |
|---|---|---|
| `/nova/core.html` | Outdated, references "Mood Drift Monitor" and "Dream Engine" | Archive or redirect to dashboard |
| `/nova/nova-vision.html` | Image generation demo, uses "dream" language | Archive |
| `/nova/ai-mood-demo.html` | Old mood demo | Archive |
| `/nova/mood-demo.html` | Old mood demo v1 | Archive |
| `/nova/mood-demo-V2.html` | Old mood demo v2 | Archive |
| `/nova/lore/` (10 pages) | Narrative fiction content from old Nova personality | Review for brand alignment; may still have value as content |
| `/nova/about.html` | Nova bio — could be merged into index.html or kept | Keep but align styling |
| `/nova/twitch-background.html` | Utility page for streaming | Keep as utility |

# AmbientOS Dashboard Typography Scale

## Context

Default text sizes across the AmbientOS backend dashboard (`/modules/company/`) are too small for comfortable reading. An audit found 822 font-size declarations across 21 CSS files, with 75% (618) at or below 0.85rem (13.6px). The smallest values go down to 0.5rem (8px). Body text and table content — the most-read elements — sit at 11-13px when they should be 14px. No typography tokens exist; every font-size is hardcoded.

**Goal:** Raise the typography floor to 12px, standardize body text at 14px, and introduce a reusable token scale to prevent drift.

**Scope:** Only the 21 CSS files in `ambientpixels/modules/company/css/`. Shared CSS files (`css/base.css`, `css/components.css`, etc.) are NOT touched — they serve customer-facing pages.

**Commit strategy:** One git commit per phase. This makes revert granular — if Phase 3 breaks config pages, revert that commit without losing Phases 0-2.

**CSS coverage assumption:** All 40 dashboard HTML pages load `company.css` (shared tokens) plus page-specific CSS from the same `modules/company/css/` directory. Before Phase 1, verify no dashboard page loads a CSS file outside these 21 that also sets small font-sizes.

---

## Typography Token Scale

Add to the existing `:root` block in `ambientpixels/modules/company/css/company.css` (after spacing tokens, before `--c-font`):

```css
/* Typography scale */
--c-text-xs:     0.75rem;     /* 12px — floor. Badges, status pills, icon labels */
--c-text-base:   0.875rem;    /* 14px — body text, table cells, descriptions, inputs */
--c-text-md:     1rem;        /* 16px — panel titles, section labels */
--c-text-lg:     1.125rem;    /* 18px — section headers, card titles */
--c-text-xl:     1.375rem;    /* 22px — KPI values, large stat numbers */
--c-text-2xl:    1.75rem;     /* 28px — page titles */
--c-text-3xl:    2.25rem;     /* 36px — large display numbers */
/* Line-height */
--c-lh-tight:    1.3;        /* badges, labels, compact rows */
--c-lh-base:     1.5;        /* body text, table cells, descriptions */
```

**Design rationale:**
- Floor is 12px (WCAG minimum for body text)
- Body text at 14px matches Material Design 3 and Tailwind dashboard defaults
- Panel titles bump from 14px to 16px to create visual hierarchy above body text
- Custom dashboard scale tuned for density — not a strict modular ratio. 6 tokens: xs (floor) → base (body) → md (titles) → lg (headers) → xl (KPIs) → 2xl/3xl (display). Wider jumps at the display end for visual emphasis
- Naming follows existing `--c-*` convention (`--c-bg`, `--c-text`, `--c-pad`, `--c-r`, etc.)

---

## Value Mapping

| Current values | Current px | New token | New px |
|---|---|---|---|
| 0.5-0.62rem, 8-10px | 8-10px | `--c-text-xs` | 12px |
| 0.65-0.72rem, 11px | 10.4-11.5px | `--c-text-xs` | 12px |
| 0.75rem, 12px | 12px | `--c-text-xs` | 12px (already at floor — preserve) |
| 0.78-0.8rem, 13px | 12.5-13px | `--c-text-base` | 14px (+1-1.5px) |
| 0.85rem, 14px | 13.6-14px | `--c-text-base` | 14px (tokenize, ~no change) |
| 0.9-0.95rem, 15px | 14.4-15px | `--c-text-md` | 16px (+1-1.6px — intentional: labels/titles gain hierarchy) |
| 1rem, 16px | 16px | `--c-text-md` | 16px (tokenize, no change) |
| 1.1-1.125rem, 18px | 17.6-18px | `--c-text-lg` | 18px (tokenize, ~no change) |
| 1.25rem, 20px | 20px | keep hardcoded | 20px (preserve — doesn't fit a token cleanly) |
| 1.375rem, 22px | 22px | `--c-text-xl` | 22px (tokenize, no change) |
| 1.5rem+, 28px+ | 24px+ | `--c-text-2xl` / `--c-text-3xl` | 28/36px (tokenize, no change) |

---

## Edge Cases

- **Icon font-sizes:** `font-size` on `<i>`, `.fa-*`, `.icon` selectors controls icon rendering, not text readability. Leave these at current values — do not apply text tokens to icons.
- **`!important` declarations:** Keep the flag, swap the value to a token.
- **KPI/display numbers at 22px+:** These already match a token (`--c-text-xl` = 22px, `--c-text-2xl` = 28px). Tokenize them — size doesn't change.
- **In-between values (20px, 15px, etc.):** Values that don't cleanly map to a token stay hardcoded rather than being forced into a nearby token. The goal is accuracy, not 100% token coverage. Examples: a 20px stat number stays `1.25rem`; forcing it to `--c-text-xl` (22px) would visibly change it.
- **Intentional bumps:** Values in the 14.4-15px range moving to `--c-text-md` (16px) is intentional — these are typically labels and section titles that benefit from gaining hierarchy over body text (14px). This is the point of the plan, not a side effect.
- **Responsive `@media` queries:** Enforce the 12px floor — no text below `--c-text-xs` at any viewport width (breakpoints: 768px, 640px, 600px, 480px).

---

## Phased Implementation

### Phase 0: Token Definition
**File:** `company.css`
Add `--c-text-*` tokens to the existing `:root` block (~10 new lines).

### Phase 1: Shared Components (cascades to all 40 pages)
**Files:** `company.css` (62 declarations), `sidebar.css` (13 declarations)
Replace hardcoded font-sizes on `.ap-*` shared component selectors and sidebar elements with tokens.

### Phase 2: Dashboard Core + Tables
**File:** `dashboard.css` (148 declarations — largest file, worst tables)
Key fixes:
- `.hb-agent-table th`: 0.55rem (8.8px) to `--c-text-xs` (12px)
- `.hb-agent-table td`: 0.7rem (11.2px) to `--c-text-base` (14px)
- All `.tb-stats-table`, `.shm-*`, `.hb-footer-stat` selectors

**Table padding audit (required, not reactive):** Going from 11px to 14px is a 25% text increase. After tokenizing font-sizes, explicitly review and adjust cell padding on `.hb-agent-table td/th`, `.tb-stats-table td/th`, and any other table selectors. Test with real data (not empty cells) to catch column crowding before moving on.

### Phase 3: High-Count Module Files (~350 declarations)
**Files (in order):**
1. `config.css` (94) — form labels, helper text
2. `analytics-hub.css` (86) — analytics tables, KPI labels
3. `tasks.css` (54) — task cards, provenance badges
4. `memory-stack.css` (48) — memory layer labels
5. `trends.css` (47) — chart labels, data displays

### Phase 4: Medium-Count Files (~200 declarations)
**Files:** `workspace.css` (38), `objectives.css` (30), `meetings.css` (27), `documents.css` (23), `inbound.css` (23), `hq.css` (23)

### Phase 5: Low-Count Files (~100 declarations)
**Files:** `agent-intelligence.css` (21), `board-view.css` (19), `directives.css` (19), `content-gallery.css` (18), `actions.css` (14), `quick-chat.css` (9), `calendar.css` (6)

### Phase 6: Responsive Breakpoint Audit
Audit all `@media` queries across all 21 files. Ensure no text drops below `--c-text-xs` (12px) at any breakpoint.

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Table cells crowding when text goes 11px to 14px | Padding audit is an explicit Phase 2 task — test with real data, adjust before moving on |
| Dense cards (task, agent intel) wrapping with 10px to 12px badges | 12px is still compact; verify each card type visually |
| Line-height crowding after font-size bumps | Apply `--c-lh-base` (1.5) to body text and table cells; `--c-lh-tight` (1.3) to badges/labels. Adjust reactively if specific elements still feel cramped |
| Regression scope | One git commit per phase. If a phase breaks layout, revert that single commit |

---

## Verification

**Per-phase:**
1. Load affected page(s) in browser
2. Check: no text overflow/truncation in cards, table columns align, sidebar fits
3. Test responsive breakpoints (768px, 480px)
4. One git commit per phase — makes revert granular

**Phase 1 gets extra verification** (cascades to all 40 pages):
- Visual pass across 4 representative page types: dashboard (tables), tasks (cards), config (forms), analytics-hub (data displays)
- Confirm `.ap-*` shared selectors render correctly across all page types before proceeding

**After Phase 3 (majority done):**
```bash
grep -rn "font-size:\s*0\.[0-6][0-9]*rem\|font-size:\s*[89]px\|font-size:\s*1[01]px" ambientpixels/modules/company/css/
```
Confirm no remaining values below the 12px floor (excluding icon selectors).

**Final:**
- Browser zoom to 200% — text readable, no overflow
- Open all 40 dashboard HTML pages for visual scan
- Confirm token adoption: `grep -c "var(--c-text-" ambientpixels/modules/company/css/*.css`

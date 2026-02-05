# TileForge Documentation
**Xbox Tile Localization Preview Tool with Visual Text Measurement**
**Current Version: 2.4.0**

---

## 🤖 AI Agent Onboarding

### **Project Context**
TileForge is a **production-ready Xbox tile localization preview tool** built with vanilla HTML/CSS/JavaScript. It helps game developers and localization teams preview how Xbox game tiles will appear across 52+ languages and regions before deployment.

### **Current Architecture**
```
TileForge/
├── index.html              # Main application entry point
├── css/
│   ├── styles.css          # Main styling and layout
│   ├── tile-card.css       # Tile preview styling
│   ├── template-system.css # Template selection and Mobile Spotlight styles
│   └── transform-modal.css # CSV transformation modal styling
└── js/
    ├── main.js             # Application initialization
    ├── constants.js        # Locale mappings, limits, helper functions
    ├── template-system.js  # Template selection and switching logic
    ├── tile-renderer.js    # Tile creation and locale rendering
    ├── text-measurement.js # Visual text analysis and overflow detection
    ├── live-editor.js      # Real-time tile editing functionality
    ├── analytics.js        # Statistics and dashboard updates
    ├── loc-transformer.js  # CSV transformation logic
    ├── transform-modal.js  # Transform modal UI and interaction
    └── csv-viewer.js       # GridPeek: lightweight, read-only CSV table viewer
```

### **Key Technical Details**
- **No Build Process**: Pure vanilla JavaScript, runs directly in browser
- **Multi-Template System**: Top of Home and Mobile Spotlight templates with dynamic switching
- **Visual Text Measurement**: Canvas-based pixel-perfect text analysis (not character counting)
- **Template-Aware Analysis**: Text limits and overflow detection adapt to selected template
- **Locale Badge System**: Clean pill-style badges for locale identification (EN-US, FR-FR, etc.)
- **Real-time Updates**: Live tile preview with instant visual feedback
- **Modular CSS**: Feature-based separation, no duplication, follows Windsurf Protocol
- **52+ Locales**: Full international coverage with proper locale name mappings

## 🎨 Template System

### **Overview**
TileForge supports two Xbox tile templates optimized for different platforms and use cases:

### **Top of Home (ToH) - Default Template**
- **Image Dimensions**: 560×315px (Xbox standard)
- **Display Size**: 280×140px (50% scale for UI)
- **Aspect Ratio**: 8:7 horizontal format
- **Text Limits**:
  - Title: 40 characters max, 2 lines
  - Subtitle: 40 characters max, 2 lines
- **Typography**:
  - Title: 18px, font-weight 600
  - Subtitle: 16px, font-weight 400
- **Use Case**: Traditional Xbox dashboard tiles, home screen placement

### **Mobile Spotlight - New Template**
- **Image Dimensions**: 694×758px (mobile-optimized)
- **Display Size**: 347×379px (50% scale for UI)
- **Aspect Ratio**: 11:12 vertical format
- **Text Limits**:
  - Title: 60 characters max, 3 lines (+50% capacity)
  - Subtitle: 80 characters max, 3 lines (+100% capacity)
- **Typography**:
  - Title: 20px, font-weight 700 (larger, bolder)
  - Subtitle: 16px, font-weight 400
- **Use Case**: Xbox mobile app spotlight tiles, vertical mobile layouts

### **Template Architecture**

#### **JavaScript Module: `template-system.js`**
```javascript
// Template configuration objects
const TEMPLATE_CONFIGS = {
  'Top of Home': {
    name: 'Top of Home',
    displayWidth: 280,
    displayHeight: 140,
    imageWidth: 360,
    imageHeight: 315,
    limits: { title: { max: 40, warning: 35 }, subtitle: { max: 40, warning: 35 } },
    fonts: { title: { fontSize: '18px', fontWeight: '600' }, subtitle: { fontSize: '16px', fontWeight: '400' } },
    lineClamps: { title: 2, subtitle: 2 }
  },
  'Mobile Spotlight': {
    name: 'Mobile Spotlight',
    displayWidth: 347,
    displayHeight: 379,
    imageWidth: 694,
    imageHeight: 758,
    limits: { title: { max: 60, warning: 55 }, subtitle: { max: 80, warning: 75 } },
    fonts: { title: { fontSize: '20px', fontWeight: '700' }, subtitle: { fontSize: '16px', fontWeight: '400' } },
    lineClamps: { title: 3, subtitle: 3 }
  }
};
```

#### **CSS Classes: `template-system.css`**
```css
/* Mobile Spotlight template styling */
.tile-preview.mobile-spotlight {
  width: 347px;
  height: 379px;
}

.mobile-spotlight .tile-overlay {
  padding: 24px 20px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.9));
}

.mobile-spotlight .tile-title {
  font-size: 20px;
  font-weight: 700;
  -webkit-line-clamp: 3;
}

.mobile-spotlight .tile-subtitle {
  font-size: 16px;
  -webkit-line-clamp: 3;
}
```

### **Template Switching Logic**
1. **UI Selection**: Visual template cards in left panel
2. **Global State**: `currentTemplate` variable tracks active template
3. **Dynamic Updates**: All existing tiles update classes and dimensions
4. **Text Analysis**: Limits and overflow detection adapt to template
5. **Live Editor**: Preview tile maintains template during editing

### **Integration Points**
- **`tile-renderer.js`**: Applies template CSS classes during tile creation
- **`text-measurement.js`**: Uses template-specific fonts and line clamps
- **`live-editor.js`**: Template-aware character limits and preview updates
- **`constants.js`**: Delegates limit queries to template system

---

## 🎨 Headliner Crafter - Advanced Localization Field Mapping

### **Overview**
Headliner Crafter is TileForge's advanced CSV localization transformation tool that enables intelligent field mapping from source CSV data to CardForge output fields. It provides real-time visual feedback, multi-locale analysis, and smart content optimization for game localization workflows.

---

## 🆕 August 2025 Major Updates (Headliner Crafter & Localization)

- **Campsite XML Import & Export:** Now supports direct upload of Campsite-localized XML files. XML data is parsed and normalized to the same internal format as CSV, enabling seamless mapping, preview, and export workflows. Export to XML is also supported.
- **Unified Mapping & CardForge Import:** Whether you upload CSV or XML, you can map, preview, and export data. The CardForge import button now initializes data if none exists, supporting both formats.
- **Intelligent Field Filtering:** Fields with no values (such as SubHeader, Footer, or any unused field) are automatically excluded from mapping and preview interfaces.
- **Drop Zone & UI Guidance:** The localized preview empty-state accepts CSV, XML, JSON (arrays), and Images. You can also use the Auto‑Localize drop zone above the editor. After items exist, localized preview tiles do not accept drops. The modal drop zone also indicates CSV/XML support and Iris-ready export guidance. <!-- updated by Cascade -->
- **Enhanced Modal Workflow:** User guidance, mapping, and preview flows are more robust and user-friendly, with fixes for edge cases and improved end-to-end experience.
- **New Clear All Features:** Quickly reset all mapping and preview data with one click.
- **Improved UI & Control Panel:** New control panel for easier workflow and navigation.
- **Manage Locales (Panel):** Separate panel to view, add, or remove locales for better control. <!-- updated by Cascade -->
- **Loading Default Template (Coming Soon):** Option to load a default mapping/template (feature in progress).
- **Arabic & Special Character Support:** Fixed issues with Arabic and special characters in data and preview.
- **New Case Converter Tool:** Added a dedicated Case Converter module for fast text case transformations.
- **Subtitle Symbols Selector:** Optional symbol dropdown for Subtitle Modifiers. Safely appends %, $, €, £, ¥ only when the chosen template has {n} and no existing percent/currency symbol (Behavior B). <!-- updated by Cascade -->

---

## 📈 GridPeek — CSV Quick Viewer

### Overview
GridPeek is a lightweight, read-only CSV table viewer used for fast inspection of dataset rows without modifying state. It reuses the shared Modal system and existing table styles for consistent UI and zero CSS bloat.

### Launch Points
- Toolbar: table icon button opens the active dataset
- Projects panel quick-view button
- Per-file button in Projects list: next to Rename on each file row (opens that file directly)

### Module
- File: `lab/TileForge/js/csv-viewer.js`
- Global API: `window.GridPeek.open(opts)`

### API
```js
// opts is optional; if omitted, GridPeek infers the active dataset
GridPeek.open({
  rows?: Array<object>,      // array of row objects to display
  headers?: Array<string>,   // optional columns; inferred from rows if omitted
  title?: string,            // modal title; defaults to "GridPeek — CSV Preview"
  filename?: string          // displayed in meta area when provided
});
```

Behavior:
- Renders up to 200 rows for performance; shows total counts and columns
- Escapes HTML safely; infers headers from the first few rows when not provided
- Displays filename in the meta bar and title when `filename`/`title` supplied

### Integration Points
- Projects list handler (`lab/TileForge/js/project-ui.js`):
  - Adds a per-file button with `data-act="gridpeek-file"`
  - On click, loads the file’s content (CSV via `processCsvText` or fallback parser; JSON via `JSON.parse`) and calls `GridPeek.open({ rows, title, filename })`
- Modal System: uses `Modal.createModal({ title, content, size: 'large' })`
- Styles: reuses `.preview-table-wrapper` and `.preview-table`

### Accessibility
- Buttons include ARIA labels and tooltips
- Modal supports keyboard focus and dismissal via existing modal patterns

### Performance
- Hard cap of 200 rows rendered initially; suitable for quick inspection
- No mutation of global state; stateless viewer

### Limitations & Future Work
- No pagination/sorting yet (planned)
- Column resize and search/filter are candidates for a future iteration

---

## 📁 Projects List — File Actions & Export Button

### Overview
The per-file actions in the Projects list use a compact 3-column grid for quick operations. The Export button is a full-width, accessible badge below the icon row and reflects save/export readiness using an attribute-based state — no new classes.

### Layout
- Container: `.project-file-row .file-actions`
- Grid: 3 equal columns for top-row icon buttons (Rename, GridPeek, Remove)
- Export button: `[data-act="export-file"]` spans all 3 columns beneath the icons

### Accessibility
- Visible label: "Export to Iris CSV" appears alongside the icon
- Attributes: `title` and `aria-label` mirror the visible label

### Ready-State Visuals
- Attribute: `[data-ready="true" | "false"]` on the Export button
- Styles are applied via existing selectors in `lab/TileForge/css/styles.css`:
  - Ready (green): `.project-file-row .file-actions [data-act="export-file"][data-ready="true"] { … }`
  - Not ready (outline): default/when `data-ready="false"`

### State Management (No New Classes)
- Default state: Export button renders with `data-ready="true"`
- Global events handled in `lab/TileForge/js/project-ui.js`:
  - `tileforge:file-dirty` → sets active row’s export `[data-ready]` to `"false"`
  - `tileforge:file-saved` → sets active row’s export `[data-ready]` to `"true"`
- Convenience helpers (exposed on `window`):
  - `TileForge.markDirty()` → dispatches `tileforge:file-dirty`
  - `TileForge.markSaved()` → dispatches `tileforge:file-saved`

### Integration Points
- Per-locale editors (`lab/TileForge/js/tile-renderer.js`): on input for title/subtitle/narrator, call `TileForge.markDirty()` so the Export button leaves ready state immediately during edits.
- Save flow (`lab/TileForge/js/project-ui.js`): on successful save, dispatches `tileforge:file-saved` so the Export button returns to ready (green).

<!-- updated by Cascade: projects list export button layout + ready state docs -->

## 🏷️ Locale Badges — Language Color Palette Toggle
- **Badge rendering:** `lab/TileForge/js/analytics.js` → `renderLocaleBadgeArea()` writes pills into `#localeBadgeArea`. Each pill is a link wrapping a badge span with classes: `country-badge`, a status class (e.g., `clean`, `near-limit`, `overflow`), and a language class `lang-<code>` (e.g., `lang-en`). The function also toggles `.has-badges` on the container `.locale-badges-section` when pills exist.
- **Palette application (CSS):** `lab/TileForge/css/styles.css` scopes per‑language colors behind a container switch:
  - Default (palette OFF): `.country-badge` uses the base pill style.
  - Palette ON: `.locale-badges-section.palette-on #localeBadgeArea .country-badge.lang-en { … }` and similar for `fr`, `es`, `de`, `ja`, `ko`, `zh`, etc. These rules only apply when the ancestor `.locale-badges-section` has `.palette-on`.
- **Toggle binding (JS):** `lab/TileForge/js/toolbar.js` attaches to the checkbox `#toggleLocaleColors` on `DOMContentLoaded` and toggles `.palette-on` on `.locale-badges-section`. It also syncs `aria-checked` with the control state.
- **Required DOM (verify in HTML):**
  - Container: an element with class `.locale-badges-section`.
  - Host: `#localeBadgeArea` where pills render.
  - Control: a checkbox/switch with id `#toggleLocaleColors` that the toolbar script listens to. If adding markup, place the control inside the existing `.badge-controls` within `.locale-badges-section` rather than creating new containers.
- **Behavior:**
  - Toggle OFF → `.palette-on` absent → all pills use default `.country-badge` styling (uniform color).
  - Toggle ON → `.palette-on` present → per‑language colors activate via the `lang-<code>` classes.

<!-- updated by Cascade: locale badge palette toggle docs -->

## 🟩 Tile Status — Pill Color Toggle
- **Source of classes:** Locale pills are rendered by `lab/TileForge/js/analytics.js` → `renderLocaleBadgeArea()`. Each pill uses `country-badge` plus a status class (`clean`, `near-limit`, `overflow`) and a language class `lang-<code>`.
- **UI control:** `lab/TileForge/index.html` adds a second toggle inside `.locale-badges-section`:
  - Checkbox id: `#toggleStatusPillColors` within a `.badge-controls` block.
- **Binding (JS):** `lab/TileForge/js/toolbar.js` listens to `#toggleStatusPillColors` and toggles `.status-palette-on` on `.locale-badges-section`, syncing `aria-checked`.
- **Scoped CSS:** `lab/TileForge/css/styles.css` applies status colors only when active:
  - `.locale-badges-section.status-palette-on #localeBadgeArea .country-badge.clean { … }`
  - `.locale-badges-section.status-palette-on #localeBadgeArea .country-badge.near-limit { … }`
  - `.locale-badges-section.status-palette-on #localeBadgeArea .country-badge.overflow { … }`
- **Behavior & precedence:**
  - Status toggle ON → pills use green/orange/red by status.
  - Language toggle ON → pills use per-language colors.
  - Both ON → status palette takes precedence (rules are defined after language palette in `styles.css`).
- **Accessibility:** `aria-checked` is kept in sync on change (mirrors the language palette toggle).

<!-- updated by Cascade: status pill color toggle docs -->

## 🧰 Locale Badges — Status Borders Toggle (Default View)
- **Setting (General):** Checkbox labeled "Status borders on locale badges" (`statusPillBordersPref`).
- **State Key:** `currentSettings.statusPillBorders` (boolean, default `true`).
- **DOM Hook:** Toggles `.status-borders-off` on the container `.locale-badges-section`.

### Behavior
- Borders/glow apply only in the default view (when both palettes are OFF) and when the opt-out class is absent:
  - CSS scope: `.locale-badges-section:not(.palette-on):not(.status-palette-on):not(.status-borders-off) #localeBadgeArea .country-badge.{clean|near-limit|overflow}`
- Turning the setting OFF adds `.status-borders-off` and suppresses the default border/glow for Clean / Near-limit / Overflow.
- Status and Language palette behaviors are unchanged and remain mutually exclusive.

### Implementation
- **UI:** Added to Settings → General tab within `createGeneralTabContent()` (`lab/TileForge/js/settings.js`) as `#statusPillBordersPref`.
- **Init & Persistence:** Value initializes from `currentSettings.statusPillBorders` and persists via `saveSettings()`; applied on `DOMContentLoaded` and modal open.
- **CSS:** Updated `lab/TileForge/css/styles.css` to include `:not(.status-borders-off)` in the default-view status border selectors for `.clean`, `.near-limit`, `.overflow`.

<!-- updated by Cascade: status borders toggle docs -->

## 📌 Localized Previews — Sticky Wrapper (Headline + Toolbar + Badges)

<!-- updated by Cascade: localized previews sticky wrapper docs -->

### Overview
Keeps the Localized Previews headline, toolbar controls, and locale badges pinned under the top nav while scrolling. Provides a subtle glass panel background.

### DOM Structure
- **Wrapper**: `#localizedPreviewsStickyBlock`
- **Header toggle (inline)**: checkbox `#togglePreviewsStickyHeader` with state label `#previewsStickyHeaderState` inside `.section-separator .separator-content`
- **Back‑compat**: `.locale-badges-section` may also receive `.sticky` for legacy badges‑only pinning

### Settings & State
- **Key**: `currentSettings.badgesPanelSticky` (boolean)
- **Persistence**: saved via `saveSettings()` → `localStorage['tileforge-settings']`
- **Initializer**: `applyBadgesStickyState()` runs on `DOMContentLoaded`

### Behavior
- Applies `.sticky` to `#localizedPreviewsStickyBlock` when enabled
- Syncs both header toggle (`#togglePreviewsStickyHeader`) and modal toggle (`#toggleBadgesSticky`) with `aria-checked` and textual state labels
- Headline + toolbar + badges stay fixed; locale groups below continue scrolling

### Functions
- `applyBadgesStickyState()` in `lab/TileForge/js/settings.js`
  - Toggles `.sticky` on `#localizedPreviewsStickyBlock`
  - Back‑compat: mirrors state to `.locale-badges-section`
  - Synchronizes UI controls and state labels
- Global change listener updates state on either toggle: `#toggleBadgesSticky` or `#togglePreviewsStickyHeader`

### CSS Hooks
- Sticky container: `#localizedPreviewsStickyBlock.sticky { position: sticky; top: var(--badges-sticky-top, 72px); z-index: 30; }`
- Glass panel: `#localizedPreviewsStickyBlock { backdrop-filter: blur(8px) saturate(120%); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); }`
- Headline row layout: `.section-separator .separator-content { display: flex; gap: 8px; }` with `.badge-controls { margin-left: auto; }`

### Accessibility
- Toggles maintain `aria-checked` and visible On/Off labels
- Sticky elevation ensures focus outlines and content remain visible

### Design Tokens
- Uses existing offset variable `--badges-sticky-top`
- Background aligns with Nova tokens (e.g., `--aura-*`) and avoids inline styles per Windsurf Protocol

## 🧭 Left Panel Overview

The Left Panel is the primary navigation and workflow anchor in TileForge, always visible on the left side of the interface. It consolidates all major controls, filtering, and tool access into a single, persistent vertical panel for efficient localization and preview workflows.

### Main Sections & Features

- **Panel Header:** Displays the TileForge title, Info/Help and Settings buttons, and a subtitle for quick orientation.

- **Controls Toolbar:** A persistent toolbar with Save, Clone, New, and Export actions for managing your localization session. Locale management is available via the **Manage Locales** panel in the left column. <!-- updated by Cascade -->

- **File Info Display:** Shows the currently loaded image and CSV file names for clear workflow tracking.

- **Dynamic Filters:** Multi-level filters for Status (All, Clean, Issues), Language, Region, and Locale. Each dropdown is dynamically populated based on the loaded data and locale mapping. Filters update the tile preview in real time.

- **Template Selection:** Visual selector for "Top of Home" and "Mobile Spotlight" templates, each with preview thumbnails and info. Selecting a template updates all tiles and analysis systems accordingly.

- **Tool Shortcuts:** Quick-access buttons for advanced tools, including Transform Data and Headliner Crafter. These launch modal interfaces for data transformation and field mapping.

- **Image Info Panel:** Always-present panel displaying detailed metadata for the uploaded image, including file name, format, size, dimensions, and aspect ratio. Provides immediate feedback on image compliance with template requirements.

- **Workflow Guidance:** The panel layout follows the logical workflow: 1) File Upload, 2) Filter/Template Selection, 3) Tool Access, 4) Image Details, ensuring users can move efficiently through each step.

#### Recent Enhancements
- **Bulk Actions:** Toolbar now supports Save, Clone, New, and Export, streamlining session management.
- **Locale Management (Panel):** Fully integrated modal for adding/removing supported locales, with live preview updates. <!-- updated by Cascade -->
- **Advanced Filtering:** Filters are now dynamically generated and update the UI instantly.
- **Visual Template Picker:** Interactive, thumbnail-based template selection.
- **Integrated Tools:** Transform Modal and Headliner Crafter are directly accessible from the panel.
- **Image Metadata:** Image info panel provides compliance feedback and detailed analysis.

The Left Panel is designed for clarity, speed, and full control, anchoring all major actions and navigation for the TileForge localization workflow.

/* updated by Cascade */

---

## 🆕 Tools — String Forge (Case Converter)

### Overview
`String Forge` is a compact text utilities panel for quick transformations and ID affixing used during editing and cleanup.

### Features
- UPPERCASE • lowercase • Title Case • Sentence case
- Strip Spaces • Remove Punctuation
- BIG ID affix: Append • Prepend • Lower+Append
- Auto‑apply on dropdown change or Enter in BIG ID field
- 2‑column action layout; Clear spans full width

### Usage
1) Paste or type text into the input.
2) Click actions in the 2‑column grid to transform.
3) Enter BIG ID, choose mode (applies immediately) or press Enter.
4) Click Output to copy.

### Behavior & Containment
- Affix row grid: `label | minmax(0,1fr) | select` with strict overflow containment.
- Native select wrapped to avoid panel overflow. All controls are `32px` high.

### Files
- JS: `lab/TileForge/js/case-converter.js`
- CSS: `lab/TileForge/css/case-converter.css`

---

## 🆕 Tools — Naming Generator (CSV)

### Overview
The Naming Generator helps craft consistent product/feature names and exportable CSV rows for batch localization workflows.

### Capabilities
- Generate line name variants, slugs, categories, and tags
- Compose CSV‑ready rows for downstream tools
- Copy/export from modal; integrates with Projects/CSV flows

### Usage
1) Open the modal from Tools → Naming Generator (CSV).
2) Provide base terms and constraints.
3) Generate and copy rows, or export as CSV.

### Files
- JS: `lab/TileForge/js/line-name-generator-modal.js`

<!-- updated by Cascade: String Forge + Naming Generator docs -->

## 🌍 Locale Manager (Modal)

<!-- updated by Cascade: Locale Manager docs -->

### Overview
The Locale Manager lets you choose which locales are active for preview and export. It includes a search box, language filter pills, and pill‑styled action buttons. All styles and selectors are scoped to the modal to avoid CSS collisions.

### UI Structure
- **Host file:** `lab/TileForge/index.html`
- **Container:** `#localePickerModal`
- **Key elements:**
  - Search: `#localeSearchInput`
  - Language pills: `#localeLanguageFilters` with `.pill-btn` buttons (includes an "All" pill)
  - Locale list: `#localeList`
  - Actions row: `.locale-actions-row` with `.modal-btn` buttons
  - Apply: footer button calling `TileForgeLocalesUI.apply()`

### Behavior
- **Filtering:** Search text and the selected language pill combine to filter the locale list.
- **Language pills:** Clicking a pill sets `aria-pressed` on that pill and re-renders the list. "All" clears the language filter.
- **Selection:** Check/uncheck in the list updates the internal `selectedLocales` state.

### Defaults
- Source: `lab/TileForge/js/locale-mapping.js`
- Buttons in actions row call `TileForgeLocalesUI.loadDefault(type)`:
  - `type === 'mobile'` → selects all locales (Mobile includes all)
  - `type === 'toh'` → selects all except the special `INVARIANT` locale (ToH excludes INVARIANT)

### Styling Scope
- Source: `lab/TileForge/css/modal.css`
- Modal‑scoped rules under `#localePickerModal`:
  - Pills: `#localePickerModal .locale-filter-pills .pill-btn`
  - List wrapper: `#localePickerModal .locale-list`
  - Actions row: `#localePickerModal .locale-actions-row .modal-btn` (pill‑style buttons)
- No inline styles; action row uses `.locale-actions-row` for consistent spacing.

### Public API
- Module: `lab/TileForge/js/locale-picker-ui.js`
- Exposed on `window.TileForgeLocalesUI`:
  - `open(callback, preselect?)` → opens modal with optional preselected locales and on-apply callback
  - `close()` → closes modal
  - `apply()` → invokes callback with the selected locales
  - `selectAll()` / `clearAll()` → select or clear visible locales
  - `loadDefault('toh' | 'mobile')` → apply default sets described above

### Accessibility
- Language filter pills use `aria-pressed` to indicate the active state.
- Buttons and inputs follow existing modal focus and keyboard handling patterns.

---

## ✨ What’s New in 2.4.0

- **New Projects module:**
  Left‑panel Projects manager with Save, Clone, New, Remove, and Export to Iris CSV. Per‑file actions and quick preview centralize session files. Session backup/import/export supported; folder-based storage is planned.
- **Locale pills and badge system:**
  Visual pill row under the toolbar with language and status palettes, optional status borders (toggle in Settings), anchor links to locale sections, counts/status summary text, and a sticky wrapper that pins headline + toolbar + badges. Interactive filters by language/status.
- **Locale Picker upgrades:**
  Quick picks for ToH and Mobile defaults, language filter pills, scoped modal styling, and improved filtering.
- **GridPeek — CSV Quick Viewer:**
  Read‑only CSV modal with filename meta, capped rows, and clean table styling. Launch from Projects quick‑view or the toolbar icon.
- **Dynamic Export ready state:**
  Export buttons reflect saved/dirty via `[data-ready]` and global events (`tileforge:file-dirty` / `tileforge:file-saved`).
- **Save overwrite confirmation:**
  Confirmation prompt with accent styling before overwriting an existing filename.
- **Interactive analytics:**
  Analytics dashboard items sort/filter and anchor to impacted entries for faster triage.
- **Quality‑of‑life:**
  Clear All buttons per field, template validation pass, sticky previews polish.

**Information Center:**
A comprehensive, always-up-to-date help & support modal. Browse features, new tools, tips & tricks, keyboard shortcuts, troubleshooting, and future plans—all in one place!

---

## 📋 Overview

TileForge is a comprehensive localization preview tool designed for Xbox tile content. It provides real-time visual feedback for game titles across multiple locales, featuring advanced text measurement, locale identification badges, detailed image analysis, drag-and-drop functionality, and modular CSS architecture.

### ✨ Key Features

- **Real-time Tile Status System**: Color-coded tile borders with instant visual feedback (green/orange/red)
- **Unified Analytics Dashboard**: Live updates from both live editor and CSV tile editing
- **Visual Text Measurement**: Canvas-based pixel-perfect text analysis (replaces conservative character counting)
- **Locale Code Badges**: Clean pill-style badges for locale codes (EN-US, FR-FR, etc.) for easy identification
- **Detailed Image Analysis**: Comprehensive image metadata panel (format, dimensions, file size, aspect ratio)
- **52 Comprehensive Locales**: Full regional coverage including Arabic, European, English, Spanish, and Asian variants
- **Real-time Live Editing**: Click-to-edit tile text with instant visual feedback and border color updates
- **Advanced Filtering**: Multi-level filtering by status, language, region, and locale
- **Drag & Drop Interface**: Upload images on the preview tile. The localized preview empty-state accepts CSV/XML/JSON/Image; after items exist, localized tiles themselves do not accept drops. The Auto‑Localize zone also accepts CSV/XML. <!-- updated by Cascade -->
- **Analytics Dashboard**: Real-time character analysis, locale statistics, and overflow detection
- **Modal System**: Integrated modal system for confirmations, alerts, and detailed information display
- **Modular Architecture**: Clean separation of concerns with feature-based CSS modules
- **Desktop Optimized**: Professional interface optimized for desktop development workflows

---

## 🏳️ Country Identification System

### **Unicode Flag Badges**
Each locale section now features a prominent country badge with:

- **Flag Emoji**: Native Unicode flag emojis (🇺🇸, 🇩🇪, 🇫🇷, etc.)
- **Locale Code**: Clear country/region code (EN-US, DE-DE, FR-FR)
- **Visual Prominence**: Blue pill-style badges for easy scanning
- **Comprehensive Coverage**: 15+ countries with fallback globe emoji (🌍)

### **Supported Country Flags**
- 🇺🇸 United States (US)
- 🇫🇷 France (FR)
- 🇩🇪 Germany (DE)
- 🇬🇧 United Kingdom (GB)
- 🇯🇵 Japan (JP)
- 🇪🇸 Spain (ES)
- 🇮🇹 Italy (IT)
- 🇨🇦 Canada (CA)
- 🇦🇺 Australia (AU)
- 🇲🇽 Mexico (MX)
- 🇧🇷 Brazil (BR)
- 🇨🇳 China (CN)
- 🇰🇷 South Korea (KR)
- 🇮🇳 India (IN)
- 🇷🇺 Russia (RU)

### **Badge Implementation**
```html
<h3 class="locale-header">
  <span class="country-badge">🇺🇸 EN-US</span> English (United States)
</h3>
```

---

## 🏷️ Locale Badge System

### **Clean Pill-Style Badges**
Each locale section features a prominent locale badge with:

- **Locale Code**: Clear language/region code (EN-US, FR-FR, DE-DE, etc.)
- **Pill Styling**: Blue rounded badges with clean typography
- **Visual Prominence**: Easy to spot specific locales in large lists
- **Consistent Design**: Uniform styling across all 52+ supported locales

### **Badge Implementation**
```html
<h3 class="locale-header">
  <span class="country-badge">EN-US</span> English (United States)
</h3>
```

### **CSS Styling**
```css
.country-badge {
  background: #007acc;
  color: white;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: bold;
  margin-right: 8px;
  display: inline-block;
}
```

---

## 📷 Image Analysis System

### **Comprehensive Image Details**
When an image is uploaded, TileForge displays detailed metadata:

- **📁 File Name**: Original filename with extension
- **🎨 Format**: Image format (PNG, JPG, GIF, etc.)
- **📏 File Size**: Precise file size in KB
- **📐 Dimensions**: Width × Height in pixels
- **📊 Aspect Ratio**: Calculated ratio (e.g., 1.78:1 for 16:9)
- **📅 Last Modified**: File modification date

### **Default State**
- **No Image Loaded**: Clear message with upload instructions
- **Visual Indicator**: Large image icon (🖼️) with muted styling
- **Helpful Guidance**: "Upload an image to see detailed information"

### **Panel Location**
The image info panel is positioned below the filters section for optimal workflow:
1. File Upload → 2. Filters → 3. Image Details → 4. Tile Preview

---

## 🔍 Advanced Filtering System

### **Multi-Level Filtering**
- **Status Filter**: Clean, Issues, All Tiles
- **Language Filter**: English, Spanish, German, French, etc.
- **Region Filter**: North America, Europe, Asia, etc.
- **Locale Filter**: Specific locale codes (EN-US, DE-DE, etc.)

### **Filter Workflow**
```javascript
// Filter hierarchy: Status → Language → Region → Locale
applyFilters() // Updates tile visibility in real-time
resetFilters() // Clears all filters and shows all tiles
```

---

## 🎯 Visual Text Measurement System

### **Revolutionary Approach**
TileForge uses **Canvas-based visual measurement** instead of conservative character counting, providing:

- **Pixel-perfect accuracy**: Measures actual rendered text width
- **Font-aware analysis**: Considers exact font size, weight, and family
- **Multi-line intelligence**: Predicts text wrapping and truncation
- **Real space utilization**: Uses actual tile dimensions (280px width, 248px usable)

### **Old vs New System Comparison**
```
OLD SYSTEM (Character Count):
- Title limit: 15 characters (WWWWWWWWWWWWWWW)
- Subtitle limit: 15 characters
- Result: Massive underutilization of visual space

NEW SYSTEM (Visual Measurement):
- Title limit: ~35-45 characters (based on actual pixel width)
- Subtitle limit: ~40-50 characters (smaller font allows more)
- Result: 2.5-3x more usable space while preventing overflow
```

### **Smart Subtitle Logic**
- **Single Line Title**: Subtitle is displayed normally
- **Multi-Line Title**: Subtitle is hidden to prevent overflow
- **Real-time Updates**: Live editor reflects subtitle visibility changes

### **Text Analysis Functions**
- `measureTextWidth()`: Pixel-accurate text width measurement
- `analyzeTextLayout()`: Multi-line text analysis with word wrapping
- `willTextFit()`: Single-line overflow prediction
- `analyzeTextVisually()`: Complete text analysis replacing old character-count system

---

## � Tile Border Color System & Real-time Analytics

### **Visual Status Feedback**
TileForge provides instant visual feedback through color-coded tile borders that update in real-time as you type or edit content.

#### **Border Color System**
- **🟢 Green Border**: Clean text (under 30 characters) - optimal length
- **🟠 Orange Border**: Near-limit text (30-40 characters) - approaching limit
- **🔴 Red Border**: Overflow text (over 40 characters) - exceeds recommended length

#### **Status Badge Icons**
- **✓ Green Checkmark**: Text fits comfortably within limits
- **⚠ Orange Warning**: Text approaching character limits
- **⚠ Red Warning**: Text exceeds recommended limits

### **Real-time Analytics Integration**
The analytics dashboard updates instantly as you edit any tile content, providing live feedback across all tile types.

#### **Live Editor Analytics**
- Type in live editor → Analytics dashboard updates immediately
- Shows current status of the single preview tile
- Reflects clean/near-limit/overflow status in real-time

#### **CSV Tile Analytics**
- Edit any CSV tile → Analytics dashboard recalculates all tiles
- Scans all loaded tiles for current status
- Updates total counts across all tile types
- Provides unified analytics for mixed editing workflows

#### **Analytics Dashboard Metrics**
- **Total Locales**: Count of all loaded tiles
- **Clean Tiles**: Tiles with optimal text length (green)
- **Near Limit**: Tiles approaching character limits (orange)
- **Overflow Issues**: Tiles exceeding recommended length (red)

### **Technical Implementation**

#### **Character Limits (LIMITS Constants)**
```javascript
const LIMITS = {
  title: {
    max: 40,        // Maximum characters before overflow
    warning: 30     // Warning threshold for near-limit
  },
  subtitle: {
    max: 40,        // Maximum characters before overflow  
    warning: 30     // Warning threshold for near-limit
  }
};
```

#### **CSS Classes for Border Colors**
```css
/* Live Editor Tiles */
.preview-tile.clean { border-color: #4caf50; }
.preview-tile.near-limit { border-color: #ffa500; }
.preview-tile.overflow { border-color: #ff6b6b; }

/* CSV Tiles */
.tile-preview.clean { border-color: #4caf50; }
.tile-preview.near-limit { border-color: #ffa500; }
.tile-preview.overflow { border-color: #ff6b6b; }
```

#### **Real-time Update Functions**
- `updatePreviewTileStatus()`: Updates live editor tile status
- `updateTileStatus()`: Updates individual CSV tile status
- `updateLiveAnalytics()`: Updates analytics from live editor
- `updateAnalyticsFromAllTiles()`: Scans all tiles and updates analytics
- `analyzeText()`: Determines status based on character limits

### **User Experience Benefits**
- **Instant Feedback**: See text status changes as you type
- **Visual Clarity**: Color-coded borders provide immediate status recognition
- **Unified System**: Consistent behavior across live editor and CSV tiles
- **Real-time Metrics**: Analytics dashboard reflects current state without refresh
- **Professional Workflow**: Streamlined editing with immediate visual validation

---

## 🎛️ Enhanced Live Tile Editor

### **Overview**
The Live Tile Editor provides comprehensive text editing capabilities with dual control systems for maximum flexibility and granular control over tile localization.

### **Dual Control Architecture**

#### **1. Manual Text Application**
Independent "Apply Text to All" buttons for applying manually typed text to all tiles per field.

**Features:**
- **Per-Field Control**: Separate buttons for Headline, Subheadline, and Narrator Text
- **Horizontal Layout**: Green buttons positioned to the right of each input field
- **Real-time Application**: Instantly applies typed text to all 55+ locales
- **Visual Feedback**: Immediate tile re-rendering and analytics updates

**Technical Implementation:**
```javascript
// Function: applyManualTextToAllTiles(text, fieldType)
// Location: js/live-editor.js
// Purpose: Apply manually entered text to all tiles for specific field

applyManualTextToAllTiles('Custom Title', 'title');
// Updates all locales with "Custom Title" in title field
```

**HTML Structure:**
```html
<div class="input-row">
  <div class="input-container">
    <input type="text" id="titleInput" placeholder="Enter headline..." />
    <div class="character-info">
      <div class="char-count"><span id="titleCharCount">0</span></div>
    </div>
  </div>
  <div class="manual-controls">
    <button class="manual-apply-btn" id="titleManualApplyBtn">
      <i class="fas fa-share"></i> Apply Text to All
    </button>
  </div>
</div>
```

#### **2. Preset System**
Comprehensive preset management with auto-localization capabilities.

**Features:**
- **JSON-Based Presets**: Modular preset files in `data/` directory
- **Auto-Localization Toggle**: Apply localized text per locale or English to all
- **Dropdown Selection**: Per-field preset selection with immediate preview
- **Preset "Apply All"**: Blue buttons for applying selected presets to all tiles

**Available Presets:**
- `available-now.json` - "Available Now" in 121+ languages
- `buy-now.json` - "Buy Now" in 121+ languages  
- `pre-order-now.json` - "Pre-order Now" in 121+ languages
- `new-season.json` - "New Season" in 121+ languages

**Preset Data Structure:**
```json
{
  "name": "Available Now",
  "locales": {
    "EN-US": "Available Now",
    "FR-FR": "Disponible maintenant",
    "DE-DE": "Jetzt verfügbar",
    "ES-ES": "Ya disponible"
  }
}
```

**Auto-Localization Logic:**
```javascript
// Auto-localize ON: Each locale gets its translated text
if (isAutoLocalizeEnabled) {
  textToApply = preset.locales[locale] || preset.locales['EN-US'];
}
// Auto-localize OFF: All locales get English text
else {
  textToApply = preset.locales['EN-US'];
}
```

### **CSS Layout System**

#### **Input Row Layout**
```css
.input-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.input-row .input-container {
  flex: 1; /* Input takes remaining space */
}

.manual-controls {
  display: flex;
  align-items: center;
}
```

#### **Button Styling**
```css
/* Manual Apply All Buttons (Green) */
.manual-apply-btn {
  background: var(--success-color, #28a745);
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
}

/* Preset Apply All Buttons (Blue) */
.preset-apply-btn {
  background: var(--accent-color);
  color: white;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
}
```

### **Event Handling Architecture**

#### **Manual Text Event Listeners**
```javascript
// Setup in setupLiveEditor() function
titleManualApplyBtn.addEventListener('click', function() {
  const manualText = titleInput ? titleInput.value.trim() : '';
  if (manualText) {
    applyManualTextToAllTiles(manualText, 'title');
  } else {
    alert('Please enter some text in the Title field first');
  }
});
```

#### **Data Flow & Synchronization**
```javascript
// Manual text application - same text to all locales
currentCsvData.forEach((row, index) => {
  if (index === 0) return; // Skip header row
  const locale = row.Locale || row.locale;
  row[fieldKey] = text; // Apply same text to all locales
});

// Preset application with auto-localization
currentCsvData.forEach(row => {
  const locale = row.Locale || row.locale;
  const textToApply = isAutoLocalizeEnabled 
    ? preset.locales[locale] || preset.locales['EN-US']
    : preset.locales['EN-US'];
  row[fieldKey] = textToApply;
});

// Trigger UI re-render
renderLocaleGroups(currentCsvData);
updateAnalytics();
```

### **User Experience Features**

#### **Visual Distinction**
- **Green Buttons**: Manual text application ("Apply Text to All")
- **Blue Buttons**: Preset application ("Apply All")
- **Horizontal Layout**: Buttons aligned to the right of input fields
- **Clear Labeling**: Distinct icons and text for each function

#### **Validation & Feedback**
- **Empty Field Alerts**: User-friendly messages for empty inputs
- **Real-time Preview**: Live Editor always shows English text for consistency
- **Immediate Updates**: Tiles re-render instantly after application
- **Analytics Integration**: Dashboard updates reflect all changes

---

## 🏗️ Architecture

### **Modular CSS System**
TileForge follows a strict modular architecture with zero duplication:

```
css/
├── base.css           # Core typography and layout foundation
├── styles.css         # Main app layout, upload system, controls, image info panel
├── tile-card.css      # Tile display, text positioning, overlays
├── tile-editor.css    # Live editing interface and form controls
├── tile-grid.css      # Locale organization and grid layout
├── dashboard.css      # Analytics interface and statistics
└── tile-utils.css     # Utility classes and helpers
```

### **JavaScript Modules**
```
js/
├── main.js              # Application initialization and coordination
├── constants.js         # Configuration and locale mappings
├── text-measurement.js  # Visual text measurement system
├── csv-handler.js       # CSV parsing and data management
├── tile-renderer.js    # Tile creation, visual updates, country badges
├── live-editor.js       # Real-time editing functionality
├── analytics.js         # Statistics, dashboard updates, image info panel
└── drag-drop.js         # File upload and drag-and-drop handling
```

---

## 🌍 Locale System

### **Comprehensive Coverage (52 Locales)**
- **Arabic**: AR-AE, AR-SA
- **European**: CS-CZ, DA-DK, DE-AT, DE-CH, DE-DE, EL-GR, ES-ES, FI-FI, FR-BE, FR-CA, FR-CH, FR-FR, HU-HU, IT-IT, NL-BE, NL-NL, NO-NO, PL-PL, PT-BR, PT-PT, RO-RO, RU-RU, SK-SK, SV-SE, TR-TR
- **English**: EN-AU, EN-CA, EN-GB, EN-IE, EN-IN, EN-NZ, EN-PH, EN-SG, EN-US, EN-ZA
- **Spanish**: ES-AR, ES-CL, ES-CO, ES-MX, ES-US
- **Asian**: JA-JP, KO-KR, TH-TH, VI-VN, ZH-CN, ZH-HK, ZH-TW

### **CSV Data Structure**
```csv
Locale,items/0/title,items/0/subtitle,items/0/narratorText
EN-US,Game Title,Subtitle Text,Accessibility narrator text
```

### **Locale Display Names**
Full mapping of locale codes to human-readable names with regional variants, enhanced with country flag badges for visual identification.

---

## 🎮 Usage Guide

### **Getting Started**
1. **Load Default Data**: Application initializes with 52 locales automatically
2. **Upload Custom Image**: Drag image to "Drop Image Here" zone or browse files
3. **View Image Details**: Comprehensive metadata appears in the image info panel
4. **Upload Custom CSV**: Drag CSV to "Drop CSV File Here" zone or browse files
5. **Apply Filters**: Use status, language, region, or locale filters to focus content
6. **Identify Countries**: Use flag badges to quickly identify locale regions
7. **Live Edit Text**: Click any tile title/subtitle to edit in real-time
8. **Monitor Analytics**: View character analysis and locale statistics

### **Visual Text Analysis**
- **Green Status**: Text fits comfortably within visual bounds
- **Orange Warning**: Text approaching visual limits (>90% space utilization)
- **Red Overflow**: Text will be truncated or overflow tile boundaries

### **Country Badge Benefits**
- **Quick Identification**: Instantly recognize country/region from flag emoji
- **Visual Scanning**: Easy to spot specific locales in large lists
- **Professional Appearance**: Clean, consistent badge styling
- **Accessibility**: Text-based locale codes alongside visual flags

### **Image Analysis Benefits**
- **Technical Verification**: Confirm image specifications before use
- **Quality Assurance**: Check dimensions and file size for optimization
- **Format Validation**: Ensure correct image format for deployment
- **Troubleshooting**: Identify potential display issues early

### **Testing Visual Measurement**
Open browser console and run:
```javascript
testVisualMeasurement()
```
This shows the dramatic improvement in space utilization vs the old character-count system.

---

## 🛠️ Development

### **File Structure**
```
TileForge/
├── index.html           # Main application interface
├── DOCUMENTATION.md     # This comprehensive guide
├── README.md           # Quick start guide
├── css/                # Modular stylesheets
├── js/                 # JavaScript modules
└── data/              # Sample CSV files and assets
```

### **Recent Enhancements**
- **Modal System Integration**: Complete modal framework with multiple types and sizes
- **Country Badge System**: Unicode flag emojis with locale codes
- **Image Info Panel**: Detailed metadata display with default state
- **Filter Improvements**: Multi-level filtering with real-time updates
- **CSS Modularization**: Systematic removal of duplicate styles
- **Text Measurement**: Canvas-based pixel-perfect analysis
- **Live Editor**: Real-time tile preview updates
- **Tile Border Color System**: Color-coded tile borders with instant visual feedback
- **Real-time Analytics Integration**: Live updates from both live editor and CSV tile editing

### **CSS Architecture Principles**
- **Zero Duplication**: Each style defined once in appropriate module
- **Feature-Based Separation**: Styles grouped by functionality
- **Windsurf Protocol Compliance**: No inline styles, proper scoping
- **Visual Consistency**: Consistent spacing, colors, and typography
- **Country Badge Styling**: Blue pills with proper typography and spacing

### **JavaScript Module Loading Order**
```html
<script src="js/constants.js"></script>
<script src="js/text-measurement.js"></script>
<script src="js/csv-handler.js"></script>
<script src="js/tile-renderer.js"></script>
<script src="js/live-editor.js"></script>
<script src="js/analytics.js"></script>
<script src="js/drag-drop.js"></script>
<script src="js/main.js"></script>
```

### **Adding New Countries**
1. Update flag mapping in `tile-renderer.js`
2. Add Unicode flag emoji for the country
3. Test badge display across different browsers
4. Update documentation with new country support

### **Adding New Locales**
1. Update `DEFAULT_CSV_DATA` in `constants.js`
2. Add locale mapping to `LOCALE_NAMES`
3. Ensure country flag mapping exists
4. Test with visual measurement system

---

## 🔧 Technical Details

### **Country Badge Implementation**
- **HTML Structure**: `<span class="country-badge">🇺🇸 EN-US</span>`
- **CSS Styling**: Blue background (#007acc), white text, rounded corners
- **JavaScript Logic**: Case-insensitive locale code detection
- **Fallback Handling**: Globe emoji (🌍) for unmapped countries

### **Image Info Panel Specifications**
- **Panel ID**: `#imageInfoPanel`
- **Default State**: "No image loaded" message with upload guidance
- **Data Collection**: File name, format, size, dimensions, aspect ratio, modification date
- **Update Function**: `updateImageInfoPanel(imageInfo)`
- **Styling**: Consistent with TileForge dark theme

### **Drag & Drop System**
- **HTML Elements**: `#previewTile` (image drop), `#autoLocalizeDropZone` (CSV/XML drop), `#imgInput`, `#csvInput`
- **CSS Classes**: `.dnd-image-zone`, `.dnd-csv-zone`, `.dnd-*-message`, `.drag-over`
- **JavaScript**: Event listeners for dragover, dragleave, drop events; preview-area CSV drop zones removed in main UI
- **Visual Feedback**: Border color changes and hover effects
- **Image Processing**: Automatic metadata extraction and panel update

### **Text Measurement Specifications**
- **Tile Dimensions**: 280px × 140px
- **Text Area**: 248px usable width (280px - 32px padding)
- **Title Font**: 18px system-ui, weight 600
- **Subtitle Font**: 16px system-ui, weight 400
- **Line Clamp**: Maximum 2 lines with CSS `line-clamp: 2`
- **Subtitle Logic**: Hidden when title breaks to multiple lines

### **Performance Optimizations**
- **Canvas Reuse**: Single measurement canvas for all text analysis
- **Modular Loading**: CSS and JS loaded only when needed
- **Event Delegation**: Efficient event handling for live editing
- **Unicode Emoji**: Native browser rendering, no external dependencies
- **Image Analysis**: Efficient metadata extraction without server calls

---

## 🚨 Troubleshooting

### **Common Issues**

**Country flags not displaying:**
- Ensure browser supports Unicode flag emojis
- Check that locale codes match expected format (e.g., EN-US, DE-DE)
- Verify flag mapping logic in `tile-renderer.js`
- Globe emoji (🌍) appears as fallback for unmapped countries

**Image info panel not updating:**
- Verify image file is valid format (PNG, JPG, GIF)
- Check browser console for JavaScript errors
- Ensure `updateImageInfoPanel()` function is loaded
- Confirm image loads successfully in browser

**Text appears too conservative/short:**
- The new visual measurement system allows much longer text
- Run `testVisualMeasurement()` to see actual limits vs old character count
- Check that subtitle disappears when title breaks to multiple lines

**Drag-and-drop not working:**
- Ensure `styles.css` is loaded in HTML (required for drop-zone styling)
- Check browser console for JavaScript errors
- Verify file types: images (PNG, JPG, GIF), CSV files only
- Test with different browsers for compatibility

**Tiles not displaying correctly:**
- Check that all CSS modules are loaded in correct order
- Verify `tile-card.css` contains tile positioning styles
- Ensure no CSS conflicts between modules
- Confirm country badge styling doesn't interfere with layout

**Filters not working:**
- Verify filter JavaScript is loaded and initialized
- Check that filter options are populated from CSV data
- Ensure filter event handlers are properly bound
- Test individual filter types (status, language, region, locale)

---

## 📊 Project Status

### **✅ Completed Features**
- Visual text measurement system (canvas-based)
- Country code badges with Unicode flag emojis
- Detailed image info panel with metadata
- Multi-level filtering system
- Live tile editor with real-time preview
- Modular CSS architecture with zero duplication
- Comprehensive locale support (52 locales)
- Drag-and-drop file upload system
- Analytics dashboard with statistics
- Tile border color system with instant visual feedback
- Real-time analytics integration

### **🔄 Current Focus**
- Left toolbar drag-and-drop area improvements
- Export to CSV functionality enhancements
- Filter system reliability improvements
- Additional country flag support

### **🎯 Future Enhancements**
- Batch tile editing capabilities
- Advanced image processing options
- Locale-specific font rendering
- Performance optimizations for large datasets
- Accessibility improvements
- Mobile responsive design enhancements

---

## 📝 Version History

### **v2.2 - Tile Border Color System & Real-time Analytics**
- Implemented color-coded tile borders with instant visual feedback
- Integrated real-time analytics updates from both live editor and CSV tile editing

### **v2.1 - Country Identification & Image Analysis**
- Added Unicode flag emoji country badges
- Implemented detailed image info panel
- Enhanced filter system with multi-level support
- Improved user experience with default states

### **v2.0 - Visual Text Measurement**
- Replaced character counting with canvas-based measurement
- Added smart subtitle visibility logic
- Implemented live editor with real-time preview
- Modularized CSS architecture

### **v1.0 - Initial Release**
- Basic tile preview functionality
- CSV data import
- Drag-and-drop file upload
- Analytics dashboard

This documentation reflects the current state of TileForge as a comprehensive Xbox tile localization tool with advanced visual measurement, country identification, and image analysis capabilities.

## ✅ Locale Validation — Presence, Count, and Exact Order

### Overview
Ensures all required locales for the active template are present, counted correctly, and in the exact expected order.

- Templates covered: Top of Home (ToH) and Mobile Spotlight
- Expected sets source: `lab/TileForge/js/locale-mapping.js` → `TileForgeLocales.getDefaultSet(templateKey)`
- Active set source: `getActiveLocalesForPreview()` (CSV-derived or Manage Locales selection)

### UI Placement
- Badge id: `#localeValidationBadge`
- Location: Toolbar info row next to `#statusInfoBadge` in `lab/TileForge/index.html`
- Behavior: Shows “Locales: Valid” or “Locales: Invalid” and is clickable/focusable

### Triggers
Validation recalculates automatically on:
- `tf:csvProcessed` — after CSV is loaded/processed
- `tf:templateSwitched` — when switching between ToH and Mobile Spotlight
- `tf:localesChanged` — after applying changes in Manage Locales modal

### Modal Details (Shared Modal System)
- Opens on click/Enter/Space of the badge
- API preference order:
  1) `Modal.createTabbedModal({ title, tabs: [{ title: 'Summary', content }], size: 'large' })`
  2) `Modal.create({ title, size }).setBody(content).show()`
  3) `Modal.alert(message, kind)`
- Content includes:
  - Status banner: Valid / Missing or extra locales / Count mismatch / Order mismatch
  - Presence lists: Missing and Extras (when applicable)
  - Count details: Expected vs Found
  - Order comparison table: Expected vs Active with mismatches highlighted
  - Full lists: `<details>` blocks for Expected and Active sequences

### Styling (Reuses Existing Classes)
- Status banner: `.file-status` with variants `success`, `warning`, `error`
- Locale chips: `.country-badge` (with contextual `clean`, `warning`, `overflow`)
- Mismatch emphasis: `.warning` applied to rows/cells in the order table
- No new CSS added; leverages tokens already in `css/styles.css`

### Accessibility
- Badge configured with `role="button"`, `tabindex="0"`, keyboard activation (Enter/Space)
- Pointer cursor set programmatically for hover affordance
- Modal content uses semantic markup and ARIA labels where appropriate

### Implementation Notes
- File: `lab/TileForge/js/analytics.js`
  - `renderValidationBadge(validation)` renders badge text/affordances and binds events
  - `showLocaleValidationDetails()` builds the HTML report and opens the modal
  - Stores last snapshot for modal: `lastValidation`, `lastExpected`, `lastActive`
- Integration points:
  - Template key via `template-system.js` (`getCurrentTemplateKey()`)
  - Locale changes dispatched by `main.js` (`tf:localesChanged`)
  - Badge updated along with analytics after CSV processing

<!-- updated by Cascade: locale validation badge + modal documentation -->

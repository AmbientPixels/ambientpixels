Mision:
css refactor
We need to break up our current css system into smaller more manageable files. We have one uber css (cardforge-ui.css) and 3 others. We want to establish preferable under 10 css files. We need to determine the best categories or split we need to  make. The uber css file contain duplicate styles we will discover them and remove them as we progress in teh refactor. FIrst lets identify what we currently have 

C:\ambientpixels\EchoGrid\cardforge\css\card-forge.css
C:\ambientpixels\EchoGrid\cardforge\css\cardforge-card.css
C:\ambientpixels\EchoGrid\cardforge\css\cardforge-layout.css

C:\ambientpixels\EchoGrid\cardforge\css\cardforge-ui.css


index
C:\ambientpixels\EchoGrid\cardforge\index.html


once we determin the best fiels to make lets make blank files. 


next we will begin to exteact the css from eh fiels to the newly created files. we need a stepwise approach. this is teh approach. it must be followed every time. 

1 you will copy the css code from teh old (legacy) file to the new file
2 you will add teh reference to index.html
3 I will remove the code manually
4 you will then report what css to remove from the legacy code.  we we dont see changes or minimal changes (from duplicate removals) we will continue

this is a Strick outline of the process to endure we dont miss and also so we have clean code and remove duplicates.  

first list what the legacy css files contain and what they do here:

## LEGACY CSS FILES ANALYSIS

### 1. cardforge-ui.css (UBER FILE - ~3,091 lines)
**Purpose:** Main UI components, controls, and interface elements
**Contains:**
- Tabbed sections and stepper tabs
- Dialog/modal systems
- Message notifications
- Gallery grid layouts
- Form controls (social links, badges, stats)
- Modular system UI (tier selectors, preset buttons)
- Icon systems for layouts, alignments, containers
- Visual preview thumbnails
- Responsive design rules
- Legacy layout CSS (marked for removal)
- Effect previews and style options

### 2. cardforge-card.css (~1,055 lines)
**Purpose:** Card rendering, styling, and modular system application
**Contains:**
- Basic card container styling
- Card glow effects and animations
- Color palette variants (neon, earth, ocean, sunset, monochrome)
- Layout-specific card styling (minimal, split, stack, frame)
- Content alignment and weight distribution
- Modular system CSS classes
- Card element styling (names, stats, quotes)

### 3. cardforge-layout.css (~98 lines)
**Purpose:** Page layout and column structure
**Contains:**
- Main container layout (flex-based)
- Left column (form pane) styling
- Right column (preview pane) styling
- Card preview zone positioning
- Responsive layout adjustments
- Non-sticky implementation fixes

### 4. card-forge.css (~594 lines)
**Purpose:** Form styling and editor components
**Contains:**
- CardForge editor layout (grid-based)
- Form input styling
- Stat rows, social rows, badge rows
- Micro badge containers
- Form validation styling
- Input focus states
- Form-specific overrides

## DUPLICATE STYLES IDENTIFIED
- Layout grid systems (both cardforge-layout.css and card-forge.css have container layouts)
- Form styling appears in both cardforge-ui.css and card-forge.css
- Card container basics might overlap between files

## PROPOSED NEW CSS FILE STRUCTURE (8 files total)

### 1. cardforge-base.css
**Purpose:** Core variables, resets, and base card container
**Extract from:** cardforge-card.css (base container, animations, glow effects)
**Size estimate:** ~200 lines

### 2. cardforge-layout.css (KEEP - minimal changes)
**Purpose:** Page layout and column structure
**Current:** Already focused and clean at ~98 lines
**Action:** Keep as-is, maybe minor cleanup

### 3. cardforge-forms.css
**Purpose:** All form inputs, validation, and form-specific styling
**Extract from:** card-forge.css (form inputs, focus states) + cardforge-ui.css (form controls)
**Size estimate:** ~400 lines

### 4. cardforge-modular.css
**Purpose:** Modular system CSS classes (palettes, layouts, alignments, effects)
**Extract from:** cardforge-card.css (modular classes, variants) + cardforge-ui.css (modular UI)
**Size estimate:** ~600 lines

### 5. cardforge-ui-components.css
**Purpose:** UI controls, buttons, dialogs, messages, tabs
**Extract from:** cardforge-ui.css (dialogs, messages, tabs, stepper)
**Size estimate:** ~300 lines

### 6. cardforge-icons.css
**Purpose:** All icon systems and visual previews
**Extract from:** cardforge-ui.css (icon systems, preview thumbnails)
**Size estimate:** ~500 lines

### 7. cardforge-gallery.css
**Purpose:** Gallery grid, image selection, and media-related UI
**Extract from:** cardforge-ui.css (gallery grid, image controls)
**Size estimate:** ~200 lines

### 8. cardforge-responsive.css
**Purpose:** All responsive design and mobile adjustments
**Extract from:** All files (media queries, mobile-specific rules)
**Size estimate:** ~300 lines

## EXTRACTION PRIORITY ORDER
1. cardforge-base.css (foundation first)
2. cardforge-forms.css (high duplication potential)
3. cardforge-ui-components.css (clear separation)
4. cardforge-icons.css (large, self-contained)
5. cardforge-modular.css (complex, needs careful extraction)
6. cardforge-gallery.css (medium complexity)
7. cardforge-responsive.css (cross-cutting, do last)
8. Clean up cardforge-layout.css (minor)

## PROGRESS TRACKING
- [x] Analyzed all 4 legacy CSS files
- [x] Proposed new file structure (8 files)
- [x] Created 7 blank new CSS files:
  - [x] cardforge-base.css
  - [x] cardforge-forms.css
  - [x] cardforge-ui-components.css
  - [x] cardforge-icons.css
  - [x] cardforge-modular.css
  - [x] cardforge-gallery.css
  - [x] cardforge-responsive.css
  - [x] cardforge-layout.css (already exists, will clean up later)
- [ ] Begin stepwise extraction process



## NEXT STEP: Start with cardforge-base.css
**Ready to extract:** Base card container, animations, and glow effects from cardforge-card.css
**Process:** Copy CSS → Add reference to index.html → User removes from legacy → Report what to remove  
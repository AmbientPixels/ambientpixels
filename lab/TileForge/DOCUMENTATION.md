# TileForge Documentation
**Xbox Tile Localization Preview Tool with Visual Text Measurement**

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
│   └── template-system.css # Template selection and Mobile Spotlight styles
└── js/
    ├── main.js             # Application initialization
    ├── constants.js        # Locale mappings, limits, helper functions
    ├── template-system.js  # Template selection and switching logic
    ├── tile-renderer.js    # Tile creation and locale rendering
    ├── text-measurement.js # Visual text analysis and overflow detection
    ├── live-editor.js      # Real-time tile editing functionality
    └── analytics.js        # Statistics and dashboard updates
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

## 🎯 Image Dimension Validation System

TileForge includes a comprehensive image dimension validation system that ensures uploaded images comply with Xbox template specifications. The system provides real-time feedback through both detailed information panels and visual badges.

### **Template Requirements**
- **Top of Home (ToH)**: 560×315px (Xbox standard horizontal format)
- **Mobile Spotlight**: 694×758px (mobile-optimized vertical format)

### **Validation Logic**

#### **Compliance Levels**
1. **✅ Perfect Match**: Exact dimension match (green badge/text)
2. **⚠️ Close Match**: Within ±5% tolerance (green badge/text)
3. **❌ Non-Compliant**: Outside tolerance range (red badge/text)

#### **JavaScript Implementation**
```javascript
// Core validation function in analytics.js
function validateImageDimensions(width, height) {
  const currentTemplate = window.templateSystem.getCurrentConfig();
  const expectedDimensions = {
    width: currentTemplate.actualDimensions.width,
    height: currentTemplate.actualDimensions.height
  };
  
  // Exact match check
  const isExactMatch = width === expectedDimensions.width && 
                      height === expectedDimensions.height;
  
  // Tolerance check (±5%)
  const tolerance = 0.05;
  const isWithinTolerance = 
    Math.abs(width - expectedDimensions.width) <= expectedDimensions.width * tolerance &&
    Math.abs(height - expectedDimensions.height) <= expectedDimensions.height * tolerance;
  
  return {
    status: isExactMatch ? 'compliant' : isWithinTolerance ? 'close' : 'non-compliant',
    badgeText: `${width}×${height}`,
    badgeClass: isExactMatch || isWithinTolerance ? 'compliant' : 'non-compliant',
    message: `${isExactMatch ? 'Perfect' : isWithinTolerance ? 'Close' : 'Does not'} match for ${templateName}`
  };
}
```

### **Visual Feedback System**

#### **Enhanced Image Info Panel**
- **Color-coded dimensions**: Green for compliant, red for non-compliant
- **Template compliance row**: Shows current template requirements
- **Detailed messages**: Explains compliance status and expected dimensions
- **Visual icons**: ✅, ⚠️, ❌ indicators for quick status recognition

#### **Preview Badges**
- **Universal coverage**: Appears on all tile types (live editor, localized cards, modal previews)
- **Dimension display**: Shows actual image size (e.g., "560×315")
- **Color coding**: Green background for compliant, red for non-compliant
- **Strategic positioning**: Top-left corner to avoid UI conflicts
- **Hover tooltips**: Detailed compliance information on hover

### **Template-Aware Validation**

#### **Dynamic Re-validation**
The validation system automatically re-checks image dimensions when users switch between templates:

```javascript
// Template switching triggers re-validation
function switchTemplate(templateType) {
  // ... template switching logic ...
  
  // Re-validate image dimensions for new template
  if (typeof revalidateImageDimensions === 'function') {
    revalidateImageDimensions();
  }
}

// Re-validation function
function revalidateImageDimensions() {
  if (window.currentImageInfo) {
    const validation = validateImageDimensions(
      window.currentImageInfo.width, 
      window.currentImageInfo.height
    );
    updateImageInfoPanel(window.currentImageInfo);
  }
}
```

#### **Global State Management**
- **Image storage**: `window.currentImageInfo` stores current image metadata
- **Template awareness**: Validation adapts to active template requirements
- **Immediate feedback**: Updates occur instantly on template changes

### **CSS Styling**

#### **Validation Classes**
```css
/* Info panel validation colors */
.validation-compliant {
  color: #4caf50 !important;
  font-weight: 500;
}

.validation-error {
  color: #f44336 !important;
  font-weight: 500;
}

/* Badge styling */
.validation-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  z-index: 10;
  pointer-events: none;
}

.validation-badge.compliant {
  background: #4caf50;
  color: white;
}

.validation-badge.non-compliant {
  background: #f44336;
  color: white;
}
```

### **User Experience Benefits**
- **Immediate feedback**: Users know instantly if images meet template specs
- **Template switching**: Validation updates automatically when changing templates
- **Professional presentation**: Clean, color-coded system for quick assessment
- **Non-intrusive design**: Badges positioned to avoid UI conflicts
- **Comprehensive coverage**: Validation appears across all tile instances

### **Technical Architecture**
- **Module**: `analytics.js` contains core validation logic
- **Integration**: Hooks into template system and drag-drop handlers
- **Global state**: Image info stored for template switching scenarios
- **Event-driven**: Responds to both image uploads and template changes

### **Template Persistence & Bug Fixes**
The Mobile Spotlight template system includes robust persistence logic to maintain template consistency across all UI interactions:

#### **Template Persistence Logic**
- **Live Preview Editor**: Automatically re-applies template classes after every text update
- **Locale Tile Editors**: Re-applies Mobile Spotlight template class after `updateTileStatus()` calls
- **Template Switching**: All existing tiles update classes and dimensions dynamically
- **Modal Previews**: Template classes persist when opening locale tile live editors

#### **Resolved Issues**
- **Fixed**: Mobile Spotlight template reversion bug in locale tile editors
- **Root Cause**: Locale editors called `updateTileStatus()` but didn't re-apply template classes
- **Solution**: Added template class re-application logic matching live preview editor behavior
- **Impact**: Consistent 347×379px Mobile Spotlight dimensions across all editing contexts

### **Important Notes for AI Agents**
- ⚠️ **No Country Flags**: Previous country identification system was removed as code bloat
- ✅ **Simple Locale Badges**: Only clean pill-style badges with locale codes (no emojis/flags)
- 🎯 **Core Focus**: Xbox tile localization testing and visual overflow detection
- 📱 **Desktop Optimized**: Professional interface for development workflows
- 🔧 **Helper Functions**: `getLanguageFromLocale()` and `getRegionFromLocale()` in constants.js

### **Common Tasks**
- **Styling Changes**: Modify `css/styles.css` (never inline styles per Windsurf Protocol)
- **Locale Logic**: Update `js/constants.js` for locale mappings and limits
- **Tile Rendering**: Modify `js/tile-renderer.js` for display logic
- **Filtering/UI**: Update `js/main.js` for app functionality

### **Testing**
- Open `index.html` in browser (no server required)
- Upload sample image + CSV file to test functionality
- Check console for any JavaScript errors
- Verify locale badges display correctly without country flags

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
- **Drag & Drop Interface**: Upload images and CSV files with visual styling
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
- **Visual Prominence**: Easy scanning and identification of different locales
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
├── tile-renderer.js     # Tile creation, visual updates, country badges
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
- **HTML Elements**: `#imgDropZone`, `#csvDropZone`, `#imgInput`, `#csvInput`
- **CSS Classes**: `.drop-zone`, `.drop-zone:hover`, `.drop-zone.drag-over`
- **JavaScript**: Event listeners for dragover, dragleave, drop events
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

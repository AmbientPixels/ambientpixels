# TileForge Documentation
**Xbox Tile Localization Preview Tool with Visual Text Measurement**

## 📋 Overview

TileForge is a comprehensive localization preview tool designed for Xbox tile content. It provides real-time visual feedback for game titles across multiple locales, featuring advanced text measurement, drag-and-drop functionality, and modular CSS architecture.

### ✨ Key Features

- **Visual Text Measurement**: Canvas-based pixel-perfect text analysis (replaces conservative character counting)
- **52 Comprehensive Locales**: Full regional coverage including Arabic, European, English, Spanish, and Asian variants
- **Real-time Live Editing**: Click-to-edit tile text with instant visual feedback
- **Drag & Drop Interface**: Upload images and CSV files with visual styling
- **Analytics Dashboard**: Character analysis, locale statistics, and overflow detection
- **Modular Architecture**: Clean separation of concerns with feature-based CSS modules
- **Responsive Design**: Optimized for various screen sizes and resolutions

---

## 🎯 Visual Text Measurement System

### **Revolutionary Approach**
TileForge now uses **Canvas-based visual measurement** instead of conservative character counting, providing:

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

### **Text Analysis Functions**
- `measureTextWidth()`: Pixel-accurate text width measurement
- `analyzeTextLayout()`: Multi-line text analysis with word wrapping
- `willTextFit()`: Single-line overflow prediction
- `analyzeTextVisually()`: Complete text analysis replacing old character-count system

---

## 🏗️ Architecture

### **Modular CSS System**
TileForge follows a strict modular architecture with zero duplication:

```
css/
├── base.css           # Core typography and layout foundation
├── styles.css         # Main app layout, upload system, controls
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
├── text-measurement.js  # Visual text measurement system (NEW)
├── csv-handler.js       # CSV parsing and data management
├── tile-renderer.js     # Tile creation and visual updates
├── live-editor.js       # Real-time editing functionality
├── analytics.js         # Statistics and dashboard updates
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
Full mapping of locale codes to human-readable names with regional variants.

---

## 🎮 Usage Guide

### **Getting Started**
1. **Load Default Data**: Application initializes with 52 locales automatically
2. **Upload Custom Image**: Drag image to "Drop Image Here" zone or browse files
3. **Upload Custom CSV**: Drag CSV to "Drop CSV File Here" zone or browse files
4. **Live Edit Text**: Click any tile title/subtitle to edit in real-time
5. **Monitor Analytics**: View character analysis and locale statistics

### **Visual Text Analysis**
- **Green Status**: Text fits comfortably within visual bounds
- **Orange Warning**: Text approaching visual limits (>90% space utilization)
- **Red Overflow**: Text will be truncated or overflow tile boundaries

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
├── css/                 # Modular stylesheets
├── js/                  # JavaScript modules
└── data/               # Sample CSV files and assets
```

### **CSS Architecture Principles**
- **Zero Duplication**: Each style defined once in appropriate module
- **Feature-Based Separation**: Styles grouped by functionality
- **Windsurf Protocol Compliance**: No inline styles, proper scoping
- **Visual Consistency**: Consistent spacing, colors, and typography

### **JavaScript Module Loading Order**
```html
<script src="js/constants.js"></script>
<script src="js/text-measurement.js"></script>  <!-- NEW -->
<script src="js/csv-handler.js"></script>
<script src="js/tile-renderer.js"></script>
<script src="js/live-editor.js"></script>
<script src="js/analytics.js"></script>
<script src="js/drag-drop.js"></script>
<script src="js/main.js"></script>
```

### **Adding New Locales**
1. Update `DEFAULT_CSV_DATA` in `constants.js`
2. Add locale mapping to `LOCALE_NAMES`
3. Test with visual measurement system

---

## 🔧 Technical Details

### **Drag & Drop System**
- **HTML Elements**: `#imgDropZone`, `#csvDropZone`, `#imgInput`, `#csvInput`
- **CSS Classes**: `.drop-zone`, `.drop-zone:hover`, `.drop-zone.drag-over`
- **JavaScript**: Event listeners for dragover, dragleave, drop events
- **Visual Feedback**: Border color changes and hover effects

### **Text Measurement Specifications**
- **Tile Dimensions**: 280px × 140px
- **Text Area**: 248px usable width (280px - 32px padding)
- **Title Font**: 18px system-ui, weight 600
- **Subtitle Font**: 16px system-ui, weight 400
- **Line Clamp**: Maximum 2 lines with CSS `line-clamp: 2`

### **Performance Optimizations**
- **Canvas Reuse**: Single measurement canvas for all text analysis
- **Modular Loading**: CSS and JS loaded only when needed
- **Event Delegation**: Efficient event handling for live editing

---

## 🚨 Troubleshooting

### **Common Issues**

**Text appears too conservative/short:**
- The new visual measurement system allows much longer text
- Run `testVisualMeasurement()` to see actual limits vs old character count

**Drag-and-drop not working:**
- Ensure `styles.css` is loaded in HTML (required for drop-zone styling)
- Check browser console for JavaScript errors
- Verify file types: images (PNG, JPG, GIF), CSV files only

**Tiles not displaying correctly:**
- Check that all CSS modules are loaded in correct order
- Verify `tile-card.css` contains tile positioning styles
- Ensure no CSS conflicts between modules

**Live editing not responding:**
- Confirm `live-editor.js` is loaded after `tile-renderer.js`
- Check that tiles have proper `contenteditable` attributes
- Verify character counter elements exist

### **Browser Compatibility**
- **Canvas API**: Required for text measurement (supported in all modern browsers)
- **CSS Line Clamp**: Required for text truncation (widely supported)
- **Drag & Drop API**: Required for file uploads (universal support)

---

## 📊 Analytics & Monitoring

### **Dashboard Metrics**
- **Total Locales**: Count of loaded locale variants
- **Character Analysis**: Real-time text length monitoring with visual measurement
- **File Information**: Uploaded image and CSV details
- **Status Distribution**: Clean, warning, and overflow tile counts

### **Visual Measurement Insights**
- **Space Utilization**: Percentage of available tile width used
- **Line Analysis**: Predicted text wrapping and truncation
- **Overflow Prevention**: Proactive detection of text that won't fit

---

## 📈 Changelog

### **Version 2.1 - Visual Measurement Revolution**
- ✅ **NEW**: Canvas-based visual text measurement system
- ✅ **NEW**: `text-measurement.js` module with pixel-perfect analysis
- ✅ **IMPROVED**: 2.5-3x increase in usable text space
- ✅ **FIXED**: Drag-and-drop styling and functionality alignment
- ✅ **ENHANCED**: Title font size increased to 18px, subtitle to 16px

### **Version 2.0 - Complete CSS Modularization**
- ✅ **MAJOR**: Complete CSS architecture overhaul with modular design
- ✅ **EXPANSION**: 52 comprehensive locales (up from 34)
- ✅ **NEW**: Narrator text column support (`items/0/narratorText`)
- ✅ **CLEANUP**: 415+ lines of duplicate CSS removed (42% reduction)
- ✅ **DOCUMENTATION**: Comprehensive system documentation

### **Version 1.0 - Foundation**
- ✅ Basic tile preview functionality
- ✅ CSV upload and parsing
- ✅ Live text editing
- ✅ Character count monitoring

---

## 🎯 Future Enhancements

### **Planned Features**
- **Advanced Typography**: Font family selection and custom font loading
- **Accessibility Testing**: Screen reader compatibility and ARIA improvements
- **Export Functionality**: Generate tile assets and localization reports
- **Batch Processing**: Multiple CSV file handling and comparison
- **Theme Customization**: Dark/light mode and color scheme options

### **Performance Improvements**
- **Web Workers**: Offload text measurement to background threads
- **Caching System**: Store measurement results for repeated text
- **Lazy Loading**: Load locales on-demand for better initial performance

---

**TileForge** - Precision localization preview with visual intelligence.
*Built with modular architecture and Canvas-based text measurement for maximum accuracy and usability.*

---

## 📋 Overview

TileForge is a comprehensive Xbox tile localization preview tool that allows teams to visualize, edit, and export localized content for Xbox tiles across multiple languages. It features a revolutionary visual text measurement system, intelligent subtitle visibility logic, and streamlined CSV export functionality.

## Key Features

### 🎯 Visual Text Measurement System
- **Canvas-based pixel measurement** - Replaces conservative character counting with actual pixel-width analysis
- **Real-time overflow detection** - Prevents text truncation using actual tile dimensions (280px width, 248px usable)
- **Multi-line text analysis** - Smart word wrapping and line break prediction
- **2.5-3x increased text capacity** - Maximizes usable space while preventing overflow

### 🎨 Intelligent Subtitle Visibility
- **Dynamic subtitle hiding** - When headlines break to 2 lines, subtitles automatically disappear
- **Clean tile layout** - Prevents text overcrowding and maintains readability
- **Real-time responsiveness** - Updates instantly as users type

### 📊 Simple Character Counting
- **Clean interface** - Shows only current character count without arbitrary limits
- **No W-count restrictions** - Removed legacy 15-character limits
- **Real-time updates** - Character counts update as users type

### 📤 CSV Export Functionality
- **One-click export** - Download current localization data as CSV
- **Preserves all edits** - Includes user modifications from live editing
- **Proper CSV formatting** - Handles commas, quotes, and newlines correctly
- **Integration ready** - Files can be imported back into localization workflows

## Architecture

### Modular CSS Structure
```
css/
├── styles.css          # Core app layout and global styles
├── tile-card.css       # Tile preview and overlay positioning
├── tile-editor.css     # Inline editing controls and inputs
└── base.css           # Typography and foundational styles
```

### JavaScript Modules
```
js/
├── main.js            # Application initialization and coordination
├── tile-renderer.js   # Tile creation, rendering, and visual updates
├── text-measurement.js # Canvas-based visual text measurement
├── csv-handler.js     # CSV parsing, updating, and export
├── drag-drop.js       # File upload and drag-and-drop handling
└── constants.js       # Locale data and configuration
```

## Visual Text Measurement System

### Technical Implementation
The visual measurement system uses HTML5 Canvas API to measure actual pixel width of text:

```javascript
function measureTextWidth(text, fontSize, fontFamily, fontWeight) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `${fontWeight} ${fontSize} ${fontFamily}`;
  return context.measureText(text).width;
}
```

### Key Functions
- `measureTextWidth()` - Pixel-accurate text measurement
- `analyzeTextLayout()` - Multi-line analysis with word wrapping
- `willTextFit()` - Single-line overflow prediction
- `analyzeTextVisually()` - Complete text fitting analysis

### Performance Optimizations
- Canvas reuse for multiple measurements
- Cached font metrics for repeated calculations
- Efficient word-wrapping algorithms

## Subtitle Visibility Logic

### Behavior
- **Single-line headlines**: Both headline and subtitle are displayed
- **Multi-line headlines**: Subtitle is automatically hidden to prevent overcrowding
- **Real-time updates**: Visibility changes instantly as users type

### Implementation
```javascript
function updateSubtitleVisibility(tileElement) {
  const titleAnalysis = analyzeTextLayout(titleText, '18px', 'system-ui', '600');
  
  if (titleAnalysis.lineCount > 1) {
    subtitleElement.style.display = 'none';
    tileElement.classList.add('title-multiline');
  } else {
    subtitleElement.style.display = 'block';
    tileElement.classList.remove('title-multiline');
  }
}
```

## Locale System

### Supported Locales
TileForge supports 52+ locales including:
- **Arabic**: AR-AE, AR-SA
- **European**: DE-DE, FR-FR, ES-ES, IT-IT
- **Asian**: JA-JP, KO-KR, ZH-CN, ZH-TW
- **English variants**: EN-US, EN-GB, EN-AU, EN-CA
- And many more...

### CSV Structure
```csv
Locale,items/0/title,items/0/subtitle,items/0/narratorText
EN-US,Game Title,Subtitle Text,Narrator description
DE-DE,Spiel Titel,Untertitel Text,Erzähler Beschreibung
```

## Usage Guide

### 1. Loading Data
- **Drag & Drop**: Drop CSV files into the designated drop zone
- **File Browser**: Click "browse files" to select CSV files
- **Default Data**: Application loads with sample Fortnite OG data

### 2. Live Editing
- **Inline Editing**: Click any tile to edit headline/subtitle directly
- **Section Editor**: Use the expandable section editors for batch editing
- **Real-time Preview**: See changes instantly in tile previews
- **Character Counting**: Simple character counts update as you type

### 3. Visual Analysis
- **Overflow Detection**: Visual measurement prevents text truncation
- **Subtitle Logic**: Subtitles hide automatically when headlines wrap
- **Status Indicators**: Visual feedback for text fitting analysis

### 4. Exporting Data
- **Export to CSV**: Click the "📤 Export to CSV" button
- **File Download**: Browser downloads "tileforge-export.csv"
- **All Edits Included**: Exported file contains all user modifications

## Character Counting System

### Simple and Clean
- **Current count only**: Shows actual character count without arbitrary limits
- **No restrictions**: Removed legacy 15-character W-count limitations
- **Visual measurement**: Uses pixel-based analysis instead of character counting
- **Real-time updates**: Counts update instantly as users type

### Implementation
```javascript
// Simple character counter - no limits or warnings
titleInput.addEventListener('input', function() {
  titleCounter.textContent = this.value.length;
  updateSubtitleVisibility(tile);
});
```

## CSV Export System

### Export Functionality
```javascript
function exportToCSV() {
  const csvContent = generateCSVContent(currentCsvData);
  downloadCSVFile(csvContent, 'tileforge-export.csv');
}
```

### Features
- **Proper escaping**: Handles commas, quotes, and newlines in CSV format
- **All columns preserved**: Maintains original CSV structure
- **User edits included**: Exports current state with all modifications
- **Browser download**: Uses Blob API for clean file downloads

## Troubleshooting

### Common Issues

**Tiles not loading**
- Check browser console for JavaScript errors
- Verify CSV file format matches expected structure
- Ensure all required columns are present

**Character counts not updating**
- Verify input event listeners are properly attached
- Check for JavaScript errors in browser console

**Export not working**
- Ensure CSV data is loaded before attempting export
- Check browser permissions for file downloads
- Verify Blob API support in browser

### Browser Compatibility
- **Chrome/Edge**: Full support for all features
- **Firefox**: Full support with Canvas API
- **Safari**: Supported with minor visual differences

## Development Notes

### Code Organization
- **Modular architecture**: Separate concerns across multiple files
- **Event-driven updates**: Real-time responsiveness through event listeners
- **Visual measurement**: Canvas-based text analysis for accuracy

### Performance Considerations
- **Efficient rendering**: Minimal DOM manipulation during updates
- **Cached measurements**: Reuse canvas contexts for performance
- **Debounced updates**: Prevent excessive recalculations during typing

## Future Enhancements

### Planned Features
- **Advanced export options**: Export with analysis data, modified-only export
- **Batch editing tools**: Multi-locale editing capabilities
- **Theme customization**: Custom tile backgrounds and styling
- **Analytics dashboard**: Enhanced text fitting statistics

### Technical Improvements
- **Performance optimization**: Further canvas measurement improvements
- **Accessibility**: Enhanced screen reader support
- **Mobile responsiveness**: Touch-friendly editing interface

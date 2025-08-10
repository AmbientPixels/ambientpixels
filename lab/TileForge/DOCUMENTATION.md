# TileForge Documentation
**Xbox Tile Localization Preview Tool with Visual Text Measurement & Country Identification**

## 📋 Overview

TileForge is a comprehensive localization preview tool designed for Xbox tile content. It provides real-time visual feedback for game titles across multiple locales, featuring advanced text measurement, country identification badges, detailed image analysis, drag-and-drop functionality, and modular CSS architecture.

### ✨ Key Features

- **Visual Text Measurement**: Canvas-based pixel-perfect text analysis (replaces conservative character counting)
- **Country Code Badges**: Unicode flag emojis with locale codes for instant country identification
- **Detailed Image Analysis**: Comprehensive image metadata panel (format, dimensions, file size, aspect ratio)
- **52 Comprehensive Locales**: Full regional coverage including Arabic, European, English, Spanish, and Asian variants
- **Real-time Live Editing**: Click-to-edit tile text with instant visual feedback
- **Advanced Filtering**: Multi-level filtering by status, language, region, and locale
- **Drag & Drop Interface**: Upload images and CSV files with visual styling
- **Analytics Dashboard**: Character analysis, locale statistics, and overflow detection
- **Modular Architecture**: Clean separation of concerns with feature-based CSS modules
- **Responsive Design**: Optimized for various screen sizes and resolutions

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
- **Country Badge System**: Unicode flag emojis with locale codes
- **Image Info Panel**: Detailed metadata display with default state
- **Filter Improvements**: Multi-level filtering with real-time updates
- **CSS Modularization**: Systematic removal of duplicate styles
- **Text Measurement**: Canvas-based pixel-perfect analysis
- **Live Editor**: Real-time tile preview updates

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

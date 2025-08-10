# TileForge Documentation
**Xbox Tile Localization Preview Tool**

Version: 2.0  
Last Updated: January 2025  
Author: AmbientPixels Team

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [File Structure](#file-structure)
5. [Locale System](#locale-system)
6. [CSS Architecture](#css-architecture)
7. [JavaScript Modules](#javascript-modules)
8. [Usage Guide](#usage-guide)
9. [Development](#development)
10. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

TileForge is a comprehensive Xbox Tile Localization Preview Tool designed to help developers and localization teams visualize, edit, and validate Xbox tile content across multiple languages and regions. The tool provides real-time character limit analysis, live editing capabilities, and comprehensive analytics for localization workflows.

### Key Capabilities
- **52 Comprehensive Locales** - Complete coverage of major global markets
- **Real-time Character Analysis** - W-count based character limit validation
- **Live Tile Editor** - Interactive editing with instant preview
- **Analytics Dashboard** - Comprehensive statistics and overflow detection
- **Modular Architecture** - Clean, maintainable codebase with separated concerns

---

## ✨ Features

### 🌍 Comprehensive Locale Support
- **52 Locales** covering major global markets
- **Regional Variants** (EN-US, EN-GB, EN-AU, etc.)
- **RTL Language Support** (Arabic, Hebrew)
- **CJK Language Support** (Chinese, Japanese, Korean)

### 📊 Analytics Dashboard
- **Total Locale Count** - Real-time locale statistics
- **Overflow Detection** - Automatic character limit warnings
- **Near-Limit Analysis** - Proactive overflow prevention
- **Clean Tile Tracking** - Success rate monitoring

### ✏️ Live Tile Editor
- **Real-time Editing** - Instant tile preview updates
- **Character Counting** - W-count based limit validation
- **Visual Feedback** - Color-coded status indicators
- **Batch Operations** - Apply changes to all tiles

### 📁 File Management
- **CSV Import/Export** - Standard localization file format
- **Image Upload** - Custom tile background support
- **Drag & Drop** - Intuitive file handling
- **Format Validation** - Automatic file format checking

---

## 🏗️ Architecture

TileForge follows a **modular architecture** with clear separation of concerns:

```
TileForge/
├── index.html              # Main application entry point
├── css/                    # Modular CSS architecture
│   ├── styles.css          # Core application layout
│   ├── tile-card.css       # Tile display components
│   ├── tile-editor.css     # Live editing system
│   ├── tile-grid.css       # Locale grid layout
│   ├── tile-utils.css      # Utility classes
│   └── dashboard.css       # Analytics dashboard
├── js/                     # JavaScript modules
│   ├── main.js             # Application initialization
│   ├── constants.js        # Configuration and data
│   ├── csv-handler.js      # CSV parsing and export
│   ├── tile-renderer.js    # Tile display logic
│   ├── live-editor.js      # Interactive editing
│   ├── analytics.js        # Statistics and reporting
│   └── drag-drop.js        # File handling
└── assets/                 # Static resources
```

### Design Principles
- **Modular CSS** - Feature-specific stylesheets with no duplication
- **Component-based JS** - Isolated, reusable functionality
- **Progressive Enhancement** - Core functionality without dependencies
- **Responsive Design** - Works across different screen sizes

---

## 📂 File Structure

### Core Files
- **`index.html`** - Main application interface
- **`DOCUMENTATION.md`** - This documentation file
- **`README.md`** - Quick start guide

### CSS Modules
- **`styles.css`** - Core layout, upload system, global typography
- **`tile-card.css`** - Tile preview components, text styling
- **`tile-editor.css`** - Live editing interface, form controls
- **`tile-grid.css`** - Locale organization, grid layout
- **`tile-utils.css`** - Utility classes, helpers
- **`dashboard.css`** - Analytics interface, statistics

### JavaScript Modules
- **`main.js`** - Application initialization and coordination
- **`constants.js`** - Configuration, limits, default data
- **`csv-handler.js`** - CSV parsing, import/export functionality
- **`tile-renderer.js`** - Tile creation and display logic
- **`live-editor.js`** - Interactive editing capabilities
- **`analytics.js`** - Statistics calculation and display
- **`drag-drop.js`** - File upload and drag-drop handling

---

## 🌍 Locale System

### Supported Locales (52 Total)

#### Arabic Regions (2)
- `AR-AE` - Arabic UAE
- `AR-SA` - Arabic Saudi Arabia

#### European Locales (25)
- `CS-CZ` - Czech Czech Republic
- `DA-DK` - Danish Denmark
- `DE-AT` - German Austria
- `DE-CH` - German Switzerland
- `DE-DE` - German Germany
- `EL-GR` - Greek Greece
- `FI-FI` - Finnish Finland
- `FR-BE` - French Belgium
- `FR-CA` - French Canada
- `FR-CH` - French Switzerland
- `FR-FR` - French France
- `HE-IL` - Hebrew Israel
- `HU-HU` - Hungarian Hungary
- `IT-CH` - Italian Switzerland
- `IT-IT` - Italian Italy
- `NB-NO` - Norwegian Norway
- `NL-BE` - Dutch Belgium
- `NL-NL` - Dutch Netherlands
- `PL-PL` - Polish Poland
- `PT-BR` - Portuguese Brazil
- `PT-PT` - Portuguese Portugal
- `SK-SK` - Slovak Slovakia
- `SV-SE` - Swedish Sweden
- `TR-TR` - Turkish Turkey
- `UK-UA` - Ukrainian Ukraine

#### English Variants (16)
- `EN-AE` - English UAE
- `EN-AU` - English Australia
- `EN-CA` - English Canada
- `EN-CZ` - English Czech Republic
- `EN-GB` - English United Kingdom
- `EN-GR` - English Greece
- `EN-HK` - English Hong Kong
- `EN-HU` - English Hungary
- `EN-IE` - English Ireland
- `EN-IL` - English Israel
- `EN-IN` - English India
- `EN-NZ` - English New Zealand
- `EN-SA` - English Saudi Arabia
- `EN-SG` - English Singapore
- `EN-SK` - English Slovakia
- `EN-US` - English United States
- `EN-ZA` - English South Africa

#### Spanish Variants (5)
- `ES-AR` - Spanish Argentina
- `ES-CL` - Spanish Chile
- `ES-CO` - Spanish Colombia
- `ES-ES` - Spanish Spain
- `ES-MX` - Spanish Mexico

#### Asian Locales (5)
- `JA-JP` - Japanese Japan
- `KO-KR` - Korean South Korea
- `ZH-HK` - Chinese Hong Kong
- `ZH-SG` - Chinese Singapore
- `ZH-TW` - Chinese Taiwan

### CSV Data Structure

```csv
Locale,items/0/title,items/0/subtitle,items/0/narratorText
EN-US,Fortnite OG,New season,
JA-JP,Fortnite OG,新シーズン到来,
```

#### Required Columns
- **`Locale`** - ISO language-region code
- **`items/0/title`** - Primary tile text (15 char limit)
- **`items/0/subtitle`** - Secondary tile text (15 char limit)
- **`items/0/narratorText`** - Accessibility text (future feature)

---

## 🎨 CSS Architecture

### Modular Design Philosophy

TileForge uses a **fully modular CSS architecture** with zero duplication:

#### Core Stylesheet (`styles.css`)
- **Application Layout** - Split-screen interface, panels
- **Upload System** - File drop zones, browse controls
- **Global Typography** - Base fonts, text styles
- **Core Controls** - Primary buttons, form elements

#### Feature-Specific Modules
- **`tile-card.css`** - Tile display, text positioning, status badges
- **`tile-editor.css`** - Live editing interface, form controls
- **`tile-grid.css`** - Locale organization, grid layouts
- **`dashboard.css`** - Analytics interface, statistics cards
- **`tile-utils.css`** - Utility classes, helpers

### CSS Best Practices
- **No Duplication** - Each style defined once in appropriate module
- **Scoped Responsibilities** - Clear module boundaries
- **Consistent Naming** - BEM-inspired class naming
- **Performance Optimized** - Minimal cascade conflicts

### Recent Improvements (v2.0)
- **415+ lines of duplicate code removed**
- **42% reduction in main stylesheet size**
- **Eliminated CSS conflicts** causing layout issues
- **Fixed tile text positioning** (bottom-left alignment)

---

## ⚙️ JavaScript Modules

### Module Responsibilities

#### `main.js` - Application Coordinator
```javascript
// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  loadDefaultData();
  setupFileInputs();
  setupDragAndDrop();
  setupLiveEditor();
});
```

#### `constants.js` - Configuration Hub
- **Character Limits** - W-count based validation rules
- **Default CSV Data** - 52 comprehensive locales
- **Locale Names** - Display name mappings
- **Global State** - Application-wide variables

#### `csv-handler.js` - Data Management
- **CSV Parsing** - Robust data extraction
- **File Upload** - Import functionality
- **Data Validation** - Format checking
- **Export Capabilities** - Download processed data

#### `tile-renderer.js` - Display Engine
- **Locale Grouping** - Organize tiles by language
- **Tile Creation** - Generate preview components
- **Character Analysis** - Real-time limit checking
- **Visual Status** - Color-coded feedback

#### `live-editor.js` - Interactive Features
- **Real-time Editing** - Instant preview updates
- **Character Counting** - Live limit validation
- **Batch Operations** - Apply to all tiles
- **Visual Feedback** - Status indicators

#### `analytics.js` - Statistics Engine
- **Locale Counting** - Total locale statistics
- **Overflow Detection** - Character limit violations
- **Status Analysis** - Clean vs. problematic tiles
- **Dashboard Updates** - Real-time statistics

---

## 📖 Usage Guide

### Getting Started

1. **Open TileForge** - Load `index.html` in a web browser
2. **Default Data** - 52 locales load automatically on startup
3. **Upload Custom Data** - Drag CSV file to upload area (optional)
4. **Upload Background** - Drag image file for custom tile background (optional)

### Working with Locales

#### Viewing Locales
- **Locale Sections** - Organized by language-region code
- **Tile Previews** - Visual representation of each locale
- **Status Indicators** - Color-coded character limit status
- **Analytics Dashboard** - Overview statistics

#### Character Limit System
- **Green** - Clean (within limits)
- **Orange** - Near limit (warning threshold)
- **Red** - Overflow (exceeds limits)

#### Live Editing
1. **Click any tile** to open the live editor
2. **Edit text** in the headline/subheadline fields
3. **Watch character counts** update in real-time
4. **Apply changes** to see instant preview
5. **Apply to All** to batch update all locales

### File Operations

#### CSV Import
- **Drag & Drop** - Drop CSV file on upload area
- **Browse** - Click to select file from system
- **Auto-Parse** - Automatic data extraction and validation
- **Error Handling** - Clear feedback for invalid files

#### Image Upload
- **Supported Formats** - PNG, JPG, GIF
- **Background Replacement** - Custom tile backgrounds
- **Automatic Scaling** - Optimized for tile display

### Analytics Dashboard

#### Key Metrics
- **Total Locales** - Count of loaded language variants
- **Overflow Issues** - Tiles exceeding character limits
- **Near Limit** - Tiles approaching character limits
- **Clean Tiles** - Tiles within acceptable ranges

---

## 🛠️ Development

### Setup Requirements
- **Modern Web Browser** - Chrome, Firefox, Safari, Edge
- **Local Web Server** - For file operations (Live Server, Python HTTP server)
- **Text Editor** - VS Code, Sublime Text, etc.

### Development Workflow

#### CSS Development
1. **Identify Module** - Determine which CSS file to modify
2. **Check for Duplicates** - Ensure no conflicting styles exist
3. **Follow Naming** - Use consistent class naming conventions
4. **Test Responsively** - Verify across different screen sizes

#### JavaScript Development
1. **Module Isolation** - Keep functionality in appropriate modules
2. **Error Handling** - Implement robust error checking
3. **Performance** - Optimize for real-time operations
4. **Documentation** - Comment complex logic clearly

### Code Standards

#### CSS Guidelines
- **Modular Organization** - One feature per file
- **No Duplication** - Each style defined once
- **Semantic Naming** - Clear, descriptive class names
- **Consistent Formatting** - Uniform indentation and spacing

#### JavaScript Guidelines
- **ES6+ Features** - Modern JavaScript syntax
- **Error Handling** - Try-catch blocks for file operations
- **Performance** - Debounced updates for real-time features
- **Modularity** - Clear function responsibilities

### Testing Checklist
- [ ] All 52 locales load on page startup
- [ ] CSV import/export functionality works
- [ ] Live editor updates tiles in real-time
- [ ] Character limits are enforced correctly
- [ ] Analytics dashboard shows accurate statistics
- [ ] File drag-and-drop operations function properly
- [ ] Responsive design works on different screen sizes

---

## 🔧 Troubleshooting

### Common Issues

#### Locales Not Loading
**Symptoms:** Empty locale sections, missing tiles
**Solutions:**
- Check browser console for JavaScript errors
- Verify `constants.js` contains `DEFAULT_CSV_DATA`
- Ensure all JavaScript modules are loading properly

#### CSV Import Failures
**Symptoms:** "Invalid CSV file" error messages
**Solutions:**
- Verify CSV has required columns: `Locale`, `items/0/title`, `items/0/subtitle`
- Check for proper UTF-8 encoding
- Ensure no empty rows or malformed data

#### Character Limits Not Working
**Symptoms:** No color coding, incorrect character counts
**Solutions:**
- Verify `LIMITS` object in `constants.js`
- Check `analyzeText()` function in `tile-renderer.js`
- Ensure CSS classes for status indicators are loaded

#### Live Editor Issues
**Symptoms:** Editing doesn't update tiles, character counts wrong
**Solutions:**
- Check `live-editor.js` is loaded and initialized
- Verify event listeners are attached properly
- Check for JavaScript console errors

#### Styling Problems
**Symptoms:** Layout issues, missing styles, visual glitches
**Solutions:**
- Verify all CSS modules are loading in correct order
- Check for CSS conflicts or duplicate styles
- Ensure proper class names are used in HTML

### Performance Issues

#### Slow Loading
- **Reduce Default Data** - Temporarily reduce locale count for testing
- **Optimize Images** - Use compressed background images
- **Browser Cache** - Clear cache if styles aren't updating

#### Memory Usage
- **Large CSV Files** - Break into smaller chunks for processing
- **Image Size** - Optimize background images for web
- **Browser Limits** - Test with different browsers

### Browser Compatibility

#### Supported Browsers
- **Chrome 80+** - Full feature support
- **Firefox 75+** - Full feature support
- **Safari 13+** - Full feature support
- **Edge 80+** - Full feature support

#### Known Limitations
- **File API** - Requires modern browser for drag-and-drop
- **CSS Grid** - Fallback layouts for older browsers
- **ES6 Modules** - May need transpilation for legacy support

---

## 📝 Changelog

### Version 2.0 (January 2025)
- **Comprehensive Locale Support** - Expanded from 34 to 52 locales
- **CSS Architecture Overhaul** - Fully modular, zero duplication
- **Performance Improvements** - 42% reduction in stylesheet size
- **Enhanced CSV Structure** - Added `items/0/narratorText` column
- **Bug Fixes** - Fixed tile text positioning, eliminated CSS conflicts

### Version 1.0 (Initial Release)
- **Core Functionality** - Basic tile preview and editing
- **34 Locale Support** - Initial locale coverage
- **Analytics Dashboard** - Basic statistics and overflow detection
- **CSV Import/Export** - File handling capabilities

---

## 🤝 Contributing

### Development Guidelines
1. **Follow Windsurf Protocol** - Check existing code before creating new
2. **Modular Architecture** - Keep features in appropriate modules
3. **No Duplication** - Avoid duplicate styles or functionality
4. **Documentation** - Update this file with significant changes

### Pull Request Process
1. **Test Thoroughly** - Verify all functionality works
2. **Update Documentation** - Reflect changes in this file
3. **Performance Check** - Ensure no regressions
4. **Browser Testing** - Verify cross-browser compatibility

---

## 📄 License

TileForge is part of the AmbientPixels project suite.  
© 2025 AmbientPixels Team. All rights reserved.

---

*This documentation was last updated: January 2025*  
*For technical support or questions, contact the AmbientPixels development team.*

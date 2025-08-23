# TileForge 🎮

**Xbox Tile Localization Preview Tool**

TileForge is a professional web-based tool designed for Xbox game developers and localization teams to preview how game tiles will appear across different languages and locales. It helps identify text overflow issues and ensures consistent visual quality before deployment.

![TileForge Preview](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)
![Version](https://img.shields.io/badge/Version-1.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## 🆕 August 2025 Major Updates

- **Campsite XML Import:** Drop Campsite-localized XML files directly; parsed and normalized to CSV workflow.
- **XML Export Support:** Export mapped data back to Campsite-localized XML.
- **Unified Mapping & Export:** Map/preview/export from either CSV or XML.
- **CardForge Import Flexibility:** Works with both CSV and XML; initializes data if needed.
- **Intelligent Field Filtering:** Fields with no values (like SubHeader, Footer) are hidden from the mapping UI.
- **Drop Zone & Guidance:** The empty-state in the localized preview now accepts CSV, XML, JSON (arrays), and Images. You can also use the Auto‑Localize drop zone at the top of the editor. Once items exist, localized preview tiles do not accept CSV/XML/JSON drops (image drop per tile remains supported). Clear messaging for Iris-ready CSV export and tool purpose. <!-- updated by Cascade -->
- **Enhanced Modal Workflow:** More robust, user-friendly mapping and preview flows.
- **New Clear All Features:** Quickly reset all mapping and preview data with one click.
- **Improved UI & Control Panel:** New control panel for easier workflow and navigation.
- **Manage Locales:** Panel to view, add, or remove locales for better control.
- **Loading Default Template (Coming Soon):** Option to load a default mapping/template (feature in progress).
- **Arabic & Special Character Support:** Fixed issues with Arabic and special characters in data and preview.
- **New Case Converter Tool:** Added a dedicated Case Converter module for fast text case transformations.
- **Preset Controls Layout:** Blue preset apply buttons now stack vertically next to each preset select (Title, Subheadline, Narrator). <!-- updated by Cascade -->
- **Toolbar Placement Update:** Controls toolbar moved directly under the CSV/XML drop zone for a top-down workflow (previous "Controls" header removed). <!-- updated by Cascade -->
- **Projects Export:** Added “Export Active” button with download icon in the Projects files header to quickly download the active CSV/JSON. <!-- updated by Cascade -->
- **State Preservation:** Files panel expanded/collapsed state now persists across list refreshes for smoother project management. <!-- updated by Cascade -->
- **Subtitle Symbols Selector:** Optional dropdown next to Subtitle Modifiers value. Safely appends %, $, €, £, ¥ only if the template has `{n}` and no existing percent/currency symbol (Behavior B). <!-- updated by Cascade -->

### Bug Fixes (Aug 2025)

- First locale not populating/updating after CSV import in Live Editor
  - Root cause: bulk apply logic skipped index 0 as a "header"; per‑tile updates matched only `Locale` key and could miss `locale`.
  - Changes: removed header skip in `applyManualTextToAllTiles()` (`lab/TileForge/js/live-editor.js`); made row match casing‑agnostic in `updateCsvDataForTile()` (`lab/TileForge/js/csv-handler.js`).
  - Impact: first locale (e.g., `ar-AE`) now renders and updates correctly in previews and inputs.

---

## ✨ Features

### 🎯 Core Functionality
- **Multi-Template Support** - Top of Home (280×140px) and Mobile Spotlight (347×379px) templates
- **Xbox Tile Simulation** - Authentic Xbox tile dimensions with template-specific sizing
- **Multi-Locale Preview** - Test multiple languages simultaneously  
- **Text Overflow Detection** - Template-aware automatic detection and warnings
- **Visual Feedback** - Clear indicators for ellipsis and overflow issues
- **CSV Transformation** - Convert generic localization data to TileForge and Iris-compatible Xbox locale format

### 🖱️ Modern Interface
 - **Template Selection** - Visual template picker with live preview switching
 - **Drag & Drop Upload** - Image drop on the preview tile; CSV/XML/JSON/Image drop supported in the localized preview empty-state and in the Auto‑Localize zone above the editor. After items are created, localized tiles do not accept CSV/XML/JSON drops (image drop still allowed per tile). <!-- updated by Cascade -->
- **Inline Toolbar** - Primary editor toolbar sits directly below the CSV/XML drop zone for immediate access to Save/Clone/New/Reset/Export. <!-- updated by Cascade -->
 - **Click to Browse** - Traditional file selection still available
 - **Transform Modal** - Interactive CSV transformation with drag-and-drop file upload
 - **Live Editor** - Real-time tile editing with template-aware character limits
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Professional Styling** - Xbox-inspired dark theme with smooth animations

### 📊 File Support
- **Images**: JPG, PNG, GIF formats for tile backgrounds
- **CSV Files**: Iris Localization CSV format with locale data
- **File Validation** - Automatic validation with user-friendly error messages

---

## ℹ️ TileForge Information Center

### 🆕 Core Features
- **Case Converter Tool:** Instantly convert text to UPPER, lower, Title, or Sentence case for any field or batch of text. Great for localization and consistency.
- **Clear All:** One-click reset for all mapping and preview data—useful for rapid iteration or starting over.
- **Manage Locales:** Add, remove, or filter locales from your data set for focused previews and exports.
- **Arabic & Special Character Support:** Full UTF-8 support for right-to-left and special language characters.

### 💡 Tips & Tricks
- Use the **Case Converter** to quickly batch-convert all text fields before export—saves tons of manual editing!
- **Clear All** resets your mapping and preview instantly—no need to reload the page.
- If Arabic or special characters look wrong, ensure your CSV is UTF-8 encoded.
- Drag-and-drop is centralized: use the preview tile for images and the Auto‑Localize zone (or Transform modal) for CSV/XML. Localized preview tiles do not accept CSV/XML/JSON drops after items are created (image drop remains supported). <!-- updated by Cascade -->
- Use **Create New Item** in the empty-state to start a new localized item using the same flow as the toolbar New action. Use **Manage Locales** from the left panel to focus on specific regions or languages. <!-- updated by Cascade -->
- Check the **modal drop zone** for file type support and workflow tips.
- Coming soon: **Default Template Loader** for instant mapping setup.
 - Subtitle Symbols: leaving the selector at “No symbol” preserves existing templates; picking a symbol only appends when `{n}` is present and the template doesn’t already include %/currency. <!-- updated by Cascade -->

---

## 🚀 Quick Start

### 1. Setup
```bash
# Clone or download TileForge
# No build process required - pure HTML/CSS/JavaScript
```

### 2. Usage
1. Open `index.html` in your web browser
2. **Select Template**: Choose between Top of Home or Mobile Spotlight in the Template section
3. **Upload Tile Image**: Drag an image file onto the preview tile or click to browse
4. **Upload CSV/XML/JSON Data**: Drop files on the localized preview empty-state, or use the Auto‑Localize zone above the editor, or click to browse
   - After items exist, localized preview tiles do not accept CSV/XML/JSON drops (image drop remains supported on individual tiles)
   - If your CSV needs transformation, the Transform Modal will automatically appear
   - Or click **"Transform Data"** in the Tools section for manual transformation <!-- updated by Cascade -->
5. **Preview Results**: View tiles for all locales with template-specific overflow warnings
6. **Live Edit**: Click any tile to edit text with real-time preview

### 3. CSV Format
Your CSV file should contain columns:
- `Locale` - Language/region code (e.g., 'en-US', 'fr-FR')
- `items/0/title` - Tile title text
- `items/0/subtitle` - Tile subtitle text (optional)

Example CSV:
```csv
Locale,items/0/title,items/0/subtitle
en-US,Epic Adventure Game,Ultimate Edition
fr-FR,Jeu d'Aventure Épique,Édition Ultime
de-DE,Episches Abenteuerspiel,Ultimate Edition
```

## 🔄 CSV Transformation

TileForge includes a powerful CSV transformation system to convert generic localization data into TileForge and Iris-compatible Xbox locale format.

### When to Use
- Your CSV has generic language names instead of Xbox locale codes
- Data structure doesn't match TileForge's expected format
- Need to map regional language variants to specific Xbox locales

### How It Works
1. **Automatic Detection**: TileForge detects when uploaded CSV needs transformation
2. **Transform Modal**: Interactive modal appears with drag-and-drop file upload
3. **Dual File Input**: Upload both mapping table and source data CSV files
4. **Live Preview**: See transformed data before applying
5. **Seamless Integration**: Transformed data flows directly into TileForge

### Required Files
**Mapping Table CSV** - Maps language codes to Xbox locales:
```csv
Language,Country,LanguageLocale
EN,US,EN-US
ES,ES,ES-ES
FR,FR,FR-FR
```

**Source Data CSV** - Your localization content:
```csv
Region,Language,Title,Description,MiniFAD
US,en,Game Title,Game description text,Short text
ES,es,Título del Juego,Texto de descripción del juego,Texto corto
```

### Sample Data
TileForge includes sample CSV files in `sample-data/` folder:
- `mapping-table.csv` - Xbox locale mapping with 55+ supported locales
- `source-data.csv` - Real Xbox promotional content in 24 languages

## 🎨 Template System

TileForge supports two Xbox tile templates optimized for different platforms:

### Top of Home (ToH) - Default
- **Dimensions**: 560×315px (displayed as 280×140px)
- **Aspect Ratio**: Xbox standard horizontal format
- **Text Limits**: 
  - Title: 40 characters max, 2 lines
  - Subtitle: 40 characters max, 2 lines
- **Font Sizes**: Title 18px, Subtitle 16px
- **Best For**: Traditional Xbox dashboard tiles

### Mobile Spotlight - New
- **Dimensions**: 694×758px (displayed as 347×379px)
- **Aspect Ratio**: Vertical mobile-optimized format
- **Text Limits**: 
  - Title: 60 characters max, 3 lines
  - Subtitle: 80 characters max, 3 lines
- **Font Sizes**: Title 20px, Subtitle 16px
- **Best For**: Mobile Xbox app spotlight tiles

### Template Switching
- Use the **Template** section in the left panel to switch between templates
- All existing tiles update automatically when switching templates
- Text analysis and overflow detection adapts to the selected template
- Live editor preview maintains the selected template during editing
- **Template persistence**: Mobile Spotlight template now maintains correct dimensions across all UI interactions
- **Bug fixed**: Locale tile editors no longer revert to Top of Home template when typing

## 📁 Project Structure

```
TileForge/
├── index.html              # Main application file
├── css/
│   ├── styles.css          # Main styling and layout
│   ├── tile-card.css       # Tile preview styling
│   └── template-system.css # Template selection and Mobile Spotlight styles
├── js/
│   ├── main.js             # Application initialization
│   ├── tile-renderer.js    # Tile creation and rendering
│   ├── text-measurement.js # Text analysis and overflow detection
│   ├── live-editor.js      # Live tile editing functionality
│   ├── template-system.js  # Template selection and switching
│   └── constants.js        # Configuration and limits
├── DOCUMENTATION.md        # Technical documentation
└── README.md              # This documentation
```

## 🔧 Technical Details

### Technologies Used
- **HTML5** - Semantic structure and file APIs
- **CSS3** - Modern styling with flexbox and animations
- **Vanilla JavaScript** - No external dependencies
- **File API** - For local file processing
- **Drag & Drop API** - Modern file upload experience

### Browser Support
- ✅ Chrome 60+
- ✅ Firefox 55+
- ✅ Safari 12+
- ✅ Edge 79+

### Key Features Implementation
- **Text Clamping**: Uses `-webkit-line-clamp` for proper text truncation
- **Overflow Detection**: Dynamic measurement of text vs container dimensions
- **File Processing**: FileReader API for local file handling
- **Responsive Design**: CSS Grid and Flexbox for adaptive layouts

## 🎨 Customization

### Styling
Modify `css/styles.css` to customize:
- Color scheme and Xbox branding
- Tile dimensions and layout
- Animation timing and effects
- Typography and spacing

### Functionality  
Extend `js/script.js` to add:
- Additional file format support
- Export functionality
- Batch processing features
- Custom validation rules

## 🐛 Troubleshooting

### Common Issues

**Files not loading?**
- Ensure files are in correct format (images: JPG/PNG/GIF, data: CSV)
- Check browser console for error messages
- Verify CSV has required columns: `Locale`, `items/0/title`

**Text not displaying correctly?**
- Ensure CSV file is UTF-8 encoded for international characters
- Check for proper CSV formatting with quotes around text containing commas

**Drag & drop not working?**
- Ensure you're using a modern browser with drag-drop support
- Try the "browse files" link as an alternative
- Check that JavaScript is enabled

## 🚀 Use Cases

### Game Development
- **Pre-Certification Testing** - Catch text overflow before Xbox certification
- **Localization QA** - Visual verification of translated content
- **Design Review** - Ensure consistent visual quality across languages

### Localization Teams
- **Translation Validation** - See how translations fit in actual UI
- **Length Testing** - Identify problematic long translations
- **Cultural Adaptation** - Preview localized content in context

## 📈 Future Enhancements

Potential features for future versions:
- [ ] Export tiles as PNG images
- [ ] Batch processing for multiple CSV files
- [ ] Preset tile templates for different game genres
- [ ] Real-time text editing without file re-upload
- [ ] Integration with localization management systems
- [ ] Support for additional Xbox tile sizes

## 🤝 Contributing

TileForge is designed to be easily extensible. To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test across different browsers
5. Submit a pull request

## 📄 License

MIT License - Feel free to use TileForge in your projects!

## 🙋‍♂️ Support

For questions, issues, or feature requests:
- Check the troubleshooting section above
- Review browser console for error messages
- Ensure files meet format requirements

---

**TileForge** - Making Xbox localization testing simple and visual! 🎮✨

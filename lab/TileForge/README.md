# TileForge 🎮

**Xbox Tile Localization Preview Tool**

TileForge is a professional web-based tool designed for Xbox game developers and localization teams to preview how game tiles will appear across different languages and locales. It helps identify text overflow issues and ensures consistent visual quality before deployment.

![TileForge Preview](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)
![Version](https://img.shields.io/badge/Version-1.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

### 🎯 Core Functionality
- **Multi-Template Support** - Top of Home (280×140px) and Mobile Spotlight (347×379px) templates
- **Xbox Tile Simulation** - Authentic Xbox tile dimensions with template-specific sizing
- **Multi-Locale Preview** - Test multiple languages simultaneously  
- **Text Overflow Detection** - Template-aware automatic detection and warnings
- **Visual Feedback** - Clear indicators for ellipsis and overflow issues

### 🖱️ Modern Interface
- **Template Selection** - Visual template picker with live preview switching
- **Drag & Drop Upload** - Simply drag image and CSV files onto drop zones
- **Click to Browse** - Traditional file selection still available
- **Live Editor** - Real-time tile editing with template-aware character limits
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Professional Styling** - Xbox-inspired dark theme with smooth animations

### 📊 File Support
- **Images**: JPG, PNG, GIF formats for tile backgrounds
- **CSV Files**: Iris Localization CSV format with locale data
- **File Validation** - Automatic validation with user-friendly error messages

## 🚀 Quick Start

### 1. Setup
```bash
# Clone or download TileForge
# No build process required - pure HTML/CSS/JavaScript
```

### 2. Usage
1. Open `index.html` in your web browser
2. **Select Template**: Choose between Top of Home or Mobile Spotlight in the Template section
3. **Upload Tile Image**: Drag an image file to the left drop zone or click to browse
4. **Upload CSV Data**: Drag your localization CSV to the right drop zone or click to browse
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

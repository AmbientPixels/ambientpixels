# CardForge V2 Preset System Documentation

## Overview
The CardForge V2 preset system provides 8 professionally designed character presets with complete front-of-card styling and back-of-card sample data. Each preset includes unique visual styling, character stats, badges, attributes, and biographical information.

## Preset System Features

### ✅ Complete Preset Collection (8 Presets)
1. **Fantasy Ranger** - Earth palette, framed container, nature-themed
2. **Cyberpunk Runner** - Neon palette, masked container, tech-focused
3. **Arcane Scholar** - Mystic palette, ornate framing, knowledge-based
4. **Space Marine** - Steel palette, military styling, combat-oriented
5. **Corporate Ronin** - Monochrome palette, minimal design, precision-focused
6. **Legendary Hero** - Epic palette, cinematic styling, leadership-focused
7. **Titan Guardian** - Hero large container, divine protection theme
8. **Shadow Operative** - Raw rounded styling, stealth and infiltration

### ✅ Enhanced Stats System
- **5-Stat Limit**: All presets have exactly 5 stats (matching system maximum)
- **Random Values**: Stats range from 1-100 for varied character profiles
- **Animated Bars**: Smooth fill effect with staggered timing (200ms delays)
- **No Default Stats**: Clean slate - stats only appear via presets or user input

### ✅ Dynamic Form Population
- **Complete Data**: Name, class, biography, avatar, stats, badges, attributes
- **Container ID Fixes**: Corrected mismatches between HTML and JavaScript
- **Clean Clearing**: `clearAllDynamicRows()` removes old data before new preset
- **Error Handling**: Missing function fixes and debug logging

## Technical Implementation

### Data Sources
- **Preset Configurations**: Embedded in `card-forge-editor.js` (lines 37-341)
- **Prefill Data**: `./data/prefill-card.json` (default card on page load)
- **Image Gallery**: `./image-manifest.json` (character avatar selection)
- **Card Gallery**: Remote `published-cards.json` (community published cards)

### Animation System
```css
.stat-progress {
  transition: width 1s ease-out;
  width: 0;
}

.stat-progress.animate {
  width: var(--target-width, 0%) !important;
}
```

### JavaScript Integration
```javascript
// Triggered on card content updates
function animateStatBars() {
  const statBars = document.querySelectorAll('.stat-progress');
  statBars.forEach((bar, index) => {
    setTimeout(() => {
      bar.classList.add('animate');
    }, index * 200 + 300); // Staggered animation
  });
}
```

## User Experience

### Preset Application Flow
1. **Click preset button** → Front styling applied to ModularState
2. **Form population** → Back-of-card data fills form fields
3. **Card preview update** → Visual changes render immediately
4. **Stat bar animation** → Smooth fill effect with staggered timing
5. **Complete experience** → Professional, polished card creation

### Animation Sequence
- **Base delay**: 300ms (allows DOM to update)
- **Stagger delay**: 200ms between each stat bar
- **Total duration**: ~1.5 seconds for 5 stats
- **Visual feedback**: Console logging for debugging

## Container ID Mappings
- **Stats**: `stats-editor` (HTML) ↔ `stats-editor` (JS)
- **Badges**: `micro-editor` (HTML) ↔ `micro-editor` (JS)
- **Attributes**: `attribute-editor` (HTML) ↔ `attribute-editor` (JS)

## Quality Assurance

### ✅ Verified Working
- All 8 presets load correctly with unique data
- Stats populate exactly 5 per preset
- Animated stat bars trigger on card updates
- Form clearing works properly between presets
- No JavaScript errors in console
- Professional visual polish maintained

### Performance Optimizations
- CSS animations use GPU acceleration
- Staggered timing prevents overwhelming visual effects
- Minimal DOM manipulation for smooth performance
- Error handling prevents system crashes

## Future Enhancements
- Additional preset themes and character types
- Customizable animation timing preferences
- Preset favoriting and user-created presets
- Enhanced stat bar styling options

---

**Status**: Production-ready ✅  
**Last Updated**: January 2025  
**Version**: CardForge V2.1

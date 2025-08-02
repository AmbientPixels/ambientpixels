# CardForge V2 Modular System Documentation

## Overview

CardForge V2 implements a sophisticated **6-tier hierarchical modular UI system** that provides users with granular control over card design through progressive disclosure. This system replaces the previous flat picker interface with a structured, hierarchical approach that reduces cognitive load while maximizing customization options.

## Architecture

The modular system is built on a matrix architecture where **Layout + Color Palette + Image Style** work independently and harmoniously. This allows any combination of these elements to work together without conflicts or overrides.

### Key Benefits of the Matrix System

- **Modular Design:** Each layout maintains its structure
- **Variant Support:** Large/Small variants work across all layouts
- **No Overrides:** Eliminated redundant CSS rules
- **Maintainable:** Easy to add new layouts or image styles
- **Consistent:** All combinations work predictably

## Tier Structure

### Tier 1: Layout Style
- **Purpose:** Controls the fundamental card structure
- **Options:** Hero, Split, Minimal, Left Aligned, Right Aligned, Grid
- **Implementation:** Base CSS classes (e.g., `layout-hero`, `layout-split`)
- **State Property:** `ModularState.layout`

### Tier 2: Content Alignment (3-level hierarchy)
- **Purpose:** Controls content positioning and spacing
- **Level 1:** Alignment Type (Left, Center, Right)
  - **State Property:** `ModularState.alignmentType`
- **Level 2:** Weight Distribution (Top Heavy, Balanced, Bottom Heavy)
  - **State Property:** `ModularState.alignmentWeight`
- **Level 3:** Style Variants (Minimal, Padded, Compact)
  - **State Property:** `ModularState.alignmentStyle`
- **Legacy Support:** `ModularState.alignment` (maintained for backward compatibility)

### Tier 3: Visual Weight
- **Purpose:** Controls content distribution and emphasis
- **Options:** Top Heavy, Balanced, Bottom Heavy
- **Implementation:** CSS classes (e.g., `weight-top-heavy`, `weight-balanced`)
- **State Property:** `ModularState.weight`

### Tier 4: Color Palette
- **Purpose:** Controls color scheme and mood
- **Palette Families:** Neon, Earth, Ocean, Sunset, Monochrome
  - **State Property:** `ModularState.palette`
- **Variants:** Light, Dark (per family)
  - **State Property:** `ModularState.paletteVariant`
- **Implementation:** CSS classes (e.g., `theme-neofantasy`, `variant-light`)

### Tier 5: Image Container
- **Purpose:** Controls avatar/image presentation
- **Container Types:** Masked, Framed, Raw
  - **State Property:** `ModularState.imageContainer`
- **Type-specific variants:** Circle, Hex, Square, etc.
  - **State Property:** `ModularState.imageContainerVariant`
- **Implementation:** CSS classes (e.g., `image-style-masked`, `image-masked-circle`)

### Tier 6: Image Effects
- **Purpose:** Applies visual treatments to images
- **Effect Types:** Filters, Borders, Overlays
  - **State Property:** `ModularState.imageEffect`
- **Effect-specific variants:** Glow, Vintage, Pixel, etc.
  - **State Property:** `ModularState.imageEffectVariant`
- **Implementation:** CSS classes (e.g., `image-effect-glow`, `image-glow-subtle`)

## HTML/CSS/JS Patterns

### HTML Structure
```html
<div class="card-preview-canvas card-front 
            theme-neofantasy variant-light 
            layout-hero 
            image-style-hero image-hero-large">
  <!-- Card content -->
</div>
```

### CSS Implementation
```css
/* Base layout styles */
.layout-hero { /* Base hero layout styles */ }
.layout-split { /* Base split layout styles */ }

/* Image style implementation */
.image-style-hero .card-avatar {
  border-radius: 8px;
  border: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  object-fit: cover;
  object-position: center;
  transition: all 0.3s ease;
}

/* Variant support */
.card-preview-canvas.layout-split.image-hero-large .card-avatar {
  aspect-ratio: 16 / 9 !important; /* Taller, more cinematic */
}

.card-preview-canvas.layout-split.image-hero-small .card-avatar {
  aspect-ratio: 3 / 1 !important; /* Flatter, more compact */
}
```

### JavaScript State Management
```javascript
const ModularState = {
  // Tier 1: Base Layout
  layout: 'hero',
  
  // Tier 2: Content Alignment (3-level hierarchy)
  alignment: 'center', // Legacy compatibility
  alignmentType: 'center',
  alignmentWeight: 'balanced',
  alignmentStyle: 'padded',
  
  // Tier 3: Visual Weight
  weight: 'balanced',
  
  // Tier 4: Color Palette
  palette: 'neon',
  paletteVariant: 'light',
  
  // Tier 5: Image Container
  imageContainer: 'masked',
  imageContainerVariant: 'circle',
  
  // Tier 6: Image Effects
  imageEffect: 'none',
  imageEffectVariant: 'clean'
};
```

## Progressive Disclosure

The modular system implements progressive disclosure to reduce cognitive load:

1. **Initial View:** Only Tier 1 (Layout) is fully expanded
2. **Selection Behavior:** When a user selects a layout, Tier 2 (Alignment) expands
3. **Cascading Expansion:** Each tier selection reveals the next tier's options
4. **Current Selection Display:** Each tier shows the currently selected option
5. **Collapsible Tiers:** Users can collapse previously expanded tiers to focus on current choices

## Implementation Details

### Initialization
The modular system is initialized in `initModularSystem()` which:
- Sets up event listeners for tier selections
- Initializes the UI based on default or saved ModularState
- Ensures proper progressive disclosure behavior

### State Updates
When a user selects an option:
1. The corresponding ModularState property is updated
2. The updatePreview() function is called
3. CSS classes are applied to the card preview based on the updated state
4. The UI is updated to reflect the current selection

### Preview Updates
The `updatePreview()` function:
- Collects the current ModularState values
- Applies corresponding CSS classes to the card preview
- Generates card content based on form data
- Updates both front and back faces of the card

## Recent Technical Fixes

### Hero Variant Aspect Ratios
- **Hero Large:** 16:9 ratio (taller, more cinematic)
- **Hero Small:** 3:1 ratio (flatter, more compact)
- Fixed across all layouts (Split, Minimal, Left/Right Aligned, Grid)

### CSS Selector Correction
- Changed from data attribute selectors to class selectors
- Ensures proper matching with JavaScript-generated classes
- Consistent pattern across all layouts and variants

### Theme System Consolidation
- Standardized on 'neofantasy' theme
- Removed unused theme CSS (synthwavehacker, propersona)
- Fixed theme name mismatch in JavaScript

## Planned Enhancements

### Component Visibility Toggles
- Toggle visibility for Class, Rarity, Quote sections
- Name and Bio remain required
- Global toggles for Stats, Social, Badges sections

### Visual UI Selectors
- Replace text dropdowns with visual previews
- Show color swatches for palette selection
- Display mini-previews for layout options
- Visual filters for image effects

### Additional Design Options
- Back image customization
- Border style and color controls
- Background particle effects
- Advanced visual settings panel

## Technical Implementation Notes

### Class Naming Convention
- Layout classes: `layout-{name}` (e.g., `layout-hero`, `layout-split`)
- Theme classes: `theme-{name}` (e.g., `theme-neofantasy`)
- Variant classes: `variant-{name}` (e.g., `variant-light`, `variant-dark`)
- Image style classes: `image-style-{name}` (e.g., `image-style-hero`)
- Image variant classes: `image-{style}-{variant}` (e.g., `image-hero-large`)

### CSS Architecture
- Base styles define core card structure
- Layout styles define positioning and spacing
- Theme styles define colors and visual treatment
- Image styles define avatar/image presentation
- Responsive breakpoints ensure mobile compatibility

### JavaScript Integration
```javascript
// Example of class application in updatePreview()
front.className = `card-preview-canvas card-front theme-${currentPreset} variant-${currentPalette} layout-${currentLayout} image-style-${currentImageStyle} image-${currentImageStyle}-${currentImageVariant}`;
```

## Conclusion

The CardForge V2 modular system provides a flexible, maintainable architecture for card customization. The 6-tier hierarchical approach with progressive disclosure reduces cognitive load while maximizing customization options. The matrix system ensures that any combination of Layout + Color Palette + Image Style works harmoniously without conflicts.

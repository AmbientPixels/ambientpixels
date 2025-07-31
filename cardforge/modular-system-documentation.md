# CardForge V2 Modular System Documentation

## Overview

CardForge V2 implements a sophisticated 6-tier hierarchical modular UI system that provides users with granular control over card design through progressive disclosure. This system replaces the previous flat picker interface with a structured, hierarchical approach that reduces cognitive load while maximizing customization options.

## System Architecture

### Core Principles

1. **Progressive Disclosure**: Complex options are revealed progressively as users make higher-level choices
2. **Hierarchical Organization**: Options are organized in logical parent-child relationships
3. **Visual Consistency**: All tiers use consistent visual patterns and interaction models
4. **State Management**: Global state variables track selections across all tiers
5. **Live Preview**: Changes are reflected immediately in the card preview

### Modular Tier Structure

The system consists of 6 primary tiers, each with specific responsibilities:

```
Tier 1: Base Layout (Foundation)
├── Hero, Split, Minimal, Overlay, Stack, Frame

Tier 2: Content Alignment (3-Level Hierarchy)
├── Level 1: Alignment Type
│   ├── Left, Center, Right
├── Level 2: Weight Distribution (per alignment)
│   ├── Top Heavy, Balanced, Bottom Heavy
└── Level 3: Style Variants (per weight)
    ├── Minimal, Padded, Compact

Tier 4: Color Palettes (Enhanced)
├── Palette Families: Neon, Earth, Ocean, Sunset, Monochrome
└── Variants: Light, Dark (per family)

Tier 5: Image Container (2-Level Hierarchy)
├── Level 1: Container Type
│   ├── Masked, Framed, Raw
└── Level 2: Container Variants (per type)
    ├── Masked: Circle, Hex, Blob
    ├── Framed: Border, Shadow, Glow
    └── Raw: Contain, Cover, Fill

Tier 6: Image Effects (2-Level Hierarchy)
├── Level 1: Effect Type
│   ├── Filters, Borders, Overlays
└── Level 2: Effect Variants (per type)
    ├── Filters: Sepia, Grayscale, Blur, Brightness
    ├── Borders: Solid, Dashed, Glow, Neon
    └── Overlays: Gradient, Pattern, Texture

Tier 7: Image Dimensions (2-Level Hierarchy)
├── Level 1: Coverage Type
│   ├── Contain, Cover, Fill
└── Level 2: Aspect Ratio Variants (per coverage)
    ├── Contain: Square, Portrait, Landscape
    ├── Cover: Wide, Standard, Tall
    └── Fill: Stretch, Crop, Fit
```

## Implementation Details

### HTML Structure

Each tier is implemented with semantic HTML using data attributes for JavaScript integration:

```html
<!-- Tier 1: Base Layout -->
<div class="tier-1-container">
  <h3>Base Layout</h3>
  <div class="tier-1-options">
    <div class="tier-1-option" data-tier1="hero">
      <div class="option-thumbnail hero-thumbnail"></div>
      <span class="option-label">Hero</span>
    </div>
    <!-- Additional layout options... -->
  </div>
</div>

<!-- Tier 2: Content Alignment (Progressive Disclosure) -->
<div class="tier-2-container">
  <h3>Content Alignment</h3>
  
  <!-- Level 1: Alignment Type -->
  <div class="alignment-options">
    <div class="alignment-option" data-alignment="left">
      <div class="option-thumbnail align-left-thumbnail"></div>
      <span class="option-label">Left</span>
    </div>
    <!-- Additional alignment options... -->
  </div>
  
  <!-- Level 2: Weight Distribution (Hidden by default) -->
  <div class="weight-container" data-weight-options="left" style="display: none;">
    <h4>Weight Distribution</h4>
    <div class="weight-options">
      <div class="weight-option" data-weight="top-heavy">
        <div class="option-thumbnail weight-top-thumbnail"></div>
        <span class="option-label">Top Heavy</span>
      </div>
      <!-- Additional weight options... -->
    </div>
    
    <!-- Level 3: Style Variants (Hidden by default) -->
    <div class="variant-container" data-style-variants="top-heavy" style="display: none;">
      <h5>Style Variants</h5>
      <div class="variant-options">
        <div class="variant-option" data-variant="minimal">
          <div class="option-thumbnail variant-minimal-thumbnail"></div>
          <span class="option-label">Minimal</span>
        </div>
        <!-- Additional variant options... -->
      </div>
    </div>
  </div>
</div>
```

### CSS Implementation

The modular system uses a comprehensive CSS architecture:

#### Base Tier Styling
```css
/* Tier Container Base Styles */
.tier-1-container,
.tier-2-container,
.tier-5-container,
.tier-6-container,
.tier-7-container {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--aura-bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--mood-border-color);
}

/* Option Grid Layouts */
.tier-1-options,
.alignment-options,
.weight-options,
.variant-options,
.container-options,
.container-variant-options,
.effect-options,
.effect-variant-options,
.coverage-options,
.dimension-variant-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

/* Option Base Styling */
.tier-1-option,
.alignment-option,
.weight-option,
.variant-option,
.container-option,
.container-variant-option,
.effect-option,
.effect-variant-option,
.coverage-option,
.dimension-variant-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem;
  background: var(--aura-bg-primary);
  border: 2px solid var(--mood-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: center;
}

/* Hover and Selected States */
.tier-1-option:hover,
.alignment-option:hover,
.weight-option:hover,
.variant-option:hover,
.container-option:hover,
.container-variant-option:hover,
.effect-option:hover,
.effect-variant-option:hover,
.coverage-option:hover,
.dimension-variant-option:hover {
  border-color: var(--mood-accent-color);
  background: var(--aura-bg-hover);
  transform: translateY(-2px);
}

.tier-1-option.selected,
.alignment-option.selected,
.weight-option.selected,
.variant-option.selected,
.container-option.selected,
.container-variant-option.selected,
.effect-option.selected,
.effect-variant-option.selected,
.coverage-option.selected,
.dimension-variant-option.selected {
  border-color: var(--mood-primary-color);
  background: var(--aura-bg-selected);
  box-shadow: 0 4px 12px rgba(var(--mood-primary-rgb), 0.3);
}
```

#### Visual Thumbnails
```css
/* Thumbnail Base Styles */
.option-thumbnail {
  width: 60px;
  height: 40px;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  border: 1px solid var(--mood-border-color);
}

/* Tier 1: Layout Thumbnails */
.hero-thumbnail {
  background: linear-gradient(to bottom, var(--mood-primary-color) 30%, var(--aura-bg-secondary) 30%);
}

.split-thumbnail {
  background: linear-gradient(to right, var(--mood-primary-color) 50%, var(--aura-bg-secondary) 50%);
}

.minimal-thumbnail {
  background: var(--aura-bg-secondary);
  border: 2px solid var(--mood-primary-color);
}

/* Tier 2: Alignment Thumbnails */
.align-left-thumbnail {
  background: linear-gradient(to right, var(--mood-primary-color) 40%, transparent 40%);
}

.align-center-thumbnail {
  background: linear-gradient(to right, transparent 30%, var(--mood-primary-color) 30%, var(--mood-primary-color) 70%, transparent 70%);
}

.align-right-thumbnail {
  background: linear-gradient(to left, var(--mood-primary-color) 40%, transparent 40%);
}

/* Weight Distribution Thumbnails */
.weight-top-thumbnail {
  background: linear-gradient(to bottom, var(--mood-primary-color) 60%, var(--aura-bg-secondary) 60%);
}

.weight-balanced-thumbnail {
  background: linear-gradient(to bottom, var(--mood-primary-color) 33%, var(--aura-bg-secondary) 33%, var(--aura-bg-secondary) 66%, var(--mood-primary-color) 66%);
}

.weight-bottom-thumbnail {
  background: linear-gradient(to bottom, var(--aura-bg-secondary) 40%, var(--mood-primary-color) 40%);
}
```

### JavaScript Implementation

#### Global State Management
```javascript
// Global state variables for all modular tiers
let currentLayout = 'hero';
let currentAlignment = 'center';
let currentWeight = 'balanced';
let currentVariant = 'minimal';
let currentPalette = 'neon';
let currentPaletteVariant = 'light';
let currentImageContainer = 'masked';
let currentContainerVariant = 'circle';
let currentImageEffect = 'none';
let currentEffectVariant = 'none';
let currentImageDimensions = 'contain';
let currentDimensionsVariant = 'square';
```

#### Progressive Disclosure Logic
```javascript
// Example: Tier 2 Content Alignment Progressive Disclosure
function initTier2ContentAlignment() {
  // Level 1: Alignment Type
  const alignmentOptions = document.querySelectorAll('[data-alignment]');
  alignmentOptions.forEach(option => {
    option.addEventListener('click', function() {
      // Update selection state
      alignmentOptions.forEach(opt => opt.classList.remove('selected'));
      this.classList.add('selected');
      
      // Update global state
      currentAlignment = this.dataset.alignment;
      
      // Progressive disclosure: Show weight options for selected alignment
      const alignmentValue = this.dataset.alignment;
      const weightContainer = document.querySelector(`[data-weight-options="${alignmentValue}"]`);
      
      // Hide all weight containers
      document.querySelectorAll('[data-weight-options]').forEach(container => {
        container.style.display = 'none';
      });
      
      // Show the selected alignment's weight container
      if (weightContainer) {
        weightContainer.style.display = 'block';
      }
      
      // Update live preview
      updatePreview();
    });
  });
  
  // Similar logic for Level 2 (Weight) and Level 3 (Variants)...
}
```

#### Live Preview Integration
```javascript
function updatePreview() {
  const cardPreview = document.querySelector('.card-preview-canvas');
  if (!cardPreview) return;
  
  // Apply modular tier classes
  cardPreview.className = 'card-preview-canvas';
  
  // Tier 1: Base Layout
  cardPreview.classList.add(`layout-${currentLayout}`);
  
  // Tier 2: Content Alignment
  cardPreview.classList.add(`align-${currentAlignment}`);
  cardPreview.classList.add(`weight-${currentWeight}`);
  cardPreview.classList.add(`variant-${currentVariant}`);
  
  // Tier 4: Color Palette
  cardPreview.classList.add(`palette-${currentPalette}`);
  cardPreview.classList.add(`variant-${currentPaletteVariant}`);
  
  // Tier 5: Image Container
  cardPreview.classList.add(`container-${currentImageContainer}`);
  cardPreview.classList.add(`container-variant-${currentContainerVariant}`);
  
  // Tier 6: Image Effects
  cardPreview.classList.add(`effect-${currentImageEffect}`);
  cardPreview.classList.add(`effect-variant-${currentEffectVariant}`);
  
  // Tier 7: Image Dimensions
  cardPreview.classList.add(`dimensions-${currentImageDimensions}`);
  cardPreview.classList.add(`dimension-variant-${currentDimensionsVariant}`);
  
  // Apply data attributes for advanced styling
  cardPreview.dataset.layout = currentLayout;
  cardPreview.dataset.alignment = currentAlignment;
  cardPreview.dataset.weight = currentWeight;
  cardPreview.dataset.variant = currentVariant;
  cardPreview.dataset.palette = currentPalette;
  cardPreview.dataset.paletteVariant = currentPaletteVariant;
  cardPreview.dataset.container = currentImageContainer;
  cardPreview.dataset.containerVariant = currentContainerVariant;
  cardPreview.dataset.effect = currentImageEffect;
  cardPreview.dataset.effectVariant = currentEffectVariant;
  cardPreview.dataset.dimensions = currentImageDimensions;
  cardPreview.dataset.dimensionVariant = currentDimensionsVariant;
  
  console.log('🎯 Modular preview updated:', {
    layout: currentLayout,
    alignment: currentAlignment,
    weight: currentWeight,
    variant: currentVariant,
    palette: `${currentPalette}-${currentPaletteVariant}`,
    container: `${currentImageContainer}-${currentContainerVariant}`,
    effect: `${currentImageEffect}-${currentEffectVariant}`,
    dimensions: `${currentImageDimensions}-${currentDimensionsVariant}`
  });
}
```

## User Experience Flow

### 1. Initial State
- All tiers display their top-level options
- Default selections are pre-made for each tier
- Sub-level containers are hidden (progressive disclosure)

### 2. User Interaction
- User clicks on a top-level option (e.g., "Left" alignment)
- System updates selection state visually
- Progressive disclosure reveals relevant sub-options
- Live preview updates immediately

### 3. Hierarchical Navigation
- User can drill down through multiple levels
- Each level reveals more specific options
- Previous selections remain visible and editable
- User can change higher-level selections to explore different paths

### 4. Visual Feedback
- Selected options are highlighted with primary color
- Hover states provide immediate feedback
- Smooth animations guide user attention
- Thumbnails provide visual context for each option

## Technical Considerations

### Performance
- Event delegation used for efficient event handling
- CSS classes applied/removed rather than inline styles
- Minimal DOM manipulation for progressive disclosure
- Debounced preview updates to prevent excessive re-rendering

### Accessibility
- Semantic HTML structure with proper headings
- ARIA labels and roles for screen readers
- Keyboard navigation support
- High contrast color schemes
- Focus management for progressive disclosure

### Responsive Design
- Grid layouts adapt to different screen sizes
- Mobile-optimized touch targets
- Collapsible sections for smaller screens
- Horizontal scrolling for option grids when needed

### Browser Compatibility
- Modern CSS Grid with fallbacks
- ES6+ JavaScript with polyfills
- Progressive enhancement approach
- Graceful degradation for older browsers

## Integration Points

### Theme System
- Uses Nova CSS variables for consistent theming
- Respects user's color preferences
- Supports light/dark mode variants
- Maintains visual hierarchy through color

### Card Generation
- Modular selections feed into card generation logic
- CSS classes map to specific styling rules
- Data attributes enable complex styling combinations
- Backward compatibility with existing card formats

### Save/Load System
- All modular selections are serializable
- State can be saved to JSON format
- Presets can include modular configurations
- Import/export functionality for sharing designs

## Future Enhancements

### Planned Features
1. **Custom Tier Extensions**: Allow users to create custom option sets
2. **Animation Presets**: Add tier for card animation and transition effects
3. **Typography Tier**: Dedicated tier for font selection and text styling
4. **Advanced Layouts**: More complex layout options with custom positioning
5. **Template System**: Pre-configured combinations of modular selections

### Technical Improvements
1. **State Management**: Implement Redux-like state management
2. **Performance Optimization**: Virtual scrolling for large option sets
3. **Testing Suite**: Comprehensive unit and integration tests
4. **Documentation**: Interactive documentation with live examples

## Troubleshooting

### Common Issues

#### Progressive Disclosure Not Working
- Check data attribute naming consistency
- Verify JavaScript event listeners are attached
- Ensure CSS display properties are correctly set

#### Preview Not Updating
- Confirm updatePreview() function is called after state changes
- Check that CSS classes are being applied correctly
- Verify global state variables are being updated

#### Visual Inconsistencies
- Review CSS specificity rules
- Check for conflicting styles between tiers
- Ensure theme variables are properly applied

#### Performance Issues
- Monitor event listener count
- Check for memory leaks in progressive disclosure
- Optimize CSS selector performance

### Debug Tools
- Console logging for state changes
- Visual indicators for selected options
- Performance monitoring for preview updates
- State inspection tools for development

## Conclusion

The CardForge V2 modular system represents a significant advancement in user interface design for card creation tools. By implementing progressive disclosure and hierarchical organization, the system provides users with powerful customization capabilities while maintaining an intuitive and accessible interface.

The modular architecture ensures scalability for future enhancements while maintaining backward compatibility with existing features. The comprehensive CSS and JavaScript implementation provides a solid foundation for continued development and refinement.

This documentation serves as both a technical reference and a guide for future development, ensuring that the modular system can be maintained, extended, and improved over time.

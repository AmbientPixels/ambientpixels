# CardForge V2 Layout Styles Documentation

## Overview

This document provides detailed specifications for each card layout style in CardForge V2. Each layout has a unique structure and visual presentation that can be combined with other modular tiers (alignment, weight, palette, image container, and effects) to create diverse card designs.

## Layout Styles

CardForge V2 offers six distinct layout styles:

1. **Hero Layout** - Dramatic full-width image with overlay text
2. **Split Layout** - Two-column design with image on left, content on right
3. **Minimal Layout** - Compact header with small avatar and streamlined content
4. **Overlay Layout** - Full-bleed background image with semi-transparent content overlay
5. **Stack Layout** - Vertical stacking of elements with centered image
6. **Frame Layout** - Decorative border framing the card content

## Detailed Specifications

### 1. Hero Layout

**Purpose:** Create a dramatic, cinematic card with emphasis on the hero image.

**HTML Structure:**
```html
<div class="card-hero-header">
  <div class="hero-image-container">
    <img src="avatar.jpg" alt="Character Name" class="card-avatar" />
    <div class="hero-overlay">
      <h3 class="card-name">Character Name</h3>
    </div>
  </div>
</div>
<div class="card-body">
  <div class="card-class">Character Class</div>
  <div class="card-rarity">Rarity</div>
  <div class="card-quote">"Character Quote"</div>
  <div class="card-stats">
    <!-- Stats HTML -->
  </div>
</div>
```

**CSS Implementation:**
```css
.layout-hero .card-hero-header {
  position: relative;
  width: 100%;
  margin-bottom: 1rem;
}

.layout-hero .hero-image-container {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
}

.layout-hero .card-avatar {
  width: 100%;
  height: auto;
  object-fit: cover;
  aspect-ratio: 16 / 9; /* Default for large variant */
}

.layout-hero .hero-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 1rem;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  color: white;
}

.layout-hero .card-body {
  padding: 0.5rem 1rem 1rem;
}
```

**Variants:**
- **Hero Large:** 16:9 aspect ratio for a taller, more cinematic image
- **Hero Small:** 3:1 aspect ratio for a flatter, more compact banner-style image

**Key Visual Elements:**
- Large hero image spanning full width at top
- Semi-transparent overlay with character name
- Content section below image for class, rarity, quote, and stats
- Image aspect ratio: 16:9 (large variant) or 3:1 (small variant)

**Intended Look & Feel:**
- Cinematic, dramatic presentation
- Focus on visual impact of the hero image
- Clean separation between image and content
- Works well with high-quality character portraits or action scenes

**Recommended Combinations:**
- **Weight:** Top-heavy for emphasis on the hero image
- **Alignment:** Center for balanced look
- **Palette:** Ocean or Sunset for cinematic feel
- **Image Container:** Raw for maximum image impact
- **Image Effects:** Glow or Shadow for dramatic emphasis

### 2. Split Layout

**Purpose:** Balance image and content side-by-side for information-rich cards.

**HTML Structure:**
```html
<div class="card-left">
  <div class="card-avatar-container">
    <img src="avatar.jpg" alt="Character Name" class="card-avatar" />
  </div>
</div>
<div class="card-right">
  <div class="card-header">
    <h3 class="card-name">Character Name</h3>
    <div class="card-class">Character Class</div>
  </div>
  <div class="card-body">
    <div class="card-rarity">Rarity</div>
    <div class="card-quote">"Character Quote"</div>
    <div class="card-stats">
      <!-- Stats HTML -->
    </div>
  </div>
</div>
```

**CSS Implementation:**
```css
.layout-split {
  display: grid;
  grid-template-columns: 40% 60%;
  gap: 1rem;
}

.layout-split .card-left {
  padding: 1rem;
}

.layout-split .card-avatar-container {
  width: 100%;
  height: 100%;
}

.layout-split .card-avatar {
  width: 100%;
  height: auto;
  object-fit: cover;
  border-radius: 8px;
}

.layout-split .card-right {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.layout-split .card-header {
  margin-bottom: 0.5rem;
}

.layout-split .card-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
```

**Variants:**
- **Standard Split:** 40/60 ratio between image and content
- **Equal Split:** 50/50 ratio for balanced presentation
- **Content Focus:** 30/70 ratio for more content space

**Key Visual Elements:**
- Two-column layout with clear separation
- Left column dedicated to character image
- Right column contains all text content in a structured hierarchy
- Balanced visual weight between image and content

**Intended Look & Feel:**
- Professional, balanced presentation
- Information-dense without feeling cluttered
- Clear visual hierarchy of content
- Works well for character cards with detailed stats

**Recommended Combinations:**
- **Weight:** Balanced for equal emphasis on image and content
- **Alignment:** Left for natural reading flow
- **Palette:** Ocean or Monochrome for professional look
- **Image Container:** Framed for clear separation
- **Image Effects:** Shadow for subtle depth

### 3. Minimal Layout

**Purpose:** Clean, compact presentation focusing on essential information.

**HTML Structure:**
```html
<div class="card-header minimal-header">
  <div class="card-avatar-container">
    <img src="avatar.jpg" alt="Character Name" class="card-avatar" />
  </div>
  <div class="minimal-info">
    <h3 class="card-name">Character Name</h3>
    <div class="card-class">Character Class</div>
    <div class="card-rarity">Rarity</div>
  </div>
</div>
<div class="card-body">
  <div class="card-quote">"Character Quote"</div>
  <div class="card-stats">
    <!-- Stats HTML -->
  </div>
</div>
```

**CSS Implementation:**
```css
.layout-minimal {
  padding: 1rem;
}

.layout-minimal .minimal-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.layout-minimal .card-avatar-container {
  flex-shrink: 0;
}

.layout-minimal .card-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  object-fit: cover;
}

.layout-minimal .minimal-info {
  flex-grow: 1;
}

.layout-minimal .card-name {
  margin: 0 0 0.25rem 0;
  font-size: 1.2rem;
}

.layout-minimal .card-class,
.layout-minimal .card-rarity {
  font-size: 0.9rem;
  margin-bottom: 0.1rem;
}

.layout-minimal .card-body {
  padding: 0;
}

.layout-minimal .card-quote {
  font-size: 0.9rem;
  margin-bottom: 1rem;
  font-style: italic;
}
```

**Variants:**
- **Ultra Minimal:** Shows only essential information (name, class, avatar)
- **Standard Minimal:** Includes quote and basic stats
- **Expanded Minimal:** Adds more stats while maintaining compact layout

**Key Visual Elements:**
- Compact header with small avatar and key information
- Horizontal arrangement of avatar and name/class/rarity
- Streamlined body section with quote and stats
- Reduced spacing and compact presentation

**Intended Look & Feel:**
- Clean, minimalist aesthetic
- Focus on typography and spacing
- Efficient use of space without feeling cramped
- Modern, sleek appearance

**Recommended Combinations:**
- **Weight:** Balanced or Bottom-heavy for emphasis on stats
- **Alignment:** Left for clean reading flow
- **Palette:** Monochrome or Neon for minimalist aesthetic
- **Image Container:** Masked (Circle) for compact presentation
- **Image Effects:** None or subtle Border for clean look

### 4. Overlay Layout

**Purpose:** Immersive design with content overlaid on a full-bleed background image.

**HTML Structure:**
```html
<div class="card-overlay-container">
  <img src="avatar.jpg" alt="Character Name" class="card-background" />
  <div class="overlay-content">
    <h3 class="card-name">Character Name</h3>
    <div class="card-class">Character Class</div>
    <div class="card-rarity">Rarity</div>
    <div class="card-quote">"Character Quote"</div>
  </div>
</div>
```

**CSS Implementation:**
```css
.layout-overlay .card-overlay-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 200px;
  overflow: hidden;
  border-radius: 8px;
}

.layout-overlay .card-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}

.layout-overlay .overlay-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 1.5rem;
  background: linear-gradient(transparent 40%, rgba(0,0,0,0.8));
  color: white;
}

.layout-overlay .card-name {
  margin: 0 0 0.5rem 0;
  text-shadow: 0 2px 4px rgba(0,0,0,0.5);
}

.layout-overlay .card-class,
.layout-overlay .card-rarity,
.layout-overlay .card-quote {
  text-shadow: 0 1px 2px rgba(0,0,0,0.7);
  margin-bottom: 0.25rem;
}
```

**Variants:**
- **Bottom Overlay:** Text content at bottom with gradient background
- **Full Overlay:** Semi-transparent overlay across entire image
- **Side Overlay:** Content aligned to one side of the image

**Key Visual Elements:**
- Full-bleed background image covering entire card
- Semi-transparent overlay for text content
- Content positioned for optimal readability
- Image serves as both background and character representation

**Intended Look & Feel:**
- Immersive, atmospheric presentation
- Cinematic quality with full-bleed imagery
- Text remains readable through strategic overlay
- Dramatic, high-impact design

**Recommended Combinations:**
- **Weight:** Top-heavy for emphasis on name/class
- **Alignment:** Center or Right for dramatic composition
- **Palette:** Sunset or Earth for rich color depth
- **Image Container:** Raw (full-bleed is built into layout)
- **Image Effects:** Filter for mood enhancement

### 5. Stack Layout

**Purpose:** Vertical organization with clear hierarchy and centered elements.

**HTML Structure:**
```html
<div class="card-header">
  <h3 class="card-name">Character Name</h3>
  <div class="card-class">Character Class</div>
</div>
<div class="card-avatar-container">
  <img src="avatar.jpg" alt="Character Name" class="card-avatar" />
</div>
<div class="card-body">
  <div class="card-rarity">Rarity</div>
  <div class="card-quote">"Character Quote"</div>
</div>
```

**CSS Implementation:**
```css
.layout-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  text-align: center;
}

.layout-stack .card-header {
  margin-bottom: 1rem;
  width: 100%;
}

.layout-stack .card-name {
  margin: 0 0 0.5rem 0;
}

.layout-stack .card-class {
  margin-bottom: 0.5rem;
}

.layout-stack .card-avatar-container {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
}

.layout-stack .card-avatar {
  width: 120px;
  height: 120px;
  border-radius: 8px;
  object-fit: cover;
}

.layout-stack .card-body {
  width: 100%;
}

.layout-stack .card-rarity {
  margin-bottom: 0.5rem;
}

.layout-stack .card-quote {
  font-style: italic;
  margin-bottom: 1rem;
}
```

**Variants:**
- **Compact Stack:** Reduced spacing between elements
- **Expanded Stack:** More generous spacing for premium feel
- **Centered Stack:** All elements perfectly centered
- **Offset Stack:** Elements slightly offset for dynamic feel

**Key Visual Elements:**
- Vertical stacking of all elements
- Name and class at top
- Centered avatar in middle
- Rarity and quote at bottom
- Clear visual separation between sections

**Intended Look & Feel:**
- Organized, structured presentation
- Balanced vertical flow
- Focus on hierarchy and organization
- Clean, methodical design

**Recommended Combinations:**
- **Weight:** Balanced for consistent flow
- **Alignment:** Center for symmetrical appearance
- **Palette:** Ocean or Neon for structured feel
- **Image Container:** Masked (Hex or Diamond) for visual interest
- **Image Effects:** Border for definition

### 6. Frame Layout

**Purpose:** Elegant, ornate presentation with decorative framing.

**HTML Structure:**
```html
<div class="card-frame">
  <div class="frame-border">
    <div class="card-avatar-container">
      <img src="avatar.jpg" alt="Character Name" class="card-avatar" />
    </div>
    <div class="frame-content">
      <h3 class="card-name">Character Name</h3>
      <div class="card-class">Character Class</div>
      <div class="card-rarity">Rarity</div>
      <div class="card-quote">"Character Quote"</div>
    </div>
  </div>
</div>
```

**CSS Implementation:**
```css
.layout-frame {
  padding: 0.75rem;
}

.layout-frame .card-frame {
  width: 100%;
  height: 100%;
  position: relative;
}

.layout-frame .frame-border {
  border: 8px solid var(--card-accent, #daa520);
  border-image: linear-gradient(45deg, var(--card-accent, #daa520), var(--card-border, #8b4513)) 1;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.layout-frame .card-avatar-container {
  margin-bottom: 1rem;
}

.layout-frame .card-avatar {
  width: 100px;
  height: 100px;
  border-radius: 8px;
  object-fit: cover;
  border: 3px solid var(--card-accent, #daa520);
  box-shadow: 0 0 10px rgba(0,0,0,0.3);
}

.layout-frame .frame-content {
  text-align: center;
  width: 100%;
}

.layout-frame .card-name {
  margin: 0 0 0.5rem 0;
}

.layout-frame .card-class,
.layout-frame .card-rarity {
  margin-bottom: 0.25rem;
}

.layout-frame .card-quote {
  font-style: italic;
  margin-top: 0.5rem;
}
```

**Variants:**
- **Classic Frame:** Traditional ornate border design
- **Modern Frame:** Sleek, minimalist framing
- **Ornate Frame:** Highly decorative with intricate patterns
- **Double Frame:** Nested frames for premium presentation

**Key Visual Elements:**
- Decorative border framing the entire card
- Structured content within the frame
- Avatar positioned prominently
- Ornate styling and detailed border elements

**Intended Look & Feel:**
- Premium, high-end presentation
- Classic, timeless aesthetic
- Attention to decorative details
- Formal, elegant appearance

**Recommended Combinations:**
- **Weight:** Top-heavy for emphasis on name/avatar
- **Alignment:** Center for symmetrical framing
- **Palette:** Earth or Sunset for rich, warm tones
- **Image Container:** Framed (Ornate) for enhanced framing
- **Image Effects:** Glow for premium feel

## Layout Compatibility Matrix

Each layout style works with all modular tiers, but certain combinations create more harmonious designs:

| Layout Style | Best Alignment | Best Weight | Best Palette | Best Container | Best Effect |
|-------------|---------------|------------|-------------|---------------|------------|
| Hero        | Center        | Top-heavy  | Ocean/Sunset| Raw           | Glow/Shadow|
| Split       | Left          | Balanced   | Ocean/Mono  | Framed        | Shadow     |
| Minimal     | Left          | Balanced   | Mono/Neon   | Masked (Circle)| None/Border|
| Overlay     | Center/Right  | Top-heavy  | Sunset/Earth| Raw (built-in)| Filter     |
| Stack       | Center        | Balanced   | Ocean/Neon  | Masked (Hex)  | Border     |
| Frame       | Center        | Top-heavy  | Earth/Sunset| Framed (Ornate)| Glow      |

## Implementation Notes

1. **Layout Switching:**
   - When changing layouts, the system preserves content but restructures the HTML
   - Each layout has its own generator function (e.g., `generateHeroLayout()`)
   - CSS classes are applied based on the selected layout

2. **Responsive Behavior:**
   - All layouts adapt to container width
   - Stack layout is recommended for narrow mobile views
   - Hero and Overlay layouts may require image cropping on small screens

3. **Accessibility Considerations:**
   - All layouts maintain proper heading hierarchy
   - Text contrast is preserved across all combinations
   - Interactive elements maintain proper focus states

4. **Performance Optimization:**
   - Layout switching is optimized to minimize DOM operations
   - CSS transitions provide smooth layout changes
   - Image loading is optimized for each layout's requirements

## Technical Implementation

The layout system is implemented through a combination of HTML generators and CSS classes:

```javascript
// Example of layout switching in updateFrontFace()
switch (ModularState.layout) {
  case 'hero':
    frontHTML = generateHeroLayout(data);
    break;
  case 'split':
    frontHTML = generateSplitLayout(data);
    break;
  case 'minimal':
    frontHTML = generateMinimalLayout(data);
    break;
  case 'overlay':
    frontHTML = generateOverlayLayout(data);
    break;
  case 'stack':
    frontHTML = generateStackLayout(data);
    break;
  case 'frame':
    frontHTML = generateFrameLayout(data);
    break;
  default:
    frontHTML = generateHeroLayout(data);
}
```

CSS classes are applied in the `updatePreview()` function:

```javascript
// Apply layout classes
front.className = `card-preview-canvas card-front 
                   layout-${ModularState.layout}
                   align-type-${ModularState.alignmentType}
                   weight-${ModularState.weight}
                   palette-${ModularState.palette} variant-${ModularState.paletteVariant}
                   container-${ModularState.imageContainer} container-variant-${ModularState.imageContainerVariant}
                   effect-${ModularState.imageEffect} effect-variant-${ModularState.imageEffectVariant}`;
```

## Future Layout Enhancements

Planned enhancements for layout styles include:

1. **Grid Layout** - Multi-section grid for complex character sheets
2. **Tabbed Layout** - Multiple content sections accessible via tabs
3. **Flip Layout** - Interactive front/back card with 3D flip animation
4. **Timeline Layout** - Character progression with milestone markers
5. **Comparison Layout** - Side-by-side character comparison

## Best Practices

1. **Choose layout based on content needs:**
   - Hero for visual impact
   - Split for information balance
   - Minimal for clean efficiency
   - Overlay for immersive experience
   - Stack for clear organization
   - Frame for elegant presentation

2. **Consider image quality requirements:**
   - Hero and Overlay layouts require high-resolution images
   - Split layout works well with standard portraits
   - Minimal layout can use smaller, lower-resolution images

3. **Text length considerations:**
   - Hero and Overlay layouts work best with concise text
   - Split layout accommodates more detailed content
   - Frame layout benefits from balanced text length

4. **Mobile optimization:**
   - Test all layouts at various screen sizes
   - Consider fallback layouts for extreme dimensions
   - Ensure text remains readable at all sizes

## Recent Updates and Fixes

### Layout CSS Implementation (Latest)

**Issue:** Layout styles were missing their CSS implementation, causing layouts to display as unstyled HTML.

**Solution:** Added comprehensive CSS styling for all 6 layout types to `cardforge-card.css`:
- Hero Layout: Full-width hero image with gradient overlay
- Split Layout: CSS Grid with 40/60 column split
- Minimal Layout: Flexbox header with 60px circular avatar
- Overlay Layout: Absolute positioning with gradient overlay
- Stack Layout: Centered vertical flexbox layout
- Frame Layout: Decorative border with CSS variables

**Result:** All layouts now display with proper visual styling and responsive behavior.

### Stats Display Fix

**Issue:** Overlay, Stack, and Frame layouts were missing stats; Split layout had hardcoded stats.

**Solution:** Added `generateStatsHTML(data.stats)` calls to all affected layouts:
```javascript
// Added to generateOverlayLayout, generateStackLayout, generateFrameLayout
<div class="card-stats">
  ${generateStatsHTML(data.stats)}
</div>

// Replaced hardcoded stats in generateSplitLayout
<div class="card-stats">
  ${generateStatsHTML(data.stats)}
</div>
```

**Result:** All layouts now display stats that match the form input values.

### Hero Layout Image Variants

Previously, Hero Large and Small variants had incorrect aspect ratios:
- **Wrong:** Hero Large (2:1) was actually smaller than Hero Small (3:1)
- **Fixed:** Hero Large (16:9) is now taller/more cinematic than Hero Small (3:1)

The fix involved updating CSS selectors from data attributes to classes:

```css
/* WRONG APPROACH (old) */
.card-preview-canvas.layout-split.image-style-hero[data-image-variant="large"] .card-avatar {
  aspect-ratio: 2 / 1 !important;
}

/* CORRECT APPROACH (new) */
.card-preview-canvas.layout-split.image-hero-large .card-avatar {
  aspect-ratio: 16 / 9 !important; /* Taller, more cinematic */
}
```

### Legacy Code Cleanup

**Issue:** Legacy alignment code was causing conflicts with the modern modular system.

**Solution:** Removed legacy `alignment` property from ModularState and all presets, updated UI functions to use modern 3-level alignment hierarchy (alignmentType, alignmentWeight, alignmentStyle).

**Result:** Presets now work correctly and apply the complete modular configuration.

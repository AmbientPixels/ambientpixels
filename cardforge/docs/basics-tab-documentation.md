# CardForge Basics Tab - Developer Documentation

## Overview

The Basics tab is the second step in the CardForge card creation process, handling core card information including name, class/type, rarity, and quote/description. This tab manages the fundamental identity elements that appear on every card.

## File Structure

### HTML Structure
- **Location**: `cardforge/index.html` (lines ~604-720)
- **Section ID**: `data-step-section="2"`
- **Container Class**: `.cf-section`

### CSS Styling
- **Primary File**: `cardforge/css/cardforge-forms.css`
- **Icon Styling**: Lines 350-420 (icon picker containers and options)
- **Form Controls**: Standard form styling with Nova theme integration

### JavaScript Logic
- **Primary File**: `cardforge/js/card-forge-editor.js`
- **Key Functions**:
  - `updateCardContent()` - Data collection and card preview updates
  - `applyClassAndRarityStyles()` - Icon and styling application
  - `initIconPickers()` - Icon selection event handlers

## Form Fields

### 1. Card Name
- **Input ID**: `card-name`
- **Type**: Text input
- **Placeholder**: "Card Name"
- **Fallback**: "Aria Shadowbane" (when empty)
- **Purpose**: Primary card identifier displayed prominently

### 2. Class/Type Section
- **Container ID**: `class-section`
- **Input ID**: `card-class`
- **Placeholder**: "e.g. Ranger, Castle, Artifact"
- **Behavior**: Hidden on card when empty (no fallback)

#### Class Styling Options
- **Selector ID**: `class-style`
- **Options**:
  - `default` - Default Text
  - `badge` - Badge Style
  - `banner` - Banner Ribbon
  - `outlined` - Outlined
  - `glow` - Glow Effect

#### Class Icon Picker
- **Container**: `.icon-picker-container`
- **Hidden Input**: `class-icon-value`
- **Grid Layout**: 5 columns, responsive
- **Icon Count**: 20 icons + "None" option
- **Icons Available**:
  - Combat: sword (khanda), shield, dagger (cut), hammer, fist
  - Magic: magic, staff, book, flask, eye
  - Nature: leaf, feather, paw, dragon
  - Social: crown, heart, skull
  - Utility: cog, castle

### 3. Rarity Section
- **Container ID**: `rarity-section`
- **Input ID**: `card-rarity`
- **Placeholder**: "e.g. Common, Rare, Legendary"
- **Behavior**: Hidden on card when empty (no fallback)

#### Rarity Styling Options
- **Selector ID**: `rarity-style`
- **Options**:
  - `default` - Default Text
  - `badge` - Corner Badge
  - `border` - Colored Border
  - `glow` - Rarity Glow
  - `foil` - Foil Effect
  - `frame` - Ornate Frame

#### Rarity Icon Picker
- **Container**: `.icon-picker-container`
- **Hidden Input**: `rarity-icon-value`
- **Grid Layout**: 5 columns, responsive
- **Icon Count**: 20 icons + "None" option
- **Icons Available**:
  - Precious: gem, diamond (chess-king), coins, ring
  - Celestial: star, sun, moon, crown
  - Achievement: trophy, medal, certificate
  - Elemental: fire, bolt, snowflake, orb (circle)
  - Mystical: key, scroll, hourglass, shield

### 4. Quote/Description
- **Input ID**: `card-quote`
- **Type**: Text input
- **Placeholder**: "Card quote or description"
- **Fallback**: "Shadows are my allies, silence my weapon."
- **Purpose**: Flavor text displayed on card

## Technical Implementation

### Data Collection Flow

1. **Form Input → Data Object**
   ```javascript
   const cardData = {
     name: document.getElementById('card-name')?.value || 'Aria Shadowbane',
     characterClass: document.getElementById('card-class')?.value || '',
     rarity: document.getElementById('card-rarity')?.value || '',
     quote: document.getElementById('card-quote')?.value || 'Shadows are my allies...'
   };
   ```

2. **Style Application**
   ```javascript
   applyClassAndRarityStyles() {
     // Get form values
     const classValue = classInput ? classInput.value.trim() : '';
     const rarityValue = rarityInput ? rarityInput.value.trim() : '';
     
     // Hide/show elements based on content
     if (!classValue) {
       element.style.display = 'none';
     }
   }
   ```

### Icon System Architecture

#### HTML Structure
```html
<div class="icon-picker-container">
  <div class="icon-picker" aria-label="Select class icon">
    <input type="hidden" id="class-icon-value" value="none" />
    <button type="button" class="icon-option selected" data-icon="none">
      <span class="no-icon">None</span>
    </button>
    <button type="button" class="icon-option" data-icon="sword">
      <i class="fas fa-khanda"></i>
    </button>
    <!-- More icons... -->
  </div>
</div>
```

#### CSS Grid System
```css
.icon-picker-container .icon-picker {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
  max-width: 250px;
}

.icon-picker-container .icon-option {
  width: 40px;
  height: 40px;
  border: 2px solid var(--mood-accent-color);
  /* ... styling ... */
}
```

#### JavaScript Event Handling
```javascript
function initIconPickers() {
  // Class icon selection
  const classIconOptions = document.querySelectorAll('#class-section .icon-picker .icon-option');
  classIconOptions.forEach(option => {
    option.addEventListener('click', function() {
      // Update selection state
      classIconOptions.forEach(opt => opt.classList.remove('selected'));
      this.classList.add('selected');
      
      // Update hidden input
      const iconValue = document.getElementById('class-icon-value');
      if (iconValue) {
        iconValue.value = this.dataset.icon;
      }
      
      // Refresh preview
      updatePreview();
    });
  });
}
```

## Key Behaviors

### Empty Field Handling
- **Class/Type**: Hidden when input is empty
- **Rarity**: Hidden when input is empty
- **Name**: Shows fallback "Aria Shadowbane"
- **Quote**: Shows fallback flavor text

### Icon Integration
- **"None" Option**: Hides icon, shows text only
- **Icon Selection**: Adds icon before text content
- **Dynamic Injection**: Icons added/removed via JavaScript
- **FontAwesome Classes**: All icons use valid FA classes

### Style Variants
- **CSS Classes**: Applied dynamically based on dropdown selection
- **Scoped Styling**: `.class-style-*` and `.rarity-style-*` prefixes
- **Theme Integration**: Uses Nova CSS variables for colors

## Common Development Tasks

### Adding New Icons
1. Add button to HTML with `data-icon` attribute
2. Use valid FontAwesome class in `<i>` tag
3. Ensure icon picker container has proper structure
4. Test icon selection and preview update

### Adding New Style Options
1. Add option to `<select>` element
2. Create corresponding CSS classes (`.class-style-newstyle`)
3. Update `applyClassAndRarityStyles()` logic if needed
4. Test style application on card preview

### Debugging Icon Issues
1. Check FontAwesome class validity
2. Verify event handlers are attached (`initIconPickers()`)
3. Confirm hidden input value updates
4. Test `updatePreview()` call chain

## Dependencies

### External Libraries
- **FontAwesome**: Icon rendering
- **Nova CSS Framework**: Theme variables and base styling

### Internal Dependencies
- **ModularState**: Card state management
- **updatePreview()**: Card preview refresh system
- **Card Template System**: HTML template rendering

## Browser Compatibility

- **Modern Browsers**: Full support (Chrome, Firefox, Safari, Edge)
- **CSS Grid**: Required for icon picker layout
- **ES6 Features**: Arrow functions, const/let, template literals
- **FontAwesome 5+**: Required for icon rendering

## Performance Considerations

- **Icon Rendering**: 40+ icons per section, minimal impact
- **Event Listeners**: Efficiently scoped to prevent memory leaks
- **DOM Updates**: Batched through `updatePreview()` system
- **CSS Grid**: Hardware accelerated, performant layout

## Future Enhancements

### Potential Improvements
- **Icon Search**: Filter icons by keyword
- **Custom Icons**: Upload custom icon support
- **Icon Categories**: Group icons by theme/type
- **Accessibility**: Enhanced screen reader support
- **Mobile UX**: Touch-optimized icon selection

### Architecture Considerations
- **Icon Data**: Move to JSON configuration
- **Lazy Loading**: Load icons on demand
- **Icon Sprites**: Optimize icon delivery
- **State Management**: Centralized icon state

---

## Quick Reference

### Key Files
- `cardforge/index.html` - HTML structure
- `cardforge/css/cardforge-forms.css` - Styling
- `cardforge/js/card-forge-editor.js` - Logic

### Key Functions
- `updateCardContent()` - Data collection
- `applyClassAndRarityStyles()` - Style/icon application
- `initIconPickers()` - Event handler setup

### Key IDs
- `card-name`, `card-class`, `card-rarity`, `card-quote` - Form inputs
- `class-icon-value`, `rarity-icon-value` - Hidden icon inputs
- `class-style`, `rarity-style` - Style selectors

This documentation should provide a comprehensive foundation for any developer working with the Basics tab functionality.

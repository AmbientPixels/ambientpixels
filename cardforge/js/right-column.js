/**
 * Right Column Functionality
 * Handles zone collapsing and tool interactions
 * Part of CardForge V2 Right Column
 */

class RightColumn {
  constructor() {
    this.zoneStates = {
      tools: true,    // expanded by default
      'my-cards': true // expanded by default
    };
    
    this.init();
  }

  init() {
    this.bindEvents();
    this.initializeZones();
  }

  bindEvents() {
    // Zone toggle buttons
    document.querySelectorAll('.zone-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const zone = toggle.getAttribute('data-zone');
        this.toggleZone(zone);
      });
    });

    // Zone headers (also toggle zones)
    document.querySelectorAll('.zone-header').forEach(header => {
      header.addEventListener('click', (e) => {
        // Only toggle if clicking the header itself, not buttons inside
        if (e.target === header || e.target.tagName === 'H3' || e.target.tagName === 'I') {
          const toggle = header.querySelector('.zone-toggle');
          if (toggle) {
            const zone = toggle.getAttribute('data-zone');
            this.toggleZone(zone);
          }
        }
      });
    });

    // Tool buttons
    this.bindToolButtons();

    // My Cards search
    this.bindMyCardsSearch();

    // Responsive behavior
    this.bindResponsiveEvents();
  }

  bindToolButtons() {
    // Forge tab buttons are handled by cardforge-forge-actions.js
  }

  bindMyCardsSearch() {
    const searchInput = document.getElementById('my-cards-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.handleMyCardsSearch(e.target.value);
      });
    }
  }

  bindResponsiveEvents() {
    // Handle window resize for responsive behavior
    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }

  initializeZones() {
    // Set initial zone states
    Object.keys(this.zoneStates).forEach(zone => {
      const isExpanded = this.zoneStates[zone];
      const content = document.querySelector(`[data-zone-content="${zone}"]`);
      const toggle = document.querySelector(`[data-zone="${zone}"]`);
      
      if (content && toggle) {
        if (isExpanded) {
          content.classList.remove('collapsed');
          toggle.classList.remove('collapsed');
        } else {
          content.classList.add('collapsed');
          toggle.classList.add('collapsed');
        }
      }
    });
  }

  toggleZone(zoneName) {
    if (!this.zoneStates.hasOwnProperty(zoneName)) return;

    this.zoneStates[zoneName] = !this.zoneStates[zoneName];
    const isExpanded = this.zoneStates[zoneName];

    const content = document.querySelector(`[data-zone-content="${zoneName}"]`);
    const toggle = document.querySelector(`[data-zone="${zoneName}"]`);

    if (content && toggle) {
      if (isExpanded) {
        content.classList.remove('collapsed');
        toggle.classList.remove('collapsed');
      } else {
        content.classList.add('collapsed');
        toggle.classList.add('collapsed');
      }
    }

  }



  handleMyCardsSearch(query) {
    // Search filtering handled by cardforge-forge-actions.js
  }

  handleResize() {
    // Responsive behavior now handled purely by CSS media queries

  }

  showToolMessage(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `tool-notification tool-notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    // Exit animation after 3s, then remove from DOM
    setTimeout(() => {
      notification.classList.add('removing');
      notification.addEventListener('animationend', () => {
        if (notification.parentNode) notification.remove();
      }, { once: true });
    }, 3000);
  }


  // Data Collection for Card Saving
  collectCurrentCardData() {
    const cardData = {
      // Basic card information
      name: this.getFieldValue('card-name'),
      class: this.getFieldValue('card-class'),
      rarity: this.getFieldValue('card-rarity'),
      quote: this.getFieldValue('card-quote'),
      avatar: this.getFieldValue('card-avatar') || '',
      
      // Stats
      stats: this.collectStats(),
      
      // Badges
      badges: this.collectBadges(),
      
      // Attributes
      attributes: this.collectAttributes(),
      
      // Biography
      biography: this.getFieldValue('card-bio'),
      
      // Design settings (from modular system)
      design: this.collectDesignSettings()
    };
    
    return cardData;
  }

  getFieldValue(fieldId) {
    const field = document.getElementById(fieldId);
    return field ? field.value.trim() : '';
  }

  collectStats() {
    const stats = [];
    const statRows = document.querySelectorAll('#stats-editor .stat-row');
    
    statRows.forEach(row => {
      const nameField = row.querySelector('.stat-name');
      const valueField = row.querySelector('.stat-value');
      
      if (nameField && valueField && nameField.value.trim()) {
        stats.push({
          name: nameField.value.trim(),
          value: parseInt(valueField.value) || 0
        });
      }
    });
    
    return stats;
  }

  collectBadges() {
    const badges = [];
    const badgeRows = document.querySelectorAll('#micro-editor .micro-row');
    
    badgeRows.forEach(row => {
      const categoryField = row.querySelector('.micro-category');
      const iconField = row.querySelector('.micro-icon');
      const descField = row.querySelector('.micro-desc');
      const quantityField = row.querySelector('.micro-quantity');
      
      if (categoryField && categoryField.value.trim()) {
        badges.push({
          category: categoryField.value.trim(),
          icon: iconField ? iconField.value.trim() : '',
          description: descField ? descField.value.trim() : '',
          quantity: quantityField ? parseInt(quantityField.value) || 1 : 1
        });
      }
    });
    
    return badges;
  }

  collectAttributes() {
    const attributes = [];
    const attrRows = document.querySelectorAll('#attribute-editor .attribute-row');
    
    attrRows.forEach(row => {
      const keyField = row.querySelector('.attr-key');
      const valueField = row.querySelector('.attr-value');
      
      if (keyField && valueField && keyField.value.trim()) {
        attributes.push({
          key: keyField.value.trim(),
          value: valueField.value.trim()
        });
      }
    });
    
    return attributes;
  }

  collectDesignSettings() {
    // Collect current modular system settings
    const design = {
      layout: window.currentLayout || 'hero',
      palette: window.currentPalette || 'ocean',
      paletteVariant: window.currentPaletteVariant || 'dark',
      imageStyle: window.currentImageStyle || 'masked',
      imageVariant: window.currentImageVariant || 'circle'
    };
    
    // Try to get modular state if available
    if (window.ModularState) {
      design.alignment = window.ModularState.horizontalAlignment || 'center';
      design.weight = window.ModularState.alignmentWeight || 'balanced';
      design.container = window.ModularState.imageContainer || 'masked';
      design.effect = window.ModularState.imageEffect || 'none';
    }
    
    return design;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if we're on the CardForge page
  if (document.querySelector('.right-column')) {
    window.RightColumn = new RightColumn();
  }
});

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RightColumn;
}

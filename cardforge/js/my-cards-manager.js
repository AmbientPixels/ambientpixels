/**
 * My Cards Manager
 * Handles saving, loading, and managing user's saved cards
 * Part of CardForge V2 Right Column Redesign
 */

class MyCardsManager {
  constructor() {
    this.storageKey = 'cardforge_my_cards';
    this.cards = [];
    this.filteredCards = [];
    this.currentSearchQuery = '';
    
    this.init();
  }

  init() {
    this.loadCardsFromStorage();
    this.renderMyCards();
    this.bindEvents();
    console.log('✅ My Cards Manager initialized with', this.cards.length, 'cards');
  }

  bindEvents() {
    // Listen for card save events from the main CardForge system
    document.addEventListener('cardforge:cardSaved', (e) => {
      this.handleCardSaved(e.detail);
    });

    // Listen for card updates
    document.addEventListener('cardforge:cardUpdated', (e) => {
      this.handleCardUpdated(e.detail);
    });
  }

  loadCardsFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      this.cards = stored ? JSON.parse(stored) : [];
      this.filteredCards = [...this.cards];
    } catch (error) {
      console.error('Error loading My Cards from storage:', error);
      this.cards = [];
      this.filteredCards = [];
    }
  }

  saveCardsToStorage() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.cards));
      console.log('💾 My Cards saved to storage');
    } catch (error) {
      console.error('Error saving My Cards to storage:', error);
    }
  }

  addCard(cardData) {
    // Create card using new JSON schema format
    const card = this.createNewSchemaCard(cardData);
    
    // For backward compatibility, also create old format data
    const legacyCard = this.createLegacyCard(cardData);

    // Check if card with same name already exists
    const cardName = card.cardContent.frontFace.characterName || 'Untitled Card';
    const existingIndex = this.cards.findIndex(c => {
      // Handle both old and new format when checking for duplicates
      const existingName = c.cardContent ? c.cardContent.frontFace.characterName : c.name;
      return existingName === cardName;
    });
    
    if (existingIndex !== -1) {
      // Update existing card
      card.metadata.modified = new Date().toISOString();
      this.cards[existingIndex] = card;
      console.log('📝 Updated existing card:', cardName);
    } else {
      // Add new card
      this.cards.unshift(card); // Add to beginning of array
      console.log('➕ Added new card:', cardName);
    }

    this.saveCardsToStorage();
    this.applySearch(this.currentSearchQuery);
    this.renderMyCards();
    
    return card;
  }

  /**
   * Create a card using the new JSON schema format
   */
  createNewSchemaCard(cardData) {
    const cardId = this.generateCardId();
    const now = new Date().toISOString();
    
    return {
      metadata: {
        version: "2.0",
        created: now,
        modified: now,
        cardId: cardId,
        presetUsed: cardData.presetUsed || null,
        isCustom: !cardData.presetUsed
      },
      
      modularSystem: {
        tier2_imageContainer: {
          container: window.ModularState?.imageContainer || 'masked',
          containerVariant: window.ModularState?.imageContainerVariant || 'circle',
          imageEffect: window.ModularState?.imageEffect || 'none',
          imageEffectVariant: window.ModularState?.imageEffectVariant || 'clean'
        },
        tier3_colorPalette: {
          palette: window.ModularState?.palette || 'neon',
          paletteVariant: window.ModularState?.paletteVariant || 'light',
          textColor: window.ModularState?.textColor || 'auto'
        },
        tier4_contentAlignment: {
          horizontalAlignment: window.ModularState?.horizontalAlignment || 'center',
          verticalAlignment: window.ModularState?.verticalAlignment || 'middle',
          alignmentWeight: window.ModularState?.alignmentWeight || 'balanced',
          alignmentStyle: window.ModularState?.alignmentStyle || 'padded'
        }
      },
      
      cardContent: {
        frontFace: {
          characterName: cardData.name || 'Untitled Card',
          characterClass: cardData.class || '',
          characterRarity: cardData.rarity || 'common',
          characterLevel: cardData.level || null,
          characterDescription: cardData.quote || cardData.description || '',
          characterImage: {
            url: cardData.avatar || '/cardforge/images/default-avatar.jpg',
            alt: cardData.name || 'Card character',
            source: 'upload'
          }
        },
        backFace: {
          stats: this.collectStatsFromForm(),
          socialLinks: this.collectSocialLinksFromForm(),
          badges: this.collectBadgesFromForm(),
          attributes: this.collectAttributesFromForm(),
          backDescription: cardData.bio || '',
          flavorText: cardData.flavorText || ''
        }
      },
      
      userPreferences: {
        autoSave: true,
        showIntroOnStartup: false,
        theme: 'auto',
        defaultExportFormat: 'png',
        exportQuality: 'high'
      }
    };
  }

  /**
   * Create legacy format card for backward compatibility
   */
  createLegacyCard(cardData) {
    return {
      id: this.generateCardId(),
      name: cardData.name || 'Untitled Card',
      class: cardData.class || '',
      rarity: cardData.rarity || 'common',
      avatar: cardData.avatar || '/cardforge/images/default-avatar.jpg',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { ...cardData }
    };
  }

  /**
   * Collect stats data from the form
   */
  collectStatsFromForm() {
    const stats = [];
    const statsContainer = document.querySelector('#stats-editor .dynamic-rows');
    if (statsContainer) {
      const statRows = statsContainer.querySelectorAll('.dynamic-row');
      statRows.forEach(row => {
        const nameInput = row.querySelector('input[placeholder*="name"], input[placeholder*="Name"]');
        const valueInput = row.querySelector('input[type="number"], input[placeholder*="value"], input[placeholder*="Value"]');
        if (nameInput && valueInput && nameInput.value.trim()) {
          stats.push({
            name: nameInput.value.trim(),
            value: parseInt(valueInput.value) || 0
          });
        }
      });
    }
    return stats;
  }

  /**
   * Collect social links data from the form
   */
  collectSocialLinksFromForm() {
    const socialLinks = [];
    const socialContainer = document.querySelector('#social-editor .dynamic-rows');
    if (socialContainer) {
      const socialRows = socialContainer.querySelectorAll('.dynamic-row');
      socialRows.forEach(row => {
        const platformSelect = row.querySelector('select');
        const urlInput = row.querySelector('input[type="url"], input[placeholder*="URL"], input[placeholder*="url"]');
        if (platformSelect && urlInput && urlInput.value.trim()) {
          socialLinks.push({
            platform: platformSelect.value,
            url: urlInput.value.trim(),
            displayName: ''
          });
        }
      });
    }
    return socialLinks;
  }

  /**
   * Collect badges data from the form
   */
  collectBadgesFromForm() {
    const badges = [];
    const badgesContainer = document.querySelector('#badges-editor .dynamic-rows');
    if (badgesContainer) {
      const badgeRows = badgesContainer.querySelectorAll('.dynamic-row');
      badgeRows.forEach(row => {
        const categoryInput = row.querySelector('input[placeholder*="category"], input[placeholder*="Category"]');
        const iconInput = row.querySelector('input[placeholder*="icon"], input[placeholder*="Icon"]');
        const descInput = row.querySelector('input[placeholder*="description"], input[placeholder*="Description"]');
        const quantityInput = row.querySelector('input[type="number"]');
        if (categoryInput && categoryInput.value.trim()) {
          badges.push({
            category: categoryInput.value.trim(),
            icon: iconInput?.value.trim() || 'star',
            description: descInput?.value.trim() || '',
            quantity: parseInt(quantityInput?.value) || 1
          });
        }
      });
    }
    return badges;
  }

  /**
   * Collect attributes data from the form
   */
  collectAttributesFromForm() {
    const attributes = [];
    const attributesContainer = document.querySelector('#attributes-editor .dynamic-rows');
    if (attributesContainer) {
      const attributeRows = attributesContainer.querySelectorAll('.dynamic-row');
      attributeRows.forEach(row => {
        const nameInput = row.querySelector('input[placeholder*="name"], input[placeholder*="Name"]');
        const valueInput = row.querySelector('input[placeholder*="value"], input[placeholder*="Value"]:not([type="number"])');
        if (nameInput && valueInput && nameInput.value.trim()) {
          attributes.push({
            name: nameInput.value.trim(),
            value: valueInput.value.trim()
          });
        }
      });
    }
    return attributes;
  }

  /**
   * Export card as JSON file (new schema format)
   */
  exportCardAsJSON(cardId) {
    const card = this.cards.find(c => {
      // Handle both old and new format IDs
      return c.id === cardId || (c.metadata && c.metadata.cardId === cardId);
    });
    
    if (!card) {
      this.showMessage('Card not found for export', 'error');
      return;
    }

    // Ensure card is in new schema format
    let exportCard = card;
    if (!card.cardContent) {
      // Convert old format to new format for export
      exportCard = this.createNewSchemaCard(card.data || card);
    }

    // Create downloadable JSON file
    const dataStr = JSON.stringify(exportCard, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `${exportCard.cardContent.frontFace.characterName || 'card'}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    this.showMessage(`Exported "${exportCard.cardContent.frontFace.characterName}" as JSON`, 'success');
  }

  /**
   * Import card from JSON file
   */
  importCardFromJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const cardData = JSON.parse(event.target.result);
          
          // Validate imported card data
          if (this.validateImportedCard(cardData)) {
            // Update metadata for import
            if (cardData.metadata) {
              cardData.metadata.cardId = this.generateCardId();
              cardData.metadata.created = new Date().toISOString();
              cardData.metadata.modified = new Date().toISOString();
            }
            
            // Add imported card
            this.cards.unshift(cardData);
            this.saveCardsToStorage();
            this.applySearch(this.currentSearchQuery);
            this.renderMyCards();
            
            const cardName = cardData.cardContent?.frontFace?.characterName || cardData.name || 'Imported Card';
            this.showMessage(`Imported "${cardName}" successfully`, 'success');
          } else {
            this.showMessage('Invalid card file format', 'error');
          }
        } catch (error) {
          console.error('Error importing card:', error);
          this.showMessage('Failed to import card: Invalid JSON format', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /**
   * Validate imported card data
   */
  validateImportedCard(cardData) {
    // Check for new schema format
    if (cardData.cardContent && cardData.cardContent.frontFace) {
      return cardData.cardContent.frontFace.characterName && 
             cardData.modularSystem &&
             cardData.metadata;
    }
    
    // Check for old schema format (backward compatibility)
    if (cardData.name || cardData.data) {
      return true;
    }
    
    return false;
  }

  /**
   * Export all cards as JSON file
   */
  exportAllCardsAsJSON() {
    if (this.cards.length === 0) {
      this.showMessage('No cards to export', 'info');
      return;
    }

    // Convert all cards to new schema format
    const exportCards = this.cards.map(card => {
      if (!card.cardContent) {
        // Convert old format to new format
        return this.createNewSchemaCard(card.data || card);
      }
      return card;
    });

    const exportData = {
      metadata: {
        exportVersion: "2.0",
        exportDate: new Date().toISOString(),
        cardCount: exportCards.length,
        source: "CardForge V2"
      },
      cards: exportCards
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `cardforge-cards-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    this.showMessage(`Exported ${exportCards.length} cards as JSON`, 'success');
  }

  /**
   * Import multiple cards from JSON file
   */
  importMultipleCardsFromJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importData = JSON.parse(event.target.result);
          let cardsToImport = [];
          
          // Handle different import formats
          if (importData.cards && Array.isArray(importData.cards)) {
            // New export format with metadata wrapper
            cardsToImport = importData.cards;
          } else if (Array.isArray(importData)) {
            // Direct array of cards
            cardsToImport = importData;
          } else if (importData.cardContent) {
            // Single card format
            cardsToImport = [importData];
          } else {
            this.showMessage('Invalid import file format', 'error');
            return;
          }
          
          let importedCount = 0;
          cardsToImport.forEach(cardData => {
            if (this.validateImportedCard(cardData)) {
              // Update metadata for import
              if (cardData.metadata) {
                cardData.metadata.cardId = this.generateCardId();
                cardData.metadata.created = new Date().toISOString();
                cardData.metadata.modified = new Date().toISOString();
              }
              
              this.cards.unshift(cardData);
              importedCount++;
            }
          });
          
          if (importedCount > 0) {
            this.saveCardsToStorage();
            this.applySearch(this.currentSearchQuery);
            this.renderMyCards();
            this.showMessage(`Imported ${importedCount} cards successfully`, 'success');
          } else {
            this.showMessage('No valid cards found in import file', 'error');
          }
          
        } catch (error) {
          console.error('Error importing cards:', error);
          this.showMessage('Failed to import cards: Invalid JSON format', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  removeCard(cardId) {
    const index = this.cards.findIndex(c => c.id === cardId);
    if (index !== -1) {
      const removedCard = this.cards.splice(index, 1)[0];
      this.saveCardsToStorage();
      this.applySearch(this.currentSearchQuery);
      this.renderMyCards();
      console.log('🗑️ Removed card:', removedCard.name);
      return removedCard;
    }
    return null;
  }

  loadCard(cardId) {
    const card = this.cards.find(c => c.id === cardId);
    if (card) {
      console.log('📄 Loading card:', card.name);
      
      // Dispatch event to load card data into the form
      document.dispatchEvent(new CustomEvent('myCards:loadCard', {
        detail: card.data
      }));
      
      // Show success message
      this.showMessage(`Loaded "${card.name}"`, 'success');
      return card;
    }
    return null;
  }

  duplicateCard(cardId) {
    const card = this.cards.find(c => c.id === cardId);
    if (card) {
      const duplicatedData = { ...card.data };
      duplicatedData.name = `${duplicatedData.name} (Copy)`;
      
      const newCard = this.addCard(duplicatedData);
      this.showMessage(`Duplicated "${card.name}"`, 'success');
      return newCard;
    }
    return null;
  }

  searchCards(query) {
    this.currentSearchQuery = query;
    this.applySearch(query);
    this.renderMyCards();
  }

  applySearch(query) {
    if (!query || query.trim() === '') {
      this.filteredCards = [...this.cards];
    } else {
      const searchTerm = query.toLowerCase().trim();
      this.filteredCards = this.cards.filter(card => 
        card.name.toLowerCase().includes(searchTerm) ||
        card.class.toLowerCase().includes(searchTerm) ||
        card.rarity.toLowerCase().includes(searchTerm)
      );
    }
  }

  renderMyCards() {
    const container = document.getElementById('my-cards-list');
    if (!container) return;

    if (this.filteredCards.length === 0) {
      if (this.cards.length === 0) {
        // No cards at all
        container.innerHTML = `
          <div class="my-cards-empty">
            <i class="fas fa-layer-group"></i>
            <p>No saved cards yet</p>
            <small>Save your first card to see it here</small>
          </div>
        `;
      } else {
        // No cards match search
        container.innerHTML = `
          <div class="my-cards-empty">
            <i class="fas fa-search"></i>
            <p>No cards found</p>
            <small>Try a different search term</small>
          </div>
        `;
      }
      return;
    }

    const cardsHtml = this.filteredCards.map(card => this.renderCardItem(card)).join('');
    container.innerHTML = cardsHtml;

    // Bind events for card items
    this.bindCardItemEvents();
  }

  renderCardItem(card) {
    const timeAgo = this.getTimeAgo(card.updatedAt);
    const rarityClass = `rarity-${card.rarity.toLowerCase()}`;
    
    return `
      <div class="my-card-item" data-card-id="${card.id}">
        <div class="my-card-thumbnail">
          <img src="${card.avatar}" alt="${card.name}" onerror="this.src='/cardforge/images/default-avatar.jpg'">
        </div>
        <div class="my-card-info">
          <div class="my-card-name">${this.escapeHtml(card.name)}</div>
          <div class="my-card-meta">
            <span class="card-class">${this.escapeHtml(card.class)}</span>
            ${card.class ? ' • ' : ''}
            <span class="card-rarity ${rarityClass}">${card.rarity}</span>
            <br>
            <small class="card-time">${timeAgo}</small>
          </div>
        </div>
        <div class="my-card-actions">
          <button type="button" class="my-card-action load-card" title="Load card">
            <i class="fas fa-folder-open"></i>
          </button>
          <button type="button" class="my-card-action duplicate-card" title="Duplicate card">
            <i class="fas fa-copy"></i>
          </button>
          <button type="button" class="my-card-action delete-card" title="Delete card">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }

  bindCardItemEvents() {
    // Load card events
    document.querySelectorAll('.my-card-item .load-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = e.target.closest('.my-card-item').dataset.cardId;
        this.loadCard(cardId);
      });
    });

    // Duplicate card events
    document.querySelectorAll('.my-card-item .duplicate-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = e.target.closest('.my-card-item').dataset.cardId;
        this.duplicateCard(cardId);
      });
    });

    // Delete card events
    document.querySelectorAll('.my-card-item .delete-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = e.target.closest('.my-card-item').dataset.cardId;
        const card = this.cards.find(c => c.id === cardId);
        if (card && confirm(`Are you sure you want to delete "${card.name}"?`)) {
          this.removeCard(cardId);
          this.showMessage(`Deleted "${card.name}"`, 'info');
        }
      });
    });

    // Click to load card
    document.querySelectorAll('.my-card-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Only if not clicking on action buttons
        if (!e.target.closest('.my-card-actions')) {
          const cardId = item.dataset.cardId;
          this.loadCard(cardId);
        }
      });
    });
  }

  // Event handlers for integration with main CardForge system
  handleCardSaved(cardData) {
    this.addCard(cardData);
  }

  handleCardUpdated(cardData) {
    this.addCard(cardData); // addCard handles updates too
  }

  // Utility methods
  generateCardId() {
    return 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  showMessage(message, type = 'info') {
    // Create a simple notification
    const notification = document.createElement('div');
    notification.className = `my-cards-notification my-cards-notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: var(--aura-bg-color, #1a1a2e);
      color: var(--mood-text-primary, #e1e1ff);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      border: 1px solid var(--mood-primary-color, #00d4ff);
      box-shadow: 0 4px 12px rgba(0, 212, 255, 0.3);
      z-index: 1001;
      animation: slideInRight 0.3s ease;
      max-width: 250px;
    `;

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  // Public API
  getCurrentCards() {
    return [...this.cards];
  }

  getFilteredCards() {
    return [...this.filteredCards];
  }

  exportCards() {
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      cards: this.cards
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-cards-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.showMessage('Cards exported successfully', 'success');
  }

  importCards(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.cards && Array.isArray(importData.cards)) {
          const importedCount = importData.cards.length;
          importData.cards.forEach(card => {
            // Generate new IDs to avoid conflicts
            card.id = this.generateCardId();
            card.name = card.name + ' (Imported)';
          });
          
          this.cards.unshift(...importData.cards);
          this.saveCardsToStorage();
          this.applySearch(this.currentSearchQuery);
          this.renderMyCards();
          
          this.showMessage(`Imported ${importedCount} cards`, 'success');
        } else {
          throw new Error('Invalid file format');
        }
      } catch (error) {
        console.error('Import error:', error);
        this.showMessage('Error importing cards', 'error');
      }
    };
    reader.readAsText(file);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if we're on the CardForge page
  if (document.querySelector('.my-cards-zone')) {
    window.MyCardsManager = new MyCardsManager();
    
    // Integrate with search input
    const searchInput = document.getElementById('my-cards-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        window.MyCardsManager.searchCards(e.target.value);
      });
    }
  }
});

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MyCardsManager;
}

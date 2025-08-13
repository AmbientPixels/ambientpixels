/**
 * CardForge Forge Actions
 * Handles all Forge tab button functionality:
 * - Save Card, Duplicate Card, Reset Card
 * - Create New Deck, Publish Card
 * - Clean, focused implementation with proper error handling
 */

class CardForgeActions {
  constructor() {
    this.initialized = false;
    console.log('🔧 CardForge Forge Actions initialized');
  }

  init() {
    console.log('✅ CardForge Forge Actions ready');
    
    // Prevent duplicate initialization
    if (this.initialized) {
      console.log('⚠️ Already initialized, skipping...');
      return;
    }
    
    this.bindForgeButtons();
    this.refreshMyCardsList();
    this.refreshDeckList();
    this.initialized = true;
  }

  bindForgeButtons() {
    console.log('🔗 Binding Forge tab buttons...');
    
    // Save Card Button - prevent duplicate bindings
    const saveBtn = document.getElementById('save-card-btn');
    if (saveBtn && !saveBtn.dataset.forgeActionsBound) {
      // Mark as bound to prevent duplicates
      saveBtn.dataset.forgeActionsBound = 'true';
      
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Prevent rapid clicks
        if (saveBtn.dataset.saving === 'true') {
          console.log('Already saving, ignoring click');
          return;
        }
        
        saveBtn.dataset.saving = 'true';
        setTimeout(() => {
          saveBtn.dataset.saving = 'false';
        }, 2000);
        
        this.handleSaveCard();
      });
      
      console.log('✅ Save Card button bound (single handler)');
    } else if (saveBtn) {
      console.log('⚠️ Save Card button already bound, skipping');
    }

    // Duplicate Card button
    const duplicateBtn = document.getElementById('duplicate-card-btn');
    if (duplicateBtn) {
      duplicateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleDuplicateCard();
      });
    }

    // Reset Card button
    const resetBtn = document.getElementById('reset-card-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleResetCard();
      });
    }

    // Create New Deck button
    const createDeckBtn = document.getElementById('create-deck-btn');
    if (createDeckBtn) {
      createDeckBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleCreateNewDeck();
      });
    }

    // Publish Card button
    const publishBtn = document.getElementById('publish-card-btn');
    if (publishBtn) {
      publishBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handlePublishCard();
      });
    }

    console.log('🔗 Forge buttons bound successfully');
  }

  // ===================
  // SAVE CARD
  // ===================
  
  handleSaveCard() {
    console.log('💾 Save card requested');
    
    try {
      const cardData = this.collectCardData();
      
      if (!cardData.name || cardData.name.trim() === '') {
        this.showNotification('Please enter a card name before saving', 'error');
        return;
      }

      // Get saved cards first to check for existing card by name
      const savedCards = this.getSavedCards();
      const existingCard = savedCards.find(card => card.name.trim().toLowerCase() === cardData.name.trim().toLowerCase());
      
      // Use existing card ID if found, otherwise generate new one
      const cardId = existingCard ? existingCard.id : this.generateCardId();
      
      const savedCard = {
        id: cardId,
        name: cardData.name.trim(),
        createdAt: existingCard ? existingCard.createdAt : new Date().toISOString(),
        lastModified: new Date().toISOString(),
        cardData: cardData,
        isPublished: existingCard ? existingCard.isPublished : false,
        deckIds: existingCard ? existingCard.deckIds : []
      };

      // Update existing card or add new one
      const existingIndex = savedCards.findIndex(card => card.id === cardId);
      
      if (existingIndex >= 0) {
        savedCards[existingIndex] = savedCard;
        this.showNotification(`Card "${savedCard.name}" updated`, 'success');
      } else {
        savedCards.push(savedCard);
        this.showNotification(`Card "${savedCard.name}" saved`, 'success');
      }

      localStorage.setItem('cardforge_saved_cards', JSON.stringify(savedCards));
      
      // Update My Cards list if visible
      this.refreshMyCardsList();
      
    } catch (error) {
      console.error('Error saving card:', error);
      this.showNotification('Error saving card', 'error');
    }
  }

  // ===================
  // DUPLICATE CARD
  // ===================
  
  handleDuplicateCard() {
    console.log('📋 Duplicate card requested');
    
    try {
      const cardData = this.collectCardData();
      
      if (!cardData.name || cardData.name.trim() === '') {
        this.showNotification('Please enter a card name before duplicating', 'error');
        return;
      }

      // Create duplicate with modified name
      const duplicateName = `${cardData.name} (Copy)`;
      const duplicateData = {
        ...cardData,
        name: duplicateName,
        id: this.generateCardId()
      };

      // Load duplicate data into form
      this.loadCardIntoForm(duplicateData);
      
      this.showNotification(`Card duplicated as "${duplicateName}"`, 'success');
      
      // Switch to Card Design tab
      this.switchToDesignTab();
      
    } catch (error) {
      console.error('Error duplicating card:', error);
      this.showNotification('Error duplicating card', 'error');
    }
  }

  // ===================
  // RESET CARD
  // ===================
  
  handleResetCard() {
    console.log('🔄 Reset card requested');
    
    if (!confirm('Are you sure you want to reset the card? This will clear all current data and cannot be undone.')) {
      return;
    }

    try {
      // Reset all form fields
      this.resetAllFormFields();
      
      // Reset modular system if available
      if (window.ModularState && window.ModularState.reset) {
        window.ModularState.reset();
      }

      // Update card preview
      if (window.CardForgeEditor && window.CardForgeEditor.updateCardPreview) {
        window.CardForgeEditor.updateCardPreview();
      }

      this.showNotification('Card reset successfully', 'success');
      
      // Switch to Card Design tab
      this.switchToDesignTab();
      
    } catch (error) {
      console.error('Error resetting card:', error);
      this.showNotification('Error resetting card', 'error');
    }
  }

  // ===================
  // CREATE NEW DECK
  // ===================
  
  handleCreateNewDeck() {
    console.log('🗂️ Create new deck requested');
    
    const deckName = prompt('Enter a name for your new deck:', 'My New Deck');
    
    if (!deckName || deckName.trim() === '') {
      this.showNotification('Deck creation cancelled', 'info');
      return;
    }

    try {
      const newDeck = {
        id: this.generateDeckId(),
        name: deckName.trim(),
        description: '',
        cardIds: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      };

      // Save to localStorage
      const decks = this.getSavedDecks();
      decks.push(newDeck);
      localStorage.setItem('cardforge_decks', JSON.stringify(decks));

      this.showNotification(`Created deck "${deckName}"`, 'success');
      
      // Switch to Deck Manager tab
      this.switchToDeckTab();
      
      // Refresh deck list if visible
      this.refreshDeckList();
      
    } catch (error) {
      console.error('Error creating deck:', error);
      this.showNotification('Error creating deck', 'error');
    }
  }

  // ===================
  // PUBLISH CARD
  // ===================
  
  handlePublishCard() {
    console.log('🚀 Publish card requested');
    
    try {
      const cardData = this.collectCardData();
      
      if (!cardData.name || cardData.name.trim() === '') {
        this.showNotification('Please enter a card name before publishing', 'error');
        return;
      }

      // Use existing publish functionality if available
      if (window.publishCard && typeof window.publishCard === 'function') {
        window.publishCard();
      } else {
        this.showNotification('Publish functionality coming soon!', 'info');
      }
      
    } catch (error) {
      console.error('Error publishing card:', error);
      this.showNotification('Error publishing card', 'error');
    }
  }

  // ===================
  // UTILITY METHODS
  // ===================

  collectCardData() {
    const data = {};
    
    // Basic form fields
    const basicFields = [
      'card-name', 'card-class', 'card-quote', 'card-bio',
      'card-rarity', 'card-level', 'card-image-url'
    ];
    
    basicFields.forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) {
        data[fieldId.replace('card-', '')] = field.value;
      }
    });

    // Collect modular system data if available
    if (window.ModularState && window.ModularState.getCurrentState) {
      data.design = window.ModularState.getCurrentState();
    }

    return data;
  }

  loadCardIntoForm(cardData) {
    // Load basic fields
    const basicFields = [
      'card-name', 'card-class', 'card-quote', 'card-bio',
      'card-rarity', 'card-level', 'card-image-url'
    ];
    
    basicFields.forEach(fieldId => {
      const field = document.getElementById(fieldId);
      const dataKey = fieldId.replace('card-', '');
      if (field && cardData[dataKey]) {
        field.value = cardData[dataKey];
      }
    });

    // Load modular system data if available
    if (cardData.design && window.CardForgeEditor && window.CardForgeEditor.loadCardData) {
      window.CardForgeEditor.loadCardData(cardData);
    }

    // Update preview
    if (window.CardForgeEditor && window.CardForgeEditor.updateCardPreview) {
      window.CardForgeEditor.updateCardPreview();
    }
  }

  resetAllFormFields() {
    // Reset main form
    const form = document.getElementById('card-editor-form');
    if (form) {
      form.reset();
    }

    // Reset specific fields
    const fieldsToReset = [
      'card-name', 'card-class', 'card-quote', 'card-bio',
      'card-rarity', 'card-level', 'card-image-url'
    ];
    
    fieldsToReset.forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) {
        field.value = '';
      }
    });

    // Reset dynamic sections
    this.resetDynamicSections();
  }

  resetDynamicSections() {
    // Reset stats editor
    const statsEditor = document.getElementById('stats-editor');
    if (statsEditor) {
      statsEditor.innerHTML = '';
    }
    
    // Reset social links editor
    const socialEditor = document.getElementById('social-editor');
    if (socialEditor) {
      const firstRow = socialEditor.querySelector('.social-row');
      if (firstRow) {
        const platformSelect = firstRow.querySelector('.social-platform');
        const urlInput = firstRow.querySelector('input[name="social-url"]');
        if (platformSelect) platformSelect.value = 'twitter';
        if (urlInput) urlInput.value = '';
        
        // Remove additional rows
        const additionalRows = socialEditor.querySelectorAll('.social-row:not(:first-child)');
        additionalRows.forEach(row => this.refreshMyCardsList());
      }
    }
    
    // Reset micro badges editor
    const microEditor = document.getElementById('micro-editor');
    if (microEditor) {
      const firstRow = microEditor.querySelector('.micro-row');
      if (firstRow) {
        const inputs = firstRow.querySelectorAll('input');
        inputs.forEach(input => {
          if (input.type === 'range') {
            input.value = '1';
            const valueSpan = firstRow.querySelector('.slider-value');
            if (valueSpan) valueSpan.textContent = '1';
          } else if (input.type !== 'hidden') {
            input.value = '';
          }
        });
        
        const iconPicker = firstRow.querySelector('.icon-picker');
        if (iconPicker) {
          const selectedIcon = iconPicker.querySelector('.icon-option.selected');
          if (selectedIcon) selectedIcon.classList.remove('selected');
          const firstIcon = iconPicker.querySelector('.icon-option');
          if (firstIcon) firstIcon.classList.add('selected');
        }
        
        const additionalRows = microEditor.querySelectorAll('.micro-row:not(:first-child)');
        additionalRows.forEach(row => row.remove());
      }
    }
    
    // Reset attributes editor
    const attributeEditor = document.getElementById('attribute-editor');
    if (attributeEditor) {
      const firstRow = attributeEditor.querySelector('.attribute-row');
      if (firstRow) {
        const inputs = firstRow.querySelectorAll('input');
        inputs.forEach(input => input.value = '');
        
        const additionalRows = attributeEditor.querySelectorAll('.attribute-row:not(:first-child)');
        additionalRows.forEach(row => row.remove());
      }
    }
  }

  // Navigation helpers
  switchToDesignTab() {
    const designTab = document.querySelector('[data-step="1"]');
    if (designTab) {
      designTab.click();
    }
  }

  switchToDeckTab() {
    const deckTab = document.querySelector('[data-forge-tab="deck"]');
    if (deckTab) {
      deckTab.click();
    }
  }

  // Data management
  getSavedCards() {
    return JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]');
  }

  getSavedDecks() {
    return JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
  }

  generateCardId() {
    return 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  generateDeckId() {
    return 'deck_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // UI Updates
  refreshMyCardsList() {
    console.log('📋 Refreshing My Cards list...');
    const myCardsList = document.getElementById('my-cards-list');
    if (!myCardsList) return;

    const savedCards = this.getSavedCards();
    
    if (savedCards.length === 0) {
      myCardsList.innerHTML = `
        <div class="my-cards-empty">
          <i class="fas fa-layer-group"></i>
          <p>No saved cards yet</p>
          <small>Save your first card to see it here</small>
        </div>
      `;
      return;
    }

    // Render beautiful card gallery
    myCardsList.innerHTML = savedCards.map(card => {
      const cardDate = new Date(card.lastModified).toLocaleDateString();
      const cardImage = card.cardData?.avatar || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzAwZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkNhcmQgSW1hZ2U8L3RleHQ+PC9zdmc+';
      const cardName = card.name || 'Untitled Card';
      const isPublished = card.isPublished || false;
      
      return `
        <div class="card-gallery-item" data-card-id="${card.id}">
          <div class="card-thumbnail">
            <img src="${cardImage}" alt="${cardName}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzAwZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkNhcmQgSW1hZ2U8L3RleHQ+PC9zdmc+'">
          </div>
          <div class="card-info">
            <h3 class="card-title" title="${cardName}">${cardName}</h3>
            <div class="card-meta">
              <span class="card-date">${cardDate}</span>
              <span class="card-status ${isPublished ? 'published' : 'saved'}">
                ${isPublished ? 'Published' : 'Saved'}
              </span>
            </div>
            <div class="card-actions">
              <button class="card-action-btn edit" onclick="cardForgeActions.loadCard('${card.id}')" title="Edit Card">
                <i class="fas fa-edit"></i>
              </button>
              <button class="card-action-btn save" onclick="cardForgeActions.duplicateCard('${card.id}')" title="Duplicate Card">
                <i class="fas fa-copy"></i>
              </button>
              <button class="card-action-btn publish" onclick="cardForgeActions.publishCard('${card.id}')" title="Publish Card">
                <i class="fas fa-share"></i>
              </button>
              <button class="card-action-btn delete" onclick="cardForgeActions.deleteCard('${card.id}')" title="Delete Card">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  refreshDeckList() {
    // TODO: Implement deck list refresh
    console.log('🗂️ Refreshing deck list...');
  }

  // Card Gallery Actions
  loadCard(cardId) {
    console.log(`📂 Loading card: ${cardId}`);
    const savedCards = this.getSavedCards();
    const card = savedCards.find(c => c.id === cardId);
    
    if (!card) {
      this.showNotification('Card not found', 'error');
      return;
    }

    try {
      // Load card data into the editor
      if (window.cardForgeEditor && window.cardForgeEditor.loadCardData) {
        window.cardForgeEditor.loadCardData(card.data);
        this.showNotification(`Card "${card.name}" loaded successfully`, 'success');
      } else {
        // Fallback: populate form fields manually
        this.populateFormFields(card.data);
        this.showNotification(`Card "${card.name}" loaded`, 'success');
      }
    } catch (error) {
      console.error('Error loading card:', error);
      this.showNotification('Failed to load card', 'error');
    }
  }

  duplicateCard(cardId) {
    console.log(`📋 Duplicating card: ${cardId}`);
    const savedCards = this.getSavedCards();
    const card = savedCards.find(c => c.id === cardId);
    
    if (!card) {
      this.showNotification('Card not found', 'error');
      return;
    }

    try {
      // Create duplicate with new ID and name
      const duplicateCard = {
        ...card,
        id: this.generateCardId(),
        name: `${card.name} (Copy)`,
        savedAt: new Date().toISOString()
      };

      // Save the duplicate
      savedCards.push(duplicateCard);
      localStorage.setItem('cardforge-saved-cards', JSON.stringify(savedCards));
      
      this.refreshMyCardsList();
      this.showNotification(`Card duplicated as "${duplicateCard.name}"`, 'success');
    } catch (error) {
      console.error('Error duplicating card:', error);
      this.showNotification('Failed to duplicate card', 'error');
    }
  }

  deleteCard(cardId) {
    console.log(`🗑️ Deleting card: ${cardId}`);
    
    if (!confirm('Are you sure you want to delete this card? This action cannot be undone.')) {
      return;
    }

    try {
      const savedCards = this.getSavedCards();
      const cardIndex = savedCards.findIndex(c => c.id === cardId);
      
      if (cardIndex === -1) {
        this.showNotification('Card not found', 'error');
        return;
      }

      const cardName = savedCards[cardIndex].name;
      savedCards.splice(cardIndex, 1);
      localStorage.setItem('cardforge-saved-cards', JSON.stringify(savedCards));
      
      this.refreshMyCardsList();
      this.showNotification(`Card "${cardName}" deleted`, 'success');
    } catch (error) {
      console.error('Error deleting card:', error);
      this.showNotification('Failed to delete card', 'error');
    }
  }

  publishCard(cardId) {
    console.log(`🚀 Publishing card: ${cardId}`);
    const savedCards = this.getSavedCards();
    const card = savedCards.find(c => c.id === cardId);
    
    if (!card) {
      this.showNotification('Card not found', 'error');
      return;
    }

    try {
      // Use existing publish functionality
      if (window.publishCard) {
        window.publishCard();
        
        // Mark card as published
        card.published = true;
        card.publishedAt = new Date().toISOString();
        localStorage.setItem('cardforge-saved-cards', JSON.stringify(savedCards));
        
        this.refreshMyCardsList();
        this.showNotification(`Card "${card.name}" published successfully`, 'success');
      } else {
        this.showNotification('Publish functionality not available', 'error');
      }
    } catch (error) {
      console.error('Error publishing card:', error);
      this.showNotification('Failed to publish card', 'error');
    }
  }

  // Helper method to populate form fields
  populateFormFields(cardData) {
    if (!cardData) return;

    // Populate basic fields
    const fields = ['card-name', 'card-bio', 'card-class', 'card-rarity'];
    fields.forEach(fieldId => {
      const element = document.getElementById(fieldId);
      if (element && cardData[fieldId]) {
        element.value = cardData[fieldId];
      }
    });

    // Trigger form updates if available
    if (window.cardForgeEditor && window.cardForgeEditor.updatePreview) {
      window.cardForgeEditor.updatePreview();
    }
  }

  // Notifications
  showNotification(message, type = 'info') {
    // Use existing notification system if available
    if (window.rightColumn && window.rightColumn.showToolMessage) {
      window.rightColumn.showToolMessage(message, type);
    } else {
      // Fallback to console
      console.log(`[${type.toUpperCase()}] ${message}`);
      
      // Simple alert for important messages
      if (type === 'error') {
        alert(`Error: ${message}`);
      }
    }
  }
}

// Initialize CardForge Actions
const cardForgeActions = new CardForgeActions();

// Initialize when DOM is ready with multiple fallbacks
function initializeForgeActions() {
  console.log('🔧 Attempting to initialize Forge Actions...');
  cardForgeActions.init();
}

// Multiple initialization strategies to ensure it works
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeForgeActions);
} else if (document.readyState === 'interactive') {
  // DOM is ready but resources may still be loading
  setTimeout(initializeForgeActions, 100);
} else {
  // DOM is fully loaded
  initializeForgeActions();
}

// Additional fallback - try again after a short delay
setTimeout(() => {
  if (!cardForgeActions.initialized) {
    console.log('🔄 Fallback initialization attempt...');
    initializeForgeActions();
  }
}, 500);

// Export for global access
window.cardForgeActions = cardForgeActions;

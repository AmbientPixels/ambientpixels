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
      console.log(' Already initialized, skipping...');
      return;
    }
    
    this.bindForgeButtons();
    this.bindForgeTabNavigation();
    this.refreshMyCardsList();
    this.refreshDeckList();
    this.initialized = true;
  }

  /**
   * Bind Forge sub-tab navigation (Quick Actions, My Cards, Deck Manager)
   */
  bindForgeTabNavigation() {
    const tabButtons = document.querySelectorAll('.forge-sidebar-tab');
    const tabContents = document.querySelectorAll('.forge-tab-content');

    tabButtons.forEach((btn, idx) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        // Remove active/aria-selected from all buttons
        tabButtons.forEach((b, i) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
          b.setAttribute('tabindex', '-1');
        });
        // Add active/aria-selected to clicked button
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');
        btn.focus();
        // Show matching content, hide others
        const target = btn.getAttribute('data-forge-tab');
        tabContents.forEach(content => {
          if (content.getAttribute('data-forge-content') === target) {
            content.classList.add('active');
            content.style.display = '';
          } else {
            content.classList.remove('active');
            content.style.display = 'none';
          }
        });
      });
      // Keyboard navigation (arrow keys, Home/End)
      btn.addEventListener('keydown', (e) => {
        let newIdx = idx;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          newIdx = (idx + 1) % tabButtons.length;
          e.preventDefault();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          newIdx = (idx - 1 + tabButtons.length) % tabButtons.length;
          e.preventDefault();
        } else if (e.key === 'Home') {
          newIdx = 0;
          e.preventDefault();
        } else if (e.key === 'End') {
          newIdx = tabButtons.length - 1;
          e.preventDefault();
        }
        if (newIdx !== idx) {
          tabButtons[newIdx].click();
        }
      });
    });
    // On load, ensure only the active tab's content is visible
    setTimeout(() => {
      const activeBtn = document.querySelector('.forge-sidebar-tab.active');
      if (activeBtn) activeBtn.click();
    }, 0);
  }

  // updated by Cascade: Unify Save/Duplicate/Reset event binding for all UIs per Windsurf Protocol
  bindForgeButtons() {
    console.log('🔗 Binding Forge tab buttons...');
    
    // Save Card Buttons (Forge tab and Toolbar) - prevent duplicate bindings
    const saveBtns = [
      document.getElementById('save-card-btn'),
      document.getElementById('toolbar-save-btn')
    ].filter(Boolean);
    saveBtns.forEach(btn => {
      if (!btn.dataset.forgeActionsBound) {
        btn.dataset.forgeActionsBound = 'true';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (btn.dataset.saving === 'true') {
            console.log('Already saving, ignoring click');
            return;
          }
          btn.dataset.saving = 'true';
          setTimeout(() => {
            btn.dataset.saving = 'false';
          }, 2000);
          this.handleSaveCard();
        });
        console.log('✅ Save Card button bound (single handler)', btn.id);
      } else {
        console.log('⚠️ Save Card button already bound, skipping', btn.id);
      }
    });

    // Duplicate Card button
    const duplicateBtn = document.getElementById('duplicate-card-btn');
    if (duplicateBtn) {
      duplicateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleDuplicateCard(); // updated by Cascade
      });
    } // updated by Cascade

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
      console.log('🔍 Got card data:', cardData);
      console.log('🖼️ SAVING IMAGE:', cardData.avatar);
      
      if (!cardData.name || cardData.name.trim() === '') {
        this.showNotification('Please enter a card name before saving', 'error');
        return;
      }
      
      const savedCards = this.getSavedCards();
      
      // Always create new cards - don't check for existing names
      const existingCard = null;
      
      // Use existing card ID if found, otherwise generate new one
      const cardId = existingCard ? existingCard.id : this.generateCardId();
      // Ensure hidden field reflects current working card id (used by publish flow)
      const idField = document.getElementById('card-id'); /* updated by Cascade */
      if (idField) idField.value = cardId;               /* updated by Cascade */
      
      const savedCard = {
        id: cardId,
        name: cardData.name.trim(),
        createdAt: existingCard ? existingCard.createdAt : new Date().toISOString(),
        lastModified: new Date().toISOString(),
        cardData: cardData,
        isPublished: existingCard ? existingCard.isPublished : false,
        deckIds: existingCard ? existingCard.deckIds : []
      };

      /* updated by Cascade: route save based on auth state */
      const isAuthed = (sessionStorage.getItem('isAuthenticated') === 'true') ||
                       (document.body?.getAttribute('data-auth-state') === 'signed-in');
      if (isAuthed) {
        const saveUrl = window.buildApiPath('saveCard');
// Map characterClass to class for backend compatibility
        // Construct backend payload with required top-level fields only
        // Map from full modular schema to backend flat payload
        const cardData = savedCard.cardData;
        // Support both legacy and modular schema
        let backendPayload;
        if (cardData.cardContent && cardData.cardContent.frontFace) {
          backendPayload = {
            id: savedCard.id,
            name: cardData.cardContent.frontFace.characterName,
            class: cardData.cardContent.frontFace.characterClass,
            avatar: cardData.cardContent.frontFace.characterImage?.url || '',
            quote: cardData.cardContent.frontFace.characterDescription || '',
            achievement: cardData.cardContent.frontFace.achievement || ''
          };
        } else {
          backendPayload = {
            id: savedCard.id,
            name: cardData.name,
            class: cardData.characterClass,
            avatar: cardData.avatar,
            quote: cardData.quote,
            achievement: cardData.achievement
          };
        }
        fetch(saveUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(backendPayload)
        })
        .then(async (response) => {
          if (!response.ok) throw new Error('Azure save failed');
          await response.json().catch(() => ({}));
          this.showNotification(`Card "${savedCard.name}" saved to cloud`, 'success');
          // Also cache locally for offline
          const existingIndex = savedCards.findIndex(card => card.id === cardId);
          if (existingIndex >= 0) savedCards[existingIndex] = savedCard;
          else savedCards.unshift(savedCard);
          localStorage.setItem('cardforge_saved_cards', JSON.stringify(savedCards));
          this.refreshMyCardsList();
          setTimeout(() => {
            if (typeof showSavedCardsModal === 'function') showSavedCardsModal();
            else if (window.showSavedCardsModal) window.showSavedCardsModal();
          }, 250);
        })
        .catch(() => {
          // Cloud failed — fall back to local
          const existingIndex = savedCards.findIndex(card => card.id === cardId);
          if (existingIndex >= 0) {
            savedCards[existingIndex] = savedCard;
            this.showNotification(`Card "${savedCard.name}" updated locally`, 'warning');
          } else {
            savedCards.unshift(savedCard);
            this.showNotification(`Card "${savedCard.name}" saved locally`, 'warning');
          }
          localStorage.setItem('cardforge_saved_cards', JSON.stringify(savedCards));
          this.refreshMyCardsList();
          setTimeout(() => {
            if (typeof showSavedCardsModal === 'function') showSavedCardsModal();
            else if (window.showSavedCardsModal) window.showSavedCardsModal();
          }, 250);
        });
      } else {
        // Signed-out experience: local-only save
        const existingIndex = savedCards.findIndex(card => card.id === cardId);
        if (existingIndex >= 0) {
          savedCards[existingIndex] = savedCard;
          this.showNotification(`Card "${savedCard.name}" saved locally (sign in to sync)`, 'info');
        } else {
          savedCards.unshift(savedCard);
          this.showNotification(`Card "${savedCard.name}" saved locally (sign in to sync)`, 'info');
        }
        localStorage.setItem('cardforge_saved_cards', JSON.stringify(savedCards));
        this.refreshMyCardsList();
        setTimeout(() => {
          if (typeof showSavedCardsModal === 'function') showSavedCardsModal();
          else if (window.showSavedCardsModal) window.showSavedCardsModal();
        }, 250);
      }
      
    } catch (error) {
      console.error('Error saving card:', error);
      this.showNotification('Error saving card', 'error');
    }
  }

  // ===================
  // RESET CARD
  // ===================
  
  async handleResetCard() {
    console.log('🔄 Reset card requested');
    let proceed = true;
    if (typeof showConfirmDialog === 'function') {
      proceed = await new Promise(resolve => showConfirmDialog(
        'Reset Card',
        'Are you sure you want to reset the card? This will restore the default template and cannot be undone.',
        () => resolve(true),
        () => resolve(false)
      ));
    } else {
      proceed = confirm('Are you sure you want to reset the card? This will restore the default template and cannot be undone.');
    }
    if (!proceed) return;

    try {
      // Reset all form fields
      this.resetAllFormFields();

      // Reset modular system if available
      if (window.ModularState && window.ModularState.reset) {
        window.ModularState.reset();
      }

      // Load and apply prefill-card.json as the new default state
      await this.applyDefaultTemplate();

      this.showNotification('Card reset to default template', 'success');
      // Switch to Card Design tab
      this.switchToDesignTab();
    } catch (error) {
      console.error('Error resetting card:', error);
      this.showNotification('Error resetting card', 'error');
    }
  }

  /**
   * Loads prefill-card.json and applies its data to both form and preview
   */
  async applyDefaultTemplate() {
    try {
      const response = await fetch('./data/prefill-card.json');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const prefillData = await response.json();
      if (prefillData.cardData) {
        // Use existing loadCardIntoForm to apply to form and preview
        this.loadCardIntoForm(prefillData.cardData);
        // If modular system exists, update it
        if (window.ModularState && prefillData.cardData.design) {
          window.ModularState.loadState?.(prefillData.cardData.design);
        }
        // Update preview
        if (window.CardForgeEditor && window.CardForgeEditor.updateCardPreview) {
          window.CardForgeEditor.updateCardPreview();
        }
      }
      console.log('📄 Default template applied after reset:', prefillData);
    } catch (error) {
      console.warn('⚠️ Could not load prefill data after reset:', error);
    }
  }

  async handleResetCard() {
    console.log('🔄 Reset card requested');
    let proceed = true;
    if (typeof showConfirmDialog === 'function') {
      proceed = await new Promise(resolve => showConfirmDialog(
        'Reset Card',
        'Are you sure you want to reset the card? This will restore the default template and cannot be undone.',
        () => resolve(true),
        () => resolve(false)
      ));
    } else {
      proceed = confirm('Are you sure you want to reset the card? This will restore the default template and cannot be undone.');
    }
    if (!proceed) return;

    try {
      // Reset all form fields
      this.resetAllFormFields();

      // Reset modular system if available
      if (window.ModularState && window.ModularState.reset) {
        window.ModularState.reset();
      }

      // Load and apply prefill-card.json as the new default state
      await this.applyDefaultTemplate();

      this.showNotification('Card reset to default template', 'success');
      // Switch to Card Design tab
      this.switchToDesignTab();
    } catch (error) {
      console.error('Error resetting card:', error);
      this.showNotification('Error resetting card', 'error');
    }
  }

  /**
   * Loads prefill-card.json and applies its data to both form and preview
   */
  async applyDefaultTemplate() {
    try {
      const response = await fetch('./data/prefill-card.json');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const prefillData = await response.json();
      if (prefillData.cardData) {
        // Use existing loadCardIntoForm to apply to form and preview
        this.loadCardIntoForm(prefillData.cardData);
        // If modular system exists, update it
        if (window.ModularState && prefillData.cardData.design) {
          window.ModularState.loadState?.(prefillData.cardData.design);
        }
        // Update preview
        if (window.CardForgeEditor && window.CardForgeEditor.updateCardPreview) {
          window.CardForgeEditor.updateCardPreview();
        }
      }
      console.log('📄 Default template applied after reset:', prefillData);
    } catch (error) {
      console.warn('⚠️ Could not load prefill data after reset:', error);
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
        // Ensure hidden id field is set to the card being published
        const idField = document.getElementById('card-id'); /* updated by Cascade */
        if (idField) idField.value = cardData.id;               /* updated by Cascade */
        window.publishCard();
        
        // Mark card as published
        cardData.published = true;
        cardData.publishedAt = new Date().toISOString();
        localStorage.setItem('cardforge_saved_cards', JSON.stringify(this.getSavedCards()));
        
        this.refreshMyCardsList();
        this.showNotification(`Card "${cardData.name}" published successfully`, 'success');
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
    // Trigger updateCardContent first to get the preview JSON
    if (window.updateCardContent) {
      console.log('🔄 Calling updateCardContent to get preview JSON...');
      window.updateCardContent();
    }
    
    // Use the stored preview JSON data instead of form fields
    if (window.lastPreviewCardData) {
      console.log('✅ Using stored preview JSON data for save');
      console.log('🖼️ Preview JSON avatar:', window.lastPreviewCardData.avatar);
      const data = { ...window.lastPreviewCardData };
      
      console.log('📋 USING PREVIEW JSON DATA:', data);
      return data;
    }
    
    // Fallback: collect from form fields if preview data not available
    console.log('⚠️ Preview JSON not available, falling back to form fields');
    const statsData = window.collectStatsData ? window.collectStatsData() : [];
    const socialData = window.collectSocialLinksData ? window.collectSocialLinksData() : [];
    const badgesData = window.collectBadgesData ? window.collectBadgesData() : [];
    const attributesData = window.collectAttributesData ? window.collectAttributesData() : [];
    
    const biographyField = document.getElementById('card-bio');
    const biography = biographyField?.value?.trim() || '';
    
    const data = {
      name: document.getElementById('card-name')?.value || 'Aria Shadowbane',
      characterClass: document.getElementById('card-class')?.value || '',
      rarity: document.getElementById('card-rarity')?.value || '',
      quote: document.getElementById('card-quote')?.value || 'Shadows are my allies, silence my weapon.',
      avatar: document.getElementById('card-avatar')?.value || '',
      biography: biography,
      stats: statsData,
      socialLinks: socialData,
      badges: badgesData,
      attributes: attributesData
    };

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
      'card-rarity', 'card-level', 'card-avatar'
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
      'card-name', 'card-bio', 'card-class', 'card-rarity',
      'card-level', 'card-image-url'
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
  /* updated by Cascade: support cloud-backed list when authenticated */
  async refreshMyCardsList() {
    console.log('📋 Refreshing My Cards list...');
    const myCardsList = document.getElementById('my-cards-list');
    if (!myCardsList) return;

    const isAuthed = (sessionStorage.getItem('isAuthenticated') === 'true') ||
                     (document.body?.getAttribute('data-auth-state') === 'signed-in');

    let savedCards = this.getSavedCards();

    if (isAuthed) {
      try {
        const loadUrl = window.buildApiPath('loadCards');
const resp = await fetch(loadUrl, {
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
});
        if (resp.ok) {
          const data = await resp.json();
          let cloudCards = Array.isArray(data?.userCards) ? data.userCards : [];
          // Filter out default sample cards - they shouldn't appear in My Cards
          cloudCards = cloudCards.filter(c => !c.isDefault);
          // Prefer cloud cards; merge any local-only drafts not present by id
          const cloudIds = new Set(cloudCards.map(c => c.id));
          const localOnly = savedCards.filter(c => !cloudIds.has(c.id));
          savedCards = [...cloudCards, ...localOnly];
        }
      } catch (e) {
        console.warn('⚠️ Could not load cloud cards, showing local only:', e);
      }
    }

    if (!savedCards || savedCards.length === 0) {
      myCardsList.innerHTML = `
        <div class="my-cards-empty">
          <i class="fas fa-layer-group"></i>
          <p>No saved cards yet</p>
          <small>Save your first card to see it here</small>
        </div>
      `;
      return;
    }

    // Render gallery
    myCardsList.innerHTML = savedCards.map(card => {
      const cardDate = new Date(card.lastModified || card.createdAt || Date.now()).toLocaleDateString();
      const cardImage = card.cardData?.avatar || card.avatar || '';
      const cardName = card.cardData?.name || card.name || 'Untitled Card';
      const characterClass = card.cardData?.characterClass || card.characterClass || '';
      const rarity = card.cardData?.rarity || card.rarity || '';
      const quote = card.cardData?.quote || card.quote || '';
      const isPublished = card.isPublished || card.published || false;
      
      console.log(`🖼️ Gallery rendering card "${cardName}" with image:`, cardImage);
      
      const statsCount = card.cardData?.stats?.length || 0;
      const socialCount = card.cardData?.socialLinks?.length || 0;
      const badgesCount = card.cardData?.badges?.length || 0;
      
      return `
        <div class="card-gallery-item" data-card-id="${card.id}">
          <div class="card-thumbnail">
            <img src="${cardImage}" alt="${cardName}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzAwZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkNhcmQgSW1hZ2U8L3RleHQ+PC9zdmc+'">
            ${rarity ? `<div class="card-rarity-badge ${rarity.toLowerCase()}">${rarity}</div>` : ''}
          </div>
          <div class="card-info">
            <h3 class="card-title" title="${cardName}">${cardName}</h3>
            ${characterClass ? `<div class="card-class">${characterClass}</div>` : ''}
            ${quote ? `<div class="card-quote">"${quote.length > 50 ? quote.substring(0, 50) + '...' : quote}"</div>` : ''}
            <div class="card-stats-summary">
              ${statsCount > 0 ? `<span class="stat-count">📊 ${statsCount} stats</span>` : ''}
              ${socialCount > 0 ? `<span class="social-count">🔗 ${socialCount} links</span>` : ''}
              ${badgesCount > 0 ? `<span class="badge-count">🏆 ${badgesCount} badges</span>` : ''}
            </div>
            <div class="card-meta">
              <span class="card-date">${cardDate}</span>
              <span class="card-status ${isPublished ? 'published' : 'saved'}">
                ${isPublished ? 'Published' : 'Saved'}
              </span>
            </div>
            <div class="card-actions">
              <button class="card-action-btn edit" type="button" onclick="cardForgeActions.loadCard('${card.id}')" title="Edit Card">
                <i class="fas fa-edit"></i>
              </button>
              <button class="card-action-btn save" type="button" onclick="cardForgeActions.duplicateCard('${card.id}')" title="Duplicate Card">
                <i class="fas fa-copy"></i>
              </button>
              <button class="card-action-btn publish" type="button" onclick="cardForgeActions.publishCard('${card.id}')" title="Publish Card">
                <i class="fas fa-share"></i>
              </button>
              <button class="card-action-btn delete" type="button" onclick="window.deleteCard('${card.id}')" title="Delete Card">
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
      // Set hidden id field so subsequent Publish knows which card is active
      const idField = document.getElementById('card-id'); /* updated by Cascade */
      if (idField) idField.value = card.id;               /* updated by Cascade */
      if (window.cardForgeEditor && window.cardForgeEditor.loadCardData) {
        console.log('[CardForge] Card object about to load:', card);
        // Support legacy and new schemas: .data, .cardData, or direct
        let cardData = card.data || card.cardData || card;
        console.log('[CardForge] Card data about to load:', cardData);
        window.cardForgeEditor.loadCardData(cardData);
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


  publishCard(cardId) {
    console.log(`📤 Publishing card: ${cardId}`);
    const savedCards = this.getSavedCards();
    const card = savedCards.find(c => c.id === cardId);
    
    if (!card) {
      this.showNotification('Card not found', 'error');
      return;
    }

    try {
      // Use existing publish functionality - modal will be shown by cardforge-publish.js
      if (window.publishCard) {
        // Ensure hidden id field is set to the card being published
        const idField = document.getElementById('card-id'); /* updated by Cascade */
        if (idField) idField.value = card.id;               /* updated by Cascade */
        window.publishCard();
        // Note: Success modal and status update handled by cardforge-publish.js
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

// Card duplication logic (single source of truth) - updated by Cascade
CardForgeActions.prototype.duplicateCard = function(cardId) {
  const savedCards = this.getSavedCards();
  const original = savedCards.find(c => c.id === cardId);
  if (!original) {
    this.showNotification('Card not found', 'error');
    return;
  }
  // Deep clone
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = this.generateCardId();
  // Name logic: "Name Copy" or "Name Copy (2)", etc.
  let baseName = original.cardData?.name || original.name || 'Untitled Card';
  let copyNum = 1;
  let newName = baseName + ' Copy';
  while (savedCards.some(c => (c.cardData?.name || c.name) === newName)) {
    copyNum++;
    newName = baseName + ' Copy (' + copyNum + ')';
  }
  if (copy.cardData) copy.cardData.name = newName;
  copy.name = newName;
  copy.lastModified = new Date().toISOString();
  savedCards.unshift(copy);
  localStorage.setItem('cardforge_saved_cards', JSON.stringify(savedCards));
  this.refreshMyCardsList();
  this.showNotification(`Card duplicated as "${newName}"`, 'success');
};

// Toolbar and My Cards list both call this (single source of truth) - updated by Cascade
CardForgeActions.prototype.handleDuplicateCard = function(cardId) {
  // If called from button (no arg), get selected card from UI
  if (!cardId) {
    // Try to get selected card from UI (implement as needed)
    const selected = document.querySelector('.my-card.selected');
    if (selected && selected.dataset.cardId) {
      cardId = selected.dataset.cardId;
    } else {
      this.showNotification('Select a card to duplicate', 'error');
      return;
    }
  }
  this.duplicateCard(cardId);
};

// Initialize CardForge Actions
const cardForgeActions = new CardForgeActions();

// Minimal Toolbar Integration
// REMOVED: Legacy prototype-based bindToolbarActions (all button bindings unified below)

// Windsurf Protocol: SINGLE SOURCE OF TRUTH for Forge/Toolbar button bindings
// Only keep the class-based bindForgeButtons
// This function binds Save, Reset, and Clear All for both Forge tab and toolbar, and ensures only one handler per button.
// Windsurf Protocol: SINGLE SOURCE OF TRUTH for all Save/Reset/Clear All button bindings
CardForgeActions.prototype.bindForgeButtons = function() {
  // Save Card Buttons (Forge tab and Toolbar) - prevent duplicate bindings
  const saveBtns = [
    document.getElementById('save-card-btn'),
    document.getElementById('toolbar-save-btn')
  ].filter(Boolean);
  saveBtns.forEach(btn => {
    if (!btn.dataset.forgeActionsBound) {
      btn.dataset.forgeActionsBound = 'true';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.saving === 'true') {
          console.log('Already saving, ignoring click');
          return;
        }
        btn.dataset.saving = 'true';
        setTimeout(() => {
          btn.dataset.saving = 'false';
        }, 2000);
        this.handleSaveCard();
      });
      console.log('✅ Save Card button bound (single handler)', btn.id);
    } else {
      console.log('⚠️ Save Card button already bound, skipping', btn.id);
    }
  });

  // Reset Card Buttons (Forge tab and Toolbar)
  const resetBtns = [
    document.getElementById('reset-card-btn'),
    document.getElementById('toolbar-reset-btn')
  ].filter(Boolean);
  resetBtns.forEach(btn => {
    if (!btn.dataset.forgeActionsBound) {
      btn.dataset.forgeActionsBound = 'true';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        // Use CardForge modal confirmation, not native confirm
        if (typeof showConfirmDialog === 'function') {
          showConfirmDialog(
            'Reset Card',
            'Are you sure you want to reset the card? This will clear all current data and cannot be undone.',
            () => this.handleResetCard()
          );
        } else {
          // Fallback (should not happen)
          if (confirm('Are you sure you want to reset the card? This will clear all current data and cannot be undone.')) {
            this.handleResetCard();
          }
        }
      });
      console.log('✅ Reset Card button bound (single handler)', btn.id);
    }
  });

  // Clear All Buttons (Forge tab and Toolbar)
  const clearBtns = [
    document.getElementById('clear-all-btn'),
    document.getElementById('toolbar-clear-all-btn')
  ].filter(Boolean);
  clearBtns.forEach(btn => {
    if (!btn.dataset.forgeActionsBound) {
      btn.dataset.forgeActionsBound = 'true';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        // Use CardForge modal confirmation, not native confirm
        if (typeof showConfirmDialog === 'function') {
          showConfirmDialog(
            'Clear All Fields',
            'Are you sure you want to clear all fields? This will blank out the entire card and cannot be undone.',
            () => this.handleClearAll()
          );
        } else {
          if (confirm('Are you sure you want to clear all fields? This will blank out the entire card and cannot be undone.')) {
            this.handleClearAll();
          }
        }
      });
      console.log('✅ Clear All button bound (single handler)', btn.id);
    }
  });
};


function showSavedCardsModal() {
  // Fetch saved cards from localStorage
  let savedCards = [];
  try {
    savedCards = JSON.parse(localStorage.getItem('cardforge_saved_cards')) || [];
  } catch { savedCards = []; }
  if (!savedCards.length) return;
  // Show up to 6 recent cards
  const recent = savedCards.slice(0, 6);
  const latestId = recent[0].id;
  let gallery = '<div class="mini-card-gallery">';
  recent.forEach(card => {
    gallery += `<div class="mini-card${card.id===latestId?' saved':''}">
      <img src="${card.cardData.avatar||''}" alt="${card.name}" />
      <div class="mini-card-name">${card.name||'Untitled'}</div>
      ${card.id===latestId ? '<span class="saved-badge"><i class="fas fa-check"></i></span>' : ''}
    </div>`;
  });
  gallery += '</div>';
  const modalHtml = `<div class="modal-saved-gallery">
    <h3><i class="fas fa-check-circle"></i> Card Saved!</h3>
    ${gallery}
    <div class="modal-actions">
      <button id="saved-modal-go-cards" onclick="window.location.hash='#forge-my-cards'">Go to My Cards</button>
      <button onclick="document.querySelector('.modal-saved-gallery').parentNode.remove()">Close</button>
    </div>
  </div>`;
  // Remove any existing modal
  document.querySelectorAll('.modal-saved-gallery').forEach(m => m.parentNode.removeChild(m));
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = modalHtml;
  overlay.style.position = 'fixed';
  overlay.style.top = 0;
  overlay.style.left = 0;
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.zIndex = 5000;
  overlay.style.background = 'rgba(18,22,34,0.82)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  // Windsurf Protocol: Force modal visible
  overlay.style.opacity = '1';
  overlay.style.visibility = 'visible';
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  setTimeout(() => { /* updated by Cascade */
    const goBtn = overlay.querySelector('#saved-modal-go-cards');
    if (goBtn) {
      goBtn.addEventListener('click', () => {
        const forgeStepBtn = document.querySelector('.step-btn[data-step="7"]');
        if (forgeStepBtn) {
          try { forgeStepBtn.click(); } catch {}
        }
        setTimeout(() => {
          const cardsTabBtn = document.querySelector('.forge-sidebar-tab[data-forge-tab="cards"]');
          const allTabs = document.querySelectorAll('.forge-sidebar-tab');
          const allPanels = document.querySelectorAll('.forge-tab-content');
          const cardsPanel = document.querySelector('.forge-tab-content[data-forge-content="cards"]');
          // Manually activate target tab/panel
          if (allTabs.length && allPanels.length && cardsTabBtn && cardsPanel) {
            allTabs.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); b.setAttribute('tabindex','-1'); });
            cardsTabBtn.classList.add('active');
            cardsTabBtn.setAttribute('aria-selected','true');
            cardsTabBtn.setAttribute('tabindex','0');
            allPanels.forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
            cardsPanel.classList.add('active');
            cardsPanel.style.display = '';
            // Bring My Cards list into view and focus for clarity
            const list = document.getElementById('my-cards-list');
            if (list) {
              try { list.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
              try { list.setAttribute('tabindex','-1'); list.focus({ preventScroll: true }); } catch {}
            }
          } else if (cardsTabBtn) {
            // Fallback: trigger click if bindings exist
            try { cardsTabBtn.click(); } catch {}
          }
          overlay.remove();
          // Optionally focus the active tab for a11y
          try { cardsTabBtn && cardsTabBtn.focus(); } catch {}
        }, 50);
      });
    }
  }, 0);
}
window.showSavedCardsModal = showSavedCardsModal;


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

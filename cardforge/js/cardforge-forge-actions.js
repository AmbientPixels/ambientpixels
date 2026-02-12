/**
 * CardForge Forge Actions
 * Handles all Forge tab button functionality:
 * - Save Card, Duplicate Card, Reset Card
 * - Create New Deck, Publish Card
 * - Clean, focused implementation with proper error handling
 */

const DECK_ICONS = [
  { icon: 'fas fa-layer-group',        label: 'Stack' },
  { icon: 'fas fa-clone',              label: 'Cards' },
  { icon: 'fas fa-khanda',             label: 'Sword' },
  { icon: 'fas fa-shield-halved',      label: 'Shield' },
  { icon: 'fas fa-wand-magic-sparkles', label: 'Wand' },
  { icon: 'fas fa-leaf',               label: 'Leaf' },
  { icon: 'fas fa-gear',               label: 'Cog' },
  { icon: 'fas fa-flask',              label: 'Flask' },
  { icon: 'fas fa-star',               label: 'Star' },
  { icon: 'fas fa-compass',            label: 'Compass' },
  { icon: 'fas fa-box',                label: 'Box' },
  { icon: 'fas fa-box-archive',        label: 'Archive' }
];
const DEFAULT_DECK_ICON = 'fas fa-layer-group';

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
    this.refreshGallery();
    this.refreshGalleryDecks();
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
        // Update pip active states
        this.updateSidebarIndicators();
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
    
    // Save Card Buttons (Forge tab and Toolbar) - unified state via ChromeUI
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
          const currentState = window.CardForgeChrome?.statusEl?.dataset?.state;
          if (currentState !== 'unsaved' && currentState !== 'error') {
            console.log(`Save blocked — state is "${currentState}"`);
            return;
          }
          if (window.CardForgeChrome) {
            if (btn.id === 'toolbar-save-btn') {
              window.CardForgeChrome._navigateAfterSave = true;
            }
            window.CardForgeChrome.beginSaving();
          }
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
      
      // Check if we're editing an existing card (card-id is set by loadCard)
      const idField = document.getElementById('card-id');
      const editingId = idField ? idField.value : null;
      const existingCard = editingId ? savedCards.find(c => c.id === editingId) : null;
      
      // Reuse existing card ID when editing, otherwise generate new one
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

      /* updated by Cascade: route save based on auth state */
      const isAuthed = (sessionStorage.getItem('isAuthenticated') === 'true') ||
                       (document.body?.getAttribute('data-auth-state') === 'signed-in');
      if (isAuthed) {
        const saveUrl = window.buildApiPath('saveCard');
        // Build backend payload: flat validated fields + full cardData for lightbox rendering
        const cardData = savedCard.cardData;
        let backendPayload;
        if (cardData.cardContent && cardData.cardContent.frontFace) {
          backendPayload = {
            id: savedCard.id,
            name: cardData.cardContent.frontFace.characterName,
            class: cardData.cardContent.frontFace.characterClass,
            avatar: cardData.cardContent.frontFace.characterImage?.url || '',
            quote: cardData.cardContent.frontFace.characterDescription || '',
            achievement: cardData.cardContent.frontFace.achievement || '',
            cardData: cardData
          };
        } else {
          backendPayload = {
            id: savedCard.id,
            name: cardData.name,
            class: cardData.characterClass,
            avatar: cardData.avatar,
            quote: cardData.quote,
            achievement: cardData.achievement,
            cardData: cardData
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
          // Clear card-id so the next save creates a new card
          if (idField) idField.value = '';
          this.refreshMyCardsList();
          if (window.CardForgeChrome) {
            window.CardForgeChrome.finishSaving(true);
          }
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
          // Clear card-id so the next save creates a new card
          if (idField) idField.value = '';
          this.refreshMyCardsList();
          if (window.CardForgeChrome) {
            window.CardForgeChrome.finishSaving(true);
          }
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
        // Clear card-id so the next save creates a new card
        if (idField) idField.value = '';
        this.refreshMyCardsList();
        if (window.CardForgeChrome) {
          window.CardForgeChrome.finishSaving(true);
        }
      }
      
    } catch (error) {
      console.error('Error saving card:', error);
      this.showNotification('Error saving card', 'error');
      if (window.CardForgeChrome) {
        window.CardForgeChrome.finishSaving(false);
      }
    }
  }

  // ===================
  // RE-PUBLISH PROMPT
  // ===================

  _promptRepublish(cardId, cardName) {
    // Show a confirm dialog to re-publish the updated card
    const doRepublish = () => {
      const idField = document.getElementById('card-id');
      if (idField) idField.value = cardId;
      if (window.publishCard && typeof window.publishCard === 'function') {
        window.publishCard();
      } else {
        this.showNotification('Publish functionality not available', 'error');
      }
    };

    const dialogFn = (window.UIUtils && window.UIUtils.showConfirmDialog) || (typeof showConfirmDialog === 'function' ? showConfirmDialog : null);
    if (dialogFn) {
      dialogFn(
        'Update Published Card',
        `"${cardName}" is published in the gallery. Would you like to re-publish with your changes?`,
        doRepublish
      );
    } else if (confirm(`"${cardName}" is published. Re-publish with your changes?`)) {
      doRepublish();
    }
  }

  // ===================
  // RESET CARD
  // ===================
  
  async handleResetCard() {
    console.log('🔄 Reset card requested');
    try {
      this.resetAllFormFields();

      // Reset ModularState to defaults (it's a plain object, no .reset() method)
      if (window.ModularState) {
        Object.assign(window.ModularState, {
          horizontalAlignment: 'center',
          verticalAlignment: 'middle',
          alignmentWeight: 'balanced',
          alignmentStyle: 'padded',
          palette: 'neon',
          paletteVariant: 'light',
          textColor: 'auto',
          imageContainer: 'masked',
          imageContainerVariant: 'circle',
          imageEffect: 'none',
          imageEffectVariant: 'clean'
        });
      }

      await this.applyDefaultTemplate();

      this.showNotification('Card reset to default template', 'success');
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
        // Use the global API which handles form fields, ModularState, AND updatePreview()
        if (window.cardForgeEditor && window.cardForgeEditor.loadCardData) {
          window.cardForgeEditor.loadCardData(prefillData.cardData);
        }
      }
      console.log('📄 Default template applied after reset:', prefillData);
    } catch (error) {
      console.warn('⚠️ Could not load prefill data after reset:', error);
    }
  }

  // ===================
  // NEW CARD (Clear All)
  // ===================

  handleClearAll() {
    console.log('✨ New random card requested');
    try {
      // Clear card-id so next Save creates a new card instead of overwriting
      const idField = document.getElementById('card-id');
      if (idField) idField.value = '';

      // Roll a completely random card (design + character data + artwork)
      if (window.CardForge && window.CardForge.rollRandomCard) {
        window.CardForge.rollRandomCard();
      }

      // Mark as dirty so Save becomes active
      if (window.CardForgeChrome) {
        window.CardForgeChrome.markDirty();
      }

      this.showNotification('New random card generated', 'success');
    } catch (error) {
      console.error('Error creating new card:', error);
      this.showNotification('Error creating new card', 'error');
    }
  }

  // ===================
  // CREATE NEW DECK
  // ===================
  
  handleCreateNewDeck() {
    console.log('🗂️ Create new deck requested');
    if (!this.requireAuth('create a deck')) return;

    this._showDeckFormDialog({
      title: 'Create New Deck',
      confirmLabel: 'Create',
      defaults: { name: 'My New Deck', icon: DEFAULT_DECK_ICON, description: '', tags: '', deckImage: '' }
    }, (formData) => {
      try {
        const newDeck = {
          id: this.generateDeckId(),
          name: formData.name,
          icon: formData.icon || DEFAULT_DECK_ICON,
          description: formData.description || '',
          tags: formData.tags || '',
          deckImage: formData.deckImage || '',
          cardIds: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString()
        };

        const decks = this.getSavedDecks();
        decks.push(newDeck);
        localStorage.setItem('cardforge_decks', JSON.stringify(decks));

        this.showNotification(`Created deck "${formData.name}"`, 'success');
        this._selectedDeckId = newDeck.id;
        this.switchToDeckTab();
        this.refreshDeckList();
      } catch (error) {
        console.error('Error creating deck:', error);
        this.showNotification('Error creating deck', 'error');
      }
    });
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
        // Clear card-id immediately — publishCard() already captured it
        if (idField) idField.value = '';
        
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
  // DECK FORM DIALOG (shared by create + edit)
  // ===================

  _showDeckFormDialog(config, onConfirm) {
    const dialog = document.getElementById('cardforge-dialog');
    if (!dialog) {
      const name = prompt(config.title, config.defaults.name || '');
      if (name && name.trim()) onConfirm({ name: name.trim(), icon: config.defaults.icon, description: '', tags: '', deckImage: '' });
      return;
    }

    const d = config.defaults || {};
    const titleEl = dialog.querySelector('#cardforge-dialog-title');
    const messageEl = dialog.querySelector('#cardforge-dialog-message');
    const confirmBtn = dialog.querySelector('#cardforge-dialog-confirm');
    const cancelBtn = dialog.querySelector('#cardforge-dialog-cancel');

    if (titleEl) titleEl.textContent = config.title;

    let _selectedIcon = d.icon || DEFAULT_DECK_ICON;

    const iconsHTML = DECK_ICONS.map(item =>
      '<button type="button" class="dialog-icon-option' +
      (item.icon === _selectedIcon ? ' selected' : '') +
      '" data-icon="' + item.icon + '" title="' + item.label + '">' +
      '<i class="' + item.icon + '"></i></button>'
    ).join('');

    const formHTML =
      '<div class="deck-form-dialog">' +
        '<label class="deck-publish-label">Name</label>' +
        '<input type="text" id="deck-form-name" class="cardforge-dialog-input" value="' + (d.name || '').replace(/"/g, '&quot;') + '" placeholder="Deck name..." autocomplete="off" />' +
        '<label class="deck-publish-label">Deck Image <span style="opacity:0.5">(optional)</span></label>' +
        '<div class="deck-form-image-row">' +
          '<input type="text" id="deck-form-image" class="cardforge-dialog-input" value="' + (d.deckImage || '').replace(/"/g, '&quot;') + '" placeholder="Paste URL or browse below..." autocomplete="off" />' +
          '<button type="button" id="deck-form-browse-btn" class="deck-form-browse-btn" title="Browse Image Library"><i class="fas fa-images"></i></button>' +
          '<div class="deck-form-image-preview" id="deck-form-image-preview">' +
            (d.deckImage ? '<img src="' + d.deckImage.replace(/"/g, '&quot;') + '" alt="preview" />' : '<i class="fas fa-image"></i>') +
          '</div>' +
        '</div>' +
        '<div class="deck-form-image-library" id="deck-form-image-library" style="display:none">' +
          '<div class="deck-form-image-library-header">' +
            '<span class="deck-form-image-library-title"><i class="fas fa-images"></i> Image Library</span>' +
            '<div class="deck-form-image-library-pager">' +
              '<button type="button" id="deck-img-prev" class="deck-form-pager-btn" disabled>&laquo;</button>' +
              '<span id="deck-img-page-info">Page 1</span>' +
              '<button type="button" id="deck-img-next" class="deck-form-pager-btn">&raquo;</button>' +
            '</div>' +
          '</div>' +
          '<div class="deck-form-image-grid" id="deck-form-image-grid">Loading...</div>' +
        '</div>' +
        '<label class="deck-publish-label">Description <span style="opacity:0.5">(optional)</span></label>' +
        '<textarea id="deck-form-desc" class="cardforge-dialog-input" rows="2" placeholder="Describe your deck...">' + (d.description || '') + '</textarea>' +
        '<label class="deck-publish-label">Tags <span style="opacity:0.5">(comma separated)</span></label>' +
        '<input type="text" id="deck-form-tags" class="cardforge-dialog-input" value="' + (d.tags || '').replace(/"/g, '&quot;') + '" placeholder="e.g. warrior, fire, starter" autocomplete="off" />' +
        '<div class="dialog-icon-picker">' +
          '<div class="dialog-icon-label">Deck Icon</div>' +
          '<div class="dialog-icon-grid">' + iconsHTML + '</div>' +
        '</div>' +
      '</div>';

    if (messageEl) messageEl.innerHTML = formHTML;
    if (cancelBtn) cancelBtn.style.display = '';
    if (confirmBtn) confirmBtn.textContent = config.confirmLabel || 'Save';

    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    dialog.classList.add('active');
    const nameInput = dialog.querySelector('#deck-form-name');
    if (nameInput) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 100);

    // Icon selection
    const iconGrid = dialog.querySelector('.dialog-icon-grid');
    if (iconGrid) {
      iconGrid.addEventListener('click', function(e) {
        const btn = e.target.closest('.dialog-icon-option');
        if (!btn) return;
        iconGrid.querySelectorAll('.dialog-icon-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _selectedIcon = btn.getAttribute('data-icon');
      });
    }

    // Image input, preview, and library
    const imgInput = dialog.querySelector('#deck-form-image');
    const imgPreview = dialog.querySelector('#deck-form-image-preview');
    const browseBtn = dialog.querySelector('#deck-form-browse-btn');
    const libraryEl = dialog.querySelector('#deck-form-image-library');
    const imgGrid = dialog.querySelector('#deck-form-image-grid');
    const prevBtn = dialog.querySelector('#deck-img-prev');
    const nextBtn = dialog.querySelector('#deck-img-next');
    const pageInfoEl = dialog.querySelector('#deck-img-page-info');

    const updateImgPreview = (url) => {
      if (!imgPreview) return;
      if (url) {
        imgPreview.innerHTML = '<img src="' + url.replace(/"/g, '&quot;') + '" alt="preview" onerror="this.parentNode.innerHTML=\'<i class=&quot;fas fa-exclamation-triangle&quot;></i>\'" />';
      } else {
        imgPreview.innerHTML = '<i class="fas fa-image"></i>';
      }
    };

    // Live preview on URL typing
    if (imgInput) {
      let debounce;
      imgInput.addEventListener('input', function() {
        clearTimeout(debounce);
        debounce = setTimeout(() => updateImgPreview(imgInput.value.trim()), 400);
        // Deselect library images when typing a custom URL
        if (imgGrid) imgGrid.querySelectorAll('img').forEach(i => i.classList.remove('selected'));
      });
    }

    // Browse button toggles image library
    let _imgManifest = null;
    let _imgPage = 1;
    const IMG_PER_PAGE = 12;

    const loadImgPage = (page) => {
      if (!_imgManifest || !imgGrid) return;
      _imgPage = page;
      const total = Math.ceil(_imgManifest.length / IMG_PER_PAGE);
      const start = (page - 1) * IMG_PER_PAGE;
      const pageImgs = _imgManifest.slice(start, start + IMG_PER_PAGE);
      const currentVal = imgInput ? imgInput.value.trim() : '';

      imgGrid.innerHTML = pageImgs.map(url =>
        '<img src="' + url + '" alt="" class="deck-form-lib-img' +
        (url === currentVal ? ' selected' : '') + '" data-url="' + url + '" />'
      ).join('');

      // Click handler for each image
      imgGrid.querySelectorAll('.deck-form-lib-img').forEach(img => {
        img.addEventListener('click', function() {
          imgGrid.querySelectorAll('img').forEach(i => i.classList.remove('selected'));
          img.classList.add('selected');
          const selectedUrl = img.getAttribute('data-url');
          if (imgInput) imgInput.value = selectedUrl;
          updateImgPreview(selectedUrl);
        });
      });

      if (pageInfoEl) pageInfoEl.textContent = 'Page ' + page + ' of ' + total;
      if (prevBtn) prevBtn.disabled = page <= 1;
      if (nextBtn) nextBtn.disabled = page >= total;
    };

    if (browseBtn && libraryEl) {
      browseBtn.addEventListener('click', async function() {
        const isOpen = libraryEl.style.display !== 'none';
        if (isOpen) {
          libraryEl.style.display = 'none';
          return;
        }
        libraryEl.style.display = '';
        if (!_imgManifest) {
          try {
            const resp = await fetch('/cardforge/image-manifest.json');
            _imgManifest = await resp.json();
          } catch (e) {
            imgGrid.innerHTML = '<p style="color:#ff6b6b;font-size:0.75rem;">Failed to load images</p>';
            return;
          }
        }
        loadImgPage(1);
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', () => { if (_imgPage > 1) loadImgPage(_imgPage - 1); });
    if (nextBtn) nextBtn.addEventListener('click', () => { loadImgPage(_imgPage + 1); });

    const cleanup = () => {
      dialog.classList.remove('active');
      if (messageEl) messageEl.innerHTML = '';
      newConfirmBtn.removeEventListener('click', handleConfirm);
      newCancelBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleKeydown);
    };

    const handleConfirm = () => {
      const name = (dialog.querySelector('#deck-form-name') || {}).value || '';
      if (!name.trim()) { cleanup(); return; }
      const formData = {
        name: name.trim(),
        icon: _selectedIcon,
        description: (dialog.querySelector('#deck-form-desc') || {}).value || '',
        tags: (dialog.querySelector('#deck-form-tags') || {}).value || '',
        deckImage: (dialog.querySelector('#deck-form-image') || {}).value || ''
      };
      cleanup();
      onConfirm(formData);
    };

    const handleCancel = () => { cleanup(); };
    const handleKeydown = (e) => {
      if (e.key === 'Escape') handleCancel();
    };

    newConfirmBtn.addEventListener('click', handleConfirm);
    newCancelBtn.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleKeydown);
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
      
      // Collect modular system data if available (ModularState is a plain object)
      if (window.ModularState) {
        data.design = { ...window.ModularState };
      }

      // Capture rendered card HTML from the live preview DOM
      const frontEl = document.querySelector('.card-preview-zone .card-front');
      const backEl = document.querySelector('.card-preview-zone .card-back');
      console.log('🔍 [CAPTURE] frontEl found:', !!frontEl, 'backEl found:', !!backEl);
      if (frontEl) {
        data.renderedFront = frontEl.innerHTML;
        data.frontClasses = frontEl.className;
        console.log('🔍 [CAPTURE] frontClasses:', data.frontClasses);
        console.log('🔍 [CAPTURE] renderedFront length:', data.renderedFront.length);
      }
      if (backEl) {
        data.renderedBack = backEl.innerHTML;
        data.backClasses = backEl.className;
        console.log('🔍 [CAPTURE] backClasses:', data.backClasses);
      }

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

    // Collect modular system data if available (ModularState is a plain object)
    if (window.ModularState) {
      data.design = Object.assign({}, window.ModularState);
    }

    // Capture rendered card HTML from the live preview DOM
    const frontEl = document.querySelector('.card-preview-zone .card-front');
    const backEl = document.querySelector('.card-preview-zone .card-back');
    if (frontEl) {
      data.renderedFront = frontEl.innerHTML;
      data.frontClasses = frontEl.className;
    }
    if (backEl) {
      data.renderedBack = backEl.innerHTML;
      data.backClasses = backEl.className;
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
          // Build a set of published card IDs from gallery data for reliable status detection
          const galleryCards = Array.isArray(data?.galleryCards) ? data.galleryCards : [];
          const publishedCardIds = new Set(galleryCards.map(c => c.id));
          console.log('☁️ Raw cloud cards from API:', cloudCards.map(c => ({ id: c.id, name: c.name || c.cardData?.name, published: c.published, publishDate: c.publishDate })));
          console.log('📢 Published card IDs from gallery:', [...publishedCardIds]);
          // Cache published IDs so save flow can detect re-publish scenarios
          this._publishedCardIds = publishedCardIds;
          // Filter out default sample cards - they shouldn't appear in My Cards
          cloudCards = cloudCards.filter(c => !c.isDefault);
          // Cross-reference with gallery to set published status reliably
          cloudCards.forEach(c => {
            if (publishedCardIds.has(c.id)) {
              c.published = true;
            }
          });
          // Prefer cloud cards; merge any local-only drafts not present by id
          const cloudIds = new Set(cloudCards.map(c => c.id));
          const localOnly = savedCards.filter(c => !cloudIds.has(c.id));
          // Also mark local cards as published if they exist in gallery
          localOnly.forEach(c => {
            if (publishedCardIds.has(c.id)) {
              c.published = true;
            }
          });
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

    // Render mini cards — half-size replicas using zoom
    const fallbackSvg = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYwIiBoZWlnaHQ9IjUwNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzAwZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
    myCardsList.innerHTML = savedCards.map(card => {
      const cd = card.cardData || card;
      const cardName = cd.name || card.name || 'Untitled Card';
      const characterClass = cd.characterClass || '';
      const cardImage = cd.avatar || card.avatar || '';
      const isPublished = card.isPublished || card.published || cd.published || cd.isPublished || false;
      const hasRendered = cd.renderedFront && cd.frontClasses;

      // Wrap card content in a scaler div — zoom:0.5 shrinks 360px to 180px in layout
      let contentHTML;
      if (hasRendered) {
        contentHTML = `<div class="mini-card-scaler"><div class="${cd.frontClasses}">${cd.renderedFront}</div></div>`;
      } else {
        contentHTML = `<img class="mini-card-fallback" src="${cardImage || fallbackSvg}" alt="${cardName}" onerror="this.src='${fallbackSvg}'">`;
      }

      return `
        <div class="mini-card" data-card-id="${card.id}" onclick="cardForgeActions.loadCard('${card.id}')" style="cursor:pointer">
          ${contentHTML}
          ${isPublished ? '<span class="mini-card-published" title="Published"></span>' : ''}
          <div class="mini-card-label">
            ${cardName}
            ${characterClass ? `<span class="mini-card-class">${characterClass}</span>` : ''}
          </div>
          <div class="mini-card-overlay">
            <div class="mini-card-actions">
              <button class="mini-card-btn duplicate" type="button" onclick="event.stopPropagation();cardForgeActions.duplicateCard('${card.id}')" title="Duplicate">
                <i class="fas fa-copy"></i>
              </button>
              <button class="mini-card-btn publish" type="button" onclick="event.stopPropagation();${isPublished ? '' : `cardForgeActions.publishCard('${card.id}')`}" title="${isPublished ? 'Published' : 'Publish'}" ${isPublished ? 'disabled style="opacity:0.4"' : ''}>
                <i class="fas fa-${isPublished ? 'check-circle' : 'share'}"></i>
              </button>
              <button class="mini-card-btn deck-add" type="button" onclick="event.stopPropagation();cardForgeActions.showAddToDeckPicker('${card.id}', this.closest('.mini-card'))" title="Add to Deck">
                <i class="fas fa-folder-plus"></i>
              </button>
              <button class="mini-card-btn delete" type="button" onclick="event.stopPropagation();window.deleteCard('${card.id}')" title="Delete">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Height handled by CSS: .mini-card { height: 252px } + .card-preview-canvas { height: 504px }
    this.updateSidebarIndicators();
  }

  refreshDeckList() {
    console.log('🗂️ Refreshing deck list...');
    const deckListEl = document.getElementById('deck-list');
    if (!deckListEl) return;

    // Clean up orphaned cardIds before rendering
    this.cleanupDeckCardIds();

    const decks = this.getSavedDecks();

    if (!decks || decks.length === 0) {
      deckListEl.innerHTML = `
        <div class="deck-empty">
          <i class="fas fa-th-large"></i>
          <p>No decks yet</p>
          <small>Create your first deck to see it here</small>
        </div>
      `;
      // Clear detail panel
      const detailEl = document.getElementById('deck-detail');
      if (detailEl) {
        detailEl.innerHTML = `
          <div class="deck-detail-empty">
            <i class="fas fa-folder-open"></i>
            <p>No decks yet</p>
            <small>Create a new deck to get started</small>
          </div>
        `;
      }
      this._selectedDeckId = null;
      return;
    }

    // Render deck list items
    deckListEl.innerHTML = decks.map(deck => {
      const count = deck.cardIds ? deck.cardIds.length : 0;
      const isSelected = deck.id === this._selectedDeckId;
      const deckIcon = deck.icon || DEFAULT_DECK_ICON;
      const hasDeckImg = deck.deckImage && deck.deckImage.trim();
      const visualHTML = hasDeckImg
        ? `<div class="deck-list-item-img"><img src="${deck.deckImage}" alt="" onerror="this.parentNode.innerHTML='<i class=\\'${deckIcon}\\'></i>'" /></div>`
        : `<i class="deck-list-item-icon ${deckIcon}"></i>`;
      return `
        <div class="deck-list-item${isSelected ? ' active' : ''}" data-deck-id="${deck.id}"
             onclick="cardForgeActions.selectDeck('${deck.id}')">
          ${visualHTML}
          <div class="deck-list-item-info">
            <span class="deck-list-item-name">${deck.name}</span>
            <span class="deck-list-item-count">${count} card${count !== 1 ? 's' : ''}${deck.shareId ? ' · <span class="deck-list-pub-dot" title="Published"></span>' : ''}</span>
          </div>
          <div class="deck-list-item-actions">
            <button type="button" class="deck-item-btn" title="Rename"
                    onclick="event.stopPropagation();cardForgeActions.renameDeck('${deck.id}')">
              <i class="fas fa-pen"></i>
            </button>
            <button type="button" class="deck-item-btn delete" title="Delete"
                    onclick="event.stopPropagation();cardForgeActions.deleteDeck('${deck.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Auto-select first deck if none selected, or re-select current
    if (!this._selectedDeckId || !decks.find(d => d.id === this._selectedDeckId)) {
      this._selectedDeckId = decks[0].id;
    }
    this.renderDeckDetail(this._selectedDeckId);
    this.updateSidebarIndicators();
  }

  // Public Gallery - shows published cards from all users
  async refreshGallery() {
    console.log('🌐 Refreshing public gallery...');
    const galleryGrid = document.getElementById('gallery-cards-grid');
    if (!galleryGrid) return;

    try {
      const loadUrl = window.buildApiPath('loadCards');
      const resp = await fetch(loadUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!resp.ok) {
        throw new Error(`Failed to load gallery: ${resp.status}`);
      }
      
      const data = await resp.json();
      const galleryCards = Array.isArray(data?.galleryCards) ? data.galleryCards : [];
      
      console.log(`🌐 Loaded ${galleryCards.length} published cards for gallery`);
      this._galleryCards = galleryCards;
      
      if (galleryCards.length === 0) {
        galleryGrid.innerHTML = `
          <div class="gallery-empty">
            <i class="fas fa-images"></i>
            <p>No published cards yet</p>
            <small>Be the first to publish a card to the gallery!</small>
          </div>
        `;
        return;
      }
      
      // Determine current user for owner/admin checks
      const currentUserId = (() => {
        try { return JSON.parse(sessionStorage.getItem('userInfo') || '{}').userId || null; } catch { return null; }
      })();
      const adminIds = window._config?.adminUserIds || [];
      const isAdmin = currentUserId && adminIds.includes(currentUserId);

      // Render mini cards for gallery — half-size replicas using zoom
      const fallbackSvg = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYwIiBoZWlnaHQ9IjUwNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzAwZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
      galleryGrid.innerHTML = galleryCards.map(card => {
        const cd = card.cardData || card;
        const cardName = cd.name || card.name || 'Untitled Card';
        const characterClass = cd.characterClass || card.characterClass || '';
        const cardImage = cd.avatar || card.avatar || card.image || '';
        const publishedBy = card.publishedBy || card.userId || 'Anonymous';
        const canRemove = isAdmin || (currentUserId && publishedBy === currentUserId);
        const hasRendered = cd.renderedFront && cd.frontClasses;

        let contentHTML;
        if (hasRendered) {
          contentHTML = `<div class="mini-card-scaler"><div class="${cd.frontClasses}">${cd.renderedFront}</div></div>`;
        } else {
          contentHTML = `<img class="mini-card-fallback" src="${cardImage || fallbackSvg}" alt="${cardName}" onerror="this.src='${fallbackSvg}'">`;
        }

        return `
          <div class="mini-card" data-card-id="${card.id}">
            ${contentHTML}
            <div class="mini-card-label">
              ${cardName}
              ${characterClass ? `<span class="mini-card-class">${characterClass}</span>` : ''}
            </div>
            ${canRemove ? `
            <div class="mini-card-overlay">
              <div class="mini-card-actions">
                <button class="mini-card-btn remove" type="button" onclick="event.stopPropagation();cardForgeActions.removeFromGallery('${card.id}')" title="Remove from Gallery">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>` : ''}
          </div>
        `;
      }).join('');

      // Height handled by CSS: .mini-card { height: 252px } + .card-preview-canvas { height: 504px }

      // Bind gallery mini-card clicks to open lightbox
      galleryGrid.querySelectorAll('.mini-card').forEach((item, idx) => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.mini-card-btn')) return;
          if (window.CardForgeLightbox) {
            window.CardForgeLightbox.open(galleryCards, idx);
          }
        });
      });
      
    } catch (e) {
      console.error('❌ Failed to load gallery:', e);
      galleryGrid.innerHTML = `
        <div class="gallery-error">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Failed to load gallery</p>
          <small>${e.message}</small>
        </div>
      `;
    }
  }

  // Published Decks — gallery section
  async refreshGalleryDecks() {
    console.log('🌐 Refreshing gallery decks...');
    const grid = document.getElementById('gallery-decks-grid');
    if (!grid) return;

    try {
      const url = window.buildApiPath('deckLoad');
      const resp = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });

      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const data = await resp.json();
      const decks = Array.isArray(data?.publishedDecks) ? data.publishedDecks : [];

      console.log(`🌐 Loaded ${decks.length} published decks`);

      if (decks.length === 0) {
        grid.innerHTML = `
          <div class="gallery-empty">
            <i class="fas fa-layer-group"></i>
            <p>No published decks yet</p>
            <small>Publish a deck from the Deck Manager to see it here!</small>
          </div>`;
        return;
      }

      this._galleryDecks = decks;

      // Admin/owner check for delete button
      const currentUserId = (() => {
        try { return JSON.parse(sessionStorage.getItem('userInfo') || '{}').userId || null; } catch { return null; }
      })();
      const adminIds = window._config?.adminUserIds || [];
      const isAdmin = currentUserId && adminIds.includes(currentUserId);

      grid.innerHTML = decks.map(d => {
        const icon = d.icon || 'fas fa-layer-group';
        const tags = (d.tags || []).slice(0, 3).map(t =>
          '<span class="gallery-deck-tag">' + t + '</span>'
        ).join('');
        const hasImage = d.deckImage && d.deckImage.trim();
        const visualHTML = hasImage
          ? `<div class="gallery-deck-tile-img"><img src="${d.deckImage}" alt="${d.name}" onerror="this.parentNode.innerHTML='<i class=\\'${icon}\\'></i>'" /></div>`
          : `<div class="gallery-deck-tile-icon"><i class="${icon}"></i></div>`;
        const canDelete = isAdmin || (currentUserId && d.userId === currentUserId);
        const deleteBtn = canDelete
          ? `<button type="button" class="gallery-deck-delete-btn" onclick="event.stopPropagation();cardForgeActions.removeGalleryDeck('${d.shareId}')" title="Delete from Gallery"><i class="fas fa-trash"></i></button>`
          : '';
        return `
          <div class="gallery-deck-tile" data-share-id="${d.shareId}" onclick="cardForgeActions.showDeckModal('${d.shareId}')" style="cursor:pointer" title="${d.name}">
            ${visualHTML}
            <div class="gallery-deck-tile-info">
              <div class="gallery-deck-tile-name">${d.name}</div>
              <div class="gallery-deck-tile-meta">${d.cardCount || 0} card${(d.cardCount || 0) !== 1 ? 's' : ''}</div>
              ${tags ? '<div class="gallery-deck-tile-tags">' + tags + '</div>' : ''}
            </div>
            ${deleteBtn}
          </div>`;
      }).join('');

    } catch (e) {
      console.warn('⚠️ Could not load gallery decks:', e);
      grid.innerHTML = `
        <div class="gallery-empty">
          <i class="fas fa-layer-group"></i>
          <p>Decks coming soon</p>
        </div>`;
    }
  }

  // Show a modal for a published deck (gallery click)
  async showDeckModal(shareId) {
    // Create or reuse full-screen deck viewer overlay
    let overlay = document.getElementById('deck-viewer-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'deck-viewer-overlay';
      overlay.className = 'deck-viewer-overlay';
      document.body.appendChild(overlay);
    }

    // Show loading state
    overlay.innerHTML =
      '<div class="deck-viewer-loading"><i class="fas fa-spinner fa-spin"></i> Loading deck...</div>';
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    const closeDeckViewer = () => {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', deckKeyHandler);
    };

    // Keyboard handler
    let carouselIndex = 0;
    let totalCards = 0;
    const VISIBLE = 3;
    const updateCarousel = () => {
      const track = overlay.querySelector('.deck-viewer-track');
      const counter = overlay.querySelector('.deck-viewer-counter');
      const prevBtn = overlay.querySelector('.deck-viewer-prev');
      const nextBtn = overlay.querySelector('.deck-viewer-next');
      if (track) {
        const firstCard = track.querySelector('.deck-viewer-card');
        const cardStep = firstCard ? (firstCard.offsetWidth + 16) : 416;
        track.style.transform = 'translateX(-' + (carouselIndex * cardStep) + 'px)';
      }
      if (counter) {
        const endIdx = Math.min(carouselIndex + VISIBLE, totalCards);
        counter.textContent = (carouselIndex + 1) + '–' + endIdx + ' of ' + totalCards;
      }
      if (prevBtn) prevBtn.disabled = carouselIndex <= 0;
      if (nextBtn) nextBtn.disabled = carouselIndex + VISIBLE >= totalCards;
    };

    const deckKeyHandler = (e) => {
      if (!overlay.classList.contains('active')) return;
      if (e.key === 'Escape') closeDeckViewer();
      if (e.key === 'ArrowLeft' && carouselIndex > 0) { carouselIndex--; updateCarousel(); }
      if (e.key === 'ArrowRight' && carouselIndex + VISIBLE < totalCards) { carouselIndex++; updateCarousel(); }
    };
    document.addEventListener('keydown', deckKeyHandler);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDeckViewer();
    }, { once: true });

    try {
      const url = window.buildApiPath('deckLoad', { shareId });
      const resp = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const deck = await resp.json();

      const icon = deck.icon || 'fas fa-layer-group';
      const cards = deck.cards || [];
      totalCards = cards.length;
      const tags = (deck.tags || []).map(t => '<span class="gallery-deck-tag">' + t + '</span>').join('');
      const hasImage = deck.deckImage && deck.deckImage.trim();
      const shareUrl = window.buildApiPath('deckShare', { deck: shareId });

      // Admin/owner check
      const modalUserId = (() => {
        try { return JSON.parse(sessionStorage.getItem('userInfo') || '{}').userId || null; } catch { return null; }
      })();
      const modalAdminIds = window._config?.adminUserIds || [];
      const modalIsAdmin = modalUserId && modalAdminIds.includes(modalUserId);
      const modalCanDelete = modalIsAdmin || (modalUserId && deck.publishedBy === modalUserId);

      // Fallback SVG for cards without rendered HTML
      const fallbackSvg = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYwIiBoZWlnaHQ9IjUwNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzAwZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';

      // Enrich cards from localStorage — same pattern as lightbox enrichFromLocal()
      let savedCardsCache = null;
      try { savedCardsCache = JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]'); } catch (e) { savedCardsCache = []; }

      const enrichedCards = cards.map(c => {
        // If API card already has rendered HTML, use it directly
        if (c.renderedFront && c.frontClasses) return c;
        // Try to resolve from localStorage using cardId
        const localMatch = savedCardsCache.find(s => s.id === c.cardId);
        if (localMatch && localMatch.cardData && localMatch.cardData.renderedFront) {
          return Object.assign({}, c, {
            renderedFront: localMatch.cardData.renderedFront,
            frontClasses: localMatch.cardData.frontClasses,
            renderedBack: localMatch.cardData.renderedBack || '',
            backClasses: localMatch.cardData.backClasses || ''
          });
        }
        return c;
      });

      // Render each card using the SAME structure as the lightbox
      const cardsTrackHTML = enrichedCards.map(c => {
        let cardInner = '';
        let flipBtn = '';
        if (c.renderedFront && c.frontClasses) {
          const frontCls = c.frontClasses;
          const backCls = c.backClasses || c.frontClasses;
          cardInner =
            '<div class="card-preview-canvas">' +
              '<div class="card-inner">' +
                '<div class="' + frontCls + '">' + c.renderedFront + '</div>' +
                '<div class="' + backCls + '">' + (c.renderedBack || '') + '</div>' +
              '</div>' +
            '</div>';
          flipBtn = '<button class="deck-viewer-card-flip" title="Flip Card"><i class="fas fa-sync-alt"></i></button>';
        } else {
          const img = c.preview || c.avatar || fallbackSvg;
          cardInner =
            '<div class="card-preview-canvas deck-viewer-fallback-card">' +
              '<img src="' + img + '" alt="' + (c.name || '') + '" onerror="this.src=\'' + fallbackSvg + '\'" />' +
            '</div>';
        }
        return '<div class="deck-viewer-card">' + flipBtn + cardInner +
          '<div class="deck-viewer-card-label">' + (c.name || 'Untitled') + '</div></div>';
      }).join('');

      // Build the full overlay content
      overlay.innerHTML =
        '<div class="deck-viewer-inner">' +
          '<button class="deck-viewer-close" title="Close (Esc)"><i class="fas fa-times"></i></button>' +
          // Header
          '<div class="deck-viewer-header">' +
            (hasImage ? '<div class="deck-viewer-cover"><img src="' + deck.deckImage + '" alt="" /></div>' : '') +
            '<div class="deck-viewer-info">' +
              '<h2 class="deck-viewer-title"><i class="' + icon + '"></i> ' + deck.name + '</h2>' +
              (deck.description ? '<p class="deck-viewer-desc">' + deck.description + '</p>' : '') +
              (tags ? '<div class="deck-viewer-tags">' + tags + '</div>' : '') +
              '<div class="deck-viewer-meta">' + cards.length + ' card' + (cards.length !== 1 ? 's' : '') + '</div>' +
            '</div>' +
          '</div>' +
          // Carousel
          (cards.length > 0
            ? '<div class="deck-viewer-carousel">' +
                '<button class="deck-viewer-nav deck-viewer-prev" title="Previous (←)"' + (carouselIndex <= 0 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i></button>' +
                '<div class="deck-viewer-viewport">' +
                  '<div class="deck-viewer-track">' + cardsTrackHTML + '</div>' +
                '</div>' +
                '<button class="deck-viewer-nav deck-viewer-next" title="Next (→)"' + (carouselIndex + VISIBLE >= totalCards ? ' disabled' : '') + '><i class="fas fa-chevron-right"></i></button>' +
              '</div>' +
              '<div class="deck-viewer-counter">' + (carouselIndex + 1) + '–' + Math.min(VISIBLE, totalCards) + ' of ' + totalCards + '</div>'
            : '<p style="text-align:center;color:#6a6a8a;padding:2rem;">No cards in this deck.</p>') +
          // Actions
          '<div class="deck-viewer-actions">' +
            '<button type="button" class="deck-publish-action-btn" id="dv-copy-link"><i class="fas fa-share-alt"></i> Share</button>' +
            '<button type="button" class="deck-publish-action-btn" id="dv-save-deck"><i class="fas fa-download"></i> Save to My Decks</button>' +
            (modalCanDelete ? '<button type="button" class="deck-publish-action-btn deck-modal-delete-btn" id="dv-delete-deck"><i class="fas fa-trash"></i> Delete</button>' : '') +
          '</div>' +
        '</div>';

      // Bind events
      overlay.querySelector('.deck-viewer-close').addEventListener('click', closeDeckViewer);

      const prevBtn = overlay.querySelector('.deck-viewer-prev');
      const nextBtn = overlay.querySelector('.deck-viewer-next');
      if (prevBtn) prevBtn.addEventListener('click', () => { if (carouselIndex > 0) { carouselIndex--; updateCarousel(); } });
      if (nextBtn) nextBtn.addEventListener('click', () => { if (carouselIndex + VISIBLE < totalCards) { carouselIndex++; updateCarousel(); } });

      const copyBtn = overlay.querySelector('#dv-copy-link');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(shareUrl);
          copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
          setTimeout(() => { copyBtn.innerHTML = '<i class="fas fa-share-alt"></i> Share'; }, 2000);
        });
      }

      const saveBtn = overlay.querySelector('#dv-save-deck');
      if (saveBtn) saveBtn.addEventListener('click', () => this.saveDeckFromGallery(shareId));

      const deleteBtn = overlay.querySelector('#dv-delete-deck');
      if (deleteBtn) deleteBtn.addEventListener('click', () => { closeDeckViewer(); this.removeGalleryDeck(shareId); });

      // Bind flip buttons on each card
      overlay.querySelectorAll('.deck-viewer-card-flip').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const card = btn.closest('.deck-viewer-card');
          const inner = card && card.querySelector('.card-inner');
          if (inner) inner.classList.toggle('flipped');
        });
      });

    } catch (e) {
      console.error('[CardForge] Deck modal load error:', e);
      overlay.innerHTML =
        '<div class="deck-viewer-inner">' +
          '<button class="deck-viewer-close" title="Close"><i class="fas fa-times"></i></button>' +
          '<p style="text-align:center;color:#ff6b6b;padding:2rem;">Could not load deck: ' + e.message + '</p>' +
        '</div>';
      overlay.querySelector('.deck-viewer-close').addEventListener('click', closeDeckViewer);
    }
  }

  // Delete a published deck from the gallery
  async removeGalleryDeck(shareId) {
    const doRemove = async () => {
      try {
        const deleteUrl = window.buildApiPath('deckDelete');
        const deleteUserId = (() => {
          try { return JSON.parse(sessionStorage.getItem('userInfo') || '{}').userId || 'anonymous'; }
          catch { return 'anonymous'; }
        })();
        const resp = await fetch(deleteUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shareId, userId: deleteUserId }),
          credentials: 'include'
        });
        if (resp.ok) {
          this.showNotification('Deck removed from gallery', 'success');
          // Close modal if open
          const dialog = document.getElementById('cardforge-dialog');
          if (dialog && dialog.classList.contains('active')) dialog.classList.remove('active');
          this.refreshGalleryDecks();
        } else {
          const errData = await resp.json().catch(() => ({}));
          this.showNotification(errData.error || 'Failed to remove deck', 'error');
        }
      } catch (e) {
        console.error('Remove gallery deck failed:', e);
        this.showNotification('Failed to remove deck', 'error');
      }
    };
    const dialogFn = (window.UIUtils && window.UIUtils.showConfirmDialog) || null;
    if (dialogFn) {
      dialogFn('Remove Deck from Gallery', 'Are you sure you want to remove this deck from the public gallery? This cannot be undone.', doRemove, null, { confirmLabel: 'Remove' });
    } else if (confirm('Remove this deck from the gallery?')) {
      doRemove();
    }
  }

  // Save a published deck to local My Decks (from gallery modal)
  saveDeckFromGallery(shareId) {
    try {
      const existing = JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
      const dup = existing.find(d => d.shareId === shareId);
      if (dup) { this.showNotification('This deck is already in your collection', 'info'); return; }

      // Find deck data from cached gallery decks
      const galleryDeck = (this._galleryDecks || []).find(d => d.shareId === shareId);
      if (!galleryDeck) { this.showNotification('Deck data not available', 'error'); return; }

      const newDeck = {
        id: 'deck_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: galleryDeck.name,
        icon: galleryDeck.icon || DEFAULT_DECK_ICON,
        description: galleryDeck.description || '',
        tags: (galleryDeck.tags || []).join(', '),
        deckImage: galleryDeck.deckImage || '',
        cardIds: [],
        shareId: shareId,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      };

      existing.push(newDeck);
      localStorage.setItem('cardforge_decks', JSON.stringify(existing));
      this.showNotification('Deck saved! Open Deck Manager to view it.', 'success');
      this.refreshDeckList();
    } catch (e) {
      console.error('[CardForge] Save deck from gallery error:', e);
      this.showNotification('Error saving deck', 'error');
    }
  }

  // Remove a card from the public gallery (published-cards.json)
  async removeFromGallery(cardId) {
    const doRemove = async () => {
      try {
        const deleteUrl = window.buildApiPath('deleteCard');
        const resp = await fetch(deleteUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cardId })
        });
        if (resp.ok) {
          this.showNotification('Card removed from gallery', 'success');
          this.refreshGallery();
          this.refreshMyCardsList();
        } else {
          this.showNotification('Failed to remove card', 'error');
        }
      } catch (e) {
        console.error('Remove from gallery failed:', e);
        this.showNotification('Failed to remove card', 'error');
      }
    };
    const dialogFn = (window.UIUtils && window.UIUtils.showConfirmDialog) || null;
    if (dialogFn) {
      dialogFn('Remove from Gallery', 'Are you sure you want to remove this card from the public gallery? This cannot be undone.', doRemove);
    } else if (confirm('Remove this card from the gallery?')) {
      doRemove();
    }
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
      // If this card is published, re-enable its Publish button so user can re-publish after edits
      const publishBtn = document.querySelector(`.card-gallery-item[data-card-id="${card.id}"] .card-action-btn.publish`);
      if (publishBtn && publishBtn.disabled) {
        publishBtn.disabled = false;
        publishBtn.classList.remove('published-disabled');
        publishBtn.innerHTML = '<i class="fas fa-share"></i> Publish';
        publishBtn.title = 'Publish Card';
        publishBtn.setAttribute('onclick', `cardForgeActions.publishCard('${card.id}')`);
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
        // Clear card-id immediately — publishCard() already captured it
        if (idField) idField.value = '';
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

// ===================
// DECK MANAGER — full implementation
// ===================

CardForgeActions.prototype.isAuthenticated = function() {
  return (sessionStorage.getItem('isAuthenticated') === 'true') ||
         (document.body?.getAttribute('data-auth-state') === 'signed-in');
};

CardForgeActions.prototype.requireAuth = function(action) {
  // Bypass auth check on localhost for dev/testing
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal) return true;

  if (!this.isAuthenticated()) {
    this.showNotification(`Sign in to ${action}`, 'error');
    return false;
  }
  return true;
};

CardForgeActions.prototype._selectedDeckId = null;

CardForgeActions.prototype.selectDeck = function(deckId) {
  this._selectedDeckId = deckId;
  // Update sidebar active state
  const items = document.querySelectorAll('#deck-list .deck-list-item');
  items.forEach(el => {
    el.classList.toggle('active', el.dataset.deckId === deckId);
  });
  this.renderDeckDetail(deckId);
};

CardForgeActions.prototype.renderDeckDetail = function(deckId) {
  const detailEl = document.getElementById('deck-detail');
  if (!detailEl) return;

  const decks = this.getSavedDecks();
  const deck = decks.find(d => d.id === deckId);
  if (!deck) {
    detailEl.innerHTML = `
      <div class="deck-detail-empty">
        <i class="fas fa-folder-open"></i>
        <p>Select a deck</p>
        <small>Choose a deck from the list or create a new one</small>
      </div>`;
    return;
  }

  const savedCards = this.getSavedCards();
  const cardsInDeck = deck.cardIds
    .map(id => savedCards.find(c => c.id === id))
    .filter(Boolean);
  const count = cardsInDeck.length;

  const fallbackSvg = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYwIiBoZWlnaHQ9IjUwNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzAwZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';

  let gridHTML = '';
  if (count === 0) {
    gridHTML = `
      <div class="deck-cards-empty">
        <i class="fas fa-inbox"></i>
        <p>This deck is empty</p>
        <small>Go to My Cards and add cards to this deck</small>
      </div>`;
  } else {
    gridHTML = `<div class="deck-cards-grid">` + cardsInDeck.map(card => {
      const cd = card.cardData || card;
      const cardName = cd.name || card.name || 'Untitled Card';
      const characterClass = cd.characterClass || '';
      const cardImage = cd.avatar || card.avatar || '';
      const hasRendered = cd.renderedFront && cd.frontClasses;

      let contentHTML;
      if (hasRendered) {
        contentHTML = `<div class="mini-card-scaler"><div class="${cd.frontClasses}">${cd.renderedFront}</div></div>`;
      } else {
        contentHTML = `<img class="mini-card-fallback" src="${cardImage || fallbackSvg}" alt="${cardName}" onerror="this.src='${fallbackSvg}'">`;
      }

      return `
        <div class="mini-card" data-card-id="${card.id}" onclick="cardForgeActions.loadCard('${card.id}')" style="cursor:pointer">
          ${contentHTML}
          <div class="mini-card-label">
            ${cardName}
            ${characterClass ? `<span class="mini-card-class">${characterClass}</span>` : ''}
          </div>
          <div class="mini-card-overlay">
            <div class="mini-card-actions">
              <button class="mini-card-btn remove" type="button"
                      onclick="event.stopPropagation();cardForgeActions.removeCardFromDeck('${card.id}','${deckId}')" title="Remove from Deck">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        </div>`;
    }).join('') + `</div>`;
  }

  const deckIcon = deck.icon || DEFAULT_DECK_ICON;
  detailEl.innerHTML = `
    <div class="deck-detail-header">
      <div class="deck-detail-title">
        <i class="${deckIcon}"></i>
        <span>${deck.name}</span>
      </div>
      <div class="deck-detail-meta-row">
        <span class="deck-detail-count">${count} card${count !== 1 ? 's' : ''}</span>
        <div class="deck-detail-actions">
          <button type="button" class="deck-publish-btn${deck.shareId ? ' published' : ''}" title="${count === 0 ? 'Add cards to publish' : deck.shareId ? 'Published · Visible in the public gallery' : 'Publish Deck'}"
                  ${count === 0 || deck.shareId ? 'disabled aria-disabled="true"' : ''}
                  onclick="cardForgeActions.publishDeck('${deckId}')">
            <i class="fas fa-${deck.shareId ? 'check-circle' : 'share-from-square'}"></i> ${deck.shareId ? 'Published' : 'Publish'}
          </button>
          <button type="button" class="deck-item-btn" title="Rename Deck"
                  onclick="cardForgeActions.renameDeck('${deckId}')">
            <i class="fas fa-pen"></i>
          </button>
          <button type="button" class="deck-item-btn delete" title="Delete Deck"
                  onclick="cardForgeActions.deleteDeck('${deckId}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
    ${gridHTML}`;
};

CardForgeActions.prototype.renameDeck = function(deckId) {
  if (!this.requireAuth('manage decks')) return;
  const decks = this.getSavedDecks();
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  this._showDeckFormDialog({
    title: 'Edit Deck',
    confirmLabel: 'Save',
    defaults: {
      name: deck.name,
      icon: deck.icon || DEFAULT_DECK_ICON,
      description: deck.description || '',
      tags: deck.tags || '',
      deckImage: deck.deckImage || ''
    }
  }, (formData) => {
    deck.name = formData.name;
    deck.icon = formData.icon || deck.icon;
    deck.description = formData.description || '';
    deck.tags = formData.tags || '';
    deck.deckImage = formData.deckImage || '';
    deck.lastModified = new Date().toISOString();
    localStorage.setItem('cardforge_decks', JSON.stringify(decks));
    this.showNotification(`Deck updated: "${deck.name}"`, 'success');
    this.refreshDeckList();
  });
};

CardForgeActions.prototype.deleteDeck = function(deckId) {
  if (!this.requireAuth('manage decks')) return;
  const decks = this.getSavedDecks();
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  const self = this;
  const isPublished = !!deck.shareId;

  const doDelete = async () => {
    // If published, also remove from the public gallery
    if (isPublished) {
      try {
        const deleteUrl = window.buildApiPath('deckDelete');
        const deleteUserId = (() => {
          try { return JSON.parse(sessionStorage.getItem('userInfo') || '{}').userId || 'anonymous'; }
          catch { return 'anonymous'; }
        })();
        await fetch(deleteUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shareId: deck.shareId, userId: deleteUserId }),
          credentials: 'include'
        });
        self.refreshGalleryDecks();
      } catch (e) {
        console.warn('[CardForge] Could not remove published deck from gallery:', e);
      }
    }

    const updated = decks.filter(d => d.id !== deckId);
    localStorage.setItem('cardforge_decks', JSON.stringify(updated));
    if (self._selectedDeckId === deckId) {
      self._selectedDeckId = updated.length > 0 ? updated[0].id : null;
    }
    self.showNotification(`Deck "${deck.name}" deleted`, 'success');
    self.refreshDeckList();
  };

  const confirmMsg = isPublished
    ? `Delete "${deck.name}"? This will also remove it from the published gallery.\nCards in your My Cards collection will not be deleted.`
    : `Delete "${deck.name}"?\nCards in your My Cards collection will not be deleted.`;

  const dialogFn = (window.UIUtils && window.UIUtils.showConfirmDialog) || (typeof showConfirmDialog === 'function' ? showConfirmDialog : null);
  if (dialogFn) {
    dialogFn('Delete Deck', confirmMsg, doDelete, null, { confirmLabel: 'Delete' });
  } else {
    if (confirm(confirmMsg)) {
      doDelete();
    }
  }
};

CardForgeActions.prototype.publishDeck = function(deckId) {
  if (!this.requireAuth('publish a deck')) return;

  const decks = this.getSavedDecks();
  const deck = decks.find(d => d.id === deckId);
  if (!deck) { this.showNotification('Deck not found', 'error'); return; }

  const savedCards = this.getSavedCards();
  const cardsInDeck = (deck.cardIds || []).map(id => savedCards.find(c => c.id === id)).filter(Boolean);

  if (cardsInDeck.length === 0) {
    this.showNotification('Add at least one card before publishing', 'info');
    return;
  }

  const deckIcon = deck.icon || DEFAULT_DECK_ICON;
  const deckName = deck.name || 'Untitled Deck';
  const cardCount = cardsInDeck.length;
  const self = this;

  // Simple confirm dialog — same pattern as card publish
  const dialogFn = (window.UIUtils && window.UIUtils.showConfirmDialog) || null;
  const confirmMsg = 'Do you want to publish "' + deckName + '" (' + cardCount + ' card' + (cardCount !== 1 ? 's' : '') + ') to the public gallery? Published decks will be visible to everyone.';

  const doPublish = async () => {
    self.showNotification('Publishing deck...', 'info');

    try {
      const userId = (() => {
        try { return JSON.parse(sessionStorage.getItem('userInfo') || '{}').userId || 'anonymous'; }
        catch { return 'anonymous'; }
      })();

      const cards = cardsInDeck.map(c => {
        const cd = c.cardData || c;
        return {
          cardId: c.id,
          name: cd.name || c.name || 'Untitled',
          preview: cd.avatar || c.avatar || null,
          renderedFront: cd.renderedFront || null,
          frontClasses: cd.frontClasses || null,
          renderedBack: cd.renderedBack || null,
          backClasses: cd.backClasses || null,
          characterClass: cd.characterClass || '',
          rarity: cd.rarity || '',
          avatar: cd.avatar || c.avatar || '',
          quote: cd.quote || '',
          stats: cd.stats || [],
          badges: cd.badges || [],
          design: cd.design || null
        };
      });

      const tagsList = (deck.tags || '').split(',').map(t => t.trim()).filter(Boolean);

      const endpoint = window.buildApiPath('deckPublish');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.csrfProtection?.getToken?.() || '',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          deckId: deck.id,
          name: deckName,
          icon: deckIcon,
          deckImage: deck.deckImage || '',
          description: deck.description || '',
          tags: tagsList,
          visibility: 'unlisted',
          createdAt: deck.createdAt,
          cards,
          userId
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'HTTP ' + response.status);
      }

      const result = await response.json();
      const shareId = result.shareId;
      const shareUrl = window.buildApiPath('deckShare', { deck: shareId });

      // Store shareId on the deck for republish stability
      deck.shareId = shareId;
      deck.lastModified = new Date().toISOString();
      localStorage.setItem('cardforge_decks', JSON.stringify(decks));

      // Refresh gallery decks section
      setTimeout(() => { self.refreshGalleryDecks(); }, 500);

      // Show success modal — same style as card publish
      if (typeof Modal === 'function') {
        const successModal = new Modal({
          title: 'Published!',
          size: 'small',
          tabs: [{
            title: 'Success',
            icon: '<i class="fas fa-check-circle"></i>',
            content: '<div style="text-align:center;padding:20px;">' +
              '<div style="color:#00ff88;font-size:64px;margin-bottom:16px;"><i class="fas fa-check-circle"></i></div>' +
              '<h3 style="margin-bottom:12px;color:#fff;font-size:1.4em;">' + deckName + '</h3>' +
              '<p style="margin-bottom:8px;color:#00ff88;font-size:1.1em;">Successfully published to the gallery!</p>' +
              '<p style="margin-bottom:16px;color:#aaa;">' + cardCount + ' card' + (cardCount !== 1 ? 's' : '') + ' · Visible to everyone</p>' +
              '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:20px;">' +
                '<input type="text" id="deck-share-url" value="' + shareUrl + '" readonly style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;color:#e1e1ff;font-size:0.8em;min-width:0;" />' +
                '<button id="deck-copy-link" class="deck-publish-action-btn" style="flex-shrink:0;"><i class="fas fa-copy"></i></button>' +
                '<button id="deck-open-link" class="deck-publish-action-btn" style="flex-shrink:0;" title="View Deck"><i class="fas fa-eye"></i></button>' +
              '</div>' +
              '<button id="deck-publish-ok-btn" class="btn-primary" style="background:linear-gradient(135deg,#00ff88,#00cc6a);border:none;color:#000;padding:12px 32px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:1em;">' +
                '<i class="fas fa-thumbs-up"></i> Awesome!' +
              '</button>' +
            '</div>'
          }]
        });
        successModal.show();

        setTimeout(() => {
          const okBtn = document.getElementById('deck-publish-ok-btn');
          if (okBtn) okBtn.addEventListener('click', () => successModal.hide());
          const copyBtn = document.getElementById('deck-copy-link');
          if (copyBtn) {
            copyBtn.addEventListener('click', () => {
              const urlInput = document.getElementById('deck-share-url');
              if (urlInput) navigator.clipboard.writeText(urlInput.value);
              copyBtn.innerHTML = '<i class="fas fa-check"></i>';
              setTimeout(() => { copyBtn.innerHTML = '<i class="fas fa-copy"></i>'; }, 2000);
            });
          }
          const openBtn = document.getElementById('deck-open-link');
          if (openBtn) {
            openBtn.addEventListener('click', () => {
              successModal.hide();
              try {
                self.showDeckModal(shareId);
              } catch (err) {
                console.error('[CardForge] Could not open deck modal:', err);
                self.showNotification('Could not open deck viewer — opening in new tab', 'info');
                window.open(shareUrl, '_blank');
              }
            });
          }
        }, 100);
      } else {
        self.showNotification('Deck published! Link: ' + shareUrl, 'success');
      }

    } catch (error) {
      console.error('[CardForge] Deck publish error:', error);
      self.showNotification('Error publishing deck: ' + error.message, 'error');
    }
  };

  if (dialogFn) {
    dialogFn('Publish Deck', confirmMsg, doPublish);
  } else if (confirm(confirmMsg)) {
    doPublish();
  }
};

CardForgeActions.prototype.addCardToDeck = function(cardId, deckId) {
  if (!this.requireAuth('manage decks')) return;
  if (!deckId) {
    deckId = this._selectedDeckId;
  }
  if (!deckId) {
    this.showNotification('No deck selected', 'error');
    return;
  }

  const decks = this.getSavedDecks();
  const deck = decks.find(d => d.id === deckId);
  if (!deck) {
    this.showNotification('Deck not found', 'error');
    return;
  }

  if (deck.cardIds.includes(cardId)) {
    this.showNotification(`Card is already in "${deck.name}"`, 'info');
    return;
  }

  deck.cardIds.push(cardId);
  deck.lastModified = new Date().toISOString();
  localStorage.setItem('cardforge_decks', JSON.stringify(decks));
  this.showNotification(`Card added to "${deck.name}"`, 'success');
  this.refreshDeckList();
};

CardForgeActions.prototype.removeCardFromDeck = function(cardId, deckId) {
  if (!this.requireAuth('manage decks')) return;
  const decks = this.getSavedDecks();
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  deck.cardIds = deck.cardIds.filter(id => id !== cardId);
  deck.lastModified = new Date().toISOString();
  localStorage.setItem('cardforge_decks', JSON.stringify(decks));
  this.showNotification('Card removed from deck', 'success');
  this.refreshDeckList();
};

CardForgeActions.prototype.cleanupDeckCardIds = function() {
  const decks = this.getSavedDecks();
  if (!decks || decks.length === 0) return;

  const savedCards = this.getSavedCards();
  const validIds = new Set(savedCards.map(c => c.id));
  let changed = false;

  decks.forEach(deck => {
    const before = deck.cardIds.length;
    deck.cardIds = deck.cardIds.filter(id => validIds.has(id));
    if (deck.cardIds.length !== before) changed = true;
  });

  if (changed) {
    localStorage.setItem('cardforge_decks', JSON.stringify(decks));
    console.log('🧹 Cleaned up orphaned cardIds from decks');
  }
};

CardForgeActions.prototype.getSelectedDeckId = function() {
  return this._selectedDeckId;
};

CardForgeActions.prototype.updateSidebarIndicators = function() {
  const cards = this.getSavedCards();
  const decks = this.getSavedDecks();
  const cardCount = cards ? cards.length : 0;
  const deckCount = decks ? decks.length : 0;

  // Badge pills
  const cardBadge = document.getElementById('my-cards-count');
  if (cardBadge) {
    cardBadge.textContent = cardCount;
    cardBadge.style.display = cardCount > 0 ? 'inline-block' : 'none';
  }
  const deckBadge = document.getElementById('deck-count');
  if (deckBadge) {
    deckBadge.textContent = deckCount;
    deckBadge.style.display = deckCount > 0 ? 'inline-block' : 'none';
  }

  // Activity pips
  const cardTab = document.querySelector('[data-forge-tab="cards"]');
  const deckTab = document.querySelector('[data-forge-tab="deck"]');
  const cardPip = document.getElementById('my-cards-pip');
  const deckPip = document.getElementById('deck-pip');

  if (cardPip) {
    const isActive = cardTab && cardTab.classList.contains('active');
    cardPip.classList.toggle('active', isActive || cardCount > 0);
    cardPip.classList.toggle('lit', isActive);
  }
  if (deckPip) {
    const isActive = deckTab && deckTab.classList.contains('active');
    deckPip.classList.toggle('active', isActive || deckCount > 0);
    deckPip.classList.toggle('lit', isActive);
  }
};

CardForgeActions.prototype.showAddToDeckPicker = function(cardId, anchorEl) {
  if (!this.requireAuth('manage decks')) return;
  // Remove any existing picker
  document.querySelectorAll('.deck-picker-dropdown').forEach(el => el.remove());

  const decks = this.getSavedDecks();
  if (!decks || decks.length === 0) {
    this.showNotification('Create a deck first in Deck Manager', 'info');
    return;
  }

  const picker = document.createElement('div');
  picker.className = 'deck-picker-dropdown';
  picker.innerHTML = `
    <div class="deck-picker-title">Add to Deck</div>
    ${decks.map(d => {
      const inDeck = d.cardIds && d.cardIds.includes(cardId);
      return `<button type="button" class="deck-picker-option${inDeck ? ' in-deck' : ''}"
                      data-deck-id="${d.id}" ${inDeck ? 'disabled' : ''}>
        <i class="fas fa-${inDeck ? 'check' : 'plus'}"></i>
        <span>${d.name}</span>
        ${inDeck ? '<small>already added</small>' : ''}
      </button>`;
    }).join('')}
  `;

  // Append to body and position near the anchor card (avoids overflow:hidden clipping)
  document.body.appendChild(picker);
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.left = rect.left + 'px';
    picker.style.top = Math.max(0, rect.top - picker.offsetHeight - 4) + 'px';
    picker.style.zIndex = '9999';
  }

  // Bind clicks
  picker.querySelectorAll('.deck-picker-option:not([disabled])').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dId = btn.dataset.deckId;
      this.addCardToDeck(cardId, dId);
      picker.remove();
    });
  });

  // Close on outside click
  const closeHandler = (e) => {
    if (!picker.contains(e.target)) {
      picker.remove();
      document.removeEventListener('click', closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
};

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
  // Save Card Buttons (Forge tab and Toolbar) - unified state via ChromeUI
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
        const currentState = window.CardForgeChrome?.statusEl?.dataset?.state;
        if (currentState !== 'unsaved' && currentState !== 'error') {
          console.log(`Save blocked — state is "${currentState}"`);
          return;
        }
        if (window.CardForgeChrome) {
          if (btn.id === 'toolbar-save-btn') {
            window.CardForgeChrome._navigateAfterSave = true;
          }
          window.CardForgeChrome.beginSaving();
        }
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
        UIUtils.showConfirmDialog(
          'Reset Card',
          'Reset to the starter template? Any unsaved changes will be lost.',
          () => this.handleResetCard()
        );
      });
      console.log('✅ Reset Card button bound (single handler)', btn.id);
    }
  });

  // New Card Buttons (Forge tab and Toolbar)
  const newCardBtns = [
    document.getElementById('clear-all-btn'),
    document.getElementById('toolbar-new-card-btn')
  ].filter(Boolean);
  newCardBtns.forEach(btn => {
    if (!btn.dataset.forgeActionsBound) {
      btn.dataset.forgeActionsBound = 'true';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        UIUtils.showConfirmDialog(
          'Random Card',
          'Generate a random card? Any unsaved changes will be lost.',
          () => this.handleClearAll()
        );
      });
      console.log('✅ New Card button bound (single handler)', btn.id);
    }
  });

  // Create New Deck button
  const createDeckBtn = document.getElementById('create-deck-btn');
  if (createDeckBtn && !createDeckBtn.dataset.forgeActionsBound) {
    createDeckBtn.dataset.forgeActionsBound = 'true';
    createDeckBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleCreateNewDeck();
    });
    console.log('✅ Create Deck button bound (single handler)');
  }

  // Publish Card button
  const publishBtn = document.getElementById('publish-card-btn');
  if (publishBtn && !publishBtn.dataset.forgeActionsBound) {
    publishBtn.dataset.forgeActionsBound = 'true';
    publishBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlePublishCard();
    });
    console.log('✅ Publish Card button bound (single handler)');
  }
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

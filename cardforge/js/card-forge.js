// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// Updated 2025-07-05: Added input validation, sanitization, and improved error handling
// Updated 2025-07-05: Using shared validation utilities module

// Dynamic form validation and button state management
window.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const avatarInput = document.getElementById('card-avatar');
  const publishBtn = document.getElementById('publish-btn');
  
  function validateForm() {
    const valid = nameInput?.value.trim() && classInput?.value.trim() && avatarInput?.value.trim();
    // Note: Save button validation is handled by cardforge-forge-actions.js
  }

  [nameInput, classInput, avatarInput].forEach(input => input?.addEventListener('input', validateForm));
  validateForm();

  // Ensure Publish disabled until after a successful save
  if (publishBtn) publishBtn.disabled = true;
});

/**
 * Load cards from the API and update the UI
 */
async function loadCards() {
  const cardList = document.getElementById('my-cards-list'); // user cards sidebar
  if (!cardList) return;

  try {
    // Show loading state
    cardList.innerHTML = '<li class="loading">Loading cards...</li>';

    // Fetch cards
    const endpoint = window.buildApiPath('loadCards');
    const response = await fetch(endpoint, { credentials: 'include', headers: { 'Cache-Control':'no-cache','Pragma':'no-cache','Accept':'application/json','X-Requested-With':'XMLHttpRequest' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const cards = await response.json();
    window._userCards = cards;
    renderUserCards(cardList, cards);
  } catch (e) {
    console.error('Failed to load user cards:', e);
    cardList.innerHTML = '<li class="error">Failed to load cards.</li>';
  }
} // end loadCards
  

/**
 * Render cards to the DOM
 * @param {HTMLElement} container - The container element
 * @param {Array} cards - Array of card objects
 */
// Render public gallery cards (unchanged)
function renderCards(container, cards) {
  if (!container) return;
  
  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    container.innerHTML = '<div class="no-cards">No cards found. Create your first card!</div>';
    return;
  }

  container.innerHTML = '';
  cards.forEach(card => {
    try {
      const cardElement = createCardElement(card);
      container.appendChild(cardElement);
    } catch (error) {
      console.error('Error rendering card:', card, error);
    }
  });
}

/**
 * Create a card element from card data (supports both old and new JSON schema)
 */
function createCardElement(card) {
  const cardElement = document.createElement('div');
  cardElement.className = 'card';
  
  // Extract data from new JSON schema or fallback to old format
  const cardData = extractCardDisplayData(card);
  
  cardElement.innerHTML = `
    <div class="card-header">
      <img src="${cardData.avatar}" alt="${cardData.name}" class="card-avatar" onerror="this.src='https://via.placeholder.com/50'">
      <h3>${cardData.name}</h3>
      <span class="card-class">${cardData.class}</span>
      ${cardData.rarity ? `<span class="card-rarity rarity-${cardData.rarity}">${cardData.rarity}</span>` : ''}
    </div>
    <div class="card-body">
      <blockquote>${cardData.description}</blockquote>
      ${cardData.level ? `<div class="card-level">Level ${cardData.level}</div>` : ''}
      ${cardData.palette ? `<div class="card-palette">Theme: ${cardData.palette}</div>` : ''}
    </div>
    <div class="card-actions">
      <button onclick="editCard('${cardData.id}')" class="btn btn-edit">Edit</button>
      <button onclick="deleteCard('${cardData.id}')" class="btn btn-delete">Delete</button>
    </div>
  `;
  return cardElement;
}

/**
 * Extract display data from card object (supports both old and new JSON schema)
 */
function extractCardDisplayData(card) {
  // Handle new JSON schema format
  if (card.cardContent && card.cardContent.frontFace) {
    const front = card.cardContent.frontFace;
    const modular = card.modularSystem || {};
    const meta = card.metadata || {};
    
    return {
      id: meta.cardId || card.id || 'unknown',
      name: front.characterName || 'Unnamed Card',
      class: front.characterClass || 'No Class',
      rarity: front.characterRarity || null,
      level: front.characterLevel || null,
      description: front.characterDescription || 'No description provided',
      avatar: front.characterImage?.url || 'https://via.placeholder.com/50',
      palette: modular.tier3_colorPalette?.palette || null,
      container: modular.tier2_imageContainer?.container || null
    };
  }
  
  // Handle old format (backward compatibility)
  return {
    id: card.id || 'unknown',
    name: card.name || 'Unnamed Card',
    class: card.class || 'No Class',
    rarity: card.rarity || null,
    level: card.level || null,
    description: card.quote || card.description || 'No description provided',
    avatar: card.avatar || 'https://via.placeholder.com/50',
    palette: null,
    container: null
  };
}

// Load and render published gallery cards
async function loadGallery() {
  const galleryGrid = document.getElementById('gallery-cards-grid');
  if (!galleryGrid) return;

  galleryGrid.innerHTML = '<div class="gallery-loading">Loading gallery cards...</div>';

  try {
    const response = await fetch('https://cardforgeblobdata.blob.core.windows.net/cardforge/published-cards.json', {
      cache: 'no-cache'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    // Support both array and {publishedCards: array}
    const cards = Array.isArray(data) ? data : (Array.isArray(data.publishedCards) ? data.publishedCards : []);
    renderCards(galleryGrid, cards);
  } catch (error) {
    galleryGrid.innerHTML = `<div class="error">Failed to load gallery: ${error.message}</div>`;
  }
}


/**
 * Render items in 'My Cards' sidebar
 */
function renderUserCards(container, cards) {
  container.innerHTML = '';
  if (!cards || !cards.length) {
    const li = document.createElement('li');
    li.textContent = 'No cards found. Create your first card!';
    container.appendChild(li);
    return;
  }
  cards.forEach(card => {
    // Extract display data using the same function as gallery cards
    const cardData = extractCardDisplayData(card);
    
    const li = document.createElement('li');
    li.className = 'cardforge-list-item';
    li.innerHTML = `
      <span class="card-list-title">${ValidationUtils.sanitizeString(cardData.name)}</span>
      ${cardData.class ? `<span class="card-list-class">${cardData.class}</span>` : ''}
      ${cardData.rarity ? `<span class="card-list-rarity rarity-${cardData.rarity}">${cardData.rarity}</span>` : ''}
      <div class="card-list-actions">
        <button class="btn btn-edit"><i class="fas fa-edit"></i></button>
        <button class="btn btn-delete"><i class="fas fa-trash"></i></button>
      </div>
    `;
    const editBtn = li.querySelector('.btn-edit');
    editBtn.addEventListener('click', () => editCard(cardData.id));
    const delBtn = li.querySelector('.btn-delete');
    delBtn.addEventListener('click', () => deleteCard(cardData.id));
    container.appendChild(li);
  });
}

/** Load a card into the editor form for editing */
function editCard(id) {
  const card = window._userCards?.find(c => {
    // Handle both old format (c.id) and new format (c.metadata.cardId)
    return c.id === id || (c.metadata && c.metadata.cardId === id);
  });
  if (!card) return;
  
  // Load card data into editor using new JSON schema-aware function
  loadCardIntoEditor(card);
  
  const saveBtn = document.getElementById('save-btn'); if (saveBtn) saveBtn.disabled = false;
  const publishBtn = document.getElementById('publish-btn'); if (publishBtn) publishBtn.disabled = false;
}

/**
 * Load card data into the editor form (supports both old and new JSON schema)
 */
function loadCardIntoEditor(card) {
  // Handle new JSON schema format
  if (card.cardContent && card.cardContent.frontFace) {
    const front = card.cardContent.frontFace;
    const back = card.cardContent.backFace || {};
    const modular = card.modularSystem || {};
    const meta = card.metadata || {};
    
    // Basic card info
    document.getElementById('card-id').value = meta.cardId || card.id || '';
    document.getElementById('card-name').value = front.characterName || '';
    document.getElementById('card-class').value = front.characterClass || '';
    document.getElementById('card-quote').value = front.characterDescription || '';
    document.getElementById('card-avatar').value = front.characterImage?.url || '';
    
    // Load modular system settings if available
    if (window.ModularState && modular.tier2_imageContainer) {
      window.ModularState.imageContainer = modular.tier2_imageContainer.container || 'masked';
      window.ModularState.imageContainerVariant = modular.tier2_imageContainer.containerVariant || 'circle';
      window.ModularState.imageEffect = modular.tier2_imageContainer.imageEffect || 'none';
      window.ModularState.imageEffectVariant = modular.tier2_imageContainer.imageEffectVariant || 'clean';
    }
    
    if (window.ModularState && modular.tier3_colorPalette) {
      window.ModularState.palette = modular.tier3_colorPalette.palette || 'neon';
      window.ModularState.paletteVariant = modular.tier3_colorPalette.paletteVariant || 'light';
      window.ModularState.textColor = modular.tier3_colorPalette.textColor || 'auto';
    }
    
    if (window.ModularState && modular.tier4_contentAlignment) {
      window.ModularState.horizontalAlignment = modular.tier4_contentAlignment.horizontalAlignment || 'center';
      window.ModularState.verticalAlignment = modular.tier4_contentAlignment.verticalAlignment || 'middle';
      window.ModularState.alignmentWeight = modular.tier4_contentAlignment.alignmentWeight || 'balanced';
      window.ModularState.alignmentStyle = modular.tier4_contentAlignment.alignmentStyle || 'padded';
    }
    
    // Update UI elements if the function exists
    if (typeof updateUIFromState === 'function') {
      updateUIFromState();
    }
    
    return;
  }
  
  // Handle old format (backward compatibility)
  document.getElementById('card-id').value = card.id || '';
  document.getElementById('card-name').value = card.name || '';
  document.getElementById('card-class').value = card.class || '';
  document.getElementById('card-quote').value = card.quote || '';
  document.getElementById('card-avatar').value = card.avatar || '';
  document.getElementById('card-achievement').value = card.achievement || '';
  if (document.getElementById('card-template-type')) {
    document.getElementById('card-template-type').value = card.templateType || '';
  }
}

/** Delete a user card */
function deleteCard(id) {
  const msg = 'Are you sure you want to delete this card? This cannot be undone.';
  const confirmFn = UIUtils.showConfirmDialog || ((t,m,cb)=>{ if(confirm(m)) cb(); });
  confirmFn('Delete Card', msg, async () => {
    // find button
    const selector = `li .btn-delete`;
    // Disable UI
    try {
      // call delete API
      const btn = document.querySelector(`.btn-delete`);
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
      const endpoint = window.buildApiPath('deleteCard');
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: {'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
        credentials: 'include',
        body: JSON.stringify({ id })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      UIUtils.showMessage('Card deleted', 'success');
      await loadCards();
    } catch (e) {
      console.error('Delete failed', e);
      UIUtils.showMessage(`Delete error: ${e.message}`, 'error');
    }
  });
}

// Initialize cards and gallery when the page loads
document.addEventListener('DOMContentLoaded', async () => {
  // Load cards when the page loads
  await loadCards();

  // Load first saved card by default if available
  if (window._userCards && window._userCards.length) {
    editCard(window._userCards[0].id);
  }

  // Load published gallery cards
  await loadGallery();

  // Save button event listener is handled by cardforge-forge-actions.js
});

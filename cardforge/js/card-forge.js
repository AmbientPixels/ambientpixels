// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// Updated 2025-07-05: Added input validation, sanitization, and improved error handling
// Updated 2025-07-05: Using shared validation utilities module

// [Previous code remains the same until the saveCard function]

// Dynamic form validation and button state management
window.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const avatarInput = document.getElementById('card-avatar');
  const saveBtn = document.getElementById('save-btn');
  const publishBtn = document.getElementById('publish-btn');
  

  function validateForm() {
    const valid = nameInput?.value.trim() && classInput?.value.trim() && avatarInput?.value.trim();
    if (saveBtn) saveBtn.disabled = !valid;
  }

  [nameInput, classInput, avatarInput].forEach(input => input?.addEventListener('input', validateForm));
  validateForm();

  // Ensure Publish and Delete disabled until after a successful save
  if (publishBtn) publishBtn.disabled = true;
  
});


async function saveCard() {
  const form = document.getElementById('card-editor-form');
  if (!form) {
    console.error('Card editor form not found');
    return;
  }

  // Get form elements
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const quoteInput = document.getElementById('card-quote');
  const avatarInput = document.getElementById('card-avatar');
  const achievementInput = document.getElementById('card-achievement');
  const cardIdInput = document.getElementById('card-id');
  const templateTypeInput = document.getElementById('card-template-type');

  // Clear previous errors
  if (window.UIUtils) {
    window.UIUtils.clearValidationErrors();
  }

  // Simple validation
  const errors = [];
  if (!nameInput?.value?.trim()) errors.push('Name is required');
  if (!classInput?.value?.trim()) errors.push('Class is required');
  if (!avatarInput?.value?.trim()) errors.push('Avatar URL is required');

  if (errors.length > 0) {
    if (window.UIUtils) {
      window.UIUtils.showValidationErrors(errors);
    } else {
      console.error('Validation errors:', errors);
    }
    return;
  }

  // Prepare card data
  const card = {
    id: cardIdInput?.value || `v2-${Date.now()}`,
    name: nameInput.value.trim(),
    class: classInput.value.trim(),
    quote: quoteInput?.value?.trim() || '',
    avatar: avatarInput.value.trim(),
    achievement: achievementInput?.value?.trim() || '',
    templateType: templateTypeInput?.value || 'default'
  };

  // Show confirmation dialog
  const showDialog = window.UIUtils?.showConfirmDialog || window.confirm;
  
  if (typeof showDialog === 'function') {
    showDialog(
      'Save Card', 
      'Do you want to save this card to your collection?',
      async () => {
        const saveBtn = document.getElementById('save-btn');
        // Set loading state
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        try {
          // Prepare the card data
          const cardData = {
            id: card.id,
            name: card.name,
            class: card.class,
            quote: card.quote,
            avatar: card.avatar,
            achievement: card.achievement,
            templateType: card.templateType
          };

          // Use buildApiPath helper for proper API endpoint construction
          const endpoint = window.buildApiPath('saveCard');
          console.log(`[CardForge] Saving card to endpoint: ${endpoint}`);

          // Prepare headers for anonymous access
          const headers = {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.csrfProtection?.getToken?.() || '',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          };

          console.log('[CardForge] Request details:', {
            url: endpoint,
            method: 'POST',
            headers: {
              ...headers,
              'X-CSRF-Token': headers['X-CSRF-Token'] ? '[REDACTED]' : 'MISSING'
            },
            body: {
              ...cardData,
              userId: 'anonymous',
              cardData: '[...truncated]'
            }
          });
          
          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              ...cardData,
              userId: 'anonymous',
              authToken: 'included-in-header'
            })
          });
          
          console.log('[CardForge] Response status:', response.status);
          console.log('[CardForge] Response headers:', [...response.headers.entries()]);
          
          // updated by Cascade 2025-07-20: fix double-read of response body
          const responseText = await response.text();
          console.log('[CardForge] Response body:', responseText);

          let result;
          try {
            result = JSON.parse(responseText);
          } catch (e) {
            result = null;
          }

          if (!response.ok) {
            console.error('[CardForge] Error response:', result || responseText);
            throw new Error((result && result.message) || `HTTP ${response.status}: ${response.statusText}`);
          }

          console.log('[CardForge] Card saved:', result);

          if (window.UIUtils?.showAlertDialog) {
            window.UIUtils.showAlertDialog('Card Saved', 'Your card was successfully saved!', () => {
              // Optional: focus the publish button or do any follow-up
              const publishBtn = document.getElementById('publish-btn');
              if (publishBtn) publishBtn.focus();
            });
          } else if (window.UIUtils?.showMessage) {
            window.UIUtils.showMessage('Card saved successfully!', 'success');
          } else {
            console.log('Card saved successfully!');
          }
          
          if (cardIdInput && result && result.id) {
            cardIdInput.value = result.id;
          }

          const publishBtn = document.getElementById('publish-btn');
          if (publishBtn) {
            publishBtn.disabled = false;
          }

          if (window.showMessage) {
            window.showMessage('Card saved successfully!', 'success');
          }
            
            if (window.loadCards) {
              window.loadCards();
            }
          } catch (error) {
            console.error('Failed to save card:', error);
            if (window.UIUtils?.showMessage) {
              window.UIUtils.showMessage(`Error: ${error.message}`, 'error');
            } else {
              console.error('Error:', error.message);
            }
          } finally {
            if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.innerHTML = 'Save';
            }
          }

      }
    );
  }
}

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
 * Create a card element from card data
 */
function createCardElement(card) {
  const cardElement = document.createElement('div');
  cardElement.className = 'card';
  cardElement.innerHTML = `
    <div class="card-header">
      <img src="${card.avatar || 'https://via.placeholder.com/50'}" alt="${card.name}" class="card-avatar">
      <h3>${card.name || 'Unnamed Card'}</h3>
      <span class="card-class">${card.class || 'No Class'}</span>
    </div>
    <div class="card-body">
      <blockquote>${card.quote || 'No quote provided'}</blockquote>
      ${card.achievement ? `<div class="achievement">🏆 ${card.achievement}</div>` : ''}
    </div>
    <div class="card-actions">
      <button onclick="editCard('${card.id}')" class="btn btn-edit">Edit</button>
      <button onclick="deleteCard('${card.id}')" class="btn btn-delete">Delete</button>
    </div>
  `;
  return cardElement;
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
    const li = document.createElement('li');
    li.className = 'cardforge-list-item';
    li.innerHTML = `
      <span class="card-list-title">${ValidationUtils.sanitizeString(card.name)}</span>
      <div class="card-list-actions">
        <button class="btn btn-edit"><i class="fas fa-edit"></i></button>
        <button class="btn btn-delete"><i class="fas fa-trash"></i></button>
      </div>
    `;
    const editBtn = li.querySelector('.btn-edit');
    editBtn.addEventListener('click', () => editCard(card.id));
    const delBtn = li.querySelector('.btn-delete');
    delBtn.addEventListener('click', () => deleteCard(card.id));
    container.appendChild(li);
  });
}

/** Load a card into the editor form for editing */
function editCard(id) {
  const card = window._userCards?.find(c => c.id === id);
  if (!card) return;
  document.getElementById('card-id').value = card.id;
  document.getElementById('card-name').value = card.name;
  document.getElementById('card-class').value = card.class;
  document.getElementById('card-quote').value = card.quote;
  document.getElementById('card-avatar').value = card.avatar;
  document.getElementById('card-achievement').value = card.achievement || '';
  document.getElementById('card-template-type').value = card.templateType;
  // updatePreview(); // Removed - handled by card-forge-editor.js
  const saveBtn = document.getElementById('save-btn'); if (saveBtn) saveBtn.disabled = false;
  const publishBtn = document.getElementById('publish-btn'); if (publishBtn) publishBtn.disabled = false;
  // No automatic scrolling
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

  // Set up event listeners for the save button
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveCard);
  }
});

// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// Updated 2025-07-05: Added input validation, sanitization, and improved error handling
// Updated 2025-07-05: Using shared validation utilities module

// [Previous code remains the same until the saveCard function]

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
  clearValidationErrors();

  // Simple validation
  const errors = [];
  if (!nameInput?.value?.trim()) errors.push('Name is required');
  if (!classInput?.value?.trim()) errors.push('Class is required');
  if (!avatarInput?.value?.trim()) errors.push('Avatar URL is required');

  if (errors.length > 0) {
    showValidationErrors(errors);
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
  showConfirmDialog(
    'Save Card', 
    'Do you want to save this card to your collection?',
    async () => {
      const saveBtn = document.getElementById('save-btn');
      try {
        // Set loading state
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
        }

        // Use buildApiPath helper for proper API endpoint construction
        const endpoint = buildApiPath('cardforgesavecards');
        console.log(`[CardForge] Saving card to endpoint: ${endpoint}`);

        // Prepare headers
        const headers = {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.csrfProtection?.getToken?.() || ''
        };

        // Add dev user ID in non-production
        if (window._config?.environment !== 'production') {
          const devAuth = localStorage.getItem('cardforge_dev_auth');
          if (devAuth) {
            try {
              const { id: devUserId } = JSON.parse(devAuth);
              headers['X-User-ID'] = devUserId;
              if (window._config?.debug) {
                console.log(`[DEV] Added X-User-ID header for save: ${devUserId}`);
              }
            } catch (e) {
              console.warn('Failed to parse dev auth data', e);
            }
          }
        }

        // Make API request
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(card)
        });

        if (!response.ok) {
          const error = await response.text().catch(() => null);
          throw new Error(error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        console.log('[CardForge] Card saved:', result);

        // Update card ID if this is a new card
        if (cardIdInput && result.id) {
          cardIdInput.value = result.id;
        }

        // Enable publish button after successful save
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
          publishBtn.disabled = false;
        }

        showMessage('Card saved successfully!', 'success');
        loadCards(); // Refresh the card list
      } catch (error) {
        console.error('Failed to save card:', error);
        showMessage(`Error: ${error.message}`, 'error');
      } finally {
        // Reset button state
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      }
    }
  );
}

/**
 * Load cards from the API and update the UI
 */
async function loadCards() {
  const cardList = document.getElementById('card-list');
  if (!cardList) return;

  try {
    // Show loading state
    cardList.innerHTML = '<div class="loading">Loading cards...</div>';
    
    // Try API first
    try {
      const response = await fetch(buildApiPath('cardforgeloadcards'), {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (response.ok) {
        const cards = await response.json();
        renderCards(cardList, cards);
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (apiError) {
      console.warn('API load failed, trying mock data', apiError);
      // Fall through to mock data
    }

    // Fallback to mock data
    try {
      const [defaultCards, publishedCards] = await Promise.all([
        fetch('/cardforge/mock/default-cards.json').then(r => r.json()),
        fetch('/cardforge/mock/published-cards.json').then(r => r.json())
      ]);
      
      renderCards(cardList, [...(defaultCards || []), ...(publishedCards || [])]);
    } catch (mockError) {
      console.error('Failed to load mock data:', mockError);
      throw new Error('Failed to load cards. Please try again later.');
    }
  } catch (error) {
    console.error('Failed to load cards:', error);
    cardList.innerHTML = `
      <div class="error">
        <p>Failed to load cards. ${error.message}</p>
        <button onclick="loadCards()" class="btn btn-retry">Retry</button>
      </div>
    `;
  }
}

/**
 * Render cards to the DOM
 * @param {HTMLElement} container - The container element
 * @param {Array} cards - Array of card objects
 */
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

// Initialize cards when the page loads
document.addEventListener('DOMContentLoaded', async () => {
  // Load cards when the page loads
  await loadCards();
  
  // Set up event listeners for the save button
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveCard);
  }
});

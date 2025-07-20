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
          saveBtn.textContent = 'Saving...';
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

          // Get auth token from session
          const userInfo = JSON.parse(sessionStorage.getItem('userInfo') || 'null');
          const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
          
          if (!isAuthenticated || !userInfo) {
            if (window.UIUtils && typeof window.UIUtils.showMessage === 'function') {
              window.UIUtils.showMessage('You must be signed in to save cards.', 'error');
            } else {
              alert('Authentication failed. Please sign in with Microsoft.');
            }
            return;
          }

          // Prepare headers with MSAL token
          const headers = {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.csrfProtection?.getToken?.() || '',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Authorization': `Bearer ${token}`
          };

          console.log('[CardForge] Using MSAL Bearer token for authentication');
          
          console.log('[CardForge] Request details:', {
            url: endpoint,
            method: 'POST',
            headers: {
              ...headers,
              'X-CSRF-Token': headers['X-CSRF-Token'] ? '[REDACTED]' : 'MISSING',
              'Authorization': '[REDACTED]'
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
          
          const responseText = await response.text();
          console.log('[CardForge] Response body:', responseText);
          
          if (!response.ok) {
            try {
              const errorData = JSON.parse(responseText);
              console.error('[CardForge] Error response:', errorData);
              throw new Error(errorData.message || `HTTP ${response.status}`);
            } catch (e) {
              console.error('[CardForge] Non-JSON error response:', responseText);
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
          }

          const result = await response.json();
          console.log('[CardForge] Card saved:', result);

          if (window.UIUtils?.showMessage) {
            window.UIUtils.showMessage('Card saved successfully!', 'success');
          } else {
            console.log('Card saved successfully!');
          }
          
          if (cardIdInput && result.id) {
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
            saveBtn.textContent = 'Save';
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
  const cardList = document.getElementById('card-list');
  if (!cardList) return;

  try {
    // Show loading state
    cardList.innerHTML = '<div class="loading">Loading cards...</div>';
    
    // Try API first
    try {
      const endpoint = window.buildApiPath('loadCards');
      console.log(`[CardForge] Loading cards from: ${endpoint}`);
      
      const response = await fetch(endpoint, {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }
      
      const cards = await response.json();
      renderCards(cardList, cards);
      return;
    } catch (apiError) {
      console.warn('API load failed, trying mock data', apiError);
      // Fall through to mock data
    }

    // Fallback to mock data if in development
    if (window._config?.environment === 'development') {
      try {
        const mockResponse = await fetch('/cardforge/mock/cards.json');
        if (mockResponse.ok) {
          const mockData = await mockResponse.json();
          renderCards(cardList, mockData);
          console.warn('[CardForge] Using mock data');
          return;
        }
      } catch (mockError) {
        console.error('Failed to load mock data:', mockError);
      }
    }
    
    throw new Error('Failed to load cards. Please check your connection and try again.');
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

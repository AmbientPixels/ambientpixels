// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// Updated 2025-07-05: Added input validation, sanitization, and improved error handling
// Updated 2025-07-05: Using shared validation utilities module

// Helper functions for UI feedback
// Note: validation and sanitization functions now use shared ValidationUtils module

/**
 * Shows validation errors in the UI
 * @param {Array} errors - Array of error messages
 */
function showValidationErrors(errors) {
  // Remove any existing error messages
  clearValidationErrors();
  
  // Create error container if it doesn't exist
  let errorContainer = document.getElementById('cardforge-errors');
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.id = 'cardforge-errors';
    errorContainer.className = 'cardforge-error-container';
    
    // Insert after the form
    const form = document.getElementById('card-editor-form');
    if (form) {
      form.insertAdjacentElement('afterend', errorContainer);
    }
  }
  
  // Add each error
  const errorList = document.createElement('ul');
  errors.forEach(error => {
    const errorItem = document.createElement('li');
    errorItem.textContent = error;
    errorList.appendChild(errorItem);
  });
  
  errorContainer.appendChild(errorList);
}

/**
 * Clears validation errors from the UI
 */
function clearValidationErrors() {
  const errorContainer = document.getElementById('cardforge-errors');
  if (errorContainer) {
    errorContainer.innerHTML = '';
  }
}

/**
 * Shows a message to the user
 * @param {string} message - The message to display
 * @param {string} type - The type of message ('success', 'error', 'info')
 */
function showMessage(message, type = 'info') {
  // Create message container if it doesn't exist
  let messageContainer = document.getElementById('cardforge-messages');
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.id = 'cardforge-messages';
    messageContainer.className = 'cardforge-message-container';
    
    // Insert at the top of the editor section
    const editorSection = document.querySelector('.cardforge-editor');
    if (editorSection) {
      editorSection.insertAdjacentElement('afterbegin', messageContainer);
    } else {
      document.body.insertAdjacentElement('afterbegin', messageContainer);
    }
  }
  
  // Create the message element
  const messageElement = document.createElement('div');
  messageElement.className = `cardforge-message cardforge-message-${type}`;
  messageElement.textContent = message;
  
  // Add close button
  const closeButton = document.createElement('button');
  closeButton.className = 'cardforge-message-close';
  closeButton.innerHTML = '&times;';
  closeButton.onclick = function() {
    messageElement.remove();
  };
  messageElement.appendChild(closeButton);
  
  // Add to container
  messageContainer.appendChild(messageElement);
  
  // Auto-remove after 5 seconds if it's a success message
  if (type === 'success') {
    setTimeout(() => {
      messageElement.remove();
    }, 5000);
  }
}

// loadCards() will retrieve the current user's cards (mock for now)

// Helper to determine API base URL based on environment
function getApiBaseUrl() {
    // Check if we're running locally
    const isLocalDev = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1';
    
    // For local development, use the local API
    if (isLocalDev) {
        return 'http://localhost:7071'; // Azure Functions default port
    }
    
    // In production, check if window._config exists (for custom API paths)
    if (window._config && window._config.apiBasePath) {
        return window._config.apiBasePath;
    }
    
    // Default: use relative paths (will be handled by SWA)
    return '';
}

async function loadCards() {
    const listEl = document.getElementById('my-cards-list');
    const listTitle = document.querySelector('.cardforge-sidebar h2');
    const saveBtn = document.getElementById('save-btn');

    // This function needs to be exposed by the auth scripts
    const account = window.authModule?.getCurrentUser();

    let cards = [];
    const apiBase = getApiBaseUrl();
    let endpoint = `${apiBase}/api/cardforgegallery`;
    let title = 'Public Gallery';
    let isAuthenticated = false;

    if (account) {
        endpoint = `${apiBase}/api/cardforgemycards`;
        title = 'My Cards';
        isAuthenticated = true;
    }
    
    // Enable debugging for API calls
    if (window._config?.debug) {
        console.log(`[CardForge] Configuration:`, window._config);
        console.log(`[CardForge] API Base URL: ${apiBase}`);
        console.log(`[CardForge] Full endpoint: ${endpoint}`);
        console.log(`[CardForge] Authentication status: ${isAuthenticated ? 'Authenticated' : 'Anonymous'}`);
    }
    
    if (listTitle) listTitle.textContent = title;
    if (saveBtn) saveBtn.disabled = !isAuthenticated;

    try {
        console.log(`[CardForge] Fetching cards from: ${endpoint}`);
        const res = await fetch(endpoint, {
            // Add credentials to send cookies
            credentials: 'include',
            // Add proper headers
            headers: {
                'Accept': 'application/json'
            }
        });
        
        // Log detailed response info
        if (window._config?.debug) {
            console.log(`[CardForge] Response status: ${res.status} ${res.statusText}`);
            console.log(`[CardForge] Response headers:`, Object.fromEntries([...res.headers]));
        }
        
        if (res.ok) {
            cards = await res.json();
            console.log(`[CardForge] Loaded ${cards.length} cards from ${endpoint}`);
        } else if (res.status !== 401) { // Ignore 401s for anonymous users
            // Try to get more error details
            let errorDetails = `HTTP ${res.status}`;
            try {
                const errorData = await res.text();
                if (errorData) {
                    errorDetails += ` - ${errorData}`;
                }
            } catch (e) { /* ignore */ }
            throw new Error(errorDetails);
        }

        // If there's a container for listing cards, render them.
        if (listEl) {
            listEl.innerHTML = '';
            cards.forEach(card => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${card.name}</strong> <em>${card.class}</em>`;
                li.dataset.cardId = card.id;
                li.addEventListener('click', () => {
                    // highlight selection
                    document.querySelectorAll('#my-cards-list li.selected').forEach(el => el.classList.remove('selected'));
                    li.classList.add('selected');
                    // populate editor fields when clicking card
                    const evt = new CustomEvent('cardforge:select', { detail: card });
                    document.dispatchEvent(evt);
                });
                listEl.appendChild(li);
            });
        }
    } catch (err) {
        console.error('Failed to load cards', err.message);
        if (listEl) {
            listEl.innerHTML = '<li><em>Failed to load cards</em></li>';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
  loadCards();
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveCard);
});

// Handle card selection to fill form (if editor loaded earlier)
document.addEventListener('cardforge:select', e => {
  const card = e.detail;
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const quoteInput = document.getElementById('card-quote');
  const avatarInput = document.getElementById('card-avatar');
  if (nameInput) nameInput.value = card.name;
  if (classInput) classInput.value = card.class;
  if (quoteInput) quoteInput.value = card.quote;
  if (avatarInput) avatarInput.value = card.avatar;

  // Trigger preview update if button exists
  const previewBtn = document.getElementById('preview-btn');
  if (previewBtn) previewBtn.click();
});

async function saveCard() {
  const form = document.getElementById('card-form');
  if (!form) return;

  clearValidationErrors();

  // Get form values
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const avatarInput = document.getElementById('card-avatar');
  const quoteInput = document.getElementById('card-quote');
  const achievementInput = document.getElementById('card-achievement');

  // Get the validation module
  const validator = window.validationUtils;

  // Validate input values
  const errors = [];
  if (!validator.isValidString(nameInput.value, 2, 30)) {
      errors.push('Name must be between 2 and 30 characters');
  }
  if (!validator.isValidString(classInput.value, 2, 20)) {
      errors.push('Class must be between 2 and 20 characters');
  }
  if (!validator.isValidImageUrl(avatarInput.value)) {
      errors.push('Avatar must be a valid image URL');
  }
  if (!validator.isValidString(quoteInput.value, 0, 100)) {
      errors.push('Quote must be less than 100 characters');
  }
  if (!validator.isValidString(achievementInput.value, 0, 50)) {
      errors.push('Achievement must be less than 50 characters');
  }

  // If there are validation errors, display them and return
  if (errors.length > 0) {
      showValidationErrors(errors);
      return;
  }
  
  // Get API base URL
  const apiBase = getApiBaseUrl();

  // Clear any previous validation messages
  clearValidationErrors();
  
  // Sanitize using shared utilities and prepare the card data
  const card = {
      id: `v2-${Date.now()}`,
      name: nameInput.value.trim(),
      class: classInput.value.trim(),
      quote: quoteInput.value.trim(),
      avatar: avatarInput.value.trim(),
      achievement: achievementInput.value.trim()
  };

  try {
      // Show saving indicator
      const saveBtn = document.getElementById('save-btn');
      if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
      }
      
      // This function needs to be exposed by the auth scripts
      const account = window.authModule?.getCurrentUser();
      
      // Send the card data to the server
      const response = await fetch(`${apiBase}/api/cardforgesavecards`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'X-User-Id': account?.id || 'anonymous',
              'X-CSRF-Token': window.csrfToken
          },
          body: JSON.stringify(card)
      });
      
      if (!response.ok) {
          // Check content type to handle non-JSON errors
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
              const errorData = await response.json();
              throw new Error(errorData.message || `HTTP ${response.status}`);
          } else {
              throw new Error(`HTTP ${response.status}`);
          }
      }
      
      const result = await response.json();
      console.log('[CardForge] Card saved:', result);
      
      // Show success message
      showMessage('Card saved successfully!', 'success');
      
      // Reload cards to show the updated list
      loadCards();
  } catch (error) {
      console.error('Failed to save card:', error);
      showMessage(`Error: ${error.message}`, 'error');
  } finally {
      // Reset save button
      const saveBtn = document.getElementById('save-btn');
      if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
      }
  }
}

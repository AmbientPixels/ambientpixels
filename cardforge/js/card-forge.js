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

async function loadCards() {
    const listEl = document.getElementById('my-cards-list');
    const listTitle = document.querySelector('.cardforge-sidebar h2');
    const saveBtn = document.getElementById('save-btn');

    // This function needs to be exposed by the auth scripts
    const account = window.authModule?.getCurrentUser();

    let cards = [];
    let endpoint = '/api/cardforge/gallery';
    let title = 'Public Gallery';
    let isAuthenticated = false;

    if (account) {
        endpoint = '/api/cardforge/mycards';
        title = 'My Cards';
        isAuthenticated = true;
    }

    if (listTitle) listTitle.textContent = title;
    if (saveBtn) saveBtn.disabled = !isAuthenticated;

    try {
        const res = await fetch(endpoint);
        if (res.ok) {
            cards = await res.json();
        } else if (res.status !== 401) { // Ignore 401s for anonymous users
            throw new Error(`HTTP ${res.status}`);
        }

        console.log(`[CardForge] Loaded ${cards.length} cards from ${endpoint}`);

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
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const quoteInput = document.getElementById('card-quote');
  const avatarInput = document.getElementById('card-avatar');

  // Create card object for validation
  const cardToValidate = {
    name: nameInput.value.trim(),
    class: classInput.value.trim(),
    quote: quoteInput.value.trim(),
    avatar: avatarInput.value.trim()
  };

  // Use shared validation utilities
  const errors = ValidationUtils.validateCard(cardToValidate);
  
  // Reset UI error indicators
  nameInput.classList.toggle('error', !ValidationUtils.isNonEmptyString(cardToValidate.name));
  classInput.classList.toggle('error', !ValidationUtils.isNonEmptyString(cardToValidate.class));
  avatarInput.classList.toggle('error', cardToValidate.avatar && !ValidationUtils.isValidImageUrl(cardToValidate.avatar));

  // If there are validation errors, show them and abort save
  if (errors.length > 0) {
    showValidationErrors(errors);
    return;
  }

  // Clear any previous validation messages
  clearValidationErrors();
  
  // Sanitize using shared utilities and prepare the card data
  const card = {
    id: `v2-${Date.now()}`,
    ...ValidationUtils.sanitizeCard(cardToValidate)
  };

  try {
    // Show saving indicator
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    // Add CSRF token if available
    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = document.querySelector('meta[name="csrf-token"]');
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken.getAttribute('content');
    }

    const res = await fetch('/api/cardforge/savecards', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(card)
    });

    if (!res.ok) {
      // Check content type to handle non-JSON errors
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const errorData = await res.json();
        throw new Error(errorData.message || `HTTP ${res.status}`);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    }

    const data = await res.json();
    console.log('[CardForge] Saved', data);
    
    // Show success message
    showMessage('Card saved successfully!', 'success');
    
    // Reload list with new card
    loadCards();
  } catch (err) {
    console.error('Failed to save card', err);
    showMessage(`Failed to save card: ${err.message}`, 'error');
  } finally {
    // Reset button state
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

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
 * Shows a message popup to the user
 * @param {string} message - The message to display
 * @param {string} type - The type of message (success, error, info)
 */
function showMessage(message, type = 'info') {
  // Create message container if it doesn't exist
  let messageContainer = document.getElementById('cardforge-messages');
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.id = 'cardforge-messages';
    messageContainer.className = 'cardforge-message-container';
    document.body.appendChild(messageContainer);
  }
  
  // Create message element
  const messageElement = document.createElement('div');
  messageElement.className = `cardforge-message cardforge-message-${type}`;
  messageElement.innerHTML = `
    <span class="message-icon">
      ${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}
    </span>
    <span class="message-text">${message}</span>
  `;
  
  // Add to container
  messageContainer.appendChild(messageElement);
  
  // Remove after delay
  setTimeout(() => {
    messageElement.classList.add('fade-out');
    setTimeout(() => {
      messageContainer.removeChild(messageElement);
    }, 500);
  }, 3000);
}

/**
 * Shows a confirmation dialog
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {Function} onConfirm - Function to call when confirmed
 */
function showConfirmDialog(title, message, onConfirm) {
  const dialog = document.getElementById('cardforge-dialog');
  const dialogTitle = document.getElementById('dialog-title');
  const dialogMessage = document.getElementById('dialog-message');
  const confirmBtn = document.getElementById('dialog-confirm');
  const cancelBtn = document.getElementById('dialog-cancel');
  
  if (!dialog || !dialogTitle || !dialogMessage || !confirmBtn || !cancelBtn) {
    console.error('Dialog elements not found');
    return;
  }
  
  // Set dialog content
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  
  // Show dialog
  dialog.classList.add('active');
  
  // Handle confirm button
  const handleConfirm = () => {
    dialog.classList.remove('active');
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
    onConfirm();
  };
  
  // Handle cancel button
  const handleCancel = () => {
    dialog.classList.remove('active');
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
  };
  
  // Add event listeners
  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
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
    // Check if window._config exists (for custom API paths)
    if (window._config && window._config.apiBasePath) {
        return window._config.apiBasePath;
    }
    
    // Default: use relative paths (will be handled by Azure Static Web Apps)
    return '';
}

/**
 * Load user cards and gallery cards
 */
async function loadCards() {
    // Get DOM elements
    const myCardsList = document.getElementById('my-cards-list');
    const userCardsSidebar = document.getElementById('user-cards-sidebar');
    const cardPreviewContainer = document.getElementById('card-preview-container');
    const mainContainer = document.getElementById('cardforge-main-container');
    const authStatusMessage = document.getElementById('auth-status-message');
    const galleryGrid = document.getElementById('gallery-cards-grid');
    const saveBtn = document.getElementById('save-btn');
    const publishBtn = document.getElementById('publish-btn');
    
    // Check authentication status
    // Try multiple ways to detect authentication
    let account = null;
    let isAuthenticated = false;
    
    // Method 1: Check window.authModule (SWA)
    if (window.authModule && typeof window.authModule.getCurrentUser === 'function') {
        account = window.authModule.getCurrentUser();
        if (account) {
            isAuthenticated = true;
            console.log('[CardForge] Authentication detected via authModule');
        }
    }
    
    // Method 2: Check window.authClient (AAD)
    if (!isAuthenticated && window.authClient && typeof window.authClient.getAccount === 'function') {
        account = window.authClient.getAccount();
        if (account) {
            isAuthenticated = true;
            console.log('[CardForge] Authentication detected via authClient');
        }
    }
    
    // Method 3: Check localStorage for testing/development
    if (!isAuthenticated && localStorage.getItem('cardforge_dev_auth')) {
        try {
            account = JSON.parse(localStorage.getItem('cardforge_dev_auth'));
            isAuthenticated = true;
            console.log('[CardForge] Authentication detected via localStorage (dev mode)');
        } catch (e) {
            console.warn('[CardForge] Invalid dev auth data in localStorage');
        }
    }
    
    // For testing: enable mock authentication
    if (!isAuthenticated && window.location.search.includes('mockAuth=true')) {
        account = { id: 'test-user', name: 'Test User', roles: ['user'] };
        isAuthenticated = true;
        console.log('[CardForge] Using mock authentication for testing');
        localStorage.setItem('cardforge_dev_auth', JSON.stringify(account));
    }
    
    // API configuration
    const apiBase = getApiBaseUrl();
    // Prevent double /api/ prefix by checking if apiBase already contains /api anywhere
    const apiPath = apiBase.includes('/api') ? '' : '/api';
    // Ensure we have a clean path with no double slashes
    const cleanBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
    const endpoint = `${cleanBase}${apiPath}/cardforgeloadcards`;
    
    // Update UI based on authentication status
    if (saveBtn) {
        if (isAuthenticated) {
            saveBtn.disabled = false;
            saveBtn.style.display = 'inline-block';
        } else {
            saveBtn.style.display = 'none'; // Hide save button when not authenticated
        }
    }
    
    if (publishBtn) {
        if (isAuthenticated) {
            publishBtn.disabled = true; // Only enabled when a card is selected
            publishBtn.style.display = 'inline-block';
        } else {
            publishBtn.style.display = 'none'; // Hide publish button when not authenticated
        }
    }
    
    // Update layout based on authentication status
    if (mainContainer && userCardsSidebar && cardPreviewContainer) {
        if (isAuthenticated) {
            // Three-column layout for authenticated users
            userCardsSidebar.style.display = 'block';
            cardPreviewContainer.classList.remove('grid-col-8');
            cardPreviewContainer.classList.add('grid-col-5');
        } else {
            // Two-column layout for anonymous users
            userCardsSidebar.style.display = 'none';
            cardPreviewContainer.classList.remove('grid-col-5');
            cardPreviewContainer.classList.add('grid-col-8');
        }
    }
    
    // Update auth status message
    if (authStatusMessage) {
        if (isAuthenticated) {
            authStatusMessage.textContent = `Signed in as ${account.name || account.username || 'User'}. Your cards will be saved.`;
            authStatusMessage.className = 'cardforge-auth-message authenticated';
            // Hide sign-in message when authenticated
            document.querySelectorAll('.sign-in-prompt').forEach(el => {
                el.style.display = 'none';
            });
        } else {
            authStatusMessage.textContent = 'Sign in to save your cards and publish to the gallery.';
            authStatusMessage.className = 'cardforge-auth-message unauthenticated';
            // Show sign-in message when not authenticated
            document.querySelectorAll('.sign-in-prompt').forEach(el => {
                el.style.display = 'block';
            });
        }
    }
    
    // Debug logging
    if (window._config?.debug) {
        console.log(`[CardForge] Configuration:`, window._config || {});
        console.log(`[CardForge] API Base URL: ${apiBase}`);
        console.log(`[CardForge] Full endpoint: ${endpoint}`);
        console.log(`[CardForge] Authentication status: ${isAuthenticated ? 'Authenticated' : 'Anonymous'}`);
        console.log(`[CardForge] Layout mode: ${isAuthenticated ? '3-column' : '2-column'}`);
        console.log(`[CardForge] User account:`, account || 'Not signed in');
    }
    
    try {
        // Fetch cards from API
        console.log(`[CardForge] Fetching cards from: ${endpoint}`);
        const res = await fetch(endpoint, {
            credentials: 'include',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        // Debug response info
        if (window._config?.debug) {
            console.log(`[CardForge] Response status: ${res.status} ${res.statusText}`);
            console.log(`[CardForge] Response headers:`, Object.fromEntries([...res.headers]));
        }
        
        if (!res.ok && res.status !== 401) { // Ignore 401s for anonymous users
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
        
        // Process API response
        const data = res.ok ? await res.json() : { userCards: [], galleryCards: [] };
        console.log(`[CardForge] Full API response:`, JSON.stringify(data, null, 2));
        
        let userCards = data.userCards || [];
        let galleryCards = data.galleryCards || [];
        
        // If no gallery cards were found but we got published cards, use those instead
        if (galleryCards.length === 0 && Array.isArray(data.publishedCards) && data.publishedCards.length > 0) {
            console.log(`[CardForge] Using publishedCards array (${data.publishedCards.length} cards) as gallery cards`);
            galleryCards = data.publishedCards;
        }
        
        // For anonymous users, if no user cards are loaded, use default cards if available
        if (!isAuthenticated && userCards.length === 0 && Array.isArray(data.defaultCards) && data.defaultCards.length > 0) {
            console.log(`[CardForge] Using defaultCards array (${data.defaultCards.length} cards) for anonymous user`);
            userCards = data.defaultCards;
        }
        
        console.log(`[CardForge] Loaded ${userCards.length} user cards and ${galleryCards.length} gallery cards`);
        console.log(`[CardForge] API diagnostics:`, data.diagnostics || 'No diagnostics available');
        
        // Check for misnamed properties in the response
        const possibleCardArrays = ['galleryCards', 'publishedCards', 'gallery', 'cards', 'published'];
        for (const prop of possibleCardArrays) {
            if (data[prop] && Array.isArray(data[prop]) && data[prop].length > 0) {
                console.log(`[CardForge] Found potential gallery cards in property '${prop}': ${data[prop].length} cards`);
                // If we found cards in a property other than galleryCards, use those instead
                if (prop !== 'galleryCards' && galleryCards.length === 0) {
                    console.log(`[CardForge] Using '${prop}' as gallery cards source`);
                    galleryCards = data[prop];
                }
            }
        }
        
        // Render user cards (only if authenticated)
        if (myCardsList && isAuthenticated) {
            myCardsList.innerHTML = '';
            
            if (userCards.length > 0) {
                userCards.forEach(card => {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <img class="card-list-thumbnail" src="${card.avatar || '/images/card-placeholder.png'}" alt="${card.name}" onerror="this.src='/images/card-placeholder.png'">
                        <div class="card-list-info">
                            <h4 class="card-list-title">${card.name}</h4>
                            <p class="card-list-subtitle">${card.class}</p>
                        </div>
                    `;
                    li.dataset.cardId = card.id;
                    li.addEventListener('click', () => {
                        // Highlight selection
                        document.querySelectorAll('#my-cards-list li.selected').forEach(el => el.classList.remove('selected'));
                        li.classList.add('selected');
                        
                        // Update hidden card ID field
                        const cardIdInput = document.getElementById('card-id');
                        if (cardIdInput) cardIdInput.value = card.id;
                        
                        // Enable publish button if card is saved
                        if (publishBtn) publishBtn.disabled = false;
                        
                        // Populate editor fields
                        const evt = new CustomEvent('cardforge:select', { detail: card });
                        document.dispatchEvent(evt);
                    });
                    myCardsList.appendChild(li);
                });
            } else {
                const emptyMsg = document.createElement('li');
                emptyMsg.className = 'empty-message';
                emptyMsg.textContent = 'No cards yet. Create your first card!';
                myCardsList.appendChild(emptyMsg);
            }
        }
        
        // Render gallery cards
        if (galleryGrid) {
            galleryGrid.innerHTML = '';
            
            if (galleryCards.length > 0) {
                galleryCards.forEach(card => {
                    const cardElement = document.createElement('div');
                    cardElement.className = 'gallery-card';
                    cardElement.innerHTML = `
                        <img class="gallery-card-image" src="${card.avatar || '/images/card-placeholder.png'}" alt="${card.name}" onerror="this.src='/images/card-placeholder.png'">
                        <div class="gallery-card-content">
                            <h4 class="gallery-card-title">${card.name}</h4>
                            <p class="gallery-card-subtitle">${card.class}</p>
                        </div>
                    `;
                    cardElement.addEventListener('click', () => {
                        // Populate editor fields when clicking gallery card
                        const evt = new CustomEvent('cardforge:select', { detail: card });
                        document.dispatchEvent(evt);
                    });
                    galleryGrid.appendChild(cardElement);
                });
            } else {
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'gallery-empty-message';
                emptyMsg.textContent = 'No published cards yet. Be the first to publish!';
                galleryGrid.appendChild(emptyMsg);
            }
        }
    } catch (error) {
        console.error(`[CardForge] Error loading cards:`, error);
        
        // Show error in user cards list
        if (myCardsList && isAuthenticated) {
            myCardsList.innerHTML = `<li class="error-message">Error loading cards: ${error.message}</li>`;
        }
        
        // Show error in gallery
        if (galleryGrid) {
            galleryGrid.innerHTML = `<div class="error-message">Error loading gallery: ${error.message}</div>`;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
  loadCards();
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveCard);
  
  const publishBtn = document.getElementById('publish-btn');
  if (publishBtn) publishBtn.addEventListener('click', publishCard);
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
  const form = document.getElementById('card-editor-form');
  if (!form) {
    console.error('Card editor form not found');
    return;
  }

  clearValidationErrors();

  // Get form values
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const avatarInput = document.getElementById('card-avatar');
  const quoteInput = document.getElementById('card-quote');
  const achievementInput = document.getElementById('card-achievement');
  const cardIdInput = document.getElementById('card-id');

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
  
  // Check if user is signed in
  const account = window.authModule?.getCurrentUser();
  const isSignedIn = !!account;
  
  if (!isSignedIn) {
    showMessage('Please sign in to save cards', 'error');
    return;
  }
  
  // Prepare the card data
  const card = {
    id: cardIdInput.value || `v2-${Date.now()}`,
    name: nameInput.value.trim(),
    class: classInput.value.trim(),
    quote: quoteInput.value.trim(),
    avatar: avatarInput.value.trim(),
    achievement: achievementInput.value.trim(),
    templateType: document.getElementById('card-template-type').value
  };
  
  // Show confirmation dialog
  showConfirmDialog(
    'Save Card', 
    'Do you want to save this card to your collection?',
    async () => {
      try {
        // Show saving indicator
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
        }
        
        // Get API base URL
        const apiBase = getApiBaseUrl();
        
        // Avoid double /api paths by checking if apiBase already ends with /api
        const apiPath = apiBase.endsWith('/api') ? '' : '/api';
        
        // Send the card data to the server
        const response = await fetch(`${apiBase}${apiPath}/cardforgesavecards`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': account?.id || 'anonymous',
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
        
        // Update the card ID in the form
        if (cardIdInput && result.id) {
          cardIdInput.value = result.id;
        }
        
        // Enable publish button after successful save
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
          publishBtn.disabled = false;
        }
        
        // Show success message
        showMessage('Card saved successfully!', 'success');
        
        // Reload cards to show the updated list
        loadCards();
      } catch (error) {
        console.error('Failed to save card:', error);
        showMessage(`Error: ${error.message}`, 'error');
      } finally {
        // Reset button state
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      }
    }
  );
}

/**
 * Publish a card to the public gallery
 */
async function publishCard() {
  // Check if user is signed in
  const account = window.authModule?.getCurrentUser();
  const isSignedIn = !!account;
  
  if (!isSignedIn) {
    showMessage('Please sign in to publish cards', 'error');
    return;
  }

  // Get the card ID from the form
  const cardIdInput = document.getElementById('card-id');
  if (!cardIdInput || !cardIdInput.value) {
    showMessage('Please save the card before publishing', 'error');
    return;
  }

  const cardId = cardIdInput.value;
  
  // Show confirmation dialog
  showConfirmDialog(
    'Publish Card', 
    'Do you want to publish this card to the public gallery? Published cards will be visible to everyone.',
    async () => {
      try {
        // Get API base URL - uses the shared getApiBaseUrl() function from card-forge.js
        const apiBase = getApiBaseUrl();
        
        // Avoid double /api paths by checking if apiBase already ends with /api
        const apiPath = apiBase.endsWith('/api') ? '' : '/api';
        
        // Show publishing indicator
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
          publishBtn.disabled = true;
          publishBtn.textContent = 'Publishing...';
        }
        
        // Call the cardforgepublish API
        const response = await fetch(`${apiBase}${apiPath}/cardforgepublish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': account?.id || 'anonymous',
            'X-CSRF-Token': window.csrfToken
          },
          body: JSON.stringify({ cardId })
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
        console.log('[CardForge] Card published:', result);
        
        // Show success message
        showMessage('Card published to gallery!', 'success');
        
        // Reload gallery to show the updated list
        if (typeof loadGallery === 'function') {
          loadGallery();
        } else {
          // Fallback to reloading the page if loadGallery isn't available
          console.log('[CardForge] loadGallery function not found, reloading cards instead');
          if (typeof loadCards === 'function') {
            loadCards();
          }
        }
      } catch (error) {
        console.error('Failed to publish card:', error);
        showMessage(`Error: ${error.message}`, 'error');
      } finally {
        // Reset button state
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
          publishBtn.disabled = false;
          publishBtn.textContent = 'Publish to Gallery';
        }
      }
    }
  );
}

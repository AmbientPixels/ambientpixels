/**
 * Publish a card to the public gallery
 */
async function publishCard() {
  // Check if user is signed in - ensure authModule is fully initialized
  if (!window.authModule) {
    console.error('[CardForge] Authentication module not initialized');
    showMessage('Authentication system not ready. Please refresh the page and try again.', 'error');
    return;
  }
  
  const account = window.authModule.getCurrentUser();
  if (window._config.debug) {
    console.log('[CardForge] Current user account:', account);
  }
  
  if (!account || !account.id) {
    console.error('[CardForge] User not authenticated or missing ID');
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
        // Show publishing indicator
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
          publishBtn.disabled = true;
          publishBtn.textContent = 'Publishing...';
        }
        
        // Call the cardforgepublish API with corrected path construction
        const endpoint = window.buildApiPath('cardforge/cardpublish');
        console.log('[CardForge] Publishing to endpoint:', endpoint);
        
        // Ensure we send both upper and lowercase versions of the user ID header
        // to handle any case sensitivity issues in the backend
        const publishHeaders = {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.csrfProtection.getToken()
        };
        if (window._config.environment !== 'production') {
          const devAuth = localStorage.getItem('cardforge_dev_auth');
          if (devAuth) {
            const { id: devUserId } = JSON.parse(devAuth);
            publishHeaders['X-User-ID'] = devUserId;
            if (window._config.debug) console.log(`[DEV] Added X-User-ID header for publish: ${devUserId}`);
          }
        }
        
        console.log('[CardForge] Request headers:', publishHeaders);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: publishHeaders,
          body: JSON.stringify({ cardId }),
          credentials: 'include'  // Include cookies for any session-based auth
        });
        
        console.log('[CardForge] Publish response status:', response.status);
        console.log('[CardForge] Publish response headers:', [...response.headers.entries()]);
        
        if (!response.ok) {
          // Check content type to handle non-JSON errors
          const contentType = response.headers.get('content-type');
          let errorMessage = `HTTP ${response.status}`;
          
          try {
            if (contentType && contentType.includes('application/json')) {
              const errorData = await response.json();
              console.error('[CardForge] Error response:', errorData);
              errorMessage = errorData.error || errorData.message || errorMessage;
            } else {
              const textResponse = await response.text();
              console.error('[CardForge] Error response text:', textResponse);
            }
          } catch (parseError) {
            console.error('[CardForge] Error parsing error response:', parseError);
          }
          
          throw new Error(errorMessage);
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
        console.error('[CardForge] Failed to publish card:', error);
        showMessage(`Error publishing card: ${error.message}`, 'error');
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

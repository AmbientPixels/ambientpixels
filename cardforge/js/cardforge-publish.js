/**
 * Publish a card to the public gallery
 */
async function publishCard() {
  try {
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
    
    // Get API base URL - uses the shared getApiBaseUrl() function from card-forge.js
    const apiBase = getApiBaseUrl();
    
    // Show publishing indicator
    const publishBtn = document.getElementById('publish-btn');
    if (publishBtn) {
      publishBtn.disabled = true;
      publishBtn.textContent = 'Publishing...';
    }
    
    // Call the cardforgepublish API
    const response = await fetch(`${apiBase}/api/cardforgepublish`, {
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
    
    showMessage('Card published to gallery successfully!', 'success');
    
    // Reload cards to show updated status
    loadCards();
  } catch (error) {
    console.error('Failed to publish card:', error);
    showMessage(`Error: ${error.message}`, 'error');
  } finally {
    // Reset publish button
    const publishBtn = document.getElementById('publish-btn');
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.textContent = 'Publish to Gallery';
    }
  }
}

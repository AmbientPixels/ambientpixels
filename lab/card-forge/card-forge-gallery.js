/**
 * Card Forge Gallery Module
 * Handles fetching, displaying, and filtering cards in the public gallery
 * and personal library views based on authentication state.
 */

window.CardForgeGallery = (function() {
  // Configuration
  const config = {
    apiEndpoints: {
      gallery: '/api/cardforge/cards',
      userCards: '/api/cardforge/mycards'
    },
    defaultLimit: 12,
    defaultCategory: 'all'
  };

  // DOM Elements
  let elements = {};
  
  // State
  let state = {
    galleryCards: [],
    userCards: [],
    filters: {
      category: 'all',
      sort: 'newest'
    },
    isLoading: false
  };

  /**
   * Initialize the gallery
   */
  function init() {
    console.log('Initializing Card Forge Gallery...');
    bindElements();
    bindEvents();
    updateUIForAuthState();
    
    // Load the appropriate content based on auth state
    if (window.CardForgeAuth && window.CardForgeAuth.isAuthenticated()) {
      loadUserLibrary();
    } else {
      loadGalleryCards();
    }
  }

  /**
   * Bind DOM elements
   */
  function bindElements() {
    elements = {
      galleryContainer: document.getElementById('card-forge-gallery'),
      personalLibrary: document.getElementById('card-forge-personal-library'),
      galleryFilter: document.getElementById('gallery-filter'),
      gallerySort: document.getElementById('gallery-sort'),
      galleryCards: document.getElementById('gallery-cards'),
      personalCards: document.getElementById('personal-cards'),
      loadMoreBtn: document.getElementById('load-more-gallery'),
      loadMorePersonalBtn: document.getElementById('load-more-personal')
    };
  }

  /**
   * Bind event listeners
   */
  function bindEvents() {
    // Filter events
    if (elements.galleryFilter) {
      elements.galleryFilter.addEventListener('change', (e) => {
        state.filters.category = e.target.value;
        refreshGallery();
      });
    }
    
    // Sort events
    if (elements.gallerySort) {
      elements.gallerySort.addEventListener('change', (e) => {
        state.filters.sort = e.target.value;
        refreshGallery();
      });
    }
    
    // Load more buttons
    if (elements.loadMoreBtn) {
      elements.loadMoreBtn.addEventListener('click', loadMoreGalleryCards);
    }
    
    if (elements.loadMorePersonalBtn) {
      elements.loadMorePersonalBtn.addEventListener('click', loadMoreUserCards);
    }

    // Listen for authentication state changes
    document.addEventListener('cardForgeAuthStateChanged', updateUIForAuthState);
  }

  /**
   * Update UI based on authentication state
   */
  function updateUIForAuthState() {
    const isSignedIn = window.CardForgeAuth && window.CardForgeAuth.isAuthenticated();
    
    if (elements.galleryContainer) {
      elements.galleryContainer.classList.toggle('signed-out', !isSignedIn);
      elements.galleryContainer.classList.toggle('signed-in', isSignedIn);
    }
    
    if (elements.personalLibrary) {
      elements.personalLibrary.style.display = isSignedIn ? 'block' : 'none';
    }

    // If user just signed in, load their library
    if (isSignedIn) {
      loadUserLibrary();
    } else {
      // Ensure gallery is loaded for signed out users
      if (state.galleryCards.length === 0) {
        loadGalleryCards();
      }
    }
  }

  /**
   * Fetch gallery cards from the API
   */
  function loadGalleryCards() {
    if (state.isLoading) return;
    
    state.isLoading = true;
    showLoadingState(elements.galleryCards);
    
    // Build query params
    const params = new URLSearchParams({
      category: state.filters.category !== 'all' ? state.filters.category : '',
      sort: state.filters.sort,
      limit: config.defaultLimit
    });
    
    // Log API details for debugging
    console.log(`Fetching gallery cards from: ${config.apiEndpoints.gallery}?${params.toString()}`);
    
    // Add a timeout to abort if request takes too long
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    // Fetch gallery cards with retry logic
    let retryCount = 0;
    const maxRetries = 2;
    
    const attemptFetch = () => {
      fetch(`${config.apiEndpoints.gallery}?${params.toString()}`, {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' } // Prevent caching issues
      })
        .then(response => {
          // Clear the timeout since we got a response
          clearTimeout(timeoutId);
          
          console.log(`Gallery API response: ${response.status} ${response.statusText}`);
          
          if (!response.ok) {
            if (response.status === 404) {
              console.error('API endpoint not found (404). Check if the API is deployed properly.');
            }
            throw new Error(`Failed to load gallery cards: ${response.status} ${response.statusText}`);
          }
          return response.json();
        })
        .then(data => {
          // Extract the cards array from the response data structure
          console.log('Gallery data received:', data ? 'has data' : 'no data');
          state.galleryCards = data.cards || [];
          // Store pagination information if needed
          state.galleryPagination = data.pagination || { total: 0, page: 1, limit: 20, pages: 0 };
          renderGalleryCards();
        })
        .catch(error => {
          console.error('Error loading gallery cards:', error);
          
          // Retry logic for network errors or timeouts
          if (retryCount < maxRetries && (error.name === 'AbortError' || error.name === 'TypeError')) {
            console.log(`Retrying gallery fetch (attempt ${retryCount + 1} of ${maxRetries})...`);
            retryCount++;
            setTimeout(attemptFetch, 1000 * retryCount); // Exponential backoff
          } else {
            // Show error state with details
            const errorMessage = error.message || 'Failed to load gallery cards';
            showErrorState(elements.galleryCards, errorMessage);
            
            // Add fallback content for better UX
            const fallbackEl = document.createElement('div');
            fallbackEl.className = 'gallery-fallback';
            fallbackEl.innerHTML = `
              <h3>Gallery temporarily unavailable</h3>
              <p>We're experiencing issues connecting to our servers. Please try again later.</p>
              <button id="gallery-retry-btn" class="btn btn-primary">Retry</button>
            `;
            elements.galleryCards.appendChild(fallbackEl);
            
            // Bind retry button
            document.getElementById('gallery-retry-btn')?.addEventListener('click', () => {
              loadGalleryCards();
            });
          }
        })
        .finally(() => {
          if (retryCount === 0 || retryCount >= maxRetries) {
            state.isLoading = false;
          }
        });
    };
    
    // Initial fetch attempt
    attemptFetch();
  }

  /**
   * Fetch user's personal cards
   */
  function loadUserLibrary() {
    if (!window.CardForgeAuth || !window.CardForgeAuth.isAuthenticated()) return;
    if (state.isLoading) return;
    
    state.isLoading = true;
    showLoadingState(elements.personalCards);
    
    const userId = window.CardForgeAuth.getUserId();
    if (!userId) {
      showErrorState(elements.personalCards, 'User ID not found');
      state.isLoading = false;
      return;
    }
    
    // Fetch user cards
    fetch(config.apiEndpoints.userCards, {
      headers: {
        'X-User-ID': userId
      }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load your cards');
        }
        return response.json();
      })
      .then(data => {
        state.userCards = data;
        renderUserCards();
      })
      .catch(error => {
        console.error('Error loading user cards:', error);
        showErrorState(elements.personalCards, 'Failed to load your cards');
      })
      .finally(() => {
        state.isLoading = false;
      });
  }

  /**
   * Render gallery cards to the DOM
   */
  function renderGalleryCards() {
    if (!elements.galleryCards) return;
    
    if (state.galleryCards.length === 0) {
      elements.galleryCards.innerHTML = `
        <div class="empty-state">
          <p><i class="fas fa-info-circle"></i> No cards found in the gallery.</p>
        </div>
      `;
      return;
    }
    
    elements.galleryCards.innerHTML = '';
    
    // Render each card
    state.galleryCards.forEach(card => {
      const cardElement = createCardElement(card, true);
      elements.galleryCards.appendChild(cardElement);
    });
  }

  /**
   * Render user's cards to the DOM
   */
  function renderUserCards() {
    if (!elements.personalCards) return;
    
    if (state.userCards.length === 0) {
      elements.personalCards.innerHTML = `
        <div class="empty-state">
          <p><i class="fas fa-info-circle"></i> You haven't created any cards yet.</p>
        </div>
      `;
      return;
    }
    
    elements.personalCards.innerHTML = '';
    
    // Render each card
    state.userCards.forEach(card => {
      const cardElement = createCardElement(card, false);
      elements.personalCards.appendChild(cardElement);
    });
  }

  /**
   * Create a card element
   * @param {Object} card - The card data
   * @param {boolean} isGallery - Whether this is a gallery card
   * @returns {HTMLElement} The card element
   */
  function createCardElement(card, isGallery) {
    const div = document.createElement('div');
    div.className = 'gallery-card';
    div.dataset.cardId = card.id;
    
    div.innerHTML = `
      <div class="gallery-card-inner">
        <div class="gallery-card-front">
          <img src="/images/avatars/${card.avatar || 'default.jpg'}" alt="${card.name}" class="card-avatar">
          <h3 class="card-name">${card.name || 'Unnamed Card'}</h3>
          <div class="card-badges">
            ${card.badges ? card.badges.map(badge => `<span class="badge ${badge}">${badge}</span>`).join('') : ''}
          </div>
        </div>
      </div>
      <div class="gallery-card-footer">
        ${isGallery ? `<div class="card-creator">Created by ${card.creatorName || 'Anonymous'}</div>` : ''}
        <div class="card-actions">
          ${isGallery ? 
            '<button class="card-action-btn" title="View Details"><i class="fas fa-eye"></i></button>' : 
            '<button class="card-action-btn" title="Edit Card"><i class="fas fa-edit"></i></button>'}
          <button class="card-action-btn" title="Copy Card"><i class="fas fa-copy"></i></button>
          ${!isGallery ? 
            `<button class="card-action-btn ${card.isPublic ? 'published' : ''}" title="${card.isPublic ? 'Published' : 'Publish to Gallery'}">
               <i class="fas fa-${card.isPublic ? 'check-circle' : 'cloud-upload-alt'}"></i>
             </button>` : ''}
        </div>
      </div>
    `;
    
    // Add event listeners
    const actionButtons = div.querySelectorAll('.card-action-btn');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.title.toLowerCase();
        handleCardAction(card, action, e);
      });
    });
    
    return div;
  }

  /**
   * Handle card actions (view, edit, copy, publish)
   */
  function handleCardAction(card, action, event) {
    event.stopPropagation();
    
    switch (action) {
      case 'view details':
        // Show card details modal
        console.log('View card details', card);
        break;
      case 'edit card':
        // Load card into editor
        if (window.CardForgeEditor) {
          window.CardForgeEditor.loadCard(card);
        }
        break;
      case 'copy card':
        // Create a copy in the editor
        if (window.CardForgeEditor) {
          const copiedCard = { ...card, id: null, name: `Copy of ${card.name}` };
          window.CardForgeEditor.loadCard(copiedCard);
        }
        break;
      case 'publish to gallery':
        publishCardToGallery(card);
        break;
    }
  }

  /**
   * Publish a card to the gallery
   * @param {Object} card - The card to publish
   */
  function publishCardToGallery(card) {
    // Check authentication using our updated auth module
    if (!window.CardForgeAuth || !window.CardForgeAuth.isAuthenticated()) {
      alert('You need to be signed in to publish cards to the gallery');
      return;
    }
    
    // Get user ID using our improved auth module
    const userId = window.CardForgeAuth.getUserId();
    if (!userId) {
      console.error('Cannot publish: Missing user ID');
      alert('Authentication error: Cannot identify your account. Please sign in again.');
      return;
    }
    
    // Get confirmation with clearer messaging
    if (!window.confirm(`Are you sure you want to publish "${card.name || 'this card'}" to the public gallery? Anyone will be able to view it.`)) {
      return;
    }
    
    // Show loading state if possible
    const publishBtn = document.querySelector(`[data-action="publish"][data-card-id="${card.id}"]`);
    if (publishBtn) {
      publishBtn.disabled = true;
      publishBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }
    
    // Create a clean copy for publishing (remove sensitive data)
    const publishableCard = { ...card };
    delete publishableCard.privateNotes;
    delete publishableCard.personalInfo;
    delete publishableCard.email;
    
    // Use the auth module to get proper headers
    const headers = window.CardForgeAuth.getAuthHeaders();
    
    // Call the API with improved error handling
    fetch(`/api/cardforge/cardpublish/${card.id}`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        userId: userId,
        card: publishableCard
      })
    })
    .then(response => {
      // Get text first for better error handling
      return response.text().then(text => {
        // Try to parse as JSON
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          console.error('Failed to parse response', e);
          data = {};
        }
        
        // Check if response was successful
        if (!response.ok) {
          const errorMessage = data.message || data.error || `Error ${response.status}: ${response.statusText}`;
          throw new Error(errorMessage);
        }
        
        return data;
      });
    })
    .then(data => {
      console.log('Publish successful:', data);
      
      // Update local state
      const cardIndex = state.userCards.findIndex(c => c.id === card.id);
      if (cardIndex >= 0) {
        state.userCards[cardIndex].isPublic = true;
        state.userCards[cardIndex].publishedAt = data.publishedAt || new Date().toISOString();
        renderUserCards();
      }
      
      // Load gallery to show the newly published card
      loadGalleryCards();
      
      // Show success message
      alert('Card published to gallery successfully!');
    })
    .catch(error => {
      console.error('Error publishing card:', error);
      alert(`Failed to publish card: ${error.message}`);
    })
    .finally(() => {
      // Reset UI state
      if (publishBtn) {
        publishBtn.disabled = false;
        publishBtn.innerHTML = card.isPublic ? 
          '<i class="fas fa-check-circle"></i> Published' : 
          '<i class="fas fa-cloud-upload-alt"></i> Publish';
      }
    });
  }

  /**
   * Load more gallery cards
   */
  function loadMoreGalleryCards() {
    // Implementation will be added in the future
    console.log('Load more gallery cards');
  }

  /**
   * Load more user cards
   */
  function loadMoreUserCards() {
    // Implementation will be added in the future
    console.log('Load more user cards');
  }

  /**
   * Refresh the gallery with current filters
   */
  function refreshGallery() {
    if (elements.galleryCards) {
      elements.galleryCards.innerHTML = '';
    }
    loadGalleryCards();
  }

  /**
   * Show loading state in container
   */
  function showLoadingState(container) {
    if (!container) return;
    
    container.innerHTML = `
      <div class="loading-state">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading cards...</p>
      </div>
    `;
  }

  /**
   * Show error state in container
   */
  function showErrorState(container, message) {
    if (!container) return;
    
    container.innerHTML = `
      <div class="error-state">
        <i class="fas fa-exclamation-circle"></i>
        <p>${message}</p>
      </div>
    `;
  }

  // Return public API
  return {
    init,
    loadGalleryCards,
    loadPersonalCards: loadUserLibrary, // Alias for test compatibility
    loadUserLibrary,
    refreshGallery
  };
})();

// Initialize gallery when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  if (window.CardForgeGallery) {
    window.CardForgeGallery.init();
  }
});

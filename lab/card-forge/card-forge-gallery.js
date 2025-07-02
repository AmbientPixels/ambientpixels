/**
 * Card Forge Gallery Module
 * Handles fetching, displaying, and filtering cards in the public gallery
 * and personal library views based on authentication state.
 */

window.CardForgeGallery = (function() {
  // Configuration
  const config = {
    apiEndpoints: {
      gallery: '/api/cards',
      userCards: '/api/myCards'
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
    if (window.CardForgeAuth && window.CardForgeAuth.isSignedIn()) {
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
    const isSignedIn = window.CardForgeAuth && window.CardForgeAuth.isSignedIn();
    
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
    
    // Fetch gallery cards
    fetch(`${config.apiEndpoints.gallery}?${params.toString()}`)
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load gallery cards');
        }
        return response.json();
      })
      .then(data => {
        state.galleryCards = data;
        renderGalleryCards();
      })
      .catch(error => {
        console.error('Error loading gallery cards:', error);
        showErrorState(elements.galleryCards, 'Failed to load gallery cards');
      })
      .finally(() => {
        state.isLoading = false;
      });
  }

  /**
   * Fetch user's personal cards
   */
  function loadUserLibrary() {
    if (!window.CardForgeAuth || !window.CardForgeAuth.isSignedIn()) return;
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
   */
  function publishCardToGallery(card) {
    if (!window.CardForgeAuth || !window.CardForgeAuth.isSignedIn()) {
      alert('You need to be signed in to publish cards to the gallery');
      return;
    }
    
    if (!window.confirm('Are you sure you want to publish this card to the public gallery?')) {
      return;
    }
    
    const userId = window.CardForgeAuth.getUserId();
    
    fetch(`${config.apiEndpoints.gallery}/publish/${card.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId
      },
      body: JSON.stringify({
        isPublic: true,
        category: 'general' // Default category
      })
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to publish card');
        }
        return response.json();
      })
      .then(() => {
        // Update local state
        const cardIndex = state.userCards.findIndex(c => c.id === card.id);
        if (cardIndex >= 0) {
          state.userCards[cardIndex].isPublic = true;
          renderUserCards();
        }
        alert('Card published to gallery successfully!');
      })
      .catch(error => {
        console.error('Error publishing card:', error);
        alert('Failed to publish card. Please try again.');
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

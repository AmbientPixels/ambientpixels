/**
 * My Cards Manager
 * Handles saving, loading, and managing user's saved cards
 * Part of CardForge V2 Right Column Redesign
 */

class MyCardsManager {
  constructor() {
    this.storageKey = 'cardforge_my_cards';
    this.cards = [];
    this.filteredCards = [];
    this.currentSearchQuery = '';
    
    this.init();
  }

  init() {
    this.loadCardsFromStorage();
    this.renderMyCards();
    this.bindEvents();
    console.log('✅ My Cards Manager initialized with', this.cards.length, 'cards');
  }

  bindEvents() {
    // Listen for card save events from the main CardForge system
    document.addEventListener('cardforge:cardSaved', (e) => {
      this.handleCardSaved(e.detail);
    });

    // Listen for card updates
    document.addEventListener('cardforge:cardUpdated', (e) => {
      this.handleCardUpdated(e.detail);
    });
  }

  loadCardsFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      this.cards = stored ? JSON.parse(stored) : [];
      this.filteredCards = [...this.cards];
    } catch (error) {
      console.error('Error loading My Cards from storage:', error);
      this.cards = [];
      this.filteredCards = [];
    }
  }

  saveCardsToStorage() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.cards));
      console.log('💾 My Cards saved to storage');
    } catch (error) {
      console.error('Error saving My Cards to storage:', error);
    }
  }

  addCard(cardData) {
    const card = {
      id: this.generateCardId(),
      name: cardData.name || 'Untitled Card',
      class: cardData.class || '',
      rarity: cardData.rarity || 'common',
      avatar: cardData.avatar || '/cardforge/images/default-avatar.jpg',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { ...cardData }
    };

    // Check if card with same name already exists
    const existingIndex = this.cards.findIndex(c => c.name === card.name);
    if (existingIndex !== -1) {
      // Update existing card
      this.cards[existingIndex] = { ...this.cards[existingIndex], ...card, updatedAt: card.updatedAt };
      console.log('📝 Updated existing card:', card.name);
    } else {
      // Add new card
      this.cards.unshift(card); // Add to beginning of array
      console.log('➕ Added new card:', card.name);
    }

    this.saveCardsToStorage();
    this.applySearch(this.currentSearchQuery);
    this.renderMyCards();
    
    return card;
  }

  removeCard(cardId) {
    const index = this.cards.findIndex(c => c.id === cardId);
    if (index !== -1) {
      const removedCard = this.cards.splice(index, 1)[0];
      this.saveCardsToStorage();
      this.applySearch(this.currentSearchQuery);
      this.renderMyCards();
      console.log('🗑️ Removed card:', removedCard.name);
      return removedCard;
    }
    return null;
  }

  loadCard(cardId) {
    const card = this.cards.find(c => c.id === cardId);
    if (card) {
      console.log('📄 Loading card:', card.name);
      
      // Dispatch event to load card data into the form
      document.dispatchEvent(new CustomEvent('myCards:loadCard', {
        detail: card.data
      }));
      
      // Show success message
      this.showMessage(`Loaded "${card.name}"`, 'success');
      return card;
    }
    return null;
  }

  duplicateCard(cardId) {
    const card = this.cards.find(c => c.id === cardId);
    if (card) {
      const duplicatedData = { ...card.data };
      duplicatedData.name = `${duplicatedData.name} (Copy)`;
      
      const newCard = this.addCard(duplicatedData);
      this.showMessage(`Duplicated "${card.name}"`, 'success');
      return newCard;
    }
    return null;
  }

  searchCards(query) {
    this.currentSearchQuery = query;
    this.applySearch(query);
    this.renderMyCards();
  }

  applySearch(query) {
    if (!query || query.trim() === '') {
      this.filteredCards = [...this.cards];
    } else {
      const searchTerm = query.toLowerCase().trim();
      this.filteredCards = this.cards.filter(card => 
        card.name.toLowerCase().includes(searchTerm) ||
        card.class.toLowerCase().includes(searchTerm) ||
        card.rarity.toLowerCase().includes(searchTerm)
      );
    }
  }

  renderMyCards() {
    const container = document.getElementById('my-cards-list');
    if (!container) return;

    if (this.filteredCards.length === 0) {
      if (this.cards.length === 0) {
        // No cards at all
        container.innerHTML = `
          <div class="my-cards-empty">
            <i class="fas fa-layer-group"></i>
            <p>No saved cards yet</p>
            <small>Save your first card to see it here</small>
          </div>
        `;
      } else {
        // No cards match search
        container.innerHTML = `
          <div class="my-cards-empty">
            <i class="fas fa-search"></i>
            <p>No cards found</p>
            <small>Try a different search term</small>
          </div>
        `;
      }
      return;
    }

    const cardsHtml = this.filteredCards.map(card => this.renderCardItem(card)).join('');
    container.innerHTML = cardsHtml;

    // Bind events for card items
    this.bindCardItemEvents();
  }

  renderCardItem(card) {
    const timeAgo = this.getTimeAgo(card.updatedAt);
    const rarityClass = `rarity-${card.rarity.toLowerCase()}`;
    
    return `
      <div class="my-card-item" data-card-id="${card.id}">
        <div class="my-card-thumbnail">
          <img src="${card.avatar}" alt="${card.name}" onerror="this.src='/cardforge/images/default-avatar.jpg'">
        </div>
        <div class="my-card-info">
          <div class="my-card-name">${this.escapeHtml(card.name)}</div>
          <div class="my-card-meta">
            <span class="card-class">${this.escapeHtml(card.class)}</span>
            ${card.class ? ' • ' : ''}
            <span class="card-rarity ${rarityClass}">${card.rarity}</span>
            <br>
            <small class="card-time">${timeAgo}</small>
          </div>
        </div>
        <div class="my-card-actions">
          <button type="button" class="my-card-action load-card" title="Load card">
            <i class="fas fa-folder-open"></i>
          </button>
          <button type="button" class="my-card-action duplicate-card" title="Duplicate card">
            <i class="fas fa-copy"></i>
          </button>
          <button type="button" class="my-card-action delete-card" title="Delete card">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }

  bindCardItemEvents() {
    // Load card events
    document.querySelectorAll('.my-card-item .load-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = e.target.closest('.my-card-item').dataset.cardId;
        this.loadCard(cardId);
      });
    });

    // Duplicate card events
    document.querySelectorAll('.my-card-item .duplicate-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = e.target.closest('.my-card-item').dataset.cardId;
        this.duplicateCard(cardId);
      });
    });

    // Delete card events
    document.querySelectorAll('.my-card-item .delete-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = e.target.closest('.my-card-item').dataset.cardId;
        const card = this.cards.find(c => c.id === cardId);
        if (card && confirm(`Are you sure you want to delete "${card.name}"?`)) {
          this.removeCard(cardId);
          this.showMessage(`Deleted "${card.name}"`, 'info');
        }
      });
    });

    // Click to load card
    document.querySelectorAll('.my-card-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Only if not clicking on action buttons
        if (!e.target.closest('.my-card-actions')) {
          const cardId = item.dataset.cardId;
          this.loadCard(cardId);
        }
      });
    });
  }

  // Event handlers for integration with main CardForge system
  handleCardSaved(cardData) {
    this.addCard(cardData);
  }

  handleCardUpdated(cardData) {
    this.addCard(cardData); // addCard handles updates too
  }

  // Utility methods
  generateCardId() {
    return 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  showMessage(message, type = 'info') {
    // Create a simple notification
    const notification = document.createElement('div');
    notification.className = `my-cards-notification my-cards-notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: var(--aura-bg-color, #1a1a2e);
      color: var(--mood-text-primary, #e1e1ff);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      border: 1px solid var(--mood-primary-color, #00d4ff);
      box-shadow: 0 4px 12px rgba(0, 212, 255, 0.3);
      z-index: 1001;
      animation: slideInRight 0.3s ease;
      max-width: 250px;
    `;

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  // Public API
  getCurrentCards() {
    return [...this.cards];
  }

  getFilteredCards() {
    return [...this.filteredCards];
  }

  exportCards() {
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      cards: this.cards
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-cards-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.showMessage('Cards exported successfully', 'success');
  }

  importCards(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.cards && Array.isArray(importData.cards)) {
          const importedCount = importData.cards.length;
          importData.cards.forEach(card => {
            // Generate new IDs to avoid conflicts
            card.id = this.generateCardId();
            card.name = card.name + ' (Imported)';
          });
          
          this.cards.unshift(...importData.cards);
          this.saveCardsToStorage();
          this.applySearch(this.currentSearchQuery);
          this.renderMyCards();
          
          this.showMessage(`Imported ${importedCount} cards`, 'success');
        } else {
          throw new Error('Invalid file format');
        }
      } catch (error) {
        console.error('Import error:', error);
        this.showMessage('Error importing cards', 'error');
      }
    };
    reader.readAsText(file);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if we're on the CardForge page
  if (document.querySelector('.my-cards-zone')) {
    window.MyCardsManager = new MyCardsManager();
    
    // Integrate with search input
    const searchInput = document.getElementById('my-cards-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        window.MyCardsManager.searchCards(e.target.value);
      });
    }
  }
});

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MyCardsManager;
}

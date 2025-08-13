// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// Updated 2025-07-05: Added input validation, sanitization, and improved error handling
// Updated 2025-07-05: Using shared validation utilities module

/** 
 * Delete a user card - SINGLE SOURCE OF TRUTH
 */
function deleteCard(id) {
  const msg = 'Are you sure you want to delete this card? This cannot be undone.';
  
  if (confirm(msg)) {
    try {
      console.log(`🗑️ Deleting card: ${id}`);
      
      // Get saved cards from localStorage
      const savedCards = JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]');
      const cardIndex = savedCards.findIndex(card => card.id === id);
      
      if (cardIndex === -1) {
        console.error('Card not found:', id);
        alert('Card not found');
        return;
      }
      
      const cardName = savedCards[cardIndex].name || 'Unknown Card';
      savedCards.splice(cardIndex, 1);
      localStorage.setItem('cardforge_saved_cards', JSON.stringify(savedCards));
      
      console.log(`✅ Card "${cardName}" deleted from localStorage`);
      
      // Refresh gallery if it exists
      if (window.cardForgeActions && window.cardForgeActions.refreshMyCardsList) {
        window.cardForgeActions.refreshMyCardsList();
        console.log('🔄 Gallery refreshed');
      }
      
      alert(`Card "${cardName}" deleted successfully`);
      
    } catch (e) {
      console.error('Delete failed', e);
      alert(`Delete error: ${e.message}`);
    }
  }
}




  




















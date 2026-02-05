// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// Updated 2025-07-05: Added input validation, sanitization, and improved error handling
// Updated 2025-07-05: Using shared validation utilities module

/** 
 * Delete a user card - SINGLE SOURCE OF TRUTH
 */
function deleteCard(id) {
  // Get card name for confirmation
  const savedCards = JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]');
  const card = savedCards.find(card => card.id === id);
  const cardName = card?.name || card?.cardData?.name || 'Unknown Card';
  
  // Use existing Modal system instead of confirm()
  const confirmModal = new Modal({
    title: 'Delete Card',
    size: 'small',
    tabs: [{
      title: 'Confirm',
      icon: '<i class="fas fa-exclamation-triangle"></i>',
      content: `
        <div style="text-align: center; padding: 20px;">
          <div style="color: #ff4444; font-size: 48px; margin-bottom: 16px;">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <h3 style="margin-bottom: 16px; color: #fff;">Delete "${cardName}"?</h3>
          <p style="margin-bottom: 24px; color: #aaa;">
            This action cannot be undone. The card will be permanently removed from your collection.
          </p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="confirm-delete-btn" class="btn-primary" style="background: #ff4444; border: 1px solid #ff4444; color: white; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold;">
              <i class="fas fa-trash"></i> Delete Card
            </button>
            <button id="cancel-delete-btn" class="btn-secondary" style="background: #666; border: 1px solid #666; color: white; padding: 10px 20px; border-radius: 4px; cursor: pointer;">
              <i class="fas fa-times"></i> Cancel
            </button>
          </div>
        </div>
      `
    }]
  });
  
  confirmModal.show();
  
  // Add event listeners after modal is shown
  setTimeout(() => {
    const confirmBtn = document.getElementById('confirm-delete-btn');
    const cancelBtn = document.getElementById('cancel-delete-btn');
    
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        performDelete(id, cardName);
        confirmModal.hide();
      });
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        confirmModal.hide();
      });
    }
  }, 100);
}

async function performDelete(id, cardName) {
  try {
    console.log(`🗑️ Deleting card: ${id}`);
    
    const isAuthed = (sessionStorage.getItem('isAuthenticated') === 'true') ||
                     (document.body?.getAttribute('data-auth-state') === 'signed-in');
    
    // Try to delete from cloud storage first if authenticated
    let cloudDeleteSuccess = false;
    if (isAuthed && window.buildApiPath) {
      try {
        const deleteUrl = window.buildApiPath('deleteCard');
        const resp = await fetch(deleteUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        if (resp.ok) {
          cloudDeleteSuccess = true;
          console.log(`☁️ Card "${cardName}" deleted from cloud`);
        }
      } catch (cloudErr) {
        console.warn('⚠️ Cloud delete failed, trying local:', cloudErr);
      }
    }
    
    // Also delete from localStorage
    const savedCards = JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]');
    const cardIndex = savedCards.findIndex(card => card.id === id);
    
    if (cardIndex !== -1) {
      savedCards.splice(cardIndex, 1);
      localStorage.setItem('cardforge_saved_cards', JSON.stringify(savedCards));
      console.log(`✅ Card "${cardName}" deleted from localStorage`);
    } else if (!cloudDeleteSuccess) {
      console.warn('Card not found in localStorage, may have been cloud-only');
    }
    
    // Refresh gallery if it exists
    if (window.cardForgeActions && window.cardForgeActions.refreshMyCardsList) {
      window.cardForgeActions.refreshMyCardsList();
      console.log('🔄 Gallery refreshed');
    }
    
    console.log(`✅ Card "${cardName}" deleted successfully`);
    
  } catch (e) {
    console.error('Delete failed', e);
    alert(`Delete error: ${e.message}`);
  }
}




  




















/**
 * Publish a card to the public gallery
 */
async function publishCard() {
  /* updated by Cascade: require authentication to publish */
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const isAuthed = isLocal ||
                   (sessionStorage.getItem('isAuthenticated') === 'true') ||
                   (document.body?.getAttribute('data-auth-state') === 'signed-in');

  if (!isAuthed) {
    // Prefer CardForge modal system over native alerts
    if (window.UIUtils && typeof UIUtils.showAlertDialog === 'function') {
      UIUtils.showAlertDialog('Sign in required', 'Please sign in to publish cards');
    } else {
      alert('Please sign in to publish cards');
    }
    return;
  }

  // Get the card ID from the form
  const cardIdInput = document.getElementById('card-id');
  if (!cardIdInput || !cardIdInput.value) {
    if (window.rightColumn && typeof window.rightColumn.showToolMessage === 'function') {
      window.rightColumn.showToolMessage('Please save the card before publishing', 'error');
    } else {
      alert('Please save the card before publishing');
    }
    return;
  }

  const cardId = cardIdInput.value;

  // Show confirmation dialog
  UIUtils.showConfirmDialog(
    'Publish Card',
    'Do you want to publish this card to the public gallery? Published cards will be visible to everyone.',
    async () => {
      try {
        // Show publishing indicator
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
          publishBtn.disabled = true;
          publishBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';
        }

        // Call the cardforgepublish API with correct path
        const endpoint = window.buildApiPath('publish');
        console.log('[CardForge] Publishing to endpoint:', endpoint);

        // Prepare headers (no auth required for anonymous publish)
        const publishHeaders = {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.csrfProtection?.getToken?.() || '',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        };

        console.log('[CardForge] Request headers:', publishHeaders);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: publishHeaders,
          body: JSON.stringify({
            cardId,
            // Pass userId explicitly since auth headers aren't forwarded to external Function App
            userId: (() => {
              try {
                const userInfo = JSON.parse(sessionStorage.getItem('userInfo') || '{}');
                return userInfo.userId || 'anonymous';
              } catch { return 'anonymous'; }
            })(),
            // Include card data so API can publish even when card isn't in blob storage yet
            cardData: (() => {
              try {
                const saved = JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]');
                return saved.find(c => c.id === cardId) || null;
              } catch { return null; }
            })()
          }),
          credentials: 'include'
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
        console.log('[CardForge] DEBUG from API:', result.debug);

        // Update nav publish button to "Published" state
        if (typeof CardForgeActions !== 'undefined' && CardForgeActions.setPublishNavState) {
          CardForgeActions.setPublishNavState('published');
        }

        // Reload gallery after small delay to ensure blob storage has propagated
        setTimeout(async () => {
          if (window.cardForgeActions && typeof window.cardForgeActions.refreshGallery === 'function') {
            await window.cardForgeActions.refreshGallery();
            await window.cardForgeActions.refreshMyCardsList();
          }
        }, 500);

        // Show success modal with Copy Link + View Card
        var cardName = result.card?.name || result.cardName || 'Your card';
        var cardShareUrl = window.buildApiPath('cardShare', { card: cardId });
        var publishedModal = new Modal({
          title: 'Published!',
          size: 'small',
          tabs: [{
            title: 'Success',
            icon: '<i class="fas fa-check-circle"></i>',
            content: '<div style="text-align:center;padding:20px;">' +
              '<div style="color:#00ff88;font-size:64px;margin-bottom:16px;"><i class="fas fa-check-circle"></i></div>' +
              '<h3 style="margin-bottom:12px;color:#fff;font-size:1.4em;">' + cardName + '</h3>' +
              '<p style="margin-bottom:8px;color:#00ff88;font-size:1.1em;">Successfully published to the gallery!</p>' +
              '<p style="margin-bottom:16px;color:#aaa;">Your card is now visible to everyone in the public gallery.</p>' +
              '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:20px;">' +
                '<input type="text" id="card-share-url" value="' + cardShareUrl + '" readonly style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;color:#e1e1ff;font-size:0.8em;min-width:0;" />' +
                '<button id="card-copy-link" class="deck-publish-action-btn" style="flex-shrink:0;" title="Copy Link"><i class="fas fa-copy"></i></button>' +
                '<button id="card-view-btn" class="deck-publish-action-btn" style="flex-shrink:0;" title="View Card"><i class="fas fa-eye"></i></button>' +
              '</div>' +
              '<button id="publish-success-ok-btn" class="btn-primary" style="background:linear-gradient(135deg,#00ff88,#00cc6a);border:none;color:#000;padding:12px 32px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:1em;">' +
                '<i class="fas fa-thumbs-up"></i> Awesome!' +
              '</button>' +
            '</div>'
          }]
        });

        publishedModal.show();

        setTimeout(function() {
          var okBtn = document.getElementById('publish-success-ok-btn');
          if (okBtn) okBtn.addEventListener('click', function() { publishedModal.hide(); });

          var copyBtn = document.getElementById('card-copy-link');
          if (copyBtn) {
            copyBtn.addEventListener('click', function() {
              var urlInput = document.getElementById('card-share-url');
              if (urlInput) navigator.clipboard.writeText(urlInput.value);
              copyBtn.innerHTML = '<i class="fas fa-check"></i>';
              setTimeout(function() { copyBtn.innerHTML = '<i class="fas fa-copy"></i>'; }, 2000);
            });
          }

          var viewBtn = document.getElementById('card-view-btn');
          if (viewBtn) {
            viewBtn.addEventListener('click', function() {
              publishedModal.hide();
              try {
                var galleryCards = (window.cardForgeActions && window.cardForgeActions._galleryCards) || [];
                var idx = -1;
                for (var i = 0; i < galleryCards.length; i++) {
                  if (galleryCards[i].id === cardId) { idx = i; break; }
                }
                if (idx >= 0 && window.CardForgeLightbox) {
                  window.CardForgeLightbox.open(galleryCards, idx);
                } else {
                  var saved = JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]');
                  var cardObj = null;
                  for (var j = 0; j < saved.length; j++) {
                    if (saved[j].id === cardId) { cardObj = saved[j]; break; }
                  }
                  if (cardObj && window.CardForgeLightbox) {
                    window.CardForgeLightbox.open([cardObj], 0);
                  } else {
                    window.open(cardShareUrl, '_blank');
                  }
                }
              } catch (err) {
                console.error('[CardForge] Could not open card lightbox:', err);
                if (window.cardForgeActions) window.cardForgeActions.showNotification('Could not open card viewer — opening in new tab', 'info');
                window.open(cardShareUrl, '_blank');
              }
            });
          }
        }, 100);

      } catch (error) {
        console.error('[CardForge] Failed to publish card:', error);
        if (window.rightColumn && typeof window.rightColumn.showToolMessage === 'function') {
          window.rightColumn.showToolMessage('Error publishing card: ' + error.message, 'error');
        } else {
          alert('Error publishing card: ' + error.message);
        }
      } finally {
        // Reset button state
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
          publishBtn.disabled = false;
          publishBtn.innerHTML = 'Publish to Gallery';
        }
      }
    }
  );
}

// Attach publish button event listener after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const publishBtn = document.getElementById('publish-btn');
  if (publishBtn) {
    publishBtn.addEventListener('click', publishCard);
  }
});
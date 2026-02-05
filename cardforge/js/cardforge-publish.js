/**


 * Publish a card to the public gallery


 */


async function publishCard() {


  /* updated by Cascade: require authentication to publish */


  const isAuthed = (sessionStorage.getItem('isAuthenticated') === 'true') ||
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


        


        // Show success modal
        const cardName = result.card?.name || result.cardName || 'Your card';
        const publishedModal = new Modal({
          title: 'Published!',
          size: 'small',
          tabs: [{
            title: 'Success',
            icon: '<i class="fas fa-check-circle"></i>',
            content: `
              <div style="text-align: center; padding: 20px;">
                <div style="color: #00ff88; font-size: 64px; margin-bottom: 16px;">
                  <i class="fas fa-check-circle"></i>
                </div>
                <h3 style="margin-bottom: 12px; color: #fff; font-size: 1.4em;">${cardName}</h3>
                <p style="margin-bottom: 24px; color: #00ff88; font-size: 1.1em;">
                  Successfully published to the gallery!
                </p>
                <p style="margin-bottom: 24px; color: #aaa;">
                  Your card is now visible to everyone in the public gallery.
                </p>
                <button id="publish-success-ok-btn" class="btn-primary" style="background: linear-gradient(135deg, #00ff88, #00cc6a); border: none; color: #000; padding: 12px 32px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1em;">
                  <i class="fas fa-thumbs-up"></i> Awesome!
                </button>
              </div>
            `
          }]
        });
        
        publishedModal.show();
        
        setTimeout(() => {
          const okBtn = document.getElementById('publish-success-ok-btn');
          if (okBtn) {
            okBtn.addEventListener('click', () => publishedModal.hide());
          }
        }, 100);


        


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


        if (window.rightColumn && typeof window.rightColumn.showToolMessage === 'function') {
  window.rightColumn.showToolMessage(`Error publishing card: ${error.message}`, 'error');
} else {
  alert(`Error publishing card: ${error.message}`);
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
// Ensures publishCard is bound and button is interactive (Windsurf Protocol)
document.addEventListener('DOMContentLoaded', () => {
  const publishBtn = document.getElementById('publish-btn');
  if (publishBtn) {
    publishBtn.addEventListener('click', publishCard);
  }
});
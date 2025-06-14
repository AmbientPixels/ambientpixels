// File: /js/init-contact-modal.js – Initialize Contact Modal Module

/**
 * Loads the contact form modal into the page
 */
function loadContactModal() {
  // Check if the modal container exists
  let modalContainer = document.getElementById('modal-container');
  if (!modalContainer) {
    console.error('Modal container not found. Make sure you have a <div id="modal-container"></div> in your HTML.');
    return;
  }

  // Load the contact form HTML
  fetch('/modules/get-in-touch.html')
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load contact form: ${response.status} ${response.statusText}`);
      }
      return response.text();
    })
    .then(html => {
      // Insert the modal HTML
      modalContainer.innerHTML = html;
      
      // Initialize any modal-specific JavaScript here if needed
      console.log('Contact form modal loaded successfully');
      
      // Initialize forms after modal is loaded
      if (window.initForms) {
        window.initForms();
      }
    })
    .catch(error => {
      console.error('Error loading contact form:', error);
      modalContainer.innerHTML = `
        <div class="error-message">
          <p>Failed to load contact form. Please try again later or email directly.</p>
        </div>
      `;
    });
}

// Initialize the modal when the page loads
document.addEventListener('DOMContentLoaded', loadContactModal);

// Make the load function available globally for dynamic loading if needed
window.loadContactModal = loadContactModal;

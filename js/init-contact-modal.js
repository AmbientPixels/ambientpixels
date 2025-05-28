// File: /js/init-contact-modal.js – Initialize Contact Modal Module

document.addEventListener('DOMContentLoaded', () => {
  // Inject Contact Modal
  fetch('/modules/contact-modal.html')
    .then(r => r.text())
    .then(html => {
      // Create a container for the modal if it doesn't exist
      let modalContainer = document.getElementById('modal-container');
      if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'modal-container';
        document.body.appendChild(modalContainer);
      }
      
      // Insert the modal HTML
      modalContainer.innerHTML = html;
      
      // Fix the modal ID to match what showModal() expects
      const contactModal = document.getElementById('contact-modal');
      if (contactModal) {
        contactModal.id = 'modal';
      }
    });
});

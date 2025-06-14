// File: /js/init-contact-modal.js – Initialize Contact Modal Module

// Map of form types to their HTML paths
const FORM_TYPES = {
  'contact': '/modules/contact-form.html',
  'modal': '/modules/contact-modal.html',
  'email': '/modules/email-capture-modal.html',
  'get-in-touch': '/modules/get-in-touch.html'
};

/**
 * Shows a modal by ID
 * @param {string} modalId - ID of the modal to show
 */
function showModal(modalId = 'modal') {
  // Try to find the modal
  let modal = document.getElementById(modalId);
  
  // If modal doesn't exist yet (might be loading asynchronously)
  if (!modal) {
    // Check if it's in the modal container
    const container = document.getElementById('modal-container');
    if (container && container.querySelector(`#${modalId}, .modal`)) {
      modal = container.querySelector(`#${modalId}`) || container.querySelector('.modal');
      // Fix the ID to match what we expect if needed
      if (modalId === 'modal' && modal.id !== 'modal') {
        modal.id = 'modal';
      }
    } else {
      // Modal might still be loading, try again in a moment
      console.log(`Modal ${modalId} not found, trying again in 100ms...`);
      setTimeout(() => showModal(modalId), 100);
      return;
    }
  }
  
  // Show the modal
  document.body.classList.add('modal-open');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);
}

/**
 * Closes a modal by ID
 * @param {string} modalId - ID of the modal to close
 */
function closeModal(modalId = 'modal') {
  const modal = document.getElementById(modalId) || document.querySelector('.modal');
  if (modal) {
    // Remove active class first
    modal.classList.remove('active');
    // Add hidden class after a short delay for smooth transition
    setTimeout(() => {
      modal.classList.add('hidden');
      document.body.classList.remove('modal-open');
    }, 300);
  }
}

/**
 * Loads a form into the specified container
 * @param {string} formType - Type of form to load (contact, modal, email)
 * @param {string} containerId - ID of the container to load the form into
 */
function loadForm(formType = 'modal', containerId = 'modal-container') {
  // Check if the container exists
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container with ID "${containerId}" not found.`);
    return Promise.reject(new Error(`Container "${containerId}" not found`));
  }

  // Get the form path from our types
  const formPath = FORM_TYPES[formType];
  if (!formPath) {
    const errorMsg = `Unknown form type: ${formType}. Available types: ${Object.keys(FORM_TYPES).join(', ')}`;
    console.error(errorMsg);
    return Promise.reject(new Error(errorMsg));
  }

  // Show loading state if container is empty
  if (container.children.length === 0) {
    container.innerHTML = '<div class="loading-message">Loading form...</div>';
  }

  return fetch(formPath)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load ${formType} form: ${response.status} ${response.statusText}`);
      }
      return response.text();
    })
    .then(html => {
      // Insert the form HTML
      container.innerHTML = html;
      console.log(`Successfully loaded ${formType} form into #${containerId}`);
      
      // Initialize forms if the function is available
      if (typeof window.initForms === 'function') {
        window.initForms();
      }
      
      // Return the container for chaining
      return container;
    })
    .catch(error => {
      console.error(`Error loading ${formType} form:`, error);
      container.innerHTML = `
        <div class="error-message">
          <p>Failed to load form. Please try again later or contact us directly.</p>
        </div>
      `;
      throw error; // Re-throw to allow error handling by the caller
    });
}

/**
 * Loads a modal form into the default modal container
 * @param {string} formType - Type of form to load (contact, modal, email)
 */
function loadModalForm(formType = 'modal') {
  return loadForm(formType, 'modal-container');
}

// Initialize any auto-load forms when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Auto-load forms with data-auto-form attribute
  document.querySelectorAll('[data-auto-form]').forEach(element => {
    const formType = element.dataset.autoForm;
    const containerId = element.id || 'modal-container';
    
    loadForm(formType, containerId).catch(error => {
      console.error(`Failed to auto-load form ${formType} into #${containerId}:`, error);
    });
  });

  // Close modal when clicking outside content
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      const modal = e.target.closest('.modal');
      if (modal) {
        closeModal(modal.id);
      }
    }
  });

  // Close modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal:not(.hidden)');
      if (activeModal) {
        closeModal(activeModal.id);
      }
    }
  });
});

// Make functions available globally
window.loadForm = loadForm;
window.loadModalForm = loadModalForm;
window.showModal = showModal;
window.closeModal = closeModal;

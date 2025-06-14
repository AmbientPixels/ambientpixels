// File: /js/init-contact-modal.js – Initialize Contact Modal Module

// Map of form types to their HTML paths
const FORM_TYPES = {
  'contact': '/modules/contact-form.html',
  'modal': '/modules/contact-modal.html',
  'email': '/modules/email-capture-modal.html'
};

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
});

// Make functions available globally
window.loadForm = loadForm;
window.loadModalForm = loadModalForm;

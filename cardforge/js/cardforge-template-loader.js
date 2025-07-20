// CardForge Template Loader
// Loads card templates from the API and updates the editor form
// Updated 2025-07-19: Complete rewrite for better reliability

// Create global namespace if it doesn't exist
window.CardForge = window.CardForge || {};

const TemplateLoader = {
  /**
   * Initialize the template loader
   */
  init() {
    const templateSelector = document.getElementById('card-template-type');
    if (!templateSelector) {
      console.warn('[CardForge] Template selector not found');
      return;
    }

    // Load initial template
    this.loadTemplate(templateSelector.value);
    
    // Add change event listener
    templateSelector.addEventListener('change', (e) => {
      this.loadTemplate(e.target.value);
    });
  },

  /**
   * Load a template by type
   * @param {string} templateType - Type of template to load (character, location, item)
   */
  async loadTemplate(templateType) {
    if (!templateType) {
      console.warn('[CardForge] No template type specified');
      return;
    }

    const form = document.getElementById('card-editor-form');
    if (form) {
      form.classList.add('loading');
    }

    try {
      const endpoint = window.buildApiPath('template', { type: templateType });
      console.log(`[CardForge] Loading template: ${endpoint}`);
      
      // Always use anonymous access
      let headers = {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      };
      const response = await fetch(endpoint, {
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const template = await response.json();
      if (!template || typeof template !== 'object') {
        throw new Error('Invalid template data received');
      }

      this.updateForm(template);
      console.log(`[CardForge] Template loaded:`, template);
      
    } catch (error) {
      console.error('[CardForge] Failed to load template:', error);
      this.showMessage(`Error loading template: ${error.message}`, 'error');
    } finally {
      if (form) {
        form.classList.remove('loading');
      }
    }
  },

  /**
   * Update form with template data
   * @param {Object} template - Template data
   */
  updateForm(template) {
    const form = document.getElementById('card-editor-form');
    if (!form) return;

    // Update form fields
    const fields = template.fields || {};
    Object.entries(fields).forEach(([fieldId, fieldData]) => {
      const input = document.getElementById(fieldId);
      if (!input) return;

      // Update input properties
      if (fieldData.placeholder) input.placeholder = fieldData.placeholder;
      if (fieldData.value !== undefined) input.value = fieldData.value;
      if (fieldData.title) input.title = fieldData.title;

      // Update corresponding label if it exists
      const label = document.querySelector(`label[for="${fieldId}"]`);
      if (label && fieldData.label) {
        label.textContent = fieldData.label;
      }
    });

    // Update form title if it exists
    const formTitle = document.querySelector('.cardforge-editor h2');
    if (formTitle && template.name) {
      formTitle.textContent = `${template.name} Details`;
    }

    // Trigger input event to update preview
    form.dispatchEvent(new Event('input', { bubbles: true }));
  },

  /**
   * Show a message to the user
   * @param {string} message - Message to display
   * @param {string} type - Message type (info, success, error)
   */
  showMessage(message, type = 'info') {
    if (window.UIUtils && typeof window.UIUtils.showMessage === 'function') {
      window.UIUtils.showMessage(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
      // Fallback to browser alert if no UI utils available
      if (type === 'error') {
        alert(`Error: ${message}`);
      }
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Expose to global scope
  window.CardForge.TemplateLoader = TemplateLoader;
  
  // Initialize the template loader
  TemplateLoader.init();
});
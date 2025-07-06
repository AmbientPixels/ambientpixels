// CardForge Template Loader
// Loads card templates from the API and updates the editor form
// Updated 2025-07-06: Initial implementation

(function() {
  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    initTemplateLoader();
  });

  function initTemplateLoader() {
    const templateSelector = document.getElementById('card-template-type');
    if (templateSelector) {
      // Load initial template
      loadTemplateForType(templateSelector.value);
      
      // Add change event listener
      templateSelector.addEventListener('change', (e) => {
        loadTemplateForType(e.target.value);
      });
    }
  }

  // Helper to determine API base URL based on environment
  function getApiBaseUrl() {
    // Check if window._config exists (for custom API paths)
    if (window._config && window._config.apiBasePath) {
        return window._config.apiBasePath;
    }
    
    // Default: use relative paths (will be handled by Azure Static Web Apps)
    return '';
  }

  /**
   * Loads a template for the specified card type and updates the form
   * @param {string} templateType - The type of template to load (character, location, item)
   */
  async function loadTemplateForType(templateType) {
    try {
      // Show loading state
      const form = document.getElementById('card-editor-form');
      if (form) {
        form.classList.add('loading');
      }
      
      // Get API base URL
      const apiBase = getApiBaseUrl();
      
      // Fetch template from API
      const response = await fetch(`${apiBase}/api/cardforgetemplate?type=${templateType}`);
      
      if (!response.ok) {
        throw new Error(`Failed to load template: ${response.status}`);
      }
      
      const template = await response.json();
      
      // Update form placeholders and help text based on template
      updateFormWithTemplate(template);
      
      // Log success
      console.log(`[CardForge] Loaded template for ${templateType}`);
      
      // Trigger preview update if button exists
      const previewBtn = document.getElementById('preview-btn');
      if (previewBtn) {
        previewBtn.click();
      }
    } catch (error) {
      console.error(`[CardForge] Error loading template: ${error.message}`);
      showMessage(`Failed to load template: ${error.message}`, 'error');
    } finally {
      // Remove loading state
      const form = document.getElementById('card-editor-form');
      if (form) {
        form.classList.remove('loading');
      }
    }
  }

  /**
   * Updates the form fields with template data
   * @param {object} template - The template object from the API
   */
  function updateFormWithTemplate(template) {
    if (!template) return;
    
    // Update name field
    const nameInput = document.getElementById('card-name');
    if (nameInput) {
      nameInput.placeholder = template.fields.name.placeholder || 'Name';
      nameInput.title = template.fields.name.description || '';
    }
    
    // Update class/type field
    const classInput = document.getElementById('card-class');
    if (classInput) {
      classInput.placeholder = template.fields.class.placeholder || 'Class/Type';
      classInput.title = template.fields.class.description || '';
    }
    
    // Update quote/description field
    const quoteInput = document.getElementById('card-quote');
    if (quoteInput) {
      quoteInput.placeholder = template.fields.quote.placeholder || 'Description';
      quoteInput.title = template.fields.quote.description || '';
    }
    
    // Update avatar/image field
    const avatarInput = document.getElementById('card-avatar');
    if (avatarInput) {
      avatarInput.placeholder = template.fields.avatar.placeholder || 'Image URL';
      avatarInput.title = template.fields.avatar.description || '';
    }
    
    // Update form title if it exists
    const formTitle = document.querySelector('.cardforge-editor h2');
    if (formTitle) {
      formTitle.textContent = `${template.name} Details`;
    }
    
    // Update form labels to match template field names
    updateFormLabels(template);
  }
  
  /**
   * Updates form labels to match template field names
   * @param {object} template - The template object from the API
   */
  function updateFormLabels(template) {
    // Update name label
    const nameLabel = document.querySelector('label[for="card-name"]');
    if (nameLabel) {
      nameLabel.textContent = template.fields.name.label || 'Name';
    }
    
    // Update class/type label
    const classLabel = document.querySelector('label[for="card-class"]');
    if (classLabel) {
      classLabel.textContent = template.fields.class.label || 'Class/Type';
    }
    
    // Update quote/description label
    const quoteLabel = document.querySelector('label[for="card-quote"]');
    if (quoteLabel) {
      quoteLabel.textContent = template.fields.quote.label || 'Description';
    }
    
    // Update avatar/image label
    const avatarLabel = document.querySelector('label[for="card-avatar"]');
    if (avatarLabel) {
      avatarLabel.textContent = template.fields.avatar.label || 'Image URL';
    }
  }

  /**
   * Shows a message to the user
   * @param {string} message - The message to display
   * @param {string} type - The type of message ('success', 'error', 'info')
   */
  function showMessage(message, type = 'info') {
    // Check if the showMessage function exists in the global scope
    if (typeof window.showMessage === 'function') {
      window.showMessage(message, type);
    } else {
      console.log(`[CardForge] ${type.toUpperCase()}: ${message}`);
    }
  }
})();

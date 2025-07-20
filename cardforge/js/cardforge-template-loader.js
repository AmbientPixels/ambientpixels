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

  // We now use the global buildApiPath helper from card-forge.js
  // No need for a local getApiBaseUrl duplicate

  /**
   * Loads a template for the specified card type and updates the form
   * @param {string} templateType - The type of template to load (character, location, item)
   */
  async function loadTemplateForType(templateType) {
    const form = document.getElementById('card-editor-form');
    if (form) {
      form.classList.add('loading');
    }

    try {
      const endpoint = window.buildApiPath(`cardforgetemplate?type=${encodeURIComponent(templateType)}`);
      console.log(`[CardForge] Loading template from endpoint: ${endpoint}`);
      
      const response = await fetch(endpoint, {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'  // Helps identify AJAX requests
        }
      });
      
      const contentType = response.headers.get('content-type') || '';
      
      // Check if response is HTML (indicating a redirect to login or error page)
      if (contentType.includes('text/html')) {
        const text = await response.text();
        if (text.includes('signin') || text.includes('login')) {
          throw new Error('Authentication required. Please sign in.');
        }
        throw new Error('Unexpected HTML response from server');
      }
      let template;
      
      if (!response.ok) {
        // Try to parse error response as JSON, fallback to text if not JSON
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.message || `Failed to load template: HTTP ${response.status}`);
        } catch (e) {
          // If response is HTML, it might be a login page or error page
          if (contentType.includes('text/html')) {
            throw new Error('Authentication required or server error. Please check your login status.');
          }
          throw new Error(`Failed to load template: ${errorText || `HTTP ${response.status}`}`);
        }
      }
      
      // Check if response is JSON
      if (!contentType.includes('application/json')) {
        const responseText = await response.text();
        console.warn(`[CardForge] Expected JSON but got:`, responseText.substring(0, 100));
        throw new Error('Invalid response format from server');
      }
      
      template = await response.json();
      
      if (!template || typeof template !== 'object') {
        throw new Error('Invalid template data received');
      }
      
      updateFormWithTemplate(template);
      console.log(`[CardForge] Loaded template for ${templateType}`, template);
      
      // Trigger preview update if button exists
      const previewBtn = document.getElementById('preview-btn');
      if (previewBtn) {
        // Bypass confirmation modal when auto-loading template
        window.__cardforgeSkipConfirm = true;
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

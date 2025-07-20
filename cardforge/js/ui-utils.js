/**
 * UI Utility Functions for CardForge
 * Created: 2025-07-19
 * 
 * Shared UI functions like dialogs and form handling
 */

(function(global) {
  'use strict';

  // Check if UIUtils is already defined
  if (global.UIUtils) {
    console.warn('UIUtils is already defined. Skipping redefinition.');
    return;
  }

  /**
   * Shows a confirmation dialog
   * @param {string} title - Dialog title
   * @param {string} message - Dialog message
   * @param {Function} onConfirm - Callback when user confirms
   * @param {Function} [onCancel] - Optional cancel callback
   */
  function showConfirmDialog(title, message, onConfirm, onCancel) {
    const dialog = document.getElementById('cardforge-dialog');
    if (!dialog) {
      console.error('Dialog element not found');
      onConfirm();
      return;
    }

    // Set dialog content
    const titleEl = dialog.querySelector('#dialog-title');
    const messageEl = dialog.querySelector('#dialog-message');
    const confirmBtn = dialog.querySelector('#dialog-confirm');
    const cancelBtn = dialog.querySelector('#dialog-cancel');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    // Remove previous event listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Show dialog
    dialog.style.display = 'block';

    // Setup confirm handler
    newConfirmBtn.onclick = () => {
      dialog.style.display = 'none';
      if (typeof onConfirm === 'function') {
        onConfirm();
      }
    };

    // Setup cancel handler
    newCancelBtn.onclick = () => {
      dialog.style.display = 'none';
      if (typeof onCancel === 'function') {
        onCancel();
      }
    };
  }

  /**
   * Clears all validation errors from the form
   */
  function clearValidationErrors() {
    // Remove existing error messages
    const errorMessages = document.querySelectorAll('.error-message');
    errorMessages.forEach(el => el.remove());

    // Remove error classes from inputs
    const errorInputs = document.querySelectorAll('.error');
    errorInputs.forEach(el => el.classList.remove('error'));
  }

  /**
   * Shows validation errors in the form
   * @param {Array} errors - Array of error messages
   */
  function showValidationErrors(errors) {
    clearValidationErrors();
    
    if (!errors || !errors.length) return;

    // Create error container if it doesn't exist
    let errorContainer = document.getElementById('error-container');
    if (!errorContainer) {
      errorContainer = document.createElement('div');
      errorContainer.id = 'error-container';
      errorContainer.className = 'error-message';
      const form = document.getElementById('card-editor-form');
      if (form) {
        form.insertBefore(errorContainer, form.firstChild);
      }
    }

    // Add error messages
    errorContainer.innerHTML = `
      <p><strong>Please fix the following errors:</strong></p>
      <ul>
        ${errors.map(error => `<li>${error}</li>`).join('')}
      </ul>
    `;
  }

  // Create the UIUtils object
  const UIUtils = {
    showConfirmDialog,
    clearValidationErrors,
    showValidationErrors
  };

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIUtils;
  } else {
    global.UIUtils = UIUtils;
  }

})(typeof window !== 'undefined' ? window : this);

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
      // Fallback to native confirm if dialog element is missing
      if (confirm(`${title}\n\n${message}`)) {
        onConfirm && onConfirm();
      } else {
        onCancel && onCancel();
      }
      return;
    }

    // Set dialog content
    const titleEl = dialog.querySelector('#cardforge-dialog-title');
    const messageEl = dialog.querySelector('#cardforge-dialog-message');
    const confirmBtn = dialog.querySelector('#cardforge-dialog-confirm');
    const cancelBtn = dialog.querySelector('#cardforge-dialog-cancel');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    // Clone buttons to remove any existing event listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);

    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Set up new event listeners
    const handleConfirm = () => {
      dialog.classList.remove('active');
      onConfirm && onConfirm();
      // Clean up event listeners
      newConfirmBtn.removeEventListener('click', handleConfirm);
      newCancelBtn.removeEventListener('click', handleCancel);
    };

    const handleCancel = () => {
      dialog.classList.remove('active');
      onCancel && onCancel();
      // Clean up event listeners
      newConfirmBtn.removeEventListener('click', handleConfirm);
      newCancelBtn.removeEventListener('click', handleCancel);
    };

    newConfirmBtn.addEventListener('click', handleConfirm);
    newCancelBtn.addEventListener('click', handleCancel);

    // Add escape key handler
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Show dialog by adding 'active' class
    dialog.classList.add('active');
    
    // Focus the confirm button for better keyboard navigation
    setTimeout(() => newConfirmBtn.focus(), 100);
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
  /**
   * Shows a single-button alert dialog (OK only)
   * @param {string} title - Dialog title
   * @param {string} message - Dialog message
   * @param {Function} [onClose] - Optional callback when closed
   */
  function showAlertDialog(title, message, onClose) {
    const dialog = document.getElementById('cardforge-dialog');
    if (!dialog) {
      alert(`${title}\n\n${message}`);
      onClose && onClose();
      return;
    }
    const titleEl = dialog.querySelector('#cardforge-dialog-title');
    const messageEl = dialog.querySelector('#cardforge-dialog-message');
    const confirmBtn = dialog.querySelector('#cardforge-dialog-confirm');
    const cancelBtn = dialog.querySelector('#cardforge-dialog-cancel');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    // Hide cancel, relabel confirm
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (confirmBtn) confirmBtn.textContent = 'OK';
    // Clone confirm to remove prior listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    // Show dialog
    dialog.classList.add('active');
    newConfirmBtn.focus();
    const handleClose = () => {
      dialog.classList.remove('active');
      if (cancelBtn) cancelBtn.style.display = '';
      if (newConfirmBtn) newConfirmBtn.textContent = 'Confirm';
      onClose && onClose();
      newConfirmBtn.removeEventListener('click', handleClose);
      document.removeEventListener('keydown', escListener);
    };
    const escListener = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    newConfirmBtn.addEventListener('click', handleClose);
    document.addEventListener('keydown', escListener);
  }

  const UIUtils = {
    showConfirmDialog,
    showAlertDialog,
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

// Global form handler for all forms with class 'js-form-handler'
document.addEventListener('DOMContentLoaded', function() {
  // Initialize all forms with the js-form-handler class
  const forms = document.querySelectorAll('.js-form-handler');
  
  forms.forEach(form => {
    form.addEventListener('submit', handleFormSubmit);
  });
});

/**
 * Handles form submission for all forms
 * @param {Event} e - The submit event
 */
async function handleFormSubmit(e) {
  e.preventDefault();
  
  const form = e.target;
  const formId = form.id || 'form';
  const submitButton = form.querySelector('button[type="submit"]');
  const formStatus = form.querySelector('.form-status');
  
  if (!submitButton) return;
  
  // Show loading state
  const originalButtonText = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
  
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      // Success
      if (formStatus) {
        formStatus.textContent = 'Message sent successfully!';
        formStatus.className = 'form-status success';
      }
      
      // Reset form
      form.reset();
      
      // Close modal if this is a modal form
      const modal = form.closest('.modal');
      if (modal) {
        setTimeout(() => {
          closeModal(modal.id);
          // Reset status after modal closes
          if (formStatus) {
            setTimeout(() => {
              formStatus.textContent = '';
              formStatus.className = 'form-status';
            }, 300);
          }
        }, 2000);
      }
    } else {
      throw new Error('Form submission failed');
    }
  } catch (error) {
    console.error(`Form ${formId} submission error:`, error);
    if (formStatus) {
      formStatus.textContent = 'Error sending message. Please try again or email directly.';
      formStatus.className = 'form-status error';
    }
  } finally {
    // Reset button state
    submitButton.disabled = false;
    submitButton.innerHTML = originalButtonText;
    
    // Scroll to status message if it exists
    if (formStatus) {
      formStatus.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

// Make the form handler function available globally
window.handleFormSubmit = handleFormSubmit;

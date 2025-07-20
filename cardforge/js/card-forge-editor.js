// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// CardForge Editor logic – MVP preview only
// Updated 2025-07-05: Now using shared validation utilities

(function(){
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const quoteInput = document.getElementById('card-quote');
  const avatarInput = document.getElementById('card-avatar');
  // Card preview functionality for CardForge editor
  // Updated 2025-07-05: Added XSS protection with sanitization

  window.addEventListener('DOMContentLoaded', () => {
    const previewBtn = document.getElementById('preview-btn');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        if (typeof UIUtils !== 'undefined' && typeof UIUtils.showConfirmDialog === 'function') {
          UIUtils.showConfirmDialog(
            'Preview Card',
            'Do you want to preview this card?',
            updatePreview
          );
        } else {
          // Fallback to direct preview if UIUtils is not available
          console.warn('UIUtils not available, showing preview directly');
          updatePreview();
        }
      });
    }
  });

  // We now use the shared ValidationUtils.sanitizeString method instead of a local sanitizeHtml function

  /**
   * Creates a DOM element with sanitized content
   * @param {string} tag - HTML tag name
   * @param {object} attributes - Element attributes
   * @param {string|HTMLElement|Array} children - Child content or elements
   * @returns {HTMLElement} - Created DOM element
   */
  function createElement(tag, attributes = {}, children = null) {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        element.setAttribute(key, value);
      }
    });
    
    // Add children
    if (children !== null) {
      if (typeof children === 'string') {
        element.textContent = children;
      } else if (children instanceof HTMLElement) {
        element.appendChild(children);
      } else if (Array.isArray(children)) {
        children.forEach(child => {
          if (child instanceof HTMLElement) {
            element.appendChild(child);
          } else if (child) {
            element.appendChild(document.createTextNode(String(child)));
          }
        });
      }
    }
    
    return element;
  }

  function updatePreview() {
    const name = document.getElementById('card-name').value;
    const cardClass = document.getElementById('card-class').value;
    const quote = document.getElementById('card-quote').value;
    const avatar = document.getElementById('card-avatar').value;
    
    const preview = document.getElementById('card-preview');
    if (!preview) return;
    
    // Clear existing preview
    preview.innerHTML = '';
    
    // Create card preview content container
    const previewContent = createElement('div', { class: 'card-preview-content' });
    
    // Create card header with avatar and name
    const cardHeader = createElement('div', { class: 'card-header' });
    
    // Add avatar if provided
    if (avatar) {
      // Validate URL using our shared validation utility
      if (ValidationUtils.isValidImageUrl(avatar)) {
        const avatarImg = createElement('img', { 
          src: avatar,
          class: 'card-avatar', 
          alt: `${ValidationUtils.sanitizeString(name)}'s Avatar` 
        });
        cardHeader.appendChild(avatarImg);
      } else {
        console.warn('Invalid avatar URL');
        // Create placeholder for invalid URL
        const placeholderDiv = createElement('div', { 
          class: 'card-avatar card-avatar-placeholder' 
        }, '?');
        cardHeader.appendChild(placeholderDiv);
      }
    }
    
    // Add name
    const nameHeader = createElement('h3', {}, name || 'Card Name');
    cardHeader.appendChild(nameHeader);
    previewContent.appendChild(cardHeader);
    
    // Add class badge if provided
    if (cardClass) {
      const badgeDiv = createElement('div', { class: 'card-badge' }, cardClass);
      previewContent.appendChild(badgeDiv);
    }
    
    // Add quote if provided
    if (quote) {
      const quoteBlock = createElement('blockquote', { class: 'card-quote' }, quote);
      previewContent.appendChild(quoteBlock);
    }
    
    // Add the constructed preview to the container
    preview.appendChild(previewContent);
  }
})();

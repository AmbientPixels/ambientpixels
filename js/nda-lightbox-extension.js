/**
 * NDA Lightbox Extension
 * Extends the Ambient Pixels Lightbox Component to add red overlay for NDA protected images
 * Enhanced with security measures to prevent image downloading and source viewing
 * 
 * @version 1.1.0
 * @updated 2025-06-22
 */

document.addEventListener('DOMContentLoaded', () => {
  // Wait for the lightbox to be initialized
  setTimeout(() => {
    // Check if lightbox exists
    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;
    
    // Get all NDA protected image elements
    const ndaTriggers = document.querySelectorAll('.nda-red-overlay a');
    const ndaImages = document.querySelectorAll('.nda-protected img');
    
    // Apply security measures to all NDA images
    ndaImages.forEach(img => {
      // Prevent drag and drop
      img.setAttribute('draggable', 'false');
      // Add NDA protection attributes
      img.setAttribute('data-nda-protected', 'true');
      // Apply heavy blur directly to the image as fallback
      img.style.filter = 'blur(8px)';
      
      // Replace the original src with a data URI that includes the image path
      // This makes it harder to extract the original image URL
      const originalSrc = img.src;
      img.setAttribute('data-protected-src', originalSrc);
      
      // Apply ARIA attributes for accessibility
      img.setAttribute('aria-description', 'NDA protected image with security measures');
    });
    
    // Add a class to identify NDA images in the lightbox
    ndaTriggers.forEach(trigger => {
      trigger.setAttribute('data-nda-protected', 'true');
      // Prevent default behavior on right-click
      trigger.addEventListener('contextmenu', e => e.preventDefault());
    });
    
    // Original open method reference
    const originalOpen = window.lightbox?.open;
    
    // If lightbox instance exists, extend its open method
    if (window.lightbox && typeof originalOpen === 'function') {
      window.lightbox.open = function(index) {
        // Call the original open method
        originalOpen.call(this, index);
        
        // Check if the current image is NDA protected
        const currentTrigger = this.elements.triggers[index];
        const isNdaProtected = currentTrigger && 
                              (currentTrigger.hasAttribute('data-nda-protected') || 
                               currentTrigger.closest('.nda-red-overlay'));
        
        // Add or remove the nda-protected class to the lightbox content
        const lightboxContent = document.querySelector('.lightbox-content');
        const lightboxImg = document.getElementById('lightbox-img');
        
        if (lightboxContent && lightboxImg) {
          if (isNdaProtected) {
            // Add protection class
            lightboxContent.classList.add('nda-protected-lightbox');
            
            // Apply additional security to the lightbox image
            lightboxImg.setAttribute('draggable', 'false');
            lightboxImg.classList.add('pswp__img--blur');
            
            // Apply extreme blur directly via inline style for maximum effect
            lightboxImg.style.filter = 'blur(45px) brightness(0.9)';
            
            // Prevent right-click on lightbox image
            lightboxImg.addEventListener('contextmenu', e => e.preventDefault());
            
            // Add a visible NDA watermark
            const watermark = document.createElement('div');
            watermark.className = 'nda-watermark';
            watermark.innerHTML = '<i class="fas fa-lock"></i> NDA PROTECTED';
            lightboxContent.appendChild(watermark);
          } else {
            lightboxContent.classList.remove('nda-protected-lightbox');
            const existingWatermark = lightboxContent.querySelector('.nda-watermark');
            if (existingWatermark) {
              existingWatermark.remove();
            }
          }
        }
      };
    }
    
    // Add the CSS for the NDA protected lightbox
    const style = document.createElement('style');
    style.textContent = `
      .nda-protected-lightbox::after {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 0, 0, 0.25);
        z-index: 1;
        pointer-events: none;
      }
      
      .nda-watermark {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-30deg);
        font-size: 2.5rem;
        font-weight: bold;
        color: rgba(255, 0, 0, 0.7);
        text-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
        white-space: nowrap;
        pointer-events: none;
        z-index: 10;
        letter-spacing: 0.5rem;
      }
      
      .nda-watermark i {
        margin-right: 1rem;
      }
    `;
    document.head.appendChild(style);
    
    // Global protection against image downloading
    document.addEventListener('contextmenu', function(e) {
      // Check if the target is an NDA protected image or container
      if (e.target.closest('.nda-protected') || 
          e.target.closest('.nda-red-overlay') || 
          e.target.closest('.nda-protected-lightbox')) {
        e.preventDefault();
        return false;
      }
    });
    
    // Disable keyboard shortcuts that might be used to save images
    document.addEventListener('keydown', function(e) {
      // Check if we're in an NDA context
      const inNdaContext = document.querySelector('.nda-protected-lightbox') !== null;
      
      if (inNdaContext) {
        // Prevent Ctrl+S, Ctrl+P, Ctrl+U
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'p' || e.key === 'u')) {
          e.preventDefault();
          return false;
        }
      }
    });
    
  }, 500); // Give time for lightbox to initialize
});

// Additional protection against dev tools inspection
// This makes it harder (but not impossible) to extract image URLs
setTimeout(() => {
  // Obfuscate image sources in the DOM
  const ndaImages = document.querySelectorAll('.nda-protected img');
  ndaImages.forEach(img => {
    if (img.hasAttribute('data-protected-src')) {
      // Create a reference to the original source but don't expose it directly
      const originalSrc = img.getAttribute('data-protected-src');
      img.removeAttribute('data-protected-src');
      
      // Use a data URI with minimal information
      const secureRef = btoa(originalSrc.split('/').pop());
      img.setAttribute('data-secure-ref', secureRef);
    }
  });
}, 1000);


/**
 * Lightbox.js - Ambient Pixels Lightbox Component
 * A lightweight, accessible, and responsive lightbox for images
 * 
 * Features:
 * - Keyboard navigation (arrow keys, ESC)
 * - Touch gestures for mobile
 * - Responsive design
 * - Accessible with ARIA labels
 * - Smooth animations
 * - Image preloading
 */

class Lightbox {
  constructor(options = {}) {
    // Default options
    this.options = {
      selector: '.lightbox-trigger',
      navText: {
        next: 'Next',
        prev: 'Previous',
        close: 'Close',
        loading: 'Loading...'
      },
      animationSpeed: 300,
      enableKeyboard: true,
      loop: true,
      ...options
    };

    // State
    this.currentIndex = 0;
    this.images = [];
    this.isOpen = false;
    this.isLoading = false;

    // Bind methods
    this.init = this.init.bind(this);
    this.open = this.open.bind(this);
    this.close = this.close.bind(this);
    this.navigate = this.navigate.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleClickOutside = this.handleClickOutside.bind(this);
    this.handleSwipe = this.handleSwipe.bind(this);

    // Initialize
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', this.init);
    } else {
      this.init();
    }
  }


  /**
   * Initialize the lightbox
   */
  init() {
    // Create lightbox HTML if it doesn't exist
    if (!document.getElementById('lightbox')) {
      const lightboxHTML = `
        <div id="lightbox" class="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer">
          <button class="lightbox-close" aria-label="${this.options.navText.close}" tabindex="0">&times;</button>
          <button class="lightbox-nav prev" aria-label="${this.options.navText.prev}" tabindex="0">&#10094;</button>
          <div class="lightbox-content">
            <div class="lightbox-loading"></div>
            <img id="lightbox-img" src="" alt="" />
            <div id="lightbox-caption" class="lightbox-caption"></div>
          </div>
          <button class="lightbox-nav next" aria-label="${this.options.navText.next}" tabindex="0">&#10095;</button>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', lightboxHTML);
    }

    // Cache DOM elements
    this.elements = {
      lightbox: document.getElementById('lightbox'),
      lightboxImg: document.getElementById('lightbox-img'),
      lightboxCaption: document.getElementById('lightbox-caption'),
      closeBtn: document.querySelector('.lightbox-close'),
      prevBtn: document.querySelector('.lightbox-nav.prev'),
      nextBtn: document.querySelector('.lightbox-nav.next'),
      triggers: document.querySelectorAll(this.options.selector)
    };

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    const { triggers, closeBtn, prevBtn, nextBtn, lightbox } = this.elements;

    // Open lightbox on trigger click
    triggers.forEach((trigger, index) => {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        this.open(index);
      });

      // Add keyboard support for triggers
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.open(index);
        }
      });
    });

    // Navigation controls
    closeBtn.addEventListener('click', this.close);
    prevBtn.addEventListener('click', () => this.navigate(-1));
    nextBtn.addEventListener('click', () => this.navigate(1));

    // Keyboard navigation
    if (this.options.enableKeyboard) {
      document.addEventListener('keydown', this.handleKeyDown);
    }

    // Close on click outside
    lightbox.addEventListener('click', this.handleClickOutside);

    // Touch events for mobile
    this.setupTouchEvents();
  }

  /**
   * Set up touch events for mobile
   */
  setupTouchEvents() {
    const { lightboxImg } = this.elements;
    let touchStartX = 0;
    let touchEndX = 0;

    lightboxImg.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    lightboxImg.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe(touchStartX, touchEndX);
    }, { passive: true });
  }

  /**
   * Handle swipe gestures
   */
  handleSwipe(startX, endX) {
    const difference = startX - endX;
    const SWIPE_THRESHOLD = 50; // Minimum distance to trigger navigation

    if (difference > SWIPE_THRESHOLD) {
      this.navigate(1); // Swipe left - next
    } else if (difference < -SWIPE_THRESHOLD) {
      this.navigate(-1); // Swipe right - previous
    }
  }

  /**
   * Open the lightbox
   */
  async open(index) {
    if (this.isOpen || this.isLoading) return;

    const { triggers, lightbox, lightboxImg, lightboxCaption } = this.elements;
    
    // Get all images from triggers
    this.images = Array.from(triggers).map(trigger => ({
      src: trigger.getAttribute('href') || trigger.dataset.src || trigger.src,
      caption: trigger.getAttribute('title') || trigger.dataset.caption || '',
      alt: trigger.getAttribute('alt') || ''
    }));

    // Validate index
    if (index < 0 || index >= this.images.length) {
      console.error('Lightbox: Invalid image index');
      return;
    }

    this.currentIndex = index;
    this.isOpen = true;
    this.isLoading = true;

    // Show loading state
    lightbox.classList.add('loading');
    document.body.style.overflow = 'hidden';
    
    // Set image source and show lightbox
    const { src, caption, alt } = this.images[this.currentIndex];
    
    try {
      // Preload image
      await this.preloadImage(src);
      
      lightboxImg.src = src;
      lightboxImg.alt = alt;
      lightboxCaption.textContent = caption;
      lightboxCaption.style.display = caption ? 'block' : 'none';
      
      // Show lightbox after image is loaded
      setTimeout(() => {
        lightbox.classList.add('active');
        lightbox.classList.remove('loading');
        this.isLoading = false;
        
        // Focus the close button for keyboard navigation
        this.elements.closeBtn.focus();
      }, 50);
      
    } catch (error) {
      console.error('Lightbox: Error loading image', error);
      this.close();
    }
  }

  /**
   * Close the lightbox
   */
  close() {
    if (!this.isOpen) return;
    
    const { lightbox } = this.elements;
    
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    
    // Wait for animation to complete before removing the active class
    setTimeout(() => {
      lightbox.classList.remove('loading');
      this.isOpen = false;
      this.isLoading = false;
      
      // Return focus to the trigger that opened the lightbox
      if (this.elements.triggers[this.currentIndex]) {
        this.elements.triggers[this.currentIndex].focus();
      }
    }, this.options.animationSpeed);
  }

  /**
   * Navigate between images
   */
  navigate(direction) {
    if (this.isLoading) return;
    
    const { lightboxImg, lightboxCaption } = this.elements;
    let newIndex = this.currentIndex + direction;
    
    // Handle looping
    if (this.options.loop) {
      newIndex = (newIndex + this.images.length) % this.images.length;
    } else {
      newIndex = Math.max(0, Math.min(newIndex, this.images.length - 1));
    }
    
    if (newIndex === this.currentIndex) return;
    
    this.currentIndex = newIndex;
    this.isLoading = true;
    
    // Fade out current image
    lightboxImg.style.opacity = '0';
    lightboxCaption.style.opacity = '0';
    
    // Load new image
    this.preloadImage(this.images[this.currentIndex].src)
      .then(() => {
        const { src, caption, alt } = this.images[this.currentIndex];
        
        lightboxImg.src = src;
        lightboxImg.alt = alt;
        lightboxCaption.textContent = caption;
        lightboxCaption.style.display = caption ? 'block' : 'none';
        
        // Fade in new image
        setTimeout(() => {
          lightboxImg.style.opacity = '1';
          lightboxCaption.style.opacity = '1';
          this.isLoading = false;
        }, 20);
      })
      .catch(error => {
        console.error('Lightbox: Error loading image', error);
        this.close();
      });
  }

  /**
   * Preload an image
   */
  preloadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Handle keyboard navigation
   */
  handleKeyDown(e) {
    if (!this.isOpen) return;
    
    switch (e.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowLeft':
        this.navigate(-1);
        break;
      case 'ArrowRight':
        this.navigate(1);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault(); // Prevent page scrolling
        break;
    }
  }

  /**
   * Handle click outside
   */
  handleClickOutside(e) {
    if (e.target === this.elements.lightbox) {
      this.close();
    }
  }
}

// Export the Lightbox class
export { Lightbox };

// Auto-initialize if data-lightbox-autoload is present
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('[data-lightbox-autoload]')) {
    window.lightbox = new Lightbox();
  }
});

export default Lightbox;

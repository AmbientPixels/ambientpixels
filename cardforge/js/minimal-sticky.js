/**
 * Minimal Sticky Solution
 * Simple JavaScript to handle sticky positioning when CSS sticky fails
 */

class MinimalSticky {
  constructor() {
    this.stickyElement = null;
    this.isFixed = false;
    this.originalTop = 0;
    this.stickyOffset = 16; // 1rem
    this.init();
  }

  init() {
    // Wait for DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  setup() {
    this.stickyElement = document.querySelector('.sticky-right-column');
    
    if (!this.stickyElement) {
      return;
    }

    // Store original position
    this.originalTop = this.stickyElement.offsetTop;
    
    // Listen to scroll
    window.addEventListener('scroll', () => this.handleScroll(), { passive: true });
    
    console.log('✅ Minimal sticky initialized');
  }

  handleScroll() {
    if (!this.stickyElement) return;

    const scrollTop = window.pageYOffset;
    const viewportHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // Check if we're near the bottom of the page
    const nearBottom = (scrollTop + viewportHeight) >= (documentHeight - 200);
    
    const shouldBeFixed = scrollTop > (this.originalTop - this.stickyOffset) && !nearBottom;

    if (shouldBeFixed && !this.isFixed) {
      this.makeFixed();
    } else if (!shouldBeFixed && this.isFixed) {
      this.makeNormal();
    }
  }

  makeFixed() {
    if (!this.stickyElement || this.isFixed) return;

    const rect = this.stickyElement.getBoundingClientRect();
    
    // Apply fixed positioning
    this.stickyElement.style.position = 'fixed';
    this.stickyElement.style.top = this.stickyOffset + 'px';
    this.stickyElement.style.left = rect.left + 'px';
    this.stickyElement.style.width = rect.width + 'px';
    this.stickyElement.style.zIndex = '100';
    
    this.isFixed = true;
  }

  makeNormal() {
    if (!this.stickyElement || !this.isFixed) return;

    // Reset to normal positioning
    this.stickyElement.style.position = '';
    this.stickyElement.style.top = '';
    this.stickyElement.style.left = '';
    this.stickyElement.style.width = '';
    this.stickyElement.style.zIndex = '';
    
    this.isFixed = false;
  }
}

// Initialize
new MinimalSticky();

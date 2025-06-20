/**
 * Nova Comparison Slider
 * A clean, accessible before/after image comparison slider
 */
class NovaComparisonSlider {
  constructor(container) {
    // Store elements
    this.container = container;
    this.before = container.querySelector('.comparison-before');
    this.after = container.querySelector('.comparison-after');
    this.handle = container.querySelector('.slider-handle');
    
    // State
    this.isDragging = false;
    this.currentPosition = 50; // Start at 50%
    this.resizeTimeout = null;
    
    // Bind methods
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleResize = this.handleResize.bind(this);
    
    // Initialize
    this.init();
  }
  
  init() {
    // Set initial position
    this.updateSlider(this.currentPosition);
    
    // Add event listeners
    this.addEventListeners();
    
    // Mark as initialized
    this.container.classList.add('js-initialized');
  }
  
  addEventListeners() {
    // Mouse events
    this.handle.addEventListener('mousedown', this.handleMouseDown);
    
    // Touch events
    this.handle.addEventListener('touchstart', this.handleMouseDown, { passive: false });
    
    // Keyboard navigation
    this.handle.addEventListener('keydown', this.handleKeyDown);
    
    // Click to move
    this.container.addEventListener('click', this.handleClick);
    
    // Handle window resize with debounce
    window.addEventListener('resize', this.handleResize);
  }
  
  handleMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    
    this.isDragging = true;
    document.body.classList.add('dragging');
    
    // Add global event listeners
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('touchmove', this.handleMouseMove, { passive: false });
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('touchend', this.handleMouseUp);
  }
  
  handleMouseMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();
    
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX || (e.touches?.[0]?.clientX);
    
    if (x === undefined) return;
    
    // Calculate position (0-100) and update
    const position = Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100));
    this.updateSlider(position);
  }
  
  handleMouseUp() {
    if (!this.isDragging) return;
    this.isDragging = false;
    document.body.classList.remove('dragging');
    this.removeGlobalListeners();
  }
  
  handleKeyDown(e) {
    const keyActions = {
      ArrowLeft: () => Math.max(0, this.currentPosition - 5),
      ArrowRight: () => Math.min(100, this.currentPosition + 5),
      Home: () => 0,
      End: () => 100
    };
    
    const action = keyActions[e.key];
    if (!action) return;
    
    e.preventDefault();
    this.updateSlider(action());
  }
  
  handleClick(e) {
    // Only handle clicks on the container or after image
    if (![this.container, this.after].includes(e.target)) return;
    
    const rect = this.container.getBoundingClientRect();
    const position = ((e.clientX - rect.left) / rect.width) * 100;
    this.updateSlider(Math.max(0, Math.min(100, position)));
  }
  
  handleResize() {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this.updateSlider(this.currentPosition);
    }, 100);
  }
  
  updateSlider(position) {
    // Update state and UI
    this.currentPosition = position;
    const roundedPosition = Math.round(position);
    
    // Update DOM
    // Instead of resizing .comparison-before, move the mask overlay
    const mask = this.container.querySelector('.comparison-mask');
    if (mask) {
      mask.style.left = `${position}%`;
    }
    this.handle.style.left = `${position}%`;
    this.handle.setAttribute('aria-valuenow', roundedPosition);
    this.handle.setAttribute('aria-valuetext', `${roundedPosition}%`);
    // Update labels visibility
    this.updateLabels(position);
  }
  
  updateLabels(position) {
    const beforeLabel = this.container.querySelector('.comparison-label:not(.right)');
    const afterLabel = this.container.querySelector('.comparison-label.right');
    
    if (!beforeLabel || !afterLabel) return;
    
    const isBeforeVisible = position <= 70;
    const isAfterVisible = position >= 30;
    
    beforeLabel.toggleAttribute('aria-hidden', !isBeforeVisible);
    afterLabel.toggleAttribute('aria-hidden', !isAfterVisible);
  }
  
  removeGlobalListeners() {
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('touchmove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('touchend', this.handleMouseUp);
  }
  
  destroy() {
    // Clean up event listeners
    this.handle.removeEventListener('mousedown', this.handleMouseDown);
    this.handle.removeEventListener('touchstart', this.handleMouseDown);
    this.handle.removeEventListener('keydown', this.handleKeyDown);
    this.container.removeEventListener('click', this.handleClick);
    window.removeEventListener('resize', this.handleResize);
    
    // Remove global listeners if dragging
    if (this.isDragging) {
      this.removeGlobalListeners();
    }
    
    // Clean up
    clearTimeout(this.resizeTimeout);
  }
}

// Initialize all sliders on the page
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nova-comparison-slider:not([data-initialized])')
    .forEach(container => {
      container.dataset.initialized = 'true';
      container.novaSlider = new NovaComparisonSlider(container);
    });
});

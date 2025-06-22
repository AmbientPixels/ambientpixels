/**
 * Form Explainer - Interactive UI elements for form field explanation
 * Version 3.0 - Clean, modular architecture with configurable options
 */

/**
 * Global initialization function exposed to window
 * @param {Object} config - Configuration options (optional)
 */
window.initFormExplainer = function(config = {}) {
  console.log('Form explainer initialization starting...');
  
  try {
    // Create and initialize the form explainer with config
    const formExplainer = new FormExplainer(config);
    formExplainer.init();
    
    // Return the instance for potential programmatic access
    return formExplainer;
  } catch (err) {
    console.error('Form explainer initialization failed:', err);
    return null;
  }
};

/**
 * FormExplainer class - Main class that manages the interactive form explainer
 */
class FormExplainer {
  /**
   * Constructor - Sets up initial state and configuration
   * @param {Object} customConfig - Optional custom configuration
   */
  constructor(customConfig = {}) {
    // Default configuration
    this.config = {
      containerId: 'form-explainer-container',
      jsonPath: '/data/form-explainer-map.json',
      imagePath: '/images/projects/ninja-theroy/screen06-1600.png',
      autoStart: true,
      stepDuration: 2500, // milliseconds per step
      ...customConfig
    };
    
    // Initialize DOM elements as null until setup
    this.container = null;
    this.imageContainer = null;
    this.imageElement = null;
    this.overlayContainer = null;
    this.whisperPanel = null;
    this.fieldStack = null;
    this.timelineScrubber = null;
    this.replayButton = null;
    
    // Module state
    this.overlayData = [];
    this.sequence = [];
    this.currentStep = -1;
    this.tourTimer = null;
    this.isTourActive = false;
    this.userHasInteracted = false;
    this.isPausedByUser = false;
    
    // Field icon mappings for different field types
    this.fieldIcons = {
      'title': 'fa-heading',
      'description': 'fa-align-left',
      'issue-type': 'fa-tags',
      'details': 'fa-comment-alt',
      'nova-note': 'fa-lightbulb',
      'game': 'fa-gamepad',
      'email': 'fa-envelope',
      'attachment': 'fa-paperclip',
      'captcha': 'fa-robot',
      'submit': 'fa-paper-plane'
    };
  }

  /**
   * Initialize the form explainer
   * Entry point called by global initFormExplainer
   */
  init() {
    // Find the container
    this.container = document.getElementById(this.config.containerId);
    
    if (!this.container) {
      console.error(`Form explainer container #${this.config.containerId} not found`);
      return;
    }
    
    // Check if there's a container-specified JSON path
    const jsonPathAttr = this.container.getAttribute('data-json-path');
    if (jsonPathAttr) {
      this.config.jsonPath = jsonPathAttr;
    }

    // Check if there's a container-specified image path
    const imagePathAttr = this.container.getAttribute('data-image-path');
    if (imagePathAttr) {
      this.config.imagePath = imagePathAttr;
    }
    
    console.log('Form explainer container found, initializing with JSON:', this.config.jsonPath);
    this.fetchData();
  }
  
  /**
   * Fetch overlay data from JSON file
   */
  fetchData() {
    // Add cache busting for development
    const cacheBuster = new Date().getTime();
    
    fetch(`${this.config.jsonPath}?_=${cacheBuster}`)
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(data => {
        if (!data || !Array.isArray(data)) {
          throw new Error('Invalid overlay data format');
        }
        
        // Store the overlay data
        this.overlayData = data;
        
        // Create sequence from data order
        this.sequence = data.map(item => item.key);
        
        // Setup main explainer UI elements once data is loaded
        this.setupExplainer();
      })
      .catch(error => {
        console.error('Error fetching form explainer data:', error);
      });
  }

  /**
   * Main setup function for explainer UI
   */
  setupExplainer() {
    // Get references to key elements or create them if needed
    this.setupDOM();
    
    // Create UI components
    this.createOverlays();
    this.createFieldExplainers();
    this.createTimelineProgress();
    this.setupEventListeners();
    // Add mouse hover to stop tour
    this.container.addEventListener('mouseenter', () => {
      this.stopTour();
    });
    
    // Add intersection observer to auto-start tour when in viewport
    if (this.config.autoStart) {
      this.setupIntersectionObserver();
    }
  }
  
  /**
   * Setup DOM elements and structure
   */
  setupDOM() {
    // Find or create the image container
    this.imageContainer = this.container.querySelector('.form-image-container');
    if (!this.imageContainer) {
      this.imageContainer = document.createElement('div');
      this.imageContainer.className = 'form-image-container';
      this.container.appendChild(this.imageContainer);
    }
    
    // Find or create the form image
    this.imageElement = this.imageContainer.querySelector('img');
    if (!this.imageElement) {
      this.imageElement = document.createElement('img');
      // No specific class needed, CSS targets the tag
      this.imageElement.alt = 'Form Screenshot';
      this.imageElement.loading = 'lazy';
      this.imageContainer.appendChild(this.imageElement);
    }
    
    // Set the image source from config
    this.imageElement.src = this.config.imagePath;
    
    // Find or create the whisper panel
    this.whisperPanel = this.imageContainer.querySelector('.whisper-panel');
    if (!this.whisperPanel) {
      this.whisperPanel = document.createElement('div');
      this.whisperPanel.className = 'whisper-panel';
      this.whisperPanel.setAttribute('aria-live', 'polite');
      this.whisperPanel.setAttribute('tabindex', '0');
      this.imageContainer.appendChild(this.whisperPanel);
    }
    
    // Find or create the field stack
    this.fieldStack = this.container.querySelector('.field-stack-container');
    if (!this.fieldStack) {
      this.fieldStack = document.createElement('div');
      this.fieldStack.className = 'field-stack-container';
      this.container.appendChild(this.fieldStack);
    }
    
    // Find or create the timeline scrubber
    this.timelineScrubber = this.fieldStack.querySelector('.timeline-scrubber');
    if (!this.timelineScrubber) {
      this.timelineScrubber = document.createElement('div');
      this.timelineScrubber.className = 'timeline-scrubber';
      this.fieldStack.appendChild(this.timelineScrubber);
    }
    
    // Find or create the replay button
    this.replayButton = this.fieldStack.querySelector('.replay-button');
    if (!this.replayButton) {
      this.replayButton = document.createElement('button');
      this.replayButton.className = 'replay-button';
      this.replayButton.type = 'button';
      
      const icon = document.createElement('i');
      icon.className = 'fas fa-undo';
      this.replayButton.appendChild(icon);
      
      const text = document.createElement('span');
      text.textContent = 'Replay Tour';
      this.replayButton.appendChild(text);
      
      this.fieldStack.appendChild(this.replayButton);
    }
  }
  
  /**
   * Creates overlay elements based on the data
   */
  createOverlays() {
    // Create overlay container if needed
    this.overlayContainer = this.imageContainer.querySelector('.form-overlays');
    if (!this.overlayContainer) {
      this.overlayContainer = document.createElement('div');
      this.overlayContainer.className = 'form-overlays';
      this.imageContainer.appendChild(this.overlayContainer);
    } else {
      // Clear existing overlays
      this.overlayContainer.innerHTML = '';
    }
    
    // Create overlays for each field
    this.overlayData.forEach((item, index) => {
      const overlay = document.createElement('div');
      overlay.className = 'form-field-overlay';
      overlay.dataset.fieldId = item.key;
      overlay.dataset.index = index;
      overlay.style.left = `${item.left * 100}%`;
      overlay.style.top = `${item.top * 100}%`;
      overlay.style.width = `${item.width * 100}%`;
      overlay.style.height = `${item.height * 100}%`;
      // Tooltip for overlay (left panel only)
      const tooltip = document.createElement('div');
      tooltip.className = 'field-item-tooltip';
      tooltip.textContent = item.tooltip || 'No details available.';
      overlay.appendChild(tooltip);
      // Stop tour on mouse hover over overlay
      overlay.addEventListener('mouseenter', () => {
        this.stopTour();
      });
      this.overlayContainer.appendChild(overlay);
    });
    
    // Create ghost overlay for hover effect
    this.ghostOverlay = document.createElement('div');
    this.ghostOverlay.className = 'ghost-overlay';
    this.overlayContainer.appendChild(this.ghostOverlay);
  }
  
  /**
   * Creates field explainer items in the stack
   */
  createFieldExplainers() {
    // Clear any existing field items except timeline and replay button
    const existingItems = this.fieldStack.querySelectorAll('.field-item');
    existingItems.forEach(item => item.remove());

    // Create field items for each form element
    this.overlayData.forEach((item, index) => {
      const fieldItem = document.createElement('div');
      fieldItem.className = 'field-item';
      fieldItem.dataset.fieldId = item.key;
      fieldItem.dataset.index = index;

      // Header
      const header = document.createElement('div');
      header.className = 'field-item-header';
      const icon = document.createElement('i');
      icon.className = `fas ${this.fieldIcons[item.key] || 'fa-circle-info'}`;
      const title = document.createElement('h3');
      title.textContent = item.title || (item.key.charAt(0).toUpperCase() + item.key.slice(1).replace(/-/g, ' '));
      header.appendChild(icon);
      header.appendChild(title);

      // Description
      const description = document.createElement('div');
      description.className = 'field-item-description';
      description.textContent = item.description || '';

      // Assemble the field item
      fieldItem.appendChild(header);
      fieldItem.appendChild(description);

      // Insert before the timeline scrubber
      this.fieldStack.insertBefore(fieldItem, this.timelineScrubber);
    });
  }
  
  /**
   * Creates timeline progress bar and markers with absolute positioning
   */
  createTimelineProgress() {
    // Clear timeline scrubber
    this.timelineScrubber.innerHTML = '';
    
    // Create base timeline line
    const markers = document.createElement('div');
    markers.className = 'timeline-markers';
    this.timelineScrubber.appendChild(markers);
    
    // Create progress bar
    const progress = document.createElement('div');
    progress.className = 'timeline-progress';
    this.timelineScrubber.appendChild(progress);
    
    // Create playhead
    const playhead = document.createElement('div');
    playhead.className = 'timeline-playhead';
    const playheadIcon = document.createElement('i');
    // Use the icon for the first step initially
    const firstStep = this.overlayData[0] || {};
    const firstIconClass = this.fieldIcons?.[firstStep.key] || 'fa-circle-info';
    playheadIcon.className = `fa-solid ${firstIconClass} timeline-dot-icon`;
    playhead.appendChild(playheadIcon);
    this.timelineScrubber.appendChild(playhead);
    this._timelinePlayheadIcon = playheadIcon; // Save for later updates
    
    // Create markers for each step with absolute positioning
    const totalSteps = this.sequence.length;
    this.sequence.forEach((_, index) => {
      const marker = document.createElement('div');
      marker.className = 'timeline-marker';
      marker.dataset.index = index;
      
      // Calculate exact position percentage with padding for first and last markers
      // Add 5% padding on each side to prevent edge clipping
      const paddingPercent = 5;
      const usableWidth = 100 - (paddingPercent * 2);
      let position;
      
      if (totalSteps > 1) {
        // For multiple steps, distribute evenly within the usable width
        position = paddingPercent + (index / (totalSteps - 1)) * usableWidth;
      } else {
        // For a single step, center it
        position = 50;
      }
      
      marker.style.left = `${position}%`;
      
      // Add icon
      const stepData = this.overlayData[index] || {};
      const iconClass = this.fieldIcons?.[stepData.key] || 'fa-circle-info';
      const markerIcon = document.createElement('i');
      markerIcon.className = `fa-solid ${iconClass} timeline-dot-icon`;
      marker.appendChild(markerIcon);
      
      this.timelineScrubber.appendChild(marker);
    });
  }
  
  /**
   * Setup intersection observer for auto-start when in viewport
   */
  setupIntersectionObserver() {
    // Create observer to auto-start tour when in viewport
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !this.userHasInteracted) {
        // Stagger animation of field items first, then start tour
        this.animateFieldsIn().then(() => {
          setTimeout(() => this.startTour(true), 500); // Start tour after field animations
        });
        observer.disconnect();
      }
    }, { threshold: 0.5 });

    observer.observe(this.container);
  }
  
  /**
   * Animate field items in with staggered timing
   * @returns {Promise} Promise that resolves when animations complete
   */
  animateFieldsIn() {
    return new Promise(resolve => {
      const fieldItems = this.fieldStack.querySelectorAll('.field-item');
      let delay = 100;
      
      fieldItems.forEach((item, index) => {
        setTimeout(() => {
          item.classList.add('visible');
          if (index === fieldItems.length - 1) {
            setTimeout(resolve, 300); // Resolve after last animation completes
          }
        }, delay * index);
      });
      
      // Resolve after all animations if no items
      if (fieldItems.length === 0) resolve();
    });
  }
  
  /**
   * Update UI elements to reflect the current step
   * @param {number} stepIndex - Index of the step to display
   */
  updateUIForStep(stepIndex) {
    this.currentStep = stepIndex;
    
    // Reset all active states
    const overlays = this.overlayContainer.querySelectorAll('.form-field-overlay');
    overlays.forEach(o => o.classList.remove('active'));
    
    const fieldItems = this.fieldStack.querySelectorAll('.field-item');
    fieldItems.forEach(f => f.classList.remove('active'));
    
    if (stepIndex > -1 && stepIndex < this.sequence.length) {
      // Update image overlay
      const activeOverlay = this.overlayContainer.querySelector(`.form-field-overlay[data-index='${stepIndex}']`);
      if (activeOverlay) {
        activeOverlay.classList.add('active');
        this.updateGhostOverlay(activeOverlay);
      }
      
      // Update field item
      const activeField = this.fieldStack.querySelector(`.field-item[data-index='${stepIndex}']`);
      if (activeField) {
        activeField.classList.add('active');
        // Scroll field into view if not visible
        activeField.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      
      // Update whisper panel
      if (this.whisperPanel) {
        const currentField = this.overlayData[stepIndex];
        if (currentField && currentField.novaThought) {
          this.whisperPanel.textContent = currentField.novaThought;
          this.whisperPanel.classList.add('active');
        } else {
          this.whisperPanel.classList.remove('active');
        }
      }
      
      this.updateTimelineProgress(stepIndex);
    } else {
      // Reset UI when no step is active
      this.ghostOverlay.classList.remove('pulsing');
      this.whisperPanel.classList.remove('active');
      this.updateTimelineProgress(-1);
    }
  }
  
  /**
   * Update ghost overlay position and animation
   * @param {HTMLElement} targetOverlay - The overlay to highlight
   */
  updateGhostOverlay(targetOverlay) {
    if (!targetOverlay) {
      this.ghostOverlay.classList.remove('pulsing');
      return;
    }
    this.ghostOverlay.style.left = targetOverlay.style.left;
    this.ghostOverlay.style.top = targetOverlay.style.top;
    this.ghostOverlay.style.width = targetOverlay.style.width;
    this.ghostOverlay.style.height = targetOverlay.style.height;
    this.ghostOverlay.classList.add('pulsing');
  }
  
  /**
   * Update timeline progress indicators
   * @param {number} stepIndex - Current step index
   */
  updateTimelineProgress(stepIndex) {
    const progress = this.timelineScrubber.querySelector('.timeline-progress');
    const playhead = this.timelineScrubber.querySelector('.timeline-playhead');
    const markers = this.timelineScrubber.querySelectorAll('.timeline-marker');
    
    // Reset all markers
    markers.forEach((marker, index) => {
      marker.classList.toggle('active', index === stepIndex);
    });
    
    if (stepIndex < 0 || stepIndex >= this.sequence.length) {
      progress.style.width = '0%';
      playhead.style.left = '0%';
      return;
    }
    
    // Find the active marker and get its position
    const activeMarker = this.timelineScrubber.querySelector(`.timeline-marker[data-index="${stepIndex}"]`);
    if (activeMarker) {
      // Get the exact position from the marker's inline style
      const markerPosition = activeMarker.style.left;
      
      // Set playhead to exact same position as the marker
      playhead.style.left = markerPosition;
      
      // Set progress bar width to the same position
      progress.style.width = markerPosition;
    } else {
      // Fallback to calculated position if marker not found
      const totalSteps = this.sequence.length - 1;
      const progressPercent = totalSteps > 0 ? (stepIndex / totalSteps) * 100 : 100;
      progress.style.width = `${progressPercent}%`;
      playhead.style.left = `${progressPercent}%`;
    }
    
    // Update playhead icon to match current step
    if (this._timelinePlayheadIcon && stepIndex >= 0 && stepIndex < this.overlayData.length) {
      const stepData = this.overlayData[stepIndex] || {};
      const iconClass = this.fieldIcons?.[stepData.key] || 'fa-circle-info';
      this._timelinePlayheadIcon.className = `fa-solid ${iconClass} timeline-dot-icon`;
    }
  }
  
  /**
   * Start the automated tour
   * @param {boolean} isAutoStart - Whether tour is auto-started (vs. user-initiated)
   */
  startTour(isAutoStart = false) {
    clearTimeout(this.tourTimer);
    this.userHasInteracted = !isAutoStart;
    this.isTourActive = true;
    
    // Reset any active states before starting
    this.overlayContainer.querySelectorAll('.form-field-overlay').forEach(o => o.classList.remove('active'));
    this.fieldStack.querySelectorAll('.field-item').forEach(f => f.classList.remove('active'));
    
    // Start from the beginning
    this.currentStep = -1;
    
    // Ensure all field items are visible before starting tour
    this.fieldStack.querySelectorAll('.field-item:not(.visible)').forEach(item => {
      item.classList.add('visible');
    });
    
    // Begin the tour
    this.advanceTour();
  }
  
  /**
   * Advance to the next step in the tour
   */
  advanceTour() {
    if (!this.isTourActive || this.isPausedByUser) return;
    this.currentStep++;
    
    if (this.currentStep >= this.sequence.length) {
      this.endTour();
      return;
    }
    
    // Update UI for this step
    this.updateUIForStep(this.currentStep);
    
    // Duration increases slightly for steps with Nova thoughts
    const currentField = this.overlayData[this.currentStep];
    const hasNovaThought = currentField && currentField.novaThought;
    const stepDuration = hasNovaThought ? 3200 : this.config.stepDuration;
    
    // Schedule next step
    this.tourTimer = setTimeout(() => this.advanceTour(), stepDuration);
  }
  
  /**
   * End the tour sequence
   */
  endTour() {
    this.isTourActive = false;
    clearTimeout(this.tourTimer);
    
    // Reset UI
    this.updateUIForStep(-1);
    this.updateGhostOverlay(null);
    
    // Show completion message
    setTimeout(() => {
      if (!this.isTourActive) {
        this.whisperPanel.textContent = "Use the timeline or hover over fields to explore more";
        this.whisperPanel.classList.add('active');
      }
    }, 500);
  }
  
  /**
   * Pauses the tour timer.
   */
  pauseTour() {
    if (!this.isTourActive) return;
    this.isPausedByUser = true;
    clearTimeout(this.tourTimer);
  }

  /**
   * Resumes the tour timer if it was paused by the user.
   */
  resumeTour() {
    if (!this.isTourActive || !this.isPausedByUser) return;
    this.isPausedByUser = false;
    this.advanceTour(); // Simply call advance to resume the timer
  }
  
  /**
   * Stop any active tour
   */
  stopTour() {
    if (!this.isTourActive) return;
    
    this.isTourActive = false;
    this.userHasInteracted = true;
    clearTimeout(this.tourTimer);
  }
  
  /**
   * Highlight a specific field
   * @param {number} index - Index of the field to highlight
   * @param {boolean} isActive - Whether to activate or deactivate the highlight
   */
  highlightField(index, isActive) {
    // Highlight/unhighlight the field item
    const fieldItem = this.fieldStack.querySelector(`.field-item[data-index='${index}']`);
    if (fieldItem) {
      fieldItem.classList.toggle('active', isActive);
    }
    
    // Highlight/unhighlight the image overlay
    const overlay = this.overlayContainer.querySelector(`.form-field-overlay[data-index='${index}']`);
    if (overlay) {
      overlay.classList.toggle('active', isActive);
      
      // Update ghost overlay
      if (isActive) {
        this.updateGhostOverlay(overlay);
      } else if (index !== this.currentStep) {
        this.ghostOverlay.classList.remove('pulsing');
      }
    }
    
    // Update whisper panel
    if (isActive && index >= 0 && index < this.sequence.length) {
      const currentField = this.overlayData[index];
      if (currentField) {
        this.whisperPanel.textContent = currentField.novaThought || currentField.tooltip;
        this.whisperPanel.classList.add('active');
      }
    } else if (!isActive && index !== this.currentStep) {
      this.whisperPanel.classList.remove('active');
    }
  }
  
  // Removed calculateMarkerPositions method - using fixed positions instead
  
  /**
   * Setup all event listeners for interactive elements
   */
  setupEventListeners() {
    // Pause and resume tour on container hover
    this.container.addEventListener('mouseenter', () => this.pauseTour());
    this.container.addEventListener('mouseleave', () => this.resumeTour());
    
    // No need for resize handler with fixed positioning

    // Overlay hover/click in the image
    this.overlayContainer.querySelectorAll('.form-field-overlay').forEach(overlay => {
      overlay.addEventListener('mouseenter', () => {
        if (this.isTourActive) return; // Don't respond to hover during tour
        const overlayIndex = parseInt(overlay.dataset.index, 10);
        this.highlightField(overlayIndex, true);
      });
      
      overlay.addEventListener('mouseleave', () => {
        if (this.isTourActive) return;
        const overlayIndex = parseInt(overlay.dataset.index, 10);
        if (overlayIndex !== this.currentStep) {
          this.highlightField(overlayIndex, false);
        }
      });
      
      overlay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.stopTour();
        const clickedIndex = parseInt(overlay.dataset.index, 10);
        this.updateUIForStep(clickedIndex);
      });
    });

    // Field item interactions
    this.fieldStack.querySelectorAll('.field-item').forEach(field => {
      field.addEventListener('mouseenter', () => {
        if (this.isTourActive) return;
        const fieldIndex = parseInt(field.dataset.index, 10);
        this.highlightField(fieldIndex, true);
      });
      
      field.addEventListener('mouseleave', () => {
        if (this.isTourActive) return;
        const fieldIndex = parseInt(field.dataset.index, 10);
        if (fieldIndex !== this.currentStep) {
          this.highlightField(fieldIndex, false);
        }
      });
      
      field.addEventListener('click', () => {
        this.stopTour();
        const clickedIndex = parseInt(field.dataset.index, 10);
        this.updateUIForStep(clickedIndex);
      });
    });

    // Timeline markers
    this.timelineScrubber.querySelectorAll('.timeline-marker').forEach(marker => {
      marker.addEventListener('click', () => {
        this.stopTour();
        const markerIndex = parseInt(marker.dataset.index, 10);
        this.updateUIForStep(markerIndex);
      });
    });

    // Replay button
    if (this.replayButton) {
      this.replayButton.addEventListener('click', () => {
        this.stopTour();
        this.updateUIForStep(0);
        this.startTour(false);
      });
    }

    // Global click to reset highlights when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest(`#${this.config.containerId}`)) {
        this.stopTour();
        this.updateUIForStep(-1);
      }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
      // Recalculate positions if needed
    });

    // Keyboard navigation
    this.container.setAttribute('tabindex', '0');
    this.container.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          this.stopTour();
          this.updateUIForStep(Math.min(this.currentStep + 1, this.sequence.length - 1));
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          this.stopTour();
          this.updateUIForStep(Math.max(this.currentStep - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          this.stopTour();
          this.updateUIForStep(0);
          break;
        case 'End':
          e.preventDefault();
          this.stopTour();
          this.updateUIForStep(this.sequence.length - 1);
          break;
        case 'Escape':
          e.preventDefault();
          this.stopTour();
          this.updateUIForStep(-1);
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          if (this.isTourActive) {
            this.stopTour();
          } else {
            this.startTour(false);
          }
          break;
      }
    });
  }
}

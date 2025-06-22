/**
 * Luma V1 - Modular, mood-aware guidance system
 * Migrated and refactored from Form Explainer
 * All references to FormExplainer and form-explainer have been updated for Luma
 * Mood and aura support added
 * updated by Cascade
 */

/**
 * Global initialization function exposed to window
 * @param {Object} config - Configuration options (optional)
 */
window.initLuma = function(config = {}) {
  console.log('Luma initialization starting...');
  try {
    const luma = new Luma(config);
    luma.init();
    return luma;
  } catch (err) {
    console.error('Luma initialization failed:', err);
    return null;
  }
};

/**
 * Luma class - Main class that manages the interactive guidance system
 */
class Luma {
  /**
   * Constructor - Sets up initial state and configuration
   * @param {Object} customConfig - Optional custom configuration
   */
  constructor(customConfig = {}) {
    // Default configuration
    this.config = {
      containerId: 'luma-container',
      jsonPath: '/data/luma-data.json',
      imagePath: '/images/projects/ninja-theroy/screen06-1600.png',
      autoStart: true,
      stepDuration: 2500,
      ...customConfig
    };
    // Initialize DOM elements
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
    // Field icon mappings
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
   * Initialize the Luma module
   * Entry point called by global initLuma
   */
  init() {
    // Find the container and set data-module
    this.container = document.getElementById(this.config.containerId);
    if (!this.container) {
      console.error(`Luma container #${this.config.containerId} not found`);
      return;
    }
    this.container.setAttribute('data-module', 'luma');
    // Check for container-specified JSON path
    const jsonPathAttr = this.container.getAttribute('data-json-path');
    if (jsonPathAttr) {
      this.config.jsonPath = jsonPathAttr;
    }
    // Check for container-specified image path
    const imagePathAttr = this.container.getAttribute('data-image-path');
    if (imagePathAttr) {
      this.config.imagePath = imagePathAttr;
    }
    console.log('Luma container found, initializing with JSON:', this.config.jsonPath);
    this.fetchData();
  }

  /* updated by Cascade - interactive methods (Form Explainer style) */
  updateUIForStep(idx) {
    this.currentStep = idx;
    // Highlight overlays
    const overlays = this.overlayContainer.querySelectorAll('.form-field-overlay');
    overlays.forEach((el, i) => el.classList.toggle('active', i === idx));
    // Highlight fields
    const fields = this.fieldStack.querySelectorAll('.field-item');
    fields.forEach((el, i) => el.classList.toggle('active', i === idx));
    // Update ghost overlay
    const step = this.overlayData[idx];
    if (step && this.ghostOverlay) {
      this.ghostOverlay.style.left = `${step.left * 100}%`;
      this.ghostOverlay.style.top = `${step.top * 100}%`;
      this.ghostOverlay.style.width = `${step.width * 100}%`;
      this.ghostOverlay.style.height = `${step.height * 100}%`;
      this.ghostOverlay.classList.add('pulsing');
    } else if (this.ghostOverlay) {
      this.ghostOverlay.classList.remove('pulsing');
    }
    // Update whisper panel
    if (this.whisperPanel) {
      if (step && step.novaThought) {
        this.whisperPanel.textContent = step.novaThought;
        this.whisperPanel.classList.add('active');
      } else {
        this.whisperPanel.classList.remove('active');
      }
    }
    // Update timeline/playhead if present
    if (this._timelinePlayheadIcon && step && this.fieldIcons[step.key]) {
      this._timelinePlayheadIcon.className = `fa-solid ${this.fieldIcons[step.key]} timeline-dot-icon`;
    }
    // Scroll field into view if needed
    const field = fields[idx];
    if (field) field.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // updated by Cascade: update timeline progress
    this.updateTimelineProgress(idx);
  }

  // updated by Cascade: update timeline progress like Form Explainer
  updateTimelineProgress(idx) {
    if (!this.timelineScrubber) return;
    const progress = this.timelineScrubber.querySelector('.timeline-progress');
    const playhead = this.timelineScrubber.querySelector('.timeline-playhead');
    const markers = this.timelineScrubber.querySelectorAll('.timeline-marker');
    // Reset all markers
    markers.forEach((marker, i) => {
      marker.classList.toggle('active', i === idx);
    });
    if (!progress || !playhead) return;
    if (idx < 0 || idx >= this.overlayData.length) {
      progress.style.width = '0%';
      playhead.style.left = '0%';
      return;
    }
    // Find the active marker and get its position
    const activeMarker = this.timelineScrubber.querySelector(`.timeline-marker[data-index="${idx}"]`);
    if (activeMarker) {
      const markerPosition = activeMarker.style.left;
      playhead.style.left = markerPosition;
      progress.style.width = markerPosition;
    } else {
      const totalSteps = this.overlayData.length - 1;
      const progressPercent = totalSteps > 0 ? (idx / totalSteps) * 100 : 100;
      progress.style.width = `${progressPercent}%`;
      playhead.style.left = `${progressPercent}%`;
    }
    // Update playhead icon to match current step
    if (this._timelinePlayheadIcon && idx >= 0 && idx < this.overlayData.length) {
      const stepData = this.overlayData[idx] || {};
      const iconClass = this.fieldIcons?.[stepData.key] || 'fa-circle-info';
      this._timelinePlayheadIcon.className = `fa-solid ${iconClass} timeline-dot-icon`;
    }
  }

  advanceTour() {
    if (!this.isTourActive || this.isPausedByUser) return;
    this.currentStep++;
    if (this.currentStep >= this.overlayData.length) {
      this.endTour();
      return;
    }
    this.updateUIForStep(this.currentStep);
    // Duration increases slightly for steps with novaThought
    const step = this.overlayData[this.currentStep];
    const hasNovaThought = step && step.novaThought;
    const stepDuration = hasNovaThought ? 3200 : (this.config.stepDuration || 3000);
    this.tourTimer = setTimeout(() => this.advanceTour(), stepDuration);
  }

  startTour(isAutoStart = false) {
    clearTimeout(this.tourTimer);
    this.userHasInteracted = !isAutoStart;
    this.isTourActive = true;
    this.isPausedByUser = false;
    this.currentStep = -1;
    // Ensure all field items are visible before starting tour
    this.fieldStack.querySelectorAll('.field-item:not(.visible)').forEach(item => {
      item.classList.add('visible');
    });
    this.advanceTour();
  }

  pauseTour() {
    if (!this.isTourActive) return;
    this.isPausedByUser = true;
    clearTimeout(this.tourTimer);
  }

  resumeTour() {
    if (!this.isTourActive || !this.isPausedByUser) return;
    this.isPausedByUser = false;
    this.advanceTour();
  }

  endTour() {
    this.isTourActive = false;
    clearTimeout(this.tourTimer);
    this.updateUIForStep(-1);
    if (this.whisperPanel) {
      setTimeout(() => {
        if (!this.isTourActive) {
          this.whisperPanel.textContent = "Use the timeline or hover over fields to explore more";
          this.whisperPanel.classList.add('active');
        }
      }, 500);
    }
  }

  stopTour() {
    if (!this.isTourActive) return;
    this.isTourActive = false;
    this.userHasInteracted = true;
    clearTimeout(this.tourTimer);
  }

  setupEventListeners() {
    // Overlay click/hover
    const overlays = this.overlayContainer.querySelectorAll('.form-field-overlay');
    overlays.forEach((el, idx) => {
      el.addEventListener('mouseenter', () => {
        this.stopTour();
        this.updateUIForStep(idx);
      });
      el.addEventListener('click', () => {
        this.stopTour();
        this.updateUIForStep(idx);
      });
    });
    // Field stack click/hover
    const fields = this.fieldStack.querySelectorAll('.field-item');
    fields.forEach((el, idx) => {
      el.addEventListener('mouseenter', () => {
        this.stopTour();
        this.updateUIForStep(idx);
      });
      el.addEventListener('click', () => {
        this.stopTour();
        this.updateUIForStep(idx);
      });
    });
    // Replay button
    if (this.replayButton) {
      this.replayButton.addEventListener('click', () => {
        this.currentStep = -1;
        this.startTour();
      });
    }
    // updated by Cascade: fix stopTour binding for container
    if (this.container) {
      this.container.addEventListener('mouseenter', () => {
        if (typeof this.stopTour === 'function') this.stopTour();
      });
    }
  }

  /**
   * Fetch overlay data from JSON file
   */
  fetchData() {
    const cacheBuster = new Date().getTime();
    fetch(`${this.config.jsonPath}?_=${cacheBuster}`)
      .then(response => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
      })
      .then(data => {
        if (!data || !Array.isArray(data)) throw new Error('Invalid overlay data format');
        this.overlayData = data;
        this.sequence = data.map(item => item.key);
        this.setupExplainer();
      })
      .catch(error => {
        console.error('Error fetching Luma data:', error);
      });
  }

  /**
   * Main setup function for explainer UI
   */
  setupExplainer() {
    this.setupDOM();
    this.createOverlays();
    this.createFieldExplainers();
    this.createTimelineProgress();
    this.setupEventListeners && this.setupEventListeners();
    /* updated by Cascade: start tour and show first step */
    this.updateUIForStep(0);
    if (this.config.autoStart) {
      this.startTour(true);
      this.setupIntersectionObserver && this.setupIntersectionObserver();
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
      this.imageElement.alt = 'Form Screenshot';
      this.imageElement.loading = 'lazy';
      this.imageContainer.appendChild(this.imageElement);
    }
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
   * Creates overlay elements based on the data, with mood/aura attributes
   */
  createOverlays() {
    this.overlayContainer = this.imageContainer.querySelector('.form-overlays');
    if (!this.overlayContainer) {
      this.overlayContainer = document.createElement('div');
      this.overlayContainer.className = 'form-overlays';
      this.imageContainer.appendChild(this.overlayContainer);
    } else {
      this.overlayContainer.innerHTML = '';
    }
    this.overlayData.forEach((item, index) => {
      const overlay = document.createElement('div');
      overlay.className = 'form-field-overlay';
      overlay.dataset.fieldId = item.key;
      overlay.dataset.index = index;
      overlay.style.left = `${item.left * 100}%`;
      overlay.style.top = `${item.top * 100}%`;
      overlay.style.width = `${item.width * 100}%`;
      overlay.style.height = `${item.height * 100}%`;
      // Add mood/aura attributes if present
      if (item.mood) overlay.setAttribute('data-mood', item.mood);
      if (item.aura) overlay.setAttribute('data-aura', item.aura);
      // Tooltip for overlay
      const tooltip = document.createElement('div');
      tooltip.className = 'field-item-tooltip';
      tooltip.textContent = item.tooltip || 'No details available.';
      overlay.appendChild(tooltip);
      overlay.addEventListener('mouseenter', () => { this.stopTour(); });
      this.overlayContainer.appendChild(overlay);
    });
    // Create ghost overlay
    this.ghostOverlay = document.createElement('div');
    this.ghostOverlay.className = 'ghost-overlay';
    this.overlayContainer.appendChild(this.ghostOverlay);
  }

  /**
   * Creates field explainer items in the stack, with mood/aura attributes
   */
  createFieldExplainers() {
    const existingItems = this.fieldStack.querySelectorAll('.field-item');
    existingItems.forEach(item => item.remove());
    this.overlayData.forEach((item, index) => {
      const fieldItem = document.createElement('div');
      fieldItem.className = 'field-item';
      fieldItem.dataset.fieldId = item.key;
      fieldItem.dataset.index = index;
      // Add mood/aura attributes if present
      if (item.mood) fieldItem.setAttribute('data-mood', item.mood);
      if (item.aura) fieldItem.setAttribute('data-aura', item.aura);
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

  /* --- The rest of the Luma logic is identical to the original FormExplainer, with class/selector/config naming updated --- */

  /**
   * Creates timeline progress bar, markers, and playhead with absolute positioning
   * Adapted from Form Explainer
   * updated by Cascade
   */
  createTimelineProgress() {
    if (!this.timelineScrubber) return;
    this.timelineScrubber.innerHTML = '';
    const markers = document.createElement('div');
    markers.className = 'timeline-markers';
    this.timelineScrubber.appendChild(markers);
    const progress = document.createElement('div');
    progress.className = 'timeline-progress';
    this.timelineScrubber.appendChild(progress);
    const playhead = document.createElement('div');
    playhead.className = 'timeline-playhead';
    const playheadIcon = document.createElement('i');
    const firstStep = this.overlayData[0] || {};
    const firstIconClass = this.fieldIcons?.[firstStep.key] || 'fa-circle-info';
    playheadIcon.className = `fa-solid ${firstIconClass} timeline-dot-icon`;
    playhead.appendChild(playheadIcon);
    this.timelineScrubber.appendChild(playhead);
    this._timelinePlayheadIcon = playheadIcon;
    const totalSteps = this.sequence.length;
    this.sequence.forEach((_, index) => {
      const marker = document.createElement('div');
      marker.className = 'timeline-marker';
      marker.dataset.index = index;
      const paddingPercent = 5;
      const usableWidth = 100 - (paddingPercent * 2);
      let position;
      if (totalSteps > 1) {
        position = paddingPercent + (index / (totalSteps - 1)) * usableWidth;
      } else {
        position = 50;
      }
      marker.style.left = `${position}%`;
      const stepData = this.overlayData[index] || {};
      const iconClass = this.fieldIcons?.[stepData.key] || 'fa-circle-info';
      const markerIcon = document.createElement('i');
      markerIcon.className = `fa-solid ${iconClass} timeline-dot-icon`;
      marker.appendChild(markerIcon);
      this.timelineScrubber.appendChild(marker);
    });
  }
}

// updated by Cascade

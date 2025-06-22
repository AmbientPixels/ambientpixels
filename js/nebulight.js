/**
 * Nebulight Interactive Slideshow
 * A modern, responsive, and accessible slideshow component
 * 
 * @version 1.0.0
 * @author AmbientPixels
 */

class Nebulight {
  /**
   * Create a new Nebulight slideshow instance
   * @param {string|HTMLElement} container - Container element or selector
   * @param {Object|string} config - Configuration object or path to JSON config
   */
  constructor(container, config = {}) {
    // Store references
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
      
    if (!this.container) {
      console.error('Nebulight: Container element not found');
      return;
    }
    
    // Initialize state
    this.slides = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isFullscreen = false;
    this.autoplayTimer = null;
    this.progressTimer = null;
    this.progressValue = 0;
    this.touchStartX = 0;
    this.touchEndX = 0;
    
    // Default configuration
    this.defaultConfig = {
      slideshowId: 'nebulight-' + Math.random().toString(36).substring(2, 9),
      title: 'Nebulight Slideshow',
      description: '',
      settings: {
        autoplay: true,
        interval: 5000,
        loop: true,
        transition: 'fade',
        transitionDuration: 800,
        showCaptions: true,
        showControls: true,
        showProgress: true,
        showCounter: true,
        showThumbnails: true,
        allowFullscreen: true,
        theme: 'dark',
        aspectRatio: '16:9',
        height: 'auto'
      },
      security: {
        disableRightClick: false,
        obfuscateImageUrls: false,
        preventDownload: false
      },
      slides: [],
      i18n: {
        nextSlide: 'Next slide',
        previousSlide: 'Previous slide',
        playSlideshow: 'Play slideshow',
        pauseSlideshow: 'Pause slideshow',
        fullscreen: 'Toggle fullscreen',
        exitFullscreen: 'Exit fullscreen',
        slideCounter: 'Slide {current} of {total}'
      }
    };
    
    // Load configuration
    if (typeof config === 'string') {
      this.loadConfigFromJson(config);
    } else {
      this.config = { ...this.defaultConfig, ...config };
      this.init();
    }
  }
  
  /**
   * Load configuration from JSON file
   * @param {string} jsonPath - Path to JSON configuration file
   */
  async loadConfigFromJson(jsonPath) {
    try {
      const response = await fetch(jsonPath);
      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
      }
      
      const config = await response.json();
      this.config = { ...this.defaultConfig, ...config };
      this.init();
    } catch (error) {
      console.error('Nebulight: Failed to load configuration', error);
    }
  }
  
  /**
   * Initialize the slideshow
   */
  init() {
    // Apply theme
    this.container.classList.add('nebulight-container');
    this.container.setAttribute('data-theme', this.config.settings.theme);
    this.container.setAttribute('data-transition', this.config.settings.transition);
    this.container.setAttribute('data-autoplay', this.config.settings.autoplay);
    this.container.setAttribute('id', this.config.slideshowId);
    
    // Create slideshow structure
    this.buildStructure();
    
    // Load slides
    this.loadSlides();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Start autoplay if enabled
    if (this.config.settings.autoplay) {
      this.play();
    }
    
    // Apply security measures
    this.applySecurity();
  }
  
  /**
   * Build the HTML structure for the slideshow
   */
  buildStructure() {
    // Clear container
    this.container.innerHTML = '';
    
    // Create stage
    this.stage = document.createElement('div');
    this.stage.className = 'nebulight-stage';
    this.stage.setAttribute('data-aspect-ratio', this.config.settings.aspectRatio);
    this.container.appendChild(this.stage);
    
    // Create slides container
    this.slidesContainer = document.createElement('div');
    this.slidesContainer.className = 'nebulight-slides';
    this.stage.appendChild(this.slidesContainer);
    
    // Create controls if enabled
    if (this.config.settings.showControls) {
      this.controls = document.createElement('div');
      this.controls.className = 'nebulight-controls';
      
      // Previous button
      this.prevButton = document.createElement('button');
      this.prevButton.className = 'nebulight-nav-button nebulight-prev';
      this.prevButton.setAttribute('aria-label', this.config.i18n.previousSlide);
      this.prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
      this.controls.appendChild(this.prevButton);
      
      // Next button
      this.nextButton = document.createElement('button');
      this.nextButton.className = 'nebulight-nav-button nebulight-next';
      this.nextButton.setAttribute('aria-label', this.config.i18n.nextSlide);
      this.nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
      this.controls.appendChild(this.nextButton);
      
      this.stage.appendChild(this.controls);
    }
    
    // Create control bar
    this.controlBar = document.createElement('div');
    this.controlBar.className = 'nebulight-control-bar';
    
    // Play/pause button
    this.playButton = document.createElement('button');
    this.playButton.className = 'nebulight-play-button';
    this.playButton.setAttribute('aria-label', this.config.i18n.playSlideshow);
    this.playButton.innerHTML = '<i class="fas fa-play"></i>';
    this.controlBar.appendChild(this.playButton);
    
    // Counter
    if (this.config.settings.showCounter) {
      this.counter = document.createElement('div');
      this.counter.className = 'nebulight-counter';
      this.controlBar.appendChild(this.counter);
    }
    
    // Fullscreen button
    if (this.config.settings.allowFullscreen) {
      this.fullscreenButton = document.createElement('button');
      this.fullscreenButton.className = 'nebulight-fullscreen-button';
      this.fullscreenButton.setAttribute('aria-label', this.config.i18n.fullscreen);
      this.fullscreenButton.innerHTML = '<i class="fas fa-expand"></i>';
      this.controlBar.appendChild(this.fullscreenButton);
    }
    
    this.stage.appendChild(this.controlBar);
    
    // Create progress bar
    if (this.config.settings.showProgress) {
      this.progress = document.createElement('div');
      this.progress.className = 'nebulight-progress';
      this.progressBar = document.createElement('div');
      this.progressBar.className = 'nebulight-progress-bar';
      this.progress.appendChild(this.progressBar);
      this.stage.appendChild(this.progress);
    }
    
    // Create thumbnails container
    if (this.config.settings.showThumbnails) {
      this.thumbnails = document.createElement('div');
      this.thumbnails.className = 'nebulight-thumbnails';
      this.container.appendChild(this.thumbnails);
    }
  }
}

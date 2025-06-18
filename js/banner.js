// File: /js/banner.js - Nova Glass Banner System

// Default configuration
const defaultConfig = {
  showOnLoad: true,
  bannersPath: '/data/banners/banners.json',
  messages: {
    default: {
      message: 'Welcome to our website!',
      duration: 5000,
      type: 'info'
    }
  }
};

// Merge user config with defaults
let config = {
  ...defaultConfig,
  ...(window.bannerConfig || {})
};

let currentBanner = null;
let hideTimeout = null;

/**
 * Loads banner configurations from JSON file
 */
async function loadBanners() {
  if (!config.bannersPath) return false;
  
  try {
    const response = await fetch(config.bannersPath);
    const data = await response.json();
    
    if (data && data.banners) {
      // Merge with default messages, allowing overrides
      config.messages = {
        ...defaultConfig.messages,
        ...data.banners
      };
      return true;
    }
  } catch (error) {
    console.error('Failed to load banners:', error);
  }
  return false;
}

/**
 * Shows a banner with the specified key or options
 * @param {string|object} keyOrOptions - Banner key or options object
 * @param {object} [customOptions] - Additional options to override
 */
function showBanner(keyOrOptions = 'default', customOptions = {}) {
  // Handle both showBanner('key') and showBanner({...}) syntax
  const options = typeof keyOrOptions === 'string'
    ? { ...(config.messages[keyOrOptions] || config.messages.default), ...customOptions }
    : { ...keyOrOptions };

  // Ensure required fields
  const { message = '', duration = 5000, type = 'info' } = options;
  
  // Hide current banner if visible
  hideBanner();

  // Create banner if it doesn't exist
  if (!currentBanner) {
    currentBanner = document.createElement('div');
    currentBanner.id = 'banner';
    currentBanner.className = `banner ${type}`;
    currentBanner.setAttribute('role', 'alert');
    currentBanner.setAttribute('aria-live', 'polite');
    
    const content = document.createElement('div');
    content.className = 'banner-content';
    
    const messageEl = document.createElement('div');
    messageEl.className = 'banner-message';
    
    const closeButton = document.createElement('button');
    closeButton.className = 'banner-close';
    closeButton.setAttribute('aria-label', 'Close banner');
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', hideBanner);

    content.appendChild(messageEl);
    content.appendChild(closeButton);
    currentBanner.appendChild(content);
    document.body.insertBefore(currentBanner, document.body.firstChild);
  }

  // Update banner content
  const messageEl = currentBanner.querySelector('.banner-message');
  messageEl.textContent = message;
  currentBanner.className = `banner ${type} visible`;
  
  // Auto-hide after duration
  if (duration > 0) {
    hideTimeout = setTimeout(() => {
      hideBanner();
    }, duration);
  }

  // Dispatch custom event
  const event = new CustomEvent('banner:show', { 
    detail: { message, duration, type } 
  });
  document.dispatchEvent(event);
}

/**
 * Hides the currently visible banner
 */
function hideBanner() {
  if (!currentBanner) return;
  
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
  
  currentBanner.classList.remove('visible');
  
  // Remove after animation completes
  setTimeout(() => {
    if (currentBanner?.parentNode) {
      currentBanner.parentNode.removeChild(currentBanner);
      currentBanner = null;
      
      // Dispatch custom event
      document.dispatchEvent(new CustomEvent('banner:hide'));
    }
  }, 300);
}

// Initialize banner system
document.addEventListener('DOMContentLoaded', async () => {
  // Load banners from JSON if path is configured
  if (config.bannersPath) {
    await loadBanners();
  }
  
  // Show default banner on load if enabled
  if (config.showOnLoad) {
    showBanner('default');
  }
});

// Export for global use
window.banner = {
  show: showBanner,
  hide: hideBanner,
  getConfig: () => ({ ...config })
};

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { showBanner, hideBanner, loadBanners };
}

// File: /js/banner.js - Nova Glass Banner System

// Default configuration - can be overridden by window.bannerConfig
const defaultConfig = {
  showOnLoad: true,
  bannersPath: '/data/banners/banners.json',
  animationDuration: 500, // ms for slide animation
  messages: {}
};

let config = { ...defaultConfig };

// Initialize configuration
function initConfig() {
  // Merge with window.bannerConfig if it exists
  if (window.bannerConfig) {
    config = {
      ...defaultConfig,
      ...window.bannerConfig,
      messages: { ...defaultConfig.messages }
    };
  }
  
  // Ensure messages object exists
  config.messages = config.messages || {};
  
  console.log('Banner config initialized:', config);
}

// Default messages - only used if not provided in config or JSON
const defaultMessages = {
  default: {
    message: 'Welcome to our website!',
    duration: 8000,
    type: 'info'
  }
};

let currentBanner = null;
let hideTimeout = null;

/**
 * Loads banner configurations from JSON file
 */
async function loadBanners() {
  if (!config.bannersPath) {
    console.warn('No bannersPath configured, using default messages');
    // Set both for backward compatibility
    config.messages = { ...defaultMessages };
    config.banners = { ...defaultMessages };
    return false;
  }
  
  try {
    const response = await fetch(`${config.bannersPath}?v=${Date.now()}`); // Cache buster
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    // Merge config from JSON
    if (data.config) {
      config = { ...config, ...data.config };
    }
    
    // Merge banners from JSON with defaults
    // Merge loaded banners/messages with defaults
    // Use banners if available, fall back to messages for backward compatibility
    const loadedBanners = data.banners || data.messages || {};
    
    // Set both for backward compatibility
    config.banners = {
      ...defaultMessages,
      ...loadedBanners
    };
    
    config.messages = config.banners; // Keep for any code that still uses messages
    
    // Also merge in any window.bannerConfig overrides
    if (window.bannerConfig?.banners || window.bannerConfig?.messages) {
      const overrideBanners = window.bannerConfig.banners || window.bannerConfig.messages || {};
      config.banners = { ...config.banners, ...overrideBanners };
      config.messages = config.banners;
    }
    
    return true;
  } catch (error) {
    console.error('Failed to load banners:', error);
    config.banners = { ...defaultMessages };
    config.messages = { ...defaultMessages };
    return false;
  }
}

/**
 * Shows a banner with the specified key or options
 * @param {string|Object} keyOrOptions - Banner key or options object
 */
async function showBanner(keyOrOptions) {
  // Clear any existing timeout
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  // Hide current banner if any
  hideBanner();

  // Small delay to ensure CSS is ready
  if (document.readyState !== 'complete') {
    await new Promise(resolve => {
      window.addEventListener('load', resolve, { once: true });
    });
  }
  
  // Ensure CSS transitions are ready
  await new Promise(resolve => requestAnimationFrame(resolve));

  // Get default message config - check both config.banners and config.messages for backward compatibility
  const defaultMessage = (config.banners?.default || config.messages?.default || defaultMessages.default);
  
  // Determine banner options based on input type
  let bannerOptions = {};
  
  if (typeof keyOrOptions === 'string') {
    // If it's a string key, get the banner config
    const bannerKey = keyOrOptions;
    // Check both config.banners and config.messages for backward compatibility
    const bannerConfig = (config.banners?.[bannerKey] || config.messages?.[bannerKey]);
    
    if (!bannerConfig) {
      console.warn(`No banner config found for key: ${bannerKey}, using default`);
      bannerOptions = { ...defaultMessage, key: 'default' };
    } else {
      bannerOptions = { 
        ...defaultMessage, 
        ...bannerConfig, 
        key: bannerKey 
      };
    }
  } else if (typeof keyOrOptions === 'object' && keyOrOptions !== null) {
    // If it's an options object, merge with defaults
    bannerOptions = { 
      ...defaultMessage, 
      ...keyOrOptions 
    };
  } else {
    // Fallback to default message
    bannerOptions = { ...defaultMessage, key: 'default' };
  }
  
  // Get config from loaded JSON if available
  const jsonConfig = window.bannerConfig?.config || {};
  
  // Ensure required fields have valid values
  bannerOptions = {
    message: bannerOptions.message || defaultMessage.message,
    duration: Math.max(Number(bannerOptions.duration) || Number(jsonConfig.defaultDuration) || 8000, 1000), // Ensure minimum 1s duration
    type: bannerOptions.type || 'info',
    key: bannerOptions.key || 'default',
    closeable: bannerOptions.closeable !== undefined ? bannerOptions.closeable : (jsonConfig.closeable !== false)
  };
  
  // Apply auto-hide setting from config if not explicitly set
  if (bannerOptions.autoHide === undefined) {
    bannerOptions.autoHide = jsonConfig.autoHide !== false; // Default to true if not specified
  }

  // Create banner element if it doesn't exist
  let banner = document.getElementById('banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'banner';
    document.body.appendChild(banner);
  }

  // Set banner content
  banner.className = ''; // Reset classes
  banner.innerHTML = `
    <div class="banner ${bannerOptions.type}">
      <div class="banner-content">
        <div class="banner-message">${bannerOptions.message}</div>
        <button class="banner-close" aria-label="Close banner">&times;</button>
      </div>
    </div>
  `;

  // Add close handler
  const closeBtn = banner.querySelector('.banner-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideBanner);
  }

  // Store current banner options
  currentBanner = bannerOptions;

  // Trigger reflow to ensure the initial state is applied
  void banner.offsetHeight;
  
  // Show the banner with animation
  banner.classList.add('visible');
  
  // Force reflow to ensure the transition starts
  void banner.offsetHeight;
  
  // Dispatch custom event after the banner is visible
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('banner:show', { detail: bannerOptions }));
  }, 50);
  
  // Auto-hide if duration is set and auto-hide is enabled
  if (bannerOptions.duration > 0 && bannerOptions.autoHide !== false) {
    console.log('Setting banner timeout for', bannerOptions.duration, 'ms');
    
    // Clear any existing timeout first
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    
    // Set new timeout with a small delay to ensure banner is fully visible
    hideTimeout = setTimeout(() => {
      console.log('Auto-hiding banner after timeout');
      hideBanner();
    }, bannerOptions.duration + 100); // Add small buffer time
  } else {
    console.log('Auto-hide disabled for banner');
  }
  
  return true;
}

/**
 * Hides the currently visible banner
 */
function hideBanner() {
  const banner = document.getElementById('banner');
  if (!banner) return;
  
  console.log('Hiding banner...');
  
  // Clear any pending hide timeout
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
  
  // Only proceed if banner is actually visible
  if (!banner.classList.contains('visible')) {
    console.log('Banner already hidden, skipping hide animation');
    return;
  }
  
  // Remove visible class to trigger hide animation
  banner.classList.remove('visible');
  
  // Wait for the hide animation to complete
  const onTransitionEnd = () => {
    // Remove the event listener
    banner.removeEventListener('transitionend', onTransitionEnd);
    
    // Only remove if banner still exists and is not visible
    if (banner.parentNode && !banner.classList.contains('visible')) {
      console.log('Removing banner from DOM');
      banner.parentNode.removeChild(banner);
      
      // Dispatch custom event
      document.dispatchEvent(new CustomEvent('banner:hide'));
    }
  };
  
  // Listen for transition end
  banner.addEventListener('transitionend', onTransitionEnd, { once: true });
  
  // Fallback in case transitionend doesn't fire
  setTimeout(() => {
    if (banner.parentNode && !banner.classList.contains('visible')) {
      banner.removeEventListener('transitionend', onTransitionEnd);
      banner.parentNode.removeChild(banner);
      document.dispatchEvent(new CustomEvent('banner:hide'));
    }
  }, 1000); // 1 second should be more than enough for the animation
  
  currentBanner = null;
}

// Initialize banner system
function initBannerSystem() {
  // Small delay to ensure CSS is loaded and ready for animation
  setTimeout(async () => {
    try {
      // Load banners from JSON if path is configured
      if (config.bannersPath) {
        await loadBanners();
      }
      
      // Show banner on load if enabled
      if (config.showOnLoad) {
        // Force reflow before showing banner
        document.body.offsetHeight;
        const bannerKey = typeof config.showOnLoad === 'string' ? config.showOnLoad : 'default';
        showBanner(bannerKey);
      }
    } catch (error) {
      console.error('Error initializing banner system:', error);
    }
  }, 100); // Small delay to ensure CSS is loaded
}

// Initialize when DOM is ready
function init() {
  // First initialize config
  initConfig();
  
  // Then initialize the banner system
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBannerSystem);
  } else {
    initBannerSystem();
  }
}

// Start initialization
init();

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

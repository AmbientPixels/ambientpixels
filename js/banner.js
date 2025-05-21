// File: /js/banner.js – Modular Nova-Themed Banner System

// Helper functions
function getCurrentMood() {
  // Look for mood data in various elements
  const moodElements = [
    document.getElementById('mood-synth'),
    document.getElementById('nova-mood'),
    document.querySelector('#novaMoodGrid .mood-commentary')
  ];

  for (const element of moodElements) {
    if (element) {
      try {
        const moodData = JSON.parse(element.getAttribute('data-mood'));
        if (moodData) {
          console.log('Found mood data:', JSON.stringify(moodData, null, 2));
          return moodData;
        }
      } catch (e) {
        console.warn('Failed to parse mood data:', e);
      }
    }
  }
  
  // Fallback mood data
  return {
    mood: 'neutral',
    aura: 'glitchy',
    auraColorHex: '#431571',
    quote: 'System initializing...',
    emoji: 'ℹ️',
    internalState: 'stable',
    observation: 'System booting up',
    context: {
      trigger: 'system initialization',
      influences: ['initialization', 'startup']
    }
  };
}

function getBannerIcon(type) {
  return {
    info: 'ℹ️',
    warn: '⚠️',
    critical: '❌'
  }[type] || 'ℹ️';
}

function getBannerMessage(type) {
  const mood = getCurrentMood();
  console.log('Using mood data:', mood);
  
  // Fallback if mood data is missing
  if (!window.bannerConfig.messages) {
    console.warn('Banner config not loaded');
    return {
      message: "Nova system status: Initializing...",
      type: 'info',
      duration: 5000,
      mood: 'neutral'
    };
  }

  if (!mood || !window.bannerConfig.moodMap[mood.mood]) {
    const defaultMessages = window.bannerConfig.messages[type] || window.bannerConfig.messages.info;
    const defaultMessage = window.bannerConfig.randomize 
      ? defaultMessages[Math.floor(Math.random() * defaultMessages.length)]
      : defaultMessages[0];
    
    // Replace template variables with fallback values
    const processedDefault = defaultMessage.message
      .replace('{mood.emoji}', '')
      .replace('{mood.quote}', 'System initializing...')
      .replace('{mood.internalState}', 'stable')
      .replace('{mood.observation}', 'System booting up')
      .replace('{mood.context.trigger}', 'system initialization')
      .replace('{mood.context.influences}', 'initialization, startup')
      .replace('{mood.mood}', 'neutral')
      .replace('{mood.aura}', 'glitchy');
    
    return {
      message: processedDefault,
      type: type,
      duration: defaultMessage.duration,
      mood: 'neutral'
    };
  }

  const mappedType = window.bannerConfig.moodMap[mood.mood];
  const messages = window.bannerConfig.messages[mappedType] || [];

  const message = messages[Math.floor(Math.random() * messages.length)];
  
  // Replace template variables with actual mood data
  const processedMessage = message.message
    .replace('{mood.emoji}', '')
    .replace('{mood.quote}', mood.quote || 'System initializing...')
    .replace('{mood.internalState}', mood.internalState || 'stable')
    .replace('{mood.observation}', mood.observation || 'System booting up')
    .replace('{mood.context.trigger}', mood.context?.trigger || 'system initialization')
    .replace('{mood.context.influences}', Array.isArray(mood.context?.influences) 
      ? mood.context.influences.join(', ') 
      : mood.context?.influences || 'initialization, startup')
    .replace('{mood.mood}', mood.mood || 'neutral')
    .replace('{mood.aura}', mood.aura || 'glitchy');

  return {
    message: processedMessage,
    type: mappedType,
    duration: message.duration,
    mood: mood.mood
  };
}

function showBanner(type, duration = 5000) {
  // Fallback if config is not loaded
  if (!window.bannerConfig.messages) {
    console.warn('Banner config not loaded');
    return null;
  }

  const messageConfig = getBannerMessage(type);
  const message = messageConfig.message;
  const actualDuration = messageConfig.duration || duration;

  const banner = document.createElement('div');
  banner.className = `banner ${messageConfig.type}`;
  banner.style.backgroundColor = window.bannerConfig.colorMap[messageConfig.type] || '#333';
  banner.innerHTML = `
    <div class="banner-content">
      <span class="banner-icon">${getBannerIcon(messageConfig.type)}</span>
      <span class="banner-message">${message}</span>
      <button class="banner-close" aria-label="Close Banner">×</button>
    </div>
  `;

  // Style the close button
  const closeBtn = banner.querySelector('.banner-close');
  if (closeBtn) {
    closeBtn.style.position = 'absolute';
    closeBtn.style.right = '10px';
    closeBtn.style.top = '50%';
    closeBtn.style.transform = 'translateY(-50%)';
    closeBtn.style.backgroundColor = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.fontSize = '1.2em';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '0 5px';
    closeBtn.style.color = '#fff';
    closeBtn.style.opacity = '0.8';
    closeBtn.style.transition = 'opacity 0.2s';
    closeBtn.style.hover = {
      opacity: '1'
    };
    closeBtn.onclick = () => hideBanner(banner);
  }

  const existing = document.querySelector('.banner');
  if (existing) {
    hideBanner(existing);
  }

  const container = document.getElementById('banner-container');
  if (!container) return;
  container.appendChild(banner);
  banner.classList.add('show');

  if (window.bannerConfig.autoHide) {
    setTimeout(() => hideBanner(banner), actualDuration);
  }

  return banner;
}

function hideBanner(el) {
  el.classList.remove('show');
  setTimeout(() => el.remove(), 300);
}

// Initialize banner system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Ensure banner config is loaded
  if (!window.bannerConfig) {
    console.error('Banner config not found');
    return;
  }

  // Initialize banner system
  console.log('Banner system initializing...');
  console.log('Banner config:', window.bannerConfig);

  // Create banner element if it doesn't exist
  if (!document.querySelector('.banner')) {
    const banner = document.createElement('div');
    banner.className = 'banner';
    document.body.appendChild(banner);
  }

  // Initialize banner system if configured
  if (window.bannerConfig.showOnLoad) {
    console.log('Showing banner on load');
    const currentMood = getCurrentMood();
    if (currentMood) {
      // Get the mood type directly from moodMap
      const moodType = window.bannerConfig.moodMap[currentMood.mood] || 'info';
      showBanner(moodType);
    }
  }

  // Initialize close button
  const closeBtn = document.querySelector('.banner-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hideBanner(closeBtn.closest('.banner'));
    });
  }
});

// Export functions for external use
window.banner = {
  show: showBanner,
  hide: hideBanner
};

// Export config for external access
window.bannerConfig = bannerConfig;

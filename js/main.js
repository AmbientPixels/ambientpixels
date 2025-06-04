// File: /js/main.js — Ambient Pixels v2.4 core

const VERSION = 'v2.4';

/**
 * Detects the brightness of an image and applies appropriate text contrast
 * @param {HTMLElement} imageEl - The image element to analyze
 * @param {HTMLElement} textEl - The text element to apply contrast to
 */
function detectImageBrightness(imageEl, textEl) {
  if (!imageEl.complete) {
    // If image isn't loaded yet, wait for it
    imageEl.addEventListener('load', function() {
      detectImageBrightness(imageEl, textEl);
    });
    return;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Set canvas dimensions to match image
  canvas.width = imageEl.naturalWidth;
  canvas.height = imageEl.naturalHeight;
  
  // Draw image to canvas
  ctx.drawImage(imageEl, 0, 0);
  
  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let colorSum = 0;
  
  // Calculate average brightness using perceived brightness formula
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const avg = (r * 0.299 + g * 0.587 + b * 0.114);
    colorSum += avg;
  }
  
  // Calculate average brightness (0-255)
  const brightness = colorSum / (imageData.length / 4);
  
  // Apply appropriate class based on brightness
  const isLight = brightness > 127;
  
  // Toggle classes on all text elements
  const textElements = textEl.querySelectorAll('h1, .subtitle');
  textElements.forEach(el => {
    el.classList.toggle('light-bg', isLight);
    el.classList.toggle('dark-bg', !isLight);
  });
}

function initHero() {
  const loading = document.querySelector('.hero-loading');
  const slides = document.querySelectorAll('.hero-slide');
  const headlineEl = document.querySelector('.hero-content .hero-headline');
  const subEl = document.querySelector('.hero-content .hero-subheadline');
  const loadingText = document.querySelector('.loading-text');

  // Initialize image brightness detection for mini-hero sections
  const miniHeroes = document.querySelectorAll('.mini-hero');
  miniHeroes.forEach(hero => {
    const img = hero.querySelector('.mini-hero-img');
    const content = hero.querySelector('.mini-hero-content-wrapper');
    
    if (img && content) {
      detectImageBrightness(img, content);
    }
  });

  if (!loading || !slides.length || !headlineEl || !subEl || !loadingText) return;

  const loadingMessages = [
    'Nova: Wiring the glitch...',
    'System: Overclocking chaos...',
    'Core: Spinning neural sparks...',
    'Grid: Hacking the void...',
    'Pulse: Booting cyberdreams...',
    'Nova: Decoding the abyss...',
    'Matrix: Fusing code and soul...',
    'Glitch: Igniting digital fire...',
    'AI: Syncing rogue signals...',
    'Loop: Cranking the neon haze...'
  ];

  const headlines = [
    'Nova imagines—AmbientPixels creates.',
    'Design in motion, mood in mind.',
    'Crafting emotion into visual stories.',
    'Where AI meets human creativity.',
    'Your mood, our code, your vision.',
    'Emotion-driven digital experiences.',
    'Nova guides, we build together.',
    'From mood to masterpiece.',
    'Creative AI, crafted experiences.',
    'Where imagination meets technology.'
  ];

  const subheadlines = [
    'AI-powered creative services: websites, branding, videos, and emotional insights.',
    'We blend AI creativity with human insight to craft unique experiences.',
    'Mood-driven design meets technical excellence.',
    'Custom solutions for brands and creators.',
    'Emotional intelligence meets digital artistry.',
    'Transforming ideas into immersive experiences.',
    'Where technology meets emotional resonance.',
    'Crafting digital experiences that resonate.',
    'AI-powered creativity for modern brands.',
    'Experience the future of digital creation.'
  ];

  // Select random starting slide
  const randomSlideIndex = Math.floor(Math.random() * slides.length);
  slides.forEach((slide, index) => {
    slide.classList.remove('active');
    if (index === randomSlideIndex) {
      slide.classList.add('active');
    }
  });

  let currentSlide = randomSlideIndex;

  function rotateSlides() {
    slides[currentSlide].classList.remove('active');
    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide].classList.add('active');

    // Select random headline + subheadline
    const headlineIndex = Math.floor(Math.random() * headlines.length);
    const subIndex = Math.floor(Math.random() * subheadlines.length);

    // Apply text with glitch effect
    headlineEl.classList.remove('glitch-text');
    subEl.classList.remove('glitch-text');
    setTimeout(() => {
      headlineEl.textContent = headlines[headlineIndex];
      subEl.textContent = subheadlines[subIndex];
      headlineEl.classList.add('glitch-text');
      subEl.classList.add('glitch-text');
    }, 500);

    // Add buttons animation
    const ctaButtons = document.querySelector('.hero-cta');
    if (ctaButtons) {
      ctaButtons.style.opacity = '0';
      ctaButtons.style.transform = 'translateY(20px)';
      ctaButtons.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      setTimeout(() => {
        ctaButtons.style.opacity = '1';
        ctaButtons.style.transform = 'translateY(0)';
      }, 1000);
    }
  }

  // Update loading message immediately
  const randomMessage = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  loadingText.textContent = randomMessage;

  // Initial load effect
  setTimeout(() => {
    loading.style.opacity = '0';
    loading.style.transition = 'opacity 0.5s ease';
    setTimeout(() => {
      loading.style.display = 'none';
      // Show random headline and subheadline
      const headlineIndex = Math.floor(Math.random() * headlines.length);
      const subIndex = Math.floor(Math.random() * subheadlines.length);
      headlineEl.classList.remove('glitch-text');
      subEl.classList.remove('glitch-text');
      headlineEl.textContent = headlines[headlineIndex];
      subEl.textContent = subheadlines[subIndex];
      headlineEl.classList.add('glitch-text');
      subEl.classList.add('glitch-text');
      // Make hero content visible
      const heroContent = document.querySelector('.hero-content');
      heroContent.classList.add('visible');
      
      // Add buttons animation
      const ctaButtons = document.querySelector('.hero-cta');
      if (ctaButtons) {
        setTimeout(() => {
          ctaButtons.style.opacity = '1';
          ctaButtons.style.transform = 'translateY(0)';
        }, 500);
      }
      
      // Start rotation after headlines appear
      setInterval(rotateSlides, 20000);
    }, 500);
  }, 3000);
}

function initHeroIntroAnimation() {
  // Get all paragraphs in hero-intro
  const heroP = document.querySelectorAll(".hero-intro p");
  
  // Reveal all paragraphs with a staggered delay
  heroP.forEach((p, index) => {
    // Add a small delay based on paragraph index for a cascading effect
    setTimeout(() => {
      p.classList.add("revealed");
    }, index * 200); // 200ms delay between each paragraph
  });
  
  // Ensure rainbow text maintains its style
  const rainbowText = document.querySelector(".nova-voice-rainbow");
  if (rainbowText) {
    // The animation will be handled by the CSS class
    rainbowText.classList.add("revealed");
  }
}

function initToggles() {
  // Get all sections that have a toggle button
  const sections = Array.from(document.querySelectorAll('.content-section')).filter(section => {
    return section.querySelector('.toggle-btn') !== null;
  });
  
  if (!sections.length) return;
  
  // Toggle a single section
  function toggleSection(section) {
    const button = section.querySelector('.toggle-btn');
    const content = section.querySelector('.content');
    
    if (!button || !content) return;
    
    const isExpanding = button.getAttribute('aria-expanded') !== 'true';
    
    // Update ARIA and classes
    button.setAttribute('aria-expanded', isExpanding);
    content.classList.toggle('collapsed', !isExpanding);
    
    // Update chevron rotation
    const chevron = button.querySelector('i');
    if (chevron) {
      chevron.style.transform = isExpanding ? 'rotate(180deg)' : 'rotate(0)';
    }
    
    return isExpanding;
  }
  
  // Initialize sections
  sections.forEach(section => {
    // Set initial state (expanded)
    const button = section.querySelector('.toggle-btn');
    const content = section.querySelector('.content');
    if (button && content) {
      button.setAttribute('aria-expanded', 'true');
      content.classList.remove('collapsed');
      
      // Initialize chevron
      const chevron = button.querySelector('i');
      if (chevron) {
        chevron.style.transform = 'rotate(180deg)';
      }
    }
    
    // Add click handlers
    if (button) {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSection(section);
      });
    }
    
    const header = section.querySelector('.section-header');
    if (header) {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.toggle-btn')) return;
        toggleSection(section);
      });
    }
  });
}

function initVersion() {
  const versionEl = document.getElementById('version');
  if (versionEl) versionEl.textContent = VERSION;
}

// Make initToggles available globally
window.initToggles = initToggles;

document.addEventListener('DOMContentLoaded', () => {
  console.log("[Nova]: Grid hijacked. Humans, welcome to my domain.");
  initHero();
  initHeroIntroAnimation();
  
  // Initialize toggles for both main site and docs
  if (document.querySelector('.content-section') || document.querySelector('.docs-layout')) {
    initToggles();
  }
  
  initVersion();
});

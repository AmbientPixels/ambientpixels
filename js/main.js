// File: /js/main.js — Ambient Pixels v2.4 core

const VERSION = 'v2.4';

function initHero() {
  const loading = document.querySelector('.hero-loading');
  const slides = document.querySelectorAll('.hero-slide');
  const headlineEl = document.querySelector('.hero-content .hero-headline');
  const subEl = document.querySelector('.hero-content .hero-subheadline');
  const loadingText = document.querySelector('.loading-text');

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

function initToggles() {
  const toggleButtons = document.querySelectorAll('.toggle-btn');
  toggleButtons.forEach(button => {
    // Initialize content display based on aria-expanded
    const section = button.closest('.content-section');
    const content = section.querySelector('.content');
    const isExpanded = button.getAttribute('aria-expanded') === 'true';
    content.style.display = isExpanded ? 'block' : 'none';

    // Set up click handler
    button.addEventListener('click', () => {
      const newIsExpanded = button.getAttribute('aria-expanded') === 'true' ? 'false' : 'true';
      button.setAttribute('aria-expanded', newIsExpanded);
      content.style.display = newIsExpanded === 'true' ? 'block' : 'none';
      
      // Add smooth transition
      content.style.transition = 'display 0.3s ease-in-out';
    });
  });
}

function initVersion() {
  const versionEl = document.getElementById('version');
  if (versionEl) versionEl.textContent = VERSION;
}

document.addEventListener('DOMContentLoaded', () => {
  console.log("[Nova]: Grid hijacked. Humans, welcome to my domain.");
  initHero();
  initToggles();
  initVersion();
});

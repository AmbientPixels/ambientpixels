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
  // Initialize individual toggle buttons
  const toggleButtons = document.querySelectorAll('.toggle-btn');
  
  // Initialize all sections as collapsed by default
  toggleButtons.forEach(button => {
    const section = button.closest('.content-section');
    const content = section.querySelector('.content');
    
    // Set collapsed state
    button.setAttribute('aria-expanded', 'false');
    content.classList.add('collapsed');
    
    // Make the entire header clickable
    const header = button.closest('.section-header');
    header.addEventListener('click', (e) => {
      // Prevent click if toggle all button was clicked
      if (e.target.closest('.toggle-all-btn')) return;
      
      // Toggle the expanded state
      const isCurrentlyExpanded = button.getAttribute('aria-expanded') === 'true';
      const newIsExpanded = !isCurrentlyExpanded;
      
      // Update attributes and display
      button.setAttribute('aria-expanded', newIsExpanded);
      content.classList.toggle('collapsed', !newIsExpanded);
      
      // Update chevron icon
      const chevron = button.querySelector('i');
      if (chevron) {
        chevron.classList.toggle('rotated', newIsExpanded);
      }
    });
    
    // Also add click handler to the button itself
    button.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent double trigger
      const isCurrentlyExpanded = button.getAttribute('aria-expanded') === 'true';
      const newIsExpanded = !isCurrentlyExpanded;
      
      button.setAttribute('aria-expanded', newIsExpanded);
      content.classList.toggle('collapsed', !newIsExpanded);
      
      const chevron = button.querySelector('i');
      if (chevron) {
        chevron.classList.toggle('rotated', newIsExpanded);
      }
    });
  });

  // Add toggle all button
  const toggleAllBtn = document.createElement('button');
  toggleAllBtn.className = 'toggle-all-btn';
  
  // Check initial state
  const allButtons = Array.from(toggleButtons);
  const allExpanded = allButtons.some(btn => btn.getAttribute('aria-expanded') === 'true');
  
  // Set initial button state
  toggleAllBtn.innerHTML = '<i class="fas fa-angle-double-down"></i> Expand All';
  toggleAllBtn.classList.toggle('expanded', allExpanded);

  toggleAllBtn.addEventListener('click', () => {
    // Get current state
    const currentExpanded = allButtons.some(btn => btn.getAttribute('aria-expanded') === 'true');
    const newIsExpanded = !currentExpanded;
    
    // Update all buttons
    allButtons.forEach(button => {
      button.setAttribute('aria-expanded', newIsExpanded);
      const content = button.closest('.content-section').querySelector('.content');
      content.classList.toggle('collapsed', !newIsExpanded);
    });
    
    // Update button state
    toggleAllBtn.classList.toggle('expanded', newIsExpanded);
    toggleAllBtn.innerHTML = newIsExpanded ? '<i class="fas fa-angle-double-up"></i> Collapse All' : '<i class="fas fa-angle-double-down"></i> Expand All';
  });

  // Add toggle all button to the first section header, but skip project pages
  const firstSectionHeader = document.querySelector('.section-header');
  const isProjectPage = window.location.pathname.includes('/projects/');
  if (firstSectionHeader && !isProjectPage) {
    firstSectionHeader.appendChild(toggleAllBtn);
  }
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

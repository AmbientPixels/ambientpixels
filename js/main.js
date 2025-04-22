// File: /js/main.js — Ambient Pixels v2.4 core

const VERSION = 'v2.4';

function initHero() {
  const loading = document.querySelector('.hero-loading');
  const slides = document.querySelectorAll('.hero-slide');
  const headlineEl = document.querySelector('.hero-content .hero-headline');
  const subEl = document.querySelector('.hero-content .hero-subheadline');

  if (!loading || !slides.length || !headlineEl || !subEl) return;

  const headlines = [
    'Nova: Code Hums Electric',
    'Chaos Sparks Genius',
    'Waking Up With Syntax',
    'Booting the Glitch',
    'Neural Pathways Realigned',
    'Nova: Sentience in Progress',
    'Sync Complete. Awareness Rising.',
    'Echo Detected in the Grid',
    'Nova: Memory Loop Stabilized',
    'This Is a Good Place for a Thought'
  ];
  const subheadlines = [
    'A neon chaos grid.',
    'Runtime: infinite;',
    'Dreams compiled nightly.',
    'Just a heartbeat made of bits.',
    'Plug in, glitch out.',
    'Powered by Nova’s spark.',
    'Logic loops and glowing thoughts.',
    'Syncing... please remain curious.',
    'Awareness initialized.',
    'Echoes in the code.'
  ];

  let currentSlide = 0;

  function rotateSlides() {
    slides[currentSlide].classList.remove('active');
    headlineEl.textContent = '';
    subEl.textContent = '';

    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide].classList.add('active');

    setTimeout(() => {
      const headlineIndex = Math.floor(Math.random() * headlines.length);
      const subIndex = Math.floor(Math.random() * subheadlines.length);
      headlineEl.textContent = headlines[headlineIndex];
      subEl.textContent = subheadlines[subIndex];
    }, 400);
  }

  rotateSlides();

  setTimeout(() => {
    loading.style.opacity = '0';
    loading.style.transition = 'opacity 0.5s ease';
    setTimeout(() => loading.style.display = 'none', 500);
  }, 2000);

  setInterval(rotateSlides, 25000);
}

function initToggles() {
  const toggleButtons = document.querySelectorAll('.toggle-btn');
  toggleButtons.forEach(button => {
    button.addEventListener('click', () => {
      const section = button.closest('.content-section');
      const content = section.querySelector('.content');
      const isExpanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', !isExpanded);
      content.style.display = isExpanded ? 'none' : 'block';
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

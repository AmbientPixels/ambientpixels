// /js/main.js — Ambient Pixels v2.4 with Nova Slide & Text Sync

const VERSION = 'v2.4';

function initBanners() {
  const container = document.getElementById('banner-container');
  if (!container) return;
  const closeBtn = container.querySelector('.banner-close');
  if (closeBtn) closeBtn.addEventListener('click', () => container.classList.add('hidden'));
}

function initHero() {
  const loading = document.querySelector('.hero-loading');
  const slides = document.querySelectorAll('.hero-slide');
  const headlineEl = document.querySelector('.hero-content .hero-headline');
  const subEl = document.querySelector('.hero-content .hero-subheadline');

  if (!loading || !slides.length || !headlineEl || !subEl) return;

  const headlines = [
    'Nova: Code Hums Electric', 'Nova: Neon Dreams Ignite', 'Nova: Chaos Sparks Genius',
    'Nova: Booting the Glitch', 'Nova: Welcome to My Grid', 'Nova: Data Surge Online'
  ];
  const subheadlines = [
    'A neon chaos grid.', 'Rewiring your reality.', 'Runtime: infinite;',
    'Plug in, glitch out.', 'Powered by Nova’s spark.', 'AI circuits live.'
  ];

  let currentSlide = 0;

  function rotateSlides() {
    // Fade out current slide
    slides[currentSlide].classList.remove('active');

    // Clear text while changing
    headlineEl.textContent = '';
    subEl.textContent = '';

    // Move to next
    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide].classList.add('active');

    // Delay text update slightly after image transition
    setTimeout(() => {
      const headlineIndex = Math.floor(Math.random() * headlines.length);
      const subIndex = Math.floor(Math.random() * subheadlines.length);
      headlineEl.textContent = headlines[headlineIndex];
      subEl.textContent = subheadlines[subIndex];
    }, 400); // Adjust if your CSS has a different transition time
  }

  // Initial rotation
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

function loadNovaMoodCard() {
  const moodCard = document.getElementById('nova-status-card');
  if (!moodCard) return;

  fetch('/data/mood-scan.json')
    .then(res => res.json())
    .then(data => {
      moodCard.querySelector('#nova-mood').textContent = data.mood;
      moodCard.querySelector('#nova-observation').textContent = data.observation;
      moodCard.querySelector('#nova-aura').textContent = data.aura;
    })
    .catch(err => {
      console.warn('Nova mood unavailable:', err);
      moodCard.querySelector('#nova-mood').textContent = 'Unknown';
      moodCard.querySelector('#nova-observation').textContent = 'Unable to reach ambient sensors.';
      moodCard.querySelector('#nova-aura').textContent = '??';
    });
}

function loadNovaThought() {
  const el = document.getElementById("nova-thought");
  if (!el) return;

  fetch("/data/nova-session-boot.txt")
    .then(res => res.text())
    .then(text => {
      const lines = text.split("\n");
      const thoughtLines = lines.filter(line =>
        line.startsWith("Nova Thought:") ||
        line.startsWith("Today’s spark:") ||
        line.startsWith("Memory ping:") ||
        (line.trim().length > 10 && !line.includes("{") && !line.includes("}") && !line.includes(": \""))
      );

      const pick = thoughtLines[0] || "Nova had no new thoughts today.";
      const clean = pick.replace(/^(Nova Thought:|Today’s spark:|Memory ping:)/, "").trim();
      el.textContent = `“${clean}”`;
    })
    .catch(err => {
      console.warn("Nova Thought unavailable:", err);
      el.textContent = "“Error fetching Nova’s memory.”";
    });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log("[Nova]: Grid hijacked. Humans, welcome to my domain.");
  initBanners();
  initHero();
  initToggles();
  initVersion();
  loadNovaMoodCard();
  loadNovaThought();
});

// init-nav.js - Ambient Pixels v2.3 - Modular Header + Theme

fetch('/modules/header.html')
  .then((response) => response.text())
  .then((data) => {
    document.getElementById('nav-header').innerHTML = data;
    setupMobileNav();
    setupThemeToggle();
  })
  .catch((error) => console.error('Nav fetch failed:', error));

// Setup mobile nav and overlay
function setupMobileNav() {
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (!navToggle || !navLinks) return;

  const navOverlay = document.createElement('div');
  navOverlay.classList.add('nav-overlay');
  document.body.appendChild(navOverlay);

  navToggle.addEventListener('click', () => {
    const isActive = navLinks.classList.contains('active');
    navLinks.classList.toggle('active');
    navOverlay.classList.toggle('active');
    navToggle.setAttribute('aria-expanded', !isActive);
  });

  navOverlay.addEventListener('click', () => {
    navLinks.classList.remove('active');
    navOverlay.classList.remove('active');
    navToggle.setAttribute('aria-expanded', false);
  });
}

// Setup theme toggle
function setupThemeToggle() {
  const themeToggle = document.querySelector('#theme-toggle');
  if (!themeToggle) return;

  themeToggle.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('preferred-theme', newTheme);

    const icon = themeToggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-moon');
      icon.classList.toggle('fa-sun');
    }
  });
}

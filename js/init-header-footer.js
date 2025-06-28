// File: /js/init-header-footer.js – Modular Header/Footer + Nav + Pulse Inject

// Inject Header
fetch('/modules/header.html')
  .then(r => r.text())
  .then(html => {
    const header = document.getElementById('nav-header');
    if (header) {
      header.innerHTML = html;
      setupMobileNav();
      setupThemeToggle();
      if (window.bindAuthButtons) window.bindAuthButtons();
    }
  });

// Inject Footer
fetch('/modules/footer.html')
  .then(r => r.text())
  .then(html => {
    const footer = document.getElementById('footer-container');
    if (footer) footer.innerHTML = html;
  })
  .then(() => {
    // Dynamically load nova-whispers.js after the footer is injected
    const script = document.createElement('script');
    script.src = '/js/nova-whispers.js';
    script.defer = true;
    document.body.appendChild(script);
  });

// Mobile Nav
function setupMobileNav() {
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (!navToggle || !navLinks) return;

  const overlay = document.createElement('div');
  overlay.classList.add('nav-overlay');
  document.body.appendChild(overlay);

  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    overlay.classList.toggle('active');
  });

  overlay.addEventListener('click', () => {
    navLinks.classList.remove('active');
    overlay.classList.remove('active');
  });
}

// Theme Toggler
function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('preferred-theme', next);

    const icon = toggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-sun', next === 'light');
      icon.classList.toggle('fa-moon', next === 'dark');
    }
  });
}

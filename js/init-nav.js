// /js/init-nav.js - Ambient Pixels v2.3

// Inject header
fetch('/modules/header.html')
  .then(res => res.text())
  .then(html => {
    document.getElementById('nav-header').innerHTML = html;
    setupMobileNav();
    setupThemeToggle();
  });

// Inject footer
fetch('/modules/footer.html')
  .then(res => res.text())
  .then(html => {
    const footer = document.getElementById('footer-container');
    if (footer) {
      footer.innerHTML = html;
      initFooter();
    }
  });

// Mobile nav
function setupMobileNav() {
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (!navToggle || !navLinks) return;

  const overlay = document.createElement('div');
  overlay.classList.add('nav-overlay');
  document.body.appendChild(overlay);

  navToggle.addEventListener('click', () => {
    const active = navLinks.classList.contains('active');
    navLinks.classList.toggle('active');
    overlay.classList.toggle('active');
    navToggle.setAttribute('aria-expanded', !active);
  });

  overlay.addEventListener('click', () => {
    navLinks.classList.remove('active');
    overlay.classList.remove('active');
    navToggle.setAttribute('aria-expanded', false);
  });
}

// Theme toggle
function setupThemeToggle() {
  const toggle = document.querySelector('#theme-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const dark = document.body.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('preferred-theme', next);

    const icon = toggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-moon');
      icon.classList.toggle('fa-sun');
    }
  });
}

// Footer version & Nova sync
function initFooter() {
  const versionEl = document.getElementById('version');
  fetch('/data/version.json')
    .then(res => res.json())
    .then(data => {
      if (versionEl) versionEl.textContent = data.version;
    });

  const topBtn = document.querySelector('.back-to-top');
  if (topBtn) {
    topBtn.addEventListener('click', e => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  fetch('/data/nova-session-boot.html')
    .then(res => res.text())
    .then(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const pre = doc.querySelector('pre')?.textContent || '';
      const start = pre.indexOf('//// Version ////');
      if (start === -1) return;

      const jsonStart = pre.indexOf('{', start);
      const jsonEnd = pre.indexOf('}', jsonStart) + 1;
      const json = pre.slice(jsonStart, jsonEnd);
      const version = JSON.parse(json);

      const date = new Date(version.updated);
      if (isNaN(date)) return;

      const formatted = date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
        timeZoneName: 'short'
      });

      const stamp = document.createElement('p');
      stamp.className = 'nova-sync-time';
      stamp.textContent = `🕒 Nova Memory Synced: ${formatted}`;

      const footerMeta = document.querySelector('.footer .grid-col-12');
      if (footerMeta) {
        footerMeta.appendChild(stamp);
      }
    });
}
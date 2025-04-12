// /js/init-nav.js – Inject header and footer
fetch('/modules/header.html').then(r => r.text()).then(html => {
  document.getElementById('nav-header').innerHTML = html;
  setupMobileNav();
  setupThemeToggle();
});

fetch('/modules/footer.html').then(r => r.text()).then(html => {
  const footer = document.getElementById('footer-container');
  if (footer) {
    footer.innerHTML = html;
    initFooter();
  }
});

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

function initFooter() {
  fetch('/data/version.json')
    .then(res => res.json())
    .then(data => {
      const versionEl = document.getElementById('version');
      if (versionEl) versionEl.textContent = data.version;
    });

  fetch('/data/nova-session-boot.html')
    .then(res => res.text())
    .then(html => {
      const stamp = document.createElement('p');
      stamp.className = 'nova-sync-time';
      stamp.textContent = 'Nova Memory Synced: just now';
      const footerMeta = document.querySelector('.footer .grid-col-12');
      if (footerMeta) footerMeta.appendChild(stamp);
    });
}

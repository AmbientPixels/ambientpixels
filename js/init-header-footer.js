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
      markActiveNavLink();
      if (window.bindAuthButtons) window.bindAuthButtons();
    }
  });

// Inject Footer
fetch('/modules/footer.html')
  .then(r => r.text())
  .then(html => {
    const footerContainer = document.getElementById('footer-container');
    if (!footerContainer) return;

    // Use a DOMParser for safe and efficient parsing
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Get all scripts from the parsed document
    const scripts = Array.from(doc.querySelectorAll('script'));
    
    // Append the HTML content from the parsed doc's body to the footer container
    // This adds the structure without executing scripts
    footerContainer.append(...doc.body.childNodes);

    // Now, append the scripts to the document's body to trigger execution.
    // Wrapped in try/catch because the act of appending a <script> causes the
    // browser to parse and execute its inline content — if that content has a
    // syntax error, the SyntaxError bubbles up here. This was producing 39
    // localhost-only errors/month from VSCode Live Server's injected reload
    // script. Production was unaffected, but the noise polluted App Insights
    // and the dashboard's error count. The catch makes future occurrences a
    // local console warning instead of a global window.onerror event.
    scripts.forEach(script => {
      const newScript = document.createElement('script');
      // Copy attributes (src, defer, etc.)
      for (const { name, value } of script.attributes) {
        newScript.setAttribute(name, value);
      }
      // Copy inline script content
      if (script.innerHTML) {
        newScript.innerHTML = script.innerHTML;
      }
      try {
        document.body.appendChild(newScript);
      } catch (e) {
        console.warn('[init-header-footer] Failed to inject footer script:', e.message);
      }
    });
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

// Active Nav Link
function markActiveNavLink() {
  var path = window.location.pathname.toLowerCase().replace(/\/index\.html$/, '/');
  var links = document.querySelectorAll('.nav-links a');
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute('href');
    if (!href) continue;
    var linkPath = href.toLowerCase().replace(/\/index\.html$/, '/');
    if (path === linkPath || (linkPath !== '/' && path.indexOf(linkPath) === 0)) {
      links[i].classList.add('nav-link-active');
    }
  }
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

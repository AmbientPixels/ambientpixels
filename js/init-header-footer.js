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

    // Now, append the scripts to the document's body to trigger execution
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
      document.body.appendChild(newScript);
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

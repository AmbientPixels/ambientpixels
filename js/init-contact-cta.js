// File: /js/init-contact-cta.js – Initialize CTA and Modal Modules

document.addEventListener('DOMContentLoaded', () => {
  // Load and inject modules
  const loadModule = (url, containerId) => {
    fetch(url)
      .then(r => r.text())
      .then(html => {
        const container = document.getElementById(containerId);
        if (container) container.innerHTML = html;
      })
      .catch(err => console.error(`Error loading ${url}:`, err));
  };

  // Load Contact CTA
  loadModule('/modules/contact-cta.html', 'contact-cta');
  
  // Load Services CTA
  loadModule('/modules/services-cta.html', 'services-cta');
  
  // Load Contact Modal
  loadModule('/modules/contact-modal.html', 'contact-modal-container');
});

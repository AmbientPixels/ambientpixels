// File: /js/init-contact-cta.js – Initialize Contact CTA Module

document.addEventListener('DOMContentLoaded', () => {
  // Inject Contact CTA
  fetch('/modules/contact-cta.html')
    .then(r => r.text())
    .then(html => {
      const cta = document.getElementById('contact-cta');
      if (cta) cta.innerHTML = html;
    });
});

/* File: /js/projects.js - Ambient Pixels v2.3 - May 14, 2025 */
document.addEventListener('DOMContentLoaded', () => {
  // Toggle section content
  const toggleButtons = document.querySelectorAll('.toggle-btn.icon-only');
  toggleButtons.forEach(button => {
    button.addEventListener('click', () => {
      const isExpanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', !isExpanded);
      const content = button.closest('.section-header').nextElementSibling;
      content.style.display = isExpanded ? 'none' : 'block';
    });
  });

  // Lazy-load images (optional, if not handled by browser)
  const images = document.querySelectorAll('img[loading="lazy"]');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src || img.src;
          observer.unobserve(img);
        }
      });
    });
    images.forEach(img => observer.observe(img));
  }
});
// nav.js - Enhanced for mobile nav with overlay
document.addEventListener('DOMContentLoaded', () => {
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');
    const navOverlay = document.createElement('div');
    navOverlay.classList.add('nav-overlay');
    document.body.appendChild(navOverlay);

    if (navToggle && navLinks) {
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
});

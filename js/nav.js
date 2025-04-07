// nav.js - Ambient Pixels v2.3 - April 7, 2025
document.addEventListener('DOMContentLoaded', () => {
    const checkNavToggle = setInterval(() => {
        const navToggle = document.querySelector('.nav-toggle');
        const navLinks = document.querySelector('.nav-links');
        if (navToggle && navLinks) {
            clearInterval(checkNavToggle);
            navToggle.addEventListener('click', () => {
                navLinks.classList.toggle('active');
                navToggle.setAttribute('aria-expanded', navLinks.classList.contains('active'));
            });
        }
    }, 100); // Check every 100ms until nav loads
});
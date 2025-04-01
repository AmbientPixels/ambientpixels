// nav.js - Ambient Pixels v1.0.0-20250401
document.addEventListener('DOMContentLoaded', () => {
    console.log('Nav JS loaded - Grid navigation active');
    const navLinks = document.querySelector('.nav-links');
    const toggleBtn = document.querySelector('.nav-toggle');

    toggleBtn.addEventListener('click', () => {
        navLinks.classList.toggle('nav-open');
    });

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    function handleMobile(e) {
        if (e.matches) {
            toggleBtn.style.display = 'block';
            navLinks.classList.remove('nav-open');
        } else {
            toggleBtn.style.display = 'none';
            navLinks.classList.remove('nav-open');
        }
    }
    mediaQuery.addListener(handleMobile);
    handleMobile(mediaQuery);
});
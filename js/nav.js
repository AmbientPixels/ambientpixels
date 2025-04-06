// nav.js - Ambient Pixels v2.3 - April 5, 2025
document.addEventListener('DOMContentLoaded', () => {
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (!navToggle || !navLinks) return;

    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) navLinks.classList.remove('active');
    });
});
// nav.js - Ambient Pixels v2.1.7-20250402
// Handles nav toggle for mobile - Cleaned up with FrostyNav inspiration
document.addEventListener('DOMContentLoaded', () => {
    const navToggle = document.querySelector('.nav-toggle'); // Grab the toggle button
    const navLinks = document.querySelector('.nav-links');   // Grab the links container

    // Set initial state: Hide nav-links on mobile, show on desktop
    if (window.innerWidth <= 768) {
        navLinks.classList.add('hidden'); // Add hidden class for mobile
    } else {
        navLinks.classList.remove('hidden'); // Ensure visible on desktop
    }

    // Toggle event: Show/hide nav-links on click
    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('hidden'); // Toggle hidden class
    });

    // Resize event: Adjust visibility based on screen size
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            navLinks.classList.remove('hidden'); // Show on desktop
        } else {
            navLinks.classList.add('hidden');    // Hide on mobile
        }
    });
});
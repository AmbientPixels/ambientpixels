// grid-scripts.js - Ambient Pixels v0.17.8-20250331
function toggleSection(header) {
    const content = header.nextElementSibling;
    console.log('Toggling section:', header.textContent);
    content.classList.toggle('active');
}

document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('.grid-col-6 .section-content');
    sections.forEach(section => section.classList.add('active')); // Start open
    console.log('grid-scripts.js loaded');
});
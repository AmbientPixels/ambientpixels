// theme.js - Ambient Pixels v2.1.7-20250402
// Theme toggle logic - Flip between light and dark
document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const toggleButton = document.querySelector('.theme-toggle');
    const darkIcon = toggleButton.querySelector('.dark-icon');
    const lightIcon = toggleButton.querySelector('.light-icon');

    // Check initial theme (default dark)
    if (!body.getAttribute('data-theme')) {
        body.setAttribute('data-theme', 'dark');
    }

    // Toggle theme on click
    toggleButton.addEventListener('click', () => {
        if (body.getAttribute('data-theme') === 'dark') {
            body.setAttribute('data-theme', 'light');
            darkIcon.style.display = 'none';
            lightIcon.style.display = 'inline';
        } else {
            body.setAttribute('data-theme', 'dark');
            darkIcon.style.display = 'inline';
            lightIcon.style.display = 'none';
        }
    });
});
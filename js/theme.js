// theme.js - Ambient Pixels v2.1.4-20250402
function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const darkIcon = document.querySelector('.dark-icon');
    const lightIcon = document.querySelector('.light-icon');

    if (currentTheme === 'light') {
        body.removeAttribute('data-theme');
        darkIcon.style.display = 'inline';
        lightIcon.style.display = 'none';
    } else {
        body.setAttribute('data-theme', 'light');
        darkIcon.style.display = 'none';
        lightIcon.style.display = 'inline';
    }
    localStorage.setItem('theme', body.getAttribute('data-theme') || 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark'; // Default dark
    const body = document.body;
    const darkIcon = document.querySelector('.dark-icon');
    const lightIcon = document.querySelector('.light-icon');

    if (savedTheme === 'light') {
        body.setAttribute('data-theme', 'light');
        darkIcon.style.display = 'none';
        lightIcon.style.display = 'inline';
    } else {
        body.removeAttribute('data-theme');
        darkIcon.style.display = 'inline';
        lightIcon.style.display = 'none';
    }
});
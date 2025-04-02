// theme.js - Ambient Pixels v2.1.5-20250402
function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const darkIcons = document.querySelectorAll('.dark-icon, .dark-icon-demo');
    const lightIcons = document.querySelectorAll('.light-icon, .light-icon-demo');

    if (currentTheme === 'light') {
        body.removeAttribute('data-theme');
        darkIcons.forEach(icon => icon.style.display = 'inline');
        lightIcons.forEach(icon => icon.style.display = 'none');
    } else {
        body.setAttribute('data-theme', 'light');
        darkIcons.forEach(icon => icon.style.display = 'none');
        lightIcons.forEach(icon => icon.style.display = 'inline');
    }
    localStorage.setItem('theme', body.getAttribute('data-theme') || 'dark');
    console.log(`Theme toggled - Now: ${body.getAttribute('data-theme') || 'dark'}`);
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark'; // Default dark
    const body = document.body;
    const darkIcons = document.querySelectorAll('.dark-icon, .dark-icon-demo');
    const lightIcons = document.querySelectorAll('.light-icon, .light-icon-demo');

    if (savedTheme === 'light') {
        body.setAttribute('data-theme', 'light');
        darkIcons.forEach(icon => icon.style.display = 'none');
        lightIcons.forEach(icon => icon.style.display = 'inline');
    } else {
        body.removeAttribute('data-theme');
        darkIcons.forEach(icon => icon.style.display = 'inline');
        lightIcons.forEach(icon => icon.style.display = 'none');
    }
});
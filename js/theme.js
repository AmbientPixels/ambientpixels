// theme.js - Ambient Pixels v1.0.0-20250401
function toggleTheme(mode) {
    if (mode === 'dark' || (mode !== 'light' && document.body.getAttribute('data-theme') === 'light')) {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.body.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.setAttribute('data-theme', 'light');
    } else {
        document.body.setAttribute('data-theme', 'dark');
    }
    console.log('Theme JS loaded');
});
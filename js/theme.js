// theme.js - Ambient Pixels v2.1.0-20250402
function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    if (currentTheme === 'light') {
        body.removeAttribute('data-theme');
    } else {
        body.setAttribute('data-theme', 'light');
    }
    localStorage.setItem('theme', body.getAttribute('data-theme') || 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') document.body.setAttribute('data-theme', 'light');
});
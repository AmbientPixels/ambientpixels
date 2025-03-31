// theme.js - Ambient Pixels v0.17.3-20250328
function toggleTheme(mode) {
    if (mode === 'dark' || (mode !== 'light' && document.body.classList.contains('light'))) {
        document.body.classList.remove('light');
        document.body.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.body.classList.remove('dark');
        document.body.classList.add('light');
        localStorage.setItem('theme', 'light');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light');
    } else {
        document.body.classList.add('dark');
    }
});
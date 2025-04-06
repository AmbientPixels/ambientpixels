// theme.js - Ambient Pixels v2.3 - April 5, 2025
document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) {
        console.log('Theme toggle not found—check HTML!');
        return;
    }

    // Debug: Log initial state
    console.log('Theme toggle loaded—initial theme:', localStorage.getItem('theme'));

    themeToggle.addEventListener('click', () => {
        // Toggle class and update attribute
        const body = document.body;
        const isDark = body.classList.toggle('dark-theme');
        body.setAttribute('data-theme', isDark ? 'dark' : 'light');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        themeToggle.querySelector('i').className = isDark ? 'fas fa-moon' : 'fas fa-sun';
        console.log('Theme toggled—new state:', isDark ? 'dark' : 'light');
    });

    // Initial theme setup
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.body.setAttribute('data-theme', 'dark');
        themeToggle.querySelector('i').className = 'fas fa-moon';
    } else {
        document.body.classList.remove('dark-theme');
        document.body.setAttribute('data-theme', 'light');
        themeToggle.querySelector('i').className = 'fas fa-sun';
    }
});
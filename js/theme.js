// theme.js - Ambient Pixels v2.3 - April 6, 2025
document.addEventListener('DOMContentLoaded', () => {
    // Wait for nav fetch to complete
    const checkThemeToggle = setInterval(() => {
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            clearInterval(checkThemeToggle); // Stop checking once found
            const currentTheme = localStorage.getItem('theme') || 'dark';
            document.body.setAttribute('data-theme', currentTheme);

            themeToggle.addEventListener('click', () => {
                const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                document.body.setAttribute('data-theme', newTheme);
                localStorage.setItem('theme', newTheme);
            });
        } else {
            console.log('Waiting for theme toggle...');
        }
    }, 100); // Check every 100ms until nav loads
});
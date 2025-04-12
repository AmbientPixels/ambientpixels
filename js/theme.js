// /js/theme.js – Optional fallback if not using init-nav.js
document.addEventListener('DOMContentLoaded', () => {
    const storedTheme = localStorage.getItem('preferred-theme');
    if (storedTheme) {
      document.body.setAttribute('data-theme', storedTheme);
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const storedTheme = localStorage.getItem('preferred-theme');
    if (storedTheme) {
      document.body.setAttribute('data-theme', storedTheme);
  
      const icon = document.querySelector('#theme-toggle i');
      if (icon) {
        icon.classList.toggle('fa-moon', storedTheme === 'light');
        icon.classList.toggle('fa-sun', storedTheme === 'dark');
      }
    }
  });
  
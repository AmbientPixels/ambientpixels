// File: /js/theme.js – Load Preferred Theme and Icon

document.addEventListener('DOMContentLoaded', () => {
  const storedTheme = localStorage.getItem('preferred-theme');
  if (storedTheme) {
    document.body.setAttribute('data-theme', storedTheme);
    const icon = document.querySelector('#theme-toggle i');
    if (icon) {
      icon.classList.toggle('fa-sun', storedTheme === 'light');
      icon.classList.toggle('fa-moon', storedTheme === 'dark');
    }
  }
});

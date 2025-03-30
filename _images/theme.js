// theme.js - Adjusted for v0.17.7-20250330
function toggleTheme() {
    console.log('toggleTheme clicked');
    const currentTheme = document.body.classList.contains('light') ? 'light' : 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}

function setTheme(theme) {
    console.log('setTheme called:', theme);
    const themeIcon = document.querySelector('.theme-toggle i');
    const navbar = document.querySelector('.navbar');
    const menu = document.querySelector('.navbar-menu');
    const links = document.querySelectorAll('.navbar-menu a');
    const h1 = document.querySelector('.navbar h1');
    const footer = document.querySelector('footer');
    const socialLinks = document.querySelectorAll('.social-links a');

    document.body.classList.remove('light', 'dark');
    document.body.classList.add(theme);
    if (themeIcon) {
        themeIcon.classList.remove(theme === 'light' ? 'fa-moon' : 'fa-sun');
        themeIcon.classList.add(theme === 'light' ? 'fa-sun' : 'fa-moon');
    }
    localStorage.setItem('theme', theme);

    requestAnimationFrame(() => {
        console.log('Links:', links.length);
        console.log('Styles:', {
            bodyBg: window.getComputedStyle(document.body).backgroundColor,
            bodyColor: window.getComputedStyle(document.body).color,
            navBg: navbar ? window.getComputedStyle(navbar).backgroundColor : 'null',
            navColor: navbar ? window.getComputedStyle(navbar).color : 'null',
            linkColor: links.length > 0 ? window.getComputedStyle(links[0]).color : 'null'
        });
    });
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    console.log('Saved theme:', savedTheme);
    setTheme(savedTheme || 'dark'); // Default to dark if null
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded');
    loadTheme();

    const toggle = document.getElementById('menuToggle');
    const menu = document.getElementById('navbarMenu');

    toggle.addEventListener('click', () => {
        menu.classList.toggle('active');
        toggle.classList.toggle('fa-bars');
        toggle.classList.toggle('fa-times');
        console.log('Menu toggled, active:', menu.classList.contains('active'));
    });

    toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            menu.classList.toggle('active');
            toggle.classList.toggle('fa-bars');
            toggle.classList.toggle('fa-times');
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            menu.classList.remove('active');
            toggle.classList.remove('fa-times');
            toggle.classList.add('fa-bars');
        }
    });

    window.addEventListener('click', (event) => {
        console.log('Window click at:', event.target);
    });
});
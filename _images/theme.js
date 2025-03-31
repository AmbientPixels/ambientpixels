// theme.js - Adjusted for v0.17.8-20250331, Dark Default
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
    const toggle = document.getElementById('menuToggle');

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

function generateMeme() {
    console.log('Generating meme...');
    const output = document.getElementById('meme-output');
    const memes = ['Chaos reigns!', 'Glitch it up!', 'AI says hi!'];
    const randomImage = '_images/banner.jpg'; // Placeholder
    if (output) {
        output.innerHTML = `<img src="${randomImage}" alt="Chaos Meme" style="max-width: 100%;"><p>${memes[Math.floor(Math.random() * memes.length)]}</p>`;
    }
}

function toggleChaosMode() {
    console.log('Toggling chaos mode...');
    document.body.classList.toggle('chaos-active');
    const sections = document.querySelectorAll('.grid-col-6');
    sections.forEach(section => {
        if (document.body.classList.contains('chaos-active')) {
            const x = Math.random() * 20 - 10;
            const y = Math.random() * 20 - 10;
            section.style.transform = `translate(${x}px, ${y}px)`;
            section.querySelectorAll('p').forEach(p => p.classList.add('chaos-text'));
        } else {
            section.style.transform = 'translate(0, 0)';
            section.querySelectorAll('p').forEach(p => p.classList.remove('chaos-text'));
        }
    });
}

function loadTheme() {
    console.log('Loading dark theme by default');
    setTheme('dark');
    localStorage.setItem('theme', 'dark');
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
        toggle.setAttribute('aria-expanded', menu.classList.contains('active') ? 'true' : 'false');
        console.log('Menu toggled, active:', menu.classList.contains('active'));
    });

    toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            menu.classList.toggle('active');
            toggle.classList.toggle('fa-bars');
            toggle.classList.toggle('fa-times');
            toggle.setAttribute('aria-expanded', menu.classList.contains('active') ? 'true' : 'false');
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            menu.classList.remove('active');
            toggle.classList.remove('fa-times');
            toggle.classList.add('fa-bars');
            toggle.setAttribute('aria-expanded', 'false');
        }
    });

    window.addEventListener('click', (event) => {
        console.log('Window click at:', event.target);
    });
});
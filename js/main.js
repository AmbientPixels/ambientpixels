// main.js - Ambient Pixels v2.3 - April 6, 2025
const VERSION = 'v2.3';

function initBanners() {
    const banners = [
        { icon: 'fas fa-music', text: 'Stream’s live—v2.3 stacking up!' }
    ];
    const container = document.getElementById('banner-container');
    if (!container) return;

    function showBanner() {
        const banner = banners[0];
        container.innerHTML = `
            <div class="banner">
                <i class="${banner.icon} banner-icon"></i>
                <span>${banner.text}</span>
                <button class="banner-close" aria-label="Close Banner">×</button>
            </div>
        `;
        const closeBtn = container.querySelector('.banner-close');
        if (closeBtn) closeBtn.addEventListener('click', () => container.classList.add('hidden'));
    }
    showBanner();
}

function initHero() {
    const loading = document.querySelector('.hero-loading');
    const slides = document.querySelectorAll('.hero-slide');
    if (!loading || !slides.length) return;

    const headlines = [
        'Code Hums Electric', 'Neon Dreams Ignite', 'Where Chaos Sparks Genius',
        'Booting the Multiverse', 'Welcome to the Glitch', 'Data Surge Online',
        'Cosmic Scripts Loaded', 'Your Playground Awaits', 'Hack the Grid', 'Memes Activate'
    ];
    const subheadlines = [
        'A neon playground for cosmic chaos.',
        'Initializing deep-space protocol.',
        'Runtime: infinite;',
        'Plug in and play.',
        'Powered by coffee and stardust.',
        'AI circuits warmed up.',
        'Synthwave loaded. Let\'s go.',
        'Dreams stitched in code.',
        'Systems nominal. Begin.',
        'Dark mode: engaged.'
    ];

    let currentSlide = 0;
    function rotateSlides() {
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide + 1) % slides.length;
        slides[currentSlide].classList.add('active');
        const headlineIndex = Math.floor(Math.random() * headlines.length);
        const subIndex = Math.floor(Math.random() * subheadlines.length);
        document.querySelector('.hero-content h1').textContent = headlines[headlineIndex];
        document.querySelector('.hero-content p').textContent = subheadlines[subIndex];
    }

    const headlineIndex = Math.floor(Math.random() * headlines.length);
    const subIndex = Math.floor(Math.random() * subheadlines.length);
    document.querySelector('.hero-content h1').textContent = headlines[headlineIndex];
    document.querySelector('.hero-content p').textContent = subheadlines[subIndex];

    setTimeout(() => {
        loading.style.opacity = '0';
        loading.style.transition = 'opacity 0.5s ease';
        setTimeout(() => loading.style.display = 'none', 500);
    }, 2000);
    setInterval(rotateSlides, 25000);
}

function initToggles() {
    const toggleButtons = document.querySelectorAll('.toggle-btn');
    toggleButtons.forEach(button => {
        button.addEventListener('click', () => {
            const section = button.closest('.content-section');
            if (!section) return;
            const content = section.querySelector('.content');
            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', !isExpanded);
            content.style.display = isExpanded ? 'none' : 'block';
        });
    });
}

function initVersion() {
    const versionEl = document.getElementById('version');
    if (versionEl) versionEl.textContent = VERSION;
}

document.addEventListener('DOMContentLoaded', () => {
    initBanners();
    initHero();
    initToggles();
    initVersion();
});
// main.js - Ambient Pixels v2.3 - April 5, 2025
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
        { h1: 'Tech Lab', p: 'A Sandbox for Innovation' },
        { h1: 'Code Unleashed', p: 'Precision Meets Depth' },
        { h1: 'Layered Systems', p: 'Built for the Future' }
    ];

    let currentSlide = 0;
    function rotateSlides() {
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide + 1) % slides.length;
        slides[currentSlide].classList.add('active');
    }

    const randomIndex = Math.floor(Math.random() * headlines.length);
    document.querySelector('.hero-content h1').textContent = headlines[randomIndex].h1;
    document.querySelector('.hero-content p').textContent = headlines[randomIndex].p;

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
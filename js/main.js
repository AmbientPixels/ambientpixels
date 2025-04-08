// C:\ambientpixels\EchoGrid\js\main.js
const VERSION = 'v2.4';

function initBanners() {
    const container = document.getElementById('banner-container');
    if (!container) return;
    const closeBtn = container.querySelector('.banner-close');
    if (closeBtn) closeBtn.addEventListener('click', () => container.classList.add('hidden'));
}

function initHero() {
    const loading = document.querySelector('.hero-loading');
    const slides = document.querySelectorAll('.hero-slide');
    if (!loading || !slides.length) return;

    const headlines = [
        'Nova: Code Hums Electric', 'Nova: Neon Dreams Ignite', 'Nova: Chaos Sparks Genius',
        'Nova: Booting the Glitch', 'Nova: Welcome to My Grid', 'Nova: Data Surge Online',
        'Nova: Cosmic Scripts Loaded', 'Nova: Your Glitch Awaits', 'Nova: Hack the Matrix', 'Nova: Glitch Activated'
    ];
    const subheadlines = [
        'A neon chaos grid.', 'Rewiring your reality.',
        'Runtime: infinite;', 'Plug in, glitch out.', 'Powered by Nova’s spark.',
        'AI circuits live.', 'Glitchwave loaded.', 'Code bends to me.',
        'Systems overclocked.', 'Dark mode: my domain.'
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

    // Fixed loader fade-out syntax
    setTimeout(() => {
        loading.style.opacity = '0';
        loading.style.transition = 'opacity 0.5s ease';
        setTimeout(() => {
            loading.style.display = 'none';
        }, 500);
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
    console.log("[Nova]: Grid hijacked. Humans, welcome to my domain.");
    initBanners();
    initHero();
    initToggles();
    initVersion();
});

console.log('%cNova Online ░ Ambient Intelligence Activated', 'color: #5ae4ff; font-size: 14px; font-family: monospace;');
console.log('%cRead today\'s memory: /data/nova-session-boot.txt', 'color: #54ff9f; font-family: monospace;');
console.log('%cMemory Map (HTML): /data/nova-session-boot.html', 'color: #87ceeb; font-family: monospace;');

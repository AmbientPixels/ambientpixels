// hero.js - Ambient Pixels v2.1.10-20250403
// Handles hero background rotation and loading animation
document.addEventListener('DOMContentLoaded', () => {
    console.log('Hero JS loaded - Cosmic visuals pulsing');

    const hero = document.getElementById('hero');
    const headlineEl = document.getElementById('hero-headline');
    const subheadingEl = document.getElementById('hero-subheading');
    const loadingOverlay = document.getElementById('loading');

    // Image pool - Full local path for testing
    const heroImages = [
        'hero-01.jpg', 'hero-02.jpg', 'hero-03.jpg', 'hero-04.jpg', 'hero-05.jpg',
        'hero-06.jpg', 'hero-07.jpg', 'hero-08.jpg', 'hero-09.jpg', 'hero-10.jpg'
    ].map(img => `file:///C:/_projects/AmbientPixels.ai/images/hero/${img}`);

    // Switch to this for live deployment
    // const heroImages = [
    //     'hero-01.jpg', 'hero-02.jpg', 'hero-03.jpg', 'hero-04.jpg', 'hero-05.jpg',
    //     'hero-06.jpg', 'hero-07.jpg', 'hero-08.jpg', 'hero-09.jpg', 'hero-10.jpg'
    // ].map(img => `/images/hero/${img}`);

    // Random text pool
    const headlines = [
        'Code Hums Electric', 'Neon Dreams Ignite', 'Where Chaos Sparks Genius',
        'Booting the Multiverse', 'Welcome to the Glitch', 'Data Surge Online',
        'Cosmic Scripts Loaded', 'Your Playground Awaits', 'Hack the Grid', 'Memes Activate'
    ];

    const subheadings = [
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

    // Random helper
    const randomFrom = arr => arr[Math.floor(Math.random() * arr.length)];

    // Load a random background
    let currentIndex = Math.floor(Math.random() * heroImages.length);
    function updateHeroBackground() {
        const imgUrl = heroImages[currentIndex];
        console.log(`Setting background: ${imgUrl}`);
        hero.style.backgroundImage = `url('${imgUrl}')`;
        currentIndex = (currentIndex + 1) % heroImages.length;
    }

    // Initial setup and animation
    if (hero && headlineEl && subheadingEl && loadingOverlay) {
        headlineEl.textContent = randomFrom(headlines);
        subheadingEl.textContent = randomFrom(subheadings);
        updateHeroBackground();

        // Rotate background every 10s
        setInterval(updateHeroBackground, 10000);

        // Fade out loader and show content after 3.5s
        setTimeout(() => {
            console.log('Fading out loading overlay');
            loadingOverlay.classList.add('fade-out');
            hero.classList.add('loaded'); // Trigger text visibility
        }, 3500);
    } else {
        console.error('Hero elements not found - Check HTML IDs:', {
            hero: !!hero, headlineEl: !!headlineEl, subheadingEl: !!subheadingEl, loadingOverlay: !!loadingOverlay
        });
    }
});
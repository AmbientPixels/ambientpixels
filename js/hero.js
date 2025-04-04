// hero.js - Ambient Pixels v2.1.10-20250403
// Handles hero background rotation and loading animation
document.addEventListener('DOMContentLoaded', () => {
    console.log('Hero JS loaded - Cosmic visuals pulsing');

    const hero = document.getElementById('hero');
    const headlineEl = document.getElementById('hero-headline');
    const subheadingEl = document.getElementById('hero-subheading');
    const loadingOverlay = document.getElementById('loading');

    // Random text pool - Defined before use
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

    // Image pool - Relative path from project root for local and live
    const heroImages = [
        'hero-01.jpg', 'hero-02.jpg', 'hero-03.jpg', 'hero-04.jpg', 'hero-05.jpg',
        'hero-06.jpg', 'hero-07.jpg', 'hero-08.jpg', 'hero-09.jpg', 'hero-10.jpg'
    ].map(img => `./images/hero/${img}`); // ./ works for local server and live root

    // Preload images to prevent flicker
    const preloadImages = () => {
        heroImages.forEach(imgUrl => {
            const img = new Image();
            img.src = imgUrl;
            img.onload = () => console.log(`Preloaded: ${imgUrl}`);
            img.onerror = () => console.error(`Preload failed: ${imgUrl}`);
        });
    };

    // Random helper
    const randomFrom = arr => arr[Math.floor(Math.random() * arr.length)];

    // Load a random background
    let currentIndex = Math.floor(Math.random() * heroImages.length);
    function updateHeroBackground() {
        const imgUrl = heroImages[currentIndex];
        console.log(`Setting background: ${imgUrl}`);
        hero.style.backgroundImage = `url(${imgUrl})`; // Simplified syntax, CSS handles transition
        currentIndex = (currentIndex + 1) % heroImages.length;
    }

    // Initial setup and animation
    if (hero && headlineEl && subheadingEl && loadingOverlay) {
        preloadImages(); // Preload to avoid flicker
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
// hero.js - Ambient Pixels v2.1.10
document.addEventListener('DOMContentLoaded', () => {
    console.log('Hero JS loaded - Cosmic visuals pulsing');
    const hero = document.getElementById('hero');
    const loadingOverlay = document.getElementById('loading');
    const headline = document.getElementById('hero-headline');
    const subheading = document.getElementById('hero-subheading');

    if (!hero || !loadingOverlay || !headline || !subheading) {
        console.error('Hero elements missing:', { hero, loadingOverlay, headline, subheading });
        return;
    }

    const headlines = [
        'Code Hums Electric', 'Neon Dreams Ignite', 'Where Chaos Sparks Genius',
        'Booting the Multiverse', 'Welcome to the Glitch', 'Data Surge Online',
        'Cosmic Scripts Loaded', 'Your Playground Awaits', 'Hack the Grid', 'Memes Activate'
    ];
    const subheadings = [
        'A neon playground for cosmic chaos.', 'Initializing deep-space protocol.',
        'Runtime: infinite;', 'Plug in and play.', 'Powered by coffee and stardust.',
        'AI circuits warmed up.', 'Synthwave loaded. Let\'s go.', 'Dreams stitched in code.',
        'Systems nominal. Begin.', 'Dark mode: engaged.'
    ];
    const heroImages = [
        './images/hero/hero-01.jpg', './images/hero/hero-02.jpg', './images/hero/hero-03.jpg',
        './images/hero/hero-04.jpg', './images/hero/hero-05.jpg', './images/hero/hero-06.jpg',
        './images/hero/hero-07.jpg', './images/hero/hero-08.jpg', './images/hero/hero-09.jpg',
        './images/hero/hero-10.jpg'
    ];
    let currentImageIndex = Math.floor(Math.random() * heroImages.length);

    const randomFrom = arr => arr[Math.floor(Math.random() * arr.length)];
    heroImages.forEach((src) => {
        const img = new Image();
        img.src = src;
        img.onload = () => console.log(`Preloaded: ${src}`);
        img.onerror = () => console.error(`Failed to preload: ${src}`);
    });

    function cycleBackground() {
        hero.style.backgroundImage = `url(${heroImages[currentImageIndex]})`;
        console.log(`Setting background: ${heroImages[currentImageIndex]}`);
        currentImageIndex = (currentImageIndex + 1) % heroImages.length;
    }

    headline.textContent = randomFrom(headlines);
    subheading.textContent = randomFrom(subheadings);
    cycleBackground();
    setInterval(cycleBackground, 10000);

    setTimeout(() => {
        console.log('Fading out loading overlay');
        loadingOverlay.classList.add('fade-out');
        hero.classList.add('loaded');
    }, 3500);
});
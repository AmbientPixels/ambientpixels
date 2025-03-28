// Hero Randomizer - Ambient Pixels v0.16.9-20250328 - March 28, 2025

document.addEventListener('DOMContentLoaded', () => {
    // Hero taglines and images
    const taglines = [
        "Oops, the pixels got drunk again!",
        "Chaos.exe has entered the chat.",
        "Art + Tech = Glorious Mess.",
        "Pixel storm incoming—duck!",
        "AI says: Beep boop, creativity overload!",
        "Supernova vibes, no survivors.",
        "When memes crash the mainframe."
    ];
    const taglineElement = document.getElementById('randomTagline');
    const loadingScreen = document.getElementById('loadingScreen');
    const heroElement = document.querySelector('.hero');

    if (!taglineElement || !loadingScreen || !heroElement) {
        console.error('Hero elements missing:', {
            taglineElement: !!taglineElement,
            loadingScreen: !!loadingScreen,
            heroElement: !!heroElement
        });
        return;
    }

    const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];
    taglineElement.innerHTML = randomTagline.split('').map(char =>
        char === ' ' ? `<span>&nbsp;</span>` : `<span>${char}</span>`
    ).join('');
    setTimeout(() => {
        loadingScreen.style.display = 'none';
        taglineElement.style.display = 'block';
        console.log('Tagline set:', randomTagline);
    }, 1500);

    const heroImages = [
        '_images/banner.jpg',
        '_images/banner1.jpg',
        '_images/banner2.jpg', // Replaced in v0.16.7-20250328
        '_images/banner3.jpg',
        '_images/banner4.jpg',
        '_images/banner5.jpg',
        '_images/banner6.jpg', // Added in v0.16.7-20250328
        '_images/banner7.jpg', // Added in v0.16.7-20250328
        '_images/banner8.jpg', // Added in v0.16.7-20250328
        '_images/banner9.jpg', // Added in v0.16.7-20250328
        '_images/banner10.jpg' // Added in v0.16.7-20250328
    ];
    const randomHeroImage = heroImages[Math.floor(Math.random() * heroImages.length)];
    heroElement.style.backgroundImage = `url('${randomHeroImage}')`;
    console.log('Hero image set:', randomHeroImage);
});
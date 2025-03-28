// Hero Randomizer - Ambient Pixels v0.16.8-20250328 - March 28, 2025

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
if (taglineElement && loadingScreen) {
    const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];
    taglineElement.innerHTML = randomTagline.split('').map(char =>
        char === ' ' ? `<span> </span>` : `<span>${char}</span>`
    ).join('');
    setTimeout(() => {
        loadingScreen.style.display = 'none';
        taglineElement.style.display = 'block';
    }, 1500);
}

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
const heroElement = document.querySelector('.hero');
if (heroElement) {
    const randomHeroImage = heroImages[Math.floor(Math.random() * heroImages.length)];
    heroElement.style.backgroundImage = `url('${randomHeroImage}')`;
}
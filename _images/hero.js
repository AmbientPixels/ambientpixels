// hero.js - Ambient Pixels v0.17.7-20250330 - March 30, 2025, 8:45 AM PDT

const taglines = [
    "Oops, the pixels got drunk again!",
    "Chaos.exe has entered the chat.",
    "Pixel storm incoming—duck!",
    "AI went rogue, we just rolled with it.",
    "Glitch today, gold tomorrow.",
    "Code’s on fire—literally.",
    "Madness? This is Ambient Pixels!"
];
const subheadings = [
    "Creative Tech Unleashed",
    "Where Chaos Sparks Genius",
    "AI Fuels the Fire",
    "Glitchy Vibes Only",
    "Pixelated Madness Awaits",
    "Unleashing Digital Wildness",
    "Art Meets Insanity"
];
const heroImages = [
    '_images/banner.jpg', '_images/banner1.jpg', '_images/banner2.jpg',
    '_images/banner3.jpg', '_images/banner4.jpg', '_images/banner5.jpg',
    '_images/banner6.jpg', '_images/banner7.jpg', '_images/banner8.jpg',
    '_images/banner9.jpg', '_images/banner10.jpg'
];

function setRandomHeroText() {
    const heroElement = document.querySelector('.hero');
    if (!heroElement) {
        console.error('Missing .hero element');
        return;
    }

    // Set image first
    const randomHeroImage = heroImages[Math.floor(Math.random() * heroImages.length)];
    console.log('Setting hero image:', randomHeroImage);
    heroElement.style.backgroundImage = `url('${randomHeroImage}')`;

    // Handle loading sequence
    const taglineElement = document.getElementById('randomTagline');
    const subheadingElement = document.getElementById('randomSubheading');
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingBar = document.querySelector('.loading-bar');
    const loadingText = document.querySelector('.loading-text');

    if (!taglineElement) console.error('Missing #randomTagline element');
    if (!subheadingElement) console.error('Missing #randomSubheading element');
    if (!loadingScreen) console.error('Missing #loadingScreen element');
    if (!loadingBar) console.error('Missing .loading-bar element');
    if (!loadingText) console.error('Missing .loading-text element');

    if (taglineElement && subheadingElement && loadingScreen && loadingBar && loadingText) {
        const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];
        const randomSubheading = subheadings[Math.floor(Math.random() * subheadings.length)];

        taglineElement.innerHTML = randomTagline.split('').map(char =>
            char === ' ' ? `<span> </span>` : `<span>${char}</span>`
        ).join('');
        subheadingElement.textContent = randomSubheading;

        // Elegant loading sequence with one icon
        loadingScreen.style.opacity = '1';
        loadingBar.style.width = '0%';
        loadingText.textContent = '';
        taglineElement.style.opacity = '0';
        subheadingElement.style.opacity = '0';

        // Typing effect for "Loading..."
        const loadingMessage = "Loading...";
        let charIndex = 0;
        const typeInterval = setInterval(() => {
            if (charIndex < loadingMessage.length) {
                loadingText.textContent += loadingMessage[charIndex];
                charIndex++;
            } else {
                clearInterval(typeInterval);
            }
        }, 80); // 0.88s total (11 chars * 80ms)

        // Loading bar animation
        let width = 0;
        const loadInterval = setInterval(() => {
            width += 2;
            loadingBar.style.width = `${width}%`;
            if (width >= 100) {
                clearInterval(loadInterval);
                setTimeout(() => {
                    loadingScreen.style.opacity = '0'; // Full fade-out
                    setTimeout(() => {
                        loadingScreen.style.display = 'none'; // Remove completely
                        loadingText.style.opacity = '0';
                        taglineElement.style.opacity = '1';
                        subheadingElement.style.opacity = '1';
                    }, 300);
                }, 500);
            }
        }, 40); // 2s total duration (100 / 2 * 40ms)
    } else {
        console.warn('Skipping loading sequence - some hero elements missing');
    }
}

document.addEventListener('DOMContentLoaded', setRandomHeroText);

console.log('hero.js loaded');
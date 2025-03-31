// hero.js - Ambient Pixels v0.17.8-20250331
const heroImages = [
    '_images/banner.jpg', '_images/banner1.jpg', '_images/banner2.jpg',
    '_images/banner3.jpg', '_images/banner4.jpg', '_images/banner5.jpg',
    '_images/banner6.jpg', '_images/banner7.jpg', '_images/banner8.jpg',
    '_images/banner9.jpg', '_images/banner10.jpg'
];

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

function typeTagline(text, element, callback) {
    let i = 0;
    element.innerHTML = '';
    element.classList.remove('visible');
    const interval = setInterval(() => {
        if (i < text.length) {
            element.innerHTML += text[i];
            i++;
        } else {
            clearInterval(interval);
            element.classList.add('visible');
            if (callback) callback();
        }
    }, 50);
}

function setRandomHeroText() {
    const heroElement = document.querySelector('.hero');
    const taglineElement = document.getElementById('randomTagline');
    const subheadingElement = document.getElementById('randomSubheading');
    const loadingScreen = document.getElementById('loadingScreen');

    if (!heroElement || !taglineElement || !subheadingElement || !loadingScreen) {
        console.error('Missing hero elements');
        return;
    }

    const randomImage = heroImages[Math.floor(Math.random() * heroImages.length)];
    heroElement.style.backgroundImage = `url('${randomImage}')`;
    const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];
    const randomSubheading = subheadings[Math.floor(Math.random() * subheadings.length)];

    loadingScreen.style.opacity = '1';
    loadingScreen.classList.remove('hidden');
    let width = 0;
    const loadInterval = setInterval(() => {
        width += 4;
        document.querySelector('.loading-bar').style.width = `${width}%`;
        if (width >= 100) {
            clearInterval(loadInterval);
            setTimeout(() => {
                loadingScreen.style.opacity = '0';
                setTimeout(() => {
                    loadingScreen.classList.add('hidden');
                    typeTagline(randomTagline, taglineElement, () => {
                        subheadingElement.textContent = randomSubheading;
                        subheadingElement.classList.add('visible');
                    });
                }, 300);
            }, 300);
        }
    }, 20);
}

document.addEventListener('DOMContentLoaded', setRandomHeroText);
console.log('hero.js loaded');
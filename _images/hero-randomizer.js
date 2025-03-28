document.addEventListener('DOMContentLoaded', () => {
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

    const taglineElement = document.getElementById('randomTagline');
    const subheadingElement = document.getElementById('randomSubheading');
    const loadingScreen = document.getElementById('loadingScreen');

    if (taglineElement && subheadingElement && loadingScreen) {
        const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];
        const randomSubheading = subheadings[Math.floor(Math.random() * subheadings.length)];

        taglineElement.innerHTML = randomTagline.split('').map(char =>
            char === ' ' ? `<span>&nbsp;</span>` : `<span>${char}</span>`
        ).join('');
        subheadingElement.textContent = randomSubheading;

        setTimeout(() => {
            loadingScreen.style.display = 'none';
            taglineElement.style.display = 'flex';
            subheadingElement.style.display = 'block';
        }, 1500);
    }

    const heroImages = [
        '_images/banner.jpg',
        '_images/banner1.jpg',
        '_images/banner2.jpg',
        '_images/banner3.jpg',
        '_images/banner4.jpg',
        '_images/banner5.jpg',
        '_images/banner6.jpg',
        '_images/banner7.jpg',
        '_images/banner8.jpg',
        '_images/banner9.jpg',
        '_images/banner10.jpg'
    ];

    const heroElement = document.querySelector('.hero');
    if (heroElement) {
        const randomHeroImage = heroImages[Math.floor(Math.random() * heroImages.length)];
        heroElement.style.backgroundImage = `url('${randomHeroImage}')`;
    }
});
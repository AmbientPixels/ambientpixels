// scripts.js - Ambient Pixels v0.17.6-20250329 - March 29, 2025, 5:05 PM PDT

const VERSION_NUMBER = "v0.17.6-20250329";
const API_ENDPOINT = "https://ambientpixels-meme-api-fn.azurewebsites.net/api/memeGenerator";

const versionFlair = [
    "shines bright!",
    "sparks chaos!",
    "ignites the void!",
    "blasts off!",
    "glows wild!",
    "rocks hard!",
    "paints the glitch!"
];

document.addEventListener('DOMContentLoaded', () => {
    // Inject plain version number for all .version-number elements
    const versionElements = document.querySelectorAll('.version-number');
    versionElements.forEach(element => {
        element.textContent = VERSION_NUMBER;
    });

    // Inject version number with flair for .version-flair elements in footer tagline
    const flairElements = document.querySelectorAll('.version-flair');
    const randomFlair = versionFlair[Math.floor(Math.random() * versionFlair.length)];
    flairElements.forEach(element => {
        element.textContent = `${VERSION_NUMBER} ${randomFlair}`;
    });

    const toggleAllSectionsBtn = document.getElementById('toggleAllSections');
    if (toggleAllSectionsBtn) toggleAllSectionsBtn.addEventListener('click', toggleAllSections);

    const sections = document.querySelectorAll('.section-container');
    sections.forEach(section => {
        const header = section.querySelector('h2');
        if (header) header.addEventListener('click', () => toggleSection(header));
    });

    window.addEventListener('scroll', () => {
        const backToTop = document.querySelector('.back-to-top');
        if (backToTop) backToTop.classList.toggle('visible', window.scrollY > 200);
    });

    const taglineElement = document.getElementById('randomTagline');
    const subheadingElement = document.getElementById('randomSubheading');
    const loadingScreen = document.getElementById('loadingScreen');

    if (taglineElement && subheadingElement && loadingScreen) {
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
        const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];
        const randomSubheading = subheadings[Math.floor(Math.random() * subheadings.length)];

        taglineElement.innerHTML = randomTagline.split('').map(char =>
            char === ' ' ? `<span> </span>` : `<span>${char}</span>`
        ).join('');
        subheadingElement.textContent = randomSubheading;

        setTimeout(() => {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                taglineElement.style.display = 'flex';
                subheadingElement.style.display = 'block';
                taglineElement.style.opacity = '1';
                subheadingElement.style.opacity = '1';
            }, 300);
        }, 1500);

        const heroImages = [
            '_images/banner.jpg', '_images/banner1.jpg', '_images/banner2.jpg',
            '_images/banner3.jpg', '_images/banner4.jpg', '_images/banner5.jpg',
            '_images/banner6.jpg', '_images/banner7.jpg', '_images/banner8.jpg',
            '_images/banner9.jpg', '_images/banner10.jpg'
        ];
        const heroElement = document.querySelector('.hero');
        if (heroElement) {
            const randomHeroImage = heroImages[Math.floor(Math.random() * heroImages.length)];
            heroElement.style.backgroundImage = `url('${randomHeroImage}')`;
        }
    }

    animateSections();

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) setTheme(savedTheme);

    // Activate loading animations
    const loadingFades = document.querySelectorAll('.loading-fade');
    loadingFades.forEach(fade => fade.classList.add('active'));

    const loadingDots = document.querySelectorAll('.loading-dots');
    loadingDots.forEach(dots => dots.classList.add('active'));

    const loadingBounces = document.querySelectorAll('.loading-bounce');
    loadingBounces.forEach(bounce => bounce.classList.add('active'));

    const loadingBars = document.querySelectorAll('.loading-bar');
    loadingBars.forEach(bar => bar.classList.add('active'));

    const loadingChaos = document.querySelectorAll('.loading-chaos');
    loadingChaos.forEach(chaos => chaos.classList.add('active'));

    const loadingGlitches = document.querySelectorAll('.loading-glitch');
    loadingGlitches.forEach(glitch => glitch.classList.add('active'));
});

function toggleTheme() {
    document.body.classList.toggle('light');
    const themeIcon = document.querySelector('.theme-toggle');
    themeIcon.classList.toggle('fa-moon');
    themeIcon.classList.toggle('fa-sun');
    const newTheme = document.body.classList.contains('light') ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
}

function setTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light');
        document.querySelector('.theme-toggle').classList.replace('fa-moon', 'fa-sun');
    } else {
        document.body.classList.remove('light');
        document.querySelector('.theme-toggle').classList.replace('fa-sun', 'fa-moon');
    }
    localStorage.setItem('theme', theme);
}

function toggleMenu() {
    const menu = document.querySelector('.navbar-menu');
    const toggleIcon = document.querySelector('.navbar-toggle');
    if (menu && toggleIcon) {
        menu.classList.toggle('active');
        toggleIcon.classList.toggle('fa-bars');
        toggleIcon.classList.toggle('fa-times');
        document.body.classList.toggle('menu-open');
    }
}

function toggleSection(header) {
    const content = header.nextElementSibling;
    if (content) content.classList.toggle('active');
}

function toggleGroup(header) {
    const content = header.nextElementSibling;
    const icon = header.querySelector('.toggle-icon');
    if (content && icon) {
        content.classList.toggle('active');
        icon.classList.toggle('fa-chevron-down');
        icon.classList.toggle('fa-chevron-up');
    }
}

function toggleAllSections() {
    const groups = document.querySelectorAll('.section-group');
    const sections = document.querySelectorAll('.section-container');
    const toggleIcon = document.getElementById('toggleAllSections');
    const allActive = Array.from(groups).every(group => group.querySelector('.group-content')?.classList.contains('active')) &&
                     Array.from(sections).every(section => section.querySelector('.section-content')?.classList.contains('active'));

    groups.forEach(group => {
        const content = group.querySelector('.group-content');
        const header = group.querySelector('.group-header');
        if (content && header) {
            if (allActive) {
                content.classList.remove('active');
                header.querySelector('.toggle-icon')?.classList.replace('fa-chevron-up', 'fa-chevron-down');
            } else {
                content.classList.add('active');
                header.querySelector('.toggle-icon')?.classList.replace('fa-chevron-down', 'fa-chevron-up');
            }
        }
    });

    sections.forEach(section => {
        const content = section.querySelector('.section-content');
        if (content) content.classList.toggle('active', !allActive);
    });

    if (toggleIcon) {
        toggleIcon.classList.toggle('fa-expand-alt', allActive);
        toggleIcon.classList.toggle('fa-compress-alt', !allActive);
    }
}

function animateSections() {
    const sections = document.querySelectorAll('.section-container');
    sections.forEach((section, index) => {
        section.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        setTimeout(() => {
            section.style.opacity = '1';
            section.style.transform = 'translateY(0)';
        }, index * 150);
    });
}

function toggleChaosMode() {
    document.body.classList.toggle('chaos-active');
    const chaosButton = document.getElementById('chaosToggle');
    if (chaosButton) {
        chaosButton.textContent = document.body.classList.contains('chaos-active') ? 'Calm the Chaos' : 'Toggle Chaos Mode';
    }
}

async function getAccessToken() {
    try {
        const response = await fetch('https://ambientpixels-meme-api-fn.azurewebsites.net/api/getToken');
        if (!response.ok) throw new Error(`Token fetch failed: ${response.status}`);
        const data = await response.json();
        return data.token;
    } catch (error) {
        console.error('Error fetching token:', error);
        return null;
    }
}

async function generateMeme() {
    const promptInput = document.getElementById('memePrompt');
    const defaultPrompt = 'A confused robot in a disco';
    const prompt = promptInput?.value.trim() || defaultPrompt;
    const generateBtn = document.getElementById('memeGenerateBtn');
    const loadingDiv = document.getElementById('memeLoading');
    const memeImage = document.getElementById('memeImage');
    const topText = document.getElementById('memeTopText');
    const bottomText = document.getElementById('memeBottomText');

    if (!generateBtn || !loadingDiv || !memeImage || !topText || !bottomText) {
        console.error('Meme elements missing');
        return;
    }

    generateBtn.disabled = true;
    loadingDiv.classList.add('visible');
    memeImage.classList.remove('visible');
    topText.innerText = '';
    bottomText.innerText = '';

    try {
        const token = await getAccessToken();
        if (!token) throw new Error('No access token available');
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ endpoint: "image", prompt: prompt })
        });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const blob = await response.blob();
        memeImage.src = URL.createObjectURL(blob);
        memeImage.classList.add('visible');
        topText.innerText = prompt.slice(0, 20);
        bottomText.innerText = prompt.slice(-20);
    } catch (error) {
        console.error('Meme generation error:', error);
        memeImage.src = 'https://placehold.co/300x300?text=API+Error';
        topText.innerText = 'OOPS';
        bottomText.innerText = 'API BROKE';
        memeImage.classList.add('visible');
    } finally {
        loadingDiv.classList.remove('visible');
        generateBtn.disabled = false;
    }
}
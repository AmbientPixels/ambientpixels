// scripts.js - Ambient Pixels v0.17.7-20250330 - March 30, 2025, 1:15 AM PDT

// Version Flair Injection (for footer and version spans) - Moved to top for easy updates
function setVersionFlair() {
    const versionElements = document.querySelectorAll('.version-number, .version-flair');
    versionElements.forEach(el => injectString(el, 'v0.17.7-20250330'));
}

// Theme Toggle
function toggleTheme() {
    document.body.classList.toggle('light');
    localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
    updateThemeIcons();
}

// Update Theme Icons (moon/sun swap)
function updateThemeIcons() {
    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) {
        themeToggle.classList.toggle('fa-moon');
        themeToggle.classList.toggle('fa-sun');
    }
}

// Menu Toggle for Mobile
function toggleMenu() {
    const menu = document.querySelector('.navbar-menu');
    menu.classList.toggle('active');
}

// Section Toggle
function toggleSection(header) {
    const content = header.nextElementSibling;
    content.classList.toggle('active');
    const icon = header.querySelector('i');
    if (icon) icon.classList.toggle('effect-pulse'); // Optional flair
}

// Group Toggle
function toggleGroup(header) {
    const content = header.nextElementSibling;
    content.classList.toggle('active');
    const icon = header.querySelector('.toggle-icon');
    if (icon) {
        icon.classList.toggle('fa-chevron-down');
        icon.classList.toggle('fa-chevron-up');
    }
}

// Chaos Mode Toggle
function toggleChaosMode() {
    document.body.classList.toggle('chaos-active');
    const chaosText = document.querySelectorAll('.chaos-text');
    chaosText.forEach(text => text.classList.toggle('glitch'));
    console.log('Chaos mode toggled:', document.body.classList.contains('chaos-active'));
}

// Meme Generator (placeholder—assumes API call)
function generateMeme() {
    const prompt = document.getElementById('memePrompt').value;
    const memeImage = document.getElementById('memeImage');
    const memeTopText = document.getElementById('memeTopText');
    const memeBottomText = document.getElementById('memeBottomText');
    const memeLoading = document.getElementById('memeLoading');

    if (!prompt) {
        alert('Enter a prompt to generate a meme!');
        return;
    }

    memeLoading.style.display = 'block';
    memeImage.style.display = 'none';
    memeTopText.textContent = '';
    memeBottomText.textContent = '';

    // Simulated API call (replace with real endpoint)
    setTimeout(() => {
        memeImage.src = 'https://via.placeholder.com/400x300?text=Glitchy+Meme'; // Placeholder
        injectString(memeTopText, prompt.toUpperCase().slice(0, 10));
        injectString(memeBottomText, 'CHAOS RULES');
        memeLoading.style.display = 'none';
        memeImage.style.display = 'block';
    }, 2000);
}

// Theme Persistence
function loadTheme() {
    const theme = localStorage.getItem('theme');
    if (theme === 'light') {
        document.body.classList.add('light');
    } else {
        document.body.classList.remove('light');
    }
    updateThemeIcons();
}

// Random Hero Text (for index.html)
const taglines = [
    "Chaos Meets Code",
    "Glitchy Vibes Only",
    "AI Fuels the Fire",
    "Pixels Gone Wild"
];
const subheadings = [
    "Where art and tech collide",
    "Unleash the madness",
    "Built by bots, loved by humans",
    "Pink chaos reigns supreme"
];
function setRandomHeroText() {
    const tagline = taglines[Math.floor(Math.random() * taglines.length)];
    const subheading = subheadings[Math.floor(Math.random() * subheadings.length)];
    const taglineEl = document.getElementById('randomTagline');
    const subheadingEl = document.getElementById('randomSubheading');
    if (taglineEl) injectString(taglineEl, tagline);
    if (subheadingEl) injectString(subheadingEl, subheading);
}

// Section Animation
function animateSections() {
    const sections = document.querySelectorAll('.section-container');
    sections.forEach((section, index) => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        setTimeout(() => {
            section.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            section.style.opacity = '1';
            section.style.transform = 'translateY(0)';
        }, index * 200);
    });
}

// Theme Switcher for template.html
function setTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light');
        localStorage.setItem('theme', 'light');
    } else {
        document.body.classList.remove('light');
        localStorage.setItem('theme', 'dark');
    }
    updateThemeIcons();
}

// Back to Top Scroll
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Loading Screen Fade Out
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) {
        loadingScreen.addEventListener('animationend', () => {
            loadingScreen.style.display = 'none';
        });
    }
}

// Injection String Functions
function injectString(element, text) {
    if (!element) return;
    element.textContent = ''; // Clear existing content
    element.innerHTML = text; // Inject as HTML to support tags like <i>
    console.log('String injected into element:', { element: element.id || element.tagName, text });
}

function injectStringWithDelay(element, text, delay = 50) {
    if (!element) return;
    element.textContent = '';
    let i = 0;
    function type() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(type, delay);
        } else {
            console.log('String injected with delay:', { element: element.id || element.tagName, text });
        }
    }
    type();
}

function injectRandomString(element, strings, interval = 2000) {
    if (!element || !strings.length) return;
    function injectNext() {
        const randomText = strings[Math.floor(Math.random() * strings.length)];
        injectString(element, randomText);
        setTimeout(injectNext, interval);
    }
    injectNext();
}

// DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    setRandomHeroText();
    setVersionFlair();
    animateSections();
    hideLoadingScreen();

    // Event Listeners
    const sections = document.querySelectorAll('.section-container');
    sections.forEach(section => {
        const header = section.querySelector('h2');
        if (header) header.addEventListener('click', () => toggleSection(header));
    });

    const groups = document.querySelectorAll('.section-group .group-header');
    groups.forEach(group => group.addEventListener('click', () => toggleGroup(group)));

    const backToTop = document.querySelector('.back-to-top');
    if (backToTop) backToTop.addEventListener('click', (e) => {
        e.preventDefault();
        scrollToTop();
    });

    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    const menuToggle = document.querySelector('.navbar-toggle');
    if (menuToggle) menuToggle.addEventListener('click', toggleMenu);

    const chaosToggle = document.getElementById('chaosToggle');
    if (chaosToggle) chaosToggle.addEventListener('click', toggleChaosMode);

    const memeBtn = document.getElementById('memeGenerateBtn');
    if (memeBtn) memeBtn.addEventListener('click', generateMeme);

    // Optional: Inject random chaos text in test.html or elsewhere
    const chaosText = document.querySelector('.chaos-text');
    if (chaosText) injectRandomString(chaosText, ['Glitch me!', 'Chaos reigns!', 'AI vibes!'], 3000);
});

console.log('scripts.js loaded'); 
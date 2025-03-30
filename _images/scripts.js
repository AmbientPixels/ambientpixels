// scripts.js - Ambient Pixels v0.17.7-20250330 - March 30, 2025, 12:25 PM PDT

const VERSION_NUMBER = "v0.17.7-20250330";
const API_ENDPOINT = "https://ambientpixels-meme-api-fn.azurewebsites.net/api/memeGenerator";

function setVersionFlair() {
    const versionElements = document.querySelectorAll('.version-number, .version-flair');
    versionElements.forEach(el => injectString(el, VERSION_NUMBER));
}

function toggleTheme() {
    console.log('toggleTheme clicked');
    document.body.classList.toggle('light');
    const themeIcon = document.querySelector('.theme-toggle');
    if (themeIcon) {
        themeIcon.classList.toggle('fa-moon');
        themeIcon.classList.toggle('fa-sun');
        console.log('Theme icon toggled:', themeIcon.classList);
    } else {
        console.error('Theme toggle element not found');
    }
    const newTheme = document.body.classList.contains('light') ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    console.log('Theme toggled:', newTheme);
}

function setTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light');
        document.querySelector('.theme-toggle')?.classList.replace('fa-moon', 'fa-sun');
    } else {
        document.body.classList.remove('light');
        document.querySelector('.theme-toggle')?.classList.replace('fa-sun', 'fa-moon');
    }
    localStorage.setItem('theme', theme);
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) setTheme(savedTheme);
}

function toggleMenu() {
    console.log('toggleMenu called');
    const menu = document.querySelector('.navbar-menu');
    const toggleIcon = document.querySelector('.navbar-toggle');
    if (menu && toggleIcon) {
        menu.classList.toggle('active');
        toggleIcon.classList.toggle('fa-bars');
        toggleIcon.classList.toggle('fa-times');
        document.body.classList.toggle('menu-open');
        console.log('Menu toggled, active:', menu.classList.contains('active'));
    } else {
        console.error('Menu or toggle icon missing:', { menu, toggleIcon });
    }
}

function toggleSection(header) {
    const content = header.nextElementSibling;
    content.classList.toggle('active');
    console.log('toggleSection called - content active:', content.classList.contains('active'));
}

function toggleGroup(header) {
    const content = header.nextElementSibling;
    content.classList.toggle('active');
    const icon = header.querySelector('.toggle-icon');
    if (icon) {
        icon.classList.toggle('fa-chevron-down');
        icon.classList.toggle('fa-chevron-up');
    }
}

function toggleAllSections() {
    const groups = document.querySelectorAll('.section-group');
    const sections = document.querySelectorAll('.section-container');
    const toggleIcon = document.getElementById('toggleAllSections');
    const allActive = Array.from(groups).every(group => group.querySelector('.group-content').classList.contains('active')) &&
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

function toggleChaosMode() {
    document.body.classList.toggle('chaos-active');
    const chaosButton = document.getElementById('chaosToggle');
    if (chaosButton) {
        chaosButton.textContent = document.body.classList.contains('chaos-active') ? 'Calm the Chaos' : 'Toggle Chaos Mode';
    }
    const chaosText = document.querySelectorAll('.chaos-text');
    chaosText.forEach(text => text.classList.toggle('glitch'));
    console.log('Chaos mode toggled:', document.body.classList.contains('chaos-active'));
}

function animateSections() {
    const sections = document.querySelectorAll('.section-container, .section-standalone');
    console.log('animateSections called - found sections:', sections.length);
    sections.forEach((section, index) => {
        console.log('Animating section:', section.id || index, 'initial opacity:', section.style.opacity);
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        setTimeout(() => {
            section.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            section.style.opacity = '1';
            section.style.transform = 'translateY(0)';
            console.log('Section animated:', section.id || index, 'final opacity:', section.style.opacity);
        }, index * 150);
    });
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        injectString(topText, prompt.slice(0, 20));
        injectString(bottomElements, prompt.slice(-20));
    } catch (error) {
        console.error('Meme generation error:', error);
        memeImage.src = 'https://placehold.co/300x300?text=API+Error';
        injectString(topText, 'OOPS');
        injectString(customElements, 'API BROKE');
        memeImage.classList.add('visible');
    } finally {
        loadingDiv.classList.remove('visible');
        generateBtn.disabled = false;
    }
}

function injectString(element, text) {
    if (!element) return;
    element.textContent = '';
    element.innerHTML = text;
    console.log('String injected:', { element: element.id || element.tagName, text: text });
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
            console.log('String injected with delay:', { element: element.id || element.tagName, text: text });
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

document.addEventListener('DOMContentLoaded', () => {
    setVersionFlair();
    loadTheme();
    animateSections();

    const sections = document.querySelectorAll('.section-container');
    sections.forEach(section => {
        const header = section.querySelector('h2');
        if (header) header.addEventListener('click', () => toggleSection(header));
    });

    const groups = document.querySelectorAll('.section-group .group-header');
    groups.forEach(group => group.addEventListener('click', () => toggleGroup(group)));

    const toggleAllSectionsBtn = document.getElementById('toggleAllSections');
    if (toggleAllSectionsBtn) toggleAllSectionsBtn.addEventListener('click', toggleAllSections);

    const backToTop = document.querySelector('.back-to-top');
    if (backToTop) {
        backToTop.addEventListener('click', (e) => {
            e.preventDefault();
            scrollToTop();
        });
        window.addEventListener('scroll', () => {
            backToTop.classList.toggle('visible', window.scrollY > 200);
        });
    }

    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            toggleTheme();
        });
        console.log('Theme toggle event listener added');
    } else {
        console.error('Theme toggle element not found on DOM load');
    }

    const menuToggle = document.querySelector('.navbar-toggle');
    if (menuToggle) menuToggle.addEventListener('click', toggleMenu);

    const chaosToggle = document.getElementById('chaosToggle');
    if (chaosToggle) chaosToggle.addEventListener('click', toggleChaosMode);

    const memeBtn = document.getElementById('memeGenerateBtn');
    if (memeBtn) memeBtn.addEventListener('click', generateMeme);

    const chaosText = document.querySelector('.chaos-text');
    if (chaosText) injectRandomString(chaosText, ['Glitch me!', 'Chaos reigns!', 'AI vibes!'], 3000);
});

console.log('scripts.js loaded');
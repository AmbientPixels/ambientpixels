const VERSION_NUMBER = "v0.17.1-20250328";
const API_ENDPOINT = "https://ambientpixels-meme-api-fn.azurewebsites.net/api/memeGenerator";

document.addEventListener('DOMContentLoaded', () => {
    const versionElements = document.querySelectorAll('#version-number');
    versionElements.forEach(element => {
        element.textContent = VERSION_NUMBER;
    });

    const toggleAllSectionsBtn = document.getElementById('toggleAllSections');
    if (toggleAllSectionsBtn) {
        toggleAllSectionsBtn.addEventListener('click', toggleAllSections);
    }

    const sections = document.querySelectorAll('.section-container');
    sections.forEach(section => {
        const header = section.querySelector('h2');
        if (header) {
            header.addEventListener('click', () => toggleSection(header));
        }
    });

    window.addEventListener('scroll', () => {
        const backToTop = document.querySelector('.back-to-top');
        if (backToTop) {
            backToTop.classList.toggle('visible', window.scrollY > 200);
        }
    });

    animateSections();
});

function toggleTheme() {
    document.body.classList.toggle('light');
    const themeIcon = document.querySelector('.theme-toggle i');
    themeIcon.classList.toggle('fa-moon');
    themeIcon.classList.toggle('fa-sun');
}

function setTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light');
        document.querySelector('.theme-toggle i').classList.replace('fa-moon', 'fa-sun');
    } else {
        document.body.classList.remove('light');
        document.querySelector('.theme-toggle i').classList.replace('fa-sun', 'fa-moon');
    }
}

function toggleMenu() {
    const menu = document.querySelector('.navbar-menu');
    const toggleIcon = document.querySelector('.navbar-toggle i');
    menu.classList.toggle('active');
    toggleIcon.classList.toggle('fa-bars');
    toggleIcon.classList.toggle('fa-times');
    document.body.classList.toggle('menu-open');
}

function toggleSection(header) {
    const content = header.nextElementSibling;
    content.classList.toggle('active');
}

function toggleGroup(header) {
    const content = header.nextElementSibling;
    content.classList.toggle('active');
    const icon = header.querySelector('.toggle-icon');
    icon.classList.toggle('fa-chevron-down');
    icon.classList.toggle('fa-chevron-up');
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
        if (content) {
            content.classList.toggle('active', !allActive);
        }
    });

    toggleIcon.classList.toggle('fa-expand-alt', allActive);
    toggleIcon.classList.toggle('fa-compress-alt', !allActive);
}

function animateSections() {
    const sections = document.querySelectorAll('.section-container');
    sections.forEach((section, index) => {
        setTimeout(() => {
            section.style.opacity = '1';
            section.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

function toggleChaosMode() {
    document.body.classList.toggle('chaos-active');
    const chaosButton = document.getElementById('chaosToggle');
    chaosButton.textContent = document.body.classList.contains('chaos-active') ? 'Calm the Chaos' : 'Toggle Chaos Mode';
}

async function getAccessToken() {
    try {
        const response = await fetch('https://ambientpixels-meme-api-fn.azurewebsites.net/api/getToken');
        if (!response.ok) throw new Error('Token fetch failed');
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

    if (!generateBtn || !loadingDiv || !memeImage || !topText || !bottomText) return;

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
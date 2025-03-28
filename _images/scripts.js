// JavaScript Document
function toggleTheme() {
    document.body.classList.toggle('light');
    const icon = document.querySelector('.theme-toggle i');
    icon.classList.toggle('fa-moon');
    icon.classList.toggle('fa-sun');
}

function toggleMenu() {
    document.querySelector('.navbar-menu').classList.toggle('active');
}

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
        char === ' ' ? `<span>&nbsp;</span>` : `<span>${char}</span>`
    ).join('');
    setTimeout(() => {
        loadingScreen.style.display = 'none';
        taglineElement.style.display = 'block';
    }, 1500);
}

// Random hero images
const heroImages = [
    '_images/banner.jpg',
    '_images/banner1.jpg',
    '_images/banner2.jpg',
    '_images/banner3.jpg',
    '_images/banner4.jpg',
    '_images/banner5.jpg'
];
const heroElement = document.querySelector('.hero');
if (heroElement) {
    const randomHeroImage = heroImages[Math.floor(Math.random() * heroImages.length)];
    heroElement.style.backgroundImage = `url('${randomHeroImage}')`;
}

const memetronWarnings = [
    "Test mode: AI’s still learning—expect glitches, maybe a meme-pocalypse!",
    "Beta vibes: AI might spit out 404 memes—hold tight!",
    "Under AI construction—glitches are free DLC!",
    "AI’s on training wheels—brace for meme chaos!",
    "Test run: AI’s meme skills are 50% dank, 50% derp!"
];
const warningElement = document.getElementById('memetronWarning');
if (warningElement) {
    warningElement.textContent = memetronWarnings[Math.floor(Math.random() * memetronWarnings.length)];
}

const notifyForm = document.getElementById('notifyForm');
if (notifyForm) {
    notifyForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const form = this;
        const data = new FormData(form);
        fetch('https://formspree.io/f/xanejjnz', {
            method: 'POST',
            body: data,
            headers: { 'Accept': 'application/json' }
        })
        .then(response => {
            if (response.ok) {
                document.getElementById('formModal').style.display = 'flex';
                form.reset();
            } else {
                alert('Oops! Something went wrong.');
            }
        })
        .catch(error => {
            alert('Error: ' + error);
        });
    });
}

const backToTop = document.querySelector('.back-to-top');
if (backToTop) {
    backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', () => {
        backToTop.classList.toggle('visible', window.scrollY > 200);
    });
}

// Memetron 3030 API Test Script
const API_ENDPOINT = 'https://ambientpixels-meme-api-fn.azurewebsites.net/api/memeGenerator';

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
    const prompt = promptInput && promptInput.value.trim() ? promptInput.value.trim() : defaultPrompt;
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

        if (!response.ok) throw new Error(`API error: ${response.status} - ${response.statusText}`);

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        memeImage.src = imageUrl;
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

const memeGenerateBtn = document.getElementById('memeGenerateBtn');
if (memeGenerateBtn) {
    memeGenerateBtn.addEventListener('click', generateMeme);
    window.onload = () => generateMeme();
}
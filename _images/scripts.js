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
const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];

taglineElement.innerHTML = randomTagline.split('').map(char =>
    char === ' ' ? `<span>&nbsp;</span>` : `<span>${char}</span>`
).join('');

setTimeout(() => {
    loadingScreen.style.display = 'none';
    taglineElement.style.display = 'block';
}, 1500);

const memetronWarnings = [
    "Test mode: AI’s still learning—expect glitches, maybe a meme-pocalypse!",
    "Beta vibes: AI might spit out 404 memes—hold tight!",
    "Under AI construction—glitches are free DLC!",
    "AI’s on training wheels—brace for meme chaos!",
    "Test run: AI’s meme skills are 50% dank, 50% derp!"
];
document.getElementById('memetronWarning').textContent = memetronWarnings[Math.floor(Math.random() * memetronWarnings.length)];

const comingSoonContent = [
    { icon: '<i class="fas fa-bug"></i>', text: "AI debug mode: Page not found—yet!" },
    { icon: '<i class="fas fa-skull"></i>', text: "This page terminated by rogue AI!" },
    { icon: '<i class="fas fa-bomb"></i>', text: "AI blew up this section—rebuilding soon!" },
    { icon: '<i class="fas fa-ghost"></i>', text: "Ghost in the machine ate this page!" },
    { icon: '<i class="fas fa-poo"></i>', text: "AI took a dump, page coming later!" },
    { icon: '<i class="fas fa-alien"></i>', text: "AI abducted this content—ETA unknown!" },
    { icon: '<i class="fas fa-robot"></i>', text: "AI’s drunk on binary—page pending!" }
];
function showComingSoonModal(section) {
    const randomContent = comingSoonContent[Math.floor(Math.random() * comingSoonContent.length)];
    document.getElementById('comingSoonIcon').innerHTML = randomContent.icon;
    document.getElementById('comingSoonText').textContent = `${section}: ${randomContent.text}`;
    document.getElementById('comingSoonModal').style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

document.getElementById('notifyForm').addEventListener('submit', function(e) {
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

const backToTop = document.querySelector('.back-to-top');
backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('scroll', () => {
    if (window.scrollY > 200) {
        backToTop.classList.add('visible');
    } else {
        backToTop.classList.remove('visible');
    }
});

// Memetron 3030 API Test Script
const API_ENDPOINT = 'https://ambientpixels-meme-api-fn.azurewebsites.net/api/memeGenerator';
const API_KEY = 'xyz123';

async function getAccessToken() {
    try {
        const response = await fetch('https://ambientpixels-meme-api-fn.azurewebsites.net/api/getToken', {
            headers: { 'x-api-key': API_KEY }
        });
        console.log('Token Response Status:', response.status);
        if (!response.ok) throw new Error(`Token fetch failed: ${response.status}`);
        const data = await response.json();
        console.log('Token Data:', data);
        return data.token;
    } catch (error) {
        console.error('Error fetching token:', error);
        return null;
    }
}

async function generateMeme() {
    const promptInput = document.getElementById('memePrompt');
    const prompt = promptInput.value.trim() || 'A confused robot in a disco';
    const generateBtn = document.getElementById('memeGenerateBtn');
    const loadingDiv = document.getElementById('memeLoading');
    const memeImage = document.getElementById('memeImage');
    const topText = document.getElementById('memeTopText');
    const bottomText = document.getElementById('memeBottomText');

    generateBtn.disabled = true;
    loadingDiv.classList.add('visible');
    memeImage.classList.remove('visible');
    topText.innerText = '';
    bottomText.innerText = '';

    try {
        const token = await getAccessToken();
        if (!token) throw new Error('No access token available');

        console.log('Fetching meme with prompt:', prompt);
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ endpoint: "image", prompt: prompt })
        });

        console.log('API Response Status:', response.status);
        if (!response.ok) throw new Error(`API error: ${response.status} - ${response.statusText}`);

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        console.log('API Response Image URL:', imageUrl);

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

document.getElementById('memeGenerateBtn').addEventListener('click', generateMeme);

window.onload = () => {
    generateMeme();
};
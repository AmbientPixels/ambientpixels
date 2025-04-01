// main.js - Ambient Pixels v1.1.0-20250402
document.addEventListener('DOMContentLoaded', () => {
    console.log('Main JS loaded - Circuits online');

    setTimeout(() => {
        // Hero Loading & Rotation
        const slides = document.querySelectorAll('.hero-slide');
        const heroText = document.querySelector('.hero-text');
        const heroSub = document.querySelector('.hero-subheading');
        const loading = document.querySelector('.hero-loading');

        slides.forEach(slide => {
            const bgImage = slide.getAttribute('data-bg');
            if (bgImage) slide.style.backgroundImage = `url('${bgImage}')`;
        });

        const headlines = [
            { text: "Neon beats in cosmic streets.", sub: "Code the void. Paint the stars." },
            { text: "Glitch the multiverse.", sub: "Pixels pulse. Worlds collide." },
            { text: "Forge the neon frontier.", sub: "Tools spark. Futures glow." },
            { text: "Quantum code unleashed.", sub: "Bits bend. Reality shifts." },
            { text: "Cyber dreams in 4K.", sub: "Reels hum. Screens ignite." },
            { text: "Pixel chaos reigns.", sub: "Art glows. Grid lives." },
            { text: "Neon grid uprising.", sub: "Code runs. Stars fall." },
            { text: "Echoes of the void.", sub: "Glitch sings. Time breaks." },
            { text: "Cosmic tools awaken.", sub: "Forge fast. Shine bright." },
            { text: "Infinite neon pulse.", sub: "Beats drop. Worlds sync." },
            { text: "Ambient Pixels", sub: "Neon beats in cosmic streets—v2.3 ignites." }
        ];

        let currentIndex = 0;
        const initialHeadline = headlines[Math.floor(Math.random() * headlines.length)];

        function rotateHero() {
            slides[currentIndex].classList.remove('active');
            currentIndex = (currentIndex + 1) % slides.length;
            slides[currentIndex].classList.add('active');
            console.log(`Hero rotated - BG: ${currentIndex + 1}, Headline: "${heroText.textContent}"`);
        }

        heroText.textContent = initialHeadline.text;
        heroSub.textContent = initialHeadline.sub;

        setTimeout(() => {
            slides[0].classList.add('active');
            loading.style.display = 'none';
            heroText.classList.add('visible');
            heroSub.classList.add('visible');
        }, 2000);

        setInterval(rotateHero, 25000);
    }, 50);

    // Copy Prompt Functionality
    window.copyPrompt = function() {
        const textarea = document.getElementById('raw-prompt');
        textarea.select();
        document.execCommand('copy');
        console.log('Raw prompt copied to clipboard');
        alert('Prompt copied—forge your neon future!');
    };
});
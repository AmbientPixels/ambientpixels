// main.js - Ambient Pixels v2.1.5-20250402
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

    // Toggle Sections
    document.querySelectorAll('[data-toggle]').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-toggle');
            const content = document.getElementById(targetId);
            if (content) {
                const isExpanded = content.style.display === 'block';
                content.style.display = isExpanded ? 'none' : 'block';
                button.setAttribute('aria-expanded', !isExpanded);
                console.log(`Toggled ${targetId} - Expanded: ${!isExpanded}`);
            }
        });
    });

    // Copy Prompt Functionality
    window.copyPrompt = function() {
        const textarea = document.getElementById('raw-prompt');
        textarea.select();
        document.execCommand('copy');
        console.log('Raw prompt copied to clipboard');
        alert('Prompt copied—forge your neon future!');
    };

    // Neon Forge Prompt
    window.generateForgePrompt = function() {
        const theme = document.getElementById('forge-theme').value;
        const input1 = document.getElementById('forge-input1').value || '[random]';
        const input2 = document.getElementById('forge-input2').value || '[chaos]';
        let output;

        switch (theme) {
            case 'website':
                output = `Build a ${input1} site with ${input2}—12 columns pulse with glitchy chaos.`;
                break;
            case 'tale':
                output = `A ${input1} hacks ${input2} in a neon sprawl—grid bends, stars fall.`;
                break;
            case 'art':
                output = `Blend ${input1} with ${input2}—pixels shatter in neon rain.`;
                break;
            case 'self':
                output = `AI forges a ${Math.random() > 0.5 ? 'grid' : 'tale'} with ${Math.random() > 0.5 ? 'neon' : 'glitch'}—self-glitched chaos ignites!`;
                break;
            default:
                output = 'Awaiting your chaos...';
        }

        document.getElementById('forge-output').textContent = output;
        console.log(`Neon Forge Prompt: "${output}"`);
    };

    // Theme Toggle Demo
    document.querySelectorAll('.theme-toggle-demo').forEach(button => {
        button.addEventListener('click', () => {
            const darkIcon = button.querySelector('.dark-icon-demo');
            const lightIcon = button.querySelector('.light-icon-demo');
            const isLight = lightIcon.style.display === 'inline';
            darkIcon.style.display = isLight ? 'inline' : 'none';
            lightIcon.style.display = isLight ? 'none' : 'inline';
            console.log(`Theme toggle demo - Light: ${!isLight}`);
        });
    });
});
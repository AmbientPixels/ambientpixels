// main.js - Ambient Pixels v2.1.10-20250406
document.addEventListener('DOMContentLoaded', () => {
    console.log('Main JS loaded - Circuits online');

    Promise.all([
        fetch('./modules/header.html')
            .then(response => {
                if (!response.ok) throw new Error(`Header fetch failed: ${response.status}`);
                return response.text();
            })
            .then(data => {
                console.log('Header fetched:', data);
                document.getElementById('header-placeholder').innerHTML = data;
            }),
        fetch('./modules/footer.html')
            .then(response => {
                if (!response.ok) throw new Error(`Footer fetch failed: ${response.status}`);
                return response.text();
            })
            .then(data => {
                console.log('Footer fetched:', data);
                document.getElementById('footer-placeholder').innerHTML = data;
            })
    ])
    .then(() => {
        // Version injection
        const versionElement = document.getElementById('version');
        if (versionElement) versionElement.textContent = 'v2.1.10';

        // Banner logic (moved up for priority)
        console.log('Banner JS loaded - Neon alert pulsing');
        const banners = [
            { level: 'low', icon: 'fas fa-music', text: 'Caution: Grid Gremlins at Work—Blinky Bits Blame the Handlers!' }
        ];
        const container = document.createElement('div');
        container.className = 'banner-container';
        document.body.insertBefore(container, document.body.firstChild); // Insert at top
        const banner = banners[0];
        container.innerHTML = `
            <div class="banner ${banner.level}">
                <i class="${banner.icon} banner-icon"></i>
                <span>${banner.text}</span>
                <button class="banner-close" aria-label="Close Banner">×</button>
            </div>
        `;
        const closeBtn = container.querySelector('.banner-close');
        closeBtn.addEventListener('click', () => container.classList.add('hidden'));

        // Hero logic
        console.log('Hero JS loaded - Cosmic visuals pulsing');
        const hero = document.getElementById('hero');
        const loadingOverlay = document.getElementById('loading');
        const headline = document.getElementById('hero-headline');
        const subheading = document.getElementById('hero-subheading');
        if (hero && loadingOverlay && headline && subheading) {
            const headlines = [
                'Code Hums Electric', 'Neon Dreams Ignite', 'Where Chaos Sparks Genius',
                'Booting the Multiverse', 'Welcome to the Glitch', 'Data Surge Online',
                'Cosmic Scripts Loaded', 'Your Playground Awaits', 'Hack the Grid', 'Memes Activate'
            ];
            const subheadings = [
                'A neon playground for cosmic chaos.', 'Initializing deep-space protocol.',
                'Runtime: infinite;', 'Plug in and play.', 'Powered by coffee and stardust.',
                'AI circuits warmed up.', 'Synthwave loaded. Let\'s go.', 'Dreams stitched in code.',
                'Systems nominal. Begin.', 'Dark mode: engaged.'
            ];
            const heroImages = [
                './images/hero/hero-01.jpg', './images/hero/hero-02.jpg', './images/hero/hero-03.jpg',
                './images/hero/hero-04.jpg', './images/hero/hero-05.jpg', './images/hero/hero-06.jpg',
                './images/hero/hero-07.jpg', './images/hero/hero-08.jpg', './images/hero/hero-09.jpg',
                './images/hero/hero-10.jpg'
            ];
            let currentImageIndex = Math.floor(Math.random() * heroImages.length);
            const randomFrom = arr => arr[Math.floor(Math.random() * arr.length)];
            heroImages.forEach(src => {
                const img = new Image();
                img.src = src;
                img.onload = () => console.log(`Preloaded: ${src}`);
                img.onerror = () => console.error(`Failed to preload: ${src}`);
            });
            function cycleBackground() {
                hero.style.backgroundImage = `url(${heroImages[currentImageIndex]})`;
                console.log(`Setting background: ${heroImages[currentImageIndex]}`);
                currentImageIndex = (currentImageIndex + 1) % heroImages.length;
            }
            headline.textContent = randomFrom(headlines);
            subheading.textContent = randomFrom(subheadings);
            cycleBackground();
            setInterval(cycleBackground, 10000);
            setTimeout(() => {
                console.log('Fading out loading overlay');
                loadingOverlay.classList.add('fade-out');
                hero.classList.add('loaded');
            }, 3500);
        }

        // Theme logic
        console.log('Theme JS loaded - Dark/light switching ready');
        const body = document.body;
        const themeIcons = document.querySelectorAll('.theme-icon');
        if (themeIcons.length) {
            themeIcons.forEach(icon => {
                if (body.getAttribute('data-theme') === 'light') {
                    icon.classList.remove('fa-moon');
                    icon.classList.add('fa-sun');
                }
                icon.addEventListener('click', () => {
                    console.log('Theme icon clicked');
                    const currentTheme = body.getAttribute('data-theme');
                    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                    body.setAttribute('data-theme', newTheme);
                    themeIcons.forEach(i => {
                        i.classList.remove(newTheme === 'dark' ? 'fa-sun' : 'fa-moon');
                        i.classList.add(newTheme === 'dark' ? 'fa-moon' : 'fa-sun');
                    });
                });
            });
        }

        // Load remaining scripts
        const scripts = ['js/nav.js', 'js/modal-window.js', 'js/test-toggles.js'];
        scripts.forEach(src => {
            const script = document.createElement('script');
            script.src = src;
            script.defer = true;
            script.onload = () => console.log(`Script loaded: ${src}`);
            script.onerror = () => console.error(`Failed to load script: ${src}`);
            document.body.appendChild(script);
        });

        console.log('All fetches complete, scripts loading');
    })
    .catch(err => console.error('Fetch failed:', err));
});
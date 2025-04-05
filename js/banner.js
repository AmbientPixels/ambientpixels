// banner.js - Ambient Pixels v2.1.10-20250406
document.addEventListener('DOMContentLoaded', () => {
    const banners = [
        {
            level: 'low',
            icon: 'fas fa-music',
            text: 'Caution: Grid Gremlins at Work—Blinky Bits Blame the Handlers!'
        }
    ];

    const container = document.createElement('div');
    container.className = 'banner-container';
    document.body.prepend(container);

    function showBanner() {
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
        container.classList.remove('hidden');
    }

    showBanner();
});
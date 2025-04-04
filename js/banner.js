// banner.js - Ambient Pixels v2.1.10-20250404
// Single test banner
document.addEventListener('DOMContentLoaded', () => {
    const banners = [
        {
            level: 'low',
            icon: 'fas fa-music',
            text: 'NeonPulse Vibes: Kavinsky’s beats fuel the night—tune in, stack up.'
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
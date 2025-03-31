// banner.js - Ambient Pixels v0.17.8-20250331
function closeBanner(bannerId) {
    const banner = document.getElementById(bannerId);
    if (banner) {
        banner.style.display = 'none';
        console.log(`Closed banner: ${bannerId}`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('banner.js loaded');
});
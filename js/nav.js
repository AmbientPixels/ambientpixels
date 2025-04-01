// nav.js - Ambient Pixels v1.0.1-20250401
document.addEventListener('DOMContentLoaded', () => {
    console.log('Nav JS loaded - Grid navigation active');

    setTimeout(() => {
        const navLinks = document.querySelector('.nav-links');
        const toggleBtn = document.querySelector('.nav-toggle');

        if (!navLinks || !toggleBtn) {
            console.warn('Nav elements not found:', { navLinks, toggleBtn });
            return;
        }

        toggleBtn.addEventListener('click', () => {
            navLinks.classList.toggle('nav-open');
            console.log('Mobile menu toggled:', navLinks.classList.contains('nav-open') ? 'Open' : 'Closed');
        });

        const mediaQuery = window.matchMedia('(max-width: 768px)');
        function handleMobile(e) {
            if (e.matches) {
                toggleBtn.style.display = 'block';
                navLinks.classList.remove('nav-open');
                console.log('Mobile view activated');
            } else {
                toggleBtn.style.display = 'none';
                navLinks.classList.remove('nav-open');
                console.log('Desktop view activated');
            }
        }
        mediaQuery.addListener(handleMobile);
        handleMobile(mediaQuery);
    }, 50);
});
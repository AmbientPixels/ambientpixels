// main.js - Ambient Pixels v1.0.1-20250401
document.addEventListener('DOMContentLoaded', () => {
    console.log('Main JS loaded - Circuits online');

    // Ensure DOM is fully loaded
    setTimeout(() => {
        const gridButtons = document.querySelectorAll('.grid-col-6 .btn');

        if (gridButtons.length === 0) {
            console.warn('No grid buttons found');
            return;
        }

        gridButtons.forEach((btn) => {
            const contentId = btn.getAttribute('data-toggle');
            const content = document.getElementById(contentId);

            if (!content) {
                console.warn(`Content not found for ID: ${contentId}`);
                return;
            }

            btn.addEventListener('click', () => {
                if (content.classList.contains('open')) {
                    content.style.maxHeight = '0';
                    content.style.opacity = '0';
                    setTimeout(() => { content.classList.remove('open'); }, 300); // Match transition duration
                } else {
                    content.classList.add('open');
                    content.style.maxHeight = content.scrollHeight + 'px';
                    setTimeout(() => { content.style.opacity = '1'; }, 10); // Smooth fade-in
                }
            });
            console.log(`Attached toggle handler to: ${contentId} button`);
        });
    }, 50); // 50ms delay to ensure DOM readiness
});
// main.js - Ambient Pixels v1.0.1-20250401
document.addEventListener('DOMContentLoaded', () => {
    console.log('Main JS loaded - Circuits online');

    setTimeout(() => {
        const gridButtons = document.querySelectorAll('.grid-col-6 .btn');
        const toggleHeaders = document.querySelectorAll('.toggle-header');

        if (gridButtons.length === 0 && toggleHeaders.length === 0) {
            console.warn('No toggle elements found');
            return;
        }

        // Function to toggle content with typewriter animation
        const toggleContent = (contentId, header) => {
            const content = document.getElementById(contentId);
            if (!content) {
                console.warn(`Content not found for ID: ${contentId}`);
                return;
            }

            if (content.classList.contains('open')) {
                content.style.maxHeight = '0';
                content.style.opacity = '0';
                setTimeout(() => { content.classList.remove('open'); }, 300);
                header.classList.remove('typing');
            } else {
                content.classList.add('open');
                content.style.maxHeight = content.scrollHeight + 'px';
                content.style.opacity = '1';
                header.classList.add('typing');
                setTimeout(() => { header.classList.remove('typing'); }, 1000); // Match animation duration
            }
            console.log(`Content toggled for: ${contentId}`, content.classList.contains('open') ? 'Shown' : 'Hidden');
        };

        // Button toggles
        gridButtons.forEach((btn) => {
            const contentId = btn.getAttribute('data-toggle');
            const header = btn.closest('.grid-col-6').querySelector('.toggle-header');
            btn.addEventListener('click', () => toggleContent(contentId, header));
            console.log(`Attached toggle handler to button: ${contentId}`);
        });

        // Header toggles
        toggleHeaders.forEach((header) => {
            const contentId = header.getAttribute('data-toggle');
            header.addEventListener('click', () => toggleContent(contentId, header));
            console.log(`Attached toggle handler to header: ${contentId}`);
        });
    }, 50);
});
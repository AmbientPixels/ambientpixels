// test-toggles.js - Ambient Pixels v2.1.10-20250403
// Handles toggleable sections in test.html
document.addEventListener('DOMContentLoaded', () => {
    console.log('Test toggles JS loaded - Chaos lab active');

    const toggleButtons = document.querySelectorAll('.btn[data-toggle]');
    
    toggleButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-toggle');
            const content = document.getElementById(targetId);
            const isExpanded = button.getAttribute('aria-expanded') === 'true';

            if (content) {
                content.style.display = isExpanded ? 'none' : 'block';
                button.setAttribute('aria-expanded', !isExpanded);
                console.log(`Toggled ${targetId}: ${isExpanded ? 'hidden' : 'shown'}`);
            } else {
                console.error(`Toggle target not found: ${targetId}`);
            }
        });
    });
});
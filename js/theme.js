// theme.js - Ambient Pixels v2.1.9-20250403
// Handles theme switching - Fixed for grid compatibility
document.addEventListener('DOMContentLoaded', () => {
    console.log('Theme JS loaded - Dark/light switching ready');

    const body = document.body;                              // Grab body for theme attribute
    const themeIcons = document.querySelectorAll('.theme-icon'); // Grab all theme icons (nav + grid)

    // Check if any theme icons exist
    if (themeIcons.length > 0) {
        // Set initial state for all icons
        themeIcons.forEach(icon => {
            if (body.getAttribute('data-theme') === 'light') {
                icon.classList.remove('fa-moon');
                icon.classList.add('fa-sun');
            }
        });

        // Add click event to each theme icon
        themeIcons.forEach(icon => {
            icon.addEventListener('click', () => {
                if (body.getAttribute('data-theme') === 'dark') {
                    body.setAttribute('data-theme', 'light'); // Switch to light
                    themeIcons.forEach(i => {
                        i.classList.remove('fa-moon');    // Remove moon
                        i.classList.add('fa-sun');        // Add sun
                    });
                } else {
                    body.setAttribute('data-theme', 'dark');  // Switch to dark
                    themeIcons.forEach(i => {
                        i.classList.remove('fa-sun');     // Remove sun
                        i.classList.add('fa-moon');       // Add moon
                    });
                }
            });
        });
    } else {
        console.error('No theme icons found - Check .theme-icon in HTML');
    }
});
// main.js - Ambient Pixels v2.1.10-20250403
// General site functionality
document.addEventListener('DOMContentLoaded', () => {
    console.log('Main JS loaded - Circuits online');

    // Example: Version injection (assuming this is line 41)
    const versionElement = document.getElementById('version');
    if (versionElement) {
        versionElement.textContent = 'v2.1.10'; // Update manually if version.js is stale
    } else {
        console.warn('Version element not found - Check #version in HTML');
    }

    // Add other main site logic here if needed
});
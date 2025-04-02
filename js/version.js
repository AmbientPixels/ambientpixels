// version.js - Ambient Pixels v2.1.5-20250402
const VERSION = 'v2.1.5';
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('version').textContent = VERSION;
    console.log(`Version injected: ${VERSION}`);
});
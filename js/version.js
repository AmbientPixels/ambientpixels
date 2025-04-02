// version.js - Ambient Pixels v2.1.6-20250402
const VERSION = 'v2.1.6';
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('version').textContent = VERSION;
    console.log(`Version injected: ${VERSION}`);
});
// main.js - Ambient Pixels v1.0.1-20250401
document.addEventListener('DOMContentLoaded', () => {
    console.log('Main JS loaded - Circuits online');

    // Select all buttons in grid-col-6 sections
    const gridButtons = document.querySelectorAll('.grid-col-6 .btn');

    if (gridButtons.length === 0) {
        console.warn('No grid buttons found');
        return;
    }

    gridButtons.forEach((btn, index) => {
        const labels = ['Video', 'Art', 'Client Work', 'Tools'];
        btn.addEventListener('click', () => {
            alert(`${labels[index] || 'Mystery'} section loading...`);
        });
        console.log(`Attached click handler to: ${labels[index] || 'Unnamed'} button`);
    });
});
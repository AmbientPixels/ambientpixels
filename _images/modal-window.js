// modal-window.js - Ambient Pixels v0.17.5-20250329 - March 29, 2025, 1:55 PM PDT

const comingSoonContent = [
    { icon: '<i class="fas fa-bug"></i>', text: "AI debug mode: Page not found—yet!" },
    { icon: '<i class="fas fa-skull"></i>', text: "This page terminated by rogue AI!" },
    { icon: '<i class="fas fa-bomb"></i>', text: "AI blew up this section—rebuilding soon!" },
    { icon: '<i class="fas fa-ghost"></i>', text: "Ghost in the machine ate this page!" },
    { icon: '<i class="fas fa-poo"></i>', text: "AI took a dump, page coming later!" },
    { icon: '<i class="fas fa-alien"></i>', text: "AI abducted this content—ETA unknown!" },
    { icon: '<i class="fas fa-robot"></i>', text: "AI’s drunk on binary—page pending!" }
];

window.showComingSoonModal = function(section) {
    console.log('showComingSoonModal called with:', section);
    const modal = document.getElementById('comingSoonModal');
    const iconElement = document.getElementById('comingSoonIcon');
    const textElement = document.getElementById('comingSoonText');
    
    if (!modal || !iconElement || !textElement) {
        console.error('Modal elements missing:', { modal, iconElement, textElement });
        return;
    }

    const randomContent = comingSoonContent[Math.floor(Math.random() * comingSoonContent.length)];
    iconElement.innerHTML = randomContent.icon;
    textElement.textContent = `${section}: ${randomContent.text}`;
    modal.classList.add('active');
    console.log('Modal class set to active');
};

window.closeModal = function(modalId) {
    console.log('closeModal called with:', modalId);
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        console.log('Modal class removed');
    } else {
        console.error(`Modal with ID ${modalId} not found`);
    }
};

document.addEventListener('click', (event) => {
    const modal = document.getElementById('comingSoonModal');
    if (modal && modal.classList.contains('active') && !event.target.closest('.modal-content')) {
        console.log('Clicked outside—closing modal');
        modal.classList.remove('active');
    }
});

console.log('modal-window.js script loaded');
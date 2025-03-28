// modal-window.js
const comingSoonContent = [
    { icon: '<i class="fas fa-bug"></i>', text: "AI debug mode: Page not found—yet!" },
    { icon: '<i class="fas fa-skull"></i>', text: "This page terminated by rogue AI!" },
    { icon: '<i class="fas fa-bomb"></i>', text: "AI blew up this section—rebuilding soon!" },
    { icon: '<i class="fas fa-ghost"></i>', text: "Ghost in the machine ate this page!" },
    { icon: '<i class="fas fa-poo"></i>', text: "AI took a dump, page coming later!" },
    { icon: '<i class="fas fa-alien"></i>', text: "AI abducted this content—ETA unknown!" },
    { icon: '<i class="fas fa-robot"></i>', text: "AI’s drunk on binary—page pending!" }
];

function showComingSoonModal(section) {
    const randomContent = comingSoonContent[Math.floor(Math.random() * comingSoonContent.length)];
    document.getElementById('comingSoonIcon').innerHTML = randomContent.icon;
    document.getElementById('comingSoonText').textContent = `${section}: ${randomContent.text}`;
    document.getElementById('comingSoonModal').style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}
// modal-window.js - Ambient Pixels v0.17.8-20250331
function showComingSoonModal(feature) {
    console.log('showComingSoonModal called with:', feature);
    const modal = document.getElementById('modal');
    const modalMessage = document.getElementById('modal-message');
    const closeModal = document.querySelector('.close-modal');

    if (!modal || !modalMessage || !closeModal) {
        console.error('Modal elements missing:', { modal, modalMessage, closeModal });
        return;
    }

    modalMessage.textContent = `${feature} is coming soon!`;
    modal.style.display = 'block';

    closeModal.onclick = function() {
        modal.style.display = 'none';
    };

    window.onclick = function(event) {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
}

console.log('modal-window.js script loaded');
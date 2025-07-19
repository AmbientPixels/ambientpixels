// modal-window.js stub
// TODO: Replace with actual modal window implementation
console.warn('[modal-window] Stub loaded.');

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) {
    console.warn(`[modal-window] showModal: no element with id ${id}`);
    return;
  }
  modal.classList.remove('hidden');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) {
    console.warn(`[modal-window] closeModal: no element with id ${id}`);
    return;
  }
  modal.classList.add('hidden');
}

// Bind close buttons inside modals
if (document.readyState !== 'loading') {
  document.querySelectorAll('.modal .close-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      if (modal) modal.classList.add('hidden');
    });
  });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal .close-button').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal');
        if (modal) modal.classList.add('hidden');
      });
    });
  });
}

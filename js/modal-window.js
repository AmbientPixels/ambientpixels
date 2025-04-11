// modal-window.js – Ambient Pixels Modal Controls
console.log('Modal window JS loaded');

function setupContactModal() {
  const openBtn = document.querySelector('a[href="#contact"]'); // Footer link
  const modal = document.getElementById('contact-modal');
  const backdrop = document.getElementById('modal-backdrop');
  const closeBtn = document.getElementById('modal-close');

  if (!openBtn || !modal || !backdrop || !closeBtn) return;

  openBtn.addEventListener('click', e => {
    e.preventDefault();
    modal.classList.remove('hidden');
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  backdrop.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      modal.classList.add('hidden');
    }
  });
}
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('contact-form');
    const status = document.getElementById('form-status');
  
    if (!form || !status) return;
  
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
  
      const data = new FormData(form);
  
      try {
        const res = await fetch('https://formspree.io/f/xanejjnz', {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: data
        });
  
        if (res.ok) {
          form.reset();
          status.textContent = '✅ Message sent! Nova will beam back soon.';
          status.style.color = 'var(--success, #54b054)';
        } else {
          const result = await res.json();
          throw result.error || new Error('Form error');
        }
      } catch (err) {
        console.error(err);
        status.textContent = '⚠️ Something glitched. Try again.';
        status.style.color = 'var(--error, #dc7b7f)';
      }
    });
  });
  
// cardforge-layout.js
// Handles split-pane drag divider, stepper navigation, and accordion behaviors
// Added by Cascade 2025-07-23

(function () {
  // Ensure DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    initDragDivider();
    initStepper();
    initTabs();
  }

  /* ---------------- Drag Divider ---------------- */
  function initDragDivider() {
    const divider = document.querySelector('.drag-divider');
    const formPane = document.querySelector('.form-pane');
    const previewPane = document.querySelector('.preview-pane');
    if (!divider || !formPane || !previewPane) return;

    let isDragging = false;
    divider.addEventListener('mousedown', (e) => {
      isDragging = true;
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = '';
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const container = divider.parentElement;
      const rect = container.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const min = 200; // min width each pane
      const max = rect.width - min;
      const clamped = Math.min(Math.max(offsetX, min), max);
      const percent = (clamped / rect.width) * 100;
      formPane.style.flex = `0 0 ${percent}%`;
      previewPane.style.flex = `0 0 ${100 - percent}%`;
    });
  }

  /* ---------------- Stepper ---------------- */
  function initStepper() {
    const sections = document.querySelectorAll('.cf-section');
    const stepButtons = document.querySelectorAll('.step-btn');
    if (!stepButtons.length || !sections.length) return;

    stepButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const step = btn.dataset.step;
        const targetSection = document.querySelector(`[data-step-section="${step}"]`);
        if (targetSection) {
          // Hide all sections then show target
          sections.forEach(sec=>{sec.classList.remove('active'); sec.style.display='none';});
          targetSection.classList.add('active');
          targetSection.style.display='block';
        }
        stepButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  /* ---------------- Tabs ---------------- */
  function initTabs() {
    const sections = document.querySelectorAll('.cf-section');
    // Stepper click already handles switching sections;
    sections.forEach((sec) => {
      // ensure only first section visible by default
      if (!sec.classList.contains('active')) sec.style.display = 'none';
    });
  }
})();
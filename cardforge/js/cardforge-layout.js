// cardforge-layout.js
// Handles split-pane drag divider, stepper navigation, and accordion behaviors
// Added by Cascade 2025-07-23

(function () {
  const RAIL_COLLAPSE_KEY = 'cfRailCollapsed';

  // Ensure DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    initRailToggle();
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
          // Scroll so the active section is visible below the chrome
          // Use rAF to ensure layout is recalculated after display change
          requestAnimationFrame(() => {
            targetSection.scrollIntoView({ behavior: 'instant', block: 'start' });
          });
        }
        stepButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        // auto-flip card on section change: flip for sections > 3 (Social, Badges, Attributes)
        const cardInner = document.querySelector('.card-inner');
        if (cardInner) {
          if (parseInt(step, 10) > 3) cardInner.classList.add('flipped');
          else cardInner.classList.remove('flipped');
        }
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

  /* ---------------- Rail Toggle ---------------- */
  function initRailToggle() {
    const toggleBtn = document.querySelector('[data-rail-toggle]');
    if (!toggleBtn) return;

    const body = document.body;
    const applyState = (collapsed) => {
      body.classList.toggle('cf-rail-collapsed', collapsed);
      toggleBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    };

    try {
      const savedState = localStorage.getItem(RAIL_COLLAPSE_KEY);
      if (savedState === '1') {
        applyState(true);
      }
    } catch (err) {
      console.warn('CF Rail: unable to read saved state', err);
    }

    toggleBtn.addEventListener('click', () => {
      const collapsed = !body.classList.contains('cf-rail-collapsed');
      applyState(collapsed);
      try {
        localStorage.setItem(RAIL_COLLAPSE_KEY, collapsed ? '1' : '0');
      } catch (err) {
        console.warn('CF Rail: unable to persist state', err);
      }
    });
  }
})();
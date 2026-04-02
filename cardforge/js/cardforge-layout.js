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
    if (window.ProductAnalytics) ProductAnalytics.init('cardforge');
    initRailToggle();
    initDragDivider();
    initStepper();
    initTabs();
    wireStepNav();
    initMobilePreviewToggle();
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
          // Hide all sections then show target with enter animation
          sections.forEach(sec=>{sec.classList.remove('active','cf-section-entering'); sec.style.display='none';});
          targetSection.classList.add('active');
          targetSection.style.display='block';
          // Trigger enter animation (reflow trick to restart)
          void targetSection.offsetWidth;
          targetSection.classList.add('cf-section-entering');
          // Scroll so the active section is visible below the chrome
          requestAnimationFrame(() => {
            targetSection.scrollIntoView({ behavior: 'instant', block: 'start' });
          });
        }
        stepButtons.forEach((b) => {
          b.classList.remove('active');
          // Reset Forge button active background when deselected
          if (b.classList.contains('step-btn--forge')) {
            b.style.background = '';
          }
        });
        btn.classList.add('active');
        // Apply gold active background for Forge tab (inline to beat CSS specificity)
        if (btn.classList.contains('step-btn--forge')) {
          btn.style.background = 'rgba(240, 192, 64, 0.14)';
        }
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
    const icon = toggleBtn.querySelector('i');

    const applyState = (collapsed) => {
      body.classList.toggle('cf-rail-collapsed', collapsed);
      toggleBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', collapsed ? 'Expand navigation rail' : 'Collapse navigation rail');
      if (icon) {
        icon.className = collapsed ? 'fas fa-angles-right' : 'fas fa-angles-left';
      }
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

  /* ---------------- Section Prev / Next Nav ---------------- */

  function wireStepNav() {
    const stepBtns = Array.from(document.querySelectorAll('.step-btn'));
    if (!stepBtns.length) return;

    // Build ordered list of { step, label } from left rail
    const steps = stepBtns.map(btn => ({
      step: btn.dataset.step,
      label: (btn.querySelector('.step-label') || {}).textContent || 'Step ' + btn.dataset.step
    }));

    // Remove existing "Next: Basics →" CTA (superseded by standardized nav)
    const legacyCta = document.getElementById('craft-completion-cta');
    if (legacyCta) legacyCta.remove();

    // Navigate to a step by triggering the corresponding left rail button
    function goToStep(stepId) {
      const btn = document.querySelector('.step-btn[data-step="' + stepId + '"]');
      if (btn) btn.click();
    }

    steps.forEach((current, idx) => {
      const section = document.querySelector('[data-step-section="' + current.step + '"]');
      if (!section) return;

      const isFirst = idx === 0;
      const isLast = idx === steps.length - 1;
      const prev = isFirst ? null : steps[idx - 1];
      const next = isLast ? null : steps[idx + 1];

      // Build nav row
      const row = document.createElement('div');
      row.className = 'cf-step-nav';

      // Previous button
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'cf-step-nav-btn cf-step-nav-prev';
      prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i> <span>' + (prev ? prev.label : 'Previous') + '</span>';
      prevBtn.setAttribute('aria-label', prev ? 'Go to ' + prev.label : 'No previous section');
      if (isFirst) {
        prevBtn.style.display = 'none';
      } else {
        prevBtn.addEventListener('click', function() { goToStep(prev.step); });
      }

      // Next button
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'cf-step-nav-btn cf-step-nav-next';
      if (isLast) {
        nextBtn.id = 'forge-publish-nav-btn';
        nextBtn.innerHTML = '<span>Publish</span> <i class="fas fa-share"></i>';
        nextBtn.setAttribute('aria-label', 'Publish card to gallery');
        nextBtn.addEventListener('click', function() {
          // Check which forge tab is active
          var deckTab = document.querySelector('.forge-sidebar-tab[data-forge-tab="deck"].active');
          if (deckTab) {
            // On deck tab — check if decks exist and one is selected
            if (!window.cardForgeActions) return;
            var decks = window.cardForgeActions.getSavedDecks();
            if (!decks || decks.length === 0) {
              window.cardForgeActions.showNotification('No decks to publish — create a deck first', 'info');
            } else if (!window.cardForgeActions._selectedDeckId) {
              window.cardForgeActions.showNotification('Select a deck first', 'info');
            } else {
              window.cardForgeActions.publishDeck(window.cardForgeActions._selectedDeckId);
            }
          } else {
            // On cards tab — publish the current card
            if (window.cardForgeActions && window.cardForgeActions.handlePublishCard) {
              window.cardForgeActions.handlePublishCard();
            } else if (window.publishCard) {
              window.publishCard();
            }
          }
        });
      } else {
        nextBtn.innerHTML = '<span>' + next.label + '</span> <i class="fas fa-chevron-right"></i>';
        nextBtn.setAttribute('aria-label', 'Go to ' + next.label);
        nextBtn.addEventListener('click', function() { goToStep(next.step); });
      }

      row.appendChild(prevBtn);
      row.appendChild(nextBtn);
      section.appendChild(row);
    });
  }

  /* ---------------- Mobile Preview Toggle ---------------- */
  function initMobilePreviewToggle() {
    var fab = document.querySelector('.cf-mobile-preview-toggle');
    var pane = document.querySelector('.cf-preview-pane');
    var closeBtn = document.querySelector('.cf-mobile-preview-close');
    if (!fab || !pane) return;

    fab.addEventListener('click', function() {
      pane.classList.add('mobile-visible');
      fab.style.display = 'none';
      document.body.style.overflow = 'hidden';
    });

    function closePreview() {
      pane.classList.remove('mobile-visible');
      fab.style.display = '';
      document.body.style.overflow = '';
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', closePreview);
    }

    // Close on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && pane.classList.contains('mobile-visible')) {
        closePreview();
      }
    });
  }
})();
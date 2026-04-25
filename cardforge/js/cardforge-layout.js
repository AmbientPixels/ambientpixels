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
    wireQuickPublish();
    wireCardClickToEdit();
    initMobilePreviewToggle();
    seedEmberFields();
  }

  /* ---------------- Ember particle field ----------------
   * Inject a .cf-ember-field into each .cf-section in the right pane.
   * Each ember is a span with randomized inline CSS custom properties
   * driving size, duration, delay, and horizontal drift. CSS owns the
   * animation; this just plants the DOM seeds.
   * Runs once at init — sections that exist after this point get
   * tagged via the MutationObserver below so dynamically-injected
   * panes still get embers. */
  function seedEmberFields() {
    document.querySelectorAll('.cf-main-pane .cf-section').forEach(seedSection);

    const mainPane = document.querySelector('.cf-main-pane');
    if (!mainPane) return;
    const obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('.cf-section')) seedSection(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('.cf-section').forEach(seedSection);
          }
        });
      });
    });
    obs.observe(mainPane, { childList: true, subtree: true });
  }

  function seedSection(section) {
    if (!section || section.querySelector(':scope > .cf-ember-field')) return;
    const field = document.createElement('div');
    field.className = 'cf-ember-field';
    field.setAttribute('aria-hidden', 'true');
    const count = 16;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const e = document.createElement('span');
      e.className = 'cf-ember';
      const left = Math.random() * 100;
      const size = 1.5 + Math.random() * 2.5;
      const dur = 7 + Math.random() * 7;            // 7–14s
      const delay = -Math.random() * dur;           // negative = pre-distributed
      const drift = -25 + Math.random() * 50;       // -25..+25 px sway
      const peak = 0.20 + Math.random() * 0.25;     // 0.20..0.45
      e.style.cssText =
        'left:' + left.toFixed(1) + '%;' +
        '--cf-ember-size:' + size.toFixed(1) + 'px;' +
        '--cf-ember-dur:' + dur.toFixed(1) + 's;' +
        '--cf-ember-delay:' + delay.toFixed(1) + 's;' +
        '--cf-ember-drift:' + drift.toFixed(1) + 'px;' +
        '--cf-ember-peak:' + peak.toFixed(2) + ';';
      frag.appendChild(e);
    }
    field.appendChild(frag);
    section.appendChild(field);
  }

  /* ---------------- Card click-to-edit ----------------
   * Click a region of the rendered card → jump to the rail entry
   * that edits it. Both faces are clickable. When the click originates
   * from the back face we suppress the auto-flip in activate() so the
   * card stays where the user was looking.
   *
   * Zone → nav-id routing:
   *   portrait/avatar                        → artwork
   *   name/class/quote (front or back)       → basics
   *   biography / read-more / back-header    → basics
   *   stats / stat-bars                      → stats
   *   badges-container / badge-row / buffs   → buffs
   *   attributes-container / attribute-row   → attributes
   *   rarity text/badge                      → basics
   *   empty card surface                     → cardfx
   */
  function wireCardClickToEdit() {
    const canvas = document.querySelector('.card-preview-canvas');
    if (!canvas) return;
    canvas.addEventListener('click', function (e) {
      const nav = window.CardForgeNav;
      if (!nav || typeof nav.activateById !== 'function') return;

      const fromBack = !!e.target.closest('.card-back');
      const opts = { suppressFlip: fromBack };

      const zone = e.target.closest(
        // Artwork
        '.card-avatar, .card-avatar-container, .hero-image-container, ' +
        '.card-portrait, .card-image-container, .image-wrapper, ' +
        // Basics (text on front + back, plus back-only biography)
        '.card-name, .card-class, .card-quote, ' +
        '.back-header, .biography-section, .biography-text, .bio-read-more, ' +
        // Stats (front)
        '.card-stats, .stat-row, .stat-item, .stat-bar, .stat-progress, .stat-name, .stat-value, ' +
        // Badges / buffs (front + back)
        '.card-badges, .badge-row, .micro-row, [data-badge-key], .badge-card-header, ' +
        '.badges-container, .badges-section, ' +
        // Attributes (back)
        '.card-attributes, .attribute-row, [data-attr-key], ' +
        '.attributes-container, .attributes-section, ' +
        // Rarity
        '.card-rarity, [data-rarity-tag]'
      );
      if (!zone) {
        e.stopPropagation();
        nav.activateById('cardfx', opts);
        return;
      }
      e.stopPropagation();
      if (zone.matches('.card-avatar, .card-avatar-container, .hero-image-container, .card-portrait, .card-image-container, .image-wrapper')) {
        nav.activateById('artwork', opts);
      } else if (
        zone.matches('.card-stats, .stat-row, .stat-item, .stat-bar, .stat-progress, .stat-name, .stat-value') ||
        zone.closest('.card-stats')
      ) {
        nav.activateById('stats', opts);
      } else if (
        zone.matches('.card-badges, .badge-row, .micro-row, [data-badge-key], .badge-card-header, .badges-container, .badges-section') ||
        zone.closest('.card-badges, .badges-container, .badges-section')
      ) {
        nav.activateById('buffs', opts);
      } else if (
        zone.matches('.card-attributes, .attribute-row, [data-attr-key], .attributes-container, .attributes-section') ||
        zone.closest('.card-attributes, .attributes-container, .attributes-section')
      ) {
        nav.activateById('attributes', opts);
      } else {
        // name / class / quote / bio / rarity → basics
        nav.activateById('basics', opts);
      }
    });
    canvas.classList.add('cf-card-clickable');
  }

  /* ---------------- Quick Publish ----------------
   * #cf-publish-quick-btn in the preview toolbar (under the card).
   * Calls the same publish logic as the Forge-section button —
   * card publish via window.cardForgeActions.handlePublishCard(),
   * or deck publish when the Forge sidebar is on the deck tab. */
  function wireQuickPublish() {
    const quickBtn = document.getElementById('cf-publish-quick-btn');
    if (!quickBtn) return;
    quickBtn.addEventListener('click', function (e) {
      e.preventDefault();
      const deckTab = document.querySelector('.forge-sidebar-tab[data-forge-tab="deck"].active');
      const actions = window.cardForgeActions;
      if (deckTab && actions) {
        const decks = actions.getSavedDecks && actions.getSavedDecks();
        if (!decks || decks.length === 0) {
          actions.showNotification && actions.showNotification('No decks to publish — create a deck first', 'info');
        } else if (!actions._selectedDeckId) {
          actions.showNotification && actions.showNotification('Select a deck first', 'info');
        } else {
          actions.publishDeck && actions.publishDeck(actions._selectedDeckId);
        }
      } else if (actions && actions.handlePublishCard) {
        actions.handlePublishCard();
      } else if (window.publishCard) {
        window.publishCard();
      }
    });
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
    const navButtons = document.querySelectorAll('.cf-rail-nav .step-btn');
    const sections = document.querySelectorAll('[data-step-section]');
    const cardDesignSection = document.querySelector('[data-step-section="1"]');
    if (!navButtons.length || !sections.length) return;

    function activate(btn, opts) {
      opts = opts || {};
      const sectionIndex = btn.dataset.targetSection;
      const tierId = btn.dataset.targetTier;

      sections.forEach(sec => {
        sec.classList.remove('active', 'cf-section-entering');
        sec.style.display = 'none';
      });
      const target = document.querySelector(`[data-step-section="${sectionIndex}"]`);
      if (target) {
        target.classList.add('active');
        target.style.display = 'block';
        void target.offsetWidth;
        target.classList.add('cf-section-entering');
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'instant', block: 'start' });
        });
      }

      if (tierId && cardDesignSection) {
        cardDesignSection.dataset.activeTier = tierId;
      }

      navButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      // Auto-flip based on section — unless caller suppressed it, e.g. when
      // the user clicked a back-face element and should stay on the back.
      const cardInner = document.querySelector('.card-inner');
      if (cardInner && !opts.suppressFlip) {
        if (parseInt(sectionIndex, 10) > 3) cardInner.classList.add('flipped');
        else cardInner.classList.remove('flipped');
      }

      if (window.ProductAnalytics && typeof window.ProductAnalytics.track === 'function') {
        try {
          window.ProductAnalytics.track('cardforge.nav.select', {
            navId: btn.dataset.navId,
            section: sectionIndex,
            tier: tierId || null
          });
        } catch (_) {}
      }
    }

    navButtons.forEach(btn => btn.addEventListener('click', () => activate(btn)));

    window.CardForgeNav = {
      activate,
      activateById: (id, opts) => {
        const b = document.querySelector(`.cf-rail-nav .step-btn[data-nav-id="${id}"]`);
        if (b) activate(b, opts);
      }
    };
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
    const navBtns = Array.from(document.querySelectorAll('.cf-rail-nav .step-btn'));
    if (!navBtns.length) return;

    const legacyCta = document.getElementById('craft-completion-cta');
    if (legacyCta) legacyCta.remove();

    const sectionEntries = [];
    const seen = new Set();
    navBtns.forEach(btn => {
      const sec = btn.dataset.targetSection;
      if (sec && !seen.has(sec)) {
        seen.add(sec);
        sectionEntries.push({
          section: sec,
          label: (btn.querySelector('.step-btn__label') || {}).textContent || ('Section ' + sec),
          navId: btn.dataset.navId
        });
      }
    });

    function goToNavId(navId) {
      const btn = document.querySelector('.cf-rail-nav .step-btn[data-nav-id="' + navId + '"]');
      if (btn) btn.click();
    }

    sectionEntries.forEach((current, idx) => {
      const section = document.querySelector('[data-step-section="' + current.section + '"]');
      if (!section) return;

      const isFirst = idx === 0;
      const isLast = idx === sectionEntries.length - 1;
      const prev = isFirst ? null : sectionEntries[idx - 1];
      const next = isLast ? null : sectionEntries[idx + 1];

      const row = document.createElement('div');
      row.className = 'cf-step-nav';

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'cf-step-nav-btn cf-step-nav-prev';
      prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i> <span>' + (prev ? prev.label : 'Previous') + '</span>';
      prevBtn.setAttribute('aria-label', prev ? 'Go to ' + prev.label : 'No previous section');
      if (isFirst) {
        prevBtn.style.display = 'none';
      } else {
        prevBtn.addEventListener('click', function() { goToNavId(prev.navId); });
      }

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'cf-step-nav-btn cf-step-nav-next';
      if (isLast) {
        nextBtn.id = 'forge-publish-nav-btn';
        nextBtn.innerHTML = '<span>Publish</span> <i class="fas fa-share"></i>';
        nextBtn.setAttribute('aria-label', 'Publish card to gallery');
        nextBtn.addEventListener('click', function() {
          var deckTab = document.querySelector('.forge-sidebar-tab[data-forge-tab="deck"].active');
          if (deckTab) {
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
        nextBtn.addEventListener('click', function() { goToNavId(next.navId); });
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

/**
 * Handle ?start=X param from splash "ways-to-start" tiles.
 *   quick  → auto-open Quick Build wizard
 *   preset → activate Presets nav (default state; telemetry-only signal)
 *   blank  → activate Presets nav, leave card at default state
 */
(function handleStartParam() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  function run() {
    var params = new URLSearchParams(window.location.search);
    var start = params.get('start');
    if (!start) return;

    setTimeout(function () {
      if (start === 'quick') {
        var qb = document.getElementById('quick-build-btn');
        if (qb) qb.click();
      } else if (start === 'preset') {
        if (window.CardForgeNav) window.CardForgeNav.activateById('presets');
      } else if (start === 'blank') {
        if (window.CardForgeNav) window.CardForgeNav.activateById('presets');
      }

      if (window.ProductAnalytics && typeof window.ProductAnalytics.track === 'function') {
        try { window.ProductAnalytics.track('cardforge.editor.start_param', { start: start }); } catch (_) {}
      }
    }, 150);
  }
})();
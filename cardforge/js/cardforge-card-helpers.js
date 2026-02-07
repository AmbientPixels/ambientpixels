/**
 * CardForge Card Helpers — Portal Tooltips + Biography "Read more" Modal
 * Shared across editor preview, lightbox, and gallery contexts.
 * Created: 2025-02-06
 */
(function () {
  'use strict';

  // ===== PORTAL TOOLTIP SYSTEM =====
  // Appends tooltip to document.body so it's never clipped by overflow:hidden ancestors.

  let activeTooltip = null;

  function createPortalTooltip(text, anchorRect) {
    removePortalTooltip();

    const tip = document.createElement('div');
    tip.className = 'cf-portal-tooltip';
    tip.textContent = text;
    document.body.appendChild(tip);
    activeTooltip = tip;

    // Measure after append so we get real dimensions
    requestAnimationFrame(() => {
      if (!activeTooltip) return;
      const tipRect = tip.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Horizontal: center on anchor, clamp to viewport
      let left = anchorRect.left + anchorRect.width / 2 - tipRect.width / 2;
      left = Math.max(6, Math.min(left, vw - tipRect.width - 6));

      // Vertical: prefer below, flip above if no room
      let top = anchorRect.bottom + 8;
      if (top + tipRect.height > vh - 6) {
        top = anchorRect.top - tipRect.height - 8;
      }
      top = Math.max(6, top);

      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.style.opacity = '1';
    });
  }

  function removePortalTooltip() {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }

  // Cleanup on scroll/resize
  window.addEventListener('scroll', removePortalTooltip, true);
  window.addEventListener('resize', removePortalTooltip);

  // Delegate: any .social-link with a title attribute
  document.addEventListener('mouseenter', function (e) {
    const link = e.target.closest('.social-link[title]');
    if (!link) return;
    const text = link.getAttribute('title');
    if (!text) return;
    // Suppress native tooltip by temporarily removing title
    link.dataset.cfTitle = text;
    link.removeAttribute('title');
    createPortalTooltip(text, link.getBoundingClientRect());
  }, true);

  document.addEventListener('mouseleave', function (e) {
    const link = e.target.closest('.social-link');
    if (!link) return;
    // Restore native title
    if (link.dataset.cfTitle) {
      link.setAttribute('title', link.dataset.cfTitle);
      delete link.dataset.cfTitle;
    }
    removePortalTooltip();
  }, true);

  // ===== BIOGRAPHY "READ MORE" MODAL =====

  let _bioModalCardEl = null;
  let _bioModalRAF = null;

  function positionBioModal() {
    const modal = document.querySelector('.cf-bio-modal');
    if (!modal || !_bioModalCardEl) return;

    const rect = _bioModalCardEl.getBoundingClientRect();
    const cardCX = rect.left + rect.width / 2;
    const cardCY = rect.top + rect.height / 2;

    // Measure modal (without transform so we get natural size)
    const mW = modal.offsetWidth;
    const mH = modal.offsetHeight;

    // Clamp so modal stays visually within card bounds
    let left = cardCX;
    let top = cardCY;

    // Horizontal: keep modal edges inside card rect
    const halfW = mW / 2;
    if (left - halfW < rect.left) left = rect.left + halfW;
    if (left + halfW > rect.right) left = rect.right - halfW;

    // Vertical: keep modal edges inside card rect
    const halfH = mH / 2;
    if (top - halfH < rect.top) top = rect.top + halfH;
    if (top + halfH > rect.bottom) top = rect.bottom - halfH;

    modal.style.left = left + 'px';
    modal.style.top = top + 'px';
  }

  function onBioModalScrollResize() {
    if (_bioModalRAF) return;
    _bioModalRAF = requestAnimationFrame(() => {
      _bioModalRAF = null;
      positionBioModal();
    });
  }

  function openBioModal(fullText, anchorEl) {
    // Prevent duplicates
    closeBioModal();

    // Resolve card element for anchoring
    _bioModalCardEl = anchorEl
      ? anchorEl.closest('.card-preview-canvas') || anchorEl.closest('.card-back')
      : null;

    // Create overlay (full-screen backdrop)
    const overlay = document.createElement('div');
    overlay.className = 'cf-bio-modal-overlay';
    document.body.appendChild(overlay);

    // Create modal (separate element, positioned over card)
    const modal = document.createElement('div');
    modal.className = 'cf-bio-modal';
    modal.innerHTML = `
      <button class="cf-bio-modal-close" aria-label="Close">&times;</button>
      <h3 class="cf-bio-modal-title">Biography</h3>
      <div class="cf-bio-modal-text">${escapeHTML(fullText)}</div>
    `;
    document.body.appendChild(modal);

    // Initial position
    positionBioModal();

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('active'));

    // Reposition on scroll / resize (throttled via rAF)
    window.addEventListener('scroll', onBioModalScrollResize, true);
    window.addEventListener('resize', onBioModalScrollResize);

    // Close handlers
    modal.querySelector('.cf-bio-modal-close').addEventListener('click', closeBioModal);
    overlay.addEventListener('click', closeBioModal);
    document.addEventListener('keydown', bioModalEscHandler);
  }

  function closeBioModal() {
    const overlay = document.querySelector('.cf-bio-modal-overlay');
    const modal = document.querySelector('.cf-bio-modal');
    if (overlay) {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
    }
    if (modal) {
      setTimeout(() => modal.remove(), 200);
    }
    window.removeEventListener('scroll', onBioModalScrollResize, true);
    window.removeEventListener('resize', onBioModalScrollResize);
    if (_bioModalRAF) { cancelAnimationFrame(_bioModalRAF); _bioModalRAF = null; }
    _bioModalCardEl = null;
    document.removeEventListener('keydown', bioModalEscHandler);
  }

  function bioModalEscHandler(e) {
    if (e.key === 'Escape') closeBioModal();
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Delegate: click on .bio-read-more buttons
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.bio-read-more');
    if (!btn) return;
    e.preventDefault();
    const bioSection = btn.closest('.biography-section');
    if (!bioSection) return;
    const bioText = bioSection.querySelector('.biography-text');
    if (!bioText) return;
    // Get the full untruncated text from the data attribute or textContent
    const fullText = bioText.dataset.fullBio || bioText.textContent;
    openBioModal(fullText, bioSection);
  });

  // ===== PUBLIC API =====
  window.CardForgeCardHelpers = { openBioModal, closeBioModal, removePortalTooltip };
})();

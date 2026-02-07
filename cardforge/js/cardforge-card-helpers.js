/**
 * CardForge Card Helpers — Portal Tooltips + Biography "Read more" Modal
 * Shared across editor preview, lightbox, and gallery contexts.
 * Created: 2025-02-06
 */
(function () {
  'use strict';

  // ===== PORTAL TOOLTIP SYSTEM =====
  // Appends tooltip to document.body so it's never clipped by overflow:hidden ancestors.
  // Positioned relative to cursor with offsets to avoid sitting under the pointer.

  let activeTooltip = null;
  let _lastMouseX = 0;
  let _lastMouseY = 0;
  const TIP_OFFSET_X = 14;
  const TIP_OFFSET_Y = 14;
  const TIP_PAD = 8;

  // Track cursor globally so tooltip can follow / position relative to it
  document.addEventListener('mousemove', function (e) {
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;
    if (activeTooltip) positionTooltipAtCursor();
  }, true);

  function positionTooltipAtCursor() {
    if (!activeTooltip) return;
    const tip = activeTooltip;
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer bottom-right of cursor
    let left = _lastMouseX + TIP_OFFSET_X;
    let top = _lastMouseY + TIP_OFFSET_Y;

    // Flip left if overflows right
    if (left + tipW > vw - TIP_PAD) {
      left = _lastMouseX - tipW - TIP_OFFSET_X;
    }
    // Flip up if overflows bottom
    if (top + tipH > vh - TIP_PAD) {
      top = _lastMouseY - tipH - TIP_OFFSET_Y;
    }
    // Final clamp
    left = Math.max(TIP_PAD, Math.min(left, vw - tipW - TIP_PAD));
    top = Math.max(TIP_PAD, Math.min(top, vh - tipH - TIP_PAD));

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.opacity = '1';
  }

  function createPortalTooltip(text) {
    removePortalTooltip();

    const tip = document.createElement('div');
    tip.className = 'cf-portal-tooltip';
    tip.textContent = text;
    document.body.appendChild(tip);
    activeTooltip = tip;

    // Position after append so we get real dimensions
    requestAnimationFrame(() => {
      if (!activeTooltip) return;
      positionTooltipAtCursor();
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

  // ===== SOCIAL LINK TOOLTIP =====
  document.addEventListener('mouseenter', function (e) {
    const link = e.target.closest('.social-link[title], .social-link[data-cf-title]');
    if (!link) return;
    const text = link.getAttribute('title') || link.dataset.cfTitle;
    if (!text) return;
    // Suppress native tooltip by temporarily removing title
    if (link.hasAttribute('title')) {
      link.dataset.cfTitle = text;
      link.removeAttribute('title');
    }
    createPortalTooltip(text);
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

  // ===== BADGE TOOLTIP =====
  // Use portal tooltip for badge items — suppress native title.
  document.addEventListener('mouseenter', function (e) {
    const badge = e.target.closest('.badge-item[title], .badge-item[data-cf-title]');
    if (!badge) return;
    const text = badge.getAttribute('title') || badge.dataset.cfTitle;
    if (!text) return;
    if (badge.hasAttribute('title')) {
      badge.dataset.cfTitle = text;
      badge.removeAttribute('title');
    }
    createPortalTooltip(text);
  }, true);

  document.addEventListener('mouseleave', function (e) {
    const badge = e.target.closest('.badge-item');
    if (!badge) return;
    if (badge.dataset.cfTitle) {
      badge.setAttribute('title', badge.dataset.cfTitle);
      delete badge.dataset.cfTitle;
    }
    removePortalTooltip();
  }, true);

  // ===== ATTRIBUTE ELLIPSIS TOOLTIP =====
  // Show full text on hover when attribute key/value is truncated (ellipsed).
  document.addEventListener('mouseenter', function (e) {
    const el = e.target.closest('.attribute-key, .attribute-value');
    if (!el) return;
    // Only show tooltip if content is actually truncated
    if (el.scrollWidth <= el.clientWidth) return;
    const text = el.textContent;
    if (!text) return;
    createPortalTooltip(text);
  }, true);

  document.addEventListener('mouseleave', function (e) {
    const el = e.target.closest('.attribute-key, .attribute-value');
    if (!el) return;
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
      <div class="cf-bio-modal-header">
        <h3 class="cf-bio-modal-title">Biography</h3>
        <button class="cf-bio-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="cf-bio-modal-body">
        <div class="cf-bio-modal-text">${escapeHTML(fullText)}</div>
      </div>
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

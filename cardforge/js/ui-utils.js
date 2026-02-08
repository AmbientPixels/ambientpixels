/**
 * UI Utility Functions for CardForge
 * Created: 2025-07-19
 * 
 * Shared UI functions like dialogs and form handling
 */

(function(global) {
  'use strict';

  // Check if UIUtils is already defined
  if (global.UIUtils) {
    console.warn('UIUtils is already defined. Skipping redefinition.');
    return;
  }

  /**
   * Shows a confirmation dialog
   * @param {string} title - Dialog title
   * @param {string} message - Dialog message
   * @param {Function} onConfirm - Callback when user confirms
   * @param {Function} [onCancel] - Optional cancel callback
   */
  function showConfirmDialog(title, message, onConfirm, onCancel) {
    const dialog = document.getElementById('cardforge-dialog');
    if (!dialog) {
      console.error('Dialog element not found');
      // Fallback to native confirm if dialog element is missing
      if (confirm(`${title}\n\n${message}`)) {
        onConfirm && onConfirm();
      } else {
        onCancel && onCancel();
      }
      return;
    }

    // Set dialog content
    const titleEl = dialog.querySelector('#cardforge-dialog-title');
    const messageEl = dialog.querySelector('#cardforge-dialog-message');
    const confirmBtn = dialog.querySelector('#cardforge-dialog-confirm');
    const cancelBtn = dialog.querySelector('#cardforge-dialog-cancel');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    // Clone buttons to remove any existing event listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);

    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Set up new event listeners
    const handleConfirm = () => {
      dialog.classList.remove('active');
      onConfirm && onConfirm();
      // Clean up event listeners
      newConfirmBtn.removeEventListener('click', handleConfirm);
      newCancelBtn.removeEventListener('click', handleCancel);
    };

    const handleCancel = () => {
      dialog.classList.remove('active');
      onCancel && onCancel();
      // Clean up event listeners
      newConfirmBtn.removeEventListener('click', handleConfirm);
      newCancelBtn.removeEventListener('click', handleCancel);
    };

    newConfirmBtn.addEventListener('click', handleConfirm);
    newCancelBtn.addEventListener('click', handleCancel);

    // Add escape key handler
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Show dialog by adding 'active' class
    dialog.classList.add('active');
    
    // Focus the confirm button for better keyboard navigation
    setTimeout(() => newConfirmBtn.focus(), 100);
  }

  /**
   * Clears all validation errors from the form
   */
  function clearValidationErrors() {
    // Remove existing error messages
    const errorMessages = document.querySelectorAll('.error-message');
    errorMessages.forEach(el => el.remove());

    // Remove error classes from inputs
    const errorInputs = document.querySelectorAll('.error');
    errorInputs.forEach(el => el.classList.remove('error'));
  }

  /**
   * Shows validation errors in the form
   * @param {Array} errors - Array of error messages
   */
  function showValidationErrors(errors) {
    clearValidationErrors();
    
    if (!errors || !errors.length) return;

    // Create error container if it doesn't exist
    let errorContainer = document.getElementById('error-container');
    if (!errorContainer) {
      errorContainer = document.createElement('div');
      errorContainer.id = 'error-container';
      errorContainer.className = 'error-message';
      const form = document.getElementById('card-editor-form');
      if (form) {
        form.insertBefore(errorContainer, form.firstChild);
      }
    }

    // Add error messages
    errorContainer.innerHTML = `
      <p><strong>Please fix the following errors:</strong></p>
      <ul>
        ${errors.map(error => `<li>${error}</li>`).join('')}
      </ul>
    `;
  }

  // Create the UIUtils object
  /**
   * Shows a single-button alert dialog (OK only)
   * @param {string} title - Dialog title
   * @param {string} message - Dialog message
   * @param {Function} [onClose] - Optional callback when closed
   */
  function showAlertDialog(title, message, onClose) {
    const dialog = document.getElementById('cardforge-dialog');
    if (!dialog) {
      alert(`${title}\n\n${message}`);
      onClose && onClose();
      return;
    }
    const titleEl = dialog.querySelector('#cardforge-dialog-title');
    const messageEl = dialog.querySelector('#cardforge-dialog-message');
    const confirmBtn = dialog.querySelector('#cardforge-dialog-confirm');
    const cancelBtn = dialog.querySelector('#cardforge-dialog-cancel');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    // Hide cancel, relabel confirm
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (confirmBtn) confirmBtn.textContent = 'OK';
    // Clone confirm to remove prior listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    // Show dialog
    dialog.classList.add('active');
    newConfirmBtn.focus();
    const handleClose = () => {
      dialog.classList.remove('active');
      if (cancelBtn) cancelBtn.style.display = '';
      if (newConfirmBtn) newConfirmBtn.textContent = 'Confirm';
      onClose && onClose();
      newConfirmBtn.removeEventListener('click', handleClose);
      document.removeEventListener('keydown', escListener);
    };
    const escListener = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    newConfirmBtn.addEventListener('click', handleClose);
    document.addEventListener('keydown', escListener);
  }

  /**
   * Shows a prompt dialog with a text input field (replaces browser prompt())
   * @param {string} title - Dialog title
   * @param {string} placeholder - Input placeholder text
   * @param {string} defaultValue - Default input value
   * @param {Function} onConfirm - Callback: onConfirm(value) or onConfirm(value, selectedIcon) when icons provided
   * @param {Function} [onCancel] - Optional cancel callback
   * @param {Object} [options] - Optional config: { icons: [{icon,label}], selectedIcon: string, confirmLabel: string }
   */
  function showPromptDialog(title, placeholder, defaultValue, onConfirm, onCancel, options) {
    const opts = options || {};
    const dialog = document.getElementById('cardforge-dialog');
    if (!dialog) {
      const result = prompt(title, defaultValue || '');
      if (result !== null && result.trim() !== '') {
        onConfirm && onConfirm(result.trim());
      } else {
        onCancel && onCancel();
      }
      return;
    }

    const titleEl = dialog.querySelector('#cardforge-dialog-title');
    const messageEl = dialog.querySelector('#cardforge-dialog-message');
    const confirmBtn = dialog.querySelector('#cardforge-dialog-confirm');
    const cancelBtn = dialog.querySelector('#cardforge-dialog-cancel');

    if (titleEl) titleEl.textContent = title;

    // Build dialog body: input + optional icon grid
    let bodyHTML = `<input type="text" id="cardforge-dialog-input"
      class="cardforge-dialog-input"
      placeholder="${placeholder || ''}"
      value="${defaultValue || ''}"
      autocomplete="off" />`;

    let _selectedIcon = opts.selectedIcon || '';

    if (opts.icons && opts.icons.length) {
      bodyHTML += '<div class="dialog-icon-picker">' +
        '<div class="dialog-icon-label">Deck Icon</div>' +
        '<div class="dialog-icon-grid">' +
        opts.icons.map(function(item) {
          return '<button type="button" class="dialog-icon-option' +
            (item.icon === _selectedIcon ? ' selected' : '') +
            '" data-icon="' + item.icon + '" title="' + item.label + '">' +
            '<i class="' + item.icon + '"></i></button>';
        }).join('') +
        '</div></div>';
    }

    if (messageEl) messageEl.innerHTML = bodyHTML;

    if (cancelBtn) cancelBtn.style.display = '';
    if (confirmBtn) confirmBtn.textContent = opts.confirmLabel || 'Create';

    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    dialog.classList.add('active');

    const inputEl = dialog.querySelector('#cardforge-dialog-input');
    if (inputEl) {
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 100);
    }

    // Icon selection handling
    const iconGrid = dialog.querySelector('.dialog-icon-grid');
    if (iconGrid) {
      iconGrid.addEventListener('click', function(e) {
        const btn = e.target.closest('.dialog-icon-option');
        if (!btn) return;
        iconGrid.querySelectorAll('.dialog-icon-option').forEach(function(b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        _selectedIcon = btn.getAttribute('data-icon');
      });
    }

    const cleanup = () => {
      dialog.classList.remove('active');
      if (messageEl) messageEl.innerHTML = '';
      if (newConfirmBtn) newConfirmBtn.textContent = 'Confirm';
      newConfirmBtn.removeEventListener('click', handleConfirm);
      newCancelBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleKeydown);
    };

    const handleConfirm = () => {
      const val = inputEl ? inputEl.value.trim() : '';
      cleanup();
      if (val) {
        onConfirm && onConfirm(val, _selectedIcon || undefined);
      } else {
        onCancel && onCancel();
      }
    };

    const handleCancel = () => {
      cleanup();
      onCancel && onCancel();
    };

    const handleKeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); }
      if (e.key === 'Escape') { handleCancel(); }
    };

    newConfirmBtn.addEventListener('click', handleConfirm);
    newCancelBtn.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleKeydown);
  }

  // ===== CRAFT PANEL BEHAVIORS =====

  // Helpers
  function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function _capDash(s) { return _cap((s || '').replace(/-/g, ' ')); }

  function _cleanLabel(url) {
    if (!url) return '';
    try {
      var raw = decodeURIComponent(url.split('/').pop().split('?')[0]);
      raw = raw.replace(/\.[^.]+$/, '');
      return raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    } catch (e) { return 'Image'; }
  }

  // ===== SINGLE SOURCE: READ CURRENT SELECTIONS =====

  function getCardDesignSelections() {
    var MS = (window.CardForge && window.CardForge.ModularState) || window.ModularState || {};
    var avatarInput = document.getElementById('card-avatar');
    var avatarUrl = avatarInput ? avatarInput.value : '';

    var artworkLabel = '';
    if (avatarUrl) {
      var selectedImg = document.querySelector('#inline-image-grid img.selected');
      if (selectedImg) {
        artworkLabel = selectedImg.getAttribute('data-display-name')
                    || selectedImg.getAttribute('data-title')
                    || selectedImg.getAttribute('alt')
                    || '';
      }
      if (!artworkLabel) artworkLabel = _cleanLabel(avatarUrl);
    }

    return {
      artwork:     { url: avatarUrl, label: artworkLabel },
      frame:       { container: MS.imageContainer || 'masked',
                     variant:   MS.imageContainerVariant || 'circle',
                     effect:    MS.imageEffect || 'none',
                     effectVar: MS.imageEffectVariant || 'clean' },
      style:       { palette:   MS.palette || 'neon',
                     variant:   MS.paletteVariant || 'light',
                     textColor: MS.textColor || 'auto' },
      composition: { alignment: MS.horizontalAlignment || 'center',
                     weight:    MS.alignmentWeight || 'balanced',
                     density:   MS.alignmentStyle || 'padded' }
    };
  }

  // ===== SINGLE SOURCE: DETERMINISTIC RENDERER =====

  function _swapPreviewClass(el, prefix, value) {
    if (!el) return;
    el.className = prefix + ' ' + value;
  }

  function renderCardDesignSummaries(sel) {
    // 1. Artwork chip
    var artChip = document.getElementById('craft-artwork-summary');
    if (artChip) {
      var thumbEl = artChip.querySelector('.art-chip-thumb');
      var labelEl = artChip.querySelector('.art-chip-label');
      if (sel.artwork.url) {
        if (thumbEl) { thumbEl.src = sel.artwork.url; thumbEl.style.display = ''; }
        if (labelEl) {
          var lbl = sel.artwork.label;
          if (lbl && lbl.length > 20) lbl = lbl.substring(0, 18) + '\u2026';
          labelEl.textContent = lbl || '';
        }
      } else {
        if (thumbEl) { thumbEl.src = ''; thumbEl.style.display = 'none'; }
        if (labelEl) labelEl.textContent = 'None';
      }
    }

    // 2. Frame & Effects — tier 2 chip + text
    var t2chip = document.querySelector('[data-tier="2"] .current-container-preview');
    if (t2chip) _swapPreviewClass(t2chip, 'current-container-preview', sel.frame.container + '-container-preview');

    var t2 = document.querySelector('[data-tier="2"] .current-selection-text');
    if (t2) {
      var fp = [_cap(sel.frame.container)];
      if (sel.frame.variant) fp.push(_cap(sel.frame.variant));
      if (sel.frame.effect !== 'none') fp.push(_cap(sel.frame.effect));
      t2.textContent = fp.join(' \u00B7 ');
    }

    // 3. Style & Mood — tier 3 chip + text
    var t3chip = document.querySelector('[data-tier="3"] .current-palette-preview');
    if (t3chip) _swapPreviewClass(t3chip, 'current-palette-preview', sel.style.palette + '-preview');

    var t3 = document.querySelector('[data-tier="3"] .current-selection-text');
    if (t3) {
      t3.textContent = _cap(sel.style.palette) + ' \u00B7 ' + _cap(sel.style.variant) + ' \u00B7 ' + _cap(sel.style.textColor);
    }

    // 4. Composition & Balance — tier 4 chip + text
    var t4chip = document.querySelector('[data-tier="4"] .current-alignment-preview');
    if (t4chip) _swapPreviewClass(t4chip, 'current-alignment-preview', sel.composition.alignment + '-alignment-preview');

    var t4 = document.querySelector('[data-tier="4"] .current-selection-text');
    if (t4) {
      t4.textContent = _cap(sel.composition.alignment) + ' \u00B7 ' + _capDash(sel.composition.weight) + ' \u00B7 ' + _cap(sel.composition.density);
    }

    // 5. Bottom Design Snapshot — segmented chips
    var chips = document.getElementById('craft-snapshot-chips');
    if (chips) {
      var artSnap = chips.querySelector('[data-snap="artwork"]');
      var frmSnap = chips.querySelector('[data-snap="frame"]');
      var moodSnap = chips.querySelector('[data-snap="mood"]');
      var compSnap = chips.querySelector('[data-snap="comp"]');

      if (artSnap) {
        if (sel.artwork.url) {
          var al = sel.artwork.label || '';
          artSnap.textContent = al.length > 16 ? al.substring(0, 14) + '\u2026' : al;
        } else {
          artSnap.textContent = '\u2014';
        }
      }
      if (frmSnap) frmSnap.textContent = _cap(sel.frame.container) + ' \u00B7 ' + _cap(sel.frame.variant);
      if (moodSnap) moodSnap.textContent = _cap(sel.style.palette) + ' ' + _cap(sel.style.variant);
      if (compSnap) compSnap.textContent = _cap(sel.composition.alignment) + ' \u00B7 ' + _capDash(sel.composition.weight);
    }
  }

  // ===== DEBOUNCED SCHEDULE =====

  var _renderRAF = 0;
  function scheduleRender() {
    cancelAnimationFrame(_renderRAF);
    _renderRAF = requestAnimationFrame(function() {
      renderCardDesignSummaries(getCardDesignSelections());
    });
  }

  // ===== INIT =====

  function initCraftPanel() {
    // Artwork row collapse/expand
    var artToggle = document.getElementById('craft-artwork-toggle');
    var artSection = document.getElementById('craft-artwork-section');
    if (artToggle && artSection) {
      artToggle.addEventListener('click', function() {
        artSection.classList.toggle('collapsed');
      });
      artToggle.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          artSection.classList.toggle('collapsed');
        }
      });
    }

    // Completion strip button → navigate to Basics step
    var cta = document.getElementById('craft-completion-cta');
    if (cta) {
      cta.addEventListener('click', function() {
        var btn = document.querySelector('.step-btn[data-step="2"]');
        if (btn) btn.click();
      });
    }

    // Event delegation: any click inside .modular-system triggers deferred render
    var modSystem = document.querySelector('.modular-system');
    if (modSystem) {
      modSystem.addEventListener('click', scheduleRender);
    }

    // Preset buttons + random roll button (outside .modular-system)
    document.querySelectorAll('.preset-btn, #roll-random-preset').forEach(function(btn) {
      btn.addEventListener('click', function() {
        // Presets/random update ModularState + DOM asynchronously; schedule multiple renders
        scheduleRender();
        setTimeout(scheduleRender, 200);
        setTimeout(scheduleRender, 600);
      });
    });

    // Initial render: immediate + deferred (gallery images load via fetch)
    scheduleRender();
    setTimeout(scheduleRender, 800);
    setTimeout(scheduleRender, 2000);
  }

  // Convenience wrapper matching old API
  function updateCardDesignSummaries() {
    renderCardDesignSummaries(getCardDesignSelections());
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(initCraftPanel, 150); });
  } else {
    setTimeout(initCraftPanel, 150);
  }

  const UIUtils = {
    showConfirmDialog,
    showPromptDialog,
    showAlertDialog,
    clearValidationErrors,
    showValidationErrors,
    initCraftPanel,
    updateCardDesignSummaries,
    getCardDesignSelections,
    renderCardDesignSummaries,
    scheduleRender
  };

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIUtils;
  } else {
    global.UIUtils = UIUtils;
  }

})(typeof window !== 'undefined' ? window : this);

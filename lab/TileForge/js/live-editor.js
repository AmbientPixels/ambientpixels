// TileForge Live Editing Module
// Handles per-tile live editing, character counting, and real-time updates

// Setup live editing for individual tile elements
function setupTileEditing(textElement, charCountElement, tileElement) {
  if (!textElement || !charCountElement || !tileElement) return;
  
  // Handle input events for live character counting
  textElement.addEventListener('input', function() {
    const text = this.textContent;
    const charCount = text.length;
    const field = this.dataset.field;
    const locale = this.dataset.locale;
    
    // Update character count display
    const countSpan = charCountElement.querySelector('.count');
    if (countSpan) {
      countSpan.textContent = charCount;
    }
    
    // Update character count color based on template-aware limits
    const limits = typeof getCurrentLimits === 'function' ? getCurrentLimits() : LIMITS;
    const limit = field === 'title' ? limits.title : limits.subtitle;
    charCountElement.className = `char-counter ${field}-counter`;
    
    if (charCount > limit.max) {
      charCountElement.classList.add('error');
    } else if (charCount > limit.warning) {
      charCountElement.classList.add('warning');
    }
    
    // Update tile status based on both title and subtitle
    updateTileStatus(tileElement);
    
    // Update CSV data if available
    updateCsvDataForTile(locale, tileElement);
  });
  
  // Handle focus/blur for better UX
  textElement.addEventListener('focus', function() {
    this.classList.add('editing');
    charCountElement.style.opacity = '1';
  });
  
  textElement.addEventListener('blur', function() {
    this.classList.remove('editing');
    charCountElement.style.opacity = '0.7';
  });
  
  // Prevent line breaks in contentEditable
  textElement.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.blur();
    }
  });
}

// Setup live editor panel functionality
function setupLiveEditor() {
  const liveEditingPanel = document.getElementById('liveEditingPanel');
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  const narratorInput = document.getElementById('narratorInput');
  const titleCharCount = document.getElementById('titleCharCount');
  const subtitleCharCount = document.getElementById('subtitleCharCount');
  const narratorCharCount = document.getElementById('narratorCharCount');
  const previewTitle = document.getElementById('previewTitle');
  const previewSubtitle = document.getElementById('previewSubtitle');
  const previewTile = document.getElementById('previewTile');
  const applyToAllBtn = document.getElementById('applyToAllBtn');
  
  // Show live editor panel when data is loaded
  if (liveEditingPanel) {
    liveEditingPanel.style.display = 'block';
  }
  
  // Real-time character counting and preview updates for title
  if (titleInput) {
    titleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update preview tile text
      if (previewTitle) {
        previewTitle.textContent = text || ''; // updated by Cascade: remove hardcoded default
      }
      
      // Update character count
      if (titleCharCount) {
        titleCharCount.textContent = charCount;
        
        // Update color based on W-count limits
        const charCountEl = titleCharCount.parentElement;
        charCountEl.className = 'char-count';
        if (charCount > LIMITS.title.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.title.warning) {
          charCountEl.classList.add('warning');
        }
      }
      
      // Update preview tile status
      updatePreviewTileStatus();
      
      // Update analytics dashboard in real-time
      updateLiveAnalytics();
    });
  }
  
  // Real-time character counting and preview updates for subtitle
  if (subtitleInput) {
    subtitleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update preview tile text - behave like localized previews
      if (previewSubtitle) {
        if (text.trim() === '') {
          // Hide subtitle when empty, let title expand
          previewSubtitle.textContent = '';
          previewSubtitle.classList.add('hidden');
        } else {
          // Show subtitle with text
          previewSubtitle.textContent = text;
          previewSubtitle.classList.remove('hidden');
        }
      }
      
      // Update character count
      if (subtitleCharCount) {
        subtitleCharCount.textContent = charCount;
        
        // Update color based on W-count limits
        const charCountEl = subtitleCharCount.parentElement;
        charCountEl.className = 'char-count';
        if (charCount > LIMITS.subtitle.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.subtitle.warning) {
          charCountEl.classList.add('warning');
        }
      }
      
      // Update preview tile status
      updatePreviewTileStatus();
      
      // Update analytics dashboard in real-time
      updateLiveAnalytics();
    });
  }
  
  // Narrator text input handler
  if (narratorInput) {
    narratorInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update character count
      if (narratorCharCount) {
        narratorCharCount.textContent = charCount;
        
        // Add visual feedback for character limits (using subtitle limits as reference)
        const charCountEl = narratorCharCount.parentElement;
        charCountEl.classList.remove('warning', 'error');
        
        if (charCount > LIMITS.subtitle.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.subtitle.warning) {
          charCountEl.classList.add('warning');
        }
      }
      
      // Update preview tile status
      updatePreviewTileStatus();
      
      // Update analytics dashboard in real-time
      updateLiveAnalytics();
    });
  }
  
  // Initialize clean state on load (no pre-filled Fortnite text)
  // updated by Cascade: clear preload defaults and mirror blank preview
  try {
    if (titleInput) titleInput.value = '';
    if (subtitleInput) subtitleInput.value = '';
    if (narratorInput) narratorInput.value = '';
    if (titleCharCount) titleCharCount.textContent = '0';
    if (subtitleCharCount) subtitleCharCount.textContent = '0';
    if (narratorCharCount) narratorCharCount.textContent = '0';
    if (previewTitle) previewTitle.textContent = '';
    if (previewSubtitle) {
      previewSubtitle.textContent = '';
      previewSubtitle.classList.add('hidden');
    }
    updatePreviewTileStatus();
    updateLiveAnalytics();
  } catch (e) {
    console.warn('Live editor init state setup skipped:', e);
  }

  // Apply to all tiles button
  if (applyToAllBtn) {
    applyToAllBtn.addEventListener('click', function() {
      const title = titleInput?.value || '';
      const subtitle = subtitleInput?.value || '';
      const narratorText = narratorInput?.value || '';
      
      // Update all tiles in the preview
      const allTiles = document.querySelectorAll('.tile-preview');
      allTiles.forEach(tile => {
        const tileTitle = tile.querySelector('.tile-title');
        const tileSubtitle = tile.querySelector('.tile-subtitle');
        
        if (tileTitle) tileTitle.textContent = title;
        if (tileSubtitle) tileSubtitle.textContent = subtitle;
        
        // Update tile status based on new text
        const analysis = analyzeText(title, subtitle);
        tile.className = `tile-preview ${analysis.status}`;
        
        const badge = tile.querySelector('.tile-status-badge');
        if (badge) {
          badge.className = `tile-status-badge ${analysis.status}`;
          badge.textContent = analysis.status === 'clean' ? '✓' : 
                             analysis.status === 'near-limit' ? '⚠' : '⚠';
        }
        
        // Update character counters for each tile
        const titleCounter = tile.querySelector('.title-counter .count');
        const subtitleCounter = tile.querySelector('.subtitle-counter .count');
        if (titleCounter) titleCounter.textContent = title.length;
        if (subtitleCounter) subtitleCounter.textContent = subtitle.length;
      });
      
      // Update analytics after applying changes
      if (currentCsvData) {
        // Update CSV data with new values
        currentCsvData.forEach(row => {
          row['items/0/title'] = title;
          row['items/0/subtitle'] = subtitle;
          row['items/0/narratorText'] = narratorText;
        });
        
        // Recalculate analytics
        renderLocaleGroups(currentCsvData);
      }
    });
  }
  
  // Manual Apply All buttons for typed text
  const titleManualApplyBtn = document.getElementById('titleManualApplyBtn');
  const subtitleManualApplyBtn = document.getElementById('subtitleManualApplyBtn');
  const narratorManualApplyBtn = document.getElementById('narratorManualApplyBtn');
  
  // Apply manually entered title text to all tiles
  if (titleManualApplyBtn) {
    titleManualApplyBtn.addEventListener('click', function() {
        const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
        if (totalLocales === 0) {
            const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
            if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); } else { if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); } }
            return;
        }
        const manualText = titleInput ? titleInput.value.trim() : '';
        if (manualText) {
            // Confirm applying non-empty text to all
            if (window.showModal) {
              window.showModal('', {
                title: 'Confirm Apply',
                content: `
                  <p class="modal-message">Apply this Title to all ${totalLocales} locale(s)?</p>
                `,
                confirmText: 'Apply to All',
                cancelText: 'Cancel',
                onConfirm: function() { applyManualTextToAllTiles(manualText, 'title'); }
              });
            } else {
              applyManualTextToAllTiles(manualText, 'title');
            }
        } else {
            window.showModal(
              'This will clear the Title field for all tiles. Are you sure?',
              {
                type: 'clear-confirmation',
                confirmText: 'Clear All',
                cancelText: 'Cancel',
                onConfirm: function() { applyManualTextToAllTiles('', 'title'); }
              }
            );
        }
    });
  }
  
  // Apply manually entered subtitle text to all tiles
  if (subtitleManualApplyBtn) {
    subtitleManualApplyBtn.addEventListener('click', function() {
        const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
        if (totalLocales === 0) {
            const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
            if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); } else { if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); } }
            return;
        }
        const manualText = subtitleInput ? subtitleInput.value.trim() : '';
        if (manualText) {
            // Confirm applying non-empty text to all
            if (window.showModal) {
              window.showModal('', {
                title: 'Confirm Apply',
                content: `
                  <p class="modal-message">Apply this Subtitle to all ${totalLocales} locale(s)?</p>
                `,
                confirmText: 'Apply to All',
                cancelText: 'Cancel',
                onConfirm: function() { applyManualTextToAllTiles(manualText, 'subtitle'); }
              });
            } else {
              applyManualTextToAllTiles(manualText, 'subtitle');
            }
        } else {
            window.showModal(
              'This will clear the Subtitle field for all tiles. Are you sure?',
              {
                type: 'clear-confirmation',
                confirmText: 'Clear All',
                cancelText: 'Cancel',
                onConfirm: function() { applyManualTextToAllTiles('', 'subtitle'); }
              }
            );
        }
    });
  }
  
  // Apply manually entered narrator text to all tiles
  if (narratorManualApplyBtn) {
    narratorManualApplyBtn.addEventListener('click', function() {
        const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
        if (totalLocales === 0) {
            const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
            if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); } else { if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); } }
            return;
        }
        const manualText = narratorInput ? narratorInput.value.trim() : '';
        if (manualText) {
            // Confirm applying non-empty text to all
            if (window.showModal) {
              window.showModal('', {
                title: 'Confirm Apply',
                content: `
                  <p class="modal-message">Apply this Narrator text to all ${totalLocales} locale(s)?</p>
                `,
                confirmText: 'Apply to All',
                cancelText: 'Cancel',
                onConfirm: function() { applyManualTextToAllTiles(manualText, 'narrator'); }
              });
            } else {
              applyManualTextToAllTiles(manualText, 'narrator');
            }
        } else {
            window.showModal(
              'This will clear the Narrator field for all tiles. Are you sure?',
              {
                type: 'clear-confirmation',
                confirmText: 'Clear All',
                cancelText: 'Cancel',
                onConfirm: function() { applyManualTextToAllTiles('', 'narrator'); }
              }
            );
        }
    });
  }
  
  // Apply manually entered text to SELECTED locales (opens Locale Picker)
  const titleManualApplySelectedBtn = document.getElementById('titleManualApplySelectedBtn');
  const subtitleManualApplySelectedBtn = document.getElementById('subtitleManualApplySelectedBtn');
  const narratorManualApplySelectedBtn = document.getElementById('narratorManualApplySelectedBtn');

  function getPreselectedLocales() {
    try {
      if (typeof window.getActiveLocalesForPreview === 'function') {
        return window.getActiveLocalesForPreview() || [];
      }
    } catch(e) {}
    return [];
  }

  function openLocalePickerAndApplyManual(fieldType) {
    if (!window.TileForgeLocalesUI || typeof window.TileForgeLocalesUI.open !== 'function') {
      if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Locale Picker UI not loaded.', 'warning'); } else { alert('Locale Picker UI not loaded.'); }
      return;
    }
    const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
    if (totalLocales === 0) {
      const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
      if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); } else { if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); } }
      return;
    }
    const textValue = (fieldType === 'title' ? titleInput?.value : fieldType === 'subtitle' ? subtitleInput?.value : narratorInput?.value) || '';
    const pre = getPreselectedLocales();
    window.TileForgeLocalesUI.open(function(selectedLocales) {
      const cleanSet = Array.isArray(selectedLocales) ? selectedLocales.filter(Boolean) : [];
      if (!cleanSet.length) return;
      if (!textValue) {
        window.showModal(
          `This will clear the ${fieldType} field for ${cleanSet.length} selected locale(s). Proceed?`,
          {
            type: 'clear-confirmation',
            confirmText: 'Clear Selected',
            cancelText: 'Cancel',
            onConfirm: function() { applyManualTextToSelectedLocales('', fieldType, cleanSet); }
          }
        );
      } else {
        // Confirm applying non-empty text to selected locales
        if (window.showModal) {
          window.showModal('', {
            title: 'Confirm Apply',
            content: `
              <p class="modal-message">Apply this ${fieldType} to ${cleanSet.length} selected locale(s)?</p>
            `,
            confirmText: 'Apply to Selected',
            cancelText: 'Cancel',
            onConfirm: function() { applyManualTextToSelectedLocales(textValue.trim(), fieldType, cleanSet); }
          });
        } else {
          applyManualTextToSelectedLocales(textValue.trim(), fieldType, cleanSet);
        }
      }
    }, pre);
  }

  if (titleManualApplySelectedBtn) {
    titleManualApplySelectedBtn.addEventListener('click', function() { openLocalePickerAndApplyManual('title'); });
  }
  if (subtitleManualApplySelectedBtn) {
    subtitleManualApplySelectedBtn.addEventListener('click', function() { openLocalePickerAndApplyManual('subtitle'); });
  }
  if (narratorManualApplySelectedBtn) {
    narratorManualApplySelectedBtn.addEventListener('click', function() { openLocalePickerAndApplyManual('narrator'); });
  }

  // --- Preset Sections UI wiring (collapse / enable / mode) --- // added by Cascade
  const autoLocalizeToggle = null; // Auto-Localize is permanent; UI toggle removed

  function setSectionEnabledState(section, enabled) {
    section.classList.toggle('disabled', !enabled);
    const body = section.querySelector('.preset-section-body');
    if (!body) return;
    // Disable all interactive elements in body only
    const interactive = body.querySelectorAll('input, select, button, textarea');
    interactive.forEach(el => {
      if (el.closest('.switch')) return; // keep header switches clickable
      el.disabled = !enabled;
    });
  }

  function setSectionMode(section, mode) {
    // mode: 'manual' | 'auto'
    section.classList.remove('mode-manual', 'mode-auto');
    section.classList.add(mode === 'auto' ? 'mode-auto' : 'mode-manual');

    // Update segmented buttons visual state
    const modeBtns = section.querySelectorAll('.mode-toggle .mode-btn');
    modeBtns.forEach(btn => {
      const isActive = btn.dataset.mode === mode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function applyGlobalAutoStateToSection(section, isAuto) {
    // No-op: Auto-Localize is permanent; do not alter per-section mode automatically
  }

  function initSection(section) {
    // Initial mode: Manual (per request). Auto-Localize remains permanent for apply paths.
    setSectionMode(section, 'manual');

    // Initial enabled state from checkbox
    const enabledCb = section.querySelector('.section-enabled');
    if (enabledCb) {
      setSectionEnabledState(section, !!enabledCb.checked);
      enabledCb.addEventListener('change', () => setSectionEnabledState(section, !!enabledCb.checked));
    }

    // Collapse toggle
    const collapseBtn = section.querySelector('.collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        const collapsed = section.classList.toggle('collapsed');
        collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      });
    }

    // Mode segmented control
    const modeButtons = section.querySelectorAll('.mode-toggle .mode-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.mode === 'auto' ? 'auto' : 'manual';
        setSectionMode(section, nextMode);
      });
    });

    // NOTE: Do not auto-apply global Auto-Localize on init; only respond to user toggle events
  }

  // Initialize all preset sections
  document.querySelectorAll('.preset-section').forEach(initSection);

  // Auto-Localize is permanent; no global toggle listener
}

// Enable/disable all Live Editor preset sections depending on data presence
function updateLiveEditorEnabled(hasData) {
  try {
    // Prefer the shared helper if available; otherwise, use a local inline implementation
    const enableFn = (window.setSectionEnabledState) ? window.setSectionEnabledState : function(section, enabled) {
      section.classList.toggle('disabled', !enabled);
      const body = section.querySelector('.preset-section-body');
      if (!body) return;
      const interactive = body.querySelectorAll('input, select, button, textarea');
      interactive.forEach(el => {
        if (el.closest('.switch')) return;
        el.disabled = !enabled;
      });
    };
    document.querySelectorAll('.preset-section').forEach(section => {
      // Sync checkbox visual state
      const enabledCb = section.querySelector('.section-enabled');
      if (enabledCb) enabledCb.checked = !!hasData;
      // Disable/enable interactive elements within body
      enableFn(section, !!hasData);
    });
  } catch (e) { /* no-op */ }
}

// Expose globally for main.js and CSV handlers
window.updateLiveEditorEnabled = updateLiveEditorEnabled;
// Also expose the section helper so others can reuse
if (typeof window.setSectionEnabledState === 'undefined' && typeof setSectionEnabledState !== 'undefined') {
  window.setSectionEnabledState = setSectionEnabledState; // guarded export to avoid ReferenceError
}

// updated by Cascade: provide a global background image toggle for the live preview
function toggleBackgroundImage(on) {
  try {
    const preview = document.getElementById('previewTile');
    const dndMsg = document.getElementById('dndImageMessage');
    if (!preview) return;

    // Prefer detailed image info from last upload; fallback to currentImageSrc if present
    const src = (window.currentImageInfo && window.currentImageInfo.imageSrc) ? window.currentImageInfo.imageSrc : (typeof currentImageSrc !== 'undefined' ? currentImageSrc : '');

    if (on && src) {
      preview.style.backgroundImage = `url(${src})`;
      if (dndMsg) dndMsg.style.display = 'none';
    } else {
      preview.style.backgroundImage = '';
      // Only show the drop hint when no image is applied
      if (dndMsg) dndMsg.style.display = 'flex';
    }
  } catch (e) { /* no-op */ }
}

// Expose so other modules (drag-drop.js) can call it
window.toggleBackgroundImage = toggleBackgroundImage;

// Update preview tile status based on current input
function updatePreviewTileStatus() {
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  const previewTile = document.getElementById('previewTile');
  
  if (!titleInput || !subtitleInput || !previewTile) return;
  
  const title = titleInput.value || '';
  const subtitle = subtitleInput.value || '';
  
  // Use the EXACT same analysis logic as CSV tiles
  const analysis = analyzeText(title, subtitle);
  
  // DEBUG: Log what we're getting
  console.log('Live Editor Debug:', {
    title: title,
    titleLength: title.length,
    subtitle: subtitle,
    subtitleLength: subtitle.length,
    analysis: analysis,
    LIMITS: LIMITS
  });
  
  // Apply the EXACT same class logic as createTile() function
  previewTile.className = `preview-tile ${analysis.status}`;
  
  // Apply current template class if available (FIX: Maintain template class)
  if (typeof window.templateSystem !== 'undefined') {
    const currentConfig = window.templateSystem.getCurrentConfig();
    if (currentConfig && currentConfig.name === 'Mobile Spotlight') {
      previewTile.classList.add('mobile-spotlight');
    }
  }
  
  // DEBUG: Log what class was applied
  console.log('Applied class:', previewTile.className);
  
  const badge = previewTile.querySelector('.tile-status-badge');
  if (badge) {
    badge.className = `tile-status-badge ${analysis.status}`;
    badge.textContent = analysis.status === 'clean' ? '✓' : 
                       analysis.status === 'near-limit' ? '⚠' : '⚠';
  }
}

// Setup input event listeners for tile editor
function setupEditorInputs(editor, tileElement) {
  const titleInput = editor.querySelector('.title-input');
  const subtitleInput = editor.querySelector('.subtitle-input');
  
  if (titleInput) {
    titleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update character count
      const countEl = editor.querySelector('.title-input + .char-count .count');
      if (countEl) {
        countEl.textContent = charCount;
      }
      
      // Update color based on W-count limits
      const charCountEl = editor.querySelector('.title-input + .char-count');
      if (charCountEl) {
        charCountEl.className = 'char-count';
        if (charCount > LIMITS.title.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.title.warning) {
          charCountEl.classList.add('warning');
        }
      }
    });
  }
  
  if (subtitleInput) {
    subtitleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update character count
      const countEl = editor.querySelector('.subtitle-input + .char-count .count');
      if (countEl) {
        countEl.textContent = charCount;
      }
      
      // Update color based on W-count limits
      const charCountEl = editor.querySelector('.subtitle-input + .char-count');
      if (charCountEl) {
        charCountEl.className = 'char-count';
        if (charCount > LIMITS.subtitle.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.subtitle.warning) {
          charCountEl.classList.add('warning');
        }
      }
    });
  }
}

// Update analytics dashboard based on live editor input
function updateLiveAnalytics() {
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  
  if (!titleInput || !subtitleInput) return;
  
  const title = titleInput.value || '';
  const subtitle = subtitleInput.value || '';
  const analysis = analyzeText(title, subtitle);
  
  // Create analytics based on current live editor status
  const analytics = {
    totalLocales: 1, // Live editor shows 1 preview tile
    overflowCount: analysis.status === 'overflow' ? 1 : 0,
    nearLimitCount: analysis.status === 'near-limit' ? 1 : 0,
    cleanCount: analysis.status === 'clean' ? 1 : 0
  };
  
  // Update the analytics display
  updateAnalytics(analytics);
}

// Preset Headlines System
let currentActiveLocale = 'EN-US'; // Track the currently active tile's locale

// Embedded preset data (no external file loading needed for local tool usage)
const presetData = {
  'available-now': {
    "name": "Available Now",
    "description": "Common availability messaging",
    "locales": {
      "AR-AE": "يتوفر الآن", "AR-BH": "يتوفر الآن", "AR-DZ": "يتوفر الآن", "AR-EG": "يتوفر الآن", "AR-KW": "يتوفر الآن",
      "AR-LY": "يتوفر الآن", "AR-MA": "يتوفر الآن", "AR-OM": "يتوفر الآن", "AR-QA": "يتوفر الآن", "AR-SA": "يتوفر الآن", "AR-TN": "يتوفر الآن",
      "CA-ES": "Disponible ara", "CS-CZ": "Nyní k dispozici", "DA-DK": "Fås nu", "DE-AT": "Jetzt verfügbar", "DE-CH": "Jetzt verfügbar",
      "DE-DE": "Jetzt verfügbar", "DE-LI": "Jetzt verfügbar", "DE-LU": "Jetzt verfügbar", "EL-GR": "Διαθέσιμο τώρα",
      "EN-AE": "Available now", "EN-AL": "Available now", "EN-AU": "Available now", "EN-BA": "Available now", "EN-BG": "Available now",
      "EN-BH": "Available now", "EN-CA": "Available now", "EN-CY": "Available now", "EN-CZ": "Available now", "EN-DZ": "Available now",
      "EN-EE": "Available now", "EN-EG": "Available now", "EN-GB": "Available now", "EN-GE": "Available now", "EN-GR": "Available now",
      "EN-HK": "Available now", "EN-HR": "Available now", "EN-HU": "Available now", "EN-IE": "Available now", "EN-IL": "Available now",
      "EN-IN": "Available now", "EN-IS": "Available now", "EN-KW": "Available now", "EN-LI": "Available now", "EN-LT": "Available now",
      "EN-LU": "Available now", "EN-LV": "Available now", "EN-MA": "Available now", "EN-MT": "Available now", "EN-MY": "Available now",
      "EN-NZ": "Available now", "EN-OM": "Available now", "EN-PH": "Available now", "EN-PL": "Available now", "EN-QA": "Available now",
      "EN-RO": "Available now", "EN-SA": "Available now", "EN-SG": "Available now", "EN-SI": "Available now", "EN-SK": "Available now",
      "EN-TH": "Available now", "EN-TN": "Available now", "EN-TW": "Available now", "EN-US": "Available now", "EN-ZA": "Available now",
      "ES-AR": "Disponible ahora", "ES-BO": "Disponible ahora", "ES-CL": "Disponible ahora", "ES-CO": "Disponible ahora", "ES-CR": "Disponible ahora",
      "ES-DO": "Disponible ahora", "ES-EC": "Disponible ahora", "ES-ES": "Disponible ahora", "ES-GT": "Disponible ahora", "ES-HN": "Disponible ahora",
      "ES-MX": "Disponible ahora", "ES-NI": "Disponible ahora", "ES-PA": "Disponible ahora", "ES-PE": "Disponible ahora", "ES-PR": "Disponible ahora",
      "ES-PY": "Disponible ahora", "ES-SV": "Disponible ahora", "ES-UY": "Disponible ahora", "ES-VE": "Disponible ahora",
      "FI-FI": "Saatavilla nyt", "FR-BE": "Disponible maintenant", "FR-CA": "Disponible maintenant", "FR-CH": "Disponible maintenant",
      "FR-FR": "Disponible maintenant", "FR-LU": "Disponible maintenant", "FR-MC": "Disponible maintenant", "HE-IL": "זמין עכשיו",
      "HU-HU": "Most elérhető", "IT-CH": "Disponibile ora", "IT-IT": "Disponibile ora", "JA-JP": "今すぐ利用可能",
      "KO-KR": "지금 이용 가능", "NB-NO": "Tilgjengelig nå", "NL-BE": "Nu beschikbaar", "NL-NL": "Nu beschikbaar",
      "PL-PL": "Dostępne teraz", "PT-BR": "Disponível agora", "PT-PT": "Disponível agora", "RU-RU": "Доступно сейчас",
      "SK-SK": "Dostupné teraz", "SV-SE": "Tillgänglig nu", "TH-TH": "พร้อมใช้งานแล้ว", "TR-TR": "Şimdi mevcut",
      "ZH-CN": "现已推出", "ZH-HK": "現已推出", "ZH-TW": "現已推出"
    }
  },
  'buy-now': {
    "name": "Buy Now",
    "description": "Purchase call-to-action",
    "locales": {
      "AR-AE": "بادر بالشراء الآن", "AR-BH": "بادر بالشراء الآن", "AR-DZ": "بادر بالشراء الآن", "AR-EG": "بادر بالشراء الآن",
      "AR-KW": "بادر بالشراء الآن", "AR-LY": "بادر بالشراء الآن", "AR-MA": "بادر بالشراء الآن", "AR-OM": "بادر بالشراء الآن",
      "AR-QA": "بادر بالشراء الآن", "AR-SA": "بادر بالشراء الآن", "AR-TN": "بادر بالشراء الآن",
      "CA-ES": "Compra ara", "CS-CZ": "Koupit nyní", "DA-DK": "Køb nu", "DE-AT": "Jetzt kaufen", "DE-CH": "Jetzt kaufen",
      "DE-DE": "Jetzt kaufen", "DE-LI": "Jetzt kaufen", "DE-LU": "Jetzt kaufen", "EL-GR": "Αγοράστε τώρα",
      "EN-AE": "Buy now", "EN-AL": "Buy now", "EN-AU": "Buy now", "EN-BA": "Buy now", "EN-BG": "Buy now",
      "EN-BH": "Buy now", "EN-CA": "Buy now", "EN-CY": "Buy now", "EN-CZ": "Buy now", "EN-DZ": "Buy now",
      "EN-EE": "Buy now", "EN-EG": "Buy now", "EN-GB": "Buy now", "EN-GE": "Buy now", "EN-GR": "Buy now",
      "EN-HK": "Buy now", "EN-HR": "Buy now", "EN-HU": "Buy now", "EN-IE": "Buy now", "EN-IL": "Buy now",
      "EN-IN": "Buy now", "EN-IS": "Buy now", "EN-KW": "Buy now", "EN-LI": "Buy now", "EN-LT": "Buy now",
      "EN-LU": "Buy now", "EN-LV": "Buy now", "EN-MA": "Buy now", "EN-MT": "Buy now", "EN-MY": "Buy now",
      "EN-NZ": "Buy now", "EN-OM": "Buy now", "EN-PH": "Buy now", "EN-PL": "Buy now", "EN-QA": "Buy now",
      "EN-RO": "Buy now", "EN-SA": "Buy now", "EN-SG": "Buy now", "EN-SI": "Buy now", "EN-SK": "Buy now",
      "EN-TH": "Buy now", "EN-TN": "Buy now", "EN-TW": "Buy now", "EN-US": "Buy now", "EN-ZA": "Buy now",
      "ES-AR": "Comprar ahora", "ES-BO": "Comprar ahora", "ES-CL": "Comprar ahora", "ES-CO": "Comprar ahora", "ES-CR": "Comprar ahora",
      "ES-DO": "Comprar ahora", "ES-EC": "Comprar ahora", "ES-ES": "Comprar ahora", "ES-GT": "Comprar ahora", "ES-HN": "Comprar ahora",
      "ES-MX": "Comprar ahora", "ES-NI": "Comprar ahora", "ES-PA": "Comprar ahora", "ES-PE": "Comprar ahora", "ES-PR": "Comprar ahora",
      "ES-PY": "Comprar ahora", "ES-SV": "Comprar ahora", "ES-UY": "Comprar ahora", "ES-VE": "Comprar ahora",
      "FI-FI": "Osta nyt", "FR-BE": "Acheter maintenant", "FR-CA": "Acheter maintenant", "FR-CH": "Acheter maintenant",
      "FR-FR": "Acheter maintenant", "FR-LU": "Acheter maintenant", "FR-MC": "Acheter maintenant", "HE-IL": "קנה עכשיו",
      "HU-HU": "Vásárlás most", "IT-CH": "Acquista ora", "IT-IT": "Acquista ora", "JA-JP": "今すぐ購入",
      "KO-KR": "지금 구매", "NB-NO": "Kjøp nå", "NL-BE": "Nu kopen", "NL-NL": "Nu kopen",
      "PL-PL": "Kup teraz", "PT-BR": "Comprar agora", "PT-PT": "Comprar agora", "RU-RU": "Купить сейчас",
      "SK-SK": "Kúpiť teraz", "SV-SE": "Köp nu", "TH-TH": "ซื้อตอนนี้", "TR-TR": "Şimdi satın al",
      "ZH-CN": "立即购买", "ZH-HK": "立即購買", "ZH-TW": "立即購買"
    }
  },
  'pre-order-now': {
    "name": "Pre-order Now",
    "description": "Pre-order messaging",
    "locales": {
      "AR-AE": "احجز مسبقًا الآن", "AR-BH": "احجز مسبقًا الآن", "AR-DZ": "احجز مسبقًا الآن", "AR-EG": "احجز مسبقًا الآن",
      "AR-KW": "احجز مسبقًا الآن", "AR-LY": "احجز مسبقًا الآن", "AR-MA": "احجز مسبقًا الآن", "AR-OM": "احجز مسبقًا الآن",
      "AR-QA": "احجز مسبقًا الآن", "AR-SA": "احجز مسبقًا الآن", "AR-TN": "احجز مسبقًا الآن",
      "CA-ES": "Reserva ara", "CS-CZ": "Předobjednat nyní", "DA-DK": "Forudbestil nu", "DE-AT": "Jetzt vorbestellen", "DE-CH": "Jetzt vorbestellen",
      "DE-DE": "Jetzt vorbestellen", "DE-LI": "Jetzt vorbestellen", "DE-LU": "Jetzt vorbestellen", "EL-GR": "Προπαραγγελία τώρα",
      "EN-AE": "Pre-order now", "EN-AL": "Pre-order now", "EN-AU": "Pre-order now", "EN-BA": "Pre-order now", "EN-BG": "Pre-order now",
      "EN-BH": "Pre-order now", "EN-CA": "Pre-order now", "EN-CY": "Pre-order now", "EN-CZ": "Pre-order now", "EN-DZ": "Pre-order now",
      "EN-EE": "Pre-order now", "EN-EG": "Pre-order now", "EN-GB": "Pre-order now", "EN-GE": "Pre-order now", "EN-GR": "Pre-order now",
      "EN-HK": "Pre-order now", "EN-HR": "Pre-order now", "EN-HU": "Pre-order now", "EN-IE": "Pre-order now", "EN-IL": "Pre-order now",
      "EN-IN": "Pre-order now", "EN-IS": "Pre-order now", "EN-KW": "Pre-order now", "EN-LI": "Pre-order now", "EN-LT": "Pre-order now",
      "EN-LU": "Pre-order now", "EN-LV": "Pre-order now", "EN-MA": "Pre-order now", "EN-MT": "Pre-order now", "EN-MY": "Pre-order now",
      "EN-NZ": "Pre-order now", "EN-OM": "Pre-order now", "EN-PH": "Pre-order now", "EN-PL": "Pre-order now", "EN-QA": "Pre-order now",
      "EN-RO": "Pre-order now", "EN-SA": "Pre-order now", "EN-SG": "Pre-order now", "EN-SI": "Pre-order now", "EN-SK": "Pre-order now",
      "EN-TH": "Pre-order now", "EN-TN": "Pre-order now", "EN-TW": "Pre-order now", "EN-US": "Pre-order now", "EN-ZA": "Pre-order now",
      "ES-AR": "Reservar ahora", "ES-BO": "Reservar ahora", "ES-CL": "Reservar ahora", "ES-CO": "Reservar ahora", "ES-CR": "Reservar ahora",
      "ES-DO": "Reservar ahora", "ES-EC": "Reservar ahora", "ES-ES": "Reservar ahora", "ES-GT": "Reservar ahora", "ES-HN": "Reservar ahora",
      "ES-MX": "Reservar ahora", "ES-NI": "Reservar ahora", "ES-PA": "Reservar ahora", "ES-PE": "Reservar ahora", "ES-PR": "Reservar ahora",
      "ES-PY": "Reservar ahora", "ES-SV": "Reservar ahora", "ES-UY": "Reservar ahora", "ES-VE": "Reservar ahora",
      "FI-FI": "Ennakkotilaa nyt", "FR-BE": "Précommander maintenant", "FR-CA": "Précommander maintenant", "FR-CH": "Précommander maintenant",
      "FR-FR": "Précommander maintenant", "FR-LU": "Précommander maintenant", "FR-MC": "Précommander maintenant", "HE-IL": "הזמן מראש עכשיו",
      "HU-HU": "Előrendelés most", "IT-CH": "Preordina ora", "IT-IT": "Preordina ora", "JA-JP": "今すぐ予約注文",
      "KO-KR": "지금 사전 주문", "NB-NO": "Forhåndsbestill nå", "NL-BE": "Nu voorbestellen", "NL-NL": "Nu voorbestellen",
      "PL-PL": "Zamów z wyprzedzeniem", "PT-BR": "Pré-encomende agora", "PT-PT": "Pré-encomendar agora", "RU-RU": "Предзаказать сейчас",
      "SK-SK": "Predobjednať teraz", "SV-SE": "Förbeställ nu", "TH-TH": "สั่งจองล่วงหน้าตอนนี้", "TR-TR": "Şimdi ön sipariş ver",
      "ZH-CN": "立即预购", "ZH-HK": "立即預購", "ZH-TW": "立即預購"
    }
  }
};

// Initialize preset data (no async loading needed)
function loadPresetData() {
  console.log('DEBUG: Using embedded preset data for local tool usage');
  console.log('DEBUG: Available presets:', Object.keys(presetData));
  populatePresetDropdowns();
}

// Populate all preset dropdowns with available options
function populatePresetDropdowns() {
  const dropdowns = ['titlePresetSelect', 'subtitlePresetSelect', 'narratorPresetSelect'];

  const presetKeys = presetData ? Object.keys(presetData) : [];
  console.log('PopulatePresets: dropdowns', dropdowns, 'preset keys', presetKeys);

  dropdowns.forEach(dropdownId => {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) {
      console.warn('PopulatePresets: missing select', dropdownId);
      return;
    }

    // Clear existing options
    dropdown.innerHTML = '<option value="">Select preset...</option>';

    // Add options
    presetKeys.forEach(presetKey => {
      const preset = presetData[presetKey];
      if (!preset || !preset.name) return;
      const option = document.createElement('option');
      option.value = presetKey;
      option.textContent = preset.name;
      dropdown.appendChild(option);
    });

    dropdown.setAttribute('data-presets-populated', String(dropdown.options.length));
    console.log(`PopulatePresets: ${dropdownId} options=`, dropdown.options.length);
  });

  // Retry shortly if any remains at only the placeholder
  const needsRetry = dropdowns.some(id => {
    const dd = document.getElementById(id);
    return dd && dd.options && dd.options.length <= 1;
  });
  if (needsRetry) {
    setTimeout(() => {
      console.log('PopulatePresets: retrying populate');
      dropdowns.forEach(id => {
        const dd = document.getElementById(id);
        if (!dd) return;
        // Only retry ones still empty
        if (dd.options.length <= 1) {
          // Repopulate
          dd.innerHTML = '<option value="">Select preset...</option>';
          (presetData ? Object.keys(presetData) : []).forEach(k => {
            const p = presetData[k];
            if (!p || !p.name) return;
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = p.name;
            dd.appendChild(opt);
          });
          dd.setAttribute('data-presets-populated', String(dd.options.length));
          console.log(`PopulatePresets: retry ${id} options=`, dd.options.length);
        }
      });
    }, 50);
  }
}

// Set the current active locale (called when Live Editor opens for a specific tile)
function setCurrentActiveLocale(locale) {
  currentActiveLocale = locale;
  console.log(`Active locale set to: ${locale}`);
}

// Apply preset to current input field
function applyPresetToField(presetKey, fieldType) {
  const preset = presetData[presetKey];
  if (!preset) {
    console.error(`Preset not found: ${presetKey}`);
    return;
  }
  
  // Auto-Localize is permanent; do not alter per-section mode automatically
  const isAutoLocalizeEnabled = true;
  
  console.log(`DEBUG: Auto-localize enabled: ${isAutoLocalizeEnabled}`);
  console.log(`DEBUG: Available locales in preset:`, Object.keys(preset.locales));
  console.log(`DEBUG: Current CSV data available:`, !!currentCsvData);
  
  // Live Editor preview always shows English text for consistency
  const previewText = preset.locales['EN-US'] || '';
  console.log(`DEBUG: Live Editor preview (always English): "${previewText}"`);
  console.log(`DEBUG: Auto-localize setting: ${isAutoLocalizeEnabled ? 'ON (affects Apply All)' : 'OFF (English only for Apply All)'}`);
  
  // Apply to the appropriate input field
  const inputId = fieldType + 'Input';
  const input = document.getElementById(inputId);
  if (input) {
    input.value = previewText;
    
    // Trigger input event to update character count and preview
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Replaces only the number immediately before the percent sign, preserving locale spacing and phrase
function tfReplacePercentNumber(originalText, newValue) {
  if (typeof originalText !== 'string') return originalText;
  const strValue = String(newValue);
  const regex = /(\d{1,3})([\s\u00A0]?%)/g;
  let lastMatch = null;
  let m;
  while ((m = regex.exec(originalText)) !== null) {
    lastMatch = { i: m.index, len: m[0].length, suffix: m[2] };
  }
  if (!lastMatch) return originalText; // no percent pattern found
  return originalText.slice(0, lastMatch.i) + strValue + lastMatch.suffix + originalText.slice(lastMatch.i + lastMatch.len);
}

// Embedded localized subtitle phrase templates (extensible)
// Note: Keep minimal initial set; extend as needed. Use NBSP (\u00A0) where locales require it.
const SUBTITLE_PHRASE_TEMPLATES = {
  // save_up_to: "Save up to {n}%" and localized variants
  save_up_to: {
    'EN-US': 'Save up to {n}%',
    'EN-GB': 'Save up to {n}%',
    'AR-SA': '\u0648\u0641\u0631 \u062d\u062a\u0649 {n}\u066a',
    'AR-AE': '\u0648\u0641\u0631 \u062d\u062a\u0649 {n}\u066a',
    'DE-DE': 'Spare bis zu\u00A0{n}\u00A0%',
    'FR-FR': '\u00C9conomisez jusqu\'\u00E0 {n}\u00A0%',
    'ES-ES': 'Ahorra hasta un {n}%'
  }
};

// Normalize locale like "de-de" or "de_DE" to canonical "DE-DE"
function normalizeLocaleCode(loc) {
  if (!loc || typeof loc !== 'string') return 'EN-US';
  const cleaned = loc.replace('_', '-').trim();
  const parts = cleaned.split('-');
  if (parts.length === 1) {
    return parts[0].toUpperCase();
  }
  return `${parts[0].toUpperCase()}-${parts[1].toUpperCase()}`;
}

function getSubtitleTemplateForLocale(phraseKey, locale, isAutoLocalizeEnabled) {
  const key = phraseKey || 'save_up_to';
  const bucket = SUBTITLE_PHRASE_TEMPLATES[key] || {};
  if (!isAutoLocalizeEnabled) return bucket['EN-US'] || '';

  const norm = normalizeLocaleCode(locale);
  // 1) Exact match
  if (bucket[norm]) return bucket[norm];
  // 2) Language-wide fallback (e.g., DE-* -> DE-DE, FR-* -> FR-FR, ES-* -> ES-ES, EN-* -> EN-US)
  const lang = norm.split('-')[0];
  const langDefaults = {
    'AR': 'AR-SA',
    'DE': 'DE-DE',
    'FR': 'FR-FR',
    'ES': 'ES-ES',
    'EN': 'EN-US'
  };
  const fallbackKey = langDefaults[lang];
  if (fallbackKey && bucket[fallbackKey]) return bucket[fallbackKey];

  // 3) Any entry matching this language prefix
  const anyMatch = Object.keys(bucket).find(k => k.startsWith(lang + '-'));
  if (anyMatch) return bucket[anyMatch];

  // 4) Default to EN-US
  return bucket['EN-US'] || '';
}

// Compose subtitle from template and numeric percent
function composeSubtitleFromTemplate(locale, percentVal, isAutoLocalizeEnabled, phraseKey) {
  const raw = getSubtitleTemplateForLocale(phraseKey || 'save_up_to', locale, isAutoLocalizeEnabled);
  if (!raw) return '';
  // If template has {n}, replace it; otherwise, fall back to replacing last number before %
  if (raw.includes('{n}')) {
    return raw.replace('{n}', String(percentVal));
  }
  return tfReplacePercentNumber(raw, String(percentVal));
}

// Detect if a template already carries a symbol such as %, Arabic percent, or currency marks
function tfTemplateHasSymbol(tmpl) {
  if (typeof tmpl !== 'string') return false;
  return /[%\u066a$€£¥]/.test(tmpl);
}

// Helper: escape regex special chars
function tfEscapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper: given a composed string and the raw number inserted, remove any symbol adjacent to that number
// and then optionally apply the user's chosen symbol after the number.
function tfNormalizeSymbolAroundNumber(composedStr, rawNumber, chosenSymbol) {
  if (typeof composedStr !== 'string' || !rawNumber) return composedStr;
  const numEsc = tfEscapeRegex(String(rawNumber));
  // Remove symbol directly after the number (e.g., "40%", "40$", space variations)
  const afterSymRe = new RegExp(`(${numEsc})\\s*([%\\u066a$€£¥])`, 'g');
  let out = composedStr.replace(afterSymRe, '$1');
  // Remove symbol directly before the number (edge case)
  const beforeSymRe = new RegExp(`([%\\u066a$€£¥])\\s*(${numEsc})`, 'g');
  out = out.replace(beforeSymRe, '$2');
  // Apply chosen symbol if requested
  if (chosenSymbol && chosenSymbol !== 'none') {
    const firstNumRe = new RegExp(numEsc);
    out = out.replace(firstNumRe, `${rawNumber}${chosenSymbol}`);
  }
  return out;
}

function applySubtitleModifiersAll(percentVal) {
  if (!currentCsvData) return;
  const isAutoLocalizeEnabled = true; // Auto-Localize permanently ON
  const phraseDropdown = document.getElementById('subtitlePhraseSelect');
  const phraseKey = (phraseDropdown && phraseDropdown.value) ? phraseDropdown.value : 'save_up_to';
  const symbolSelect = document.getElementById('subtitleSymbolSelect');
  const chosenSymbol = (symbolSelect && symbolSelect.value) ? symbolSelect.value : 'none';

  currentCsvData.forEach(row => {
    const locale = row.Locale || row.locale || 'EN-US';
    const rawNumber = String(percentVal);
    let composed = composeSubtitleFromTemplate(locale, rawNumber, isAutoLocalizeEnabled, phraseKey);
    composed = tfNormalizeSymbolAroundNumber(composed, rawNumber, chosenSymbol);
    row['items/0/subtitle'] = composed;
    console.log(`Subtitle Modifiers: ${locale} -> "${composed}" (autoLocalize=${isAutoLocalizeEnabled}, phrase=${phraseKey}, symbol=${chosenSymbol})`);
  });

  renderLocaleGroups(currentCsvData);
}

function applyGenericModifiersAll(percentVal, phraseKey, fieldKey) {
  if (!currentCsvData) return;
  const isAutoLocalizeEnabled = true; // Auto-Localize permanently ON
  const symbolSelectEl = document.getElementById(fieldKey === 'items/0/title' ? 'titleSymbolSelect' : (fieldKey === 'items/0/narratorText' ? 'narratorSymbolSelect' : 'subtitleSymbolSelect'));
  const chosenSymbol = (symbolSelectEl && symbolSelectEl.value) ? symbolSelectEl.value : 'none';

  currentCsvData.forEach(row => {
    const locale = row.Locale || row.locale || 'EN-US';
    const rawNumber = String(percentVal);
    let composed = composeSubtitleFromTemplate(locale, rawNumber, isAutoLocalizeEnabled, phraseKey);
    composed = tfNormalizeSymbolAroundNumber(composed, rawNumber, chosenSymbol);
    row[fieldKey] = composed;
  });
  renderLocaleGroups(currentCsvData);
}

// Apply preset to ALL locales for a specific field
function applyPresetToAllTiles(presetKey, fieldType) {
  const preset = presetData[presetKey];
  if (!preset || !currentCsvData) return;

  const isAutoLocalizeEnabled = true; // Auto-Localize permanently ON

  let fieldKey;
  if (fieldType === 'title') fieldKey = 'items/0/title';
  else if (fieldType === 'subtitle') fieldKey = 'items/0/subtitle';
  else if (fieldType === 'narrator') fieldKey = 'items/0/narratorText';
  else return;

  let updatedCount = 0;
  currentCsvData.forEach(row => {
    const locale = row.Locale || row.locale || 'EN-US';
    let textToApply = '';
    if (isAutoLocalizeEnabled) {
      textToApply = (preset.locales && (preset.locales[locale] || preset.locales['EN-US'])) || '';
    } else {
      textToApply = (preset.locales && preset.locales['EN-US']) || '';
    }
    row[fieldKey] = textToApply;
    updatedCount++;
  });

  renderLocaleGroups(currentCsvData);
  console.log(`Applied "${preset.name}" preset to ${updatedCount} locale(s) for ${fieldType} (auto-localized=${isAutoLocalizeEnabled})`);
}

// Apply preset to SELECTED locales for a specific field
function applyPresetToSelectedLocales(presetKey, fieldType, selectedLocales) {
  const preset = presetData[presetKey];
  if (!preset || !currentCsvData) return;

  const isAutoLocalizeEnabled = true; // Auto-Localize permanently ON
  const target = new Set(selectedLocales || []);
  if (!target.size) return;

  currentCsvData.forEach(row => {
    const locale = row.Locale || row.locale;
    if (!target.has(locale)) return;

    let textToApply;
    if (isAutoLocalizeEnabled) {
      textToApply = preset.locales[locale] || preset.locales['EN-US'] || '';
    } else {
      textToApply = preset.locales['EN-US'] || '';
    }

    let fieldKey;
    if (fieldType === 'title') fieldKey = 'items/0/title';
    else if (fieldType === 'subtitle') fieldKey = 'items/0/subtitle';
    else if (fieldType === 'narrator') fieldKey = 'items/0/narratorText';

    row[fieldKey] = textToApply;
  });

  renderLocaleGroups(currentCsvData);
  const mode = 'auto-localized';
  console.log(`Applied "${preset.name}" preset to ${target.size} selected locale(s) for ${fieldType} (${mode})`);
}

// Setup preset dropdown event listeners
function setupPresetControls() {
  // Dropdown change handlers
  const dropdowns = [
    { id: 'titlePresetSelect', field: 'title' },
    { id: 'subtitlePresetSelect', field: 'subtitle' },
    { id: 'narratorPresetSelect', field: 'narrator' }
  ];
  
  dropdowns.forEach(({ id, field }) => {
    const dropdown = document.getElementById(id);
    const applyBtn = document.getElementById(field + 'ApplyAllBtn');
    
    if (dropdown) {
      dropdown.addEventListener('change', function() {
        const presetKey = this.value;
        
        // Enable/disable apply button
        if (applyBtn) {
          applyBtn.disabled = !presetKey;
        }
        
        // Apply to current field if preset selected
        if (presetKey) {
          applyPresetToField(presetKey, field);
        }
      });
    }
    
    // Apply All button handlers
    if (applyBtn) {
      applyBtn.addEventListener('click', function() {
        const dropdown = document.getElementById(id);
        const presetKey = dropdown ? dropdown.value : '';
        
        if (presetKey) {
          const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
          if (totalLocales === 0) {
            const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
            if (window.showModal) {
              window.showModal(msg, { confirmText: 'OK' });
            } else {
              if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); }
            }
            return;
          }
          if (window.showModal) {
            window.showModal('', {
              title: 'Confirm Apply',
              content: `
                <p class="modal-message">Apply "${presetData[presetKey].name}" preset to all ${totalLocales} locale(s)?</p>
              `,
              confirmText: 'Apply to All',
              cancelText: 'Cancel',
              onConfirm: function() { applyPresetToAllTiles(presetKey, field); }
            });
          } else {
            applyPresetToAllTiles(presetKey, field);
          }
        }
      });
    }

    // Apply to Selected button handlers (open Locale Picker)
    const applySelectedBtn = document.getElementById(field + 'ApplySelectedBtn');
    if (applySelectedBtn) {
      applySelectedBtn.addEventListener('click', function() {
        const dropdown = document.getElementById(id);
        const presetKey = dropdown ? dropdown.value : '';
        if (!presetKey) return;
        const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
        if (totalLocales === 0) {
          const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
          if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); } else { alert(msg); }
          return;
        }
        const pre = (typeof window.getActiveLocalesForPreview === 'function') ? (window.getActiveLocalesForPreview() || []) : [];
        if (!window.TileForgeLocalesUI || typeof window.TileForgeLocalesUI.open !== 'function') {
          if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Locale Picker UI not loaded.', 'warning'); } else { alert('Locale Picker UI not loaded.'); }
          return;
        }
        window.TileForgeLocalesUI.open(function(selectedLocales){
          if (Array.isArray(selectedLocales) && selectedLocales.length) {
            applyPresetToSelectedLocales(presetKey, field, selectedLocales);
          }
        }, pre);
      });
    }
  });
}

function setupSubtitleModifiersControls() {
  const applyAllBtn = document.getElementById('subtitleModifiersApplyAllBtn');
  const applySelectedBtn = document.getElementById('subtitleModifiersApplySelectedBtn');
  const percentInput = document.getElementById('subtitlePercentInput');
  const phraseDropdown = document.getElementById('subtitlePhraseSelect');
  const symbolSelect = document.getElementById('subtitleSymbolSelect');

  function getModifierValue() {
    let val = (percentInput && typeof percentInput.value === 'string') ? percentInput.value.trim() : '';
    if (val === '') return null;
    // Normalize: if template already includes a % after {n}, avoid double % by stripping trailing % from input
    if (val.endsWith('%')) val = val.slice(0, -1).trim();
    return val;
  }

  if (applyAllBtn) {
    applyAllBtn.addEventListener('click', function() {
      const modVal = getModifierValue();
      if (modVal === null) {
        if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Enter a value to insert (e.g., 40 or “forty”).', 'info'); } else { alert('Enter a value to insert (e.g., 40 or “forty”).'); }
        return;
      }
      const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
      if (totalLocales === 0) {
        const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
        if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); } else { if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); } }
        return;
      }
      if (window.showModal) {
        window.showModal('', {
          title: 'Confirm Apply',
          content: `
            <p class="modal-message">Apply Subtitle Modifiers to all ${totalLocales} locale(s)?</p>
          `,
          confirmText: 'Apply to All',
          cancelText: 'Cancel',
          onConfirm: function() { applySubtitleModifiersAll(modVal); }
        });
      } else {
        applySubtitleModifiersAll(modVal);
      }
    });
  }

  if (applySelectedBtn) {
    applySelectedBtn.addEventListener('click', function() {
      const modVal = getModifierValue();
      if (modVal === null) {
        if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Enter a value to insert (e.g., 40 or “forty”).', 'info'); } else { alert('Enter a value to insert (e.g., 40 or “forty”).'); }
        return;
      }
      const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
      if (totalLocales === 0) {
        const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
        if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); } else { if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); } }
        return;
      }
      const pre = (typeof window.getActiveLocalesForPreview === 'function') ? (window.getActiveLocalesForPreview() || []) : [];
      if (!window.TileForgeLocalesUI || typeof window.TileForgeLocalesUI.open !== 'function') {
        if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Locale Picker UI not loaded.', 'warning'); } else { alert('Locale Picker UI not loaded.'); }
        return;
      }
      window.TileForgeLocalesUI.open(function(selectedLocales){
        if (Array.isArray(selectedLocales) && selectedLocales.length) {
          applySubtitleModifiersSelected(modVal, selectedLocales);
        }
      }, pre);
    });
  }

  // Autofill the target input (Title or Narrator) when a modifier preset is selected
  // Uses EN-US preview text composed from the selected phrase + current percent + optional symbol
  // Local helper to compose and write the subtitle input based on current controls
  function updateSubtitlePreviewFromModifiers() {
    const subtitleInput = document.getElementById('subtitleInput');
    if (!subtitleInput || !phraseDropdown) return;
    const presetKey = phraseDropdown.value;
    // If no phrase selected, clear field
    if (!presetKey) {
      subtitleInput.value = '';
      subtitleInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Pull current percent modifier (strip trailing % if user typed it)
    let insertVal = (percentInput && typeof percentInput.value === 'string') ? percentInput.value.trim() : '';
    if (insertVal.endsWith('%')) insertVal = insertVal.slice(0, -1).trim();
    // If no number yet, show phrase-only (remove {n} and any adjacent symbol/spaces)
    if (!insertVal) {
      let phraseOnly = getSubtitleTemplateForLocale(presetKey, 'EN-US', false) || '';
      phraseOnly = phraseOnly.replace(/\s*\{n\}\s*([%\u066a$€£¥])?\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
      subtitleInput.value = phraseOnly;
      subtitleInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const chosenSymbol = (symbolSelect && symbolSelect.value) ? symbolSelect.value : 'none';
    let composed = composeSubtitleFromTemplate('EN-US', String(insertVal), false, presetKey);
    composed = tfNormalizeSymbolAroundNumber(composed, String(insertVal), chosenSymbol);
    subtitleInput.value = composed;
    subtitleInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (phraseDropdown) {
    phraseDropdown.addEventListener('change', updateSubtitlePreviewFromModifiers);
  }
  if (percentInput) {
    percentInput.addEventListener('input', updateSubtitlePreviewFromModifiers);
  }
  if (symbolSelect) {
    symbolSelect.addEventListener('change', updateSubtitlePreviewFromModifiers);
  }
}

function applySubtitleModifiersSelected(percentVal, selectedLocales) {
  if (!currentCsvData || !Array.isArray(selectedLocales) || !selectedLocales.length) return;
  const isAutoLocalizeEnabled = true; // Auto-Localize permanently ON
  const target = new Set(selectedLocales);
  const phraseDropdown = document.getElementById('subtitlePhraseSelect');
  const phraseKey = (phraseDropdown && phraseDropdown.value) ? phraseDropdown.value : 'save_up_to';
  const symbolSelect = document.getElementById('subtitleSymbolSelect');
  const chosenSymbol = (symbolSelect && symbolSelect.value) ? symbolSelect.value : 'none';

  currentCsvData.forEach(row => {
    const locale = row.Locale || row.locale || 'EN-US';
    if (!target.has(locale)) return;
    const rawNumber = String(percentVal);
    let composed = composeSubtitleFromTemplate(locale, rawNumber, isAutoLocalizeEnabled, phraseKey);
    composed = tfNormalizeSymbolAroundNumber(composed, rawNumber, chosenSymbol);
    row['items/0/subtitle'] = composed;
    console.log(`Subtitle Modifiers (Selected): ${locale} -> "${composed}" (autoLocalize=${isAutoLocalizeEnabled}, phrase=${phraseKey}, symbol=${chosenSymbol})`);
  });

  renderLocaleGroups(currentCsvData);
}

function setupGenericModifiersControls({ phraseId, percentId, symbolId, applyAllId, applySelectedId, inputId, fieldKey }) {
  const phraseDropdown = document.getElementById(phraseId);
  const percentInput = document.getElementById(percentId);
  const symbolSelect = document.getElementById(symbolId);
  const applyAllBtn = document.getElementById(applyAllId);
  const applySelectedBtn = document.getElementById(applySelectedId);

  function numberFromInput() {
    let v = (percentInput && typeof percentInput.value === 'string') ? percentInput.value.trim() : '';
    if (v === '') return null;
    // Normalize: if template already includes a % after {n}, avoid double % by stripping trailing % from input
    if (v.endsWith('%')) v = v.slice(0, -1).trim();
    return v;
  }

  if (applyAllBtn) {
    applyAllBtn.addEventListener('click', function() {
      const modVal = numberFromInput();
      if (modVal === null) {
        if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Enter a value to insert (e.g., 40 or “forty”).', 'info'); } else { alert('Enter a value to insert (e.g., 40 or “forty”).'); }
        return;
      }
      const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
      if (totalLocales === 0) {
        const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
        if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); } else { if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); } }
        return;
      }
      if (window.showModal) {
        window.showModal('', {
          title: 'Confirm Apply',
          content: `
            <p class="modal-message">Apply ${fieldKey === 'items/0/title' ? 'Title' : fieldKey === 'items/0/narratorText' ? 'Narrator' : 'Subtitle'} Modifiers to all ${totalLocales} locale(s)?</p>
          `,
          confirmText: 'Apply to All',
          cancelText: 'Cancel',
          onConfirm: function() { applyGenericModifiersAll(modVal, phraseDropdown.value, fieldKey); }
        });
      } else {
        applyGenericModifiersAll(modVal, phraseDropdown.value, fieldKey);
      }
    });
  }

  if (applySelectedBtn) {
    applySelectedBtn.addEventListener('click', function() {
      const modVal = numberFromInput();
      if (modVal === null) {
        if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Enter a value to insert (e.g., 40 or “forty”).', 'info'); } else { alert('Enter a value to insert (e.g., 40 or “forty”).'); }
        return;
      }
      const totalLocales = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
      if (totalLocales === 0) {
        const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
        if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); }
        else if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); }
        else { alert(msg); }
        return;
      }
      const pre = (typeof window.getActiveLocalesForPreview === 'function') ? (window.getActiveLocalesForPreview() || []) : [];
      if (!window.TileForgeLocalesUI || typeof window.TileForgeLocalesUI.open !== 'function') {
        if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Locale Picker UI not loaded.', 'warning'); } else { alert('Locale Picker UI not loaded.'); }
        return;
      }
      window.TileForgeLocalesUI.open(function(selectedLocales){
        if (Array.isArray(selectedLocales) && selectedLocales.length) {
          applyGenericModifiersSelected(modVal, selectedLocales, phraseDropdown.value, fieldKey);
        }
      }, pre);
    });
  }

  // Autofill the target input (Title or Narrator) when a modifier preset is selected
  // Uses EN-US preview text composed from the selected phrase + current percent + optional symbol
  // Local helper to compose and write the subtitle input based on current controls
  function updatePreviewFromModifiers() {
    const targetInput = document.getElementById(inputId);
    if (!targetInput || !phraseDropdown) return;
    const presetKey = phraseDropdown.value;
    // If no phrase selected, clear field
    if (!presetKey) {
      targetInput.value = '';
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Pull current percent modifier (strip trailing % if user typed it)
    let insertVal = (percentInput && typeof percentInput.value === 'string') ? percentInput.value.trim() : '';
    if (insertVal.endsWith('%')) insertVal = insertVal.slice(0, -1).trim();
    // If no number yet, show phrase-only (remove {n} and any adjacent symbol/spaces)
    if (!insertVal) {
      let phraseOnly = getSubtitleTemplateForLocale(presetKey, 'EN-US', false) || '';
      phraseOnly = phraseOnly.replace(/\s*\{n\}\s*([%\u066a$€£¥])?\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
      targetInput.value = phraseOnly;
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const chosenSymbol = (symbolSelect && symbolSelect.value) ? symbolSelect.value : 'none';
    let composed = composeSubtitleFromTemplate('EN-US', String(insertVal), false, presetKey);
    composed = tfNormalizeSymbolAroundNumber(composed, String(insertVal), chosenSymbol);
    targetInput.value = composed;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (phraseDropdown) {
    phraseDropdown.addEventListener('change', updatePreviewFromModifiers);
  }
  if (percentInput) {
    percentInput.addEventListener('input', updatePreviewFromModifiers);
  }
  if (symbolSelect) {
    symbolSelect.addEventListener('change', updatePreviewFromModifiers);
  }
}

function applyGenericModifiersAll(percentVal, phraseKey, fieldKey) {
  if (!currentCsvData) return;
  const isAutoLocalizeEnabled = true; // Auto-Localize permanently ON
  const symbolSelectEl = document.getElementById(fieldKey === 'items/0/title' ? 'titleSymbolSelect' : (fieldKey === 'items/0/narratorText' ? 'narratorSymbolSelect' : 'subtitleSymbolSelect'));
  const chosenSymbol = (symbolSelectEl && symbolSelectEl.value) ? symbolSelectEl.value : 'none';

  currentCsvData.forEach(row => {
    const locale = row.Locale || row.locale || 'EN-US';
    const rawNumber = String(percentVal);
    let composed = composeSubtitleFromTemplate(locale, rawNumber, isAutoLocalizeEnabled, phraseKey);
    composed = tfNormalizeSymbolAroundNumber(composed, rawNumber, chosenSymbol);
    row[fieldKey] = composed;
  });
  renderLocaleGroups(currentCsvData);
}

function applyGenericModifiersSelected(percentVal, selectedLocales, phraseKey, fieldKey) {
  if (!currentCsvData || !Array.isArray(selectedLocales) || !selectedLocales.length) return;
  const isAutoLocalizeEnabled = true; // Auto-Localize permanently ON
  const target = new Set(selectedLocales);
  const symbolSelectEl = document.getElementById(fieldKey === 'items/0/title' ? 'titleSymbolSelect' : (fieldKey === 'items/0/narratorText' ? 'narratorSymbolSelect' : 'subtitleSymbolSelect'));
  const chosenSymbol = (symbolSelectEl && symbolSelectEl.value) ? symbolSelectEl.value : 'none';

  currentCsvData.forEach(row => {
    const locale = row.Locale || row.locale || 'EN-US';
    if (!target.has(locale)) return;
    const rawNumber = String(percentVal);
    let composed = composeSubtitleFromTemplate(locale, rawNumber, isAutoLocalizeEnabled, phraseKey);
    composed = tfNormalizeSymbolAroundNumber(composed, rawNumber, chosenSymbol);
    row[fieldKey] = composed;
  });
  renderLocaleGroups(currentCsvData);
}

// Initialize preset system (robust to late-loading scripts)
function initLiveEditorModules() {
  try {
    loadPresetData();
    setupPresetControls();
    if (typeof setupSubtitleModifiersControls === 'function') {
      setupSubtitleModifiersControls();
    }
    if (typeof setupGenericModifiersControls === 'function') {
      setupGenericModifiersControls({
        field: 'title',
        phraseSelectId: 'titlePhraseSelect',
        valueInputId: 'titlePercentInput',
        symbolSelectId: 'titleSymbolSelect',
        applyAllBtnId: 'titleModifiersApplyAllBtn',
        applySelectedBtnId: 'titleModifiersApplySelectedBtn'
      });
      setupGenericModifiersControls({
        field: 'subtitle',
        phraseSelectId: 'subtitlePhraseSelect',
        valueInputId: 'subtitlePercentInput',
        symbolSelectId: 'subtitleSymbolSelect',
        applyAllBtnId: 'subtitleModifiersApplyAllBtn',
        applySelectedBtnId: 'subtitleModifiersApplySelectedBtn'
      });
      setupGenericModifiersControls({
        field: 'narrator',
        phraseSelectId: 'narratorPhraseSelect',
        valueInputId: 'narratorPercentInput',
        symbolSelectId: 'narratorSymbolSelect',
        applyAllBtnId: 'narratorModifiersApplyAllBtn',
        applySelectedBtnId: 'narratorModifiersApplySelectedBtn'
      });
    }
  } catch (e) {
    console.warn('Live Editor init warning:', e);
  }

  // Safety: if any dropdowns are empty, repopulate
  ensurePresetDropdownsPopulated();
  // Run once more after microtasks in case other scripts alter the DOM
  setTimeout(ensurePresetDropdownsPopulated, 0);
  // Attach focus listeners so user opening the dropdown triggers a re-check
  ['titlePresetSelect','subtitlePresetSelect','narratorPresetSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('focus', ensurePresetDropdownsPopulated, { once: false });
  });

  // Observe Live Editor visibility changes to repopulate when panel is shown
  const panel = document.getElementById('liveEditingPanel');
  if (panel && typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => ensurePresetDropdownsPopulated());
    mo.observe(panel, { attributes: true, attributeFilter: ['style','class'] });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLiveEditorModules);
} else {
  // Document is already parsed; run immediately
  initLiveEditorModules();
}

// Ensure preset dropdowns are populated with options; repopulate if empty
function ensurePresetDropdownsPopulated() {
  try {
    const ids = ['titlePresetSelect','subtitlePresetSelect','narratorPresetSelect'];
    let needsPopulate = false;
    ids.forEach(id => {
      const dd = document.getElementById(id);
      if (dd && dd.options && dd.options.length <= 1) {
        needsPopulate = true;
      }
    });
    if (needsPopulate) {
      populatePresetDropdowns();
    }
  } catch (e) {
    console.warn('ensurePresetDropdownsPopulated warning:', e);
  }
}

// Inline Clear buttons inside inputs
const titleClearBtn = document.getElementById('titleClearBtn');
const subtitleClearBtn = document.getElementById('subtitleClearBtn');
const narratorClearBtn = document.getElementById('narratorClearBtn');

function ensureDataOrWarn() {
  const total = Array.isArray(window.currentCsvData) ? window.currentCsvData.length : 0;
  if (total === 0) {
    const msg = 'No locales detected. Please import a CSV or add locales via the Locale Manager, then retry.';
    if (window.showModal) { window.showModal(msg, { confirmText: 'OK' }); }
    else if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); }
    else { alert(msg); }
    return false;
  }
  return true;
}

function clearFieldEverywhere(fieldType, inputEl) {
  if (!ensureDataOrWarn()) return;
  const label = fieldType === 'title' ? 'Title' : fieldType === 'subtitle' ? 'Subtitle' : 'Narrator';
  if (window.showModal) {
    window.showModal(
      `This will clear the ${label} field for all tiles. Are you sure?`,
      {
        confirmText: 'Clear All',
        cancelText: 'Cancel',
        onConfirm: function() {
          // Apply empty text across all locales
          applyManualTextToAllTiles('', fieldType);
          // Clear local input and counters/preview
          if (inputEl) inputEl.value = '';
          if (fieldType === 'title' && titleCharCount) {
            titleCharCount.textContent = '0';
            const el = titleCharCount.parentElement; if (el) el.className = 'char-count';
            if (previewTitle) previewTitle.textContent = '';
          }
          if (fieldType === 'subtitle' && subtitleCharCount) {
            subtitleCharCount.textContent = '0';
            const el = subtitleCharCount.parentElement; if (el) el.className = 'char-count';
            if (previewSubtitle) { previewSubtitle.textContent = ''; previewSubtitle.classList.add('hidden'); }
          }
          if (fieldType === 'narrator' && narratorCharCount) {
            narratorCharCount.textContent = '0';
            const el = narratorCharCount.parentElement; if (el) el.className = 'char-count';
          }
          updatePreviewTileStatus();
          updateLiveAnalytics();
        }
      }
    );
  } else {
    applyManualTextToAllTiles('', fieldType);
    if (inputEl) inputEl.value = '';
    updatePreviewTileStatus();
    updateLiveAnalytics();
  }
}

if (titleClearBtn) {
  titleClearBtn.addEventListener('click', function() { clearFieldEverywhere('title', titleInput); });
}
if (subtitleClearBtn) {
  subtitleClearBtn.addEventListener('click', function() { clearFieldEverywhere('subtitle', subtitleInput); });
}
if (narratorClearBtn) {
  narratorClearBtn.addEventListener('click', function() { clearFieldEverywhere('narrator', narratorInput); });
}

// Background Image Toggle Function
window.toggleBackgroundImage = function(isEnabled) {
  const previewTile = document.getElementById('previewTile');
  
  if (previewTile && window.currentImageInfo && window.currentImageInfo.imageSrc) {
    if (isEnabled) {
      // Show uploaded image
      previewTile.style.backgroundImage = `url(${window.currentImageInfo.imageSrc})`;
      previewTile.style.backgroundSize = 'cover';
      previewTile.style.backgroundPosition = 'center';
      previewTile.style.backgroundRepeat = 'no-repeat';
    } else {
      // Restore original gradient background
      previewTile.style.backgroundImage = '';
      previewTile.style.backgroundSize = '';
      previewTile.style.backgroundPosition = '';
      previewTile.style.backgroundRepeat = '';
    }
  } else {
    console.log('Toggle failed - previewTile:', !!previewTile, 'currentImageInfo:', !!window.currentImageInfo, 'imageSrc:', !!(window.currentImageInfo && window.currentImageInfo.imageSrc));
  }
};

// --- Helpers for Manual Apply paths (All / Selected) ---
function applyManualTextToAllTiles(textToApply, fieldType) {
  if (!Array.isArray(window.currentCsvData)) return;
  const fieldKey = fieldType === 'title' ? 'items/0/title'
                  : fieldType === 'subtitle' ? 'items/0/subtitle'
                  : 'items/0/narratorText';
  window.currentCsvData.forEach(row => { row[fieldKey] = textToApply; });
  renderLocaleGroups(window.currentCsvData);
}

function applyManualTextToSelectedLocales(textToApply, fieldType, selectedLocales) {
  if (!Array.isArray(window.currentCsvData) || !Array.isArray(selectedLocales)) return;
  const target = new Set(selectedLocales);
  const fieldKey = fieldType === 'title' ? 'items/0/title'
                  : fieldType === 'subtitle' ? 'items/0/subtitle'
                  : 'items/0/narratorText';
  window.currentCsvData.forEach(row => {
    const loc = row.Locale || row.locale;
    if (loc && target.has(loc)) {
      row[fieldKey] = textToApply;
    }
  });
  renderLocaleGroups(window.currentCsvData);
}

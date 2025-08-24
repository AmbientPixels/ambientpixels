// TileForge Toolbar Module
// Handles Save, Clone, and New actions with modal confirmations

(function() {
  // Utility: Show modal confirmation using existing modal system
  function showModalConfirm(message, onConfirm) {
    // Require the custom modal system for confirmations
    if (typeof window.showModal === 'function') {
      window.showModal(message, {
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        onConfirm: onConfirm
      });
    } else {
      // No fallback: show error and do not proceed
      if (window.Modal && typeof Modal.alert === 'function') {
        Modal.alert('Error: TileForge modal system (showModal) is not available. Confirmations require the custom modal.', 'error');
      } else {
        alert('Error: TileForge modal system (showModal) is not available. Confirmations require the custom modal.');
      }
    }
  }

  // Save current state into a Project (via ProjectUI)
  function manualSave(silent) {
    const doSave = function() {
      if (!window.ProjectUI || typeof window.ProjectUI.onSave !== 'function') {
        if (window.Modal && typeof Modal.alert === 'function') {
          Modal.alert('Project UI not available. Cannot save project.', 'error');
        } else {
          alert('Project UI not available. Cannot save project.');
        }
        return;
      }
      try { window.ProjectUI.onSave(); } catch (err) {
        if (window.Modal && typeof Modal.alert === 'function') {
          Modal.alert('Save failed: ' + err.message, 'error');
        } else {
          alert('Save failed: ' + err.message);
        }
      }
    };

    if (silent) { doSave(); return; }
    showModalConfirm('Save current progress to a Project? This will update the current Project or create a new one.', doSave);
  }

  // Clone current item as a new project file (append -clone) with confirmation
  function cloneCurrentState() {
    showModalConfirm('Clone current item into project as a new file (append -clone)?', function() {
      if (window.ProjectUI && typeof window.ProjectUI.onCloneActiveFile === 'function') {
        try {
          window.ProjectUI.onCloneActiveFile();
        } catch (err) {
          if (window.Modal && typeof Modal.alert === 'function') {
            Modal.alert('Clone failed: ' + err.message, 'error');
          } else {
            alert('Clone failed: ' + err.message);
          }
        }
      } else {
        // Fallback: clone in memory only
        if (window.currentCsvData) {
          const cloned = JSON.parse(JSON.stringify(window.currentCsvData));
          window.clonedCsvData = cloned;
          if (typeof window.showToast === 'function') window.showToast('Data cloned in memory!');
        } else {
          if (window.Modal && typeof Modal.alert === 'function') {
            Modal.alert('No data found to clone.', 'warning');
          } else {
            alert('No data found to clone.');
          }
        }
      }
    });
  }

  // New: open project picker, then locale picker, then save into selected project
  function newDataSet() {
    if (window.ProjectUI && typeof window.ProjectUI.onNewWithProjectPicker === 'function') {
      try {
        window.ProjectUI.onNewWithProjectPicker();
      } catch (err) {
        if (window.Modal && typeof Modal.alert === 'function') {
          Modal.alert('New creation failed: ' + err.message, 'error');
        } else {
          alert('New creation failed: ' + err.message);
        }
      }
    } else {
      if (window.Modal && typeof Modal.alert === 'function') {
        Modal.alert('Projects UI not ready. Please open Projects panel first.', 'warning');
      } else {
        alert('Projects UI not ready.');
      }
    }
  }

  // Toolbar button event listeners
  document.addEventListener('DOMContentLoaded', function() {
    var saveBtn = document.getElementById('toolbarSaveBtn');
    var cloneBtn = document.getElementById('toolbarCloneBtn');
    var newBtn = document.getElementById('toolbarNewBtn');
    var newProjectBtn = document.getElementById('toolbarNewProjectBtn');
    var projectsNewBtn = document.getElementById('projectsNewBtn');
    if (saveBtn) saveBtn.addEventListener('click', manualSave);
    if (cloneBtn) cloneBtn.addEventListener('click', cloneCurrentState);
    if (newBtn) newBtn.addEventListener('click', newDataSet);
    if (projectsNewBtn) projectsNewBtn.addEventListener('click', newDataSet); // mirror toolbar New
    if (newProjectBtn) newProjectBtn.addEventListener('click', function() {
      if (window.ProjectUI && typeof window.ProjectUI.onNew === 'function') {
        try { window.ProjectUI.onNew(); } catch (err) {
          if (window.Modal && typeof Modal.alert === 'function') Modal.alert('New Project failed: ' + err.message, 'error');
          else alert('New Project failed: ' + err.message);
        }
      } else {
        if (window.Modal && typeof Modal.alert === 'function') Modal.alert('Projects UI not ready. Please open Projects panel first.', 'warning');
        else alert('Projects UI not ready.');
      }
    });
    var exportBtn = document.getElementById('toolbarExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', function() {
      if (typeof window.exportToCSV === 'function') {
        window.exportToCSV();
      } else {
        if (window.Modal && typeof Modal.alert === 'function') {
          Modal.alert('Export function not available.', 'error');
        } else {
          alert('Export function not available.');
        }
      }
    });
    // Bind export for Localized Previews status bar button
    var localizedExportBtn = document.getElementById('localizedExportBtn');
    if (localizedExportBtn) localizedExportBtn.addEventListener('click', function() {
      if (typeof window.exportToCSV === 'function') {
        window.exportToCSV();
      } else {
        if (window.Modal && typeof Modal.alert === 'function') {
          Modal.alert('Export function not available.', 'error');
        } else {
          alert('Export function not available.');
        }
      }
    });
    // Manage Locales (toolbar) -> central flow in main.js
    var toolbarManageLocalesBtn = document.getElementById('toolbarManageLocalesBtn');
    if (toolbarManageLocalesBtn) {
      toolbarManageLocalesBtn.addEventListener('click', function() {
        if (typeof window.openManageLocales === 'function') {
          window.openManageLocales();
        }
      });
    }
    // Locale badge color palette toggle
    var colorToggle = document.getElementById('toggleLocaleColors');
    var badgesSection = document.querySelector('.locale-badges-section');
    var localeColorsState = document.getElementById('localeColorsState');
    var statusColorsState = document.getElementById('statusColorsState');
    var languageDefaultBadge = document.getElementById('languageDefaultBadge');
    var statusDefaultBadge = document.getElementById('statusDefaultBadge');

    function getDefaultPalettePref() {
      try {
        if (typeof currentSettings !== 'undefined' && currentSettings && currentSettings.defaultPillPalette) return currentSettings.defaultPillPalette;
        if (window && window.currentSettings && window.currentSettings.defaultPillPalette) return window.currentSettings.defaultPillPalette;
      } catch (_) {}
      return 'language';
    }

    function setSetting(key, value) {
      try {
        if (typeof currentSettings !== 'undefined' && currentSettings) {
          currentSettings[key] = value;
          if (typeof saveSettings === 'function') saveSettings();
        } else if (window && window.currentSettings) {
          window.currentSettings[key] = value;
          if (typeof window.saveSettings === 'function') window.saveSettings();
        }
      } catch (_) {}
    }

    function updatePillPaletteUIBits() {
      if (localeColorsState && colorToggle) {
        localeColorsState.textContent = colorToggle.checked ? 'On' : 'Off';
      }
      if (statusColorsState && statusPillToggle) {
        statusColorsState.textContent = statusPillToggle.checked ? 'On' : 'Off';
      }
      var pref = getDefaultPalettePref();
      if (languageDefaultBadge) languageDefaultBadge.hidden = pref !== 'language';
      if (statusDefaultBadge) statusDefaultBadge.hidden = pref !== 'status';
    }

    function enforceDefaultIfNoneActive() {
      var langOn = !!(colorToggle && colorToggle.checked);
      var statusOn = !!(statusPillToggle && statusPillToggle.checked);
      if (langOn || statusOn) { updatePillPaletteUIBits(); return; }
      var pref = getDefaultPalettePref();
      if (pref === 'language') {
        if (colorToggle) {
          colorToggle.checked = true;
          colorToggle.setAttribute('aria-checked', 'true');
        }
        if (badgesSection) {
          badgesSection.classList.add('palette-on');
          badgesSection.classList.remove('status-palette-on');
        }
        if (statusPillToggle) {
          statusPillToggle.checked = false;
          statusPillToggle.setAttribute('aria-checked', 'false');
        }
        setSetting('languagePillColors', true);
        setSetting('statusPillColors', false);
      } else if (pref === 'status') {
        if (statusPillToggle) {
          statusPillToggle.checked = true;
          statusPillToggle.setAttribute('aria-checked', 'true');
        }
        if (badgesSection) {
          badgesSection.classList.add('status-palette-on');
          badgesSection.classList.remove('palette-on');
        }
        if (colorToggle) {
          colorToggle.checked = false;
          colorToggle.setAttribute('aria-checked', 'false');
        }
        setSetting('statusPillColors', true);
        setSetting('languagePillColors', false);
      } else {
        // none: leave both off
      }
      updatePillPaletteUIBits();
    }

    // Initialize from settings (default OFF)
    var prefLang = false;
    try {
      if (typeof currentSettings !== 'undefined' && currentSettings && typeof currentSettings.languagePillColors === 'boolean') {
        prefLang = currentSettings.languagePillColors;
      } else if (window && window.currentSettings && typeof window.currentSettings.languagePillColors === 'boolean') {
        prefLang = window.currentSettings.languagePillColors;
      }
    } catch (e0) { /* no-op */ }

    var initialLang = prefLang || !!colorToggle.checked;
    colorToggle.checked = initialLang;
    badgesSection.classList.toggle('palette-on', initialLang);
    colorToggle.setAttribute('aria-checked', String(initialLang));
    updatePillPaletteUIBits();
    colorToggle.addEventListener('change', function(e) {
      var on = !!e.target.checked;
      badgesSection.classList.toggle('palette-on', on);
      colorToggle.setAttribute('aria-checked', String(on));
      // Mutual exclusivity: if language palette is ON, turn OFF status palette
      if (on) {
        var statusPillToggle2 = document.getElementById('toggleStatusPillColors');
        if (statusPillToggle2) {
          statusPillToggle2.checked = false;
          statusPillToggle2.setAttribute('aria-checked', 'false');
        }
        badgesSection.classList.remove('status-palette-on');
        try {
          if (typeof currentSettings !== 'undefined' && currentSettings) {
            currentSettings.languagePillColors = true;
            currentSettings.statusPillColors = false;
            if (typeof saveSettings === 'function') saveSettings();
          } else if (window && window.currentSettings) {
            window.currentSettings.languagePillColors = true;
            window.currentSettings.statusPillColors = false;
            if (typeof window.saveSettings === 'function') window.saveSettings();
          }
        } catch (e3) { /* ignore */ }
      } else {
        try {
          if (typeof currentSettings !== 'undefined' && currentSettings) {
            currentSettings.languagePillColors = false;
            if (typeof saveSettings === 'function') saveSettings();
          } else if (window && window.currentSettings) {
            window.currentSettings.languagePillColors = false;
            if (typeof window.saveSettings === 'function') window.saveSettings();
          }
        } catch (e4) { /* ignore */ }
        // If both toggles are now off, enforce default preference
        enforceDefaultIfNoneActive();
      }
      updatePillPaletteUIBits();
    });

    // Status pill color palette toggle (Clean / Near-limit / Overflow)
    var statusPillToggle = document.getElementById('toggleStatusPillColors');
    if (statusPillToggle && badgesSection) {
      // Initialize from settings (default OFF)
      var pref = false;
      try {
        if (typeof currentSettings !== 'undefined' && currentSettings && typeof currentSettings.statusPillColors === 'boolean') {
          pref = currentSettings.statusPillColors;
        } else if (window && window.currentSettings && typeof window.currentSettings.statusPillColors === 'boolean') {
          pref = window.currentSettings.statusPillColors;
        }
      } catch (e) { /* no-op */ }

      // Apply initial state (settings wins; else checkbox state; default false)
      var initial = pref || !!statusPillToggle.checked;
      statusPillToggle.checked = initial;
      badgesSection.classList.toggle('status-palette-on', initial);
      statusPillToggle.setAttribute('aria-checked', String(initial));

      // Resolve conflict at init: if both classes present, prefer language palette
      if (badgesSection.classList.contains('palette-on') && badgesSection.classList.contains('status-palette-on')) {
        badgesSection.classList.remove('status-palette-on');
        statusPillToggle.checked = false;
        statusPillToggle.setAttribute('aria-checked', 'false');
        try {
          if (typeof currentSettings !== 'undefined' && currentSettings) {
            currentSettings.statusPillColors = false;
            if (typeof saveSettings === 'function') saveSettings();
          } else if (window && window.currentSettings) {
            window.currentSettings.statusPillColors = false;
            if (typeof window.saveSettings === 'function') window.saveSettings();
          }
        } catch (e5) { /* ignore */ }
      }

      // If both start off, enforce default preference
      enforceDefaultIfNoneActive();
      updatePillPaletteUIBits();

      statusPillToggle.addEventListener('change', function(e) {
        var enabled = !!e.target.checked;
        badgesSection.classList.toggle('status-palette-on', enabled);
        statusPillToggle.setAttribute('aria-checked', String(enabled));
        // Persist back to settings if available
        try {
          if (typeof currentSettings !== 'undefined' && currentSettings) {
            currentSettings.statusPillColors = enabled;
            if (typeof saveSettings === 'function') saveSettings();
          } else if (window && window.currentSettings) {
            window.currentSettings.statusPillColors = enabled;
            if (typeof window.saveSettings === 'function') window.saveSettings();
          }
        } catch (e2) { /* ignore */ }

        // Mutual exclusivity: if status palette is ON, turn OFF language palette
        if (enabled) {
          var colorToggle2 = document.getElementById('toggleLocaleColors');
          if (colorToggle2) {
            colorToggle2.checked = false;
            colorToggle2.setAttribute('aria-checked', 'false');
          }
          badgesSection.classList.remove('palette-on');
          try {
            if (typeof currentSettings !== 'undefined' && currentSettings) {
              currentSettings.languagePillColors = false;
              if (typeof saveSettings === 'function') saveSettings();
            } else if (window && window.currentSettings) {
              window.currentSettings.languagePillColors = false;
              if (typeof window.saveSettings === 'function') window.saveSettings();
            }
          } catch (e6) { /* ignore */ }
        } else {
          // If both toggles are now off, enforce default preference
          enforceDefaultIfNoneActive();
        }
        updatePillPaletteUIBits();
      });
    }
    // updated by Cascade
    // Expose a small hook for Settings to refresh default badge labeling
    window.updatePillPaletteDefaultUI = updatePillPaletteUIBits;
  });

  // Expose for integration with export flow
  window.manualSave = manualSave;
})();

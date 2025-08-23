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

  // New (placeholder, with modal)
  function newDataSet() {
    showModalConfirm('Start a new data set? (This is a placeholder; action not implemented yet.)', function() {
      if (typeof window.showToast === 'function') window.showToast('New data set placeholder!');
      console.log('TileForge: New data set action (placeholder)');
    });
  }

  // Toolbar button event listeners
  document.addEventListener('DOMContentLoaded', function() {
    var saveBtn = document.getElementById('toolbarSaveBtn');
    var cloneBtn = document.getElementById('toolbarCloneBtn');
    var newBtn = document.getElementById('toolbarNewBtn');
    if (saveBtn) saveBtn.addEventListener('click', manualSave);
    if (cloneBtn) cloneBtn.addEventListener('click', cloneCurrentState);
    if (newBtn) newBtn.addEventListener('click', newDataSet);
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
    // updated by Cascade
  });

  // Expose for integration with export flow
  window.manualSave = manualSave;
})();

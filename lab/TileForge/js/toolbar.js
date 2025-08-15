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
      alert('Error: TileForge modal system (showModal) is not available. Confirmations require the custom modal.');
    }
  }

  // Save current tile/form data to localStorage
  function manualSave() {
    showModalConfirm('Save current progress? This will overwrite any previous save.', function() {
      try {
        // Save currentCsvData if available, else fallback to a global state object
        if (window.currentCsvData) {
          localStorage.setItem('tileforge-data', JSON.stringify(window.currentCsvData));
          console.log('TileForge: Data saved to localStorage.');
          if (typeof window.showToast === 'function') window.showToast('Data saved!');
        } else {
          alert('No data found to save.');
        }
      } catch (err) {
        alert('Save failed: ' + err.message);
      }
    });
  }

  // Clone current state (deep copy, with modal)
  function cloneCurrentState() {
    showModalConfirm('Clone current data set? This will create a copy in memory.', function() {
      if (window.currentCsvData) {
        // Deep clone
        const cloned = JSON.parse(JSON.stringify(window.currentCsvData));
        window.clonedCsvData = cloned;
        if (typeof window.showToast === 'function') window.showToast('Data cloned in memory!');
        console.log('TileForge: Data cloned to window.clonedCsvData');
      } else {
        alert('No data found to clone.');
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
        alert('Export function not available.');
      }
    });
    // updated by Cascade
  });

  // Expose for integration with export flow
  window.manualSave = manualSave;
})();

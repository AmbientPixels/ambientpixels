  // drag-drop-csv.js
// Handles drag-and-drop for CSV upload in the locale preview area in TileForge

// --- Make drop zones clickable to open file browser ---
(function() {
  // Helper to create or get a hidden file input for CSV/XML/JSON/Images
  function getOrCreateCsvInput() {
    let csvInput = document.getElementById('csvInput');
    if (!csvInput) {
      csvInput = document.createElement('input');
      csvInput.type = 'file';
      csvInput.id = 'csvInput';
      csvInput.accept = '.csv,.xml,.json,text/csv,application/xml,application/json,image/*';
      csvInput.style.display = 'none';
      document.body.appendChild(csvInput);
    }
    return csvInput;
  }
  // expose globally for other modules/buttons
  window.getOrCreateCsvInput = getOrCreateCsvInput;

  // List of drop zone IDs to make clickable
  const dropZoneIds = [
    'dndCsvZone',
    'emptyDropZone',
    'autoLocalizeDropZone',
    'dndCsvZonePreview'
  ];

  dropZoneIds.forEach(function(zoneId) {
    const zone = document.getElementById(zoneId);
    if (zone) {
      zone.style.cursor = 'pointer';
      zone.addEventListener('click', function(e) {
        // Only trigger if clicking background, not a child button
        if (e.target === zone || e.target.classList.contains('dnd-csv-message')) {
          getOrCreateCsvInput().click();
        }
      });
    }
  });

  // Optionally wire up file input to existing handler if needed
  // (Assume main CSV upload handler is already listening for file changes)

  // Utility: attach CSV/XML/JSON/Image drop events to a zone
  function addCsvXmlDropEvents(zone) {
    if (!zone) return;
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files && files.length) {
        const file = files[0];
        const name = (file.name || '').toLowerCase();
        try {
          if (file.type === 'text/csv' || name.endsWith('.csv')) {
            if (typeof handleCsvUpload === 'function') handleCsvUpload(file);
          } else if (name.endsWith('.xml') || file.type === 'application/xml' || file.type === 'text/xml') {
            if (typeof handleXmlUpload === 'function') handleXmlUpload(file);
            else { /* XML support pending */ }
          } else if (name.endsWith('.json') || file.type === 'application/json') {
            const text = await file.text();
            try {
              const data = JSON.parse(text);
              if (Array.isArray(data)) {
                window.currentCsvData = data;
                if (typeof window.renderLocaleGroups === 'function') window.renderLocaleGroups(data);
                if (typeof updateFileInfo === 'function') updateFileInfo('JSON', file.name, data.length || 0);
                if (typeof updateLocalizedExportState === 'function') updateLocalizedExportState(true);
              }
            } catch (_) { /* ignore invalid JSON */ }
          } else if (file.type && file.type.startsWith('image/')) {
            if (typeof handleImageUpload === 'function') handleImageUpload(file);
          }
        } catch (_) { /* swallow errors to keep UX clean */ }
      }
    });
  }

  // Legacy helper: triggers input change for CSV
  function addCsvDropEvents(zone) {
    if (!zone) return;
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files && files.length) {
        const file = files[0];
        if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
          const csvInput = (typeof window.getOrCreateCsvInput === 'function') ? window.getOrCreateCsvInput() : null;
          if (csvInput) {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            csvInput.files = dataTransfer.files;
            csvInput.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (typeof handleCsvUpload === 'function') {
            handleCsvUpload(file);
          }
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const dndCsvZone = document.getElementById('dndCsvZone');
    const dndCsvZonePreview = document.getElementById('dndCsvZonePreview');
    const localeGroups = document.getElementById('localeGroups');

    // Always allow emptyDropZone logic to run
    if (!localeGroups) return;

    addCsvXmlDropEvents(dndCsvZone);
    addCsvXmlDropEvents(dndCsvZonePreview);

    function checkShowCsvZones() {
      var emptyDropZone = document.getElementById('emptyDropZone');
      if (emptyDropZone) {
        // Visibility is handled by CSS; do not force styles here
      }
    }

    var emptyDropZone = document.getElementById('emptyDropZone');
    if (emptyDropZone) addCsvXmlDropEvents(emptyDropZone);
    var autoLocalizeDropZone = document.getElementById('autoLocalizeDropZone');
    if (autoLocalizeDropZone) addCsvXmlDropEvents(autoLocalizeDropZone);

    checkShowCsvZones();

    if (typeof window.processCsvData === 'function') {
      const origProcessCsvData = window.processCsvData;
      window.processCsvData = function() {
        origProcessCsvData.apply(this, arguments);
        checkShowCsvZones();
      };
    }

    addCsvDropEvents(dndCsvZone);
    addCsvDropEvents(dndCsvZonePreview);

    const observer = new MutationObserver(checkShowCsvZones);
    observer.observe(localeGroups, { childList: true });

    // --- Live Editor: bind image drag-and-drop + click on preview tile --- // updated by Cascade 2025-08-23
    const previewTile = document.getElementById('previewTile');
    const dndImageMessage = document.getElementById('dndImageMessage');
    const imgInput = document.getElementById('imgInput');
    if (previewTile) {
      // Click to open image picker
      previewTile.addEventListener('click', function(e) {
        if (!imgInput) return;
        // avoid triggering when clicking buttons inside overlay (none currently)
        imgInput.click();
      });

      function showImgOverlay() {
        previewTile.classList.add('drag-over');
        if (dndImageMessage) dndImageMessage.style.display = 'flex';
      }
      function hideImgOverlay() {
        previewTile.classList.remove('drag-over');
        if (dndImageMessage) dndImageMessage.style.display = 'none';
      }

      previewTile.addEventListener('dragover', function(e) {
        if (!e.dataTransfer) return;
        // only react to file drags
        const types = e.dataTransfer.types || [];
        if ([...types].indexOf('Files') === -1) return;
        e.preventDefault();
        showImgOverlay();
      });
      previewTile.addEventListener('dragleave', function(e) {
        e.preventDefault();
        hideImgOverlay();
      });
      previewTile.addEventListener('drop', function(e) {
        e.preventDefault();
        hideImgOverlay();
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) {
          const file = files[0];
          if (file && file.type && file.type.startsWith('image/')) {
            if (typeof handleImageUpload === 'function') handleImageUpload(file);
          }
        }
      });
    }
  });

  // Expose binding API for dynamically inserted zones
  window.TileForgeDnd = {
    bind(zone) { addCsvXmlDropEvents(zone); },
    bindById(id) { const el = document.getElementById(id); if (el) addCsvXmlDropEvents(el); },
    bindEmptyState() { this.bindById('emptyDropZone'); }
  };
})();

// drag-drop-csv.js
// Handles drag-and-drop for CSV upload in the locale preview area in TileForge

// --- Make drop zones clickable to open file browser ---
(function() {
  // Helper to create or get a hidden file input for CSV/XML
  function getOrCreateCsvInput() {
    let csvInput = document.getElementById('csvInput');
    if (!csvInput) {
      csvInput = document.createElement('input');
      csvInput.type = 'file';
      csvInput.id = 'csvInput';
      csvInput.accept = '.csv,.xml,text/csv,application/xml';
      csvInput.style.display = 'none';
      document.body.appendChild(csvInput);
    }
    return csvInput;
  }

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
})();

document.addEventListener('DOMContentLoaded', function () {
  const dndCsvZone = document.getElementById('dndCsvZone');
  const dndCsvZonePreview = document.getElementById('dndCsvZonePreview');
  const localeGroups = document.getElementById('localeGroups');

  // Always allow emptyDropZone logic to run
  if (!localeGroups) return;

  // Drag/drop event handler for CSV/XML drop zones (calls main upload handlers)
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
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files && files.length) {
        const file = files[0];
        const name = file.name.toLowerCase();
        if (file.type === 'text/csv' || name.endsWith('.csv')) {
          if (typeof handleCsvUpload === 'function') handleCsvUpload(file);
        } else if (name.endsWith('.xml')) {
          if (typeof handleXmlUpload === 'function') handleXmlUpload(file);
          else {/* XML support coming soon - no alert */}
        }
      }
    });
  }

  addCsvXmlDropEvents(dndCsvZone);
  addCsvXmlDropEvents(dndCsvZonePreview);

  // Show dropzones if no CSV loaded (localeGroups is empty)
  function checkShowCsvZones() {
    var emptyDropZone = document.getElementById('emptyDropZone');
    if (emptyDropZone) {
      emptyDropZone.style.display = 'flex'; // Force visible for debug
      console.log('[DEBUG] Forced emptyDropZone visible');
    }
  }

  // Attach drag-and-drop to emptyDropZone and autoLocalizeDropZone
  var emptyDropZone = document.getElementById('emptyDropZone');
  if (emptyDropZone) addCsvXmlDropEvents(emptyDropZone);
  var autoLocalizeDropZone = document.getElementById('autoLocalizeDropZone');
  if (autoLocalizeDropZone) addCsvXmlDropEvents(autoLocalizeDropZone);

  // Always check on DOMContentLoaded
  checkShowCsvZones();

  // Listen for localeGroups updates to hide dropzones after upload
  // Only declare observer once!
  // Patch: also call checkShowCsvZones after a file is loaded (CSV/XML)
  if (typeof window.processCsvData === 'function') {
    const origProcessCsvData = window.processCsvData;
    window.processCsvData = function() {
      origProcessCsvData.apply(this, arguments);
      checkShowCsvZones();
    };
  }
  // Drag/drop event handler for any drop zone
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
          if (csvInput) {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            csvInput.files = dataTransfer.files;
            csvInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } // No alert for non-CSV, allow XML to be handled elsewhere
      }
    });
  }

  addCsvDropEvents(dndCsvZone);
  addCsvDropEvents(dndCsvZonePreview);

  // Listen for localeGroups updates to hide both dropzones after upload
  const observer = new MutationObserver(checkShowCsvZones);
  observer.observe(localeGroups, { childList: true });
});

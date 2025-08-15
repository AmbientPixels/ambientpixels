// drag-drop-csv.js
// Handles drag-and-drop for CSV upload in the locale preview area in TileForge

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
          else alert('XML support coming soon.');
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
        } else {
          alert('Please drop a valid CSV file.');
        }
      }
    });
  }

  addCsvDropEvents(dndCsvZone);
  addCsvDropEvents(dndCsvZonePreview);

  // Listen for localeGroups updates to hide both dropzones after upload
  const observer = new MutationObserver(checkShowCsvZones);
  observer.observe(localeGroups, { childList: true });
});

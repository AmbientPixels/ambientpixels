// TileForge CSV Handling Module
// Handles CSV parsing, data processing, and file operations

// Helper: toggle Localized Preview Export button enabled/disabled
function updateLocalizedExportState(hasData) {
  try {
    const btn = document.getElementById('localizedExportBtn');
    if (!btn) return;
    if (hasData) {
      btn.removeAttribute('disabled');
      btn.title = 'Export to CSV';
    } else {
      btn.setAttribute('disabled', 'disabled');
      btn.title = 'Load CSV data to enable export';
    }
  } catch (e) { /* no-op */ }
}

// Parse CSV data into array of objects
function parseCSV(csvText) {
  // Remove UTF-8 BOM if present
  if (csvText && csvText.charCodeAt(0) === 0xFEFF) {
    csvText = csvText.slice(1);
  }
  // Normalize line endings
  const lines = (csvText || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Simple CSV field cleaner: trim, remove surrounding quotes, unescape doubled quotes
  function cleanField(v) {
    if (v == null) return '';
    let s = String(v).trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
      s = s.slice(1, -1).replace(/""/g, '"');
    }
    return s;
  }

  // If the first line is the dummy W-width line, skip it and use the next line as header
  // Detect delimiter based on the actual header line
  let headerIndex = 0;
  let probeDelimiter = lines[0].includes('\t') ? '\t' : ',';
  const looksLikeDummyHeader = (function(rawLine){
    const tokens = rawLine.split(probeDelimiter).map(t => cleanField(t));
    if (tokens.length < 2) return false;
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (/^locale$/i.test(first) && /^narrator\s*text$/i.test(last)) {
      for (let i = 1; i < tokens.length - 1; i++) if (!/^w+$/i.test(tokens[i])) return false;
      return true;
    }
    return false;
  })(lines[0]);
  if (looksLikeDummyHeader && lines.length >= 2) {
    headerIndex = 1;
  }

  const headerLine = lines[headerIndex];
  const delimiter = headerLine.includes('\t') ? '\t' : ',';

  const headers = headerLine.split(delimiter).map(h => cleanField(h));
  const rows = [];

  // Helper to detect the dummy W-line to ignore
  function isDummyWLine(rawLine) {
    const tokens = rawLine.split(delimiter).map(t => cleanField(t));
    if (tokens.length < 2) return false;
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    // Pattern: Locale, then one or more columns filled with only W's, then Narrator Text
    if (/^locale$/i.test(first) && /^narrator\s*text$/i.test(last)) {
      // Middle tokens should be all W's (any length)
      for (let i = 1; i < tokens.length - 1; i++) {
        if (!/^w+$/i.test(tokens[i])) return false;
      }
      return true;
    }
    return false;
  }

  // Helper to detect the repeated human-readable header row often present after the real header
  const aliasHeaderSets = [
    // Iris duplicate header row
    ['locale', 'title', 'subtitle', 'narrator text'],
    // Mobile Spotlight duplicate header row
    ['locale', 'title', 'description', 'accessibility string']
  ];
  function isAliasHeaderValues(values) {
    if (!values || values.length !== headers.length) return false;
    const norm = values.map(v => String(v).trim().toLowerCase());
    const joined = norm.join('\u0001');
    return aliasHeaderSets.some(set => joined === set.join('\u0001'));
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // Ignore the special width-test line present in exported files
    // updated by Cascade: skip dummy W line to fix locale propagation issues
    if (isDummyWLine(raw)) continue;

    const values = raw.split(delimiter).map(v => cleanField(v));

    // Skip duplicated human-readable header row (e.g., Locale, Title, Subtitle, Narrator Text)
    if (isAliasHeaderValues(values)) continue;

    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    rows.push(row);
  }

  return rows;
}

// Load default CSV data on page initialization
function loadDefaultData() {
  // Attempt to load the default CSV. If it fails, fall back to empty state.
  // updated by Cascade: use sample-data/source-data.csv as the default import
  const defaultPath = './sample-data/source-data.csv'; // updated by Cascade: make path relative to /lab/TileForge/
  // default to disabled until data is confirmed loaded
  updateLocalizedExportState(false);
  if (typeof window.updateManageLocalesState === 'function') { window.updateManageLocalesState(false); }
  try {
    fetch(defaultPath, { cache: 'no-store' })
      .then(resp => {
        if (!resp.ok) throw new Error('Default CSV not found');
        return resp.text();
      })
      .then(text => {
        processCsvData(text, 'source-data.csv');
        updateLocalizedExportState(true);
        if (typeof window.updateManageLocalesState === 'function') { window.updateManageLocalesState(true); }
        if (typeof window.updateApplyButtonsState === 'function') { window.updateApplyButtonsState(true); }
        if (typeof window.updateLiveEditorEnabled === 'function') { window.updateLiveEditorEnabled(true); }
      })
      .catch(() => {
        window.currentCsvData = [];
        renderLocaleGroups([]);
        // Reset Active CSV pill in localized preview status
        try {
          const activeName = document.getElementById('activeCsvName');
          if (activeName) {
            activeName.textContent = '—';
            const pill = activeName.parentElement;
            if (pill && pill.setAttribute) pill.setAttribute('title', 'No active CSV selected');
          }
        } catch (e) { /* no-op */ }
        updateLocalizedExportState(false);
        if (typeof window.updateManageLocalesState === 'function') { window.updateManageLocalesState(false); }
        if (typeof window.updateApplyButtonsState === 'function') { window.updateApplyButtonsState(false); }
        if (typeof window.updateLiveEditorEnabled === 'function') { window.updateLiveEditorEnabled(false); }
      });
  } catch (e) {
    window.currentCsvData = [];
    renderLocaleGroups([]);
    // Reset Active CSV pill in localized preview status
    try {
      const activeName = document.getElementById('activeCsvName');
      if (activeName) {
        activeName.textContent = '—';
        const pill = activeName.parentElement;
        if (pill && pill.setAttribute) pill.setAttribute('title', 'No active CSV selected');
      }
    } catch (err) { /* no-op */ }
    updateLocalizedExportState(false);
    if (typeof window.updateManageLocalesState === 'function') { window.updateManageLocalesState(false); }
    if (typeof window.updateApplyButtonsState === 'function') { window.updateApplyButtonsState(false); }
    if (typeof window.updateLiveEditorEnabled === 'function') { window.updateLiveEditorEnabled(false); }
  }
}

// Handle CSV file upload - restored to original behavior
function handleCsvUpload(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const csvText = e.target.result;
      
      // Process CSV directly without transformation checks
      // Headliner Crafter is now a separate manual action
      processCsvData(csvText, file.name);
      
    } catch (error) {
      console.error('❌ Error reading CSV file:', error);
      /* No alert for failed CSV read */
    }
  };
  reader.readAsText(file);
}

// Process CSV data (extracted for reuse with transformed data)
function processCsvData(csvText, fileName, rowCount = null) {
  try {
    const csvRows = parseCSV(csvText);
    
    if (csvRows.length === 0) {
      /* No alert for invalid CSV file or no data found */
      updateLocalizedExportState(false);
      if (typeof window.updateManageLocalesState === 'function') { window.updateManageLocalesState(false); }
      if (typeof window.updateApplyButtonsState === 'function') { window.updateApplyButtonsState(false); }
      return;
    }
    
    window.currentCsvData = csvRows;
    renderLocaleGroups(csvRows);
    // Notify listeners that CSV data is ready (load-order safe)
    try { document.dispatchEvent(new CustomEvent('tf:csvProcessed', { detail: { rows: csvRows } })); } catch (_) {}
    // Auto-populate Live Editor from imported data (prefer EN-US)
    try { if (typeof window.populateLiveEditorFromCsv === 'function') window.populateLiveEditorFromCsv(csvRows, 'EN-US'); } catch (e) { /* no-op */ }
    
    // Update file info in analytics
    const actualRowCount = rowCount || csvRows.length;
    updateFileInfo('CSV', fileName, actualRowCount);
    
    console.log('📊 CSV data processed successfully:', actualRowCount, 'rows');
    updateLocalizedExportState(true);
    if (typeof window.updateManageLocalesState === 'function') { window.updateManageLocalesState(true); }
    if (typeof window.updateApplyButtonsState === 'function') { window.updateApplyButtonsState(true); }
    // Persist last processed CSV for optional startup restore
    try {
      localStorage.setItem('tileforge-last-csv', csvText || '');
      localStorage.setItem('tileforge-last-csv-name', fileName || 'session.csv');
    } catch (_) {}
    
  } catch (error) {
    console.error('Error parsing CSV:', error);
    /* No alert for error parsing CSV file */
    updateLocalizedExportState(false);
    if (typeof window.updateManageLocalesState === 'function') { window.updateManageLocalesState(false); }
    if (typeof window.updateApplyButtonsState === 'function') { window.updateApplyButtonsState(false); }
  }
}

// Update CSV data when individual tiles are edited
function updateCsvDataForTile(locale, tileElement) {
  if (!window.currentCsvData || !locale) return;
  
  const titleEl = tileElement.querySelector('.tile-title');
  const subtitleEl = tileElement.querySelector('.tile-subtitle');
  
  if (!titleEl || !subtitleEl) return;
  
  const newTitle = titleEl.textContent || '';
  const newSubtitle = subtitleEl.textContent || '';
  
  // Get narrator text from live editor if available
  const narratorInput = document.getElementById('narratorInput');
  const newNarratorText = narratorInput ? narratorInput.value || '' : '';
  
  // Find and update the corresponding CSV row (support Locale/locale casing)
  const row = window.currentCsvData.find(r => (r.Locale || r.locale) === locale);
  if (row) {
    row['items/0/title'] = newTitle;
    row['items/0/subtitle'] = newSubtitle;
    // Add narrator text field (using common CSV column name)
    if (newNarratorText || row['items/0/narratorText'] !== undefined) {
      row['items/0/narratorText'] = newNarratorText;
    }
  }
  
  // Update analytics after a short delay to avoid excessive updates
  clearTimeout(updateCsvDataForTile.timeout);
  updateCsvDataForTile.timeout = setTimeout(() => {
    updateAnalyticsFromCurrentData();
  }, 500);
}

// Update analytics from current CSV data
function updateAnalyticsFromCurrentData() {
  if (!window.currentCsvData) return;
  
  const analytics = { totalLocales: 0, overflowCount: 0, nearLimitCount: 0, cleanCount: 0 };
  const localeGroups = {};
  
  window.currentCsvData.forEach(row => {
    const locale = row.Locale || row.locale || 'unknown';
    const title = row['items/0/title'] || row.Title || row.title || '';
    // Treat Mobile Spotlight `description` as subtitle as well
    const subtitle = row['items/0/subtitle'] || row.Subtitle || row.subtitle || row.description || row.Description || '';
    
    if (!localeGroups[locale]) {
      localeGroups[locale] = true;
      analytics.totalLocales++;
    }
    
    const analysis = analyzeText(title, subtitle);
    if (analysis.status === 'overflow') analytics.overflowCount++;
    else if (analysis.status === 'near-limit') analytics.nearLimitCount++;
    else analytics.cleanCount++;
  });
  
  updateAnalytics(analytics);
}

// Export current CSV data to downloadable file
function exportToCSV() {
  // Skip pre-export save to avoid any prompts during export
  if (!window.currentCsvData || window.currentCsvData.length === 0) {
    alert('No data available to export. Please load CSV data first.');
    return;
  }
  
  try {
    // Generate CSV content from current data
    const csvContent = generateCSVContent(window.currentCsvData);
    // Determine export filename from the active CSV name shown in UI, fallback to default
    let exportedName = (function(){
      try {
        const el = document.getElementById('activeCsvName');
        const name = el ? (el.textContent || '').trim() : '';
        return name || 'tileforge-export.csv';
      } catch (_) { return 'tileforge-export.csv'; }
    })();
    // Ensure .csv extension
    if (!/\.csv$/i.test(exportedName)) exportedName = exportedName + '.csv';
    
    // Create download
    downloadCSVFile(csvContent, exportedName);
    // Show success modal consistent with project export flow (reuses global Modal)
    if (window.Modal && typeof Modal.alert === 'function') {
      // updated by Cascade: remove emoji, rely on FA icon from Modal.alert()
      Modal.alert(`“${exportedName}” is forged and ready.<br><span class="modal-description">Delivered to your downloads.</span>`, 'success', 'File forged');
    } else {
      alert(`“${exportedName}” is forged and ready.`);
    }
    
    // Update analytics
    updateFileInfo('Export', exportedName, `${window.currentCsvData.length} locales`);
    
    console.log('CSV export successful:', window.currentCsvData.length, 'locales exported');
  } catch (error) {
    console.error('CSV export failed:', error);
    alert('Failed to export CSV. Please try again.');
  }
}

// Generate CSV content from data array
function generateCSVContent(data) {
  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }
  
  // Get headers from first row (preserve original columns/order)
  const headers = Object.keys(data[0]);

  // Helper: pick first non-empty value from preferred keys
  function prefer(row, keys) {
    for (const k of keys) {
      if (row.hasOwnProperty(k) && row[k] != null && String(row[k]).trim() !== '') {
        return String(row[k]);
      }
    }
    return '';
  }

  // Create CSV header row
  const csvLines = [headers.join(',')];

  // Insert human-readable alias header row to match Iris exports
  const aliasHeader = headers.map(h => {
    const k = String(h || '').toLowerCase();
    if (k === 'locale') return 'Locale';
    if (k === 'items/0/title' || k === 'title') return 'Title';
    if (k === 'items/0/subtitle' || k === 'subtitle' || k === 'description') return 'Subtitle';
    if (k === 'items/0/narratortext' || k === 'narratortext' || k === 'accessibility string' || k === 'accessibilitystring') return 'Narrator Text';
    return h;
  });
  csvLines.push(aliasHeader.join(','));
  
  // Add data rows
  data.forEach(row => {
    const values = headers.map(header => {
      const h = String(header || '').toLowerCase();
      let value = '';

      // Resolve common aliases so live-edited fields are exported even if headers are legacy
      if (h === 'items/0/title' || h === 'title') {
        value = prefer(row, ['items/0/title', 'Title', 'title']);
      } else if (
        h === 'items/0/subtitle' ||
        h === 'subtitle' ||
        h === 'description'
      ) {
        value = prefer(row, ['items/0/subtitle', 'Subtitle', 'subtitle', 'description', 'Description']);
      } else if (
        h === 'items/0/narratortext' ||
        h === 'narratortext' ||
        h === 'accessibility string' ||
        h === 'accessibilitystring'
      ) {
        value = prefer(row, ['items/0/narratorText', 'narratorText', 'Accessibility String', 'accessibilityString']);
      } else if (h === 'locale') {
        value = prefer(row, ['Locale', 'locale']);
      } else {
        // Default: use the field as-is
        value = row[header] != null ? String(row[header]) : '';
      }

      // Escape commas, quotes, newlines
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvLines.push(values.join(','));
  });
  
  return csvLines.join('\n');
}

// Download CSV file to user's system
function downloadCSVFile(csvContent, filename) {
  // Add UTF-8 BOM to ensure special characters are preserved in Excel and other apps
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  // updated by Cascade
  
  // Create download link
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  // Trigger download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up URL object
  URL.revokeObjectURL(url);
}

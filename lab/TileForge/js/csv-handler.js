// TileForge CSV Handling Module
// Handles CSV parsing, data processing, and file operations

// Parse CSV data into array of objects
function parseCSV(csvText) {
  // Remove UTF-8 BOM if present
  if (csvText && csvText.charCodeAt(0) === 0xFEFF) {
    csvText = csvText.slice(1);
  }
  // Normalize line endings
  const lines = (csvText || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // If the first line is the dummy W-width line, skip it and use the next line as header
  // Detect delimiter based on the actual header line
  let headerIndex = 0;
  let probeDelimiter = lines[0].includes('\t') ? '\t' : ',';
  const looksLikeDummyHeader = (function(rawLine){
    const tokens = rawLine.split(probeDelimiter).map(t => t.trim());
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

  const headers = headerLine.split(delimiter).map(h => h.trim());
  const rows = [];

  // Helper to detect the dummy W-line to ignore
  function isDummyWLine(rawLine) {
    const tokens = rawLine.split(delimiter).map(t => t.trim());
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

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // Ignore the special width-test line present in exported files
    // updated by Cascade: skip dummy W line to fix locale propagation issues
    if (isDummyWLine(raw)) continue;

    const values = raw.split(delimiter).map(v => v.trim());
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
  const defaultPath = 'lab/TileForge/sample-data/source-data.csv';
  try {
    fetch(defaultPath, { cache: 'no-store' })
      .then(resp => {
        if (!resp.ok) throw new Error('Default CSV not found');
        return resp.text();
      })
      .then(text => {
        processCsvData(text, 'source-data.csv');
      })
      .catch(() => {
        window.currentCsvData = [];
        renderLocaleGroups([]);
      });
  } catch (e) {
    window.currentCsvData = [];
    renderLocaleGroups([]);
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
      return;
    }
    
    window.currentCsvData = csvRows;
    renderLocaleGroups(csvRows);
    
    // Update file info in analytics
    const actualRowCount = rowCount || csvRows.length;
    updateFileInfo('CSV', fileName, actualRowCount);
    
    console.log('📊 CSV data processed successfully:', actualRowCount, 'rows');
    
  } catch (error) {
    console.error('Error parsing CSV:', error);
    /* No alert for error parsing CSV file */
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
    const subtitle = row['items/0/subtitle'] || row.Subtitle || row.subtitle || '';
    
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
  // Always save before export (manualSave from toolbar.js)
  if (typeof window.manualSave === 'function') {
    try {
      window.manualSave(true); // Optionally pass silent=true to suppress modal
    } catch (err) {
      if (window.showToast) {
        window.showToast('Warning: Save before export failed, exporting anyway.', 'warning');
      } else {
        alert('Warning: Save before export failed, exporting anyway.');
      }
    }
  }
  if (!window.currentCsvData || window.currentCsvData.length === 0) {
    alert('No data available to export. Please load CSV data first.');
    return;
  }
  
  try {
    // Generate CSV content from current data
    const csvContent = generateCSVContent(window.currentCsvData);
    
    // Create download
    downloadCSVFile(csvContent, 'tileforge-export.csv');
    
    // Update analytics
    updateFileInfo('Export', 'tileforge-export.csv', `${window.currentCsvData.length} locales`);
    
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
  
  // Get headers from first row
  const headers = Object.keys(data[0]);
  
  // Create CSV header row
  const csvLines = [headers.join(',')];
  
  // Add data rows
  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header] || '';
      // Escape commas and quotes in CSV values
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

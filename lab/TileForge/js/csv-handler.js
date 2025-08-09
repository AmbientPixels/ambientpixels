// TileForge CSV Handling Module
// Handles CSV parsing, data processing, and file operations

// Parse CSV data into array of objects
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
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
  const csvRows = parseCSV(DEFAULT_CSV_DATA);
  currentCsvData = csvRows;
  renderLocaleGroups(csvRows);
}

// Handle CSV file upload
function handleCsvUpload(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const csvText = e.target.result;
      const csvRows = parseCSV(csvText);
      
      if (csvRows.length === 0) {
        alert('Invalid CSV file or no data found.');
        return;
      }
      
      currentCsvData = csvRows;
      renderLocaleGroups(csvRows);
      
      // Update file info in analytics
      updateFileInfo('CSV', file.name, csvRows.length);
      
    } catch (error) {
      console.error('Error parsing CSV:', error);
      alert('Error parsing CSV file. Please check the format.');
    }
  };
  reader.readAsText(file);
}

// Update CSV data when individual tiles are edited
function updateCsvDataForTile(locale, tileElement) {
  if (!currentCsvData || !locale) return;
  
  const titleEl = tileElement.querySelector('.tile-title');
  const subtitleEl = tileElement.querySelector('.tile-subtitle');
  
  if (!titleEl || !subtitleEl) return;
  
  const newTitle = titleEl.textContent || '';
  const newSubtitle = subtitleEl.textContent || '';
  
  // Find and update the corresponding CSV row
  const row = currentCsvData.find(r => r.Locale === locale);
  if (row) {
    row['items/0/title'] = newTitle;
    row['items/0/subtitle'] = newSubtitle;
  }
  
  // Update analytics after a short delay to avoid excessive updates
  clearTimeout(updateCsvDataForTile.timeout);
  updateCsvDataForTile.timeout = setTimeout(() => {
    updateAnalyticsFromCurrentData();
  }, 500);
}

// Update analytics from current CSV data
function updateAnalyticsFromCurrentData() {
  if (!currentCsvData) return;
  
  const analytics = { totalLocales: 0, overflowCount: 0, nearLimitCount: 0, cleanCount: 0 };
  const localeGroups = {};
  
  currentCsvData.forEach(row => {
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

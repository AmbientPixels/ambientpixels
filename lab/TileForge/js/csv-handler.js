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

// Handle CSV file upload with transformation detection
function handleCsvUpload(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const csvText = e.target.result;
      
      // Check if CSV needs transformation before processing
      if (typeof window.LocTransformer !== 'undefined' && window.LocTransformer.needsTransformation(csvText)) {
        console.log('🔄 CSV needs transformation - showing transform modal');
        
        // Show transformation modal
        if (typeof window.transformModal !== 'undefined') {
          window.transformModal.show((transformedCsvText, stats) => {
            console.log('✅ Transformation complete:', stats);
            // Process the transformed CSV data
            processCsvData(transformedCsvText, file.name + ' (transformed)', stats.totalRows);
          });
        } else {
          console.error('Transform modal not available');
          alert('This CSV requires transformation, but the transform module is not loaded.');
        }
        return;
      }
      
      // Process standard CSV directly
      processCsvData(csvText, file.name);
      
    } catch (error) {
      console.error('Error handling CSV upload:', error);
      alert('Error processing CSV file. Please check the format.');
    }
  };
  reader.readAsText(file);
}

// Process CSV data (extracted for reuse with transformed data)
function processCsvData(csvText, fileName, rowCount = null) {
  try {
    const csvRows = parseCSV(csvText);
    
    if (csvRows.length === 0) {
      alert('Invalid CSV file or no data found.');
      return;
    }
    
    currentCsvData = csvRows;
    renderLocaleGroups(csvRows);
    
    // Update file info in analytics
    const actualRowCount = rowCount || csvRows.length;
    updateFileInfo('CSV', fileName, actualRowCount);
    
    console.log('📊 CSV data processed successfully:', actualRowCount, 'rows');
    
  } catch (error) {
    console.error('Error parsing CSV:', error);
    alert('Error parsing CSV file. Please check the format.');
  }
}

// Update CSV data when individual tiles are edited
function updateCsvDataForTile(locale, tileElement) {
  if (!currentCsvData || !locale) return;
  
  const titleEl = tileElement.querySelector('.tile-title');
  const subtitleEl = tileElement.querySelector('.tile-subtitle');
  
  if (!titleEl || !subtitleEl) return;
  
  const newTitle = titleEl.textContent || '';
  const newSubtitle = subtitleEl.textContent || '';
  
  // Get narrator text from live editor if available
  const narratorInput = document.getElementById('narratorInput');
  const newNarratorText = narratorInput ? narratorInput.value || '' : '';
  
  // Find and update the corresponding CSV row
  const row = currentCsvData.find(r => r.Locale === locale);
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

// Export current CSV data to downloadable file
function exportToCSV() {
  if (!currentCsvData || currentCsvData.length === 0) {
    alert('No data available to export. Please load CSV data first.');
    return;
  }
  
  try {
    // Generate CSV content from current data
    const csvContent = generateCSVContent(currentCsvData);
    
    // Create download
    downloadCSVFile(csvContent, 'tileforge-export.csv');
    
    // Update analytics
    updateFileInfo('Export', 'tileforge-export.csv', `${currentCsvData.length} locales`);
    
    console.log('CSV export successful:', currentCsvData.length, 'locales exported');
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
  // Create blob with CSV content
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
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

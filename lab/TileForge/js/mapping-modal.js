/**
 * TileForge Mapping Modal - Clean Version (No Approval Workflow)
 * Simple UI for Headliner Crafter: Upload → Configure → Export
 */

class MappingModal {
  constructor() {
    this.currentData = null;
    this.dataAnalysis = null;
    this.fieldTypes = {
      input: [],
      output: ['headline', 'subheadline', 'narrator']
    };
    this.currentMapping = {};
    
    this.init();
    console.log('🎨 Mapping Modal initialized (Clean Version)');
  }

  /**
   * Initialize the modal
   */
  init() {
    this.createModal();
    this.bindEvents();
  }

  /**
   * Create the modal HTML structure
   */
  createModal() {
    const modalHTML = `
      <div id="mapping-modal" class="modal-overlay" style="display: none;">
        <div class="modal-container">
          <div class="modal-header">
            <h2><i class="fas fa-magic"></i> Headliner Crafter</h2>
            <button class="modal-close">&times;</button>
          </div>
          
          <div class="modal-body">
            <!-- CSV Upload Section -->
            <div id="csv-upload-section" class="upload-section">
              <div class="csv-drop-zone" id="modalCsvDropZone">
                <div class="csv-drop-zone-content">
  <i class="fas fa-file-csv upload-icon"></i>
  <h4>Drop CSV or Campsite XML File Here</h4>
  <p>or <span class="browse-link" onclick="document.getElementById('modalCsvInput').click()">browse files</span></p>
  <small>
    Drag and drop your localization <b>CSV</b> or <b>Campsite-localized XML</b> file.<br>
    <span style="color:#6c63ff"><b>Tip:</b></span> This tool lets you map and convert Campsite XML files to an <b>Iris-ready CSV</b> for CardForge or other Iris-compatible tools.
  </small>
  <div class="dropzone-info">
    <p style="margin-top:8px;font-size:13px;color:#888;">
      <b>What does this tool do?</b><br>
      • Import Campsite-localized XML or CSV files<br>
      • Map and preview localization fields<br>
      • Export as Iris-ready CSV for CardForge or Iris pipeline
    </p>
  </div>
</div>
                <input type="file" id="modalCsvInput" accept=".csv" style="display: none;" />
              </div>
            </div>

            <!-- Mapping Interface -->
            <div id="mapping-interface" class="mapping-interface" style="display: none;">
              <!-- Data Analysis -->
              <div class="analysis-section">
                <h3><i class="fas fa-chart-bar"></i> Data Analysis</h3>
                <div class="stats-container" id="statsContainer">
                  <!-- Stats will be populated here -->
                </div>
              </div>

              <!-- Field Mapping -->
              <div class="mapping-section">
                <h3><i class="fas fa-arrows-alt-h"></i> Field Mapping</h3>
                <div class="mapping-grid">
                  <div class="input-fields">
                    <h4>Input Fields (Your CSV)</h4>
                    <div id="input-fields">
                      <!-- Input fields will be populated here -->
                    </div>
                  </div>
                  <div class="mapping-arrow">
                    <i class="fas fa-arrow-right"></i>
                  </div>
                  <div class="output-fields">
                    <h4>Output Fields (CardForge)</h4>
                    <div id="output-fields">
                      <!-- Output fields will be populated here -->
                    </div>
                  </div>
                </div>
              </div>

              <!-- Live Preview -->
              <div class="preview-section">
                <h3><i class="fas fa-eye"></i> Live Preview</h3>
                <div class="preview-container" id="previewContainer">
                  <!-- Preview will be populated here -->
                </div>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.mappingModal.hide()">Cancel</button>
            <button class="btn btn-outline-primary" id="exportCsvBtn" onclick="window.mappingModal.exportCsv()" style="display: none;">
              <i class="fas fa-download"></i> Export CSV
            </button>
            <button class="btn btn-primary" id="importBtn" onclick="window.mappingModal.importToCardForge()" style="display: none;">
              <i class="fas fa-upload"></i> Import to CardForge
            </button>
          </div>
        </div>
      </div>
    `;

    // Remove existing modal if it exists
    const existingModal = document.getElementById('mapping-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Add modal to document
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Setup drag and drop for modal (calls modal's handleCsvUpload method)
    const modalDropZone = document.getElementById('modalCsvDropZone');
    if (modalDropZone) {
      modalDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modalDropZone.classList.add('drag-over');
      });

      modalDropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modalDropZone.classList.remove('drag-over');
      });

      modalDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modalDropZone.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          const file = files[0];
          if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
          this.handleCsvUpload(file); // Call modal's own handleCsvUpload method
        } else if (file.type === 'text/xml' || file.name.endsWith('.xml')) {
          // Read XML and parse
          const reader = new FileReader();
          reader.onload = (e) => {
            const xmlString = e.target.result;
            const rows = window.headlinerCrafter.constructor.parseXML(xmlString);
            this.handleCsvUpload(rows); // Reuse CSV handler with normalized data
          };
          reader.readAsText(file);

            this.handleCsvUpload(file); // Call modal's own handleCsvUpload method
          } else {
            alert('Please upload a valid CSV file.');
          }
        }
      });
    }
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // CSV file input
    const csvInput = document.getElementById('modalCsvInput');
    if (csvInput) {
      csvInput.addEventListener('change', (e) => this.handleCsvUpload(e.target.files[0]));
    }



    // Close modal events
    const closeBtn = document.querySelector('#mapping-modal .modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Click outside to close
    const modal = document.getElementById('mapping-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hide();
        }
      });
    }

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
        this.hide();
      }
    });
  }

  /**
   * Show the modal
   */
  show(csvData = null) {
    console.log('🎨 Opening Headliner Crafter mapping modal...');
    
    const modal = document.getElementById('mapping-modal');
    const uploadSection = document.getElementById('csv-upload-section');
    const mappingInterface = document.getElementById('mapping-interface');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const importBtn = document.getElementById('importBtn');
    
    if (csvData && csvData.length > 0) {
      console.log('📊 Using provided CSV data:', csvData.length, 'rows');
      this.currentData = csvData;
      this.analyzeAndPopulate(csvData);
      uploadSection.style.display = 'none';
      mappingInterface.style.display = 'block';
      exportCsvBtn.style.display = 'inline-block';
      importBtn.style.display = 'inline-block';
    } else {
      uploadSection.style.display = 'block';
      mappingInterface.style.display = 'none';
      exportCsvBtn.style.display = 'none';
      importBtn.style.display = 'none';
    }
    
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
  }

  /**
   * Hide the modal
   */
  hide() {
    const modal = document.getElementById('mapping-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.style.opacity = '0';
      modal.style.visibility = 'hidden';
    }
  }

  /**
   * Handle CSV file upload
   */
  handleCsvUpload(input) {
    // If input is an array (from XML), process directly
    if (Array.isArray(input)) {
      if (!input.length) {
        alert('XML file appears to be empty or invalid.');
        return;
      }
      console.log('📁 Processing uploaded XML data:', input.length, 'rows');
      this.currentData = input;
      this.analyzeAndPopulate(input);
      // Switch to mapping interface
      document.getElementById('csv-upload-section').style.display = 'none';
      document.getElementById('mapping-interface').style.display = 'block';
      document.getElementById('exportCsvBtn').style.display = 'inline-block';
      document.getElementById('importBtn').style.display = 'inline-block';
      return;
    }

    // Otherwise, expect a CSV file
    if (!input || !input.name.endsWith('.csv')) {
      alert('Please select a valid CSV file.');
      return;
    }

    console.log('📁 Processing uploaded CSV file:', input.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target.result;
        const csvData = this.parseCSV(csvText);
        if (csvData.length === 0) {
          alert('CSV file appears to be empty or invalid.');
          return;
        }
        console.log('✅ CSV parsed successfully:', csvData.length, 'rows');
        this.currentData = csvData;
        this.analyzeAndPopulate(csvData);
        // Switch to mapping interface
        document.getElementById('csv-upload-section').style.display = 'none';
        document.getElementById('mapping-interface').style.display = 'block';
        document.getElementById('exportCsvBtn').style.display = 'inline-block';
        document.getElementById('importBtn').style.display = 'inline-block';
      } catch (error) {
        console.error('❌ Error parsing CSV:', error);
        alert('Error parsing CSV file: ' + error.message);
      }
    };
    reader.readAsText(input);
  }

  /**
   * Parse CSV text into array of objects
   */
  parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const row = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      data.push(row);
    }
    
    return data;
  }

  /**
   * Analyze CSV data and populate the interface
   */
  analyzeAndPopulate(csvData) {
    // Use headliner crafter to analyze the data
    if (window.headlinerCrafter) {
      const analysis = window.headlinerCrafter.analyzeData(csvData);
      this.dataAnalysis = analysis;
      this.populateInterface(analysis, csvData);
      this.updatePreview();
    }
  }

  /**
   * Populate the interface with analysis data
   */
  populateInterface(analysis, csvData) {
    console.log('🎨 Populating interface with analysis data...');
    
    // Store the analysis data
    this.dataAnalysis = analysis;
    this.currentData = csvData;
    
    // Extract input fields from CSV, filtering out Language and Region fields
    const allFields = Object.keys(csvData[0] || {});
    // Only include fields that have at least one non-empty value
    this.fieldTypes.input = allFields.filter(field => {
      const fieldLower = field.toLowerCase();
      if (fieldLower === 'language' || fieldLower === 'region') return false;
      // Check if any row has a non-empty value for this field
      return csvData.some(row => row[field] && String(row[field]).trim() !== '');
    });
    
    console.log('🔍 Filtered input fields (hiding Language/Region):', this.fieldTypes.input);
    
    // Populate all interface sections
    this.populateAnalysis();
    this.populateFieldMapping();
    
    console.log('✅ Interface populated successfully');
  }

  /**
   * Populate the data analysis section
   */
  populateAnalysis() {
    const statsContainer = document.getElementById('statsContainer');
    const analysis = this.dataAnalysis;
    
    const statsHTML = `
      <div class="stat-item">
        <span class="stat-label">Total Rows:</span>
        <span class="stat-value">${analysis.totalRows}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Locales:</span>
        <span class="stat-value">${analysis.locales.size}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Input Fields:</span>
        <span class="stat-value">${this.fieldTypes.input.length}</span>
      </div>
    `;
    
    statsContainer.innerHTML = statsHTML;
  }

  /**
   * Populate the field mapping interface with card-based layout
   */
  populateFieldMapping() {
    const inputContainer = document.getElementById('input-fields');
    const outputContainer = document.getElementById('output-fields');
    
    // Input field cards with enhanced visualization
    const inputHTML = this.fieldTypes.input.map(field => {
      const sample = this.getFieldSample(field);
      const sampleLength = sample.length;
      return `
        <div class="field-card input-card" data-field="${field}">
          <div class="card-header">
            <i class="fas fa-file-alt card-icon"></i>
            <span class="field-name">${field}</span>
          </div>
          <div class="card-content">
            <div class="field-sample">
              <span class="sample-label">Sample:</span>
              <span class="sample-text">"${sample}"</span>
            </div>
            <div class="field-meta">
              <span class="sample-length">${sampleLength} chars</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // Output field cards with mapping controls and visual feedback
    const outputHTML = this.fieldTypes.output.map(field => {
      const limit = this.getFieldLimit(field);
      const defaultMapping = this.getDefaultMapping(field);
      const isAutoMapped = this.fieldTypes.input.some(inputField => 
        this.getDefaultMapping(inputField) === field
      );
      
      return `
        <div class="field-card output-card" data-field="${field}">
          <div class="card-header">
            <i class="fas fa-bullseye card-icon"></i>
            <span class="field-name">${field}</span>
            <span class="char-limit">${limit} chars max</span>
          </div>
          <div class="card-content">
            <select class="field-mapping-select" data-output="${field}">
              <option value="">Select input field...</option>
              ${this.fieldTypes.input.map(inputField => `
                <option value="${inputField}" ${this.getDefaultMapping(inputField) === field ? 'selected' : ''}>
                  ${inputField}
                </option>
              `).join('')}
            </select>
            <div class="mapping-preview" id="preview-${field}">
              <span class="preview-label">Preview:</span>
              <span class="preview-text">Select a field to see preview...</span>
            </div>
            <div class="mapping-status ${isAutoMapped ? 'auto-mapped' : 'unmapped'}" id="status-${field}">
              <i class="fas ${isAutoMapped ? 'fa-check-circle' : 'fa-circle'} status-icon"></i>
              <span class="status-text">${isAutoMapped ? 'Auto-mapped' : 'Not mapped'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    inputContainer.innerHTML = inputHTML;
    outputContainer.innerHTML = outputHTML;
    
    // Bind mapping change events with enhanced feedback
    document.querySelectorAll('.field-mapping-select').forEach(select => {
      select.addEventListener('change', () => {
        this.updateCurrentMapping();
        this.updateMappingPreviews();
        this.updatePreview();
      });
    });
    
    // Set initial mapping and update previews
    this.updateCurrentMapping();
    this.updateMappingPreviews();
  }

  /**
   * Get sample data for a field, prioritizing English content
   */
  getFieldSample(field) {
    if (!this.currentData || this.currentData.length === 0) return '';
    
    // Try to find English language row first
    const englishRow = this.currentData.find(row => 
      row.Language && row.Language.toLowerCase() === 'en'
    );
    
    // Use English sample if available, otherwise use first row
    const sampleRow = englishRow || this.currentData[0];
    const sample = sampleRow[field] || '';
    
    return sample.length > 30 ? sample.substring(0, 30) + '...' : sample;
  }

  /**
   * Get character limit for output field
   */
  getFieldLimit(field) {
    const limits = {
      'headline': 45,
      'subheadline': 35,
      'narrator': 60
    };
    return limits[field] || 50;
  }

  /**
   * Get default mapping for input field
   */
  getDefaultMapping(inputField) {
    const defaultMappings = {
      'Title': 'headline',
      'MiniFAD': 'headline',
      'Description': 'subheadline',
      'Narrator': 'narrator'
    };
    return defaultMappings[inputField] || '';
  }

  /**
   * Update current mapping from UI
   */
  updateCurrentMapping() {
    const mappings = {};
    document.querySelectorAll('.field-mapping-select').forEach(select => {
      const outputField = select.dataset.output;
      const inputField = select.value;
      if (inputField) {
        mappings[inputField] = outputField;
      }
    });
    
    this.currentMapping = mappings;
    
    // Update headliner crafter mappings
    if (window.headlinerCrafter) {
      window.headlinerCrafter.updateFieldMappings(mappings);
    }
  }

  /**
   * Update the live preview
   */
  updatePreview() {
    if (!this.currentData || !window.headlinerCrafter) return;
    
    const previewContainer = document.getElementById('previewContainer');
    const transformedData = window.headlinerCrafter.transformData(this.currentData);
    
    const previewHTML = `
      <div class="preview-table">
        <div class="preview-header">
          <div class="preview-cell">Locale</div>
          <div class="preview-cell">Headline</div>
          <div class="preview-cell">Subheadline</div>
          <div class="preview-cell">Narrator</div>
        </div>
        ${transformedData.map(row => `
          <div class="preview-row" data-locale="${row.locale}" data-language="${row.language || ''}" data-region="${row.region || ''}">
            <div class="preview-cell">${row.locale}</div>
            <div class="preview-cell">${row.headline}</div>
            <div class="preview-cell">${row.subheadline}</div>
            <div class="preview-cell">${row.narrator}</div>
          </div>
        `).join('')}
      </div>
      <div class="preview-note">
        <small>Showing all ${transformedData.length} rows</small>
      </div>
    `;
    
    previewContainer.innerHTML = previewHTML;
  }

  /**
   * Export the transformed data as CSV file
   */
  exportCsv() {
    if (!this.currentData || !window.headlinerCrafter) {
      alert('No data to export');
      return;
    }
    
    console.log('📤 Exporting CardForge CSV...');
    
    try {
      const transformedData = window.headlinerCrafter.transformData(this.currentData);
      const csvContent = window.headlinerCrafter.exportToCardForgeCSV(transformedData);
      
      // Download the CSV
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cardforge-export.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      console.log('✅ CardForge CSV exported successfully');
      alert(`Successfully exported ${transformedData.length} locales to CSV file!`);
      
    } catch (error) {
      console.error('❌ Export error:', error);
      alert('Error exporting data: ' + error.message);
    }
  }

  /**
   * Import the transformed data directly into CardForge main interface
   */
  importToCardForge() {
    if (!this.currentData || !window.headlinerCrafter) {
      alert('No data to import');
      return;
    }
    
    console.log('📥 Importing ONLY content to CardForge...');
    
    try {
      const transformedData = window.headlinerCrafter.transformData(this.currentData);
      
      if (!window.currentCsvData || window.currentCsvData.length === 0) {
        // If no data exists, initialize it from transformedData
        window.currentCsvData = transformedData.map(row => ({
          'Locale': row.locale,
          'items/0/title': row.headline || '',
          'items/0/subtitle': row.subheadline || '',
          'items/0/narratorText': row.narrator || ''
        }));
        renderLocaleGroups(window.currentCsvData);
        alert(`Imported ${transformedData.length} rows as new data!`);
        this.hide();
        return;
      }
      
      console.log('� Updating ONLY content fields by row index...');
      
      // Update content by row index - don't touch locale names at all
      transformedData.forEach((newRow, index) => {
        if (index < window.currentCsvData.length) {
          const existingRow = window.currentCsvData[index];
          
          // ONLY update content fields - NEVER touch Locale
          existingRow['items/0/title'] = newRow.headline || '';
          existingRow['items/0/subtitle'] = newRow.subheadline || '';
          existingRow['items/0/narratorText'] = newRow.narrator || '';
          
          console.log(`✅ Updated content for row ${index}: ${existingRow.Locale}`);
        }
      });
      
      // Re-render the interface with updated content
      renderLocaleGroups(window.currentCsvData);
      
      console.log('✅ Content imported successfully');
      alert(`Successfully updated content for ${transformedData.length} locales!`);
      
      // Close the modal
      this.hide();
      
    } catch (error) {
      console.error('❌ Import error:', error);
      alert('Error importing content: ' + error.message);
    }
  }

  /**
   * Update mapping previews and status flags
   */
  updateMappingPreviews() {
    document.querySelectorAll('.field-mapping-select').forEach(select => {
      const outputField = select.dataset.output;
      const inputField = select.value;
      const previewElement = document.getElementById(`preview-${outputField}`);
      const statusElement = document.getElementById(`status-${outputField}`);
      
      if (inputField && this.currentData && this.currentData.length > 0) {
        // Get English sample data for preview (prioritize English like Input Fields do)
        const englishRow = this.currentData.find(row => 
          row.Language && row.Language.toLowerCase() === 'en'
        );
        const sampleRow = englishRow || this.currentData[0];
        const sampleText = sampleRow[inputField] || '';
        const limit = this.getFieldLimit(outputField);
        
        // Update preview text with character count and color coding
        const charCount = sampleText.length;
        const colorClass = this.getCharCountColorClass(charCount, limit);
        
        // Analyze all locales for length issues
        const localeAnalysis = this.analyzeLocaleLength(inputField, limit);
        const localeWarningHTML = localeAnalysis.issues.length > 0 
          ? `<div class="locale-warning">⚠️ ${localeAnalysis.issues.join(', ')} (${localeAnalysis.issues.length} over limit)</div>`
          : '';
        
        previewElement.innerHTML = `
          <span class="preview-label">Preview:</span>
          <span class="preview-text">"${sampleText}"</span>
          <span class="char-count ${colorClass}">${charCount}/${limit}</span>
          ${localeWarningHTML}
        `;
        
        // Update status to mapped
        statusElement.className = 'mapping-status mapped';
        statusElement.innerHTML = `
          <i class="fas fa-check-circle status-icon"></i>
          <span class="status-text">Mapped</span>
        `;
      } else {
        // No mapping selected
        previewElement.innerHTML = `
          <span class="preview-label">Preview:</span>
          <span class="preview-text">Select a field to see preview...</span>
        `;
        
        // Update status to not mapped
        statusElement.className = 'mapping-status unmapped';
        statusElement.innerHTML = `
          <i class="fas fa-circle status-icon"></i>
          <span class="status-text">Not mapped</span>
        `;
      }
    });
  }

  /**
   * Analyze character length across all locales for a given field
   */
  analyzeLocaleLength(inputField, limit) {
    const issues = [];
    const localeStats = {};
    
    // Check each row (locale) for length issues
    this.currentData.forEach(row => {
      const locale = row.Language || 'Unknown';
      const text = row[inputField] || '';
      const length = text.length;
      
      localeStats[locale] = length;
      
      // Flag if over limit
      if (length > limit) {
        const localeCode = this.getLocaleCode(locale);
        issues.push(`${localeCode}(${length}/${limit})`);
      }
    });
    
    return {
      issues: issues,
      stats: localeStats,
      totalLocales: Object.keys(localeStats).length,
      problemLocales: issues.length
    };
  }

  /**
   * Get short locale code for display
   */
  getLocaleCode(language) {
    const localeCodes = {
      'en': 'EN',
      'ar': 'AR', 
      'arabic': 'AR',
      'de': 'DE',
      'german': 'DE',
      'fr': 'FR',
      'french': 'FR',
      'es': 'ES',
      'spanish': 'ES',
      'it': 'IT',
      'italian': 'IT',
      'pt': 'PT',
      'portuguese': 'PT',
      'ru': 'RU',
      'russian': 'RU',
      'ja': 'JA',
      'japanese': 'JA',
      'ko': 'KO',
      'korean': 'KO',
      'zh': 'ZH',
      'chinese': 'ZH'
    };
    
    const key = language.toLowerCase();
    return localeCodes[key] || language.substring(0, 2).toUpperCase();
  }

  /**
   * Get color class based on character count vs limit
   */
  getCharCountColorClass(charCount, limit) {
    const percentage = (charCount / limit) * 100;
    
    if (percentage >= 100) {
      return 'char-count-danger'; // Red - over limit
    } else if (percentage >= 90) {
      return 'char-count-warning'; // Orange - very close to limit
    } else if (percentage >= 70) {
      return 'char-count-caution'; // Yellow - approaching limit
    } else {
      return 'char-count-safe'; // Green - safe zone
    }
  }
}

// Initialize global instance
window.mappingModal = new MappingModal();

console.log('🎨 Mapping Modal module loaded (Clean Version - No Approval Workflow)');

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
                <div class="drop-zone-content">
                  <i class="fas fa-file-csv upload-icon"></i>
                  <h4>Drop CSV File Here</h4>
                  <p>or <span class="browse-link" onclick="document.getElementById('modalCsvInput').click()">browse files</span></p>
                  <small>Drag and drop your localization CSV file</small>
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
  handleCsvUpload(file) {
    if (!file || !file.name.endsWith('.csv')) {
      alert('Please select a valid CSV file.');
      return;
    }

    console.log('📁 Processing uploaded CSV file:', file.name);
    
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
    
    reader.readAsText(file);
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
    
    // Extract input fields from CSV
    this.fieldTypes.input = Object.keys(csvData[0] || {});
    
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
   * Populate the field mapping interface
   */
  populateFieldMapping() {
    const inputContainer = document.getElementById('input-fields');
    const outputContainer = document.getElementById('output-fields');
    
    // Input fields
    const inputHTML = this.fieldTypes.input.map(field => `
      <div class="field-item input-field" data-field="${field}">
        <div class="field-header">
          <span class="field-name">${field}</span>
          <span class="field-sample">${this.getFieldSample(field)}</span>
        </div>
      </div>
    `).join('');
    
    // Output fields with dropdowns
    const outputHTML = this.fieldTypes.output.map(field => `
      <div class="field-item output-field" data-field="${field}">
        <div class="field-header">
          <span class="field-name">${field}</span>
          <span class="field-limit">${this.getFieldLimit(field)} chars</span>
        </div>
        <select class="field-mapping-select" data-output="${field}">
          <option value="">Select input field...</option>
          ${this.fieldTypes.input.map(inputField => `
            <option value="${inputField}" ${this.getDefaultMapping(inputField) === field ? 'selected' : ''}>
              ${inputField}
            </option>
          `).join('')}
        </select>
      </div>
    `).join('');
    
    inputContainer.innerHTML = inputHTML;
    outputContainer.innerHTML = outputHTML;
    
    // Bind mapping change events
    document.querySelectorAll('.field-mapping-select').forEach(select => {
      select.addEventListener('change', () => {
        this.updateCurrentMapping();
        this.updatePreview();
      });
    });
    
    // Set initial mapping
    this.updateCurrentMapping();
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
    const preview = window.headlinerCrafter.getPreview(this.currentData, 5);
    
    const previewHTML = `
      <div class="preview-table">
        <div class="preview-header">
          <div class="preview-cell">Locale</div>
          <div class="preview-cell">Headline</div>
          <div class="preview-cell">Subheadline</div>
          <div class="preview-cell">Narrator</div>
        </div>
        ${preview.map(row => `
          <div class="preview-row">
            <div class="preview-cell">${row.locale}</div>
            <div class="preview-cell">${row.headline}</div>
            <div class="preview-cell">${row.subheadline}</div>
            <div class="preview-cell">${row.narrator}</div>
          </div>
        `).join('')}
      </div>
      <div class="preview-note">
        <small>Showing first 5 rows of ${this.currentData.length} total rows</small>
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
    
    console.log('📥 Importing data to CardForge main interface...');
    
    try {
      const transformedData = window.headlinerCrafter.transformData(this.currentData);
      const csvContent = window.headlinerCrafter.exportToCardForgeCSV(transformedData);
      
      // Import directly into TileForge main interface
      if (typeof processCsvData === 'function') {
        console.log('📥 CSV content being imported:', csvContent.substring(0, 200) + '...');
        console.log('📊 Transformed data sample:', transformedData.slice(0, 2));
        
        processCsvData(csvContent, 'Headliner Crafter Import', transformedData.length);
        
        console.log('✅ Data imported to CardForge successfully');
        alert(`Successfully imported ${transformedData.length} locales to CardForge!`);
        
        // Close the modal after successful import
        this.hide();
        
      } else {
        console.error('❌ processCsvData function not available');
        alert('Error: Main TileForge interface not available for import');
      }
      
    } catch (error) {
      console.error('❌ Import error:', error);
      alert('Error importing data: ' + error.message);
    }
  }
}

// Initialize global instance
window.mappingModal = new MappingModal();

console.log('🎨 Mapping Modal module loaded (Clean Version - No Approval Workflow)');

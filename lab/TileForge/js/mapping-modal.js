/**
 * Mapping Modal - Interactive UI for Headliner Crafter field mapping
 * Provides visual mapping interface, preview, and approval workflow integration
 */

class MappingModal {
  constructor() {
    this.isVisible = false;
    this.currentData = null;
    this.previewData = null;
    this.mappingConfig = null;
    this.modalElement = null;
    
    this.fieldTypes = {
      input: ['Title', 'Description', 'MiniFAD'],
      output: ['headline', 'subheadline', 'narrator']
    };
    
    this.currentMapping = {
      'Title': 'headline',
      'Description': 'subheadline', 
      'MiniFAD': 'narrator'
    };
  }

  /**
   * Show the mapping modal with optional CSV data
   * @param {Array} csvData - Optional raw CSV data to map
   * @param {Function} callback - Callback when mapping is complete
   */
  show(csvData = null, callback = null) {
    console.log('🎨 Opening Headliner Crafter mapping modal...');
    
    this.currentData = csvData;
    this.onComplete = callback;
    
    // Create modal first
    this.createModal();
    this.bindEvents();
    
    // If we have valid CSV data, analyze and show mapping interface
    if (csvData && Array.isArray(csvData) && csvData.length > 0) {
      console.log('📊 Using provided CSV data:', csvData.length, 'rows');
      this.analyzeAndPopulate(csvData);
      // Hide upload section, show mapping interface
      document.getElementById('csv-upload-section').style.display = 'none';
      document.getElementById('mapping-interface').style.display = 'block';
    } else {
      console.log('📁 No CSV data provided, showing upload interface');
      // Show upload section, hide mapping interface
      document.getElementById('csv-upload-section').style.display = 'block';
      document.getElementById('mapping-interface').style.display = 'none';
    }
    
    this.isVisible = true;
  }

  /**
   * Hide the mapping modal
   */
  hide() {
    console.log('🎨 Closing mapping modal...');
    
    if (this.modalElement) {
      this.modalElement.style.display = 'none';
      document.body.removeChild(this.modalElement);
      this.modalElement = null;
    }
    
    this.isVisible = false;
    this.currentData = null;
    this.previewData = null;
  }

  /**
   * Create the modal HTML structure
   */
  createModal() {
    const modalHTML = `
      <div id="mapping-modal" class="modal-overlay" style="display: flex;">
        <div class="modal-container mapping-modal-container">
          <div class="modal-header">
            <h2><i class="fas fa-magic"></i> Headliner Crafter</h2>
            <button class="modal-close" aria-label="Close">&times;</button>
          </div>
          
          <div class="modal-body">
            <div class="mapping-explanation">
              <p><i class="fas fa-info-circle"></i> Configure how your raw localization data maps to CardForge fields. Preview the results and submit for approval.</p>
            </div>
            
            <!-- CSV Upload Section -->
            <div class="csv-upload-section" id="csv-upload-section">
              <div class="csv-drop-zone" id="csv-drop-zone">
                <div class="drop-zone-content">
                  <i class="fas fa-cloud-upload-alt"></i>
                  <h4>Drop CSV File Here</h4>
                  <p>or <span class="browse-link" id="browse-csv">browse files</span></p>
                  <small>Supports .csv files with localization data</small>
                </div>
                <input type="file" id="csv-file-input" accept=".csv" style="display: none;">
              </div>
            </div>
            
            <div class="mapping-interface" id="mapping-interface" style="display: none;">
              <!-- Data Analysis Section -->
              <div class="analysis-section">
                <h3><i class="fas fa-chart-bar"></i> Data Analysis</h3>
                <div class="analysis-stats" id="analysis-stats">
                  <!-- Analysis results will be inserted here -->
                </div>
              </div>
              
              <!-- Mapping Configuration Section -->
              <div class="mapping-section">
                <h3><i class="fas fa-arrows-alt-h"></i> Field Mapping</h3>
                <div class="mapping-grid">
                  <div class="input-fields">
                    <h4>Input Fields</h4>
                    <div class="field-list" id="input-fields">
                      <!-- Input fields will be populated here -->
                    </div>
                  </div>
                  
                  <div class="mapping-arrows">
                    <i class="fas fa-arrow-right"></i>
                  </div>
                  
                  <div class="output-fields">
                    <h4>CardForge Fields</h4>
                    <div class="field-list" id="output-fields">
                      <!-- Output fields will be populated here -->
                    </div>
                  </div>
                </div>
                
                <!-- Conditional Rules Section -->
                <div class="conditional-rules">
                  <h4><i class="fas fa-code-branch"></i> Conditional Logic</h4>
                  <div class="rules-list" id="conditional-rules">
                    <!-- Conditional rules will be populated here -->
                  </div>
                  <button type="button" class="btn btn-secondary" id="add-rule-btn">
                    <i class="fas fa-plus"></i> Add Rule
                  </button>
                </div>
              </div>
              
              <!-- Preview Section -->
              <div class="preview-section">
                <h3><i class="fas fa-eye"></i> Preview Results</h3>
                <div class="preview-controls">
                  <button type="button" class="btn btn-secondary" id="refresh-preview-btn">
                    <i class="fas fa-sync"></i> Refresh Preview
                  </button>
                  <span class="preview-count" id="preview-count">0 rows</span>
                </div>
                <div class="preview-container" id="preview-container">
                  <!-- Preview results will be shown here -->
                </div>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" id="cancel-mapping-btn">
                <i class="fas fa-times"></i> Cancel
              </button>
              <button type="button" class="btn btn-success" id="export-csv-btn">
                <i class="fas fa-download"></i> Export CardForge CSV
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Insert modal into DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modalElement = document.getElementById('mapping-modal');
    
    // Populate initial content
    this.populateAnalysis();
    this.populateFieldMapping();
    this.populateConditionalRules();
  }

  /**
   * Populate the data analysis section
   */
  populateAnalysis() {
    if (!this.dataAnalysis) return;
    
    const statsContainer = document.getElementById('analysis-stats');
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
        <span class="stat-label">Suggested Mapping:</span>
        <span class="stat-value">${analysis.suggestedMappings.length > 0 ? analysis.suggestedMappings[0].name : 'Default'}</span>
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
        <div class="field-stats">
          ${this.getFieldStats(field)}
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
            <option value="${inputField}" ${this.currentMapping[inputField] === field ? 'selected' : ''}>
              ${inputField}
            </option>
          `).join('')}
        </select>
      </div>
    `).join('');
    
    inputContainer.innerHTML = inputHTML;
    outputContainer.innerHTML = outputHTML;
  }

  /**
   * Populate conditional rules section
   */
  populateConditionalRules() {
    const rulesContainer = document.getElementById('conditional-rules');
    
    if (window.headlinerCrafter && window.headlinerCrafter.mappingConfig.rules) {
      const rules = window.headlinerCrafter.mappingConfig.rules;
      
      const rulesHTML = rules.map((rule, index) => `
        <div class="rule-item" data-rule-index="${index}">
          <div class="rule-header">
            <span class="rule-name">${rule.name}</span>
            <span class="rule-priority">Priority: ${rule.priority}</span>
          </div>
          <div class="rule-condition">
            <strong>If:</strong> ${this.formatCondition(rule.condition)}
          </div>
          <div class="rule-mapping">
            <strong>Then:</strong> ${this.formatMapping(rule.mapping)}
          </div>
          <div class="rule-actions">
            <button type="button" class="btn-small btn-secondary edit-rule-btn" data-rule-index="${index}">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button type="button" class="btn-small btn-danger delete-rule-btn" data-rule-index="${index}">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      `).join('');
      
      rulesContainer.innerHTML = rulesHTML;
    }
  }

  /**
   * Get sample text for a field
   * @param {String} fieldName - Field name
   * @returns {String} Sample text
   */
  getFieldSample(fieldName) {
    if (!this.currentData || this.currentData.length === 0) return '';
    
    const sampleRow = this.currentData[0];
    const text = sampleRow[fieldName] || '';
    
    return text.length > 30 ? text.substring(0, 30) + '...' : text;
  }

  /**
   * Get statistics for a field
   * @param {String} fieldName - Field name
   * @returns {String} Statistics HTML
   */
  getFieldStats(fieldName) {
    if (!this.dataAnalysis || !this.dataAnalysis.fieldAnalysis[fieldName]) {
      return '<span class="field-stat">No data</span>';
    }
    
    const stats = this.dataAnalysis.fieldAnalysis[fieldName];
    return `
      <span class="field-stat">Avg: ${Math.round(stats.avgLength)} chars</span>
      <span class="field-stat">${stats.hasPercentage > 0 ? '📊 Has %' : ''}</span>
      <span class="field-stat">${stats.isPromotional > 0 ? '🎯 Promo' : ''}</span>
    `;
  }

  /**
   * Get character limit for output field
   * @param {String} fieldName - Field name
   * @returns {Number} Character limit
   */
  getFieldLimit(fieldName) {
    const limits = { headline: 50, subheadline: 80, narrator: 150 };
    return limits[fieldName] || 100;
  }

  /**
   * Format condition for display
   * @param {String} condition - Condition name
   * @returns {String} Formatted condition
   */
  formatCondition(condition) {
    const conditionMap = {
      'hasPercentage': 'MiniFAD contains percentage (%)',
      'isPromotional': 'Text contains promotional keywords',
      'isShort': 'Text is short (< 30 chars)',
      'default': 'Default (fallback)'
    };
    
    return conditionMap[condition] || condition;
  }

  /**
   * Format mapping for display
   * @param {Object} mapping - Mapping object
   * @returns {String} Formatted mapping
   */
  formatMapping(mapping) {
    return Object.entries(mapping)
      .map(([input, output]) => `${input} → ${output}`)
      .join(', ');
  }

  /**
   * Update the preview with current mapping
   */
  updatePreview() {
    if (!this.currentData || !window.headlinerCrafter) return;
    
    console.log('🔄 Updating mapping preview...');
    
    try {
      // Get current mapping configuration
      const customMapping = this.getCurrentMappingConfig();
      
      // Transform data
      this.previewData = window.headlinerCrafter.transformData(this.currentData, customMapping);
      
      // Update preview display
      this.displayPreview();
      
    } catch (error) {
      console.error('❌ Error updating preview:', error);
      this.showPreviewError(error.message);
    }
  }

  /**
   * Get current mapping configuration from UI
   * @returns {Object} Current mapping configuration
   */
  getCurrentMappingConfig() {
    const mapping = {};
    
    // Read from dropdowns
    document.querySelectorAll('.field-mapping-select').forEach(select => {
      const outputField = select.dataset.output;
      const inputField = select.value;
      
      if (inputField) {
        mapping[inputField] = outputField;
      }
    });
    
    return mapping;
  }

  /**
   * Display preview results
   */
  displayPreview() {
    const container = document.getElementById('preview-container');
    const countElement = document.getElementById('preview-count');
    
    if (!this.previewData || this.previewData.length === 0) {
      container.innerHTML = '<p class="no-preview">No preview data available</p>';
      countElement.textContent = '0 rows';
      return;
    }
    
    // Update count
    countElement.textContent = `${this.previewData.length} rows`;
    
    // Show first few rows as preview
    const previewRows = this.previewData.slice(0, 5);
    
    const previewHTML = `
      <div class="preview-table">
        <div class="preview-header">
          <div class="preview-col">Locale</div>
          <div class="preview-col">Headline</div>
          <div class="preview-col">Subheadline</div>
          <div class="preview-col">Narrator</div>
        </div>
        ${previewRows.map(row => `
          <div class="preview-row">
            <div class="preview-col locale">${row.locale}</div>
            <div class="preview-col headline">${this.truncatePreview(row.headline, 25)}</div>
            <div class="preview-col subheadline">${this.truncatePreview(row.subheadline, 30)}</div>
            <div class="preview-col narrator">${this.truncatePreview(row.narrator, 40)}</div>
          </div>
        `).join('')}
      </div>
      ${this.previewData.length > 5 ? `<p class="preview-note">Showing first 5 of ${this.previewData.length} rows</p>` : ''}
    `;
    
    container.innerHTML = previewHTML;
  }

  /**
   * Truncate text for preview display
   * @param {String} text - Text to truncate
   * @param {Number} maxLength - Maximum length
   * @returns {String} Truncated text
   */
  truncatePreview(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  /**
   * Show preview error
   * @param {String} errorMessage - Error message
   */
  showPreviewError(errorMessage) {
    const container = document.getElementById('preview-container');
    container.innerHTML = `
      <div class="preview-error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Preview Error: ${errorMessage}</p>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Close button
    const closeButton = document.querySelector('#mapping-modal .modal-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => this.hide());
    }
    
    // Cancel button
    const cancelButton = document.getElementById('cancel-mapping-btn');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => this.hide());
    }
    
    // Field mapping selects
    document.querySelectorAll('.field-mapping-select').forEach(select => {
      select.addEventListener('change', () => {
        this.updateCurrentMapping();
        this.updatePreview();
      });
    });
    
    // Refresh preview button
    const refreshButton = document.getElementById('refresh-preview-btn');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => this.updatePreview());
    }
    
    // Export CSV button
    const exportButton = document.getElementById('export-csv-btn');
    if (exportButton) {
      exportButton.addEventListener('click', () => this.exportCardForgeCSV());
    }
    
    // Click outside to close
    this.modalElement.addEventListener('click', (e) => {
      if (e.target === this.modalElement) {
        this.hide();
      }
    });
    
    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });
    
    // CSV Upload functionality
    this.setupCsvUpload();
  }
  
  /**
   * Setup CSV drag & drop upload functionality
   */
  setupCsvUpload() {
    const dropZone = document.getElementById('csv-drop-zone');
    const fileInput = document.getElementById('csv-file-input');
    const browseLink = document.getElementById('browse-csv');
    
    if (!dropZone || !fileInput || !browseLink) return;
    
    // Browse files click
    browseLink.addEventListener('click', () => {
      fileInput.click();
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleCsvFile(file);
      }
    });
    
    // Drag & drop events
    dropZone.addEventListener('click', () => {
      fileInput.click();
    });
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
          this.handleCsvFile(file);
        } else {
          alert('Please upload a CSV file.');
        }
      }
    });
  }
  
  /**
   * Handle CSV file upload and processing
   */
  handleCsvFile(file) {
    console.log('📁 Processing CSV file:', file.name);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target.result;
        
        // Parse CSV data
        const csvData = this.parseCSV(csvText);
        
        if (csvData.length === 0) {
          alert('CSV file appears to be empty or invalid.');
          return;
        }
        
        console.log('✅ CSV loaded:', csvData.length, 'rows');
        
        // Store the data
        this.rawData = csvData;
        
        // Hide upload section and show mapping interface
        document.getElementById('csv-upload-section').style.display = 'none';
        document.getElementById('mapping-interface').style.display = 'block';
        
        // Analyze and populate the interface
        this.analyzeAndPopulate(csvData);
        
      } catch (error) {
        console.error('❌ Error processing CSV:', error);
        alert('Error processing CSV file. Please check the format.');
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
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const row = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      rows.push(row);
    }
    
    return rows;
  }
  
  /**
   * Analyze CSV data and populate the interface
   */
  analyzeAndPopulate(csvData) {
    // Use headliner crafter to analyze the data
    if (window.headlinerCrafter) {
      const analysis = window.headlinerCrafter.analyzeRawData(csvData);
      this.populateInterface(analysis, csvData);
      this.updatePreview();
    }
  }

  /**
   * Update current mapping from UI
   */
  updateCurrentMapping() {
    this.currentMapping = this.getCurrentMappingConfig();
  }

  /**
   * Export CardForge CSV directly
   */
  exportCardForgeCSV() {
    console.log('📥 Exporting CardForge CSV...');
    
    try {
      if (!this.rawData || this.rawData.length === 0) {
        alert('No data to export. Please upload a CSV file first.');
        return;
      }
      
      // Get current mapping configuration
      const mappingConfig = this.getCurrentMappingConfig();
      
      // Transform data using headliner crafter
      if (window.headlinerCrafter) {
        const transformedData = window.headlinerCrafter.transformData(this.rawData, mappingConfig);
        
        if (transformedData && transformedData.length > 0) {
          // Export to CardForge CSV format
          const csvContent = window.headlinerCrafter.exportToCardForgeCSV(transformedData);
          
          // Download the file
          this.downloadCSV(csvContent, 'cardforge-export.csv');
          
          console.log(`✅ Exported ${transformedData.length} rows to CardForge CSV`);
          alert(`Successfully exported ${transformedData.length} locales to CardForge CSV!`);
          
        } else {
          alert('No data was transformed. Please check your mapping configuration.');
        }
      } else {
        alert('Headliner Crafter not available. Please refresh the page.');
      }
      
    } catch (error) {
      console.error('❌ Error exporting CSV:', error);
      alert('Error exporting CSV: ' + error.message);
    }
  }
  
  /**
   * Download CSV content as file
   */
  downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  /**
   * Submit mapping for approval
   */
  submitForApproval() {
    if (!window.approvalWorkflow || !window.headlinerCrafter) {
      alert('Approval system not available');
      return;
    }
    
    const description = document.getElementById('approval-description').value || 'Custom mapping configuration';
    const newConfig = this.buildMappingConfig();
    const previousConfig = window.headlinerCrafter.mappingConfig;
    
    try {
      const requestId = window.approvalWorkflow.createApprovalRequest(
        newConfig,
        previousConfig,
        description
      );
      
      console.log(`✅ Submitted mapping for approval: ${requestId}`);
      alert(`Mapping submitted for approval!\nRequest ID: ${requestId}`);
      
      this.hide();
      
    } catch (error) {
      console.error('❌ Error submitting for approval:', error);
      alert('Error submitting for approval: ' + error.message);
    }
  }

  /**
   * Save mapping as draft
   */
  saveDraft() {
    console.log('💾 Saving mapping draft...');
    
    const config = this.buildMappingConfig();
    
    // Save to localStorage for now
    localStorage.setItem('headliner_crafter_draft', JSON.stringify({
      config: config,
      savedAt: new Date().toISOString()
    }));
    
    alert('Mapping saved as draft!');
  }

  /**
   * Build complete mapping configuration
   * @returns {Object} Complete mapping configuration
   */
  buildMappingConfig() {
    const baseConfig = window.headlinerCrafter ? 
      JSON.parse(JSON.stringify(window.headlinerCrafter.mappingConfig)) : 
      { rules: [], localeOverrides: {}, globalSettings: {} };
    
    // Update default mapping rule
    const defaultRule = baseConfig.rules.find(rule => rule.condition === 'default');
    if (defaultRule) {
      defaultRule.mapping = this.currentMapping;
    }
    
    return baseConfig;
  }

  /**
   * Refresh preview (public method)
   */
  refreshPreview() {
    this.updatePreview();
  }
}

// Global instance
window.MappingModal = MappingModal;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  if (!window.mappingModal) {
    window.mappingModal = new MappingModal();
    console.log('🎨 Mapping Modal initialized');
  }
});

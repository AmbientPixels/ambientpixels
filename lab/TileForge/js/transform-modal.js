// TileForge Transform Modal Module
// Handles UI for localization data transformation

/**
 * Transform Modal Manager
 * Integrates with TileForge's existing modal system
 */
class TransformModal {
  constructor() {
    this.isOpen = false;
    this.onTransformComplete = null;
    this.mappingFile = null;
    this.sourceFile = null;
  }

  /**
   * Show transformation modal
   * @param {Function} onComplete - Callback when transformation is complete
   */
  show(onComplete) {
    this.onTransformComplete = onComplete;
    this.isOpen = true;
    
    console.log('🔄 Attempting to show transform modal...');
    console.log('Modal class available:', typeof window.Modal !== 'undefined');
    
    // Use TileForge's existing modal system (Modal class)
    if (typeof window.Modal !== 'undefined') {
      try {
        this.showWithTileForgeModal();
      } catch (error) {
        console.error('Error with TileForge modal system:', error);
        // Fallback to direct creation
        this.createModal();
      }
    } else {
      // Fallback: create modal directly
      console.log('Using fallback modal creation');
      this.createModal();
    }
  }

  /**
   * Get modal content HTML
   */
  getModalContent() {
    return `
      <div class="transform-explanation">
        <p><i class="fas fa-info-circle"></i> Your CSV needs transformation to work with TileForge. Please upload both files:</p>
      </div>
      
      <div class="transform-inputs">
        <div class="transform-input-group">
          <label for="mapping-file-input">
            <i class="fas fa-table"></i> Mapping Table CSV
            <span class="input-description">Language → Locale mapping (Language, Country, LanguageLocale)</span>
          </label>
          <div class="file-input-wrapper">
            <input type="file" id="mapping-file-input" accept=".csv" />
            <div class="file-status" id="mapping-status">No file selected</div>
          </div>
        </div>
        
        <div class="transform-input-group">
          <label for="source-file-input">
            <i class="fas fa-file-text"></i> Source Localization CSV
            <span class="input-description">Your localization data (Language, Region, Title, MiniFAD)</span>
          </label>
          <div class="file-input-wrapper">
            <input type="file" id="source-file-input" accept=".csv" />
            <div class="file-status" id="source-status">No file selected</div>
          </div>
        </div>
      </div>
      
      <div class="transform-preview" id="transform-preview" style="display: none;">
        <h4><i class="fas fa-eye"></i> Transformation Preview</h4>
        <div class="preview-stats" id="preview-stats"></div>
        <div class="preview-table-wrapper">
          <table id="preview-table" class="preview-table">
            <thead></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      
      <div class="transform-error" id="transform-error" style="display: none;">
        <i class="fas fa-exclamation-triangle"></i>
        <span id="error-message"></span>
      </div>
    `;
  }

  /**
   * Show modal using TileForge's modal system
   */
  showWithTileForgeModal() {
    const modalContent = this.getModalContent();
    
    this.tileForgeModal = window.Modal.createModal({
      id: 'transform-modal',
      title: 'Transform Localization Data',
      content: modalContent,
      size: 'large',
      type: 'default',
      closable: true,
      backdrop: true,
      buttons: [
        {
          text: 'Cancel',
          class: 'btn-secondary',
          action: () => this.hide()
        },
        {
          text: 'Transform & Use Data',
          class: 'btn-primary',
          id: 'transform-btn',
          disabled: true,
          action: () => this.runTransform()
        }
      ],
      onShow: () => {
        this.bindEvents();
        console.log('🔄 Transform modal opened');
      },
      onHide: () => {
        this.reset();
      }
    });
    
    this.tileForgeModal.show();
  }

  /**
   * Hide transformation modal
   */
  hide() {
    console.log('🔴 Hide method called');
    this.isOpen = false;
    
    if (this.tileForgeModal) {
      this.tileForgeModal.hide();
      this.tileForgeModal = null;
    } else {
      const modal = document.getElementById('transform-modal');
      if (modal) {
        console.log('🔴 Hiding modal with aggressive styling override');
        // Use aggressive styling to override the !important CSS rules
        modal.style.display = 'none !important';
        modal.style.visibility = 'hidden !important';
        modal.style.opacity = '0 !important';
        modal.style.pointerEvents = 'none !important';
        // Alternative: remove the modal completely
        modal.remove();
        console.log('✅ Modal removed from DOM');
      } else {
        console.log('❌ Modal element not found');
      }
    }
    
    this.reset();
    console.log('✅ Hide method completed');
  }

  /**
   * Create modal HTML structure
   */
  createModal() {
    console.log('📝 Creating modal HTML structure...');
    
    // Check if modal already exists
    const existingModal = document.getElementById('transform-modal');
    if (existingModal) {
      console.log('Modal already exists, showing it');
      existingModal.style.display = 'block';
      this.bindEvents();
      return;
    }

    const modalHTML = `
      <div id="transform-modal" class="modal-overlay">
        <div class="modal-content transform-modal-content">
          <div class="modal-header">
            <h3><i class="fas fa-exchange-alt"></i> Transform Localization Data</h3>
            <button class="modal-close">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <div class="modal-body">
            <div class="transform-explanation">
              <p><i class="fas fa-info-circle"></i> Your CSV needs transformation to work with TileForge. Please upload both files:</p>
            </div>
            
            <div class="transform-inputs">
              <div class="transform-input-group">
                <label for="mapping-file-input">
                  <i class="fas fa-table"></i> Mapping Table CSV
                  <span class="input-description">Language → Locale mapping (Language, Country, LanguageLocale)</span>
                </label>
                <div class="file-input-wrapper">
                  <input type="file" id="mapping-file-input" accept=".csv" />
                  <div class="file-status" id="mapping-status">No file selected</div>
                </div>
              </div>
              
              <div class="transform-input-group">
                <label for="source-file-input">
                  <i class="fas fa-file-text"></i> Source Localization CSV
                  <span class="input-description">Your localization data (Language, Region, Title, MiniFAD)</span>
                </label>
                <div class="file-input-wrapper">
                  <input type="file" id="source-file-input" accept=".csv" />
                  <div class="file-status" id="source-status">No file selected</div>
                </div>
              </div>
            </div>
            
            <div class="transform-preview" id="transform-preview" style="display: none;">
              <h4><i class="fas fa-eye"></i> Transformation Preview</h4>
              <div class="preview-stats" id="preview-stats"></div>
              <div class="preview-table-wrapper">
                <table id="preview-table" class="preview-table">
                  <thead></thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
            
            <div class="transform-error" id="transform-error" style="display: none;">
              <i class="fas fa-exclamation-triangle"></i>
              <span id="error-message"></span>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-secondary">
              Cancel
            </button>
            <button class="btn btn-primary" id="transform-btn" disabled>
              <i class="fas fa-magic"></i> Transform & Use Data
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    console.log('✅ Modal HTML inserted into DOM');
    
    // Ensure modal is visible with aggressive styling
    const modal = document.getElementById('transform-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
      modal.style.zIndex = '999999';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.visibility = 'visible';
      modal.style.opacity = '1';
      console.log('✅ Modal display set with aggressive styling');
      console.log('Modal computed style:', window.getComputedStyle(modal).display);
      console.log('Modal position in DOM:', modal.getBoundingClientRect());
    }
    
    this.bindEvents();
    console.log('✅ Event listeners bound');
  }

  /**
   * Bind event listeners for modal interactions
   */
  bindEvents() {
    console.log('🔗 Binding event listeners...');
    
    const mappingInput = document.getElementById('mapping-file-input');
    const sourceInput = document.getElementById('source-file-input');
    const closeButton = document.querySelector('#transform-modal .modal-close');
    const cancelButton = document.querySelector('#transform-modal .btn-secondary');
    const modal = document.getElementById('transform-modal');

    // File input events
    if (mappingInput && sourceInput) {
      mappingInput.addEventListener('change', (e) => this.handleFileSelect(e, 'mapping'));
      sourceInput.addEventListener('change', (e) => this.handleFileSelect(e, 'source'));
      console.log('✅ File input event listeners bound successfully');
    } else {
      console.error('❌ Could not find file input elements:', {
        mappingInput: !!mappingInput,
        sourceInput: !!sourceInput
      });
    }

    // Close button events
    if (closeButton) {
      closeButton.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('🔴 Close button clicked');
        this.hide();
      });
      console.log('✅ Close button event listener bound');
    }

    if (cancelButton) {
      cancelButton.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('🔴 Cancel button clicked');
        this.hide();
      });
      console.log('✅ Cancel button event listener bound');
    }

    // Click outside to close
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          console.log('🔴 Clicked outside modal');
          this.hide();
        }
      });
      console.log('✅ Click outside to close event listener bound');
    }

    // Transform button event
    const transformButton = document.getElementById('transform-btn');
    if (transformButton) {
      transformButton.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('🔄 Transform button clicked');
        this.runTransform();
      });
      console.log('✅ Transform button event listener bound');
    }

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('transform-modal')) {
        console.log('🔴 Escape key pressed');
        this.hide();
      }
    });
    console.log('✅ Escape key event listener bound');
  }

  /**
   * Handle file selection
   * @param {Event} event - File input change event
   * @param {string} type - File type ('mapping' or 'source')
   */
  handleFileSelect(event, type) {
    const file = event.target.files[0];
    const statusElement = document.getElementById(`${type}-status`);
    
    if (!file) {
      statusElement.textContent = 'No file selected';
      statusElement.className = 'file-status';
      if (type === 'mapping') this.mappingFile = null;
      if (type === 'source') this.sourceFile = null;
      this.updateTransformButton();
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      statusElement.textContent = 'Please select a CSV file';
      statusElement.className = 'file-status error';
      return;
    }

    statusElement.textContent = `✓ ${file.name}`;
    statusElement.className = 'file-status success';
    
    if (type === 'mapping') this.mappingFile = file;
    if (type === 'source') this.sourceFile = file;
    
    this.updateTransformButton();
    
    // Auto-run transformation if both files are loaded
    if (this.mappingFile && this.sourceFile) {
      setTimeout(() => this.previewTransform(), 100);
    }
  }

  /**
   * Update transform button state
   */
  updateTransformButton() {
    // For TileForge modal system, find button in modal footer
    const transformBtn = document.querySelector('#transform-modal .btn-primary') || 
                        document.getElementById('transform-btn');
    if (transformBtn) {
      transformBtn.disabled = !(this.mappingFile && this.sourceFile);
    }
  }

  /**
   * Preview transformation results
   */
  async previewTransform() {
    if (!this.mappingFile || !this.sourceFile) return;

    try {
      this.hideError();
      
      // Read files
      const mappingText = await this.readFile(this.mappingFile);
      const sourceText = await this.readFile(this.sourceFile);
      
      // Load data into transformer
      const mappingLoaded = window.locTransformer.loadMappingTable(mappingText);
      const sourceLoaded = window.locTransformer.loadSourceData(sourceText);
      
      if (!mappingLoaded || !sourceLoaded) {
        this.showError('Failed to load CSV files. Please check file format.');
        return;
      }
      
      // Run transformation
      const result = window.locTransformer.transform();
      
      if (!result.success) {
        this.showError(result.error);
        return;
      }
      
      // Show preview
      this.showPreview(result.data, result.stats);
      
    } catch (error) {
      this.showError('Preview failed: ' + error.message);
    }
  }

  /**
   * Read file as text
   * @param {File} file - File to read
   * @returns {Promise<string>} File content as text
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Show transformation preview
   * @param {Array} data - Transformed data
   * @param {Object} stats - Transformation statistics
   */
  showPreview(data, stats) {
    const previewSection = document.getElementById('transform-preview');
    const statsElement = document.getElementById('preview-stats');
    const table = document.getElementById('preview-table');
    
    if (!previewSection || !statsElement || !table) return;
    
    // Show stats
    statsElement.innerHTML = `
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">${stats.totalRows}</span>
          <span class="stat-label">Total Locales</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${stats.withRegion}</span>
          <span class="stat-label">Region-Specific</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${stats.withoutRegion}</span>
          <span class="stat-label">Language-Only</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${stats.duplicatesRemoved}</span>
          <span class="stat-label">Duplicates Removed</span>
        </div>
      </div>
    `;
    
    // Show table preview (first 10 rows)
    const previewData = data.slice(0, Math.min(10, data.length));
    const headers = Object.keys(previewData[0] || {});
    
    table.querySelector('thead').innerHTML = `
      <tr>
        ${headers.map(header => `<th>${header}</th>`).join('')}
      </tr>
    `;
    
    table.querySelector('tbody').innerHTML = previewData.map(row => `
      <tr>
        ${headers.map(header => `<td>${this.escapeHtml(row[header])}</td>`).join('')}
      </tr>
    `).join('');
    
    previewSection.style.display = 'block';
  }

  /**
   * Run final transformation and pass to TileForge
   */
  async runTransform() {
    try {
      const result = window.locTransformer.transform();
      
      if (!result.success) {
        this.showError(result.error);
        return;
      }
      
      // Convert to CSV format for TileForge
      const csvData = window.locTransformer.exportCSV();
      
      // Call completion callback
      if (this.onTransformComplete) {
        this.onTransformComplete(csvData, result.stats);
      }
      
      this.hide();
      
    } catch (error) {
      this.showError('Transformation failed: ' + error.message);
    }
  }

  /**
   * Show error message
   * @param {string} message - Error message to display
   */
  showError(message) {
    const errorElement = document.getElementById('transform-error');
    const messageElement = document.getElementById('error-message');
    
    if (errorElement && messageElement) {
      messageElement.textContent = message;
      errorElement.style.display = 'block';
    }
  }

  /**
   * Hide error message
   */
  hideError() {
    const errorElement = document.getElementById('transform-error');
    if (errorElement) {
      errorElement.style.display = 'none';
    }
  }

  /**
   * Escape HTML for safe display
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Reset modal state
   */
  reset() {
    this.mappingFile = null;
    this.sourceFile = null;
    this.onTransformComplete = null;
    
    // Reset UI elements
    const mappingInput = document.getElementById('mapping-file-input');
    const sourceInput = document.getElementById('source-file-input');
    const mappingStatus = document.getElementById('mapping-status');
    const sourceStatus = document.getElementById('source-status');
    const previewSection = document.getElementById('transform-preview');
    
    if (mappingInput) mappingInput.value = '';
    if (sourceInput) sourceInput.value = '';
    if (mappingStatus) {
      mappingStatus.textContent = 'No file selected';
      mappingStatus.className = 'file-status';
    }
    if (sourceStatus) {
      sourceStatus.textContent = 'No file selected';
      sourceStatus.className = 'file-status';
    }
    if (previewSection) previewSection.style.display = 'none';
    
    this.hideError();
    this.updateTransformButton();
    
    // Reset transformer
    window.locTransformer.reset();
  }
}

// Initialize global transform modal instance
window.transformModal = new TransformModal();

console.log('🔄 Transform Modal module loaded');

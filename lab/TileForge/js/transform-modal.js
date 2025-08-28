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
    
    console.log('🔁 Attempting to show transform modal...');
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
        <p><i class="fas fa-info-circle"></i> Quick Transform converts generic localization (e.g., "English", optional Region) into TileForge CSV (Locale, items/0/title, items/0/subtitle). If you need advanced field mapping and per-locale validation, use <button id="open-headliner-btn" class="linklike" aria-label="Open Headliner Mapper">Headliner Mapper</button>.</p>
      </div>

      <div class="callout info" id="schema-help">
        <p><strong>Required schemas</strong></p>
        <ul>
          <li><strong>Mapping Table CSV</strong>: Language, Country, LanguageLocale</li>
          <li><strong>Source Localization CSV</strong>: Language, Region (optional), Title, MiniFAD</li>
        </ul>
        <p class="small">Transform will warn if any required columns are missing.</p>
      </div>
      
      <details class="callout" id="tool-diff">
        <summary><strong>What’s the difference?</strong></summary>
        <ul>
          <li><strong>Transform Data (this)</strong>: Quick guided convert for standard schemas. Requires exact column names. Good for fast CSV-to-TileForge.</li>
          <li><strong>Headliner Mapper</strong>: Advanced field mapping, character checks, multi-locale validation, and flexible schemas. Use when columns differ or you need fine control.</li>
        </ul>
      </details>
      
      <div class="transform-inputs">
        <div class="transform-input-group">
          <label for="mapping-file-input">
            <i class="fas fa-table"></i> Mapping Table CSV
            <span class="input-description">Language → Locale mapping (Language, Country, LanguageLocale)</span>
          </label>
          <div class="file-input-wrapper">
            <input type="file" id="mapping-file-input" accept=".csv" />
          </div>
        </div>
        
        <div class="transform-input-group">
          <label for="source-file-input">
            <i class="fas fa-file-text"></i> Source Localization CSV
            <span class="input-description">Your localization data (Language, Region, Title, MiniFAD)</span>
          </label>
          <div class="file-input-wrapper">
            <input type="file" id="source-file-input" accept=".csv" />
          </div>
        </div>
      </div>

      <div id="schema-check" class="file-status" style="display:none;"></div>
      
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

      <div class="callout warning" id="limits-note">
        <p><strong>Limitations</strong></p>
        <ul>
          <li>Assumes column names match exactly as listed above.</li>
          <li>Does not rename or infer arbitrary columns.</li>
          <li>One-to-many mapping by Language expands to all supported locales; duplicates are filtered.</li>
        </ul>
        <p class="small">Need flexible mapping, color-coded character checks, or per-locale fixing? Open <button id="open-headliner-btn-2" class="linklike">Headliner Mapper</button>.</p>
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
          text: 'Open Headliner Mapper',
          class: 'btn-secondary',
          action: () => this.openHeadliner()
        },
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
        console.log('🔁 Transform modal opened');
      },
      onHide: () => {
        this.reset();
      }
    });
    
    this.tileForgeModal.show();
  }

  /**
   * Create modal HTML structure
   */
  createModal() {
    console.log('📝 Creating modal HTML structure...');
    
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
              <p><i class="fas fa-magic"></i> <strong>CSV Transformation Tool</strong> — Quick transform for standard schemas. For advanced mapping and validation, use <button id="open-headliner-btn" class="linklike">Headliner Mapper</button>.</p>
            </div>

            <div class="callout info" id="schema-help">
              <p><strong>Required schemas</strong></p>
              <ul>
                <li><strong>Mapping</strong>: Language, Country, LanguageLocale</li>
                <li><strong>Source</strong>: Language, Region (optional), Title, MiniFAD</li>
              </ul>
            </div>
            
            <details class="callout" id="tool-diff-fallback">
              <summary><strong>What’s the difference?</strong></summary>
              <ul>
                <li><strong>Transform Data (this)</strong>: Quick guided convert for standard schemas. Requires exact column names. Good for fast CSV-to-TileForge.</li>
                <li><strong>Headliner Mapper</strong>: Advanced field mapping, character checks, multi-locale validation, and flexible schemas. Use when columns differ or you need fine control.</li>
              </ul>
            </details>
            
            <div class="transform-inputs">
              <div class="transform-input-group">
                <label for="mapping-file-input">
                  <i class="fas fa-table"></i> Mapping Table CSV
                </label>
                <div class="file-drop-zone" id="mapping-drop-zone">
                  <div class="drop-zone-content">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>Drop CSV file here</p>
                    <span>or</span>
                    <button type="button" class="browse-btn" onclick="document.getElementById('mapping-file-input').click()">
                      Browse Files
                    </button>
                  </div>
                  <input type="file" id="mapping-file-input" accept=".csv" style="display: none;" />
                </div>
                <div class="file-status" id="mapping-status">
                  <span class="status-text">No file selected</span>
                </div>
              </div>
              
              <div class="transform-input-group">
                <label for="source-file-input">
                  <i class="fas fa-file-csv"></i> Source Data CSV
                </label>
                <div class="file-drop-zone" id="source-drop-zone">
                  <div class="drop-zone-content">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>Drop CSV file here</p>
                    <span>or</span>
                    <button type="button" class="browse-btn" onclick="document.getElementById('source-file-input').click()">
                      Browse Files
                    </button>
                  </div>
                  <input type="file" id="source-file-input" accept=".csv" style="display: none;" />
                </div>
                <div class="file-status" id="source-status">
                  <span class="status-text">No file selected</span>
                </div>
              </div>
            </div>

            <div id="schema-check" class="file-status" style="display:none;"></div>
            
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

            <div class="callout warning" id="limits-note">
              <p><strong>Limitations</strong></p>
              <ul>
                <li>Assumes exact column names.</li>
                <li>No arbitrary column remapping.</li>
                <li>Language-only rows expand to all supported locales; duplicates removed.</li>
              </ul>
              <p class="small">Need more control? Open <button id="open-headliner-btn-2" class="linklike">Headliner Mapper</button>.</p>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-secondary" id="open-headliner-footer">Open Headliner Mapper</button>
            <button class="btn btn-secondary">Cancel</button>
            <button class="btn btn-primary" id="transform-btn" disabled>
              <i class="fas fa-magic"></i> Transform & Use Data
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    console.log('✅ Modal HTML inserted into DOM');
    
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
        console.log('🔁 Transform button clicked');
        this.runTransform();
      });
      console.log('✅ Transform button event listener bound');
    }

    // Headliner Mapper buttons
    const hl1 = document.getElementById('open-headliner-btn');
    const hl2 = document.getElementById('open-headliner-btn-2');
    const hlFooter = document.getElementById('open-headliner-footer');
    [hl1, hl2, hlFooter].forEach(btn => {
      if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); this.openHeadliner(); });
    });

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('transform-modal')) {
        console.log('🔴 Escape key pressed');
        this.hide();
      }
    });
    console.log('✅ Escape key event listener bound');

    // Drag and drop events
    this.bindDragDropEvents();
    console.log('✅ Drag and drop events bound');
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
      if (type === 'mapping') this.mappingFile = null;
      if (type === 'source') this.sourceFile = null;
      this.updateTransformButton();
      this.renderSchemaCheck();
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      if (file.name.toLowerCase().endsWith('.xml')) {
        // Allow XML files, do not show CSV warning or success
      } else {
        // Do not show any status or error
      }
      return;
    }

    // Do not show any status or success
    if (type === 'mapping') this.mappingFile = file;
    if (type === 'source') this.sourceFile = file;
    this.updateTransformButton();
    if (this.mappingFile && this.sourceFile) {
      setTimeout(() => this.previewTransform(), 100);
    }
    this.renderSchemaCheck();
  }

  /**
   * Preview transformation results
   */
  async previewTransform() {
    if (!this.mappingFile || !this.sourceFile) return;

    try {
      this.hideError();
      
      const mappingText = await this.readFile(this.mappingFile);
      const sourceText = await this.readFile(this.sourceFile);
      
      const mappingLoaded = window.locTransformer.loadMappingTable(mappingText);
      const sourceLoaded = window.locTransformer.loadSourceData(sourceText);
      
      if (!mappingLoaded || !sourceLoaded) {
        this.showError('Failed to load CSV files. Please check file format.');
        return;
      }

      const schemaOk = this.validateSchemas();
      this.renderSchemaCheck(schemaOk);
      if (!schemaOk.ok) {
        const msg = this.composeSchemaError(schemaOk);
        this.showError(msg);
        return;
      }
      
      const result = window.locTransformer.transform();
      
      if (!result.success) {
        this.showError(result.error + ' Tip: Try Headliner Mapper for flexible mapping.');
        return;
      }
      
      this.showPreview(result.data, result.stats);
      
    } catch (error) {
      this.showError('Preview failed: ' + error.message);
    }
  }

  /**
   * Run final transformation and pass to TileForge
   */
  async runTransform() {
    try {
      const schemaOk = this.validateSchemas();
      if (!schemaOk.ok) {
        const msg = this.composeSchemaError(schemaOk);
        this.showError(msg);
        return;
      }

      const result = window.locTransformer.transform();
      
      if (!result.success) {
        this.showError(result.error);
        return;
      }
      
      const csvData = window.locTransformer.exportCSV();
      
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
   * Reset modal state
   */
  reset() {
    this.mappingFile = null;
    this.sourceFile = null;
    this.onTransformComplete = null;
    
    const mappingInput = document.getElementById('mapping-file-input');
    const sourceInput = document.getElementById('source-file-input');
    const mappingStatus = document.getElementById('mapping-status');
    const sourceStatus = document.getElementById('source-status');
    const previewSection = document.getElementById('transform-preview');
    const schemaCheck = document.getElementById('schema-check');
    
    if (mappingInput) mappingInput.value = '';
    if (sourceInput) sourceInput.value = '';
    if (previewSection) previewSection.style.display = 'none';
    if (schemaCheck) { schemaCheck.style.display = 'none'; schemaCheck.innerHTML = ''; }
    
    this.hideError();
    this.updateTransformButton();
    
    window.locTransformer.reset();
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
   * Validate schemas
   */
  validateSchemas() {
    // Inspect parsed rows from locTransformer
    const mappingRows = window.locTransformer.mappingRows || [];
    const sourceRows = window.locTransformer.sourceRows || [];
    const mapHeaders = mappingRows[0] ? Object.keys(mappingRows[0]) : [];
    const srcHeaders = sourceRows[0] ? Object.keys(sourceRows[0]) : [];

    const requiredMap = ['Language', 'Country', 'LanguageLocale'];
    const requiredSrc = ['Language', 'Title', 'MiniFAD']; // Region optional

    const mapMissing = requiredMap.filter(h => !mapHeaders.includes(h));
    const srcMissing = requiredSrc.filter(h => !srcHeaders.includes(h));

    return { ok: mapMissing.length === 0 && srcMissing.length === 0, mapMissing, srcMissing, mapHeaders, srcHeaders };
  }

  /**
   * Compose schema error message
   */
  composeSchemaError(state) {
    const parts = [];
    if (state.mapMissing.length) parts.push(`Mapping table missing: ${state.mapMissing.join(', ')}`);
    if (state.srcMissing.length) parts.push(`Source CSV missing: ${state.srcMissing.join(', ')}`);
    return parts.join(' • ') + '. You can fix your CSVs or use Headliner Mapper for flexible mapping.';
  }

  /**
   * Render schema check
   */
  renderSchemaCheck(state) {
    const el = document.getElementById('schema-check');
    if (!el) return;
    const s = state || this.validateSchemas();

    if (!this.mappingFile && !this.sourceFile) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    const okIcon = '<span class="status-pill success">OK</span>';
    const warnIcon = '<span class="status-pill warning">Missing</span>';

    const mapSummary = s.mapMissing.length ? warnIcon + ' Mapping: ' + s.mapMissing.join(', ') : okIcon + ' Mapping schema OK';
    const srcSummary = s.srcMissing.length ? warnIcon + ' Source: ' + s.srcMissing.join(', ') : okIcon + ' Source schema OK';

    el.innerHTML = `<div>${mapSummary}</div><div>${srcSummary}</div>`;
    el.style.display = 'block';
  }

  /**
   * Open Headliner Mapper
   */
  openHeadliner() {
    try {
      if (!window.mappingModal) {
        if (window.Modal && typeof Modal.alert === 'function') {
          Modal.alert('Headliner Mapper is not properly initialized. Please refresh the page.', 'error');
        } else {
          alert('Headliner Mapper is not properly initialized. Please refresh the page.');
        }
        return;
      }
      window.mappingModal.show(null, (transformedData, stats) => {
        if (transformedData && transformedData.length > 0) {
          const csvText = window.headlinerCrafter.exportToCardForgeCSV(transformedData);
          if (typeof window.processCsvData === 'function') {
            window.processCsvData(csvText, 'Headliner Crafter Output', transformedData.length);
          }
          if (window.Modal && typeof Modal.alert === 'function') {
            Modal.alert(`Successfully processed ${transformedData.length} locales through Headliner Mapper!`, 'success');
          } else {
            alert(`Successfully processed ${transformedData.length} locales through Headliner Mapper!`);
          }
        }
      });
    } catch (error) {
      console.error('❌ Error opening Headliner Mapper from Transform modal:', error);
      if (window.Modal && typeof Modal.alert === 'function') {
        Modal.alert('Error opening Headliner Mapper: ' + error.message, 'error');
      } else {
        alert('Error opening Headliner Mapper: ' + error.message);
      }
    }
  }
}

// Initialize global transform modal instance
window.transformModal = new TransformModal();

console.log('🔁 Transform Modal module loaded');

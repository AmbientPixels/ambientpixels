// TileForge Tile Rendering Module
// Handles tile creation, rendering, and visual updates

// Enhanced text analysis using visual measurement instead of character count
function analyzeText(title, subtitle) {
  // Use the new visual measurement system
  return analyzeTextVisually(title, subtitle);
}

// Create tile element with dedicated editor
function createTile(locale, title, subtitle, analysis) {
  const tileContainer = document.createElement('div');
  tileContainer.className = 'tile-container';
  tileContainer.dataset.locale = locale;
  
  // Create the actual tile preview
  const tile = document.createElement('div');
  tile.className = `tile-preview ${analysis.status}`;
  tile.dataset.locale = locale;
  tile.dataset.originalTitle = title;
  tile.dataset.originalSubtitle = subtitle;
  
  // Status badge
  const badge = document.createElement('div');
  badge.className = `tile-status-badge ${analysis.status}`;
  badge.textContent = analysis.status === 'clean' ? '✓' : 
                     analysis.status === 'near-limit' ? '⚠' : '⚠';
  
  // Tile overlay container (positions text at bottom)
  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';
  
  // Title and subtitle inside overlay (read-only display)
  const titleEl = document.createElement('div');
  titleEl.className = 'tile-title';
  titleEl.textContent = title;
  
  const subtitleEl = document.createElement('div');
  subtitleEl.className = 'tile-subtitle';
  subtitleEl.textContent = subtitle;
  
  // Assemble tile structure
  overlay.appendChild(titleEl);
  overlay.appendChild(subtitleEl);
  tile.appendChild(badge);
  tile.appendChild(overlay);
  
  // Set background image if available
  if (currentImageSrc) {
    tile.style.backgroundImage = `url(${currentImageSrc})`;
  }
  
  // Create editing content container (like existing live editor)
  const editingContent = document.createElement('div');
  editingContent.className = 'editing-content';
  
  // Tile preview container (left side)
  const previewContainer = document.createElement('div');
  previewContainer.className = 'preview-tile-container';
  previewContainer.appendChild(tile);
  
  // Editing controls container (right side)
  const editingControls = document.createElement('div');
  editingControls.className = 'editing-controls';
  
  // Title input group
  const titleGroup = document.createElement('div');
  titleGroup.className = 'input-group';
  titleGroup.innerHTML = `
    <label>Headline</label>
    <div class="input-container">
      <input type="text" class="card-title-input" value="${title}" placeholder="Enter headline..." maxlength="50" />
      <div class="character-info">
        <div class="char-count">
          <span class="count">${title.length}</span>/15 
          <span class="w-reference" title="Max W characters: WWWWWWWWWWWWWWW">W</span>
        </div>
        <div class="w-count-display">Max: <code>WWWWWWWWWWWWWWW</code></div>
      </div>
    </div>
  `;
  
  // Subtitle input group
  const subtitleGroup = document.createElement('div');
  subtitleGroup.className = 'input-group';
  subtitleGroup.innerHTML = `
    <label>Subheadline</label>
    <div class="input-container">
      <input type="text" class="card-subtitle-input" value="${subtitle}" placeholder="Enter subheadline..." maxlength="50" />
      <div class="character-info">
        <div class="char-count">
          <span class="count">${subtitle.length}</span>/15 
          <span class="w-reference" title="Max W characters: WWWWWWWWWWWWWWW">W</span>
        </div>
        <div class="w-count-display">Max: <code>WWWWWWWWWWWWWWW</code></div>
      </div>
    </div>
  `;
  
  // Get input elements for event listeners
  editingControls.appendChild(titleGroup);
  editingControls.appendChild(subtitleGroup);
  
  const titleInput = titleGroup.querySelector('.card-title-input');
  const subtitleInput = subtitleGroup.querySelector('.card-subtitle-input');
  const titleCounter = titleGroup.querySelector('.char-count .count');
  const subtitleCounter = subtitleGroup.querySelector('.char-count .count');
  
  // Live preview updates
  titleInput.addEventListener('input', function() {
    titleEl.textContent = this.value;
    titleCounter.textContent = this.value.length;
    updateTileStatus(tile);
  });
  
  subtitleInput.addEventListener('input', function() {
    subtitleEl.textContent = this.value;
    subtitleCounter.textContent = this.value.length;
    updateTileStatus(tile);
  });
  
  // Assemble editing content (tile left, controls right)
  editingContent.appendChild(previewContainer);
  editingContent.appendChild(editingControls);
  
  // Assemble tile container
  tileContainer.appendChild(editingContent);
  
  return tileContainer;
}

// Create dedicated editor for individual tile
function createTileEditor(locale, title, subtitle, tileElement) {
  const editor = document.createElement('div');
  editor.className = 'tile-editor';
  editor.style.display = 'none';
  
  // Editor header
  const header = document.createElement('div');
  header.className = 'editor-header';
  header.innerHTML = `
    <h4>✏️ Edit ${locale}</h4>
    <button class="close-editor" onclick="closeTileEditor(this)">✕</button>
  `;
  
  // Title input group
  const titleGroup = document.createElement('div');
  titleGroup.className = 'input-group';
  titleGroup.innerHTML = `
    <label>Headline</label>
    <div class="input-container">
      <input type="text" class="title-input" value="${title}" maxlength="50" />
      <div class="char-count">
        <span class="count">${title.length}</span>/15 
        <span class="w-reference">W</span>
      </div>
    </div>
    <div class="w-count-display">Max: <code>WWWWWWWWWWWWWWW</code></div>
  `;
  
  // Subtitle input group
  const subtitleGroup = document.createElement('div');
  subtitleGroup.className = 'input-group';
  subtitleGroup.innerHTML = `
    <label>Subheadline</label>
    <div class="input-container">
      <input type="text" class="subtitle-input" value="${subtitle}" maxlength="50" />
      <div class="char-count">
        <span class="count">${subtitle.length}</span>/15 
        <span class="w-reference">W</span>
      </div>
    </div>
    <div class="w-count-display">Max: <code>WWWWWWWWWWWWWWW</code></div>
  `;
  
  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'editor-actions';
  actions.innerHTML = `
    <button class="apply-btn" onclick="applyTileChanges(this)">✓ Apply</button>
    <button class="reset-btn" onclick="resetTileEditor(this)">↺ Reset</button>
    <button class="cancel-btn" onclick="closeTileEditor(this)">✕ Cancel</button>
  `;
  
  // Assemble editor
  editor.appendChild(header);
  editor.appendChild(titleGroup);
  editor.appendChild(subtitleGroup);
  editor.appendChild(actions);
  
  // Setup live character counting
  setupEditorInputs(editor, tileElement);
  
  return editor;
}

// Toggle tile editor visibility
function toggleTileEditor(editor) {
  // Close any other open editors first
  const openEditors = document.querySelectorAll('.tile-editor[style*="block"]');
  openEditors.forEach(ed => {
    if (ed !== editor) {
      ed.style.display = 'none';
    }
  });
  
  // Toggle this editor
  editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
}

// Close tile editor
function closeTileEditor(button) {
  const editor = button.closest('.tile-editor');
  if (editor) {
    editor.style.display = 'none';
  }
}

// Apply changes from tile editor
function applyTileChanges(button) {
  const editor = button.closest('.tile-editor');
  const container = editor.closest('.tile-container');
  const tile = container.querySelector('.tile-preview');
  const locale = container.dataset.locale;
  
  const titleInput = editor.querySelector('.title-input');
  const subtitleInput = editor.querySelector('.subtitle-input');
  
  const newTitle = titleInput.value;
  const newSubtitle = subtitleInput.value;
  
  // Update tile display
  const titleEl = tile.querySelector('.tile-title');
  const subtitleEl = tile.querySelector('.tile-subtitle');
  
  if (titleEl) titleEl.textContent = newTitle;
  if (subtitleEl) subtitleEl.textContent = newSubtitle;
  
  // Update tile status
  updateTileStatus(tile);
  
  // Update CSV data
  updateCsvDataForTile(locale, tile);
  
  // Close editor
  editor.style.display = 'none';
}

// Reset tile editor to original values
function resetTileEditor(button) {
  const editor = button.closest('.tile-editor');
  const container = editor.closest('.tile-container');
  const tile = container.querySelector('.tile-preview');
  
  const originalTitle = tile.dataset.originalTitle;
  const originalSubtitle = tile.dataset.originalSubtitle;
  
  const titleInput = editor.querySelector('.title-input');
  const subtitleInput = editor.querySelector('.subtitle-input');
  const titleCount = editor.querySelector('.title-input + .char-count .count');
  const subtitleCount = editor.querySelector('.subtitle-input + .char-count .count');
  
  titleInput.value = originalTitle;
  subtitleInput.value = originalSubtitle;
  
  if (titleCount) titleCount.textContent = originalTitle.length;
  if (subtitleCount) subtitleCount.textContent = originalSubtitle.length;
  
  // Reset character count colors
  const charCounts = editor.querySelectorAll('.char-count');
  charCounts.forEach(el => el.className = 'char-count');
}

// Render locale groups with tiles
function renderLocaleGroups(csvData) {
  const container = document.getElementById('localeGroups');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Group data by locale
  const localeGroups = {};
  const analytics = { totalLocales: 0, overflowCount: 0, nearLimitCount: 0, cleanCount: 0 };
  
  csvData.forEach(row => {
    const locale = row.Locale || row.locale || 'unknown';
    const title = row['items/0/title'] || row.Title || row.title || '';
    const subtitle = row['items/0/subtitle'] || row.Subtitle || row.subtitle || '';
    
    if (!localeGroups[locale]) {
      localeGroups[locale] = [];
      analytics.totalLocales++;
    }
    
    const analysis = analyzeText(title, subtitle);
    localeGroups[locale].push({ title, subtitle, analysis });
    
    // Update analytics
    if (analysis.status === 'overflow') analytics.overflowCount++;
    else if (analysis.status === 'near-limit') analytics.nearLimitCount++;
    else analytics.cleanCount++;
  });
  
  // Create sections for each locale
  Object.entries(localeGroups).forEach(([locale, tiles]) => {
    const section = document.createElement('div');
    section.className = 'locale-section';
    
    // Section header with locale code and full name
    const header = document.createElement('h3');
    header.className = 'locale-header';
    const localeName = LOCALE_NAMES[locale] || locale;
    header.textContent = `${locale} ${localeName}`;
    
    // Tiles container
    const tilesContainer = document.createElement('div');
    tilesContainer.className = 'tiles-container';
    
    // Create tiles for this locale
    tiles.forEach(({ title, subtitle, analysis }) => {
      const tile = createTile(locale, title, subtitle, analysis);
      tilesContainer.appendChild(tile);
    });
    
    section.appendChild(header);
    section.appendChild(tilesContainer);
    container.appendChild(section);
  });
  
  // Update analytics display
  updateAnalytics(analytics);
}

// Update tile status based on current title and subtitle text
function updateTileStatus(tileElement) {
  const titleEl = tileElement.querySelector('.tile-title');
  const subtitleEl = tileElement.querySelector('.tile-subtitle');
  
  if (!titleEl || !subtitleEl) return;
  
  const title = titleEl.textContent || '';
  const subtitle = subtitleEl.textContent || '';
  const analysis = analyzeText(title, subtitle);
  
  // Update tile class
  tileElement.className = `tile-preview ${analysis.status}`;
  
  // Update status badge
  const badge = tileElement.querySelector('.tile-status-badge');
  if (badge) {
    badge.className = `tile-status-badge ${analysis.status}`;
    badge.textContent = analysis.status === 'clean' ? '✓' : 
                       analysis.status === 'near-limit' ? '⚠' : '⚠';
  }
}

// Create section editor that loads current tile text
function createSectionEditor(locale, tileData) {
  const editor = document.createElement('div');
  editor.className = 'section-editor';
  editor.dataset.locale = locale;
  
  const currentTitle = tileData ? tileData.title : '';
  const currentSubtitle = tileData ? tileData.subtitle : '';
  
  editor.innerHTML = `
    <div class="section-editor-header">
      <h4>✏️ Edit ${locale}</h4>
      <button class="toggle-section-editor" onclick="toggleSectionEditor(this)">▼</button>
    </div>
    <div class="section-editor-content" style="display: none;">
      <div class="editor-row">
        <div class="input-group">
          <label>Headline</label>
          <div class="input-container">
            <input type="text" class="section-title-input" value="${currentTitle}" maxlength="50" />
            <div class="char-count">
              <span class="count">${currentTitle.length}</span>/15 
              <span class="w-reference">W</span>
            </div>
          </div>
          <div class="w-count-display">Max: <code>WWWWWWWWWWWWWWW</code></div>
        </div>
        
        <div class="input-group">
          <label>Subheadline</label>
          <div class="input-container">
            <input type="text" class="section-subtitle-input" value="${currentSubtitle}" maxlength="50" />
            <div class="char-count">
              <span class="count">${currentSubtitle.length}</span>/15 
              <span class="w-reference">W</span>
            </div>
          </div>
          <div class="w-count-display">Max: <code>WWWWWWWWWWWWWWW</code></div>
        </div>
        
        <div class="section-editor-actions">
          <button class="apply-section-btn" onclick="applySectionChanges(this)">✓ Apply to Section</button>
          <button class="reset-section-btn" onclick="resetSectionEditor(this)">↺ Reset</button>
        </div>
      </div>
    </div>
  `;
  
  // Setup live character counting for section editor
  setupSectionEditorInputs(editor);
  
  return editor;
}

// Toggle section editor visibility
function toggleSectionEditor(button) {
  const content = button.closest('.section-editor').querySelector('.section-editor-content');
  const isVisible = content.style.display !== 'none';
  
  content.style.display = isVisible ? 'none' : 'block';
  button.textContent = isVisible ? '▼' : '▲';
}

// Apply changes from section editor to all tiles in that section
function applySectionChanges(button) {
  const editor = button.closest('.section-editor');
  const locale = editor.dataset.locale;
  const section = editor.closest('.locale-section');
  
  const titleInput = editor.querySelector('.section-title-input');
  const subtitleInput = editor.querySelector('.section-subtitle-input');
  
  const newTitle = titleInput.value;
  const newSubtitle = subtitleInput.value;
  
  // Update all tiles in this section
  const tiles = section.querySelectorAll('.tile-preview');
  tiles.forEach(tile => {
    const titleEl = tile.querySelector('.tile-title');
    const subtitleEl = tile.querySelector('.tile-subtitle');
    
    if (titleEl) titleEl.textContent = newTitle;
    if (subtitleEl) subtitleEl.textContent = newSubtitle;
    
    // Update tile status
    updateTileStatus(tile);
  });
  
  // Update CSV data for this locale
  if (currentCsvData) {
    const rows = currentCsvData.filter(row => (row.Locale || row.locale) === locale);
    rows.forEach(row => {
      row['items/0/title'] = newTitle;
      row['items/0/subtitle'] = newSubtitle;
    });
    
    // Update analytics
    updateAnalyticsFromCurrentData();
  }
}

// Reset section editor to original values
function resetSectionEditor(button) {
  const editor = button.closest('.section-editor');
  const locale = editor.dataset.locale;
  
  // Find original values from CSV data
  if (currentCsvData) {
    const row = currentCsvData.find(r => (r.Locale || r.locale) === locale);
    if (row) {
      const originalTitle = row['items/0/title'] || row.Title || row.title || '';
      const originalSubtitle = row['items/0/subtitle'] || row.Subtitle || row.subtitle || '';
      
      const titleInput = editor.querySelector('.section-title-input');
      const subtitleInput = editor.querySelector('.section-subtitle-input');
      const titleCount = editor.querySelector('.section-title-input + .char-count .count');
      const subtitleCount = editor.querySelector('.section-subtitle-input + .char-count .count');
      
      titleInput.value = originalTitle;
      subtitleInput.value = originalSubtitle;
      
      if (titleCount) titleCount.textContent = originalTitle.length;
      if (subtitleCount) subtitleCount.textContent = originalSubtitle.length;
      
      // Reset character count colors
      const charCounts = editor.querySelectorAll('.char-count');
      charCounts.forEach(el => el.className = 'char-count');
    }
  }
}

// Setup input event listeners for section editor
function setupSectionEditorInputs(editor) {
  const titleInput = editor.querySelector('.section-title-input');
  const subtitleInput = editor.querySelector('.section-subtitle-input');
  
  if (titleInput) {
    titleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update character count
      const countEl = editor.querySelector('.section-title-input + .char-count .count');
      if (countEl) {
        countEl.textContent = charCount;
      }
      
      // Update color based on W-count limits
      const charCountEl = editor.querySelector('.section-title-input + .char-count');
      if (charCountEl) {
        charCountEl.className = 'char-count';
        if (charCount > LIMITS.title.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.title.warning) {
          charCountEl.classList.add('warning');
        }
      }
    });
  }
  
  if (subtitleInput) {
    subtitleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update character count
      const countEl = editor.querySelector('.section-subtitle-input + .char-count .count');
      if (countEl) {
        countEl.textContent = charCount;
      }
      
      // Update color based on W-count limits
      const charCountEl = editor.querySelector('.section-subtitle-input + .char-count');
      if (charCountEl) {
        charCountEl.className = 'char-count';
        if (charCount > LIMITS.subtitle.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.subtitle.warning) {
          charCountEl.classList.add('warning');
        }
      }
    });
  }
}

// Update all tiles with new background image
function updateTileBackgrounds(imageSrc) {
  currentImageSrc = imageSrc;
  const tiles = document.querySelectorAll('.tile-preview');
  tiles.forEach(tile => {
    if (imageSrc) {
      tile.style.backgroundImage = `url(${imageSrc})`;
    } else {
      tile.style.backgroundImage = '';
    }
  });
}

// TileForge Live Editing Module
// Handles per-tile live editing, character counting, and real-time updates

// Setup live editing for individual tile elements
function setupTileEditing(textElement, charCountElement, tileElement) {
  if (!textElement || !charCountElement || !tileElement) return;
  
  // Handle input events for live character counting
  textElement.addEventListener('input', function() {
    const text = this.textContent;
    const charCount = text.length;
    const field = this.dataset.field;
    const locale = this.dataset.locale;
    
    // Update character count display
    const countSpan = charCountElement.querySelector('.count');
    if (countSpan) {
      countSpan.textContent = charCount;
    }
    
    // Update character count color based on W-count limits
    const limit = field === 'title' ? LIMITS.title : LIMITS.subtitle;
    charCountElement.className = `char-counter ${field}-counter`;
    
    if (charCount > limit.max) {
      charCountElement.classList.add('error');
    } else if (charCount > limit.warning) {
      charCountElement.classList.add('warning');
    }
    
    // Update tile status based on both title and subtitle
    updateTileStatus(tileElement);
    
    // Update CSV data if available
    updateCsvDataForTile(locale, tileElement);
  });
  
  // Handle focus/blur for better UX
  textElement.addEventListener('focus', function() {
    this.classList.add('editing');
    charCountElement.style.opacity = '1';
  });
  
  textElement.addEventListener('blur', function() {
    this.classList.remove('editing');
    charCountElement.style.opacity = '0.7';
  });
  
  // Prevent line breaks in contentEditable
  textElement.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.blur();
    }
  });
}

// Setup live editor panel functionality
function setupLiveEditor() {
  const liveEditingPanel = document.getElementById('liveEditingPanel');
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  const narratorInput = document.getElementById('narratorInput');
  const titleCharCount = document.getElementById('titleCharCount');
  const subtitleCharCount = document.getElementById('subtitleCharCount');
  const narratorCharCount = document.getElementById('narratorCharCount');
  const previewTitle = document.getElementById('previewTitle');
  const previewSubtitle = document.getElementById('previewSubtitle');
  const previewTile = document.getElementById('previewTile');
  const applyToAllBtn = document.getElementById('applyToAllBtn');
  const resetBtn = document.getElementById('resetBtn');
  
  // Show live editor panel when data is loaded
  if (liveEditingPanel) {
    liveEditingPanel.style.display = 'block';
  }
  
  // Real-time character counting and preview updates for title
  if (titleInput) {
    titleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update preview tile text
      if (previewTitle) {
        previewTitle.textContent = text || 'Fortnite OG';
      }
      
      // Update character count
      if (titleCharCount) {
        titleCharCount.textContent = charCount;
        
        // Update color based on W-count limits
        const charCountEl = titleCharCount.parentElement;
        charCountEl.className = 'char-count';
        if (charCount > LIMITS.title.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.title.warning) {
          charCountEl.classList.add('warning');
        }
      }
      
      // Update preview tile status
      updatePreviewTileStatus();
      
      // Update analytics dashboard in real-time
      updateLiveAnalytics();
    });
  }
  
  // Real-time character counting and preview updates for subtitle
  if (subtitleInput) {
    subtitleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update preview tile text
      if (previewSubtitle) {
        previewSubtitle.textContent = text || 'New season';
      }
      
      // Update character count
      if (subtitleCharCount) {
        subtitleCharCount.textContent = charCount;
        
        // Update color based on W-count limits
        const charCountEl = subtitleCharCount.parentElement;
        charCountEl.className = 'char-count';
        if (charCount > LIMITS.subtitle.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.subtitle.warning) {
          charCountEl.classList.add('warning');
        }
      }
      
      // Update preview tile status
      updatePreviewTileStatus();
      
      // Update analytics dashboard in real-time
      updateLiveAnalytics();
    });
  }
  
  // Narrator text input handler
  if (narratorInput) {
    narratorInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update character count
      if (narratorCharCount) {
        narratorCharCount.textContent = charCount;
        
        // Add visual feedback for character limits (using subtitle limits as reference)
        const charCountEl = narratorCharCount.parentElement;
        charCountEl.classList.remove('warning', 'error');
        
        if (charCount > LIMITS.subtitle.max) {
          charCountEl.classList.add('error');
        } else if (charCount > LIMITS.subtitle.warning) {
          charCountEl.classList.add('warning');
        }
      }
      
      // Update preview tile status
      updatePreviewTileStatus();
      
      // Update analytics dashboard in real-time
      updateLiveAnalytics();
    });
  }
  
  // Apply to all tiles button
  if (applyToAllBtn) {
    applyToAllBtn.addEventListener('click', function() {
      const title = titleInput?.value || 'Fortnite OG';
      const subtitle = subtitleInput?.value || 'New season';
      
      // Update all tiles in the preview
      const allTiles = document.querySelectorAll('.tile-preview');
      allTiles.forEach(tile => {
        const tileTitle = tile.querySelector('.tile-title');
        const tileSubtitle = tile.querySelector('.tile-subtitle');
        
        if (tileTitle) tileTitle.textContent = title;
        if (tileSubtitle) tileSubtitle.textContent = subtitle;
        
        // Update tile status based on new text
        const analysis = analyzeText(title, subtitle);
        tile.className = `tile-preview ${analysis.status}`;
        
        const badge = tile.querySelector('.tile-status-badge');
        if (badge) {
          badge.className = `tile-status-badge ${analysis.status}`;
          badge.textContent = analysis.status === 'clean' ? '✓' : 
                             analysis.status === 'near-limit' ? '⚠' : '⚠';
        }
        
        // Update character counters for each tile
        const titleCounter = tile.querySelector('.title-counter .count');
        const subtitleCounter = tile.querySelector('.subtitle-counter .count');
        if (titleCounter) titleCounter.textContent = title.length;
        if (subtitleCounter) subtitleCounter.textContent = subtitle.length;
      });
      
      // Update analytics after applying changes
      if (currentCsvData) {
        // Update CSV data with new values
        currentCsvData.forEach(row => {
          row['items/0/title'] = title;
          row['items/0/subtitle'] = subtitle;
        });
        
        // Recalculate analytics
        renderLocaleGroups(currentCsvData);
      }
    });
  }
  
  // Reset button
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      if (titleInput) titleInput.value = '';
      if (subtitleInput) subtitleInput.value = '';
      if (titleCharCount) titleCharCount.textContent = '0';
      if (subtitleCharCount) subtitleCharCount.textContent = '0';
      if (previewTitle) previewTitle.textContent = 'Fortnite OG';
      if (previewSubtitle) previewSubtitle.textContent = 'New season';
      
      // Reset character count colors
      const charCounts = document.querySelectorAll('.char-count');
      charCounts.forEach(el => el.className = 'char-count');
      
      updatePreviewTileStatus();
    });
  }
}

// Update preview tile status based on current input
function updatePreviewTileStatus() {
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  const previewTile = document.getElementById('previewTile');
  
  if (!titleInput || !subtitleInput || !previewTile) return;
  
  const title = titleInput.value || 'Fortnite OG';
  const subtitle = subtitleInput.value || 'New season';
  
  // Use the EXACT same analysis logic as CSV tiles
  const analysis = analyzeText(title, subtitle);
  
  // DEBUG: Log what we're getting
  console.log('Live Editor Debug:', {
    title: title,
    titleLength: title.length,
    subtitle: subtitle,
    subtitleLength: subtitle.length,
    analysis: analysis,
    LIMITS: LIMITS
  });
  
  // Apply the EXACT same class logic as createTile() function
  previewTile.className = `preview-tile ${analysis.status}`;
  
  // DEBUG: Log what class was applied
  console.log('Applied class:', previewTile.className);
  
  const badge = previewTile.querySelector('.tile-status-badge');
  if (badge) {
    badge.className = `tile-status-badge ${analysis.status}`;
    badge.textContent = analysis.status === 'clean' ? '✓' : 
                       analysis.status === 'near-limit' ? '⚠' : '⚠';
  }
}

// Setup input event listeners for tile editor
function setupEditorInputs(editor, tileElement) {
  const titleInput = editor.querySelector('.title-input');
  const subtitleInput = editor.querySelector('.subtitle-input');
  
  if (titleInput) {
    titleInput.addEventListener('input', function() {
      const text = this.value;
      const charCount = text.length;
      
      // Update character count
      const countEl = editor.querySelector('.title-input + .char-count .count');
      if (countEl) {
        countEl.textContent = charCount;
      }
      
      // Update color based on W-count limits
      const charCountEl = editor.querySelector('.title-input + .char-count');
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
      const countEl = editor.querySelector('.subtitle-input + .char-count .count');
      if (countEl) {
        countEl.textContent = charCount;
      }
      
      // Update color based on W-count limits
      const charCountEl = editor.querySelector('.subtitle-input + .char-count');
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

// Update analytics dashboard based on live editor input
function updateLiveAnalytics() {
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  
  if (!titleInput || !subtitleInput) return;
  
  const title = titleInput.value || 'Fortnite OG';
  const subtitle = subtitleInput.value || 'New season';
  const analysis = analyzeText(title, subtitle);
  
  // Create analytics based on current live editor status
  const analytics = {
    totalLocales: 1, // Live editor shows 1 preview tile
    overflowCount: analysis.status === 'overflow' ? 1 : 0,
    nearLimitCount: analysis.status === 'near-limit' ? 1 : 0,
    cleanCount: analysis.status === 'clean' ? 1 : 0
  };
  
  // Update the analytics display
  updateAnalytics(analytics);
}

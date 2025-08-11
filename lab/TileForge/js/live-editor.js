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
    
    // Update character count color based on template-aware limits
    const limits = typeof getCurrentLimits === 'function' ? getCurrentLimits() : LIMITS;
    const limit = field === 'title' ? limits.title : limits.subtitle;
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
      const narratorText = narratorInput?.value || '';
      
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
          row['items/0/narratorText'] = narratorText;
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
  
  // Manual Apply All buttons for typed text
  const titleManualApplyBtn = document.getElementById('titleManualApplyBtn');
  const subtitleManualApplyBtn = document.getElementById('subtitleManualApplyBtn');
  const narratorManualApplyBtn = document.getElementById('narratorManualApplyBtn');
  
  // Apply manually entered title text to all tiles
  if (titleManualApplyBtn) {
    titleManualApplyBtn.addEventListener('click', function() {
      const manualText = titleInput ? titleInput.value.trim() : '';
      if (manualText) {
        applyManualTextToAllTiles(manualText, 'title');
      } else {
        alert('Please enter some text in the Title field first');
      }
    });
  }
  
  // Apply manually entered subtitle text to all tiles
  if (subtitleManualApplyBtn) {
    subtitleManualApplyBtn.addEventListener('click', function() {
      const manualText = subtitleInput ? subtitleInput.value.trim() : '';
      if (manualText) {
        applyManualTextToAllTiles(manualText, 'subtitle');
      } else {
        alert('Please enter some text in the Subtitle field first');
      }
    });
  }
  
  // Apply manually entered narrator text to all tiles
  if (narratorManualApplyBtn) {
    narratorManualApplyBtn.addEventListener('click', function() {
      const manualText = narratorInput ? narratorInput.value.trim() : '';
      if (manualText) {
        applyManualTextToAllTiles(manualText, 'narrator');
      } else {
        alert('Please enter some text in the Narrator field first');
      }
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
  
  // Apply current template class if available (FIX: Maintain template class)
  if (typeof window.templateSystem !== 'undefined') {
    const currentConfig = window.templateSystem.getCurrentConfig();
    if (currentConfig && currentConfig.name === 'Mobile Spotlight') {
      previewTile.classList.add('mobile-spotlight');
    }
  }
  
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

// Preset Headlines System
let presetData = {};
let currentActiveLocale = 'EN-US'; // Track the currently active tile's locale

// Load preset data from JSON files
async function loadPresetData() {
  try {
    const presetFiles = ['available-now', 'buy-now', 'pre-order-now'];
    
    for (const presetName of presetFiles) {
      console.log(`DEBUG: Loading preset file: ${presetName}.json`);
      const response = await fetch(`data/${presetName}.json`);
      if (response.ok) {
        const data = await response.json();
        presetData[presetName] = data;
        console.log(`DEBUG: Loaded ${presetName}:`, {
          name: data.name,
          localeCount: Object.keys(data.locales).length,
          sampleLocales: Object.keys(data.locales).slice(0, 5)
        });
      } else {
        console.warn(`Could not load preset: ${presetName}.json - Status: ${response.status}`);
      }
    }
    
    console.log('DEBUG: All preset data loaded:', Object.keys(presetData));
    populatePresetDropdowns();
  } catch (error) {
    console.error('Error loading preset data:', error);
  }
}

// Populate all preset dropdowns with available options
function populatePresetDropdowns() {
  const dropdowns = ['titlePresetSelect', 'subtitlePresetSelect', 'narratorPresetSelect'];
  
  dropdowns.forEach(dropdownId => {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    
    // Clear existing options (except the first "Select preset..." option)
    dropdown.innerHTML = '<option value="">Select preset...</option>';
    
    // Add options for each preset type
    Object.keys(presetData).forEach(presetKey => {
      const preset = presetData[presetKey];
      const option = document.createElement('option');
      option.value = presetKey;
      option.textContent = preset.name;
      dropdown.appendChild(option);
    });
  });
}

// Set the current active locale (called when Live Editor opens for a specific tile)
function setCurrentActiveLocale(locale) {
  currentActiveLocale = locale;
  console.log(`Active locale set to: ${locale}`);
}

// Apply preset to current input field
function applyPresetToField(presetKey, fieldType) {
  const preset = presetData[presetKey];
  if (!preset) {
    console.error(`Preset not found: ${presetKey}`);
    return;
  }
  
  // Check if auto-localization is enabled
  const autoLocalizeToggle = document.getElementById('autoLocalizeToggle');
  const isAutoLocalizeEnabled = autoLocalizeToggle ? autoLocalizeToggle.checked : true;
  
  console.log(`DEBUG: Auto-localize enabled: ${isAutoLocalizeEnabled}`);
  console.log(`DEBUG: Available locales in preset:`, Object.keys(preset.locales));
  console.log(`DEBUG: Current CSV data available:`, !!currentCsvData);
  
  // Live Editor preview always shows English text for consistency
  const previewText = preset.locales['EN-US'] || '';
  console.log(`DEBUG: Live Editor preview (always English): "${previewText}"`);
  console.log(`DEBUG: Auto-localize setting: ${isAutoLocalizeEnabled ? 'ON (affects Apply All)' : 'OFF (English only for Apply All)'}`);
  
  // Apply to the appropriate input field
  const inputId = fieldType + 'Input';
  const input = document.getElementById(inputId);
  if (input) {
    input.value = previewText;
    
    // Trigger input event to update character count and preview
    const event = new Event('input', { bubbles: true });
    input.dispatchEvent(event);
    
    console.log(`DEBUG: Applied to ${inputId}: "${previewText}"`);
  } else {
    console.error(`Input field not found: ${inputId}`);
  }
}

// Apply manually entered text to all tiles for a specific field
function applyManualTextToAllTiles(text, fieldType) {
  if (!currentCsvData || !currentCsvData.length) {
    console.warn('No CSV data available to apply text to');
    return;
  }
  
  console.log(`Applying manual text "${text}" to all tiles for ${fieldType} field`);
  
  // Determine the field key based on field type
  let fieldKey;
  switch (fieldType) {
    case 'title':
      fieldKey = 'items/0/title';
      break;
    case 'subtitle':
      fieldKey = 'items/0/subtitle';
      break;
    case 'narrator':
      fieldKey = 'items/0/narratorText';
      break;
    default:
      console.error(`Unknown field type: ${fieldType}`);
      return;
  }
  
  // Update CSV data for all locales
  currentCsvData.forEach((row, index) => {
    if (index === 0) return; // Skip header row
    
    const locale = row.Locale || row.locale;
    console.log(`Updating ${locale} - ${fieldKey} = "${text}"`);
    row[fieldKey] = text;
  });
  
  // Re-render tiles and update analytics
  renderLocaleGroups(currentCsvData);
  updateAnalytics();
  
  console.log(`Successfully applied manual text to all tiles for ${fieldType} field`);
}

// Apply preset to all tiles for a specific field
function applyPresetToAllTiles(presetKey, fieldType) {
  const preset = presetData[presetKey];
  if (!preset || !currentCsvData) return;
  
  // Check if auto-localization is enabled
  const autoLocalizeToggle = document.getElementById('autoLocalizeToggle');
  const isAutoLocalizeEnabled = autoLocalizeToggle ? autoLocalizeToggle.checked : true;
  
  // Update CSV data
  currentCsvData.forEach(row => {
    // The locale field might be 'Locale' (uppercase) or 'locale' (lowercase)
    const locale = row.Locale || row.locale;
    
    console.log(`DEBUG: Processing row for locale: "${locale}"`);
    
    let textToApply;
    if (isAutoLocalizeEnabled) {
      // Use localized text for each locale
      textToApply = preset.locales[locale] || preset.locales['EN-US'] || '';
      console.log(`DEBUG: Auto-localize ON - Using "${locale}" text: "${textToApply}"`);
    } else {
      // Use English text for all locales
      textToApply = preset.locales['EN-US'] || '';
      console.log(`DEBUG: Auto-localize OFF - Using English text: "${textToApply}"`);
    }
    
    // Update the appropriate field in CSV data
    let fieldKey;
    if (fieldType === 'title') {
      fieldKey = 'items/0/title';
    } else if (fieldType === 'subtitle') {
      fieldKey = 'items/0/subtitle';
    } else if (fieldType === 'narrator') {
      fieldKey = 'items/0/narratorText';
    }
    
    console.log(`Updating ${locale} - ${fieldKey} = "${textToApply}" (auto-localize: ${isAutoLocalizeEnabled})`);
    row[fieldKey] = textToApply;
  });
  
  // Re-render all tiles with updated data
  renderLocaleGroups(currentCsvData);
  
  const mode = isAutoLocalizeEnabled ? 'auto-localized' : 'English-only';
  console.log(`Applied "${preset.name}" preset to all tiles for ${fieldType} field (${mode})`);
}

// Setup preset dropdown event listeners
function setupPresetControls() {
  // Dropdown change handlers
  const dropdowns = [
    { id: 'titlePresetSelect', field: 'title' },
    { id: 'subtitlePresetSelect', field: 'subtitle' },
    { id: 'narratorPresetSelect', field: 'narrator' }
  ];
  
  dropdowns.forEach(({ id, field }) => {
    const dropdown = document.getElementById(id);
    const applyBtn = document.getElementById(field + 'ApplyAllBtn');
    
    if (dropdown) {
      dropdown.addEventListener('change', function() {
        const presetKey = this.value;
        
        // Enable/disable apply button
        if (applyBtn) {
          applyBtn.disabled = !presetKey;
        }
        
        // Apply to current field if preset selected
        if (presetKey) {
          applyPresetToField(presetKey, field);
        }
      });
    }
    
    // Apply All button handlers
    if (applyBtn) {
      applyBtn.addEventListener('click', function() {
        const dropdown = document.getElementById(id);
        const presetKey = dropdown ? dropdown.value : '';
        
        if (presetKey) {
          applyPresetToAllTiles(presetKey, field);
        }
      });
    }
  });
}

// Initialize preset system when page loads
document.addEventListener('DOMContentLoaded', function() {
  loadPresetData();
  setupPresetControls();
});

// Background Image Toggle Function
window.toggleBackgroundImage = function(isEnabled) {
  const previewTile = document.getElementById('previewTile');
  
  if (previewTile && window.currentImageInfo && window.currentImageInfo.imageSrc) {
    if (isEnabled) {
      // Show uploaded image
      previewTile.style.backgroundImage = `url(${window.currentImageInfo.imageSrc})`;
      previewTile.style.backgroundSize = 'cover';
      previewTile.style.backgroundPosition = 'center';
      previewTile.style.backgroundRepeat = 'no-repeat';
    } else {
      // Restore original gradient background
      previewTile.style.backgroundImage = '';
      previewTile.style.backgroundSize = '';
      previewTile.style.backgroundPosition = '';
      previewTile.style.backgroundRepeat = '';
    }
  } else {
    console.log('Toggle failed - previewTile:', !!previewTile, 'currentImageInfo:', !!window.currentImageInfo, 'imageSrc:', !!(window.currentImageInfo && window.currentImageInfo.imageSrc));
  }
};

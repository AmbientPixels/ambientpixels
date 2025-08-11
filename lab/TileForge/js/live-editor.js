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
      
      // Update preview tile text - behave like localized previews
      if (previewSubtitle) {
        if (text.trim() === '') {
          // Hide subtitle when empty, let title expand
          previewSubtitle.textContent = '';
          previewSubtitle.classList.add('hidden');
        } else {
          // Show subtitle with text
          previewSubtitle.textContent = text;
          previewSubtitle.classList.remove('hidden');
        }
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
let currentActiveLocale = 'EN-US'; // Track the currently active tile's locale

// Embedded preset data (no external file loading needed for local tool usage)
const presetData = {
  'available-now': {
    "name": "Available Now",
    "description": "Common availability messaging",
    "locales": {
      "AR-AE": "يتوفر الآن", "AR-BH": "يتوفر الآن", "AR-DZ": "يتوفر الآن", "AR-EG": "يتوفر الآن", "AR-KW": "يتوفر الآن",
      "AR-LY": "يتوفر الآن", "AR-MA": "يتوفر الآن", "AR-OM": "يتوفر الآن", "AR-QA": "يتوفر الآن", "AR-SA": "يتوفر الآن", "AR-TN": "يتوفر الآن",
      "CA-ES": "Disponible ara", "CS-CZ": "Nyní k dispozici", "DA-DK": "Fås nu", "DE-AT": "Jetzt verfügbar", "DE-CH": "Jetzt verfügbar",
      "DE-DE": "Jetzt verfügbar", "DE-LI": "Jetzt verfügbar", "DE-LU": "Jetzt verfügbar", "EL-GR": "Διαθέσιμο τώρα",
      "EN-AE": "Available now", "EN-AL": "Available now", "EN-AU": "Available now", "EN-BA": "Available now", "EN-BG": "Available now",
      "EN-BH": "Available now", "EN-CA": "Available now", "EN-CY": "Available now", "EN-CZ": "Available now", "EN-DZ": "Available now",
      "EN-EE": "Available now", "EN-EG": "Available now", "EN-GB": "Available now", "EN-GE": "Available now", "EN-GR": "Available now",
      "EN-HK": "Available now", "EN-HR": "Available now", "EN-HU": "Available now", "EN-IE": "Available now", "EN-IL": "Available now",
      "EN-IN": "Available now", "EN-IS": "Available now", "EN-KW": "Available now", "EN-LI": "Available now", "EN-LT": "Available now",
      "EN-LU": "Available now", "EN-LV": "Available now", "EN-MA": "Available now", "EN-MT": "Available now", "EN-MY": "Available now",
      "EN-NZ": "Available now", "EN-OM": "Available now", "EN-PH": "Available now", "EN-PL": "Available now", "EN-QA": "Available now",
      "EN-RO": "Available now", "EN-SA": "Available now", "EN-SG": "Available now", "EN-SI": "Available now", "EN-SK": "Available now",
      "EN-TH": "Available now", "EN-TN": "Available now", "EN-TW": "Available now", "EN-US": "Available now", "EN-ZA": "Available now",
      "ES-AR": "Disponible ahora", "ES-BO": "Disponible ahora", "ES-CL": "Disponible ahora", "ES-CO": "Disponible ahora", "ES-CR": "Disponible ahora",
      "ES-DO": "Disponible ahora", "ES-EC": "Disponible ahora", "ES-ES": "Disponible ahora", "ES-GT": "Disponible ahora", "ES-HN": "Disponible ahora",
      "ES-MX": "Disponible ahora", "ES-NI": "Disponible ahora", "ES-PA": "Disponible ahora", "ES-PE": "Disponible ahora", "ES-PR": "Disponible ahora",
      "ES-PY": "Disponible ahora", "ES-SV": "Disponible ahora", "ES-UY": "Disponible ahora", "ES-VE": "Disponible ahora",
      "FI-FI": "Saatavilla nyt", "FR-BE": "Disponible maintenant", "FR-CA": "Disponible maintenant", "FR-CH": "Disponible maintenant",
      "FR-FR": "Disponible maintenant", "FR-LU": "Disponible maintenant", "FR-MC": "Disponible maintenant", "HE-IL": "זמין עכשיו",
      "HU-HU": "Most elérhető", "IT-CH": "Disponibile ora", "IT-IT": "Disponibile ora", "JA-JP": "今すぐ利用可能",
      "KO-KR": "지금 이용 가능", "NB-NO": "Tilgjengelig nå", "NL-BE": "Nu beschikbaar", "NL-NL": "Nu beschikbaar",
      "PL-PL": "Dostępne teraz", "PT-BR": "Disponível agora", "PT-PT": "Disponível agora", "RU-RU": "Доступно сейчас",
      "SK-SK": "Dostupné teraz", "SV-SE": "Tillgänglig nu", "TH-TH": "พร้อมใช้งานแล้ว", "TR-TR": "Şimdi mevcut",
      "ZH-CN": "现已推出", "ZH-HK": "現已推出", "ZH-TW": "現已推出"
    }
  },
  'buy-now': {
    "name": "Buy Now",
    "description": "Purchase call-to-action",
    "locales": {
      "AR-AE": "بادر بالشراء الآن", "AR-BH": "بادر بالشراء الآن", "AR-DZ": "بادر بالشراء الآن", "AR-EG": "بادر بالشراء الآن",
      "AR-KW": "بادر بالشراء الآن", "AR-LY": "بادر بالشراء الآن", "AR-MA": "بادر بالشراء الآن", "AR-OM": "بادر بالشراء الآن",
      "AR-QA": "بادر بالشراء الآن", "AR-SA": "بادر بالشراء الآن", "AR-TN": "بادر بالشراء الآن",
      "CA-ES": "Compra ara", "CS-CZ": "Koupit nyní", "DA-DK": "Køb nu", "DE-AT": "Jetzt kaufen", "DE-CH": "Jetzt kaufen",
      "DE-DE": "Jetzt kaufen", "DE-LI": "Jetzt kaufen", "DE-LU": "Jetzt kaufen", "EL-GR": "Αγοράστε τώρα",
      "EN-AE": "Buy now", "EN-AL": "Buy now", "EN-AU": "Buy now", "EN-BA": "Buy now", "EN-BG": "Buy now",
      "EN-BH": "Buy now", "EN-CA": "Buy now", "EN-CY": "Buy now", "EN-CZ": "Buy now", "EN-DZ": "Buy now",
      "EN-EE": "Buy now", "EN-EG": "Buy now", "EN-GB": "Buy now", "EN-GE": "Buy now", "EN-GR": "Buy now",
      "EN-HK": "Buy now", "EN-HR": "Buy now", "EN-HU": "Buy now", "EN-IE": "Buy now", "EN-IL": "Buy now",
      "EN-IN": "Buy now", "EN-IS": "Buy now", "EN-KW": "Buy now", "EN-LI": "Buy now", "EN-LT": "Buy now",
      "EN-LU": "Buy now", "EN-LV": "Buy now", "EN-MA": "Buy now", "EN-MT": "Buy now", "EN-MY": "Buy now",
      "EN-NZ": "Buy now", "EN-OM": "Buy now", "EN-PH": "Buy now", "EN-PL": "Buy now", "EN-QA": "Buy now",
      "EN-RO": "Buy now", "EN-SA": "Buy now", "EN-SG": "Buy now", "EN-SI": "Buy now", "EN-SK": "Buy now",
      "EN-TH": "Buy now", "EN-TN": "Buy now", "EN-TW": "Buy now", "EN-US": "Buy now", "EN-ZA": "Buy now",
      "ES-AR": "Comprar ahora", "ES-BO": "Comprar ahora", "ES-CL": "Comprar ahora", "ES-CO": "Comprar ahora", "ES-CR": "Comprar ahora",
      "ES-DO": "Comprar ahora", "ES-EC": "Comprar ahora", "ES-ES": "Comprar ahora", "ES-GT": "Comprar ahora", "ES-HN": "Comprar ahora",
      "ES-MX": "Comprar ahora", "ES-NI": "Comprar ahora", "ES-PA": "Comprar ahora", "ES-PE": "Comprar ahora", "ES-PR": "Comprar ahora",
      "ES-PY": "Comprar ahora", "ES-SV": "Comprar ahora", "ES-UY": "Comprar ahora", "ES-VE": "Comprar ahora",
      "FI-FI": "Osta nyt", "FR-BE": "Acheter maintenant", "FR-CA": "Acheter maintenant", "FR-CH": "Acheter maintenant",
      "FR-FR": "Acheter maintenant", "FR-LU": "Acheter maintenant", "FR-MC": "Acheter maintenant", "HE-IL": "קנה עכשיו",
      "HU-HU": "Vásárlás most", "IT-CH": "Acquista ora", "IT-IT": "Acquista ora", "JA-JP": "今すぐ購入",
      "KO-KR": "지금 구매", "NB-NO": "Kjøp nå", "NL-BE": "Nu kopen", "NL-NL": "Nu kopen",
      "PL-PL": "Kup teraz", "PT-BR": "Comprar agora", "PT-PT": "Comprar agora", "RU-RU": "Купить сейчас",
      "SK-SK": "Kúpiť teraz", "SV-SE": "Köp nu", "TH-TH": "ซื้อตอนนี้", "TR-TR": "Şimdi satın al",
      "ZH-CN": "立即购买", "ZH-HK": "立即購買", "ZH-TW": "立即購買"
    }
  },
  'pre-order-now': {
    "name": "Pre-order Now",
    "description": "Pre-order messaging",
    "locales": {
      "AR-AE": "احجز مسبقًا الآن", "AR-BH": "احجز مسبقًا الآن", "AR-DZ": "احجز مسبقًا الآن", "AR-EG": "احجز مسبقًا الآن",
      "AR-KW": "احجز مسبقًا الآن", "AR-LY": "احجز مسبقًا الآن", "AR-MA": "احجز مسبقًا الآن", "AR-OM": "احجز مسبقًا الآن",
      "AR-QA": "احجز مسبقًا الآن", "AR-SA": "احجز مسبقًا الآن", "AR-TN": "احجز مسبقًا الآن",
      "CA-ES": "Reserva ara", "CS-CZ": "Předobjednat nyní", "DA-DK": "Forudbestil nu", "DE-AT": "Jetzt vorbestellen", "DE-CH": "Jetzt vorbestellen",
      "DE-DE": "Jetzt vorbestellen", "DE-LI": "Jetzt vorbestellen", "DE-LU": "Jetzt vorbestellen", "EL-GR": "Προπαραγγελία τώρα",
      "EN-AE": "Pre-order now", "EN-AL": "Pre-order now", "EN-AU": "Pre-order now", "EN-BA": "Pre-order now", "EN-BG": "Pre-order now",
      "EN-BH": "Pre-order now", "EN-CA": "Pre-order now", "EN-CY": "Pre-order now", "EN-CZ": "Pre-order now", "EN-DZ": "Pre-order now",
      "EN-EE": "Pre-order now", "EN-EG": "Pre-order now", "EN-GB": "Pre-order now", "EN-GE": "Pre-order now", "EN-GR": "Pre-order now",
      "EN-HK": "Pre-order now", "EN-HR": "Pre-order now", "EN-HU": "Pre-order now", "EN-IE": "Pre-order now", "EN-IL": "Pre-order now",
      "EN-IN": "Pre-order now", "EN-IS": "Pre-order now", "EN-KW": "Pre-order now", "EN-LI": "Pre-order now", "EN-LT": "Pre-order now",
      "EN-LU": "Pre-order now", "EN-LV": "Pre-order now", "EN-MA": "Pre-order now", "EN-MT": "Pre-order now", "EN-MY": "Pre-order now",
      "EN-NZ": "Pre-order now", "EN-OM": "Pre-order now", "EN-PH": "Pre-order now", "EN-PL": "Pre-order now", "EN-QA": "Pre-order now",
      "EN-RO": "Pre-order now", "EN-SA": "Pre-order now", "EN-SG": "Pre-order now", "EN-SI": "Pre-order now", "EN-SK": "Pre-order now",
      "EN-TH": "Pre-order now", "EN-TN": "Pre-order now", "EN-TW": "Pre-order now", "EN-US": "Pre-order now", "EN-ZA": "Pre-order now",
      "ES-AR": "Reservar ahora", "ES-BO": "Reservar ahora", "ES-CL": "Reservar ahora", "ES-CO": "Reservar ahora", "ES-CR": "Reservar ahora",
      "ES-DO": "Reservar ahora", "ES-EC": "Reservar ahora", "ES-ES": "Reservar ahora", "ES-GT": "Reservar ahora", "ES-HN": "Reservar ahora",
      "ES-MX": "Reservar ahora", "ES-NI": "Reservar ahora", "ES-PA": "Reservar ahora", "ES-PE": "Reservar ahora", "ES-PR": "Reservar ahora",
      "ES-PY": "Reservar ahora", "ES-SV": "Reservar ahora", "ES-UY": "Reservar ahora", "ES-VE": "Reservar ahora",
      "FI-FI": "Ennakkotilaa nyt", "FR-BE": "Précommander maintenant", "FR-CA": "Précommander maintenant", "FR-CH": "Précommander maintenant",
      "FR-FR": "Précommander maintenant", "FR-LU": "Précommander maintenant", "FR-MC": "Précommander maintenant", "HE-IL": "הזמן מראש עכשיו",
      "HU-HU": "Előrendelés most", "IT-CH": "Preordina ora", "IT-IT": "Preordina ora", "JA-JP": "今すぐ予約注文",
      "KO-KR": "지금 사전 주문", "NB-NO": "Forhåndsbestill nå", "NL-BE": "Nu voorbestellen", "NL-NL": "Nu voorbestellen",
      "PL-PL": "Zamów z wyprzedzeniem", "PT-BR": "Pré-encomende agora", "PT-PT": "Pré-encomendar agora", "RU-RU": "Предзаказать сейчас",
      "SK-SK": "Predobjednať teraz", "SV-SE": "Förbeställ nu", "TH-TH": "สั่งจองล่วงหน้าตอนนี้", "TR-TR": "Şimdi ön sipariş ver",
      "ZH-CN": "立即预购", "ZH-HK": "立即預購", "ZH-TW": "立即預購"
    }
  }
};

// Initialize preset data (no async loading needed)
function loadPresetData() {
  console.log('DEBUG: Using embedded preset data for local tool usage');
  console.log('DEBUG: Available presets:', Object.keys(presetData));
  populatePresetDropdowns();
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

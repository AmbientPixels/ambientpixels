// TileForge Settings & Theme System
// Handles settings modal, theme switching, and keyboard shortcuts

// ===== THEME DEFINITIONS =====

const THEMES = {
  'default': {
    '--theme-primary': '#007bff',
    '--theme-secondary': '#6c757d',
    '--theme-background': '#1a1a1a',
    '--theme-surface': '#252525',
    '--theme-text': '#ffffff',
    '--theme-text-secondary': '#aaa',
    '--theme-accent': '#007bff',
    '--theme-border': '#444'
  },
  'xbox-green': {
    '--theme-primary': '#107c10',
    '--theme-secondary': '#005a9e',
    '--theme-background': '#0e1e0e',
    '--theme-surface': '#1a2f1a',
    '--theme-text': '#ffffff',
    '--theme-text-secondary': '#b3d9b3',
    '--theme-accent': '#107c10',
    '--theme-border': '#2d4a2d'
  },
  'corporate-dark': {
    '--theme-primary': '#007bff',
    '--theme-secondary': '#6c757d',
    '--theme-background': '#2c3e50',
    '--theme-surface': '#34495e',
    '--theme-text': '#ffffff',
    '--theme-text-secondary': '#bdc3c7',
    '--theme-accent': '#3498db',
    '--theme-border': '#4a5f7a'
  },
  // Added by Cascade – light variant used by Theme tab UI
  'corporate-light': {
    '--theme-primary': '#0d6efd',
    '--theme-secondary': '#6c757d',
    '--theme-background': '#f8f9fa',
    '--theme-surface': '#ffffff',
    '--theme-text': '#212529',
    '--theme-text-secondary': '#495057',
    '--theme-accent': '#0d6efd',
    '--theme-border': '#dee2e6'
  },
  'dark-focus': {
    '--theme-primary': '#adb5bd',
    '--theme-secondary': '#6c757d',
    '--theme-background': '#212529',
    '--theme-surface': '#343a40',
    '--theme-text': '#f8f9fa',
    '--theme-text-secondary': '#adb5bd',
    '--theme-accent': '#6c757d',
    '--theme-border': '#495057'
  },
  // Added by Cascade – minimal light focus theme used by Theme tab UI
  'light-focus': {
    '--theme-primary': '#495057',
    '--theme-secondary': '#adb5bd',
    '--theme-background': '#ffffff',
    '--theme-surface': '#f8f9fa',
    '--theme-text': '#212529',
    '--theme-text-secondary': '#6c757d',
    '--theme-accent': '#495057',
    '--theme-border': '#e9ecef'
  }
};

// ===== KEYBOARD SHORTCUTS =====

const DEFAULT_SHORTCUTS = {
  'open-settings': 'Ctrl+,',
  'export-csv': 'Ctrl+E',
  'upload-image': 'Ctrl+U',
  'toggle-theme': 'Ctrl+T',
  'focus-search': 'Ctrl+F',
  'reset-filters': 'Ctrl+R'
};

// ===== SETTINGS STATE =====

let currentSettings = {
  theme: 'default',
  shortcuts: { ...DEFAULT_SHORTCUTS },
  autosaveFreq: 60,
  csvDelimiter: ',',
  showIntroStartup: true,
  // When enabled, attempt to load the last saved data on startup (unless URL/localStorage autoload overrides)
  loadLastSavedOnStartup: false,
  // Toggle for locale badge status pill colors (Clean/Near/Overflow)
  statusPillColors: false,
  // Toggle for locale badge language pill colors
  languagePillColors: false,
  // Toggle for showing status borders on locale badges in default view
  statusPillBorders: true,
  // Default pill palette to apply when both toggles are off
  // Allowed: 'language' | 'status' | 'none'
  defaultPillPalette: 'language',
  // Sticky option for the Locale Badges Panel container
  badgesPanelSticky: false,
  // Default: Case Converter auto-fills input from Live Editor Title when opened
  caseAutoFillFromTitleDefault: false
};

// Ensure settings are accessible to other modules that expect window.currentSettings
// Keep this as a direct reference to the same object. /* updated by Cascade */
window.currentSettings = currentSettings;

// ===== SETTINGS MODAL FUNCTIONS =====

function openSettings() {
  const tabs = [
    {
      title: 'Themes',
      icon: '<i class="fas fa-palette" aria-hidden="true"></i>',
      content: createThemesTabContent()
    },
    {
      title: 'Shortcuts',
      icon: '<i class="fas fa-keyboard" aria-hidden="true"></i>',
      content: createSettingsShortcutsTabContent()
    },
    {
      title: 'General',
      icon: '<i class="fas fa-cog" aria-hidden="true"></i>',
      content: createGeneralTabContent()
    },
    {
      title: 'About',
      icon: '<i class="fas fa-info-circle" aria-hidden="true"></i>',
      content: createAboutTabContent()
    }
  ];

  const settingsModal = Modal.createTabbedModal({
    title: '<i class="fab fa-xbox" aria-hidden="true"></i> TileForge Settings',
    size: 'large',
    tabs: tabs,
    activeTab: 0
  }); 

  settingsModal.show();
  // Add a specific class to the settings modal container for stable sizing across tabs. /* updated by Cascade */
  try {
    const modalEl = document.getElementById(settingsModal.id);
    if (modalEl) modalEl.classList.add('settings-modal');
  } catch (_) {}
  
  // Initialize theme system after modal is shown
  setTimeout(() => {
    initializeThemeSelection();
    updateShortcutsDisplay();
  }, 100);
}

function closeSettings() {
  // Modal system handles closing automatically
}

function switchSettingsTab(tabName) {
  // Modal system handles tab switching automatically
}

// ===== THEME SYSTEM FUNCTIONS =====

function applyTheme(themeName) {
  const theme = THEMES[themeName];
  if (!theme) {
    console.warn(`Theme "${themeName}" not found`);
    return;
  }
  
  const root = document.documentElement;
  Object.entries(theme).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
  
  // Update theme selection UI
  document.querySelectorAll('.theme-option').forEach(option => {
    option.classList.remove('selected');
  });
  const selectedOption = document.querySelector(`[data-theme="${themeName}"]`);
  if (selectedOption) {
    selectedOption.classList.add('selected');
  }
  
  // Save theme preference
  currentSettings.theme = themeName;
  saveSettings();
  
  console.log(`Applied theme: ${themeName}`);
}

function previewTheme() {
  const selectedTheme = document.querySelector('.theme-option.selected');
  if (!selectedTheme) {
    console.warn('No theme selected for preview');
    return;
  }
  
  const themeName = selectedTheme.dataset.theme;
  const previewArea = document.querySelector('.theme-preview-tile');
  
  if (!previewArea) {
    console.warn('Preview area not found');
    return;
  }
  
  // Apply theme to preview area only
  const theme = THEMES[themeName];
  Object.entries(theme).forEach(([property, value]) => {
    previewArea.style.setProperty(property, value);
  });
  
  // Auto-revert after 3 seconds
  setTimeout(() => {
    // Remove only theme variables to preserve size/border-radius. /* updated by Cascade */
    try {
      Object.keys(theme).forEach((prop) => previewArea.style.removeProperty(prop));
    } catch(_) {}
  }, 3000);
  
  console.log(`Previewing theme: ${themeName}`);
}

function applySelectedTheme() {
  const selectedTheme = document.querySelector('.theme-option.selected');
  if (selectedTheme) {
    applyTheme(selectedTheme.dataset.theme);
  } else {
    console.warn('No theme selected to apply');
  }
}

function toggleNextTheme() {
  const themeNames = Object.keys(THEMES);
  const currentIndex = themeNames.indexOf(currentSettings.theme);
  const nextIndex = (currentIndex + 1) % themeNames.length;
  applyTheme(themeNames[nextIndex]);
}

// ===== KEYBOARD SHORTCUTS FUNCTIONS =====

function updateShortcutsDisplay() {
  const shortcutsList = document.querySelector('#shortcutsList');
  if (!shortcutsList) return;
  
  shortcutsList.innerHTML = '';
  
  Object.entries(currentSettings.shortcuts).forEach(([action, shortcut]) => {
    const item = document.createElement('div');
    item.className = 'settings-row';
    
    const actionName = action.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const keys = shortcut.split('+').map(key => `<kbd>${key}</kbd>`).join(' + ');
    
    item.innerHTML = `
      <div class="row-text">
        <div class="row-title">${actionName}</div>
      </div>
      <div class="row-actions">
        <div class="shortcut-keys">${keys}</div>
        <button class="btn btn-secondary" onclick="editShortcut('${action}')">Edit</button>
      </div>
    `;
    
    shortcutsList.appendChild(item);
  });
}

function initializeThemeSelection() {
  // Build the theme grid dynamically from THEMES to avoid drift. /* updated by Cascade */
  const grid = document.getElementById('themeGrid');
  if (grid) {
    grid.innerHTML = '';
    const themeEntries = Object.entries(THEMES);
    themeEntries.forEach(([name, vars]) => {
      const option = document.createElement('div');
      option.className = 'theme-option';
      option.setAttribute('data-theme', name);
      // Simple readable label
      const label = name
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      option.innerHTML = `
        <div class=\"theme-preview\"></div>
        <div class="theme-info">
          <h4>${label}</h4>
          <p>${label} theme</p>
        </div>
      `;
      grid.appendChild(option);

      // Apply gradient swatch using theme variables (surface -> primary). /* updated by Cascade */
      try {
        const preview = option.querySelector('.theme-preview');
        const surface = vars['--theme-surface'] || '#2b2b2b';
        const primary = vars['--theme-primary'] || '#0d6efd';
        const border = vars['--theme-border'] || 'rgba(0,0,0,0.2)';
        if (preview) {
          preview.style.background = `linear-gradient(135deg, ${surface} 0%, ${primary} 100%)`;
          preview.style.border = `1px solid ${border}`;
          preview.style.borderRadius = '8px';
        }
      } catch(_) {}
    });
  }

  // Update selection to current theme
  document.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('selected'));
  const currentThemeOption = document.querySelector(`[data-theme="${currentSettings.theme}"]`);
  if (currentThemeOption) currentThemeOption.classList.add('selected');

  // Click selects theme option (no immediate apply)
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', function() {
      document.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('selected'));
      this.classList.add('selected');
    });
  });

  // Hover preview: apply CSS vars only to preview tile sandbox
  const previewArea = document.querySelector('.theme-preview-tile');
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('mouseenter', () => {
      if (!previewArea) return;
      const themeName = option.getAttribute('data-theme');
      const theme = THEMES[themeName];
      if (!theme) return;
      Object.entries(theme).forEach(([property, value]) => {
        previewArea.style.setProperty(property, value);
      });
    });
    option.addEventListener('mouseleave', () => {
      if (!previewArea) return;
      // Revert only theme variables to preserve size/border-radius. /* updated by Cascade */
      try {
        const themeName = option.getAttribute('data-theme');
        const theme = THEMES[themeName];
        if (theme) {
          Object.keys(theme).forEach((prop) => previewArea.style.removeProperty(prop));
        }
      } catch(_) {}
    });
  });
  
  // Update general settings
  const autosaveFreq = document.getElementById('autosaveFreq');
  const csvDelimiter = document.getElementById('csvDelimiter');
  const showIntroStartup = document.getElementById('showIntroStartup');
  const loadLastSavedOnStartup = document.getElementById('loadLastSavedOnStartup');
  const statusPillColorsPref = document.getElementById('statusPillColorsPref');
  const languagePillColorsPref = document.getElementById('languagePillColorsPref');
  const defaultPillPalettePref = document.getElementById('defaultPillPalettePref');
  const statusPillBordersPref = document.getElementById('statusPillBordersPref');
  const caseAutoFillPref = document.getElementById('caseAutoFillFromTitleDefault');
  
  if (autosaveFreq) {
    autosaveFreq.value = currentSettings.autosaveFreq;
    autosaveFreq.addEventListener('change', function() {
      currentSettings.autosaveFreq = parseInt(this.value);
      saveSettings();
    });
  }
  
  if (csvDelimiter) {
    csvDelimiter.value = currentSettings.csvDelimiter;
    csvDelimiter.addEventListener('change', function() {
      currentSettings.csvDelimiter = this.value;
      saveSettings();
    });
  }
  
  if (showIntroStartup) {
    showIntroStartup.checked = currentSettings.showIntroStartup;
    showIntroStartup.addEventListener('change', function() {
      currentSettings.showIntroStartup = this.checked;
      localStorage.setItem('tileforge-show-intro', this.checked ? 'true' : 'false');
      saveSettings();
    });
  }
  if (loadLastSavedOnStartup) {
    loadLastSavedOnStartup.checked = !!currentSettings.loadLastSavedOnStartup;
    loadLastSavedOnStartup.addEventListener('change', function() {
      currentSettings.loadLastSavedOnStartup = !!this.checked;
      saveSettings();
    });
  }
  
  // Resolve any persisted conflict: only one may be true at a time
  if (currentSettings.statusPillColors && currentSettings.languagePillColors) {
    // Prefer language and disable status to avoid conflict
    currentSettings.statusPillColors = false;
    saveSettings();
  }
  
  if (statusPillColorsPref) {
    statusPillColorsPref.checked = !!currentSettings.statusPillColors;
  }
  if (languagePillColorsPref) {
    languagePillColorsPref.checked = !!currentSettings.languagePillColors;
  }
  if (statusPillBordersPref) {
    statusPillBordersPref.checked = !!currentSettings.statusPillBorders;
  }
  if (defaultPillPalettePref) {
    const allowed = ['language','status','none'];
    const val = allowed.includes(currentSettings.defaultPillPalette) ? currentSettings.defaultPillPalette : 'language';
    defaultPillPalettePref.value = val;
  }
  if (caseAutoFillPref) {
    caseAutoFillPref.checked = !!currentSettings.caseAutoFillFromTitleDefault;
  }
  
  function applyPaletteState() {
    const badgesSection = document.querySelector('.locale-badges-section');
    const statusOn = !!currentSettings.statusPillColors;
    const langOn = !!currentSettings.languagePillColors;
    if (badgesSection) {
      badgesSection.classList.toggle('status-palette-on', statusOn);
      badgesSection.classList.toggle('palette-on', langOn);
      // Apply borders opt-out
      badgesSection.classList.toggle('status-borders-off', !currentSettings.statusPillBorders);
    }
    const uiStatus = document.getElementById('toggleStatusPillColors');
    if (uiStatus) {
      uiStatus.checked = statusOn;
      uiStatus.setAttribute('aria-checked', String(statusOn));
    }
    const uiLang = document.getElementById('toggleLocaleColors');
    if (uiLang) {
      uiLang.checked = langOn;
      uiLang.setAttribute('aria-checked', String(langOn));
    }
  }
  
  if (statusPillColorsPref) {
    statusPillColorsPref.addEventListener('change', function() {
      const enabled = !!this.checked;
      currentSettings.statusPillColors = enabled;
      if (enabled) {
        // turn off language if it was on
        currentSettings.languagePillColors = false;
      }
      saveSettings();
      applyPaletteState();
    });
  }
  if (languagePillColorsPref) {
    languagePillColorsPref.addEventListener('change', function() {
      const enabled = !!this.checked;
      currentSettings.languagePillColors = enabled;
      if (enabled) {
        // turn off status if it was on
        currentSettings.statusPillColors = false;
      }
      saveSettings();
      applyPaletteState();
    });
  }
  if (defaultPillPalettePref) {
    defaultPillPalettePref.addEventListener('change', function() {
      const v = String(this.value);
      if (v === 'language' || v === 'status' || v === 'none') {
        currentSettings.defaultPillPalette = v;
        saveSettings();
        // Notify toolbar UI to refresh default badge, if available
        if (typeof window.updatePillPaletteDefaultUI === 'function') {
          try { window.updatePillPaletteDefaultUI(); } catch(_) {}
        }
      }
    });
  }
  if (caseAutoFillPref) {
    caseAutoFillPref.addEventListener('change', function() {
      currentSettings.caseAutoFillFromTitleDefault = !!this.checked;
      saveSettings();
    });
  }
  
  // Handle borders toggle changes
  if (statusPillBordersPref) {
    statusPillBordersPref.addEventListener('change', function() {
      const enabled = !!this.checked;
      currentSettings.statusPillBorders = enabled;
      saveSettings();
      const badgesSection = document.querySelector('.locale-badges-section');
      if (badgesSection) badgesSection.classList.toggle('status-borders-off', !enabled);
    });
  }
  
  // Apply initial palette state to live UI when settings modal opens
  applyPaletteState();
}

function editShortcut(action) {
  const actionName = action.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  if (window.Modal && typeof Modal.prompt === 'function') {
    const modal = Modal.prompt({
      title: 'Edit Shortcut',
      message: `Enter new shortcut for ${actionName}:`,
      defaultValue: currentSettings.shortcuts[action],
      onConfirm: (value) => {
        if (value && value.trim()) {
          currentSettings.shortcuts[action] = value.trim();
          updateShortcutsDisplay();
          saveSettings();
          console.log(`Updated shortcut for ${action}: ${value}`);
        }
      }
    });
    modal.show();
  } else {
    const newShortcut = prompt(`Enter new shortcut for ${actionName}:`, currentSettings.shortcuts[action]);
    if (newShortcut && newShortcut.trim()) {
      currentSettings.shortcuts[action] = newShortcut.trim();
      updateShortcutsDisplay();
      saveSettings();
      console.log(`Updated shortcut for ${action}: ${newShortcut}`);
    }
  }
}

function resetShortcuts() {
  const doReset = () => {
    currentSettings.shortcuts = { ...DEFAULT_SHORTCUTS };
    updateShortcutsDisplay();
    saveSettings();
    console.log('Shortcuts reset to defaults');
  };
  if (window.Modal && typeof Modal.confirm === 'function') {
    const modal = Modal.confirm({
      content: 'Reset all keyboard shortcuts to defaults?',
      onConfirm: doReset
    });
    modal.show();
  } else {
    if (confirm('Reset all keyboard shortcuts to defaults?')) doReset();
  }
}

function handleGlobalShortcuts(event) {
  const key = getShortcutString(event);
  
  // Find matching shortcut
  for (const [action, shortcut] of Object.entries(currentSettings.shortcuts)) {
    if (key === shortcut) {
      event.preventDefault();
      executeShortcutAction(action);
      break;
    }
  }
}

function getShortcutString(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.key.toUpperCase());
  return parts.join('+');
}

function executeShortcutAction(action) {
  console.log(`Executing shortcut action: ${action}`);
  
  switch (action) {
    case 'open-settings':
      openSettings();
      break;
    case 'export-csv':
      // Call existing export function if available
      if (typeof exportCSV === 'function') {
        exportCSV();
      } else {
        console.warn('Export CSV function not available');
      }
      break;
    case 'upload-image':
      const imgInput = document.getElementById('imgInput');
      if (imgInput) {
        imgInput.click();
      }
      break;
    case 'toggle-theme':
      toggleNextTheme();
      break;
    case 'focus-search':
      const searchInput = document.querySelector('#localeFilter');
      if (searchInput) {
        searchInput.focus();
      }
      break;
    case 'reset-filters':
      if (typeof resetFilters === 'function') {
        resetFilters();
      } else {
        console.warn('Reset filters function not available');
      }
      break;
    default:
      console.warn(`Unknown shortcut action: ${action}`);
  }
}

// ===== SETTINGS PERSISTENCE =====

function saveSettings() {
  try {
    localStorage.setItem('tileforge-settings', JSON.stringify(currentSettings));
    console.log('Settings saved successfully');
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('tileforge-settings');
    if (saved) {
      const parsedSettings = JSON.parse(saved);
      // Preserve the same object reference so window.currentSettings stays in sync
      Object.assign(currentSettings, parsedSettings); /* updated by Cascade */
      console.log('Settings loaded successfully');
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  
  // Apply loaded theme
  applyTheme(currentSettings.theme);
}

function loadCurrentSettings() {
  // Update theme selection
  const currentThemeOption = document.querySelector(`[data-theme="${currentSettings.theme}"]`);
  if (currentThemeOption) {
    document.querySelectorAll('.theme-option').forEach(option => {
      option.classList.remove('selected');
    });
    currentThemeOption.classList.add('selected');
  }
  
  // Update general settings
  const autosaveFreq = document.getElementById('autosaveFreq');
  const csvDelimiter = document.getElementById('csvDelimiter');
  const showIntroStartup = document.getElementById('showIntroStartup');
  
  if (autosaveFreq) autosaveFreq.value = currentSettings.autosaveFreq;
  if (csvDelimiter) csvDelimiter.value = currentSettings.csvDelimiter;
  if (showIntroStartup) showIntroStartup.checked = currentSettings.showIntroStartup;
}

// ===== IMPORT/EXPORT FUNCTIONS =====

function exportShortcuts() {
  try {
    const data = JSON.stringify(currentSettings.shortcuts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tileforge-shortcuts.json';
    a.click();
    URL.revokeObjectURL(url);
    console.log('Shortcuts exported successfully');
  } catch (error) {
    console.error('Failed to export shortcuts:', error);
    if (window.Modal && typeof Modal.alert === 'function') {
      Modal.alert('Failed to export shortcuts', 'error');
    } else {
      alert('Failed to export shortcuts');
    }
  }
}

function importShortcuts() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(event) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const shortcuts = JSON.parse(e.target.result);
          currentSettings.shortcuts = { ...DEFAULT_SHORTCUTS, ...shortcuts };
          updateShortcutsDisplay();
          saveSettings();
          if (window.Modal && typeof Modal.alert === 'function') {
            Modal.alert('Shortcuts imported successfully!', 'success');
          } else {
            alert('Shortcuts imported successfully!');
          }
          console.log('Shortcuts imported successfully');
        } catch (error) {
          console.error('Failed to import shortcuts:', error);
          if (window.Modal && typeof Modal.alert === 'function') {
            Modal.alert('Failed to import shortcuts: Invalid file format', 'error');
          } else {
            alert('Failed to import shortcuts: Invalid file format');
          }
        }
      };
      reader.readAsText(file);
    }
  };
  input.click();
}

// ===== TAB CONTENT CREATION FUNCTIONS =====

function createThemesTabContent() {
  return `
    <div class="settings-section settings-root">
      <h3>Theme Selection</h3>
      <div class="theme-preview-area">
        <div class="theme-preview-tile">
          <div class="preview-header">Theme Preview</div>
          <div class="preview-content">Sample content with current theme</div>
        </div>
      </div>
      
      <!-- Dynamic grid populated by initializeThemeSelection() to keep UI in sync with THEMES -->
      <div class="theme-grid" id="themeGrid"></div>
      
      <div class="theme-actions">
        <button class="btn btn-primary" onclick="applySelectedTheme()">Apply Theme</button>
      </div>
    </div>
  `;
}

function createSettingsShortcutsTabContent() {
  return `
    <div class="settings-section tf-general shortcuts-panel settings-root">
      <h3>Keyboard Shortcuts</h3>

      <div class="settings-card">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Search</div>
          </div>
          <div class="shortcuts-search">
            <input type="text" placeholder="Search shortcuts..." id="shortcutsSearch" class="modal-form-input">
          </div>
        </div>
      </div>
      
      <div class="settings-card">
        <div id="shortcutsList"><!-- populated by updateShortcutsDisplay() --></div>
      </div>

      <div class="settings-card">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Manage</div>
          </div>
          <div>
            <button class="btn btn-secondary" onclick="resetShortcuts()">Reset to Defaults</button>
            <button class="btn btn-secondary" onclick="exportShortcuts()">Export</button>
            <button class="btn btn-secondary" onclick="importShortcuts()">Import</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function createGeneralTabContent() {
  // Windows Settings-style layout with cards/rows, right-aligned controls
  // Keep original input IDs for JS wiring. /* updated by Cascade */
  return `
    <div class="settings-section tf-general settings-root">
      <h3>General Settings</h3>

      <div class="settings-card">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Auto-save Frequency</div>
          </div>
          <div class="tf-select">
            <select id="autosaveFreq">
              <option value="30">30 seconds</option>
              <option value="60" selected>1 minute</option>
              <option value="300">5 minutes</option>
              <option value="0">Manual only</option>
            </select>
            <i class="fas fa-chevron-down" aria-hidden="true"></i>
          </div>
        </div>

        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Default CSV Delimiter</div>
          </div>
          <div class="tf-select">
            <select id="csvDelimiter">
              <option value="," selected>Comma (,)</option>
              <option value=";">Semicolon (;)</option>
              <option value="\t">Tab</option>
            </select>
            <i class="fas fa-chevron-down" aria-hidden="true"></i>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Show intro on startup</div>
          </div>
          <label class="tf-switch">
            <input type="checkbox" id="showIntroStartup" />
            <span class="tf-switch-track" aria-hidden="true"></span>
          </label>
        </div>

        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Load last saved data on startup</div>
            <div class="row-desc">Overrides empty start unless ?autoload=1 or an autoload flag is set. Uses the most recently processed CSV from this browser.</div>
          </div>
          <label class="tf-switch">
            <input type="checkbox" id="loadLastSavedOnStartup" />
            <span class="tf-switch-track" aria-hidden="true"></span>
          </label>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Status pill colors (locale badges)</div>
            <div class="row-desc">Controls green/orange/red for Clean / Near-limit / Overflow on locale pills.</div>
          </div>
          <label class="tf-switch">
            <input type="checkbox" id="statusPillColorsPref" />
            <span class="tf-switch-track" aria-hidden="true"></span>
          </label>
        </div>

        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Status borders on locale badges</div>
            <div class="row-desc">Colored border around each locale badge based on status (Clean / Near-limit / Overflow).</div>
          </div>
          <label class="tf-switch">
            <input type="checkbox" id="statusPillBordersPref" />
            <span class="tf-switch-track" aria-hidden="true"></span>
          </label>
        </div>

        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Language pill colors (locale badges)</div>
            <div class="row-desc">Per-language color palette for locale pills (lang-en, lang-fr, etc.).</div>
          </div>
          <label class="tf-switch">
            <input type="checkbox" id="languagePillColorsPref" />
            <span class="tf-switch-track" aria-hidden="true"></span>
          </label>
        </div>

        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Default pill palette</div>
            <div class="row-desc">If both toggles are OFF, this determines which palette turns ON automatically.</div>
          </div>
          <div class="tf-select">
            <select id="defaultPillPalettePref">
              <option value="language">Language colors</option>
              <option value="status">Status colors</option>
              <option value="none">None</option>
            </select>
            <i class="fas fa-chevron-down" aria-hidden="true"></i>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Case Converter: auto-fill from Title by default</div>
            <div class="row-desc">When enabled, the Case Converter will default to syncing its input from the Live Editor Title field.</div>
          </div>
          <label class="tf-switch">
            <input type="checkbox" id="caseAutoFillFromTitleDefault" />
            <span class="tf-switch-track" aria-hidden="true"></span>
          </label>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">Sticky Locale Badges Panel</div>
            <div class="row-desc">Keep the locale badges panel open even when the main content area is scrolled.</div>
          </div>
          <label class="tf-switch">
            <input type="checkbox" id="toggleBadgesSticky" />
            <span class="tf-switch-track" aria-hidden="true"></span>
          </label>
        </div>
      </div>
    </div>
  `;
}

function createAboutTabContent() {
  return `
    <div class="settings-section settings-root">
      <h3>🎮 About TileForge</h3>
      <div class="about-info">
        ${typeof window.renderVersionCard === 'function' ? window.renderVersionCard({ headingLevel: 'h5', wrapperClass: 'version-info' }) : ''}

        <div class="info-section">
          <h4>🛠️ Hotfixes (2.4.1)</h4>
          <ul>
            <li><strong>Iris export compatibility:</strong> Fixed CSV export to avoid malformed structures that Iris rejected. Exports now strictly match the expected Iris import schema.</li>
            <li><strong>Locale Validator:</strong> Added validation pass with a <em>linkable pill</em> in the UI showing overall status; clicking opens a full report modal with details and a "Locales: No CSV" state when applicable.</li>
            <li><strong>Transform Data guidance:</strong> Added in-tool context and instructions to help map and clean incoming CSVs before processing.</li>
            <li><strong>Case Converter upgrades:</strong> New space remover utility and an option to inherit the current <em>Title</em> field for quick input when game titles are commonly reused.</li>
          </ul>
        </div>

        <div class="info-section">
          <h4>🎮 About TileForge</h4>
          <p>TileForge is a comprehensive Xbox tile localization preview tool designed to streamline the process of creating and managing localized game tiles across multiple regions and languages.</p>
        </div>

        <div class="info-section whats-new">
          <h4>✨ What’s New in 2.4.0</h4>
          <ul>
            <li><strong>New Projects module:</strong> Left‑panel Projects manager with Save, Clone, New, Remove, and Export to Iris CSV. Per‑file actions and quick preview centralize session files.</li>
            <li><strong>Locale pills and badges:</strong> New pill row under the toolbar with language/status palettes, optional status borders, anchor links, counts, and sticky wrapper. Interactive filters by language/status.</li>
            <li><strong>Locale Picker upgrades:</strong> Quick picks for ToH and Mobile defaults, language pills, improved filtering and scoped modal styling.</li>
            <li><strong>GridPeek — CSV Quick Viewer:</strong> Read‑only CSV modal with filename meta and capped rows. Launch from Projects or toolbar.</li>
            <li><strong>Dynamic Export ready state:</strong> Export buttons reflect saved/dirty via <code>[data-ready]</code> and global events (<code>tileforge:file-dirty</code>/<code>tileforge:file-saved</code>).</li>
            <li><strong>Save overwrite confirmation:</strong> Confirmation prompt with accent styling before overwriting an existing filename.</li>
            <li><strong>Interactive analytics:</strong> Analytics cards sort/filter and anchor to impacted entries for faster triage.</li>
            <li><strong>Quality‑of‑life:</strong> Clear All buttons per field, template validation pass, and sticky previews polish.</li>
          </ul>
          <p><strong>Information Center:</strong> A comprehensive, always-up-to-date help & support modal. Browse features, new tools, tips & tricks, keyboard shortcuts, troubleshooting, and future plans—all in one place!</p>
        </div>

        <div class="info-section">
          <h4>🛠️ Technical Stack</h4>
          <ul>
            <li><strong>Frontend:</strong> Vanilla JavaScript ES6+, HTML5, CSS3</li>
            <li><strong>Canvas API:</strong> Pixel-perfect text measurement and analysis</li>
            <li><strong>File Handling:</strong> FileReader API for CSV and image processing</li>
            <li><strong>Responsive Design:</strong> CSS Grid and Flexbox layouts</li>
            <li><strong>Accessibility:</strong> ARIA labels, keyboard navigation, focus management</li>
            <li><strong>Performance:</strong> Optimized rendering with efficient DOM manipulation</li>
          </ul>
        </div>

        <div class="info-section">
          <h4>🎨 Template System</h4>
          <p>TileForge now supports multiple Xbox tile templates optimized for different platforms:</p>
          <ul>
            <li><strong>Top of Home (ToH):</strong> Traditional 560×315px horizontal Xbox dashboard tiles</li>
            <li><strong>Mobile Spotlight:</strong> NEW 694×758px vertical mobile-optimized tiles</li>
            <li><strong>Dynamic Switching:</strong> Seamless template switching with automatic tile updates</li>
            <li><strong>Template Persistence:</strong> Robust template consistency across all UI interactions</li>
            <li><strong>Enhanced Capacity:</strong> Mobile Spotlight supports 50% more text (60/80 char vs 40/40)</li>
          </ul>
        </div>

        <div class="info-section">
          <h4>🤖 Auto-Localization System</h4>
          <p>Advanced preset management with intelligent localization capabilities:</p>
          <ul>
            <li><strong>JSON-Based Presets:</strong> Modular preset files with 121+ language translations</li>
            <li><strong>Smart Toggle:</strong> Switch between localized text per locale vs English for all</li>
            <li><strong>Preset Library:</strong> Available Now, Buy Now, Pre-order Now, New Season presets</li>
            <li><strong>Dropdown Selection:</strong> Per-field preset selection with immediate preview</li>
            <li><strong>Apply All:</strong> Bulk application of presets across all tiles with one click</li>
          </ul>
        </div>

        <div class="info-section">
          <h4>🌟 Key Innovations</h4>
          <ul>
            <li><strong>Visual Text Measurement:</strong> Canvas-based pixel measurement replaces unreliable character counting</li>
            <li><strong>Template-Aware Analysis:</strong> Text limits and overflow detection adapt to selected template</li>
            <li><strong>Modular Architecture:</strong> Zero-duplication CSS with feature-based separation</li>
            <li><strong>Real-time Preview:</strong> Instant visual feedback for all tile modifications</li>
            <li><strong>Advanced Filtering:</strong> Multi-dimensional filtering by status, locale, language, and region</li>
          </ul>
        </div>

        <div class="info-section">
          <h4>🎯 Design Philosophy</h4>
          <p>TileForge emphasizes professional development standards:</p>
          <ul>
            <li><strong>Precision over Approximation:</strong> Exact measurements instead of estimates</li>
            <li><strong>Modularity over Monoliths:</strong> Clean separation of concerns</li>
            <li><strong>User Experience First:</strong> Intuitive interfaces with immediate feedback</li>
            <li><strong>Performance Optimization:</strong> Efficient algorithms and minimal resource usage</li>
            <li><strong>Accessibility by Design:</strong> Inclusive interfaces for all users</li>
          </ul>
        </div>

        <div class="info-section">
          <h4>🔮 Future Roadmap</h4>
          <p>Planned enhancements include:</p>
          <ul>
            <li>Advanced export options with custom formatting</li>
            <li>Batch editing capabilities for multiple tiles</li>
            <li>Integration with external localization services</li>
            <li>Enhanced image processing and optimization tools</li>
            <li>Collaborative editing features</li>
          </ul>
        </div>

        <div class="info-section">
          <h4>👥 Credits</h4>
          <p>TileForge development team:</p>
          <ul>
            <li><strong>Jon:</strong> Initial base code concept and foundation</li>
            <li><strong>Chad:</strong> Upgrades, enhancements, and system refinement</li>
            <li><strong>Tania Jimenez:</strong> Thoughtful testing feedback and steadfast backing support for this project</li>
            <li><strong>Joel Valdes Beneyto:</strong> Detailed testing feedback and strong backing support for this project</li>
          </ul>
          <p>Special thanks to all contributors who helped shape TileForge into a comprehensive Xbox localization tool. Thank you for helping make this project the best it can possibly be.</p>
        </div>
      </div>
    </div>
  `;
}

// ===== PLACEHOLDER FUNCTIONS =====

function showChangelog() {
  if (window.Modal && typeof Modal.alert === 'function') {
    Modal.alert('Changelog feature coming soon!', 'info');
  } else {
    alert('Changelog feature coming soon!');
  }
}

function reportIssue() {
  if (window.Modal && typeof Modal.alert === 'function') {
    Modal.alert('Issue reporting feature coming soon!', 'info');
  } else {
    alert('Issue reporting feature coming soon!');
  }
}

function checkForUpdates() {
  // In Electron environment, trigger manual update check
  if (typeof require !== 'undefined') {
    try {
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('check-for-updates');
      if (window.Modal && typeof Modal.alert === 'function') {
        Modal.alert('Checking for updates... You will be notified if an update is available.', 'info');
      } else {
        alert('Checking for updates... You will be notified if an update is available.');
      }
    } catch (error) {
      console.log('Running in web mode, update check not available');
      if (window.Modal && typeof Modal.alert === 'function') {
        Modal.alert('Manual update check is only available in the desktop version of TileForge.', 'warning');
      } else {
        alert('Manual update check is only available in the desktop version of TileForge.');
      }
    }
  } else {
    if (window.Modal && typeof Modal.alert === 'function') {
      Modal.alert('Manual update check is only available in the desktop version of TileForge.', 'warning');
    } else {
      alert('Manual update check is only available in the desktop version of TileForge.');
    }
  }
}

// ===== INITIALIZATION =====

document.addEventListener('DOMContentLoaded', function() {
  console.log('Initializing TileForge Settings System');
  
  // Load settings on startup
  loadSettings();
  // Apply persisted sticky state for localized previews (header + badges) on startup
  try { applyBadgesStickyState(); } catch (_) {}
  // Apply persisted status borders preference on startup
  try {
    const badgesSection = document.querySelector('.locale-badges-section');
    if (badgesSection) badgesSection.classList.toggle('status-borders-off', !currentSettings.statusPillBorders);
  } catch (_) {}
  
  // Add global keyboard shortcut listener
  document.addEventListener('keydown', handleGlobalShortcuts);
  
  // Add theme option click handlers
  document.addEventListener('click', function(event) {
    if (event.target.closest('.theme-option')) {
      document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.remove('selected');
      });
      event.target.closest('.theme-option').classList.add('selected');
    }
  });
  
  // Add settings change handlers
  const autosaveFreq = document.getElementById('autosaveFreq');
  const csvDelimiter = document.getElementById('csvDelimiter');
  const showIntroStartup = document.getElementById('showIntroStartup');
  
  if (autosaveFreq) {
    autosaveFreq.addEventListener('change', function() {
      currentSettings.autosaveFreq = parseInt(this.value);
      saveSettings();
    });
  }
  
  if (csvDelimiter) {
    csvDelimiter.addEventListener('change', function() {
      currentSettings.csvDelimiter = this.value;
      saveSettings();
    });
  }
  
  if (showIntroStartup) {
    showIntroStartup.addEventListener('change', function() {
      currentSettings.showIntroStartup = this.checked;
      localStorage.setItem('tileforge-show-intro', this.checked ? 'true' : 'false');
      saveSettings();
    });
  }
  
  console.log('Settings system initialized successfully');
});

// Apply sticky state to the Locale Badges Panel and sync UI toggle
function applyBadgesStickyState() {
  // Apply sticky to the unified header+badges wrapper
  const previewsStickyBlock = document.querySelector('#localizedPreviewsStickyBlock');
  const stickyOn = !!currentSettings.badgesPanelSticky;
  if (previewsStickyBlock) {
    previewsStickyBlock.classList.toggle('sticky', stickyOn);
  }
  // Back-compat: if a badges-only sticky still exists, keep it in sync (future sub-sticky can override)
  const badgesSection = document.querySelector('.locale-badges-section');
  if (badgesSection) {
    badgesSection.classList.toggle('sticky', stickyOn);
  }

  // Sync inline/modal badges toggle if present
  const toggle = document.getElementById('toggleBadgesSticky');
  const stateLabel = document.getElementById('badgesStickyState');
  if (toggle) {
    toggle.checked = stickyOn;
    toggle.setAttribute('aria-checked', String(stickyOn));
  }
  if (stateLabel) {
    stateLabel.textContent = stickyOn ? 'On' : 'Off';
  }

  // Sync new header pill toggle
  const headerToggle = document.getElementById('togglePreviewsStickyHeader');
  const headerState = document.getElementById('previewsStickyHeaderState');
  if (headerToggle) {
    headerToggle.checked = stickyOn;
    headerToggle.setAttribute('aria-checked', String(stickyOn));
  }
  if (headerState) {
    headerState.textContent = stickyOn ? 'On' : 'Off';
  }

  // Compute anchor offset only when sticky is active so section anchors are not hidden
  try {
    const root = document.documentElement;
    if (stickyOn && previewsStickyBlock) {
      // Use offsetHeight to include borders/padding; fallback to 72px if zero
      const h = Math.max(previewsStickyBlock.offsetHeight || 0, 1) ? previewsStickyBlock.offsetHeight : 72;
      root.style.setProperty('--localized-sticky-anchor-offset', h + 'px');
    } else {
      root.style.removeProperty('--localized-sticky-anchor-offset');
    }
  } catch (_) {}
}

// Wire sticky toggle interaction in main UI
document.addEventListener('change', function(event) {
  const t = event.target;
  if (t && (t.id === 'toggleBadgesSticky' || t.id === 'togglePreviewsStickyHeader')) {
    const enabled = !!t.checked;
    currentSettings.badgesPanelSticky = enabled;
    saveSettings();
    applyBadgesStickyState();
  }
});

// Recompute anchor offset on resize if sticky is active (layout/height can change)
window.addEventListener('resize', function() {
  try {
    if (currentSettings && currentSettings.badgesPanelSticky) {
      applyBadgesStickyState();
    }
  } catch (_) {}
});

// ===== MODAL CLOSE ON OUTSIDE CLICK =====

document.addEventListener('click', function(event) {
  const modal = document.getElementById('settingsModal');
  if (modal && event.target === modal) {
    closeSettings();
  }
});

// ===== ESCAPE KEY TO CLOSE MODAL =====

document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    const modal = document.getElementById('settingsModal');
    if (modal && modal.style.display === 'flex') {
      closeSettings();
    }
  }
});

function applyShortcutsFilter(q) {
  const rows = document.querySelectorAll('#shortcutsList .settings-row');
  if (!rows || rows.length === 0) return;
  if (!q) {
    rows.forEach(r => r.classList.remove('hidden'));
    return;
    }
  rows.forEach(r => {
    const hay = r.getAttribute('data-filter-text') || r.textContent || '';
    const match = hay.toLowerCase().includes(q);
    r.classList.toggle('hidden', !match);
  });
}

// ===== STARTUP: Load settings immediately so other modules see persisted values =====
try {
  loadSettings();
} catch (e) {
  console.warn('Settings failed to load on startup:', e);
}

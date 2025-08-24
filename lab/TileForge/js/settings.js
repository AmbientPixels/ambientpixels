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



  'dark-focus': {
    '--theme-primary': '#adb5bd',
    '--theme-secondary': '#6c757d',
    '--theme-background': '#212529',
    '--theme-surface': '#343a40',
    '--theme-text': '#f8f9fa',
    '--theme-text-secondary': '#adb5bd',
    '--theme-accent': '#6c757d',
    '--theme-border': '#495057'
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
  badgesPanelSticky: false
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
      content: createShortcutsTabContent()
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
    previewArea.style.cssText = '';
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
    item.className = 'shortcut-item';
    
    const actionName = action.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const keys = shortcut.split('+').map(key => `<kbd>${key}</kbd>`).join(' + ');
    
    item.innerHTML = `
      <div class="shortcut-action">${actionName}</div>
      <div class="shortcut-keys">${keys}</div>
      <button class="shortcut-edit" onclick="editShortcut('${action}')">Edit</button>
    `;
    
    shortcutsList.appendChild(item);
  });
}

function initializeThemeSelection() {
  // Update theme selection to show current theme
  const currentThemeOption = document.querySelector(`[data-theme="${currentSettings.theme}"]`);
  if (currentThemeOption) {
    document.querySelectorAll('.theme-option').forEach(option => {
      option.classList.remove('selected');
    });
    currentThemeOption.classList.add('selected');
  }
  
  // Add click handlers for theme options
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', function() {
      document.querySelectorAll('.theme-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      this.classList.add('selected');
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
    <div class="settings-section">
      <h3>Theme Selection</h3>
      <div class="theme-preview-area">
        <div class="theme-preview-tile">
          <div class="preview-header">Theme Preview</div>
          <div class="preview-content">Sample content with current theme</div>
        </div>
      </div>
      
      <div class="theme-grid">
        <div class="theme-option" data-theme="default">
          <div class="theme-preview default-preview"></div>
          <div class="theme-info">
            <h4>Default</h4>
            <p>Original TileForge theme</p>
          </div>
        </div>
        
        <div class="theme-option" data-theme="xbox-green">
          <div class="theme-preview xbox-green-preview"></div>
          <div class="theme-info">
            <h4>Xbox Green</h4>
            <p>Official Xbox brand colors</p>
          </div>
        </div>
        
        <div class="theme-option" data-theme="corporate-dark">
          <div class="theme-preview corporate-dark-preview"></div>
          <div class="theme-info">
            <h4>Corporate Dark</h4>
            <p>Professional dark theme</p>
          </div>
        </div>
        
        <div class="theme-option" data-theme="corporate-light">
          <div class="theme-preview corporate-light-preview"></div>
          <div class="theme-info">
            <h4>Corporate Light</h4>
            <p>Clean professional theme</p>
          </div>
        </div>
        
        <div class="theme-option" data-theme="light-focus">
          <div class="theme-preview light-focus-preview"></div>
          <div class="theme-info">
            <h4>Light Focus</h4>
            <p>Minimal distraction-free</p>
          </div>
        </div>
        
        <div class="theme-option" data-theme="dark-focus">
          <div class="theme-preview dark-focus-preview"></div>
          <div class="theme-info">
            <h4>Dark Focus</h4>
            <p>Dark minimal theme</p>
          </div>
        </div>
      </div>
      
      <div class="theme-actions">
        <button class="btn secondary" onclick="previewTheme()">Preview</button>
        <button class="btn primary" onclick="applySelectedTheme()">Apply Theme</button>
      </div>
    </div>
  `;
}

function createShortcutsTabContent() {
  return `
    <div class="settings-section">
      <h3>Keyboard Shortcuts</h3>
      <div class="shortcuts-search">
        <input type="text" placeholder="Search shortcuts..." id="shortcutsSearch">
      </div>
      
      <div class="shortcuts-list" id="shortcutsList">
        <!-- Shortcuts will be populated by updateShortcutsDisplay() -->
      </div>
      
      <div class="shortcuts-actions">
        <button class="btn secondary" onclick="resetShortcuts()">Reset to Defaults</button>
        <button class="btn secondary" onclick="exportShortcuts()">Export</button>
        <button class="btn secondary" onclick="importShortcuts()">Import</button>
      </div>
    </div>
  `;
}

function createGeneralTabContent() {
  return `
    <div class="settings-section">
      <h3>General Settings</h3>
      <div class="setting-group">
        <label>Auto-save Frequency</label>
        <select id="autosaveFreq">
          <option value="30">30 seconds</option>
          <option value="60" selected>1 minute</option>
          <option value="300">5 minutes</option>
          <option value="0">Manual only</option>
        </select>
      </div>
      
      <div class="setting-group">
        <label>Default CSV Delimiter</label>
        <select id="csvDelimiter">
          <option value="," selected>Comma (,)</option>
          <option value=";">Semicolon (;)</option>
          <option value="\t">Tab</option>
        </select>
      </div>
      
      <div class="setting-group">
        <label>
          <input type="checkbox" id="showIntroStartup" checked>
          Show intro on startup
        </label>
      </div>

      <div class="setting-group">
        <label>
          <input type="checkbox" id="loadLastSavedOnStartup">
          Load last saved data on startup
        </label>
        <div class="setting-hint">Overrides empty start unless ?autoload=1 or an autoload flag is set. Uses the most recently processed CSV from this browser.</div>
      </div>
      
      <div class="setting-group">
        <label>
          <input type="checkbox" id="statusPillColorsPref">
          Status pill colors (locale badges)
        </label>
        <div class="setting-hint">Controls green/orange/red for Clean / Near-limit / Overflow on locale pills.</div>
      </div>

      <div class="setting-group">
        <label>
          <input type="checkbox" id="statusPillBordersPref" checked>
          Status borders on locale badges
        </label>
        <div class="setting-hint">When enabled, default view shows a colored border around each locale badge based on status (Clean/ Near-limit/ Overflow). Turn off to hide these borders.</div>
      </div>

      <div class="setting-group">
        <label>
          <input type="checkbox" id="languagePillColorsPref">
          Language pill colors (locale badges)
        </label>
        <div class="setting-hint">Per-language color palette for locale pills (lang-en, lang-fr, etc.).</div>
      </div>
      
      <div class="setting-group">
        <label>Default pill palette</label>
        <select id="defaultPillPalettePref">
          <option value="language">Language colors</option>
          <option value="status">Status colors</option>
          <option value="none">None</option>
        </select>
        <div class="setting-hint">If both toggles are OFF, this preference determines which palette turns ON automatically. "None" leaves both off.</div>
      </div>
      
      <div class="setting-group">
        <label>
          <input type="checkbox" id="toggleBadgesSticky">
          Sticky Locale Badges Panel
        </label>
        <div class="setting-hint">Keep the locale badges panel open even when the main content area is scrolled.</div>
        <div class="setting-state" id="badgesStickyState">Off</div>
      </div>
    </div>
  `;
}

function createAboutTabContent() {
  return `
    <div class="settings-section">
      <h3>About TileForge</h3>
      <div class="about-info">
        <div class="version-info">
          <h4>Version 1.0.1</h4>
          <p><strong>Xbox Tile Localization Preview Tool</strong></p>
          <p class="version-subtitle">Professional Desktop Edition with Auto-Updates</p>
          <div class="update-badge">
            <i class="fas fa-download"></i>
            <span>Auto-Update Enabled</span>
          </div>
        </div>
        
        <div class="features-highlight">
          <h4>Latest Features</h4>
          <ul class="feature-list">
            <li><i class="fas fa-magic"></i> Enhanced About section with detailed information</li>
            <li><i class="fas fa-sync-alt"></i> Automatic update system for seamless upgrades</li>
            <li><i class="fas fa-desktop"></i> Native desktop app with system integration</li>
            <li><i class="fas fa-language"></i> Support for 52+ languages and locales</li>
            <li><i class="fas fa-chart-line"></i> Advanced analytics and text analysis</li>
          </ul>
        </div>
        
        <div class="credits">
          <h4>Credits & Purpose</h4>
          <p><strong>Built by AmbientPixels</strong> for Xbox content producers and localization teams</p>
          <p><em>Designed to prevent certification failures and streamline the localization workflow</em></p>
          <p>Empowering developers to create perfect tile experiences across all markets</p>
        </div>
        
        <div class="tech-info">
          <h4>Technical Information</h4>
          <div class="tech-grid">
            <div class="tech-item">
              <strong>Platform:</strong> Electron Desktop App
            </div>
            <div class="tech-item">
              <strong>Updates:</strong> Automatic via GitHub Releases
            </div>
            <div class="tech-item">
              <strong>Compatibility:</strong> Windows 10/11
            </div>
            <div class="tech-item">
              <strong>License:</strong> MIT Open Source
            </div>
          </div>
        </div>
        
        <div class="links">
          <button class="btn secondary" onclick="showChangelog()">
            <i class="fas fa-history"></i> View Changelog
          </button>
          <button class="btn secondary" onclick="reportIssue()">
            <i class="fas fa-bug"></i> Report Issue
          </button>
          <button class="btn secondary" onclick="checkForUpdates()">
            <i class="fas fa-download"></i> Check for Updates
          </button>
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

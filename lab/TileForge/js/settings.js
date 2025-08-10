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
  showIntroStartup: true
};

// ===== SETTINGS MODAL FUNCTIONS =====

function openSettings() {
  const tabs = [
    {
      title: 'Themes',
      icon: '🎨',
      content: createThemesTabContent()
    },
    {
      title: 'Shortcuts',
      icon: '⌨️',
      content: createShortcutsTabContent()
    },
    {
      title: 'General',
      icon: '⚙️',
      content: createGeneralTabContent()
    },
    {
      title: 'About',
      icon: 'ℹ️',
      content: createAboutTabContent()
    }
  ];

  const settingsModal = Modal.createTabbedModal({
    title: '⚙️ TileForge Settings',
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
}

function editShortcut(action) {
  const actionName = action.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const newShortcut = prompt(`Enter new shortcut for ${actionName}:`, currentSettings.shortcuts[action]);
  
  if (newShortcut && newShortcut.trim()) {
    currentSettings.shortcuts[action] = newShortcut.trim();
    updateShortcutsDisplay();
    saveSettings();
    console.log(`Updated shortcut for ${action}: ${newShortcut}`);
  }
}

function resetShortcuts() {
  if (confirm('Reset all keyboard shortcuts to defaults?')) {
    currentSettings.shortcuts = { ...DEFAULT_SHORTCUTS };
    updateShortcutsDisplay();
    saveSettings();
    console.log('Shortcuts reset to defaults');
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
      currentSettings = { ...currentSettings, ...parsedSettings };
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
    alert('Failed to export shortcuts');
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
          alert('Shortcuts imported successfully!');
          console.log('Shortcuts imported successfully');
        } catch (error) {
          console.error('Failed to import shortcuts:', error);
          alert('Failed to import shortcuts: Invalid file format');
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
          <option value="\\t">Tab</option>
        </select>
      </div>
      
      <div class="setting-group">
        <label>
          <input type="checkbox" id="showIntroStartup" checked>
          Show intro on startup
        </label>
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
          <h4>Version 1.2.0</h4>
          <p>Xbox Tile Localization Preview Tool</p>
        </div>
        
        <div class="credits">
          <h4>Credits</h4>
          <p>Built for Producers publishing Xbox content</p>
          <p>Designed to prevent certification failures</p>
        </div>
        
        <div class="links">
          <button class="btn secondary" onclick="showChangelog()">View Changelog</button>
          <button class="btn secondary" onclick="reportIssue()">Report Issue</button>
        </div>
      </div>
    </div>
  `;
}

// ===== PLACEHOLDER FUNCTIONS =====

function showChangelog() {
  alert('Changelog feature coming soon!');
}

function reportIssue() {
  alert('Issue reporting feature coming soon!');
}

// ===== INITIALIZATION =====

document.addEventListener('DOMContentLoaded', function() {
  console.log('Initializing TileForge Settings System');
  
  // Load settings on startup
  loadSettings();
  
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

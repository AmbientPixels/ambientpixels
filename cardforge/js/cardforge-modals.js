/**
 * CardForge Modal System
 * TileForge-style settings and help/info modals
 */

// ================================
// MODAL SYSTEM CLASS
// ================================

class Modal {
  constructor(options = {}) {
    this.title = options.title || 'Modal';
    this.size = options.size || 'medium';
    this.tabs = options.tabs || [];
    this.activeTab = options.activeTab || 0;
    this.overlay = null;
    this.container = null;
    this.onClose = options.onClose || null;
  }

  static createTabbedModal(options) {
    return new Modal(options);
  }

  show() {
    this.create();
    document.body.appendChild(this.overlay);
    
    setTimeout(() => {
      this.overlay.classList.add('show');
    }, 10);
    
    this.trapFocus();
  }

  hide() {
    if (this.overlay) {
      this.overlay.classList.remove('show');
      setTimeout(() => {
        if (this.overlay && this.overlay.parentNode) {
          this.overlay.parentNode.removeChild(this.overlay);
        }
        if (this.onClose) {
          this.onClose();
        }
      }, 300);
    }
  }

  create() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    this.container = document.createElement('div');
    this.container.className = `modal-container size-${this.size}`;

    const header = document.createElement('div');
    header.className = 'modal-header';
    
    const title = document.createElement('h2');
    title.className = 'modal-title';
    title.textContent = this.title;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.addEventListener('click', () => this.hide());
    
    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'modal-body';

    if (this.tabs.length > 0) {
      const tabsContainer = document.createElement('div');
      tabsContainer.className = 'modal-tabs';

      this.tabs.forEach((tab, index) => {
        const tabBtn = document.createElement('button');
        tabBtn.className = `modal-tab ${index === this.activeTab ? 'active' : ''}`;
        tabBtn.innerHTML = `${tab.icon} ${tab.title}`;
        tabBtn.addEventListener('click', () => this.switchTab(index));
        tabsContainer.appendChild(tabBtn);
      });

      body.appendChild(tabsContainer);

      this.tabs.forEach((tab, index) => {
        const content = document.createElement('div');
        content.className = `modal-tab-content ${index === this.activeTab ? 'active' : ''}`;
        content.innerHTML = tab.content;
        body.appendChild(content);
      });
    }

    this.container.appendChild(header);
    this.container.appendChild(body);
    this.overlay.appendChild(this.container);

    document.addEventListener('keydown', this.handleKeydown.bind(this));
  }

  switchTab(index) {
    const tabButtons = this.overlay.querySelectorAll('.modal-tab');
    tabButtons.forEach((btn, i) => {
      btn.classList.toggle('active', i === index);
    });

    const tabContents = this.overlay.querySelectorAll('.modal-tab-content');
    tabContents.forEach((content, i) => {
      content.classList.toggle('active', i === index);
    });

    this.activeTab = index;
  }

  handleKeydown(e) {
    if (e.key === 'Escape') {
      this.hide();
    }
  }

  trapFocus() {
    const focusableElements = this.container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  }
}

// ================================
// SETTINGS MODAL
// ================================

function openSettings() {
  const tabs = [
    {
      title: 'Themes',
      icon: '🎨',
      content: createThemesTabContent()
    },
    {
      title: 'Preferences',
      icon: '⚙️',
      content: createPreferencesTabContent()
    },
    {
      title: 'About',
      icon: 'ℹ️',
      content: createAboutTabContent()
    }
  ];

  const settingsModal = Modal.createTabbedModal({
    title: '⚙️ CardForge Settings',
    size: 'large',
    tabs: tabs,
    activeTab: 0
  });

  settingsModal.show();
  
  setTimeout(() => {
    initializeThemeSelection();
    initializePreferences();
  }, 100);
}

function createThemesTabContent() {
  return `
    <div class="settings-section">
      <h4>🎨 Theme Selection</h4>
      <p>Choose your preferred theme for CardForge.</p>
      
      <div class="theme-options">
        <div class="theme-option" data-theme="dark">
          <div class="theme-preview dark-preview">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-card"></div>
            </div>
          </div>
          <h5>Dark Theme</h5>
          <p>Perfect for late-night sessions</p>
        </div>
        
        <div class="theme-option" data-theme="light">
          <div class="theme-preview light-preview">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-card"></div>
            </div>
          </div>
          <h5>Light Theme</h5>
          <p>Clean and bright</p>
        </div>
      </div>
    </div>
  `;
}

function createPreferencesTabContent() {
  return `
    <div class="settings-section">
      <h4>⚙️ General Preferences</h4>
      
      <div class="preference-group">
        <h5>Editor Behavior</h5>
        <label class="preference-item">
          <input type="checkbox" id="auto-save-enabled" />
          <span class="checkmark"></span>
          Enable auto-save (saves every 30 seconds)
        </label>
        <label class="preference-item">
          <input type="checkbox" id="real-time-preview" checked />
          <span class="checkmark"></span>
          Real-time preview updates
        </label>
        <label class="preference-item">
          <input type="checkbox" id="show-grid-lines" />
          <span class="checkmark"></span>
          Show alignment grid lines
        </label>
      </div>
      
      <div class="preference-group">
        <h5>Export Settings</h5>
        <label class="preference-item">
          <span class="preference-label">Default export format:</span>
          <select id="default-export-format">
            <option value="png">PNG (Recommended)</option>
            <option value="jpg">JPEG</option>
            <option value="svg">SVG</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label class="preference-item">
          <span class="preference-label">Export quality:</span>
          <select id="export-quality">
            <option value="high">High (300 DPI)</option>
            <option value="medium" selected>Medium (150 DPI)</option>
            <option value="low">Low (72 DPI)</option>
          </select>
        </label>
      </div>
    </div>
  `;
}

function createAboutTabContent() {
  return `
    <div class="settings-section">
      <h4>ℹ️ About CardForge</h4>
      
      <div class="about-info">
        <div class="about-logo">
          <i class="fas fa-magic" style="font-size: 3rem; color: var(--primary-color);"></i>
        </div>
        
        <div class="about-details">
          <h5>CardForge V2</h5>
          <p class="version">Version 2.0.0</p>
          <p class="description">
            A browser-based RPG card creation toolkit powered by Nova's crystalline flux aesthetic.
            Create, customize, and share stunning collectible cards for tabletop RPGs, fan worlds, and trading card concepts.
          </p>
        </div>
      </div>
      
      <div class="about-features">
        <h5>Key Features</h5>
        <ul>
          <li>Real-time preview with theme-aware templates</li>
          <li>Modular design system with containers and effects</li>
          <li>Gallery sharing and private card management</li>
          <li>Open API for deck import/export</li>
          <li>Responsive design for desktop and mobile</li>
        </ul>
      </div>
      
      <div class="about-credits">
        <h5>Credits</h5>
        <p>Built with ❤️ by the AmbientPixels team</p>
        <p>Powered by Nova's ambient AI system</p>
        <p>Part of the EchoGrid creative toolkit ecosystem</p>
      </div>
    </div>
  `;
}

// ================================
// HELP/INFO MODAL
// ================================

function showInfoPopup() {
  const tabs = [
    {
      title: 'Features',
      icon: '🚀',
      content: createFeaturesTabContent()
    },
    {
      title: 'Getting Started',
      icon: '🎯',
      content: createGettingStartedTabContent()
    },
    {
      title: 'Tips & Tricks',
      icon: '💡',
      content: createTipsTabContent()
    },
    {
      title: 'Shortcuts',
      icon: '⌨️',
      content: createShortcutsTabContent()
    }
  ];

  const infoModal = Modal.createTabbedModal({
    title: '📖 CardForge Help Center',
    size: 'large',
    tabs: tabs,
    activeTab: 0
  });

  infoModal.show();
}

function createFeaturesTabContent() {
  return `
    <div class="info-section">
      <h4>🚀 Core Features</h4>
      <div class="feature-grid">
        <div class="feature-item">
          <h5>🎨 Real-time Design</h5>
          <p>See your card design update instantly as you type and adjust settings. No need to refresh or wait for previews.</p>
        </div>
        <div class="feature-item">
          <h5>🃏 Quick Start Presets</h5>
          <p>Jump-start your design with hero, villain, spell, and item templates. Each preset includes optimized layouts and styling.</p>
        </div>
        <div class="feature-item">
          <h5>🎭 Modular Design System</h5>
          <p>Customize every aspect with our tier-based system: containers, effects, colors, and alignment options.</p>
        </div>
        <div class="feature-item">
          <h5>🌙 Theme Awareness</h5>
          <p>Designs automatically adapt to light/dark modes with Nova's crystalline flux aesthetic for consistent beauty.</p>
        </div>
        <div class="feature-item">
          <h5>📱 Responsive Design</h5>
          <p>Works perfectly on desktop, tablet, and mobile devices. Create cards anywhere, anytime.</p>
        </div>
        <div class="feature-item">
          <h5>💾 Smart Saving</h5>
          <p>Auto-save functionality and manual save options ensure your work is never lost.</p>
        </div>
      </div>
    </div>
  `;
}

function createGettingStartedTabContent() {
  return `
    <div class="info-section">
      <h4>🎯 Getting Started Guide</h4>
      
      <div class="getting-started-steps">
        <div class="step-item">
          <div class="step-number">1</div>
          <div class="step-content">
            <h5>Choose Your Starting Point</h5>
            <p>Begin with a Quick Start Preset (Hero, Villain, Spell, or Item) or start from scratch with a blank card.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">2</div>
          <div class="step-content">
            <h5>Add Basic Information</h5>
            <p>Fill in the card name, description, and any stats or attributes. Use the step-by-step interface to guide you.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">3</div>
          <div class="step-content">
            <h5>Customize the Design</h5>
            <p>Use the modular design system to adjust containers, effects, colors, and alignment. Each tier offers different customization options.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">4</div>
          <div class="step-content">
            <h5>Upload Artwork</h5>
            <p>Add your character or item image using the artwork section. Supports PNG, JPG, and GIF formats.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">5</div>
          <div class="step-content">
            <h5>Save and Share</h5>
            <p>Save your card locally, export as an image, or publish to the community gallery for others to see.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function createTipsTabContent() {
  return `
    <div class="info-section">
      <h4>💡 Tips & Tricks</h4>
      
      <div class="tips-grid">
        <div class="tip-item">
          <h5>🎨 Design Tips</h5>
          <ul>
            <li>Use high contrast between text and background for readability</li>
            <li>Keep important information in the upper portion of the card</li>
            <li>Limit yourself to 2-3 colors for a cohesive look</li>
            <li>Use the masked container for character portraits</li>
            <li>Test your design in both light and dark themes</li>
          </ul>
        </div>
        
        <div class="tip-item">
          <h5>⚡ Workflow Tips</h5>
          <ul>
            <li>Start with a preset to save time on basic layout</li>
            <li>Use the step-by-step interface to stay organized</li>
            <li>Save different versions of your card as you iterate</li>
            <li>Preview your card at different screen sizes</li>
            <li>Use keyboard shortcuts for faster navigation</li>
          </ul>
        </div>
        
        <div class="tip-item">
          <h5>🖼️ Image Tips</h5>
          <ul>
            <li>Use high-resolution images (at least 300x300px)</li>
            <li>PNG format works best for images with transparency</li>
            <li>Consider the aspect ratio when choosing container types</li>
            <li>Optimize image file sizes for better performance</li>
          </ul>
        </div>
        
        <div class="tip-item">
          <h5>📝 Content Tips</h5>
          <ul>
            <li>Keep card names short and memorable</li>
            <li>Write descriptions that tell a story</li>
            <li>Use consistent terminology across your deck</li>
            <li>Balance flavor text with mechanical information</li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

function createShortcutsTabContent() {
  return `
    <div class="info-section">
      <h4>⌨️ Keyboard Shortcuts</h4>
      <p>Speed up your workflow with these keyboard shortcuts:</p>
      
      <div class="shortcuts-grid">
        <div class="shortcut-category">
          <h5>General</h5>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>S</kbd></span>
            <span class="shortcut-desc">Save card</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>Z</kbd></span>
            <span class="shortcut-desc">Undo</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>Y</kbd></span>
            <span class="shortcut-desc">Redo</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>N</kbd></span>
            <span class="shortcut-desc">New card</span>
          </div>
        </div>
        
        <div class="shortcut-category">
          <h5>Navigation</h5>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Tab</kbd></span>
            <span class="shortcut-desc">Next field</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Shift</kbd> + <kbd>Tab</kbd></span>
            <span class="shortcut-desc">Previous field</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>1-7</kbd></span>
            <span class="shortcut-desc">Switch to step 1-7</span>
          </div>
        </div>
        
        <div class="shortcut-category">
          <h5>Help & Settings</h5>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>F1</kbd></span>
            <span class="shortcut-desc">Show help</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>,</kbd></span>
            <span class="shortcut-desc">Open settings</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-keys"><kbd>Esc</kbd></span>
            <span class="shortcut-desc">Close modal</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ================================
// SETTINGS INITIALIZATION
// ================================

function initializeThemeSelection() {
  const themeOptions = document.querySelectorAll('.theme-option');
  const currentTheme = document.body.getAttribute('data-theme') || 'dark';
  
  themeOptions.forEach(option => {
    const theme = option.getAttribute('data-theme');
    if (theme === currentTheme) {
      option.classList.add('selected');
    }
    
    option.addEventListener('click', () => {
      themeOptions.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      setTheme(theme);
    });
  });
}

function initializePreferences() {
  const autoSave = localStorage.getItem('cardforge-auto-save') === 'true';
  const realtimePreview = localStorage.getItem('cardforge-realtime-preview') !== 'false';
  const showGrid = localStorage.getItem('cardforge-show-grid') === 'true';
  const exportFormat = localStorage.getItem('cardforge-export-format') || 'png';
  const exportQuality = localStorage.getItem('cardforge-export-quality') || 'medium';
  
  const autoSaveCheckbox = document.getElementById('auto-save-enabled');
  const realtimeCheckbox = document.getElementById('real-time-preview');
  const gridCheckbox = document.getElementById('show-grid-lines');
  const formatSelect = document.getElementById('default-export-format');
  const qualitySelect = document.getElementById('export-quality');
  
  if (autoSaveCheckbox) autoSaveCheckbox.checked = autoSave;
  if (realtimeCheckbox) realtimeCheckbox.checked = realtimePreview;
  if (gridCheckbox) gridCheckbox.checked = showGrid;
  if (formatSelect) formatSelect.value = exportFormat;
  if (qualitySelect) qualitySelect.value = exportQuality;
  
  // Add event listeners
  if (autoSaveCheckbox) {
    autoSaveCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-auto-save', e.target.checked);
    });
  }
  
  if (realtimeCheckbox) {
    realtimeCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-realtime-preview', e.target.checked);
    });
  }
  
  if (gridCheckbox) {
    gridCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-show-grid', e.target.checked);
    });
  }
  
  if (formatSelect) {
    formatSelect.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-export-format', e.target.value);
    });
  }
  
  if (qualitySelect) {
    qualitySelect.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-export-quality', e.target.value);
    });
  }
}

function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('cardforge-theme', theme);
}

// ================================
// INITIALIZATION
// ================================

document.addEventListener('DOMContentLoaded', function() {
  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.key === 'F1') {
      e.preventDefault();
      showInfoPopup();
    }
    if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      openSettings();
    }
  });
});

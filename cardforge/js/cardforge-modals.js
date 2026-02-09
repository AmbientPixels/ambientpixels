/**
 * CardForge Modal System
 * TileForge-style settings and help/info modals
 */

// ================================
// INTRO SECTION FUNCTIONALITY
// ================================

function initializeIntro() {
  const showIntroOnStartup = localStorage.getItem('cardforge-show-intro');
  
  // Show intro by default for new users, or if preference is set to show
  if (showIntroOnStartup === null || showIntroOnStartup === 'true') {
    showIntro();
  } else {
    hideIntro();
  }
}

function showIntro() {
  const introSection = document.getElementById('introSection');
  if (introSection) {
    introSection.classList.remove('hidden');
  }
}

function hideIntro() {
  const introSection = document.getElementById('introSection');
  if (introSection) {
    introSection.classList.add('hidden');
  }
}

function toggleIntroVisibility(e) {
  const currentSetting = localStorage.getItem('cardforge-show-intro');
  const newSetting = currentSetting === 'false' ? 'true' : 'false';
  
  localStorage.setItem('cardforge-show-intro', newSetting);
  
  // Update button text to reflect current state
  const button = e && e.target ? e.target : null;
  if (button) {
    if (newSetting === 'true') {
      button.textContent = 'Hide on startup';
      button.title = 'Intro will show on next visit';
    } else {
      button.textContent = 'Show on startup';
      button.title = 'Intro will be hidden on next visit';
    }
  }
}

function showIntroManually() {
  showIntro();
}

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

      this.tabs.forEach((tab, index) => {
        const content = document.createElement('div');
        content.className = `modal-tab-content ${index === this.activeTab ? 'active' : ''}`;
        content.innerHTML = tab.content;
        body.appendChild(content);
      });

      this.container.appendChild(header);
      this.container.appendChild(tabsContainer);
      this.container.appendChild(body);
    } else {
      this.container.appendChild(header);
      this.container.appendChild(body);
    }
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
        <h5>Startup Behavior</h5>
        <label class="preference-item">
          <input type="checkbox" id="show-intro-startup" />
          <span class="checkmark"></span>
          Show intro modal on startup
        </label>
        <div class="preference-item">
          <button class="settings-btn secondary" onclick="showIntroManually()">
            <i class="fas fa-magic"></i> Show Welcome Intro
          </button>
        </div>
      </div>
      
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
      icon: '<i class="fas fa-rocket"></i>',
      content: createFeaturesTabContent()
    },
    {
      title: 'Getting Started',
      icon: '<i class="fas fa-bullseye"></i>',
      content: createGettingStartedTabContent()
    },
    {
      title: 'Tips & Tricks',
      icon: '<i class="fas fa-lightbulb"></i>',
      content: createTipsTabContent()
    },
    {
      title: 'Shortcuts',
      icon: '<i class="fas fa-keyboard"></i>',
      content: createShortcutsTabContent()
    }
  ];

  const infoModal = Modal.createTabbedModal({
    title: 'CardForge Help Center',
    size: 'large',
    tabs: tabs,
    activeTab: 0
  });

  infoModal.show();
}

function createFeaturesTabContent() {
  return `
    <div class="info-section">
      <h4><i class="fas fa-chart-bar"></i> By the Numbers</h4>
      <h5 style="margin: 0 0 8px 0; color: var(--primary-color, #6366f1); font-size: 1.1rem;">Nearly 40 Million Possible Card Designs</h5>
      <p style="margin: 0 0 8px 0;">CardForge's modular system combines container types, palette families, layout variants, compositions, and stat configurations into a structured design space that supports nearly 40 million unique visual card designs — all generated within intentional constraints rather than random output.</p>
      <p style="margin: 0 0 24px 0; opacity: 0.8;">This gives creators massive variety without sacrificing readability, balance, or visual consistency.</p>

      <h4><i class="fas fa-rocket"></i> Core Features</h4>
      <div class="feature-grid">
        <div class="feature-item">
          <h5><i class="fas fa-paint-brush"></i> Real-Time Design</h5>
          <p>See your card update instantly as you type or adjust settings. Every change is reflected live — no refreshes, no waiting for previews.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-magic"></i> Quick Start Presets</h5>
          <p>Jump-start your design with curated presets for heroes, villains, spells, items, and archetypes. Each preset applies a complete, tuned configuration across layout, palette, stats, and styling.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-layer-group"></i> Modular Design System</h5>
          <p>Customize every aspect of your card using a tier-based system — container types, palette families, style variants, composition rules, and stat layouts all work together without breaking structure.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-folder-open"></i> My Cards</h5>
          <p>Browse, search, and manage all your saved cards in one place. Edit, duplicate, publish, delete, or add cards to decks from a unified gallery.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-book"></i> Deck Manager</h5>
          <p>Organize cards into themed decks. Create, rename, and curate collections using a visual deck builder with fully rendered card previews.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-share-nodes"></i> Publishing & Sharing</h5>
          <p>Publish cards and decks to the public gallery with a single action. Share links, preview content in-app, and manage visibility without leaving your workflow.</p>
        </div>
      </div>

      <h4 style="margin-top: 24px;"><i class="fas fa-bolt"></i> Latest Updates</h4>
      <div class="feature-grid">
        <div class="feature-item">
          <h5><i class="fas fa-wand-magic-sparkles"></i> Refreshed Interface</h5>
          <p>A fully overhauled UI featuring a collapsible left navigation rail, clearer editor sections, and a smoother step-by-step creation flow designed for focus and speed.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-crop-simple"></i> Inset Container</h5>
          <p>A new container type that renders artwork inside a constrained inset frame. Choose from Panel, Glass, Emblem, or Cutout variants for cleaner, more controlled compositions.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-palette"></i> Expanded Palette Library</h5>
          <p>Five new palette families — Corporate, Royal, Inferno, Frost, and Arcane — join the original collection for a total of 11 palette options (including Auto), each with Light and Dark variants.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-eye-dropper"></i> Auto Palette</h5>
          <p>Select Auto in the palette picker and CardForge analyzes your artwork to automatically choose a complementary color palette optimized for contrast and readability.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-floppy-disk"></i> Save State Feedback</h5>
          <p>Clear visual save states indicate when your work is unsaved, saving, saved, or up to date, helping you stay confident as you iterate.</p>
        </div>
        <div class="feature-item">
          <h5><i class="fas fa-dice"></i> Improved Preset & Random Flow</h5>
          <p>Quick Start Presets and the Random Card generator now use unified iconography, clearer hover states, and improved selection feedback for better visual affordance.</p>
        </div>
      </div>
    </div>
  `;
}

function createGettingStartedTabContent() {
  return `
    <div class="info-section">
      <h4><i class="fas fa-bullseye"></i> Getting Started Guide</h4>
      
      <div class="getting-started-steps">
        <div class="step-item">
          <div class="step-number">1</div>
          <div class="step-content">
            <h5>Choose Your Starting Point</h5>
            <p>Begin with a Quick Start Preset (Hero, Villain, Spell, or Item) or start from scratch with a blank card. You can also hit the random button to generate a completely randomized card.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">2</div>
          <div class="step-content">
            <h5>Add Basic Information</h5>
            <p>Fill in the card name, class, rarity, quote, and stats. Use the step-by-step left rail to navigate between sections.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">3</div>
          <div class="step-content">
            <h5>Select a Container Type</h5>
            <p>Choose how your image is displayed: Masked, Framed, Raw, Full Bleed, Hero, or the new Inset type. Each has its own variants (e.g., Inset offers Panel, Glass, Emblem, and Cutout).</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">4</div>
          <div class="step-content">
            <h5>Pick a Color Palette</h5>
            <p>Choose from 11 palette families: Neon, Earth, Ocean, Sunset, Mono, Corporate, Royal, Inferno, Frost, Arcane, or Auto. Auto analyzes your image and picks the best match. Each palette has Light and Dark variants.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">5</div>
          <div class="step-content">
            <h5>Set Composition & Style</h5>
            <p>Fine-tune alignment (Left, Center, Right) and choose a style variant: None, Padded, Compact, Elegant, Narrow, Bold, Cinematic, Editorial, or Stacked. Each changes the card's typography and spacing.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">6</div>
          <div class="step-content">
            <h5>Upload Artwork</h5>
            <p>Select from the built-in image gallery, paste a custom URL, or browse the paginated image packs. Supports PNG, JPG, and GIF formats.</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">7</div>
          <div class="step-content">
            <h5>Save and Share</h5>
            <p>Save your card locally, publish to the community gallery, or add it to a deck. Cards render consistently across the preview, gallery tiles, and deck modal.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function createTipsTabContent() {
  return `
    <div class="info-section">
      <h4><i class="fas fa-lightbulb"></i> Tips & Tricks</h4>
      
      <div class="tips-grid">
        <div class="tip-item">
          <h5><i class="fas fa-paint-brush"></i> Design Tips</h5>
          <ul>
            <li>Use high contrast between text and background for readability</li>
            <li>Try the Auto palette to let the system match colors to your image</li>
            <li>Test your design in both Light and Dark palette variants</li>
            <li>Use the Inset container for a clean, constrained image frame</li>
            <li>Pair the Bold style with Inferno or Royal for dramatic cards</li>
          </ul>
        </div>
        
        <div class="tip-item">
          <h5><i class="fas fa-image"></i> Image Tips</h5>
          <ul>
            <li>Use high-resolution images (at least 300x300px)</li>
            <li>PNG format works best for images with transparency</li>
            <li>The Inset Emblem variant works great for circular portraits</li>
            <li>Full Bleed is best for landscape or panoramic images</li>
            <li>Auto palette works best with colorful, well-lit images</li>
          </ul>
        </div>
        
        <div class="tip-item">
          <h5><i class="fas fa-bolt"></i> Workflow Tips</h5>
          <ul>
            <li>Start with a preset to save time on basic layout</li>
            <li>Use the collapsible left rail to focus on one section at a time</li>
            <li>Hit the random button to discover unexpected combinations</li>
            <li>Save different versions of your card as you iterate</li>
            <li>Use keyboard shortcuts for faster navigation</li>
          </ul>
        </div>
        
        <div class="tip-item">
          <h5><i class="fas fa-pen"></i> Content Tips</h5>
          <ul>
            <li>Keep card names short and memorable</li>
            <li>Write descriptions that tell a story</li>
            <li>Use consistent terminology across your deck</li>
            <li>The Editorial style pairs well with longer quotes</li>
            <li>Cinematic style adds em-dashes around quotes for flair</li>
          </ul>
        </div>

        <div class="tip-item">
          <h5><i class="fas fa-swatchbook"></i> Palette Pairing Ideas</h5>
          <ul>
            <li><strong>Frost + Cinematic</strong> — ethereal, icy storytelling</li>
            <li><strong>Royal + Elegant</strong> — premium, legendary feel</li>
            <li><strong>Inferno + Bold</strong> — aggressive villain energy</li>
            <li><strong>Corporate + Editorial</strong> — clean, professional look</li>
            <li><strong>Arcane + Stacked</strong> — structured magical codex</li>
          </ul>
        </div>

        <div class="tip-item">
          <h5><i class="fas fa-book"></i> Deck & Publishing Tips</h5>
          <ul>
            <li>Group cards into decks by theme, faction, or campaign</li>
            <li>Reorder cards within a deck to control presentation flow</li>
            <li>Preview your deck before publishing to check consistency</li>
            <li>Published decks are visible in the public gallery immediately</li>
            <li>Keep draft cards private until they are ready to share</li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

function createShortcutsTabContent() {
  return `
    <div class="info-section">
      <h4><i class="fas fa-keyboard"></i> Keyboard Shortcuts</h4>
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
  // Show intro on startup setting
  const introCheckbox = document.getElementById('show-intro-startup');
  if (introCheckbox) {
    const showIntro = localStorage.getItem('cardforge-show-intro');
    introCheckbox.checked = showIntro === null || showIntro === 'true';
    introCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-show-intro', e.target.checked ? 'true' : 'false');
    });
  }

  // Auto-save setting
  const autoSaveCheckbox = document.getElementById('auto-save-enabled');
  if (autoSaveCheckbox) {
    const autoSaveEnabled = localStorage.getItem('cardforge-auto-save') === 'true';
    autoSaveCheckbox.checked = autoSaveEnabled;
    autoSaveCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-auto-save', e.target.checked);
    });
  }

  // Real-time preview setting
  const previewCheckbox = document.getElementById('real-time-preview');
  if (previewCheckbox) {
    const previewEnabled = localStorage.getItem('cardforge-real-time-preview') !== 'false';
    previewCheckbox.checked = previewEnabled;
    previewCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-real-time-preview', e.target.checked);
    });
  }

  // Grid lines setting
  const gridCheckbox = document.getElementById('show-grid-lines');
  if (gridCheckbox) {
    const gridEnabled = localStorage.getItem('cardforge-show-grid') === 'true';
    gridCheckbox.checked = gridEnabled;
    gridCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-show-grid', e.target.checked);
      // Apply grid visibility immediately
      document.body.classList.toggle('show-grid', e.target.checked);
    });
  }

  // Export format setting
  const formatSelect = document.getElementById('default-export-format');
  if (formatSelect) {
    const exportFormat = localStorage.getItem('cardforge-export-format') || 'png';
    formatSelect.value = exportFormat;
    formatSelect.addEventListener('change', (e) => {
      localStorage.setItem('cardforge-export-format', e.target.value);
    });
  }

  // Export quality setting
  const qualitySelect = document.getElementById('export-quality');
  if (qualitySelect) {
    const exportQuality = localStorage.getItem('cardforge-export-quality') || 'medium';
    qualitySelect.value = exportQuality;
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

// Initialize intro when the page loads
document.addEventListener('DOMContentLoaded', function() {
  initializeIntro();
});

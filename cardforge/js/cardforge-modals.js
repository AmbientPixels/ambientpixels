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
      icon: '<i class="fas fa-palette"></i>',
      content: createThemesTabContent()
    },
    {
      title: 'Preferences',
      icon: '<i class="fas fa-cog"></i>',
      content: createPreferencesTabContent()
    },
    {
      title: 'Labs',
      icon: '<i class="fas fa-flask"></i>',
      content: createLabsTabContent()
    },
    {
      title: 'About',
      icon: '<i class="fas fa-info-circle"></i>',
      content: createAboutTabContent()
    }
  ];

  const settingsModal = Modal.createTabbedModal({
    title: 'CardForge Settings',
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
      <h4><i class="fas fa-palette"></i> Theme Selection</h4>
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
        
        <div class="theme-option" data-theme="dim">
          <div class="theme-preview dim-preview">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-card"></div>
            </div>
          </div>
          <h5>Dim Theme</h5>
          <p>Balanced mid-tone</p>
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
      <h4><i class="fas fa-cog"></i> General Preferences</h4>
      
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

      <div class="preference-group preference-coming-soon">
        <p style="margin: 16px 0 4px 0; font-size: 0.85rem; color: var(--text-muted, #a1a1aa);"><i class="fas fa-flask" style="margin-right: 6px;"></i>More settings coming soon</p>
        <p style="margin: 0; font-size: 0.8rem; opacity: 0.6;">Additional editor and workflow controls are currently in development.</p>
      </div>
    </div>
  `;
}

function createLabsTabContent() {
  return `
    <div class="settings-section">
      <h4><i class="fas fa-flask"></i> Labs (Coming Soon)</h4>
      <p style="margin: 0 0 8px 0; opacity: 0.7;">Experimental features and advanced tools currently in development.</p>
      <p style="margin: 0 0 20px 0; opacity: 0.5; font-size: 0.85rem;">These features are not enabled yet.</p>

      <div class="labs-list">
        <div class="labs-item">
          <div class="labs-item-icon"><i class="fas fa-image"></i></div>
          <div class="labs-item-content">
            <div class="labs-item-header"><span class="labs-item-title">AI Image Generation</span><span class="labs-pill">Coming Soon</span></div>
            <p>Generate original character, item, or scene artwork directly inside CardForge using AI prompts.</p>
          </div>
        </div>
        <div class="labs-item">
          <div class="labs-item-icon"><i class="fas fa-robot"></i></div>
          <div class="labs-item-content">
            <div class="labs-item-header"><span class="labs-item-title">AI Assist (Experimental)</span><span class="labs-pill">Coming Soon</span></div>
            <p>Get help generating card names, flavor text, archetypes, and stat suggestions.</p>
          </div>
        </div>
        <div class="labs-item">
          <div class="labs-item-icon"><i class="fas fa-sliders"></i></div>
          <div class="labs-item-content">
            <div class="labs-item-header"><span class="labs-item-title">Image Filters & Effects</span><span class="labs-pill">Coming Soon</span></div>
            <p>Apply cinematic filters, color grading, and stylistic effects directly to card artwork.</p>
          </div>
        </div>
        <div class="labs-item">
          <div class="labs-item-icon"><i class="fas fa-border-all"></i></div>
          <div class="labs-item-content">
            <div class="labs-item-header"><span class="labs-item-title">Design Grid Overlay</span><span class="labs-pill">Coming Soon</span></div>
            <p>Optional alignment and spacing guides for precision layouts.</p>
          </div>
        </div>
        <div class="labs-item">
          <div class="labs-item-icon"><i class="fas fa-floppy-disk"></i></div>
          <div class="labs-item-content">
            <div class="labs-item-header"><span class="labs-item-title">Auto-Save Engine</span><span class="labs-pill">Coming Soon</span></div>
            <p>Background saving with recovery and safety snapshots.</p>
          </div>
        </div>
        <div class="labs-item">
          <div class="labs-item-icon"><i class="fas fa-clock-rotate-left"></i></div>
          <div class="labs-item-content">
            <div class="labs-item-header"><span class="labs-item-title">Version History</span><span class="labs-pill">Coming Soon</span></div>
            <p>Restore previous saved versions of a card.</p>
          </div>
        </div>
        <div class="labs-item">
          <div class="labs-item-icon"><i class="fas fa-file-export"></i></div>
          <div class="labs-item-content">
            <div class="labs-item-header"><span class="labs-item-title">Advanced Export Options</span><span class="labs-pill">Coming Soon</span></div>
            <p>Print-ready PDFs, social formats, and layout presets.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function createAboutTabContent() {
  return `
    <div class="settings-section">
      <h4><i class="fas fa-info-circle"></i> About CardForge</h4>
      
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

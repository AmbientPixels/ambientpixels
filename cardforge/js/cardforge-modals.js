/**
 * CardForge Modal System
 * TileForge-style settings and help/info modals
 */

// ================================
// INTRO SECTION FUNCTIONALITY
// ================================

function initializeIntro() {
  const showIntroOnStartup = localStorage.getItem('cardforge-show-intro');
  
  // Hero section now handles the value prop — intro hidden by default
  // Only show if user explicitly enabled it in settings
  if (showIntroOnStartup === 'true') {
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

function createSubscriptionTabContent() {
  var isSignedIn = sessionStorage.getItem('isAuthenticated') === 'true' ||
    (document.body && document.body.getAttribute('data-auth-state') === 'signed-in');
  var isPro = window.Entitlements && window.Entitlements.isPro();

  var features =
    '<li><i class="fas fa-image" style="color:#7b2ff2;margin-right:0.5rem;width:16px"></i> HD exports (2x, 3x, 4x resolution)</li>' +
    '<li><i class="fas fa-sparkles" style="color:#7b2ff2;margin-right:0.5rem;width:16px"></i> All premium effects unlocked</li>' +
    '<li><i class="fas fa-layer-group" style="color:#7b2ff2;margin-right:0.5rem;width:16px"></i> 4 buff slots + x5 stacking</li>' +
    '<li><i class="fas fa-robot" style="color:#7b2ff2;margin-right:0.5rem;width:16px"></i> Unlimited AI generations</li>';

  if (isPro) {
    return '<div class="settings-section" style="text-align:center">' +
      '<div style="font-size:2.5rem;margin-bottom:0.5rem"><i class="fas fa-crown" style="color:#FFD700"></i></div>' +
      '<h4 style="color:#FFD700;margin-bottom:0.25rem">CardForge Pro</h4>' +
      '<p style="color:rgba(255,255,255,0.5);margin-bottom:1rem">Your subscription is active. All features unlocked.</p>' +
      '<ul style="list-style:none;padding:0;text-align:left;max-width:300px;margin:0 auto 1.25rem;color:rgba(255,255,255,0.7);font-size:0.9rem;line-height:1.8">' + features + '</ul>' +
      '<button class="cf-upgrade-btn" style="background:rgba(255,255,255,0.1);max-width:240px;margin:0 auto;display:block" ' +
        'onclick="window.Entitlements.openBillingPortal()"><i class="fas fa-cog"></i> Manage Subscription</button>' +
    '</div>';
  }

  var buttons = isSignedIn
    ? '<div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap">' +
        '<button class="cf-upgrade-btn" style="max-width:200px" ' +
          'onclick="window.Entitlements.startCheckout(\'cf-pro-monthly\')">$4.99 / month</button>' +
        '<button class="cf-upgrade-btn" style="max-width:200px;background:linear-gradient(135deg,#c471ed,#f64f59)" ' +
          'onclick="window.Entitlements.startCheckout(\'cf-pro-yearly\')">$3.99/mo (yearly)</button>' +
      '</div>' +
      '<p style="color:rgba(255,255,255,0.3);font-size:0.75rem;margin-top:0.75rem">' +
        'Yearly plan billed at $47.88/year. Cancel anytime.' +
      '</p>'
    : '<a class="cf-upgrade-btn" style="max-width:260px;margin:0 auto;display:block;text-decoration:none;text-align:center" ' +
        'href="/pages/login.html?redirect=/cardforge/">' +
        '<i class="fas fa-sign-in-alt"></i> Sign in to upgrade</a>';

  return '<div class="settings-section" style="text-align:center">' +
    '<div style="font-size:2.5rem;margin-bottom:0.5rem"><i class="fas fa-crown" style="color:#FFD700"></i></div>' +
    '<h4 style="color:#fff;margin-bottom:0.25rem">Upgrade to Pro</h4>' +
    '<p style="color:rgba(255,255,255,0.5);margin-bottom:1rem">Unlock the full CardForge experience.</p>' +
    '<ul style="list-style:none;padding:0;text-align:left;max-width:300px;margin:0 auto 1.25rem;color:rgba(255,255,255,0.7);font-size:0.9rem;line-height:1.8">' + features + '</ul>' +
    buttons +
  '</div>';
}

function openSettings() {
  const tabs = [
    {
      title: 'Subscription',
      icon: '<i class="fas fa-crown"></i>',
      content: createSubscriptionTabContent()
    },
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
        <div class="preference-item">
          <button class="settings-btn secondary" onclick="window.resetTour()">
            <i class="fas fa-route"></i> Replay Guided Tour
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
      title: 'Gameplay',
      icon: '<i class="fas fa-gamepad"></i>',
      content: createGameplayTabContent()
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
            <p>Choose how your image is displayed: Masked, Polaroid, Banner, Hero, Full Bleed, or Floating. Each has its own variants (e.g., Masked offers Circle, Hex, Diamond, and more).</p>
          </div>
        </div>
        
        <div class="step-item">
          <div class="step-number">4</div>
          <div class="step-content">
            <h5>Pick a Color Palette</h5>
            <p>Choose from 11 palette families: Neon, Earth, Ocean, Sunset, Monochrome, Corporate, Royal, Inferno, Frost, Arcane, or Auto. Auto analyzes your image and picks the best match. Each palette has Light and Dark variants.</p>
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
            <li>Use the Polaroid container for a clean, framed image look</li>
            <li>Pair the Bold style with Inferno or Royal for dramatic cards</li>
          </ul>
        </div>
        
        <div class="tip-item">
          <h5><i class="fas fa-image"></i> Image Tips</h5>
          <ul>
            <li>Use high-resolution images (at least 300x300px)</li>
            <li>PNG format works best for images with transparency</li>
            <li>The Masked Circle variant works great for circular portraits</li>
            <li>Full Bleed is best for landscape or panoramic art</li>
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

function createGameplayTabContent() {
  return `
    <div class="info-section">
      <h4><i class="fas fa-gamepad"></i> Gameplay Overview</h4>
      <p>CardForge cards aren't just collectibles — they're battle-ready. Every stat, buff, and attribute feeds into the Arena, a turn-based combat system where your card fights opponents head-to-head.</p>

      <div class="feature-grid">

        <div class="feature-item">
          <h5><i class="fas fa-heart"></i> Stats & HP</h5>
          <p>Each card has 5 core stats scaled 0–100:</p>
          <ul>
            <li><strong>Strength</strong> — Physical damage output</li>
            <li><strong>Agility</strong> — Speed and evasion</li>
            <li><strong>Intelligence</strong> — Spell and ability power</li>
            <li><strong>Endurance</strong> — Defense and HP pool</li>
            <li><strong>Luck</strong> — Critical hit chance</li>
          </ul>
          <p>HP is calculated from your stats: <em>50 + (Endurance × 0.8) + (Strength × 0.2)</em>. A tank with 100 Endurance and 80 Strength starts with 146 HP.</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-crossed-swords fa-swords"></i> Arena Combat</h5>
          <p>Battles are 3 rounds of turn-based combat. Each round, choose one of 4 moves:</p>
          <ul>
            <li><strong>Strike</strong> — Physical attack (Strength-based). Strong vs Ability, weak vs Guard.</li>
            <li><strong>Guard</strong> — Defensive stance. Reduces incoming damage by 30% and builds Charge.</li>
            <li><strong>Ability</strong> — Special power move (Intelligence-based). Costs 2 Charge. Strong vs Strike, weak vs Guard.</li>
            <li><strong>Heal</strong> — Restore HP based on your stats.</li>
          </ul>
          <p>Charge builds each turn (max 4). Timing your Ability around Guard and Strike is the core strategy.</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-bolt"></i> Buffs & Passives</h5>
          <p>Buffs are passive combat bonuses that activate automatically during battle. Each buff has a tier and a quantity multiplier:</p>
          <ul>
            <li><strong>Fury</strong> — +3% crit chance per stack</li>
            <li><strong>Aegis</strong> — +2% damage reduction per stack</li>
            <li><strong>Fortitude</strong> — +2% damage reduction per stack</li>
            <li><strong>Regen</strong> — +5% HP regen per stack</li>
            <li><strong>Focus</strong> — +3% crit chance per stack</li>
            <li><strong>Arcane</strong> — +3% ability power per stack</li>
            <li><strong>Legendary</strong> — +10% to all stats per stack</li>
          </ul>
          <p>Higher ranks unlock more buff slots and higher stack limits (up to ×5 at Diamond).</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-trophy"></i> Ranks & XP</h5>
          <p>Win battles to earn XP and climb the ranks:</p>
          <ul>
            <li><strong>Bronze</strong> — 0 XP (2 buff slots, ×1 stacks)</li>
            <li><strong>Silver</strong> — 500 XP (3 slots, ×2 stacks)</li>
            <li><strong>Gold</strong> — 1,500 XP (4 slots, ×3 stacks)</li>
            <li><strong>Platinum</strong> — 3,500 XP (4 slots, ×4 stacks)</li>
            <li><strong>Diamond</strong> — 7,000 XP (4 slots, ×5 stacks)</li>
          </ul>
          <p>PvE wins award 25 XP + 5 per opponent level. PvP wins award 50 XP. Even losses give consolation XP.</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-gem"></i> Rarity</h5>
          <p>Rarity is a freeform text field — name your own tier. Common presets include Common, Uncommon, Rare, Epic, Legendary, and Mythic. Rarity affects the visual presentation of your card (glow, border, badge style) but not combat stats directly.</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-shield-halved"></i> Class & Subclass</h5>
          <p>Your card's Class defines its archetype — Ranger, Fighter, Caster, Rogue, Scholar, or anything you invent. The optional Subclass adds specialization flair. Class influences which stats matter most: a Caster leans on Intelligence for Ability damage, while a Fighter relies on Strength for Strike power.</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-layer-group"></i> Attributes</h5>
          <p>Attributes are custom key-value pairs displayed on the card back — Level, Guild, Alignment, Element, Origin, Weapon, or anything that fits your character's lore. They're flavor and identity, not combat mechanics. Slot count scales with rank (up to 4 at Gold+).</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-book"></i> Card Back & Lore</h5>
          <p>The back of every card tells the story. It displays your stats as visual bars, buff badges with quantities, attribute metadata, a biography (up to 300 characters), flavor text, and optional social links. Choose from Default, Parchment, or Dark back styles.</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-layer-group"></i> Decks</h5>
          <p>Organize your cards into themed decks — by faction, campaign, element, or strategy. Name and curate collections, preview them visually, and publish to the gallery for others to browse.</p>
        </div>

        <div class="feature-item">
          <h5><i class="fas fa-chess"></i> Strategy Tips</h5>
          <ul>
            <li>High Endurance + Aegis/Fortitude buffs = tanky survivalist</li>
            <li>High Intelligence + Arcane buff = devastating Ability burst</li>
            <li>High Luck + Fury + Focus = crit machine</li>
            <li>Guard early to build Charge, then unleash Ability at the right moment</li>
            <li>Balance your stats — a one-dimensional card is easy to counter</li>
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

// ================================
// ONBOARDING TOUR
// ================================

var _tourStep = -1;
var _tourActive = false;
var _tourHighlightEl = null;

var TOUR_STEPS = [
  {
    selector: '.cf-hero__actions',
    text: 'Start here. <strong>Start Creating</strong> opens the editor, <strong>Quick Build</strong> walks you through a guided 4-step wizard, and <strong>Deck Builder</strong> and <strong>Arena</strong> take you to dedicated pages.',
    position: 'bottom'
  },
  {
    selector: '.step-btn[data-step="0"]',
    text: 'Choose a preset to jumpstart your card — each one configures layout, colors, stats, and artwork in one click. Or use the randomizer.',
    position: 'right'
  },
  {
    selector: '.cf-stepper',
    text: 'Navigate your card through these steps: <strong>Design</strong> the look, set <strong>Basics</strong> like name and class, tune <strong>Stats</strong>, add <strong>Buffs</strong> and <strong>Attributes</strong>.',
    position: 'right'
  },
  {
    selector: '.card-preview-zone',
    text: 'Your card updates in real-time as you edit. Flip it to see the back with stats, buffs, and lore. Use the toolbar to save, reset, or randomize.',
    position: 'left'
  },
  {
    selector: '.step-btn--forge',
    text: 'When you\'re done, head to <strong>Forge</strong> to save your card, publish it to the gallery, or add it to a deck. Your cards are also battle-ready in the Arena.',
    position: 'right'
  }
];

function checkTour() {
  if (localStorage.getItem('cardforge-tour-complete')) return;
  var overlay = document.getElementById('cf-tour-overlay');
  if (!overlay) return;

  overlay.style.display = 'flex';
  document.getElementById('cf-tour-start').addEventListener('click', startTour);
  document.getElementById('cf-tour-skip').addEventListener('click', endTour);
}

function startTour() {
  var overlay = document.getElementById('cf-tour-overlay');
  if (overlay) overlay.style.display = 'none';

  var backdrop = document.getElementById('cf-tour-backdrop');
  if (backdrop) backdrop.style.display = 'block';

  _tourActive = true;
  _tourStep = -1;

  document.getElementById('cf-tour-next').addEventListener('click', advanceTour);
  document.getElementById('cf-tour-skip-step').addEventListener('click', endTour);

  advanceTour();
}

function advanceTour() {
  if (!_tourActive) return;

  // Clear previous highlight
  if (_tourHighlightEl) {
    _tourHighlightEl.classList.remove('cf-tour-highlight');
    _tourHighlightEl = null;
  }

  _tourStep++;

  if (_tourStep >= TOUR_STEPS.length) {
    endTour();
    return;
  }

  var step = TOUR_STEPS[_tourStep];
  var target = document.querySelector(step.selector);

  if (!target) {
    advanceTour();
    return;
  }

  // Scroll target into view
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Highlight target
  setTimeout(function () {
    target.classList.add('cf-tour-highlight');
    _tourHighlightEl = target;
    positionTooltip(target, step);
  }, 350);
}

function positionTooltip(target, step) {
  var tooltip = document.getElementById('cf-tour-tooltip');
  var arrow = document.getElementById('cf-tour-arrow');
  var textEl = document.getElementById('cf-tour-text');
  var stepLabel = document.getElementById('cf-tour-step-label');
  var nextLabel = document.getElementById('cf-tour-next-label');
  if (!tooltip || !textEl) return;

  textEl.innerHTML = step.text;
  stepLabel.textContent = 'Step ' + (_tourStep + 1) + ' of ' + TOUR_STEPS.length;
  nextLabel.textContent = _tourStep === TOUR_STEPS.length - 1 ? 'Done' : 'Next';

  tooltip.style.display = 'block';

  var rect = target.getBoundingClientRect();
  var gap = 14;

  // Reset arrow classes
  arrow.className = 'cf-tour-tooltip__arrow';

  if (step.position === 'bottom') {
    tooltip.style.top = (rect.bottom + gap + window.scrollY) + 'px';
    tooltip.style.left = (rect.left + rect.width / 2) + 'px';
    tooltip.style.transform = 'translateX(-50%)';
    arrow.classList.add('cf-tour-arrow--top');
  } else if (step.position === 'right') {
    tooltip.style.top = (rect.top + rect.height / 2 + window.scrollY) + 'px';
    tooltip.style.left = (rect.right + gap) + 'px';
    tooltip.style.transform = 'translateY(-50%)';
    arrow.classList.add('cf-tour-arrow--left');
  } else if (step.position === 'left') {
    tooltip.style.top = (rect.top + rect.height / 2 + window.scrollY) + 'px';
    tooltip.style.left = (rect.left - gap) + 'px';
    tooltip.style.transform = 'translate(-100%, -50%)';
    arrow.classList.add('cf-tour-arrow--right');
  }

  // Mobile fallback: if tooltip goes off screen, center it
  var tooltipRect = tooltip.getBoundingClientRect();
  if (tooltipRect.left < 8 || tooltipRect.right > window.innerWidth - 8) {
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translateX(-50%)';
    tooltip.style.top = (rect.bottom + gap + window.scrollY) + 'px';
    arrow.className = 'cf-tour-tooltip__arrow cf-tour-arrow--top';
  }
}

function endTour() {
  _tourActive = false;
  localStorage.setItem('cardforge-tour-complete', '1');

  if (_tourHighlightEl) {
    _tourHighlightEl.classList.remove('cf-tour-highlight');
    _tourHighlightEl = null;
  }

  var overlay = document.getElementById('cf-tour-overlay');
  if (overlay) overlay.style.display = 'none';

  var tooltip = document.getElementById('cf-tour-tooltip');
  if (tooltip) tooltip.style.display = 'none';

  var backdrop = document.getElementById('cf-tour-backdrop');
  if (backdrop) backdrop.style.display = 'none';
}

// Expose for settings reset
window.resetTour = function () {
  localStorage.removeItem('cardforge-tour-complete');
  location.reload();
};

// ================================
// INITIALIZATION
// ================================

// Initialize intro when the page loads
document.addEventListener('DOMContentLoaded', function() {
  initializeIntro();
  // Delay tour check slightly to let the page render
  setTimeout(checkTour, 800);
});

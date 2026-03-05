// CardForge V2 - Modular System Implementation
// Clean implementation of the 6-tier modular card design system
// Updated: 2025-07-30 - Fresh start with modular architecture

(function() {
  'use strict';

  // ===== MODULAR SYSTEM STATE =====
  const ModularState = {
    // LAYOUT REMOVED - Phase 1 of Flow Restructure
    // Image-first design: Image Container moved to Tier 2
    
    // Tier 4: Content Alignment (3-level hierarchy)
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    alignmentWeight: 'balanced',
    alignmentStyle: 'padded',
    
    // Tier 3: Color Palette
    palette: 'neon',
    paletteVariant: 'light',
    textColor: 'auto',
    
    // Tier 2: Image Container
    imageContainer: 'masked',
    imageContainerVariant: 'circle',
    
    // Image Effects (filters only)
    imageEffect: 'none',
    imageEffectVariant: 'clean'
  };
  
  // Make ModularState globally accessible for event handlers
  window.ModularState = ModularState;

  const ChromeUI = {
    statusEl: null,
    statusLabelEl: null,
    variantButtons: [],
    readyForDirty: false,
    isDirty: false,
    isSaving: false,
    _navigateAfterSave: false,
    init() {
      this.statusEl = document.querySelector('.cf-status-pill');
      this.statusLabelEl = this.statusEl?.querySelector('.cf-status-pill__label') || null;
      this.variantButtons = Array.from(document.querySelectorAll('.cf-variant-btn'));
      if (this.variantButtons.length) {
        this.variantButtons.forEach(btn => {
          btn.addEventListener('click', () => this.applyVariant(btn.dataset.cfVariant));
        });
        const storedVariant = localStorage.getItem('cfUiVariant');
        if (storedVariant) {
          this.applyVariant(storedVariant, false);
        } else {
          const activeBtn = this.variantButtons.find(btn => btn.classList.contains('active'));
          if (activeBtn) {
            this.applyVariant(activeBtn.dataset.cfVariant, false);
          }
        }
      }

      // Restore data-theme from localStorage
      const storedTheme = localStorage.getItem('cardforge-theme');
      if (storedTheme && ['dark', 'dim', 'light'].includes(storedTheme)) {
        document.body.setAttribute('data-theme', storedTheme);
      }

      const editorForm = document.getElementById('card-editor-form');
      if (editorForm) {
        const handleFormDirty = () => this.markDirty();
        editorForm.addEventListener('input', handleFormDirty, true);
        editorForm.addEventListener('change', handleFormDirty, true);
      }

      document.addEventListener('click', (event) => {
        if (!this.readyForDirty) return;
        const interactive = event.target.closest('.preset-btn, .tier-option, .variant-option, .weight-option, .style-option, #roll-random-preset');
        if (interactive) {
          this.markDirty();
        }
      });

      this.setStatus('ready', 'Ready');
    },
    applyVariant(variant, persist = true) {
      const normalized = variant === 'clean' ? 'clean' : 'neon';
      document.body.classList.remove('cf-ui--clean', 'cf-ui--neon');
      document.body.classList.add(`cf-ui--${normalized}`);
      this.variantButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cfVariant === normalized);
      });
      if (persist) {
        localStorage.setItem('cfUiVariant', normalized);
      }
    },
    setStatus(state, labelOverride) {
      if (!this.statusEl) return;
      const labels = {
        ready: 'Ready',
        unsaved: 'Unsaved',
        saving: 'Saving…',
        saved: 'Saved',
        error: 'Error'
      };
      this.statusEl.dataset.state = state;
      if (this.statusLabelEl) {
        this.statusLabelEl.textContent = labelOverride || labels[state] || state;
      }
      if (state === 'unsaved') {
        this.isDirty = true;
      }
      if (state === 'saved' || state === 'ready') {
        this.isDirty = false;
      }
      this.syncSaveButtons(state);
    },
    syncSaveButtons(state) {
      const btnConfig = {
        ready:   { icon: 'fa-check',               label: 'Up to Date',  toolbarLabel: 'Saved',  title: 'No changes to save',       disabled: true  },
        unsaved: { icon: 'fa-save',                 label: 'Save Card',   toolbarLabel: 'Save',   title: 'You have unsaved changes', disabled: false },
        saving:  { icon: 'fa-spinner fa-spin',      label: 'Saving…',     toolbarLabel: 'Saving', title: 'Saving…',                  disabled: true  },
        saved:   { icon: 'fa-check',                label: 'Saved',       toolbarLabel: 'Saved',  title: 'Card saved',               disabled: true  },
        error:   { icon: 'fa-exclamation-triangle', label: 'Retry Save',  toolbarLabel: 'Retry',  title: 'Save failed — try again',  disabled: false }
      };
      const cfg = btnConfig[state];
      if (!cfg) return;
      const btns = [
        document.getElementById('save-card-btn'),
        document.getElementById('toolbar-save-btn')
      ].filter(Boolean);
      btns.forEach(btn => {
        btn.dataset.saveState = state;
        btn.disabled = cfg.disabled;
        btn.setAttribute('aria-disabled', String(cfg.disabled));
        btn.title = cfg.title;
        btn.setAttribute('aria-label', cfg.title);
        const icon = btn.querySelector('i');
        if (icon) icon.className = 'fas ' + cfg.icon;
        const span = btn.querySelector('span');
        if (span) {
          span.textContent = btn.id === 'save-card-btn' ? cfg.label : cfg.toolbarLabel;
        }
      });
    },
    markDirty() {
      if (!this.readyForDirty || this.isDirty || this.isSaving) return;
      this.setStatus('unsaved', 'Unsaved');
    },
    beginSaving() {
      this.isSaving = true;
      this.setStatus('saving', 'Saving…');
    },
    finishSaving(success) {
      this.isSaving = false;
      if (success) {
        this.isDirty = false;
        this.setStatus('saved', 'Saved');
        // After saving, re-enable publish nav button so user can re-publish
        // Skip if we're in the middle of loading a card (auto-save during publish flow)
        if (typeof CardForgeActions !== 'undefined' &&
            !CardForgeActions._isLoadingCard &&
            CardForgeActions.setPublishNavState) {
          CardForgeActions.setPublishNavState('default');
        }
        if (this._navigateAfterSave) {
          this._navigateAfterSave = false;
          this.navigateToMyCards();
        }
        setTimeout(() => {
          if (!this.isDirty && !this.isSaving) {
            this.setStatus('ready', 'Ready');
          }
        }, 2000);
      } else {
        this._navigateAfterSave = false;
        this.setStatus('error', 'Error');
      }
    },
    navigateToMyCards() {
      const forgeStepBtn = document.querySelector('.step-btn[data-step="6"]');
      if (forgeStepBtn) {
        try { forgeStepBtn.click(); } catch (e) { /* ignore */ }
      }
      setTimeout(() => {
        const cardsTabBtn = document.querySelector('.forge-sidebar-tab[data-forge-tab="cards"]');
        const allTabs = document.querySelectorAll('.forge-sidebar-tab');
        const allPanels = document.querySelectorAll('.forge-tab-content');
        const cardsPanel = document.querySelector('.forge-tab-content[data-forge-content="cards"]');
        if (allTabs.length && allPanels.length && cardsTabBtn && cardsPanel) {
          allTabs.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); b.setAttribute('tabindex', '-1'); });
          cardsTabBtn.classList.add('active');
          cardsTabBtn.setAttribute('aria-selected', 'true');
          cardsTabBtn.setAttribute('tabindex', '0');
          allPanels.forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
          cardsPanel.classList.add('active');
          cardsPanel.style.display = '';
          const list = document.getElementById('my-cards-list');
          if (list) {
            try { list.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* ignore */ }
          }
        }
      }, 150);
    },
    setDirtyTracking(enabled) {
      this.readyForDirty = Boolean(enabled);
      if (!this.readyForDirty && !this.isSaving) {
        this.isDirty = false;
        this.setStatus('ready', 'Ready');
      }
      // Fresh/new card (no saved card-id) should start as unsaved
      if (enabled) {
        const cardId = document.getElementById('card-id');
        if (!cardId || !cardId.value) {
          this.isDirty = false;
          this.setStatus('unsaved', 'New Card');
        }
      }
    }
  };

  window.CardForgeChrome = ChromeUI;

  // ===== CARD DISPLAY CAPS =====
  const STAT_CAP = 5;            // Max visible stats on card face
  const BADGE_CAP_MAX = 4;      // Absolute max buffs (Gold+ / Pro)
  const ATTRIBUTE_CAP_MAX = 4;  // Absolute max attributes (Gold+ / Pro)

  // Dynamic caps based on arena rank — falls back to max if EffectTiers not loaded
  function getBuffSlotCap() {
    return (window.EffectTiers && window.EffectTiers.getSlotCap) ? window.EffectTiers.getSlotCap('buffs') : BADGE_CAP_MAX;
  }
  function getAttributeSlotCap() {
    return (window.EffectTiers && window.EffectTiers.getSlotCap) ? window.EffectTiers.getSlotCap('attributes') : ATTRIBUTE_CAP_MAX;
  }
  
  // ===== PRESET CONFIGURATIONS =====
  const PresetConfigurations = {
    'hero-classic': {
      // Front-of-card styling
      horizontalAlignment: 'center',
      verticalAlignment: 'middle',
      alignmentWeight: 'balanced',
      alignmentStyle: 'padded',
      palette: 'earth',
      paletteVariant: 'light',
      imageContainer: 'framed',
      imageContainerVariant: 'ornate',
      imageEffect: 'borders',
      imageEffectVariant: 'glow',
      // Class and Rarity Styling
      classStyle: 'badge',
      classIcon: 'khanda',
      rarityStyle: 'glow',
      rarityIcon: 'gem',
      // Back-of-card sample data
      sampleData: {
        name: 'Fantasy Ranger',
        characterClass: 'Scout',
        characterSubclass: 'Elven Archer',
        avatar: '/images/image-packs/characters/whispers-of-the-sylvan-queen.jpg',
        biography: 'A skilled archer from the Whispering Woods, protector of ancient secrets and guardian of the realm.',
        badges: [
          { category: 'Marksman', icon: 'target', quantity: 3, description: 'Expert archer with unmatched precision' },
          { category: 'Explorer', icon: 'star', quantity: 2, description: 'Discovered hidden paths and ancient ruins' },
          { category: 'Beast Friend', icon: 'heart', quantity: 1, description: 'Trusted companion of forest creatures' }
        ],
        attributes: [
          { name: 'Agility', value: '18' },
          { name: 'Wisdom', value: '16' },
          { name: 'Stealth', value: '14' },
          { name: 'Nature Lore', value: 'Expert' }
        ],
        stats: [
          { name: 'Health', value: 78 },
          { name: 'Mana', value: 64 },
          { name: 'Stamina', value: 82 },
          { name: 'Archery', value: 91 },
          { name: 'Survival', value: 73 }
        ]
      }
    },
    'split-modern': {
      // Front-of-card styling
      horizontalAlignment: 'left',
      verticalAlignment: 'middle',
      alignmentWeight: 'top-heavy',
      alignmentStyle: 'compact',
      palette: 'ocean',
      paletteVariant: 'dark',
      imageContainer: 'framed',
      imageContainerVariant: 'modern',
      imageEffect: 'borders',
      imageEffectVariant: 'solid',
      // Class and Rarity Styling
      classStyle: 'glow',
      classIcon: 'cog',
      rarityStyle: 'foil',
      rarityIcon: 'bolt',
      // Back-of-card sample data
      sampleData: {
        name: 'Cyberpunk Runner',
        characterClass: 'Hacker',
        characterSubclass: 'Data Netrunner',
        avatar: '/images/image-packs/characters/cyber-erenity.jpg',
        biography: 'Elite netrunner specializing in corporate infiltration and data extraction from high-security systems.',
        badges: [
          { category: 'Hacker', icon: 'bolt', quantity: 4, description: 'Master of digital infiltration' },
          { category: 'Ghost Protocol', icon: 'shield', quantity: 2, description: 'Invisible in the net' },
          { category: 'System Breaker', icon: 'fire', quantity: 1, description: 'Can crack any firewall' }
        ],
        attributes: [
          { name: 'Tech', value: '20' },
          { name: 'Stealth', value: '17' },
          { name: 'Logic', value: '15' },
          { name: 'Reputation', value: 'Legendary' }
        ],
        stats: [
          { name: 'Processing', value: 87 },
          { name: 'Security', value: 72 },
          { name: 'Speed', value: 91 },
          { name: 'Hacking', value: 84 },
          { name: 'Stealth', value: 69 }
        ]
      }
    },
    'minimal-glow': {
      // Front-of-card styling
      horizontalAlignment: 'center',
      verticalAlignment: 'middle',
      alignmentWeight: 'balanced',
      alignmentStyle: 'compact',
      palette: 'monochrome',
      paletteVariant: 'light',
      imageContainer: 'raw',
      imageContainerVariant: 'rounded',
      imageEffect: 'borders',
      imageEffectVariant: 'glow',
      // Class and Rarity Styling
      classStyle: 'outlined',
      classIcon: 'book',
      rarityStyle: 'border',
      rarityIcon: 'scroll',
      // Back-of-card sample data
      sampleData: {
        name: 'Arcane Scholar',
        characterClass: 'Scholar',
        characterSubclass: 'Mystic Researcher',
        avatar: '/images/image-packs/characters/ethereal-enigma.jpg',
        biography: 'Renowned scholar of ancient magics and forbidden knowledge, keeper of the Great Library.',
        badges: [
          { category: 'Scholar', icon: 'star', quantity: 4, description: 'Master of ancient texts' },
          { category: 'Spell Weaver', icon: 'gem', quantity: 3, description: 'Creator of new magical formulas' },
          { category: 'Ancient Lore', icon: 'crown', quantity: 2, description: 'Keeper of forgotten secrets' }
        ],
        attributes: [
          { name: 'Intelligence', value: '20' },
          { name: 'Wisdom', value: '17' },
          { name: 'Focus', value: '15' },
          { name: 'Research', value: 'Masterful' }
        ],
        stats: [
          { name: 'Knowledge', value: 93 },
          { name: 'Concentration', value: 68 },
          { name: 'Memory', value: 85 },
          { name: 'Research', value: 79 },
          { name: 'Wisdom', value: 88 }
        ]
      }
    },
    'fullbleed-cinematic': {
      // Front-of-card styling
      horizontalAlignment: 'center',
      verticalAlignment: 'bottom',
      alignmentWeight: 'bottom-heavy',
      alignmentStyle: 'padded',
      palette: 'sunset',
      paletteVariant: 'dark',
      imageContainer: 'fullbleed',
      imageContainerVariant: 'none',
      imageEffect: 'filters',
      imageEffectVariant: 'sepia',
      // Class and Rarity Styling
      classStyle: 'banner',
      classIcon: 'shield',
      rarityStyle: 'frame',
      rarityIcon: 'star',
      // Back-of-card sample data
      sampleData: {
        name: 'Space Marine',
        characterClass: 'Fighter',
        characterSubclass: 'Galactic Warrior',
        avatar: '/images/image-packs/characters/guardian-of-the-gilded-halls.jpg',
        biography: 'Veteran space marine with decades of combat experience across multiple star systems. Leader of the Phoenix Squadron and defender of the galaxy.',
        badges: [
          { category: 'Combat Veteran', icon: 'medal', quantity: 5, description: 'Survived countless battles' },
          { category: 'Leadership', icon: 'crown', quantity: 3, description: 'Inspires troops to victory' },
          { category: 'Pilot', icon: 'star', quantity: 2, description: 'Ace starfighter pilot' }
        ],
        attributes: [
          { name: 'Strength', value: '19' },
          { name: 'Leadership', value: '18' },
          { name: 'Tactics', value: '16' },
          { name: 'Honor', value: 'Unbreakable' }
        ],
        stats: [
          { name: 'Combat', value: 89 },
          { name: 'Command', value: 76 },
          { name: 'Morale', value: 83 },
          { name: 'Tactics', value: 92 },
          { name: 'Armor', value: 85 }
        ]
      }
    },
    'framed-ornate': {
      // Front-of-card styling
      horizontalAlignment: 'center',
      verticalAlignment: 'middle',
      alignmentWeight: 'balanced',
      alignmentStyle: 'padded',
      palette: 'neon',
      paletteVariant: 'dark',
      imageContainer: 'framed',
      imageContainerVariant: 'ornate',
      imageEffect: 'borders',
      imageEffectVariant: 'neon',
      // Class and Rarity Styling
      classStyle: 'badge',
      classIcon: 'cut',
      rarityStyle: 'glow',
      rarityIcon: 'trophy',
      // Back-of-card sample data
      sampleData: {
        name: 'Corporate Ronin',
        characterClass: 'Rogue',
        characterSubclass: 'Blade for Hire',
        avatar: '/images/image-packs/characters/the-enigmatic-neuromancer.jpg',
        biography: 'Former corporate security turned freelance blade for hire, walking the path of honor in a corrupt world.',
        badges: [
          { category: 'Blade Master', icon: 'trophy', quantity: 4, description: 'Unmatched sword technique' },
          { category: 'Honor Code', icon: 'shield', quantity: 2, description: 'Lives by ancient principles' },
          { category: 'Street Smart', icon: 'target', quantity: 3, description: 'Knows the urban jungle' }
        ],
        attributes: [
          { name: 'Reflexes', value: '19' },
          { name: 'Honor', value: '16' },
          { name: 'Combat', value: '18' },
          { name: 'Reputation', value: 'Respected' }
        ],
        stats: [
          { name: 'Speed', value: 94 },
          { name: 'Precision', value: 81 },
          { name: 'Focus', value: 77 },
          { name: 'Honor', value: 86 },
          { name: 'Blade Mastery', value: 90 }
        ]
      }
    },
    'hero-fullbleed': {
      // Front-of-card styling - Full Bleed Hero
      horizontalAlignment: 'center',
      verticalAlignment: 'bottom',
      alignmentWeight: 'balanced',
      alignmentStyle: 'compact',
      palette: 'fire',
      paletteVariant: 'dark',
      imageContainer: 'fullbleed',
      imageContainerVariant: 'standard',
      imageEffect: 'overlay',
      imageEffectVariant: 'gradient',
      // Class and Rarity Styling
      classStyle: 'banner',
      classIcon: 'crown',
      rarityStyle: 'foil',
      rarityIcon: 'sun',
      // Back-of-card sample data
      sampleData: {
        name: 'Legendary Hero',
        characterClass: 'Guardian',
        characterSubclass: 'Champion of Justice',
        avatar: '/images/image-packs/characters/hero.png',
        biography: 'Champion of justice and defender of the innocent. Wielder of ancient powers and leader of the legendary Phoenix Guard.',
        badges: [
          { category: 'Hero', icon: 'crown', quantity: 5, description: 'Legendary status among all heroes' },
          { category: 'Leader', icon: 'star', quantity: 4, description: 'Commands respect and loyalty' },
          { category: 'Champion', icon: 'trophy', quantity: 3, description: 'Victor in countless battles' }
        ],
        attributes: [
          { name: 'Strength', value: '20' },
          { name: 'Courage', value: '19' },
          { name: 'Leadership', value: '18' },
          { name: 'Honor', value: 'Legendary' }
        ],
        stats: [
          { name: 'Health', value: 88 },
          { name: 'Energy', value: 92 },
          { name: 'Spirit', value: 95 },
          { name: 'Strength', value: 87 },
          { name: 'Leadership', value: 93 }
        ]
      }
    },
    'hero-large': {
      // Front-of-card styling - Hero Large Container
      horizontalAlignment: 'center',
      verticalAlignment: 'middle',
      alignmentWeight: 'balanced',
      alignmentStyle: 'padded',
      palette: 'sunset',
      paletteVariant: 'light',
      imageContainer: 'hero',
      imageContainerVariant: 'large',
      imageEffect: 'shadow',
      imageEffectVariant: 'soft',
      // Class and Rarity Styling
      classStyle: 'glow',
      classIcon: 'hammer',
      rarityStyle: 'frame',
      rarityIcon: 'diamond',
      // Back-of-card sample data
      sampleData: {
        name: 'Titan Guardian',
        characterClass: 'Guardian',
        characterSubclass: 'Divine Protector',
        avatar: '/images/image-packs/characters/twilight-titan.jpg',
        biography: 'A towering guardian blessed by the gods, standing watch over sacred temples and protecting the faithful from darkness.',
        badges: [
          { category: 'Divine', icon: 'crown', quantity: 4, description: 'Blessed with divine power and authority' },
          { category: 'Guardian', icon: 'shield', quantity: 5, description: 'Eternal protector of the sacred realm' },
          { category: 'Strength', icon: 'trophy', quantity: 3, description: 'Possesses incredible physical might' }
        ],
        attributes: [
          { name: 'Strength', value: '20' },
          { name: 'Constitution', value: '19' },
          { name: 'Wisdom', value: '17' },
          { name: 'Divine Favor', value: 'Blessed' }
        ],
        stats: [
          { name: 'Health', value: 97 },
          { name: 'Divine Power', value: 83 },
          { name: 'Endurance', value: 90 },
          { name: 'Strength', value: 94 },
          { name: 'Protection', value: 89 }
        ]
      }
    },
    'raw-rounded': {
      // Front-of-card styling - Raw Rounded
      horizontalAlignment: 'left',
      verticalAlignment: 'middle',
      alignmentWeight: 'top-heavy',
      alignmentStyle: 'compact',
      palette: 'monochrome',
      paletteVariant: 'dark',
      imageContainer: 'raw',
      imageContainerVariant: 'rounded',
      imageEffect: 'none',
      imageEffectVariant: 'none',
      // Class and Rarity Styling
      classStyle: 'outlined',
      classIcon: 'eye',
      rarityStyle: 'border',
      rarityIcon: 'moon',
      // Back-of-card sample data
      sampleData: {
        name: 'Shadow Operative',
        characterClass: 'Rogue',
        characterSubclass: 'Stealth Specialist',
        avatar: '/images/image-packs/characters/navigator-kairo.jpg',
        biography: 'A master of stealth and infiltration, operating in the shadows to gather intelligence and eliminate threats with surgical precision.',
        badges: [
          { category: 'Stealth', icon: 'target', quantity: 5, description: 'Undetectable in shadows and silence' },
          { category: 'Precision', icon: 'star', quantity: 4, description: 'Every move calculated and exact' },
          { category: 'Intel', icon: 'trophy', quantity: 2, description: 'Master of information gathering' }
        ],
        attributes: [
          { name: 'Stealth', value: '20' },
          { name: 'Dexterity', value: '18' },
          { name: 'Intelligence', value: '16' },
          { name: 'Infiltration', value: 'Expert' }
        ],
        stats: [
          { name: 'Stealth', value: 96 },
          { name: 'Agility', value: 85 },
          { name: 'Focus', value: 71 },
          { name: 'Intelligence', value: 82 },
          { name: 'Infiltration', value: 88 }
        ]
      }
    },
    'celestial-warden': {
      // Front-of-card styling
      horizontalAlignment: 'center',
      verticalAlignment: 'middle',
      alignmentWeight: 'balanced',
      alignmentStyle: 'padded',
      palette: 'ocean',
      paletteVariant: 'light',
      imageContainer: 'framed',
      imageContainerVariant: 'ornate',
      imageEffect: 'borders',
      imageEffectVariant: 'glow',
      // Class and Rarity Styling
      classStyle: 'badge',
      classIcon: 'crown',
      rarityStyle: 'glow',
      rarityIcon: 'star',
      // Back-of-card sample data
      sampleData: {
        name: 'Celestial Warden',
        characterClass: 'Guardian',
        characterSubclass: 'Divine Sentinel',
        avatar: '/images/image-packs/characters/seraphina.jpg',
        biography: 'A radiant guardian chosen by the stars, sworn to protect the boundary between mortal and celestial realms.',
        badges: [
          { category: 'Divine Light', icon: 'star', quantity: 4, description: 'Channel of celestial radiance' },
          { category: 'Warden', icon: 'shield', quantity: 3, description: 'Eternal guardian of the veil' },
          { category: 'Prophecy', icon: 'gem', quantity: 2, description: 'Sees threads of fate' }
        ],
        attributes: [
          { name: 'Wisdom', value: '20' },
          { name: 'Spirit', value: '18' },
          { name: 'Radiance', value: '17' },
          { name: 'Devotion', value: 'Absolute' }
        ],
        stats: [
          { name: 'Holy Power', value: 92 },
          { name: 'Protection', value: 88 },
          { name: 'Insight', value: 79 },
          { name: 'Resilience', value: 85 },
          { name: 'Grace', value: 94 }
        ]
      }
    },
    'flame-oracle': {
      // Front-of-card styling
      horizontalAlignment: 'center',
      verticalAlignment: 'bottom',
      alignmentWeight: 'bottom-heavy',
      alignmentStyle: 'padded',
      palette: 'fire',
      paletteVariant: 'dark',
      imageContainer: 'fullbleed',
      imageContainerVariant: 'none',
      imageEffect: 'overlay',
      imageEffectVariant: 'gradient',
      // Class and Rarity Styling
      classStyle: 'banner',
      classIcon: 'dragon',
      rarityStyle: 'foil',
      rarityIcon: 'fire',
      // Back-of-card sample data
      sampleData: {
        name: 'Flame Oracle',
        characterClass: 'Caster',
        characterSubclass: 'Pyromantic Seer',
        avatar: '/images/image-packs/characters/ember-gaze.jpg',
        biography: 'A seer who reads the future in dancing flames, wielding fire as both weapon and window to destiny.',
        badges: [
          { category: 'Pyromancy', icon: 'fire', quantity: 5, description: 'Master of sacred flames' },
          { category: 'Oracle', icon: 'gem', quantity: 3, description: 'Visions forged in fire' },
          { category: 'Destroyer', icon: 'bolt', quantity: 2, description: 'Unleashes devastating infernos' }
        ],
        attributes: [
          { name: 'Intelligence', value: '19' },
          { name: 'Willpower', value: '18' },
          { name: 'Fire Mastery', value: '20' },
          { name: 'Foresight', value: 'Prophetic' }
        ],
        stats: [
          { name: 'Fire Power', value: 95 },
          { name: 'Vision', value: 82 },
          { name: 'Intensity', value: 88 },
          { name: 'Control', value: 74 },
          { name: 'Divination', value: 91 }
        ]
      }
    }
  };

  // ===== PREFILL INTEGRATION =====
  async function loadPrefillData() {
    try {
      const response = await fetch('./data/prefill-card.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const prefillData = await response.json();
      
      // Apply card data to form fields
      if (prefillData.cardData) {
        const cardData = prefillData.cardData;
        
        // Basic fields
        if (cardData.name) document.getElementById('card-name').value = cardData.name;
        if (cardData.class) document.getElementById('card-class').value = cardData.class;
        if (cardData.rarity) document.getElementById('card-rarity').value = cardData.rarity;
        if (cardData.quote) document.getElementById('card-quote').value = cardData.quote;
        if (cardData.avatar) document.getElementById('card-avatar').value = cardData.avatar;
        if (cardData.biography) document.getElementById('card-bio').value = cardData.biography;
      }
      
      // Apply stats - split into combat + custom
      if (prefillData.combatStats) {
        setCombatStatValues(prefillData.combatStats);
      }
      if (prefillData.stats && prefillData.stats.length > 0) {
        const statsContainer = document.getElementById('stats-editor');
        statsContainer.innerHTML = '';

        // If no combatStats object, migrate legacy stats
        if (!prefillData.combatStats) {
          const migrated = migrateLegacyStats(prefillData.stats);
          setCombatStatValues(migrated.combat);
          migrated.custom.forEach(stat => {
            statsContainer.appendChild(createStatRow(stat.name, stat.value));
          });
        } else {
          // Only load custom stats (filter out combat stat names)
          prefillData.stats.filter(s => {
            const nameLower = (s.name || '').toLowerCase().trim();
            return !COMBAT_STAT_DEFS.some(d => d.label.toLowerCase() === nameLower);
          }).forEach(stat => {
            statsContainer.appendChild(createStatRow(stat.name, stat.value));
          });
        }
      }
      
      // Apply badges - CREATE MULTIPLE ROWS (capped to slot limit)
      if (prefillData.badges && prefillData.badges.length > 0) {
        const badgesContainer = document.getElementById('micro-editor');

        // Clear existing badge rows
        badgesContainer.innerHTML = '';

        const buffCap = getBuffSlotCap();
        const maxQty = (window.EffectTiers && window.EffectTiers.getMaxBuffQty) ? window.EffectTiers.getMaxBuffQty() : 1;
        prefillData.badges.slice(0, buffCap).forEach(badge => {
          const qty = Math.min(badge.quantity || 1, maxQty);
          badgesContainer.appendChild(createBadgeRow(badge.category, badge.icon, badge.description, qty));
        });
      }
      
      // Apply attributes - CREATE MULTIPLE ROWS (capped to slot limit)
      if (prefillData.attributes && prefillData.attributes.length > 0) {
        const attributesContainer = document.getElementById('attribute-editor');

        // Clear existing attribute rows
        attributesContainer.innerHTML = '';

        // Create a row for each attribute, capped to rank-based slot limit
        const attrCap = getAttributeSlotCap();
        prefillData.attributes.slice(0, attrCap).forEach((attribute, index) => {
          const attributeRow = createAttributeRow(attribute.name, attribute.value);
          attributesContainer.appendChild(attributeRow);
        });
      }
      

      // Pad Attributes up to rank-based cap
      const attributesContainer = document.getElementById('attribute-editor');
      if (attributesContainer) {
        const attrCap = getAttributeSlotCap();
        const existingAttrs = attributesContainer.querySelectorAll('.attribute-row').length;
        for (let i = existingAttrs; i < attrCap; i++) {
          attributesContainer.appendChild(createAttributeRow('Reputation', 'Unknown'));
        }
        const addAttrBtn = document.getElementById('add-attribute-btn');
        if (attributesContainer.querySelectorAll('.attribute-row').length >= attrCap && addAttrBtn) {
          addAttrBtn.classList.add('disabled');
          addAttrBtn.title = `Maximum ${attrCap} attributes reached`;
        }
      }

      // Buffs are display-only (game-assigned) — no add button state to manage

      // Update preview after loading prefill data
      updatePreview();
      
    } catch (error) {
      console.warn('⚠️ Could not load prefill data:', error);
      // Continue without prefill data
    }
  }
  
  // ===== DYNAMIC ROW CREATION HELPERS =====
  function createStatRow(name = '', value = 0) {
    const statRow = document.createElement('div');
    statRow.className = 'stat-row';
    statRow.innerHTML = `
      <div class="stat-header">
        <input type="text" name="stat-name" placeholder="Stat name" value="${name}" />
        <span class="stat-value-display">${value}</span>
        <button type="button" class="remove-attribute">&times;</button>
      </div>
      <div class="stat-control">
        <input type="range" name="stat-value" min="0" max="100" value="${value}" class="stat-slider" aria-label="Stat value" />
      </div>
    `;
    
    // Add event listeners for the new row
    const slider = statRow.querySelector('.stat-slider');
    const display = statRow.querySelector('.stat-value-display');
    const removeBtn = statRow.querySelector('.remove-attribute');
    
    slider.style.setProperty('--fill', value + '%');

    slider.addEventListener('input', function() {
      display.textContent = this.value;
      this.style.setProperty('--fill', this.value + '%');
      updatePreview();
    });
    
    // Name edits: no animation needed — just re-render and snap
    statRow.querySelector('input[name="stat-name"]').addEventListener('input', updatePreview);
    
    removeBtn.addEventListener('click', function() {
      statRow.remove();
      _statAnimationNeeded = true;
      updatePreview();
      updateStatBtnState();
    });
    
    return statRow;
  }

  // ===== COMBAT STAT SYSTEM (Arena) =====
  const COMBAT_STAT_DEFS = [
    { key: 'str', label: 'Strength',     icon: 'fa-hand-fist',       color: '#ff5252' },
    { key: 'agi', label: 'Agility',      icon: 'fa-feather-pointed', color: '#00e676' },
    { key: 'int', label: 'Intelligence',  icon: 'fa-bolt',            color: '#7b2fff' },
    { key: 'end', label: 'Endurance',     icon: 'fa-heart',           color: '#ff9100' },
    { key: 'lck', label: 'Luck',          icon: 'fa-clover',          color: '#ffd740' }
  ];
  const COMBAT_POINT_BUDGET = 300;
  const COMBAT_DEFAULT_VALUE = 60;

  function createCombatStatRow(def, value) {
    const row = document.createElement('div');
    row.className = 'combat-stat-row';
    row.dataset.statKey = def.key;
    row.innerHTML = `
      <div class="combat-stat-header">
        <i class="fas ${def.icon}" style="color:${def.color}"></i>
        <span class="combat-stat-label">${def.label}</span>
        <span class="combat-stat-value-display">${value}</span>
      </div>
      <div class="stat-control">
        <input type="range" name="combat-stat-value" min="0" max="100" value="${value}" class="stat-slider combat-stat-slider" data-stat-key="${def.key}" aria-label="${def.label}" />
      </div>
    `;

    const slider = row.querySelector('.combat-stat-slider');
    const display = row.querySelector('.combat-stat-value-display');
    slider.style.setProperty('--fill', value + '%');

    slider.addEventListener('input', function() {
      enforceBudget(def.key, parseInt(this.value));
      const clamped = parseInt(this.value);
      display.textContent = clamped;
      this.style.setProperty('--fill', clamped + '%');
      updateBudgetDisplay();
      updatePreview();
    });

    return row;
  }

  function initCombatStatsEditor() {
    const container = document.getElementById('combat-stats-editor');
    if (!container) return;
    container.innerHTML = '';
    COMBAT_STAT_DEFS.forEach(def => {
      container.appendChild(createCombatStatRow(def, COMBAT_DEFAULT_VALUE));
    });
    updateBudgetDisplay();
  }

  function getCombatStatTotal() {
    let total = 0;
    document.querySelectorAll('#combat-stats-editor .combat-stat-slider').forEach(slider => {
      total += parseInt(slider.value) || 0;
    });
    return total;
  }

  function enforceBudget(changedKey, requestedValue) {
    const slider = document.querySelector(`#combat-stats-editor .combat-stat-slider[data-stat-key="${changedKey}"]`);
    if (!slider) return;

    // Calculate what total would be with the requested value
    let otherTotal = 0;
    document.querySelectorAll('#combat-stats-editor .combat-stat-slider').forEach(s => {
      if (s.dataset.statKey !== changedKey) {
        otherTotal += parseInt(s.value) || 0;
      }
    });

    const maxAllowed = COMBAT_POINT_BUDGET - otherTotal;
    const clamped = Math.min(requestedValue, Math.max(0, maxAllowed));
    slider.value = clamped;
    slider.style.setProperty('--fill', clamped + '%');

    const display = slider.closest('.combat-stat-row').querySelector('.combat-stat-value-display');
    if (display) display.textContent = clamped;
  }

  function updateBudgetDisplay() {
    const display = document.getElementById('stat-budget-display');
    if (!display) return;
    const used = getCombatStatTotal();
    const remaining = COMBAT_POINT_BUDGET - used;
    display.textContent = `${remaining} / ${COMBAT_POINT_BUDGET}`;
    display.classList.toggle('arena-combat-stats__budget--empty', remaining <= 0);
    display.classList.toggle('arena-combat-stats__budget--low', remaining > 0 && remaining <= 50);
  }

  function collectCombatStatsData() {
    const combat = {};
    document.querySelectorAll('#combat-stats-editor .combat-stat-slider').forEach(slider => {
      combat[slider.dataset.statKey] = parseInt(slider.value) || 0;
    });
    return combat;
  }

  function setCombatStatValues(combatStats) {
    if (!combatStats) return;
    COMBAT_STAT_DEFS.forEach(def => {
      const slider = document.querySelector(`#combat-stats-editor .combat-stat-slider[data-stat-key="${def.key}"]`);
      if (slider && combatStats[def.key] !== undefined) {
        const val = Math.min(100, Math.max(0, combatStats[def.key]));
        slider.value = val;
        slider.style.setProperty('--fill', val + '%');
        const display = slider.closest('.combat-stat-row').querySelector('.combat-stat-value-display');
        if (display) display.textContent = val;
      }
    });
    updateBudgetDisplay();
  }

  // Map old freeform stats to combat stats (for legacy card loading)
  const STAT_ALIAS_MAP = {
    str: ['strength', 'power', 'combat', 'attack', 'might'],
    agi: ['agility', 'speed', 'dexterity', 'reflexes', 'stealth', 'quickness'],
    int: ['intelligence', 'magic', 'wisdom', 'tech', 'hacking', 'intellect', 'sorcery'],
    end: ['endurance', 'defense', 'vitality', 'constitution', 'stamina', 'toughness', 'resilience'],
    lck: ['luck', 'charisma', 'fortune', 'intuition', 'charm']
  };

  function migrateLegacyStats(statsArray) {
    const combat = { str: COMBAT_DEFAULT_VALUE, agi: COMBAT_DEFAULT_VALUE, int: COMBAT_DEFAULT_VALUE, end: COMBAT_DEFAULT_VALUE, lck: COMBAT_DEFAULT_VALUE };
    const custom = [];
    if (!statsArray || statsArray.length === 0) return { combat, custom };

    const maxVal = Math.max(...statsArray.map(s => s.value || 0));
    const scale = maxVal <= 10 ? 10 : 1;

    statsArray.forEach(stat => {
      const name = (stat.name || '').toLowerCase().trim();
      let matched = false;
      for (const [key, aliases] of Object.entries(STAT_ALIAS_MAP)) {
        if (aliases.includes(name)) {
          combat[key] = Math.min(100, Math.max(0, Math.round((stat.value || 0) * scale)));
          matched = true;
          break;
        }
      }
      if (!matched) {
        custom.push({ name: stat.name, value: stat.value });
      }
    });

    return { combat, custom };
  }

  // Buff/trait definitions — sourced from EffectTiers (single source of truth)
  function getBuffDefs() {
    return (window.EffectTiers && window.EffectTiers.BUFF_DEFS) || [];
  }

  function createBadgeRow(category = '', icon = 'star', description = '', quantity = 1) {
    const defs = getBuffDefs();
    const ET = window.EffectTiers;

    // Build dropdown — only unlocked buffs are selectable, locked ones disabled
    const categoryOptions = defs.map(def => {
      const selected = (category.toLowerCase() === def.key) ? 'selected' : '';
      const locked = (ET && !ET.isBuffUnlocked(def.key)) ? ' disabled' : '';
      const lockLabel = locked ? ' [Locked]' : '';
      return `<option value="${def.key}" ${selected}${locked}>${def.label}${lockLabel}</option>`;
    }).join('');

    // Resolve icon from category
    const matchedDef = defs.find(d => d.key === category.toLowerCase());
    const resolvedIcon = matchedDef ? matchedDef.icon : icon;
    const displayDesc = description || (matchedDef ? matchedDef.description : '');

    // Qty tooltip — explains multiplier progression
    const qtyTooltip = (ET && ET.getQtyTooltip) ? ET.getQtyTooltip() : '';

    const badgeRow = document.createElement('div');
    badgeRow.className = 'micro-row';
    badgeRow.innerHTML = `
      <div class="badge-card-header">
        <span class="badge-icon-preview"><i class="fas fa-${resolvedIcon}"></i></span>
        <select name="micro-category" class="badge-category-select" aria-label="Buff type">
          ${categoryOptions}
        </select>
        <input type="hidden" name="micro-icon" value="${resolvedIcon}">
        <input type="hidden" name="micro-quantity" value="${quantity}">
      </div>
      <div class="badge-card-body">
        <input type="text" name="micro-desc" class="badge-desc-input" value="${displayDesc.replace(/"/g, '&quot;')}" readonly aria-label="Buff description">
      </div>
      <div class="badge-card-count">
        <span class="badge-qty-display" title="${qtyTooltip}">&times;${quantity}</span>
      </div>
      <button type="button" class="remove-micro" aria-label="Remove buff">&times;</button>
    `;

    const categorySelect = badgeRow.querySelector('select[name="micro-category"]');
    const hiddenIconInput = badgeRow.querySelector('input[name="micro-icon"]');
    const descInput = badgeRow.querySelector('input[name="micro-desc"]');
    const iconPreview = badgeRow.querySelector('.badge-icon-preview i');
    const removeBtn = badgeRow.querySelector('.remove-micro');

    // Update icon + pre-fill description when user changes buff type
    categorySelect.addEventListener('change', function() {
      const def = getBuffDefs().find(d => d.key === this.value);
      if (def) {
        hiddenIconInput.value = def.icon;
        iconPreview.className = `fas fa-${def.icon}`;
        // Pre-fill description from def (user can still overwrite)
        descInput.value = def.description;
      }
      updatePreview();
    });

    // Remove button
    removeBtn.addEventListener('click', function() {
      badgeRow.remove();
      updateBuffBtnState();
      updateBuffEmptyState();
      updateBuffProgressionBanner();
      updatePreview();
    });

    return badgeRow;
  }

  // Alias for createBadgeRow to maintain compatibility with preset system
  function createMicroBadgeRow(category, icon, description, quantity) {
    return createBadgeRow(category, icon, description, quantity);
  }

  function createAttributeRow(name = '', value = '') {
    const attributeRow = document.createElement('div');
    attributeRow.className = 'attribute-row';
    attributeRow.innerHTML = `
      <label class="attribute-tile-label">Name</label>
      <input type="text" name="attribute-name" placeholder="Attribute" value="${name}">
      <label class="attribute-tile-label">Value</label>
      <input type="text" name="attribute-value" placeholder="Value" value="${value}">
      <button type="button" class="remove-attribute">&times;</button>
    `;
    
    // Add event listeners for the new row
    const removeBtn = attributeRow.querySelector('.remove-attribute');
    const nameField = attributeRow.querySelector('input[name="attribute-name"]');
    const valueField = attributeRow.querySelector('input[name="attribute-value"]');
    
    // Field listeners
    nameField.addEventListener('input', updatePreview);
    valueField.addEventListener('input', updatePreview);
    
    removeBtn.addEventListener('click', function() {
      attributeRow.remove();
      // Re-enable Add Attribute button if under cap
      const addAttributeBtn = document.getElementById('add-attribute-btn');
      if (addAttributeBtn) {
        const remaining = document.querySelectorAll('#attribute-editor .attribute-row').length;
        if (remaining < getAttributeSlotCap()) {
          addAttributeBtn.classList.remove('disabled');
          addAttributeBtn.title = '';
        }
      }
      updatePreview();
    });
    
    return attributeRow;
  }

  // ===== DYNAMIC EDITORS INITIALIZATION =====
  function initDynamicEditors() {
    
    // Initialize Stats Editor
    initStatsEditor();
    
    // Initialize Badges Editor
    initBadgesEditor();
    
    // Initialize Attributes Editor
    initAttributesEditor();
    
    // Initialize Biography Character Counter
    initBioCounter();
    
    // Initialize form listeners for live preview
    initFormListeners();
    
  }

  // ===== BIOGRAPHY CHARACTER COUNTER =====
  const BIO_RECOMMENDED_MAX = 220; // ~5 lines at 0.7rem/1.4 line-height in the card bio box

  function initBioCounter() {
    const bioField = document.getElementById('card-bio');
    if (!bioField) return;

    // Create counter element below the textarea
    const counter = document.createElement('div');
    counter.className = 'bio-char-counter';
    counter.setAttribute('aria-live', 'polite');
    bioField.parentNode.insertBefore(counter, bioField.nextSibling);

    function updateCounter() {
      const len = bioField.value.length;
      counter.textContent = `${len} / ${BIO_RECOMMENDED_MAX}`;
      if (len > BIO_RECOMMENDED_MAX) {
        counter.classList.add('over-limit');
        counter.textContent += ' — Bio will be truncated on card';
      } else {
        counter.classList.remove('over-limit');
      }
    }

    bioField.addEventListener('input', updateCounter);
    // Initial state
    updateCounter();
  }
  
  const CUSTOM_STAT_CAP = 5;

  function updateStatBtnState() {
    const addStatBtn = document.getElementById('add-stat-btn');
    if (!addStatBtn) return;
    const statsContainer = document.getElementById('stats-editor');
    const count = statsContainer ? statsContainer.querySelectorAll('.stat-row').length : 0;
    if (count >= CUSTOM_STAT_CAP) {
      addStatBtn.classList.add('disabled');
      addStatBtn.disabled = true;
      addStatBtn.title = `Maximum ${CUSTOM_STAT_CAP} custom stats reached`;
    } else {
      addStatBtn.classList.remove('disabled');
      addStatBtn.disabled = false;
      addStatBtn.title = '';
    }
  }

  function initStatsEditor() {
    // Initialize fixed combat stats first
    initCombatStatsEditor();

    // Custom stats (freeform, visual only)
    const addStatBtn = document.getElementById('add-stat-btn');
    if (addStatBtn) {
      addStatBtn.addEventListener('click', function() {
        const statsContainer = document.getElementById('stats-editor');
        const currentStats = statsContainer.querySelectorAll('.stat-row').length;

        if (currentStats >= CUSTOM_STAT_CAP) {
          console.warn(`⚠️ Maximum of ${CUSTOM_STAT_CAP} custom stats allowed`);
          return;
        }

        const newStatRow = createStatRow();
        statsContainer.appendChild(newStatRow);
        updateStatBtnState();
      });
    }
    updateStatBtnState();
  }
  
  function initBadgesEditor() {
    const addBuffBtn = document.getElementById('add-buff-btn');
    if (addBuffBtn) {
      addBuffBtn.addEventListener('click', function() {
        const badgesContainer = document.getElementById('micro-editor');
        const buffCap = getBuffSlotCap();
        const currentBuffs = badgesContainer.querySelectorAll('.micro-row').length;
        if (currentBuffs >= buffCap) {
          addBuffBtn.classList.add('disabled');
          addBuffBtn.title = 'Maximum ' + buffCap + ' buff' + (buffCap > 1 ? 's' : '') + ' at your rank';
          return;
        }
        // Pick first available unlocked buff not already in use
        const usedKeys = Array.from(badgesContainer.querySelectorAll('select[name="micro-category"]')).map(s => s.value);
        const available = (window.EffectTiers && window.EffectTiers.getUnlockedBuffs)
          ? window.EffectTiers.getUnlockedBuffs().filter(b => usedKeys.indexOf(b.key) === -1)
          : [];
        const pick = available.length > 0 ? available[0] : getBuffDefs()[0];
        if (!pick) return;
        const maxQty = (window.EffectTiers && window.EffectTiers.getMaxBuffQty) ? window.EffectTiers.getMaxBuffQty() : 1;
        const qty = Math.floor(Math.random() * maxQty) + 1;
        badgesContainer.appendChild(createBadgeRow(pick.key, pick.icon, pick.description, qty));
        updateBuffBtnState();
        updateBuffEmptyState();
        updateBuffProgressionBanner();
        updatePreview();
      });
    }
    updateBuffBtnState();
    updateBuffEmptyState();
    updateBuffProgressionBanner();
  }

  /**
   * Enable/disable the Add Buff button based on current count vs slot cap.
   */
  function updateBuffBtnState() {
    const addBuffBtn = document.getElementById('add-buff-btn');
    if (!addBuffBtn) return;
    const badgesContainer = document.getElementById('micro-editor');
    const currentBuffs = badgesContainer ? badgesContainer.querySelectorAll('.micro-row').length : 0;
    const buffCap = getBuffSlotCap();
    if (currentBuffs >= buffCap) {
      addBuffBtn.classList.add('disabled');
      addBuffBtn.title = 'Maximum ' + buffCap + ' buff' + (buffCap > 1 ? 's' : '') + ' at your rank';
    } else {
      addBuffBtn.classList.remove('disabled');
      addBuffBtn.title = '';
    }
  }

  /**
   * Show/hide the buff empty state message based on current buff count.
   * Differentiates guest vs signed-in messaging.
   */
  function updateBuffEmptyState() {
    const emptyState = document.getElementById('buff-empty-state');
    if (!emptyState) return;
    const editor = document.getElementById('micro-editor');
    const hasBadges = editor && editor.querySelectorAll('.micro-row').length > 0;
    emptyState.style.display = hasBadges ? 'none' : '';

    const ET = window.EffectTiers;
    if (!ET) return;

    // Update hint text based on auth state
    const hintEl = emptyState.querySelector('.buff-empty-state__hint');
    if (hintEl) {
      if (ET.isAuthenticated && !ET.isAuthenticated()) {
        hintEl.innerHTML = 'Use <strong>Roll Character</strong> to assign a buff. <strong>Sign in</strong> to unlock more buff slots and customization.';
      } else {
        hintEl.innerHTML = 'Use <strong>Roll Character</strong> to assign buffs. Play Arena battles to unlock more buff slots, higher quantities, and new buff types.';
      }
    }

    // Populate progression summary chips
    const progressEl = document.getElementById('buff-empty-state__progress');
    if (!progressEl) return;

    const slots = ET.getSlotCap ? ET.getSlotCap('buffs') : 2;
    const maxQty = ET.getMaxBuffQty ? ET.getMaxBuffQty() : 1;
    const unlocked = ET.getUnlockedBuffs ? ET.getUnlockedBuffs().length : 4;
    const total = ET.BUFF_DEFS ? ET.BUFF_DEFS.length : 10;
    const rankLabel = (ET.getEffectiveRankLabel) ? ET.getEffectiveRankLabel() : 'Bronze';

    progressEl.innerHTML =
      '<span class="buff-progress-chip"><i class="fas fa-shield-halved"></i> ' + rankLabel + '</span>' +
      '<span class="buff-progress-chip"><i class="fas fa-layer-group"></i> ' + slots + '/4 slots</span>' +
      '<span class="buff-progress-chip"><i class="fas fa-xmark"></i> &times;' + maxQty + ' max qty</span>' +
      '<span class="buff-progress-chip"><i class="fas fa-unlock"></i> ' + unlocked + '/' + total + ' buffs</span>';
  }

  /**
   * Buff progression banner — shows XP-to-next-rank for signed-in users,
   * sign-in CTA for guests, hidden at max rank / Pro.
   */
  function updateBuffProgressionBanner() {
    const banner = document.getElementById('buff-progression-banner');
    if (!banner) return;
    const ET = window.EffectTiers;
    if (!ET) { banner.style.display = 'none'; return; }

    const desc = ET.getNextBuffUnlockDescription ? ET.getNextBuffUnlockDescription() : null;
    if (!desc) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = '';

    const textEl = document.getElementById('buff-progression-text');
    if (textEl) textEl.textContent = desc;

    const statsEl = document.getElementById('buff-progression-stats');
    if (statsEl) {
      const slots = ET.getSlotCap ? ET.getSlotCap('buffs') : 1;
      const maxQty = ET.getMaxBuffQty ? ET.getMaxBuffQty() : 1;
      const unlocked = ET.getUnlockedBuffs ? ET.getUnlockedBuffs().length : 4;
      const total = ET.BUFF_DEFS ? ET.BUFF_DEFS.length : 10;
      const rankLabel = ET.getEffectiveRankLabel ? ET.getEffectiveRankLabel() : 'Bronze';

      statsEl.innerHTML =
        '<span class="buff-progress-chip"><i class="fas fa-shield-halved"></i> ' + rankLabel + '</span>' +
        '<span class="buff-progress-chip"><i class="fas fa-unlock"></i> ' + unlocked + '/' + total + ' buffs</span>' +
        '<span class="buff-progress-chip"><i class="fas fa-layer-group"></i> ' + slots + '/4 slots</span>' +
        '<span class="buff-progress-chip"><i class="fas fa-xmark"></i> &times;' + maxQty + ' max</span>';
    }
  }

  function initAttributesEditor() {
    const addAttributeBtn = document.getElementById('add-attribute-btn');
    if (addAttributeBtn) {
      addAttributeBtn.addEventListener('click', function() {
        const attributesContainer = document.getElementById('attribute-editor');
        const attrCap = getAttributeSlotCap();
        const currentAttrs = attributesContainer.querySelectorAll('.attribute-row').length;
        if (currentAttrs >= attrCap) {
          addAttributeBtn.classList.add('disabled');
          addAttributeBtn.title = `Maximum ${attrCap} attributes reached`;
          return;
        }
        const newAttributeRow = createAttributeRow();
        attributesContainer.appendChild(newAttributeRow);
        if (currentAttrs + 1 >= attrCap) {
          addAttributeBtn.classList.add('disabled');
          addAttributeBtn.title = `Maximum ${attrCap} attributes reached`;
        }
      });
    }
  }

  // ===== CARD FORGE EDITOR GLOBAL API =====
  if (!window.cardForgeEditor) window.cardForgeEditor = {};
  window.cardForgeEditor.loadCardData = function(cardData) {
    if (!cardData) {
      console.error('[CardForge] loadCardData called with undefined/null cardData:', cardData);
      return;
    }
    // Basic fields
    if (cardData.name) document.getElementById('card-name').value = cardData.name;
    if (cardData.characterClass || cardData.class) document.getElementById('card-class').value = cardData.characterClass || cardData.class;
    if (cardData.rarity) document.getElementById('card-rarity').value = cardData.rarity;
    if (cardData.quote) document.getElementById('card-quote').value = cardData.quote;
    if (cardData.avatar) document.getElementById('card-avatar').value = cardData.avatar;
    if (cardData.biography || cardData.bio) document.getElementById('card-bio').value = cardData.biography || cardData.bio;

    // Combat Stats — load from combatStats object or migrate from legacy stats
    if (cardData.combatStats) {
      setCombatStatValues(cardData.combatStats);
    } else if (cardData.stats && Array.isArray(cardData.stats)) {
      const migrated = migrateLegacyStats(cardData.stats);
      setCombatStatValues(migrated.combat);
      // Custom stats loaded below
      cardData._customStats = migrated.custom;
    }

    // Custom Stats (freeform)
    const statsContainer = document.getElementById('stats-editor');
    if (statsContainer) {
      statsContainer.innerHTML = '';
      const customStats = cardData._customStats || (cardData.stats || []).filter(s => {
        const nameLower = (s.name || '').toLowerCase().trim();
        return !COMBAT_STAT_DEFS.some(d => d.label.toLowerCase() === nameLower);
      });
      customStats.forEach(stat => {
        statsContainer.appendChild(createStatRow(stat.name, stat.value));
      });
    }

    // Badges (capped to slot limit + qty cap)
    const badgesContainer = document.getElementById('micro-editor');
    if (badgesContainer && cardData.badges && Array.isArray(cardData.badges)) {
      badgesContainer.innerHTML = '';
      const buffCap = getBuffSlotCap();
      const maxQty = (window.EffectTiers && window.EffectTiers.getMaxBuffQty) ? window.EffectTiers.getMaxBuffQty() : 1;
      cardData.badges.slice(0, buffCap).forEach(badge => {
        const qty = Math.min(badge.quantity || 1, maxQty);
        badgesContainer.appendChild(createBadgeRow(badge.category, badge.icon, badge.description, qty));
      });
    }
    updateBuffEmptyState();
    updateBuffBtnState();
    updateBuffProgressionBanner();

    // Attributes (capped to slot limit)
    const attributesContainer = document.getElementById('attribute-editor');
    if (attributesContainer && cardData.attributes && Array.isArray(cardData.attributes)) {
      attributesContainer.innerHTML = '';
      const attrCap = getAttributeSlotCap();
      cardData.attributes.slice(0, attrCap).forEach(attribute => {
        attributesContainer.appendChild(createAttributeRow(attribute.name, attribute.value));
      });
    }

    // Modular design (if present) — reset to defaults first to prevent stale keys
    if (cardData.design && window.ModularState) {
      const defaults = {
        horizontalAlignment: 'center',
        verticalAlignment: 'middle',
        alignmentWeight: 'balanced',
        alignmentStyle: 'padded',
        palette: 'neon',
        paletteVariant: 'light',
        textColor: 'auto',
        imageContainer: 'masked',
        imageContainerVariant: 'circle',
        imageEffect: 'none',
        imageEffectVariant: 'clean'
      };
      Object.assign(window.ModularState, defaults, cardData.design);
      
      // Legacy mapping: framed → masked(rounded), raw → masked(square), inset → masked(rounded)
      if (['framed', 'raw', 'inset'].includes(window.ModularState.imageContainer)) {
        const legacyMap = { 'framed': 'rounded', 'raw': 'square', 'inset': 'rounded' };
        window.ModularState.imageContainerVariant = legacyMap[window.ModularState.imageContainer] || 'circle';
        window.ModularState.imageContainer = 'masked';
      }
      // Legacy mapping: borders effect → none (border feature removed)
      if (window.ModularState.imageEffect === 'borders') {
        window.ModularState.imageEffect = 'none';
        window.ModularState.imageEffectVariant = 'clean';
      }
    }

    _statAnimationNeeded = true;
    updatePreview();
  };

  // Initialize everything when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    
    initPresets();
    initDynamicEditors();
    loadPrefillData();
    
    // Initialize modular tier system
    initModularSystem();
    
    // Initialize badge section toggles
    // Initialize icon pickers
    initIconPickers();
    
    // Initialize image gallery
    initImageGallery();
    
    // Initialize card flip functionality
    initCardFlip();
    
    // Initialize default class and rarity styles
    initDefaultClassAndRarityStyles();
    
    if (window.CardForgeChrome) {
      window.CardForgeChrome.init();
    }
    
    // Roll a random card for better initial experience
    // Note: Using direct call since we're inside the IIFE closure
    rollRandomCard();

    // Fetch arena profile for Battle Record (non-blocking)
    loadArenaStats().then(function (profile) {
      if (profile) updatePreview();
      applyEffectLockState(); // refresh locks with actual rank
      updateBuffProgressionBanner();
      updateBuffBtnState();
    });

    // Load billing entitlements (non-blocking)
    if (window.Entitlements) window.Entitlements.load();
    
    // Default image effects and borders to none on page load
    ModularState.imageEffect = 'none';
    ModularState.imageEffectVariant = 'clean';
    updatePreview();
    
    // Sync effect type buttons to None
    document.querySelectorAll('[data-tier="2"] .effects-grid .tier-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.value === 'none');
    });
    const evsSection = document.querySelector('[data-tier="2"] .effects-variants-section');
    if (evsSection) evsSection.style.display = 'none';
    
    // Ensure card effects and typography display is current after init
    updateCardEffectsDisplay();
    updateTypographyDisplay();
    
    if (window.CardForgeChrome) {
      setTimeout(() => window.CardForgeChrome.setDirtyTracking(true), 600);
    }
    
  });
  
  // ===== CARD FLIP FUNCTIONALITY =====
  function initCardFlip() {
    const flipBtn = document.getElementById('flip-btn');
    const cardInner = document.querySelector('.card-inner');
    
    // Manual flip button
    if (flipBtn && cardInner) {
      flipBtn.addEventListener('click', function() {
        cardInner.classList.toggle('flipped');
      });
    }
    
    // Auto flip on tab clicks
    document.addEventListener('click', function(e) {
      const stepBtn = e.target.closest('.step-btn');
      if (stepBtn && cardInner) {
        const step = stepBtn.getAttribute('data-step');
        // Steps 4, 5 show back face (Badges, Attributes)
        if (['4', '5'].includes(step)) {
          cardInner.classList.add('flipped');
        } else {
          // Steps 1, 2, 3 show front face (Card Design, Basics, Stats)
          cardInner.classList.remove('flipped');
        }
      }
    });
    
  }

  // ===== PRESET SYSTEM =====
  function initPresets() {
    const presetButtons = document.querySelectorAll('.preset-btn');
    
    presetButtons.forEach((button, index) => {
      const presetId = button.dataset.preset;
      
      button.addEventListener('click', (e) => {
        e.preventDefault();
        
        applyPreset(presetId);
        
        // Update active state
        presetButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
      });
    });
    
    // Initialize Roll button
    const rollButton = document.getElementById('roll-random-preset');
    if (rollButton) {
      rollButton.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Add visual feedback
        rollButton.style.transform = 'scale(0.95)';
        setTimeout(() => {
          rollButton.style.transform = '';
        }, 150);
        
        window.CardForge.rollRandomCard();
      });
    }
    
  }
  
  // ===== RANDOM CARD GENERATOR =====
  let _lastRandomImage = ''; // Track last image to avoid repeats

  function rollRandomCard() {
    
    // Define all possible options for each modular tier
    const randomOptions = {
      // Container Types (6 types)
      imageContainers: ['masked', 'polaroid', 'banner', 'fullbleed', 'hero', 'floating'],
      containerVariants: {
        'masked': ['circle', 'hex', 'diamond', 'rounded', 'square', 'rectangle'],
        'polaroid': ['classic', 'vintage', 'dark'],
        'banner': ['top', 'bottom'],
        'hero': ['large', 'small'],
        'fullbleed': ['standard', 'dimmed', 'blurred'],
        'floating': ['centered', 'tilted-left', 'tilted-right']
      },
      // Image Effects (filters only)
      imageEffects: ['none', 'filters', 'overlays'],
      effectVariants: {
        'none': ['clean'],
        'filters': ['sepia', 'grayscale', 'vintage', 'noir', 'warm', 'cool', 'cyberpunk', 'faded', 'high-contrast', 'duotone', 'vignette', 'bleach-bypass', 'cross-process', 'infrared', 'midnight', 'emerald', 'sunset'],
        'overlays': ['color-wash', 'gradient-fade', 'spotlight', 'haze']
      },
      // Tier 3: Color Palette
      palettes: ['neon', 'earth', 'ocean', 'sunset', 'monochrome', 'corporate', 'royal', 'inferno', 'frost', 'arcane'],
      paletteVariants: ['light', 'dark'],
      
      // Tier 4: Content Alignment
      horizontalAlignments: ['left', 'center', 'right'],
      verticalAlignments: ['middle', 'bottom'], // Exclude 'top' from random rolls
      alignmentStyles: ['none', 'padded', 'compact', 'elegant', 'narrow', 'bold', 'cinematic', 'editorial', 'stacked'],
      
      // Class Styles
      classStyles: ['default', 'badge', 'banner', 'outlined', 'glow', 'underline', 'gradient'],
      
      // Rarity Styles (text/badge only)
      rarityStyles: ['default', 'badge', 'inline-badge', 'outlined', 'underline', 'gradient', 'ribbon'],
      
      // Card Effects (separate categories)
      bgEffects: ['none', 'foil', 'holographic', 'sparkle', 'aurora', 'pulse', 'particles', 'grain', 'vignette', 'scanlines', 'frosted', 'linen', 'brushed-metal', 'parchment'],
      borderEffects: ['none', 'border', 'double', 'inset', 'thick', 'dashed', 'ridge', 'beveled', 'corners', 'animated-border'],
      glowEffects: ['none', 'glow', 'soft-ambient', 'inner-glow', 'neon-glow', 'halo', 'drop-shadow', 'pulse-glow', 'color-shift'],
      fontFamilies: ['inter', 'montserrat', 'poppins', 'rajdhani', 'playfair', 'cinzel', 'orbitron', 'medievalsharp', 'pirata']
    };
    
    // Generate random selections
    const randomContainer = randomOptions.imageContainers[Math.floor(Math.random() * randomOptions.imageContainers.length)];
    const randomContainerVariant = randomOptions.containerVariants[randomContainer][Math.floor(Math.random() * randomOptions.containerVariants[randomContainer].length)];
    
    // Filter image effects/variants through tier unlock system
    var availableEffects = randomOptions.imageEffects;
    if (window.EffectTiers) {
      availableEffects = randomOptions.imageEffects.filter(function (e) {
        if (e === 'none') return true;
        // "filters" type available if any filter variant is unlocked
        if (e === 'filters') return window.EffectTiers.getUnlockedEffects('imageFilter').length > 0;
        if (e === 'overlays') return window.EffectTiers.getUnlockedEffects('overlay').length > 0;
        return true;
      });
      if (availableEffects.length === 0) availableEffects = ['none'];
    }
    const randomEffect = availableEffects[Math.floor(Math.random() * availableEffects.length)];

    var availableVariants = randomOptions.effectVariants[randomEffect] || ['clean'];
    if (window.EffectTiers && randomEffect !== 'none') {
      var cat = randomEffect === 'overlays' ? 'overlay' : 'imageFilter';
      availableVariants = availableVariants.filter(function (v) {
        return v === 'clean' || window.EffectTiers.isEffectUnlocked(cat, v);
      });
      if (availableVariants.length === 0) availableVariants = ['clean'];
    }
    const randomEffectVariant = availableVariants[Math.floor(Math.random() * availableVariants.length)];
    
    const randomPalette = randomOptions.palettes[Math.floor(Math.random() * randomOptions.palettes.length)];
    const randomPaletteVariant = randomOptions.paletteVariants[Math.floor(Math.random() * randomOptions.paletteVariants.length)];
    
    const randomHorizontal = randomOptions.horizontalAlignments[Math.floor(Math.random() * randomOptions.horizontalAlignments.length)];
    const randomVertical = randomOptions.verticalAlignments[Math.floor(Math.random() * randomOptions.verticalAlignments.length)];
    const randomStyle = randomOptions.alignmentStyles[Math.floor(Math.random() * randomOptions.alignmentStyles.length)];
    
    const randomClassStyle = randomOptions.classStyles[Math.floor(Math.random() * randomOptions.classStyles.length)];
    const randomRarityStyle = randomOptions.rarityStyles[Math.floor(Math.random() * randomOptions.rarityStyles.length)];
    // Keep bg effects off to avoid gotty cards; allow subtle border/glow
    // Filter picks through effect tier unlock system
    const randomBgEffect = 'none';
    const unlockedBorders = window.EffectTiers ? window.EffectTiers.getUnlockedEffects('border') : ['none', 'border'];
    const randomBorderEffect = Math.random() < 0.5 ? (unlockedBorders.filter(b => b !== 'none')[0] || 'none') : 'none';
    const unlockedGlows = window.EffectTiers ? window.EffectTiers.getUnlockedEffects('glow') : ['none', 'glow'];
    const randomGlowEffect = Math.random() < 0.5 ? (unlockedGlows.filter(g => g !== 'none')[0] || 'none') : 'none';
    const randomFont = randomOptions.fontFamilies[Math.floor(Math.random() * randomOptions.fontFamilies.length)];
    
    // Reset ModularState to defaults, then apply random selections
    // This prevents stale keys from persisting across rolls/preset switches
    const defaults = {
      horizontalAlignment: 'center',
      verticalAlignment: 'middle',
      alignmentWeight: 'balanced',
      alignmentStyle: 'padded',
      palette: 'neon',
      paletteVariant: 'light',
      textColor: 'auto',
      imageContainer: 'masked',
      imageContainerVariant: 'circle',
      imageEffect: 'none',
      imageEffectVariant: 'clean'
    };
    Object.assign(ModularState, defaults, {
      imageContainer: randomContainer,
      imageContainerVariant: randomContainerVariant,
      imageEffect: randomEffect,
      imageEffectVariant: randomEffectVariant,
      palette: randomPalette,
      paletteVariant: randomPaletteVariant,
      horizontalAlignment: randomHorizontal,
      verticalAlignment: randomVertical,
      alignmentStyle: randomStyle
    });
    
    // Apply random class style to the dropdown
    const classStyleField = document.getElementById('class-style');
    if (classStyleField) {
      classStyleField.value = randomClassStyle;
    }
    
    // Apply random rarity style to the dropdown
    const rarityStyleField = document.getElementById('rarity-style');
    if (rarityStyleField) {
      rarityStyleField.value = randomRarityStyle;
    }
    
    // Apply random card effects to their dropdowns
    const bgEffectField = document.getElementById('card-bg-effect');
    if (bgEffectField) bgEffectField.value = randomBgEffect;
    const borderEffectField = document.getElementById('card-border-effect');
    if (borderEffectField) borderEffectField.value = randomBorderEffect;
    const glowEffectField = document.getElementById('card-glow-effect');
    if (glowEffectField) glowEffectField.value = randomGlowEffect;
    const fontField = document.getElementById('card-font-family');
    if (fontField) fontField.value = randomFont;
    
    // Clear any active preset buttons since this is a custom random card
    const allPresetButtons = document.querySelectorAll('.preset-btn');
    allPresetButtons.forEach(btn => btn.classList.remove('active'));
    
    // Update UI elements to reflect new random selections
    updateUIElementsFromState();
    
    // Generate random character data (name, class, rarity, quote, stats, badges, attributes, bio)
    generateRandomCharacterData();
    
    // Always randomize artwork on every roll — fetch then update preview
    generateRandomImage().then(() => {
      _statAnimationNeeded = true;
      updatePreview();
    });
  }
  
  // ===== UI ELEMENTS UPDATE FOR RANDOM CARD =====
  function updateUIElementsFromState() {
    // Update container selection UI
    const containerOptions = document.querySelectorAll('[data-tier="2"] .container-grid .tier-option');
    containerOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.imageContainer);
    });
    
    // Show correct container variants
    const variantContainers = document.querySelectorAll('[data-tier="2"] .container-variants');
    variantContainers.forEach(container => {
      const containerType = container.dataset.container;
      container.style.display = containerType === ModularState.imageContainer ? 'block' : 'none';
    });
    
    // Update variant selection
    const activeContainer = document.querySelector(`[data-tier="2"] [data-container="${ModularState.imageContainer}"]`);
    if (activeContainer) {
      const variantOptions = activeContainer.querySelectorAll('.variant-option');
      variantOptions.forEach(option => {
        option.classList.toggle('selected', option.dataset.variant === ModularState.imageContainerVariant);
      });
    }
    
    // Update effects selection
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-level .effects-grid .tier-option');
    effectOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.imageEffect);
    });
    
    // Show/hide effects variants section
    const evsSection = document.querySelector('[data-tier="2"] .effects-variants-section');
    if (evsSection) {
      evsSection.style.display = ModularState.imageEffect === 'none' ? 'none' : 'block';
    }
    document.querySelectorAll('[data-tier="2"] .effect-variants').forEach(container => {
      container.style.display = container.dataset.effect === ModularState.imageEffect ? 'block' : 'none';
    });
    const activeEffectPanel = document.querySelector(`[data-tier="2"] [data-effect="${ModularState.imageEffect}"]`);
    if (activeEffectPanel) {
      activeEffectPanel.querySelectorAll('.variant-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.variant === ModularState.imageEffectVariant);
      });
    }
    
    // Update palette selection
    const paletteOptions = document.querySelectorAll('[data-tier="3"] .palette-family');
    paletteOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.palette === ModularState.palette);
    });
    
    // Update palette variant toggles
    const variantToggles = document.querySelectorAll('[data-tier="3"] .variant-toggle');
    variantToggles.forEach(toggle => {
      toggle.classList.toggle('selected', toggle.dataset.variant === ModularState.paletteVariant);
    });
    
    // Update alignment selections
    const horizontalOptions = document.querySelectorAll('[data-tier="4"] .alignment-type .tier-option');
    horizontalOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.horizontalAlignment);
    });
    
    // Update style variant selection
    const styleOptions = document.querySelectorAll('[data-tier="4"] .style-option');
    styleOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.style === ModularState.alignmentStyle);
    });
    
    // Update card effects display in tier header
    updateCardEffectsDisplay();
    updateTypographyDisplay();
    
  }
  
  // ===== RANDOM CHARACTER DATA GENERATOR =====
  function generateRandomCharacterData() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const randomNames = ['Aria Shadowbane', 'Zara-7', 'Marcus Ironforge', 'Luna Starweaver', 'Kai Stormrider', 'Nova Brightblade', 'Rex Cyberpunk', 'Sage Moonwhisper', 'Titan Guardian', 'Vex Nightshade', 'Orion Blaze', 'Lyra Frostwind'];
    const randomClasses = ['Fighter', 'Enforcer', 'Berserker', 'Caster', 'Hacker', 'Scholar', 'Scout', 'Rogue', 'Pilot', 'Guardian', 'Medic', 'Trickster', 'Wildcard'];
    const randomSubclasses = ['Shadow Operative', 'Void Walker', 'Neon Samurai', 'Chrono Mage', 'Bio-Engineer', 'Cyberpunk Runner', 'Arcane Scholar', 'Space Marine', 'Tech Specialist', 'Mystic Warrior', 'Storm Rider', 'Blade Dancer'];
    const randomRarities = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const randomQuotes = [
      'Shadows are my allies, silence my weapon.',
      'In the neon glow, I find my path.',
      'Knowledge is the greatest power.',
      'For honor and the galaxy!',
      'Nature guides my arrows.',
      'Technology is my sword.',
      'Magic flows through all things.',
      'Stealth is my greatest asset.',
      'The void whispers, and I answer.',
      'Time bends to my will.',
      'Every circuit tells a story.',
      'Born from starlight, forged in fire.'
    ];
    const randomBios = [
      'A wanderer from the outer rim, shaped by conflict and driven by an unshakable code of honor.',
      'Once a street-level hacker, now a legend in the underground resistance networks.',
      'Trained in the ancient arts since childhood, wielding power few can comprehend.',
      'A decorated veteran of the Galactic Wars, seeking redemption in the frontier.',
      'Emerged from the digital void with memories of a thousand simulated lifetimes.',
      'Last survivor of a forgotten order, carrying secrets that could reshape reality.',
      'A prodigy of bio-mechanical fusion, blurring the line between flesh and machine.',
      'Guardian of the threshold between worlds, sworn to maintain the cosmic balance.'
    ];
    // Buff pool sourced from EffectTiers (single source of truth), filtered by rank
    const buffPool = (window.EffectTiers && window.EffectTiers.getUnlockedBuffs)
      ? window.EffectTiers.getUnlockedBuffs()
      : (window.EffectTiers && window.EffectTiers.BUFF_DEFS) || [];
    // Set random basic info
    document.getElementById('card-name').value = pick(randomNames);
    document.getElementById('card-class').value = pick(randomClasses);
    const subclassField = document.getElementById('card-subclass');
    if (subclassField) subclassField.value = pick(randomSubclasses);
    document.getElementById('card-rarity').value = pick(randomRarities);
    document.getElementById('card-quote').value = pick(randomQuotes);

    // Set random biography
    const bioField = document.getElementById('card-bio');
    if (bioField) {
      bioField.value = pick(randomBios);
    }
    
    // Clear all dynamic rows (stats, badges, attributes)
    clearAllDynamicRows();

    // Generate random stats (3 to STAT_CAP)
    const statNames = ['Strength', 'Agility', 'Intelligence', 'Stealth', 'Magic', 'Tech', 'Charisma', 'Endurance'];
    const numStats = Math.floor(Math.random() * (STAT_CAP - 2)) + 3; // 3 to STAT_CAP
    const statsContainer = document.getElementById('stats-editor');
    if (statsContainer) {
      const usedStats = [];
      for (let i = 0; i < numStats; i++) {
        let statName;
        do { statName = pick(statNames); } while (usedStats.includes(statName) && usedStats.length < statNames.length);
        usedStats.push(statName);
        const statValue = Math.floor(Math.random() * 80) + 20; // 20-99 range
        statsContainer.appendChild(createStatRow(statName, statValue));
      }
    }

    // Generate random buffs/traits — fills exactly the rank-based slot cap, qty capped by rank
    const badgesContainer = document.getElementById('micro-editor');
    const buffSlots = getBuffSlotCap();
    const maxQty = (window.EffectTiers && window.EffectTiers.getMaxBuffQty)
      ? window.EffectTiers.getMaxBuffQty() : 1;
    if (badgesContainer && buffPool.length > 0) {
      const count = Math.min(buffSlots, buffPool.length);
      const shuffled = [...buffPool].sort(() => Math.random() - 0.5).slice(0, count);
      shuffled.forEach(buff => {
        const quantity = Math.floor(Math.random() * maxQty) + 1; // 1 to maxQty
        badgesContainer.appendChild(createBadgeRow(buff.key, buff.icon, buff.description, quantity));
      });
    }

    // Update buff UI state after generation
    updateBuffEmptyState();
    updateBuffBtnState();
    updateBuffProgressionBanner();

    // Generate random attributes — fills exactly the rank-based slot cap
    const attributeNames = ['Strength', 'Agility', 'Intelligence', 'Wisdom', 'Stealth', 'Dexterity',
      'Courage', 'Focus', 'Reflexes', 'Leadership', 'Honor', 'Cunning', 'Tech', 'Nature Lore',
      'Combat', 'Resilience', 'Reputation', 'Constitution', 'Research', 'Tactics'];
    const attributeTextValues = ['Expert', 'Masterful', 'Legendary', 'Respected', 'Unbreakable', 'Blessed', 'Renowned'];
    const attributesContainer = document.getElementById('attribute-editor');
    const attrSlots = getAttributeSlotCap();
    if (attributesContainer) {
      const usedNames = [];
      for (let i = 0; i < attrSlots; i++) {
        let attrName;
        do { attrName = pick(attributeNames); } while (usedNames.includes(attrName) && usedNames.length < attributeNames.length);
        usedNames.push(attrName);
        // Mix numeric and text values
        const attrValue = Math.random() < 0.3
          ? pick(attributeTextValues)
          : String(Math.floor(Math.random() * 13) + 8); // 8-20 range
        attributesContainer.appendChild(createAttributeRow(attrName, attrValue));
      }
      // Disable add button if at cap
      const addAttrBtn = document.getElementById('add-attribute-btn');
      if (addAttrBtn && attrSlots >= getAttributeSlotCap()) {
        addAttrBtn.classList.add('disabled');
        addAttrBtn.title = `Maximum ${attrSlots} attributes reached`;
      }
    }

  }
  
  // ===== RANDOM IMAGE GENERATOR =====
  function generateRandomImage() {
    // Return a Promise so we can chain .then() properly
    return fetch('/cardforge/image-manifest.json')
      .then(res => res.json())
      .then(images => {
        if (images && images.length > 0) {
          // Avoid repeating the same image two rolls in a row
          let candidates = images.length > 1
            ? images.filter(img => img !== _lastRandomImage)
            : images;
          const randomImage = candidates[Math.floor(Math.random() * candidates.length)];
          _lastRandomImage = randomImage;
          
          // Set the random image as the card avatar
          const cardAvatarInput = document.getElementById('card-avatar');
          if (cardAvatarInput) {
            cardAvatarInput.value = randomImage;
            
            // Highlight matching gallery thumbnail if visible
            const inlineImageGrid = document.getElementById('inline-image-grid');
            if (inlineImageGrid) {
              inlineImageGrid.querySelectorAll('img').forEach(img => {
                img.classList.toggle('selected', img.src.endsWith(randomImage));
              });
            }
          }
        }
      })
      .catch(error => {
        console.warn('⚠️ Could not load random image:', error);
        // Fallback to a default image if manifest fails
        const cardAvatarInput = document.getElementById('card-avatar');
        if (cardAvatarInput) {
          cardAvatarInput.value = '/images/image-packs/characters/cyber-erenity.jpg';
        }
      });
  }
  
  function applyPreset(presetId) {
    const config = PresetConfigurations[presetId];
    if (!config) {
      console.error(`Preset ${presetId} not found in PresetConfigurations`);
      return;
    }
    
    // Separate front styling from sample data and non-ModularState keys
    const { sampleData, classStyle, classIcon, rarityStyle, rarityIcon, ...designConfig } = config;
    
    // Reset ModularState to defaults, then apply preset design config
    // This prevents stale keys from persisting across preset switches
    const defaults = {
      horizontalAlignment: 'center',
      verticalAlignment: 'middle',
      alignmentWeight: 'balanced',
      alignmentStyle: 'padded',
      palette: 'neon',
      paletteVariant: 'light',
      textColor: 'auto',
      imageContainer: 'masked',
      imageContainerVariant: 'circle',
      imageEffect: 'none',
      imageEffectVariant: 'clean'
    };
    Object.assign(ModularState, defaults, designConfig);
    // Legacy mapping: framed/raw/inset → masked
    if (['framed', 'raw', 'inset'].includes(ModularState.imageContainer)) {
      const legacyMap = { 'framed': 'rounded', 'raw': 'square', 'inset': 'rounded' };
      ModularState.imageContainerVariant = legacyMap[ModularState.imageContainer] || 'circle';
      ModularState.imageContainer = 'masked';
    }
    // Legacy mapping: borders effect → none (border feature removed)
    if (ModularState.imageEffect === 'borders') {
      ModularState.imageEffect = 'none';
      ModularState.imageEffectVariant = 'clean';
    }
    
    // Populate class and rarity styling form fields
    if (classStyle) {
      const classStyleField = document.getElementById('class-style');
      if (classStyleField) {
        classStyleField.value = classStyle;
      }
    }
    
    if (classIcon) {
      const classIconField = document.getElementById('class-icon-value');
      if (classIconField) {
        classIconField.value = classIcon;
        // Update visual selection
        const classIconOptions = document.querySelectorAll('#class-section .icon-option');
        classIconOptions.forEach(option => {
          option.classList.toggle('selected', option.dataset.icon === classIcon);
        });
      }
    }
    
    if (rarityStyle) {
      // Route old rarityStyle values to the correct new dropdowns
      const bgEffectField = document.getElementById('card-bg-effect');
      const borderEffectField = document.getElementById('card-border-effect');
      const glowEffectField = document.getElementById('card-glow-effect');
      const rarityStyleField = document.getElementById('rarity-style');
      
      // Reset all effect dropdowns and font first
      if (bgEffectField) bgEffectField.value = 'none';
      if (borderEffectField) borderEffectField.value = 'none';
      if (glowEffectField) glowEffectField.value = 'none';
      if (rarityStyleField) rarityStyleField.value = 'default';
      const fontField = document.getElementById('card-font-family');
      if (fontField) fontField.value = 'inter';
      
      if (rarityStyle === 'foil' && bgEffectField) {
        bgEffectField.value = 'foil';
      } else if ((rarityStyle === 'border' || rarityStyle === 'frame') && borderEffectField) {
        borderEffectField.value = rarityStyle;
      } else if (rarityStyle === 'glow' && glowEffectField) {
        glowEffectField.value = 'glow';
      } else if (rarityStyleField) {
        rarityStyleField.value = rarityStyle;
      }
    }
    
    if (rarityIcon) {
      const rarityIconField = document.getElementById('rarity-icon-value');
      if (rarityIconField) {
        rarityIconField.value = rarityIcon;
        // Update visual selection
        const rarityIconOptions = document.querySelectorAll('#rarity-section .icon-option');
        rarityIconOptions.forEach(option => {
          option.classList.toggle('selected', option.dataset.icon === rarityIcon);
        });
      }
    }

    // Downgrade locked effects to 'none' when applying presets
    if (window.EffectTiers) {
      var bgField = document.getElementById('card-bg-effect');
      var brField = document.getElementById('card-border-effect');
      var glField = document.getElementById('card-glow-effect');
      if (bgField && !window.EffectTiers.isEffectUnlocked('bg', bgField.value)) bgField.value = 'none';
      if (brField && !window.EffectTiers.isEffectUnlocked('border', brField.value)) brField.value = 'none';
      if (glField && !window.EffectTiers.isEffectUnlocked('glow', glField.value)) glField.value = 'none';
      // Downgrade image effect variant if locked
      if (ModularState.imageEffect === 'filters' && !window.EffectTiers.isEffectUnlocked('imageFilter', ModularState.imageEffectVariant)) {
        ModularState.imageEffectVariant = 'clean';
      }
      if (ModularState.imageEffect === 'overlays' && !window.EffectTiers.isEffectUnlocked('overlay', ModularState.imageEffectVariant)) {
        ModularState.imageEffectVariant = 'clean';
        ModularState.imageEffect = 'none';
      }
    }

    try {
      updateUIFromState();
    } catch (error) {
      console.error('Error in updateUIFromState:', error);
    }
    
    // Populate form with sample data
    if (sampleData) {
      try {
        populateFormWithSampleData(sampleData);
      } catch (error) {
        console.error('Error in populateFormWithSampleData:', error);
      }
    } else {
      console.warn(`⚠️ No sample data found for preset ${presetId}`);
    }
    
    // Update preview
    try {
      _statAnimationNeeded = true;
      updatePreview();
    } catch (error) {
      console.error('Error in updatePreview:', error);
    }
  }
  
  function populateFormWithSampleData(sampleData) {
    // Populate basic character info
    if (sampleData.name) {
      const nameField = document.getElementById('card-name');
      if (nameField) {
        nameField.value = sampleData.name;
      }
    }
    
    if (sampleData.characterClass) {
      const classField = document.getElementById('card-class');
      if (classField) {
        classField.value = sampleData.characterClass;
        // Fallback: if value didn't match any option, try to map or clear
        if (!classField.value && sampleData.characterClass) {
          // Old free-text class — use as subclass instead
          classField.value = '';
          const subFallback = document.getElementById('card-subclass');
          if (subFallback && !sampleData.characterSubclass) subFallback.value = sampleData.characterClass;
        }
      }
    }
    if (sampleData.characterSubclass) {
      const subclassField = document.getElementById('card-subclass');
      if (subclassField) subclassField.value = sampleData.characterSubclass;
    }
    
    if (sampleData.biography) {
      const bioField = document.getElementById('card-bio');
      if (bioField) bioField.value = sampleData.biography;
    }
    
    if (sampleData.avatar) {
      const avatarField = document.getElementById('card-avatar');
      if (avatarField) avatarField.value = sampleData.avatar;
    }
    
    // Clear existing dynamic content
    clearAllDynamicRows();
    
    // Populate stats — migrate legacy sample data into combat + custom
    if (sampleData.combatStats) {
      setCombatStatValues(sampleData.combatStats);
    }
    if (sampleData.stats && sampleData.stats.length > 0) {
      const statsContainer = document.getElementById('stats-editor');
      if (statsContainer) {
        if (!sampleData.combatStats) {
          const migrated = migrateLegacyStats(sampleData.stats);
          setCombatStatValues(migrated.combat);
          migrated.custom.forEach(stat => {
            statsContainer.appendChild(createStatRow(stat.name, stat.value));
          });
        } else {
          sampleData.stats.filter(s => {
            const nameLower = (s.name || '').toLowerCase().trim();
            return !COMBAT_STAT_DEFS.some(d => d.label.toLowerCase() === nameLower);
          }).forEach(stat => {
            statsContainer.appendChild(createStatRow(stat.name, stat.value));
          });
        }
      }
    }
    
    // Populate badges (capped to slot limit + qty cap)
    if (sampleData.badges && sampleData.badges.length > 0) {
      const badgesContainer = document.getElementById('micro-editor');
      if (badgesContainer) {
        const buffCap = getBuffSlotCap();
        const maxQty = (window.EffectTiers && window.EffectTiers.getMaxBuffQty) ? window.EffectTiers.getMaxBuffQty() : 1;
        sampleData.badges.slice(0, buffCap).forEach(badge => {
          const qty = Math.min(badge.quantity || 1, maxQty);
          const badgeRow = createMicroBadgeRow(badge.category, badge.icon, badge.description, qty);
          badgesContainer.appendChild(badgeRow);
        });
      } else {
        console.warn('⚠️ Badges container not found');
      }
    }
    
    // Populate attributes (capped to slot limit)
    if (sampleData.attributes && sampleData.attributes.length > 0) {
      const attributesContainer = document.getElementById('attribute-editor');
      if (attributesContainer) {
        const attrCap = getAttributeSlotCap();
        sampleData.attributes.slice(0, attrCap).forEach(attribute => {
          const attributeRow = createAttributeRow(attribute.name, attribute.value);
          attributesContainer.appendChild(attributeRow);
        });
      } else {
        console.warn('⚠️ Attributes container not found');
      }
    }
    
  }
  
  function clearAllDynamicRows() {
    // Reset combat stats to defaults
    const defaultCombat = {};
    COMBAT_STAT_DEFS.forEach(d => { defaultCombat[d.key] = COMBAT_DEFAULT_VALUE; });
    setCombatStatValues(defaultCombat);
    updateBudgetDisplay();

    // Clear custom stats
    const statsContainer = document.getElementById('stats-editor');
    if (statsContainer) {
      statsContainer.innerHTML = '';
    }
    
    // Clear badges + show empty state
    const badgesContainer = document.getElementById('micro-editor');
    if (badgesContainer) {
      badgesContainer.innerHTML = '';
    }
    updateBuffEmptyState();
    updateBuffBtnState();
    updateBuffProgressionBanner();
    
    // Clear attributes and re-enable Add button
    const attributesContainer = document.getElementById('attribute-editor');
    if (attributesContainer) {
      attributesContainer.innerHTML = '';
      const addAttrBtn = document.getElementById('add-attribute-btn');
      if (addAttrBtn) {
        addAttrBtn.classList.remove('disabled');
        addAttrBtn.title = '';
      }
    }
    
  }
  
  function updateUIFromState() {
    // Update Tier 1: Layout
    const layoutOptions = document.querySelectorAll('[data-tier="1"] .tier-option');
    layoutOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.layout);
    });
    
    // Update Tier 4: Content Alignment (3-level hierarchy)
    // Level 1: Horizontal Alignment
    const horizontalAlignmentOptions = document.querySelectorAll('[data-tier="4"] .alignment-type .tier-option');
    horizontalAlignmentOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.horizontalAlignment);
    });
    
    // Level 1: Vertical Alignment (show/hide based on fullbleed container)
    const verticalAlignmentSection = document.getElementById('vertical-alignment-section');
    if (verticalAlignmentSection) {
      // Show vertical alignment only for fullbleed containers
      const showVerticalAlignment = ModularState.imageContainer === 'fullbleed';
      
      // Force show with important style
      if (showVerticalAlignment) {
        verticalAlignmentSection.style.setProperty('display', 'block', 'important');
        verticalAlignmentSection.style.visibility = 'visible';
        verticalAlignmentSection.style.opacity = '1';
      } else {
        verticalAlignmentSection.style.display = 'none';
      }
      
      // Update vertical alignment selection if visible
      if (showVerticalAlignment) {
        const verticalAlignmentOptions = document.querySelectorAll('[data-tier="4"] .vertical-alignment-level .tier-option');
        verticalAlignmentOptions.forEach(option => {
          const isSelected = option.dataset.value === ModularState.verticalAlignment;
          option.classList.toggle('selected', isSelected);
        });
      }
    }
    
    // Level 3: Alignment Style
    const alignmentStyleOptions = document.querySelectorAll('[data-tier="4"] .style-option');
    alignmentStyleOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.style === ModularState.alignmentStyle);
    });
    
    // Update Tier 3: Weight
    const weightOptions = document.querySelectorAll('[data-tier="3"] .tier-option');
    weightOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.weight);
    });
    
    // Update Tier 3: Color Palette
    const paletteOptions = document.querySelectorAll('[data-tier="3"] .palette-family');
    paletteOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.palette === ModularState.palette);
    });
    
    const variantToggles = document.querySelectorAll('[data-tier="3"] .variant-toggle');
    variantToggles.forEach(toggle => {
      toggle.classList.toggle('selected', toggle.dataset.variant === ModularState.paletteVariant);
    });
    
    // Update Tier 2: Image Container (scoped to .container-grid only)
    const containerOptions = document.querySelectorAll('[data-tier="2"] .container-grid .tier-option');
    containerOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.imageContainer);
    });
    
    // Show/hide container variants
    const variantContainers = document.querySelectorAll('[data-tier="2"] .container-variants');
    variantContainers.forEach(container => {
      const containerType = container.dataset.container;
      container.style.display = containerType === ModularState.imageContainer ? 'block' : 'none';
    });
    
    // Update container variant selection
    const activeContainer = document.querySelector(`[data-tier="2"] [data-container="${ModularState.imageContainer}"]`);
    if (activeContainer) {
      const variantOptions = activeContainer.querySelectorAll('.variant-option');
      variantOptions.forEach(option => {
        option.classList.toggle('selected', option.dataset.variant === ModularState.imageContainerVariant);
      });
    }
    
    // Update Image Effects (scoped to .effects-grid)
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-grid .tier-option');
    effectOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.imageEffect);
    });
    
    // Show/hide effects-variants-section based on effect type
    const effectsVariantsSection = document.querySelector('[data-tier="2"] .effects-level .effects-variants-section');
    if (effectsVariantsSection) {
      effectsVariantsSection.style.display = ModularState.imageEffect === 'none' ? 'none' : 'block';
    }
    
    // Show/hide effect variants
    const effectVariantContainers = document.querySelectorAll('[data-tier="2"] .effect-variants');
    effectVariantContainers.forEach(container => {
      const effectType = container.dataset.effect;
      container.style.display = effectType === ModularState.imageEffect ? 'block' : 'none';
    });
    
    // Update effect variant selection
    const activeEffect = document.querySelector(`[data-tier="2"] [data-effect="${ModularState.imageEffect}"]`);
    if (activeEffect) {
      const variantOptions = activeEffect.querySelectorAll('.variant-option');
      variantOptions.forEach(option => {
        option.classList.toggle('selected', option.dataset.variant === ModularState.imageEffectVariant);
      });
    }
    
    // Update collapsible tier current selection displays
    updateCollapsibleTierDisplays();
    updateCardEffectsDisplay();
  }

  // ===== MODULAR SYSTEM INITIALIZATION =====
  function initModularSystem() {
    
    // Initialize collapsible tier system
    initCollapsibleTiers();
    
    // Initialize all modular tiers
    // initTier1Layout() REMOVED - Phase 1 of Flow Restructure
    initTier2ImageContainer(); // Image Container in Tier 2
    // initTier3ImageEffects(); // Image Effects - TEMPORARILY DISABLED
    initTier3Palette(); // Color Palette moved to Tier 4 (function name needs updating)
    initTier4Alignment(); // Content Alignment moved to Tier 5 (function name needs updating)
    // initTier5Weight(); // REMOVED - Standalone Visual Weight tier (redundant with Content Alignment weight distribution)
    
  }

  // ===== COLLAPSIBLE TIER SYSTEM =====
  function initCollapsibleTiers() {
    
    // Get all tier headers (clickable collapse/expand triggers)
    const tierHeaders = document.querySelectorAll('.tier-header[data-tier-toggle]');
    
    tierHeaders.forEach(header => {
      header.addEventListener('click', function() {
        const tierId = this.getAttribute('data-tier-toggle');
        const tier = this.closest('.collapsible-tier');
        const content = tier.querySelector(`[data-tier-content="${tierId}"]`);
        
        // Toggle expanded state
        const isExpanded = tier.classList.contains('expanded');
        
        if (isExpanded) {
          // Collapse
          tier.classList.remove('expanded');
        } else {
          // Expand (and optionally collapse others for accordion effect)
          // First collapse all other tiers
          document.querySelectorAll('.collapsible-tier.expanded').forEach(otherTier => {
            if (otherTier !== tier) {
              otherTier.classList.remove('expanded');
            }
          });
          
          // Then expand this tier
          tier.classList.add('expanded');
        }
      });
    });
    
    // Initialize with all tiers collapsed by default
    document.querySelectorAll('.collapsible-tier').forEach(tier => {
      tier.classList.remove('expanded');
    });
    
  }

  // ===== TIER SELECTION DISPLAY UPDATES =====
  function updateTierCurrentSelection(tierId, displayText, previewClass = null) {
    const tier = document.querySelector(`[data-tier="${tierId}"]`);
    if (!tier) return;
    
    const selectionText = tier.querySelector('.current-selection-text');
    const previewElement = tier.querySelector('.current-palette-preview');
    
    if (selectionText) {
      selectionText.textContent = displayText;
    }
    
    if (previewElement && previewClass) {
      // Remove all existing preview classes
      previewElement.className = previewElement.className.replace(/\w+-preview/g, '').trim();
      previewElement.classList.add('current-palette-preview', previewClass);
    }
    
  }

  function updateCollapsibleTierDisplays() {
    // Update Tier 1: Layout Style display
    const selectedLayout = document.querySelector('[data-tier="1"] .tier-option.selected');
    if (selectedLayout) {
      const layoutLabel = selectedLayout.querySelector('.option-label').textContent;
      const previewClass = `${ModularState.layout}-layout-preview`;
      updateTierCurrentSelection('1', layoutLabel, previewClass);
    }
    
    // Update Tier 2: Content Alignment display (3-level hierarchy)
    const alignmentType = ModularState.horizontalAlignment || 'center';
    const alignmentStyle = ModularState.alignmentStyle || 'padded';
    
    const alignmentTypeLabel = alignmentType.charAt(0).toUpperCase() + alignmentType.slice(1);
    const alignmentStyleLabel = alignmentStyle.charAt(0).toUpperCase() + alignmentStyle.slice(1);
    
    const alignmentDisplayText = `${alignmentTypeLabel} ${alignmentStyleLabel}`;
    const alignmentPreviewClass = `${alignmentType}-alignment-preview`;
    updateTierCurrentSelection('2', alignmentDisplayText, alignmentPreviewClass);
    
    // Update Tier 3: Color Palette display
    const selectedPalette = document.querySelector('.palette-family.selected');
    if (selectedPalette) {
      const paletteLabel = selectedPalette.querySelector('.palette-label').textContent;
      const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
      const effective = getEffectivePalette();
      const displayLabel = ModularState.palette === 'auto'
        ? `Auto (${effective.charAt(0).toUpperCase() + effective.slice(1)}) ${variantLabel}`
        : `${paletteLabel} ${variantLabel}`;
      const previewClass = ModularState.palette === 'auto'
        ? `${effective}-preview`
        : `${ModularState.palette}-preview`;
      updateTierCurrentSelection('3', displayLabel, previewClass);
    }
    
    // Update Tier 2: Image Container display
    const selectedContainer = document.querySelector('.tier-option.selected[data-value]');
    if (selectedContainer && selectedContainer.dataset.value !== 'none') {
      const containerLabel = selectedContainer.querySelector('.option-label').textContent;
      const variantLabel = ModularState.imageContainerVariant.charAt(0).toUpperCase() + ModularState.imageContainerVariant.slice(1);
      const previewClass = `${ModularState.imageContainer}-container-preview`;
      updateTierCurrentSelection('2', `${containerLabel} ${variantLabel}`, previewClass);
    }
    
    // Update Tier 5: Visual Weight display
    const selectedWeight = document.querySelector('.weight-option.selected');
    if (selectedWeight) {
      const weightLabel = selectedWeight.querySelector('.option-label').textContent;
      const previewClass = `${ModularState.weight}-weight-preview`;
      updateTierCurrentSelection('5', weightLabel, previewClass);
    }
    
    // Update Tier 6: Image Effects display
    const selectedEffect = document.querySelector('[data-tier="6"] .tier-option.selected');
    if (selectedEffect) {
      const effectLabel = selectedEffect.querySelector('.option-label').textContent;
      const variantLabel = ModularState.imageEffectVariant ? ModularState.imageEffectVariant.charAt(0).toUpperCase() + ModularState.imageEffectVariant.slice(1) : '';
      const previewClass = `${ModularState.imageEffect || 'none'}-effect-preview`;
      // For 'none' effect, just show the effect name without variant
      const displayText = (ModularState.imageEffect === 'none') ? effectLabel : `${effectLabel} ${variantLabel}`;
      updateTierCurrentSelection('6', displayText, previewClass);
    }
    
  }

  function updateCardEffectsDisplay() {
    const bg = document.getElementById('card-bg-effect');
    const border = document.getElementById('card-border-effect');
    const glow = document.getElementById('card-glow-effect');
    
    const parts = [];
    const icons = [];
    
    if (bg && bg.value !== 'none') {
      const chip = document.querySelector(`.effect-chips[data-target="card-bg-effect"] .effect-chip[data-value="${bg.value}"] i`);
      parts.push(bg.options[bg.selectedIndex].text);
      if (chip) icons.push(chip.className);
    }
    if (border && border.value !== 'none') {
      const chip = document.querySelector(`.effect-chips[data-target="card-border-effect"] .effect-chip[data-value="${border.value}"] i`);
      parts.push(border.options[border.selectedIndex].text);
      if (chip) icons.push(chip.className);
    }
    if (glow && glow.value !== 'none') {
      const chip = document.querySelector(`.effect-chips[data-target="card-glow-effect"] .effect-chip[data-value="${glow.value}"] i`);
      parts.push(glow.options[glow.selectedIndex].text);
      if (chip) icons.push(chip.className);
    }
    
    const displayText = parts.length > 0 ? parts.join(' · ') : 'None';
    
    // Update header: inject mini icon chips + text
    const tier = document.querySelector('[data-tier="5"]');
    if (tier) {
      const selectionArea = tier.querySelector('.tier-current-selection');
      if (selectionArea) {
        // Clear existing preview chips
        selectionArea.querySelectorAll('.effect-preview-chip').forEach(el => el.remove());
        
        // Add mini icon chips before the text
        const textEl = selectionArea.querySelector('.current-selection-text');
        icons.forEach(iconClass => {
          const chip = document.createElement('div');
          chip.className = 'effect-preview-chip';
          chip.innerHTML = `<i class="${iconClass}"></i>`;
          selectionArea.insertBefore(chip, textEl);
        });
        
        if (textEl) textEl.textContent = displayText;
      }
    }
    
    // Sync chip button selection state from hidden selects
    [bg, border, glow].forEach(select => {
      if (!select) return;
      const chipGroup = document.querySelector(`.effect-chips[data-target="${select.id}"]`);
      if (!chipGroup) return;
      chipGroup.querySelectorAll('.effect-chip').forEach(chip => {
        chip.classList.toggle('selected', chip.dataset.value === select.value);
      });
    });
  }

  function updateTypographyDisplay() {
    const fontSelect = document.getElementById('card-font-family');
    if (!fontSelect) return;
    
    const fontName = fontSelect.options[fontSelect.selectedIndex].text;
    updateTierCurrentSelection('typo', fontName);
    
    // Update header font preview to match selected font
    const typoPreview = document.querySelector('.current-typo-preview');
    if (typoPreview) {
      const selectedChip = document.querySelector(`.font-chip[data-value="${fontSelect.value}"]`);
      if (selectedChip) {
        typoPreview.style.fontFamily = selectedChip.style.fontFamily;
      }
    }
    
    // Sync font chip button selection state
    const chipGroup = document.querySelector('.font-chips');
    if (chipGroup) {
      chipGroup.querySelectorAll('.effect-chip').forEach(chip => {
        chip.classList.toggle('selected', chip.dataset.value === fontSelect.value);
      });
    }
  }

  // ===== TIER 1: LAYOUT REMOVED =====
  // Phase 1 of Flow Restructure: Layout initialization eliminated
  // Image-first design: Image Container moved to Tier 2 position

  // ===== TIER 4: CONTENT ALIGNMENT (SIMPLE WORKING SYSTEM) =====
  function initTier4Alignment() {
    
    // Initialize alignment event handlers
    initAlignmentEventHandlers();
    
  }
  
  function initAlignmentEventHandlers() {
    // Horizontal alignment handlers
    const horizontalOptions = document.querySelectorAll('[data-tier="4"] .alignment-level:first-child .tier-option');
    horizontalOptions.forEach(option => {
      option.addEventListener('click', () => {
        horizontalOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        ModularState.horizontalAlignment = option.dataset.value;
        updatePreview();
      });
    });
    
    // Vertical alignment handlers
    const verticalOptions = document.querySelectorAll('[data-tier="4"] .alignment-level:nth-child(2) .tier-option');
    verticalOptions.forEach(option => {
      option.addEventListener('click', () => {
        verticalOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        ModularState.verticalAlignment = option.dataset.value;
        updatePreview();
      });
    });
    
    // Style variant handlers
    const styleOptions = document.querySelectorAll('[data-tier="4"] .style-option');
    styleOptions.forEach(option => {
      option.addEventListener('click', () => {
        styleOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        ModularState.alignmentStyle = option.dataset.style;
        updatePreview();
      });
    });
  }
  
  // Old alignment functions removed - using simplified version above
  
  function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ===== TIER 5: VISUAL WEIGHT =====
  function initTier5Weight() {
    const weightOptions = document.querySelectorAll('[data-tier="5"] .tier-option');
    
    weightOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        weightOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.weight = option.dataset.value;
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
      });
    });
    
    // Set default selection
    const defaultOption = document.querySelector(`[data-tier="5"] [data-value="${ModularState.weight}"]`);
    if (defaultOption) {
      defaultOption.classList.add('selected');
      
      // Initialize current selection display with default values
      const weightLabel = defaultOption.querySelector('.option-label').textContent;
      const previewClass = `${ModularState.weight}-weight-preview`;
      updateTierCurrentSelection('5', weightLabel, previewClass);
    }
  }

  // ===== TIER 3: COLOR PALETTE =====
  function initTier3Palette() {
    // Palette family selection
    const paletteOptions = document.querySelectorAll('[data-tier="3"] .palette-family');
    const variantToggles = document.querySelectorAll('[data-tier="3"] .variant-toggle');
    
    paletteOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        paletteOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.palette = option.dataset.palette;
        
        // Update current selection display
        const paletteLabel = option.querySelector('.palette-label').textContent;
        const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
        const effective = getEffectivePalette();
        const displayLabel = ModularState.palette === 'auto'
          ? `Auto (${effective.charAt(0).toUpperCase() + effective.slice(1)}) ${variantLabel}`
          : `${paletteLabel} ${variantLabel}`;
        const previewClass = ModularState.palette === 'auto'
          ? `${effective}-preview`
          : `${ModularState.palette}-preview`;
        updateTierCurrentSelection('3', displayLabel, previewClass);
        
        // Update preview
        updatePreview();
        
      });
    });
    
    // Variant toggle (Light/Dark)
    variantToggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        // Update selection state
        variantToggles.forEach(t => t.classList.remove('selected'));
        toggle.classList.add('selected');
        
        // Update modular state
        ModularState.paletteVariant = toggle.dataset.variant;
        
        // Update current selection display
        const selectedPalette = document.querySelector('[data-tier="3"] .palette-family.selected');
        if (selectedPalette) {
          const paletteLabel = selectedPalette.querySelector('.palette-label').textContent;
          const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
          const previewClass = `${ModularState.palette}-preview`;
          updateTierCurrentSelection('3', `${paletteLabel} ${variantLabel}`, previewClass);
        }
        
        // Update preview
        updatePreview();
        
      });
    });
    
    // Set default selections
    const defaultPalette = document.querySelector(`[data-tier="3"] [data-palette="${ModularState.palette}"]`);
    const defaultVariant = document.querySelector(`[data-tier="3"] [data-variant="${ModularState.paletteVariant}"]`);
    
    if (defaultPalette) defaultPalette.classList.add('selected');
    if (defaultVariant) defaultVariant.classList.add('selected');
    
    // Text Color selection
    const textColorOptions = document.querySelectorAll('[data-tier="3"] .text-color-option');
    
    textColorOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        textColorOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.textColor = option.dataset.textColor;
        
        // Update current selection display
        const selectedPalette = document.querySelector('[data-tier="3"] .palette-family.selected');
        if (selectedPalette) {
          const paletteLabel = selectedPalette.querySelector('.palette-label').textContent;
          const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
          const textLabel = ModularState.textColor.charAt(0).toUpperCase() + ModularState.textColor.slice(1);
          const previewClass = `${ModularState.palette}-preview`;
          updateTierCurrentSelection('3', `${paletteLabel} ${variantLabel} ${textLabel}`, previewClass);
        }
        
        // Update preview
        updatePreview();
        
      });
    });
    
    // Set default text color selection
    const defaultTextColor = document.querySelector(`[data-tier="3"] [data-text-color="${ModularState.textColor}"]`);
    if (defaultTextColor) defaultTextColor.classList.add('selected');
    
    // Initialize current selection display with default values
    if (defaultPalette) {
      const paletteLabel = defaultPalette.querySelector('.palette-label').textContent;
      const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
      const textLabel = ModularState.textColor.charAt(0).toUpperCase() + ModularState.textColor.slice(1);
      const previewClass = `${ModularState.palette}-preview`;
      updateTierCurrentSelection('3', `${paletteLabel} ${variantLabel} ${textLabel}`, previewClass);
    }
  }

  // ===== AUTO-PALETTE RESOLUTION =====
  let _resolvedAutoPalette = 'neon'; // cache for the resolved palette when Auto is active

  function resolveAutoPalette(avatarUrl) {
    if (!avatarUrl) return 'neon';

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = function () {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const size = 50;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let rTotal = 0, gTotal = 0, bTotal = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          rTotal += data[i];
          gTotal += data[i + 1];
          bTotal += data[i + 2];
          count++;
        }

        const r = rTotal / count;
        const g = gTotal / count;
        const b = bTotal / count;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        const lightness = (max + min) / 2;
        const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * (lightness / 255) - 1)) / 255;

        let hue = 0;
        if (delta !== 0) {
          if (max === r) hue = ((g - b) / delta) % 6;
          else if (max === g) hue = (b - r) / delta + 2;
          else hue = (r - g) / delta + 4;
          hue = Math.round(hue * 60);
          if (hue < 0) hue += 360;
        }

        let matched;
        if (saturation < 0.15) {
          matched = lightness > 160 ? 'corporate' : 'monochrome';
        } else if (hue >= 0 && hue < 30) matched = 'inferno';
        else if (hue >= 30 && hue < 60) matched = 'sunset';
        else if (hue >= 60 && hue < 150) matched = 'earth';
        else if (hue >= 150 && hue < 200) matched = 'ocean';
        else if (hue >= 200 && hue < 250) matched = 'frost';
        else if (hue >= 250 && hue < 290) matched = 'arcane';
        else if (hue >= 290 && hue < 330) matched = 'royal';
        else matched = 'neon';

        if (_resolvedAutoPalette !== matched) {
          _resolvedAutoPalette = matched;
          if (ModularState.palette === 'auto') {
            applyResolvedPalette();
          }
        }
      } catch (e) {
        console.warn('⚠️ Auto-palette: could not sample image (CORS?), falling back to neon');
        _resolvedAutoPalette = 'neon';
      }
    };

    img.onerror = function () {
      _resolvedAutoPalette = 'neon';
    };

    img.src = avatarUrl;
    return _resolvedAutoPalette;
  }

  function getEffectivePalette() {
    return ModularState.palette === 'auto' ? _resolvedAutoPalette : ModularState.palette;
  }

  function applyResolvedPalette() {
    const front = document.querySelector('.card-preview-zone .card-front');
    const back = document.querySelector('.card-preview-zone .card-back');
    if (!front || !back) return;

    const palettes = ['neon', 'earth', 'ocean', 'sunset', 'monochrome', 'corporate', 'royal', 'inferno', 'frost', 'arcane'];
    palettes.forEach(p => {
      front.classList.remove(`palette-${p}`);
      back.classList.remove(`palette-${p}`);
    });
    front.classList.remove('palette-auto');
    back.classList.remove('palette-auto');

    const resolved = getEffectivePalette();
    front.classList.add(`palette-${resolved}`);
    back.classList.add(`palette-${resolved}`);
    front.setAttribute('data-palette', resolved);
    back.setAttribute('data-palette', resolved);

  }

  // ===== PREVIEW UPDATE SYSTEM =====
  function updatePreview() {

    // Any preview update means the card changed — mark dirty
    if (window.CardForgeChrome) window.CardForgeChrome.markDirty();
    
    const front = document.querySelector('.card-preview-zone .card-front');
    const back = document.querySelector('.card-preview-zone .card-back');
    
    if (!front || !back) {
      console.warn('⚠️ Card preview elements not found');
      return;
    }
    
    // Resolve auto-palette if active
    const effectivePalette = getEffectivePalette();
    if (ModularState.palette === 'auto') {
      const avatarUrl = document.getElementById('card-avatar')?.value || '';
      if (avatarUrl) resolveAutoPalette(avatarUrl);
    }

    // Shared classes — palette, container, effects (apply to both faces)
    const sharedClasses = [
      `palette-${effectivePalette}`,
      `variant-${ModularState.paletteVariant}`,
      `text-${ModularState.textColor}`,
      `container-${ModularState.imageContainer}`,
      `container-variant-${ModularState.imageContainerVariant}`,
      `effect-${ModularState.imageEffect}`,
      `effect-variant-${ModularState.imageEffectVariant}`
    ];
    
    // Front-only classes — alignment, weight, style (these resize elements)
    const frontOnlyClasses = [
      `align-${ModularState.horizontalAlignment}`,
      `align-vertical-${ModularState.verticalAlignment}`,
      `align-style-${ModularState.alignmentStyle}`
    ];
    
    // Get class and rarity style selections
    const classStyleSelector = document.getElementById('class-style');
    const rarityStyleSelector = document.getElementById('rarity-style');
    const cardRarityInput = document.getElementById('card-rarity');
    
    const classStyle = classStyleSelector ? classStyleSelector.value : 'default';
    const rarityStyle = rarityStyleSelector ? rarityStyleSelector.value : 'default';
    const rarityValue = cardRarityInput ? cardRarityInput.value : '';
    
    // Add class and rarity style classes to shared classes
    if (classStyle !== 'default') {
      sharedClasses.push(`class-style-${classStyle}`);
    }
    if (rarityStyle !== 'default') {
      sharedClasses.push(`rarity-style-${rarityStyle}`);
    }
    
    // Card Effects (from Card Design tab dropdowns)
    const bgEffect = document.getElementById('card-bg-effect');
    const borderEffect = document.getElementById('card-border-effect');
    const glowEffect = document.getElementById('card-glow-effect');
    
    if (bgEffect && bgEffect.value !== 'none') {
      sharedClasses.push(`rarity-style-${bgEffect.value}`);
    }
    if (borderEffect) {
      if (borderEffect.value !== 'none') {
        sharedClasses.push(`rarity-style-${borderEffect.value}`);
      } else {
        sharedClasses.push('border-effect-none');
      }
    }
    if (glowEffect && glowEffect.value !== 'none') {
      sharedClasses.push(`rarity-style-${glowEffect.value}`);
    }
    
    // Typography — apply font-family class
    const fontSelect = document.getElementById('card-font-family');
    if (fontSelect && fontSelect.value !== 'inter') {
      sharedClasses.push(`card-font-${fontSelect.value}`);
    }
    
    // Apply classes: front gets alignment + shared; back gets shared only
    front.className = `card-preview-canvas card-front ${frontOnlyClasses.join(' ')} ${sharedClasses.join(' ')}`;
    back.className = `card-preview-canvas card-back ${sharedClasses.join(' ')}`;
    
    // Set data attributes for advanced styling
    const dataAttributes = {
      // 'data-layout': ModularState.layout, REMOVED - Phase 1 of Flow Restructure
      'data-alignment-type': ModularState.horizontalAlignment,
      'data-alignment-style': ModularState.alignmentStyle,
      'data-palette': effectivePalette,
      'data-palette-variant': ModularState.paletteVariant,
      'data-image-container': ModularState.imageContainer,
      'data-image-container-variant': ModularState.imageContainerVariant,
      'data-image-effect': ModularState.imageEffect,
      'data-image-effect-variant': ModularState.imageEffectVariant,
      'data-rarity': rarityValue.toLowerCase()
    };
    
    Object.entries(dataAttributes).forEach(([attr, value]) => {
      front.setAttribute(attr, value);
      back.setAttribute(attr, value);
    });
    
    // Update card content
    updateCardContent();
    
    // Combine fullbleed variant filters with image effect filters
    applyCombinedFilters();
    
  }

  // ===== COMBINED FILTER MERGE =====
  // Fullbleed variants and image effects both use CSS `filter` on .card-avatar.
  // CSS can't merge filter from separate rules, so when both are active we
  // combine them into a single inline style.
  function applyCombinedFilters() {
    const avatars = document.querySelectorAll('.card-preview-zone .card-avatar');
    if (!avatars.length) return;

    const fullbleedFilters = {
      'dimmed':  'brightness(0.7) contrast(1.1)',
      'blurred': 'blur(3px) brightness(0.8)'
    };

    const effectFilters = {
      'sepia':          'sepia(80%) saturate(1.2) brightness(1.1)',
      'grayscale':      'grayscale(100%) contrast(1.1) brightness(1.05)',
      'vintage':        'sepia(60%) contrast(1.2) brightness(0.9) saturate(1.4) hue-rotate(15deg)',
      'noir':           'grayscale(100%) contrast(1.3) brightness(0.8)',
      'warm':           'sepia(30%) saturate(1.3) brightness(1.1) hue-rotate(10deg)',
      'cool':           'saturate(1.2) brightness(1.05) hue-rotate(-10deg) contrast(1.1)',
      'cyberpunk':      'saturate(1.8) contrast(1.3) brightness(1.1) hue-rotate(280deg)',
      'faded':          'saturate(0.5) contrast(0.85) brightness(1.15) sepia(15%)',
      'high-contrast':  'contrast(1.6) brightness(1.05) saturate(1.1)',
      'duotone':        'grayscale(80%) sepia(60%) saturate(1.6) hue-rotate(180deg) brightness(0.95)',
      'vignette':       'contrast(1.1) brightness(0.92) saturate(1.1)',
      'bleach-bypass':  'grayscale(40%) contrast(1.4) brightness(0.95) saturate(0.7)',
      'cross-process':  'sepia(20%) saturate(1.6) hue-rotate(40deg) contrast(1.15) brightness(1.05)',
      'infrared':       'sepia(40%) saturate(2) hue-rotate(330deg) contrast(1.2) brightness(1.05)',
      'midnight':       'sepia(30%) saturate(1.4) hue-rotate(200deg) brightness(0.85) contrast(1.15)',
      'emerald':        'sepia(25%) saturate(1.5) hue-rotate(90deg) brightness(1.0) contrast(1.1)',
      'sunset':         'sepia(50%) saturate(1.6) hue-rotate(350deg) brightness(1.1) contrast(1.05)',
      'color-wash':     'sepia(0.4) saturate(1.8) hue-rotate(160deg)',
      'gradient-fade':  'brightness(0.6) contrast(1.15) saturate(1.1)',
      'spotlight':      'contrast(1.3) brightness(1.1) saturate(1.2)',
      'haze':           'brightness(1.15) contrast(0.8) saturate(0.75) blur(0.5px)'
    };

    const containerFilter = (ModularState.imageContainer === 'fullbleed')
      ? fullbleedFilters[ModularState.imageContainerVariant] || null
      : null;

    const effectFilter = (ModularState.imageEffect === 'filters' || ModularState.imageEffect === 'overlays')
      ? effectFilters[ModularState.imageEffectVariant] || null
      : null;

    avatars.forEach(avatar => {
      if (containerFilter && effectFilter) {
        avatar.style.filter = `${containerFilter} ${effectFilter}`;
      } else {
        avatar.style.removeProperty('filter');
      }
    });
  }

  // ===== CARD CONTENT UPDATE =====
  function updateCardContent() {
    // Collect all data first
    const combatStatsData = collectCombatStatsData();
    const customStatsData = collectStatsData();
    const badgesData = collectBadgesData();
    const attributesData = collectAttributesData();

    // Build combined stats array: combat stats (with fixed names) + custom stats
    const combatStatsArray = COMBAT_STAT_DEFS.map(def => ({
      name: def.label,
      value: combatStatsData[def.key] || COMBAT_DEFAULT_VALUE
    }));
    const allStats = combatStatsArray.concat(customStatsData);

    // Collect biography separately
    const biographyField = document.getElementById('card-bio');
    const biography = biographyField?.value?.trim() || '';

    // Build complete card data object
    const cardData = {
      name: document.getElementById('card-name')?.value || 'Aria Shadowbane',
      characterClass: document.getElementById('card-class')?.value || '',
      characterSubclass: document.getElementById('card-subclass')?.value || '',
      rarity: document.getElementById('card-rarity')?.value || '',
      quote: document.getElementById('card-quote')?.value || 'Shadows are my allies, silence my weapon.',
      avatar: document.getElementById('card-avatar')?.value || '',
      biography: biography,
      combatStats: combatStatsData,
      stats: allStats,
      badges: badgesData,
      attributes: attributesData
    };
    
    
    // Store the preview JSON data globally for save function to use
    window.lastPreviewCardData = cardData;
    
    // Update front face
    updateFrontFace(cardData);
    
    // Update back face
    updateBackFace(cardData);
    
    // Apply class and rarity styles to card elements
    applyClassAndRarityStyles();
    
    // Trigger stat bar animations only when structural change occurred;
    // otherwise snap bars to target instantly (avoids flicker on name edits).
    if (_statAnimationNeeded) {
      _statAnimationNeeded = false;
      // rAF ensures innerHTML is committed before animation queries bars
      requestAnimationFrame(() => { animateStatBars(); });
    } else {
      // Snap synchronously — innerHTML is already committed, no need to defer.
      // This avoids a visible 0-width frame between innerHTML and the snap.
      snapStatBars();
    }
  }
  
  // ===== CLASS AND RARITY STYLING =====
  function applyClassAndRarityStyles() {
    // Get form input values to check if sections should be displayed
    const classInput = document.getElementById('card-class');
    const rarityInput = document.getElementById('card-rarity');
    
    const classValue = classInput ? classInput.value.trim() : '';
    const rarityValue = rarityInput ? rarityInput.value.trim() : '';
    
    // Get style selections
    const classStyleSelector = document.getElementById('class-style');
    const rarityStyleSelector = document.getElementById('rarity-style');
    
    const classStyle = classStyleSelector ? classStyleSelector.value : 'default';
    const rarityStyle = rarityStyleSelector ? rarityStyleSelector.value : 'default';
    
    // Get icon settings
    const classIconValue = document.getElementById('class-icon-value');
    const rarityIconValue = document.getElementById('rarity-icon-value');
    
    const classIcon = classIconValue ? classIconValue.value : 'none';
    const rarityIcon = rarityIconValue ? rarityIconValue.value : 'none';
    
    // Apply class styling to all .card-class elements
    const classElements = document.querySelectorAll('.card-class');
    classElements.forEach(element => {
      // Hide element if class value is empty
      if (!classValue) {
        element.style.display = 'none';
        return;
      }
      
      // Show element if class value exists
      element.style.display = '';
      
      // Remove existing class style classes
      element.classList.remove('class-style-default', 'class-style-badge', 'class-style-banner', 
                                'class-style-outlined', 'class-style-glow', 'class-has-icon',
                                'class-style-underline', 'class-style-gradient', 'class-style-stamped');
      
      // Add new class style
      if (classStyle !== 'default') {
        element.classList.add(`class-style-${classStyle}`);
      }
      
      // Handle class icon (only when icon is not 'none')
      if (classIcon !== 'none') {
        element.classList.add('class-has-icon');
        element.setAttribute('data-class-icon', classIcon);
        
        // Add icon to element if it doesn't exist
        let iconElement = element.querySelector('.class-icon');
        if (!iconElement) {
          iconElement = document.createElement('i');
          iconElement.className = 'class-icon';
          element.insertBefore(iconElement, element.firstChild);
        }
        iconElement.className = `class-icon fas fa-${classIcon}`;
      } else {
        element.classList.remove('class-has-icon');
        element.removeAttribute('data-class-icon');
        const iconElement = element.querySelector('.class-icon');
        if (iconElement) {
          iconElement.remove();
        }
      }
    });
    
    // Apply rarity styling to all .card-rarity elements
    const rarityElements = document.querySelectorAll('.card-rarity');
    rarityElements.forEach(element => {
      // Hide element if rarity value is empty
      if (!rarityValue) {
        element.style.display = 'none';
        return;
      }
      
      // Hide inline rarity text when Corner Badge is active (badge shows it in the corner instead)
      if (rarityStyle === 'badge') {
        element.style.display = 'none';
        return;
      }
      
      // Show element if rarity value exists
      element.style.display = '';
      
      // Remove existing rarity style classes
      element.classList.remove('rarity-style-default', 'rarity-style-badge', 'rarity-style-border',
                                'rarity-style-glow', 'rarity-style-foil', 'rarity-style-frame', 'rarity-has-icon',
                                'rarity-style-inline-badge', 'rarity-style-outlined', 'rarity-style-underline',
                                'rarity-style-gradient', 'rarity-style-stamped', 'rarity-style-ribbon');
      
      // Add new rarity style
      if (rarityStyle !== 'default') {
        element.classList.add(`rarity-style-${rarityStyle}`);
      }
      
      // Handle rarity icon (only when icon is not 'none')
      if (rarityIcon !== 'none') {
        element.classList.add('rarity-has-icon');
        element.setAttribute('data-rarity-icon', rarityIcon);
        
        // Add icon to element if it doesn't exist
        let iconElement = element.querySelector('.rarity-icon');
        if (!iconElement) {
          iconElement = document.createElement('i');
          iconElement.className = 'rarity-icon';
          element.insertBefore(iconElement, element.firstChild);
        }
        iconElement.className = `rarity-icon fas fa-${rarityIcon}`;
      } else {
        element.classList.remove('rarity-has-icon');
        element.removeAttribute('data-rarity-icon');
        const iconElement = element.querySelector('.rarity-icon');
        if (iconElement) {
          iconElement.remove();
        }
      }
    });
    
    // Handle rarity badge DOM element (not ::after, to avoid conflict with foil/frame)
    const cardFaces = document.querySelectorAll('.card-preview-zone .card-preview-canvas.card-front, .card-preview-zone .card-preview-canvas.card-back');
    cardFaces.forEach(face => {
      const existingBadge = face.querySelector('.rarity-badge');
      if (rarityStyle === 'badge' && rarityValue) {
        // Build badge content: icon + text
        let badgeHTML = '';
        if (rarityIcon !== 'none') {
          badgeHTML += `<i class="fas fa-${rarityIcon}" style="margin-right:0.3em"></i>`;
        }
        badgeHTML += rarityValue;
        
        if (!existingBadge) {
          const badge = document.createElement('span');
          badge.className = 'rarity-badge';
          badge.innerHTML = badgeHTML;
          face.appendChild(badge);
        } else {
          existingBadge.innerHTML = badgeHTML;
        }
      } else if (existingBadge) {
        existingBadge.remove();
      }
    });
    
  }
  
  // ===== ICON PICKER SYSTEM =====
  function initIconPickers() {
    // Handle class icon selection
    const classIconOptions = document.querySelectorAll('#class-section .icon-picker .icon-option');
    classIconOptions.forEach(option => {
      option.addEventListener('click', function() {
        // Remove selected class from all options
        classIconOptions.forEach(opt => opt.classList.remove('selected'));
        // Add selected class to clicked option
        this.classList.add('selected');
        // Update hidden input
        const iconValue = document.getElementById('class-icon-value');
        if (iconValue) {
          iconValue.value = this.dataset.icon;
        }
        updatePreview();
      });
    });
    
    // Handle rarity icon selection
    const rarityIconOptions = document.querySelectorAll('#rarity-section .icon-picker .icon-option');
    rarityIconOptions.forEach(option => {
      option.addEventListener('click', function() {
        // Remove selected class from all options
        rarityIconOptions.forEach(opt => opt.classList.remove('selected'));
        // Add selected class to clicked option
        this.classList.add('selected');
        // Update hidden input
        const iconValue = document.getElementById('rarity-icon-value');
        if (iconValue) {
          iconValue.value = this.dataset.icon;
        }
        updatePreview();
      });
    });
  }
  
  
  // ===== DATA COLLECTION HELPERS =====
  function collectStatsData() {
    const statsContainer = document.getElementById('stats-editor');
    const stats = [];
    
    if (statsContainer) {
      const statRows = statsContainer.querySelectorAll('.stat-row');
      statRows.forEach(row => {
        const nameInput = row.querySelector('input[name="stat-name"]');
        const valueInput = row.querySelector('input[name="stat-value"]');
        
        if (nameInput && valueInput && nameInput.value.trim()) {
          stats.push({
            name: nameInput.value.trim(),
            value: parseInt(valueInput.value) || 0
          });
        }
      });
    }
    
    return stats;
  }
  
  function collectBadgesData() {
    const badgesContainer = document.getElementById('micro-editor');
    const badges = [];

    if (badgesContainer) {
      const badgeRows = badgesContainer.querySelectorAll('.micro-row');
      badgeRows.forEach(row => {
        // Support both select (new) and input (legacy) for category
        const categoryEl = row.querySelector('select[name="micro-category"]') || row.querySelector('input[name="micro-category"]');
        const iconInput = row.querySelector('input[name="micro-icon"]');
        const descInput = row.querySelector('input[name="micro-desc"]');
        const quantityInput = row.querySelector('input[name="micro-quantity"]');

        if (categoryEl && categoryEl.value.trim()) {
          badges.push({
            category: categoryEl.value.trim(),
            icon: iconInput ? iconInput.value : 'star',
            description: descInput ? descInput.value.trim() : '',
            quantity: parseInt(quantityInput?.value) || 1
          });
        }
      });
    }

    return badges;
  }
  
  function collectAttributesData() {
    const attributesContainer = document.getElementById('attribute-editor');
    const attributes = [];
    
    // Biography is now collected separately in updateCardContent()
    // No longer adding it as a regular attribute
    
    // Collect dynamic custom attributes
    if (attributesContainer) {
      const attributeRows = attributesContainer.querySelectorAll('.attribute-row');
      attributeRows.forEach(row => {
        const nameInput = row.querySelector('input[name="attribute-name"]');
        const valueInput = row.querySelector('input[name="attribute-value"]');
        
        if (nameInput && valueInput && nameInput.value.trim()) {
          attributes.push({
            name: nameInput.value.trim(),
            value: valueInput.value.trim()
          });
        }
      });
    }
    
    return attributes;
  }

  // Flag: when true, next updatePreview triggers full bar animation.
  // When false, bars snap to target without animation (e.g. name-only edits).
  let _statAnimationNeeded = true;

  // Animation version counter — incremented on every animate/snap request.
  // Stale callbacks compare their captured version and bail if superseded.
  let _statsAnimVersion = 0;

  // Active per-bar timer IDs (keyed by bar element via WeakMap).
  const _barTimers = new WeakMap();

  // Read sanitized target percentage from a bar's data-target attribute.
  function _barTarget(bar) {
    const raw = Number(bar.dataset.target);
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  }

  // Cancel any pending animation timer on a bar.
  function _cancelBarTimer(bar) {
    const id = _barTimers.get(bar);
    if (id != null) { clearTimeout(id); _barTimers.delete(bar); }
  }

  // Snap all stat bars to their data-target width instantly (no animation).
  function snapStatBars() {
    const ver = ++_statsAnimVersion;
    const bars = document.querySelectorAll('.stat-progress');
    bars.forEach(bar => {
      _cancelBarTimer(bar);
      if (!bar.isConnected) return;
      bar.style.transition = 'none';
      bar.style.width = _barTarget(bar) + '%';
    });
  }

  // ===== SINGLE BAR ANIMATION (rAF + forced reflow, race-safe) =====
  function animateBar(bar, delayMs, ver) {
    _cancelBarTimer(bar);
    if (!bar.isConnected || ver !== _statsAnimVersion) return;
    const targetPct = _barTarget(bar);
    bar.style.transition = 'none';
    bar.style.width = '0%';
    void bar.offsetWidth; // force reflow
    requestAnimationFrame(() => {
      if (!bar.isConnected || ver !== _statsAnimVersion) {
        // Superseded — snap any connected bars to target as fallback
        if (bar.isConnected) { bar.style.transition = 'none'; bar.style.width = targetPct + '%'; }
        return;
      }
      requestAnimationFrame(() => {
        if (!bar.isConnected || ver !== _statsAnimVersion) {
          if (bar.isConnected) { bar.style.transition = 'none'; bar.style.width = targetPct + '%'; }
          return;
        }
        bar.style.transition = 'width 450ms ease';
        const tid = setTimeout(() => {
          _barTimers.delete(bar);
          if (!bar.isConnected || ver !== _statsAnimVersion) return;
          bar.style.width = targetPct + '%';
        }, delayMs);
        _barTimers.set(bar, tid);
      });
    });
  }

  // ===== RESTART STAT BAR ANIMATIONS (called after roll/preset) =====
  function restartStatBarAnimations() {
    const ver = ++_statsAnimVersion;
    const bars = document.querySelectorAll('.card-preview-zone .stat-progress');
    bars.forEach((bar, i) => animateBar(bar, i * 120, ver));
  }

  // ===== ANIMATED STAT BARS =====
  function animateStatBars() {
    const ver = ++_statsAnimVersion;
    const statBars = document.querySelectorAll('.stat-progress');
    statBars.forEach((bar, i) => animateBar(bar, i * 120, ver));
  }

  // ===== FRONT FACE UPDATE =====
  function updateFrontFace(data) {
    const front = document.querySelector('.card-preview-zone .card-front');
    if (!front) return;
    
    // Generate layout-specific HTML based on modular state
    let frontHTML = '';
    
    switch (ModularState.layout) {
      case 'hero':
        frontHTML = generateHeroLayout(data);
        break;
      case 'split':
        frontHTML = generateSplitLayout(data);
        break;
      case 'minimal':
        frontHTML = generateMinimalLayout(data);
        break;
      case 'overlay':
        frontHTML = generateOverlayLayout(data);
        break;
      case 'stack':
        frontHTML = generateStackLayout(data);
        break;
      case 'frame':
        frontHTML = generateFrameLayout(data);
        break;
      default:
        frontHTML = generateHeroLayout(data);
    }
    
    front.innerHTML = frontHTML;
  }

  // ===== DYNAMIC HTML GENERATORS =====
  function generateStatsHTML(stats) {
    if (!stats || stats.length === 0) {
      return '<div class="no-stats">No stats available</div>';
    }

    // Separate combat stats from custom stats
    const combatNames = COMBAT_STAT_DEFS.map(d => d.label.toLowerCase());
    const combatStats = [];
    const customStats = [];

    stats.forEach(stat => {
      const nameLower = (stat.name || '').toLowerCase().trim();
      const combatDef = COMBAT_STAT_DEFS.find(d => d.label.toLowerCase() === nameLower);
      if (combatDef) {
        combatStats.push({ ...stat, icon: combatDef.icon, color: combatDef.color });
      } else {
        customStats.push(stat);
      }
    });

    let html = '';

    // Render combat stats first (all 5, with icons)
    if (combatStats.length > 0) {
      html += combatStats.map(stat => {
        const raw = Number(stat.value);
        const v = Number.isFinite(raw) ? raw : 0;
        const percentage = Math.max(0, Math.min(100, v));
        return `
          <div class="stat-item stat-item--combat">
            <div class="stat-label"><i class="fas ${stat.icon}" style="color:${stat.color};margin-right:4px"></i>${stat.name} <span class="stat-value">${Math.round(v)}</span></div>
            <div class="stat-bar">
              <div class="stat-progress" data-target="${percentage}" style="width:0%"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render custom stats with separator
    if (customStats.length > 0) {
      if (combatStats.length > 0) {
        html += '<div class="stats-separator"><span>Custom</span></div>';
      }
      const visible = customStats.slice(0, CUSTOM_STAT_CAP);
      const overflow = customStats.length - CUSTOM_STAT_CAP;

      html += visible.map(stat => {
        const raw = Number(stat.value);
        const v = Number.isFinite(raw) ? raw : 0;
        const percentage = Math.max(0, Math.min(100, v));
        return `
          <div class="stat-item">
            <div class="stat-label">${stat.name} <span class="stat-value">${Math.round(v)}</span></div>
            <div class="stat-bar">
              <div class="stat-progress" data-target="${percentage}" style="width:0%"></div>
            </div>
          </div>
        `;
      }).join('');

      if (overflow > 0) {
        html += `<div class="stats-overflow-indicator">+${overflow} more</div>`;
      }
    }

    return html;
  }
  
  function generateBadgesHTML(badges) {
    if (!badges || badges.length === 0) {
      return '<div class="no-badges">No buffs assigned</div>';
    }

    // Build icon map from unified BUFF_DEFS + fallback for legacy values
    const iconMap = {
      star: 'fas fa-star', trophy: 'fas fa-trophy', medal: 'fas fa-medal',
      crown: 'fas fa-crown', shield: 'fas fa-shield-alt', gem: 'fas fa-gem',
      fire: 'fas fa-fire', heart: 'fas fa-heart', bolt: 'fas fa-bolt',
      bullseye: 'fas fa-bullseye', target: 'fas fa-bullseye', book: 'fas fa-book'
    };

    const visible = badges.slice(0, BADGE_CAP_MAX);
    const overflow = badges.length - BADGE_CAP_MAX;
    
    let html = visible.map(badge => {
      const iconClass = iconMap[badge.icon] || 'fas fa-award';
      const quantity = badge.quantity || 1;

      // Resolve display label from unified BUFF_DEFS (category may be a key like 'fury')
      const defs = getBuffDefs();
      const def = defs.find(d => d.key === badge.category.toLowerCase());
      const displayLabel = def ? def.label : (badge.category.charAt(0).toUpperCase() + badge.category.slice(1));

      return `
        <div class="badge-item" title="${badge.description || displayLabel}">
          <div class="badge-icon">
            <i class="${iconClass}"></i>${quantity > 1 ? `<span class="badge-qty-multiplier">&times;${quantity}</span>` : ''}
          </div>
          <div class="badge-label">${displayLabel}</div>
        </div>
      `;
    }).join('');

    if (overflow > 0) {
      html += `<div class="badges-overflow-indicator">+${overflow} more</div>`;
    }

    return html;
  }
  
  // ===== GAME STATS (Battle Record) =====
  // Fetched from arena profile, rendered read-only on card back
  function loadArenaStats() {
    if (!window.ArenaAPI || !window.ArenaAPI.getPrincipalHeader) return Promise.resolve(null);
    return window.ArenaAPI.getPrincipalHeader().then(function (headers) {
      if (!headers['X-CF-Auth-Principal']) return null;
      var url = window.buildApiPath('arenaProfile');
      if (!url) return null;
      return fetch(url, { headers: Object.assign({ 'Content-Type': 'application/json' }, headers) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }).then(function (data) {
      // API returns { profile: { ... }, isDemo }, unwrap to inner profile
      var profile = (data && data.profile) ? data.profile : null;
      // Skip demo profiles — only show real arena records
      if (data && data.isDemo) profile = null;
      window._arenaProfile = profile;
      return profile;
    }).catch(function () {
      window._arenaProfile = null;
      return null;
    });
  }

  // Rank thresholds for XP bar (mirrors arena-results.js)
  const RANK_THRESHOLDS = {
    bronze:   { xpRequired: 0,    icon: 'fa-shield-halved', color: '#CD7F32', label: 'Bronze' },
    silver:   { xpRequired: 500,  icon: 'fa-shield',        color: '#C0C0C0', label: 'Silver' },
    gold:     { xpRequired: 1500, icon: 'fa-crown',         color: '#FFD700', label: 'Gold' },
    platinum: { xpRequired: 3500, icon: 'fa-gem',           color: '#E5E4E2', label: 'Platinum' },
    diamond:  { xpRequired: 7000, icon: 'fa-diamond',       color: '#B9F2FF', label: 'Diamond' }
  };
  const RANK_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

  function generateArenaRecordHTML(profile) {
    if (!profile || !profile.record) return '';
    var w = profile.record.wins || 0;
    var l = profile.record.losses || 0;
    var rankKey = (profile.rank || 'bronze').toLowerCase();
    var rankInfo = RANK_THRESHOLDS[rankKey] || RANK_THRESHOLDS.bronze;
    var lvl = profile.level || 1;
    var xp = profile.xp || 0;

    // XP progress toward next rank
    var rankIdx = RANK_ORDER.indexOf(rankKey);
    var nextRankKey = rankIdx < RANK_ORDER.length - 1 ? RANK_ORDER[rankIdx + 1] : null;
    var nextXp = nextRankKey ? RANK_THRESHOLDS[nextRankKey].xpRequired : null;
    var rankXp = rankInfo.xpRequired;
    var progressPct = 100;
    var xpLabel = `${xp} XP (Max Rank)`;
    if (nextXp) {
      progressPct = Math.min(100, Math.round(((xp - rankXp) / (nextXp - rankXp)) * 100));
      xpLabel = `${xp} / ${nextXp} XP`;
    }

    return `
      <div class="back-section arena-record-section">
        <h4 class="section-title">Arena Record</h4>
        <div class="arena-record-grid">
          <div class="arena-record-stat">
            <i class="fas ${rankInfo.icon} arena-record-stat__icon" style="color:${rankInfo.color}"></i>
            <span class="arena-record-stat__value">${rankInfo.label}</span>
            <span class="arena-record-stat__label">Rank</span>
          </div>
          <div class="arena-record-stat">
            <i class="fas fa-swords arena-record-stat__icon"></i>
            <span class="arena-record-stat__value">${w}W / ${l}L</span>
            <span class="arena-record-stat__label">Record</span>
          </div>
          <div class="arena-record-stat">
            <i class="fas fa-arrow-up arena-record-stat__icon"></i>
            <span class="arena-record-stat__value">Lv.${lvl}</span>
            <span class="arena-record-stat__label">Level</span>
          </div>
          <div class="arena-record-stat">
            <i class="fas fa-star arena-record-stat__icon"></i>
            <span class="arena-record-stat__value">${xp}</span>
            <span class="arena-record-stat__label">XP</span>
          </div>
        </div>
        <div class="arena-xp-bar">
          <div class="arena-xp-bar__fill" style="width:${progressPct}%"></div>
        </div>
        <div class="arena-xp-bar__label">${xpLabel}</div>
      </div>`;
  }

  // Attribute names already covered by the arena stats bar (Rank/Lv/W-L/XP)
  const ARENA_OVERLAP_NAMES = ['level', 'experience', 'xp', 'rank', 'wins', 'losses', 'win', 'loss', 'record'];

  function generateAttributesHTML(attributes) {
    if (!attributes || attributes.length === 0) {
      return '<div class="no-attributes">No attributes available</div>';
    }

    // Strip attributes that duplicate arena stats
    const filtered = attributes.filter(a => !ARENA_OVERLAP_NAMES.includes(a.name.toLowerCase()));
    if (filtered.length === 0) {
      return '<div class="no-attributes">No attributes available</div>';
    }

    const visible = filtered.slice(0, ATTRIBUTE_CAP_MAX);
    const overflow = filtered.length - ATTRIBUTE_CAP_MAX;
    
    let html = visible.map(attr => {
      return `
        <div class="attribute-item">
          <span class="attribute-key">${attr.name}</span>
          <span class="attribute-value">${attr.value}</span>
        </div>
      `;
    }).join('');

    if (overflow > 0) {
      html += `<div class="attributes-overflow-indicator">+${overflow} more</div>`;
    }

    return html;
  }

  // ===== LAYOUT GENERATORS =====
  function generateHeroLayout(data) {
    return `
      <div class="card-hero-header">
        <div class="hero-image-container">
          <div class="card-avatar-container">
            <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
          </div>
          <div class="hero-overlay">
            <h3 class="card-name">${data.name}</h3>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-class">${data.characterClass}${data.characterSubclass ? ' — ' + data.characterSubclass : ''}</div>
        <div class="card-rarity">${data.rarity}</div>
        <div class="card-quote">"${data.quote}"</div>
        <div class="card-stats">
          ${generateStatsHTML(data.stats)}
        </div>
      </div>
    `;
  }
  function generateSplitLayout(data) {
    return `
      <div class="card-left">
        <div class="card-avatar-container">
          <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
        </div>
      </div>
      <div class="card-right">
        <div class="card-header">
          <h3 class="card-name">${data.name}</h3>
          <div class="card-class">${data.characterClass}${data.characterSubclass ? ' — ' + data.characterSubclass : ''}</div>
        </div>
        <div class="card-body">
          <div class="card-rarity">${data.rarity}</div>
          <div class="card-quote">"${data.quote}"</div>
          <div class="card-stats">
            ${generateStatsHTML(data.stats)}
          </div>
        </div>
      </div>
    `;
  }

  function generateMinimalLayout(data) {
    return `
      <div class="card-header minimal-header">
        <div class="card-avatar-container">
          <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
        </div>
        <div class="minimal-info">
          <h3 class="card-name">${data.name}</h3>
          <div class="card-class">${data.characterClass}${data.characterSubclass ? ' — ' + data.characterSubclass : ''}</div>
          <div class="card-rarity">${data.rarity}</div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-quote">"${data.quote}"</div>
        <div class="card-stats">
          ${generateStatsHTML(data.stats)}
        </div>
      </div>
    `;
  }

  function generateOverlayLayout(data) {
    return `
      <div class="card-overlay-container">
        <img src="${data.avatar}" alt="${data.name}" class="card-background" />
        <div class="overlay-content">
          <h3 class="card-name">${data.name}</h3>
          <div class="card-class">${data.characterClass}${data.characterSubclass ? ' — ' + data.characterSubclass : ''}</div>
          <div class="card-rarity">${data.rarity}</div>
          <div class="card-quote">"${data.quote}"</div>
          <div class="card-stats">
            ${generateStatsHTML(data.stats)}
          </div>
        </div>
      </div>
    `;
  }

  function generateStackLayout(data) {
    return `
      <div class="card-header">
        <h3 class="card-name">${data.name}</h3>
        <div class="card-class">${data.characterClass}${data.characterSubclass ? ' — ' + data.characterSubclass : ''}</div>
      </div>
      <div class="card-avatar-container">
        <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
      </div>
      <div class="card-body">
        <div class="card-rarity">${data.rarity}</div>
        <div class="card-quote">"${data.quote}"</div>
        <div class="card-stats">
          ${generateStatsHTML(data.stats)}
        </div>
      </div>
    `;
  }

  function generateFrameLayout(data) {
    return `
      <div class="card-frame">
        <div class="frame-border">
          <div class="card-avatar-container">
            <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
          </div>
          <div class="frame-content">
            <h3 class="card-name">${data.name}</h3>
            <div class="card-class">${data.characterClass}${data.characterSubclass ? ' — ' + data.characterSubclass : ''}</div>
            <div class="card-rarity">${data.rarity}</div>
            <div class="card-quote">"${data.quote}"</div>
            <div class="card-stats">
              ${generateStatsHTML(data.stats)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ===== BACK FACE UPDATE =====
  function updateBackFace(data) {
    const back = document.querySelector('.card-preview-zone .card-back');
    if (!back) return;

    const badgeCount = data.badges ? Math.min(data.badges.length, BADGE_CAP_MAX) : 0;
    
    back.innerHTML = `
    <div class="card-back-content">
      <div class="back-header">
        <h3 class="card-name">${data.name}</h3>
        <div class="card-class">${data.characterClass}${data.characterSubclass ? ' — ' + data.characterSubclass : ''}</div>
      </div>
      <div class="back-body">
        ${data.biography ? `
        <div class="biography-section">
          <h4 class="section-title">Biography</h4>
          <div class="biography-text" data-full-bio="${data.biography.replace(/"/g, '&quot;')}">${data.biography}</div>
          <a class="bio-read-more" href="#">Read more &raquo;</a>
        </div>
        ` : ''}

        ${generateArenaRecordHTML(window._arenaProfile)}

        <div class="info-grid">
          <div class="back-section badges-section">
            <h4 class="section-title">Buffs & Traits</h4>
            <div class="badges-container" data-badge-count="${badgeCount}">
              ${generateBadgesHTML(data.badges)}
            </div>
          </div>

          <div class="back-section attributes-section">
            <h4 class="section-title">Attributes</h4>
            <div class="attributes-container">
              ${generateAttributesHTML(data.attributes)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  }

  // ===== OVERFLOW DETECTION — applies condensed mode when faces overflow =====
  function checkCardOverflow() {
    const back = document.querySelector('.card-preview-zone .card-back');
    if (back) {
      const backContent = back.querySelector('.card-back-content');
      if (backContent) {
        back.classList.remove('card-condensed');
        requestAnimationFrame(() => {
          if (backContent.scrollHeight > back.clientHeight) {
            back.classList.add('card-condensed');
          }
        });
      }
    }

    // Front-face overflow: condense first, then truncate stats if still overflowing.
    // Flex layouts (hero, etc.) constrain .card-body via flex-shrink so the
    // front element itself may never overflow — check .card-body too.
    const front = document.querySelector('.card-preview-zone .card-front');
    if (!front) return;

    front.classList.remove('card-condensed');
    // Remove any previous truncation
    const statsContainer = front.querySelector('.card-stats');
    if (statsContainer) {
      statsContainer.querySelectorAll('.stat-item').forEach(el => el.classList.remove('stat-hidden'));
      const existingOverflow = statsContainer.querySelector('.stats-overflow-indicator');
      if (existingOverflow) existingOverflow.remove();
    }

    const cardBody = front.querySelector('.card-body');

    // Helper: true when content overflows the visible card area.
    // Checks both the front face (block layouts) and the card-body
    // (flex layouts where the body absorbs overflow via overflow-y:auto).
    function isOverflowing() {
      if (front.scrollHeight > front.clientHeight + 1) return true;
      if (cardBody && cardBody.scrollHeight > cardBody.clientHeight + 1) return true;
      return false;
    }

    requestAnimationFrame(() => {
      if (!isOverflowing()) return;

      // Step 1: Apply condensed mode
      front.classList.add('card-condensed');

      requestAnimationFrame(() => {
        if (!isOverflowing() || !statsContainer) return;

        // Step 2: Progressively hide stats from bottom until it fits
        const allStats = Array.from(statsContainer.querySelectorAll('.stat-item'));
        const separator = statsContainer.querySelector('.stats-separator');
        let hiddenCount = 0;

        for (let i = allStats.length - 1; i >= 0; i--) {
          if (!isOverflowing()) break;
          allStats[i].classList.add('stat-hidden');
          hiddenCount++;
          // If we hid all custom stats, also hide the separator
          if (separator) {
            const visibleCustom = Array.from(statsContainer.querySelectorAll('.stat-item:not(.stat-item--combat):not(.stat-hidden)'));
            if (visibleCustom.length === 0) separator.classList.add('stat-hidden');
          }
        }

        if (hiddenCount > 0) {
          const indicator = document.createElement('div');
          indicator.className = 'stats-overflow-indicator';
          indicator.textContent = `+${hiddenCount} more`;
          statsContainer.appendChild(indicator);
        }
      });
    });
  }

  // ===== EFFECT TIER LOCK STATE =====
  function applyEffectLockState() {
    if (!window.EffectTiers) return;

    // Map data-target IDs to tier categories
    var targetToCategory = {
      'card-bg-effect': 'bg',
      'card-border-effect': 'border',
      'card-glow-effect': 'glow'
    };

    // 1) Background / Border / Glow chips
    document.querySelectorAll('.effect-chips').forEach(function (chipGroup) {
      var category = targetToCategory[chipGroup.dataset.target];
      if (!category) return; // skip font chips
      chipGroup.querySelectorAll('.effect-chip').forEach(function (chip) {
        var value = chip.dataset.value;
        if (window.EffectTiers.isEffectUnlocked(category, value)) {
          chip.classList.remove('locked');
          chip.removeAttribute('title');
          chip.removeAttribute('data-rank-tier');
        } else {
          chip.classList.add('locked');
          var tier = window.EffectTiers.getEffectTier(category, value);
          chip.setAttribute('data-rank-tier', tier);
          chip.title = 'Reach ' + window.EffectTiers.getRankLabel(tier) + ' to unlock';
        }
      });
    });

    // 2) Image effect type options (none / filters / overlays)
    document.querySelectorAll('[data-tier="2"] .effects-level .tier-option').forEach(function (option) {
      var value = option.dataset.value;
      // "none" is always free; "filters" / "overlays" are unlocked if any variant inside is unlocked
      if (!value || value === 'none') {
        option.classList.remove('locked');
        return;
      }
      // Check if any variant in this category is unlocked
      var category = value === 'overlays' ? 'overlay' : 'imageFilter';
      var unlocked = window.EffectTiers.getUnlockedEffects(category);
      if (unlocked.length > 0) {
        option.classList.remove('locked');
        option.removeAttribute('title');
        option.removeAttribute('data-rank-tier');
      } else {
        option.classList.add('locked');
        option.title = 'Unlock effects by earning arena rank';
        // Find the lowest locked tier for this category
        var RANK_ORDER = window.EffectTiers.RANK_ORDER;
        var EFFECT_TIERS = window.EffectTiers.EFFECT_TIERS;
        for (var ri = 0; ri < RANK_ORDER.length; ri++) {
          var rk = RANK_ORDER[ri];
          var eff = EFFECT_TIERS[rk][category];
          if (eff && eff.length > 0 && !window.EffectTiers.isEffectUnlocked(category, eff[0])) {
            option.setAttribute('data-rank-tier', rk);
            break;
          }
        }
      }
    });

    // 3) Individual filter / overlay variants
    document.querySelectorAll('[data-tier="2"] .effects-level .variant-option').forEach(function (option) {
      var variant = option.dataset.variant;
      if (!variant) return;
      // Determine category from parent container
      var container = option.closest('.effect-variants');
      var effectType = container ? container.dataset.effect : null;
      var category;
      if (effectType === 'overlays') {
        category = 'overlay';
      } else if (effectType === 'filters') {
        category = 'imageFilter';
      } else {
        // "none" container — always free
        option.classList.remove('locked');
        return;
      }
      if (window.EffectTiers.isEffectUnlocked(category, variant)) {
        option.classList.remove('locked');
        option.removeAttribute('title');
        option.removeAttribute('data-rank-tier');
      } else {
        var tier = window.EffectTiers.getEffectTier(category, variant);
        option.classList.add('locked');
        option.setAttribute('data-rank-tier', tier);
        option.title = 'Reach ' + window.EffectTiers.getRankLabel(tier) + ' to unlock';
      }
    });

    // Update effects progression banner
    updateEffectProgressionBanner();
  }

  /**
   * Show a progression banner above the effects panels with unlock stats.
   * Hidden if all effects are unlocked (Diamond / Pro).
   */
  function updateEffectProgressionBanner() {
    var banner = document.getElementById('effect-progression-banner');
    if (!banner || !window.EffectTiers) return;

    var ET = window.EffectTiers;
    var profile = window._arenaProfile;
    var rank = (profile && profile.rank) ? profile.rank.toLowerCase() : 'bronze';
    var rankLabel = ET.RANK_CONFIG && ET.RANK_CONFIG[rank] ? ET.RANK_CONFIG[rank].label : 'Bronze';

    // Count unlocked vs total across all categories
    var categories = ['bg', 'border', 'glow', 'imageFilter', 'overlay'];
    var totalEffects = 0;
    var unlockedEffects = 0;
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var TIERS = ET.EFFECT_TIERS;
      for (var r = 0; r < ET.RANK_ORDER.length; r++) {
        var effects = TIERS[ET.RANK_ORDER[r]][cat];
        if (effects) {
          for (var e = 0; e < effects.length; e++) {
            if (effects[e] === 'none') continue;
            totalEffects++;
            if (ET.isEffectUnlocked(cat, effects[e])) unlockedEffects++;
          }
        }
      }
    }

    // Hide banner if all unlocked
    if (unlockedEffects >= totalEffects) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = '';

    var statsEl = document.getElementById('effect-progression-stats');
    if (statsEl) {
      statsEl.innerHTML =
        '<span class="buff-progress-chip"><i class="fas fa-shield-halved"></i> ' + rankLabel + '</span>' +
        '<span class="buff-progress-chip"><i class="fas fa-unlock"></i> ' + unlockedEffects + '/' + totalEffects + ' effects</span>';
    }
  }

  // ===== BIOGRAPHY TRUNCATION DETECTION =====
  function detectBioTruncation(root) {
    const bioText = (root || document).querySelector('.biography-text');
    if (!bioText) return;
    // Compare scrollHeight vs clientHeight to detect line-clamp truncation
    if (bioText.scrollHeight > bioText.clientHeight + 1) {
      bioText.classList.add('is-truncated');
    } else {
      bioText.classList.remove('is-truncated');
    }
  }

  // Hook into updateFrontFace — check overflow after stats render
  const _origUpdateFrontFace = updateFrontFace;
  updateFrontFace = function(data) {
    _origUpdateFrontFace(data);
    checkCardOverflow();
  };

  // Hook into updateBackFace — check overflow + bio truncation after rendering
  const _origUpdateBackFace = updateBackFace;
  updateBackFace = function(data) {
    _origUpdateBackFace(data);
    checkCardOverflow();
    // Detect bio truncation after layout settles
    requestAnimationFrame(() => {
      const back = document.querySelector('.card-preview-zone .card-back');
      detectBioTruncation(back);
    });
  };

  // ===== FORM LISTENERS =====
  function initFormListeners() {
    // Basic form fields
    const formInputs = [
      'card-name',
      'card-class', 
      'card-rarity',
      'card-quote',
      'card-avatar',
      'card-bio' // Biography field for Attributes tab
    ];
    
    formInputs.forEach(inputId => {
      const input = document.getElementById(inputId);
      if (input) {
        input.addEventListener('input', updatePreview);
        input.addEventListener('change', updatePreview);
      }
    });
    
    // Dynamic stats listeners
    initStatsListeners();
    
    // Class and Rarity style selectors
    const classStyleSelector = document.getElementById('class-style');
    const rarityStyleSelector = document.getElementById('rarity-style');
    
    if (classStyleSelector) {
      classStyleSelector.addEventListener('change', function() {
        updatePreview();
      });
    }
    
    if (rarityStyleSelector) {
      rarityStyleSelector.addEventListener('change', function() {
        updatePreview();
      });
    }
    
    // Card Effects chip buttons — click to select, sync to hidden <select>, update preview
    document.querySelectorAll('.effect-chips').forEach(chipGroup => {
      const targetId = chipGroup.dataset.target;
      const hiddenSelect = document.getElementById(targetId);
      
      chipGroup.querySelectorAll('.effect-chip').forEach(chip => {
        chip.addEventListener('click', function() {
          if (this.classList.contains('locked')) return;
          chipGroup.querySelectorAll('.effect-chip').forEach(c => c.classList.remove('selected'));
          this.classList.add('selected');
          
          if (hiddenSelect) {
            hiddenSelect.value = this.dataset.value;
            hiddenSelect.dispatchEvent(new Event('change'));
          }
          
          updatePreview();
          updateCardEffectsDisplay();
          updateTypographyDisplay();
        });
      });
    });
    
    // Clear All Effects buttons — reset bg/border/glow to 'none'
    function clearAllEffects() {
      ['card-bg-effect', 'card-border-effect', 'card-glow-effect'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) sel.value = 'none';
        const chipGroup = document.querySelector(`.effect-chips[data-target="${id}"]`);
        if (chipGroup) {
          chipGroup.querySelectorAll('.effect-chip').forEach(c => c.classList.remove('selected'));
          const noneChip = chipGroup.querySelector('.effect-chip[data-value="none"]');
          if (noneChip) noneChip.classList.add('selected');
        }
      });
      updatePreview();
      updateCardEffectsDisplay();
    }
    const clearEffectsBtn = document.getElementById('clear-all-effects');
    if (clearEffectsBtn) clearEffectsBtn.addEventListener('click', clearAllEffects);
    const clearEffectsBtnBottom = document.getElementById('clear-all-effects-bottom');
    if (clearEffectsBtnBottom) clearEffectsBtnBottom.addEventListener('click', clearAllEffects);

    // Apply effect tier locks (bronze-default until profile loads)
    applyEffectLockState();

    // Hidden select change listeners (for programmatic .value changes from random roll)
    ['card-bg-effect', 'card-border-effect', 'card-glow-effect'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function() {
          updatePreview();
          updateCardEffectsDisplay();
        });
      }
    });
    
    // Initialize badge section toggle systems
    // Initialize icon pickers
    initIconPickers();
    
  }
  
  function initStatsListeners() {
    const statsContainer = document.getElementById('stats-editor');
    if (statsContainer) {
      // Use event delegation for dynamic stat rows
      statsContainer.addEventListener('input', function(e) {
        if (e.target.matches('input[name="stat-value"]') || e.target.matches('input[name="stat-name"]')) {
          // Value and name edits: snap bars (no full animation)
          updatePreview();
        }
      });
      
      statsContainer.addEventListener('change', function(e) {
        if (e.target.matches('input[name="stat-value"]')) {
          // Update the display value for range sliders
          const display = e.target.parentNode.querySelector('.stat-value-display');
          if (display) {
            display.textContent = e.target.value;
          }
          updatePreview();
        }
      });
    }
  }
  




  // ===== IMAGE GALLERY =====
  function initImageGallery() {
    const inlineImageGrid = document.getElementById('inline-image-grid');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');
    const customUrlInput = document.getElementById('custom-url-input');
    const useCustomUrlBtn = document.getElementById('use-custom-url');
    const cardAvatarInput = document.getElementById('card-avatar');

    let currentPage = 1;
    const imagesPerPage = 18;

    function loadInlineImages(page) {
      if (!inlineImageGrid) return;
      
      inlineImageGrid.textContent = 'Loading images...';
      
      fetch('/cardforge/image-manifest.json')
        .then(res => res.json())
        .then(images => {
          inlineImageGrid.innerHTML = '';
          const start = (page - 1) * imagesPerPage;
          const pageImages = images.slice(start, start + imagesPerPage);
          
          if (!pageImages.length) {
            inlineImageGrid.innerHTML = '<p class="no-images-message">No images available.</p>';
          } else {
            pageImages.forEach((url, index) => {
              const img = document.createElement('img');
              img.src = url;
              img.alt = '';
              
              // Auto-select first image on page 1 if no image is currently selected
              if (page === 1 && index === 0 && (!cardAvatarInput.value || cardAvatarInput.value === '')) {
                img.classList.add('selected');
                cardAvatarInput.value = url;
                updatePreview();
              }
              
              // Check if this image is currently selected
              if (cardAvatarInput.value === url) {
                img.classList.add('selected');
              }
              
              img.addEventListener('click', () => {
                // Remove previous selection
                inlineImageGrid.querySelectorAll('img').forEach(i => i.classList.remove('selected'));
                // Mark as selected
                img.classList.add('selected');
                // Update avatar input
                if (cardAvatarInput) {
                  cardAvatarInput.value = url;
                  updatePreview();
                  if (window.CardForgeChrome) window.CardForgeChrome.markDirty();
                }
              });
              
              inlineImageGrid.appendChild(img);
            });
          }
          
          // Update pagination info
          const totalPages = Math.ceil(images.length / imagesPerPage);
          if (pageInfo) {
            pageInfo.textContent = `Page ${page} of ${totalPages}`;
          }
          if (prevPageBtn) {
            prevPageBtn.disabled = page <= 1;
          }
          if (nextPageBtn) {
            nextPageBtn.disabled = page >= totalPages;
          }
        })
        .catch(err => {
          console.error('Error loading image manifest:', err);
          inlineImageGrid.innerHTML = '<p class="error-message">Failed to load images.</p>';
        });
    }

    // Initialize image gallery
    if (inlineImageGrid) {
      loadInlineImages(currentPage);
    }

    // Pagination event listeners
    prevPageBtn?.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadInlineImages(currentPage);
      }
    });

    nextPageBtn?.addEventListener('click', () => {
      currentPage++;
      loadInlineImages(currentPage);
    });

    // Custom URL functionality
    useCustomUrlBtn?.addEventListener('click', () => {
      if (cardAvatarInput && customUrlInput && customUrlInput.value.trim()) {
        // Clear any gallery selections
        if (inlineImageGrid) {
          inlineImageGrid.querySelectorAll('img').forEach(img => img.classList.remove('selected'));
        }
        // Set custom URL
        cardAvatarInput.value = customUrlInput.value.trim();
        customUrlInput.value = '';
        updatePreview();
        if (window.CardForgeChrome) window.CardForgeChrome.markDirty();
      }
    });
  }

  // ===== TIER 2: IMAGE CONTAINER & EFFECTS (CONSOLIDATED) =====
  function initTier2ImageContainer() {
    // Initialize Image Container options (exclude Image Effects options)
    const containerOptions = document.querySelectorAll('[data-tier="2"] .tier-options-grid:not(.effects-grid) .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="2"] .container-variants');
    
    containerOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        containerOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageContainer = option.dataset.value;
        
        // Show/hide relevant variant options
        variantContainers.forEach(container => {
          const containerType = container.dataset.container;
          if (containerType === ModularState.imageContainer) {
            container.style.display = 'block';
          } else {
            container.style.display = 'none';
          }
        });
        
        // Set default variant for the selected container
        const defaultVariants = {
          'masked': 'circle',
          'polaroid': 'classic',
          'banner': 'top',
          'fullbleed': 'standard',
          'hero': 'large',
          'floating': 'centered'
        };
        ModularState.imageContainerVariant = defaultVariants[ModularState.imageContainer] || 'circle';
        
        // Update variant selection UI
        const activeContainer = document.querySelector(`[data-tier="2"] [data-container="${ModularState.imageContainer}"]`);
        if (activeContainer) {
          const variantOptions = activeContainer.querySelectorAll('.variant-option');
          variantOptions.forEach(v => v.classList.remove('selected'));
          const defaultVariant = activeContainer.querySelector(`[data-variant="${ModularState.imageContainerVariant}"]`);
          if (defaultVariant) defaultVariant.classList.add('selected');
        }
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
      });
    });
    
    // Initialize variant option listeners
    const allVariantOptions = document.querySelectorAll('[data-tier="2"] .container-variants .variant-option');
    allVariantOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state within the same container
        const container = option.closest('.container-variants');
        const siblingOptions = container.querySelectorAll('.variant-option');
        siblingOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageContainerVariant = option.dataset.variant;
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
      });
    });
    
    // Initialize Image Effects type listeners
    const effectTypeOptions = document.querySelectorAll('[data-tier="2"] .effects-level .tier-option');
    effectTypeOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        effectTypeOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageEffect = option.dataset.value;
        
        // Set default variant for the selected effect
        const defaultVariants = {
          'none': 'clean',
          'filters': 'sepia',
          'overlays': 'color-wash'
        };
        ModularState.imageEffectVariant = defaultVariants[ModularState.imageEffect] || 'clean';
        
        // Update variant selection UI
        const activeEffect = document.querySelector(`[data-tier="2"] .effects-level [data-effect="${ModularState.imageEffect}"]`);
        if (activeEffect) {
          const variantOptions = activeEffect.querySelectorAll('.variant-option');
          variantOptions.forEach(v => v.classList.remove('selected'));
          const defaultVariant = activeEffect.querySelector(`[data-variant="${ModularState.imageEffectVariant}"]`);
          if (defaultVariant) defaultVariant.classList.add('selected');
        }
        
        // Update preview
        updatePreview();
        
      });
    });
    
    // Initialize Image Effects variant listeners
    const effectVariantOptions = document.querySelectorAll('[data-tier="2"] .effects-level .variant-option');
    effectVariantOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state within the same effect container
        const container = option.closest('.effect-variants');
        const siblingOptions = container.querySelectorAll('.variant-option');
        siblingOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageEffectVariant = option.dataset.variant;
        
        // Update preview
        updatePreview();
        
      });
    });
    
    // Set default selections
    const defaultContainer = document.querySelector(`[data-tier="2"] [data-value="${ModularState.imageContainer}"]`);
    if (defaultContainer) {
      defaultContainer.classList.add('selected');
      // Show the default container's variants
      const defaultVariantContainer = document.querySelector(`[data-tier="2"] [data-container="${ModularState.imageContainer}"]`);
      if (defaultVariantContainer) {
        defaultVariantContainer.style.display = 'block';
        const defaultVariant = defaultVariantContainer.querySelector(`[data-variant="${ModularState.imageContainerVariant}"]`);
        if (defaultVariant) defaultVariant.classList.add('selected');
      }
    }
    
    // Initialize Image Effects sub-level within Tier 2
    initImageEffectsSubLevel();
  }

  // ===== IMAGE EFFECTS SUB-LEVEL INITIALIZATION =====
  function initImageEffectsSubLevel() {
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-level .effects-type-grid .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="2"] .effects-level .effect-variants');
    const variantsSection = document.querySelector('[data-tier="2"] .effects-level .effects-variants-section');
    
    // Effect Type Selection Handlers
    effectOptions.forEach(option => {
      option.addEventListener('click', () => {
        if (option.classList.contains('locked')) return;
        effectOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        ModularState.imageEffect = option.dataset.value;

        // Show/hide variant containers
        variantContainers.forEach(container => {
          const effectType = container.dataset.effect;
          container.style.display = effectType === ModularState.imageEffect ? 'block' : 'none';
        });
        
        // Hide entire variants section when None is selected
        if (variantsSection) {
          variantsSection.style.display = ModularState.imageEffect === 'none' ? 'none' : 'block';
        }
        
        const defaultVariants = {
          'none': 'clean',
          'filters': 'sepia',
          'overlays': 'color-wash'
        };
        
        ModularState.imageEffectVariant = defaultVariants[ModularState.imageEffect] || 'clean';
        
        if (ModularState.imageEffect !== 'none') {
          const activeVariantContainer = document.querySelector(`[data-tier="2"] .effects-level [data-effect="${ModularState.imageEffect}"]`);
          if (activeVariantContainer) {
            const variantOptions = activeVariantContainer.querySelectorAll('.variant-option');
            variantOptions.forEach(opt => opt.classList.remove('selected'));
            const defaultVariantOption = activeVariantContainer.querySelector(`[data-variant="${ModularState.imageEffectVariant}"]`);
            if (defaultVariantOption) defaultVariantOption.classList.add('selected');
          }
        }
        
        updatePreview();
      });
    });
    
    // Effect Variant Selection Handlers
    const variantOptions2 = document.querySelectorAll('[data-tier="2"] .effects-level .variant-option');
    variantOptions2.forEach(option => {
      option.addEventListener('click', () => {
        if (option.classList.contains('locked')) return;
        const container = option.closest('.effect-variants');
        const siblingOptions = container.querySelectorAll('.variant-option');
        siblingOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        ModularState.imageEffectVariant = option.dataset.variant;
        updatePreview();
      });
    });
    
    // Hide variants section on initial load (None is default)
    if (variantsSection) variantsSection.style.display = 'none';
  }

  // ===== IMAGE EFFECTS SUB-LEVEL (within Tier 2) =====
  function initImageEffectsSubLevel() {
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-level .effects-grid .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="2"] .effects-level .effect-variants');
    const variantsSection = document.querySelector('[data-tier="2"] .effects-level .effects-variants-section');
    
    effectOptions.forEach(option => {
      option.addEventListener('click', () => {
        if (option.classList.contains('locked')) return;
        effectOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        ModularState.imageEffect = option.dataset.value;

        // Show/hide variant panels
        variantContainers.forEach(container => {
          const effectType = container.dataset.effect;
          container.style.display = effectType === ModularState.imageEffect ? 'block' : 'none';
        });
        
        // Hide entire variants section when None is selected
        if (variantsSection) {
          variantsSection.style.display = ModularState.imageEffect === 'none' ? 'none' : 'block';
        }
        
        const defaultVariants = {
          'none': 'clean',
          'filters': 'sepia',
          'overlays': 'color-wash'
        };
        
        ModularState.imageEffectVariant = defaultVariants[ModularState.imageEffect] || 'clean';
        
        if (ModularState.imageEffect !== 'none') {
          const activeVariantContainer = document.querySelector(`[data-tier="2"] .effects-level [data-effect="${ModularState.imageEffect}"]`);
          if (activeVariantContainer) {
            const variantOptions = activeVariantContainer.querySelectorAll('.variant-option');
            variantOptions.forEach(opt => opt.classList.remove('selected'));
            const defaultVariantOption = activeVariantContainer.querySelector(`[data-variant="${ModularState.imageEffectVariant}"]`);
            if (defaultVariantOption) defaultVariantOption.classList.add('selected');
          }
        }
        
        updatePreview();
      });
    });
    
    const variantOptions3 = document.querySelectorAll('[data-tier="2"] .effects-level .effect-variants .variant-option');
    variantOptions3.forEach(option => {
      option.addEventListener('click', () => {
        if (option.classList.contains('locked')) return;
        const container = option.closest('.effect-variants');
        const siblingOptions = container.querySelectorAll('.variant-option');
        siblingOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        ModularState.imageEffectVariant = option.dataset.variant;
        updatePreview();
      });
    });
    
    // Hide variants section on initial load (None is default)
    if (variantsSection) variantsSection.style.display = 'none';
  }

  // ===== WORKING MODULAR SYSTEM INITIALIZATION =====
  function initTier2ImageContainer() {

    // Container type event handlers
    const containerOptions = document.querySelectorAll('[data-tier="2"] .container-grid .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="2"] .container-variants');

    containerOptions.forEach(option => {
      option.addEventListener('click', () => {
        
        // Update selection state
        containerOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageContainer = option.dataset.value;
        
        // Show/hide relevant variant options
        variantContainers.forEach(container => {
          const containerType = container.dataset.container;
          if (containerType === ModularState.imageContainer) {
            container.style.display = 'block';
          } else {
            container.style.display = 'none';
          }
        });
        
        // Set default variant for the selected container
        const defaultVariants = {
          'masked': 'circle',
          'polaroid': 'classic',
          'banner': 'top',
          'fullbleed': 'standard',
          'hero': 'large',
          'floating': 'centered'
        };
        ModularState.imageContainerVariant = defaultVariants[ModularState.imageContainer] || 'circle';
        
        // Show/hide vertical alignment controls based on container type
        const verticalAlignmentSection = document.getElementById('vertical-alignment-section');
        if (verticalAlignmentSection) {
          if (ModularState.imageContainer === 'fullbleed') {
            verticalAlignmentSection.style.display = 'block';
          } else {
            verticalAlignmentSection.style.display = 'none';
          }
        }
        
        // Update preview
        updatePreview();
      });
    });

    // Container variant event handlers
    const containerVariantOptions = document.querySelectorAll('[data-tier="2"] .container-variants .variant-option');
    containerVariantOptions.forEach(option => {
      option.addEventListener('click', () => {
        
        // Update ModularState for CONTAINER variant
        ModularState.imageContainerVariant = option.dataset.variant;
        
        // Update selection state within this variant group
        const siblingVariants = option.parentNode.querySelectorAll('.variant-option');
        siblingVariants.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update preview
        updatePreview();
      });
    });

    // Image effects event handlers
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-grid .tier-option');
    const effectVariantContainers = document.querySelectorAll('[data-tier="2"] .effect-variants');
    const effectVariantsSection = document.querySelector('[data-tier="2"] .effects-level .effects-variants-section');

    effectOptions.forEach(option => {
      option.addEventListener('click', () => {
        
        // Update selection state
        effectOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageEffect = option.dataset.value;
        
        // Hide entire variants section when None is selected
        if (effectVariantsSection) {
          effectVariantsSection.style.display = ModularState.imageEffect === 'none' ? 'none' : 'block';
        }
        
        // Show/hide relevant effect variant options
        effectVariantContainers.forEach(container => {
          const effectType = container.dataset.effect;
          if (effectType === ModularState.imageEffect) {
            container.style.display = 'block';
          } else {
            container.style.display = 'none';
          }
        });
        
        // Set default variant for the selected effect
        const defaultEffectVariants = {
          'none': 'clean',
          'filters': 'sepia',
          'overlays': 'color-wash'
        };
        ModularState.imageEffectVariant = defaultEffectVariants[ModularState.imageEffect] || 'clean';
        
        // Highlight default variant
        if (ModularState.imageEffect !== 'none') {
          const activePanel = document.querySelector(`[data-tier="2"] .effects-level [data-effect="${ModularState.imageEffect}"]`);
          if (activePanel) {
            activePanel.querySelectorAll('.variant-option').forEach(opt => opt.classList.remove('selected'));
            const defaultOpt = activePanel.querySelector(`[data-variant="${ModularState.imageEffectVariant}"]`);
            if (defaultOpt) defaultOpt.classList.add('selected');
          }
        }
        
        // Update preview
        updatePreview();
      });
    });

    // Effect variant event handlers
    const effectVariantOptions = document.querySelectorAll('[data-tier="2"] .effect-variants .variant-option');
    effectVariantOptions.forEach(option => {
      option.addEventListener('click', () => {
        
        // Update ModularState for EFFECT variant
        ModularState.imageEffectVariant = option.dataset.variant;
        
        // Update selection state within this variant group
        const siblingVariants = option.parentNode.querySelectorAll('.variant-option');
        siblingVariants.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update preview
        updatePreview();
      });
    });

  }

  // ===== DEFAULT CLASS AND RARITY STYLING =====
  function initDefaultClassAndRarityStyles() {
    
    // Set default class styling
    const classStyleField = document.getElementById('class-style');
    if (classStyleField) {
      classStyleField.value = 'badge';
    }
    
    const classIconField = document.getElementById('class-icon-value');
    if (classIconField) {
      classIconField.value = 'khanda';
      // Update visual selection
      const classIconOptions = document.querySelectorAll('#class-section .icon-option');
      classIconOptions.forEach(option => {
        option.classList.toggle('selected', option.dataset.icon === 'khanda');
      });
    }
    
    // Set default rarity styling
    const rarityStyleField = document.getElementById('rarity-style');
    if (rarityStyleField) {
      rarityStyleField.value = 'default';
    }
    
    const rarityIconField = document.getElementById('rarity-icon-value');
    if (rarityIconField) {
      rarityIconField.value = 'gem';
      // Update visual selection
      const rarityIconOptions = document.querySelectorAll('#rarity-section .icon-option');
      rarityIconOptions.forEach(option => {
        option.classList.toggle('selected', option.dataset.icon === 'gem');
      });
    }
    
  }
  
  // Note: Default styles initialization moved to main DOMContentLoaded listener to avoid conflicts
  
  // Expose global functions for external access
  window.CardForge = {
    updatePreview,
    initImageGallery,
    initTier2ImageContainer,
    rollRandomCard,
    ModularState,
    createStatRow,
    createBadgeRow,
    createAttributeRow,
    applyEffectLockState
  };

})();

// ===== PLACEHOLDER FOR ADDITIONAL TIERS =====
// TODO: Add Tier 2 (Alignment), Tier 3 (Weight), Tier 5 (Image Container), Tier 6 (Effects)
// TODO: Add dynamic form editors (Stats, Social, Badges, Attributes)


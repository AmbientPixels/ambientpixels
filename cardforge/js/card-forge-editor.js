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
    
    // Image Effects (sub-tier of Image Container)
    imageEffect: 'none',
    imageEffectVariant: 'clean'
  };
  
  // Make ModularState globally accessible for event handlers
  window.ModularState = ModularState;

  // ===== CARD DISPLAY CAPS =====
  const STAT_CAP = 5;        // Max visible stats on card face
  const SOCIAL_CAP = 8;      // Max visible social icons on card face
  const BADGE_CAP = 6;       // 2 rows × 3 columns — overflow gets "+N" indicator
  const ATTRIBUTE_CAP = 6;   // Max visible attributes on card face
  
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
        characterClass: 'Elven Archer',
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
        characterClass: 'Data Netrunner',
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
        characterClass: 'Mystic Researcher',
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
        characterClass: 'Galactic Warrior',
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
        characterClass: 'Blade for Hire',
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
        characterClass: 'Champion of Justice',
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
        characterClass: 'Divine Protector',
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
        characterClass: 'Stealth Specialist',
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
      
      // Apply stats - CREATE MULTIPLE ROWS
      if (prefillData.stats && prefillData.stats.length > 0) {
        const statsContainer = document.getElementById('stats-editor');
        
        // Clear existing stat rows
        statsContainer.innerHTML = '';
        
        // Create a row for each stat
        prefillData.stats.forEach((stat, index) => {
          const statRow = createStatRow(stat.name, stat.value);
          statsContainer.appendChild(statRow);
          console.log(`📊 Added stat: ${stat.name} = ${stat.value}`);
        });
      }
      
      // Apply social links - CREATE MULTIPLE ROWS
      if (prefillData.socialLinks && prefillData.socialLinks.length > 0) {
        const socialContainer = document.getElementById('social-editor');
        
        // Clear existing social rows
        socialContainer.innerHTML = '';
        
        // Create a row for each social link
        prefillData.socialLinks.forEach((social, index) => {
          const socialRow = createSocialRow(social.platform, social.url);
          socialContainer.appendChild(socialRow);
          console.log(`🔗 Added social: ${social.platform} = ${social.url}`);
        });
      }
      
      // Apply badges - CREATE MULTIPLE ROWS
      if (prefillData.badges && prefillData.badges.length > 0) {
        const badgesContainer = document.getElementById('micro-editor');
        
        // Clear existing badge rows
        badgesContainer.innerHTML = '';
        
        // Create a row for each badge
        prefillData.badges.forEach((badge, index) => {
          const badgeRow = createBadgeRow(badge.category, badge.icon, badge.description, badge.quantity);
          badgesContainer.appendChild(badgeRow);
          console.log(`🏆 Added badge: ${badge.category} = ${badge.quantity}`);
        });
      }
      
      // Apply attributes - CREATE MULTIPLE ROWS
      if (prefillData.attributes && prefillData.attributes.length > 0) {
        const attributesContainer = document.getElementById('attribute-editor');
        
        // Clear existing attribute rows
        attributesContainer.innerHTML = '';
        
        // Create a row for each attribute
        prefillData.attributes.forEach((attribute, index) => {
          const attributeRow = createAttributeRow(attribute.name, attribute.value);
          attributesContainer.appendChild(attributeRow);
          console.log(`⚡ Added attribute: ${attribute.name} = ${attribute.value}`);
        });
      }
      
      console.log('📄 Prefill data loaded successfully:', prefillData);
      
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
      <input type="text" name="stat-name" placeholder="Stat name" value="${name}" />
      <input type="range" name="stat-value" min="0" max="100" value="${value}" class="stat-slider" aria-label="Stat value" />
      <span class="stat-value-display">${value}</span>
      <button type="button" class="remove-attribute">&times;</button>
    `;
    
    // Add event listeners for the new row
    const slider = statRow.querySelector('.stat-slider');
    const display = statRow.querySelector('.stat-value-display');
    const removeBtn = statRow.querySelector('.remove-attribute');
    
    slider.addEventListener('input', function() {
      display.textContent = this.value;
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
  
  function createSocialRow(platform = 'twitter', url = '') {
    const socialRow = document.createElement('div');
    socialRow.className = 'social-row';
    socialRow.innerHTML = `
      <label>Platform
        <select name="social-name" class="social-platform" aria-label="Platform">
          <option value="twitter" ${platform === 'twitter' ? 'selected' : ''}>Twitter</option>
          <option value="instagram" ${platform === 'instagram' ? 'selected' : ''}>Instagram</option>
          <option value="linkedin" ${platform === 'linkedin' ? 'selected' : ''}>LinkedIn</option>
          <option value="x" ${platform === 'x' ? 'selected' : ''}>X</option>
          <option value="deviantart" ${platform === 'deviantart' ? 'selected' : ''}>DeviantArt</option>
          <option value="github" ${platform === 'github' ? 'selected' : ''}>GitHub</option>
          <option value="facebook" ${platform === 'facebook' ? 'selected' : ''}>Facebook</option>
          <option value="discord" ${platform === 'discord' ? 'selected' : ''}>Discord</option>
          <option value="tiktok" ${platform === 'tiktok' ? 'selected' : ''}>TikTok</option>
          <option value="youtube" ${platform === 'youtube' ? 'selected' : ''}>YouTube</option>
        </select>
      </label>
      <label>Link (URL)
        <input type="url" name="social-url" placeholder="https://..." value="${url}" />
      </label>
      <button type="button" class="remove-attribute">&times;</button>
    `;
    
    // Add event listeners for the new row
    const removeBtn = socialRow.querySelector('.remove-attribute');
    const selectField = socialRow.querySelector('select[name="social-name"]');
    const urlField = socialRow.querySelector('input[name="social-url"]');
    
    selectField.addEventListener('change', updatePreview);
    urlField.addEventListener('input', updatePreview);
    
    removeBtn.addEventListener('click', function() {
      socialRow.remove();
      // Re-enable Add Social button if under cap
      const addSocialBtn = document.getElementById('add-social-btn');
      if (addSocialBtn) {
        const remaining = document.querySelectorAll('#social-editor .social-row').length;
        if (remaining < SOCIAL_CAP) {
          addSocialBtn.classList.remove('disabled');
          addSocialBtn.title = '';
        }
      }
      updatePreview();
    });
    
    return socialRow;
  }

  function createBadgeRow(category = '', icon = 'star', description = '', quantity = 1) {
    const badgeRow = document.createElement('div');
    badgeRow.className = 'micro-row';
    badgeRow.innerHTML = `
      <label>Category
        <input type="text" name="micro-category" placeholder="Category (e.g. Skill)" value="${category}">
      </label>
      <label>Symbol/Icon
        <div class="icon-picker" aria-label="Select badge icon">
          <input type="hidden" name="micro-icon" value="${icon}">
          <button type="button" class="icon-option" data-icon="star"><i class="fas fa-star"></i></button>
          <button type="button" class="icon-option" data-icon="heart"><i class="fas fa-heart"></i></button>
          <button type="button" class="icon-option" data-icon="bolt"><i class="fas fa-bolt"></i></button>
          <button type="button" class="icon-option" data-icon="trophy"><i class="fas fa-trophy"></i></button>
          <button type="button" class="icon-option" data-icon="leaf"><i class="fas fa-leaf"></i></button>
          <button type="button" class="icon-option" data-icon="gear"><i class="fas fa-gear"></i></button>
          <button type="button" class="icon-option" data-icon="book"><i class="fas fa-book"></i></button>
          <button type="button" class="icon-option" data-icon="lightbulb"><i class="fas fa-lightbulb"></i></button>
          <button type="button" class="icon-option" data-icon="medal"><i class="fas fa-medal"></i></button>
          <button type="button" class="icon-option" data-icon="certificate"><i class="fas fa-certificate"></i></button>
        </div>
      </label>
      <label>Description
        <input type="text" name="micro-desc" placeholder="Description" value="${description}">
      </label>
      <label>Count
        <input type="range" name="micro-quantity" min="1" max="5" value="${quantity}" class="badge-slider">
        <span class="slider-value">${quantity}</span>
      </label>
      <button type="button" class="remove-attribute" aria-label="Remove badge">&times;</button>
    `;
    
    // Add event listeners for the new row
    const removeBtn = badgeRow.querySelector('.remove-attribute');
    const categoryField = badgeRow.querySelector('input[name="micro-category"]');
    const descField = badgeRow.querySelector('input[name="micro-desc"]');
    const quantitySlider = badgeRow.querySelector('input[name="micro-quantity"]');
    const sliderDisplay = badgeRow.querySelector('.slider-value');
    const iconPicker = badgeRow.querySelector('.icon-picker');
    const hiddenIconInput = badgeRow.querySelector('input[name="micro-icon"]');
    
    // Icon picker functionality
    iconPicker.addEventListener('click', function(e) {
      if (e.target.closest('.icon-option')) {
        const iconBtn = e.target.closest('.icon-option');
        const iconValue = iconBtn.dataset.icon;
        hiddenIconInput.value = iconValue;
        
        // Update visual selection
        iconPicker.querySelectorAll('.icon-option').forEach(btn => btn.classList.remove('selected'));
        iconBtn.classList.add('selected');
        
        updatePreview();
      }
    });
    
    // Set initial icon selection
    const initialIconBtn = iconPicker.querySelector(`[data-icon="${icon}"]`);
    if (initialIconBtn) initialIconBtn.classList.add('selected');
    
    // Quantity slider functionality
    quantitySlider.addEventListener('input', function() {
      sliderDisplay.textContent = this.value;
      updatePreview();
    });
    
    // Other field listeners
    categoryField.addEventListener('input', updatePreview);
    descField.addEventListener('input', updatePreview);
    
    removeBtn.addEventListener('click', function() {
      badgeRow.remove();
      // Re-enable Add Badge button if under cap
      const addBadgeBtn = document.getElementById('add-micro-btn');
      if (addBadgeBtn) {
        const remaining = document.querySelectorAll('#micro-editor .micro-row').length;
        if (remaining < BADGE_CAP) {
          addBadgeBtn.classList.remove('disabled');
          addBadgeBtn.title = '';
        }
      }
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
      <input type="text" name="attribute-name" placeholder="Attribute (e.g. Alignment)" value="${name}">
      <input type="text" name="attribute-value" placeholder="Value (e.g. Chaotic Creative)" value="${value}">
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
        if (remaining < ATTRIBUTE_CAP) {
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
    console.log('🔧 Initializing dynamic editors...');
    
    // Initialize Stats Editor
    initStatsEditor();
    
    // Initialize Social Links Editor
    initSocialEditor();
    
    // Initialize Badges Editor
    initBadgesEditor();
    
    // Initialize Attributes Editor
    initAttributesEditor();
    
    // Initialize Biography Character Counter
    initBioCounter();
    
    // Initialize form listeners for live preview
    initFormListeners();
    
    console.log('✅ Dynamic editors initialized');
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
  
  function updateStatBtnState() {
    const addStatBtn = document.getElementById('add-stat-btn');
    if (!addStatBtn) return;
    const statsContainer = document.getElementById('stats-editor');
    const count = statsContainer ? statsContainer.querySelectorAll('.stat-row').length : 0;
    if (count >= 10) {
      addStatBtn.classList.add('disabled');
      addStatBtn.disabled = true;
      addStatBtn.title = 'Maximum 10 stats reached';
    } else {
      addStatBtn.classList.remove('disabled');
      addStatBtn.disabled = false;
      addStatBtn.title = '';
    }
  }

  function initStatsEditor() {
    const addStatBtn = document.getElementById('add-stat-btn');
    if (addStatBtn) {
      addStatBtn.addEventListener('click', function() {
        const statsContainer = document.getElementById('stats-editor');
        const currentStats = statsContainer.querySelectorAll('.stat-row').length;
        
        if (currentStats >= 10) {
          console.warn('⚠️ Maximum of 10 stats allowed');
          return;
        }
        
        const newStatRow = createStatRow();
        statsContainer.appendChild(newStatRow);
        console.log(`📊 New stat row added (${currentStats + 1}/10)`);
        updateStatBtnState();
      });
    }
    updateStatBtnState();
  }
  
  function initSocialEditor() {
    const addSocialBtn = document.getElementById('add-social-btn');
    if (addSocialBtn) {
      addSocialBtn.addEventListener('click', function() {
        const socialContainer = document.getElementById('social-editor');
        const currentSocials = socialContainer.querySelectorAll('.social-row').length;
        if (currentSocials >= SOCIAL_CAP) {
          addSocialBtn.classList.add('disabled');
          addSocialBtn.title = `Maximum ${SOCIAL_CAP} social links reached`;
          console.log(`🔗 Social limit reached (${SOCIAL_CAP})`);
          return;
        }
        const newSocialRow = createSocialRow();
        socialContainer.appendChild(newSocialRow);
        if (currentSocials + 1 >= SOCIAL_CAP) {
          addSocialBtn.classList.add('disabled');
          addSocialBtn.title = `Maximum ${SOCIAL_CAP} social links reached`;
        }
        console.log(`🔗 New social row added (${currentSocials + 1}/${SOCIAL_CAP})`);
      });
    }
  }

  function initBadgesEditor() {
    const addBadgeBtn = document.getElementById('add-micro-btn');
    if (addBadgeBtn) {
      addBadgeBtn.addEventListener('click', function() {
        const badgesContainer = document.getElementById('micro-editor');
        const currentBadges = badgesContainer.querySelectorAll('.micro-row').length;
        if (currentBadges >= BADGE_CAP) {
          addBadgeBtn.classList.add('disabled');
          addBadgeBtn.title = `Maximum ${BADGE_CAP} badges reached`;
          console.log(`🏆 Badge limit reached (${BADGE_CAP})`);
          return;
        }
        const newBadgeRow = createBadgeRow();
        badgesContainer.appendChild(newBadgeRow);
        // Update button state after adding
        if (currentBadges + 1 >= BADGE_CAP) {
          addBadgeBtn.classList.add('disabled');
          addBadgeBtn.title = `Maximum ${BADGE_CAP} badges reached`;
        }
        console.log(`🏆 New badge row added (${currentBadges + 1}/${BADGE_CAP})`);
      });
    }
  }

  function initAttributesEditor() {
    const addAttributeBtn = document.getElementById('add-attribute-btn');
    if (addAttributeBtn) {
      addAttributeBtn.addEventListener('click', function() {
        const attributesContainer = document.getElementById('attribute-editor');
        const currentAttrs = attributesContainer.querySelectorAll('.attribute-row').length;
        if (currentAttrs >= ATTRIBUTE_CAP) {
          addAttributeBtn.classList.add('disabled');
          addAttributeBtn.title = `Maximum ${ATTRIBUTE_CAP} attributes reached`;
          console.log(`⚡ Attribute limit reached (${ATTRIBUTE_CAP})`);
          return;
        }
        const newAttributeRow = createAttributeRow();
        attributesContainer.appendChild(newAttributeRow);
        if (currentAttrs + 1 >= ATTRIBUTE_CAP) {
          addAttributeBtn.classList.add('disabled');
          addAttributeBtn.title = `Maximum ${ATTRIBUTE_CAP} attributes reached`;
        }
        console.log(`⚡ New attribute row added (${currentAttrs + 1}/${ATTRIBUTE_CAP})`);
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

    // Stats
    const statsContainer = document.getElementById('stats-editor');
    if (statsContainer && cardData.stats && Array.isArray(cardData.stats)) {
      statsContainer.innerHTML = '';
      cardData.stats.forEach(stat => {
        statsContainer.appendChild(createStatRow(stat.name, stat.value));
      });
    }

    // Social Links
    const socialContainer = document.getElementById('social-editor');
    if (socialContainer && cardData.socialLinks && Array.isArray(cardData.socialLinks)) {
      socialContainer.innerHTML = '';
      cardData.socialLinks.forEach(social => {
        socialContainer.appendChild(createSocialRow(social.platform, social.url));
      });
    }

    // Badges
    const badgesContainer = document.getElementById('micro-editor');
    if (badgesContainer && cardData.badges && Array.isArray(cardData.badges)) {
      badgesContainer.innerHTML = '';
      cardData.badges.forEach(badge => {
        badgesContainer.appendChild(createBadgeRow(badge.category, badge.icon, badge.description, badge.quantity));
      });
    }

    // Attributes
    const attributesContainer = document.getElementById('attribute-editor');
    if (attributesContainer && cardData.attributes && Array.isArray(cardData.attributes)) {
      attributesContainer.innerHTML = '';
      cardData.attributes.forEach(attribute => {
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
    }

    _statAnimationNeeded = true;
    updatePreview();
  };

  // Initialize everything when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 CardForge Editor initializing...');
    
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
    
    // Roll a random card for better initial experience
    // Note: Using direct call since we're inside the IIFE closure
    rollRandomCard();
    
    console.log('✅ CardForge V2 Modular System Ready!');
  });
  
  // ===== CARD FLIP FUNCTIONALITY =====
  function initCardFlip() {
    const flipBtn = document.getElementById('flip-btn');
    const cardInner = document.querySelector('.card-inner');
    
    // Manual flip button
    if (flipBtn && cardInner) {
      flipBtn.addEventListener('click', function() {
        cardInner.classList.toggle('flipped');
        console.log('🔄 Card flipped manually');
      });
    }
    
    // Auto flip on tab clicks
    document.addEventListener('click', function(e) {
      const stepBtn = e.target.closest('.step-btn');
      if (stepBtn && cardInner) {
        const step = stepBtn.getAttribute('data-step');
        // Steps 4, 5, 6 show back face (Social, Badges, Attributes)
        if (['4', '5', '6'].includes(step)) {
          cardInner.classList.add('flipped');
          console.log('🔄 Card flipped to back (step ' + step + ')');
        } else {
          // Steps 1, 2, 3 show front face (Card Design, Basics, Stats)
          cardInner.classList.remove('flipped');
          console.log('🔄 Card flipped to front (step ' + step + ')');
        }
      }
    });
    
    console.log('🔄 Card flip initialized');
  }

  // ===== PRESET SYSTEM =====
  function initPresets() {
    const presetButtons = document.querySelectorAll('.preset-btn');
    console.log(`🔍 Found ${presetButtons.length} preset buttons`);
    
    presetButtons.forEach((button, index) => {
      const presetId = button.dataset.preset;
      console.log(`🔗 Binding preset button ${index}: ${presetId}`);
      
      button.addEventListener('click', (e) => {
        e.preventDefault();
        console.log(`🖱️ Preset button clicked: ${presetId}`);
        
        applyPreset(presetId);
        
        // Update active state
        presetButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        console.log(`🎨 Applied preset: ${presetId}`);
      });
    });
    
    // Initialize Roll button
    const rollButton = document.getElementById('roll-random-preset');
    if (rollButton) {
      rollButton.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('🎲 Roll button clicked - generating random preset');
        
        // Add visual feedback
        rollButton.style.transform = 'scale(0.95)';
        setTimeout(() => {
          rollButton.style.transform = '';
        }, 150);
        
        window.CardForge.rollRandomCard();
      });
      console.log('🎲 Roll button initialized');
    }
    
    console.log('🚀 Presets initialized with event listeners');
  }
  
  // ===== RANDOM CARD GENERATOR =====
  let _lastRandomImage = ''; // Track last image to avoid repeats

  function rollRandomCard() {
    console.log('🎲 Rolling a completely random card...');
    
    // Define all possible options for each modular tier
    const randomOptions = {
      // Tier 2: Image Container & Effects
      imageContainers: ['masked', 'framed', 'raw', 'hero', 'fullbleed'],
      containerVariants: {
        'masked': ['circle', 'hex', 'diamond'],
        'framed': ['classic', 'ornate', 'minimal'],
        'raw': ['sharp', 'rounded', 'soft'],
        'hero': ['large', 'compact'],
        'fullbleed': ['standard', 'wide']
      },
      imageEffects: ['none', 'filters', 'borders'],
      effectVariants: {
        'none': ['clean'],
        'filters': ['sepia', 'blur', 'saturate', 'contrast'],
        'borders': ['solid', 'dashed', 'glow']
      },
      
      // Tier 3: Color Palette
      palettes: ['neon', 'earth', 'ocean', 'fire', 'cosmic'],
      paletteVariants: ['light', 'dark', 'vibrant'],
      
      // Tier 4: Content Alignment
      horizontalAlignments: ['left', 'center', 'right'],
      verticalAlignments: ['middle', 'bottom'], // Exclude 'top' from random rolls
      alignmentWeights: ['light', 'balanced', 'heavy'],
      alignmentStyles: ['minimal', 'padded', 'spacious']
    };
    
    // Generate random selections
    const randomContainer = randomOptions.imageContainers[Math.floor(Math.random() * randomOptions.imageContainers.length)];
    const randomContainerVariant = randomOptions.containerVariants[randomContainer][Math.floor(Math.random() * randomOptions.containerVariants[randomContainer].length)];
    
    // Handle image effects based on container type (avoid borders on masked)
    let availableEffects = [...randomOptions.imageEffects];
    if (randomContainer === 'masked') {
      availableEffects = availableEffects.filter(effect => effect !== 'borders');
    }
    const randomEffect = availableEffects[Math.floor(Math.random() * availableEffects.length)];
    const randomEffectVariant = randomOptions.effectVariants[randomEffect][Math.floor(Math.random() * randomOptions.effectVariants[randomEffect].length)];
    
    const randomPalette = randomOptions.palettes[Math.floor(Math.random() * randomOptions.palettes.length)];
    const randomPaletteVariant = randomOptions.paletteVariants[Math.floor(Math.random() * randomOptions.paletteVariants.length)];
    
    const randomHorizontal = randomOptions.horizontalAlignments[Math.floor(Math.random() * randomOptions.horizontalAlignments.length)];
    const randomVertical = randomOptions.verticalAlignments[Math.floor(Math.random() * randomOptions.verticalAlignments.length)];
    const randomWeight = randomOptions.alignmentWeights[Math.floor(Math.random() * randomOptions.alignmentWeights.length)];
    const randomStyle = randomOptions.alignmentStyles[Math.floor(Math.random() * randomOptions.alignmentStyles.length)];
    
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
      alignmentWeight: randomWeight,
      alignmentStyle: randomStyle
    });
    
    console.log(`🎯 Random card generated:`, {
      container: `${randomContainer}-${randomContainerVariant}`,
      effect: `${randomEffect}-${randomEffectVariant}`,
      palette: `${randomPalette}-${randomPaletteVariant}`,
      alignment: `${randomHorizontal}-${randomVertical}-${randomWeight}-${randomStyle}`
    });
    
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
      console.log('✨ Random card rolled successfully!');
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
    
    console.log('🔄 UI elements updated from ModularState');
  }
  
  // ===== RANDOM CHARACTER DATA GENERATOR =====
  function generateRandomCharacterData() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const randomNames = ['Aria Shadowbane', 'Zara-7', 'Marcus Ironforge', 'Luna Starweaver', 'Kai Stormrider', 'Nova Brightblade', 'Rex Cyberpunk', 'Sage Moonwhisper', 'Titan Guardian', 'Vex Nightshade', 'Orion Blaze', 'Lyra Frostwind'];
    const randomClasses = ['Rogue Assassin', 'Cyberpunk Runner', 'Arcane Scholar', 'Space Marine', 'Fantasy Ranger', 'Tech Specialist', 'Mystic Warrior', 'Shadow Operative', 'Void Walker', 'Chrono Mage', 'Neon Samurai', 'Bio-Engineer'];
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
    const badgePool = [
      { category: 'Combat', icon: 'fire', description: 'Battle-hardened warrior' },
      { category: 'Stealth', icon: 'shield', description: 'Master of shadows' },
      { category: 'Leadership', icon: 'crown', description: 'Born to lead' },
      { category: 'Arcane', icon: 'gem', description: 'Wielder of ancient magic' },
      { category: 'Tech', icon: 'bolt', description: 'Digital pioneer' },
      { category: 'Honor', icon: 'medal', description: 'Decorated hero' },
      { category: 'Valor', icon: 'trophy', description: 'Proven in battle' },
      { category: 'Precision', icon: 'target', description: 'Never misses' },
      { category: 'Heart', icon: 'heart', description: 'Compassionate soul' },
      { category: 'Legend', icon: 'star', description: 'Known across galaxies' }
    ];
    const attributePool = [
      { name: 'Origin', values: ['Earth', 'Mars Colony', 'Void Station', 'Neon City', 'Arcane Realm', 'Deep Space'] },
      { name: 'Faction', values: ['Rebel Alliance', 'Shadow Guild', 'Tech Union', 'Arcane Order', 'Free Agents', 'Void Walkers'] },
      { name: 'Weapon', values: ['Plasma Blade', 'Arcane Staff', 'Twin Daggers', 'Rail Cannon', 'Energy Bow', 'Void Gauntlets'] },
      { name: 'Rank', values: ['Initiate', 'Adept', 'Veteran', 'Commander', 'Grandmaster', 'Ascended'] },
      { name: 'Element', values: ['Fire', 'Ice', 'Lightning', 'Shadow', 'Light', 'Void'] },
      { name: 'Era', values: ['Ancient', 'Modern', 'Futuristic', 'Timeless', 'Post-Apocalyptic', 'Mythic'] }
    ];
    
    // Set random basic info
    document.getElementById('card-name').value = pick(randomNames);
    document.getElementById('card-class').value = pick(randomClasses);
    document.getElementById('card-rarity').value = pick(randomRarities);
    document.getElementById('card-quote').value = pick(randomQuotes);

    // Set random biography
    const bioField = document.getElementById('card-bio');
    if (bioField) {
      bioField.value = pick(randomBios);
    }
    
    // Clear all dynamic rows (stats, badges, attributes)
    clearAllDynamicRows();

    // Generate random stats (3-6)
    const statNames = ['Strength', 'Agility', 'Intelligence', 'Stealth', 'Magic', 'Tech', 'Charisma', 'Endurance'];
    const numStats = Math.floor(Math.random() * 4) + 3;
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

    // Generate random badges (2-5)
    const numBadges = Math.floor(Math.random() * 4) + 2;
    const badgesContainer = document.getElementById('micro-editor');
    if (badgesContainer) {
      const shuffledBadges = [...badgePool].sort(() => Math.random() - 0.5).slice(0, numBadges);
      shuffledBadges.forEach(badge => {
        const quantity = Math.floor(Math.random() * 3) + 1; // 1-3
        badgesContainer.appendChild(createBadgeRow(badge.category, badge.icon, badge.description, quantity));
      });
    }

    // Generate random attributes (2-4)
    const numAttrs = Math.floor(Math.random() * 3) + 2;
    const attributesContainer = document.getElementById('attribute-editor');
    if (attributesContainer) {
      const shuffledAttrs = [...attributePool].sort(() => Math.random() - 0.5).slice(0, numAttrs);
      shuffledAttrs.forEach(attr => {
        attributesContainer.appendChild(createAttributeRow(attr.name, pick(attr.values)));
      });
    }
    
    console.log(`🎲 Generated random character: ${numStats} stats, ${numBadges} badges, ${numAttrs} attributes`);
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
            console.log(`🖼️ Random image selected: ${randomImage}`);
            
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
    console.log(`🎯 applyPreset called with: ${presetId}`);
    
    const config = PresetConfigurations[presetId];
    if (!config) {
      console.error(`❌ Preset ${presetId} not found in PresetConfigurations`);
      console.log('Available presets:', Object.keys(PresetConfigurations));
      return;
    }
    
    console.log(`📋 Found preset config:`, config);
    
    // Separate front styling from sample data and non-ModularState keys
    const { sampleData, classStyle, classIcon, rarityStyle, rarityIcon, ...designConfig } = config;
    console.log(`🎨 Design config:`, designConfig);
    console.log(`📝 Sample data:`, sampleData);
    
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
    console.log(`🔄 ModularState updated:`, ModularState);
    
    // Populate class and rarity styling form fields
    if (classStyle) {
      const classStyleField = document.getElementById('class-style');
      if (classStyleField) {
        classStyleField.value = classStyle;
        console.log(`✅ Class style populated: ${classStyle}`);
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
        console.log(`✅ Class icon populated: ${classIcon}`);
      }
    }
    
    if (rarityStyle) {
      const rarityStyleField = document.getElementById('rarity-style');
      if (rarityStyleField) {
        rarityStyleField.value = rarityStyle;
        console.log(`✅ Rarity style populated: ${rarityStyle}`);
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
        console.log(`✅ Rarity icon populated: ${rarityIcon}`);
      }
    }
    
    try {
      updateUIFromState();
      console.log(`✅ updateUIFromState completed`);
    } catch (error) {
      console.error(`❌ Error in updateUIFromState:`, error);
    }
    
    // Populate form with sample data
    console.log(`🔍 Checking sampleData:`, sampleData, 'Type:', typeof sampleData, 'Truthy:', !!sampleData);
    if (sampleData) {
      console.log(`📊 Populating form with sample data...`);
      try {
        populateFormWithSampleData(sampleData);
        console.log(`✅ populateFormWithSampleData completed`);
      } catch (error) {
        console.error(`❌ Error in populateFormWithSampleData:`, error);
      }
    } else {
      console.warn(`⚠️ No sample data found for preset ${presetId}`);
    }
    
    // Update preview
    console.log(`🔄 Updating preview...`);
    try {
      _statAnimationNeeded = true;
      updatePreview();
      console.log(`✅ updatePreview completed`);
    } catch (error) {
      console.error(`❌ Error in updatePreview:`, error);
    }
    
    console.log(`✨ Preset ${presetId} applied successfully`);
  }
  
  function populateFormWithSampleData(sampleData) {
    console.log('📊 populateFormWithSampleData called with:', sampleData);
    
    // Populate basic character info
    if (sampleData.name) {
      const nameField = document.getElementById('card-name');
      console.log('🏷️ Name field:', nameField, 'Setting to:', sampleData.name);
      if (nameField) {
        nameField.value = sampleData.name;
        console.log('✅ Name field populated:', nameField.value);
      } else {
        console.error('❌ Name field not found!');
      }
    }
    
    if (sampleData.characterClass) {
      const classField = document.getElementById('card-class');
      console.log('🎭 Class field:', classField, 'Setting to:', sampleData.characterClass);
      if (classField) {
        classField.value = sampleData.characterClass;
        console.log('✅ Class field populated:', classField.value);
      } else {
        console.error('❌ Class field not found!');
      }
    }
    
    if (sampleData.biography) {
      const bioField = document.getElementById('card-bio');
      console.log('📖 Bio field:', bioField, 'Setting to:', sampleData.biography);
      if (bioField) {
        bioField.value = sampleData.biography;
        console.log('✅ Bio field populated:', bioField.value);
      } else {
        console.error('❌ Bio field not found!');
      }
    }
    
    if (sampleData.avatar) {
      const avatarField = document.getElementById('card-avatar');
      console.log('🖼️ Avatar field:', avatarField, 'Setting to:', sampleData.avatar);
      if (avatarField) {
        avatarField.value = sampleData.avatar;
        console.log('✅ Avatar field populated:', avatarField.value);
      } else {
        console.error('❌ Avatar field not found!');
      }
    }
    
    // Clear existing dynamic content
    clearAllDynamicRows();
    
    // Populate stats
    if (sampleData.stats && sampleData.stats.length > 0) {
      const statsContainer = document.getElementById('stats-editor');
      if (statsContainer) {
        sampleData.stats.forEach(stat => {
          const statRow = createStatRow(stat.name, stat.value);
          statsContainer.appendChild(statRow);
        });
        console.log(`✅ Populated ${sampleData.stats.length} stats`);
      } else {
        console.warn('⚠️ Stats container not found');
      }
    }
    
    // Populate badges
    if (sampleData.badges && sampleData.badges.length > 0) {
      const badgesContainer = document.getElementById('micro-editor');
      if (badgesContainer) {
        sampleData.badges.forEach(badge => {
          const badgeRow = createMicroBadgeRow(badge.category, badge.icon, badge.description, badge.quantity);
          badgesContainer.appendChild(badgeRow);
        });
        console.log(`✅ Populated ${sampleData.badges.length} badges`);
      } else {
        console.warn('⚠️ Badges container not found');
      }
    }
    
    // Populate attributes
    if (sampleData.attributes && sampleData.attributes.length > 0) {
      const attributesContainer = document.getElementById('attribute-editor');
      if (attributesContainer) {
        sampleData.attributes.forEach(attribute => {
          const attributeRow = createAttributeRow(attribute.name, attribute.value);
          attributesContainer.appendChild(attributeRow);
        });
        console.log(`✅ Populated ${sampleData.attributes.length} attributes`);
      } else {
        console.warn('⚠️ Attributes container not found');
      }
    }
    
    console.log(`📝 Form populated with sample data:`, sampleData);
  }
  
  function clearAllDynamicRows() {
    // Clear stats
    const statsContainer = document.getElementById('stats-editor');
    if (statsContainer) {
      statsContainer.innerHTML = '';
    }
    
    // Clear badges
    const badgesContainer = document.getElementById('micro-editor');
    if (badgesContainer) {
      badgesContainer.innerHTML = '';
    }
    
    // Clear attributes
    const attributesContainer = document.getElementById('attribute-editor');
    if (attributesContainer) {
      attributesContainer.innerHTML = '';
    }
    
    console.log('🧹 Cleared all dynamic form rows');
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
    console.log('🔍 Vertical alignment debug:', {
      section: verticalAlignmentSection,
      sectionExists: !!verticalAlignmentSection,
      imageContainer: ModularState.imageContainer,
      verticalAlignment: ModularState.verticalAlignment,
      isFullbleed: ModularState.imageContainer === 'fullbleed'
    });
    
    if (verticalAlignmentSection) {
      // Show vertical alignment only for fullbleed containers
      const showVerticalAlignment = ModularState.imageContainer === 'fullbleed';
      
      // Force show with important style
      if (showVerticalAlignment) {
        verticalAlignmentSection.style.setProperty('display', 'block', 'important');
        verticalAlignmentSection.style.visibility = 'visible';
        verticalAlignmentSection.style.opacity = '1';
        console.log(`📐 FORCED vertical alignment section VISIBLE for fullbleed container`);
      } else {
        verticalAlignmentSection.style.display = 'none';
        console.log(`📐 Vertical alignment section HIDDEN for container: ${ModularState.imageContainer}`);
      }
      
      // Update vertical alignment selection if visible
      if (showVerticalAlignment) {
        const verticalAlignmentOptions = document.querySelectorAll('[data-tier="4"] .vertical-alignment-level .tier-option');
        console.log(`🔍 Found ${verticalAlignmentOptions.length} vertical alignment options`);
        verticalAlignmentOptions.forEach(option => {
          const isSelected = option.dataset.value === ModularState.verticalAlignment;
          option.classList.toggle('selected', isSelected);
          console.log(`🎯 Option ${option.dataset.value}: ${isSelected ? 'SELECTED' : 'not selected'}`);
        });
        console.log(`✅ Updated vertical alignment selection to: ${ModularState.verticalAlignment}`);
      }
    } else {
      console.error('❌ Vertical alignment section not found! Element with ID "vertical-alignment-section" does not exist.');
      // Try to find it with a different selector
      const altSection = document.querySelector('.vertical-alignment-level');
      console.log('🔍 Alternative search result:', altSection);
    }
    
    // Level 2: Alignment Weight
    const alignmentWeightOptions = document.querySelectorAll('[data-tier="2"] .alignment-weight .tier-option');
    alignmentWeightOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.alignmentWeight);
    });
    
    // Level 3: Alignment Style
    const alignmentStyleOptions = document.querySelectorAll('[data-tier="2"] .alignment-style .tier-option');
    alignmentStyleOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.alignmentStyle);
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
    
    // Update Tier 2: Image Container & Effects (consolidated)
    const containerOptions = document.querySelectorAll('[data-tier="2"] .tier-option');
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
    
    // Update Image Effects (sub-section of Tier 2)
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-level .tier-option');
    effectOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.imageEffect);
    });
    
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
  }

  // ===== MODULAR SYSTEM INITIALIZATION =====
  function initModularSystem() {
    console.log('🎯 Initializing modular tier systems...');
    
    // Initialize collapsible tier system
    initCollapsibleTiers();
    
    // Initialize all modular tiers
    // initTier1Layout() REMOVED - Phase 1 of Flow Restructure
    initTier2ImageContainer(); // Image Container in Tier 2
    // initTier3ImageEffects(); // Image Effects - TEMPORARILY DISABLED
    initTier3Palette(); // Color Palette moved to Tier 4 (function name needs updating)
    initTier4Alignment(); // Content Alignment moved to Tier 5 (function name needs updating)
    // initTier5Weight(); // REMOVED - Standalone Visual Weight tier (redundant with Content Alignment weight distribution)
    
    console.log('✅ Core modular tiers initialized');
  }

  // ===== COLLAPSIBLE TIER SYSTEM =====
  function initCollapsibleTiers() {
    console.log('🎯 Initializing collapsible tier system...');
    
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
          console.log(`📁 Collapsed tier ${tierId}`);
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
          console.log(`📂 Expanded tier ${tierId}`);
        }
      });
    });
    
    // Initialize with all tiers collapsed by default
    document.querySelectorAll('.collapsible-tier').forEach(tier => {
      tier.classList.remove('expanded');
    });
    
    console.log('✅ Collapsible tier system initialized');
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
    
    console.log(`🔄 Updated tier ${tierId} selection display: ${displayText}`);
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
    const alignmentWeight = ModularState.alignmentWeight || 'balanced';
    const alignmentStyle = ModularState.alignmentStyle || 'padded';
    
    const alignmentTypeLabel = alignmentType.charAt(0).toUpperCase() + alignmentType.slice(1);
    const alignmentWeightLabel = alignmentWeight.charAt(0).toUpperCase() + alignmentWeight.slice(1);
    const alignmentStyleLabel = alignmentStyle.charAt(0).toUpperCase() + alignmentStyle.slice(1);
    
    const alignmentDisplayText = `${alignmentTypeLabel} ${alignmentWeightLabel} ${alignmentStyleLabel}`;
    const alignmentPreviewClass = `${alignmentType}-alignment-preview`;
    updateTierCurrentSelection('2', alignmentDisplayText, alignmentPreviewClass);
    
    // Update Tier 3: Color Palette display
    const selectedPalette = document.querySelector('.palette-family.selected');
    if (selectedPalette) {
      const paletteLabel = selectedPalette.querySelector('.palette-label').textContent;
      const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
      const previewClass = `${ModularState.palette}-preview`;
      updateTierCurrentSelection('3', `${paletteLabel} ${variantLabel}`, previewClass);
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
    
    console.log('🔄 Updated all collapsible tier displays');
  }

  // ===== TIER 1: LAYOUT REMOVED =====
  // Phase 1 of Flow Restructure: Layout initialization eliminated
  // Image-first design: Image Container moved to Tier 2 position

  // ===== TIER 4: CONTENT ALIGNMENT (SIMPLE WORKING SYSTEM) =====
  function initTier4Alignment() {
    console.log('🎯 Initializing Tier 4: Content Alignment...');
    
    // Initialize alignment event handlers
    initAlignmentEventHandlers();
    
    console.log('✅ Tier 4 Content Alignment initialized');
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
        console.log(`📐 Horizontal alignment: ${ModularState.horizontalAlignment}`);
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
        console.log(`📐 Vertical alignment: ${ModularState.verticalAlignment}`);
      });
    });
    
    // Weight distribution handlers
    const weightOptions = document.querySelectorAll('[data-tier="4"] .weight-option');
    weightOptions.forEach(option => {
      option.addEventListener('click', () => {
        weightOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        ModularState.alignmentWeight = option.dataset.weight;
        updatePreview();
        console.log(`⚖️ Weight distribution: ${ModularState.alignmentWeight}`);
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
        console.log(`🎨 Style variant: ${ModularState.alignmentStyle}`);
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
        
        console.log(`⚖️ Weight updated: ${ModularState.weight}`);
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
        const previewClass = `${ModularState.palette}-preview`;
        updateTierCurrentSelection('3', `${paletteLabel} ${variantLabel}`, previewClass);
        
        // Update preview
        updatePreview();
        
        console.log(`🎨 Palette updated: ${ModularState.palette}`);
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
        
        console.log(`💡 Palette variant updated: ${ModularState.paletteVariant}`);
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
        
        console.log(`📝 Text color updated: ${ModularState.textColor}`);
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

  // ===== PREVIEW UPDATE SYSTEM =====
  function updatePreview() {
    console.log('🎨 Updating card preview with modular system...');
    
    const front = document.querySelector('.card-preview-zone .card-front');
    const back = document.querySelector('.card-preview-zone .card-back');
    
    if (!front || !back) {
      console.warn('⚠️ Card preview elements not found');
      return;
    }
    
    // Shared classes — palette, container, effects (apply to both faces)
    const sharedClasses = [
      `palette-${ModularState.palette}`,
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
      `align-weight-${ModularState.alignmentWeight}`,
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
    
    // Apply classes: front gets alignment + shared; back gets shared only
    front.className = `card-preview-canvas card-front ${frontOnlyClasses.join(' ')} ${sharedClasses.join(' ')}`;
    back.className = `card-preview-canvas card-back ${sharedClasses.join(' ')}`;
    
    // Set data attributes for advanced styling
    const dataAttributes = {
      // 'data-layout': ModularState.layout, REMOVED - Phase 1 of Flow Restructure
      'data-alignment-type': ModularState.horizontalAlignment,
      'data-alignment-weight': ModularState.alignmentWeight,
      'data-alignment-style': ModularState.alignmentStyle,
      'data-palette': ModularState.palette,
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
    
    // Equalize card heights after content update
    setTimeout(() => {
      setEqualCardHeight();
    }, 50); // Small delay to ensure content is rendered
    
    console.log('✅ Card preview updated with modular system:', {
      // layout: ModularState.layout, REMOVED - Phase 1 of Flow Restructure
      palette: `${ModularState.palette}-${ModularState.paletteVariant}`,
      imageContainer: `${ModularState.imageContainer}-${ModularState.imageContainerVariant}`
    });
  }

  // ===== CARD CONTENT UPDATE =====
  function updateCardContent() {
    // Collect all data first
    const statsData = collectStatsData();
    const socialData = collectSocialLinksData();
    const badgesData = collectBadgesData();
    const attributesData = collectAttributesData();
    
    // Collect biography separately
    const biographyField = document.getElementById('card-bio');
    const biography = biographyField?.value?.trim() || '';
    
    // Build complete card data object
    const cardData = {
      name: document.getElementById('card-name')?.value || 'Aria Shadowbane',
      characterClass: document.getElementById('card-class')?.value || '',
      rarity: document.getElementById('card-rarity')?.value || '',
      quote: document.getElementById('card-quote')?.value || 'Shadows are my allies, silence my weapon.',
      avatar: document.getElementById('card-avatar')?.value || '',
      biography: biography,
      stats: statsData,
      socialLinks: socialData,
      badges: badgesData,
      attributes: attributesData
    };
    
    console.log('📋 Complete card data with all sections:', cardData);
    console.log('📊 Stats count:', cardData.stats.length);
    console.log('🔗 Social links count:', cardData.socialLinks.length);
    console.log('🏆 Badges count:', cardData.badges.length);
    console.log('⚡ Attributes count:', cardData.attributes.length);
    
    // Store the preview JSON data globally for save function to use
    window.lastPreviewCardData = cardData;
    console.log('💾 Stored preview data globally for save function');
    
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
                                'class-style-outlined', 'class-style-glow', 'class-has-icon');
      
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
      
      // Show element if rarity value exists
      element.style.display = '';
      
      // Remove existing rarity style classes
      element.classList.remove('rarity-style-default', 'rarity-style-badge', 'rarity-style-border',
                                'rarity-style-glow', 'rarity-style-foil', 'rarity-style-frame', 'rarity-has-icon');
      
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
    
    console.log('🎨 Applied class and rarity styles:', { 
      classStyle, rarityStyle, 
      classIcon, rarityIcon 
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
  
  console.log('🎯 Icon picker system initialized');
  
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
    
    console.log('📊 Collected stats:', stats);
    return stats;
  }
  
  function collectSocialLinksData() {
    const socialContainer = document.getElementById('social-editor');
    const socialLinks = [];
    
    if (socialContainer) {
      const socialRows = socialContainer.querySelectorAll('.social-row');
      socialRows.forEach(row => {
        const platformSelect = row.querySelector('select[name="social-name"]');
        const urlInput = row.querySelector('input[name="social-url"]');
        
        if (platformSelect && urlInput && urlInput.value.trim()) {
          socialLinks.push({
            platform: platformSelect.value,
            url: urlInput.value.trim()
          });
        }
      });
    }
    
    console.log('🔗 Collected social links:', socialLinks);
    return socialLinks;
  }
  
  function collectBadgesData() {
    const badgesContainer = document.getElementById('micro-editor');
    const badges = [];
    
    if (badgesContainer) {
      const badgeRows = badgesContainer.querySelectorAll('.micro-row');
      badgeRows.forEach(row => {
        const categoryInput = row.querySelector('input[name="micro-category"]');
        const iconInput = row.querySelector('input[name="micro-icon"]');
        const descInput = row.querySelector('input[name="micro-desc"]');
        const quantityInput = row.querySelector('input[name="micro-quantity"]');
        
        if (categoryInput && categoryInput.value.trim()) {
          badges.push({
            category: categoryInput.value.trim(),
            icon: iconInput ? iconInput.value : 'star',
            description: descInput ? descInput.value.trim() : '',
            quantity: parseInt(quantityInput?.value) || 1
          });
        }
      });
    }
    
    console.log('🏆 Collected badges:', badges);
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
    
    console.log('⚡ Collected attributes (including biography):', attributes);
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

    const visible = stats.slice(0, STAT_CAP);
    const overflow = stats.length - STAT_CAP;
    
    let html = visible.map((stat, index) => {
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

    return html;
  }
  
  function generateSocialLinksHTML(socialLinks) {
    if (!socialLinks || socialLinks.length === 0) {
      return '<div class="no-social">No social links available</div>';
    }
    
    const iconMap = {
      twitter: 'fab fa-twitter',
      github: 'fab fa-github',
      instagram: 'fab fa-instagram',
      linkedin: 'fab fa-linkedin',
      x: 'fab fa-x-twitter',
      deviantart: 'fab fa-deviantart',
      facebook: 'fab fa-facebook',
      discord: 'fab fa-discord',
      tiktok: 'fab fa-tiktok',
      youtube: 'fab fa-youtube'
    };

    const visible = socialLinks.slice(0, SOCIAL_CAP);
    const overflow = socialLinks.length - SOCIAL_CAP;
    
    let html = visible.map(social => {
      const iconClass = iconMap[social.platform] || 'fas fa-link';
      const platformName = social.platform.charAt(0).toUpperCase() + social.platform.slice(1);
      return `
        <a href="${social.url}" target="_blank" rel="noopener noreferrer" class="social-link" title="Visit ${platformName}">
          <i class="${iconClass}"></i>
        </a>
      `;
    }).join('');

    if (overflow > 0) {
      html += `<span class="social-overflow-indicator" title="${overflow} more links">+${overflow}</span>`;
    }

    return html;
  }
  
  function generateBadgesHTML(badges) {
    if (!badges || badges.length === 0) {
      return '<div class="no-badges">No badges available</div>';
    }
    
    const iconMap = {
      star: 'fas fa-star',
      trophy: 'fas fa-trophy',
      medal: 'fas fa-medal',
      crown: 'fas fa-crown',
      shield: 'fas fa-shield-alt',
      gem: 'fas fa-gem',
      fire: 'fas fa-fire',
      heart: 'fas fa-heart',
      bolt: 'fas fa-bolt',
      target: 'fas fa-bullseye'
    };

    const visible = badges.slice(0, BADGE_CAP);
    const overflow = badges.length - BADGE_CAP;
    
    let html = visible.map(badge => {
      const iconClass = iconMap[badge.icon] || 'fas fa-award';
      const quantity = badge.quantity || 1;
      
      // Create multiple icons within a single badge item
      const icons = Array.from({ length: quantity }, () => 
        `<i class="${iconClass}"></i>`
      ).join('');
      
      return `
        <div class="badge-item" title="${badge.description || badge.category}">
          <div class="badge-icon">
            ${icons}
          </div>
          <div class="badge-label">${badge.category}</div>
        </div>
      `;
    }).join('');

    if (overflow > 0) {
      html += `<div class="badges-overflow-indicator">+${overflow} more</div>`;
    }

    return html;
  }
  
  function generateAttributesHTML(attributes) {
    if (!attributes || attributes.length === 0) {
      return '<div class="no-attributes">No attributes available</div>';
    }

    const visible = attributes.slice(0, ATTRIBUTE_CAP);
    const overflow = attributes.length - ATTRIBUTE_CAP;
    
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
          <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
          <div class="hero-overlay">
            <h3 class="card-name">${data.name}</h3>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-class">${data.characterClass}</div>
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
          <div class="card-class">${data.characterClass}</div>
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
          <div class="card-class">${data.characterClass}</div>
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
          <div class="card-class">${data.characterClass}</div>
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
        <div class="card-class">${data.characterClass}</div>
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
            <div class="card-class">${data.characterClass}</div>
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

    const badgeCount = data.badges ? Math.min(data.badges.length, BADGE_CAP) : 0;
    
    back.innerHTML = `
    <div class="card-back-content">
      <div class="back-header">
        <h3 class="card-name">${data.name}</h3>
        <div class="card-class">${data.characterClass}</div>
      </div>
      <div class="back-body">
        ${data.biography ? `
        <div class="biography-section">
          <h4 class="section-title">Biography</h4>
          <div class="biography-text" data-full-bio="${data.biography.replace(/"/g, '&quot;')}">${data.biography}</div>
          <a class="bio-read-more" href="#">Read more &raquo;</a>
        </div>
        ` : ''}
        
        <div class="info-grid">
          <div class="back-section badges-section">
            <h4 class="section-title">Badges & Achievements</h4>
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
        
        <div class="social-section">
          <h4 class="section-title">Social Links</h4>
          <div class="social-links">
            ${generateSocialLinksHTML(data.socialLinks)}
          </div>
        </div>
      </div>
    </div>
  `;
  }

  // ===== OVERFLOW DETECTION — applies condensed mode when back face overflows =====
  function checkCardOverflow() {
    const back = document.querySelector('.card-preview-zone .card-back');
    if (!back) return;
    const backContent = back.querySelector('.card-back-content');
    if (!backContent) return;

    // Remove condensed first to measure natural height
    back.classList.remove('card-condensed');

    // Use requestAnimationFrame to measure after layout
    requestAnimationFrame(() => {
      const cardH = back.clientHeight;
      const contentH = backContent.scrollHeight;
      if (contentH > cardH) {
        back.classList.add('card-condensed');
      }
    });
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
    
    // Dynamic social links listeners
    initSocialListeners();
    
    // Class and Rarity style selectors
    const classStyleSelector = document.getElementById('class-style');
    const rarityStyleSelector = document.getElementById('rarity-style');
    
    if (classStyleSelector) {
      classStyleSelector.addEventListener('change', function() {
        console.log('Class style changed to:', this.value);
        updatePreview();
      });
    }
    
    if (rarityStyleSelector) {
      rarityStyleSelector.addEventListener('change', function() {
        console.log('Rarity style changed to:', this.value);
        updatePreview();
      });
    }
    
    // Initialize badge section toggle systems
    // Initialize icon pickers
    initIconPickers();
    
    console.log('🎧 Form listeners initialized for live preview');
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
  
  function initSocialListeners() {
    const socialContainer = document.getElementById('social-editor');
    if (socialContainer) {
      // Use event delegation for dynamic social rows
      socialContainer.addEventListener('change', function(e) {
        if (e.target.matches('select[name="social-name"]') || e.target.matches('input[name="social-url"]')) {
          updatePreview();
        }
      });
      
      socialContainer.addEventListener('input', function(e) {
        if (e.target.matches('input[name="social-url"]')) {
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
          'framed': 'classic',
          'raw': 'sharp',
          'fullbleed': 'standard',
          'hero': 'large'
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
        
        // Update Image Effects availability based on container type
        updateImageEffectsAvailability();
        
        // Update preview
        updatePreview();
        
        console.log(`🖼️ Image container updated: ${ModularState.imageContainer}-${ModularState.imageContainerVariant}`);
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
        
        console.log(`🎭 Container variant updated: ${ModularState.imageContainerVariant}`);
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
          'borders': 'solid',
          'overlays': 'vintage'
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
        
        console.log(`✨ Image effect updated: ${ModularState.imageEffect}-${ModularState.imageEffectVariant}`);
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
        
        console.log(`🎨 Effect variant updated: ${ModularState.imageEffectVariant}`);
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
    
    // Set initial Image Effects availability based on default container
    updateImageEffectsAvailability();
  }

  // ===== IMAGE EFFECTS SUB-LEVEL INITIALIZATION =====
  function initImageEffectsSubLevel() {
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-level .effects-type-grid .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="2"] .effects-level .effect-variants');
    
    // Effect Type Selection Handlers
    effectOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        effectOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageEffect = option.dataset.value;
        
        // Show/hide variant containers based on selected effect
        variantContainers.forEach(container => {
          const effectType = container.dataset.effect;
          container.style.display = effectType === ModularState.imageEffect ? 'block' : 'none';
        });
        
        // Set default variant for the selected effect
        const defaultVariants = {
          'none': 'clean',
          'filters': 'sepia',
          'borders': 'solid',
          'overlays': 'gradient'
        };
        
        ModularState.imageEffectVariant = defaultVariants[ModularState.imageEffect] || 'clean';
        
        // Update variant selection UI
        const activeVariantContainer = document.querySelector(`[data-tier="2"] .effects-level [data-effect="${ModularState.imageEffect}"]`);
        if (activeVariantContainer) {
          const variantOptions = activeVariantContainer.querySelectorAll('.variant-option');
          variantOptions.forEach(opt => opt.classList.remove('selected'));
          const defaultVariantOption = activeVariantContainer.querySelector(`[data-variant="${ModularState.imageEffectVariant}"]`);
          if (defaultVariantOption) {
            defaultVariantOption.classList.add('selected');
          }
        }
        
        // Update preview
        updatePreview();
        
        console.log(`✨ Image effect updated: ${ModularState.imageEffect} ${ModularState.imageEffectVariant}`);
      });
    });
    
    // Effect Variant Selection Handlers
    const variantOptions = document.querySelectorAll('[data-tier="2"] .effects-level .variant-option');
    variantOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state within the same variant container
        const container = option.closest('.effect-variants');
        const siblingOptions = container.querySelectorAll('.variant-option');
        siblingOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageEffectVariant = option.dataset.variant;
        
        // Update preview
        updatePreview();
        
        console.log(`🎨 Effect variant updated: ${ModularState.imageEffectVariant}`);
      });
    });
  }

  // ===== IMAGE EFFECTS AVAILABILITY CONTROL =====
  function updateImageEffectsAvailability() {
    const bordersOption = document.querySelector('[data-tier="2"] .effects-level .effects-grid [data-value="borders"]');
    
    if (bordersOption) {
      if (ModularState.imageContainer === 'masked') {
        // Hide borders option for masked containers (use Framed instead)
        bordersOption.style.display = 'none';
        
        // If borders was selected, switch to 'none' effect
        if (ModularState.imageEffect === 'borders') {
          ModularState.imageEffect = 'none';
          ModularState.imageEffectVariant = 'clean';
          
          // Update UI selection
          const noneOption = document.querySelector('[data-tier="2"] .effects-level .effects-grid [data-value="none"]');
          if (noneOption) {
            // Clear all effect selections
            const allEffectOptions = document.querySelectorAll('[data-tier="2"] .effects-level .effects-grid .tier-option');
            allEffectOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Select 'none' option
            noneOption.classList.add('selected');
          }
          
          // Hide all effect variant containers
          const variantContainers = document.querySelectorAll('[data-tier="2"] .effects-level .effect-variants');
          variantContainers.forEach(container => {
            container.style.display = 'none';
          });
          
          console.log('🚫 Borders disabled for masked container - switched to None effect');
        }
      } else {
        // Show borders option for other containers
        bordersOption.style.display = 'block';
      }
    }
  }

  // ===== IMAGE EFFECTS SUB-LEVEL (within Tier 2) =====
  function initImageEffectsSubLevel() {
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-level .effects-grid .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="2"] .effects-level .effect-variants');
    
    effectOptions.forEach(option => {
      option.addEventListener('click', () => {
        effectOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        ModularState.imageEffect = option.dataset.value;
        
        variantContainers.forEach(container => {
          const effectType = container.dataset.effect;
          container.style.display = effectType === ModularState.imageEffect ? 'block' : 'none';
        });
        
        const defaultVariants = {
          'none': 'clean',
          'filters': 'sepia',
          'borders': 'solid',
          'overlays': 'gradient'
        };
        
        ModularState.imageEffectVariant = defaultVariants[ModularState.imageEffect] || 'clean';
        
        const activeVariantContainer = document.querySelector(`[data-tier="2"] .effects-level [data-effect="${ModularState.imageEffect}"]`);
        if (activeVariantContainer) {
          const variantOptions = activeVariantContainer.querySelectorAll('.variant-option');
          variantOptions.forEach(opt => opt.classList.remove('selected'));
          const defaultVariantOption = activeVariantContainer.querySelector(`[data-variant="${ModularState.imageEffectVariant}"]`);
          if (defaultVariantOption) defaultVariantOption.classList.add('selected');
        }
        
        updatePreview();
      });
    });
    
    const variantOptions = document.querySelectorAll('[data-tier="2"] .effects-level .effect-variants .variant-option');
    variantOptions.forEach(option => {
      option.addEventListener('click', () => {
        const container = option.closest('.effect-variants');
        const siblingOptions = container.querySelectorAll('.variant-option');
        siblingOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        ModularState.imageEffectVariant = option.dataset.variant;
        updatePreview();
      });
    });
  }

  // ===== WORKING MODULAR SYSTEM INITIALIZATION =====
  function initTier2ImageContainer() {
    console.log('🔧 Applying EXACT working browser fixes...');

    // Container type event handlers
    const containerOptions = document.querySelectorAll('[data-tier="2"] .container-grid .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="2"] .container-variants');

    containerOptions.forEach(option => {
      option.addEventListener('click', () => {
        console.log('🎯 Container clicked:', option.dataset.value);
        
        // Update selection state
        containerOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageContainer = option.dataset.value;
        console.log('📦 Updated imageContainer:', ModularState.imageContainer);
        
        // Show/hide relevant variant options
        variantContainers.forEach(container => {
          const containerType = container.dataset.container;
          if (containerType === ModularState.imageContainer) {
            container.style.display = 'block';
            console.log(`👁️ Showing variants for: ${containerType}`);
          } else {
            container.style.display = 'none';
          }
        });
        
        // Set default variant for the selected container
        const defaultVariants = {
          'masked': 'circle',
          'framed': 'classic', 
          'raw': 'sharp',
          'fullbleed': 'standard',
          'hero': 'large'
        };
        ModularState.imageContainerVariant = defaultVariants[ModularState.imageContainer] || 'circle';
        console.log('🎨 Set default variant:', ModularState.imageContainerVariant);
        
        // Show/hide vertical alignment controls based on container type
        const verticalAlignmentSection = document.getElementById('vertical-alignment-section');
        if (verticalAlignmentSection) {
          if (ModularState.imageContainer === 'fullbleed') {
            verticalAlignmentSection.style.display = 'block';
            console.log('👁️ Showing vertical alignment for Full Bleed');
          } else {
            verticalAlignmentSection.style.display = 'none';
            console.log('🙈 Hiding vertical alignment for non-Full Bleed containers');
          }
        }
        
        // Update preview
        updatePreview();
        console.log('🔄 Called updatePreview for container');
      });
    });

    // Container variant event handlers
    const containerVariantOptions = document.querySelectorAll('[data-tier="2"] .container-variants .variant-option');
    containerVariantOptions.forEach(option => {
      option.addEventListener('click', () => {
        console.log('🎯 Container variant clicked:', option.dataset.variant);
        
        // Update ModularState for CONTAINER variant
        ModularState.imageContainerVariant = option.dataset.variant;
        console.log('📦 Updated imageContainerVariant:', ModularState.imageContainerVariant);
        
        // Update selection state within this variant group
        const siblingVariants = option.parentNode.querySelectorAll('.variant-option');
        siblingVariants.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update preview
        updatePreview();
        console.log('🔄 Called updatePreview for container variant');
      });
    });

    // Image effects event handlers
    const effectOptions = document.querySelectorAll('[data-tier="2"] .effects-grid .tier-option');
    const effectVariantContainers = document.querySelectorAll('[data-tier="2"] .effect-variants');

    effectOptions.forEach(option => {
      option.addEventListener('click', () => {
        console.log('🎯 Effect clicked:', option.dataset.value);
        
        // Update selection state
        effectOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageEffect = option.dataset.value;
        console.log('✨ Updated imageEffect:', ModularState.imageEffect);
        
        // Show/hide relevant effect variant options
        effectVariantContainers.forEach(container => {
          const effectType = container.dataset.effect;
          if (effectType === ModularState.imageEffect) {
            container.style.display = 'block';
            console.log(`👁️ Showing effect variants for: ${effectType}`);
          } else {
            container.style.display = 'none';
          }
        });
        
        // Set default variant for the selected effect
        const defaultEffectVariants = {
          'none': 'clean',
          'filters': 'sepia',
          'borders': 'solid'
        };
        ModularState.imageEffectVariant = defaultEffectVariants[ModularState.imageEffect] || 'clean';
        console.log('🎨 Set default effect variant:', ModularState.imageEffectVariant);
        
        // Update preview
        updatePreview();
        console.log('🔄 Called updatePreview for effect');
      });
    });

    // Effect variant event handlers
    const effectVariantOptions = document.querySelectorAll('[data-tier="2"] .effect-variants .variant-option');
    effectVariantOptions.forEach(option => {
      option.addEventListener('click', () => {
        console.log('🎯 Effect variant clicked:', option.dataset.variant);
        
        // Update ModularState for EFFECT variant
        ModularState.imageEffectVariant = option.dataset.variant;
        console.log('✨ Updated imageEffectVariant:', ModularState.imageEffectVariant);
        
        // Update selection state within this variant group
        const siblingVariants = option.parentNode.querySelectorAll('.variant-option');
        siblingVariants.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update preview
        updatePreview();
        console.log('🔄 Called updatePreview for effect variant');
      });
    });

    console.log('✅ EXACT working browser fixes applied successfully!');
    console.log('🎯 Container options found:', containerOptions.length);
    console.log('🎨 Container variant options found:', containerVariantOptions.length);
    console.log('✨ Effect options found:', effectOptions.length);
    console.log('🔧 Effect variant options found:', effectVariantOptions.length);
  }

  // ===== DEFAULT CLASS AND RARITY STYLING =====
  function initDefaultClassAndRarityStyles() {
    console.log('🎨 Initializing default class and rarity styles...');
    
    // Set default class styling
    const classStyleField = document.getElementById('class-style');
    if (classStyleField) {
      classStyleField.value = 'badge';
      console.log('✅ Default class style set to: badge');
    }
    
    const classIconField = document.getElementById('class-icon-value');
    if (classIconField) {
      classIconField.value = 'khanda';
      // Update visual selection
      const classIconOptions = document.querySelectorAll('#class-section .icon-option');
      classIconOptions.forEach(option => {
        option.classList.toggle('selected', option.dataset.icon === 'khanda');
      });
      console.log('✅ Default class icon set to: khanda');
    }
    
    // Set default rarity styling
    const rarityStyleField = document.getElementById('rarity-style');
    if (rarityStyleField) {
      rarityStyleField.value = 'glow';
      console.log('✅ Default rarity style set to: glow');
    }
    
    const rarityIconField = document.getElementById('rarity-icon-value');
    if (rarityIconField) {
      rarityIconField.value = 'gem';
      // Update visual selection
      const rarityIconOptions = document.querySelectorAll('#rarity-section .icon-option');
      rarityIconOptions.forEach(option => {
        option.classList.toggle('selected', option.dataset.icon === 'gem');
      });
      console.log('✅ Default rarity icon set to: gem');
    }
    
    console.log('✨ Default class and rarity styles initialized');
  }
  
  // Note: Default styles initialization moved to main DOMContentLoaded listener to avoid conflicts
  
  // Expose global functions for external access
  window.CardForge = {
    updatePreview,
    initImageGallery,
    initTier2ImageContainer,
    rollRandomCard,
    ModularState
  };

})();

// ===== PLACEHOLDER FOR ADDITIONAL TIERS =====
// TODO: Add Tier 2 (Alignment), Tier 3 (Weight), Tier 5 (Image Container), Tier 6 (Effects)
// TODO: Add dynamic form editors (Stats, Social, Badges, Attributes)

// ===== HEIGHT EQUALIZATION FOR CARD PREVIEW (added by Cascade) =====
function setEqualCardHeight() {
  // Card height is now enforced by CSS via --card-height (canonical card dimensions).
  // This function is kept as a no-op for backward compatibility with callers.
}

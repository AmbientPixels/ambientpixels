// CardForge V2 - Modular System Implementation
// Clean implementation of the 6-tier modular card design system
// Updated: 2025-07-30 - Fresh start with modular architecture

(function() {
  'use strict';

  // ===== MODULAR SYSTEM STATE =====
  const ModularState = {
    // Tier 1: Base Layout
    layout: 'hero',
    
    // Tier 2: Content Alignment
    alignment: 'center',
    
    // Tier 3: Visual Weight
    weight: 'balanced',
    
    // Tier 4: Color Palette
    palette: 'neon',
    paletteVariant: 'light',
    
    // Tier 5: Image Container
    imageContainer: 'masked',
    imageContainerVariant: 'circle',
    
    // Tier 6: Image Effects
    imageEffect: 'none',
    imageEffectVariant: 'clean'
  };
  
  // ===== PRESET CONFIGURATIONS =====
  const PresetConfigurations = {
    'hero-classic': {
      layout: 'hero',
      alignment: 'center',
      weight: 'balanced',
      palette: 'neon',
      paletteVariant: 'light',
      imageContainer: 'masked',
      imageContainerVariant: 'circle',
      imageEffect: 'none',
      imageEffectVariant: 'clean'
    },
    'split-modern': {
      layout: 'split',
      alignment: 'left',
      weight: 'top-heavy',
      palette: 'ocean',
      paletteVariant: 'dark',
      imageContainer: 'framed',
      imageContainerVariant: 'modern',
      imageEffect: 'borders',
      imageEffectVariant: 'solid'
    },
    'minimal-glow': {
      layout: 'minimal',
      alignment: 'center',
      weight: 'balanced',
      palette: 'monochrome',
      paletteVariant: 'light',
      imageContainer: 'raw',
      imageContainerVariant: 'rounded',
      imageEffect: 'borders',
      imageEffectVariant: 'glow'
    },
    'fullbleed-cinematic': {
      layout: 'hero',
      alignment: 'center',
      weight: 'bottom-heavy',
      palette: 'sunset',
      paletteVariant: 'dark',
      imageContainer: 'fullbleed',
      imageContainerVariant: 'none',
      imageEffect: 'filters',
      imageEffectVariant: 'sepia'
    },
    'framed-ornate': {
      layout: 'hero',
      alignment: 'center',
      weight: 'top-heavy',
      palette: 'earth',
      paletteVariant: 'light',
      imageContainer: 'framed',
      imageContainerVariant: 'ornate',
      imageEffect: 'borders',
      imageEffectVariant: 'neon'
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
    
    statRow.querySelector('input[name="stat-name"]').addEventListener('input', updatePreview);
    
    removeBtn.addEventListener('click', function() {
      statRow.remove();
      updatePreview();
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
      updatePreview();
    });
    
    return badgeRow;
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
    
    // Initialize form listeners for live preview
    initFormListeners();
    
    console.log('✅ Dynamic editors initialized');
  }
  
  function initStatsEditor() {
    const addStatBtn = document.getElementById('add-stat-btn');
    if (addStatBtn) {
      addStatBtn.addEventListener('click', function() {
        const statsContainer = document.getElementById('stats-editor');
        const newStatRow = createStatRow();
        statsContainer.appendChild(newStatRow);
        console.log('📊 New stat row added');
      });
    }
  }
  
  function initSocialEditor() {
    const addSocialBtn = document.getElementById('add-social-btn');
    if (addSocialBtn) {
      addSocialBtn.addEventListener('click', function() {
        const socialContainer = document.getElementById('social-editor');
        const newSocialRow = createSocialRow();
        socialContainer.appendChild(newSocialRow);
        console.log('🔗 New social row added');
      });
    }
  }

  function initBadgesEditor() {
    const addBadgeBtn = document.getElementById('add-micro-btn');
    if (addBadgeBtn) {
      addBadgeBtn.addEventListener('click', function() {
        const badgesContainer = document.getElementById('micro-editor');
        const newBadgeRow = createBadgeRow();
        badgesContainer.appendChild(newBadgeRow);
        console.log('🏆 New badge row added');
      });
    }
  }

  function initAttributesEditor() {
    const addAttributeBtn = document.getElementById('add-attribute-btn');
    if (addAttributeBtn) {
      addAttributeBtn.addEventListener('click', function() {
        const attributesContainer = document.getElementById('attribute-editor');
        const newAttributeRow = createAttributeRow();
        attributesContainer.appendChild(newAttributeRow);
        console.log('⚡ New attribute row added');
      });
    }
  }

  // Initialize everything when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 CardForge Editor initializing...');
    
    initPresets();
    initDynamicEditors();
    loadPrefillData();
    
    // Initialize modular tier system
    initModularSystem();
    
    // Initialize image gallery
    initImageGallery();
    
    // Initialize card flip functionality
    initCardFlip();
    
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
    
    presetButtons.forEach(button => {
      button.addEventListener('click', () => {
        const presetId = button.dataset.preset;
        applyPreset(presetId);
        
        // Update active state
        presetButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        console.log(`🎨 Applied preset: ${presetId}`);
      });
    });
    
    console.log('🚀 Presets initialized');
  }
  
  function applyPreset(presetId) {
    const config = PresetConfigurations[presetId];
    if (!config) {
      console.warn(`Preset ${presetId} not found`);
      return;
    }
    
    // Update ModularState with preset configuration
    Object.assign(ModularState, config);
    
    // Update all UI controls to reflect the preset
    updateUIFromState();
    
    // Update the preview
    updatePreview();
    
    console.log(`✨ Preset ${presetId} applied:`, config);
  }
  
  function updateUIFromState() {
    // Update Tier 1: Layout
    const layoutOptions = document.querySelectorAll('[data-tier="1"] .tier-option');
    layoutOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.layout);
    });
    
    // Update Tier 2: Alignment
    const alignmentOptions = document.querySelectorAll('[data-tier="2"] .tier-option');
    alignmentOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.alignment);
    });
    
    // Update Tier 3: Weight
    const weightOptions = document.querySelectorAll('[data-tier="3"] .tier-option');
    weightOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.weight);
    });
    
    // Update Tier 4: Palette
    const paletteOptions = document.querySelectorAll('[data-tier="4"] .palette-family');
    paletteOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.palette === ModularState.palette);
    });
    
    const variantToggles = document.querySelectorAll('[data-tier="4"] .variant-toggle');
    variantToggles.forEach(toggle => {
      toggle.classList.toggle('selected', toggle.dataset.variant === ModularState.paletteVariant);
    });
    
    // Update Tier 5: Image Container
    const containerOptions = document.querySelectorAll('[data-tier="5"] .tier-option');
    containerOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.imageContainer);
    });
    
    // Show/hide container variants
    const variantContainers = document.querySelectorAll('[data-tier="5"] .container-variants');
    variantContainers.forEach(container => {
      const containerType = container.dataset.container;
      container.style.display = containerType === ModularState.imageContainer ? 'block' : 'none';
    });
    
    // Update container variant selection
    const activeContainer = document.querySelector(`[data-tier="5"] [data-container="${ModularState.imageContainer}"]`);
    if (activeContainer) {
      const variantOptions = activeContainer.querySelectorAll('.variant-option');
      variantOptions.forEach(option => {
        option.classList.toggle('selected', option.dataset.variant === ModularState.imageContainerVariant);
      });
    }
    
    // Update Tier 6: Effects
    const effectOptions = document.querySelectorAll('[data-tier="6"] .tier-option');
    effectOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.imageEffect);
    });
    
    // Update collapsible tier current selection displays
    updateCollapsibleTierDisplays();
  }

  // ===== MODULAR SYSTEM INITIALIZATION =====
  function initModularSystem() {
    console.log('🎯 Initializing modular tier systems...');
    
    // Initialize collapsible tier system
    initCollapsibleTiers();
    
    // Initialize all modular tiers
    initTier1Layout();
    initTier2Alignment();
    initTier3Weight();
    initTier4Palette();
    initTier5Container();
    initTier6Effects();
    
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
    
    // Update Tier 4: Color Palette display
    const selectedPalette = document.querySelector('[data-tier="4"] .palette-family.selected');
    if (selectedPalette) {
      const paletteLabel = selectedPalette.querySelector('.palette-label').textContent;
      const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
      const previewClass = `${ModularState.palette}-preview`;
      updateTierCurrentSelection('4', `${paletteLabel} ${variantLabel}`, previewClass);
    }
    
    // Update Tier 5: Image Container display
    const selectedContainer = document.querySelector('[data-tier="5"] .tier-option.selected');
    if (selectedContainer) {
      const containerLabel = selectedContainer.querySelector('.option-label').textContent;
      const variantLabel = ModularState.imageContainerVariant.charAt(0).toUpperCase() + ModularState.imageContainerVariant.slice(1);
      const previewClass = `${ModularState.imageContainer}-container-preview`;
      updateTierCurrentSelection('5', `${containerLabel} ${variantLabel}`, previewClass);
    }
    
    // Update Tier 3: Visual Weight display
    const selectedWeight = document.querySelector('[data-tier="3"] .tier-option.selected');
    if (selectedWeight) {
      const weightLabel = selectedWeight.querySelector('.option-label').textContent;
      const previewClass = `${ModularState.weight}-weight-preview`;
      updateTierCurrentSelection('3', weightLabel, previewClass);
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

  // ===== TIER 1: BASE LAYOUT =====
  function initTier1Layout() {
    const layoutOptions = document.querySelectorAll('[data-tier="1"] .tier-option');
    
    layoutOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        layoutOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.layout = option.dataset.value;
        
        // Update current selection display
        const layoutLabel = option.querySelector('.option-label').textContent;
        const previewClass = `${ModularState.layout}-layout-preview`;
        updateTierCurrentSelection('1', layoutLabel, previewClass);
        
        // Update preview
        updatePreview();
        
        console.log(`🎨 Layout updated: ${ModularState.layout}`);
      });
    });
    
    // Set default selection
    const defaultOption = document.querySelector(`[data-tier="1"] [data-value="${ModularState.layout}"]`);
    if (defaultOption) {
      defaultOption.classList.add('selected');
      
      // Initialize current selection display with default values
      const layoutLabel = defaultOption.querySelector('.option-label').textContent;
      const previewClass = `${ModularState.layout}-layout-preview`;
      updateTierCurrentSelection('1', layoutLabel, previewClass);
    }
  }

  // ===== TIER 2: CONTENT ALIGNMENT =====
  function initTier2Alignment() {
    const alignmentOptions = document.querySelectorAll('[data-tier="2"] .tier-option');
    
    alignmentOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        alignmentOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.alignment = option.dataset.value;
        
        // Update preview
        updatePreview();
        
        console.log(`📐 Alignment updated: ${ModularState.alignment}`);
      });
    });
    
    // Set default selection
    const defaultOption = document.querySelector(`[data-tier="2"] [data-value="${ModularState.alignment}"]`);
    if (defaultOption) {
      defaultOption.classList.add('selected');
    }
  }

  // ===== TIER 3: VISUAL WEIGHT =====
  function initTier3Weight() {
    const weightOptions = document.querySelectorAll('[data-tier="3"] .tier-option');
    
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
    const defaultOption = document.querySelector(`[data-tier="3"] [data-value="${ModularState.weight}"]`);
    if (defaultOption) {
      defaultOption.classList.add('selected');
      
      // Initialize current selection display with default values
      const weightLabel = defaultOption.querySelector('.option-label').textContent;
      const previewClass = `${ModularState.weight}-weight-preview`;
      updateTierCurrentSelection('3', weightLabel, previewClass);
    }
  }

  // ===== TIER 4: COLOR PALETTE =====
  function initTier4Palette() {
    // Palette family selection
    const paletteOptions = document.querySelectorAll('[data-tier="4"] .palette-family');
    const variantToggles = document.querySelectorAll('[data-tier="4"] .variant-toggle');
    
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
        updateTierCurrentSelection('4', `${paletteLabel} ${variantLabel}`, previewClass);
        
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
        const selectedPalette = document.querySelector('[data-tier="4"] .palette-family.selected');
        if (selectedPalette) {
          const paletteLabel = selectedPalette.querySelector('.palette-label').textContent;
          const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
          const previewClass = `${ModularState.palette}-preview`;
          updateTierCurrentSelection('4', `${paletteLabel} ${variantLabel}`, previewClass);
        }
        
        // Update preview
        updatePreview();
        
        console.log(`💡 Palette variant updated: ${ModularState.paletteVariant}`);
      });
    });
    
    // Set default selections
    const defaultPalette = document.querySelector(`[data-tier="4"] [data-palette="${ModularState.palette}"]`);
    const defaultVariant = document.querySelector(`[data-tier="4"] [data-variant="${ModularState.paletteVariant}"]`);
    
    if (defaultPalette) defaultPalette.classList.add('selected');
    if (defaultVariant) defaultVariant.classList.add('selected');
    
    // Initialize current selection display with default values
    if (defaultPalette) {
      const paletteLabel = defaultPalette.querySelector('.palette-label').textContent;
      const variantLabel = ModularState.paletteVariant.charAt(0).toUpperCase() + ModularState.paletteVariant.slice(1);
      const previewClass = `${ModularState.palette}-preview`;
      updateTierCurrentSelection('4', `${paletteLabel} ${variantLabel}`, previewClass);
    }
  }

  // ===== PREVIEW UPDATE SYSTEM =====
  function updatePreview() {
    console.log('🎨 Updating card preview with modular system...');
    
    const front = document.querySelector('.card-front');
    const back = document.querySelector('.card-back');
    
    if (!front || !back) {
      console.warn('⚠️ Card preview elements not found');
      return;
    }
    
    // Apply modular CSS classes
    const modularClasses = [
      `layout-${ModularState.layout}`,
      `align-${ModularState.alignment}`,
      `weight-${ModularState.weight}`,
      `palette-${ModularState.palette}`,
      `variant-${ModularState.paletteVariant}`,
      `container-${ModularState.imageContainer}`,
      `container-variant-${ModularState.imageContainerVariant}`,
      `effect-${ModularState.imageEffect}`
    ];
    
    // Apply classes to both front and back
    front.className = `card-preview-canvas card-front ${modularClasses.join(' ')}`;
    back.className = `card-preview-canvas card-back ${modularClasses.join(' ')}`;
    
    // Set data attributes for advanced styling
    const dataAttributes = {
      'data-layout': ModularState.layout,
      'data-alignment': ModularState.alignment,
      'data-weight': ModularState.weight,
      'data-palette': ModularState.palette,
      'data-palette-variant': ModularState.paletteVariant,
      'data-image-container': ModularState.imageContainer,
      'data-image-container-variant': ModularState.imageContainerVariant,
      'data-image-effect': ModularState.imageEffect
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
      layout: ModularState.layout,
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
    
    // Build complete card data object
    const cardData = {
      name: document.getElementById('card-name')?.value || 'Aria Shadowbane',
      characterClass: document.getElementById('card-class')?.value || 'Rogue Assassin',
      rarity: document.getElementById('card-rarity')?.value || 'Rare',
      quote: document.getElementById('card-quote')?.value || 'Shadows are my allies, silence my weapon.',
      avatar: document.getElementById('card-avatar')?.value || '/cardforge/images/default-avatar.jpg',
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
    
    // Update front face
    updateFrontFace(cardData);
    
    // Update back face
    updateBackFace(cardData);
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
    
    console.log('⚡ Collected attributes:', attributes);
    return attributes;
  }

  // ===== FRONT FACE UPDATE =====
  function updateFrontFace(data) {
    const front = document.querySelector('.card-front');
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
    
    return stats.map(stat => {
      const percentage = Math.min(stat.value, 100); // Cap at 100%
      return `
        <div class="stat-item">
          <div class="stat-label">${stat.name} <span class="stat-value">${stat.value}</span></div>
          <div class="stat-bar"><div class="stat-progress" style="width: ${percentage}%"></div></div>
        </div>
      `;
    }).join('');
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
      tiktok: 'fab fa-tiktok'
    };
    
    return socialLinks.map(social => {
      const iconClass = iconMap[social.platform] || 'fas fa-link';
      const platformName = social.platform.charAt(0).toUpperCase() + social.platform.slice(1);
      return `
        <div class="social-item">
          <div class="social-icon-circle">
            <i class="${iconClass}"></i>
          </div>
          <span class="social-platform">${platformName}</span>
        </div>
      `;
    }).join('');
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
    
    return badges.map(badge => {
      const iconClass = iconMap[badge.icon] || 'fas fa-award';
      const icons = Array(badge.quantity || 1).fill(`<i class="${iconClass}"></i>`).join('');
      return `
        <div class="badge-item">
          <div class="badge-icons">
            ${icons}
          </div>
          <span class="badge-category">${badge.category}</span>
        </div>
      `;
    }).join('');
  }
  
  function generateAttributesHTML(attributes) {
    if (!attributes || attributes.length === 0) {
      return '<div class="no-attributes">No attributes available</div>';
    }
    
    return attributes.map(attr => {
      return `
        <div class="attribute-item">
          <span class="attr-name">${attr.name}:</span>
          <span class="attr-value">${attr.value}</span>
        </div>
      `;
    }).join('');
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
            <div class="stat-item">
              <div class="stat-label">STR <span class="stat-value">7</span></div>
              <div class="stat-bar"><div class="stat-progress" style="width: 70%"></div></div>
            </div>
            <div class="stat-item">
              <div class="stat-label">AGI <span class="stat-value">9</span></div>
              <div class="stat-bar"><div class="stat-progress" style="width: 90%"></div></div>
            </div>
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
          </div>
        </div>
      </div>
    `;
  }

  // ===== BACK FACE UPDATE =====
  function updateBackFace(data) {
    const back = document.querySelector('.card-back');
    if (!back) return;
    
    back.innerHTML = `
      <div class="card-back-content">
        <div class="back-header">
          <h3 class="card-name">${data.name}</h3>
          <div class="card-class">${data.characterClass}</div>
        </div>
        <div class="back-body">
          <div class="back-section social-section">
            <h4 class="section-title">Social Links</h4>
            <div class="social-links">
              ${generateSocialLinksHTML(data.socialLinks)}
            </div>
          </div>
          
          <div class="back-section badges-section">
            <h4 class="section-title">Badges & Achievements</h4>
            <div class="badges-container">
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
    `;
  }

  // ===== FORM LISTENERS =====
  function initFormListeners() {
    // Basic form fields
    const formInputs = [
      'card-name',
      'card-class', 
      'card-rarity',
      'card-quote',
      'card-avatar'
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
    
    console.log('🎧 Form listeners initialized for live preview');
  }
  
  function initStatsListeners() {
    const statsContainer = document.getElementById('stats-editor');
    if (statsContainer) {
      // Use event delegation for dynamic stat rows
      statsContainer.addEventListener('input', function(e) {
        if (e.target.matches('input[name="stat-name"]') || e.target.matches('input[name="stat-value"]')) {
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

  // ===== TIER 5: IMAGE CONTAINER =====
  function initTier5Container() {
    const containerOptions = document.querySelectorAll('[data-tier="5"] .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="5"] .container-variants');
    
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
          'fullbleed': 'none'
        };
        ModularState.imageContainerVariant = defaultVariants[ModularState.imageContainer] || 'circle';
        
        // Update variant selection UI
        const activeContainer = document.querySelector(`[data-tier="5"] [data-container="${ModularState.imageContainer}"]`);
        if (activeContainer) {
          const variantOptions = activeContainer.querySelectorAll('.variant-option');
          variantOptions.forEach(v => v.classList.remove('selected'));
          const defaultVariant = activeContainer.querySelector(`[data-variant="${ModularState.imageContainerVariant}"]`);
          if (defaultVariant) defaultVariant.classList.add('selected');
        }
        
        // Update preview
        updatePreview();
        
        console.log(`🖼️ Image container updated: ${ModularState.imageContainer}-${ModularState.imageContainerVariant}`);
      });
    });
    
    // Initialize variant option listeners
    const allVariantOptions = document.querySelectorAll('[data-tier="5"] .variant-option');
    allVariantOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state within the same container
        const container = option.closest('.container-variants');
        const siblingOptions = container.querySelectorAll('.variant-option');
        siblingOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageContainerVariant = option.dataset.variant;
        
        // Update preview
        updatePreview();
        
        console.log(`🎭 Container variant updated: ${ModularState.imageContainerVariant}`);
      });
    });
    
    // Set default selections
    const defaultContainer = document.querySelector(`[data-tier="5"] [data-value="${ModularState.imageContainer}"]`);
    if (defaultContainer) {
      defaultContainer.classList.add('selected');
      // Show the default container's variants
      const defaultVariantContainer = document.querySelector(`[data-tier="5"] [data-container="${ModularState.imageContainer}"]`);
      if (defaultVariantContainer) {
        defaultVariantContainer.style.display = 'block';
        const defaultVariant = defaultVariantContainer.querySelector(`[data-variant="${ModularState.imageContainerVariant}"]`);
        if (defaultVariant) defaultVariant.classList.add('selected');
      }
    }
  }

  // ===== TIER 6: IMAGE EFFECTS =====
  function initTier6Effects() {
    const effectOptions = document.querySelectorAll('[data-tier="6"] .effects-type-grid .tier-option');
    const variantContainers = document.querySelectorAll('[data-tier="6"] .effect-variants');
    
    // Effect Type Selection Handlers
    effectOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        effectOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageEffect = option.dataset.value;
        
        // Show/hide relevant variant options
        variantContainers.forEach(container => {
          const effectType = container.dataset.effect;
          if (effectType === ModularState.imageEffect) {
            container.style.display = 'block';
          } else {
            container.style.display = 'none';
          }
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
        const activeVariantContainer = document.querySelector(`[data-tier="6"] [data-effect="${ModularState.imageEffect}"]`);
        if (activeVariantContainer) {
          const variantOptions = activeVariantContainer.querySelectorAll('.variant-option');
          variantOptions.forEach(opt => opt.classList.remove('selected'));
          const defaultVariantOption = activeVariantContainer.querySelector(`[data-variant="${ModularState.imageEffectVariant}"]`);
          if (defaultVariantOption) {
            defaultVariantOption.classList.add('selected');
          }
        }
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
        console.log(`✨ Image effect updated: ${ModularState.imageEffect} ${ModularState.imageEffectVariant}`);
      });
    });
    
    // Effect Variant Selection Handlers
    const variantOptions = document.querySelectorAll('[data-tier="6"] .variant-option');
    variantOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state within the same variant container
        const container = option.closest('.effect-variants');
        const siblingOptions = container.querySelectorAll('.variant-option');
        siblingOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.imageEffectVariant = option.dataset.variant;
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
        console.log(`🎨 Effect variant updated: ${ModularState.imageEffectVariant}`);
      });
    });
    
    // Set default selections
    const defaultEffect = document.querySelector(`[data-tier="6"] .effects-type-grid [data-value="${ModularState.imageEffect}"]`);
    if (defaultEffect) {
      defaultEffect.classList.add('selected');
      // Show the default effect's variants
      const defaultVariantContainer = document.querySelector(`[data-tier="6"] [data-effect="${ModularState.imageEffect}"]`);
      if (defaultVariantContainer) {
        defaultVariantContainer.style.display = 'block';
        const defaultVariant = defaultVariantContainer.querySelector(`[data-variant="${ModularState.imageEffectVariant}"]`);
        if (defaultVariant) defaultVariant.classList.add('selected');
      }
    }
    
    // Initialize current selection display with default values
    if (defaultEffect) {
      const effectLabel = defaultEffect.querySelector('.option-label').textContent;
      const variantLabel = ModularState.imageEffectVariant.charAt(0).toUpperCase() + ModularState.imageEffectVariant.slice(1);
      const previewClass = `${ModularState.imageEffect}-effect-preview`;
      // For 'none' effect, just show the effect name without variant
      const displayText = (ModularState.imageEffect === 'none') ? effectLabel : `${effectLabel} ${variantLabel}`;
      updateTierCurrentSelection('6', displayText, previewClass);
    }
  }

  // Expose global functions for external access
  window.CardForge = {
    updatePreview,
    initImageGallery,
    ModularState
  };

})();

// ===== PLACEHOLDER FOR ADDITIONAL TIERS =====
// TODO: Add Tier 2 (Alignment), Tier 3 (Weight), Tier 5 (Image Container), Tier 6 (Effects)
// TODO: Add dynamic form editors (Stats, Social, Badges, Attributes)

// CardForge V2 - Modular System Implementation
// Clean implementation of the 6-tier modular card design system
// Updated: 2025-07-30 - Fresh start with modular architecture

(function() {
  'use strict';

  // ===== MODULAR SYSTEM STATE =====
  const ModularState = {
    // LAYOUT REMOVED - Phase 1 of Flow Restructure
    // Image-first design: Image Container moved to Tier 2
    
    // Tier 2: Content Alignment (3-level hierarchy)
    alignmentType: 'center',
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
  
  // ===== PRESET CONFIGURATIONS =====
  const PresetConfigurations = {
    'hero-classic': {
      // LAYOUT REMOVED - Phase 1 of Flow Restructure
      alignmentType: 'center',
      alignmentWeight: 'balanced',
      alignmentStyle: 'padded',
      weight: 'balanced',
      palette: 'neon',
      paletteVariant: 'light',
      imageContainer: 'masked',
      imageContainerVariant: 'circle',
      imageEffect: 'none',
      imageEffectVariant: 'clean'
    },
    'split-modern': {
      // LAYOUT REMOVED - Phase 1 of Flow Restructure
      alignmentType: 'left',
      alignmentWeight: 'top-heavy',
      alignmentStyle: 'minimal',
      weight: 'top-heavy',
      palette: 'ocean',
      paletteVariant: 'dark',
      imageContainer: 'framed',
      imageContainerVariant: 'modern',
      imageEffect: 'borders',
      imageEffectVariant: 'solid'
    },
    'minimal-glow': {
      // LAYOUT REMOVED - Phase 1 of Flow Restructure
      alignmentType: 'center',
      alignmentWeight: 'balanced',
      alignmentStyle: 'compact',
      weight: 'balanced',
      palette: 'monochrome',
      paletteVariant: 'light',
      imageContainer: 'raw',
      imageContainerVariant: 'rounded',
      imageEffect: 'borders',
      imageEffectVariant: 'glow'
    },
    'fullbleed-cinematic': {
      // LAYOUT REMOVED - Phase 1 of Flow Restructure
      alignmentType: 'center',
      alignmentWeight: 'bottom-heavy',
      alignmentStyle: 'padded',
      weight: 'bottom-heavy',
      palette: 'sunset',
      paletteVariant: 'dark',
      imageContainer: 'fullbleed',
      imageContainerVariant: 'none',
      imageEffect: 'filters',
      imageEffectVariant: 'sepia'
    },
    'framed-ornate': {
      // LAYOUT REMOVED - Phase 1 of Flow Restructure
      alignmentType: 'center',
      alignmentWeight: 'top-heavy',
      alignmentStyle: 'padded',
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
    
    // Update Tier 2: Content Alignment (3-level hierarchy)
    // Level 1: Alignment Type
    const alignmentTypeOptions = document.querySelectorAll('[data-tier="2"] .alignment-type .tier-option');
    alignmentTypeOptions.forEach(option => {
      option.classList.toggle('selected', option.dataset.value === ModularState.alignmentType);
    });
    
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
    const alignmentType = ModularState.alignmentType || 'center';
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

  // ===== TIER 4: CONTENT ALIGNMENT (3-LEVEL HIERARCHY) =====
  function initTier4Alignment() {
    console.log('🎯 Initializing Tier 4: Content Alignment (3-level hierarchy)...');
    
    // Initialize ModularState properties for 3-level alignment
    if (!ModularState.alignmentType) ModularState.alignmentType = 'center';
    if (!ModularState.alignmentWeight) ModularState.alignmentWeight = 'balanced';
    if (!ModularState.alignmentStyle) ModularState.alignmentStyle = 'padded';
    
    // Level 1: Alignment Type Selection
    initAlignmentTypeSelection();
    
    // Level 2: Weight Distribution Selection
    initAlignmentWeightSelection();
    
    // Level 3: Style Variant Selection
    initAlignmentStyleSelection();
    
    // Initialize display state
    updateAlignmentLevelVisibility();
    
    console.log('✅ Tier 4 Content Alignment initialized');
  }
  
  function initAlignmentTypeSelection() {
    const alignmentTypeOptions = document.querySelectorAll('[data-tier="4"] .alignment-type-grid .tier-option');
    
    alignmentTypeOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state
        alignmentTypeOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.alignmentType = option.dataset.value;
        
        // Show/hide appropriate weight options
        updateAlignmentLevelVisibility();
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
        console.log(`📐 Alignment Type updated: ${ModularState.alignmentType}`);
      });
    });
    
    // Set default selection
    const defaultOption = document.querySelector(`[data-tier="4"] .alignment-type-grid [data-value="${ModularState.alignmentType}"]`);
    if (defaultOption) {
      defaultOption.classList.add('selected');
    }
  }
  
  function initAlignmentWeightSelection() {
    const weightOptions = document.querySelectorAll('[data-tier="4"] .weight-option');
    
    weightOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state within the current alignment group
        const currentAlignmentGroup = option.closest('.alignment-weights');
        const groupWeightOptions = currentAlignmentGroup.querySelectorAll('.weight-option');
        groupWeightOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.alignmentWeight = option.dataset.weight;
        
        // Show/hide appropriate style options
        updateAlignmentLevelVisibility();
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
        console.log(`⚖️ Alignment Weight updated: ${ModularState.alignmentWeight}`);
      });
    });
  }
  
  function initAlignmentStyleSelection() {
    const styleOptions = document.querySelectorAll('[data-tier="4"] .style-option');
    
    styleOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state within the current combination group
        const currentCombinationGroup = option.closest('.alignment-styles');
        const groupStyleOptions = currentCombinationGroup.querySelectorAll('.style-option');
        groupStyleOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.alignmentStyle = option.dataset.style;
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
        console.log(`🎨 Alignment Style updated: ${ModularState.alignmentStyle}`);
      });
    });
  }
  
  function updateAlignmentLevelVisibility() {
    // Hide all weight groups
    const allWeightGroups = document.querySelectorAll('[data-tier="4"] .alignment-weights');
    allWeightGroups.forEach(group => {
      group.style.display = 'none';
    });
    
    // Show weight group for current alignment type
    const currentWeightGroup = document.querySelector(`[data-tier="4"] .alignment-weights[data-alignment="${ModularState.alignmentType}"]`);
    if (currentWeightGroup) {
      currentWeightGroup.style.display = 'block';
      
      // Set default weight selection if none exists
      const selectedWeight = currentWeightGroup.querySelector('.weight-option.selected');
      if (!selectedWeight) {
        const defaultWeight = currentWeightGroup.querySelector(`[data-weight="${ModularState.alignmentWeight}"]`);
        if (defaultWeight) {
          defaultWeight.classList.add('selected');
        }
      }
    }
    
    // Hide all style groups
    const allStyleGroups = document.querySelectorAll('[data-tier="4"] .alignment-styles');
    allStyleGroups.forEach(group => {
      group.style.display = 'none';
    });
    
    // Show style group for current alignment-weight combination
    const currentCombination = `${ModularState.alignmentType}-${ModularState.alignmentWeight}`;
    let currentStyleGroup = document.querySelector(`[data-tier="4"] .alignment-styles[data-combination="${currentCombination}"]`);
    
    // If the specific combination doesn't exist, create it dynamically
    if (!currentStyleGroup) {
      currentStyleGroup = createAlignmentStyleGroup(currentCombination);
    }
    
    if (currentStyleGroup) {
      currentStyleGroup.style.display = 'block';
      
      // Set default style selection if none exists
      const selectedStyle = currentStyleGroup.querySelector('.style-option.selected');
      if (!selectedStyle) {
        const defaultStyle = currentStyleGroup.querySelector(`[data-style="${ModularState.alignmentStyle}"]`);
        if (defaultStyle) {
          defaultStyle.classList.add('selected');
        }
      }
    }
  }
  
  function createAlignmentStyleGroup(combination) {
    const [alignmentType, weight] = combination.split('-');
    const styleLevel = document.querySelector('[data-tier="2"] .alignment-level:last-child');
    
    // Create the style group HTML
    const styleGroupHTML = `
      <div class="alignment-styles" data-combination="${combination}">
        <h6 class="variant-subtitle">${capitalizeFirst(alignmentType)} ${capitalizeFirst(weight)} Styles</h6>
        <div class="style-options">
          <div class="style-option" data-style="minimal">
            <div class="style-preview minimal-style-preview"></div>
            <span class="style-label">Minimal</span>
          </div>
          <div class="style-option" data-style="padded">
            <div class="style-preview padded-style-preview"></div>
            <span class="style-label">Padded</span>
          </div>
          <div class="style-option" data-style="compact">
            <div class="style-preview compact-style-preview"></div>
            <span class="style-label">Compact</span>
          </div>
        </div>
      </div>
    `;
    
    // Insert the new style group
    styleLevel.insertAdjacentHTML('beforeend', styleGroupHTML);
    
    // Get the newly created group and add event listeners
    const newStyleGroup = styleLevel.querySelector(`[data-combination="${combination}"]`);
    const newStyleOptions = newStyleGroup.querySelectorAll('.style-option');
    
    newStyleOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Update selection state within this group
        newStyleOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Update modular state
        ModularState.alignmentStyle = option.dataset.style;
        
        // Update collapsible tier display
        updateCollapsibleTierDisplays();
        
        // Update preview
        updatePreview();
        
        console.log(`🎨 Alignment Style updated: ${ModularState.alignmentStyle}`);
      });
    });
    
    return newStyleGroup;
  }
  
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
    
    const front = document.querySelector('.card-front');
    const back = document.querySelector('.card-back');
    
    if (!front || !back) {
      console.warn('⚠️ Card preview elements not found');
      return;
    }
    
    // Apply modular CSS classes
    const modularClasses = [
      // `layout-${ModularState.layout}` REMOVED - Phase 1 of Flow Restructure
      `align-type-${ModularState.alignmentType}`,
      `align-weight-${ModularState.alignmentWeight}`,
      `align-style-${ModularState.alignmentStyle}`,
      // `weight-${ModularState.weight}` REMOVED - Standalone Visual Weight tier removed
      `palette-${ModularState.palette}`,
      `variant-${ModularState.paletteVariant}`,
      `text-${ModularState.textColor}`,
      `container-${ModularState.imageContainer}`,
      `container-variant-${ModularState.imageContainerVariant}`,
      `effect-${ModularState.imageEffect}`,
      `effect-variant-${ModularState.imageEffectVariant}`
    ];
    
    // Apply classes to both front and back
    front.className = `card-preview-canvas card-front ${modularClasses.join(' ')}`;
    back.className = `card-preview-canvas card-back ${modularClasses.join(' ')}`;
    
    // Set data attributes for advanced styling
    const dataAttributes = {
      // 'data-layout': ModularState.layout, REMOVED - Phase 1 of Flow Restructure
      'data-alignment-type': ModularState.alignmentType,
      'data-alignment-weight': ModularState.alignmentWeight,
      'data-alignment-style': ModularState.alignmentStyle,
      'data-weight': ModularState.weight,
      'data-palette': ModularState.palette,
      'data-palette-variant': ModularState.paletteVariant,
      'data-image-container': ModularState.imageContainer,
      'data-image-container-variant': ModularState.imageContainerVariant,
      'data-image-effect': ModularState.imageEffect,
      'data-image-effect-variant': ModularState.imageEffectVariant
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
    
    // Collect biography field first
    const biographyField = document.getElementById('card-bio');
    if (biographyField && biographyField.value.trim()) {
      attributes.push({
        name: 'Biography',
        value: biographyField.value.trim()
      });
    }
    
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

  // Expose global functions for external access
  window.CardForge = {
    updatePreview,
    initImageGallery,
    initTier2ImageContainer,
    ModularState
  };

})();

// ===== PLACEHOLDER FOR ADDITIONAL TIERS =====
// TODO: Add Tier 2 (Alignment), Tier 3 (Weight), Tier 5 (Image Container), Tier 6 (Effects)
// TODO: Add dynamic form editors (Stats, Social, Badges, Attributes)

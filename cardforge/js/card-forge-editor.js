// CardForge V2 - RPG Card Builder Editor
// Comprehensive JavaScript implementation with visual pickers and live preview
// Updated: 2025-07-27 - Clean rewrite to restore functionality

(function() {
  'use strict';

  // Global state variables
  let currentPreset = 'cyberpunk';
  let currentLayout = 'centered';
  let currentPalette = 'neon';
  let currentImageStyle = 'masked';
  let currentImageVariant = 'circle';

  // Preset configurations
  const presetConfigurations = {
    cyberpunk: {
      theme: 'cyberpunk',
      layout: 'hero',
      palette: 'neon',
      imageStyle: 'masked',
      imageVariant: 'hex'
    },
    fantasy: {
      theme: 'fantasy',
      layout: 'centered',
      palette: 'earth',
      imageStyle: 'masked',
      imageVariant: 'circle'
    },
    corporate: {
      theme: 'corporate',
      layout: 'split',
      palette: 'monochrome',
      imageStyle: 'badge',
      imageVariant: 'standard'
    },
    retro: {
      theme: 'retro',
      layout: 'minimal',
      palette: 'sunset',
      imageStyle: 'hero',
      imageVariant: 'large'
    }
  };

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 CardForge Editor initializing...');
    
    // Initialize all components
    initFlipFunctionality();
    initVisualPickers();
    initFormListeners();
    initImageGallery();
    initStatsEditor();
    
    // Initial preview update
    updatePreview();
    
    console.log('✅ CardForge Editor initialized successfully');
  });

  // ===== FLIP FUNCTIONALITY =====
  function initFlipFunctionality() {
    function flipCard() {
      console.log('Flipping card...');
      const cardInner = document.querySelector('.card-container .card-inner');
      if (cardInner) {
        cardInner.classList.toggle('flipped');
        console.log('Card flipped:', cardInner.classList.contains('flipped'));
      } else {
        console.error('Card inner element not found');
      }
    }
    
    // Set up flip button
    const flipBtn = document.getElementById('flip-btn');
    if (flipBtn) {
      console.log('Flip button found, adding click handler');
      flipBtn.onclick = function(e) {
        e.preventDefault();
        flipCard();
        return false;
      };
    } else {
      console.error('Flip button not found in DOM');
    }
    
    // Handle tab changes for auto-flip
    document.addEventListener('click', function(e) {
      const stepButton = e.target.closest('.step-btn');
      if (stepButton) {
        const step = stepButton.getAttribute('data-step');
        const cardInner = document.querySelector('.card-container .card-inner');
        if (cardInner) {
          // Steps 4, 5, 6 are back-of-card content (Social, Badges, Attributes)
          if (step && ['4', '5', '6'].includes(step)) {
            cardInner.classList.add('flipped');
            console.log('Flipping to back for step:', step);
          } else {
            cardInner.classList.remove('flipped');
            console.log('Flipping to front for step:', step);
          }
        }
      }
    });
    
    // Add flip method to window for testing
    window.flipCard = flipCard;
    console.log('Flip functionality initialized');
  }

  // ===== VISUAL PICKERS =====
  function initVisualPickers() {
    initPresetPicker();
    initLayoutPicker();
    initPalettePicker();
    initImageStylePicker();
  }

  // Preset Picker
  function initPresetPicker() {
    const presetOptions = document.querySelectorAll('.preset-option');
    
    presetOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Remove selected from all preset options
        presetOptions.forEach(opt => opt.classList.remove('selected'));
        
        // Add selected to clicked option
        option.classList.add('selected');
        
        // Get selected preset
        const selectedPreset = option.dataset.preset;
        currentPreset = selectedPreset;
        
        // Apply full preset configuration
        applyPresetConfiguration(selectedPreset);
        
        console.log(`🎨 Preset Applied: ${selectedPreset}`);
      });
    });
    
    // Initialize with default selection
    applyPresetConfiguration(currentPreset);
  }

  // Layout Picker
  function initLayoutPicker() {
    const layoutOptions = document.querySelectorAll('.layout-option');
    
    layoutOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Remove selected from all layout options
        layoutOptions.forEach(opt => opt.classList.remove('selected'));
        
        // Add selected to clicked option
        option.classList.add('selected');
        
        // Get selected layout
        const selectedLayout = option.dataset.layout;
        currentLayout = selectedLayout;
        
        // Update preview immediately
        updatePreview();
        
        console.log(`Layout Updated: ${selectedLayout}`);
      });
    });
  }

  // Palette Picker
  function initPalettePicker() {
    const paletteOptions = document.querySelectorAll('.palette-option');
    
    paletteOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Remove selected from all palette options
        paletteOptions.forEach(opt => opt.classList.remove('selected'));
        
        // Add selected to clicked option
        option.classList.add('selected');
        
        // Get selected palette
        const selectedPalette = option.dataset.palette;
        currentPalette = selectedPalette;
        
        // Update preview immediately
        updatePreview();
        
        console.log(`Palette Updated: ${selectedPalette}`);
      });
    });
  }

  // Image Style Picker
  function initImageStylePicker() {
    const primaryOptions = document.querySelectorAll('.style-primary-option');
    const variantGroups = document.querySelectorAll('.variant-group');
    
    // Primary style selection handler
    primaryOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Remove active from all primary options
        primaryOptions.forEach(opt => opt.classList.remove('active'));
        
        // Add active to clicked option
        option.classList.add('active');
        
        // Get selected style
        const selectedStyle = option.dataset.style;
        currentImageStyle = selectedStyle;
        
        // Hide all variant groups
        variantGroups.forEach(group => {
          group.style.display = 'none';
        });
        
        // Show the variant group for selected style
        const targetGroup = document.querySelector(`[data-for-style="${selectedStyle}"]`);
        if (targetGroup) {
          targetGroup.style.display = 'grid';
        }
        
        // Update preview
        updatePreview();
        
        console.log(`Image Style Updated: ${selectedStyle}`);
      });
    });
    
    // Variant selection handler
    variantGroups.forEach(group => {
      const variantOptions = group.querySelectorAll('.variant-option');
      
      variantOptions.forEach(option => {
        option.addEventListener('click', () => {
          // Remove active from all variants in this group
          variantOptions.forEach(opt => opt.classList.remove('active'));
          
          // Add active to clicked variant
          option.classList.add('active');
          
          // Store selected variant
          const selectedVariant = option.dataset.variant;
          currentImageVariant = selectedVariant;
          
          // Update preview
          updatePreview();
          
          console.log(`Image Variant Updated: ${selectedVariant}`);
        });
      });
    });
  }

  // Apply full preset configuration
  function applyPresetConfiguration(presetName) {
    const config = presetConfigurations[presetName];
    if (!config) {
      console.warn(`⚠️ Preset configuration not found: ${presetName}`);
      return;
    }
    
    // Update all global variables
    currentPreset = presetName;
    currentLayout = config.layout;
    currentPalette = config.palette;
    currentImageStyle = config.imageStyle;
    currentImageVariant = config.imageVariant;
    
    // Update visual picker selections
    updatePickerSelections(config);
    
    // Update preview immediately
    updatePreview();
  }

  // Update visual picker selections to match preset configuration
  function updatePickerSelections(config) {
    // Update layout picker selection
    const layoutOptions = document.querySelectorAll('.layout-option');
    layoutOptions.forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.layout === config.layout);
    });
    
    // Update palette picker selection
    const paletteOptions = document.querySelectorAll('.palette-option');
    paletteOptions.forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.palette === config.palette);
    });
    
    // Update image style picker selection
    const primaryOptions = document.querySelectorAll('.style-primary-option');
    primaryOptions.forEach(opt => {
      opt.classList.toggle('active', opt.dataset.style === config.imageStyle);
    });
    
    // Update image style variants
    const variantGroups = document.querySelectorAll('.variant-group');
    variantGroups.forEach(group => {
      const isActiveStyle = group.dataset.forStyle === config.imageStyle;
      group.style.display = isActiveStyle ? 'grid' : 'none';
      
      if (isActiveStyle) {
        const variantOptions = group.querySelectorAll('.variant-option');
        variantOptions.forEach(opt => {
          opt.classList.toggle('active', opt.dataset.variant === config.imageVariant);
        });
      }
    });
  }

  // ===== FORM LISTENERS =====
  function initFormListeners() {
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

  // ===== STATS COLLECTION AND MANAGEMENT =====
  function collectStatsFromEditor() {
    const statsEditor = document.getElementById('stats-editor');
    if (!statsEditor) return [];
    
    const statRows = statsEditor.querySelectorAll('.stat-row');
    const stats = [];
    
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
    
    return stats;
  }

  function generateStatsHTML(stats) {
    if (!stats || stats.length === 0) {
      // Return default demo stats if no custom stats
      return `
        <div class="stat-item">
          <div class="stat-label">Strength <span class="stat-value">7</span></div>
          <div class="stat-bar"><div class="stat-progress" style="width: 70%"></div></div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Agility <span class="stat-value">9</span></div>
          <div class="stat-bar"><div class="stat-progress" style="width: 95%"></div></div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Intelligence <span class="stat-value">8</span></div>
          <div class="stat-bar"><div class="stat-progress" style="width: 80%"></div></div>
        </div>
      `;
    }
    
    return stats.map(stat => `
      <div class="stat-item">
        <div class="stat-label">${stat.name} <span class="stat-value">${stat.value}</span></div>
        <div class="stat-bar"><div class="stat-progress" style="width: ${stat.value}%"></div></div>
      </div>
    `).join('');
  }

  function initStatsEditor() {
    const statsEditor = document.getElementById('stats-editor');
    const addStatBtn = document.getElementById('add-stat-btn');
    
    if (!statsEditor || !addStatBtn) return;

    // Prefill default stats if form is blank
    const rows = statsEditor.querySelectorAll('.stat-row');
    if (rows.length === 0 || !Array.from(rows).some(r => r.querySelector('input[name="stat-name"]').value.trim())) {
      // Clear existing rows
      statsEditor.innerHTML = '';
      const defaultStats = [
        { name: 'Strength', value: 7 },
        { name: 'Agility', value: 9 },
        { name: 'Intelligence', value: 8 }
      ];
      defaultStats.forEach(stat => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `
          <input type="text" name="stat-name" placeholder="Stat name" value="${stat.name}" />
          <input type="range" name="stat-value" min="0" max="100" value="${stat.value}" class="stat-slider" aria-label="Stat value" />
          <span class="stat-value-display">${stat.value}</span>
          <button type="button" class="remove-attribute">&times;</button>
        `;
        statsEditor.appendChild(row);
        const nameInput = row.querySelector('input[name="stat-name"]');
        const valueInput = row.querySelector('input[name="stat-value"]');
        const valueDisplay = row.querySelector('.stat-value-display');
        const removeBtn = row.querySelector('.remove-attribute');
        valueInput.addEventListener('input', () => { valueDisplay.textContent = valueInput.value; updatePreview(); });
        nameInput.addEventListener('input', updatePreview);
        removeBtn.addEventListener('click', () => { row.remove(); updatePreview(); });
      });
    }
    const initialRows = statsEditor.querySelectorAll('.stat-row');
    if (initialRows.length === 0) {
      const defaultStats = [
        { name: 'Strength', value: 7 },
        { name: 'Agility', value: 9 },
        { name: 'Intelligence', value: 8 }
      ];
      defaultStats.forEach(stat => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `
          <input type="text" name="stat-name" placeholder="Stat name" value="${stat.name}" />
          <input type="range" name="stat-value" min="0" max="100" value="${stat.value}" class="stat-slider" aria-label="Stat value" />
          <span class="stat-value-display">${stat.value}</span>
          <button type="button" class="remove-attribute">&times;</button>
        `;
        statsEditor.appendChild(row);
        const nameInput = row.querySelector('input[name="stat-name"]');
        const valueInput = row.querySelector('input[name="stat-value"]');
        const valueDisplay = row.querySelector('.stat-value-display');
        const removeBtn = row.querySelector('.remove-attribute');
        valueInput.addEventListener('input', () => { valueDisplay.textContent = valueInput.value; updatePreview(); });
        nameInput.addEventListener('input', updatePreview);
        removeBtn.addEventListener('click', () => { row.remove(); updatePreview(); });
      });
    }
    
    // Add stat button functionality
    addStatBtn.addEventListener('click', function() {
      const newStatRow = document.createElement('div');
      newStatRow.className = 'stat-row';
      newStatRow.innerHTML = `
        <input type="text" name="stat-name" placeholder="Stat name" />
        <input type="range" name="stat-value" min="0" max="100" value="0" class="stat-slider" aria-label="Stat value" />
        <span class="stat-value-display">0</span>
        <button type="button" class="remove-attribute">&times;</button>
      `;
      
      statsEditor.appendChild(newStatRow);
      
      // Add event listeners to new elements
      const nameInput = newStatRow.querySelector('input[name="stat-name"]');
      const valueInput = newStatRow.querySelector('input[name="stat-value"]');
      const valueDisplay = newStatRow.querySelector('.stat-value-display');
      const removeBtn = newStatRow.querySelector('.remove-attribute');
      
      // Update display when slider changes
      valueInput.addEventListener('input', function() {
        valueDisplay.textContent = this.value;
        updatePreview();
      });
      
      // Update preview when name changes
      nameInput.addEventListener('input', updatePreview);
      
      // Remove stat functionality
      removeBtn.addEventListener('click', function() {
        newStatRow.remove();
        updatePreview();
      });
      
      // Update preview after adding new stat
      updatePreview();
    });
    
    // Add event listeners to existing stat rows
    const existingRows = statsEditor.querySelectorAll('.stat-row');
    existingRows.forEach(row => {
      const nameInput = row.querySelector('input[name="stat-name"]');
      const valueInput = row.querySelector('input[name="stat-value"]');
      const valueDisplay = row.querySelector('.stat-value-display');
      const removeBtn = row.querySelector('.remove-attribute');
      
      if (valueInput && valueDisplay) {
        valueInput.addEventListener('input', function() {
          valueDisplay.textContent = this.value;
          updatePreview();
        });
      }
      
      if (nameInput) {
        nameInput.addEventListener('input', updatePreview);
      }
      
      if (removeBtn) {
        removeBtn.addEventListener('click', function() {
          row.remove();
          updatePreview();
        });
      }
    });
  }

  // ===== STATS COLLECTION AND MANAGEMENT =====
  function collectStatsFromEditor() {
    const statsEditor = document.getElementById('stats-editor');
    if (!statsEditor) return [];
    
    const statRows = statsEditor.querySelectorAll('.stat-row');
    const stats = [];
    
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
    
    return stats;
  }

  function generateStatsHTML(stats) {
    if (!stats || stats.length === 0) {
      // Return default demo stats if no custom stats
      return `
        <div class="stat-item">
          <div class="stat-label">Strength <span class="stat-value">7</span></div>
          <div class="stat-bar"><div class="stat-progress" style="width: 70%"></div></div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Agility <span class="stat-value">9</span></div>
          <div class="stat-bar"><div class="stat-progress" style="width: 95%"></div></div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Intelligence <span class="stat-value">8</span></div>
          <div class="stat-bar"><div class="stat-progress" style="width: 80%"></div></div>
        </div>
      `;
    }
    
    return stats.map(stat => `
      <div class="stat-item">
        <div class="stat-label">${stat.name} <span class="stat-value">${stat.value}</span></div>
        <div class="stat-bar"><div class="stat-progress" style="width: ${stat.value}%"></div></div>
      </div>
    `).join('');
  }

  // ===== SOCIAL, BADGES, AND ATTRIBUTES COLLECTION =====
  function collectSocialLinksFromEditor() {
    const socialLinks = [];
    const socialRows = document.querySelectorAll('#social-editor .social-row');
    
    socialRows.forEach(row => {
      const platform = row.querySelector('select[name="social-name"]')?.value;
      const url = row.querySelector('input[name="social-url"]')?.value;
      
      if (platform && url) {
        socialLinks.push({ platform, url });
      }
    });
    
    console.log('📱 Collected social links:', socialLinks);
    return socialLinks;
  }

  function collectBadgesFromEditor() {
    const badges = [];
    const badgeRows = document.querySelectorAll('#micro-editor .micro-row');
    
    badgeRows.forEach(row => {
      const category = row.querySelector('input[name="micro-category"]')?.value;
      const icon = row.querySelector('input[name="micro-icon"]')?.value;
      const description = row.querySelector('input[name="micro-desc"]')?.value;
      const quantity = row.querySelector('input[name="micro-quantity"]')?.value;
      
      if (category || description) {
        badges.push({ 
          category: category || 'Badge', 
          icon: icon || 'star', 
          description: description || 'Achievement', 
          quantity: parseInt(quantity) || 1 
        });
      }
    });
    
    console.log('🏆 Collected badges:', badges);
    return badges;
  }

  function collectAttributesFromEditor() {
    const attributes = [];
    const attributeRows = document.querySelectorAll('#attribute-editor .attribute-row');
    
    attributeRows.forEach(row => {
      const name = row.querySelector('input[name="attribute-name"]')?.value;
      const value = row.querySelector('input[name="attribute-value"]')?.value;
      
      if (name && value) {
        attributes.push({ name, value });
      }
    });
    
    // Also collect biography if present
    const biography = document.getElementById('card-bio')?.value;
    if (biography) {
      attributes.unshift({ name: 'Biography', value: biography });
    }
    
    console.log('📋 Collected attributes:', attributes);
    return attributes;
  }

  function generateSocialLinksHTML(socialLinks) {
    if (!socialLinks || socialLinks.length === 0) {
      return `
        <div class="social-item">
          <i class="fab fa-twitter"></i>
          <span class="social-platform">Twitter</span>
          <span class="social-handle">@example</span>
        </div>
        <div class="social-item">
          <i class="fab fa-github"></i>
          <span class="social-platform">GitHub</span>
          <span class="social-handle">username</span>
        </div>
      `;
    }
    
    return socialLinks.map(social => {
      const iconClass = getSocialIcon(social.platform);
      const handle = extractHandle(social.url, social.platform);
      
      return `
        <div class="social-item">
          <i class="${iconClass}"></i>
          <span class="social-platform">${social.platform}</span>
          <span class="social-handle">${handle}</span>
        </div>
      `;
    }).join('');
  }

  function generateBadgesHTML(badges) {
    if (!badges || badges.length === 0) {
      return `
        <div class="badge-item">
          <i class="fas fa-star"></i>
          <span class="badge-category">Achievement</span>
          <span class="badge-count">3</span>
        </div>
        <div class="badge-item">
          <i class="fas fa-trophy"></i>
          <span class="badge-category">Victory</span>
          <span class="badge-count">1</span>
        </div>
      `;
    }
    
    return badges.map(badge => `
      <div class="badge-item">
        <i class="fas fa-${badge.icon}"></i>
        <span class="badge-category">${badge.category}</span>
        <span class="badge-count">${badge.quantity}</span>
      </div>
    `).join('');
  }

  function generateAttributesHTML(attributes) {
    if (!attributes || attributes.length === 0) {
      return `
        <div class="attribute-item">
          <span class="attr-name">Level:</span>
          <span class="attr-value">12</span>
        </div>
        <div class="attribute-item">
          <span class="attr-name">Experience:</span>
          <span class="attr-value">8,450 XP</span>
        </div>
        <div class="attribute-item">
          <span class="attr-name">Alignment:</span>
          <span class="attr-value">Chaotic Good</span>
        </div>
      `;
    }
    
    return attributes.map(attr => `
      <div class="attribute-item">
        <span class="attr-name">${attr.name}:</span>
        <span class="attr-value">${attr.value}</span>
      </div>
    `).join('');
  }

  // Helper functions
  function getSocialIcon(platform) {
    const iconMap = {
      'twitter': 'fab fa-twitter',
      'x': 'fab fa-x-twitter',
      'instagram': 'fab fa-instagram',
      'linkedin': 'fab fa-linkedin',
      'github': 'fab fa-github',
      'facebook': 'fab fa-facebook',
      'discord': 'fab fa-discord',
      'tiktok': 'fab fa-tiktok',
      'deviantart': 'fab fa-deviantart'
    };
    return iconMap[platform.toLowerCase()] || 'fas fa-link';
  }

  function extractHandle(url, platform) {
    if (!url) return '@username';
    
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      
      // Extract username from common social media URL patterns
      if (pathname.startsWith('/')) {
        const handle = pathname.slice(1).split('/')[0];
        return handle ? `@${handle}` : '@username';
      }
    } catch (e) {
      // If URL parsing fails, try to extract from string
      const match = url.match(/[/@]([a-zA-Z0-9_.-]+)/);
      if (match) {
        return `@${match[1]}`;
      }
    }
    
    return '@username';
  }

  // ===== PREVIEW UPDATE SYSTEM =====
  function updatePreview() {
    console.log('🎨 Updating card preview...');
    
    // Get preview elements
    const cardPreview = document.querySelector('.card-preview');
    const front = document.querySelector('.card-front');
    const back = document.querySelector('.card-back');
    
    if (!cardPreview || !front || !back) {
      console.warn('⚠️ Card preview elements not found');
      return;
    }
    
    // Apply theme classes to card preview container
    cardPreview.className = `card-preview theme-${currentPreset} layout-${currentLayout} palette-${currentPalette}`;
    
    // Apply comprehensive CSS classes to front face
    front.className = `card-preview-canvas card-front theme-${currentPreset} variant-${currentPalette} layout-${currentLayout} image-style-${currentImageStyle} image-${currentImageStyle}-${currentImageVariant}`;
    
    // Apply comprehensive CSS classes to back face  
    back.className = `card-preview-canvas card-back theme-${currentPreset} variant-${currentPalette} layout-${currentLayout} image-style-${currentImageStyle} image-${currentImageStyle}-${currentImageVariant}`;
    
    // Set data attributes for advanced styling
    front.setAttribute('data-preset', currentPreset);
    front.setAttribute('data-layout', currentLayout);
    front.setAttribute('data-palette', currentPalette);
    front.setAttribute('data-image-style', currentImageStyle);
    front.setAttribute('data-image-variant', currentImageVariant);
    
    back.setAttribute('data-preset', currentPreset);
    back.setAttribute('data-layout', currentLayout);
    back.setAttribute('data-palette', currentPalette);
    back.setAttribute('data-image-style', currentImageStyle);
    back.setAttribute('data-image-variant', currentImageVariant);
    
    // Update card content with form data and placeholder content
    updateCardContent(front, back);
    
    console.log('✅ Card preview updated successfully');
  }

  // Update card content based on current form data
  function updateCardContent(front, back) {
    // Get form data with fallbacks to placeholder content
    const name = document.getElementById('card-name')?.value || 'Aria Shadowbane';
    const characterClass = document.getElementById('card-class')?.value || 'Rogue Assassin';
    const rarity = document.getElementById('card-rarity')?.value || 'rare';
    const quote = document.getElementById('card-quote')?.value || '"Shadows are my allies, silence my weapon."';
    const avatar = document.getElementById('card-avatar')?.value || '/cardforge/images/default-avatar.jpg';
    
    // Collect dynamic stats from editor
    const stats = collectStatsFromEditor();
    console.log('📊 Collected stats:', stats);
    
    // Collect back-of-card data
    const socialLinks = collectSocialLinksFromEditor();
    const badges = collectBadgesFromEditor();
    const attributes = collectAttributesFromEditor();
    
    // Update front face content
    updateFrontFace(front, { name, characterClass, rarity, quote, avatar, stats });
    
    // Update back face content
    updateBackFace(back, { name, characterClass, rarity, quote, socialLinks, badges, attributes });
  }

  // Update front face with dynamic layout support
  function updateFrontFace(front, data) {
    let frontHTML = '';
    
    // Generate layout-specific HTML structure
    switch (currentLayout) {
      case 'centered':
        frontHTML = generateCenteredLayout(data);
        break;
      case 'split':
        frontHTML = generateSplitLayout(data);
        break;
      case 'hero':
        frontHTML = generateHeroLayout(data);
        break;
      case 'minimal':
        frontHTML = generateMinimalLayout(data);
        break;
      default:
        frontHTML = generateCenteredLayout(data);
    }
    
    front.innerHTML = frontHTML;
    
    // Handle image styles using legacy approach
    handleImageStyles(front, data.avatar);
  }

  // Handle image styles (masked, hero, badge, full-bleed)
  function handleImageStyles(front, avatar) {
    const avatarImg = front.querySelector('.card-avatar');
    
    if (avatarImg && avatar) {
      // Update avatar source
      avatarImg.src = avatar;
      
      // Apply image style classes
      avatarImg.className = `card-avatar image-${currentImageStyle}-${currentImageVariant}`;
      
      // For full bleed styles, apply to card container
      if (currentImageStyle === 'full-bleed') {
        // Hide avatar container for full bleed
        const avatarContainer = front.querySelector('.card-avatar-container');
        if (avatarContainer) {
          avatarContainer.style.display = 'none';
        }
        
        // Apply full bleed background
        front.style.backgroundImage = `url(${avatar})`;
        front.style.backgroundSize = 'cover';
        front.style.backgroundPosition = 'center';
        
        // Add variant-specific classes
        front.classList.add(`image-full-bleed-${currentImageVariant}`);
      } else {
        // Show avatar container for non-full-bleed styles
        const avatarContainer = front.querySelector('.card-avatar-container');
        if (avatarContainer) {
          avatarContainer.style.display = 'block';
        }
        
        // Remove full bleed styling
        front.style.backgroundImage = '';
        front.style.backgroundSize = '';
        front.style.backgroundPosition = '';
        front.classList.remove('image-full-bleed-ambient', 'image-full-bleed-overlay-safe', 'image-full-bleed-grid');
      }
    }
  }

  // Generate centered layout HTML
  function generateCenteredLayout(data) {
    const statsHTML = generateStatsHTML(data.stats);
    
    return `
      <div class="card-header centered-header">
        <h3 class="card-name">${data.name}</h3>
        <div class="card-class">${data.characterClass}</div>
      </div>
      <div class="card-avatar-container ${currentImageStyle}-style">
        <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
      </div>
      <div class="card-body centered-body">
        <div class="card-rarity rarity-${data.rarity}">${data.rarity.charAt(0).toUpperCase() + data.rarity.slice(1)}</div>
        <div class="card-quote">"${data.quote}"</div>
        ${statsHTML}
      </div>
    `;
  }

  // Generate split layout HTML
  function generateSplitLayout(data) {
    const statsHTML = generateStatsHTML(data.stats);
    
    return `
      <div class="card-content split-layout">
        <div class="card-left">
          <div class="card-avatar-container ${currentImageStyle}-style">
            <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
          </div>
        </div>
        <div class="card-right">
          <div class="card-header">
            <h3 class="card-name">${data.name}</h3>
            <div class="card-class">${data.characterClass}</div>
          </div>
          <div class="card-body">
            <div class="card-rarity rarity-${data.rarity}">${data.rarity.charAt(0).toUpperCase() + data.rarity.slice(1)}</div>
            <div class="card-quote">"${data.quote}"</div>
            ${statsHTML}
          </div>
        </div>
      </div>
    `;
  }

  // Generate hero layout HTML
  function generateHeroLayout(data) {
    const statsHTML = generateStatsHTML(data.stats);
    
    return `
      <div class="card-hero-header">
        <div class="hero-image-container ${currentImageStyle}-style">
          <img src="${data.avatar}" alt="${data.name}" class="card-avatar hero-image" />
          <div class="hero-overlay">
            <h3 class="card-name hero-name">${data.name}</h3>
          </div>
        </div>
      </div>
      <div class="card-body hero-body">
        <div class="card-class">${data.characterClass}</div>
        <div class="card-rarity rarity-${data.rarity}">${data.rarity.charAt(0).toUpperCase() + data.rarity.slice(1)}</div>
        <div class="card-quote">"${data.quote}"</div>
        ${statsHTML}
      </div>
    `;
  }

  // Generate minimal layout HTML
  function generateMinimalLayout(data) {
    const statsHTML = generateStatsHTML(data.stats);
    
    return `
      <div class="card-content minimal-layout">
        <div class="minimal-header">
          <div class="card-avatar-container ${currentImageStyle}-style minimal-avatar">
            <img src="${data.avatar}" alt="${data.name}" class="card-avatar" />
          </div>
          <div class="minimal-info">
            <h3 class="card-name">${data.name}</h3>
            <div class="card-class">${data.characterClass}</div>
            <div class="card-rarity rarity-${data.rarity}">${data.rarity.charAt(0).toUpperCase() + data.rarity.slice(1)}</div>
          </div>
        </div>
        <div class="card-quote minimal-quote">"${data.quote}"</div>
        ${statsHTML}
      </div>
    `;
  }

  // Update back face content
  function updateBackFace(back, data) {
    const socialHTML = generateSocialLinksHTML(data.socialLinks);
    const badgesHTML = generateBadgesHTML(data.badges);
    const attributesHTML = generateAttributesHTML(data.attributes);
    
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
              ${socialHTML}
            </div>
          </div>
          
          <div class="back-section badges-section">
            <h4 class="section-title">Badges & Achievements</h4>
            <div class="badges-container">
              ${badgesHTML}
            </div>
          </div>
          
          <div class="back-section attributes-section">
            <h4 class="section-title">Attributes</h4>
            <div class="attributes-container">
              ${attributesHTML}
            </div>
          </div>
          
          <div class="back-footer">
            <div class="card-rarity rarity-${data.rarity}">${data.rarity.charAt(0).toUpperCase() + data.rarity.slice(1)}</div>
          </div>
        </div>
      </div>
    `;
  }

  // Expose global functions for external access
  window.updatePreview = updatePreview;
  window.currentPreset = currentPreset;
  window.currentLayout = currentLayout;
  window.currentPalette = currentPalette;
  window.currentImageStyle = currentImageStyle;
  window.currentImageVariant = currentImageVariant;

})();
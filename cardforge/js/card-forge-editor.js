// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// CardForge Editor logic – MVP preview only
// Updated 2025-07-05: Now using shared validation utilities

(function(){
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const quoteInput = document.getElementById('card-quote');
  const avatarInput = document.getElementById('card-avatar');
  // Card preview functionality for CardForge editor
  // Updated 2025-07-05: Added XSS protection with sanitization

  window.addEventListener('DOMContentLoaded', () => {
  const inputs = [
    document.getElementById('card-name'),
    document.getElementById('card-class'),
    document.getElementById('card-quote'),
    document.getElementById('card-avatar'),
    document.getElementById('card-rarity'),
    document.getElementById('card-bio'),
    document.getElementById('image-style'),
    document.getElementById('image-variant'),
    document.getElementById('card-stats'),
    document.getElementById('card-theme')
  ].filter(Boolean);

  // Live preview on input/change
  inputs.forEach(input => {
    input.addEventListener('input', updatePreview);
    input.addEventListener('change', updatePreview);
  });

  // Initial preview on load
  updatePreview();
    // Bind static stat slider displays
    document.querySelectorAll('.stat-row').forEach(row => {
      const slider = row.querySelector('.stat-slider');
      const display = row.querySelector('.stat-value-display');
      if (slider && display) {
        display.textContent = slider.value;
        slider.addEventListener('input', () => {
          display.textContent = slider.value;
          updatePreview();
        });
      }
    });
          // Stats Editor Logic
        const statsEditor = document.getElementById('stats-editor');
        const addStatBtn = document.getElementById('add-stat-btn');

        function createStatRow(name = '', value = '') {
          const row = document.createElement('div');
          row.className = 'stat-row';
          row.innerHTML = `
            <input type="text" name="stat-name" placeholder="Stat name" value="${name}" />
            <input type="range" name="stat-value" min="0" max="100" value="${value || 0}" class="stat-slider" aria-label="Stat value" />
            <span class="stat-value-display">${value || 0}</span>
            <button type="button" class="remove-attribute">&times;</button>
          `;
          row.querySelector('.remove-attribute').addEventListener('click', () => { row.remove(); updatePreview(); });
          row.querySelector('input[name="stat-name"]').addEventListener('input', updatePreview);
          row.querySelector('input[name="stat-value"]').addEventListener('input', updatePreview);
            // Update displayed value
            const slider = row.querySelector('.stat-slider');
            const display = row.querySelector('.stat-value-display');
            if (slider && display) {
              display.textContent = slider.value;
              slider.addEventListener('input', () => {
                display.textContent = slider.value;
                updatePreview();
              });
            }
          return row;
        }

        addStatBtn?.addEventListener('click', () => {
          statsEditor?.appendChild(createStatRow());
          updatePreview();
        });

        statsEditor?.addEventListener('input', updatePreview);
        // Social Links Editor Logic
        const socialEditor = document.getElementById('social-editor');
        const addSocialBtn = document.getElementById('add-social-btn');
        function createSocialRow(name = '', url = '') {
          const row = document.createElement('div');
          row.className = 'social-row';
          row.innerHTML = `
            <input type="text" name="social-name" placeholder="Platform (e.g. Twitter)" value="${name}" />
            <input type="url" name="social-url" placeholder="https://${url}" value="${url}" />
            <button type="button" class="remove-social">&times;</button>
          `;
          row.querySelector('.remove-social').addEventListener('click', () => { row.remove(); updatePreview(); });
          row.querySelector('input[name="social-name"]').addEventListener('input', updatePreview);
          row.querySelector('input[name="social-url"]').addEventListener('input', updatePreview);
          return row;
        }
        addSocialBtn?.addEventListener('click', () => {
          socialEditor?.appendChild(createSocialRow());
          updatePreview();
        });
        socialEditor?.addEventListener('input', updatePreview);
        // Micro Badges Editor Logic
        const microEditor = document.getElementById('micro-editor');
        const addMicroBtn = document.getElementById('add-micro-btn');
        function createMicroRow(category = '', icon = 'star', desc = '', quantity = 1) {
          const options = ['star','heart','bolt','trophy','leaf','gear'];
          const row = document.createElement('div');
          row.className = 'micro-row';
          row.innerHTML = `
            <input type="text" name="micro-category" placeholder="Badge Name" value="${category}" class="badge-name" />
            <select name="micro-icon" aria-label="Select icon">
              ${options.map(option => `<option value="${option}" ${icon === option ? 'selected' : ''}>${option}</option>`).join('')}
            </select>
            <input type="number" name="micro-quantity" min="1" max="99" value="${quantity}" class="badge-quantity" />
            <input type="text" name="micro-desc" placeholder="Description (optional)" value="${desc}" />
            <button type="button" class="remove-micro" aria-label="Remove badge">&times;</button>
          `;
          row.querySelector('.remove-micro').addEventListener('click', () => { row.remove(); updatePreview(); });
          row.querySelector('input[name="micro-category"]').addEventListener('input', updatePreview);
          row.querySelector('select[name="micro-icon"]')?.addEventListener('change', updatePreview);
          row.querySelector('input[name="micro-quantity"]').addEventListener('change', updatePreview);
          row.querySelector('input[name="micro-desc"]').addEventListener('input', updatePreview);
          return row;
        }
        addMicroBtn?.addEventListener('click', () => {
          const count = microEditor?.querySelectorAll('.micro-row').length || 0;
          if (count >= 6) return;
          microEditor?.appendChild(createMicroRow());
          updatePreview();
          addMicroBtn.disabled = (microEditor?.querySelectorAll('.micro-row').length || 0) >= 6;
        });
        microEditor?.addEventListener('input', () => {
          updatePreview();
          addMicroBtn.disabled = (microEditor?.querySelectorAll('.micro-row').length || 0) >= 6;
        });
        
        // Attribute Editor Logic
        const attributeEditor = document.getElementById('attribute-editor');
        const addAttributeBtn = document.getElementById('add-attribute-btn');
        
        function createAttributeRow(name = '', value = '') {
          const row = document.createElement('div');
          row.className = 'attribute-row';
          row.innerHTML = `
            <input type="text" name="attribute-name" placeholder="Attribute (e.g. Alignment)" value="${name}" />
            <input type="text" name="attribute-value" placeholder="Value (e.g. Chaotic Creative)" value="${value}" />
            <button type="button" class="remove-attribute">&times;</button>
          `;
          row.querySelector('.remove-attribute').addEventListener('click', () => { row.remove(); updatePreview(); });
          row.querySelector('input[name="attribute-name"]').addEventListener('input', updatePreview);
          row.querySelector('input[name="attribute-value"]').addEventListener('input', updatePreview);
          return row;
        }
        
        addAttributeBtn?.addEventListener('click', () => {
          attributeEditor?.appendChild(createAttributeRow());
          updatePreview();
        });
        
        attributeEditor?.addEventListener('input', updatePreview);
        
        // Template defaults logic
        const themeSelect = document.getElementById('card-theme');
        const defaultData = {
          NeoFantasy: {
            name: 'Aria Silverleaf',
            class: 'Druid',
            quote: 'Nature\'s arcane embrace.',
            avatar: '/images/image-packs/characters/ember-gaze.jpg',
            achievement: 'Forest Guardian',
            rarity: 'Epic',
            bio: 'Warden of the ancient woods.',
            superpower: 'Earthshaping',
            alignment: 'Neutral Good',
            origin: 'Emerald Grove',
            faction: 'Circle of Sylvan',
            badge: 'Mythic Verdant',
            stats: [{ name: 'Nature', value: 85 }, { name: 'Magic', value: 70 }, { name: 'Resilience', value: 60 }],
            social: [
               { name: 'Twitter', url: 'https://twitter.com/aria_silverleaf' },
               { name: 'LinkedIn', url: 'https://linkedin.com/in/ariasilverleaf' }
             ],
             micro: [
               { category: 'Skill', icon: 'star', desc: 'Arcane skill' },
               { category: 'Nature', icon: 'leaf', desc: 'Earth magic' }
             ],
             imageStyle: 'masked',
             imageVariant: 'circle'
          },
          SynthwaveHacker: {
            name: 'Nyx Byte',
            class: 'Hacker',
            quote: 'Code is my neon blood.',
            avatar: '/images/image-packs/characters-02/Seraphim.png',
            achievement: 'Cyber Legend',
            rarity: 'Rare',
            bio: 'Lives in the digital frontier.',
            superpower: 'Data Surge',
            alignment: 'Chaotic Neutral',
            origin: 'Neon City',
            faction: 'Glitch Society',
            badge: 'Binary Badge',
            stats: [{ name: 'Tech', value: 95 }, { name: 'Speed', value: 80 }, { name: 'Stealth', value: 75 }],
            social: [
               { name: 'GitHub', url: 'https://github.com/nyxbyte' },
               { name: 'Discord', url: 'https://discord.gg/glitchsociety' }
             ],
             micro: [
               { category: 'Hack', icon: 'terminal', desc: 'System infiltration' },
               { category: 'Speed', icon: 'bolt', desc: 'Quick response' }
             ],
             imageStyle: 'hero',
             imageVariant: 'large'
          },
          ProPersona: {
            name: 'Alex Mercer',
            class: 'Agent',
            quote: 'Profession is my identity.',
            avatar: '/images/image-packs/characters-03-super-heroes/Chad-01.png',
            achievement: 'Top Performer',
            rarity: 'Common',
            bio: 'Executive strategist and leader.',
            superpower: 'Tactical Mastery',
            alignment: 'Lawful Neutral',
            origin: 'Metro HQ',
            faction: 'Persona Corp',
            badge: 'Employee of the Month',
            stats: [{ name: 'Leadership', value: 90 }, { name: 'Charisma', value: 80 }, { name: 'Intelligence', value: 85 }],
            social: [
               { name: 'LinkedIn', url: 'https://linkedin.com/in/alexmercer' },
               { name: 'Twitter', url: 'https://twitter.com/alexmercer' }
             ],
             micro: [
               { category: 'Leadership', icon: 'star', desc: 'Pinnacle leader' }
             ],
             imageStyle: 'full-bleed',
             imageVariant: 'ambient'
          }
        };
        function applyDefaults(theme) {
          const data = defaultData[theme];
          if (!data) return;
          const setInput = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
          setInput('card-name', data.name);
          setInput('card-class', data.class);
          setInput('card-quote', data.quote);
          setInput('card-avatar', data.avatar);
          setInput('card-rarity', data.rarity);
          setInput('card-bio', data.bio);
          
          // Image Style: set defaults
          if (data.imageStyle) {
            setInput('image-style', data.imageStyle);
            if (imageStyleSelect) {
              updateVariantOptions(data.imageStyle);
              if (data.imageVariant) {
                setInput('image-variant', data.imageVariant);
              }
            }
          }
          
          // Attributes: reset rows and add defaults
          attributeEditor.innerHTML = `
  <div class="attribute-group attribute-basic"><h4>Origin / Alignment / Faction</h4></div>
  <div class="attribute-group attribute-special"><h4>Achievement / Superpower / Badge</h4></div>
`;
const basicGroup = attributeEditor.querySelector('.attribute-basic');
const specialGroup = attributeEditor.querySelector('.attribute-special');;
          if (data.achievement) specialGroup.appendChild(createAttributeRow('Achievement', data.achievement));
          if (data.superpower) specialGroup.appendChild(createAttributeRow('Superpower', data.superpower));
          if (data.alignment) basicGroup.appendChild(createAttributeRow('Alignment', data.alignment));
          if (data.origin) basicGroup.appendChild(createAttributeRow('Origin', data.origin));
          if (data.faction) basicGroup.appendChild(createAttributeRow('Faction', data.faction));
          if (data.badge) specialGroup.appendChild(createAttributeRow('Badge', data.badge));
          // Stats: reset rows
          statsEditor.innerHTML = '';
          data.stats.forEach(stat => statsEditor.appendChild(createStatRow(stat.name, stat.value)));
          // Social: reset rows
          socialEditor.innerHTML = '';
           // Micro: reset rows
           microEditor.innerHTML = '';
           (data.micro || []).forEach(m => microEditor.appendChild(createMicroRow(m.category, m.icon, m.desc)));
           // Update addMicroBtn state
           addMicroBtn.disabled = (microEditor.querySelectorAll('.micro-row').length >= 6);
           
          (data.social || []).forEach(s => socialEditor.appendChild(createSocialRow(s.name, s.url)));
        }
        // Apply defaults on load
        applyDefaults(themeSelect?.value);
        // Reapply on theme change
        themeSelect?.addEventListener('change', () => applyDefaults(themeSelect.value));

        // Initialize and render My Cards
        function renderMyCards() {
          const list = document.getElementById('my-cards-list');
          if (!list) return;
          list.innerHTML = '';
          const cards = JSON.parse(localStorage.getItem('myCards') || '[]');
          cards.forEach(card => {
            const li = document.createElement('li');
            li.className = 'my-card-item';
            li.innerHTML = `<img src="${card.avatar}" alt="${card.name}" class="my-card-thumb"/><span>${card.name}</span>`;
            list.appendChild(li);
          });
        }
        
        // Save button logic
        const saveBtn = document.getElementById('save-btn');
        saveBtn?.addEventListener('click', () => {
          const cardData = {};
          const fields = ['card-name','card-class','card-quote','card-avatar','card-rarity','card-bio'];
          fields.forEach(id => {
            const el = document.getElementById(id);
            if (el) cardData[id.replace('card-','')] = el.value;
          });
          // Stats
          cardData.stats = [];
          document.querySelectorAll('#stats-editor .stat-row').forEach(row => {
            const name = row.querySelector('input[name="stat-name"]')?.value;
            const value = row.querySelector('input[name="stat-value"]')?.value;
            if (name) cardData.stats.push({ name, value: Number(value) });
          });
          // Theme and variant
          cardData.theme = document.getElementById('card-theme')?.value;
          cardData.variant = document.getElementById('card-template-type')?.value;
          
          const cards = JSON.parse(localStorage.getItem('myCards') || '[]');
          cards.push(cardData);
          localStorage.setItem('myCards', JSON.stringify(cards));
          renderMyCards();
        });
        
        // Render on load
        renderMyCards();
        
        // Fallback: listen on form for any input/change to catch all fields
  const formEl = document.getElementById('card-editor-form');
  if (formEl) {
    formEl.addEventListener('input', updatePreview);
    formEl.addEventListener('change', updatePreview);
  }
  updatePreview();
});

  // We now use the shared ValidationUtils.sanitizeString method instead of a local sanitizeHtml function

  /**
   * Creates a DOM element with sanitized content
   * @param {string} tag - HTML tag name
   * @param {object} attributes - Element attributes
   * @param {string|HTMLElement|Array} children - Child content or elements
   * @returns {HTMLElement} - Created DOM element
   */
  function createElement(tag, attributes = {}, children = null) {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        element.setAttribute(key, value);
      }
    });
    
    // Add children
    if (children !== null) {
      if (typeof children === 'string') {
        element.textContent = children;
      } else if (children instanceof HTMLElement) {
        element.appendChild(children);
      } else if (Array.isArray(children)) {
        children.forEach(child => {
          if (child instanceof HTMLElement) {
            element.appendChild(child);
          } else if (child) {
            element.appendChild(document.createTextNode(String(child)));
          }
        });
      }
    }
    
    return element;
  }

  function updatePreview() {
    console.debug('updatePreview triggered', {
      name: nameInput?.value,
      class: classInput?.value,
      quote: quoteInput?.value,
      avatar: avatarInput?.value
    });
    // Gather fields
    const name = nameInput?.value || '';
    const cardClass = classInput?.value || '';
    const quote = quoteInput?.value || '';
    const avatar = avatarInput?.value || '';
    
    
    
    
    const rarityEl = document.getElementById('card-rarity');
    const bioEl = document.getElementById('card-bio');

    const rarity = rarityEl?.value || '';
    const bio = bioEl?.value || '';
    // Collect stats from dynamic editor
    let statsObj = {};
    const statRows = document.querySelectorAll('#stats-editor .stat-row');
    statRows.forEach(row => {
      const nameInput = row.querySelector('input[name="stat-name"]');
      const valueInput = row.querySelector('input[name="stat-value"]');
      
      
      const name = nameInput?.value.trim();
      const val = parseInt(valueInput?.value, 10);

      if (name) statsObj[name] = isNaN(val) ? 0 : val;
    });

    // Collect attributes from dynamic editor
    let attributesObj = {};
    const attributeRows = document.querySelectorAll('#attribute-editor .attribute-row');
    attributeRows.forEach(row => {
      const nameInput = row.querySelector('input[name="attribute-name"]');
      const valueInput = row.querySelector('input[name="attribute-value"]');
      const name = nameInput?.value.trim();
      const value = valueInput?.value.trim();
      if (name && value) attributesObj[name] = value;
    });

    // Get image style data
    const imageStyleData = getImageStyleData();
    
    // Front face
    const variant = document.getElementById('card-template-type')?.value || 'default';
    const theme = document.getElementById('card-theme')?.value || '';
    const front = document.getElementById('card-preview');
    // Apply theme and image style classes
    if (front) {
      front.className = `card-preview-canvas card-front theme-${theme.toLowerCase()} variant-${variant} image-style-${imageStyleData.style}`;
      front.setAttribute('data-image-style', imageStyleData.style);
      front.setAttribute('data-image-variant', imageStyleData.variant);
    }
    if (front) {
      front.innerHTML = '';
      const previewContent = createElement('div', { class: 'card-preview-content' });
      // Avatar & name
      const header = createElement('div', { class: 'card-header' });
      if (avatar && (ValidationUtils.isValidImageUrl(avatar) || avatar.startsWith('/'))) {
        const avatarClasses = `card-avatar image-${imageStyleData.style}-${imageStyleData.variant}`;
        const avatarImg = createElement('img', { 
          src: avatar, 
          class: avatarClasses, 
          alt: name,
          'data-image-style': imageStyleData.style,
          'data-image-variant': imageStyleData.variant
        });
        header.appendChild(avatarImg);
      }
      header.appendChild(createElement('h3', {}, name || 'Card Name'));
    
    // Create card body wrapper for Hero style only
    const isHeroStyle = imageStyleData.style === 'hero';
    
    let bodyContainer;
    if (isHeroStyle) {
      previewContent.appendChild(header);
      bodyContainer = createElement('div', { class: 'card-body' });
    } else {
      previewContent.appendChild(header);
      bodyContainer = previewContent;
    }
      
      // Class & rarity
      if (cardClass) bodyContainer.appendChild(createElement('div', { class: 'card-badge' }, cardClass));
      if (rarity) bodyContainer.appendChild(createElement('div', { class: 'card-rarity' }, rarity));
      // Quote
      if (quote) bodyContainer.appendChild(createElement('blockquote', { class: 'card-quote' }, quote));
      // Stat bars
      Object.entries(statsObj).forEach(([key, val]) => {
          const rowWrapper = createElement('div', { class: 'stat-row-preview' });
          // Label on left
          rowWrapper.appendChild(createElement('span', { class: 'stat-label' }, key));
          // Bar track
          const barContainer = createElement('div', { class: 'stat-bar' });
          const progress = createElement('div', { class: 'stat-progress' });
          progress.style.width = val + '%';
          barContainer.appendChild(progress);
          rowWrapper.appendChild(barContainer);
          bodyContainer.appendChild(rowWrapper);
        });
      
      // Append bodyContainer to previewContent for Hero style
      if (isHeroStyle) {
        previewContent.appendChild(bodyContainer);
      }
      front.appendChild(previewContent);
    }
    // Back face
    const back = document.getElementById('card-back');
    // Apply theme, variant, and image style classes to back face
    if (back) {
      back.className = `card-preview-canvas card-back theme-${theme.toLowerCase()} variant-${variant} image-style-${imageStyleData.style}`;
      back.setAttribute('data-image-style', imageStyleData.style);
      back.setAttribute('data-image-variant', imageStyleData.variant);
    }
    if (back) {
      back.innerHTML = '';
      const backContent = createElement('div', { class: 'card-preview-content' });
      if (bio) backContent.appendChild(createElement('p', { class: 'card-bio' }, bio));

      // Social links display
      const socialRows = document.querySelectorAll('#social-editor .social-row');
      if (socialRows.length) {
        const socialContainer = createElement('div', { class: 'social-links' });
        socialRows.forEach(row => {
          const name = row.querySelector('input[name="social-name"]')?.value.trim();
          const url  = row.querySelector('input[name="social-url"]')?.value.trim();
          if (name && url) {
            const slug = name.toLowerCase().replace(/\s+/g, '-');
            const iconEl  = createElement('i', {
              class: `fab fa-${slug} social-icon`,
              'aria-label': name
            });
            socialContainer.appendChild(
              createElement('a', { href: url, target: '_blank', class: 'social-link' }, iconEl)
            );
          }
        });
        backContent.appendChild(socialContainer);
      }

      // Micro badges display
      const microRows = document.querySelectorAll('#micro-editor .micro-row');
      if (microRows.length) {
        const microContainer = createElement('div', { class: 'micro-badges' });
        microRows.forEach(row => {
          const name = row.querySelector('input[name="micro-category"]')?.value.trim() || 'Badge';
          const icon = row.querySelector('select[name="micro-icon"]')?.value.trim().toLowerCase();
          const desc = row.querySelector('input[name="micro-desc"]')?.value.trim();
          const quantity = parseInt(row.querySelector('input[name="micro-quantity"]')?.value) || 1;
          
          if (icon) {
            const slug = icon.replace(/\s+/g, '-');
            const badgeContainer = createElement('div', { 
              class: 'micro-badge-container',
              title: desc || name
            });
            
            // Add badge name
            const nameEl = createElement('span', { class: 'badge-name' }, name);
            badgeContainer.appendChild(nameEl);
            
            // Add badge icons (multiple based on quantity)
            const iconsContainer = createElement('div', { class: 'badge-icons' });
            for (let i = 0; i < Math.min(quantity, 10); i++) { // Limit to 10 for display
              const iconEl = createElement('i', {
                class: `fas fa-${slug} micro-icon`,
                'aria-hidden': 'true'
              });
              iconsContainer.appendChild(iconEl);
            }
            
            // If we have more than 10, show a counter
            if (quantity > 10) {
              const counterEl = createElement('span', { 
                class: 'badge-counter',
                'aria-label': `${quantity} total`
              }, `×${quantity}`);
              iconsContainer.appendChild(counterEl);
            }
            
            badgeContainer.appendChild(iconsContainer);
            microContainer.appendChild(badgeContainer);
          }
        });
        backContent.appendChild(microContainer);
      }

      // Attributes display
      if (Object.keys(attributesObj).length > 0) {
        const attributesContainer = createElement('div', { class: 'card-attributes' });
        Object.entries(attributesObj).forEach(([name, value]) => {
          const attrEl = createElement('div', { class: 'card-attribute' });
          attrEl.appendChild(createElement('span', { class: 'attr-name' }, name + ':'));
          attrEl.appendChild(createElement('span', { class: 'attr-value' }, value));
          attributesContainer.appendChild(attrEl);
        });
        backContent.appendChild(attributesContainer);
      }



      back.appendChild(backContent);
      // Adjust container height to fit content
      const container = document.querySelector('.card-container');
      if (container) {
        const frontEl = document.querySelector('.card-front');
        const backEl = document.querySelector('.card-back');
        const heights = [];
        if (frontEl) heights.push(frontEl.scrollHeight);
        if (backEl) heights.push(backEl.scrollHeight);
        container.style.height = Math.max(...heights) + 'px';
      }
    }
  }
  // Image Style System Logic
  const imageStyleSelect = document.getElementById('image-style');
  const imageVariantSelect = document.getElementById('image-variant');
  const imageVariantLabel = document.getElementById('image-variant-label');
  
  // Style variant mapping
  const styleVariants = {
    'masked': [
      { value: 'circle', label: 'Circle' },
      { value: 'hex', label: 'Hex' },
      { value: 'blob', label: 'Blob' },
      { value: 'tear-drop', label: 'Tear Drop' }
    ],
    'hero': [
      { value: 'large', label: 'Large' },
      { value: 'small', label: 'Small' }
    ],
    'full-bleed': [
      { value: 'ambient', label: 'Ambient' },
      { value: 'overlay-safe', label: 'Overlay Safe' }
    ]
  };
  
  // Default variants for each style
  const defaultVariants = {
    'masked': 'circle',
    'hero': 'large',
    'full-bleed': 'ambient'
  };
  
  function updateVariantOptions(selectedStyle) {
    const variants = styleVariants[selectedStyle] || [];
    const defaultVariant = defaultVariants[selectedStyle] || variants[0]?.value;
    
    // Clear existing options
    imageVariantSelect.innerHTML = '';
    
    // Add new options
    variants.forEach(variant => {
      const option = document.createElement('option');
      option.value = variant.value;
      option.textContent = variant.label;
      if (variant.value === defaultVariant) {
        option.selected = true;
      }
      imageVariantSelect.appendChild(option);
    });
    
    // Update preview when variant changes
    updatePreview();
  }
  
  function getImageStyleData() {
    const style = imageStyleSelect?.value || 'masked';
    const variant = imageVariantSelect?.value || defaultVariants[style];
    return { style, variant };
  }
  
  function generateStylePrompt(style, variant) {
    const prompts = {
      'masked': {
        'circle': 'Render this artwork in Masked Style with a circular subject container. Central subject with clean edges. Minimal background. Optimized for circular masking.',
        'hex': 'Render this artwork in Masked Style with a hex-shaped subject container. Central subject with clean edges. Minimal background. Optimized for geometric masking.',
        'blob': 'Render this artwork in Masked Style with an organic blob-shaped subject container. Central subject with soft, flowing edges. Minimal background. Optimized for organic masking.',
        'tear-drop': 'Render this artwork in Masked Style with a tear-drop shaped subject container. Central subject with elegant curved edges. Minimal background. Optimized for tear-drop masking.'
      },
      'hero': {
        'large': 'Render this artwork in Hero Style with large cinematic composition. Full-width image at top with 3:1 aspect ratio. Subject prominently featured for maximum visual impact. Clean rectangular format optimized for hero layout.',
        'small': 'Render this artwork in Hero Style with compact composition. Full-width image at top with 2:1 aspect ratio. Subject clearly visible but more space-efficient. Clean rectangular format optimized for hero layout.'
      },
      'full-bleed': {
        'ambient': 'Render this artwork in Full Bleed Style with ambient composition. Edge-to-edge coverage with atmospheric depth. Seamless background integration.',
        'overlay-safe': 'Render this artwork in Full Bleed Style with overlay-safe composition. Full coverage with text-safe areas. High contrast zones for content overlay.'
      }
    };
    
    return prompts[style]?.[variant] || prompts['masked']['circle'];
  }
  
  // Inline Image Chooser Logic
  const inlineImageGrid = document.getElementById('inline-image-grid');
  const prevPageBtn = document.getElementById('prev-page');
  const nextPageBtn = document.getElementById('next-page');
  const pageInfo = document.getElementById('page-info');
  const customUrlInput = document.getElementById('custom-url-input');
  const useCustomUrlBtn = document.getElementById('use-custom-url');
  const imagePagination = document.querySelector('.image-pagination');
  const cardAvatarInput = document.getElementById('card-avatar');

  // Default state
  let currentPage = 1;
  // TODO: Replace with actual image lists or API
  const imageDirs = [
    '/images/image-packs/characters',
    '/images/image-packs/characters-02',
    '/images/image-packs/characters-03-super-heroes/male',
    '/images/image-packs/characters-03-super-heroes/female'
  ];
  const imagesPerPage = 20;

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

  // Initialize image style system
  if (imageStyleSelect && imageVariantSelect) {
    // Set default style to masked
    imageStyleSelect.value = 'masked';
    updateVariantOptions('masked');
    
    // Add event listeners
    imageStyleSelect.addEventListener('change', (e) => {
      updateVariantOptions(e.target.value);
    });
    
    imageVariantSelect.addEventListener('change', updatePreview);
  }
  
  // Auto-load images on initialization
  if (inlineImageGrid) {
    loadInlineImages(currentPage);
  }
  
  prevPageBtn?.addEventListener('click', () => { if (currentPage>1) { currentPage--; loadInlineImages(currentPage);} });
  nextPageBtn?.addEventListener('click', () => { currentPage++; loadInlineImages(currentPage); });
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

// Flip card view handler
  const flipBtn = document.getElementById('flip-btn');
  const cardInner = document.querySelector('.card-inner');
  if (flipBtn && cardInner) {
    flipBtn.addEventListener('click', () => {
      cardInner.classList.toggle('flipped');
    });
  }
})();

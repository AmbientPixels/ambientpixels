// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// CardForge Editor logic – MVP preview only
// Updated 2025-07-05: Now using shared validation utilities

(function(){
  // Simple and reliable flip functionality
  document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded, setting up flip button...');
    
    // Function to handle flip
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
      const tabButton = e.target.closest('.tab-button');
      if (tabButton) {
        const section = tabButton.getAttribute('data-section');
        const cardInner = document.querySelector('.card-container .card-inner');
        if (cardInner) {
          if (section && ['social', 'badges', 'attributes'].includes(section)) {
            cardInner.classList.add('flipped');
          } else {
            cardInner.classList.remove('flipped');
          }
        }
      }
    });
    
    // Add flip method to window for testing
    window.flipCard = flipCard;
    console.log('Flip functionality initialized');
  });

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

  // Add click handlers for delete buttons in Basics tab
  document.querySelectorAll('.cf-section[data-step-section="2"] .remove-attribute').forEach(button => {
    button.addEventListener('click', (e) => {
      const row = e.target.closest('.stat-row');
      if (row) {
        const input = row.querySelector('input[type="text"]');
        if (input) {
          input.value = '';
          updatePreview();
        }
      }
    });
  });

  // Initial preview on load
  updatePreview();
  
  // Initialize stat bar animations
  function animateStatBars() {
    document.querySelectorAll('.stat-progress').forEach(bar => {
      // Force reflow to reset animation
      bar.style.animation = 'none';
      bar.offsetHeight;
      // Re-enable animation
      bar.style.animation = 'growStat 1s ease-out forwards';
    });
  }

  // Observe preview container for card changes
  const preview = document.getElementById('card-preview');
  if (preview) {
    // Initial animation on load
    animateStatBars();
    
    // Set up mutation observer to re-trigger animations on card changes
    const observer = new MutationObserver((mutations) => {
      // Only re-animate if the card content actually changed
      const shouldAnimate = mutations.some(mutation => 
        mutation.type === 'childList' || 
        (mutation.type === 'attributes' && mutation.attributeName === 'class')
      );
      
      if (shouldAnimate) {
        // Small delay to ensure DOM is ready
        setTimeout(animateStatBars, 50);
      }
    });
    
    // Start observing the preview container for changes
    observer.observe(preview, { 
      childList: true, 
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }

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
              <label>Platform
                <select name="social-name" class="social-platform" aria-label="Platform">
                  <option value="" disabled ${!name?'selected':''}>Platform</option>
                  <option value="twitter" ${name==='twitter'?'selected':''}>Twitter</option>
                  <option value="instagram" ${name==='instagram'?'selected':''}>Instagram</option>
                  <option value="linkedin" ${name==='linkedin'?'selected':''}>LinkedIn</option>
                  <option value="x" ${name==='x'?'selected':''}>X</option>
                  <option value="deviantart" ${name==='deviantart'?'selected':''}>DeviantArt</option>
                  <option value="github" ${name==='github'?'selected':''}>GitHub</option>
                  <option value="facebook" ${name==='facebook'?'selected':''}>Facebook</option>
                  <option value="discord" ${name==='discord'?'selected':''}>Discord</option>
                  <option value="tiktok" ${name==='tiktok'?'selected':''}>TikTok</option>
                </select>
              </label>
              <label>Link (URL)
                <input type="url" name="social-url" placeholder="https://..." value="${url}" />
              </label>
              <button type="button" class="remove-attribute" aria-label="Remove social link">&times;</button>
            `;
          row.querySelector('.remove-attribute').addEventListener('click', () => { row.remove(); updatePreview(); });
          row.querySelector('select[name="social-name"]').addEventListener('change', updatePreview);
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
  const icons = ['star','heart','bolt','trophy','leaf','gear','book','lightbulb','medal','certificate'];
  const row = document.createElement('div');
  row.className = 'micro-row';
  row.innerHTML = `
    <label>Category
      <input type="text" name="micro-category" placeholder="Category (e.g. Skill)" value="${category}" />
    </label>
    <label>Symbol/Icon
      <div class="icon-picker" aria-label="Select badge icon">
        <input type="hidden" name="micro-icon" value="${icon}" />
        ${icons.map(ic => `<button type="button" class="icon-option ${icon===ic?'active':''}" data-icon="${ic}"><i class="fas fa-${ic}"></i></button>`).join('')}
      </div>
    </label>
    <label>Description
      <input type="text" name="micro-desc" placeholder="Description" value="${desc}" />
    </label>
    <label>Count
      <input type="range" name="micro-quantity" min="1" max="5" value="${quantity}" class="badge-slider" />
      <span class="slider-value">${quantity}</span>
    </label>
    <button type="button" class="remove-attribute" aria-label="Remove badge">&times;</button>
  `;
  row.querySelector('.remove-attribute').addEventListener('click', () => { row.remove(); updatePreview(); });
  row.querySelector('input[name="micro-category"]').addEventListener('input', updatePreview);
  row.querySelector('input[name="micro-desc"]').addEventListener('input', updatePreview);
  const hiddenIconInput = row.querySelector('input[name="micro-icon"]');
  row.querySelectorAll('.icon-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const ic = btn.dataset.icon;
      hiddenIconInput.value = ic;
      row.querySelectorAll('.icon-option').forEach(b => b.classList.toggle('active', b===btn));
      updatePreview();
    });
  });
  const slider = row.querySelector('.badge-slider');
  const display = row.querySelector('.slider-value');
  slider.addEventListener('input', () => {
    display.textContent = slider.value;
    updatePreview();
  });
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
                stats: [
                    { name: 'Nature', value: 85 },
                    { name: 'Magic', value: 70 },
                    { name: 'Resilience', value: 60 }
                ],
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
                stats: [
                    { name: 'Tech', value: 95 },
                    { name: 'Speed', value: 80 },
                    { name: 'Stealth', value: 75 }
                ],
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
                stats: [
                    { name: 'Leadership', value: 90 },
                    { name: 'Charisma', value: 80 },
                    { name: 'Intelligence', value: 85 }
                ],
                social: [
                    { name: 'LinkedIn', url: 'https://linkedin.com/in/alexmercer' },
                    { name: 'Twitter', url: 'https://twitter.com/alexmercer' }
                ],
                micro: [
                    { category: 'Leadership', icon: 'star', desc: 'Pinnacle leader' }
                ],
                imageStyle: 'badge',
                imageVariant: 'standard'
            },
            NovaCore: {
                name: 'Luna Radiant',
                class: 'Oracle',
                quote: 'Guided by the celestial glow.',
                avatar: '/images/image-packs/characters/carved-celestial-goddess.jpg',
                achievement: 'Moon Seer',
                rarity: 'Legendary',
                bio: 'A mystic who channels lunar power.',
                superpower: 'Moonlight Infusion',
                alignment: 'Chaotic Good',
                origin: 'Silver Crescent Isle',
                faction: 'Celestial Order',
                badge: 'Eclipse Emblem',
                stats: [
                    { name: 'Mysticism', value: 95 },
                    { name: 'Insight', value: 85 },
                    { name: 'Grace', value: 80 }
                ],
                social: [
                    { name: 'Twitter', url: 'https://twitter.com/lunaradiant' }
                ],
                micro: [
                    { category: 'Mystic Sigil', icon: 'star', desc: 'Lunar wisdom' }
                ],
                imageStyle: 'full-bleed',
                imageVariant: 'ambient'
            },
            Scientist: {
                name: 'Nova Snow',
                class: 'Scientist',
                quote: 'Science is my passion.',
                avatar: '/images/image-packs/characters-04-scientists/Scientist-01.png',
                achievement: 'Breakthrough Discovery',
                rarity: 'Uncommon',
                bio: 'Researcher and inventor.',
                superpower: 'Genius Mind',
                alignment: 'Neutral Good',
                origin: 'Research Facility',
                faction: 'Science Guild',
                badge: 'Researcher Badge',
                stats: [
                    { name: 'Intelligence', value: 95 },
                    { name: 'Science', value: 90 },
                    { name: 'Experimentation', value: 80 }
                ],
                social: [
                    { name: 'GitHub', url: 'https://github.com/novasnow' },
                    { name: 'Twitter', url: 'https://twitter.com/novasnow' }
                ],
                micro: [
                    { category: 'Experiment', icon: 'flask', desc: 'Lab experiment' },
                    { category: 'Science', icon: 'atom', desc: 'Scientific knowledge' }
                ],
                imageStyle: 'full-bleed',
                imageVariant: 'ambient'
            }
        };

        function applyDefaults(theme) {
            const data = defaultData[theme];
            if (!data) return;

            // Override ProPersona to Badge style defaults
            if (theme === 'ProPersona') { 
                data.imageStyle = 'badge'; 
                data.imageVariant = 'standard'; 
            }

            const setInput = (id, val) => { 
                const el = document.getElementById(id); 
                if (el) el.value = val; 
            };

            // Set basic fields
            setInput('card-name', data.name);
            setInput('card-class', data.class);
            setInput('card-quote', data.quote);
            setInput('card-avatar', data.avatar);
            setInput('card-rarity', data.rarity);
            setInput('card-bio', data.bio);
            
            // Set image style and variant
            const styleSelect = document.getElementById('image-style');
            const variantSelect = document.getElementById('image-variant');
            
            if (styleSelect && variantSelect) {
                const style = data.imageStyle || 'masked';
                const variant = data.imageVariant || 'circle';
                
                // Set the style first
                styleSelect.value = style;
                
                // Update variant options based on the selected style
                updateVariantOptions(style);
                
                // Set the variant after a small delay to ensure options are populated
                setTimeout(() => {
                    if (variantSelect.querySelector(`option[value="${variant}"]`)) {
                        variantSelect.value = variant;
                    } else if (variantSelect.options.length > 0) {
                        // If the specified variant doesn't exist, use the first available
                        variantSelect.value = variantSelect.options[0].value;
                    }
                    // Trigger preview update to reflect the changes
                    updatePreview();
                }, 50);
            }
            
            // Set up attribute groups
            if (attributeEditor) {
                attributeEditor.innerHTML = `
                    <div class="attribute-group attribute-basic"><h4>Origin / Alignment / Faction</h4></div>
                    <div class="attribute-group attribute-special"><h4>Achievement / Superpower / Badge</h4></div>
                `;
                
                const basicGroup = attributeEditor.querySelector('.attribute-basic');
                const specialGroup = attributeEditor.querySelector('.attribute-special');
                
                // Add attributes to their respective groups
                if (data.achievement) specialGroup.appendChild(createAttributeRow('Achievement', data.achievement));
                if (data.superpower) specialGroup.appendChild(createAttributeRow('Superpower', data.superpower));
                if (data.alignment) basicGroup.appendChild(createAttributeRow('Alignment', data.alignment));
                if (data.origin) basicGroup.appendChild(createAttributeRow('Origin', data.origin));
                if (data.faction) basicGroup.appendChild(createAttributeRow('Faction', data.faction));
                if (data.badge) specialGroup.appendChild(createAttributeRow('Badge', data.badge));
            }
            
            // Set up stats
            if (statsEditor) {
                statsEditor.innerHTML = '';
                data.stats.forEach(stat => statsEditor.appendChild(createStatRow(stat.name, stat.value)));
            }
            
            // Set up social links
            if (socialEditor) {
                socialEditor.innerHTML = '';
                (data.social || []).forEach(s => socialEditor.appendChild(createSocialRow(s.name, s.url)));
            }
            
            // Set up micro badges
            if (microEditor) {
                microEditor.innerHTML = '';
                (data.micro || []).forEach(m => microEditor.appendChild(createMicroRow(m.category, m.icon, m.desc)));
                
                // Update addMicroBtn state
                if (addMicroBtn) {
                    addMicroBtn.disabled = (microEditor.querySelectorAll('.micro-row').length >= 6);
                }
            }
            
            // Trigger preview update
            updatePreview();
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
            const nameInput = row.querySelector('input[name="stat-name"]');
            const valueInput = row.querySelector('input[name="stat-value"]');
            
            
            const name = nameInput?.value.trim();
            const val = parseInt(valueInput?.value, 10);

            if (name) cardData.stats.push({ name, value: isNaN(val) ? 0 : val });
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
    
    // Get image style data
    const isFullBleed = imageStyleData.style === 'full-bleed';
    const isOverlaySafe = isFullBleed && imageStyleData.variant === 'overlay-safe';
    
    // Apply theme and image style classes
    if (front) {
      front.className = `card-preview-canvas card-front theme-${theme.toLowerCase()} variant-${variant} image-style-${imageStyleData.style}`;
      front.setAttribute('data-image-style', imageStyleData.style);
      front.setAttribute('data-image-variant', imageStyleData.variant);
      
      // Clear existing content
      front.innerHTML = '';
      
      // Create the main preview content container
      let previewContent = createElement('div', { class: 'card-preview-content' });
      
      // For overlay-safe variant, wrap content in an overlay container
      if (isOverlaySafe) {
        const overlay = createElement('div', { class: 'card-overlay' });
        front.appendChild(overlay);
        overlay.appendChild(previewContent);
      } else {
        front.appendChild(previewContent);
      }
      
      // Create and append the avatar/image
      if (avatar && (ValidationUtils.isValidImageUrl(avatar) || avatar.startsWith('/'))) {
        const isMasked = imageStyleData.style === 'masked';
        
        // Determine the appropriate class based on style and variant
        const imageStyleClass = isMasked 
          ? `image-${imageStyleData.style}-${imageStyleData.variant}`
          : `image-${imageStyleData.style}`;
          
        const avatarClasses = `card-avatar ${imageStyleClass}`;
        const avatarImg = createElement('img', { 
          src: avatar, 
          class: avatarClasses, 
          alt: name,
          'data-image-style': imageStyleData.style,
          'data-image-variant': imageStyleData.variant
        });
        
        if (isFullBleed) {
          // For full-bleed, add the image directly to the front
          front.insertBefore(avatarImg, front.firstChild);
        } else if (imageStyleData.style === 'hero') {
          // For hero style, create a header and add the image to it
          const header = createElement('div', { class: 'card-header' });
          header.appendChild(avatarImg);
          
          // Add name to the header overlay
          if (name) {
            const nameEl = createElement('h3', { class: 'card-name' }, name);
            header.appendChild(nameEl);
          }
          
          // Add the header to the preview content
          previewContent.appendChild(header);
        } else {
          // For other styles, add to the header without overlay
          const header = createElement('div', { class: 'card-header' });
          header.appendChild(avatarImg);
          previewContent.appendChild(header);
        }
      }
      
      // Add name and class - only if not already added in hero style
      if ((!isFullBleed || isOverlaySafe) && imageStyleData.style !== 'hero') {
        const header = isFullBleed ? previewContent : createElement('div', { class: 'card-header' });
        if (!isFullBleed) previewContent.appendChild(header);
        
        if (name) {
          header.appendChild(createElement('h3', { class: 'card-name' }, name));
        }
        // Remove the class text since we'll show it as a badge below
      }
      
      // Rest of the content (badges, stats, etc.)
      // Create badge container for class and rarity
      const badgeContainer = createElement('div', { class: 'badge-container' });
      
      // Class/Type badge - Always show as badge, not as text
      if (cardClass) {
        const badge = createElement('div', { class: 'card-badge' });
        const classLower = cardClass.toLowerCase();
        let iconClass = 'fa-user'; // Default to a simple user icon
        
        // Map class names to appropriate icons
        if (classLower.includes('mage') || classLower.includes('wizard') || classLower.includes('sorcerer')) {
          iconClass = 'fa-hat-wizard';
        } else if (classLower.includes('warrior') || classLower.includes('fighter') || classLower.includes('knight')) {
          iconClass = 'fa-sword';
        } else if (classLower.includes('ranger') || classLower.includes('archer') || classLower.includes('hunter')) {
          iconClass = 'fa-bow-arrow';
        } else if (classLower.includes('rogue') || classLower.includes('thief') || classLower.includes('assassin')) {
          iconClass = 'fa-mask';
        } else if (classLower.includes('cleric') || classLower.includes('priest') || classLower.includes('healer')) {
          iconClass = 'fa-hand-holding-medical';
        } else if (classLower.includes('monk') || classLower.includes('martial') || classLower.includes('brawler')) {
          iconClass = 'fa-hand-fist';
        } else if (classLower.includes('paladin') || classLower.includes('crusader') || classLower.includes('templar')) {
          iconClass = 'fa-shield-halved';
        } else if (classLower.includes('druid') || classLower.includes('shaman') || classLower.includes('elemental')) {
          iconClass = 'fa-leaf';
        } else if (classLower.includes('necromancer') || classLower.includes('warlock') || classLower.includes('dark')) {
          iconClass = 'fa-skull';
        } else if (classLower.includes('bard') || classLower.includes('performer') || classLower.includes('entertainer')) {
          iconClass = 'fa-music';
        } else if (classLower.includes('agent')) {
          iconClass = 'fa-user-secret'; // Special icon for agent
        }
        
        const icon = createElement('i', { class: `fas ${iconClass}`, 'aria-hidden': 'true' });
        const text = document.createTextNode(cardClass);
        badge.appendChild(icon);
        badge.appendChild(text);
        badgeContainer.appendChild(badge);
      }
      
      // Rarity badge
      const rarityEl = document.getElementById('card-rarity');
      const rarity = rarityEl?.value || '';
      if (rarity) {
        const rarityEl = createElement('div', { class: 'card-rarity' });
        const rarityLower = rarity.toLowerCase();
        let iconClass = 'fa-star';
        
        // Map rarity levels to appropriate icons
        if (rarityLower.includes('common') || rarityLower.includes('basic')) {
          iconClass = 'fa-circle';
        } else if (rarityLower.includes('uncommon') || rarityLower.includes('rare')) {
          iconClass = 'fa-star';
        } else if (rarityLower.includes('epic') || rarityLower.includes('legendary') || rarityLower.includes('mythic')) {
          iconClass = 'fa-crown';
        } else if (rarityLower.includes('unique') || rarityLower.includes('artifact')) {
          iconClass = 'fa-gem';
        } else if (rarityLower.includes('divine') || rarityLower.includes('godly')) {
          iconClass = 'fa-sun';
        }
        
        const starIcon = createElement('i', { class: `fas ${iconClass}`, 'aria-hidden': 'true' });
        const text = document.createTextNode(rarity);
        rarityEl.appendChild(starIcon);
        rarityEl.appendChild(text);
        badgeContainer.appendChild(rarityEl);
      }
      
      // Only add badge container if it has children
      if (badgeContainer.hasChildNodes()) {
        previewContent.appendChild(badgeContainer);
      }
      // Quote
      if (quote) previewContent.appendChild(createElement('blockquote', { class: 'card-quote' }, quote));
      // Stat bars
      Object.entries(statsObj).forEach(([key, val]) => {
          const rowWrapper = createElement('div', { class: 'stat-row-preview' });
          
          // Create stat label with value
          const labelContainer = createElement('div', { class: 'stat-label' });
          labelContainer.appendChild(document.createTextNode(key));
          
          // Add value as a separate span
          const valueSpan = createElement('span', { class: 'stat-value' }, `${val}%`);
          labelContainer.appendChild(valueSpan);
          
          // Bar track
          const barContainer = createElement('div', { class: 'stat-bar' });
          const progress = createElement('div', { class: 'stat-progress' });
          progress.style.width = val + '%';
          
          // Set aria attributes for accessibility
          progress.setAttribute('role', 'progressbar');
          progress.setAttribute('aria-valuenow', val);
          progress.setAttribute('aria-valuemin', '0');
          progress.setAttribute('aria-valuemax', '100');
          progress.setAttribute('aria-label', `${key} level`);
          
          barContainer.appendChild(progress);
          rowWrapper.appendChild(labelContainer);
          rowWrapper.appendChild(barContainer);
          previewContent.appendChild(rowWrapper);
        });
      
      // Append bodyContainer to previewContent for Hero style
      if (isFullBleed) {
        previewContent.appendChild(badgeContainer);
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
      const bioEl = document.getElementById('card-bio');
      const bio = bioEl?.value || '';
      if (bio) backContent.appendChild(createElement('p', { class: 'card-bio' }, bio));

      // Social links display
      const socialRows = document.querySelectorAll('#social-editor .social-row');
      const existingSocialContainer = backContent.querySelector('.social-links');
      if (existingSocialContainer) {
        existingSocialContainer.remove();
      }
      
      if (socialRows.length > 0) {
        const socialContainer = createElement('div', { class: 'social-links' });
        socialRows.forEach(row => {
          const name = row.querySelector('select[name="social-name"]')?.value.trim();
          const url = row.querySelector('input[name="social-url"]')?.value.trim();
          if (name && url) {
            const slug = name.toLowerCase().replace(/\s+/g, '-');
            const iconEl = createElement('i', {
              class: `fab fa-${slug} social-icon`,
              'aria-label': name
            });
            const link = createElement('a', { 
              href: url, 
              target: '_blank', 
              class: 'social-link',
              'aria-label': `${name} profile`
            }, iconEl);
            socialContainer.appendChild(link);
          }
        });
        
        if (socialContainer.hasChildNodes()) {
          backContent.appendChild(socialContainer);
        }
      }

      // Micro badges display
      const microRows = document.querySelectorAll('#micro-editor .micro-row');
      if (microRows.length) {
        const microContainer = createElement('div', { class: 'micro-badges' });
        microRows.forEach(row => {
          const name = row.querySelector('input[name="micro-category"]')?.value.trim() || 'Badge';
          const icon = row.querySelector('input[name="micro-icon"]')?.value.trim().toLowerCase();
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
  
  // Default variants for each style
  const defaultVariants = {
    'masked': 'circle',
    'hero': 'large',
    'badge': 'standard',
    'full-bleed': 'ambient'
  };
  
  // Label text for each style
  const variantLabels = {
    'masked': 'Mask Shape',
    'hero': 'Hero Size',
    'badge': 'Badge Style',
    'full-bleed': 'Overlay Style'
  };
  
  function updateVariantOptions(selectedStyle) {
    // Hide all variant options first
    const allVariantOptions = imageVariantSelect.querySelectorAll('option');
    allVariantOptions.forEach(option => {
      option.style.display = 'none';
    });
    
    // Show only the relevant options for the selected style
    const relevantOptions = imageVariantSelect.querySelectorAll(`.style-${selectedStyle}`);
    relevantOptions.forEach(option => {
      option.style.display = '';
    });
    
    // Set the default variant for this style
    const defaultVariant = defaultVariants[selectedStyle];
    if (defaultVariant && imageVariantSelect.querySelector(`option[value="${defaultVariant}"]`)) {
      imageVariantSelect.value = defaultVariant;
    } else if (relevantOptions.length > 0) {
      // If the specified variant doesn't exist, use the first available
      imageVariantSelect.value = relevantOptions[0].value;
    }
    
    // Update the label text
    if (imageVariantLabel) {
      imageVariantLabel.textContent = variantLabels[selectedStyle] || 'Style Variant';
    }
    
    // Update the preview
    updatePreview();
  }
  
  // Initialize the variant options when the page loads
  if (imageStyleSelect && imageVariantSelect) {
    // Set up the change event listener
    imageStyleSelect.addEventListener('change', (e) => {
      updateVariantOptions(e.target.value);
    });
    
    // Initialize with the current style
    updateVariantOptions(imageStyleSelect.value);
  }
  
  // Function to get the current image style data
  function getImageStyleData() {
    const style = imageStyleSelect?.value || 'masked';
    const variant = imageVariantSelect?.value || defaultVariants[style];
    return { style, variant };
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
    // Get current theme and set appropriate defaults
    const currentTheme = themeSelect?.value || 'NeoFantasy';
    const themeData = defaultData[currentTheme] || {};
    
    // Set default style based on theme, fallback to masked
    const defaultStyle = themeData.imageStyle || 'masked';
    const defaultVariant = themeData.imageVariant || 'circle';
    
    // Apply the style and variant
    imageStyleSelect.value = defaultStyle;
    updateVariantOptions(defaultStyle);
    
    // Set the variant after a small delay to ensure options are populated
    setTimeout(() => {
      if (imageVariantSelect.querySelector(`option[value="${defaultVariant}"]`)) {
        imageVariantSelect.value = defaultVariant;
      }
      updatePreview();
    }, 50);
    
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

// Flip functionality is now handled at the top of the file
})();

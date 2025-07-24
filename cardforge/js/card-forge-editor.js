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
    document.getElementById('card-achievement'),
    document.getElementById('card-rarity'),
    document.getElementById('card-bio'),
    document.getElementById('card-superpower'),
    document.getElementById('card-alignment'),
    document.getElementById('card-origin'),
    document.getElementById('card-faction'),
    document.getElementById('card-badge'),
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
          // Stats Editor Logic
        const statsEditor = document.getElementById('stats-editor');
        const addStatBtn = document.getElementById('add-stat-btn');

        function createStatRow(name = '', value = '') {
          const row = document.createElement('div');
          row.className = 'stat-row';
          row.innerHTML = `
            <input type="text" name="stat-name" placeholder="Stat name" value="${name}" />
            <input type="number" name="stat-value" placeholder="Value" value="${value}" />
            <button type="button" class="remove-stat">&times;</button>
          `;
          row.querySelector('.remove-stat').addEventListener('click', () => { row.remove(); updatePreview(); });
          row.querySelector('input[name="stat-name"]').addEventListener('input', updatePreview);
          row.querySelector('input[name="stat-value"]').addEventListener('input', updatePreview);
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
        function createMicroRow(category = '', icon = '', desc = '') {
          const options = ['star','heart','bolt','trophy','leaf','gear'];
          const row = document.createElement('div');
          row.className = 'micro-row';
          row.innerHTML = `
            <input type="text" name="micro-category" placeholder="Category (e.g. Skill)" value="${category}" />
            <select name="micro-icon" aria-label="Select icon">
              ${options.map(option => `<option value="${option}" ${icon === option ? 'selected' : ''}>${option}</option>`).join('')}
            </select>
            <input type="text" name="micro-desc" placeholder="Description" value="${desc}" />
            <button type="button" class="remove-micro">&times;</button>
          `;
          row.querySelector('.remove-micro').addEventListener('click', () => { row.remove(); updatePreview(); });
          row.querySelector('input[name="micro-category"]').addEventListener('input', updatePreview);
          row.querySelector('select[name="micro-icon"]')?.addEventListener('change', updatePreview);
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
             ]
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
             ]
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
             ]
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
          setInput('card-achievement', data.achievement);
          setInput('card-rarity', data.rarity);
          setInput('card-bio', data.bio);
          setInput('card-superpower', data.superpower);
          setInput('card-alignment', data.alignment);
          setInput('card-origin', data.origin);
          setInput('card-faction', data.faction);
          setInput('card-badge', data.badge);
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
          const fields = ['card-name','card-class','card-quote','card-avatar','card-achievement','card-rarity','card-bio','card-superpower','card-alignment','card-origin','card-faction','card-badge'];
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
      avatar: avatarInput?.value,
      achievement: document.getElementById('card-achievement')?.value,
      rarity: document.getElementById('card-rarity')?.value,
      bio: document.getElementById('card-bio')?.value,
      superpower: document.getElementById('card-superpower')?.value,
      alignment: document.getElementById('card-alignment')?.value,
      origin: document.getElementById('card-origin')?.value,
      faction: document.getElementById('card-faction')?.value,
      badge: document.getElementById('card-badge')?.value,
      stats: document.getElementById('card-stats')?.value,
      theme: document.getElementById('card-theme')?.value
    });
    // Gather fields
    const name = nameInput?.value || '';
    const cardClass = classInput?.value || '';
    const quote = quoteInput?.value || '';
    const avatar = avatarInput?.value || '';
    
    
    
    
    const achievementEl = document.getElementById('card-achievement');
    const rarityEl = document.getElementById('card-rarity');
    const bioEl = document.getElementById('card-bio');
    const superpowerEl = document.getElementById('card-superpower');
    const alignmentEl = document.getElementById('card-alignment');
    const originEl = document.getElementById('card-origin');
    const factionEl = document.getElementById('card-faction');
    const badgeEl = document.getElementById('card-badge');

    const achievement = achievementEl?.value || '';
    const rarity = rarityEl?.value || '';
    const bio = bioEl?.value || '';
    const superpower = superpowerEl?.value || '';
    const alignment = alignmentEl?.value || '';
    const origin = originEl?.value || '';
    const faction = factionEl?.value || '';
    const badge = badgeEl?.value || '';
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

    // Front face
    const variant = document.getElementById('card-template-type')?.value || 'default';
    const theme = document.getElementById('card-theme')?.value || '';
    const front = document.getElementById('card-preview');
    // Apply theme class
    if (front) front.className = `card-preview-canvas card-front theme-${theme.toLowerCase()} variant-${variant}`;
    if (front) {
      front.innerHTML = '';
      const previewContent = createElement('div', { class: 'card-preview-content' });
      // Avatar & name
      const header = createElement('div', { class: 'card-header' });
      if (avatar && (ValidationUtils.isValidImageUrl(avatar) || avatar.startsWith('/'))) {
        header.appendChild(createElement('img', { src: avatar, class: 'card-avatar', alt: name }));
      }
      header.appendChild(createElement('h3', {}, name || 'Card Name'));
      previewContent.appendChild(header);
      // Class & rarity
      if (cardClass) previewContent.appendChild(createElement('div', { class: 'card-badge' }, cardClass));
      if (rarity) previewContent.appendChild(createElement('div', { class: 'card-rarity' }, rarity));
      // Quote
      if (quote) previewContent.appendChild(createElement('blockquote', { class: 'card-quote' }, quote));
      // Achievement
      if (achievement) previewContent.appendChild(createElement('div', { class: 'card-achievement' }, achievement));
      // Stat bars
      Object.entries(statsObj).forEach(([key, val]) => {
        const barContainer = createElement('div', { class: 'stat-bar' });
        barContainer.appendChild(createElement('span', { class: 'stat-label' }, key));
        const progress = createElement('div', { class: 'stat-progress' });
        progress.style.width = val + '%';
        barContainer.appendChild(progress);
        previewContent.appendChild(barContainer);
      });
      front.appendChild(previewContent);
    }
    // Back face
    const back = document.getElementById('card-back');
    // Apply theme and variant classes to back face
    if (back) back.className = `card-preview-canvas card-back theme-${theme.toLowerCase()} variant-${variant}`;
    if (back) {
      back.innerHTML = '';
      const backContent = createElement('div', { class: 'card-preview-content' });
      if (bio) backContent.appendChild(createElement('p', {}, bio));
      if (superpower) backContent.appendChild(createElement('p', {}, 'Superpower: ' + superpower));
      if (alignment) backContent.appendChild(createElement('p', {}, 'Alignment: ' + alignment));
      if (origin) backContent.appendChild(createElement('p', {}, 'Origin: ' + origin));
      if (faction) backContent.appendChild(createElement('p', {}, 'Faction: ' + faction));
      if (badge) backContent.appendChild(createElement('p', {}, 'Badge: ' + badge));

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
          const icon = row.querySelector('select[name="micro-icon"]')?.value.trim().toLowerCase();
          const desc = row.querySelector('input[name="micro-desc"]')?.value.trim();
          if (icon) {
            const slug = icon.replace(/\s+/g, '-');
            const iconEl  = createElement('i', {
              class: `fas fa-${slug} micro-icon`,
              title: desc
            });
            microContainer.appendChild(
              createElement('div', { class: 'micro-badge', title: desc }, iconEl)
            );
          }
        });
        backContent.appendChild(microContainer);
      }
      back.appendChild(backContent);
    }
  }
  // Image Picker Modal Logic
  const imageModal = document.getElementById('image-modal');
  const chooseImageBtn = document.getElementById('choose-image-btn');
  const modalClose = document.getElementById('modal-close');
  const imageGrid = document.getElementById('image-grid');
  const prevBtn = document.getElementById('modal-prev');
  const nextBtn = document.getElementById('modal-next');
  const urlInput = document.getElementById('modal-url-input');
  const urlSubmit = document.getElementById('modal-url-submit');

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

  function openImageModal() {
    if (imageModal) {
      imageModal.style.display = 'flex';
      loadImages(currentPage);
    }
  }
  function closeImageModal() {
    if (imageModal) imageModal.style.display = 'none';
  }
  function loadImages(page) {
    if (!imageGrid) return;
    imageGrid.textContent = 'Loading images...';
    fetch('/cardforge/image-manifest.json')
      .then(res => res.json())
      .then(images => {
        imageGrid.innerHTML = '';
        const start = (page - 1) * imagesPerPage;
        const pageImages = images.slice(start, start + imagesPerPage);
        if (!pageImages.length) {
          imageGrid.innerHTML = '<p class="modal-message">No images available.</p>';
        } else {
          pageImages.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.addEventListener('click', () => {
              const avatarInput = document.getElementById('card-avatar');
              if (avatarInput) {
                avatarInput.value = url;
                updatePreview();
              }
              closeImageModal();
            });
            imageGrid.appendChild(img);
          });
        }
      })
      .catch(err => {
        console.error('Error loading image manifest:', err);
        imageGrid.innerHTML = '<p class="modal-message">Failed to load images.</p>';
      });
  }

  chooseImageBtn?.addEventListener('click', openImageModal);
  modalClose?.addEventListener('click', closeImageModal);
  window.addEventListener('click', e => {
    if (e.target === imageModal) closeImageModal();
  });
  prevBtn?.addEventListener('click', () => { if (currentPage>1) { currentPage--; loadImages(currentPage);} });
  nextBtn?.addEventListener('click', () => { currentPage++; loadImages(currentPage); });
  urlSubmit?.addEventListener('click', () => {
    const avatarInput = document.getElementById('card-avatar');
    if (avatarInput && urlInput) avatarInput.value = urlInput.value;
    closeImageModal();
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

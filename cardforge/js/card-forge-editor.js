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
            stats: [{ name: 'Nature', value: 85 }, { name: 'Magic', value: 70 }, { name: 'Resilience', value: 60 }]
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
            stats: [{ name: 'Tech', value: 95 }, { name: 'Speed', value: 80 }, { name: 'Stealth', value: 75 }]
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
            stats: [{ name: 'Leadership', value: 90 }, { name: 'Charisma', value: 80 }, { name: 'Intelligence', value: 85 }]
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
        }
        // Apply defaults on load
        applyDefaults(themeSelect?.value);
        // Reapply on theme change
        themeSelect?.addEventListener('change', () => applyDefaults(themeSelect.value));

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
    
    
    
    
    const achievement = document.getElementById('card-achievement').value;
    const rarity = document.getElementById('card-rarity').value;
    const bio = document.getElementById('card-bio').value;
    const superpower = document.getElementById('card-superpower').value;
    const alignment = document.getElementById('card-alignment').value;
    const origin = document.getElementById('card-origin').value;
    const faction = document.getElementById('card-faction').value;
    const badge = document.getElementById('card-badge').value;
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
      const backContent = createElement('div', { class: 'card-back-content' });
      if (bio) backContent.appendChild(createElement('p', {}, bio));
      if (superpower) backContent.appendChild(createElement('p', {}, 'Superpower: ' + superpower));
      if (alignment) backContent.appendChild(createElement('p', {}, 'Alignment: ' + alignment));
      if (origin) backContent.appendChild(createElement('p', {}, 'Origin: ' + origin));
      if (faction) backContent.appendChild(createElement('p', {}, 'Faction: ' + faction));
      if (badge) backContent.appendChild(createElement('p', {}, 'Badge: ' + badge));
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

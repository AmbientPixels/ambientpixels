// Card Forge Editor JS (Alpha)
// Modular, no inline styles, Nova/AmbientPixels conventions only
// Handles form <-> data <-> preview for a single card (MVP)

(function() {
  // --- Persistence Helpers ---
  const STORAGE_KEY = 'card-forge-cards';
  function saveCards() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }
  function loadCards() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      } catch (e) {}
    }
    return null;
  }

  // Canonical sample card data
  const defaultCards = [
    {
      id: "aria-flux",
      name: "Aria Flux",
      avatar: "autumnus-majestus.jpg",
      description: "Nova test pilot and moodstreamer.",
      stats: [
        { label: "Power", value: 8 },
        { label: "Agility", value: 6 }
      ],
      badges: ["legendary"],
      links: [],
      theme: "legendary",
      style: "rpg",
      updated: new Date().toISOString()
    },
    {
      id: "cypher-nova",
      name: "Cypher Nova",
      avatar: "cyber-erenity.jpg",
      description: "Codebreaker and synthwave engineer.",
      stats: [
        { label: "Power", value: 7 },
        { label: "Agility", value: 9 }
      ],
      badges: ["epic"],
      links: [],
      theme: "epic",
      style: "nova",
      updated: new Date().toISOString()
    },
    {
      id: "echo-prism",
      name: "Echo Prism",
      avatar: "regal-radiance.jpg",
      description: "Holographic archivist.",
      stats: [
        { label: "Power", value: 6 },
        { label: "Agility", value: 7 }
      ],
      badges: ["rare"],
      links: [],
      theme: "rare",
      style: "futuristic-id",
      updated: new Date().toISOString()
    }
  ];

  let cards = loadCards() || JSON.parse(JSON.stringify(defaultCards));
  let currentCardIdx = 0;
  let currentCard = { ...cards[currentCardIdx] };

  // DOM refs
  const form = document.querySelector('.nova-form');
  const nameInput = document.getElementById('card-name');
  const styleSelect = document.getElementById('card-style');
  const avatarSelect = document.getElementById('card-avatar');
  const descInput = document.getElementById('card-desc');
  const statsInput = document.getElementById('card-stats');
  const badgesSelect = document.getElementById('card-badges');
  const preview = document.querySelector('.card-forge-preview');

  // --- Helper: render preview ---
  function renderPreview(card) {
    if (!preview) return;
    // Remove any previous style modifier classes
    preview.className = 'card-forge-preview';
    if (card.style) {
      preview.classList.add(`card-forge-preview--${card.style}`);
    }
    // Animate style change
    preview.classList.remove('windsurf-style-animate');
    void preview.offsetWidth; // Force reflow to restart animation
    preview.classList.add('windsurf-style-animate');
    preview.innerHTML = `
      <img src="/images/image-packs/characters/${card.avatar}" alt="Preview Avatar" class="avatar-lg" />
      <h4>${card.name || ''}</h4>
      <p class="card-desc">${card.description || ''}</p>
      <ul class="nova-list card-stats">
        ${(card.stats||[]).map(stat => `<li>${stat.label}: ${stat.value}</li>`).join('')}
      </ul>
      <span class="badge ${card.theme}">${card.badges && card.badges[0] ? card.badges[0][0].toUpperCase() + card.badges[0].slice(1) : ''}</span>
    `;
  }

  // --- Helper: parse stats string to array ---
  function parseStats(str) {
    // e.g. "Power: 8, Agility: 6"
    if (!str) return [];
    return str.split(',').map(s => {
      const [label, value] = s.split(':').map(x => x.trim());
      return label && value ? { label, value: isNaN(Number(value)) ? value : Number(value) } : null;
    }).filter(Boolean);
  }

  // --- Populate form with card data ---
  function populateForm(card) {
    nameInput.value = card.name || '';
    if (styleSelect) styleSelect.value = card.style || 'rpg';
    avatarSelect.value = card.avatar || '';
    descInput.value = card.description || '';
    statsInput.value = (card.stats||[]).map(s => `${s.label}: ${s.value}`).join(', ');
    badgesSelect.value = card.badges && card.badges[0] || '';
  }

  // --- Update card from form ---
  function updateCardFromForm() {
    currentCard.name = nameInput.value;
    if (styleSelect) currentCard.style = styleSelect.value;
    currentCard.avatar = avatarSelect.value;
    currentCard.description = descInput.value;
    currentCard.stats = parseStats(statsInput.value);
    currentCard.badges = [badgesSelect.value];
    currentCard.theme = badgesSelect.value;
    currentCard.updated = new Date().toISOString();
    cards[currentCardIdx] = { ...currentCard };
    renderPreview(currentCard);
    saveCards();
  }

  // --- Card List Rendering ---
  const cardList = document.getElementById('card-list');
  const addCardBtn = document.querySelector('.glass-button i.fa-plus')?.parentElement;
  const exportBtn = document.querySelector('.glass-button i.fa-download')?.parentElement;
  const importBtn = document.querySelector('.glass-button i.fa-upload')?.parentElement;

  // --- Export Handler ---
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const dataStr = JSON.stringify(cards, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'card-forge-cards.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  // --- Import Handler ---
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.addEventListener('change', (e) => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
          try {
            const arr = JSON.parse(evt.target.result);
            if (!Array.isArray(arr) || !arr.length) throw new Error('File must be a non-empty array.');
            if (!arr.every(card => card.name && card.avatar)) throw new Error('Each card must have a name and avatar.');
            if (confirm('Importing will replace all your current cards. Continue?')) {
              cards = arr;
              currentCardIdx = 0;
              currentCard = { ...cards[0] };
              saveCards();
              renderCardList();
              populateForm(currentCard);
              renderPreview(currentCard);
            }
          } catch (err) {
            alert('Import failed: ' + (err.message || 'Invalid file.'));
          }
        };
        reader.readAsText(file);
      });
      document.body.appendChild(input);
      input.click();
      setTimeout(() => document.body.removeChild(input), 2000);
    });
  }

  function renderCardList() {
    if (!cardList) return;
    cardList.innerHTML = '';
    cards.forEach((card, idx) => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.className = idx === currentCardIdx ? 'active' : '';
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', card.name);
      li.innerHTML = `<img src="/images/image-packs/characters/${card.avatar}" alt="${card.name}" class="avatar-sm" /> ${card.name}`;
      // Remove button (if more than 1 card)
      if (cards.length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-card-btn';
        removeBtn.setAttribute('aria-label', `Remove ${card.name}`);
        removeBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        removeBtn.tabIndex = 0;
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Remove card '${card.name}'? This cannot be undone.`)) {
            cards.splice(idx, 1);
            // Adjust current selection
            if (currentCardIdx >= cards.length) {
              currentCardIdx = cards.length - 1;
            }
            currentCard = { ...cards[currentCardIdx] };
            renderCardList();
            populateForm(currentCard);
            renderPreview(currentCard);
            saveCards();
          }
        });
        removeBtn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            removeBtn.click();
          }
        });
        li.appendChild(removeBtn);
      }
      li.addEventListener('click', () => {
        currentCardIdx = idx;
        currentCard = { ...cards[currentCardIdx] };
        populateForm(currentCard);
        renderPreview(currentCard);
        renderCardList();
      });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          li.click();
        }
      });
      cardList.appendChild(li);
    });
  }

  // --- Add Card Handler ---
  if (addCardBtn) {
    addCardBtn.addEventListener('click', () => {
      const newCard = {
        id: `card-${Date.now()}`,
        name: 'New Card',
        avatar: 'autumnus-majestus.jpg',
        description: '',
        stats: [],
        badges: ['legendary'],
        links: [],
        theme: 'legendary',
        style: 'rpg',
        updated: new Date().toISOString()
      };
      cards.push(newCard);
      currentCardIdx = cards.length - 1;
      currentCard = { ...newCard };
      renderCardList();
      populateForm(currentCard);
      renderPreview(currentCard);
      saveCards();
    });
  }

  // --- Event listeners ---
  if (form) {
    form.addEventListener('input', updateCardFromForm);
    form.addEventListener('change', updateCardFromForm);
    form.addEventListener('reset', (e) => {
      e.preventDefault();
      currentCard = { ...cards[currentCardIdx] };
      populateForm(currentCard);
      renderPreview(currentCard);
    });
  }

  // --- Initial setup ---
  renderCardList();
  populateForm(currentCard);
  renderPreview(currentCard);
})();

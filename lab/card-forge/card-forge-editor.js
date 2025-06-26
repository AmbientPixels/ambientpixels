// Card Forge Editor JS (Alpha)
// Modular, no inline styles, Nova/AmbientPixels conventions only
// Handles form <-> data <-> preview for a single card (MVP)

(function() {
  // Canonical sample card data
  const cards = [
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
      updated: new Date().toISOString()
    }
  ];

  // For MVP, edit the first card only
  let currentCardIdx = 0;
  let currentCard = { ...cards[currentCardIdx] };

  // DOM refs
  const form = document.querySelector('.nova-form');
  const nameInput = document.getElementById('card-name');
  const avatarSelect = document.getElementById('card-avatar');
  const descInput = document.getElementById('card-desc');
  const statsInput = document.getElementById('card-stats');
  const badgesSelect = document.getElementById('card-badges');
  const preview = document.querySelector('.card-forge-preview');

  // --- Helper: render preview ---
  function renderPreview(card) {
    if (!preview) return;
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
    avatarSelect.value = card.avatar || '';
    descInput.value = card.description || '';
    statsInput.value = (card.stats||[]).map(s => `${s.label}: ${s.value}`).join(', ');
    badgesSelect.value = card.badges && card.badges[0] || '';
  }

  // --- Update card from form ---
  function updateCardFromForm() {
    currentCard.name = nameInput.value;
    currentCard.avatar = avatarSelect.value;
    currentCard.description = descInput.value;
    currentCard.stats = parseStats(statsInput.value);
    currentCard.badges = [badgesSelect.value];
    currentCard.theme = badgesSelect.value;
    currentCard.updated = new Date().toISOString();
    renderPreview(currentCard);
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

  // Initial setup
  populateForm(currentCard);
  renderPreview(currentCard);
})();

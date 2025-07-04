// Card Forge Editor JS (Alpha)
// Modular, no inline styles, Nova/AmbientPixels conventions only
// Handles form <-> data <-> preview for a single card (MVP)


window.addEventListener('DOMContentLoaded', function() {
  console.log('[CardForge] card-forge-editor.js loaded and DOMContentLoaded fired');
  // --- Debugging ---
  const DEBUG = true;
  function debugLog(...args) { if (DEBUG) console.log('[CardForge]', ...args); }
  function debugWarn(...args) { if (DEBUG) console.warn('[CardForge]', ...args); }
  function debugError(...args) { if (DEBUG) console.error('[CardForge]', ...args); }

  // DOM references for tabbed editor fields
  const frontFields = document.getElementById('front-fields');
  const backFields = document.getElementById('back-fields');

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
  let showingBack = false; // Track preview flip state
  // /* updated by Cascade */
  
  // Expose card management functions to global scope for cloud storage integration
  window.cardForge = {
    getCards: function() {
      return cards;
    },
    loadCards: function(newCards) {
      if (Array.isArray(newCards) && newCards.length > 0) {
        cards = newCards;
        currentCardIdx = 0;
        currentCard = { ...cards[currentCardIdx] };
        populateForm(currentCard);
        renderPreview(currentCard);
        renderCardList();
        saveCards(); // Save to localStorage as backup
        debugLog('Loaded cards from cloud:', newCards.length);
        return true;
      } else {
        debugWarn('Attempted to load invalid cards data:', newCards);
        return false;
      }
    }
  };

  // DOM refs
  // Remove duplicate avatar selects if present (from old HTML)
  // Remove duplicate avatar selects if present (from old HTML)
  let avatarSelects = document.querySelectorAll('#card-avatar');
  if (avatarSelects.length > 1) {
    for (let i = 1; i < avatarSelects.length; i++) {
      avatarSelects[i].parentElement.removeChild(avatarSelects[i]);
    }
  }
  // Always re-query avatarSelect after cleanup
  let avatarSelect = document.getElementById('card-avatar');
  const form = document.getElementById('front-form');
  const backForm = document.getElementById('back-form');
  // /* updated by Cascade: avatarSelect lint fix */
  // Custom Reset Button Logic
  document.querySelectorAll('.glass-button[type="reset"]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      // Only one debug log per reset
      debugLog('[CardForge] Reset triggered for card:', cards[currentCardIdx]);
      // Always show front tab and panel
      if (typeof switchTab === 'function') switchTab(true);
      // Reset currentCard to last saved state
      currentCard = { ...cards[currentCardIdx] };
      // Repopulate form fields from the saved card (guaranteed fresh DOM refs)
      if (typeof populateForm === 'function') populateForm(currentCard);
      // Always re-query avatarSelect after populateForm
      avatarSelect = document.getElementById('card-avatar');
      if (avatarSelect) avatarSelect.value = currentCard.avatar || '';
      // Flip preview to front
      showingBack = false;
      if (typeof renderPreview === 'function') renderPreview(currentCard);
      // If backForm exists, also reset its fields
      if (backForm && typeof ensureBackFields === 'function') {
        ensureBackFields(currentCard);
        backForm.reset();
        // No need to call populateForm or set avatarSelect again; already done above
      } // updated by Cascade: reset logic simplified
    });
  });
  // /* updated by Cascade: custom reset button logic */
  const nameInput = document.getElementById('card-name');

  // Sidebar Save, Reset, and Azure button handlers (updated by Cascade)
  const sidebarSaveBtn = document.getElementById('sidebar-save-btn');
  const sidebarResetBtn = document.getElementById('sidebar-reset-btn');
  const saveToAzureBtn = document.getElementById('save-to-azure-btn');

  if (sidebarSaveBtn) {
    sidebarSaveBtn.addEventListener('click', function() {
      updateCardFromForm();
      saveCards();
      alert('Cards saved locally.');
    });
  }
  if (sidebarResetBtn) {
    sidebarResetBtn.addEventListener('click', function(e) {
      e.preventDefault();
      // Use same logic as custom reset button
      if (typeof switchTab === 'function') switchTab(true);
      currentCard = { ...cards[currentCardIdx] };
      if (typeof populateForm === 'function') populateForm(currentCard);
      avatarSelect = document.getElementById('card-avatar');
      if (avatarSelect) avatarSelect.value = currentCard.avatar || '';
      showingBack = false;
      if (typeof renderPreview === 'function') renderPreview(currentCard);
      if (backForm && typeof ensureBackFields === 'function') {
        ensureBackFields(currentCard);
        backForm.reset();
      }
    });
  }
  if (saveToAzureBtn) {
    saveToAzureBtn.addEventListener('click', async function() {
      saveToAzureBtn.disabled = true;
      saveToAzureBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      try {
        const response = await fetch('/api/saveCardData', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cards)
        }).then(response => {
          debugLog('Publish response status:', response.status);
          debugLog('Publish response headers:', JSON.stringify(Array.from(response.headers.entries())));
          
          // Get response text first to debug any JSON parsing issues
          return response.text().then(text => {
            debugLog('Publish response text:', text);
            
            if (!response.ok) {
              // Try to parse as JSON if possible
              try {
                const errorData = JSON.parse(text);
                debugError('Parsed error response:', errorData);
                throw new Error(`Server returned ${response.status}: ${errorData.message || errorData.error || response.statusText}`);
              } catch (parseError) {
                debugError('Failed to parse error response as JSON:', parseError);
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
              }
            }
            
            // Try to parse success response as JSON
            try {
              const data = JSON.parse(text);
              debugLog('Card published successfully:', data);
              return data;
            } catch (parseError) {
              debugError('Failed to parse success response as JSON:', parseError);
              throw new Error('Invalid JSON response from server');
            }
          });
        });
        saveToAzureBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save to Azure';
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        saveToAzureBtn.disabled = false;
      }
    });
  }
  // /* updated by Cascade: sidebar Save/Reset/Azure logic */
  const styleSelect = document.getElementById('card-style');
  
  const descInput = document.getElementById('card-desc');
  const statsInput = document.getElementById('card-stats');
  const badgesSelect = document.getElementById('card-badges');
  const preview = document.querySelector('.card-forge-preview');
  // Tab controls and panels
  const tabFront = document.getElementById('tab-front');
  const tabBack = document.getElementById('tab-back');
  const frontPanel = document.getElementById('front-panel');
  const backPanel = document.getElementById('back-panel');
  // /* updated by Cascade */

  // --- Tab switching logic for Front/Back panels ---
  function switchTab(isFront) {
    if (!tabFront || !tabBack || !frontPanel || !backPanel) return;
    if (isFront) {
      tabFront.setAttribute('aria-selected', 'true');
      tabFront.tabIndex = 0;
      tabBack.setAttribute('aria-selected', 'false');
      tabBack.tabIndex = -1;
      frontPanel.hidden = false;
      backPanel.hidden = true;
    } else {
      tabFront.setAttribute('aria-selected', 'false');
      tabFront.tabIndex = -1;
      tabBack.setAttribute('aria-selected', 'true');
      tabBack.tabIndex = 0;
      frontPanel.hidden = true;
      backPanel.hidden = false;
    }
    // Flip the preview to match the selected tab
    showingBack = !isFront;
    renderPreview(currentCard);
    // Optionally focus the active tab for accessibility
    (isFront ? tabFront : tabBack).focus();
    // Repopulate form to sync fields
    populateForm(currentCard);
    // /* updated by Cascade */
  }
  if (tabFront && tabBack) {
    tabFront.addEventListener('click', function() { switchTab(true); });
    tabBack.addEventListener('click', function() { switchTab(false); });
    // Keyboard accessibility: left/right arrow keys
    [tabFront, tabBack].forEach(btn => {
      btn.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const nextIsFront = (btn === tabBack && e.key === 'ArrowLeft') || (btn === tabFront && e.key === 'ArrowRight');
          switchTab(nextIsFront);
        }
      });
    });
  }
  // Show front tab by default on load
  switchTab(true);
  // /* updated by Cascade */

  // --- Helper: render preview ---
  // --- Helper: render 3D flip preview (front+back) ---
  function renderPreview(card) {
    if (!preview) return;
    // Remove any previous style modifier classes
    preview.className = 'card-forge-preview';
    if (card.style) {
      preview.classList.add(`card-forge-preview--${card.style}`);
    }
    // Animate style change
    preview.classList.remove('windsurf-style-animate');
    void preview.offsetWidth;
    preview.classList.add('windsurf-style-animate');

    // Build Nova-compliant front face (harmonized by Cascade)
    const frontHTML = `
      <div class=\"card-forge-card flex flex-col align-center justify-center p-3\"> <!-- removed .team-trading-card, updated by Cascade -->
        <img src=\"/images/image-packs/characters/${card.avatar}\" alt=\"Preview Avatar\" class=\"avatar-lg mb-2\">
        <h4 class=\"text-bold mb-1\">${card.name || ''}</h4>
        <p class=\"card-desc text-muted mb-2\">${card.description || ''}</p>
        <ul class=\"nova-list card-stats mb-2\">${(card.stats||[]).map(stat => `<li>${stat.label}: ${stat.value}</li>`).join('')}</ul>
        <span class=\"badge ${card.theme}\">${card.badges && card.badges[0] ? card.badges[0][0].toUpperCase() + card.badges[0].slice(1) : ''}</span>
      </div>`;

    // Build Nova-compliant back face (harmonized by Cascade)
    ensureBackFields(card);
    const backHTML = `
      <div class=\"card-forge-card flex flex-col align-center justify-center p-3\"> <!-- removed .team-trading-card, updated by Cascade -->
        <div class=\"card-back-socials mb-2\">
          ${Object.entries(card.back.socials).map(([net, url]) =>
            url ? `<a href=\"${url}\" target=\"_blank\" rel=\"noopener\" aria-label=\"${net}\"><i class=\"fab fa-${net}\"></i></a>` : `<span class=\"disabled\"><i class=\"fab fa-${net}\"></i></span>`
          ).join(' ')}
        </div>
        <div class=\"card-back-bio mb-2\">${card.back.bio ? card.back.bio : '<em>No bio set.</em>'}</div>
        ${card.back.image ? `<img src=\"${card.back.image}\" alt=\"Back Image\" class=\"card-back-img mb-2\" />` : ''}
        ${card.back.qr ? `<img src=\"${card.back.qr}\" alt=\"QR Code\" class=\"card-back-qr mb-2\" />` : ''}
      </div>`;

    // Compose the harmonized card structure (Nova + flip, updated by Cascade)
    preview.innerHTML = `
      <div class=\"rpg-avatar-card${showingBack ? ' flipped' : ''}\">
        <div class=\"rpg-avatar-card-inner\">
          <div class=\"rpg-avatar-card-front\">${frontHTML}</div>
          <div class=\"rpg-avatar-card-back\">${backHTML}</div>
        </div>
      </div>
    `;
    // /* updated by Cascade */
  }

  // --- Card Back Support ---
  function ensureBackFields(card) {
    if (!card.back) card.back = {
      bio: '',
      image: '',
      qr: '',
      socials: {
        facebook: '',
        twitter: '',
        instagram: '',
        linkedin: '',
        github: ''
      }
    };
  }

  // --- No longer needed: renderPreviewBack is merged into renderPreview (see above) --- // cleaned by Cascade

  function flipCard() {
    showingBack = !showingBack;
    // Toggle the flipped class on the .rpg-avatar-card inside preview
    const cardEl = preview.querySelector('.rpg-avatar-card');
    if (cardEl) {
      cardEl.classList.toggle('flipped', showingBack);
    }
    // Update aria-pressed on the flip button
    if (flipBtn) {
      flipBtn.setAttribute('aria-pressed', showingBack ? 'true' : 'false');
    }
    // /* updated by Cascade */
  }

  // Add Flip button
  let flipBtn = document.getElementById('card-flip-btn');
  if (!flipBtn && preview && preview.parentElement) {
    flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.id = 'card-flip-btn';
    flipBtn.className = 'glass-button mt-1';
    flipBtn.innerHTML = '<i class="fas fa-retweet"></i> Flip Card';
    flipBtn.setAttribute('aria-pressed', 'false');
    preview.parentElement.insertBefore(flipBtn, preview.nextSibling);
  }
  if (flipBtn) {
    flipBtn.addEventListener('click', () => {
      flipCard();
    });
  }
  // /* updated by Cascade */

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
    // Populate back fields
    ensureBackFields(card);
    document.getElementById('card-back-bio').value = card.back.bio || '';
    document.getElementById('card-back-image').value = card.back.image || '';
    document.getElementById('card-back-qr').value = card.back.qr || '';
    document.getElementById('card-back-facebook').value = card.back.socials.facebook || '';
    document.getElementById('card-back-twitter').value = card.back.socials.twitter || '';
    document.getElementById('card-back-instagram').value = card.back.socials.instagram || '';
    document.getElementById('card-back-linkedin').value = card.back.socials.linkedin || '';
    document.getElementById('card-back-github').value = card.back.socials.github || '';
  }

  // --- Update card from form ---
  function updateCardFromForm() {
    if (showingBack) {
      ensureBackFields(currentCard);
      currentCard.back.bio = document.getElementById('card-back-bio').value;
      currentCard.back.image = document.getElementById('card-back-image').value;
      currentCard.back.qr = document.getElementById('card-back-qr').value;
      currentCard.back.socials.facebook = document.getElementById('card-back-facebook').value;
      currentCard.back.socials.twitter = document.getElementById('card-back-twitter').value;
      currentCard.back.socials.instagram = document.getElementById('card-back-instagram').value;
      currentCard.back.socials.linkedin = document.getElementById('card-back-linkedin').value;
      currentCard.back.socials.github = document.getElementById('card-back-github').value;
      currentCard.updated = new Date().toISOString();
      cards[currentCardIdx] = { ...currentCard };
      renderPreview(currentCard); // updated by Cascade
      saveCards();
      return;
    }
    currentCard.name = nameInput.value;
    if (styleSelect) currentCard.style = styleSelect.value;
    currentCard.avatar = avatarSelect.value;
    currentCard.description = descInput.value;
    currentCard.stats = parseStats(statsInput.value);
    currentCard.badges = [badgesSelect.value];
    // theme assignment handled in one place only (see below)
    currentCard.updated = new Date().toISOString(); // updated by Cascade
    cards[currentCardIdx] = { ...currentCard };
    renderPreview(currentCard);
    saveCards();
  }

  // --- Card Form Wiring: Flanked Layout ---
  // Save front fields
  if (frontFields) {
    frontFields.addEventListener('input', function(e) {
      currentCard.name = nameInput.value;
      if (styleSelect) currentCard.style = styleSelect.value;
      currentCard.avatar = avatarSelect.value;
      currentCard.description = descInput.value;
      currentCard.stats = parseStats(statsInput.value);
      currentCard.badges = [badgesSelect.value];
      currentCard.updated = new Date().toISOString();
      cards[currentCardIdx] = { ...currentCard };
      renderPreview(currentCard);
      saveCards();
    });
  }
  // Save back fields
  if (backFields) {
    backFields.addEventListener('input', function(e) {
      ensureBackFields(currentCard);
      currentCard.back.bio = document.getElementById('card-back-bio').value;
      currentCard.back.image = document.getElementById('card-back-image').value;
      currentCard.back.qr = document.getElementById('card-back-qr').value;
      currentCard.back.socials.facebook = document.getElementById('card-back-facebook').value;
      currentCard.back.socials.twitter = document.getElementById('card-back-twitter').value;
      currentCard.back.socials.instagram = document.getElementById('card-back-instagram').value;
      currentCard.back.socials.linkedin = document.getElementById('card-back-linkedin').value;
      currentCard.back.socials.github = document.getElementById('card-back-github').value;
      currentCard.updated = new Date().toISOString();
      cards[currentCardIdx] = { ...currentCard };
      renderPreview(currentCard); // updated by Cascade
      saveCards();
    });
  }

  // --- Card List Rendering ---
  const cardList = document.getElementById('card-list');
  const addCardBtn = document.querySelector('.glass-button i.fa-plus')?.parentElement;
  const exportBtn = document.querySelector('.glass-button i.fa-download')?.parentElement;
  const importBtn = document.querySelector('.glass-button i.fa-upload')?.parentElement;

  // --- Add Card Handler (added by Cascade) ---
  if (addCardBtn) {
    addCardBtn.addEventListener('click', () => {
      debugLog('Add Card button clicked');
      // Create a new card with default values
      const newId = `card-${Date.now()}`;
      const newCard = {
        id: newId,
        name: 'New Card',
        avatar: 'autumnus-majestus.jpg',
        description: '',
        stats: [],
        badges: ['legendary'],
        links: [],
        theme: 'legendary',
        style: 'rpg',
        updated: new Date().toISOString(),
        back: {
          bio: '',
          image: '',
          qr: '',
          socials: {
            facebook: '',
            twitter: '',
            instagram: '',
            linkedin: '',
            github: ''
          }
        }
      };
      cards.push(newCard);
      currentCardIdx = cards.length - 1;
      currentCard = { ...newCard };
      renderCardList();
      populateForm(currentCard);
      renderPreview(currentCard);
      
      // Local save first to ensure we don't lose the new card
      saveCards();
      
      // Then try cloud save, but don't overwrite local state if it fails
      if (window.CardForgeCloud && typeof window.CardForgeCloud.saveCards === 'function') {
        window.CardForgeCloud.saveCards([...cards])
          .then(() => {
            debugLog('New card saved to cloud successfully');
          })
          .catch(err => {
            debugLog('Failed to save new card to cloud, but local save succeeded', err);
            // Don't revert local state, we want to keep the new card locally even if cloud save failed
          });
      }
      
      debugLog('New card added:', newCard);
    });
  } // --- End Add Card Handler --- //

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
    if (!cardList) {
      debugWarn('Card list element not found in DOM.');
      return;
    }
    cardList.innerHTML = '';
    debugLog('Rendering card list. cards:', cards, 'currentCardIdx:', currentCardIdx);
    cards.forEach((card, idx) => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.className = idx === currentCardIdx ? 'active' : '';
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', card.name);
      li.innerHTML = `<img src="/images/image-packs/characters/${card.avatar}" alt="${card.name}" class="avatar-sm" /> ${card.name}`;

      // Action buttons container
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'card-list-actions';
      
      // Publish button
      const publishBtn = document.createElement('button');
      publishBtn.type = 'button';
      publishBtn.className = 'card-action-btn publish-btn';
      publishBtn.title = card.isPublic ? 'Published' : 'Publish to Gallery';
      publishBtn.innerHTML = `<i class="fas fa-${card.isPublic ? 'check-circle' : 'cloud-upload-alt'}"></i>`;
      publishBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        publishCardToGallery(card);
      });
      actionsDiv.appendChild(publishBtn);
      
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
        actionsDiv.appendChild(removeBtn);
      }
      
      // Add actions div to list item
      li.appendChild(actionsDiv);
      
      // --- Fix: actually append li to cardList (by Cascade) ---
      cardList.appendChild(li);
      // --- End Cascade fix ---
      li.addEventListener('click', () => {
        debugLog('Card selected from list:', card, 'idx:', idx);
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
    }); // End cards.forEach
  } // End renderCardList

  // Function to publish a card to the gallery
  function publishCardToGallery(card) {
    if (!card || !card.id) {
      debugError('Cannot publish card: Invalid card data');
      return;
    }

    // Get user confirmation
    if (!confirm(`Publish card "${card.name}" to the public gallery?\n\nThis will make it visible to everyone.`)) {
      return;
    }

    debugLog('Publishing card to gallery:', card);
    
    // Check if user is signed in
    const userId = CardForgeAuth.getUserId();
    if (!userId) {
      alert('You must be signed in to publish cards.');
      return;
    }

    debugLog('Publishing card with ID:', card.id, 'User ID:', userId);
    debugLog('Auth state:', document.body.getAttribute('data-auth-state'));
    
    // Remove private notes before publishing
    const cardToPublish = { ...card };
    if (cardToPublish.privateNotes) {
      delete cardToPublish.privateNotes;
    }

    // Send both lowercase and original case headers for maximum compatibility
    const headers = {
      'Content-Type': 'application/json',
      'X-User-ID': userId,
      'x-user-id': userId
    };

    fetch(`/api/cardtopublish/${card.id}`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        userId: userId,
        card: card // Send the full card data for the backend
      })
    })
    .then(response => {
      debugLog('Publish response status:', response.status);
      debugLog('Publish response headers:', JSON.stringify(Array.from(response.headers.entries())));
      
      // Get response text first to debug any JSON parsing issues
      return response.text().then(text => {
        debugLog('Publish response text:', text);
        
        if (!response.ok) {
          // Try to parse as JSON if possible
          try {
            const errorData = JSON.parse(text);
            debugError('Parsed error response:', errorData);
            throw new Error(`Server returned ${response.status}: ${errorData.message || errorData.error || response.statusText}`);
          } catch (parseError) {
            debugError('Failed to parse error response as JSON:', parseError);
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
          }
        }
        
        // Try to parse success response as JSON
        try {
          const data = JSON.parse(text);
          debugLog('Card published successfully:', data);
          return data;
        } catch (parseError) {
          debugError('Failed to parse success response as JSON:', parseError);
          throw new Error('Invalid JSON response from server');
        }
      });
    })
    .then(data => {
      // Update UI to show published status
      card.isPublic = true;
      // Save the updated card status
      saveCards();
      // Refresh the card list to show updated status
      renderCardList();
      alert('Your card has been published to the gallery!');
    })
    .catch(error => {
      debugError('Error publishing card:', error);
      alert(`Failed to publish card: ${error.message}`);
    });
  }
  
  renderPreview(currentCard);
  // --- Ensure card list is rendered on load (added by Cascade) ---
  renderCardList();
  debugLog('Initial card list rendered after DOMContentLoaded');
  // Ensure flip button state is in sync
  if (flipBtn) {
    flipBtn.setAttribute('aria-pressed', showingBack ? 'true' : 'false');
  }
  // /* updated by Cascade */
});

/**
 * CardForge Quick Build Wizard
 * 4-step guided card creation for casual/first-time users.
 * Reuses existing preset system, AI generation, and save pipeline.
 */
(function () {
  'use strict';

  const VIBES = [
    { id: 'fantasy-warrior', label: 'Fantasy Warrior', icon: 'fa-khanda', description: 'Swords, shields, and ancient valor', presetId: 'hero-classic', aiPrompt: 'A heroic fantasy warrior in gleaming armor wielding a legendary sword, standing before a castle at sunset' },
    { id: 'sci-fi-pilot', label: 'Sci-Fi Pilot', icon: 'fa-rocket', description: 'Neon cockpits and starship battles', presetId: 'split-modern', aiPrompt: 'A futuristic starship pilot in a cyberpunk cockpit with holographic displays and neon lighting' },
    { id: 'dark-sorcerer', label: 'Dark Sorcerer', icon: 'fa-hat-wizard', description: 'Forbidden magic and shadow power', presetId: 'hero-fullbleed', aiPrompt: 'A dark sorcerer channeling shadow magic in an ancient ruined temple with purple energy swirling' },
    { id: 'divine-guardian', label: 'Divine Guardian', icon: 'fa-shield-halved', description: 'Holy protectors blessed by the gods', presetId: 'celestial-warden', aiPrompt: 'A divine guardian angel in radiant golden armor with glowing wings standing on sacred ground' },
    { id: 'cyber-rogue', label: 'Cyber Rogue', icon: 'fa-user-ninja', description: 'Corporate espionage and neon streets', presetId: 'framed-ornate', aiPrompt: 'A cyberpunk rogue operative in a neon-lit alley with augmented eyes and a data blade' },
    { id: 'mystic-scholar', label: 'Mystic Scholar', icon: 'fa-book-skull', description: 'Ancient knowledge and arcane secrets', presetId: 'minimal-glow', aiPrompt: 'An arcane scholar in a library of floating books, reading from a glowing grimoire with magical runes' },
    { id: 'beast-master', label: 'Beast Master', icon: 'fa-paw', description: 'Wild creatures and primal bonds', presetId: 'fullbleed-cinematic', aiPrompt: 'A beast master ranger with a massive dire wolf companion in a misty ancient forest' },
    { id: 'shadow-operative', label: 'Shadow Operative', icon: 'fa-eye', description: 'Stealth, precision, and infiltration', presetId: 'raw-rounded', aiPrompt: 'A covert shadow operative in tactical gear on a rain-soaked rooftop overlooking a glowing city' }
  ];

  let _state = {
    step: 0,
    vibe: null,
    artworkMode: null, // 'ai' | 'url'
    artworkUrl: null,
    aiData: null,      // Full AI response (name, class, stats, etc.)
    cardName: '',
    cardClass: '',
    cardRarity: 'Common'
  };

  let _overlayEl = null;
  let _generating = false;

  // ===== PUBLIC API =====

  function open() {
    _state = { step: 0, vibe: null, artworkMode: null, artworkUrl: null, aiData: null, cardName: '', cardClass: '', cardRarity: 'Common' };
    _render();
  }

  function close() {
    if (_overlayEl) {
      _overlayEl.remove();
      _overlayEl = null;
    }
  }

  // ===== RENDER ENGINE =====

  function _render() {
    if (!_overlayEl) {
      _overlayEl = document.createElement('div');
      _overlayEl.className = 'qb-overlay';
      _overlayEl.addEventListener('click', (e) => {
        if (e.target === _overlayEl) close();
      });
      document.body.appendChild(_overlayEl);
    }

    const stepTitles = ['Pick Your Vibe', 'Choose Artwork', 'Name & Details', 'Preview & Save'];

    _overlayEl.innerHTML = `
      <div class="qb-modal" role="dialog" aria-label="Quick Build Wizard">
        <div class="qb-header">
          <h2><i class="fas fa-bolt" style="margin-right:0.5rem; color:#fbbf24;"></i>${stepTitles[_state.step]}</h2>
          <button class="qb-close" onclick="window.QuickBuild.close()" aria-label="Close wizard"><i class="fas fa-times"></i></button>
        </div>
        <div class="qb-steps">
          ${stepTitles.map((_, i) => `
            <div class="qb-step-dot ${i < _state.step ? 'completed' : ''} ${i === _state.step ? 'active' : ''}">${i < _state.step ? '<i class="fas fa-check" style="font-size:0.7rem;"></i>' : (i + 1)}</div>
            ${i < stepTitles.length - 1 ? `<div class="qb-step-line ${i < _state.step ? 'completed' : ''}"></div>` : ''}
          `).join('')}
        </div>
        <div class="qb-body">
          ${_renderStepContent()}
        </div>
        <div class="qb-nav">
          ${_state.step > 0 ? `<button class="qb-nav-btn qb-nav-btn--back" id="qb-back"><i class="fas fa-arrow-left"></i> Back</button>` : '<div></div>'}
          ${_renderNavButton()}
        </div>
      </div>
    `;

    _bindStepEvents();
  }

  function _renderStepContent() {
    switch (_state.step) {
      case 0: return _renderVibeStep();
      case 1: return _renderArtworkStep();
      case 2: return _renderDetailsStep();
      case 3: return _renderPreviewStep();
      default: return '';
    }
  }

  // ===== STEP 1: PICK YOUR VIBE =====

  function _renderVibeStep() {
    return `
      <p class="qb-panel-desc">Choose a theme for your card. This sets the visual style and provides starter content you can customize.</p>
      <div class="qb-vibe-grid">
        ${VIBES.map(v => `
          <div class="qb-vibe-card ${_state.vibe?.id === v.id ? 'selected' : ''}" data-vibe-id="${v.id}">
            <i class="fas ${v.icon}"></i>
            <span class="qb-vibe-label">${v.label}</span>
            <span class="qb-vibe-desc">${v.description}</span>
          </div>
        `).join('')}
        <div class="qb-surprise-btn" id="qb-surprise">
          <i class="fas fa-dice"></i> Surprise Me
        </div>
      </div>
    `;
  }

  // ===== STEP 2: CHOOSE ARTWORK =====

  function _renderArtworkStep() {
    const remaining = window.CardForgeAI?.getAiRemaining() ?? 0;
    const artMode = _state.artworkMode;

    let panelHTML = '';
    if (artMode === 'ai') {
      const prompt = _state.vibe?.aiPrompt || '';
      panelHTML = `
        <div class="qb-artwork-panel">
          <div class="qb-ai-prompt-wrap">
            <textarea id="qb-ai-prompt" placeholder="Describe the character artwork...">${prompt}</textarea>
            <button class="qb-generate-btn" id="qb-ai-generate" ${remaining <= 0 ? 'disabled' : ''}>
              <i class="fas fa-wand-magic-sparkles"></i> Generate
            </button>
          </div>
          <div class="qb-ai-counter">${remaining} generation${remaining !== 1 ? 's' : ''} remaining today</div>
        </div>
      `;
    } else if (artMode === 'url') {
      panelHTML = `
        <div class="qb-artwork-panel">
          <input type="url" class="qb-url-input" id="qb-url-input" placeholder="https://example.com/image.jpg" value="${_state.artworkUrl || ''}">
        </div>
      `;
    }

    const previewHTML = _state.artworkUrl
      ? `<div class="qb-artwork-preview"><img src="${_state.artworkUrl}" alt="Card artwork preview" onerror="this.parentElement.innerHTML='<p style=color:#ef4444>Failed to load image</p>'"></div>`
      : '';

    return `
      <p class="qb-panel-desc">Choose how to get your card's artwork. AI generates a unique image based on your vibe.</p>
      <div class="qb-artwork-options">
        <div class="qb-artwork-tile ${artMode === 'ai' ? 'selected' : ''}" data-art-mode="ai">
          <i class="fas fa-wand-magic-sparkles"></i>
          <span>AI Generate</span>
        </div>
        <div class="qb-artwork-tile ${artMode === 'url' ? 'selected' : ''}" data-art-mode="url">
          <i class="fas fa-link"></i>
          <span>Paste URL</span>
        </div>
        <div class="qb-artwork-tile" data-art-mode="skip">
          <i class="fas fa-forward"></i>
          <span>Skip for Now</span>
        </div>
      </div>
      ${panelHTML}
      ${previewHTML}
    `;
  }

  // ===== STEP 3: NAME & DETAILS =====

  function _renderDetailsStep() {
    const ai = _state.aiData || {};
    const preset = _state.vibe ? (window.PresetConfigurations?.[_state.vibe.presetId]?.sampleData || {}) : {};
    const name = _state.cardName || ai.name || preset.name || '';
    const cls = _state.cardClass || ai.characterClass || preset.characterClass || '';
    const rarity = _state.cardRarity || ai.rarity || 'Common';

    return `
      <p class="qb-panel-desc">Name your card and review the details. Everything here can be changed later in the full editor.</p>
      <div class="qb-form">
        <div class="qb-field">
          <label for="qb-name">Card Name *</label>
          <input type="text" id="qb-name" value="${_escHtml(name)}" placeholder="Enter a name..." maxlength="60">
        </div>
        <div class="qb-form-row">
          <div class="qb-field">
            <label for="qb-class">Class</label>
            <input type="text" id="qb-class" value="${_escHtml(cls)}" placeholder="e.g. Fighter, Mage...">
          </div>
          <div class="qb-field">
            <label for="qb-rarity">Rarity</label>
            <select id="qb-rarity">
              ${['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map(r =>
                `<option value="${r}" ${r === rarity ? 'selected' : ''}>${r}</option>`
              ).join('')}
            </select>
          </div>
        </div>
      </div>
    `;
  }

  // ===== STEP 4: PREVIEW & SAVE =====

  function _renderPreviewStep() {
    return `
      <div class="qb-preview-wrap">
        <p class="qb-panel-desc">Your card is ready! Save it to your collection or publish it to the gallery.</p>
        <div class="qb-card-preview" id="qb-card-preview">
          <div class="qb-status"><span class="qb-spinner"></span> Generating preview...</div>
        </div>
        <button class="qb-open-editor" id="qb-open-editor">Want more control? Open in full editor</button>
      </div>
    `;
  }

  // ===== NAV BUTTON =====

  function _renderNavButton() {
    if (_state.step === 3) {
      return `
        <div style="display:flex; gap:0.5rem;">
          <button class="qb-nav-btn qb-nav-btn--save" id="qb-save"><i class="fas fa-download"></i> Save</button>
          <button class="qb-nav-btn qb-nav-btn--save" id="qb-publish" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);"><i class="fas fa-globe"></i> Publish</button>
        </div>
      `;
    }

    const canAdvance = _state.step === 0 ? !!_state.vibe : true;
    return `<button class="qb-nav-btn qb-nav-btn--next" id="qb-next" ${canAdvance ? '' : 'disabled'}>Next <i class="fas fa-arrow-right"></i></button>`;
  }

  // ===== EVENT BINDING =====

  function _bindStepEvents() {
    // Back button
    const backBtn = document.getElementById('qb-back');
    if (backBtn) backBtn.addEventListener('click', () => { _state.step--; _render(); });

    // Next button
    const nextBtn = document.getElementById('qb-next');
    if (nextBtn) nextBtn.addEventListener('click', _handleNext);

    // Save/Publish buttons
    const saveBtn = document.getElementById('qb-save');
    if (saveBtn) saveBtn.addEventListener('click', () => _handleSave(false));

    const publishBtn = document.getElementById('qb-publish');
    if (publishBtn) publishBtn.addEventListener('click', () => _handleSave(true));

    // Open in editor
    const editorBtn = document.getElementById('qb-open-editor');
    if (editorBtn) editorBtn.addEventListener('click', _loadIntoEditor);

    // Step-specific bindings
    switch (_state.step) {
      case 0: _bindVibeEvents(); break;
      case 1: _bindArtworkEvents(); break;
      case 2: _bindDetailsEvents(); break;
      case 3: _triggerPreview(); break;
    }
  }

  function _bindVibeEvents() {
    document.querySelectorAll('.qb-vibe-card').forEach(card => {
      card.addEventListener('click', () => {
        const vibeId = card.dataset.vibeId;
        _state.vibe = VIBES.find(v => v.id === vibeId) || null;
        _render();
      });
    });

    const surpriseBtn = document.getElementById('qb-surprise');
    if (surpriseBtn) {
      surpriseBtn.addEventListener('click', () => {
        _state.vibe = VIBES[Math.floor(Math.random() * VIBES.length)];
        _render();
      });
    }
  }

  function _bindArtworkEvents() {
    document.querySelectorAll('.qb-artwork-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const mode = tile.dataset.artMode;
        if (mode === 'skip') {
          _state.artworkMode = null;
          _state.artworkUrl = _state.vibe
            ? (window.PresetConfigurations?.[_state.vibe.presetId]?.sampleData?.avatar || '')
            : '';
          _render();
        } else {
          _state.artworkMode = mode;
          _render();
        }
      });
    });

    // AI generate
    const generateBtn = document.getElementById('qb-ai-generate');
    if (generateBtn) {
      generateBtn.addEventListener('click', _handleAiGenerate);
    }

    // URL input
    const urlInput = document.getElementById('qb-url-input');
    if (urlInput) {
      urlInput.addEventListener('input', () => {
        _state.artworkUrl = urlInput.value.trim();
      });
      urlInput.addEventListener('change', () => _render());
    }
  }

  function _bindDetailsEvents() {
    const nameInput = document.getElementById('qb-name');
    const classInput = document.getElementById('qb-class');
    const raritySelect = document.getElementById('qb-rarity');

    if (nameInput) nameInput.addEventListener('input', () => { _state.cardName = nameInput.value; });
    if (classInput) classInput.addEventListener('input', () => { _state.cardClass = classInput.value; });
    if (raritySelect) raritySelect.addEventListener('change', () => { _state.cardRarity = raritySelect.value; });
  }

  // ===== AI GENERATION =====

  async function _handleAiGenerate() {
    if (_generating || !window.CardForgeAI) return;
    _generating = true;

    const btn = document.getElementById('qb-ai-generate');
    const promptEl = document.getElementById('qb-ai-prompt');
    const prompt = promptEl?.value?.trim() || _state.vibe?.aiPrompt || 'A mysterious RPG character';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="qb-spinner"></span> Generating...';
    }

    try {
      const AI = window.CardForgeAI;

      // Generate text (character data)
      const textPrompt = AI.buildFullCardPrompt(prompt);
      const textResp = await AI.callGemini(textPrompt, { model: AI.TEXT_MODEL });
      const textRaw = AI.extractText(textResp);
      const cardData = AI.parseJSON(textRaw);

      // Generate image
      const imgPrompt = `Create a high-quality RPG card portrait: ${prompt}. Vertical portrait composition, dramatic lighting, detailed fantasy/sci-fi art style. No text or UI elements.`;
      const imgResp = await AI.callGemini(imgPrompt, { model: AI.IMAGE_MODEL, imageGeneration: true });
      const imgData = AI.extractImage(imgResp);
      const imageUrl = imgData ? `data:${imgData.mimeType};base64,${imgData.base64}` : '';

      AI.incrementAiUsage();

      _state.aiData = cardData;
      _state.artworkUrl = imageUrl || _state.artworkUrl;
      _state.cardName = cardData.name || _state.cardName;
      _state.cardClass = cardData.characterClass || _state.cardClass;
      _state.cardRarity = cardData.rarity || _state.cardRarity;

      _render();
    } catch (err) {
      console.error('Quick Build AI error:', err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Retry';
      }
      const panel = document.querySelector('.qb-artwork-panel');
      if (panel) {
        panel.insertAdjacentHTML('beforeend', `<div class="qb-status error">Generation failed: ${err.message}</div>`);
      }
    } finally {
      _generating = false;
    }
  }

  // ===== NAVIGATION =====

  function _handleNext() {
    // Capture step 2 details before advancing
    if (_state.step === 2) {
      const nameEl = document.getElementById('qb-name');
      const classEl = document.getElementById('qb-class');
      const rarityEl = document.getElementById('qb-rarity');
      if (nameEl) _state.cardName = nameEl.value;
      if (classEl) _state.cardClass = classEl.value;
      if (rarityEl) _state.cardRarity = rarityEl.value;

      if (!_state.cardName.trim()) {
        nameEl?.focus();
        nameEl?.classList.add('qb-field-error');
        return;
      }
    }

    _state.step++;
    _render();
  }

  // ===== PREVIEW =====

  function _triggerPreview() {
    // Apply preset and data to the actual editor, then render preview
    setTimeout(() => {
      try {
        if (_state.vibe && window.CardForge?.applyPreset) {
          window.CardForge.applyPreset(_state.vibe.presetId);
        }

        // Override with wizard data
        const fields = {
          'card-name': _state.cardName,
          'card-class': _state.cardClass || '',
          'card-rarity': _state.cardRarity || 'Common',
          'card-avatar': _state.artworkUrl || ''
        };

        // Apply AI-generated data if available
        if (_state.aiData) {
          if (_state.aiData.quote) fields['card-quote'] = _state.aiData.quote;
          if (_state.aiData.biography) fields['card-bio'] = _state.aiData.biography;
          if (_state.aiData.level) fields['card-level'] = _state.aiData.level;
          if (_state.aiData.characterSubclass) fields['card-subclass'] = _state.aiData.characterSubclass;
        }

        Object.entries(fields).forEach(([id, val]) => {
          const el = document.getElementById(id);
          if (el && val) el.value = val;
        });

        // Update preview
        if (window.CardForge?.updatePreview) {
          window.CardForge.updatePreview();
        }

        // Clone preview into wizard
        const previewContainer = document.getElementById('qb-card-preview');
        const sourcePreview = document.querySelector('.card-preview-canvas');
        if (previewContainer && sourcePreview) {
          const clone = sourcePreview.cloneNode(true);
          clone.style.transform = 'scale(0.7)';
          clone.style.transformOrigin = 'top center';
          previewContainer.innerHTML = '';
          previewContainer.appendChild(clone);
        }
      } catch (err) {
        console.error('Preview generation error:', err);
        const previewContainer = document.getElementById('qb-card-preview');
        if (previewContainer) {
          previewContainer.innerHTML = '<div class="qb-status error">Preview failed to generate</div>';
        }
      }
    }, 100);
  }

  // ===== SAVE =====

  async function _handleSave(publish) {
    const btn = document.getElementById(publish ? 'qb-publish' : 'qb-save');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="qb-spinner"></span> ${publish ? 'Publishing...' : 'Saving...'}`;
    }

    try {
      // Ensure editor fields are populated
      _triggerPreview();
      await new Promise(r => setTimeout(r, 200));

      // Use existing save pipeline
      if (window.cardForgeActions) {
        if (publish) {
          await window.cardForgeActions.handlePublishCard?.();
        } else {
          await window.cardForgeActions.handleSaveCard?.();
        }
      }

      // Show success
      const body = _overlayEl?.querySelector('.qb-body');
      if (body) {
        body.innerHTML = `
          <div class="qb-status success" style="padding:3rem 1rem; font-size:1.1rem;">
            <i class="fas fa-check-circle" style="font-size:2rem; display:block; margin-bottom:1rem;"></i>
            Card ${publish ? 'published' : 'saved'} successfully!
          </div>
        `;
      }

      // Auto-close after delay
      setTimeout(close, 1500);

    } catch (err) {
      console.error('Quick Build save error:', err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Retry`;
      }
    }
  }

  // ===== LOAD INTO EDITOR =====

  function _loadIntoEditor() {
    // Data is already in the editor from _triggerPreview
    close();
    // Scroll to editor
    const editor = document.getElementById('cardforge-main-container');
    if (editor) editor.scrollIntoView({ behavior: 'smooth' });
  }

  // ===== UTILS =====

  function _escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ===== EXPOSE =====

  window.QuickBuild = { open, close };

})();

/**
 * Blindspot Quick Build — Forked from CardForge Quick Build
 * Reframed steps: Origin → Power → Form → Identity → Become
 * Card flip reveal on Step 5. Blindspot visual theme.
 * Calls back with cardId on save.
 */
(function () {
  'use strict';

  // 5 core archetypes — one per combat ability. Clean, focused choices.
  const CLASSES = [
    { id: 'Fighter',   label: 'Fighter',   icon: 'fa-hand-fist',           ability: 'Power Strike',  abilityStat: 'STR', flavor: 'Hit hard. Hit first.', desc: 'High damage strikes that overpower guards. Gets deadlier at low HP.' },
    { id: 'Caster',    label: 'Caster',    icon: 'fa-wand-magic-sparkles', ability: 'Arcane Blast',  abilityStat: 'INT', flavor: 'Rewrite the rules.',   desc: 'Arcane blasts apply Vulnerable (+15% dmg) and stun through guards.' },
    { id: 'Rogue',     label: 'Rogue',     icon: 'fa-user-ninja',          ability: 'Shadow Strike', abilityStat: 'AGI', flavor: 'Speed is everything.', desc: 'Always attacks first. Crits apply Blind (40% miss). Charges faster.' },
    { id: 'Guardian',  label: 'Guardian',  icon: 'fa-shield-halved',       ability: 'Fortify',       abilityStat: 'END', flavor: 'Outlast them all.',    desc: 'Heals + damage reduction in one move. Largest HP pool in the game.' },
    { id: 'Trickster', label: 'Trickster', icon: 'fa-dice',                ability: 'Wild Card',     abilityStat: 'LCK', flavor: 'Chaos works.',         desc: '25% chance to crit for 2x damage. 10% chance to fizzle. High risk.' }
  ];

  const STAT_BUDGET = 300;

  const STAT_DEFS = [
    { key: 'str', label: 'STR', fullLabel: 'Strength',     icon: 'fa-hand-fist',       color: '#ff5252', desc: 'Raw damage.' },
    { key: 'agi', label: 'AGI', fullLabel: 'Agility',      icon: 'fa-feather-pointed', color: '#00e676', desc: 'Speed and evasion.' },
    { key: 'int', label: 'INT', fullLabel: 'Intelligence',  icon: 'fa-bolt',            color: '#7b2fff', desc: 'Ability power.' },
    { key: 'end', label: 'END', fullLabel: 'Endurance',     icon: 'fa-heart',           color: '#ff9100', desc: 'How long you survive.' },
    { key: 'lck', label: 'LCK', fullLabel: 'Luck',          icon: 'fa-clover',          color: '#ffd740', desc: 'The unexpected.' }
  ];

  // Base stats per class (each sums to STAT_BUDGET = 300)
  const CLASS_STATS = {
    Fighter:   { str: 90, agi: 55, int: 35, end: 80, lck: 40 },
    Caster:    { str: 35, agi: 45, int: 95, end: 40, lck: 85 },
    Rogue:     { str: 55, agi: 90, int: 60, end: 50, lck: 45 },
    Guardian:  { str: 65, agi: 35, int: 45, end: 95, lck: 60 },
    Trickster: { str: 45, agi: 65, int: 55, end: 45, lck: 90 }
  };

  const VIBES = [
    { id: 'fantasy-warrior', label: 'Fantasy Warrior', icon: 'fa-khanda', description: 'Swords, shields, and ancient valor', presetId: 'hero-classic', colors: ['#3d2b1e', '#8b4513', '#228b22'], aiPrompt: 'A heroic fantasy warrior in gleaming armor wielding a legendary sword, standing before a castle at sunset' },
    { id: 'sci-fi-pilot', label: 'Sci-Fi Pilot', icon: 'fa-rocket', description: 'Neon cockpits and starship battles', presetId: 'split-modern', colors: ['#08121a', '#0099cc', '#006994'], aiPrompt: 'A futuristic starship pilot in a cyberpunk cockpit with holographic displays and neon lighting' },
    { id: 'dark-sorcerer', label: 'Dark Sorcerer', icon: 'fa-hat-wizard', description: 'Forbidden magic and shadow power', presetId: 'hero-fullbleed', colors: ['#1a0a0a', '#cc3300', '#ff6600'], aiPrompt: 'A dark sorcerer channeling shadow magic in an ancient ruined temple with purple energy swirling' },
    { id: 'divine-guardian', label: 'Divine Guardian', icon: 'fa-shield-halved', description: 'Holy protectors blessed by the gods', presetId: 'celestial-warden', colors: ['#0e1b2d', '#006994', '#0099cc'], aiPrompt: 'A divine guardian angel in radiant golden armor with glowing wings standing on sacred ground' },
    { id: 'cyber-rogue', label: 'Cyber Rogue', icon: 'fa-user-ninja', description: 'Corporate espionage and neon streets', presetId: 'framed-ornate', colors: ['#0a0a1e', '#00d4ff', '#ff00ff'], aiPrompt: 'A cyberpunk rogue operative in a neon-lit alley with augmented eyes and a data blade' },
    { id: 'mystic-scholar', label: 'Mystic Scholar', icon: 'fa-book-skull', description: 'Ancient knowledge and arcane secrets', presetId: 'minimal-glow', colors: ['#2a2a2a', '#666666', '#999999'], aiPrompt: 'An arcane scholar in a library of floating books, reading from a glowing grimoire with magical runes' },
    { id: 'beast-master', label: 'Beast Master', icon: 'fa-paw', description: 'Wild creatures and primal bonds', presetId: 'fullbleed-cinematic', colors: ['#1a0f08', '#f7931e', '#ff6b35'], aiPrompt: 'A beast master ranger with a massive dire wolf companion in a misty ancient forest' },
    { id: 'shadow-operative', label: 'Shadow Operative', icon: 'fa-eye', description: 'Stealth, precision, and infiltration', presetId: 'raw-rounded', colors: ['#1a1a1a', '#999999', '#666666'], aiPrompt: 'A covert shadow operative in tactical gear on a rain-soaked rooftop overlooking a glowing city' }
  ];

  let _state = {
    step: 0,
    vibe: null,
    artworkMode: 'gallery',
    artworkUrl: null,
    imageContainer: 'masked',
    aiData: null,
    cardName: '',
    cardClass: '',
    cardRarity: 'Common',
    customStats: null
  };

  let _overlayEl = null;
  let _generating = false;
  let _onComplete = null; // callback(cardId) when save finishes
  let _cardFlipped = false;

  const STEP_TITLES = ['Origin', 'Power', 'Form', 'Identity', 'Become'];

  // ===== PUBLIC API =====

  function open(onComplete) {
    _onComplete = onComplete || null;
    _cardFlipped = false;
    _state = { step: 0, vibe: null, artworkMode: 'gallery', artworkUrl: null, imageContainer: 'masked', aiData: null, cardName: '', cardClass: '', cardRarity: 'Common', customStats: null };
    _render();
  }

  function close(force) {
    if (!force && _overlayEl && _state.step > 0) {
      if (!confirm('Leave card builder? Your progress will be lost.')) return;
    }
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
      // Don't close on backdrop click — user must use X button or complete the wizard
      document.body.appendChild(_overlayEl);
    }

    _overlayEl.innerHTML = `
      <div class="qb-modal" role="dialog" aria-label="Build Your Card" style="background:var(--bs-surface,#1E1812); border:1px solid var(--bs-border,#2A2018); color:var(--bs-text,#F5F0E8);">
        <div class="qb-header">
          <h2 style="font-family:'Cinzel',serif; color:var(--bs-accent,#EF9F27);"><i class="fas fa-fire" style="margin-right:0.5rem;"></i>${STEP_TITLES[_state.step]}</h2>
        </div>
        <div class="qb-steps">
          ${STEP_TITLES.map((_, i) => `
            <div class="qb-step-dot ${i < _state.step ? 'completed' : ''} ${i === _state.step ? 'active' : ''}" style="${i === _state.step ? 'background:var(--bs-accent);border-color:var(--bs-accent);' : i < _state.step ? 'background:var(--bs-accent-dim);border-color:var(--bs-accent-dim);' : ''}">${i < _state.step ? '<i class="fas fa-check" style="font-size:0.7rem;"></i>' : (i + 1)}</div>
            ${i < STEP_TITLES.length - 1 ? `<div class="qb-step-line ${i < _state.step ? 'completed' : ''}" style="${i < _state.step ? 'background:var(--bs-accent-dim);' : ''}"></div>` : ''}
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
      case 1: return _renderClassStep();
      case 2: return _renderArtworkStep();
      case 3: return _renderDetailsStep();
      case 4: return _renderBecomeStep();
      default: return '';
    }
  }

  // ===== STEP 1: ORIGIN (Vibe) =====

  function _renderVibeStep() {
    return `
      <p class="qb-panel-desc">Choose your origin. This sets the visual theme for your card.</p>
      <div class="qb-vibe-grid">
        ${VIBES.map(v => `
          <div class="qb-vibe-card ${_state.vibe?.id === v.id ? 'selected' : ''}" data-vibe-id="${v.id}">
            <i class="fas ${v.icon}"></i>
            <span class="qb-vibe-label">${v.label}</span>
            <span class="qb-vibe-desc">${v.description}</span>
            <div class="qb-vibe-swatches">${v.colors.map(c => `<span class="qb-swatch" style="background:${c};"></span>`).join('')}</div>
          </div>
        `).join('')}
        <div class="qb-surprise-btn" id="qb-surprise">
          <i class="fas fa-dice"></i> Surprise Me
        </div>
      </div>
    `;
  }

  // ===== STEP 2: POWER (Class) =====

  function _renderClassStep() {
    const stats = _getActiveStats();
    const spent = STAT_DEFS.reduce((sum, d) => sum + stats[d.key], 0);
    const remaining = STAT_BUDGET - spent;

    // Two-column layout: classes on left, stats on right (or stacked on mobile)
    const classCards = CLASSES.map(c => {
      const sel = _state.cardClass === c.id;
      const classStats = CLASS_STATS[c.id];
      const topStat = classStats ? STAT_DEFS.reduce((a, b) => (classStats[a.key] || 0) > (classStats[b.key] || 0) ? a : b) : null;
      return `
        <div class="bs-class-pick ${sel ? 'bs-class-pick--selected' : ''}" data-class-id="${c.id}">
          <i class="fas ${c.icon} bs-class-pick__icon"></i>
          <div class="bs-class-pick__info">
            <span class="bs-class-pick__name">${c.label}</span>
            <span class="bs-class-pick__ability">${c.ability} (${c.abilityStat})</span>
          </div>
          ${topStat ? `<span class="bs-class-pick__top">${topStat.label} ${classStats[topStat.key]}</span>` : ''}
        </div>`;
    }).join('');

    const statsHtml = _state.cardClass ? `
      <div class="bs-stats-panel">
        <p class="qb-style-desc" style="margin:0 0 0.5rem;">Your class determines your ability. Distribute stats to match your playstyle.</p>
        <div class="bs-stats-header">
          <span><i class="fas fa-sliders"></i> Stats</span>
          <span class="bs-stats-budget ${remaining < 0 ? 'over' : remaining === 0 ? 'exact' : ''}">${remaining}/${STAT_BUDGET}</span>
        </div>
        ${STAT_DEFS.map(d => `
          <div class="bs-stat-row">
            <span class="bs-stat-label" style="color:${d.color}">${d.label}</span>
            <input type="range" class="qb-stat-slider" data-stat="${d.key}" min="0" max="100" value="${stats[d.key]}" style="--fill:${stats[d.key]}%;--stat-color:${d.color}">
            <span class="qb-stat-value" data-stat="${d.key}">${stats[d.key]}</span>
          </div>
        `).join('')}
        <button class="bs-stats-reset" id="qb-stats-reset"><i class="fas fa-rotate-left"></i> Reset</button>
      </div>` : '<div class="bs-stats-empty"><i class="fas fa-hand-pointer"></i> Pick a class to see stats</div>';

    return `
      <p class="qb-panel-desc">Choose your power. Each class has a unique combat ability.</p>
      <div class="bs-power-layout">
        <div class="bs-power-classes">${classCards}</div>
        <div class="bs-power-stats">${statsHtml}</div>
      </div>
    `;
  }

  function _getActiveStats() {
    if (_state.customStats) return { ..._state.customStats };
    if (_state.cardClass && CLASS_STATS[_state.cardClass]) return { ...CLASS_STATS[_state.cardClass] };
    return { str: 60, agi: 60, int: 60, end: 60, lck: 60 };
  }

  // ===== STEP 3: FORM (Artwork) =====

  function _renderArtworkStep() {
    const remaining = window.CardForgeAI?.getAiRemaining?.() ?? 0;
    const artMode = _state.artworkMode || 'gallery';

    let panelHTML = '';
    if (artMode === 'gallery') {
      panelHTML = `<div class="qb-artwork-panel"><div class="qb-gallery-grid" id="qb-gallery-grid"><div class="qb-status"><span class="qb-spinner"></span> <i class="fas fa-palette" style="color:var(--bs-accent,#EF9F27);margin:0 0.3em;"></i>Unveiling the gallery\u2026</div></div></div>`;
    } else if (artMode === 'ai') {
      const prompt = _state.vibe?.aiPrompt || '';
      panelHTML = `<div class="qb-artwork-panel">
        <div class="qb-ai-prompt-wrap">
          <textarea id="qb-ai-prompt" placeholder="Describe the character artwork...">${prompt}</textarea>
          <button class="qb-generate-btn" id="qb-ai-generate" ${remaining <= 0 ? 'disabled' : ''}>
            <i class="fas fa-wand-magic-sparkles"></i> Generate
          </button>
        </div>
        <div class="qb-ai-counter">${remaining} summon${remaining !== 1 ? 's' : ''} remaining</div>
        ${_state.artworkUrl ? `<div class="qb-artwork-preview"><img src="${_state.artworkUrl}" alt="Preview"></div>` : ''}
      </div>`;
    } else if (artMode === 'url') {
      panelHTML = `<div class="qb-artwork-panel">
        <input type="url" class="qb-url-input" id="qb-url-input" placeholder="https://example.com/image.jpg" value="${_state.artworkUrl || ''}">
        ${_state.artworkUrl ? `<div class="qb-artwork-preview"><img src="${_state.artworkUrl}" alt="Preview"></div>` : ''}
      </div>`;
    }

    const containerStyles = [
      { id: 'masked',    label: 'Portrait',  icon: 'fa-circle-user', desc: 'Circular portrait frame', locked: false },
      { id: 'framed',    label: 'Framed',    icon: 'fa-square',      desc: 'Classic bordered frame',  locked: false },
      { id: 'polaroid',  label: 'Polaroid',  icon: 'fa-camera-retro', desc: 'Framed photo style',    locked: false },
      { id: 'hero',      label: 'Hero',      icon: 'fa-mountain-sun', desc: 'Large hero image',      locked: true, unlock: 'Boss 4' },
      { id: 'fullbleed', label: 'Full Art',  icon: 'fa-image',       desc: 'Image fills entire card', locked: true, unlock: 'Boss 6' },
      { id: 'floating',  label: 'Floating',  icon: 'fa-expand',      desc: 'Image floats over bg',   locked: true, unlock: 'Boss 8' }
    ];

    return `
      <p class="qb-panel-desc">Give your card a face. Pick from the gallery, generate with AI, or paste a URL.</p>
      <div class="qb-artwork-options">
        ${['gallery', 'ai', 'url'].map(m => `
          <div class="qb-artwork-tile ${artMode === m ? 'selected' : ''}" data-art-mode="${m}">
            <i class="fas ${m === 'gallery' ? 'fa-images' : m === 'ai' ? 'fa-wand-magic-sparkles' : 'fa-link'}"></i>
            <span>${m === 'gallery' ? 'Gallery' : m === 'ai' ? 'AI Generate' : 'Paste URL'}</span>
          </div>
        `).join('')}
      </div>
      ${panelHTML}
      <div class="qb-style-section">
        <p class="qb-style-label">Image Style</p>
        <div class="qb-style-options">
          ${containerStyles.map(s => {
            if (s.locked) {
              return `<div class="qb-style-tile qb-style-tile--locked" title="Unlocked at ${s.unlock}">
                <i class="fas fa-lock"></i>
                <span>${s.label}</span>
                <span class="qb-style-desc">${s.unlock}</span>
              </div>`;
            }
            return `<div class="qb-style-tile ${_state.imageContainer === s.id ? 'selected' : ''}" data-img-container="${s.id}">
              <i class="fas ${s.icon}"></i>
              <span>${s.label}</span>
              <span class="qb-style-desc">${s.desc}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ===== STEP 4: IDENTITY (Name & Details) =====

  function _renderDetailsStep() {
    const ai = _state.aiData || {};
    const preset = _state.vibe ? (window.PresetConfigurations?.[_state.vibe.presetId]?.sampleData || {}) : {};
    const name = _state.cardName || ai.name || preset.name || '';
    const cls = _state.cardClass || ai.characterClass || preset.characterClass || '';
    return `
      <p class="qb-panel-desc">Name your card. This is who you become.</p>
      <div class="qb-form">
        <div class="qb-field">
          <label for="qb-name">Card Name *</label>
          <input type="text" id="qb-name" value="${_escHtml(name)}" placeholder="Enter a name..." maxlength="60">
        </div>
        <div class="qb-form-row">
          <div class="qb-field">
            <label for="qb-class">Class</label>
            <input type="text" id="qb-class" value="${_escHtml(cls)}" readonly style="opacity:0.7; cursor:default;">
          </div>
        </div>
      </div>
    `;
  }

  // ===== STEP 5: BECOME (Card Flip Reveal) =====

  function _renderBecomeStep() {
    return `
      <div class="qb-preview-wrap" style="text-align:center;">
        <p class="qb-panel-desc" style="margin-bottom:1rem;">Your card is ready. One moment defines everything.</p>
        <div class="bs-card-flip-container" id="bs-flip-container">
          <div class="bs-card-flip-inner" id="bs-flip-inner">
            <div class="bs-card-flip-front">
              <div style="display:flex; flex-direction:column; align-items:center; gap:1rem;">
                <i class="fas fa-fire" style="font-size:3rem; color:var(--bs-text-muted,#8A8070); opacity:0.25;"></i>
                <span style="font-size:0.7rem; color:var(--bs-text-muted,#8A8070); text-transform:uppercase; letter-spacing:0.1em;">Ready</span>
              </div>
            </div>
            <div class="bs-card-flip-back" id="bs-flip-back">
              <div id="qb-card-preview" style="width:100%; height:100%;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ===== NAV BUTTON =====

  function _renderNavButton() {
    if (_state.step === 4) {
      if (!_cardFlipped) {
        return `<button class="qb-nav-btn qb-nav-btn--next" id="bs-reveal-btn" style="background:var(--bs-accent);border-color:var(--bs-accent);color:var(--bs-bg,#100C08);font-family:'Cinzel',serif;font-weight:700;font-size:1.1rem;">Reveal</button>`;
      } else {
        return `<button class="qb-nav-btn qb-nav-btn--save" id="bs-enter-arena" style="background:var(--bs-accent);border-color:var(--bs-accent);font-family:'Cinzel',serif;font-weight:700;">Continue</button>`;
      }
    }

    const canAdvance = _state.step === 0 ? !!_state.vibe
                     : _state.step === 1 ? !!_state.cardClass
                     : _state.step === 2 ? !!_state.artworkUrl
                     : true;
    return `<button class="qb-nav-btn qb-nav-btn--next" id="qb-next" ${canAdvance ? '' : 'disabled'} style="background:var(--bs-accent);border-color:var(--bs-accent);color:var(--bs-bg,#100C08);">Next <i class="fas fa-arrow-right"></i></button>`;
  }

  // ===== EVENT BINDING =====

  function _bindStepEvents() {
    const backBtn = document.getElementById('qb-back');
    if (backBtn) backBtn.addEventListener('click', () => { _state.step--; _cardFlipped = false; _render(); });

    const nextBtn = document.getElementById('qb-next');
    if (nextBtn) nextBtn.addEventListener('click', _handleNext);

    switch (_state.step) {
      case 0: _bindVibeEvents(); break;
      case 1: _bindClassEvents(); break;
      case 2: _bindArtworkEvents(); break;
      case 3: _bindDetailsEvents(); break;
      case 4: _bindBecomeEvents(); break;
    }
  }

  function _bindVibeEvents() {
    document.querySelectorAll('.qb-vibe-card').forEach(card => {
      card.addEventListener('click', () => {
        const vibeId = card.dataset.vibeId;
        const newVibe = VIBES.find(v => v.id === vibeId) || null;
        if (_state.vibe?.id !== vibeId) {
          _state.artworkMode = 'gallery';
          _state.artworkUrl = null;
          _state.aiData = null;
        }
        _state.vibe = newVibe;
        _render();
      });
    });

    const surpriseBtn = document.getElementById('qb-surprise');
    if (surpriseBtn) {
      surpriseBtn.addEventListener('click', () => {
        _state.artworkMode = 'gallery';
        _state.artworkUrl = null;
        _state.aiData = null;
        _state.vibe = VIBES[Math.floor(Math.random() * VIBES.length)];
        _render();
      });
    }
  }

  function _bindClassEvents() {
    document.querySelectorAll('.bs-class-pick, .qb-class-card').forEach(card => {
      card.addEventListener('click', () => {
        _state.cardClass = card.dataset.classId;
        _state.customStats = null;
        _render();
      });
    });

    // Stat sliders
    document.querySelectorAll('.qb-stat-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.stat;
        let requested = parseInt(slider.value, 10);
        if (!_state.customStats) _state.customStats = { ..._getActiveStats() };

        let otherTotal = 0;
        STAT_DEFS.forEach(d => {
          if (d.key !== key) otherTotal += (_state.customStats[d.key] || 0);
        });
        const maxAllowed = Math.max(0, STAT_BUDGET - otherTotal);
        const clamped = Math.min(requested, maxAllowed);

        _state.customStats[key] = clamped;
        slider.value = clamped;
        slider.style.setProperty('--fill', clamped + '%');
        const display = slider.closest('.bs-stat-row').querySelector('.qb-stat-value');
        if (display) display.textContent = clamped;

        const spent = STAT_DEFS.reduce((sum, d) => sum + (_state.customStats[d.key] || 0), 0);
        const remaining = STAT_BUDGET - spent;
        const budgetEl = document.querySelector('.bs-stats-budget');
        if (budgetEl) {
          budgetEl.textContent = `${remaining} / ${STAT_BUDGET}`;
          budgetEl.classList.toggle('over', remaining < 0);
          budgetEl.classList.toggle('exact', remaining === 0);
        }
      });
    });

    const resetBtn = document.getElementById('qb-stats-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        _state.customStats = null;
        _render();
      });
    }
  }

  let _galleryCache = null;
  let _thumbCache = null;

  function _bindArtworkEvents() {
    document.querySelectorAll('.qb-artwork-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        _state.artworkMode = tile.dataset.artMode;
        _render();
      });
    });

    const galleryGrid = document.getElementById('qb-gallery-grid');
    if (galleryGrid) {
      _loadGalleryImages(galleryGrid);
    }

    const generateBtn = document.getElementById('qb-ai-generate');
    if (generateBtn) {
      generateBtn.addEventListener('click', _handleAiGenerate);
    }

    const urlInput = document.getElementById('qb-url-input');
    if (urlInput) {
      urlInput.addEventListener('input', () => {
        _state.artworkUrl = urlInput.value.trim();
        const nextBtn = document.getElementById('qb-next');
        if (nextBtn) nextBtn.disabled = !_state.artworkUrl;
      });
      urlInput.addEventListener('change', () => _render());
    }

    document.querySelectorAll('.qb-style-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        _state.imageContainer = tile.dataset.imgContainer;
        document.querySelectorAll('.qb-style-tile').forEach(t => t.classList.remove('selected'));
        tile.classList.add('selected');
      });
    });
  }

  function _loadGalleryImages(container) {
    const renderGrid = (originals, thumbs) => {
      container.innerHTML = originals.map((url, i) => {
        const thumbUrl = thumbs && thumbs[i] ? thumbs[i] : url;
        const selected = _state.artworkUrl === url ? ' selected' : '';
        return `<img class="qb-gallery-img${selected}" src="${thumbUrl}" alt="" data-url="${url}">`;
      }).join('');

      container.querySelectorAll('.qb-gallery-img').forEach(img => {
        img.addEventListener('click', () => {
          container.querySelectorAll('.qb-gallery-img').forEach(i => i.classList.remove('selected'));
          img.classList.add('selected');
          _state.artworkUrl = img.dataset.url;
          const nextBtn = document.getElementById('qb-next');
          if (nextBtn) nextBtn.disabled = false;
        });
      });
    };

    if (_galleryCache) { renderGrid(_galleryCache, _thumbCache); return; }

    // Load both manifests in parallel — thumbs for display, originals for card save
    Promise.all([
      fetch('/cardforge/image-manifest.json').then(r => r.json()),
      fetch('/cardforge/image-manifest-thumbs.json').then(r => r.json()).catch(() => null)
    ]).then(([images, thumbs]) => {
      _galleryCache = images;
      _thumbCache = thumbs;
      renderGrid(images, thumbs);
    }).catch(() => { container.innerHTML = '<div class="qb-status error">Failed to load gallery</div>'; });
  }

  function _bindDetailsEvents() {
    const nameInput = document.getElementById('qb-name');
    const classInput = document.getElementById('qb-class');

    if (nameInput) nameInput.addEventListener('input', () => { _state.cardName = nameInput.value; });
    if (classInput) classInput.addEventListener('input', () => { _state.cardClass = classInput.value; });
  }

  function _bindBecomeEvents() {
    const revealBtn = document.getElementById('bs-reveal-btn');
    if (revealBtn) {
      revealBtn.addEventListener('click', () => {
        _triggerReveal();
      });
    }

    const enterBtn = document.getElementById('bs-enter-arena');
    if (enterBtn) {
      enterBtn.addEventListener('click', () => {
        _handleSaveAndEnter();
      });
    }
  }

  // ===== REVEAL ANIMATION =====

  function _triggerReveal() {
    // Populate the card preview first, then flip after it renders
    _populatePreview();

    // Wait for preview to render (editor needs time), then flip
    setTimeout(() => {
      // Re-clone preview right before flip (in case editor rendered async)
      const sourcePreview = document.querySelector('.card-preview-zone .card-preview-canvas');
      const previewContainer = document.getElementById('qb-card-preview');
      if (sourcePreview && previewContainer) {
        const clone = sourcePreview.cloneNode(true);
        clone.style.width = '100%';
        clone.style.height = '100%';
        clone.style.position = 'absolute';
        clone.style.top = '0';
        clone.style.left = '0';
        clone.style.transform = '';
        clone.style.borderRadius = '12px';
        clone.style.overflow = 'hidden';
        previewContainer.innerHTML = '';
        previewContainer.style.position = 'relative';
        previewContainer.appendChild(clone);
      }

      // Now flip
      const flipInner = document.getElementById('bs-flip-inner');
      if (flipInner) flipInner.classList.add('flipped');

      // Play SFX
      if (window.ArenaAudio) {
        try { window.ArenaAudio.playSfx('victory'); } catch (e) {}
      }

      _cardFlipped = true;
    }, 300); // 300ms gives editor time to render

    // Update nav button after flip animation completes
    setTimeout(() => {
      const navEl = _overlayEl?.querySelector('.qb-nav');
      if (navEl) {
        const backBtn = navEl.querySelector('.qb-nav-btn--back');
        navEl.innerHTML = (backBtn ? backBtn.outerHTML : '<div></div>') +
          `<button class="qb-nav-btn qb-nav-btn--save" id="bs-enter-arena" style="background:var(--bs-accent);border-color:var(--bs-accent);font-family:'Cinzel',serif;font-weight:700;">Continue</button>`;

        document.getElementById('bs-enter-arena')?.addEventListener('click', _handleSaveAndEnter);
        document.getElementById('qb-back')?.addEventListener('click', () => { _state.step--; _cardFlipped = false; _render(); });
      }
    }, 1200); // After flip animation (800ms) + buffer
  }

  function _populatePreview() {
    return new Promise(resolve => { setTimeout(() => {
      try {
        // Apply preset design
        if (_state.vibe && window.CardForge?.applyPresetDesignOnly) {
          window.CardForge.applyPresetDesignOnly(_state.vibe.presetId);
        }

        // Set image container
        if (_state.imageContainer && window.CardForge?.ModularState) {
          const MS = window.CardForge.ModularState;
          MS.imageContainer = _state.imageContainer;
          if (_state.imageContainer === 'masked') MS.imageContainerVariant = 'circle';
          else if (_state.imageContainer === 'polaroid') MS.imageContainerVariant = 'classic';
          else if (_state.imageContainer === 'framed') MS.imageContainerVariant = '';
          else if (_state.imageContainer === 'hero') MS.imageContainerVariant = '';
          else MS.imageContainerVariant = '';
        }

        // Clear dynamic rows
        if (window.CardForge?.clearAllDynamicRows) window.CardForge.clearAllDynamicRows();

        // Set form fields
        const setField = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.value = val ?? '';
        };

        setField('card-name', _state.cardName);
        setField('card-rarity', _state.cardRarity || 'Common');
        setField('card-avatar', _state.artworkUrl || '');
        setField('card-quote', _state.aiData?.quote || '');
        setField('card-bio', _state.aiData?.biography || '');

        const classSelect = document.getElementById('card-class');
        if (classSelect) classSelect.value = _state.cardClass || '';

        // Set combat stats
        if (window.CardForge?.setCombatStatValues) {
          const stats = _getActiveStats();
          window.CardForge.setCombatStatValues(stats);
        }

        // Render
        if (window.CardForge?.updatePreview) window.CardForge.updatePreview();

        // Set avatar directly
        if (_state.artworkUrl) {
          document.querySelectorAll('.card-preview-zone .card-avatar').forEach(img => {
            img.src = _state.artworkUrl;
          });
        }

        // Clone preview into flip card — scale to fit container
        const sourcePreview = document.querySelector('.card-preview-zone .card-preview-canvas');
        const previewContainer = document.getElementById('qb-card-preview');
        if (sourcePreview && previewContainer) {
          const clone = sourcePreview.cloneNode(true);
          // Let the card render at natural size, then scale to fit the flip container
          clone.style.width = '300px';
          clone.style.height = 'auto';
          clone.style.position = 'absolute';
          clone.style.top = '0';
          clone.style.left = '0';
          clone.style.transformOrigin = 'top left';
          clone.style.borderRadius = '12px';
          clone.style.overflow = 'hidden';
          previewContainer.innerHTML = '';
          previewContainer.style.position = 'relative';
          previewContainer.style.overflow = 'hidden';
          previewContainer.appendChild(clone);
          // After render, scale down to fit container height
          requestAnimationFrame(() => {
            const containerH = previewContainer.offsetHeight || 560;
            const cardH = clone.scrollHeight || clone.offsetHeight;
            if (cardH > containerH) {
              const scale = containerH / cardH;
              clone.style.transform = 'scale(' + scale + ')';
              clone.style.width = (300 / scale) + 'px';
            }
          });
        }
      } catch (err) {
        console.error('[BS-QB] Preview error:', err);
      }
      resolve();
    }, 50); });
  }

  // ===== SAVE & ENTER ARENA =====

  async function _handleSaveAndEnter() {
    const btn = document.getElementById('bs-enter-arena');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="qb-spinner"></span> <i class="fas fa-hammer" style="margin-right:0.2em;"></i>Forging\u2026';
    }

    try {
      // Re-trigger preview to ensure all fields are set (returns promise)
      await _populatePreview();
      // Extra frame for DOM to settle after preview render
      await new Promise(r => requestAnimationFrame(r));

      // Save via existing pipeline (note: handleSaveCard's fetch is fire-and-forget)
      let savedCardId = null;
      if (window.cardForgeActions?.handleSaveCard) {
        await window.cardForgeActions.handleSaveCard();
      }

      // handleSaveCard doesn't await its fetch — wait generously for blob propagation
      await new Promise(r => setTimeout(r, 3000));

      // Retry loadCards up to 5 times to find the newly saved card
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const data = await window.ArenaAPI.loadCards();
          const cards = data.userCards || [];
          if (cards.length > 0) {
            savedCardId = cards[cards.length - 1].id;
            break;
          }
        } catch (e) {
          console.warn('[BS-QB] loadCards attempt', attempt + 1, 'failed:', e);
        }
        if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
      }

      if (!savedCardId) {
        console.warn('[BS-QB] Could not find saved card after 5 attempts');
        if (btn) { btn.disabled = false; btn.innerHTML = 'Continue'; }
        // Show error — don't proceed without a card
        const panel = _overlayEl?.querySelector('.qb-body');
        if (panel) {
          panel.insertAdjacentHTML('beforeend',
            '<div style="color:var(--bs-danger,#D85A30); text-align:center; padding:0.75rem; font-size:0.85rem; margin-top:0.5rem;">Card save is taking longer than expected. Please try again.</div>'
          );
        }
        return;
      }

      // Select the card
      try { await window.ArenaAPI.selectCard(savedCardId); } catch (e) { console.warn('selectCard error:', e); }

      close(true);

      if (_onComplete) {
        _onComplete(savedCardId);
      }
    } catch (err) {
      console.error('[BS-QB] Save error:', err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Continue';
      }
    }
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
      btn.innerHTML = '<span class="qb-spinner"></span> <i class="fas fa-wand-magic-sparkles" style="margin-right:0.2em;"></i>Channeling\u2026';
    }

    try {
      const AI = window.CardForgeAI;
      const textPrompt = AI.buildFullCardPrompt(prompt);
      const textResp = await AI.callGemini(textPrompt, { model: AI.TEXT_MODEL, skipUsageIncrement: true });
      const textRaw = AI.extractText(textResp);
      const cardData = AI.parseJSON(textRaw);

      const imgPrompt = `Create a high-quality RPG card portrait: ${prompt}. Vertical portrait composition, dramatic lighting, detailed fantasy/sci-fi art style. No text or UI elements.`;
      const imgResp = await AI.callGemini(imgPrompt, { model: AI.IMAGE_MODEL, imageGeneration: true });
      const imgData = AI.extractImage(imgResp);
      const imageUrl = imgData ? `data:${imgData.mimeType};base64,${imgData.base64}` : '';

      _state.aiData = cardData;
      _state.artworkUrl = imageUrl || _state.artworkUrl;
      _state.cardName = cardData.name || _state.cardName;
      _state.cardClass = cardData.characterClass || _state.cardClass;
      _state.cardRarity = cardData.rarity || _state.cardRarity;

      _render();
    } catch (err) {
      console.error('[BS-QB] AI error:', err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Retry';
      }
    } finally {
      _generating = false;
    }
  }

  // ===== NAVIGATION =====

  function _handleNext() {
    if (_state.step === 3) {
      const nameEl = document.getElementById('qb-name');
      const classEl = document.getElementById('qb-class');
      if (nameEl) _state.cardName = nameEl.value;
      if (classEl) _state.cardClass = classEl.value;

      if (!_state.cardName.trim()) {
        nameEl?.focus();
        nameEl?.classList.add('qb-field-error');
        return;
      }
    }

    _state.step++;
    _render();
  }

  // ===== UTILS =====

  function _escHtml(str) {
    return (window.UIUtils && window.UIUtils.escapeHtml) ? window.UIUtils.escapeHtml(str)
      : (function() { const div = document.createElement('div'); div.textContent = str || ''; return div.innerHTML; })();
  }

  // ===== EXPOSE =====

  window.BlindspotQuickBuild = { open, close };

})();

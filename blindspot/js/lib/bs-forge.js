/**
 * bs-forge.js — Forge screen: stat allocation, palette/container unlock,
 * avatar gallery/AI gen, name/quote editing, canvas ember particles.
 * Extracted from blindspot-flow.js (Round 4.3).
 */
(function () {
  'use strict';

  var _C = window.BsConst || {};
  var RC_STAT_DEFS = _C.RC_STAT_DEFS;

  var _Str = window.BsStrategy || {};
  var WEAKNESS_LABELS = _Str.WEAKNESS_LABELS;
  var WEAKNESS_COLORS = _Str.WEAKNESS_COLORS;

  // ── Callbacks injected by monolith ──
  var _cb = {};
  function setCallbacks(cbs) { _cb = cbs || {}; }

  function escHtml(s) { return _cb.escHtml ? _cb.escHtml(s) : String(s || ''); }

  function showOverlay(id) { if (_cb.showOverlay) _cb.showOverlay(id); }
  function hideOverlay(id) { if (_cb.hideOverlay) _cb.hideOverlay(id); }

  function openForgeScreen(isFirstUnlock, showCardPicker) {
    var _selectedCard = _cb.getSelectedCard ? _cb.getSelectedCard() : null;
    var _progress = _cb.getProgress ? _cb.getProgress() : {};
    var config = _cb.getConfig ? config : null;
    var rawBonus = isFirstUnlock
      ? (config ? config.forgeVisit.firstUnlockBonusPoints : 35)
      : (config ? config.forgeVisit.bonusPoints : 25);

    if (!_selectedCard || !_selectedCard.combatStats) {
    _cb.showErrorToast('No card selected for evolution.');
    return;
  }

  var FORGE_POWER_CAP = 400;
  var currentStats = { ..._selectedCard.combatStats };
  var currentTotal = Object.values(currentStats).reduce(function(a, b) { return a + b; }, 0);
  // Cap bonus so total power cannot exceed FORGE_POWER_CAP
  var bonusPoints = currentTotal >= FORGE_POWER_CAP ? 0 : Math.min(rawBonus, FORGE_POWER_CAP - currentTotal);
  const allocations = { str: 0, agi: 0, int: 0, end: 0, lck: 0 };

  const statDefs = [
    { key: 'str', label: 'STR', desc: 'Strike: 40-50% as dmg', color: '#ff5252', icon: 'fa-hand-fist' },
    { key: 'agi', label: 'AGI', desc: 'Turn order + dodge',    color: '#00e676', icon: 'fa-feather-pointed' },
    { key: 'int', label: 'INT', desc: 'Ability damage',        color: '#7b2fff', icon: 'fa-bolt' },
    { key: 'end', label: 'END', desc: 'Heal: 30-40% as HP',   color: '#ff9100', icon: 'fa-heart' },
    { key: 'lck', label: 'LCK', desc: 'Crit chance (5%+)',    color: '#ffd740', icon: 'fa-clover' }
  ];

  var totalBefore = currentTotal;
  const respecCost = config ? config.forgeVisit.winsRequired : 3;
  let _respecActive = false;

  // Visual options for Look tab — can be unlocked via boss defeats OR purchased with Sparks
  const PALETTES = [
    { id: 'earth', label: 'Earth', key: 'palette_earth', unlock: 'Default', cost: 0 },
    { id: 'ocean', label: 'Ocean', key: 'palette_ocean', unlock: 'Beat Boss 2', cost: 30 },
    { id: 'neon', label: 'Neon', key: 'palette_neon', unlock: 'Beat Boss 4', cost: 50 },
    { id: 'fire', label: 'Fire', key: 'palette_fire', unlock: 'Beat Boss 8', cost: 75 },
    { id: 'monochrome', label: 'Mono', key: 'palette_earth', unlock: 'Default', cost: 0 },
    { id: 'sunset', label: 'Sunset', key: 'palette_earth', unlock: 'Default', cost: 0 },
    { id: 'inferno', label: 'Inferno', key: 'palette_inferno', unlock: 'Ascension 1', cost: 100 },
    { id: 'frost', label: 'Frost', key: 'palette_frost', unlock: 'Ascension 2', cost: 100 }
  ];
  const CONTAINERS = [
    { id: 'masked', label: 'Portrait', icon: 'fa-circle-user', key: 'container_masked', cost: 0 },
    { id: 'fullbleed', label: 'Full Art', icon: 'fa-image', key: 'container_fullbleed', cost: 40 },
    { id: 'framed', label: 'Framed', icon: 'fa-square', key: 'container_masked', cost: 0 }
  ];
  const uv = _cb.getUnlockedVisuals();
  const purchased = _cb.getPurchasedCosmetics();

  const panel = document.getElementById('bs-forge-panel');
  var deckSize = _cb.getDeck().length;
  var showPicker = showCardPicker && deckSize > 1;
  var cardIdx = _cb.getSelectedCardIndex();

  panel.innerHTML = `
    <div class="bs-forge-layout">
      <div class="bs-forge-preview">
        ${_cb.renderCardHTML(_selectedCard, 'full')}
        ${showPicker ? `<div class="bs-card-switcher" style="margin-top:0.5rem;">
          <button class="bs-card-switcher__btn" id="bs-forge-card-prev" aria-label="Previous card"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
          <span class="bs-card-switcher__count">${cardIdx + 1} / ${deckSize}</span>
          <button class="bs-card-switcher__btn" id="bs-forge-card-next" aria-label="Next card"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
        </div>` : ''}
      </div>
      <div class="bs-forge-editor">
    <h2 class="bs-forge-screen__title"><i class="fas fa-fire" style="color:var(--bs-accent);"></i> Card Forge</h2>
    <div class="bs-forge-tabs">
      <button class="bs-forge-tab bs-forge-tab--active" data-tab="stats"><i class="fas fa-sliders"></i> Stats</button>
      <button class="bs-forge-tab" data-tab="look"><i class="fas fa-palette"></i> Look</button>
      <button class="bs-forge-tab" data-tab="details"><i class="fas fa-pen"></i> Details</button>
    </div>
    <div class="bs-forge-tab-container">
    <div class="bs-forge-tab-content bs-forge-tab-content--active" id="bs-forge-tab-stats">
      <div class="bs-forge-budget">
        <div class="bs-forge-budget__stat">
          <span class="bs-forge-budget__label">Power</span>
          <span class="bs-forge-budget__value"><strong id="bs-forge-total">${totalBefore}</strong><span class="bs-forge-budget__cap">/${FORGE_POWER_CAP}</span></span>
        </div>
        <div class="bs-forge-budget__stat">
          <span class="bs-forge-budget__label">Points</span>
          <span class="bs-forge-budget__value"><strong id="bs-forge-remaining">${bonusPoints}</strong></span>
        </div>
        <div class="bs-forge-budget__action">
          ${_cb.getForgeWins() >= respecCost ? `<button class="bs-btn bs-btn--small" id="bs-forge-respec" title="Reset all stats and redistribute"><i class="fas fa-rotate"></i> Respec</button>` : `<span class="bs-forge-budget__locked" title="Need ${respecCost} forge wins to respec"><i class="fas fa-lock"></i> Respec (${_cb.getForgeWins()}/${respecCost})</span>`}
        </div>
      </div>
      <div class="bs-forge-stat-list">
      ${statDefs.map(d => `
        <div class="bs-forge-stat">
          <i class="fas ${d.icon}" style="color:${d.color};"></i>
          <span class="bs-forge-stat__label" style="color:${d.color}">${d.label}</span>
          <span class="bs-forge-stat__base">${currentStats[d.key]}</span>
          <span class="bs-forge-stat__arrow">\u2192</span>
          <input type="range" class="bs-forge-stat__slider" data-stat="${d.key}"
                 min="${currentStats[d.key]}" max="100" value="${currentStats[d.key]}">
          <span class="bs-forge-stat__value" data-stat="${d.key}">${currentStats[d.key]}</span>
        </div>
      `).join('')}
      </div>
      <div class="bs-unlock-teaser" id="bs-forge-teaser"></div>
    </div>
    <div class="bs-forge-tab-content" id="bs-forge-tab-look">
      <div class="bs-forge-sparks-bar">
        <i class="fas fa-fire"></i> <span id="bs-forge-sparks">${_cb.getSparks()}</span> Sparks available
      </div>
      <div class="bs-forge-look-section">
        <label class="bs-forge-look-section__label"><i class="fas fa-palette"></i> Card Palette</label>
        <div class="bs-forge-palette-grid">
          ${PALETTES.map(p => {
            var owned = uv.includes(p.key) || purchased.includes(p.key);
            if (owned) return '<button class="bs-forge-palette-swatch" data-palette="' + p.id + '" title="' + p.label + '"><span class="bs-forge-palette-swatch__preview" data-pal="' + p.id + '"></span><span class="bs-forge-palette-swatch__name">' + p.label + '</span></button>';
            if (p.cost > 0) return '<button class="bs-forge-palette-swatch bs-forge-palette-swatch--buyable" data-buy-palette="' + p.id + '" data-buy-key="' + p.key + '" data-buy-cost="' + p.cost + '" title="' + p.cost + ' Sparks"><span class="bs-forge-palette-swatch__preview" data-pal="' + p.id + '"></span><span class="bs-forge-palette-swatch__name"><i class="fas fa-fire"></i> ' + p.cost + '</span></button>';
            return '<button class="bs-forge-palette-swatch bs-forge-palette-swatch--locked" disabled title="' + p.unlock + '"><span class="bs-forge-palette-swatch__preview"></span><span class="bs-forge-palette-swatch__name"><i class="fas fa-lock"></i> ' + p.unlock + '</span></button>';
          }).join('')}
        </div>
      </div>
      <div class="bs-forge-look-section">
        <label class="bs-forge-look-section__label"><i class="fas fa-crop-simple"></i> Image Layout</label>
        <div class="bs-forge-container-grid">
          ${CONTAINERS.map(c => {
            var owned = uv.includes(c.key) || purchased.includes(c.key);
            if (owned) return '<button class="bs-forge-container-card" data-container="' + c.id + '"><i class="fas ' + c.icon + '"></i><span>' + c.label + '</span></button>';
            if (c.cost > 0) return '<button class="bs-forge-container-card bs-forge-container-card--buyable" data-buy-container="' + c.id + '" data-buy-key="' + c.key + '" data-buy-cost="' + c.cost + '"><i class="fas ' + c.icon + '"></i><span><i class="fas fa-fire"></i> ' + c.cost + '</span></button>';
            return '<button class="bs-forge-container-card bs-forge-container-card--locked" disabled><i class="fas fa-lock"></i><span>Locked</span></button>';
          }).join('')}
        </div>
      </div>
    </div>
    <div class="bs-forge-tab-content" id="bs-forge-tab-details">
      <p style="font-size:0.8rem; color:var(--bs-text-muted); margin-bottom:0.75rem;">Change your card's identity.</p>
      <div style="margin-bottom:0.75rem;">
        <label style="font-size:0.75rem; color:var(--bs-text-muted); display:block; margin-bottom:0.3rem;">Card Name</label>
        <input type="text" id="bs-forge-name" value="${escHtml(_selectedCard.name || '')}" maxlength="30"
               style="width:100%; padding:0.5rem; background:var(--bs-surface-2); border:1px solid var(--bs-border); border-radius:6px; color:var(--bs-text); font-family:'Share Tech Mono',monospace; font-size:0.85rem;">
      </div>
      <div style="margin-bottom:0.75rem;">
        <label style="font-size:0.75rem; color:var(--bs-text-muted); display:block; margin-bottom:0.3rem;">Quote</label>
        <input type="text" id="bs-forge-quote" value="${escHtml(_selectedCard.quote || '')}" maxlength="100"
               style="width:100%; padding:0.5rem; background:var(--bs-surface-2); border:1px solid var(--bs-border); border-radius:6px; color:var(--bs-text); font-family:'Share Tech Mono',monospace; font-size:0.85rem;">
      </div>
      <div style="margin-bottom:0.75rem;">
        <label style="font-size:0.75rem; color:var(--bs-text-muted); display:block; margin-bottom:0.3rem;">Avatar</label>
        <div class="bs-forge-avatar-tabs" style="display:flex; gap:0.25rem; margin-bottom:0.5rem;">
          <button class="bs-forge-avt-tab bs-forge-avt-tab--active" data-avt-tab="gallery" style="flex:1; padding:0.3rem; font-size:0.65rem; border:1px solid var(--bs-border); border-radius:6px; background:var(--bs-surface-2); color:var(--bs-text); cursor:pointer;"><i class="fas fa-images"></i> Gallery</button>
          <button class="bs-forge-avt-tab" data-avt-tab="ai" style="flex:1; padding:0.3rem; font-size:0.65rem; border:1px solid var(--bs-border); border-radius:6px; background:var(--bs-surface-2); color:var(--bs-text-muted); cursor:pointer;"><i class="fas fa-wand-magic-sparkles"></i> AI Generate</button>
          <button class="bs-forge-avt-tab" data-avt-tab="url" style="flex:1; padding:0.3rem; font-size:0.65rem; border:1px solid var(--bs-border); border-radius:6px; background:var(--bs-surface-2); color:var(--bs-text-muted); cursor:pointer;"><i class="fas fa-link"></i> URL</button>
        </div>
        <div id="bs-forge-avt-gallery" class="bs-forge-avt-content">
          <div id="bs-forge-avatar-grid" style="min-height:120px;">
            <div style="text-align:center; color:var(--bs-text-muted); font-size:0.7rem; padding:1rem;"><i class="fas fa-scroll" style="color:var(--bs-accent);margin-right:0.3em;"></i><i class="fas fa-spinner fa-spin" style="margin-right:0.3em;"></i>Gathering your collection\u2026</div>
          </div>
        </div>
        <div id="bs-forge-avt-ai" class="bs-forge-avt-content" style="display:none;">
          <div style="margin-bottom:0.5rem;">
            <input type="text" id="bs-forge-ai-prompt" placeholder="Describe your character... e.g. 'cyberpunk warrior with glowing eyes'" maxlength="200"
                   style="width:100%; padding:0.5rem; background:var(--bs-surface-2); border:1px solid var(--bs-border); border-radius:6px; color:var(--bs-text); font-family:'Share Tech Mono',monospace; font-size:0.8rem; margin-bottom:0.4rem;">
            <div style="display:flex; gap:0.4rem; align-items:center;">
              <select id="bs-forge-ai-style" style="flex:1; padding:0.35rem; background:var(--bs-surface-2); border:1px solid var(--bs-border); border-radius:6px; color:var(--bs-text); font-size:0.7rem;">
                <option value="ap-fantasy-card">Fantasy Card Art</option>
                <option value="ap-dark-fantasy">Dark Fantasy</option>
                <option value="ap-dark-cinematic">Dark Cinematic</option>
                <option value="ap-comic-book">Comic Book</option>
                <option value="ap-anime-cel">Anime</option>
                <option value="ap-oil-portrait">Oil Portrait</option>
                <option value="ap-holographic">Holographic</option>
                <option value="ap-neon-glass">Neon Glass</option>
                <option value="ap-watercolor">Watercolor</option>
                <option value="ap-ornate-frame">Ornate Frame</option>
                <option value="ap-retro-pixel">Retro Pixel</option>
                <option value="none">No Style</option>
              </select>
              <button class="bs-btn bs-btn--primary bs-btn--small" id="bs-forge-ai-generate" style="padding:0.35rem 0.75rem; font-size:0.7rem; white-space:nowrap;">
                <i class="fas fa-wand-magic-sparkles"></i> Generate
              </button>
            </div>
          </div>
          <div id="bs-forge-ai-status" style="font-size:0.7rem; color:var(--bs-text-muted); text-align:center; min-height:1.5rem;"></div>
          <div id="bs-forge-ai-result" style="text-align:center;"></div>
        </div>
        <div id="bs-forge-avt-url" class="bs-forge-avt-content" style="display:none;">
          <input type="url" id="bs-forge-avatar" value="${escHtml(_selectedCard.avatar || '')}" placeholder="https://..."
                 style="width:100%; padding:0.5rem; background:var(--bs-surface-2); border:1px solid var(--bs-border); border-radius:6px; color:var(--bs-text); font-family:'Share Tech Mono',monospace; font-size:0.8rem;">
        </div>
      </div>
    </div>
    </div>
      </div>
    </div>
    <div class="bs-forge-actions" style="display:flex; gap:0.75rem; justify-content:flex-end; margin-top:1rem;">
      <button class="bs-btn bs-btn--secondary" id="bs-forge-cancel">Cancel</button>
      <button class="bs-btn bs-btn--primary bs-btn--glow" id="bs-forge-apply" disabled>
        <i class="fas fa-fire"></i> Forge
      </button>
    </div>
  `;

  showOverlay('bs-forge-screen');

  // Ember particles rising in forge editor
  (function initForgeEmbers() {
    var editor = panel.querySelector('.bs-forge-editor');
    if (!editor) return;
    editor.style.position = 'relative';
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;left:0;right:0;bottom:0;width:100%;height:60%;pointer-events:none;opacity:0.35;';
    editor.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var embers = [];
    var raf;

    function resize() {
      canvas.width = editor.offsetWidth;
      canvas.height = Math.round(editor.offsetHeight * 0.6);
    }
    resize();

    function spawn() {
      embers.push({
        x: Math.random() * canvas.width,
        y: canvas.height + 2,
        r: 0.8 + Math.random() * 1,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -(0.4 + Math.random() * 0.5),
        life: 1,
        decay: 0.001 + Math.random() * 0.002,
        hue: 25 + Math.random() * 20
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = embers.length - 1; i >= 0; i--) {
        var e = embers[i];
        e.x += e.vx + Math.sin(e.y * 0.02) * 0.15;
        e.y += e.vy;
        e.life -= e.decay;
        if (e.life <= 0) { embers.splice(i, 1); continue; }
        ctx.globalAlpha = e.life * 0.3;
        ctx.fillStyle = 'hsl(' + e.hue + ', 80%, 50%)';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (0.4 + e.life * 0.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = e.life * 0.07;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (Math.random() < 0.1) spawn();
      raf = requestAnimationFrame(draw);
    }
    draw();

    var forgeOverlay = document.getElementById('bs-forge-screen');
    var obs = new MutationObserver(function() {
      if (forgeOverlay && forgeOverlay.classList.contains('bs-overlay--hidden')) {
        cancelAnimationFrame(raf);
        obs.disconnect();
      }
    });
    if (forgeOverlay) obs.observe(forgeOverlay, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', resize);
  })();

  const remainingEl = document.getElementById('bs-forge-remaining');
  const totalEl = document.getElementById('bs-forge-total');
  const applyBtn = document.getElementById('bs-forge-apply');

  // Card picker — switch cards within the forge
  if (showPicker) {
    var forgeSwitchCard = function(direction) {
      var deck = _cb.getDeck();
      if (deck.length <= 1) return;
      var curIdx = _cb.getSelectedCardIndex();
      var nextIdx = direction === 'next'
        ? (curIdx + 1) % deck.length
        : (curIdx - 1 + deck.length) % deck.length;
      var nextCard = deck[nextIdx];
      if (!nextCard) return;
      if (_cb.setSelectedCard) _cb.setSelectedCard(nextCard);
      _selectedCard = nextCard;
      _cb.ensureCombatStats(_selectedCard);
      _cb.syncProgressToServer();
      // Re-render the entire forge with new card
      openForgeScreen(isFirstUnlock, true);
    };
    document.getElementById('bs-forge-card-prev')?.addEventListener('click', function() { forgeSwitchCard('prev'); });
    document.getElementById('bs-forge-card-next')?.addEventListener('click', function() { forgeSwitchCard('next'); });
  }

  let _hasVisualChange = false;
  const previewPowerEl = panel.querySelector('.bs-rc__power');
  const previewNameEl = panel.querySelector('.bs-rc__name');

  function getPool() {
    return _respecActive ? Math.min(totalBefore + bonusPoints, FORGE_POWER_CAP) : bonusPoints;
  }

  function updateBudget() {
    const totalAllocated = Object.values(allocations).reduce((a, b) => a + b, 0);
    const pool = getPool();
    const remaining = pool - totalAllocated;
    if (remainingEl) remainingEl.textContent = remaining;
    const newTotal = _respecActive ? totalAllocated : totalBefore + totalAllocated;
    if (totalEl) totalEl.textContent = newTotal;
    if (previewPowerEl) previewPowerEl.innerHTML = `<i class="fas fa-bolt"></i> ${newTotal}`;
    // Update stat bars in rendered card preview (nth-child matches RC_STAT_DEFS order)
    var statEls = panel.querySelectorAll('.bs-rendered-card .bs-rc-stat');
    RC_STAT_DEFS.forEach(function(d, i) {
      if (!statEls[i]) return;
      var sl = panel.querySelector('.bs-forge-stat__slider[data-stat="' + d.key + '"]');
      var val = sl ? parseInt(sl.value, 10) : (currentStats[d.key] || 0);
      var fill = statEls[i].querySelector('.bs-rc-stat__fill');
      if (fill) fill.style.width = val + '%';
      var valEl = statEls[i].querySelector('.bs-rc-stat__val');
      if (valEl) valEl.textContent = val;
    });
    // Enable forge if all points spent OR if any visual/detail change was made
    if (applyBtn) applyBtn.disabled = !(remaining === 0 || _hasVisualChange);
  }

  function activateRespec() {
    _respecActive = true;
    // Deduct forge wins for respec cost
    _cb.setForgeWins(_cb.getForgeWins() - respecCost);
    // Reset all allocations and sliders to 0
    statDefs.forEach(d => {
      allocations[d.key] = 0;
      const slider = panel.querySelector(`.bs-forge-stat__slider[data-stat="${d.key}"]`);
      if (slider) { slider.min = 0; slider.value = 0; }
      const display = panel.querySelector(`.bs-forge-stat__value[data-stat="${d.key}"]`);
      if (display) { display.textContent = '0'; display.style.color = 'var(--bs-accent)'; }
      const base = slider?.parentElement?.querySelector('.bs-forge-stat__base');
      if (base) { base.textContent = '0'; }
    });
    // Update respec button to show active state
    const respecBtn = document.getElementById('bs-forge-respec');
    if (respecBtn) {
      respecBtn.innerHTML = '<i class="fas fa-rotate"></i> Respec ON';
      respecBtn.disabled = true;
      respecBtn.style.background = 'var(--bs-accent)';
      respecBtn.style.color = 'var(--bs-bg)';
    }
    updateBudget();
    _cb.showSuccessToast(`Respec active! Redistribute ${Math.min(totalBefore + bonusPoints, FORGE_POWER_CAP)} points.`);
  }

  panel.querySelectorAll('.bs-forge-stat__slider').forEach(slider => {
    slider.addEventListener('input', () => {
      const key = slider.dataset.stat;
      const base = _respecActive ? 0 : currentStats[key];
      const desiredAllocation = parseInt(slider.value, 10) - base;
      const totalOther = Object.entries(allocations).reduce((sum, [k, v]) => k === key ? sum : sum + v, 0);
      const pool = getPool();
      const maxAllocation = pool - totalOther;
      const clamped = Math.min(Math.max(0, desiredAllocation), maxAllocation);
      const clampedVal = base + clamped;

      allocations[key] = clamped;
      slider.value = clampedVal;

      const display = panel.querySelector(`.bs-forge-stat__value[data-stat="${key}"]`);
      if (display) {
        display.textContent = clampedVal;
        display.style.color = clamped > 0 ? 'var(--bs-accent)' : 'var(--bs-text)';
      }
      updateBudget();
      updateForgeTeaser();
    });
  });

  function updateForgeTeaser() {
    var teaserEl = document.getElementById('bs-forge-teaser');
    if (!teaserEl) return;
    // Build projected stats from sliders
    var projected = {};
    statDefs.forEach(function(d) {
      var sl = panel.querySelector('.bs-forge-stat__slider[data-stat="' + d.key + '"]');
      projected[d.key] = sl ? parseInt(sl.value, 10) : (currentStats[d.key] || 0);
    });
    var nextP = _cb.getNextPassive(projected);
    if (nextP) {
      teaserEl.innerHTML = '<i class="fas ' + nextP.icon + '" style="color:' + (WEAKNESS_COLORS[nextP.stat] || 'var(--bs-accent)') + ';"></i> '
        + nextP.gap + ' more ' + (WEAKNESS_LABELS[nextP.stat] || nextP.stat) + ' → <strong>' + nextP.name + '</strong> <span style="color:var(--bs-text-muted);">(' + nextP.desc + ')</span>';
      teaserEl.style.display = '';
    } else {
      teaserEl.innerHTML = '<i class="fas fa-check-circle" style="color:var(--bs-accent);"></i> All passives unlocked!';
      teaserEl.style.display = '';
    }
  }
  updateForgeTeaser();

  document.getElementById('bs-forge-cancel')?.addEventListener('click', () => {
    hideOverlay('bs-forge-screen');
  });

  // Respec button
  document.getElementById('bs-forge-respec')?.addEventListener('click', () => {
    if (_respecActive) return;
    if (!confirm(`Respec costs ${respecCost} forge wins. Reset all stats and redistribute?`)) return;
    activateRespec();
  });

  // Tab switching — active class controls display, flex stretches to fill editor
  panel.querySelectorAll('.bs-forge-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.bs-forge-tab').forEach(t => t.classList.remove('bs-forge-tab--active'));
      tab.classList.add('bs-forge-tab--active');
      panel.querySelectorAll('.bs-forge-tab-content').forEach(c => c.classList.remove('bs-forge-tab-content--active'));
      const target = document.getElementById('bs-forge-tab-' + tab.dataset.tab);
      if (target) target.classList.add('bs-forge-tab-content--active');
    });
  });

  // Flash preview card after visual change (sticky keeps it visible on mobile)
  function flashPreview() {
    const previewCard = panel.querySelector('.bs-rendered-card');
    if (!previewCard) return;
    previewCard.style.transition = 'box-shadow 0.3s ease';
    previewCard.style.boxShadow = '0 0 20px var(--bs-accent)';
    setTimeout(() => { previewCard.style.boxShadow = ''; }, 800);
  }

  // Look tab: palette selection
  panel.querySelectorAll('.bs-forge-palette-swatch[data-palette]').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.bs-forge-palette-swatch[data-palette]').forEach(b => b.classList.remove('bs-forge-palette-swatch--selected'));
      btn.classList.add('bs-forge-palette-swatch--selected');
      const previewCard = panel.querySelector('.bs-rendered-card');
      if (previewCard) previewCard.setAttribute('data-palette', btn.dataset.palette);
      _hasVisualChange = true;
      updateBudget();
      flashPreview();
    });
  });

  // Look tab: container selection
  panel.querySelectorAll('.bs-forge-container-card[data-container]').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.bs-forge-container-card[data-container]').forEach(b => b.classList.remove('bs-forge-container-card--selected'));
      btn.classList.add('bs-forge-container-card--selected');
      const previewCard = panel.querySelector('.bs-rendered-card');
      if (previewCard) previewCard.setAttribute('data-container', btn.dataset.container);
      _hasVisualChange = true;
      updateBudget();
      flashPreview();
    });
  });

  // Buy buttons — spend Sparks to unlock palettes/containers
  panel.querySelectorAll('[data-buy-palette], [data-buy-container]').forEach(btn => {
    btn.addEventListener('click', () => {
      var cost = parseInt(btn.dataset.buyCost, 10);
      var key = btn.dataset.buyKey;
      var paletteId = btn.dataset.buyPalette;
      var containerId = btn.dataset.buyContainer;
      if (_cb.getSparks() < cost) {
        btn.style.animation = 'bs-shake 0.3s ease';
        setTimeout(() => { btn.style.animation = ''; }, 300);
        return;
      }
      if (!confirm('Spend ' + cost + ' Sparks on this?')) return;
      _cb.spendSparks(cost);
      _cb.addPurchasedCosmetic(key);
      // Update sparks display
      var sparksEl = document.getElementById('bs-forge-sparks');
      if (sparksEl) sparksEl.textContent = _cb.getSparks();
      // Replace buy button with selectable button
      if (paletteId) {
        var pDef = PALETTES.find(p => p.id === paletteId);
        btn.className = 'bs-forge-palette-swatch';
        btn.innerHTML = '<span class="bs-forge-palette-swatch__preview" data-pal="' + paletteId + '"></span><span class="bs-forge-palette-swatch__name">' + (pDef?.label || paletteId) + '</span>';
        btn.removeAttribute('data-buy-palette');
        btn.removeAttribute('data-buy-key');
        btn.removeAttribute('data-buy-cost');
        btn.setAttribute('data-palette', paletteId);
        btn.disabled = false;
        btn.addEventListener('click', () => {
          panel.querySelectorAll('.bs-forge-palette-swatch[data-palette]').forEach(b => b.classList.remove('bs-forge-palette-swatch--selected'));
          btn.classList.add('bs-forge-palette-swatch--selected');
          var previewCard = panel.querySelector('.bs-rendered-card');
          if (previewCard) previewCard.setAttribute('data-palette', paletteId);
          _hasVisualChange = true;
          updateBudget();
          flashPreview();
        });
      }
      if (containerId) {
        var cDef = CONTAINERS.find(c => c.id === containerId);
        btn.className = 'bs-forge-container-card';
        btn.innerHTML = '<i class="fas ' + (cDef?.icon || 'fa-square') + '"></i><span>' + (cDef?.label || containerId) + '</span>';
        btn.removeAttribute('data-buy-container');
        btn.removeAttribute('data-buy-key');
        btn.removeAttribute('data-buy-cost');
        btn.setAttribute('data-container', containerId);
        btn.disabled = false;
        btn.addEventListener('click', () => {
          panel.querySelectorAll('.bs-forge-container-card[data-container]').forEach(b => b.classList.remove('bs-forge-container-card--selected'));
          btn.classList.add('bs-forge-container-card--selected');
          var previewCard = panel.querySelector('.bs-rendered-card');
          if (previewCard) previewCard.setAttribute('data-container', containerId);
          _hasVisualChange = true;
          updateBudget();
          flashPreview();
        });
      }
      _cb.playSfx('forgeComplete');
      flashPreview();
    });
  });

  // Details tab: any input change enables forge + updates preview
  ['bs-forge-name', 'bs-forge-quote', 'bs-forge-avatar'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', () => {
      _hasVisualChange = true;
      updateBudget();
      // Live update preview name
      if (id === 'bs-forge-name' && previewNameEl) {
        previewNameEl.textContent = input.value || 'Your Card';
      }
      // Live update preview avatar
      if (id === 'bs-forge-avatar') {
        const previewImg = panel.querySelector('.bs-rc__avatar');
        if (previewImg && input.value.trim()) previewImg.src = input.value.trim();
      }
    });
  });

  // Avatar sub-tabs (Gallery / AI / URL)
  panel.querySelectorAll('.bs-forge-avt-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.bs-forge-avt-tab').forEach(t => { t.classList.remove('bs-forge-avt-tab--active'); t.style.color = 'var(--bs-text-muted)'; });
      tab.classList.add('bs-forge-avt-tab--active');
      tab.style.color = 'var(--bs-text)';
      panel.querySelectorAll('.bs-forge-avt-content').forEach(c => c.style.display = 'none');
      var target = document.getElementById('bs-forge-avt-' + tab.dataset.avtTab);
      if (target) target.style.display = '';
    });
  });

  // Avatar gallery — load player's CardForge cards dynamically
  function bindAvatarPicks() {
    panel.querySelectorAll('.bs-forge-avatar-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.bs-forge-avatar-pick').forEach(b => b.style.borderColor = 'var(--bs-border)');
        btn.style.borderColor = 'var(--bs-accent)';
        var src = btn.dataset.avatarSrc;
        var urlInput = document.getElementById('bs-forge-avatar');
        if (urlInput) urlInput.value = src;
        var previewImg = panel.querySelector('.bs-rc__avatar');
        var previewPlaceholder = panel.querySelector('.bs-rc__avatar-placeholder');
        if (previewImg) { previewImg.src = src; }
        else if (previewPlaceholder) { previewPlaceholder.outerHTML = '<img src="' + escHtml(src) + '" alt="Avatar" class="bs-rc__avatar" loading="lazy">'; }
        _hasVisualChange = true;
        updateBudget();
        flashPreview();
      });
    });
  }

  // Load gallery from player's CardForge cards + demo defaults
  (async function loadAvatarGallery() {
    var grid = document.getElementById('bs-forge-avatar-grid');
    if (!grid) return;
    var avatars = [];
    // Load player's own cards
    try {
      var data = await window.ArenaAPI.loadCards();
      var cards = data.userCards || [];
      cards.forEach(function(c) {
        var av = c.avatar || (c.cardData && c.cardData.cardContent && c.cardData.cardContent.frontFace && c.cardData.cardContent.frontFace.characterImage && c.cardData.cardContent.frontFace.characterImage.url) || '';
        if (av && !avatars.find(function(a) { return a.src === av; })) {
          avatars.push({ src: av, label: c.name || 'Card' });
        }
      });
    } catch(e) { /* no cards available */ }
    // Show full CardForge character image library as extra options
    [
      { src: '/blindspot/img/demo/demo-knight.webp', label: 'Knight' },
      { src: '/blindspot/img/demo/demo-mage.webp', label: 'Mage' },
      { src: '/blindspot/img/demo/demo-rogue.webp', label: 'Rogue' },
      { src: '/images/image-packs/characters/navigator-kairo.jpg', label: 'Navigator Kairo' },
      { src: '/images/image-packs/characters/eyes-of-the-storm.jpg', label: 'Eyes of the Storm' },
      { src: '/images/image-packs/characters/regal-radiance.jpg', label: 'Regal Radiance' },
      { src: '/images/image-packs/characters/autumnus-majestus.jpg', label: 'Autumnus Majestus' },
      { src: '/images/image-packs/characters/carved-celestial-goddess.jpg', label: 'Celestial Goddess' },
      { src: '/images/image-packs/characters/celestial-neptune.jpg', label: 'Celestial Neptune' },
      { src: '/images/image-packs/characters/cyber-erenity.jpg', label: 'Cyber Erenity' },
      { src: '/images/image-packs/characters/ember-gaze.jpg', label: 'Ember Gaze' },
      { src: '/images/image-packs/characters/ethereal-enigma.jpg', label: 'Ethereal Enigma' },
      { src: '/images/image-packs/characters/guardian-of-the-gilded-halls.jpg', label: 'Guardian of the Gilded Halls' },
      { src: '/images/image-packs/characters/iron-lady.jpg', label: 'Iron Lady' },
      { src: '/images/image-packs/characters/seraphic-sovereign.jpg', label: 'Seraphic Sovereign' },
      { src: '/images/image-packs/characters/seraphina.jpg', label: 'Seraphina' },
      { src: '/images/image-packs/characters/sunset-synthesis.jpg', label: 'Sunset Synthesis' },
      { src: '/images/image-packs/characters/surreal-up-close.jpg', label: 'Surreal Up Close' },
      { src: '/images/image-packs/characters/tangerine-tempest.jpg', label: 'Tangerine Tempest' },
      { src: '/images/image-packs/characters/the-enigmatic-neuromancer.jpg', label: 'The Enigmatic Neuromancer' },
      { src: '/images/image-packs/characters/twilight-titan.jpg', label: 'Twilight Titan' },
      { src: '/images/image-packs/characters/whispers-of-the-sylvan-queen.jpg', label: 'Whispers of the Sylvan Queen' },
      { src: '/images/image-packs/characters/hero.png', label: 'Hero' },
      { src: '/images/image-packs/characters/hero1.png', label: 'Hero Alt' },
      { src: '/images/image-packs/characters/hero03.jpg', label: 'Hero III' }
    ].forEach(function(a) { if (!avatars.find(function(x) { return x.src === a.src; })) avatars.push(a); });
    if (avatars.length === 0) {
      grid.innerHTML = '<div style="text-align:center; color:var(--bs-text-muted); font-size:0.7rem; padding:1rem;">No cards yet. Use AI Generate or paste a URL.</div>';
      return;
    }
    // Paginated gallery — 8 per page
    var PAGE_SIZE = 8;
    var _galleryPage = 0;
    var totalPages = Math.ceil(avatars.length / PAGE_SIZE);
    function renderGalleryPage() {
      var start = _galleryPage * PAGE_SIZE;
      var page = avatars.slice(start, start + PAGE_SIZE);
      var html = '<div style="display:grid; grid-template-columns:repeat(4, 1fr); grid-template-rows:1fr 1fr; gap:0.4rem;">';
      html += page.map(function(a) {
        return '<button class="bs-forge-avatar-pick" data-avatar-src="' + escHtml(a.src) + '" title="' + escHtml(a.label) + '" style="width:100%; aspect-ratio:1; border:2px solid var(--bs-border); border-radius:8px; overflow:hidden; background:var(--bs-surface); cursor:pointer; padding:0;"><img src="' + escHtml(a.src) + '" alt="' + escHtml(a.label) + '" style="width:100%; height:100%; object-fit:cover;" loading="lazy"></button>';
      }).join('');
      html += '</div>';
      if (totalPages > 1) {
        html += '<div style="display:flex; align-items:center; justify-content:center; gap:0.75rem; margin-top:0.5rem;">';
        html += '<button class="bs-btn bs-btn--small" id="bs-avt-prev" style="padding:0.2rem 0.5rem; font-size:0.65rem;"' + (_galleryPage <= 0 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
        html += '<span style="font-size:0.65rem; color:var(--bs-text-muted);">' + (_galleryPage + 1) + ' / ' + totalPages + '</span>';
        html += '<button class="bs-btn bs-btn--small" id="bs-avt-next" style="padding:0.2rem 0.5rem; font-size:0.65rem;"' + (_galleryPage >= totalPages - 1 ? ' disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
        html += '</div>';
      }
      grid.innerHTML = html;
      bindAvatarPicks();
      var prevBtn = document.getElementById('bs-avt-prev');
      var nextBtn = document.getElementById('bs-avt-next');
      if (prevBtn) prevBtn.addEventListener('click', function() { if (_galleryPage > 0) { _galleryPage--; renderGalleryPage(); } });
      if (nextBtn) nextBtn.addEventListener('click', function() { if (_galleryPage < totalPages - 1) { _galleryPage++; renderGalleryPage(); } });
    }
    renderGalleryPage();
  })();

  // AI Generate
  var aiGenBtn = document.getElementById('bs-forge-ai-generate');
  if (aiGenBtn) aiGenBtn.addEventListener('click', async () => {
    var prompt = (document.getElementById('bs-forge-ai-prompt')?.value || '').trim();
    if (!prompt || prompt.length < 3) {
      document.getElementById('bs-forge-ai-status').textContent = 'Describe your character (min 3 chars)';
      return;
    }
    var style = document.getElementById('bs-forge-ai-style')?.value || 'ap-neon-glass';
    var statusEl = document.getElementById('bs-forge-ai-status');
    var resultEl = document.getElementById('bs-forge-ai-result');
    aiGenBtn.disabled = true;
    aiGenBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating your portrait with AI... (15-30s)';
    resultEl.innerHTML = '';

    try {
      var resp = await fetch('https://ambientpixels-nova-api.azurewebsites.net/api/content-quick-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher' },
        body: JSON.stringify({
          topic: 'RPG character portrait: ' + prompt,
          goal: 'Card game character avatar portrait, centered face/bust composition, dark atmospheric background',
          preset: style,
          outputs: ['square_image'],
          skipApproval: true,
          accountId: 'blindspot-forge'
        })
      });
      var text = await resp.text();
      var data;
      try { data = JSON.parse(text); } catch(e) { throw new Error('Server returned invalid response (status ' + resp.status + ')'); }
      // API returns { ok, outputs: { square_image: { imageUrl, thumbUrl } } }
      var imgUrl = null;
      if (data.ok && data.outputs) {
        var firstKey = Object.keys(data.outputs).find(function(k) { return data.outputs[k].status === 'success'; });
        if (firstKey) imgUrl = data.outputs[firstKey].imageUrl || data.outputs[firstKey].thumbUrl;
      }
      if (imgUrl) {
        if (imgUrl) {
          statusEl.innerHTML = '<i class="fas fa-check" style="color:var(--bs-accent);"></i> Portrait generated!';
          resultEl.innerHTML = '<img src="' + escHtml(imgUrl) + '" style="width:120px; height:120px; object-fit:cover; border-radius:8px; border:2px solid var(--bs-accent); margin-top:0.5rem; cursor:pointer;" id="bs-forge-ai-preview">';
          // Click to use
          document.getElementById('bs-forge-ai-preview')?.addEventListener('click', () => {
            var urlInput = document.getElementById('bs-forge-avatar');
            if (urlInput) urlInput.value = imgUrl;
            var previewImg = panel.querySelector('.bs-rc__avatar');
            var previewPlaceholder = panel.querySelector('.bs-rc__avatar-placeholder');
            if (previewImg) { previewImg.src = imgUrl; }
            else if (previewPlaceholder) { previewPlaceholder.outerHTML = '<img src="' + escHtml(imgUrl) + '" alt="AI Avatar" class="bs-rc__avatar" loading="lazy">'; }
            _hasVisualChange = true;
            updateBudget();
            flashPreview();
            statusEl.innerHTML = '<i class="fas fa-check" style="color:var(--bs-accent);"></i> Applied! Click Forge to save.';
          });
          statusEl.innerHTML += ' <span style="color:var(--bs-text-muted); font-size:0.65rem;">Click image to use it.</span>';
        } else {
          statusEl.textContent = 'Generated but no image URL returned. Try again.';
        }
      } else {
        statusEl.textContent = data.error || 'Generation failed. Try again.';
      }
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err.message || 'Network error');
    }
    aiGenBtn.disabled = false;
    aiGenBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate';
  });

  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<i class="fas fa-fire" style="animation: bs-spin 0.8s linear infinite;"></i> Forging...';

    const newStats = {};
    statDefs.forEach(d => { newStats[d.key] = (_respecActive ? 0 : currentStats[d.key]) + allocations[d.key]; });

    // Forging animation
    panel.style.transition = 'box-shadow 0.5s ease';
    panel.style.boxShadow = '0 0 60px rgba(239, 159, 39, 0.5)';
    await new Promise(r => setTimeout(r, 1000));
    panel.style.boxShadow = '';

    _selectedCard.combatStats = newStats;

    // Apply visual selections from Look tab
    const selectedPalette = panel.querySelector('.bs-forge-option--selected[data-palette]');
    const selectedContainer = panel.querySelector('.bs-forge-option--selected[data-container]');
    if (selectedPalette) _selectedCard.palette = selectedPalette.dataset.palette;
    if (selectedContainer) _selectedCard.imageContainer = selectedContainer.dataset.container;

    // Apply details from Details tab
    const nameInput = document.getElementById('bs-forge-name');
    const quoteInput = document.getElementById('bs-forge-quote');
    const avatarInput = document.getElementById('bs-forge-avatar');
    if (nameInput && nameInput.value.trim()) _selectedCard.name = nameInput.value.trim();
    if (quoteInput) _selectedCard.quote = quoteInput.value.trim();
    if (avatarInput && avatarInput.value.trim()) _selectedCard.avatar = avatarInput.value.trim();

    // Save via API
    try {
      const cardToSave = { ..._selectedCard, combatStats: newStats };
      if (selectedPalette) cardToSave.palette = selectedPalette.dataset.palette;
      if (selectedContainer) cardToSave.imageContainer = selectedContainer.dataset.container;
      // Include details tab changes
      if (nameInput && nameInput.value.trim()) cardToSave.name = nameInput.value.trim();
      if (quoteInput) cardToSave.quote = quoteInput.value.trim();
      if (avatarInput && avatarInput.value.trim()) cardToSave.avatar = avatarInput.value.trim();
      cardToSave.stats = [
        { name: 'Strength', value: newStats.str },
        { name: 'Agility', value: newStats.agi },
        { name: 'Intelligence', value: newStats.int },
        { name: 'Endurance', value: newStats.end },
        { name: 'Luck', value: newStats.lck }
      ];

      const url = window.buildApiPath('saveCard');
      const headers = { 'Content-Type': 'application/json' };
      const authHeaders = await window.ArenaAPI.getPrincipalHeader();
      Object.assign(headers, authHeaders);
      // Add CSRF token if available
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta && csrfMeta.content) headers['X-CSRF-Token'] = csrfMeta.content;
      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(cardToSave) });
      if (!resp.ok) throw new Error('Save failed: ' + resp.status);

      // Mark forge as permanently unlocked (no more win-gating)
      _cb.setForgeUnlocked();
      localStorage.removeItem('bs-forge-pending');
      var prevRarity = _cb.getCardRarity();
      _cb.incForgeVisitCount();
      var newRarity = _cb.getCardRarity();
      // Update deck cache with forged card data
      _cb.updateCardInDeck(_selectedCard);
      hideOverlay('bs-forge-screen');
      _cb.updateForgeProgress();
      _cb.showScreen('lobby');
      _cb.renderLobby();
      _cb.completeBounty('forgeVisit');
      _cb.syncProgressToServer();
      _cb.playSfx('forgeComplete');
      // Rarity upgrade check
      if (newRarity.id !== prevRarity.id) {
        if (newRarity.title) _cb.setCardTitle(newRarity.title);
        _cb.showSuccessToast('Rarity up! Your card is now ' + newRarity.name + '!');
      } else {
        _cb.showSuccessToast(_respecActive ? 'Card respecced!' : 'Card evolved!');
      }
    } catch (e) {
      console.warn('[Blindspot] Forge save error:', e);
      hideOverlay('bs-forge-screen');
      _cb.showErrorToast('Failed to save evolution. Try again.');
    }
  });
}

  // ── Public API ──
  window.BsForge = {
    open: openForgeScreen,
    setCallbacks: setCallbacks
  };
})();

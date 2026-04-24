/* forge-stage.js — center-stage header + footer + per-stage content dispatch.
 * Per redesign-handoff.md §6.3 + Phase 4 Tasks 4.2 (per-stage swap) and 4.3 (identity).
 *
 * Subscribes to window.ForgeState. Wires FORGE → NEXT + stage footer buttons.
 * For stage 'identity', swaps the card slot with a portrait-picker form (Task 4.3).
 * For all other stages, shows either the real card render (once Phase 5 ships
 * ForgeRender) or a phase-appropriate placeholder.
 */

(function () {
  'use strict';

  var STAGE_ORDER = ['identity', 'card-design', 'vitals', 'overlays', 'lore', 'preview', 'mint'];

  var STAGE_TITLES = {
    'identity':    'Identity',
    'card-design': 'Card Design',
    'vitals':      'Vitals',
    'overlays':    'Overlays',
    'lore':        'Lore',
    'preview':     'Preview',
    'mint':        'Mint'
  };

  var RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];

  var AI_SUGGEST_KEY = 'cardforge.forge.ai-suggest.count';
  var AI_SUGGEST_LIMIT = 3;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getAiCount() {
    try { return Number(sessionStorage.getItem(AI_SUGGEST_KEY) || 0); } catch (e) { return 0; }
  }

  function incAiCount() {
    try { sessionStorage.setItem(AI_SUGGEST_KEY, String(getAiCount() + 1)); } catch (e) {}
  }

  // ---------------------------------------------------------------
  // Header + Footer
  // ---------------------------------------------------------------
  function renderHeader(root, state) {
    if (!root) return;
    var idx = STAGE_ORDER.indexOf(state.activeStage);
    if (idx < 0) idx = 0;
    var num = String(idx + 1).padStart(2, '0');
    var total = String(STAGE_ORDER.length).padStart(2, '0');
    var title = STAGE_TITLES[state.activeStage] || 'Card Design';

    root.innerHTML = '' +
      '<div class="forge-stage-header-left">' +
        '<div class="forge-stage-crumb">◈ STAGE ' + num + ' / ' + total + '</div>' +
        '<h2 class="forge-stage-title">' + escapeHtml(title) + '</h2>' +
      '</div>' +
      '<div class="forge-stage-header-right">' +
        '<button class="forge-stage-iconbtn" type="button" aria-label="Undo" data-action="undo">' +
          '<i class="fa-solid fa-arrow-rotate-left"></i>' +
        '</button>' +
        '<button class="forge-stage-iconbtn" type="button" aria-label="Redo" data-action="redo">' +
          '<i class="fa-solid fa-arrow-rotate-right"></i>' +
        '</button>' +
        '<button class="forge-stage-iconbtn is-active" type="button" aria-label="Fullscreen" data-action="fullscreen">' +
          '<i class="fa-solid fa-expand"></i>' +
        '</button>' +
      '</div>';
  }

  function renderFooter(root, state) {
    if (!root) return;
    var styleId = state.styleId || 'ember';
    var idx = STAGE_ORDER.indexOf(state.activeStage);
    var atTerminal = idx === STAGE_ORDER.length - 1;

    root.innerHTML = '' +
      '<button class="forge-stage-roundbtn" type="button" aria-label="Previous stage" data-action="prev"' + (idx <= 0 ? ' disabled' : '') + '>' +
        '<i class="fa-solid fa-arrow-left"></i>' +
      '</button>' +
      '<button class="forge-stage-roundbtn" type="button" aria-label="Shuffle" data-action="shuffle">' +
        '<i class="fa-solid fa-shuffle"></i>' +
      '</button>' +
      '<button class="forge-stage-roundbtn forge-stage-roundbtn--ember" type="button" aria-label="Forge — next stage" data-action="next"' + (atTerminal ? ' disabled' : '') + '>' +
        '<i class="fa-solid fa-hammer"></i>' +
      '</button>' +
      '<button class="forge-stage-roundbtn" type="button" aria-label="Share" data-action="share">' +
        '<i class="fa-solid fa-share-nodes"></i>' +
      '</button>' +
      '<span class="forge-stage-caption">style: ' + escapeHtml(styleId) + ' · ready</span>';
  }

  // ---------------------------------------------------------------
  // Per-stage center content
  // ---------------------------------------------------------------
  function renderIdentityStage(root, state) {
    var chars = (window.ForgePortrait && window.ForgePortrait.CHARACTERS) || [];
    var aiCount = getAiCount();
    var aiRemaining = Math.max(0, AI_SUGGEST_LIMIT - aiCount);
    var aiDisabled = aiRemaining <= 0;

    var rarityChips = RARITIES.map(function (r) {
      var sel = state.rarity === r;
      return '<button class="forge-rarity-chip' + (sel ? ' is-selected' : '') + '" ' +
             'type="button" data-rarity="' + r + '">' + r + '</button>';
    }).join('');

    var portraitTiles = chars.map(function (c) {
      var sel = state.portraitId === c.id;
      var portrait = window.ForgePortrait ? window.ForgePortrait.buildHtml(c) : '';
      return '<button class="forge-portrait-tile' + (sel ? ' is-selected' : '') + '" ' +
             'type="button" data-portrait-id="' + c.id + '" ' +
             'title="' + escapeHtml(c.name + ' — ' + c.class) + '">' +
               '<div class="forge-portrait-tile-svg">' + portrait + '</div>' +
               '<div class="forge-portrait-tile-label">' + escapeHtml(c.name.split(' ')[0]) + '</div>' +
             '</button>';
    }).join('');

    root.innerHTML = '' +
      '<div class="forge-identity-form">' +
        '<div class="forge-identity-header">' +
          '<input class="forge-identity-name" type="text" id="forge-stage-name" ' +
                 'placeholder="Name your hero..." value="' + escapeHtml(state.name || '') + '" />' +
        '</div>' +

        '<div class="forge-identity-rarity">' +
          '<div class="forge-section-label">◈ RARITY</div>' +
          '<div class="forge-rarity-chips">' + rarityChips + '</div>' +
        '</div>' +

        '<div class="forge-identity-portraits">' +
          '<div class="forge-identity-portraits-head">' +
            '<div class="forge-section-label">◈ PORTRAIT</div>' +
            '<button class="forge-ai-suggest" type="button" data-action="ai-suggest"' + (aiDisabled ? ' disabled' : '') + '>' +
              '<i class="fa-solid fa-wand-magic-sparkles"></i>' +
              '<span>AI SUGGEST</span>' +
              '<span class="forge-ai-suggest-count">' + aiRemaining + '/' + AI_SUGGEST_LIMIT + ' free</span>' +
            '</button>' +
          '</div>' +
          '<div class="forge-portrait-grid">' + portraitTiles + '</div>' +
        '</div>' +
      '</div>';
  }

  function renderCardStage(root, state) {
    // Phase 5 live: dispatch to ForgeRender — picks the style module,
    // preserves the portrait SVG across swaps via the dispatcher's cache.
    if (window.ForgeRender && typeof window.ForgeRender.update === 'function') {
      window.ForgeRender.update(root, state, 'md');
      return;
    }
    // Fallback if render module didn't load (e.g. network error on CDN fonts)
    root.innerHTML = '' +
      '<div class="forge-stage-card-placeholder">' +
        '<div style="font-weight: 700; color: var(--forge-ember); margin-bottom: 6px;">CARD PREVIEW</div>' +
        '<div>ForgeRender module not loaded</div>' +
      '</div>';
  }

  function renderMintStage(root, state) {
    // Card + mint panel (hash, share URL if minted, export buttons, mint/start-over)
    var minted = !!state.shareId;
    var hashDisplay = state.hash || '------------';
    var shareUrl = state.shareUrl || '';
    var shareShort = shareUrl ? shareUrl.replace(window.location.origin, '') : '';

    var statusRows = '<div class="forge-mint-status-row">' +
        '<span class="forge-mint-status-key">hash</span>' +
        '<span class="forge-mint-status-val">' + escapeHtml(hashDisplay) + '</span>' +
      '</div>';

    if (minted) {
      statusRows +=
        '<div class="forge-mint-status-row">' +
          '<span class="forge-mint-status-key">share</span>' +
          '<span class="forge-mint-status-val forge-mint-share-url" title="' + escapeHtml(shareUrl) + '">' + escapeHtml(shareShort) + '</span>' +
          '<button class="forge-mint-copy-btn" type="button" data-action="copy-share" aria-label="Copy share URL">' +
            '<i class="fa-solid fa-copy"></i>' +
          '</button>' +
        '</div>';
      if (state.localOnly) {
        statusRows +=
          '<div class="forge-mint-status-row forge-mint-status-note">' +
            '<span class="forge-mint-status-key">note</span>' +
            '<span class="forge-mint-status-val">local only (publish API unreachable)</span>' +
          '</div>';
      }
    }

    var mainBtn = minted
      ? '<button class="forge-mint-main-btn forge-mint-main-btn--success" type="button" data-action="start-over">' +
          '<i class="fa-solid fa-rotate-right"></i> START ANOTHER' +
        '</button>'
      : '<button class="forge-mint-main-btn" type="button" data-action="mint" id="forge-mint-main">' +
          '⚒ MINT THIS CARD' +
        '</button>';

    root.innerHTML = '' +
      '<div class="forge-mint-stage">' +
        '<div class="forge-mint-card" id="forge-mint-card-wrap"></div>' +
        '<div class="forge-mint-panel">' +
          '<div class="forge-section-label">◈ MINT STATUS</div>' +
          '<div class="forge-mint-status">' + statusRows + '</div>' +
          '<div class="forge-mint-exports">' +
            '<button class="forge-mint-export-btn" type="button" data-action="export-png"' + (minted ? '' : ' disabled') + '>' +
              '<i class="fa-solid fa-download"></i> PNG' +
            '</button>' +
            '<button class="forge-mint-export-btn" type="button" data-action="export-svg"' + (minted ? '' : ' disabled') + '>' +
              '<i class="fa-solid fa-download"></i> SVG' +
            '</button>' +
            '<button class="forge-mint-export-btn" type="button" data-action="export-json">' +
              '<i class="fa-solid fa-download"></i> JSON' +
            '</button>' +
          '</div>' +
          mainBtn +
        '</div>' +
      '</div>';

    // Render the card inside the mint card wrap via ForgeRender
    var cardWrap = root.querySelector('#forge-mint-card-wrap');
    if (cardWrap && window.ForgeRender && typeof window.ForgeRender.update === 'function') {
      window.ForgeRender.update(cardWrap, state, 'md');
    }
  }

  function renderStageContent(root, state) {
    if (!root) return;
    var floor = root.closest('.forge-stage-floor');
    var glow = floor ? floor.querySelector('.forge-stage-glow') : null;

    if (state.activeStage === 'identity') {
      // Identity stage takes over the whole floor — hide the glow.
      if (glow) glow.style.display = 'none';
      renderIdentityStage(root, state);
      return;
    }

    if (state.activeStage === 'mint') {
      // Mint stage has its own layout with card + panel. Keep the glow visible.
      if (glow) glow.style.display = '';
      renderMintStage(root, state);
      return;
    }

    // All other stages: card preview via ForgeRender
    if (glow) glow.style.display = '';
    renderCardStage(root, state);
  }

  // ---------------------------------------------------------------
  // Wire footer + identity form
  // ---------------------------------------------------------------
  async function handleMintAction() {
    var btn = document.getElementById('forge-mint-main');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> MINTING...'; }
    try {
      if (!window.ForgeShare || typeof window.ForgeShare.publishAndShare !== 'function') {
        throw new Error('ForgeShare module not loaded');
      }
      var state = window.ForgeState.get();
      var result = await window.ForgeShare.publishAndShare(state);
      // Commit result to state — subscribe fires, UI re-renders with mint success view
      window.ForgeState.set({
        hash: result.hash,
        shareId: result.shareId,
        shareUrl: result.shareUrl,
        localOnly: !!result.localOnly,
        mintedAt: Date.now()
      });
    } catch (e) {
      if (btn) { btn.disabled = false; btn.innerHTML = '⚒ MINT THIS CARD'; }
      var panel = document.querySelector('.forge-mint-panel');
      if (panel && !panel.querySelector('.forge-mint-error')) {
        var err = document.createElement('div');
        err.className = 'forge-mint-error';
        err.textContent = 'Mint failed: ' + (e && e.message || 'unknown error');
        panel.appendChild(err);
      }
    }
  }

  function handleCopyShare() {
    var url = window.ForgeState.get().shareUrl;
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        var btn = document.querySelector('.forge-mint-copy-btn');
        if (btn) {
          var prev = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-check"></i>';
          setTimeout(function () { btn.innerHTML = prev; }, 1500);
        }
      }).catch(function () { window.prompt('Copy this link:', url); });
    } else {
      window.prompt('Copy this link:', url);
    }
  }

  function getMintedCardEl() {
    var wrap = document.querySelector('#forge-mint-card-wrap .forge-card');
    return wrap || null;
  }

  async function handleExport(format) {
    if (!window.ForgeShare) return;
    var state = window.ForgeState.get();
    var name = state.name || 'forge-card';
    try {
      if (format === 'json') {
        window.ForgeShare.exportJSON(state, name);
      } else if (format === 'png') {
        var png = getMintedCardEl();
        if (png) await window.ForgeShare.exportPNG(png, name);
      } else if (format === 'svg') {
        var svg = getMintedCardEl();
        if (svg) await window.ForgeShare.exportSVG(svg, name);
      }
    } catch (e) {
      alert('Export failed: ' + (e && e.message || 'unknown'));
    }
  }

  function handleStartOver() {
    if (window.ForgeState && typeof window.ForgeState.reset === 'function') {
      window.ForgeState.reset();
      // Return to identity so user starts fresh
      if (window.ForgeStageFlow) window.ForgeStageFlow.goTo('identity');
    }
  }

  function handleStageAction(action) {
    if (!window.ForgeStageFlow) return;
    switch (action) {
      case 'next':        window.ForgeStageFlow.next(); return;
      case 'prev':        window.ForgeStageFlow.prev(); return;
      case 'mint':        handleMintAction(); return;
      case 'start-over':  handleStartOver(); return;
      case 'copy-share':  handleCopyShare(); return;
      case 'export-png':  handleExport('png'); return;
      case 'export-svg':  handleExport('svg'); return;
      case 'export-json': handleExport('json'); return;
      case 'shuffle':
      case 'undo':
      case 'redo':
      case 'share':
      case 'fullscreen':
        // Non-blocking no-ops — not wired to real behavior yet.
        return;
    }
  }

  function aiSuggest() {
    var count = getAiCount();
    var atStage = window.ForgeState.get().activeStage;

    if (count >= AI_SUGGEST_LIMIT) {
      if (window.ForgeTelemetry && typeof window.ForgeTelemetry.track === 'function') {
        window.ForgeTelemetry.track('ai.suggest', { atStage: atStage, blocked: 'limit' });
      }
      return;
    }

    if (window.ForgeTelemetry && typeof window.ForgeTelemetry.track === 'function') {
      window.ForgeTelemetry.track('ai.suggest', { atStage: atStage, count: count + 1 });
    }
    incAiCount();

    // Phase 4 stub: pick a random portrait + synthesize a name/class.
    // Phase 4 Task 4.3 upgrade: if window.CardForgeAI exists (Phase 0 Task 0.5
    // confirmed it's self-contained), call CardForgeAI.callGemini for a real
    // generation. Otherwise fall back to this deterministic random pick so the
    // button always does *something*.
    var chars = (window.ForgePortrait && window.ForgePortrait.CHARACTERS) || [];
    if (chars.length === 0) return;
    var pick = chars[Math.floor(Math.random() * chars.length)];
    var currentName = window.ForgeState.get().name;

    window.ForgeState.set({
      portraitId: pick.id,
      classLabel: pick.class,
      rarity: pick.rarity,
      name: currentName && currentName.trim() ? currentName : pick.name
    });
  }

  function wire(stageRoot) {
    if (!stageRoot) return;

    // Header + footer button clicks — delegate on stage root
    stageRoot.addEventListener('click', function (ev) {
      var actionBtn = ev.target.closest('[data-action]');
      if (actionBtn && actionBtn.dataset.action) {
        var action = actionBtn.dataset.action;
        if (action === 'ai-suggest') { aiSuggest(); return; }
        handleStageAction(action);
        return;
      }

      var rarityChip = ev.target.closest('.forge-rarity-chip');
      if (rarityChip && rarityChip.dataset.rarity) {
        window.ForgeState.set({ rarity: rarityChip.dataset.rarity });
        return;
      }

      var portraitTile = ev.target.closest('.forge-portrait-tile');
      if (portraitTile && portraitTile.dataset.portraitId) {
        var c = window.ForgePortrait ? window.ForgePortrait.get(portraitTile.dataset.portraitId) : null;
        if (c) {
          window.ForgeState.set({
            portraitId: c.id,
            classLabel: c.class,
            rarity: c.rarity
          });
        }
        return;
      }
    });

    // Name input — live sync to state
    stageRoot.addEventListener('input', function (ev) {
      if (ev.target && ev.target.id === 'forge-stage-name') {
        window.ForgeState.set({ name: ev.target.value });
      }
    });
  }

  function render(stageRoot, state) {
    if (!stageRoot) return;
    renderHeader(stageRoot.querySelector('.forge-stage-header'), state);
    renderFooter(stageRoot.querySelector('.forge-stage-footer'), state);
    renderStageContent(stageRoot.querySelector('#forge-stage-card'), state);
  }

  window.ForgeStage = {
    STAGE_ORDER: STAGE_ORDER,
    STAGE_TITLES: STAGE_TITLES,
    RARITIES: RARITIES,
    render: render,
    aiSuggest: aiSuggest
  };

  document.addEventListener('DOMContentLoaded', function () {
    var stageRoot = document.getElementById('forge-stage');
    if (!stageRoot || !window.ForgeState) return;
    render(stageRoot, window.ForgeState.get());
    wire(stageRoot);
    window.ForgeState.subscribe(function (state) {
      var active = document.activeElement;
      var isNameFocused = active && active.id === 'forge-stage-name';
      var caret = isNameFocused ? active.selectionStart : null;
      render(stageRoot, state);
      if (isNameFocused) {
        var nameEl = document.getElementById('forge-stage-name');
        if (nameEl) {
          nameEl.focus();
          if (caret != null) nameEl.setSelectionRange(caret, caret);
        }
      }
    });
  });
})();

/* forge-stage.js — center stage with persistent card preview.
 * Post-refactor: stages rail dropped. Always shows the card preview rendered
 * by the currently-selected style. Footer has Save Draft + Publish + Shuffle
 * (no more stage-flow hammer button). Publish triggers ForgeShare.publishAndShare
 * directly — no separate mint stage ceremony.
 */

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderHeader(root, state) {
    if (!root) return;
    var styleName = state.styleId ? state.styleId.charAt(0).toUpperCase() + state.styleId.slice(1) : 'Ember';
    var charName = state.name && state.name.trim() ? state.name.trim() : '';
    var title = charName || 'Untitled Hero';

    root.innerHTML = '' +
      '<div class="forge-stage-header-left">' +
        '<div class="forge-stage-crumb">◈ ' + escapeHtml(styleName).toUpperCase() + ' STYLE</div>' +
        '<h2 class="forge-stage-title">' + escapeHtml(title) + '</h2>' +
      '</div>' +
      '<div class="forge-stage-header-right">' +
        '<button class="forge-stage-iconbtn" type="button" aria-label="Shuffle character" data-action="shuffle">' +
          '<i class="fa-solid fa-shuffle"></i>' +
        '</button>' +
        '<button class="forge-stage-iconbtn" type="button" aria-label="Reset card" data-action="reset">' +
          '<i class="fa-solid fa-arrow-rotate-left"></i>' +
        '</button>' +
      '</div>';
  }

  function renderFooter(root, state) {
    if (!root) return;
    var minted = !!state.shareId;

    var publishLabel = minted
      ? '<i class="fa-solid fa-check"></i> PUBLISHED'
      : '<i class="fa-solid fa-hammer"></i> PUBLISH TO GALLERY';

    var mainBtnCls = 'forge-stage-publish-btn' + (minted ? ' is-success' : '');

    root.innerHTML = '' +
      '<button class="forge-stage-secondary-btn" type="button" data-action="save">' +
        '<i class="fa-solid fa-floppy-disk"></i> SAVE DRAFT' +
      '</button>' +
      '<button class="' + mainBtnCls + '" type="button" data-action="publish" id="forge-publish-btn"' + (minted ? ' disabled' : '') + '>' +
        publishLabel +
      '</button>' +
      (minted
        ? '<button class="forge-stage-secondary-btn" type="button" data-action="start-over" aria-label="Start a new card">' +
            '<i class="fa-solid fa-plus"></i> NEW' +
          '</button>'
        : ''
      );
  }

  function renderCardStage(root, state) {
    // Always render the card preview. No stage-specific swap.
    if (window.ForgeRender && typeof window.ForgeRender.update === 'function') {
      window.ForgeRender.update(root, state, 'md');
      return;
    }
    root.innerHTML = '<div class="forge-stage-card-placeholder">CARD PREVIEW<br>(ForgeRender module not loaded)</div>';
  }

  // ---------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------
  function handleShuffle() {
    var chars = (window.ForgePortrait && window.ForgePortrait.CHARACTERS) || [];
    if (chars.length === 0) return;
    var pick = chars[Math.floor(Math.random() * chars.length)];
    window.ForgeState.set({
      portraitId: pick.id,
      classLabel: pick.class,
      rarity: pick.rarity
    });
  }

  function handleReset() {
    if (!window.ForgeState) return;
    if (!confirm('Reset this card? Your draft will be cleared.')) return;
    window.ForgeState.reset();
  }

  function handleSave() {
    // Draft already auto-saves via state store. Just nudge UI feedback.
    var btn = document.querySelector('[data-action="save"]');
    if (!btn) return;
    var prev = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> SAVED';
    setTimeout(function () { btn.innerHTML = prev; }, 1200);
  }

  async function handlePublish() {
    var btn = document.getElementById('forge-publish-btn');
    if (!btn) return;
    if (!window.ForgeShare || typeof window.ForgeShare.publishAndShare !== 'function') {
      alert('Publish module not loaded.');
      return;
    }

    var state = window.ForgeState.get();
    if (!state.name || !state.name.trim()) {
      alert('Name your hero before publishing.');
      document.getElementById('forge-left-name')?.focus();
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> PUBLISHING...';

    try {
      var result = await window.ForgeShare.publishAndShare(state);
      window.ForgeState.set({
        hash: result.hash,
        shareId: result.shareId,
        shareUrl: result.shareUrl,
        localOnly: !!result.localOnly,
        mintedAt: Date.now()
      });
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-hammer"></i> PUBLISH TO GALLERY';
      alert('Publish failed: ' + (e && e.message || 'unknown error'));
    }
  }

  function handleStartOver() {
    if (!window.ForgeState) return;
    window.ForgeState.reset();
  }

  function handleAction(action) {
    switch (action) {
      case 'shuffle':     handleShuffle(); return;
      case 'reset':       handleReset(); return;
      case 'save':        handleSave(); return;
      case 'publish':     handlePublish(); return;
      case 'start-over':  handleStartOver(); return;
    }
  }

  function wire(stageRoot) {
    if (!stageRoot) return;
    stageRoot.addEventListener('click', function (ev) {
      var actionBtn = ev.target.closest('[data-action]');
      if (actionBtn && actionBtn.dataset.action) {
        handleAction(actionBtn.dataset.action);
      }
    });
  }

  function render(stageRoot, state) {
    if (!stageRoot) return;
    renderHeader(stageRoot.querySelector('.forge-stage-header'), state);
    renderFooter(stageRoot.querySelector('.forge-stage-footer'), state);
    renderCardStage(stageRoot.querySelector('#forge-stage-card'), state);
  }

  window.ForgeStage = { render: render };

  document.addEventListener('DOMContentLoaded', function () {
    var stageRoot = document.getElementById('forge-stage');
    if (!stageRoot || !window.ForgeState) return;
    render(stageRoot, window.ForgeState.get());
    wire(stageRoot);
    window.ForgeState.subscribe(function (state) { render(stageRoot, state); });
  });
})();

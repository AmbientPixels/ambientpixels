/* forge-stage.js — renders center-stage header + footer action row.
 * Per redesign-handoff.md §6.3.
 *
 * Phase 3: renders with a static default state. The `<div id="forge-stage-card">`
 * slot is left empty — Phase 5 Task 5.1 wires window.ForgeRender.update() here
 * to populate the actual card render.
 */

(function () {
  'use strict';

  // Stage catalog — mirror of forge-left-panel.js STAGES, kept local to avoid
  // a cross-module dependency in Phase 3. Phase 4 forge-bootstrap.js unifies.
  var STAGE_TITLES = {
    'identity':    'Identity',
    'card-design': 'Card Design',
    'vitals':      'Vitals',
    'overlays':    'Overlays',
    'lore':        'Lore',
    'preview':     'Preview',
    'mint':        'Mint'
  };

  var STAGE_ORDER = ['identity', 'card-design', 'vitals', 'overlays', 'lore', 'preview', 'mint'];

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
        '<button class="forge-stage-iconbtn" type="button" aria-label="Undo">' +
          '<i class="fa-solid fa-arrow-rotate-left"></i>' +
        '</button>' +
        '<button class="forge-stage-iconbtn" type="button" aria-label="Redo">' +
          '<i class="fa-solid fa-arrow-rotate-right"></i>' +
        '</button>' +
        '<button class="forge-stage-iconbtn is-active" type="button" aria-label="Fullscreen">' +
          '<i class="fa-solid fa-expand"></i>' +
        '</button>' +
      '</div>';
  }

  function renderFooter(root, state) {
    if (!root) return;
    var styleId = state.styleId || 'ember';

    root.innerHTML = '' +
      '<button class="forge-stage-roundbtn" type="button" aria-label="Undo change">' +
        '<i class="fa-solid fa-arrow-rotate-left"></i>' +
      '</button>' +
      '<button class="forge-stage-roundbtn" type="button" aria-label="Shuffle">' +
        '<i class="fa-solid fa-shuffle"></i>' +
      '</button>' +
      '<button class="forge-stage-roundbtn forge-stage-roundbtn--ember" type="button" aria-label="Forge">' +
        '<i class="fa-solid fa-hammer"></i>' +
      '</button>' +
      '<button class="forge-stage-roundbtn" type="button" aria-label="Share">' +
        '<i class="fa-solid fa-share-nodes"></i>' +
      '</button>' +
      '<span class="forge-stage-caption">style: ' + escapeHtml(styleId) + ' · ready</span>';
  }

  function renderCardPlaceholder(root) {
    if (!root) return;
    // Phase 3 placeholder — Phase 5 Task 5.1 replaces this with real card render.
    root.innerHTML = '<div class="forge-stage-card-placeholder">CARD PREVIEW<br>(Phase 5)</div>';
  }

  function render(stageRoot, state) {
    if (!stageRoot) return;
    renderHeader(stageRoot.querySelector('.forge-stage-header'), state);
    renderFooter(stageRoot.querySelector('.forge-stage-footer'), state);
    renderCardPlaceholder(stageRoot.querySelector('#forge-stage-card'));
  }

  window.ForgeStage = {
    STAGE_ORDER: STAGE_ORDER,
    STAGE_TITLES: STAGE_TITLES,
    render: render
  };

  document.addEventListener('DOMContentLoaded', function () {
    var defaultState = (window.ForgeState && typeof window.ForgeState.get === 'function')
      ? window.ForgeState.get()
      : { activeStage: 'card-design', styleId: 'ember' };
    render(document.getElementById('forge-stage'), defaultState);
  });
})();

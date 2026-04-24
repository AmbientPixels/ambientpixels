/* forge-render.js — card-style render dispatcher with portrait preservation.
 * Per redesign-handoff.md §7 + Phase 5 Task 5.1.
 *
 * The dispatcher owns ONE portrait SVG node at a time, keyed by portraitId.
 * Every style module returns { frag, portraitSlot }. The dispatcher moves
 * the cached portrait into the new slot via appendChild — which transfers
 * (not clones) the node. Browser never re-rasterizes the portrait on style
 * swap, so style changes are flash-free.
 *
 * Style modules must be loaded BEFORE this dispatcher can resolve them —
 * script-tag order in index.html handles that.
 */

(function () {
  'use strict';

  // Map styleId → global name set by the corresponding style module.
  var REGISTRY = {
    monograph: 'ForgeStyleMonograph',
    ember:     'ForgeStyleEmber',
    codex:     'ForgeStyleCodex',
    press:     'ForgeStylePress',
    arcade:    'ForgeStyleArcade',
    terminal:  'ForgeStyleTerminal'
  };

  // Cache a single portrait SVG node across style swaps + re-renders.
  // Keyed by portraitId — invalidated when the character changes.
  var portraitCache = { portraitId: null, node: null };

  function getStyleModule(styleId) {
    var name = REGISTRY[styleId] || REGISTRY.ember;
    return window[name] || window.ForgeStyleEmber || null;
  }

  function getPortraitNode(state) {
    var charId = state.portraitId || 'nova'; // default character if none picked
    if (portraitCache.portraitId === charId && portraitCache.node) {
      return portraitCache.node;
    }
    if (!window.ForgePortrait) return null;
    var node = window.ForgePortrait.build(charId);
    portraitCache = { portraitId: charId, node: node };
    return node;
  }

  /**
   * Build a new card element without mutating any existing DOM.
   * @param {object} state  — ForgeState snapshot
   * @param {string} size   — 'sm' | 'md' | 'lg'
   * @returns {HTMLElement}
   */
  function render(state, size) {
    var style = getStyleModule(state.styleId);
    if (!style || typeof style.build !== 'function') {
      var missing = document.createElement('div');
      missing.className = 'forge-card forge-card--fallback';
      missing.textContent = 'Style "' + (state.styleId || 'unknown') + '" not loaded';
      return missing;
    }

    var built;
    try { built = style.build(state); }
    catch (e) {
      var errEl = document.createElement('div');
      errEl.className = 'forge-card forge-card--fallback';
      errEl.textContent = 'Render error in style "' + style.id + '"';
      return errEl;
    }

    var portrait = getPortraitNode(state);
    if (portrait && built.portraitSlot) {
      // Move (not clone) the portrait into the new slot. If the portrait
      // was previously parented somewhere, appendChild detaches + re-parents
      // in a single atomic op — browser doesn't re-rasterize.
      built.portraitSlot.appendChild(portrait);
    }

    var wrap = document.createElement('div');
    wrap.className = 'forge-card forge-card--' + style.id + ' forge-card--size-' + (size || 'md');
    wrap.dataset.styleId = style.id;
    wrap.appendChild(built.frag);
    return wrap;
  }

  /**
   * Update an existing root element in place.
   * @param {HTMLElement} rootEl
   * @param {object} state
   * @param {string} size
   */
  function update(rootEl, state, size) {
    if (!rootEl) return;
    var next = render(state, size);
    if (rootEl.replaceChildren) {
      rootEl.replaceChildren(next);
    } else {
      rootEl.innerHTML = '';
      rootEl.appendChild(next);
    }
  }

  /**
   * Clear the portrait cache. Used by Task 5.9 gallery mount when multiple
   * cards render different characters simultaneously and each needs its own
   * portrait (cache is for the editor's single-card context).
   */
  function clearPortraitCache() {
    portraitCache = { portraitId: null, node: null };
  }

  window.ForgeRender = {
    REGISTRY: REGISTRY,
    render: render,
    update: update,
    clearPortraitCache: clearPortraitCache
  };
})();

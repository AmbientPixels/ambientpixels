/**
 * CardForge Publish Gate UI
 *
 * Visually ghosts publish-class buttons (and the Forge rail entry) for
 * signed-out users so the gallery-publish path looks unavailable until
 * sign-in. Click handlers stay attached — the existing sign-in dialog
 * still fires — this is a visual cue, not a hard disable.
 *
 * Targets:
 *   #cf-publish-quick-btn      — Quick Publish under the card (editor)
 *   #publish-btn               — Forge section Publish (legacy id)
 *   #forge-publish-nav-btn     — Forge sidebar deck publish (editor)
 *   #db-publish-btn            — Deck builder Publish header button
 *   #forge-action-btn          — Forge rail-footer entry (editor)
 *   .deck-publish-btn          — Per-deck publish row (editor sidebar)
 *
 * Signed-in users see the buttons in their normal state. Re-evaluates
 * automatically when document.body[data-auth-state] changes.
 */
(function () {
  'use strict';

  var LOCKED_CLASS = 'cf-publish-locked';
  var TITLE_DATASET_KEY = 'cfOriginalTitle';
  var STATIC_TARGETS = [
    '#cf-publish-quick-btn',
    '#publish-btn',
    '#forge-publish-nav-btn',
    '#db-publish-btn',
    '#forge-action-btn'
  ];
  var DYNAMIC_TARGETS = ['.deck-publish-btn'];
  var LOCK_TITLE_BY_ID = {
    'forge-action-btn': 'Sign in to publish — saves still work locally',
    'cf-publish-quick-btn': 'Sign in to publish to the gallery',
    'forge-publish-nav-btn': 'Sign in to publish this deck',
    'db-publish-btn': 'Sign in to publish this deck',
    'publish-btn': 'Sign in to publish to the gallery'
  };
  var DEFAULT_LOCK_TITLE = 'Sign in to publish';

  function isSignedIn() {
    return document.body && document.body.getAttribute('data-auth-state') === 'signed-in';
  }

  function lockButton(btn) {
    if (!btn) return;
    if (!btn.classList.contains(LOCKED_CLASS)) btn.classList.add(LOCKED_CLASS);
    var lockTitle = LOCK_TITLE_BY_ID[btn.id] || DEFAULT_LOCK_TITLE;
    if (!(TITLE_DATASET_KEY in btn.dataset)) {
      btn.dataset[TITLE_DATASET_KEY] = btn.getAttribute('title') || '';
    }
    btn.setAttribute('title', lockTitle);
    btn.setAttribute('aria-label', lockTitle);
  }

  function unlockButton(btn) {
    if (!btn) return;
    btn.classList.remove(LOCKED_CLASS);
    if (TITLE_DATASET_KEY in btn.dataset) {
      var orig = btn.dataset[TITLE_DATASET_KEY];
      if (orig) btn.setAttribute('title', orig); else btn.removeAttribute('title');
      delete btn.dataset[TITLE_DATASET_KEY];
    }
    btn.removeAttribute('aria-label');
  }

  function collectTargets() {
    var nodes = [];
    STATIC_TARGETS.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) nodes.push(el);
    });
    DYNAMIC_TARGETS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) { nodes.push(el); });
    });
    return nodes;
  }

  function applyState() {
    var locked = !isSignedIn();
    collectTargets().forEach(function (btn) {
      if (locked) lockButton(btn); else unlockButton(btn);
    });
  }

  function init() {
    applyState();

    // Re-apply when the auth attribute on body changes (deck.html and
    // editor.html both flip data-auth-state on sign-in).
    var bodyObserver = new MutationObserver(function () { applyState(); });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['data-auth-state'] });

    // Re-apply when buttons appear later — deck rows render after the
    // initial load, and the deck-builder rebuilds its header on each
    // mode boot.
    var domObserver = new MutationObserver(function (mutations) {
      var needsScan = false;
      for (var i = 0; i < mutations.length && !needsScan; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (!node || node.nodeType !== 1) continue;
          if (STATIC_TARGETS.some(function (sel) { return node.matches && node.matches(sel); })) { needsScan = true; break; }
          if (DYNAMIC_TARGETS.some(function (sel) { return node.matches && node.matches(sel); })) { needsScan = true; break; }
          if (node.querySelector && (
            node.querySelector(STATIC_TARGETS.join(',')) ||
            node.querySelector(DYNAMIC_TARGETS.join(','))
          )) { needsScan = true; break; }
        }
      }
      if (needsScan) applyState();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * CardForge — keyboard shortcuts.
 * Ignored while typing in input/textarea/select/contentEditable.
 *
 * 0-9               → rail nav jump (see NAV_ORDER below)
 * Ctrl/Cmd + S      → save (triggers #toolbar-save-btn)
 * Ctrl/Cmd + Enter  → publish (triggers #forge-publish-nav-btn)
 */
(function () {
  'use strict';

  // 0 = forge (SHIP); 1-9 = first 9 rail entries in order.
  // buffs + attributes are click-only (no slot left in 0-9).
  var NAV_ORDER = [
    'forge',       // 0
    'presets',     // 1
    'artwork',     // 2
    'effects',     // 3
    'mood',        // 4
    'typography',  // 5
    'composition', // 6
    'cardfx',      // 7
    'basics',      // 8
    'stats'        // 9
  ];

  function typingInField(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function onKeydown(e) {
    if (typingInField(document.activeElement)) return;
    if (e.altKey) return;

    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
      var saveBtn = document.getElementById('toolbar-save-btn');
      if (saveBtn) {
        e.preventDefault();
        saveBtn.click();
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      var publishBtn = document.getElementById('forge-publish-nav-btn');
      if (publishBtn) {
        e.preventDefault();
        publishBtn.click();
      }
      return;
    }

    if (!e.metaKey && !e.ctrlKey && /^[0-9]$/.test(e.key)) {
      var idx = parseInt(e.key, 10);
      var navId = NAV_ORDER[idx];
      if (!navId) return;
      e.preventDefault();
      if (window.CardForgeNav && typeof window.CardForgeNav.activateById === 'function') {
        window.CardForgeNav.activateById(navId);
      } else {
        var btn = document.querySelector('.cf-rail-nav .step-btn[data-nav-id="' + navId + '"]');
        if (btn) btn.click();
      }
    }
  }

  function init() { document.addEventListener('keydown', onKeydown); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

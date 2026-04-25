(function () {
  'use strict';

  function activateTab(strip, target) {
    var tabs = strip.querySelectorAll('.cf-tab');
    var section = strip.closest('.cf-section') || document;
    tabs.forEach(function (t) {
      var on = t.dataset.tabTarget === target;
      t.classList.toggle('cf-tab--active', on);
      t.setAttribute('aria-selected', String(on));
    });
    section.querySelectorAll('.cf-tab-panel').forEach(function (p) {
      var on = p.dataset.tabId === target;
      p.classList.toggle('cf-tab-panel--active', on);
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
  }

  document.addEventListener('click', function (e) {
    var tab = e.target.closest('.cf-tab');
    if (tab) {
      var strip = tab.closest('.cf-tabs');
      if (strip) activateTab(strip, tab.dataset.tabTarget);
      return;
    }
    var randomTile = e.target.closest('#cf-tile-random');
    if (randomTile && window.CardForge && typeof window.CardForge.rollRandomCard === 'function') {
      e.preventDefault();
      window.CardForge.rollRandomCard();
    }
  });

  // URL preview — live-update the preview image as the user pastes a URL.
  // Empty input resets to the empty-state hint; broken URLs hide the img
  // and show the hint again.
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'custom-url-input') return;
    var img = document.getElementById('cf-url-preview');
    var hint = document.querySelector('#cf-url-preview-wrap .cf-url-preview-empty');
    if (!img || !hint) return;
    var url = (e.target.value || '').trim();
    if (!url) {
      img.hidden = true;
      img.removeAttribute('src');
      hint.hidden = false;
      return;
    }
    img.onload = function () { img.hidden = false; hint.hidden = true; };
    img.onerror = function () { img.hidden = true; hint.hidden = false; };
    img.src = url;
  });
})();

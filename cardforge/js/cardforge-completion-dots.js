/**
 * CardForge — completion dots on rail nav.
 * Reads ModularState + DOM inputs; toggles .step-btn__dot.is-done on each
 * rail entry. Debounced 120ms. Listens to form input/change, preset/tier
 * clicks, and a 2s polling fallback for state-only changes (e.g. presets).
 */
(function () {
  'use strict';

  function evalState() {
    var ms = window.ModularState || {};

    var nameEl  = document.getElementById('card-name');
    var quoteEl = document.getElementById('card-quote');
    var avatarEl = document.getElementById('card-avatar');

    var presetSelected = !!document.querySelector('.preset-btn.active, .preset-btn.selected');
    var portraitSet = !!(avatarEl && avatarEl.value && avatarEl.value.trim());

    var imageEffect = ms.imageEffect && ms.imageEffect !== 'none';
    var palette = (ms.palette && ms.palette !== 'neon') ||
                  (ms.paletteVariant && ms.paletteVariant !== 'light') ||
                  (ms.textColor && ms.textColor !== 'auto');
    var typography = (ms.quoteFont && ms.quoteFont !== 'default');
    var alignment = (ms.horizontalAlignment && ms.horizontalAlignment !== 'center') ||
                    (ms.verticalAlignment && ms.verticalAlignment !== 'middle') ||
                    (ms.alignmentWeight && ms.alignmentWeight !== 'balanced') ||
                    (ms.alignmentStyle && ms.alignmentStyle !== 'padded');
    var cardfx = (typeof ms.effectIntensity === 'number' && ms.effectIntensity !== 1) ||
                 (ms.borderRadius && ms.borderRadius !== 'default') ||
                 (ms.cardBackStyle && ms.cardBackStyle !== 'default') ||
                 (ms.statBarColor && ms.statBarColor !== 'default');

    var basicsFilled = !!((nameEl && nameEl.value.trim()) || (quoteEl && quoteEl.value.trim()));

    var combatStatRows = document.querySelectorAll('#combat-stats-editor .stat-row, #combat-stats-editor [data-combat-stat]').length;
    var customStatRows = document.querySelectorAll('#stats-editor .stat-row').length;
    var statsFilled = (combatStatRows + customStatRows) > 0;

    var buffRows = document.querySelectorAll('#badges-editor .micro-row, #badges-editor [data-badge-key], .micro-row').length;
    var attrRows = document.querySelectorAll('#attributes-editor .attribute-row, #attributes-editor [data-attr-key]').length;

    var forgeDone = !!(ms.savedAt || ms.shareId || ms.shareUrl) ||
                    !!document.querySelector('.cf-saved-indicator.is-saved, [data-forge-status="saved"]');

    return {
      presets:     presetSelected,
      artwork:     portraitSet,
      effects:     imageEffect,
      mood:        palette,
      typography:  typography,
      composition: alignment,
      cardfx:      cardfx,
      basics:      basicsFilled,
      stats:       statsFilled,
      buffs:       buffRows > 0,
      attributes:  attrRows > 0,
      forge:       forgeDone
    };
  }

  function apply(state) {
    Object.keys(state).forEach(function (navId) {
      var btn = document.querySelector('.cf-rail-nav .step-btn[data-nav-id="' + navId + '"]');
      if (!btn) return;
      var dot = btn.querySelector('.step-btn__dot');
      if (!dot) return;
      dot.classList.toggle('is-done', !!state[navId]);
    });
  }

  var timer = null;
  function scheduleUpdate() {
    clearTimeout(timer);
    timer = setTimeout(function () { apply(evalState()); }, 120);
  }

  function init() {
    apply(evalState());
    document.addEventListener('input', scheduleUpdate, true);
    document.addEventListener('change', scheduleUpdate, true);
    document.addEventListener('click', function (e) {
      if (e.target.closest('.tier-option, .cf-chip, .preset-btn, [data-preset], .variant-option, .weight-option, .style-option')) {
        scheduleUpdate();
      }
    }, true);
    setInterval(scheduleUpdate, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

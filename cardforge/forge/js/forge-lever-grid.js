/* forge-lever-grid.js — right-column combinator viz per redesign-handoff.md §5.2.
 *
 * Renders three pieces into #forge-combinator:
 *   1. Formula bar — "◈ FORMULA  12 × 8 × 24 × 16 × 5 × stats  ≈ 14M+"
 *   2. Lever grid — 3×2 cells, each showing a dial (Classes / Poses / Palettes / etc.)
 *   3. Also-included strip — "ALSO INCLUDED · 6 card styles · auto-autosave · ..."
 *
 * Lever counts mirror ForgeOdometer.COMBOS — single source of truth.
 */

(function () {
  'use strict';

  // Active cell is purely visual — not interactive, not stateful.
  var LEVERS = [
    { icon: 'fa-user-astronaut', label: 'Classes',   count: '12', active: true  },
    { icon: 'fa-masks-theater',  label: 'Poses',     count: '8',  active: false },
    { icon: 'fa-palette',        label: 'Palettes',  count: '24', active: false },
    { icon: 'fa-layer-group',    label: 'Overlays',  count: '16', active: false },
    { icon: 'fa-chart-simple',   label: 'Stat dist', count: '∞',  active: false },
    { icon: 'fa-gem',            label: 'Rarity',    count: '5',  active: false }
  ];

  function buildFormula() {
    return '' +
      '<div class="forge-formula">' +
        '<span class="forge-formula-label">◈ FORMULA</span>' +
        '<span class="forge-formula-expr">' +
          '<span class="forge-formula-num">12</span>' +
          '<span class="forge-formula-op">×</span>' +
          '<span class="forge-formula-num">8</span>' +
          '<span class="forge-formula-op">×</span>' +
          '<span class="forge-formula-num">24</span>' +
          '<span class="forge-formula-op">×</span>' +
          '<span class="forge-formula-num">16</span>' +
          '<span class="forge-formula-op">×</span>' +
          '<span class="forge-formula-num">5</span>' +
          '<span class="forge-formula-op">×</span>' +
          '<span class="forge-formula-term">stats</span>' +
        '</span>' +
        '<span class="forge-formula-tail">≈ 14M+</span>' +
      '</div>';
  }

  function buildLevers() {
    var cells = LEVERS.map(function (l) {
      var cellClass = 'forge-lever-cell' + (l.active ? ' is-active' : '');
      return '' +
        '<div class="' + cellClass + '">' +
          '<div class="forge-lever-icon"><i class="fa-solid ' + l.icon + '" aria-hidden="true"></i></div>' +
          '<div class="forge-lever-meta">' +
            '<div class="forge-lever-label">' + l.label + '</div>' +
            '<div class="forge-lever-count">' + l.count + '</div>' +
          '</div>' +
        '</div>';
    }).join('');
    return '<div class="forge-lever-grid">' + cells + '</div>';
  }

  function buildAlsoIncluded() {
    return '' +
      '<div class="forge-also-included">' +
        '<i class="fa-solid fa-sparkles forge-also-spark" aria-hidden="true"></i>' +
        '<span>ALSO INCLUDED · 6 card styles · auto-autosave · export PNG/SVG · API access · share links</span>' +
      '</div>';
  }

  function render(root) {
    if (!root) return;
    root.innerHTML = buildFormula() + buildLevers() + buildAlsoIncluded();
  }

  window.ForgeLeverGrid = {
    LEVERS: LEVERS,
    render: render
  };

  document.addEventListener('DOMContentLoaded', function () {
    render(document.getElementById('forge-combinator'));
  });
})();

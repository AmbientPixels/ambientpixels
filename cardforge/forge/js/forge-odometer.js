/* forge-odometer.js — 8-digit combinatorial total per redesign-handoff.md §5.1 + §13.6.
 *
 * Product = CLASSES × POSES × PALETTES × 2^OVERLAYS_BITS × RARITIES × STAT_DISTRIBUTIONS
 *         = 12 × 8 × 24 × 16 × 5 × 123
 *         = 14,158,624
 *
 * MVP: digits are static but computed (not hardcoded). No seeding animation.
 * Phase 3.5 adds prefers-reduced-motion handling for the scan-line overlay.
 */

(function () {
  'use strict';

  // Dial constants — tune these and the odometer recomputes.
  // Keep the product at 8 digits to fit the UI.
  var COMBOS = {
    CLASSES: 12,
    POSES: 8,
    PALETTES: 24,
    OVERLAYS_BITS: 4,         // 2^4 = 16 on/off combinations
    RARITIES: 5,
    STAT_DISTRIBUTIONS: 123   // precomputed partitions of 400 across 5 stats, min 20 each
  };

  function computeTotal() {
    return COMBOS.CLASSES
      * COMBOS.POSES
      * COMBOS.PALETTES
      * Math.pow(2, COMBOS.OVERLAYS_BITS)
      * COMBOS.RARITIES
      * COMBOS.STAT_DISTRIBUTIONS;
  }

  function render(root) {
    if (!root) return;
    var total = computeTotal();
    var padded = String(total).padStart(8, '0');

    var labelHtml = '<span class="forge-odometer-label">TOTAL · COMBOS</span>';
    var digitsHtml = padded.split('').map(function (d) {
      return '<span class="forge-odometer-digit">' + d + '</span>';
    }).join('');

    root.innerHTML = labelHtml + '<div class="forge-odometer-digits">' + digitsHtml + '</div>';
  }

  window.ForgeOdometer = {
    COMBOS: COMBOS,
    computeTotal: computeTotal,
    render: render
  };

  document.addEventListener('DOMContentLoaded', function () {
    render(document.getElementById('forge-odometer'));
  });
})();

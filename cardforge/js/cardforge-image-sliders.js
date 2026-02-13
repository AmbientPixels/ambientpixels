/* CardForge Image Position & Zoom Sliders
 * Pan (X/Y) uses object-position on the inner .card-avatar <img>.
 * Zoom uses transform:scale on the <img> — the parent
 * .card-avatar-container has overflow:hidden so the scaled image
 * is clipped within the container shape. Zoom > 1 creates overflow
 * in both axes, enabling full pan in any direction.
 * Created: 2025-02-12
 */

(function () {
  'use strict';

  function init() {
    const posX   = document.getElementById('cf-img-pos-x');
    const posY   = document.getElementById('cf-img-pos-y');
    const zoom   = document.getElementById('cf-img-zoom');
    const resetBtn = document.getElementById('cf-img-reset');
    const posXVal  = document.getElementById('cf-img-pos-x-val');
    const posYVal  = document.getElementById('cf-img-pos-y-val');
    const zoomVal  = document.getElementById('cf-img-zoom-val');

    if (!posX || !posY) return;

    // Set CSS vars on the persistent .card-preview-zone so they survive
    // innerHTML rebuilds and never flicker.  CSS custom properties inherit
    // down to .card-avatar automatically.
    const previewZone = document.querySelector('.card-preview-zone');

    function applyImageTransform() {
      const x = posX.value;
      const y = posY.value;
      const z = zoom ? (zoom.value / 100) : 1;

      if (posXVal) posXVal.textContent = x + '%';
      if (posYVal) posYVal.textContent = y + '%';
      if (zoomVal) zoomVal.textContent = (zoom ? zoom.value : 100) + '%';

      if (previewZone) {
        previewZone.style.setProperty('--cf-avatar-pos-x', x + '%');
        previewZone.style.setProperty('--cf-avatar-pos-y', y + '%');
        previewZone.style.setProperty('--cf-avatar-scale', z);
      }
    }

    posX.addEventListener('input', applyImageTransform);
    posY.addEventListener('input', applyImageTransform);
    if (zoom) zoom.addEventListener('input', applyImageTransform);

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        posX.value = 50;
        posY.value = 50;
        if (zoom) zoom.value = 100;
        applyImageTransform();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

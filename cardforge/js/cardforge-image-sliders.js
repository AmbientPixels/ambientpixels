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

    function applyImageTransform() {
      const x = posX.value;
      const y = posY.value;
      const z = zoom ? (zoom.value / 100) : 1;

      if (posXVal) posXVal.textContent = x + '%';
      if (posYVal) posYVal.textContent = y + '%';
      if (zoomVal) zoomVal.textContent = (zoom ? zoom.value : 100) + '%';

      const avatars = document.querySelectorAll('.card-preview-zone .card-avatar');
      avatars.forEach(function (avatar) {
        avatar.style.setProperty('--cf-avatar-pos-x', x + '%');
        avatar.style.setProperty('--cf-avatar-pos-y', y + '%');
        avatar.style.setProperty('--cf-avatar-scale', z);
      });
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

    // Re-apply after card preview rebuilds
    const previewZone = document.querySelector('.card-preview-zone');
    if (previewZone) {
      let debounce = null;
      const observer = new MutationObserver(function () {
        clearTimeout(debounce);
        debounce = setTimeout(applyImageTransform, 60);
      });
      observer.observe(previewZone, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

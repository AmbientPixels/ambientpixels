/**
 * CardForge image drag — reposition the card portrait by click-and-drag,
 * zoom with the mouse wheel. Updates #cf-img-pos-x / #cf-img-pos-y /
 * #cf-img-zoom sliders so cardforge-image-sliders.js stays in sync.
 *
 * Uses document-level event delegation because the card DOM re-renders
 * asynchronously (preset apply, avatar swap, effect change), so any
 * direct element reference goes stale.
 */
(function () {
  'use strict';

  var DRAG_THRESHOLD = 4;
  var DRAG_SELECTOR  = '.card-avatar-container, .hero-image-container';

  function pct(n) { return Math.max(0, Math.min(100, n)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fireInput(el) { el.dispatchEvent(new Event('input', { bubbles: true })); }

  var dragging = false;
  var startX = 0, startY = 0;
  var startPosX = 50, startPosY = 50;
  var containerW = 0, containerH = 0;
  var moved = false;
  var activeTarget = null;

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var target = e.target.closest(DRAG_SELECTOR);
    if (!target) return;
    var posX = document.getElementById('cf-img-pos-x');
    var posY = document.getElementById('cf-img-pos-y');
    if (!posX || !posY) return;
    dragging = true;
    moved = false;
    activeTarget = target;
    startX = e.clientX;
    startY = e.clientY;
    startPosX = Number(posX.value) || 50;
    startPosY = Number(posY.value) || 50;
    var rect = target.getBoundingClientRect();
    containerW = rect.width;
    containerH = rect.height;
    target.classList.add('cf-image-dragging');
    e.preventDefault();
  });

  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) moved = true;
    var posX = document.getElementById('cf-img-pos-x');
    var posY = document.getElementById('cf-img-pos-y');
    if (!posX || !posY) return;
    var rangeX = Number(posX.max) - Number(posX.min);
    var rangeY = Number(posY.max) - Number(posY.min);
    // Dragging mouse right pans the image right, i.e. object-position
    // shifts LEFT in pos-x terms — so pos-x moves OPPOSITE to dx.
    var newX = pct(startPosX - (dx / containerW) * rangeX);
    var newY = pct(startPosY - (dy / containerH) * rangeY);
    posX.value = newX.toFixed(1);
    posY.value = newY.toFixed(1);
    fireInput(posX);
    fireInput(posY);
  });

  window.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    if (activeTarget) activeTarget.classList.remove('cf-image-dragging');
    activeTarget = null;
  });

  // Swallow click that fires after a real drag so click-to-edit
  // doesn't also navigate away from the card.
  document.addEventListener('click', function (e) {
    if (!moved) return;
    var target = e.target.closest(DRAG_SELECTOR);
    if (!target) return;
    e.stopPropagation();
    e.preventDefault();
    moved = false;
  }, true);

  // Wheel to zoom (scoped to the draggable region so the page doesn't
  // hijack wheel scroll elsewhere).
  document.addEventListener('wheel', function (e) {
    var target = e.target.closest(DRAG_SELECTOR);
    if (!target) return;
    var zoom = document.getElementById('cf-img-zoom');
    if (!zoom) return;
    e.preventDefault();
    var step = Number(zoom.step) || 1;
    var lo = Number(zoom.min);
    var hi = Number(zoom.max);
    var delta = -Math.sign(e.deltaY) * step * 5;
    var next = clamp(Number(zoom.value) + delta, lo, hi);
    zoom.value = next;
    fireInput(zoom);
  }, { passive: false });

  // Visual affordance — add the .cf-image-draggable class whenever a
  // matching element is in the DOM. An observer keeps this in sync
  // across re-renders. (Style rules live in cardforge-ui.css.)
  function tagDraggables() {
    document.querySelectorAll(DRAG_SELECTOR).forEach(function (el) {
      el.classList.add('cf-image-draggable');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tagDraggables);
  } else {
    tagDraggables();
  }
  var obs = new MutationObserver(tagDraggables);
  obs.observe(document.body, { childList: true, subtree: true });
})();

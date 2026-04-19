/**
 * Image comparison slider — drag the handle (or click anywhere on the
 * container) to reveal more of the "before" or "after" image.
 *
 * Markup expected (see /projects/websites/microsoft-casual-games-support.html):
 *   <div class="img-compare-container" id="comparison-slider">
 *     <img class="img-compare-img after-img" src="..." />
 *     <img class="img-compare-img before-img" src="..." />
 *     <div class="slider-handle"></div>
 *   </div>
 *
 * The .before-img uses `clip-path: inset(0 X% 0 0)` to expose only the
 * left X% of the after-img beneath it. The handle's `left` matches X%.
 * Pairs with /css/comparison-slider.css.
 *
 * Side effects: also toggles `.glow` / `.dim` on `.compare-pill` elements
 * (left side has data-key="before", right side has data-key="after") and
 * `.active` on `.compare-aura-ring` and `.compare-quote-whisper` if those
 * elements are present.
 */

(function () {
  'use strict';

  function initSlider(container) {
    if (!container || container.dataset.sliderInit === '1') return;
    container.dataset.sliderInit = '1';

    const beforeImg = container.querySelector('.before-img');
    const handle = container.querySelector('.slider-handle');
    if (!beforeImg || !handle) return;

    const wrap = container.closest('.compare-3col') || container.parentElement?.parentElement || document;
    const beforePills = wrap.querySelectorAll('[data-key="before"], .compare-pill[data-side="before"]');
    const afterPills = wrap.querySelectorAll('[data-key="after"], .compare-pill[data-side="after"]');
    const auraRing = container.querySelector('.compare-aura-ring');
    const whisper = container.querySelector('.compare-quote-whisper');

    let dragging = false;

    function setPosition(percent) {
      // Clamp to keep the handle visible inside the container
      const p = Math.max(2, Math.min(98, percent));
      beforeImg.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
      handle.style.left = `${p}%`;

      // Toggle pill glow/dim based on slider position
      if (beforePills.length || afterPills.length) {
        const showBefore = p > 50;
        beforePills.forEach((el) => {
          el.classList.toggle('glow', showBefore);
          el.classList.toggle('dim', !showBefore);
        });
        afterPills.forEach((el) => {
          el.classList.toggle('glow', !showBefore);
          el.classList.toggle('dim', showBefore);
        });
      }

      // Aura ring fades in near the edges (pure visual flourish)
      if (auraRing) {
        auraRing.classList.toggle('active', p < 12 || p > 88);
      }
      // Whisper quote shows briefly when slider is at far edges
      if (whisper) {
        whisper.classList.toggle('active', p < 8 || p > 92);
      }
    }

    function pctFromEvent(clientX) {
      const rect = container.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * 100;
    }

    function onPointerDown(e) {
      dragging = true;
      handle.style.transition = 'none';
      beforeImg.style.transition = 'none';
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      setPosition(pctFromEvent(x));
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      setPosition(pctFromEvent(x));
    }
    function onPointerUp() {
      dragging = false;
      handle.style.transition = '';
      beforeImg.style.transition = '';
    }

    // Mouse events on container (so clicking anywhere snaps + drags)
    container.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    // Touch events for mobile
    container.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp);

    // Keyboard support — focus the handle, use arrow keys
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', 'Image comparison slider');
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', '100');
    handle.setAttribute('aria-valuenow', '50');
    handle.addEventListener('keydown', (e) => {
      const current = parseFloat(handle.style.left) || 50;
      let next = current;
      if (e.key === 'ArrowLeft') next = current - 4;
      else if (e.key === 'ArrowRight') next = current + 4;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 100;
      else return;
      e.preventDefault();
      setPosition(next);
      handle.setAttribute('aria-valuenow', String(Math.round(next)));
    });

    // Initialize at 50%
    setPosition(50);
  }

  function init() {
    document.querySelectorAll('.img-compare-container').forEach(initSlider);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

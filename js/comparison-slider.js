// Minimal, robust image comparison slider using clip-path + transformation logic
(function () {
  const container = document.querySelector('.img-compare-container');
  if (!container) return;
  const beforeImg = container.querySelector('.before-img');
  const slider = container.querySelector('.slider-handle');
  const auraRing = container.querySelector('.compare-aura-ring');
  const quoteWhisper = container.querySelector('.compare-quote-whisper');
  let dragging = false;

  // Pills
  const leftPills = document.querySelectorAll('.before-stack .compare-pill');
  const rightPills = document.querySelectorAll('.after-stack .compare-pill');
  // Labels
  const beforeLabel = container.querySelector('.compare-label-before');
  const afterLabel = container.querySelector('.compare-label-after');

  // Map of data-key to threshold (percent)
  const pillThresholds = {
    text: 12,
    nav: 32,
    view: 55,
    static: 78
  };

  function getPercent(x) {
    const rect = container.getBoundingClientRect();
    let offsetX = x - rect.left;
    offsetX = Math.max(0, Math.min(offsetX, rect.width));
    return (offsetX / rect.width) * 100;
  }
  function setSlider(percent) {
    beforeImg.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
    slider.style.left = `${percent}%`;

    // Animate aura ring
    if (auraRing) {
      if (dragging) {
        auraRing.classList.add('active');
      } else {
        auraRing.classList.remove('active');
      }
    }

    // Animate quote at full right
    if (quoteWhisper) {
      if (percent > 97) {
        quoteWhisper.classList.add('active');
      } else {
        quoteWhisper.classList.remove('active');
      }
    }

    // Animate before/after pills (fixed logic for label swap)
    if (percent === 50) {
      leftPills.forEach((pill) => {
        pill.classList.remove('dim');
        pill.classList.add('glow');
      });
      rightPills.forEach((pill) => {
        pill.classList.remove('glow');
        pill.classList.add('dim');
      });
    } else {
      leftPills.forEach((pill) => {
        const key = pill.dataset.key;
        if (percent > (100 - pillThresholds[key])) {
          pill.classList.remove('dim');
          pill.classList.add('glow');
        } else {
          pill.classList.remove('glow');
          pill.classList.add('dim');
        }
      });
      rightPills.forEach((pill) => {
        const key = pill.dataset.key;
        if (percent < pillThresholds[key]) {
          pill.classList.remove('dim');
          pill.classList.add('glow');
        } else {
          pill.classList.remove('glow');
          pill.classList.add('dim');
        }
      });
    }
    // Animate labels (reversed effect)
    if (beforeLabel) {
      beforeLabel.style.opacity = percent > 60 ? 1 : 0.4;
    }
    if (afterLabel) {
      afterLabel.style.opacity = percent < 40 ? 1 : 0.4;
    }

  }
  function onPointerDown(e) { dragging = true; document.body.style.userSelect = 'none'; if (auraRing) auraRing.classList.add('active'); }
  function onPointerMove(e) {
    if (!dragging) return;
    let x = (e.touches ? e.touches[0].clientX : e.clientX);
    setSlider(getPercent(x));
  }
  function onPointerUp() { dragging = false; document.body.style.userSelect = ''; if (auraRing) auraRing.classList.remove('active'); }
  slider.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  slider.addEventListener('touchstart', function (e) { dragging = true; e.preventDefault(); if (auraRing) auraRing.classList.add('active'); }, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);
  container.addEventListener('click', function (e) {
    if (e.target !== slider) setSlider(getPercent(e.clientX));
  });
  setSlider(50);
})();

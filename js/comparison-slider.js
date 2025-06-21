// Minimal, robust image comparison slider using clip-path
(function () {
  const container = document.querySelector('.img-compare-container');
  if (!container) return;
  const beforeImg = container.querySelector('.before-img');
  const slider = container.querySelector('.slider-handle');
  let dragging = false;

  function getPercent(x) {
    const rect = container.getBoundingClientRect();
    let offsetX = x - rect.left;
    offsetX = Math.max(0, Math.min(offsetX, rect.width));
    return (offsetX / rect.width) * 100;
  }
  function setSlider(percent) {
    beforeImg.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
    slider.style.left = `${percent}%`;
  }
  function onPointerDown(e) { dragging = true; document.body.style.userSelect = 'none'; }
  function onPointerMove(e) {
    if (!dragging) return;
    let x = (e.touches ? e.touches[0].clientX : e.clientX);
    setSlider(getPercent(x));
  }
  function onPointerUp() { dragging = false; document.body.style.userSelect = ''; }
  slider.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  slider.addEventListener('touchstart', function (e) { dragging = true; e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);
  container.addEventListener('click', function (e) {
    if (e.target !== slider) setSlider(getPercent(e.clientX));
  });
  setSlider(50);
})();

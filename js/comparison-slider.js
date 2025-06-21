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
    // Overlay logic
    const calloutBefore = container.querySelector('.callout-before');
    const calloutAfter = container.querySelector('.callout-after');
    const calloutAccessibility = container.querySelector('.callout-accessibility');
    const calloutMobile = container.querySelector('.callout-mobile');
    if (calloutBefore) calloutBefore.style.opacity = 1;
    if (calloutAfter) calloutAfter.style.opacity = 1;
    // Callouts appear as slider moves left, disappear as you move right
    // Cumulative reveal: each callout appears as you pass its threshold left, and disappears if you move right past its threshold
    const calloutTesting = container.querySelector('.callout-testing');
    const calloutChat = container.querySelector('.callout-chat');
    if (calloutAccessibility) calloutAccessibility.style.opacity = (percent < 51 ? 1 : 0);
    if (calloutMobile) calloutMobile.style.opacity = (percent < 40 ? 1 : 0);
    if (calloutTesting) calloutTesting.style.opacity = (percent < 30 ? 1 : 0);
    if (calloutChat) calloutChat.style.opacity = (percent < 15 ? 1 : 0);
    // Debug output
    console.log('[Slider Debug]', {
      percent: percent.toFixed(2),
      calloutBefore: calloutBefore ? calloutBefore.style.opacity : 'none',
      calloutAfter: calloutAfter ? calloutAfter.style.opacity : 'none',
      calloutAccessibility: calloutAccessibility ? calloutAccessibility.style.opacity : 'none',
      calloutMobile: calloutMobile ? calloutMobile.style.opacity : 'none',
      calloutTesting: calloutTesting ? calloutTesting.style.opacity : 'none',
      calloutChat: calloutChat ? calloutChat.style.opacity : 'none'
    });
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

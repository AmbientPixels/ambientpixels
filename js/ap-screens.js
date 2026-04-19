(function () {
  'use strict';

  function init(rail) {
    if (rail.dataset.apScreensInit) return;
    rail.dataset.apScreensInit = '1';

    var slides = rail.querySelectorAll('.ap-screens-slide');
    var sentinels = rail.querySelectorAll('.ap-screens-sentinel');
    var idxEl = rail.querySelector('[data-idx]');
    var titleEl = rail.querySelector('[data-title]');
    var progEl = rail.querySelector('[data-progress]');
    if (!slides.length || !sentinels.length) return;

    var total = slides.length;
    var titles = Array.prototype.map.call(sentinels, function (s) {
      var t = s.querySelector('.ap-screens-title');
      return (t && t.textContent ? t.textContent : '').replace(/\.$/, '').trim();
    });

    function activate(i) {
      for (var si = 0; si < slides.length; si++) {
        slides[si].classList.toggle('is-active', si === i);
      }
      if (idxEl) idxEl.textContent = String(i + 1).padStart(2, '0');
      if (titleEl) titleEl.textContent = titles[i] || '';
      if (progEl) progEl.style.width = (((i + 1) / total) * 100) + '%';
    }

    if (!('IntersectionObserver' in window)) {
      activate(0);
      return;
    }

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var i = +e.target.getAttribute('data-i');
          if (!isNaN(i)) activate(i);
        }
      });
    }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 });

    sentinels.forEach(function (s) { obs.observe(s); });
    activate(0);
  }

  function boot() {
    document.querySelectorAll('.ap-screens-rail').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

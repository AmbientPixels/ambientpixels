(function () {
  'use strict';

  // Accordion: expand/collapse project cards
  document.querySelectorAll('.cv-project-head').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.cv-project');
      var open = card.getAttribute('data-open') === 'true';
      card.setAttribute('data-open', String(!open));
      btn.setAttribute('aria-expanded', String(!open));
    });
  });

  // Category filter
  var filterBtns = Array.prototype.slice.call(document.querySelectorAll('.cv-filter button'));
  filterBtns.forEach(function (fb) {
    fb.addEventListener('click', function () {
      var cat = fb.getAttribute('data-filter');
      filterBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b === fb)); });
      document.querySelectorAll('.cv-project').forEach(function (card) {
        var show = cat === 'all' || card.getAttribute('data-cat') === cat;
        card.hidden = !show;
      });
    });
  });

  // Lightbox
  var galleries = Array.prototype.slice.call(document.querySelectorAll('.cv-gallery'));
  if (!galleries.length) return;

  var imgs = [];
  var idx = 0;
  var lastFocus = null;

  var lb = document.createElement('div');
  lb.className = 'cv-lightbox';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Image viewer');
  lb.innerHTML =
    '<button type="button" class="cv-lb-btn cv-lb-close" aria-label="Close">✕</button>' +
    '<button type="button" class="cv-lb-btn cv-lb-prev" aria-label="Previous image">‹</button>' +
    '<img alt="">' +
    '<button type="button" class="cv-lb-btn cv-lb-next" aria-label="Next image">›</button>';
  document.body.appendChild(lb);

  var lbImg = lb.querySelector('img');
  var btnClose = lb.querySelector('.cv-lb-close');
  var btnPrev = lb.querySelector('.cv-lb-prev');
  var btnNext = lb.querySelector('.cv-lb-next');
  var focusables = [btnClose, btnPrev, btnNext];

  function show(i) {
    idx = (i + imgs.length) % imgs.length;
    lbImg.src = imgs[idx].full;
    lbImg.alt = imgs[idx].alt;
  }
  function openLb(list, i, trigger) {
    imgs = list;
    lastFocus = trigger;
    lb.classList.add('is-open');
    show(i);
    btnClose.focus();
    document.addEventListener('keydown', onKey);
  }
  function closeLb() {
    lb.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    if (lastFocus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { closeLb(); }
    else if (e.key === 'ArrowRight') { show(idx + 1); }
    else if (e.key === 'ArrowLeft') { show(idx - 1); }
    else if (e.key === 'Tab') {
      // simple focus trap across the three controls
      e.preventDefault();
      var cur = focusables.indexOf(document.activeElement);
      var dir = e.shiftKey ? -1 : 1;
      focusables[(cur + dir + focusables.length) % focusables.length].focus();
    }
  }

  btnClose.addEventListener('click', closeLb);
  btnNext.addEventListener('click', function () { show(idx + 1); });
  btnPrev.addEventListener('click', function () { show(idx - 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });

  galleries.forEach(function (gal) {
    var buttons = Array.prototype.slice.call(gal.querySelectorAll('button[data-full]'));
    var list = buttons.map(function (b) {
      var im = b.querySelector('img');
      return { full: b.getAttribute('data-full'), alt: im ? im.alt : '' };
    });
    buttons.forEach(function (b, i) {
      b.addEventListener('click', function () { openLb(list, i, b); });
    });
  });
})();

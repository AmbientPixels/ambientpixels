/* ============================================================================
   AmbientPixels Design System — Mobile Nav (auto-mount)
   Paired with ap-components.css §2.2.1. Activated at ≤1000px via CSS.
   Finds every .ap-nav on the page, injects a hamburger toggle + full-screen
   sheet, and wires open/close. Runs on desktop too (markup is harmless —
   CSS keeps the toggle + sheet hidden until the breakpoint fires).
   ============================================================================ */

(function () {
  'use strict';

  function init() {
    document.querySelectorAll('.ap-nav').forEach(mount);
  }

  function mount(nav) {
    if (nav.dataset.apNavMounted === '1') return;
    nav.dataset.apNavMounted = '1';

    var linkRow = nav.querySelector('.ap-nav-links');
    if (!linkRow) return;
    var cta = nav.querySelector('.ap-nav-cta');

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ap-nav-toggle';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML =
      '<span class="ap-nav-toggle__bar"></span>' +
      '<span class="ap-nav-toggle__bar"></span>' +
      '<span class="ap-nav-toggle__bar"></span>';
    nav.appendChild(toggle);

    var sheet = document.createElement('div');
    sheet.className = 'ap-nav-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Site menu');
    sheet.setAttribute('aria-hidden', 'true');

    var inner = document.createElement('div');
    inner.className = 'ap-nav-sheet__inner';

    var top = document.createElement('div');
    top.className = 'ap-nav-sheet__top';

    var spacer = document.createElement('span');
    spacer.setAttribute('aria-hidden', 'true');
    top.appendChild(spacer);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ap-nav-sheet__close';
    close.setAttribute('aria-label', 'Close menu');
    close.textContent = 'Close.';
    top.appendChild(close);

    var linkList = document.createElement('div');
    linkList.className = 'ap-nav-sheet__links';
    Array.prototype.forEach.call(linkRow.children, function (a) {
      linkList.appendChild(a.cloneNode(true));
    });

    inner.appendChild(top);
    inner.appendChild(linkList);

    if (cta) {
      var ctaClone = cta.cloneNode(true);
      ctaClone.classList.add('ap-nav-sheet__cta');
      inner.appendChild(ctaClone);
    }

    sheet.appendChild(inner);
    document.body.appendChild(sheet);

    function open() {
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
      document.documentElement.classList.add('ap-nav-lock');
      close.focus();
    }

    function closeSheet() {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      document.documentElement.classList.remove('ap-nav-lock');
      toggle.focus();
    }

    toggle.addEventListener('click', open);
    close.addEventListener('click', closeSheet);

    Array.prototype.forEach.call(linkList.querySelectorAll('a'), function (a) {
      a.addEventListener('click', closeSheet);
    });

    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) closeSheet();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('is-open')) closeSheet();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

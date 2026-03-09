/**
 * adventure-ui.js — Toasts, modals, loading, typewriter effect
 */
window.AdventureUI = (function () {
  'use strict';

  const TOAST_DURATION = 3500;

  // --- Toast ---
  function toast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    if (!container) return;

    var el = document.createElement('div');
    el.className = 'adv-toast';
    el.style.cssText =
      'padding:0.7rem 1rem;border-radius:8px;font-size:0.85rem;min-width:200px;max-width:360px;' +
      'display:flex;align-items:center;gap:0.5rem;';

    var colors = {
      info: { bg: 'rgba(124,58,237,0.15)', border: 'rgba(124,58,237,0.3)', color: '#A78BFA', icon: 'fa-circle-info' },
      success: { bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.3)', color: '#34D399', icon: 'fa-circle-check' },
      error: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)', color: '#EF4444', icon: 'fa-circle-xmark' },
      warning: { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.3)', color: '#FBBF24', icon: 'fa-triangle-exclamation' }
    };

    var c = colors[type] || colors.info;
    el.style.background = c.bg;
    el.style.border = '1px solid ' + c.border;
    el.style.color = c.color;
    el.innerHTML = '<i class="fas ' + c.icon + '"></i><span>' + escapeHtml(message) + '</span>';

    container.appendChild(el);

    setTimeout(function () {
      el.classList.add('adv-toast--exit');
      setTimeout(function () { el.remove(); }, 300);
    }, TOAST_DURATION);
  }

  // --- Typewriter ---
  var activeTypewriter = null; // allows skip on click

  function typewriter(element, text, speed) {
    speed = speed || 18;
    // Cancel any previous typewriter
    if (activeTypewriter) activeTypewriter.skip();

    // Skip animation for reduced-motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var paragraphs = text.split('\n\n');
      element.innerHTML = paragraphs.map(function (p) { return '<p>' + escapeHtml(p.trim()) + '</p>'; }).join('');
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      element.innerHTML = '';
      var paragraphs = text.split('\n\n');
      var fullHtml = paragraphs.map(function (p) { return '<p>' + escapeHtml(p.trim()) + '</p>'; }).join('');
      var chars = fullHtml;
      var i = 0;
      var inTag = false;
      var done = false;

      function finish() {
        if (done) return;
        done = true;
        activeTypewriter = null;
        element.removeEventListener('click', onSkip);
        element.style.cursor = '';
        element.innerHTML = fullHtml;
        resolve();
      }

      function onSkip() { finish(); }

      // Click to skip
      element.style.cursor = 'pointer';
      element.addEventListener('click', onSkip);

      activeTypewriter = { skip: finish };

      function tick() {
        if (done) return;
        if (i >= chars.length) { finish(); return; }
        if (chars[i] === '<') inTag = true;
        if (inTag) {
          while (i < chars.length && inTag) {
            if (chars[i] === '>') inTag = false;
            i++;
          }
          element.innerHTML = chars.substring(0, i) + '<span class="adv-cursor"></span>';
          requestAnimationFrame(tick);
        } else {
          i++;
          element.innerHTML = chars.substring(0, i) + '<span class="adv-cursor"></span>';
          setTimeout(tick, speed);
        }
      }
      tick();
    });
  }

  // --- Loading state ---
  function showLoading(container, message) {
    message = message || 'Generating...';
    container.innerHTML =
      '<div class="adv-loading">' +
        '<div class="adv-loading__spinner"></div>' +
        '<span>' + escapeHtml(message) + '</span>' +
      '</div>';
  }

  // --- Screen switching ---
  function showScreen(screenId) {
    var screens = document.querySelectorAll('[id^="screen"]');
    screens.forEach(function (s) { s.style.display = 'none'; });
    var target = document.getElementById(screenId);
    if (target) target.style.display = 'flex';
  }

  // --- Utilities ---
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function $(id) {
    return document.getElementById(id);
  }

  // --- Confirm dialog (replaces native confirm()) ---
  function showConfirm(title, text, okLabel) {
    return new Promise(function (resolve) {
      var overlay = $('confirmOverlay');
      var previousFocus = document.activeElement;
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      $('confirmOk').textContent = okLabel || 'Confirm';
      overlay.style.display = '';

      // Focus the cancel button by default (safer action)
      $('confirmCancel').focus();

      function cleanup(result) {
        overlay.style.display = 'none';
        $('confirmOk').removeEventListener('click', onOk);
        $('confirmCancel').removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        // Restore focus
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onKey(e) {
        if (e.key === 'Escape') { onCancel(); return; }
        // Focus trap: Tab cycles between Cancel and OK
        if (e.key === 'Tab') {
          var btns = [overlay.querySelector('#confirmCancel'), overlay.querySelector('#confirmOk')];
          var focused = document.activeElement;
          var idx = btns.indexOf(focused);
          if (e.shiftKey) {
            idx = idx <= 0 ? btns.length - 1 : idx - 1;
          } else {
            idx = idx >= btns.length - 1 ? 0 : idx + 1;
          }
          btns[idx].focus();
          e.preventDefault();
        }
      }
      $('confirmOk').addEventListener('click', onOk);
      $('confirmCancel').addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  }

  return {
    toast: toast,
    typewriter: typewriter,
    showLoading: showLoading,
    showScreen: showScreen,
    showConfirm: showConfirm,
    escapeHtml: escapeHtml,
    $: $
  };
})();

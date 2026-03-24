/* ============================================================
   bs-tutorial.js — Stranger fight tutorial overlay
   IIFE → window.BsTutorial
   ============================================================ */
(function () {
  'use strict';

  var TUTORIAL_HINTS = (window.BsConst || {}).TUTORIAL_HINTS || [];

  var _tutorialStep = 0;
  var _tutorialEl = null;

  function showStrangerTutorial() {
    _tutorialStep = 0;
    _tutorialEl = document.createElement('div');
    _tutorialEl.className = 'bs-tutorial';
    _tutorialEl.innerHTML = '<div class="bs-tutorial__text" id="bs-tutorial-text">' + (TUTORIAL_HINTS[0] ? TUTORIAL_HINTS[0].text : '') + '</div>';
    document.body.appendChild(_tutorialEl);
    highlightTutorialMove(0);

    // Only the highlighted move button advances the tutorial
    document.querySelectorAll('.arena-move-btn').forEach(function (btn) {
      btn.addEventListener('click', onTutorialMoveClick);
    });
  }

  function onTutorialMoveClick(e) {
    var btn = e.currentTarget;
    var currentHint = TUTORIAL_HINTS[_tutorialStep];
    // Only advance if the clicked move matches the highlighted one
    if (currentHint && btn.dataset.move === currentHint.move) {
      advanceTutorial();
    }
  }

  function highlightTutorialMove(step) {
    var hint = step < TUTORIAL_HINTS.length ? TUTORIAL_HINTS[step] : null;
    document.querySelectorAll('.arena-move-btn').forEach(function (b) {
      b.classList.remove('bs-pulse-hint');
      if (hint) {
        // Disable all buttons except the one being taught
        var isTarget = b.dataset.move === hint.move;
        b.disabled = !isTarget;
        b.style.opacity = isTarget ? '' : '0.3';
        b.style.pointerEvents = isTarget ? '' : 'none';
      } else {
        // Tutorial done — re-enable all
        b.disabled = false;
        b.style.opacity = '';
        b.style.pointerEvents = '';
      }
    });
    if (hint) {
      var btn = document.querySelector('[data-move="' + hint.move + '"]');
      if (btn) btn.classList.add('bs-pulse-hint');
      var textEl = document.getElementById('bs-tutorial-text');
      if (textEl) textEl.textContent = hint.text;
    }
  }

  function advanceTutorial() {
    _tutorialStep++;
    if (_tutorialStep >= TUTORIAL_HINTS.length) {
      removeTutorial();
      return;
    }
    highlightTutorialMove(_tutorialStep);
  }

  function removeTutorial() {
    if (_tutorialEl) { _tutorialEl.remove(); _tutorialEl = null; }
    document.querySelectorAll('.arena-move-btn').forEach(function (b) {
      b.classList.remove('bs-pulse-hint');
      b.removeEventListener('click', onTutorialMoveClick);
      b.disabled = false;
      b.style.opacity = '';
      b.style.pointerEvents = '';
    });
  }

  window.BsTutorial = {
    show: showStrangerTutorial,
    remove: removeTutorial
  };
})();

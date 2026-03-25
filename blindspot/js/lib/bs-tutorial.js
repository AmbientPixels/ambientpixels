/* ============================================================
   bs-tutorial.js — Speech bubble tutorial system
   IIFE → window.BsTutorial
   Phases: HUD intro (tap) → Move teaching (click) → Contextual (auto)
   ============================================================ */
(function () {
  'use strict';

  var C = window.BsConst || {};
  var STEPS = C.TUTORIAL_STEPS || [];
  var CONTEXTUAL = C.TUTORIAL_CONTEXTUAL || [];

  // ── State ──
  var _currentStep = 0;
  var _phase = 'idle';          // 'idle' | 'hud-intro' | 'moves' | 'contextual' | 'done'
  var _isActive = false;
  var _controllingMoves = false; // true during Phase 2
  var _bubbleEl = null;
  var _contextualShown = {};    // { id: true } — tracks one-shot contextual hints
  var _contextualTimer = null;
  var _advanceDebounce = 0;
  var _resizeHandler = null;
  var _currentTargetEl = null;
  var _currentPosition = 'above';

  var ARROW_SIZE = 8;
  var EDGE_MARGIN = 8;

  // ── Bubble HTML ──

  function _createBubbleHTML(step, actionText) {
    var html = '<div class="bs-speech-bubble__header">' +
      '<i class="fas ' + step.icon + ' bs-speech-bubble__icon" aria-hidden="true"></i>' +
      '<span class="bs-speech-bubble__label">' + step.label + '</span>' +
    '</div>' +
    '<div class="bs-speech-bubble__text">' + step.text + '</div>';
    // Move steps: no action button — the glowing move button IS the action
    // Tap steps: render a "Got it" button to dismiss
    if (step.advance !== 'move') {
      html += '<button class="bs-speech-bubble__action" type="button">' + actionText + '</button>';
    }
    return html;
  }

  // ── Positioning ──

  function _positionBubble(targetEl, direction) {
    if (!_bubbleEl || !targetEl) return;
    _currentTargetEl = targetEl;
    _currentPosition = direction;

    var tRect = targetEl.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    // Measure bubble (briefly make visible but transparent for measurement)
    _bubbleEl.style.visibility = 'hidden';
    _bubbleEl.style.display = 'block';
    var bw = _bubbleEl.offsetWidth;
    var bh = _bubbleEl.offsetHeight;
    _bubbleEl.style.visibility = '';

    var gap = 2;
    var left, top;
    var finalDir = direction;

    if (direction === 'above') {
      top = tRect.top - bh - ARROW_SIZE - gap;
      if (top < EDGE_MARGIN) { finalDir = 'below'; top = tRect.bottom + ARROW_SIZE + gap; }
    } else {
      top = tRect.bottom + ARROW_SIZE + gap;
      if (top + bh > vh - EDGE_MARGIN) { finalDir = 'above'; top = tRect.top - bh - ARROW_SIZE - gap; }
    }

    // Center horizontally on target
    left = tRect.left + tRect.width / 2 - bw / 2;
    // Clamp to viewport edges
    left = Math.max(EDGE_MARGIN, Math.min(left, vw - bw - EDGE_MARGIN));
    top = Math.max(EDGE_MARGIN, Math.min(top, vh - bh - EDGE_MARGIN));

    // Arrow offset: point at target center relative to bubble left
    var targetCenterX = tRect.left + tRect.width / 2;
    var arrowOffset = targetCenterX - left;
    arrowOffset = Math.max(16, Math.min(arrowOffset, bw - 16));

    _bubbleEl.style.left = left + 'px';
    _bubbleEl.style.top = top + 'px';
    _bubbleEl.style.setProperty('--arrow-offset', arrowOffset + 'px');

    // Set direction class
    _bubbleEl.classList.remove('bs-speech-bubble--above', 'bs-speech-bubble--below');
    _bubbleEl.classList.add('bs-speech-bubble--' + finalDir);
  }

  function _onResize() {
    if (_currentTargetEl && _bubbleEl) {
      _positionBubble(_currentTargetEl, _currentPosition);
    }
  }

  // ── Bubble Lifecycle ──

  function _showBubble() {
    if (_bubbleEl) {
      requestAnimationFrame(function () {
        if (_bubbleEl) _bubbleEl.classList.add('bs-speech-bubble--visible');
      });
    }
  }

  function _hideBubble() {
    if (_bubbleEl) _bubbleEl.classList.remove('bs-speech-bubble--visible');
  }

  function _removeBubble() {
    if (_bubbleEl) { _bubbleEl.remove(); _bubbleEl = null; }
    _currentTargetEl = null;
  }

  function _ensureBubble() {
    if (!_bubbleEl) {
      _bubbleEl = document.createElement('div');
      _bubbleEl.className = 'bs-speech-bubble';
      _bubbleEl.setAttribute('role', 'tooltip');
      document.body.appendChild(_bubbleEl);
    }
    return _bubbleEl;
  }

  // ── Button State Management ──

  function _lockAllMoves() {
    _controllingMoves = true;
    document.querySelectorAll('.arena-move-btn').forEach(function (btn) {
      btn.disabled = true;
      btn.classList.add('arena-move-btn--disabled');
      btn.style.opacity = '0.3';
      btn.style.pointerEvents = 'none';
    });
  }

  function _disableOtherMoves(allowedMove) {
    _controllingMoves = true;
    document.querySelectorAll('.arena-move-btn').forEach(function (btn) {
      btn.classList.remove('bs-pulse-hint');
      var isTarget = btn.dataset.move === allowedMove;
      btn.disabled = !isTarget;
      // Remove battle UI's disabled/locked classes — they override inline styles
      btn.classList.toggle('arena-move-btn--disabled', !isTarget);
      if (isTarget) {
        btn.classList.remove('arena-move-btn--locked');
        btn.classList.add('bs-pulse-hint');
      }
      btn.style.opacity = isTarget ? '' : '0.3';
      btn.style.pointerEvents = isTarget ? '' : 'none';
    });
  }

  function _releaseAllMoves() {
    _controllingMoves = false;
    document.querySelectorAll('.arena-move-btn').forEach(function (btn) {
      btn.classList.remove('bs-pulse-hint', 'arena-move-btn--disabled');
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    });
  }

  // ── Render Step ──

  function _renderStep(idx) {
    if (idx >= STEPS.length) {
      // Phase 1+2 complete — transition to contextual
      _phase = 'contextual';
      _controllingMoves = false;
      _releaseAllMoves();
      _removeBubble();
      return;
    }

    var step = STEPS[idx];
    var targetEl = document.querySelector(step.target);
    if (!targetEl) {
      // Target not found — skip to next step
      _currentStep = idx + 1;
      _renderStep(_currentStep);
      return;
    }

    // Determine phase from step properties
    if (step.advance === 'tap') {
      _phase = 'hud-intro';
    } else if (step.advance === 'move') {
      _phase = 'moves';
    }

    var actionText = step.advance === 'move' ? 'Try it!' : 'Got it';
    _ensureBubble();
    _bubbleEl.innerHTML = _createBubbleHTML(step, actionText);

    // Position and show
    _positionBubble(targetEl, step.position);
    _showBubble();

    // Button management
    if (step.disableOthers && step.move) {
      // Move step — enable only the target button
      _disableOtherMoves(step.move);
    } else if (step.advance === 'tap') {
      // HUD intro — lock ALL buttons until move teaching starts
      _lockAllMoves();
    }

    // Wire up action button for tap-to-advance steps
    if (step.advance === 'tap') {
      var actionBtn = _bubbleEl.querySelector('.bs-speech-bubble__action');
      if (actionBtn) {
        actionBtn.addEventListener('click', function tapHandler(e) {
          e.stopPropagation();
          actionBtn.removeEventListener('click', tapHandler);
          _advanceStep();
        });
      }
    }
    // Move steps advance via onMoveComplete() — no action button listener needed
    // (the button just says "Try it!" as a visual cue)
  }

  // ── Step Advancement ──

  function _advanceStep() {
    var now = Date.now();
    if (now - _advanceDebounce < 150) return;
    _advanceDebounce = now;

    _hideBubble();
    _currentStep++;

    // Small delay for fade-out before showing next
    setTimeout(function () {
      _renderStep(_currentStep);
    }, 280);
  }

  // ── Contextual Hints ──

  function _showContextualBubble(hint) {
    _contextualShown[hint.id] = true;

    var targetEl = document.querySelector(hint.target);
    if (!targetEl) return;

    _ensureBubble();
    _bubbleEl.innerHTML = _createBubbleHTML(hint, 'Got it');
    _positionBubble(targetEl, hint.position);
    _showBubble();

    // Wire dismiss button
    var actionBtn = _bubbleEl.querySelector('.bs-speech-bubble__action');
    if (actionBtn) {
      actionBtn.addEventListener('click', function dismissHandler(e) {
        e.stopPropagation();
        actionBtn.removeEventListener('click', dismissHandler);
        _hideBubble();
        if (_contextualTimer) clearTimeout(_contextualTimer);
        setTimeout(_removeBubble, 280);
      });
    }

    // Auto-dismiss after 4s
    if (_contextualTimer) clearTimeout(_contextualTimer);
    _contextualTimer = setTimeout(function () {
      _hideBubble();
      setTimeout(_removeBubble, 280);
    }, 4000);
  }

  // ── Public API ──

  function show() {
    _currentStep = 0;
    _isActive = true;
    _controllingMoves = false;
    _phase = 'hud-intro';
    _contextualShown = {};
    _advanceDebounce = 0;

    // Listen for resize to reposition
    _resizeHandler = _debounce(_onResize, 100);
    window.addEventListener('resize', _resizeHandler);

    _renderStep(0);
  }

  function remove() {
    _isActive = false;
    _controllingMoves = false;
    _phase = 'done';
    _hideBubble();
    _removeBubble();
    _releaseAllMoves();
    if (_contextualTimer) { clearTimeout(_contextualTimer); _contextualTimer = null; }
    if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }
  }

  function isActive() {
    return _isActive;
  }

  function isControllingMoves() {
    return _controllingMoves;
  }

  function onMoveComplete(move) {
    if (!_isActive || _phase !== 'moves') return;
    var step = STEPS[_currentStep];
    if (!step || step.move !== move) return;

    // Hide current bubble, advance to next step
    _hideBubble();
    _currentStep++;

    // Wait one frame + fade-out time before rendering next step
    setTimeout(function () {
      requestAnimationFrame(function () {
        if (_currentStep < STEPS.length && STEPS[_currentStep].advance === 'move') {
          _renderStep(_currentStep);
        } else {
          // Phase 2 complete — release buttons, enter contextual phase
          _phase = 'contextual';
          _controllingMoves = false;
          _releaseAllMoves();
          _removeBubble();
        }
      });
    }, 280);
  }

  function checkContextual(gameState) {
    if (!_isActive) return;
    if (_phase !== 'contextual' && _phase !== 'moves') return;
    // Don't show contextual during active Phase 2 move steps
    if (_phase === 'moves') return;

    // One hint per round — first match wins (priority order)
    for (var i = 0; i < CONTEXTUAL.length; i++) {
      var hint = CONTEXTUAL[i];
      if (_contextualShown[hint.id]) continue;
      if (hint.condition(gameState)) {
        _showContextualBubble(hint);
        return; // one per round
      }
    }
  }

  // ── Utility ──

  function _debounce(fn, ms) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  // ── Export ──

  window.BsTutorial = {
    show: show,
    remove: remove,
    end: remove,                 // alias — bs-arena-battle-ui.js:898 calls .end()
    isActive: isActive,
    isControllingMoves: isControllingMoves,
    onMoveComplete: onMoveComplete,
    checkContextual: checkContextual
  };
  window._arenaTutorial = window.BsTutorial;
})();

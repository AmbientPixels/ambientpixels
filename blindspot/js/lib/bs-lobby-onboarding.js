/**
 * bs-lobby-onboarding.js — 3-step spotlight welcome tutorial
 * Extracted from blindspot-flow.js (Round 6)
 *
 * API: window.BsLobbyOnboarding
 *   .show()  — showLobbyOnboarding()
 */
(function () {
  'use strict';

  function show() {
    var steps = [
      { target: 'bs-btn-campaign', title: 'Fight bosses to level up', desc: 'The Campaign has 10 bosses. Beat them to earn XP, sparks, and unlock new abilities.', icon: 'fa-dragon' },
      { target: 'bs-forge-progress', title: 'Win fights to unlock the Forge', desc: 'After a few wins, the Forge opens. Customize your card\u2019s stats, palette, and look.', icon: 'fa-fire' },
      { target: 'bs-btn-pvp', title: 'Beat all 10 to unlock PvP', desc: 'Defeat every boss to enter the PvP Arena and challenge other players\u2019 cards.', icon: 'fa-users' }
    ];
    var currentStep = 0;

    // Create backdrop
    var backdrop = document.createElement('div');
    backdrop.className = 'bs-onboard-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-label', 'Welcome guide');

    // Create spotlight cutout
    var spotlight = document.createElement('div');
    spotlight.className = 'bs-onboard-spotlight';

    // Create tooltip
    var tooltip = document.createElement('div');
    tooltip.className = 'bs-onboard-tooltip';

    backdrop.appendChild(spotlight);
    backdrop.appendChild(tooltip);
    document.body.appendChild(backdrop);

    function positionStep(stepIdx) {
      var step = steps[stepIdx];
      var targetEl = document.getElementById(step.target);
      if (!targetEl || !targetEl.offsetHeight) { cleanup(); return; }

      var rect = targetEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) { cleanup(); return; }
      var pad = 8;

      // Position spotlight around target
      spotlight.style.top = (rect.top - pad) + 'px';
      spotlight.style.left = (rect.left - pad) + 'px';
      spotlight.style.width = (rect.width + pad * 2) + 'px';
      spotlight.style.height = (rect.height + pad * 2) + 'px';

      // Scroll target into view if needed
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Tooltip content
      var isLast = stepIdx === steps.length - 1;
      tooltip.innerHTML =
        '<div class="bs-onboard-tooltip__step">' + (stepIdx + 1) + ' / ' + steps.length + '</div>' +
        '<div class="bs-onboard-tooltip__icon"><i class="fas ' + step.icon + '" aria-hidden="true"></i></div>' +
        '<div class="bs-onboard-tooltip__title">' + step.title + '</div>' +
        '<div class="bs-onboard-tooltip__desc">' + step.desc + '</div>' +
        '<div class="bs-onboard-tooltip__actions">' +
          (stepIdx > 0 ? '<button class="bs-onboard-btn bs-onboard-btn--back" aria-label="Previous step"><i class="fas fa-arrow-left" aria-hidden="true"></i> Back</button>' : '<span></span>') +
          '<button class="bs-onboard-btn bs-onboard-btn--next" aria-label="' + (isLast ? 'Close guide' : 'Next step') + '">' + (isLast ? 'Got It!' : 'Next <i class="fas fa-arrow-right" aria-hidden="true"></i>') + '</button>' +
        '</div>';

      // Position tooltip below or above target
      var tooltipHeight = 200; // estimate
      var spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow > tooltipHeight + 40) {
        tooltip.style.top = (rect.bottom + pad + 12) + 'px';
        tooltip.style.bottom = '';
        tooltip.classList.remove('bs-onboard-tooltip--above');
        tooltip.classList.add('bs-onboard-tooltip--below');
      } else {
        tooltip.style.top = '';
        tooltip.style.bottom = (window.innerHeight - rect.top + pad + 12) + 'px';
        tooltip.classList.remove('bs-onboard-tooltip--below');
        tooltip.classList.add('bs-onboard-tooltip--above');
      }

      // Bind buttons
      var nextBtn = tooltip.querySelector('.bs-onboard-btn--next');
      var backBtn = tooltip.querySelector('.bs-onboard-btn--back');
      if (nextBtn) {
        nextBtn.addEventListener('click', function() {
          if (isLast) { cleanup(); }
          else { currentStep++; positionStep(currentStep); }
        }, { once: true });
      }
      if (backBtn) {
        backBtn.addEventListener('click', function() {
          currentStep--;
          positionStep(currentStep);
        }, { once: true });
      }
    }

    function cleanup() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    // Dismiss on backdrop click
    backdrop.addEventListener('click', function(e) {
      if (e.target === backdrop) cleanup();
    });

    // Safety timeout — auto-dismiss if stuck
    var safetyTimer = setTimeout(function() { cleanup(); }, 8000);
    var origCleanup = cleanup;
    cleanup = function() { clearTimeout(safetyTimer); origCleanup(); };

    // Start first step after a brief delay for DOM to settle
    setTimeout(function() {
      // Verify all targets exist AND are visible before starting
      var allTargetsReady = steps.every(function(s) {
        var el = document.getElementById(s.target);
        return el && el.offsetHeight > 0;
      });
      if (!allTargetsReady) { cleanup(); return; }
      positionStep(0);
    }, 600);
  }

  window.BsLobbyOnboarding = {
    show: show
  };
})();

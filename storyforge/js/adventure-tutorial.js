/**
 * adventure-tutorial.js — First-time player tutorial overlay for StoryForge
 * Shows a step-by-step spotlight walkthrough on the first adventure.
 *
 * API:
 *   AdventureTutorial.start()  — begin tutorial (only if not previously completed)
 *   AdventureTutorial.reset()  — clear completion flag (for testing)
 */
var AdventureTutorial = (function () {
  'use strict';

  var STORAGE_KEY = 'sf_tutorial_done';
  var overlay = null;
  var tooltip = null;
  var currentStep = 0;

  var STEPS = [
    {
      target: '#sceneText',
      title: 'Your Story',
      text: 'This is your adventure unfolding in real-time. Click the text to skip the typewriter effect.',
      position: 'bottom'
    },
    {
      target: '#choicesContainer',
      title: 'Make Your Choice',
      text: 'Pick your path by clicking a choice. You can also press keys 1–4 for quick selection.',
      position: 'top'
    },
    {
      target: '.adv-sidebar',
      title: 'Character Sheet',
      text: 'Your stats, HP, inventory, and companions live here. Items and allies affect your skill checks.',
      position: 'left'
    },
    {
      target: '#inventoryContainer',
      title: 'Inventory',
      text: 'Tap any item to see its details. Equip weapons and armor to boost your skill checks. Drop items you don\'t need — but quest items are locked and can\'t be removed.',
      position: 'left'
    },
    {
      target: '#companionsContainer',
      title: 'Companions',
      text: 'Allies you meet on your journey appear here. Companions grant bonuses to skill checks and will speak and act in scenes — keep them alive!',
      position: 'left'
    },
    {
      target: '#narrationToggle',
      title: 'AI Narration',
      text: 'Toggle AI voice narration on or off. You can also press N anytime during play.',
      position: 'bottom'
    },
    {
      target: '#pauseBtn',
      title: 'Pause Menu',
      text: 'Pause to save your adventure, adjust settings, or quit. Your progress is auto-saved each turn.',
      position: 'bottom'
    }
  ];

  function isCompleted() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function markCompleted() {
    localStorage.setItem(STORAGE_KEY, '1');
  }

  function start() {
    if (isCompleted()) return;
    // Small delay so the scene has time to render
    setTimeout(function () { showStep(0); }, 1500);
  }

  function showStep(index) {
    currentStep = index;
    var step = STEPS[index];
    if (!step) { finish(); return; }

    var targetEl = document.querySelector(step.target);
    if (!targetEl || targetEl.offsetParent === null) {
      // Target not visible — skip this step
      showStep(index + 1);
      return;
    }

    createOverlay();
    positionSpotlight(targetEl);
    renderTooltip(step, targetEl, index);
  }

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'adv-tutorial-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) advance();
    });
    document.body.appendChild(overlay);
  }

  function positionSpotlight(targetEl) {
    var rect = targetEl.getBoundingClientRect();
    var pad = 8;
    overlay.style.setProperty('--spot-top', (rect.top - pad) + 'px');
    overlay.style.setProperty('--spot-left', (rect.left - pad) + 'px');
    overlay.style.setProperty('--spot-width', (rect.width + pad * 2) + 'px');
    overlay.style.setProperty('--spot-height', (rect.height + pad * 2) + 'px');
  }

  function renderTooltip(step, targetEl, index) {
    if (tooltip) tooltip.remove();
    tooltip = document.createElement('div');
    tooltip.className = 'adv-tutorial-tooltip';

    var stepCount = '<span class="adv-tutorial-tooltip__step">' + (index + 1) + ' / ' + STEPS.length + '</span>';
    tooltip.innerHTML =
      '<div class="adv-tutorial-tooltip__header">' +
        '<strong>' + step.title + '</strong>' + stepCount +
      '</div>' +
      '<p>' + step.text + '</p>' +
      '<div class="adv-tutorial-tooltip__actions">' +
        '<button class="adv-tutorial-tooltip__skip">Skip Tutorial</button>' +
        '<button class="adv-tutorial-tooltip__next">' +
          (index < STEPS.length - 1 ? 'Next' : 'Got It') +
        '</button>' +
      '</div>';

    document.body.appendChild(tooltip);

    // Position tooltip relative to target
    var rect = targetEl.getBoundingClientRect();
    var tRect = tooltip.getBoundingClientRect();

    var top, left;
    switch (step.position) {
      case 'bottom':
        top = rect.bottom + 12;
        left = rect.left + rect.width / 2 - tRect.width / 2;
        break;
      case 'top':
        top = rect.top - tRect.height - 12;
        left = rect.left + rect.width / 2 - tRect.width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tRect.height / 2;
        left = rect.left - tRect.width - 12;
        break;
      default:
        top = rect.bottom + 12;
        left = rect.left;
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, window.innerWidth - tRect.width - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - tRect.height - 12));

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';

    // Bind buttons
    tooltip.querySelector('.adv-tutorial-tooltip__skip').addEventListener('click', finish);
    tooltip.querySelector('.adv-tutorial-tooltip__next').addEventListener('click', advance);
  }

  function advance() {
    showStep(currentStep + 1);
  }

  function finish() {
    markCompleted();
    if (tooltip) { tooltip.remove(); tooltip = null; }
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    start: start,
    reset: reset
  };
})();

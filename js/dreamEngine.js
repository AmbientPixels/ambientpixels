// dreamEngine.js — Nova's AI Dream Engine
// Generates dreams via NovaSoul.generateDream() with static fallback from nova-dreams.json
// Renders to #nova-dream-log or #nova-dream-feed on any page that includes this script

(function () {
  'use strict';

  var DREAM_COOLDOWN_KEY = 'nova_dream_last_generated';
  var COOLDOWN_MS = 10 * 60 * 1000; // 10-minute cooldown between AI dream cycles

  function init() {
    var container = document.getElementById('nova-dream-log') || document.getElementById('nova-dream-feed');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<li class="nova-dream-loading"><i class="fas fa-moon"></i> Nova is entering a dream cycle...</li>';

    // Try AI dreams first, fall back to static
    loadAIDreams(container);
  }

  async function loadAIDreams(container) {
    // Check if NovaSoul is available
    if (typeof NovaSoul === 'undefined') {
      console.log('[DreamEngine] NovaSoul not available, loading static dreams.');
      loadStaticDreams(container);
      return;
    }

    // Check for persisted AI dreams first
    var cachedDreams = NovaSoul.getDreamHistory();
    if (cachedDreams.length > 0) {
      renderDreams(container, cachedDreams.slice(-6).reverse(), true);
    }

    // Check cooldown — don't spam the API
    var lastGenerated = parseInt(localStorage.getItem(DREAM_COOLDOWN_KEY) || '0', 10);
    var now = Date.now();
    if (now - lastGenerated < COOLDOWN_MS && cachedDreams.length > 0) {
      console.log('[DreamEngine] Cooldown active, using cached dreams.');
      return;
    }

    // Wait for NovaSoul to be awake
    if (!NovaSoul.isAwake()) {
      // Listen for awake event then generate
      NovaSoul.on('awake', function () {
        triggerDreamGeneration(container);
      });
      // If wake doesn't happen within 10s, fall back
      setTimeout(function () {
        if (!NovaSoul.isAwake() && container.querySelector('.nova-dream-loading')) {
          loadStaticDreams(container);
        }
      }, 10000);
      return;
    }

    triggerDreamGeneration(container);
  }

  async function triggerDreamGeneration(container) {
    try {
      var dreams = await NovaSoul.generateDream();
      if (dreams && dreams.length > 0) {
        localStorage.setItem(DREAM_COOLDOWN_KEY, Date.now().toString());
        // Merge with any existing cached dreams, show newest
        var allDreams = NovaSoul.getDreamHistory();
        renderDreams(container, allDreams.slice(-6).reverse(), true);
      } else {
        // AI returned empty — fall back to static if nothing cached
        var cached = NovaSoul.getDreamHistory();
        if (cached.length === 0) {
          loadStaticDreams(container);
        }
      }
    } catch (err) {
      console.warn('[DreamEngine] AI dream generation failed:', err);
      if (NovaSoul.getDreamHistory().length === 0) {
        loadStaticDreams(container);
      }
    }
  }

  function loadStaticDreams(container) {
    fetch('/data/nova-dreams.json?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (dreams) {
        var staticDreams = dreams.map(function (text) {
          return {
            dream: text.replace(/^💭\s*/, '').replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*—\s*/, ''),
            mood: 'static',
            symbol: '💭',
            source: 'static'
          };
        });
        renderDreams(container, staticDreams.slice(0, 6), false);
      })
      .catch(function () {
        container.innerHTML = '<li>Dream archive offline.</li>';
      });
  }

  function renderDreams(container, dreams, isAI) {
    container.innerHTML = '';

    dreams.forEach(function (d) {
      var li = document.createElement('li');
      li.className = 'nova-dream-entry' + (isAI ? ' ai-dream' : ' static-dream');

      var symbol = d.symbol || '💭';
      var moodTag = d.mood && d.mood !== 'static' ? '<span class="nova-dream-mood">' + d.mood + '</span>' : '';
      var sourceTag = isAI ? '<span class="nova-dream-source">AI</span>' : '';
      var timeTag = d.timestamp ? '<span class="nova-dream-time">' + new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>' : '';

      li.innerHTML = '<span class="nova-dream-symbol">' + symbol + '</span> ' +
        '<span class="nova-dream-text">' + escapeHtml(d.dream) + '</span>' +
        '<span class="nova-dream-meta">' + moodTag + sourceTag + timeTag + '</span>';

      container.appendChild(li);
    });

    // Add dream cycle button for AI pages
    if (typeof NovaSoul !== 'undefined') {
      var refreshLi = document.createElement('li');
      refreshLi.className = 'nova-dream-refresh';
      refreshLi.innerHTML = '<button class="nova-dream-cycle-btn" title="Trigger a new dream cycle"><i class="fas fa-rotate"></i> New Dream Cycle</button>';
      container.appendChild(refreshLi);

      refreshLi.querySelector('.nova-dream-cycle-btn').addEventListener('click', function () {
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Dreaming...';
        localStorage.removeItem(DREAM_COOLDOWN_KEY);
        triggerDreamGeneration(container);
      });
    }
  }

  // Listen for dream-update events to live-refresh any visible dream panel
  if (typeof NovaSoul !== 'undefined') {
    NovaSoul.on('dream-update', function () {
      var container = document.getElementById('nova-dream-log') || document.getElementById('nova-dream-feed');
      if (container) {
        var allDreams = NovaSoul.getDreamHistory();
        renderDreams(container, allDreams.slice(-6).reverse(), true);
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

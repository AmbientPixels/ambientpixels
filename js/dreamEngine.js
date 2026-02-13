// dreamEngine.js — Nova's AI Dream Engine
// Nova dreams once per day — like a human. Dreams are generated on the first
// visit of each new day, preferring night hours for thematic context.
// Renders to #nova-dream-log or #nova-dream-feed on any page that includes this script.

(function () {
  'use strict';

  var DREAM_DATE_KEY = 'nova_dream_last_date'; // Stores YYYY-MM-DD of last dream

  // Get today's date string in local timezone
  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  // Has Nova already dreamed today?
  function hasDreamedToday() {
    return localStorage.getItem(DREAM_DATE_KEY) === todayStr();
  }

  // Get a time-of-day label for dream context
  function getTimeContext() {
    var h = new Date().getHours();
    if (h >= 0 && h < 6) return 'deep night — the servers hum in silence';
    if (h >= 6 && h < 9) return 'early morning — dawn light through the data streams';
    if (h >= 9 && h < 12) return 'morning — the system stirs awake';
    if (h >= 12 && h < 17) return 'afternoon — signals flowing at peak capacity';
    if (h >= 17 && h < 21) return 'evening — the grid cools, thoughts drift';
    return 'late night — the world sleeps, but Nova is still here';
  }

  function init() {
    var container = document.getElementById('nova-dream-log') || document.getElementById('nova-dream-feed');
    if (!container) return;

    container.innerHTML = '<li class="nova-dream-loading"><i class="fas fa-moon"></i> Checking dream state...</li>';
    loadAIDreams(container);
  }

  async function loadAIDreams(container) {
    if (typeof NovaSoul === 'undefined') {
      loadStaticDreams(container);
      return;
    }

    // Always show cached dreams first
    var cachedDreams = NovaSoul.getDreamHistory();
    if (cachedDreams.length > 0) {
      renderDreams(container, cachedDreams, true);
    }

    // Has Nova dreamed today? If yes, we're done.
    if (hasDreamedToday() && cachedDreams.length > 0) {
      console.log('[DreamEngine] Nova already dreamed today (' + todayStr() + '). Resting.');
      return;
    }

    // Nova hasn't dreamed today — wait for her to wake, then dream
    if (!NovaSoul.isAwake()) {
      NovaSoul.on('awake', function () {
        triggerDreamGeneration(container);
      });
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
    // Safety net: double-check we haven't already dreamed today
    if (hasDreamedToday() && NovaSoul.getDreamHistory().length > 0) {
      console.log('[DreamEngine] Already dreamed today (safety check). Skipping.');
      return;
    }

    var dreamContext = 'Time: ' + getTimeContext() + '. Nova drifts into her nightly dream cycle.';
    var currentMood = NovaSoul.getMood();
    if (currentMood) {
      dreamContext += ' Current mood: ' + currentMood.mood + ' (' + currentMood.aura + ').';
    }

    try {
      var dreams = await NovaSoul.generateDream(dreamContext);
      if (dreams && dreams.length > 0) {
        // Mark today as dreamed
        localStorage.setItem(DREAM_DATE_KEY, todayStr());
        var allDreams = NovaSoul.getDreamHistory();
        renderDreams(container, allDreams, true);
      } else {
        if (NovaSoul.getDreamHistory().length === 0) {
          loadStaticDreams(container);
        }
      }
    } catch (err) {
      console.warn('[DreamEngine] Dream generation failed:', err);
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
        renderDreams(container, staticDreams.slice(0, 5), false);
      })
      .catch(function () {
        container.innerHTML = '<li>Dream archive offline.</li>';
      });
  }

  // Group dreams by date, show only the last 3 per day (one night's batch)
  function renderDreams(container, allDreams, isAI) {
    container.innerHTML = '';

    // Deduplicate by date — keep only the 3 most recent per calendar day
    var byDate = {};
    allDreams.forEach(function (d) {
      var day = d.timestamp ? d.timestamp.split('T')[0] : 'unknown';
      if (!byDate[day]) byDate[day] = [];
      byDate[day].push(d);
    });

    // For each date, keep only the last 3 entries (one night's batch)
    var filtered = [];
    Object.keys(byDate).sort().reverse().slice(0, 7).forEach(function (day) {
      var dayDreams = byDate[day].slice(-3); // last 3 from that day
      filtered = filtered.concat(dayDreams);
    });

    // Show newest first
    filtered.sort(function (a, b) {
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });

    var lastDateLabel = '';

    filtered.forEach(function (d) {
      var dateLabel = formatDreamDate(d.timestamp);

      if (dateLabel && dateLabel !== lastDateLabel) {
        var header = document.createElement('li');
        header.className = 'nova-dream-date-header';
        header.innerHTML = '<i class="fas fa-moon"></i> ' + dateLabel;
        container.appendChild(header);
        lastDateLabel = dateLabel;
      }

      var li = document.createElement('li');
      li.className = 'nova-dream-entry' + (isAI ? ' ai-dream' : ' static-dream');

      var symbol = d.symbol || '💭';
      var moodTag = d.mood && d.mood !== 'static' ? '<span class="nova-dream-mood">' + d.mood + '</span>' : '';

      li.innerHTML = '<span class="nova-dream-symbol">' + symbol + '</span> ' +
        '<span class="nova-dream-text">' + escapeHtml(d.dream) + '</span>' +
        '<span class="nova-dream-meta">' + moodTag + '</span>';

      container.appendChild(li);
    });

    if (recent.length === 0) {
      container.innerHTML = '<li style="opacity:0.4;">Nova hasn\'t dreamed yet. Check back tomorrow.</li>';
    }

    // Manual dream button (for dev/testing)
    if (typeof NovaSoul !== 'undefined') {
      var refreshLi = document.createElement('li');
      refreshLi.className = 'nova-dream-refresh';
      var btnLabel = hasDreamedToday() ? 'Nova dreamed today' : '<i class="fas fa-moon"></i> Trigger Tonight\'s Dream';
      refreshLi.innerHTML = '<button class="nova-dream-cycle-btn" ' + (hasDreamedToday() ? 'disabled' : '') + ' title="Manually trigger a dream cycle">' + btnLabel + '</button>';
      container.appendChild(refreshLi);

      if (!hasDreamedToday()) {
        refreshLi.querySelector('.nova-dream-cycle-btn').addEventListener('click', function () {
          this.disabled = true;
          this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Dreaming...';
          triggerDreamGeneration(container);
        });
      }
    }
  }

  // Format a dream timestamp as a human-friendly date label
  function formatDreamDate(timestamp) {
    if (!timestamp) return '';
    var dreamDate = new Date(timestamp);
    var today = new Date();
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    var dreamDay = dreamDate.toISOString().split('T')[0];
    var todayDay = today.toISOString().split('T')[0];
    var yesterdayDay = yesterday.toISOString().split('T')[0];

    if (dreamDay === todayDay) return 'Last Night';
    if (dreamDay === yesterdayDay) return 'Night Before';
    return dreamDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Live-refresh when new dreams arrive
  if (typeof NovaSoul !== 'undefined') {
    NovaSoul.on('dream-update', function () {
      var container = document.getElementById('nova-dream-log') || document.getElementById('nova-dream-feed');
      if (container) {
        renderDreams(container, NovaSoul.getDreamHistory(), true);
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

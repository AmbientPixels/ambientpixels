// dreamEngine.js — Nova Daily Brief Engine
// Nova generates one brief per day. Briefs are generated on the first visit
// of each new day, with context adjusted to current operating period.
// Renders to #nova-dream-log or #nova-dream-feed on any page that includes this script.

(function () {
  'use strict';

  var DREAM_DATE_KEY = 'nova_dream_last_date'; // Stores YYYY-MM-DD of last brief

  // Get today's date string in local timezone
  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  // Has Nova already generated today's brief?
  function hasDreamedToday() {
    return localStorage.getItem(DREAM_DATE_KEY) === todayStr();
  }

  // Get a time-of-day label for brief context
  function getTimeContext() {
    var h = new Date().getHours();
    if (h >= 0 && h < 6) return 'overnight operations window';
    if (h >= 6 && h < 9) return 'morning startup window';
    if (h >= 9 && h < 12) return 'active morning execution window';
    if (h >= 12 && h < 17) return 'afternoon execution peak';
    if (h >= 17 && h < 21) return 'evening wrap-up window';
    return 'late-night continuity window';
  }

  function init() {
    var container = document.getElementById('nova-dream-log') || document.getElementById('nova-dream-feed');
    if (!container) return;

    container.innerHTML = '<li class="nova-dream-loading"><i class="fas fa-clipboard-list"></i> Checking latest system brief...</li>';
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

    // Has Nova generated today's brief? If yes, we're done.
    if (hasDreamedToday() && cachedDreams.length > 0) {
      console.log('[DreamEngine] Daily brief already generated (' + todayStr() + ').');
      return;
    }

    // Brief not generated today — wait for Nova to wake, then generate
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
    // Safety net: double-check we haven't already generated today's brief
    if (hasDreamedToday() && NovaSoul.getDreamHistory().length > 0) {
      console.log('[DreamEngine] Daily brief already generated (safety check). Skipping.');
      return;
    }

    var dreamContext = 'Generate a concise executive system brief for AmbientPixels. Time window: ' + getTimeContext() + '. Focus on operations, risks, progress, and notable signals.';
    var currentMood = NovaSoul.getMood();
    if (currentMood) {
      dreamContext += ' Current operator state: ' + currentMood.mood + ' (' + currentMood.aura + ').';
    }

    try {
      var dreams = await NovaSoul.generateDream(dreamContext);
      if (dreams && dreams.length > 0) {
        // Mark today as generated
        localStorage.setItem(DREAM_DATE_KEY, todayStr());
        var allDreams = NovaSoul.getDreamHistory();
        renderDreams(container, allDreams, true);
      } else {
        if (NovaSoul.getDreamHistory().length === 0) {
          loadStaticDreams(container);
        }
      }
    } catch (err) {
      console.warn('[DreamEngine] Brief generation failed:', err);
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
            symbol: '•',
            source: 'static'
          };
        });
        renderDreams(container, staticDreams.slice(0, 5), false);
      })
      .catch(function () {
        container.innerHTML = '<li>System brief archive offline.</li>';
      });
  }

  function buildDemoMetrics(seed) {
    var src = String(seed || todayStr());
    var hash = 0;
    for (var i = 0; i < src.length; i++) {
      hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
    }
    var n = Math.abs(hash);
    return {
      tasksCreated: 9 + (n % 8),
      approvalsProcessed: 4 + (n % 5),
      risksFlagged: 1 + (n % 3),
      systemStatus: n % 5 === 0 ? 'Degraded' : 'Operational'
    };
  }

  function getMetricFromText(text, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var match = text.match(patterns[i]);
      if (match && match[1] !== undefined) {
        var value = parseInt(match[1], 10);
        if (!Number.isNaN(value)) return value;
      }
    }
    return null;
  }

  function buildExecutiveSnapshot(day, dayEntries) {
    var combined = dayEntries.map(function (entry) { return entry.dream || ''; }).join(' ');
    var demo = buildDemoMetrics(day);

    var tasksCreated = getMetricFromText(combined, [
      /tasks?\s*created\s*[:=-]\s*(\d+)/i,
      /created\s*(\d+)\s*tasks?/i
    ]);
    var approvalsProcessed = getMetricFromText(combined, [
      /approvals?\s*(?:processed|completed)?\s*[:=-]\s*(\d+)/i,
      /processed\s*(\d+)\s*approvals?/i
    ]);
    var risksFlagged = getMetricFromText(combined, [
      /risks?\s*flagged\s*[:=-]\s*(\d+)/i,
      /flagged\s*(\d+)\s*risks?/i
    ]);

    var status = /\bdegraded|incident|outage|blocked\b/i.test(combined) ? 'Degraded' : 'Operational';

    return {
      dateLabel: formatBriefDate(day),
      tasksCreated: tasksCreated !== null ? tasksCreated : demo.tasksCreated,
      approvalsProcessed: approvalsProcessed !== null ? approvalsProcessed : demo.approvalsProcessed,
      risksFlagged: risksFlagged !== null ? risksFlagged : demo.risksFlagged,
      systemStatus: status || demo.systemStatus
    };
  }

  function formatBriefDate(day) {
    if (!day || day === 'unknown') return 'Unknown Date';
    var parts = day.split('-');
    if (parts.length !== 3) return day;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Group briefs by date and render an executive snapshot per day.
  function renderDreams(container, allDreams, isAI) {
    container.innerHTML = '';

    // Deduplicate by date — keep only the 3 most recent per calendar day
    var byDate = {};
    allDreams.forEach(function (d) {
      var day = d.timestamp ? d.timestamp.split('T')[0] : 'unknown';
      if (!byDate[day]) byDate[day] = [];
      byDate[day].push(d);
    });

    var dayKeys = Object.keys(byDate).sort().reverse().slice(0, 7);

    dayKeys.forEach(function (day) {
      var dayEntries = byDate[day].slice(-3);
      var snapshot = buildExecutiveSnapshot(day, dayEntries);
      var latestEntry = dayEntries[dayEntries.length - 1] || {};
      var latestTimestamp = latestEntry.timestamp;
      var headerLabel = formatDreamDate(latestTimestamp) || snapshot.dateLabel;
      var sourceLabel = isAI ? 'Live' : 'Demo fallback';
      var updatedLabel = formatBriefTime(latestTimestamp);
      var statusClass = snapshot.systemStatus === 'Degraded' ? 'is-degraded' : 'is-operational';

      var header = document.createElement('li');
      header.className = 'nova-dream-date-header';
      header.innerHTML = '<i class="fas fa-clipboard-list"></i> ' + escapeHtml(headerLabel);
      container.appendChild(header);

      var li = document.createElement('li');
      li.className = 'nova-dream-entry' + (isAI ? ' ai-dream' : ' static-dream');
      li.innerHTML = '<span class="nova-dream-text nova-brief-text">' +
        '<strong class="nova-brief-title">Brief — ' + escapeHtml(snapshot.dateLabel) + '</strong>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">Tasks created</span><span class="nova-brief-value">' + snapshot.tasksCreated + '</span></span>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">Approvals processed</span><span class="nova-brief-value">' + snapshot.approvalsProcessed + '</span></span>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">Risks flagged</span><span class="nova-brief-value">' + snapshot.risksFlagged + '</span></span>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">System status</span><span class="nova-brief-value nova-brief-chip ' + statusClass + '">' + escapeHtml(snapshot.systemStatus) + '</span></span>' +
        '<span class="nova-brief-row nova-brief-row--meta"><span class="nova-brief-label">Data source</span><span class="nova-brief-value">' + sourceLabel + '</span></span>' +
        '<span class="nova-brief-row nova-brief-row--meta"><span class="nova-brief-label">Last updated</span><span class="nova-brief-value">' + escapeHtml(updatedLabel) + '</span></span>' +
        '</span>';

      container.appendChild(li);
    });

    if (dayKeys.length === 0) {
      container.innerHTML = '<li style="opacity:0.4;">No system brief has been generated yet. Check back later today.</li>';
    }
  }

  // Format a brief timestamp as a human-friendly date label
  function formatDreamDate(timestamp) {
    if (!timestamp) return '';
    var dreamDate = new Date(timestamp);
    var today = new Date();
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    var dreamDay = dreamDate.toISOString().split('T')[0];
    var todayDay = today.toISOString().split('T')[0];
    var yesterdayDay = yesterday.toISOString().split('T')[0];

    if (dreamDay === todayDay) return 'Today';
    if (dreamDay === yesterdayDay) return 'Yesterday';
    return dreamDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatBriefTime(timestamp) {
    if (!timestamp) return 'N/A';
    var d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // Live-refresh when new brief entries arrive
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

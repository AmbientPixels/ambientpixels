// operator-brief.js — Nova home daily operator snapshot
(function () {
  'use strict';

  var API_BASE = (window.location.hostname.indexOf('ambientpixels.ai') !== -1)
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  function init() {
    var container = document.getElementById('nova-dream-log') || document.getElementById('nova-dream-feed');
    if (!container) return;

    container.innerHTML = '<li class="nova-dream-loading"><i class="fas fa-clipboard-list"></i> Loading latest operator snapshot...</li>';

    loadLatestBrief(container)
      .catch(function () {
        return loadLocalFallback(container);
      })
      .catch(function () {
        container.innerHTML = '<li style="opacity:0.55;">Operator snapshot is currently unavailable.</li>';
      });
  }

  function loadLatestBrief(container) {
    return fetch(API_BASE + '/dailyLog')
      .then(function (res) {
        if (!res.ok) throw new Error('dailyLog fetch failed');
        return res.json();
      })
      .then(function (entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
          throw new Error('no published daily logs');
        }

        var latest = entries[0];
        renderBrief(container, normalizeEntry(latest, 'Public daily log API'));
      });
  }

  function loadLocalFallback(container) {
    return fetch('/data/daily-logs.json?t=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('fallback log unavailable');
        return res.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error('empty fallback log');
        }

        var latest = rows[0] || {};
        renderBrief(container, {
          dateLabel: formatDateLabel(latest.timestamp),
          tasksCreated: 'N/A',
          approvalsProcessed: 'N/A',
          risksFlagged: 'N/A',
          systemStatus: inferStatusFromText((latest.message || '')),
          sourceLabel: 'Site activity fallback',
          updatedLabel: formatTimeLabel(latest.timestamp),
          founderPriority: latest.message || 'Review latest site activity and align next priority.'
        });
      });
  }

  function normalizeEntry(entry, sourceLabel) {
    var stats = entry && entry.stats ? entry.stats : {};
    var joinedText = [entry && entry.excerpt, entry && entry.title]
      .concat(Array.isArray(entry && entry.highlights) ? entry.highlights : [])
      .join(' ');

    return {
      dateLabel: entry && entry.date ? formatDateLabel(entry.date + 'T12:00:00') : 'Today',
      tasksCreated: asMetric(stats.tasks_created),
      approvalsProcessed: asMetric(stats.approvals_processed),
      risksFlagged: asMetric(stats.risks_flagged),
      systemStatus: inferStatusFromText(joinedText),
      sourceLabel: sourceLabel,
      updatedLabel: formatTimeLabel(entry && (entry.published_at || entry.generated_at)),
      founderPriority: pickFounderPriority(entry)
    };
  }

  function renderBrief(container, data) {
    var statusClass = data.systemStatus === 'Degraded' ? 'is-degraded' : 'is-operational';

    container.innerHTML = '';

    var header = document.createElement('li');
    header.className = 'nova-dream-date-header';
    header.innerHTML = '<i class="fas fa-clipboard-list"></i> ' + esc(data.dateLabel);
    container.appendChild(header);

    var li = document.createElement('li');
    li.className = 'nova-dream-entry ai-dream';
    li.innerHTML =
      '<span class="nova-dream-text nova-brief-text">' +
        '<strong class="nova-brief-title">Brief — ' + esc(data.dateLabel) + '</strong>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">Tasks created</span><span class="nova-brief-value">' + esc(String(data.tasksCreated)) + '</span></span>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">Approvals processed</span><span class="nova-brief-value">' + esc(String(data.approvalsProcessed)) + '</span></span>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">Risks flagged</span><span class="nova-brief-value">' + esc(String(data.risksFlagged)) + '</span></span>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">System status</span><span class="nova-brief-value nova-brief-chip ' + statusClass + '">' + esc(data.systemStatus) + '</span></span>' +
        '<span class="nova-brief-row"><span class="nova-brief-label">Operator Priority</span><span class="nova-brief-value">' + esc(data.founderPriority) + '</span></span>' +
        '<span class="nova-brief-row nova-brief-row--meta"><span class="nova-brief-label">Data source</span><span class="nova-brief-value">' + esc(data.sourceLabel) + '</span></span>' +
        '<span class="nova-brief-row nova-brief-row--meta"><span class="nova-brief-label">Last updated</span><span class="nova-brief-value">' + esc(data.updatedLabel) + '</span></span>' +
      '</span>';

    container.appendChild(li);
  }

  function asMetric(value) {
    return (typeof value === 'number' && value >= 0) ? value : 'N/A';
  }

  function pickFounderPriority(entry) {
    if (entry && Array.isArray(entry.highlights) && entry.highlights.length) {
      return entry.highlights[0];
    }
    if (entry && entry.excerpt) {
      return entry.excerpt.split('. ')[0] || 'Review latest activity and set next priority.';
    }
    return 'Review latest activity and set next priority.';
  }

  function inferStatusFromText(text) {
    var t = String(text || '');
    return /\b(error|incident|outage|degraded|blocked|failure)\b/i.test(t) ? 'Degraded' : 'Operational';
  }

  function formatDateLabel(dateInput) {
    var d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return 'Today';

    var today = new Date();
    var day = d.toISOString().split('T')[0];
    var todayDay = today.toISOString().split('T')[0];

    if (day === todayDay) return 'Today';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTimeLabel(dateInput) {
    var d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

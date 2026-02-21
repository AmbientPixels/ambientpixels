// /js/nova-awareness.js
(function () {
  'use strict';

  var DETECTIONS = {
    items: [
      {
        signal: 'Publishing cadence drift',
        severity: 'med',
        status: 'monitoring',
        lastSeenHours: 6,
        summary: 'Public milestone cadence slowed after the latest release window.'
      },
      {
        signal: 'Image pipeline latency',
        severity: 'high',
        status: 'open',
        lastSeenHours: 2,
        summary: 'Asset generation queue showed repeated slowdowns under peak load.'
      },
      {
        signal: 'Directive alignment check',
        severity: 'low',
        status: 'resolved',
        lastSeenHours: 28,
        summary: 'Recent milestones remain aligned with the active public roadmap narrative.'
      }
    ]
  };

  document.addEventListener('DOMContentLoaded', function () {
    var feedApi = window.PublicLogFeed;

    function $(id) { return document.getElementById(id); }
    function set(id, val) {
      var el = $(id);
      if (el) el.textContent = val;
    }

    function setEvaluated(hours) {
      var val = 'Last evaluated: not set';
      if (!isNaN(hours)) {
        if (hours < 1) val = 'Last evaluated: just now';
        else if (hours < 24) val = 'Last evaluated: ' + Math.round(hours) + 'h ago';
        else val = 'Last evaluated: ' + Math.round(hours / 24) + 'd ago';
      }
      set('aw-evaluated', val);
    }

    function esc(s) {
      var div = document.createElement('div');
      div.textContent = s || '';
      return div.innerHTML;
    }

    function relativeTimeFromIso(iso) {
      if (!iso) return '--';
      var diff = Date.now() - new Date(iso).getTime();
      if (isNaN(diff) || diff < 0) return '--';
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return Math.floor(hrs / 24) + 'd ago';
    }

    function pickTimestamp(entry) {
      return (entry && (entry.published_at || entry.generated_at || entry.updated || entry.date)) || null;
    }

    function getHoursSince(iso) {
      if (!iso) return NaN;
      return (Date.now() - new Date(iso).getTime()) / 3600000;
    }

    function computeFrame(hours) {
      if (isNaN(hours) || hours < 2) return 'Monitoring';
      if (hours < 24) return 'Operational';
      if (hours < 24 * 7) return 'Elevated';
      return 'Degraded';
    }

    function freshnessMeta(hours) {
      if (isNaN(hours)) return { text: 'Offline', klass: 'aw-fresh-pill aw-fresh--offline' };
      if (hours < 2) return { text: 'Live', klass: 'aw-fresh-pill aw-fresh--live' };
      if (hours < 24) return { text: 'Recent', klass: 'aw-fresh-pill aw-fresh--recent' };
      if (hours < 24 * 7) return { text: 'Stale', klass: 'aw-fresh-pill aw-fresh--stale' };
      return { text: 'Offline', klass: 'aw-fresh-pill aw-fresh--offline' };
    }

    function setFreshness(hours) {
      var pill = $('aw-fresh');
      if (!pill) return;
      var fresh = freshnessMeta(hours);
      pill.textContent = fresh.text;
      pill.className = fresh.klass;
    }

    function fmtLastSeen(hoursAgo) {
      if (hoursAgo < 1) return 'just now';
      if (hoursAgo < 24) return Math.round(hoursAgo) + 'h ago';
      return Math.round(hoursAgo / 24) + 'd ago';
    }

    function severityLabel(key) {
      if (key === 'high') return 'High';
      if (key === 'med') return 'Med';
      return 'Low';
    }

    function statusLabel(key) {
      if (key === 'resolved') return 'Resolved';
      if (key === 'open') return 'Open';
      return 'Monitoring';
    }

    function renderDetections() {
      var body = $('aw-detections-body');
      if (!body) return;

      set('aw-signal-count', 'Showing ' + DETECTIONS.items.length + ' signals');

      if (!DETECTIONS.items.length) {
        body.innerHTML = '<tr class="aw-empty-row"><td colspan="5">No public-safe detections published.</td></tr>';
        return;
      }

      body.innerHTML = DETECTIONS.items.map(function (item) {
        return '<tr>' +
          '<td>' + esc(item.signal) + '</td>' +
          '<td class="aw-col-center"><span class="aw-pill aw-pill--sev-' + esc(item.severity) + '">' + severityLabel(item.severity) + '</span></td>' +
          '<td class="aw-col-center"><span class="aw-pill aw-pill--status-' + esc(item.status) + '">' + statusLabel(item.status) + '</span></td>' +
          '<td class="aw-col-right">' + esc(fmtLastSeen(item.lastSeenHours)) + '</td>' +
          '<td><div class="aw-summary-truncate" title="' + esc(item.summary) + '">' + esc(item.summary) + '</div></td>' +
        '</tr>';
      }).join('');
    }

    function getEscalationCount() {
      return DETECTIONS.items.filter(function (item) {
        return item.severity === 'high' && item.status !== 'resolved';
      }).length;
    }

    function classifyMilestone(title) {
      var text = (title || '').toLowerCase();
      if (/(deploy|release|ship|rollout)/.test(text)) return 'Release stabilization';
      if (/(publish|blog|docs|article)/.test(text)) return 'Public publishing cadence';
      if (/(image|asset|gallery|render)/.test(text)) return 'Image pipeline quality';
      return 'Operator signal review';
    }

    function buildRecommendations(frame, escalateCount, milestoneTitle) {
      var focus = classifyMilestone(milestoneTitle);
      var nextAction = frame === 'Degraded'
        ? 'Run an executive review on the last public milestone and set a corrective checkpoint.'
        : 'Prioritize stabilizing the image pipeline before expanding channels.';

      var topRisk = escalateCount > 0
        ? escalateCount + ' high-severity signal(s) remain open in the public-safe queue.'
        : 'No high-severity public-safe signals are currently open.';

      var directive = 'Set one directive for ' + focus.toLowerCase() + ' with a measurable public milestone in the next 24 hours.';

      return [
        { label: 'Next action', value: nextAction },
        { label: 'Top risk', value: topRisk },
        { label: 'Suggested directive', value: directive }
      ];
    }

    function renderRecommendations(items) {
      var list = $('aw-recommendations');
      if (!list) return;
      list.innerHTML = items.slice(0, 3).map(function (item) {
        return '<li><strong class="aw-rec-label">' + esc(item.label) + ':</strong> ' + esc(item.value) + '</li>';
      }).join('');
    }

    function applyFeedContext(entries) {
      var newest = entries && entries.length ? entries[0] : null;
      var newestTs = pickTimestamp(newest);
      var hours = getHoursSince(newestTs);
      var frame = computeFrame(hours);
      var newestTitle = newest && newest.title ? newest.title : '';
      var recs = buildRecommendations(frame, getEscalationCount(), newestTitle);

      set('aw-focus', 'REDACTED');
      set('aw-frame', frame);
      set('aw-escalations', String(getEscalationCount()));
      set('aw-milestone', newestTitle ? newestTitle + ' · ' + relativeTimeFromIso(newestTs) : 'NOT SET');
      setFreshness(hours);
      setEvaluated(hours);
      renderRecommendations(recs);
    }

    renderDetections();

    if (!feedApi || typeof feedApi.fetchDailyLogFeed !== 'function') {
      set('aw-frame', 'Monitoring');
      set('aw-focus', 'REDACTED');
      setFreshness(NaN);
      setEvaluated(NaN);
      set('aw-milestone', 'NOT SET');
      renderRecommendations(buildRecommendations('Monitoring', getEscalationCount(), ''));
      return;
    }

    feedApi.fetchDailyLogFeed()
      .then(function (entries) {
        applyFeedContext(entries || []);
      })
      .catch(function () {
        set('aw-focus', 'REDACTED');
        set('aw-frame', 'Monitoring');
        set('aw-milestone', 'NOT SET');
        setFreshness(NaN);
        setEvaluated(NaN);
        renderRecommendations(buildRecommendations('Monitoring', getEscalationCount(), ''));
      });
  });
})();

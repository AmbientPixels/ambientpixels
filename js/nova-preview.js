// nova-preview.js
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var feedApi = window.PublicLogFeed;
    var $ = function (id) { return document.getElementById(id); };

    function setText(id, val) {
      var el = $(id);
      if (el) el.textContent = val;
    }

    function relativeTime(iso) {
      if (!iso) return '--';
      var diff = Date.now() - new Date(iso).getTime();
      if (isNaN(diff) || diff < 0) return '--';
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      var days = Math.floor(hrs / 24);
      return days + 'd ago';
    }

    function classifyEvent(entry) {
      var text = ((entry && entry.title) || '') + ' ' + ((entry && entry.excerpt) || '');
      text = text.toLowerCase();
      if (/(deploy|release|ship|launched|rollout)/.test(text)) return { label: 'Deploy', key: 'deploy' };
      if (/(standup|brief|sync|check-in)/.test(text)) return { label: 'Standup', key: 'standup' };
      if (/(publish|published|post|article|blog|doc)/.test(text)) return { label: 'Publish', key: 'publish' };
      if (/(directive|objective|roadmap|priority)/.test(text)) return { label: 'Directive', key: 'directive' };
      if (/(approval|approved|review|reviewed|signoff)/.test(text)) return { label: 'Approval', key: 'approval' };
      if (/(image|art|render|gallery|visual|asset)/.test(text)) return { label: 'Image', key: 'image' };
      return { label: 'System', key: 'system' };
    }

    function pickEntryTimestamp(entry) {
      return (entry && (entry.published_at || entry.generated_at || entry.updated || entry.date)) || null;
    }

    function computeOperatorState(newestIso, hasFeedError) {
      if (hasFeedError) return 'Monitoring';
      if (!newestIso) return 'Monitoring';
      var hours = (Date.now() - new Date(newestIso).getTime()) / 3600000;
      if (isNaN(hours)) return 'Monitoring';
      if (hours < 2) return 'Monitoring';
      if (hours < 24) return 'Operational';
      if (hours < 24 * 7) return 'Elevated';
      return 'Degraded';
    }

    function freshnessFromHours(hours, hasSource) {
      if (!hasSource || isNaN(hours)) return { text: 'Offline', klass: 'gp-fresh-pill gp-fresh--offline' };
      if (hours < 2) return { text: 'Live', klass: 'gp-fresh-pill gp-fresh--live' };
      if (hours < 24) return { text: 'Recent', klass: 'gp-fresh-pill gp-fresh--preview' };
      if (hours < 24 * 7) return { text: 'Stale', klass: 'gp-fresh-pill gp-fresh--stale' };
      return { text: 'Offline', klass: 'gp-fresh-pill gp-fresh--offline' };
    }

    function setFreshness(hours, hasSource) {
      var pill = $('gp-fresh');
      if (!pill) return;
      var fresh = freshnessFromHours(hours, hasSource);
      pill.textContent = fresh.text;
      pill.className = fresh.klass;
    }

    function getMetaContent(name) {
      var el = document.querySelector('meta[name="' + name + '"]');
      return el ? el.getAttribute('content') : '';
    }

    function getVersionSource() {
      return fetch('/data/version.json?t=' + Date.now())
        .then(function (r) {
          if (!r.ok) throw new Error('version.json unavailable');
          return r.json();
        })
        .catch(function () {
          return {
            version: window.APP_VERSION || getMetaContent('app-version') || 'v--',
            build: window.APP_BUILD || getMetaContent('app-build') || '--',
            updated: window.APP_UPDATED || getMetaContent('app-updated') || ''
          };
        });
    }

    function emptyState() {
      return '<li class="gp-feed-empty">' +
        '<p class="gp-feed-empty-title">No public-safe events yet</p>' +
        '<p class="gp-feed-empty-body">This preview only shows redacted milestones published from the operator workspace.</p>' +
        '<div class="gp-feed-empty-cta">' +
          '<a href="/log/">Open Activity Log</a>' +
        '</div></li>';
    }

    function renderActivity(entries) {
      var feed = $('gp-feed');
      if (!feed) return;
      if (!entries || !entries.length) {
        feed.innerHTML = emptyState();
        return;
      }

      feed.innerHTML = entries.slice(0, 5).map(function (entry) {
        var type = classifyEvent(entry);
        var ts = pickEntryTimestamp(entry);
        return '<li class="gp-feed-item">' +
          '<div class="gp-feed-date">' + relativeTime(ts) + '</div>' +
          '<div class="gp-feed-body">' +
            '<div class="gp-feed-meta">' +
              '<span class="gp-feed-type gp-feed-type--' + type.key + '">' + type.label + '</span>' +
            '</div>' +
            '<div class="gp-feed-title">' + sanitize(entry.title || 'Untitled event') + '</div>' +
          '</div>' +
        '</li>';
      }).join('');
    }

    function sanitize(str) {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    Promise.all([
      getVersionSource(),
      (feedApi && typeof feedApi.fetchDailyLogFeed === 'function')
        ? feedApi.fetchDailyLogFeed()
        : Promise.reject(new Error('PublicLogFeed unavailable'))
    ]).then(function (arr) {
      var version = arr[0] || {};
      var entries = arr[1] || [];
      var newestIso = entries.length ? pickEntryTimestamp(entries[0]) : null;
      var hours = newestIso ? (Date.now() - new Date(newestIso).getTime()) / 3600000 : NaN;

      setText('gp-version', version.version || 'v--');
      setText('gp-build', version.build ? ('b' + version.build).replace('bb', 'b') : 'b--');
      setText('gp-state', computeOperatorState(newestIso, false));

      if (newestIso) {
        setText('gp-sync', relativeTime(newestIso));
        setFreshness(hours, true);
      } else {
        setText('gp-sync', relativeTime(version.updated));
        var vHours = version.updated ? (Date.now() - new Date(version.updated).getTime()) / 3600000 : NaN;
        setFreshness(vHours, !!version.updated);
      }

      renderActivity(entries);
    }).catch(function () {
      getVersionSource().then(function (version) {
        setText('gp-version', version.version || 'v--');
        setText('gp-build', version.build ? ('b' + version.build).replace('bb', 'b') : 'b--');
        setText('gp-state', 'Monitoring');
        setText('gp-sync', relativeTime(version.updated));
        var vHours = version.updated ? (Date.now() - new Date(version.updated).getTime()) / 3600000 : NaN;
        setFreshness(vHours, !!version.updated);
      }).catch(function () {
        setText('gp-version', 'v--');
        setText('gp-build', 'b--');
        setText('gp-state', 'Monitoring');
        setText('gp-sync', '--');
        setFreshness(NaN, false);
      });

      var feed = $('gp-feed');
      if (feed) feed.innerHTML = emptyState();
    });
  });
})();

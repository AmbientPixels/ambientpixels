// Pixel Agent Analytics — Creator-facing agent performance dashboard
(function () {
  'use strict';

  function getApiBase() {
    return window.location.hostname.includes('ambientpixels.ai')
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
      : '/api';
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return 'Never';
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    return new Date(dateStr).toLocaleDateString();
  }

  var main = document.getElementById('pa-analytics-content');
  if (!main) return;

  // Show loading
  main.innerHTML = '<div class="pa-analytics-loading"><div class="af-spinner" style="display:inline-block;margin-right:0.5rem"></div> Loading analytics...</div>';

  // Check auth — try Azure SWA auth first, fall back to CEO secret
  var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  var headers = { 'x-company-secret': 'pixelpusher' };

  if (isLocal) {
    loadAnalytics();
  } else {
    fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.clientPrincipal) {
        loadAnalytics();
      } else {
        // Not logged into B2C — try loading with CEO header anyway
        loadAnalytics();
      }
    }).catch(function () {
      // Auth check failed — try loading with CEO header
      loadAnalytics();
    });
  }

  function showAuthGate() {
    main.innerHTML =
      '<div class="pa-analytics-auth">' +
        '<i class="fas fa-lock"></i>' +
        '<h2>Sign In Required</h2>' +
        '<p>Sign in to see analytics for your agents.</p>' +
        '<a href="/pages/login.html?redirect=/pixel-agents/analytics.html" class="pa-analytics-empty-cta">' +
          '<i class="fas fa-sign-in-alt"></i> Sign In' +
        '</a>' +
      '</div>';
  }

  function loadAnalytics() {
    fetch(getApiBase() + '/pixel-agent-analytics', { headers: headers })
      .then(function (r) {
        if (r.status === 401) { showAuthGate(); return null; }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.error) {
          main.innerHTML = '<div class="pa-analytics-auth"><i class="fas fa-exclamation-triangle"></i><p>' + escapeHtml(data.error) + '</p></div>';
          return;
        }
        renderAnalytics(data);
      })
      .catch(function (err) {
        main.innerHTML = '<div class="pa-analytics-auth"><i class="fas fa-exclamation-triangle"></i><p>Failed to load analytics.</p></div>';
      });
  }

  function renderAnalytics(data) {
    var hasAgents = data.agents.length > 0 || data.pending.length > 0;

    if (!hasAgents) {
      main.innerHTML =
        '<div class="pa-analytics-empty">' +
          '<i class="fas fa-chart-line"></i>' +
          '<h2>No Agents Yet</h2>' +
          '<p>Build and submit an agent in Agent Forge to see your analytics here.</p>' +
          '<a href="/agent-forge/" class="pa-analytics-empty-cta"><i class="fas fa-hammer"></i> Open Agent Forge</a>' +
        '</div>';
      return;
    }

    var html = '';

    // Summary stats
    html += '<div class="pa-analytics-summary">' +
      '<div class="pa-analytics-stat">' +
        '<div class="pa-analytics-stat-value">' + data.summary.totalAgents + '</div>' +
        '<div class="pa-analytics-stat-label">Live Agents</div>' +
      '</div>' +
      '<div class="pa-analytics-stat">' +
        '<div class="pa-analytics-stat-value">' + data.summary.totalRuns + '</div>' +
        '<div class="pa-analytics-stat-label">Total Runs</div>' +
      '</div>' +
      '<div class="pa-analytics-stat pa-analytics-stat--highlight">' +
        '<div class="pa-analytics-stat-value">' + data.summary.runsLast7d + '</div>' +
        '<div class="pa-analytics-stat-label">Runs (7 days)</div>' +
      '</div>' +
      (data.summary.pendingCount > 0 ?
        '<div class="pa-analytics-stat">' +
          '<div class="pa-analytics-stat-value">' + data.summary.pendingCount + '</div>' +
          '<div class="pa-analytics-stat-label">Pending Review</div>' +
        '</div>' : '') +
    '</div>';

    // Live agents
    if (data.agents.length > 0) {
      html += '<div class="pa-analytics-section">' +
        '<div class="pa-analytics-section-title">Live Agents</div>' +
        '<div class="pa-analytics-grid">';

      data.agents.forEach(function (agent) {
        var portraitHtml = agent.portraitUrl
          ? '<img src="' + escapeHtml(agent.portraitUrl) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
          : '';
        var iconHtml = '<i class="' + escapeHtml(agent.icon || 'fas fa-robot') + '" style="' + (agent.portraitUrl ? 'display:none' : '') + '"></i>';

        html += '<div class="pa-analytics-card">' +
          '<div class="pa-analytics-card-portrait">' + portraitHtml + iconHtml + '</div>' +
          '<div class="pa-analytics-card-body">' +
            '<div class="pa-analytics-card-name">' + escapeHtml(agent.name) + '</div>' +
            '<div class="pa-analytics-card-tagline">' + escapeHtml(agent.tagline) + '</div>' +
            '<div class="pa-analytics-card-stats">' +
              '<div class="pa-analytics-card-stat">' +
                '<span class="pa-analytics-card-stat-value">' + agent.totalRuns + '</span>' +
                '<span class="pa-analytics-card-stat-label">Total Runs</span>' +
              '</div>' +
              '<div class="pa-analytics-card-stat">' +
                '<span class="pa-analytics-card-stat-value">' + agent.runsLast7d + '</span>' +
                '<span class="pa-analytics-card-stat-label">Last 7 Days</span>' +
              '</div>' +
              '<div class="pa-analytics-card-stat">' +
                '<span class="pa-analytics-card-stat-value">' + timeAgo(agent.lastRunAt) + '</span>' +
                '<span class="pa-analytics-card-stat-label">Last Run</span>' +
              '</div>' +
            '</div>' +
            '<div class="pa-analytics-card-meta">Approved ' + timeAgo(agent.approvedAt) + '</div>' +
          '</div>' +
        '</div>';
      });

      html += '</div></div>';
    }

    // Pending agents
    if (data.pending.length > 0) {
      html += '<div class="pa-analytics-section">' +
        '<div class="pa-analytics-section-title">Pending Review</div>' +
        '<div class="pa-analytics-grid">';

      data.pending.forEach(function (agent) {
        html += '<div class="pa-analytics-card pa-analytics-card--pending">' +
          '<div class="pa-analytics-card-portrait"><i class="fas fa-clock"></i></div>' +
          '<div class="pa-analytics-card-body">' +
            '<div class="pa-analytics-card-name">' + escapeHtml(agent.name) + '</div>' +
            '<div class="pa-analytics-card-tagline">' + escapeHtml(agent.tagline) + '</div>' +
            '<span class="pa-analytics-pending-badge"><i class="fas fa-clock"></i> Pending Review</span>' +
            '<div class="pa-analytics-card-meta">Submitted ' + timeAgo(agent.submittedAt) + '</div>' +
          '</div>' +
        '</div>';
      });

      html += '</div></div>';
    }

    main.innerHTML = html;
  }
})();

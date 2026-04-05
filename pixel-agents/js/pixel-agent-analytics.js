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

  // Check auth via Azure SWA — forward principal to Function App
  var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  var headers = {};

  if (isLocal) {
    loadAnalytics();
  } else {
    fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.clientPrincipal) {
        // Forward the B2C principal to the Function App
        headers['x-ms-client-principal'] = btoa(JSON.stringify(d.clientPrincipal));
        loadAnalytics();
      } else {
        showAuthGate();
      }
    }).catch(function () {
      showAuthGate();
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

    // Revenue share earnings card
    if (data.summary.estimatedEarnings !== undefined) {
      html += '<div class="pa-analytics-earnings">' +
        '<div class="pa-analytics-earnings-header">' +
          '<i class="fas fa-coins"></i>' +
          '<span>Revenue Share Estimate</span>' +
          '<span class="pa-analytics-earnings-badge">Preview</span>' +
        '</div>' +
        '<div class="pa-analytics-earnings-body">' +
          '<div class="pa-analytics-earnings-total">' +
            '<div class="pa-analytics-earnings-amount">$' + parseFloat(data.summary.estimatedEarnings).toFixed(2) + '</div>' +
            '<div class="pa-analytics-earnings-label">Total Attributed Earnings</div>' +
          '</div>' +
          '<div class="pa-analytics-earnings-recent">' +
            '<div class="pa-analytics-earnings-amount">$' + parseFloat(data.summary.earningsLast7d || 0).toFixed(2) + '</div>' +
            '<div class="pa-analytics-earnings-label">Last 7 Days</div>' +
          '</div>' +
        '</div>' +
        '<div class="pa-analytics-earnings-note">' +
          '<i class="fas fa-info-circle"></i> 40% of Pro revenue distributed to creators monthly. Payouts via Stripe coming soon.' +
        '</div>' +
      '</div>';
    }

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
              (agent.estimatedEarnings ? '<div class="pa-analytics-card-stat">' +
                '<span class="pa-analytics-card-stat-value pa-text-success">$' + agent.estimatedEarnings + '</span>' +
                '<span class="pa-analytics-card-stat-label">Est. Earnings</span>' +
              '</div>' : '') +
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

    // Creator leaderboard
    if (data.leaderboard && data.leaderboard.length > 0) {
      html += '<div class="pa-analytics-section">' +
        '<div class="pa-analytics-section-title"><i class="fas fa-trophy" style="color:var(--pa-warning);margin-right:6px"></i>Creator Leaderboard</div>' +
        '<div class="pa-leaderboard">';

      data.leaderboard.forEach(function (entry) {
        var rankHtml = entry.rank === 1 ? '<span class="pa-lb-medal pa-lb-gold">1</span>' :
                       entry.rank === 2 ? '<span class="pa-lb-medal pa-lb-silver">2</span>' :
                       entry.rank === 3 ? '<span class="pa-lb-medal pa-lb-bronze">3</span>' :
                       '<span class="pa-lb-rank">#' + entry.rank + '</span>';
        var isMe = entry.creatorId === data.userId;
        var rowClass = 'pa-leaderboard-row' + (isMe ? ' pa-leaderboard-row--me' : '');
        var tierBadge = entry.creatorTier === 'pro'
          ? '<span class="pa-lb-tier pa-lb-tier--pro">Pro 1.5x</span>'
          : '<span class="pa-lb-tier">Free 1x</span>';

        html += '<div class="' + rowClass + '">' +
          rankHtml +
          '<div class="pa-lb-info">' +
            '<span class="pa-lb-creator">' + escapeHtml(entry.creatorId) + '</span>' +
            tierBadge +
          '</div>' +
          '<span class="pa-lb-agents">' + entry.agentCount + ' agent' + (entry.agentCount !== 1 ? 's' : '') + '</span>' +
          '<span class="pa-lb-runs">' + entry.totalRuns + ' <small>runs</small></span>' +
          '<span class="pa-lb-earnings">$' + entry.estimatedEarnings + '</span>' +
        '</div>';
      });

      html += '</div></div>';
    }

    // Next payout estimate
    if (data.summary.nextPayoutEstimate !== undefined) {
      var nextDate = new Date();
      nextDate.setMonth(nextDate.getMonth() + 1, 1);
      var nextDateStr = nextDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      html += '<div class="pa-analytics-section">' +
        '<div class="pa-analytics-section-title"><i class="fas fa-calendar-check" style="color:var(--pa-secondary);margin-right:6px"></i>Next Payout</div>' +
        '<div class="pa-next-payout">' +
          '<div class="pa-next-payout-amount">~$' + parseFloat(data.summary.nextPayoutEstimate).toFixed(2) + '</div>' +
          '<div class="pa-next-payout-meta">' +
            'Estimated for ' + nextDateStr + ' &middot; ' +
            (data.revenueSharePercent || 50) + '% share &middot; ' +
            (data.creatorTier === 'pro' ? '1.5x' : '1x') + ' weight' +
          '</div>' +
          (parseFloat(data.summary.nextPayoutEstimate) < 25
            ? '<div class="pa-next-payout-note"><i class="fas fa-info-circle"></i> Below $25 minimum \u2014 earnings roll over to next month</div>'
            : '') +
        '</div>' +
      '</div>';
    }

    // Pro upgrade CTA (only for free creators with agents)
    if (data.creatorTier !== 'pro' && data.agents.length > 0) {
      html += '<div class="pa-pro-cta">' +
        '<div class="pa-pro-cta-content">' +
          '<div class="pa-pro-cta-badge">PRO</div>' +
          '<div>' +
            '<h3>Upgrade to Pro Creator</h3>' +
            '<p>Earn 70% instead of 50%. Get 1.5x run weight. Unlimited live agents.</p>' +
          '</div>' +
        '</div>' +
        '<a href="/pixel-agents/upgrade.html" class="pa-btn-primary"><i class="fas fa-rocket"></i> $12/mo</a>' +
      '</div>';
    }

    // Payout history table
    if (data.payoutHistory && data.payoutHistory.length > 0) {
      html += '<div class="pa-analytics-section">' +
        '<div class="pa-analytics-section-title"><i class="fas fa-receipt" style="color:var(--pa-text-muted);margin-right:6px"></i>Payout History</div>' +
        '<div class="pa-payout-history">' +
          '<div class="pa-payout-history-header">' +
            '<span>Month</span><span>Amount</span><span>Status</span><span>Transfer ID</span>' +
          '</div>';

      data.payoutHistory.slice().reverse().forEach(function (entry) {
        var statusClass = entry.status === 'paid' ? 'pa-ph-paid' :
                          entry.status === 'failed' ? 'pa-ph-failed' : 'pa-ph-pending';
        var statusLabel = entry.status === 'paid' ? 'Paid' :
                          entry.status === 'failed' ? 'Failed' : 'Rolled Over';
        var transferDisplay = entry.transferId
          ? '<span class="pa-ph-transfer-id">' + escapeHtml(entry.transferId) +
            '<button class="pa-ph-copy" onclick="navigator.clipboard.writeText(\'' + escapeHtml(entry.transferId) + '\');this.textContent=\'Copied!\';setTimeout(function(){this.textContent=\'Copy\';}.bind(this),1500)" title="Copy transfer ID">Copy</button></span>'
          : '\u2014';

        html += '<div class="pa-payout-history-row">' +
          '<span>' + escapeHtml(entry.month) + '</span>' +
          '<span class="pa-ph-amount">$' + (entry.transferAmount || 0).toFixed(2) + '</span>' +
          '<span class="' + statusClass + '">' + statusLabel + '</span>' +
          '<span>' + transferDisplay + '</span>' +
        '</div>';
      });

      html += '</div></div>';
    }

    main.innerHTML = html;

    // Load creator payout status
    loadCreatorStatus();
  }

  function loadCreatorStatus() {
    fetch(getApiBase() + '/pixel-agent-creator-status', { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (status) {
        if (!status) return;
        renderCreatorPayoutSection(status);
      })
      .catch(function () { /* non-fatal */ });
  }

  function renderCreatorPayoutSection(status) {
    var container = document.getElementById('pa-analytics-content');
    if (!container) return;

    // Find insertion point — after the earnings card, before live agents
    var earningsCard = container.querySelector('.pa-analytics-earnings');
    var insertAfter = earningsCard || container.querySelector('.pa-analytics-summary');
    if (!insertAfter) return;

    var section = document.createElement('div');
    section.className = 'pa-analytics-payout-section';

    if (!status.enrolled) {
      // Not enrolled — show CTA
      section.innerHTML =
        '<div class="pa-payout-cta-card">' +
          '<div class="pa-payout-cta-icon"><i class="fab fa-stripe-s"></i></div>' +
          '<div class="pa-payout-cta-body">' +
            '<h3>Connect Stripe to Get Paid</h3>' +
            '<p>Link your bank account to receive your share of creator revenue each month. Takes 2 minutes.</p>' +
            '<button class="pa-btn-primary" onclick="window._startCreatorOnboard()"><i class="fas fa-link"></i> Connect Stripe</button>' +
          '</div>' +
        '</div>';
    } else if (!status.onboardingComplete) {
      // Enrolled but onboarding incomplete
      section.innerHTML =
        '<div class="pa-payout-cta-card pa-payout-cta--pending">' +
          '<div class="pa-payout-cta-icon"><i class="fas fa-clock"></i></div>' +
          '<div class="pa-payout-cta-body">' +
            '<h3>Finish Stripe Setup</h3>' +
            '<p>Your Stripe account is created but setup isn\'t complete. Finish to start receiving payouts.</p>' +
            '<button class="pa-btn-primary" onclick="window._startCreatorOnboard()"><i class="fas fa-arrow-right"></i> Continue Setup</button>' +
          '</div>' +
        '</div>';
    } else {
      // Fully onboarded
      var payoutReady = status.payoutReady;
      var statusBadge = payoutReady
        ? '<span class="pa-payout-badge pa-payout-badge--active"><i class="fas fa-check-circle"></i> Payouts Active</span>'
        : '<span class="pa-payout-badge pa-payout-badge--pending"><i class="fas fa-clock"></i> Verification Pending</span>';

      section.innerHTML =
        '<div class="pa-payout-status-card">' +
          '<div class="pa-payout-status-header">' +
            '<i class="fab fa-stripe-s" style="color:var(--pa-primary);font-size:1.2rem"></i>' +
            '<span>Stripe Connect</span>' +
            statusBadge +
          '</div>' +
          '<div class="pa-payout-status-stats">' +
            '<div class="pa-payout-status-stat">' +
              '<div class="pa-payout-status-value">$' + (status.pendingBalance || 0).toFixed(2) + '</div>' +
              '<div class="pa-payout-status-label">Pending Balance</div>' +
            '</div>' +
            '<div class="pa-payout-status-stat">' +
              '<div class="pa-payout-status-value">$' + (status.totalPaidOut || 0).toFixed(2) + '</div>' +
              '<div class="pa-payout-status-label">Total Paid Out</div>' +
            '</div>' +
            '<div class="pa-payout-status-stat">' +
              '<div class="pa-payout-status-value">' + (status.lastPayoutAt ? timeAgo(status.lastPayoutAt) : 'None yet') + '</div>' +
              '<div class="pa-payout-status-label">Last Payout</div>' +
            '</div>' +
          '</div>' +
          '<div class="pa-payout-status-note"><i class="fas fa-calendar"></i> Next payout: 1st of next month ($25 minimum)</div>' +
        '</div>';
    }

    insertAfter.parentNode.insertBefore(section, insertAfter.nextSibling);
  }

  // Global onboard handler
  window._startCreatorOnboard = function () {
    var btn = document.querySelector('.pa-payout-cta-card .pa-btn-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...'; }

    fetch(getApiBase() + '/pixel-agent-creator-onboard', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.onboardingUrl) {
          window.location.href = data.onboardingUrl;
        } else if (data.alreadyOnboarded) {
          window.location.reload();
        } else {
          alert('Failed to start onboarding: ' + (data.error || 'Unknown error'));
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-link"></i> Connect Stripe'; }
        }
      })
      .catch(function (err) {
        alert('Network error: ' + err.message);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-link"></i> Connect Stripe'; }
      });
  };

  // Handle ?stripe=return param (after onboarding redirect)
  if (window.location.search.includes('stripe=return')) {
    // Clean URL and show toast
    history.replaceState(null, '', window.location.pathname);
    setTimeout(function () {
      var toast = document.createElement('div');
      toast.className = 'pa-toast show';
      toast.textContent = 'Stripe setup complete! Checking status...';
      document.body.appendChild(toast);
      setTimeout(function () { toast.classList.remove('show'); }, 3000);
    }, 500);
  }
})();

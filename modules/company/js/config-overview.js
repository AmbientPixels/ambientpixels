// ── Config Overview v3.1 ──
// Extracted from config-overview.html

// ── Tab Controller ──
(function () {
  var tabs = document.querySelectorAll('.cfg-tab');
  var panels = document.querySelectorAll('.cfg-tab-panel');
  if (!tabs.length || !panels.length) return;

  function activate(id) {
    tabs.forEach(function (t) {
      var isActive = t.getAttribute('data-tab') === id;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'cfg-panel-' + id);
    });
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      activate(this.getAttribute('data-tab'));
    });
  });

  var hash = location.hash.replace('#', '');
  var valid = Array.prototype.some.call(tabs, function (t) {
    return t.getAttribute('data-tab') === hash;
  });
  activate(valid ? hash : tabs[0].getAttribute('data-tab'));
})();

(function () {
  // v3.1 — Defensive helpers
  function _cfgSetStatus(id, text, level) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'cfg-check-value cfg-val--' + (level || 'ok');
  }
  function _cfgSetIcon(row, level) {
    if (!row) return;
    var icon = row.querySelector('.cfg-check-icon');
    if (icon) icon.className = 'cfg-check-icon cfg-check-icon--' + level;
  }

  CompanyStore.init().then(function () {
    // Store mode
    var mode = CompanyStore.getMode();
    _cfgSetStatus('stat-store', mode || 'unknown', mode ? 'ok' : 'warn');
  }).catch(function () {
    _cfgSetStatus('stat-store', '\u26A0 Store unavailable', 'err');
  });

  // Tools registry — read from AgentEngine after store is ready
  window.addEventListener('companystoreready', function () {
    try {
      var tools = (typeof AgentEngine !== 'undefined' && AgentEngine.getTools) ? AgentEngine.getTools() : [];
      _cfgSetStatus('stat-tools', tools.length + ' registered', tools.length > 0 ? 'ok' : 'warn');
    } catch (e) {
      _cfgSetStatus('stat-tools', '\u26A0 Unable to read', 'err');
    }
  });

  // Auth Status — who is logged in
  (function () {
    fetch('/.auth/me').then(function (r) {
      if (!r.ok) throw new Error('no auth');
      return r.json();
    }).then(function (data) {
      if (data && data.clientPrincipal && data.clientPrincipal.userDetails) {
        _cfgSetStatus('stat-auth', data.clientPrincipal.userDetails, 'ok');
      } else {
        _cfgSetStatus('stat-auth', 'Not authenticated', 'warn');
        var row = document.getElementById('stat-auth');
        if (row) _cfgSetIcon(row.closest('.cfg-check-row'), 'warn');
      }
    }).catch(function () {
      _cfgSetStatus('stat-auth', 'Not authenticated', 'warn');
      var row = document.getElementById('stat-auth');
      if (row) _cfgSetIcon(row.closest('.cfg-check-row'), 'warn');
    });
  })();

  // Server Sync — confirm data is flowing to/from Azure
  window.addEventListener('companystoreready', function () {
    var ws = CompanyStore.getWriteStatus ? CompanyStore.getWriteStatus() : {};
    var mode = CompanyStore.getMode();
    if (mode === 'server' && ws.canWrite) {
      _cfgSetStatus('stat-sync', 'Active \u00b7 ' + mode + ' \u00b7 writes enabled', 'ok');
    } else if (mode === 'server') {
      _cfgSetStatus('stat-sync', 'Read-only \u00b7 no write key', 'warn');
      var row = document.getElementById('stat-sync');
      if (row) _cfgSetIcon(row.closest('.cfg-check-row'), 'warn');
    } else {
      _cfgSetStatus('stat-sync', 'Local only \u00b7 not syncing', 'warn');
      var row2 = document.getElementById('stat-sync');
      if (row2) _cfgSetIcon(row2.closest('.cfg-check-row'), 'warn');
    }
  });

  // Last Heartbeat — most recent agent heartbeat timestamp
  window.addEventListener('companystoreready', function () {
    try {
      var configs = AgentEngine.getAgentConfigs ? AgentEngine.getAgentConfigs() : {};
      var latest = null;
      var latestAgent = '';
      Object.keys(configs).forEach(function (id) {
        var hb = configs[id] && configs[id].heartbeat;
        if (hb && hb.lastBeat) {
          var ts = new Date(hb.lastBeat).getTime();
          if (!latest || ts > latest) { latest = ts; latestAgent = id; }
        }
      });
      if (latest) {
        var ago = Math.round((Date.now() - latest) / 60000);
        var label = ago < 1 ? 'just now' : (ago < 60 ? ago + 'm ago' : Math.round(ago / 60) + 'h ago');
        var level = ago < 120 ? 'ok' : (ago < 1440 ? 'warn' : 'err');
        _cfgSetStatus('stat-heartbeat', latestAgent + ' \u00b7 ' + label, level);
        if (level !== 'ok') {
          var row = document.getElementById('stat-heartbeat');
          if (row) _cfgSetIcon(row.closest('.cfg-check-row'), level);
        }
      } else {
        _cfgSetStatus('stat-heartbeat', 'No heartbeats recorded', 'warn');
        var row2 = document.getElementById('stat-heartbeat');
        if (row2) _cfgSetIcon(row2.closest('.cfg-check-row'), 'warn');
      }
    } catch (e) {
      _cfgSetStatus('stat-heartbeat', '\u26A0 Unable to read', 'err');
    }
  });

  // — Business Day Timezone Selector —
  (function () {
    var sel = document.getElementById('cfg-tz-select');
    var saved = document.getElementById('cfg-tz-saved');
    if (!sel) return;

    // Load current value
    var current = localStorage.getItem('ap_company_timezone') || 'America/Los_Angeles';
    try {
      var settings = CompanyStore.getStateSync('ap_company_settings');
      if (settings && settings.timezone) current = settings.timezone;
    } catch (e) { /* use local */ }
    sel.value = current;

    sel.addEventListener('change', function () {
      var tz = sel.value;
      // Save to localStorage (immediate, used by client-side agent-engine)
      localStorage.setItem('ap_company_timezone', tz);

      // Save to server blob (used by server-side standup cron)
      var base = window.location.hostname.includes('ambientpixels.ai')
        ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
        : '/api';
      var headers = CompanyStore.getWriteHeaders ? CompanyStore.getWriteHeaders() : { 'Content-Type': 'application/json' };
      headers['Content-Type'] = 'application/json';

      fetch(base + '/company-store-upsert-settings', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ settingsPatch: { timezone: tz } })
      }).catch(function () { /* local save is enough for now */ });

      // Flash "Saved" indicator
      saved.style.opacity = '1';
      setTimeout(function () { saved.style.opacity = '0'; }, 1500);
    });
  })();

  // API connectivity check
  var apiBase = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';
  fetch(apiBase + '/company-state?key=_ping', { method: 'GET' })
    .then(function (r) {
      var el = document.getElementById('cfg-api-status');
      var row = el ? el.closest('.cfg-check-row') : null;
      if (r.ok) {
        _cfgSetStatus('cfg-api-status', 'Connected', 'ok');
      } else {
        _cfgSetStatus('cfg-api-status', '\u26A0 API unavailable', 'warn');
        _cfgSetIcon(row, 'warn');
      }
    })
    .catch(function () {
      var el = document.getElementById('cfg-api-status');
      var row = el ? el.closest('.cfg-check-row') : null;
      _cfgSetStatus('cfg-api-status', '\u26A0 API unreachable', 'err');
      _cfgSetIcon(row, 'err');
    });

  // Agent roster — health grid tiles (with styled empty state)
  var _agentRoster = null;
  fetch('/data/company-agents.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      _agentRoster = Array.isArray(data) ? data : (data && Array.isArray(data.agents) ? data.agents : null);
      if (!_agentRoster || _agentRoster.length === 0) {
        _cfgRenderAgentEmpty();
        return;
      }
      _cfgSetStatus('stat-agents', _agentRoster.length + ' active', 'ok');
      var agentRow = document.getElementById('stat-agents');
      if (agentRow) _cfgSetIcon(agentRow.closest('.cfg-check-row'), 'ok');
      _cfgRenderAgentTiles();
    }).catch(function () {
      _cfgRenderAgentEmpty();
    });

  // Re-render agent tiles once CompanyStore is ready (to get heartbeat + task data)
  window.addEventListener('companystoreready', function () { _cfgRenderAgentTiles(); });

  function _cfgRenderAgentTiles() {
    if (!_agentRoster) return;
    var el = document.getElementById('ov-agents');
    var tierColors = { 1: '#FFD700', 2: '#8A2BE2', 3: '#4ECDC4', 4: '#888' };
    var configs = (typeof AgentEngine !== 'undefined' && AgentEngine.getAgentConfigs) ? AgentEngine.getAgentConfigs() : {};
    var tasks = (typeof AgentEngine !== 'undefined' && AgentEngine.getTasks) ? AgentEngine.getTasks() : [];
    var now = Date.now();

    el.innerHTML = _agentRoster.map(function (a) {
      var color = tierColors[a.tier] || '#666';
      var id = (a.id || a.name || '').toLowerCase();

      // Heartbeat info
      var hb = configs[id] && configs[id].heartbeat;
      var lastBeat = hb && hb.lastBeat ? new Date(hb.lastBeat).getTime() : null;
      var agoMin = lastBeat ? Math.round((now - lastBeat) / 60000) : null;
      var hbLabel = '';
      var statusClass = 'cfg-agent-status--idle';
      var statusText = 'Idle';

      if (a.tier === 1) {
        statusClass = 'cfg-agent-status--active';
        statusText = 'CEO';
        hbLabel = 'human';
      } else if (agoMin !== null) {
        if (agoMin < 1) hbLabel = 'just now';
        else if (agoMin < 60) hbLabel = agoMin + 'm ago';
        else if (agoMin < 1440) hbLabel = Math.round(agoMin / 60) + 'h ago';
        else hbLabel = Math.round(agoMin / 1440) + 'd ago';

        if (agoMin < 120) { statusClass = 'cfg-agent-status--active'; statusText = 'Active'; }
        else if (agoMin < 1440) { statusClass = 'cfg-agent-status--idle'; statusText = 'Idle'; }
        else { statusClass = 'cfg-agent-status--stale'; statusText = 'Stale'; }
      } else {
        hbLabel = 'no heartbeat';
      }

      // Task count for this agent
      var agentTasks = tasks.filter(function (t) { return t.assignee === id && t.status !== 'done'; });
      var taskLabel = agentTasks.length > 0 ? agentTasks.length + ' task' + (agentTasks.length > 1 ? 's' : '') : '0 tasks';

      return '<div class="cfg-agent-tile">' +
        '<div class="cfg-agent-dot" style="background:' + color + ';"></div>' +
        '<div class="cfg-agent-info">' +
          '<div class="cfg-agent-name">' + (a.name || 'Unknown') + '</div>' +
          '<div class="cfg-agent-meta">' +
            '<span><i class="fas fa-heartbeat" style="margin-right:2px;"></i>' + hbLabel + '</span>' +
            '<span><i class="fas fa-tasks" style="margin-right:2px;"></i>' + taskLabel + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cfg-agent-right">' +
          '<div class="cfg-agent-status ' + statusClass + '">' + statusText + '</div>' +
          '<div class="cfg-agent-role">' + (a.role || '') + '</div>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  // — External API Health Panel —
  (function () {
    var grid = document.getElementById('cfg-api-grid');
    var timeEl = document.getElementById('cfg-api-health-time');
    var summaryEl = document.getElementById('cfg-api-summary');
    var btn = document.getElementById('cfg-api-health-btn');
    if (!grid || !btn) return;

    var _checking = false;

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function renderEndpoints(data) {
      if (!data || !data.endpoints) {
        grid.innerHTML = '<div style="font-size:0.6rem;opacity:0.3;grid-column:1/-1;">Health check failed.</div>';
        return;
      }
      timeEl.textContent = 'Checked ' + new Date(data.checkedAt).toLocaleTimeString();
      grid.innerHTML = data.endpoints.map(function (ep) {
        var dotClass = ep.reachable ? 'cfg-api-dot--up' : 'cfg-api-dot--down';
        var badge = ep.reachable
          ? '<span class="cfg-api-status-badge cfg-api-status-badge--up">up</span>'
          : '<span class="cfg-api-status-badge cfg-api-status-badge--down">down</span>';
        var latency = ep.latencyMs != null ? ep.latencyMs + 'ms' : '\u2014';
        return '<div class="cfg-api-tile">' +
          '<div class="cfg-api-dot ' + dotClass + '"></div>' +
          '<span class="cfg-api-name">' + esc(ep.name) + '</span>' +
          '<span class="cfg-api-latency">' + latency + '</span>' +
          badge +
          '</div>';
      }).join('');
      if (data.summary) {
        summaryEl.innerHTML =
          '<span>\u2705 ' + data.summary.reachable + ' reachable</span>' +
          (data.summary.down > 0 ? '<span>\u274C ' + data.summary.down + ' down</span>' : '') +
          '<span>\u23F1 ' + data.endpoints.length + ' checked</span>';
      }
    }

    function runCheck() {
      if (_checking) return;
      _checking = true;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking\u2026';
      grid.innerHTML = '<div style="font-size:0.6rem;opacity:0.3;grid-column:1/-1;">Pinging external APIs\u2026</div>';

      var base = window.location.hostname.includes('ambientpixels.ai')
        ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';

      fetch(base + '/api-health-check')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          renderEndpoints(data);
        })
        .catch(function () {
          grid.innerHTML = '<div style="font-size:0.6rem;color:#ef4444;grid-column:1/-1;">\u26A0 Health check endpoint unreachable. Deploy api-health-check first.</div>';
        })
        .finally(function () {
          _checking = false;
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-sync-alt"></i> Check Now';
        });
    }

    btn.addEventListener('click', runCheck);

    // Auto-check on page load after a short delay
    setTimeout(runCheck, 1500);
  })();

  function _cfgRenderAgentEmpty() {
    _cfgSetStatus('stat-agents', '\u26A0 Not detected', 'warn');
    var agentRow = document.getElementById('stat-agents');
    if (agentRow) _cfgSetIcon(agentRow.closest('.cfg-check-row'), 'warn');
    document.getElementById('ov-agents').innerHTML =
      '<div class="cfg-empty-state">' +
        '<div class="cfg-empty-state-icon"><i class="fas fa-robot"></i></div>' +
        '<div class="cfg-empty-state-title">\u26A0 No agents detected</div>' +
        '<div class="cfg-empty-state-hint">Check system connectivity or reload the page.</div>' +
      '</div>';
  }
})();

// Worker Automation panel — CEO Kill Switch
(function () {
  var dot = document.getElementById('cfg-worker-dot');
  var stateEl = document.getElementById('cfg-worker-state');
  var helperEl = document.getElementById('cfg-worker-helper');
  var toggleBtn = document.getElementById('cfg-worker-toggle');
  var auditFeed = document.getElementById('cfg-worker-audit-feed');
  if (!dot || !stateEl || !toggleBtn) return;

  var _debounceTimer = null;

  function render() {
    var enabled = WorkerManager.isEnabled();
    dot.className = 'cfg-worker-dot ' + (enabled ? 'cfg-worker-dot--on' : 'cfg-worker-dot--off');
    stateEl.textContent = enabled ? 'Enabled' : 'Disabled';
    stateEl.style.color = enabled ? '#34d399' : '#ef4444';
    helperEl.textContent = enabled ? 'Workers will spawn automatically during pressure spikes.' : 'Worker spawning and runs are paused. Existing workers will terminate safely.';
    toggleBtn.textContent = enabled ? '\u23F8 Disable Workers' : '\u25B6 Enable Workers';
    toggleBtn.className = 'cfg-worker-toggle ' + (enabled ? 'cfg-worker-toggle--disable' : 'cfg-worker-toggle--enable');
    renderAudit();
  }

  function renderAudit() {
    var events = WorkerAudit.getRecent(8);
    if (events.length === 0) { auditFeed.innerHTML = '<span style="opacity:0.25; font-size:0.6rem;">No activity yet.</span>'; return; }
    auditFeed.innerHTML = events.reverse().map(function (ev) {
      var ts = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '?';
      var label = ev.eventType.replace(/_/g, ' ');
      if (ev.workerType) label += ' (' + ev.workerType + ')';
      if (ev.reason) label += ' \u2014 ' + ev.reason;
      return '<div class="cfg-worker-audit-row"><span class="cfg-worker-audit-ts">' + ts + '</span><span class="cfg-worker-audit-ev">' + label + '</span></div>';
    }).join('');
  }

  toggleBtn.addEventListener('click', function () {
    if (_debounceTimer) return;
    var current = WorkerManager.isEnabled();
    var action = current ? 'Disable' : 'Enable';
    if (!confirm(action + ' worker automation?')) return;
    WorkerManager.setEnabled(!current, 'CEO');
    render();
    _debounceTimer = setTimeout(function () { _debounceTimer = null; }, 3000);
  });

  render();
})();

// Verification Engine status panel
(function () {
  var dot = document.getElementById('cfg-verify-dot');
  var statusEl = document.getElementById('cfg-verify-status');
  var templatesEl = document.getElementById('cfg-verify-templates');
  if (!dot || !statusEl || !templatesEl) return;

  TaskVerifier.load().then(function () {
    if (TaskVerifier.isLoaded()) {
      dot.className = 'cfg-verify-dot cfg-verify-dot--ok';
      statusEl.textContent = 'Active';
      statusEl.style.color = '#34d399';
      var count = 0;
      try { count = JSON.parse(localStorage.getItem('_vg_tpl_count') || '0'); } catch (e) {}
      // Re-count from fetch
      fetch('/data/company-verification-templates.json').then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.templates) templatesEl.textContent = d.templates.length + ' loaded';
      }).catch(function () { templatesEl.textContent = '\u26A0 Unable to count'; });
    } else {
      dot.className = 'cfg-verify-dot cfg-verify-dot--warn';
      statusEl.textContent = '\u26A0 Not loaded';
      statusEl.style.color = '#fbbf24';
      templatesEl.textContent = '\u26A0 Unavailable';
    }
  });
})();

// Autonomy Controls panel
(function () {
  var dot = document.getElementById('cfg-action-dot');
  var stateEl = document.getElementById('cfg-action-state');
  var helperEl = document.getElementById('cfg-action-helper');
  var toggleBtn = document.getElementById('cfg-action-toggle');
  var countsEl = document.getElementById('cfg-action-counts');
  var auditFeed = document.getElementById('cfg-action-audit-feed');
  var subTask = document.getElementById('cfg-action-sub-task');
  var subSocial = document.getElementById('cfg-action-sub-social');
  var subContent = document.getElementById('cfg-action-sub-content');
  var subEmail = document.getElementById('cfg-action-sub-email');
  var subGit = document.getElementById('cfg-action-sub-git');
  var subConfigChg = document.getElementById('cfg-configchg-toggle');
  var configChgInfo = document.getElementById('cfg-configchg-info');
  var subAutoPromote = document.getElementById('cfg-autopromote-toggle');
  var activationModeSelect = document.getElementById('cfg-activation-mode');
  var activationModeStatus = document.getElementById('cfg-activation-mode-status');
  var revertBackupInfo = document.getElementById('cfg-revert-backup-info');
  var revertBtn = document.getElementById('cfg-revert-btn');
  var revertStatus = document.getElementById('cfg-revert-status');
  if (!dot || !stateEl || !toggleBtn) return;

  var _debounceTimer = null;

  ActionRouter.loadRegistry().then(function () { render(); });
  loadActivationMode();

  // Re-render after CompanyStore server sync
  window.addEventListener('companystoreready', function () { render(); });

  function normalizeActivationMode(value) {
    var v = String(value || '').trim().toLowerCase();
    if (v === 'manual' || v === 'supervised_autonomous' || v === 'experimental') return v;
    return 'supervised_autonomous';
  }

  function loadActivationMode() {
    if (!activationModeSelect) return;
    fetch('/api/company-state?key=activationMode', { method: 'GET' })
      .then(function (res) { if (!res.ok) throw new Error('GET failed: ' + res.status); return res.json(); })
      .then(function (data) {
        var next = normalizeActivationMode(data && data.value);
        activationModeSelect.value = next;
        if (activationModeStatus) activationModeStatus.textContent = '';
      })
      .catch(function () {
        activationModeSelect.value = 'supervised_autonomous';
        if (activationModeStatus) activationModeStatus.textContent = 'Defaulting to supervised_autonomous';
      });
  }

  if (activationModeSelect) {
    activationModeSelect.addEventListener('change', function () {
      var selected = normalizeActivationMode(activationModeSelect.value);
      activationModeSelect.value = selected;
      if (activationModeStatus) activationModeStatus.textContent = 'Saving\u2026';
      fetch('/api/company-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'activationMode', value: selected })
      })
      .then(function (res) { if (!res.ok) throw new Error('POST failed: ' + res.status); return res.json(); })
      .then(function () {
        if (activationModeStatus) {
          activationModeStatus.textContent = 'Saved';
          setTimeout(function () {
            if (activationModeStatus && activationModeStatus.textContent === 'Saved') activationModeStatus.textContent = '';
          }, 1500);
        }
      })
      .catch(function () {
        if (activationModeStatus) activationModeStatus.textContent = 'Save failed';
      });
    });
  }

  // — Execution Mode (AmbientCore automation posture) —
  var executionModeSelect = document.getElementById('cfg-execution-mode');
  var executionModeStatus = document.getElementById('cfg-execution-mode-status');

  function normalizeExecMode(value) {
    var v = String(value || '').trim().toLowerCase();
    if (v === 'active' || v === 'observe' || v === 'frozen') return v;
    return 'active';
  }

  var _emLoadApiBase = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';
  function loadExecutionMode() {
    if (!executionModeSelect) return;
    fetch(_emLoadApiBase + '/company-state?key=execution_mode', { method: 'GET' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        executionModeSelect.value = normalizeExecMode(data && data.value);
        if (executionModeStatus) executionModeStatus.textContent = '';
      })
      .catch(function () {
        executionModeSelect.value = 'active';
        if (executionModeStatus) executionModeStatus.textContent = 'Defaulting to Live';
      });
  }
  loadExecutionMode();

  if (executionModeSelect) {
    executionModeSelect.addEventListener('change', function () {
      var selected = normalizeExecMode(executionModeSelect.value);
      executionModeSelect.value = selected;
      if (executionModeStatus) executionModeStatus.textContent = 'Saving\u2026';
      var _emApiBase = window.location.hostname.includes('ambientpixels.ai')
        ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';
      var _emHeaders = { 'Content-Type': 'application/json' };
      if (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteHeaders) {
        var _wh = CompanyStore.getWriteHeaders();
        Object.keys(_wh || {}).forEach(function (k) { _emHeaders[k] = _wh[k]; });
        _emHeaders['Content-Type'] = 'application/json';
      }
      fetch(_emApiBase + '/company-state', {
        method: 'POST',
        headers: _emHeaders,
        body: JSON.stringify({ key: 'execution_mode', value: selected })
      })
      .then(function (res) { if (!res.ok) throw new Error('POST failed'); return res.json(); })
      .then(function () {
        if (executionModeStatus) {
          executionModeStatus.textContent = 'Saved';
          setTimeout(function () {
            if (executionModeStatus && executionModeStatus.textContent === 'Saved') executionModeStatus.textContent = '';
          }, 1500);
        }
      })
      .catch(function () {
        if (executionModeStatus) executionModeStatus.textContent = 'Save failed';
      });
    });
  }

  function render() {
    var enabled = ActionRouter.isEnabled();
    dot.className = 'cfg-action-dot ' + (enabled ? 'cfg-action-dot--on' : 'cfg-action-dot--off');
    stateEl.textContent = enabled ? 'Enabled' : 'Disabled (safe default)';
    stateEl.style.color = enabled ? '#34d399' : '#ef4444';
    helperEl.textContent = enabled
      ? 'Action pipeline active. Channel toggles control autonomy level.'
      : 'Action pipeline paused. All actions queue for CEO approval.';
    toggleBtn.textContent = enabled ? '\u23F8 Disable Actions' : '\u25B6 Enable Actions';
    toggleBtn.className = 'cfg-action-toggle ' + (enabled ? 'cfg-action-toggle--disable' : 'cfg-action-toggle--enable');

    // Channel toggles with mode labels
    renderSub(subTask, ActionRouter.isTaskEnabled(), 'task', 'cfg-mode-task');
    renderSub(subConfigChg, ActionRouter.isConfigChangesEnabled(), 'configChanges', 'cfg-mode-config');
    renderSub(subSocial, ActionRouter.isSocialEnabled(), 'social', 'cfg-mode-social');
    renderSub(subContent, ActionRouter.isContentEnabled(), 'content', 'cfg-mode-content');
    renderSub(subEmail, ActionRouter.isEmailEnabled(), 'email', 'cfg-mode-email');
    renderSub(subGit, ActionRouter.isGitEnabled(), 'git', 'cfg-mode-git');
    renderSub(subAutoPromote, ActionRouter.isAutoPromoteEnabled(), 'autoPromote', 'cfg-mode-autopromote');
    renderConfigChgInfo();
    renderRevertPanel();

    // Registry counts
    var c = ActionRouter.getRegistryCounts();
    countsEl.textContent = 'Registry: ' + c.enabled + ' enabled, ' + c.disabled + ' disabled (' + c.total + ' total)';

    renderAudit();
  }

  function renderSub(btn, on, type, modeId) {
    if (!btn) return;
    btn.textContent = on ? 'ON' : 'OFF';
    btn.className = 'cfg-action-sub-toggle ' + (on ? 'on' : 'off');
    // Mode label
    var modeEl = modeId ? document.getElementById(modeId) : null;
    if (modeEl) modeEl.textContent = on ? 'Autonomous' : 'CEO Approval';
    btn.onclick = function () {
      if (type === 'task') ActionRouter.setTaskEnabled(!on);
      else if (type === 'social') ActionRouter.setSocialEnabled(!on);
      else if (type === 'content') ActionRouter.setContentEnabled(!on);
      else if (type === 'email') ActionRouter.setEmailEnabled(!on);
      else if (type === 'git') ActionRouter.setGitEnabled(!on);
      else if (type === 'configChanges') ActionRouter.setConfigChangesEnabled(!on, 'CEO');
      else if (type === 'autoPromote') ActionRouter.setAutoPromoteEnabled(!on, 'CEO');
      render();
    };
  }

  function renderConfigChgInfo() {
    if (!configChgInfo) return;
    var lines = [];
    lines.push('Applies approved calibration tuning changes. Default OFF.');
    try {
      var raw = localStorage.getItem('ap_system_adjustment_backup_latest');
      if (raw) {
        var backup = JSON.parse(raw);
        if (backup && backup.createdAt) {
          lines.push('Last applied: ' + new Date(backup.createdAt).toLocaleString());
        }
      }
    } catch (e) { /* ignore */ }
    try {
      var q = JSON.parse(localStorage.getItem('ap_action_queue') || '[]');
      var pending = 0;
      for (var i = 0; i < q.length; i++) {
        if (q[i].actionType === 'system_adjustment' && q[i].status === 'pending_approval') pending++;
      }
      if (pending > 0) lines.push(pending + ' pending system adjustment(s)');
    } catch (e) { /* ignore */ }
    configChgInfo.innerHTML = lines.join('<br>');
  }

  function renderRevertPanel() {
    if (!revertBackupInfo) return;
    var info = (typeof ActionExecutors !== 'undefined' && ActionExecutors.getBackupInfo) ? ActionExecutors.getBackupInfo() : null;
    if (!info) {
      revertBackupInfo.textContent = 'No backup snapshot available.';
      if (revertBtn) revertBtn.disabled = true;
    } else {
      var parts = [];
      if (info.createdAt) parts.push('Backup from: ' + new Date(info.createdAt).toLocaleString());
      if (info.actionId) parts.push('Action: ' + info.actionId.substring(0, 12));
      var includes = [];
      if (info.hasWeights) includes.push('priority weights');
      if (info.hasThresholds) includes.push('planner thresholds');
      if (includes.length) parts.push('Includes: ' + includes.join(' + '));
      revertBackupInfo.innerHTML = parts.join('<br>');
      if (revertBtn) revertBtn.disabled = false;
    }
    if (revertStatus) {
      var lr = (typeof ActionExecutors !== 'undefined' && ActionExecutors.getLastRevert) ? ActionExecutors.getLastRevert() : null;
      if (lr && lr.timestamp) {
        revertStatus.textContent = 'Last revert: ' + new Date(lr.timestamp).toLocaleString();
      } else {
        revertStatus.textContent = '';
      }
    }
  }

  if (revertBtn) {
    var _revertDebounce = null;
    revertBtn.addEventListener('click', function () {
      if (_revertDebounce) return;
      _revertDebounce = setTimeout(function () { _revertDebounce = null; }, 800);
      if (!ActionRouter.isConfigChangesEnabled()) {
        alert('Config Changes is disabled \u2014 enable to revert.');
        return;
      }
      var info = (typeof ActionExecutors !== 'undefined' && ActionExecutors.getBackupInfo) ? ActionExecutors.getBackupInfo() : null;
      if (!info) { alert('No backup snapshot available.'); return; }
      var msg = 'Revert last system adjustment? This will restore prior weights/thresholds.';
      if (info.createdAt) {
        var ageMs = Date.now() - new Date(info.createdAt).getTime();
        if (ageMs > 30 * 86400000) msg += '\n\n\u26A0 Backup is older than 30 days.';
      }
      if (!confirm(msg)) return;
      var result = ActionExecutors.revertLastAdjustment('CEO');
      if (result.ok) {
        var rp = [];
        if (result.reverted.weights) rp.push('priority weights');
        if (result.reverted.thresholds) rp.push('planner thresholds');
        alert('Reverted: ' + (rp.join(' + ') || 'unknown') + '.');
      } else {
        alert('Revert failed: ' + (result.reason || 'Unknown error'));
      }
      render();
    });
  }

  function renderAudit() {
    var events = ActionAudit.getRecent(10);
    if (events.length === 0) { auditFeed.innerHTML = '<span style="opacity:0.25; font-size:0.6rem;">No activity yet.</span>'; return; }
    auditFeed.innerHTML = events.reverse().map(function (ev) {
      var ts = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '?';
      var label = ev.eventType.replace(/_/g, ' ');
      if (ev.actionType) label += ' (' + ev.actionType + ')';
      if (ev.reason) label += ' \u2014 ' + ev.reason;
      return '<div class="cfg-action-audit-row"><span class="cfg-action-audit-ts">' + ts + '</span><span class="cfg-action-audit-ev">' + label + '</span></div>';
    }).join('');
  }

  toggleBtn.addEventListener('click', function () {
    if (_debounceTimer) return;
    var current = ActionRouter.isEnabled();
    var action = current ? 'Disable' : 'Enable';
    if (!confirm(action + ' action automation?')) return;
    ActionRouter.setEnabled(!current, 'CEO');
    render();
    _debounceTimer = setTimeout(function () { _debounceTimer = null; }, 3000);
  });

  render();
})();

// Planner Automation panel
(function () {
  var dot = document.getElementById('cfg-planner-dot');
  var stateEl = document.getElementById('cfg-planner-state');
  var helperEl = document.getElementById('cfg-planner-helper');
  var toggleBtn = document.getElementById('cfg-planner-toggle');
  var infoEl = document.getElementById('cfg-planner-info');
  if (!dot || !stateEl || !toggleBtn) return;

  var _debounceTimer = null;
  var cadenceSelect = document.getElementById('cfg-planner-cadence');
  var cadenceSaved = document.getElementById('cfg-cadence-saved');

  function render() {
    var enabled = PlannerLoop.isEnabled();
    dot.className = 'cfg-planner-dot ' + (enabled ? 'cfg-planner-dot--on' : 'cfg-planner-dot--off');
    stateEl.textContent = enabled ? 'Enabled' : 'Disabled (safe default)';
    stateEl.style.color = enabled ? '#34d399' : '#ef4444';
    helperEl.textContent = 'Planner generates proposals only; approvals required before execution.';
    toggleBtn.textContent = enabled ? '\u23F8 Disable Planner' : '\u25B6 Enable Planner';
    toggleBtn.className = 'cfg-planner-toggle ' + (enabled ? 'cfg-planner-toggle--disable' : 'cfg-planner-toggle--enable');

    var cadence = PlannerLoop.getCadenceDays();
    var lastRun = PlannerLoop.getLastRunTimestamp();
    var infoParts = [];
    if (lastRun) infoParts.push('Last run: ' + new Date(lastRun).toLocaleString());
    else infoParts.push('Never run');
    infoEl.textContent = infoParts.join(' \u2014 ');

    // Sync cadence dropdown
    if (cadenceSelect) cadenceSelect.value = String(cadence);
  }

  // Cadence selector
  if (cadenceSelect) {
    cadenceSelect.addEventListener('change', function () {
      var days = parseInt(cadenceSelect.value, 10);
      if (!isNaN(days) && days > 0) {
        try { localStorage.setItem('ap_planner_cadence_days', String(days)); } catch (e) {}
        if (cadenceSaved) {
          cadenceSaved.style.display = 'inline';
          setTimeout(function () { cadenceSaved.style.display = 'none'; }, 2000);
        }
        render();
      }
    });
  }

  toggleBtn.addEventListener('click', function () {
    if (_debounceTimer) return;
    var current = PlannerLoop.isEnabled();
    var action = current ? 'Disable' : 'Enable';
    if (!confirm(action + ' planner automation?')) return;
    PlannerLoop.setEnabled(!current);
    render();
    _debounceTimer = setTimeout(function () { _debounceTimer = null; }, 3000);
  });

  render();
})();

// Calibration Automation panel
(function () {
  var dot = document.getElementById('cfg-cal-dot');
  var stateEl = document.getElementById('cfg-cal-state');
  var helperEl = document.getElementById('cfg-cal-helper');
  var toggleBtn = document.getElementById('cfg-cal-toggle');
  var infoEl = document.getElementById('cfg-cal-info');
  if (!dot || !stateEl || !toggleBtn) return;

  var _debounceTimer = null;
  var calCadenceSelect = document.getElementById('cfg-cal-cadence');
  var calCadenceSaved = document.getElementById('cfg-cal-cadence-saved');

  function render() {
    var enabled = CalibrationLoop.isEnabled();
    dot.className = 'cfg-cal-dot ' + (enabled ? 'cfg-cal-dot--on' : 'cfg-cal-dot--off');
    stateEl.textContent = enabled ? 'Enabled' : 'Disabled (safe default)';
    stateEl.style.color = enabled ? '#34d399' : '#ef4444';
    helperEl.textContent = 'Calibration analyzes system health and proposes bounded tuning. All proposals require CEO approval.';
    toggleBtn.textContent = enabled ? '\u23F8 Disable Calibration' : '\u25B6 Enable Calibration';
    toggleBtn.className = 'cfg-cal-toggle ' + (enabled ? 'cfg-cal-toggle--disable' : 'cfg-cal-toggle--enable');

    var cadence = CalibrationLoop.getCadenceDays();
    var lastRun = CalibrationLoop.getLastRunTimestamp();
    var infoParts = [];
    if (lastRun) infoParts.push('Last run: ' + new Date(lastRun).toLocaleString());
    else infoParts.push('Never run');
    infoEl.textContent = infoParts.join(' \u2014 ');

    if (calCadenceSelect) calCadenceSelect.value = String(cadence);
  }

  if (calCadenceSelect) {
    calCadenceSelect.addEventListener('change', function () {
      var days = parseInt(calCadenceSelect.value, 10);
      if (!isNaN(days) && days > 0) {
        try { localStorage.setItem('ap_calibration_cadence_days', String(days)); } catch (e) {}
        if (calCadenceSaved) {
          calCadenceSaved.style.display = 'inline';
          setTimeout(function () { calCadenceSaved.style.display = 'none'; }, 2000);
        }
        render();
      }
    });
  }

  toggleBtn.addEventListener('click', function () {
    if (_debounceTimer) return;
    var current = CalibrationLoop.isEnabled();
    var action = current ? 'Disable' : 'Enable';
    if (!confirm(action + ' calibration automation?')) return;
    CalibrationLoop.setEnabled(!current);
    render();
    _debounceTimer = setTimeout(function () { _debounceTimer = null; }, 3000);
  });

  render();
})();

// System Storage panel
(function () {
  var usageEl = document.getElementById('cfg-storage-usage');
  var countsEl = document.getElementById('cfg-storage-counts');
  var oldestEl = document.getElementById('cfg-storage-oldest');
  var toastEl = document.getElementById('cfg-storage-toast');
  var pruneBtn = document.getElementById('cfg-storage-prune');
  var exportBtn = document.getElementById('cfg-storage-export');
  var resetBtn = document.getElementById('cfg-storage-reset');
  if (!usageEl || !countsEl) return;

  var _debounce = null;
  function _toast(msg) { if (toastEl) { toastEl.textContent = msg; setTimeout(function () { toastEl.textContent = ''; }, 4000); } }

  function render() {
    var u = StorageManager.estimateUsage();
    var pct = Math.min(100, Math.round((u.kbEstimate / 5120) * 100));
    var barColor = pct > 85 ? '#ef4444' : (pct > 60 ? '#fbbf24' : '#34d399');
    var statusText = pct > 85 ? 'Critical \u2014 prune recommended' : (pct > 60 ? 'Getting full' : 'Healthy');
    usageEl.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">' +
        '<span style="font-size:0.65rem;">' + u.kbEstimate + ' KB / ~5,120 KB (' + pct + '%)</span>' +
        '<span style="font-size:0.55rem;color:' + barColor + ';">' + statusText + '</span>' +
      '</div>' +
      '<div style="height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;">' +
        '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:3px;transition:width 0.3s;"></div>' +
      '</div>';

    var c = StorageManager.getStoreCounts();
    var items = [
      { key: 'ap_action_audit', label: 'Action Audit', desc: 'Log of executed actions', limit: 1000 },
      { key: 'ap_worker_audit', label: 'Worker Audit', desc: 'Background task history', limit: 1000 },
      { key: 'ap_planner_audit', label: 'Planner Audit', desc: 'Planning cycle records', limit: 1000 },
      { key: 'ap_calibration_audit', label: 'Calibration Audit', desc: 'Agent tuning history', limit: 1000 },
      { key: 'ap_priority_audit', label: 'Priority Audit', desc: 'Priority scoring log', limit: 1000 },
      { key: 'ap_action_queue', label: 'Action Queue', desc: 'Pending + completed actions', limit: 300 },
      { key: 'ap_action_queue_pending', label: 'Pending Approvals', desc: 'Awaiting your decision', limit: null },
      { key: 'ap_priority_cache', label: 'Priority Cache', desc: 'Cached scoring data', limit: 500 }
    ];
    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var val = c[items[i].key] || 0;
      var lim = items[i].limit;
      var ratio = lim ? (val / lim) : 0;
      var color = !lim ? '#60a5fa' : (ratio > 0.8 ? '#ef4444' : (ratio > 0.5 ? '#fbbf24' : '#34d399'));
      var limitLabel = lim ? ' / ' + lim : '';
      rows +=
        '<div class="cfg-storage-count-row" title="' + items[i].desc + '">' +
          '<span class="cfg-storage-count-label">' + items[i].label +
            '<span style="font-size:0.45rem;opacity:0.3;margin-left:4px;">' + items[i].desc + '</span>' +
          '</span>' +
          '<span class="cfg-storage-count-val" style="color:' + color + ';">' + val + limitLabel + '</span>' +
        '</div>';
    }
    countsEl.innerHTML = rows;

    var oldest = StorageManager.getOldestEntry();
    oldestEl.textContent = oldest ? 'Oldest entry: ' + new Date(oldest).toLocaleDateString() : '';
  }

  pruneBtn.addEventListener('click', function () {
    if (_debounce) return;
    _debounce = setTimeout(function () { _debounce = null; }, 800);
    var result = StorageManager.pruneAll();
    render();
    _toast('Pruned: ' + result.logs + ' log entries, ' + result.queue + ' queue items, ' + result.cache + ' cache entries, ' + (result.store || 0) + ' store items.');
  });

  exportBtn.addEventListener('click', function () {
    if (_debounce) return;
    _debounce = setTimeout(function () { _debounce = null; }, 800);
    StorageManager.exportDiagnostics();
    _toast('Diagnostics JSON downloaded.');
  });

  resetBtn.addEventListener('click', function () {
    if (_debounce) return;
    if (!confirm('Reset non-critical caches? This clears priority cache, planner artifact, and calibration artifact. Queue and audits are preserved.')) return;
    _debounce = setTimeout(function () { _debounce = null; }, 800);
    StorageManager.resetCaches();
    render();
    _toast('Non-critical caches cleared.');
  });

  render();
})();

// ── Server Persistence panel ──
(function () {
  var dot = document.getElementById('cfg-store-dot');
  var stateEl = document.getElementById('cfg-store-state');
  var infoEl = document.getElementById('cfg-store-info');
  var toggleBtn = document.getElementById('cfg-store-toggle');
  var pushBtn = document.getElementById('cfg-store-push');
  var pullBtn = document.getElementById('cfg-store-pull');
  var flushBtn = document.getElementById('cfg-store-flush');
  var toastEl = document.getElementById('cfg-store-toast');
  if (!dot || !stateEl || !toggleBtn) return;
  if (typeof CompanyStoreAdapter === 'undefined') { stateEl.textContent = 'Adapter not loaded'; return; }

  var _deb = null;
  function _toast(msg) { if (toastEl) { toastEl.textContent = msg; setTimeout(function () { toastEl.textContent = ''; }, 5000); } }

  function renderStorePanel() {
    var s = CompanyStoreAdapter.getStatus();
    dot.className = 'cfg-store-dot ' + (s.enabled ? (s.hasKey ? 'cfg-store-dot--on' : 'cfg-store-dot--warn') : 'cfg-store-dot--off');
    var stateLabel = 'Disabled';
    if (s.enabled) {
      if (s.hasSwaAuth) stateLabel = 'Enabled (SWA auth)';
      else if (s.hasManualKey) stateLabel = 'Enabled (manual key)';
      else stateLabel = 'Enabled (no auth)';
    }
    stateEl.textContent = stateLabel;
    stateEl.style.color = s.enabled ? (s.hasKey ? '#34d399' : '#fbbf24') : '#ef4444';
    toggleBtn.textContent = s.enabled ? 'Disable' : 'Enable Server Persistence';
    toggleBtn.className = 'cfg-store-btn ' + (s.enabled ? 'cfg-store-btn--disable' : 'cfg-store-btn--enable');
    pushBtn.disabled = !s.enabled || !s.hasKey;
    pullBtn.disabled = !s.enabled || !s.hasKey;
    flushBtn.disabled = !s.enabled || s.outboxSize === 0 || !s.hasKey;
    var lines = [];
    if (s.lastSync) lines.push('Last sync: ' + new Date(s.lastSync).toLocaleString());
    if (s.outboxSize > 0) lines.push('Outbox: ' + s.outboxSize + ' pending batch(es)');
    if (!s.hasKey && s.enabled) lines.push('Not authenticated. Log in via Azure SWA or set key: CompanyStoreAdapter.setKey("...")'); 
    infoEl.innerHTML = lines.join('<br>') || (s.enabled ? 'Ready to sync.' : 'Enable to sync state to server.');
  }

  toggleBtn.addEventListener('click', function () {
    if (_deb) return;
    _deb = setTimeout(function () { _deb = null; }, 800);
    var on = CompanyStoreAdapter.isEnabled();
    if (on) {
      if (!confirm('Disable server persistence? Local writes will continue.')) return;
      CompanyStoreAdapter.setEnabled(false);
    } else {
      CompanyStoreAdapter.setEnabled(true);
    }
    renderStorePanel();
  });

  pushBtn.addEventListener('click', function () {
    if (_deb) return;
    if (!confirm('Push all local state to server? This merges with existing server data.')) return;
    _deb = setTimeout(function () { _deb = null; }, 3000);
    pushBtn.disabled = true;
    _toast('Pushing...');
    CompanyStoreAdapter.pushLocalToServer().then(function (r) {
      pushBtn.disabled = false;
      if (r.ok) { _toast('Push complete.'); } else { _toast('Push failed: ' + (r.reason || 'unknown')); }
      renderStorePanel();
    });
  });

  pullBtn.addEventListener('click', function () {
    if (_deb) return;
    if (!confirm('Pull server state to this device? This will overwrite local settings, audits, and queue (local pending approvals preserved).')) return;
    _deb = setTimeout(function () { _deb = null; }, 3000);
    pullBtn.disabled = true;
    _toast('Pulling...');
    CompanyStoreAdapter.pullServerToLocal().then(function (r) {
      pullBtn.disabled = false;
      if (r.ok) { _toast('Pull complete. Reload recommended.'); } else { _toast('Pull failed: ' + (r.reason || 'unknown')); }
      renderStorePanel();
    });
  });

  flushBtn.addEventListener('click', function () {
    if (_deb) return;
    _deb = setTimeout(function () { _deb = null; }, 2000);
    flushBtn.disabled = true;
    _toast('Flushing outbox...');
    CompanyStoreAdapter.flushOutbox().then(function (r) {
      _toast('Flushed: ' + r.flushed + ' batches sent, ' + r.failed + ' remaining.');
      renderStorePanel();
    });
  });

  renderStorePanel();
})();

// Master Automation Toggle — kill switch for all 4 automation systems
(function () {
  var btn = document.getElementById('cfg-master-automation-toggle');
  if (!btn) return;

  function allEnabled() {
    var w = typeof WorkerManager !== 'undefined' && WorkerManager.isEnabled();
    var a = typeof ActionRouter !== 'undefined' && ActionRouter.isEnabled();
    var p = typeof PlannerLoop !== 'undefined' && PlannerLoop.isEnabled();
    var c = typeof CalibrationLoop !== 'undefined' && CalibrationLoop.isEnabled();
    return { worker: w, action: a, planner: p, calibration: c };
  }

  function anyEnabled(s) { return s.worker || s.action || s.planner || s.calibration; }

  function updateLabel() {
    var s = allEnabled();
    if (anyEnabled(s)) {
      btn.innerHTML = '<i class="fas fa-robot"></i> Kill All Automation';
      btn.style.borderColor = 'rgba(239,68,68,0.3)';
      btn.style.color = '#ef4444';
    } else {
      btn.innerHTML = '<i class="fas fa-robot"></i> Enable All Automation';
      btn.style.borderColor = 'rgba(52,211,153,0.3)';
      btn.style.color = '#34d399';
    }
  }

  btn.addEventListener('click', function () {
    var s = allEnabled();
    var turning = anyEnabled(s) ? 'OFF' : 'ON';
    var names = ['Worker', 'Action Router', 'Planner', 'Calibration'];
    if (!confirm('Turn ' + turning + ' all automation?\n\n' + names.join(', ') + '\n\nThis affects all 4 systems at once.')) return;

    var enable = !anyEnabled(s);
    if (typeof WorkerManager !== 'undefined') WorkerManager.setEnabled(enable, 'CEO');
    if (typeof ActionRouter !== 'undefined') ActionRouter.setEnabled(enable, 'CEO');
    if (typeof PlannerLoop !== 'undefined') PlannerLoop.setEnabled(enable);
    if (typeof CalibrationLoop !== 'undefined') CalibrationLoop.setEnabled(enable);

    updateLabel();
    // Re-render individual panels so their dots/states update
    setTimeout(function () { location.reload(); }, 300);
  });

  updateLabel();
})();

// Agent Memory Stack panel
(function () {
  function setLayer(n, text, level) {
    var val = document.getElementById('ms-val-' + n);
    var layer = document.getElementById('ms-layer-' + n);
    if (val) {
      val.textContent = text;
    }
    if (layer) {
      var dot = layer.querySelector('.cfg-memstack-dot');
      if (dot) dot.className = 'cfg-memstack-dot cfg-memstack-dot--' + (level || 'ok');
    }
  }

  // L1 Personality + L2 Doctrine — from company-agents.json (already fetched by agent grid)
  fetch('/data/company-agents.json')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (data) {
      var agents = Array.isArray(data) ? data : (data && Array.isArray(data.agents) ? data.agents : []);
      var withPrompt = 0, withDoctrine = 0;
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].systemPrompt) withPrompt++;
        if (agents[i].operatingDoctrine) withDoctrine++;
      }
      setLayer(1, withPrompt + '/' + agents.length + ' agents', withPrompt === agents.length ? 'ok' : 'warn');
      setLayer(2, withDoctrine + '/' + agents.length + ' agents', withDoctrine > 0 ? 'ok' : 'warn');
    })
    .catch(function () {
      setLayer(1, '\u26A0 unavailable', 'err');
      setLayer(2, '\u26A0 unavailable', 'err');
    });

  // L3 Seed Memories — from blob
  CompanyStore.getState('ap_agent_seed_memories', {}).then(function (seeds) {
    if (!seeds || typeof seeds !== 'object') seeds = {};
    var globalLen = (seeds._global || '').trim().length;
    var agentCount = 0;
    var agentNames = [];
    var keys = Object.keys(seeds);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === '_global') continue;
      if ((seeds[keys[i]] || '').trim().length > 0) {
        agentCount++;
        agentNames.push(keys[i]);
      }
    }
    var parts = [];
    if (globalLen > 0) parts.push('global');
    if (agentCount > 0) parts.push(agentCount + ' agents');
    var text = parts.length > 0 ? parts.join(' + ') : 'empty';
    setLayer(3, text, parts.length > 0 ? 'ok' : 'warn');

    // Detail
    var detail = document.getElementById('ms-detail-3');
    if (detail && (globalLen > 0 || agentCount > 0)) {
      var html = '';
      if (globalLen > 0) html += '<div class="cfg-memstack-detail-row"><span class="cfg-memstack-detail-agent">_global</span><span class="cfg-memstack-detail-count">' + globalLen + ' chars</span></div>';
      for (var j = 0; j < agentNames.length; j++) {
        html += '<div class="cfg-memstack-detail-row"><span class="cfg-memstack-detail-agent">' + agentNames[j] + '</span><span class="cfg-memstack-detail-count">' + (seeds[agentNames[j]] || '').trim().length + ' chars</span></div>';
      }
      detail.innerHTML = html;
      // Make layer clickable to expand
      var layer3 = document.getElementById('ms-layer-3');
      if (layer3) {
        layer3.style.cursor = 'pointer';
        layer3.addEventListener('click', function (e) {
          if (e.target.closest('.cfg-memstack-edit')) return;
          detail.classList.toggle('open');
        });
      }
    }
  }).catch(function () {
    setLayer(3, '\u26A0 unavailable', 'err');
  });

  // L4 Runtime Memories — from blob
  CompanyStore.getState('ap_agent_memories', {}).then(function (mems) {
    if (!mems || typeof mems !== 'object') mems = {};
    var total = 0;
    var agentBreakdown = [];
    var keys = Object.keys(mems);
    for (var i = 0; i < keys.length; i++) {
      var arr = mems[keys[i]];
      if (Array.isArray(arr) && arr.length > 0) {
        total += arr.length;
        agentBreakdown.push({ name: keys[i], count: arr.length });
      }
    }
    var text = total > 0 ? total + ' total (' + agentBreakdown.length + ' agents)' : 'empty';
    setLayer(4, text, total > 0 ? 'ok' : 'warn');

    // Detail
    var detail = document.getElementById('ms-detail-4');
    if (detail && agentBreakdown.length > 0) {
      agentBreakdown.sort(function (a, b) { return b.count - a.count; });
      detail.innerHTML = agentBreakdown.map(function (ab) {
        return '<div class="cfg-memstack-detail-row"><span class="cfg-memstack-detail-agent">' + ab.name + '</span><span class="cfg-memstack-detail-count">' + ab.count + ' memories</span></div>';
      }).join('');
    }
  }).catch(function () {
    setLayer(4, '\u26A0 unavailable', 'err');
  });

  // L4 expand toggle
  var expandBtn = document.getElementById('ms-expand-4');
  var detail4 = document.getElementById('ms-detail-4');
  if (expandBtn && detail4) {
    expandBtn.addEventListener('click', function () {
      detail4.classList.toggle('open');
      var icon = expandBtn.querySelector('i');
      if (icon) icon.className = detail4.classList.contains('open') ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
    });
  }

  // L5 CEO Notes — from blob
  CompanyStore.getState('ap_workspace_memory', []).then(function (notes) {
    if (!Array.isArray(notes)) notes = [];
    var pinned = 0;
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].pinned) pinned++;
    }
    var text = notes.length > 0 ? notes.length + ' items' + (pinned > 0 ? ' (' + pinned + ' pinned)' : '') : 'empty';
    setLayer(5, text, notes.length > 0 ? 'ok' : 'warn');
  }).catch(function () {
    setLayer(5, '\u26A0 unavailable', 'err');
  });

  // L6 Site Digest — from generated file
  fetch('/data/site-manifest.digest.json')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (d) {
      if (d && d.generatedAt) {
        var ago = Math.round((Date.now() - new Date(d.generatedAt).getTime()) / 3600000);
        var text = ago < 1 ? 'generated <1h ago' : 'generated ' + ago + 'h ago';
        if (d.counts && d.counts.pages) text += ' \u2014 ' + d.counts.pages + ' pages';
        setLayer(6, text, ago < 168 ? 'ok' : 'warn');
      } else {
        setLayer(6, 'empty', 'warn');
      }
    })
    .catch(function () {
      setLayer(6, 'not generated', 'warn');
    });
})();

// — New System Tools: Export, Sync, Flush —
(function () {
  // Export State — download all ap_* keys as JSON
  var exportBtn = document.getElementById('cfg-tool-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      var state = {};
      var count = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('ap_') === 0) {
          try { state[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { state[k] = localStorage.getItem(k); }
          count++;
        }
      }
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'ambientpixels-state-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      exportBtn.textContent = '\u2713 Exported ' + count + ' keys';
      setTimeout(function () { exportBtn.innerHTML = '<i class="fas fa-download"></i> Export State'; }, 2000);
    });
  }

  // Force Server Sync
  var syncBtn = document.getElementById('cfg-tool-sync');
  if (syncBtn) {
    syncBtn.addEventListener('click', function () {
      if (typeof CompanyStoreAdapter === 'undefined' || !CompanyStoreAdapter.isEnabled()) {
        alert('Server persistence is not enabled.');
        return;
      }
      syncBtn.textContent = 'Syncing\u2026';
      syncBtn.disabled = true;
      CompanyStoreAdapter.deltaSync().then(function (r) {
        syncBtn.innerHTML = r && r.ok ? '<i class="fas fa-check"></i> Synced' : '<i class="fas fa-times"></i> ' + (r && r.reason || 'Failed');
        syncBtn.disabled = false;
        setTimeout(function () { syncBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Force Server Sync'; }, 2500);
      }).catch(function () {
        syncBtn.innerHTML = '<i class="fas fa-times"></i> Error';
        syncBtn.disabled = false;
        setTimeout(function () { syncBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Force Server Sync'; }, 2500);
      });
    });
  }

  // Flush Outbox
  var flushBtn = document.getElementById('cfg-tool-flush');
  if (flushBtn) {
    flushBtn.addEventListener('click', function () {
      if (typeof CompanyStoreAdapter === 'undefined' || !CompanyStoreAdapter.isEnabled()) {
        alert('Server persistence is not enabled.');
        return;
      }
      var size = CompanyStoreAdapter.getOutboxSize();
      if (size === 0) { alert('Outbox is empty.'); return; }
      flushBtn.textContent = 'Flushing ' + size + '\u2026';
      flushBtn.disabled = true;
      CompanyStoreAdapter.flushOutbox().then(function (r) {
        flushBtn.innerHTML = '<i class="fas fa-check"></i> ' + r.flushed + ' flushed, ' + r.failed + ' failed';
        flushBtn.disabled = false;
        setTimeout(function () { flushBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Flush Outbox'; }, 3000);
      }).catch(function () {
        flushBtn.innerHTML = '<i class="fas fa-times"></i> Error';
        flushBtn.disabled = false;
        setTimeout(function () { flushBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Flush Outbox'; }, 2500);
      });
    });
  }
})();

// — System Maintenance: type-to-confirm —
(function () {
  var overlay = document.getElementById('cfg-confirm-overlay');
  var titleEl = document.getElementById('cfg-confirm-title');
  var descEl = document.getElementById('cfg-confirm-desc');
  var inputEl = document.getElementById('cfg-confirm-input');
  var cancelBtn = document.getElementById('cfg-confirm-cancel');
  var execBtn = document.getElementById('cfg-confirm-execute');
  var toastEl = document.getElementById('cfg-danger-toast');
  if (!overlay || !inputEl || !execBtn) return;

  var _pendingAction = null;

  var _dangerApiBase = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  function _dangerHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (CompanyStore && CompanyStore.getWriteHeaders) {
      var wh = CompanyStore.getWriteHeaders();
      Object.keys(wh || {}).forEach(function (k) { h[k] = wh[k]; });
    }
    return h;
  }

  function _dangerPost(path) {
    return fetch(_dangerApiBase + path, {
      method: 'POST',
      headers: _dangerHeaders()
    }).then(function (r) {
      return r.text().then(function (t) {
        var data = {};
        if (t && t.trim()) {
          try { data = JSON.parse(t); } catch (e) { data = { raw: t }; }
        }
        if (!r.ok) {
          throw new Error((data && (data.error || data.details)) || ('HTTP ' + r.status));
        }
        return data;
      });
    });
  }

  function _dangerToast(message, isError) {
    if (!toastEl) return;
    toastEl.textContent = message || 'Done.';
    if (isError) toastEl.classList.add('cfg-danger-toast--error');
    else toastEl.classList.remove('cfg-danger-toast--error');
    toastEl.classList.add('active');
    setTimeout(function () { toastEl.classList.remove('active'); }, isError ? 3800 : 1800);
  }

  var DANGER_ACTIONS = {
    'reset-tasks': {
      title: 'Reset Tasks',
      desc: 'This will permanently delete all tasks and the task archive.',
      exec: function () {
        return CompanyStore.setState('ap_tasks', []).then(function () {
          return CompanyStore.setState('ap_tasks_archive', []);
        });
      }
    },
    'reset-directives': {
      title: 'Reset Campaigns',
      desc: 'This will permanently delete all campaigns.',
      exec: function () {
        return CompanyStore.setState('ap_directives', []);
      }
    },
    'reset-objectives': {
      title: 'Reset Goals',
      desc: 'This will permanently delete all quarterly goals.',
      exec: function () {
        return CompanyStore.setState('ap_objectives', []);
      }
    },
    'reset-campaigns': {
      title: 'Reset Campaigns',
      desc: 'This will permanently delete all campaigns.',
      exec: function () {
        return CompanyStore.setState('ap_campaigns', []);
      }
    },
    'reset-calendar': {
      title: 'Reset Calendar',
      desc: 'This will permanently delete all workspace dates and calendar entries.',
      exec: function () {
        return CompanyStore.setState('ap_workspace_dates', []);
      }
    },
    'reset-action-queue': {
      title: 'Reset Action Queue',
      desc: 'This will clear all pending, approved, and executed actions plus rate counts.',
      exec: function () {
        return CompanyStore.setState('ap_action_queue', []).then(function () {
          return CompanyStore.setState('ap_actions', []).then(function () {
            return CompanyStore.setState('ap_approval_queue', []).then(function () {
              try { localStorage.removeItem('ap_action_queue'); } catch (e) {}
              try { localStorage.removeItem('ap_actions'); } catch (e) {}
              try { localStorage.removeItem('ap_approval_queue'); } catch (e) {}
              try { localStorage.removeItem('actionQueue'); } catch (e) {}
              try { localStorage.removeItem('actions'); } catch (e) {}
              try { localStorage.removeItem('approvalQueue'); } catch (e) {}
              try { localStorage.removeItem('ap_action_audit_log'); } catch (e) {}
              try { localStorage.removeItem('ap_action_rate_counts'); } catch (e) {}
            });
          });
        });
      }
    },
    'reset-audit-logs': {
      title: 'Reset All Audit Logs',
      desc: 'This will clear action, worker, planner, calibration, and priority audit logs.',
      exec: function () {
        var keys = ['ap_action_audit', 'ap_action_audit_log', 'ap_worker_audit', 'ap_planner_audit', 'ap_calibration_audit', 'ap_priority_audit'];
        for (var i = 0; i < keys.length; i++) {
          try { localStorage.removeItem(keys[i]); } catch (e) {}
        }
      }
    },
    'clear-company-data': {
      title: 'Clear All Company Data',
      desc: 'This will delete ALL ap_* keys from localStorage. Tasks, projects, goals, configs, audit logs \u2014 everything. Nova and browser state will be preserved.',
      exec: function () {
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf('ap_') === 0) toRemove.push(k);
        }
        for (var j = 0; j < toRemove.length; j++) {
          try { localStorage.removeItem(toRemove[j]); } catch (e) {}
        }
      }
    },
    'reset-documents': {
      title: 'Reset Wiki (Keep Content Gallery)',
      desc: 'This will remove all non-published wiki pages from the system, preserving gallery-visible content.',
      exec: function () {
        return _dangerPost('/company-reset-documents').then(function (d) {
          if (!d || !d.ok) throw new Error('Reset documents failed');
          return d;
        });
      }
    },
    'reset-nongallery-assets': {
      title: 'Reset Non-Gallery Content Assets',
      desc: 'This will remove all image assets not referenced by gallery-visible documents.',
      exec: function () {
        return _dangerPost('/company-reset-nongallery-assets').then(function (d) {
          if (!d || !d.ok) throw new Error('Reset non-gallery assets failed');
          return d;
        });
      }
    }
  };

  function runPendingDangerAction() {
    if (!_pendingAction) return;
    var action = _pendingAction;
    execBtn.disabled = true;
    Promise.resolve().then(function () {
      return action.exec();
    }).then(function () {
      closeConfirm();
      _dangerToast(action.title + ' completed.', false);
      setTimeout(function () { window.location.reload(true); }, 700);
    }).catch(function (err) {
      var msg = (err && err.message) ? err.message : String(err || 'Unknown error');
      _dangerToast('Failed: ' + msg, true);
    }).finally(function () {
      execBtn.disabled = false;
    });
  }

  function openConfirm(actionKey) {
    var action = DANGER_ACTIONS[actionKey];
    if (!action) return;
    _pendingAction = action;
    titleEl.textContent = action.title;
    descEl.textContent = action.desc;
    inputEl.value = '';
    execBtn.classList.remove('ready');
    execBtn.textContent = 'Execute';
    overlay.classList.add('active');
    setTimeout(function () { inputEl.focus(); }, 100);
  }

  function closeConfirm() {
    overlay.classList.remove('active');
    _pendingAction = null;
    inputEl.value = '';
  }

  // Wire up all danger buttons
  var btns = document.querySelectorAll('[data-danger]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function () {
      openConfirm(this.getAttribute('data-danger'));
    });
  }

  // Populate maintenance summary counts
  function _updateMaintSummary() {
    try {
      var tasks = (typeof AgentEngine !== 'undefined' && AgentEngine.getTasks) ? AgentEngine.getTasks() : [];
      var dirs = (typeof AgentEngine !== 'undefined' && AgentEngine.getDirectives) ? AgentEngine.getDirectives() : [];
      var objs = (typeof AgentEngine !== 'undefined' && AgentEngine.getObjectives) ? AgentEngine.getObjectives() : [];
      var gc = document.getElementById('maint-goal-count');
      var pc = document.getElementById('maint-project-count');
      var tc = document.getElementById('maint-task-count');
      var em = document.getElementById('maint-exec-mode');
      if (gc) gc.textContent = objs.length;
      if (pc) pc.textContent = dirs.length;
      if (tc) tc.textContent = tasks.length;
      if (em) {
        var _mApiBase = window.location.hostname.includes('ambientpixels.ai')
          ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';
        fetch(_mApiBase + '/company-state?key=execution_mode', { method: 'GET' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            var v = (d && d.value) ? String(d.value).trim().toLowerCase() : 'active';
            var labels = { active: '\uD83D\uDFE2 Live', observe: '\uD83D\uDFE1 Safe Mode', frozen: '\uD83D\uDD34 Locked' };
            em.textContent = labels[v] || labels.active;
          })
          .catch(function () { em.textContent = '\uD83D\uDFE2 Live'; });
      }
    } catch (_e) { /* fail closed */ }
  }
  _updateMaintSummary();
  window.addEventListener('companystoreready', _updateMaintSummary);

  // — Snapshot Export + Download —
  var _snapExportBtn = document.getElementById('cfg-export-snapshot');
  var _snapDownloadBtn = document.getElementById('cfg-download-snapshot');
  var _snapStatus = document.getElementById('cfg-snapshot-status');
  var _lastSnapshotData = null;
  var _snapRunning = false;
  var _snapApiBase = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';

  if (_snapExportBtn) {
    _snapExportBtn.addEventListener('click', function () {
      if (_snapRunning) return;
      _snapRunning = true;
      _snapExportBtn.disabled = true;
      _snapExportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting\u2026';
      if (_snapStatus) _snapStatus.textContent = '';
      fetch(_snapApiBase + '/export-snapshot', {
        method: 'POST',
        headers: (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteHeaders) ? CompanyStore.getWriteHeaders() : { 'Content-Type': 'application/json' }
      })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          _lastSnapshotData = data;
          _snapExportBtn.innerHTML = '<i class="fas fa-check"></i> Snapshot saved';
          _snapExportBtn.style.color = '#34d399';
          if (_snapStatus) _snapStatus.textContent = data.snapshotFile || 'Saved';
          if (_snapDownloadBtn) _snapDownloadBtn.disabled = false;
        } else {
          _snapExportBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
          _snapExportBtn.style.color = '#f87171';
          if (_snapStatus) _snapStatus.textContent = data.error || 'Export failed';
        }
        setTimeout(function () {
          _snapExportBtn.innerHTML = '<i class="fas fa-camera"></i> Export Snapshot';
          _snapExportBtn.style.color = '#4ecdc4';
          _snapExportBtn.disabled = false;
          _snapRunning = false;
        }, 3000);
      })
      .catch(function (err) {
        _snapExportBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
        _snapExportBtn.style.color = '#f87171';
        if (_snapStatus) _snapStatus.textContent = String(err.message || err);
        setTimeout(function () {
          _snapExportBtn.innerHTML = '<i class="fas fa-camera"></i> Export Snapshot';
          _snapExportBtn.style.color = '#4ecdc4';
          _snapExportBtn.disabled = false;
          _snapRunning = false;
        }, 3000);
      });
    });
  }

  if (_snapDownloadBtn) {
    _snapDownloadBtn.addEventListener('click', function () {
      if (!_lastSnapshotData || !_lastSnapshotData.snapshotFile) return;
      // Fetch the snapshot blob and trigger download
      var blobKey = _lastSnapshotData.snapshotFile.replace('company-state/', '');
      if (_snapStatus) _snapStatus.textContent = 'Downloading\u2026';
      _snapDownloadBtn.disabled = true;
      fetch(_snapApiBase + '/company-state?key=' + encodeURIComponent(blobKey), { method: 'GET' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var json = JSON.stringify(data.value || data, null, 2);
          var blob = new Blob([json], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = blobKey.split('/').pop() || 'snapshot.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          if (_snapStatus) _snapStatus.textContent = 'Downloaded';
          _snapDownloadBtn.disabled = false;
        })
        .catch(function () {
          // Fallback: download the counts/meta we already have
          var json = JSON.stringify(_lastSnapshotData, null, 2);
          var blob = new Blob([json], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'snapshot-meta.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          if (_snapStatus) _snapStatus.textContent = 'Downloaded (meta only)';
          _snapDownloadBtn.disabled = false;
        });
    });
  }

  // Input validation — enable execute only when "DELETE" is typed
  inputEl.addEventListener('input', function () {
    if (inputEl.value.trim().toUpperCase() === 'DELETE') {
      execBtn.classList.add('ready');
    } else {
      execBtn.classList.remove('ready');
    }
  });

  // Enter key shortcut
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && execBtn.classList.contains('ready') && _pendingAction) {
      runPendingDangerAction();
    }
    if (e.key === 'Escape') closeConfirm();
  });

  cancelBtn.addEventListener('click', closeConfirm);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConfirm(); });

  execBtn.addEventListener('click', function () {
    if (!execBtn.classList.contains('ready') || !_pendingAction) return;
    runPendingDangerAction();
  });
})();

// Content Engine Config panel
(function () {
  var presetSel = document.getElementById('cfg-ce-preset');
  var outputsWrap = document.getElementById('cfg-ce-outputs');
  var limitInput = document.getElementById('cfg-ce-limit');
  var versionEl = document.getElementById('cfg-ce-version');
  if (!presetSel || !outputsWrap || !limitInput) return;

  var _apiBase = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  function _getHeaders() {
    var h = { 'Content-Type': 'application/json' };
    try { var k = sessionStorage.getItem('ap_server_key'); if (k) h['x-company-secret'] = k; } catch (e) {}
    if (CompanyStore && CompanyStore.getWriteHeaders) {
      var wh = CompanyStore.getWriteHeaders();
      Object.keys(wh).forEach(function (k) { h[k] = wh[k]; });
      h['Content-Type'] = 'application/json';
    }
    return h;
  }

  function _flashSaved(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 1500);
  }

  function _getSelectedOutputs() {
    var checks = outputsWrap.querySelectorAll('.cfg-ce-check.active');
    var out = [];
    for (var i = 0; i < checks.length; i++) out.push(checks[i].getAttribute('data-output'));
    return out;
  }

  function _buildConfig() {
    return {
      defaultPreset: presetSel.value,
      defaultOutputs: _getSelectedOutputs(),
      maxImagesPerDay: parseInt(limitInput.value) || 50,
      updatedAt: new Date().toISOString()
    };
  }

  function _saveConfig(flashId) {
    var cfg = _buildConfig();
    fetch(_apiBase + '/company-state', {
      method: 'POST',
      headers: _getHeaders(),
      body: JSON.stringify({ key: 'contentEngineConfig', value: cfg })
    }).then(function (r) {
      if (r.ok && flashId) _flashSaved(flashId);
    }).catch(function () {});
  }

  // Load existing config
  fetch(_apiBase + '/company-state?key=contentEngineConfig', { headers: _getHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.value) return;
      var cfg = data.value;
      if (cfg.defaultPreset) presetSel.value = cfg.defaultPreset;
      if (Array.isArray(cfg.defaultOutputs)) {
        var checks = outputsWrap.querySelectorAll('.cfg-ce-check');
        for (var i = 0; i < checks.length; i++) {
          var out = checks[i].getAttribute('data-output');
          if (cfg.defaultOutputs.indexOf(out) !== -1) {
            checks[i].classList.add('active');
          } else {
            checks[i].classList.remove('active');
          }
        }
      }
      if (cfg.maxImagesPerDay != null) limitInput.value = cfg.maxImagesPerDay;
    }).catch(function () {});

  // Show engine version from content-index response
  fetch(_apiBase + '/content-index?limit=1', { headers: _getHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.results && d.results[0] && d.results[0].engineVersion) {
        versionEl.textContent = 'Engine v' + d.results[0].engineVersion;
      } else {
        versionEl.textContent = 'Engine v1.8.1';
      }
    }).catch(function () { versionEl.textContent = 'Engine v1.8.1'; });

  // Wire preset change
  presetSel.addEventListener('change', function () { _saveConfig('cfg-ce-preset-saved'); });

  // Wire output toggles
  outputsWrap.addEventListener('click', function (e) {
    var chip = e.target.closest('.cfg-ce-check');
    if (!chip) return;
    chip.classList.toggle('active');
    // Ensure at least one output remains selected
    if (_getSelectedOutputs().length === 0) {
      chip.classList.add('active');
      return;
    }
    _saveConfig('cfg-ce-outputs-saved');
  });

  // Wire limit change (debounced)
  var _limitTimer = null;
  limitInput.addEventListener('input', function () {
    clearTimeout(_limitTimer);
    _limitTimer = setTimeout(function () { _saveConfig('cfg-ce-limit-saved'); }, 800);
  });
})();

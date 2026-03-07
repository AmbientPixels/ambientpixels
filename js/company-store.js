// company-store.js — Hybrid persistence layer for AmbientPixels Company Module
// Selects backend based on environment:
//   - Server endpoints available → use server storage (Azure Blob via API)
//   - Fallback → localStorage (current behavior, zero changes needed)

var CompanyStore = (function () {
  'use strict';

  // ── State ──
  var _mode = 'local';        // 'local' or 'server'
  var _serverBase = '';        // resolved API base URL
  var _writeSecret = '';       // optional shared secret for writes
  var _serverAvailable = null; // null = unchecked, true/false after probe
  var _probePromise = null;
  var _memCache = {};  // In-memory fallback when localStorage is full
  var _writeFailCount = 0;
  var _lastWriteError = '';
  var _authPrincipal = '';  // base64 client principal from /.auth/me

  // Key mapping: localStorage keys → server state keys
  var KEY_MAP = {
    'ap_tasks':              'tasks',
    'ap_workspace_memory':   'workspaceMemory',
    'ap_agent_configs':      'agentConfigs',
    'ap_workspace_identity': 'identity',
    'ap_workspace_tools':    'tools',
    'ap_workspace_dates':    'dates',
    'ap_metrics':            'metrics',
    'ap_session_log':        'sessionLog',
    'ap_cron_log':           'cronLog',
    'ap_standup_log':        'standupLog',
    'ap_morning_report':     'morningReport',
    'ap_directives':         'directives',
    'ap_campaigns':          'campaigns',
    'ap_objectives':         'objectives',
    'ap_approval_queue':     'approvalQueue',
    'ap_governance_log':     'governanceLog',
    'ap_action_queue':       'actionQueue',
    'ap_action_audit_log':   'actionAuditLog',
    'ap_action_rate_counts': 'actionRateCounts',
    'ap_actions':            'actions',
    'ap_documents':          'documents',
    'ap_published_docs':     'publishedDocs',
    'ap_artifacts':           'ap_artifacts',
    'ap_meetings':            'meetings',
    'ap_tasks_archive':       'tasksArchive',
    'ap_agent_memories':      'agentMemories',
    'ap_agent_seed_memories': 'agentSeedMemories',
    'ap_image_assets':        'imageAssets'
  };

  // Reverse map
  var REVERSE_KEY_MAP = {};
  Object.keys(KEY_MAP).forEach(function (k) { REVERSE_KEY_MAP[KEY_MAP[k]] = k; });

  // ── Init / Probe ──
  function _resolveServerBase() {
    // Direct to Functions App on production (SWA proxy rewrite returns 405 for POST)
    // Auth handled by _fetchAuthPrincipal passing x-ms-client-principal explicitly
    if (window.location.hostname.includes('ambientpixels.ai')) {
      return 'https://ambientpixels-nova-api.azurewebsites.net/api';
    }
    return '/api';
  }

  function init(options) {
    options = options || {};
    // Auto-read writeSecret from sessionStorage if not explicitly provided
    _writeSecret = options.writeSecret || '';
    if (!_writeSecret) {
      try { _writeSecret = sessionStorage.getItem('ap_server_key') || ''; } catch (e) {}
    }
    _serverBase = options.serverBase || _resolveServerBase();

    // Auto-fetch auth principal from Azure SWA (non-blocking)
    _fetchAuthPrincipal();

    // Probe server availability
    _probePromise = _probeServer();
    return _probePromise;
  }

  function _fetchAuthPrincipal() {
    try {
      fetch('/.auth/me').then(function (res) {
        if (!res.ok) return;
        return res.json();
      }).then(function (data) {
        if (data && data.clientPrincipal) {
          _authPrincipal = btoa(JSON.stringify(data.clientPrincipal));
          console.log('[CompanyStore] Authenticated as:', data.clientPrincipal.userDetails || 'user');
        }
      }).catch(function () { /* not authenticated or /.auth/me unavailable */ });
    } catch (e) { /* ignore */ }
  }

  function _probeServer() {
    return fetch(_serverBase + '/company-state?key=_ping', { method: 'GET' })
      .then(function (res) {
        if (res.ok || res.status === 404) {
          _serverAvailable = true;
          _mode = 'server';
          console.log('[CompanyStore] Server mode active');
        } else {
          throw new Error('Server returned ' + res.status);
        }
      })
      .catch(function () {
        _serverAvailable = false;
        _mode = 'local';
        console.log('[CompanyStore] Local mode (server unavailable)');
      });
  }

  function getMode() { return _mode; }
  function isServerAvailable() { return _serverAvailable === true; }

  function ready() {
    if (_probePromise) return _probePromise;
    return Promise.resolve();
  }

  // ── Local storage helpers (same as agent-engine) ──
  function _localGet(key, fallback) {
    // In server mode, prefer in-memory cache (has full untruncated data)
    if (_mode === 'server' && _memCache[key] !== undefined) return _memCache[key];
    try {
      var raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through */ }
    if (_memCache[key] !== undefined) return _memCache[key];
    return fallback;
  }

  // In server mode, localStorage is just a cache. Trim large arrays to fit.
  var LOCAL_CACHE_LIMITS = {
    'ap_tasks': 80, 'ap_actions': 60, 'ap_action_audit_log': 40,
    'ap_action_queue': 40, 'ap_approval_queue': 40, 'ap_governance_log': 40,
    'ap_cron_log': 30, 'ap_standup_log': 20, 'ap_documents': 40,
    'ap_published_docs': 30, 'ap_workspace_dates': 30, 'ap_workspace_memory': 30
  };
  var _cacheFullLogged = {};  // Track which keys already logged quota warning

  function _localSet(key, data) {
    // Always keep full data in memory (localStorage may be trimmed in server mode)
    _memCache[key] = data;
    try {
      var toWrite = data;
      if (_mode === 'server' && Array.isArray(data) && LOCAL_CACHE_LIMITS[key] && data.length > LOCAL_CACHE_LIMITS[key]) {
        toWrite = data.slice(-LOCAL_CACHE_LIMITS[key]);
      }
      localStorage.setItem(key, JSON.stringify(toWrite));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || (e.message && e.message.indexOf('quota') !== -1)) {
        try { localStorage.removeItem(key); } catch (ignore) {}
        if (_mode === 'server') {
          if (!_cacheFullLogged[key]) { console.log('[CompanyStore] Cache full, skipped local cache for:', key); _cacheFullLogged[key] = true; }
        } else {
          console.warn('[CompanyStore] localStorage quota exceeded:', key);
        }
      } else {
        console.warn('[CompanyStore] localStorage write failed:', key, e);
      }
    }
  }

  // ── Server helpers ──
  function _serverHeaders(isWrite) {
    var h = { 'Content-Type': 'application/json' };
    if (isWrite && _writeSecret) {
      h['x-company-secret'] = _writeSecret;
    }
    if (isWrite && _authPrincipal) {
      h['x-ms-client-principal'] = _authPrincipal;
    }
    return h;
  }

  function _serverGet(serverKey) {
    return fetch(_serverBase + '/company-state?key=' + encodeURIComponent(serverKey), {
      method: 'GET',
      headers: _serverHeaders(false)
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Server GET failed: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      return data.value;
    });
  }

  function _serverSet(serverKey, value) {
    return fetch(_serverBase + '/company-state', {
      method: 'POST',
      headers: _serverHeaders(true),
      body: JSON.stringify({ key: serverKey, value: value })
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Server POST failed: ' + res.status);
      return res.json();
    });
  }

  // ── Public API: getState / setState ──
  // These work with localStorage keys (e.g. 'ap_tasks')
  // In server mode, they map to server keys and fetch/push

  function getState(localKey, fallback) {
    if (_mode === 'server' && KEY_MAP[localKey]) {
      return _serverGet(KEY_MAP[localKey])
        .then(function (val) {
          if (val === undefined || val === null) {
            // Server has no data — return fallback (server is authoritative)
            _localSet(localKey, fallback);
            return fallback;
          }
          // Cache locally for offline resilience
          _localSet(localKey, val);
          return val;
        })
        .catch(function () {
          // Fallback to local on server error
          return _localGet(localKey, fallback);
        });
    }
    return Promise.resolve(_localGet(localKey, fallback));
  }

  function setState(localKey, value) {
    // Always write to local as cache
    _localSet(localKey, value);

    if (_mode === 'server' && KEY_MAP[localKey]) {
      return _serverSet(KEY_MAP[localKey], value).catch(function (err) {
        console.warn('[CompanyStore] Server write failed, local cached:', localKey, err);
      });
    }
    return Promise.resolve();
  }

  // ── Sync getState for backward compat (local only, no await) ──
  function getStateSync(localKey, fallback) {
    return _localGet(localKey, fallback);
  }

  function setStateSync(localKey, value) {
    _localSet(localKey, value);
    // Fire-and-forget server write if available
    if (_mode === 'server' && KEY_MAP[localKey]) {
      _serverSet(KEY_MAP[localKey], value).then(function () {
        _writeFailCount = 0;
        _lastWriteError = '';
      }).catch(function (err) {
        _writeFailCount++;
        _lastWriteError = err.message || String(err);
        console.warn('[CompanyStore] Server write FAILED for', localKey, ':', _lastWriteError, '| failures:', _writeFailCount);
      });
    }
  }

  // ── Sync from server ──
  // Pulls all mapped state keys from server into localStorage.
  // Called once after store-ready in server mode.
  var _syncListeners = [];
  var _synced = false;

  function onSync(callback) {
    if (_synced) { callback(); return; }
    _syncListeners.push(callback);
  }

  function syncFromServer() {
    if (_mode !== 'server') {
      _synced = true;
      _syncListeners.forEach(function (cb) { cb(); });
      _syncListeners = [];
      return Promise.resolve();
    }

    // Pull the critical state keys that agents write to
    var keysToSync = ['ap_tasks', 'ap_cron_log', 'ap_standup_log', 'ap_agent_configs', 'ap_morning_report', 'ap_directives', 'ap_campaigns', 'ap_objectives', 'ap_approval_queue', 'ap_governance_log', 'ap_action_queue', 'ap_action_audit_log', 'ap_actions', 'ap_documents', 'ap_published_docs', 'ap_workspace_dates', 'ap_workspace_memory', 'ap_artifacts', 'ap_meetings', 'ap_agent_memories', 'ap_image_assets'];
    var promises = keysToSync.map(function (localKey) {
      var serverKey = KEY_MAP[localKey];
      if (!serverKey) return Promise.resolve();

      return _serverGet(serverKey)
        .then(function (val) {
          if (val === undefined || val === null) {
            // Server has no data — clear local cache to match (server is authoritative)
            _localSet(localKey, []);
            _memCache[localKey] = [];
            return;
          }
          // Server wins — use server data directly, no merge with local
          _memCache[localKey] = val;
          _localSet(localKey, val);
        })
        .catch(function () {
          // Keep local data on failure
        });
    });

    return Promise.all(promises).then(function () {
      if (!_synced) console.log('[CompanyStore] Synced', keysToSync.length, 'keys from server');
      _synced = true;
      _syncListeners.forEach(function (cb) { cb(); });
      _syncListeners = [];
    });
  }

  // ── Logs API ──
  function appendLog(logEvent) {
    // Always append locally
    var logs = _localGet('ap_company_logs', []);
    logs.push(logEvent);
    if (logs.length > 500) logs = logs.slice(-500);
    _localSet('ap_company_logs', logs);

    // Push to server if available
    if (_mode === 'server') {
      fetch(_serverBase + '/company-logs', {
        method: 'POST',
        headers: _serverHeaders(true),
        body: JSON.stringify(logEvent)
      }).catch(function () {});
    }
  }

  function getLogs(options) {
    options = options || {};
    if (_mode === 'server') {
      var params = [];
      if (options.since) params.push('since=' + encodeURIComponent(options.since));
      if (options.type) params.push('type=' + encodeURIComponent(options.type));
      if (options.limit) params.push('limit=' + options.limit);
      var qs = params.length > 0 ? '?' + params.join('&') : '';

      return fetch(_serverBase + '/company-logs' + qs, {
        method: 'GET',
        headers: _serverHeaders(false)
      })
      .then(function (res) {
        if (!res.ok) throw new Error('Logs GET failed');
        return res.json();
      })
      .then(function (data) { return data.logs || []; })
      .catch(function () {
        return _getLocalLogs(options);
      });
    }
    return Promise.resolve(_getLocalLogs(options));
  }

  function _getLocalLogs(options) {
    var logs = _localGet('ap_company_logs', []);
    if (options.since) {
      var sinceMs = new Date(options.since).getTime();
      logs = logs.filter(function (l) { return new Date(l.timestamp).getTime() >= sinceMs; });
    }
    if (options.type) {
      logs = logs.filter(function (l) { return l.type === options.type; });
    }
    if (options.limit) {
      logs = logs.slice(-options.limit);
    }
    return logs;
  }

  // ── Morning Report ──
  function getMorningReport() {
    if (_mode === 'server') {
      return fetch(_serverBase + '/company-report', {
        method: 'GET',
        headers: _serverHeaders(false)
      })
      .then(function (res) {
        if (!res.ok) throw new Error('Report GET failed');
        return res.json();
      })
      .then(function (data) { return data.report || null; })
      .catch(function () {
        return _localGet('ap_morning_report', null);
      });
    }
    return Promise.resolve(_localGet('ap_morning_report', null));
  }

  function setWriteKey(key) {
    _writeSecret = key || '';
    try { sessionStorage.setItem('ap_server_key', _writeSecret); } catch (e) {}
    _writeFailCount = 0;
    _lastWriteError = '';
  }

  function getWriteStatus() {
    return {
      hasKey: !!_writeSecret,
      hasAuth: !!_authPrincipal,
      canWrite: !!_writeSecret || !!_authPrincipal,
      mode: _mode,
      failCount: _writeFailCount,
      lastError: _lastWriteError
    };
  }

  return {
    init: init,
    ready: ready,
    getMode: getMode,
    isServerAvailable: isServerAvailable,
    getState: getState,
    setState: setState,
    getStateSync: getStateSync,
    setStateSync: setStateSync,
    syncFromServer: syncFromServer,
    onSync: onSync,
    appendLog: appendLog,
    getLogs: getLogs,
    getMorningReport: getMorningReport,
    getWriteHeaders: function () { return _serverHeaders(true); },
    getServerBase: function () { return _serverBase; },
    setWriteKey: setWriteKey,
    getWriteStatus: getWriteStatus,
    get _writeSecret() { return _writeSecret; },
    KEY_MAP: KEY_MAP
  };
})();

// ── Auto-init: probe server + sync on script load ──
// Fires 'companystoreready' event on window when sync is complete (or skipped).
(function () {
  if (typeof window === 'undefined') return;
  CompanyStore.init().then(function () {
    if (CompanyStore.isServerAvailable()) {
      return CompanyStore.syncFromServer();
    }
  }).then(function () {
    window.dispatchEvent(new Event('companystoreready'));
  }).catch(function () {
    window.dispatchEvent(new Event('companystoreready'));
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompanyStore;
}

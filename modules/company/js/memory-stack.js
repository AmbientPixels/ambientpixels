(function () {
  'use strict';

  var state = {
    layers: [],
    selectedLayer: null,
    selectedAgent: '',
    view: 'summary',
    lastPayloadText: ''
  };

  function getApiBase() {
    return window.location.hostname.includes('ambientpixels.ai')
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
      : '/api';
  }

  function getAuthHeaders() {
    var headers = {};
    try {
      if (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteHeaders) {
        headers = CompanyStore.getWriteHeaders() || {};
      }
    } catch (e) { /* ignore */ }
    try {
      if (!headers['x-company-secret']) {
        var key = sessionStorage.getItem('ap_server_key') || '';
        if (key) headers['x-company-secret'] = key;
      }
    } catch (e2) { /* ignore */ }
    return headers;
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function bytesToKb(bytes) {
    return (Math.max(0, Number(bytes) || 0) / 1024).toFixed(1) + ' KB';
  }

  function relTime(iso) {
    if (!iso) return '—';
    var ts = Date.parse(iso);
    if (isNaN(ts)) return '—';
    var mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function statusClass(status) {
    if (status === 'ok') return 'ms-badge--ok';
    if (status === 'stale') return 'ms-badge--stale';
    return 'ms-badge--empty';
  }

  function layerSupportsAgent(layerId) {
    return layerId === 'L1' || layerId === 'L2' || layerId === 'L3' || layerId === 'L4';
  }

  function layerDescription(layerId) {
    var map = {
      L1: 'Static personality prompts loaded at cold start.',
      L2: 'Static operating doctrine map used in prompt strategy biasing.',
      L3: 'Seed memories from blob (_global + optional per-agent guidance).',
      L4: 'Runtime memory stack (agent memories + runtimeMemory payloads).',
      L5: 'CEO notes/workspace memory injected as operational context.',
      L6: 'Generated site digest file injected near prompt tail.'
    };
    return map[layerId] || 'Memory layer.';
  }

  function renderLayers() {
    var root = document.getElementById('ms-layers');
    if (!root) return;
    if (!state.layers.length) {
      root.innerHTML = '<div class="ms-empty">No layers available.</div>';
      return;
    }

    var html = '';
    state.layers.forEach(function (l) {
      var isActive = state.selectedLayer && state.selectedLayer.id === l.id;
      html += '<button type="button" class="ms-layer' + (isActive ? ' ms-layer--active' : '') + '" data-layer="' + esc(l.id) + '">';
      html += '<div class="ms-layer-top">';
      html += '<span class="ms-layer-id">' + esc(l.id) + '</span>';
      html += '<span class="ms-layer-name">' + esc(l.name) + '</span>';
      html += '<span class="ms-badge ' + statusClass(l.status) + '">' + esc(l.status) + '</span>';
      html += '</div>';
      html += '<div class="ms-layer-meta">';
      html += '<div>Scope: ' + esc(l.scope) + '</div>';
      html += '<div>Size: ' + esc(bytesToKb(l.sizeBytes)) + '</div>';
      html += '<div>Updated: ' + esc(relTime(l.lastUpdatedAt)) + '</div>';
      html += '</div></button>';
    });
    root.innerHTML = html;

    root.querySelectorAll('.ms-layer').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-layer') || '';
        var found = state.layers.find(function (l) { return l.id === id; });
        if (!found) return;
        state.selectedLayer = found;
        state.selectedAgent = '';
        state.view = 'summary';
        renderLayers();
        renderDetail();
        loadLayerView();
      });
    });
  }

  function renderDetail() {
    var root = document.getElementById('ms-detail');
    if (!root) return;

    var l = state.selectedLayer;
    if (!l) {
      root.innerHTML = '<div class="ms-empty">Select a layer to inspect.</div>';
      return;
    }

    var supportsAgent = layerSupportsAgent(l.id);
    var canSelectAgent = supportsAgent;
    var agentOptions = '<option value="">All / Global</option>';
    (state.agents || []).forEach(function (name) {
      var key = String(name || '').toLowerCase();
      agentOptions += '<option value="' + esc(key) + '"' + (state.selectedAgent === key ? ' selected' : '') + '>' + esc(name) + '</option>';
    });

    root.innerHTML = '' +
      '<div class="ms-detail-row"><span class="ms-label">Layer</span><strong>' + esc(l.id + ' — ' + l.name) + '</strong></div>' +
      '<div class="ms-detail-row"><span class="ms-label">Description</span>' + esc(layerDescription(l.id)) + '</div>' +
      '<div class="ms-detail-row"><span class="ms-label">Injection order</span>' + esc(l.id + ' in heartbeat prompt sequence') + '</div>' +
      '<div class="ms-detail-row"><span class="ms-label">Scope</span>' + esc(l.scope) + '</div>' +
      '<div class="ms-detail-row"><span class="ms-label">Agent</span>' +
      '<select id="ms-agent" class="ms-agent-select" ' + (canSelectAgent ? '' : 'disabled') + '>' + agentOptions + '</select></div>' +
      '<div class="ms-controls">' +
        '<button id="ms-view-summary" class="ms-btn" type="button">View Summary</button>' +
        '<button id="ms-view-full" class="ms-btn ms-btn--ghost" type="button">View Full</button>' +
      '</div>';

    var agentSel = document.getElementById('ms-agent');
    if (agentSel) {
      agentSel.addEventListener('change', function () {
        state.selectedAgent = agentSel.value || '';
        loadLayerView();
      });
    }
    document.getElementById('ms-view-summary').addEventListener('click', function () {
      state.view = 'summary';
      loadLayerView();
    });
    document.getElementById('ms-view-full').addEventListener('click', function () {
      state.view = 'full';
      loadLayerView();
    });
  }

  function applySearchFilter() {
    var q = (document.getElementById('ms-search').value || '').toLowerCase();
    var out = state.lastPayloadText || '';
    if (q) {
      var lines = out.split('\n');
      out = lines.filter(function (line) {
        return line.toLowerCase().indexOf(q) !== -1;
      }).join('\n');
      if (!out.trim()) out = '(no matches)';
    }
    document.getElementById('ms-preview').textContent = out;
  }

  function renderPreview(data) {
    var summaryRoot = document.getElementById('ms-preview-summary');
    var summary = data && data.summary;
    if (!summaryRoot) return;

    if (summary) {
      var html = '';
      html += '<div><strong>Approx bytes:</strong> ' + esc(summary.approxBytes || 0) + '</div>';
      if (summary.topLevelKeys) html += '<div><strong>Top keys:</strong> ' + esc((summary.topLevelKeys || []).join(', ') || '—') + '</div>';
      if (summary.length !== undefined) html += '<div><strong>Length:</strong> ' + esc(summary.length) + '</div>';
      summaryRoot.innerHTML = html;
    } else {
      summaryRoot.innerHTML = '<div class="ms-empty">No summary available.</div>';
    }

    if (state.view === 'full') {
      state.lastPayloadText = JSON.stringify((data && data.payload) || null, null, 2);
    } else {
      state.lastPayloadText = JSON.stringify(summary || {}, null, 2);
    }
    applySearchFilter();
  }

  function loadMeta() {
    var url = getApiBase() + '/memory-stack?view=meta&redact=1';
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));
        state.layers = (resp.body && resp.body.layers) || [];
        state.agents = (resp.body && resp.body.agents) || [];
        if (!state.selectedLayer && state.layers.length) state.selectedLayer = state.layers[0];

        var meta = (resp.body && resp.body.meta) || {};
        document.getElementById('ms-meta').textContent = 'As of ' + (meta.asOfUtc || '—') + ' · mode: ' + (meta.mode || 'real');

        renderLayers();
        renderDetail();
        return loadLayerView();
      })
      .catch(function (err) {
        document.getElementById('ms-meta').textContent = 'Memory stack unavailable: ' + (err.message || 'Unknown error');
        document.getElementById('ms-layers').innerHTML = '<div class="ms-empty">Failed to load layers.</div>';
      });
  }

  function loadLayerView() {
    if (!state.selectedLayer) return Promise.resolve();
    var p = new URLSearchParams();
    p.set('layer', state.selectedLayer.id);
    p.set('view', state.view || 'summary');
    p.set('redact', '1');
    if (state.selectedAgent) p.set('agent_id', state.selectedAgent);

    var url = getApiBase() + '/memory-stack?' + p.toString();
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));
        renderPreview(resp.body || {});
      })
      .catch(function (err) {
        state.lastPayloadText = 'Failed to load layer preview: ' + (err.message || 'Unknown error');
        applySearchFilter();
      });
  }

  function bindGlobal() {
    var search = document.getElementById('ms-search');
    if (search) search.addEventListener('input', applySearchFilter);

    var copyBtn = document.getElementById('ms-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var txt = state.lastPayloadText || '';
        if (!txt) return;
        navigator.clipboard.writeText(txt).then(function () {
          copyBtn.textContent = 'Copied';
          setTimeout(function () { copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 1200);
        }).catch(function () {
          copyBtn.textContent = 'Copy failed';
          setTimeout(function () { copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 1200);
        });
      });
    }
  }

  function init() {
    bindGlobal();
    loadMeta();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

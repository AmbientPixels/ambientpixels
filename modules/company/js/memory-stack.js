(function () {
  'use strict';

  var state = {
    layers: [],
    selectedLayer: null,
    selectedAgent: '',
    view: 'summary',
    redact: true,
    lastPayloadText: '',
    lastFullPayload: null,
    lastLayerResp: null,
    autoRefreshId: null,
    treeData: null
  };

  // ═══ Helpers ═══

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

  function estTokens(bytes) {
    return Math.round(Math.max(0, Number(bytes) || 0) / 4);
  }

  function fmtTokens(bytes) {
    var t = estTokens(bytes);
    if (t >= 1000) return (t / 1000).toFixed(1) + 'K';
    return String(t);
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

  function slaLabel(l) {
    if (!l.staleThresholdMs) return '';
    var hrs = Math.round(l.staleThresholdMs / (60 * 60 * 1000));
    if (l.status === 'stale') return 'SLA >' + hrs + 'h breached';
    if (l.status === 'ok' && l.lastUpdatedAt) return 'SLA <' + hrs + 'h';
    return '';
  }

  function sourceTag(l) {
    if (!l.sourcePath) return '';
    if (l.sourcePath.indexOf('https://') === 0) return 'fallback URL';
    if (l.sourcePath.indexOf('blob:') === 0) return 'blob';
    return 'local file';
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

  // ═══ Health Dashboard ═══

  function renderHealthDashboard() {
    var root = document.getElementById('ms-health');
    if (!root || !state.layers.length) { if (root) root.innerHTML = ''; return; }

    var totalBytes = 0;
    var counts = { ok: 0, stale: 0, empty: 0 };
    var staleNames = [];
    var emptyNames = [];

    state.layers.forEach(function (l) {
      totalBytes += (l.sizeBytes || 0);
      var s = l.status || 'empty';
      if (s === 'ok') counts.ok++;
      else if (s === 'stale') { counts.stale++; staleNames.push(l.id); }
      else { counts.empty++; emptyNames.push(l.id); }
    });

    var totalTokens = estTokens(totalBytes);
    var dotsHtml = '';
    state.layers.forEach(function (l) {
      dotsHtml += '<div class="ms-health-dot ms-health-dot--' + (l.status || 'empty') + '" title="' + esc(l.id + ': ' + l.status) + '"></div>';
    });

    var html = '';
    html += '<div class="ms-health-chip"><div class="ms-health-chip-label">Total Footprint</div><div class="ms-health-chip-value">' + esc(bytesToKb(totalBytes)) + '</div><div class="ms-health-chip-sub">~' + esc(fmtTokens(totalBytes)) + ' tokens</div></div>';
    html += '<div class="ms-health-chip"><div class="ms-health-chip-label">Layer Status</div><div class="ms-health-chip-value">' + esc(counts.ok) + '/' + esc(state.layers.length) + ' OK</div><div class="ms-health-dots">' + dotsHtml + '</div></div>';
    html += '<div class="ms-health-chip"><div class="ms-health-chip-label">Stale</div><div class="ms-health-chip-value">' + esc(counts.stale) + '</div><div class="ms-health-chip-sub">' + esc(staleNames.join(', ') || 'None') + '</div></div>';
    html += '<div class="ms-health-chip"><div class="ms-health-chip-label">Empty</div><div class="ms-health-chip-value">' + esc(counts.empty) + '</div><div class="ms-health-chip-sub">' + esc(emptyNames.join(', ') || 'None') + '</div></div>';

    if (staleNames.length || emptyNames.length) {
      var alertParts = [];
      if (staleNames.length) alertParts.push(staleNames.join(', ') + ' stale');
      if (emptyNames.length) alertParts.push(emptyNames.join(', ') + ' empty');
      html += '<div class="ms-health-alert"><i class="fas fa-exclamation-triangle"></i> ' + esc(alertParts.join(' · ')) + '</div>';
    }

    root.innerHTML = html;
  }

  // ═══ Injection Flow ═══

  function renderFlow() {
    var root = document.getElementById('ms-flow');
    if (!root || !state.layers.length) { if (root) root.innerHTML = ''; return; }

    var html = '';
    state.layers.forEach(function (l, idx) {
      if (idx > 0) html += '<span class="ms-flow-arrow">→</span>';
      var isActive = state.selectedLayer && state.selectedLayer.id === l.id;
      var cls = 'ms-flow-node ms-flow-node--' + (l.status || 'empty');
      if (isActive) cls += ' ms-flow-node--active';
      html += '<button type="button" class="' + cls + '" data-flow-layer="' + esc(l.id) + '">';
      html += '<span class="ms-flow-id">' + esc(l.id) + '</span>';
      html += '<span class="ms-flow-name">' + esc(l.name) + '</span>';
      html += '<span class="ms-flow-tokens">~' + esc(fmtTokens(l.sizeBytes)) + ' tok</span>';
      html += '</button>';
    });
    root.innerHTML = html;

    root.querySelectorAll('[data-flow-layer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-flow-layer') || '';
        selectLayerById(id);
      });
    });
  }

  function selectLayerById(id) {
    var found = state.layers.find(function (l) { return l.id === id; });
    if (!found) return;
    state.selectedLayer = found;
    state.selectedAgent = '';
    state.view = 'summary';
    state.redact = true;
    renderAll();
    loadLayerView();
  }

  // ═══ Layers Panel ═══

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
      var sla = slaLabel(l);
      var src = sourceTag(l);
      html += '<button type="button" class="ms-layer' + (isActive ? ' ms-layer--active' : '') + '" data-layer="' + esc(l.id) + '">';
      html += '<div class="ms-layer-top">';
      html += '<span class="ms-layer-id">' + esc(l.id) + '</span>';
      html += '<span class="ms-layer-name">' + esc(l.name) + '</span>';
      html += '<span class="ms-badge ' + statusClass(l.status) + '">' + esc(l.status) + '</span>';
      html += '</div>';
      html += '<div class="ms-layer-meta">';
      html += '<div>Scope: ' + esc(l.scope) + ' · ' + esc(bytesToKb(l.sizeBytes)) + ' · ~' + esc(fmtTokens(l.sizeBytes)) + ' tok</div>';
      html += '<div>Updated: ' + esc(relTime(l.lastUpdatedAt));
      if (sla) html += ' <span class="ms-sla' + (l.status === 'stale' ? ' ms-sla--warn' : '') + '">' + esc(sla) + '</span>';
      html += '</div>';
      if (src) html += '<div class="ms-source-tag">' + esc(src) + '</div>';
      html += '</div></button>';
    });
    root.innerHTML = html;

    root.querySelectorAll('.ms-layer').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectLayerById(btn.getAttribute('data-layer') || '');
      });
    });
  }

  // ═══ Detail Panel ═══

  function renderAgentHeatmap(l) {
    if (!l.agentSizes || !l.agentSizes.length) return '';
    var maxB = 1;
    l.agentSizes.forEach(function (a) { if (a.bytes > maxB) maxB = a.bytes; });
    var html = '<div class="ms-detail-row"><span class="ms-label">Agent Memory Map</span>';
    html += '<div class="ms-heatmap">';
    l.agentSizes.forEach(function (a) {
      var pct = Math.max(4, Math.round((a.bytes / maxB) * 100));
      var color = a.bytes === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(96,165,250,' + (0.15 + 0.6 * (a.bytes / maxB)).toFixed(2) + ')';
      html += '<div class="ms-heat-cell" title="' + esc(a.agent) + ': ' + esc(bytesToKb(a.bytes)) + ' (~' + esc(fmtTokens(a.bytes)) + ' tok)">';
      html += '<div class="ms-heat-bar" style="width:' + pct + '%; background:' + color + ';"></div>';
      html += '<span class="ms-heat-name">' + esc(a.agent) + '</span>';
      html += '<span class="ms-heat-size">' + esc(bytesToKb(a.bytes)) + ' · ~' + esc(fmtTokens(a.bytes)) + ' tok</span>';
      html += '</div>';
    });
    html += '</div></div>';
    return html;
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

    var sla = slaLabel(l);
    var src = l.sourcePath || '';
    var srcDisplay = src ? src : '—';

    root.innerHTML = '' +
      '<div class="ms-detail-row"><span class="ms-label">Layer</span><strong>' + esc(l.id + ' — ' + l.name) + '</strong></div>' +
      '<div class="ms-detail-row"><span class="ms-label">Description</span>' + esc(layerDescription(l.id)) + '</div>' +
      '<div class="ms-detail-row"><span class="ms-label">Size</span>' + esc(bytesToKb(l.sizeBytes)) + ' · ~' + esc(fmtTokens(l.sizeBytes)) + ' tokens</div>' +
      '<div class="ms-detail-row"><span class="ms-label">Injection order</span>' + esc(l.id + ' in heartbeat prompt sequence') + '</div>' +
      '<div class="ms-detail-row"><span class="ms-label">Scope</span>' + esc(l.scope) + '</div>' +
      '<div class="ms-detail-row"><span class="ms-label">Source</span><span class="ms-source-path">' + esc(srcDisplay) + '</span></div>' +
      (sla ? '<div class="ms-detail-row"><span class="ms-label">Freshness SLA</span><span class="ms-sla' + (l.status === 'stale' ? ' ms-sla--warn' : '') + '">' + esc(sla) + '</span></div>' : '') +
      renderAgentHeatmap(l) +
      '<div class="ms-detail-row"><span class="ms-label">Agent</span>' +
      '<select id="ms-agent" class="ms-agent-select" ' + (canSelectAgent ? '' : 'disabled') + '>' + agentOptions + '</select></div>' +
      '<div class="ms-controls">' +
        '<button id="ms-view-summary" class="ms-btn' + (state.view === 'summary' ? '' : ' ms-btn--ghost') + '" type="button">Summary</button>' +
        '<button id="ms-view-full" class="ms-btn' + (state.view === 'full' ? '' : ' ms-btn--ghost') + '" type="button">Full</button>' +
        '<button id="ms-toggle-redact" class="ms-btn ms-btn--ghost ms-btn--sm" type="button">' + (state.redact ? 'Redacted' : 'Raw') + '</button>' +
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
      renderDetail();
      loadLayerView();
    });
    document.getElementById('ms-view-full').addEventListener('click', function () {
      state.view = 'full';
      renderDetail();
      loadLayerView();
    });
    document.getElementById('ms-toggle-redact').addEventListener('click', function () {
      state.redact = !state.redact;
      renderDetail();
      loadLayerView();
    });
  }

  // ═══ JSON Tree Viewer ═══

  function jsonSize(val) {
    try { return JSON.stringify(val).length; } catch (_) { return 0; }
  }

  function buildTreeHtml(value, key, depth, searchQ) {
    if (depth > 12) return '<span class="ms-tree-ellipsis">[max depth]</span>';
    var html = '';
    var keyHtml = key !== null ? '<span class="ms-tree-key">"' + esc(key) + '"</span><span class="ms-tree-colon">: </span>' : '';
    var matchClass = '';
    if (searchQ && key !== null && String(key).toLowerCase().indexOf(searchQ) !== -1) matchClass = ' ms-tree-row--match';

    if (value === null) {
      html += '<div class="ms-tree-row' + matchClass + '">' + keyHtml + '<span class="ms-tree-null">null</span></div>';
    } else if (typeof value === 'string') {
      var valMatch = searchQ && value.toLowerCase().indexOf(searchQ) !== -1;
      html += '<div class="ms-tree-row' + (matchClass || (valMatch ? ' ms-tree-row--match' : '')) + '">' + keyHtml + '<span class="ms-tree-str">"' + esc(value.length > 200 ? value.slice(0, 200) + '…' : value) + '"</span></div>';
    } else if (typeof value === 'number') {
      html += '<div class="ms-tree-row' + matchClass + '">' + keyHtml + '<span class="ms-tree-num">' + esc(String(value)) + '</span></div>';
    } else if (typeof value === 'boolean') {
      html += '<div class="ms-tree-row' + matchClass + '">' + keyHtml + '<span class="ms-tree-bool">' + esc(String(value)) + '</span></div>';
    } else if (Array.isArray(value)) {
      var uid = 'tree_' + depth + '_' + (key || '') + '_' + Math.random().toString(36).slice(2, 6);
      var sz = jsonSize(value);
      html += '<div class="ms-tree-row' + matchClass + '"><span class="ms-tree-toggle" data-tree-id="' + uid + '">▶</span>' + keyHtml;
      html += '<span class="ms-tree-bracket">[' + value.length + ']</span>';
      html += '<span class="ms-tree-size">' + bytesToKb(sz) + '</span>';
      html += '</div>';
      html += '<div class="ms-tree-node" id="' + uid + '" style="display:none">';
      var limit = Math.min(value.length, 50);
      for (var i = 0; i < limit; i++) {
        html += buildTreeHtml(value[i], String(i), depth + 1, searchQ);
      }
      if (value.length > 50) html += '<div class="ms-tree-ellipsis">…' + (value.length - 50) + ' more items</div>';
      html += '</div>';
    } else if (typeof value === 'object') {
      var keys = Object.keys(value);
      var uid2 = 'tree_' + depth + '_' + (key || '') + '_' + Math.random().toString(36).slice(2, 6);
      var sz2 = jsonSize(value);
      html += '<div class="ms-tree-row' + matchClass + '"><span class="ms-tree-toggle" data-tree-id="' + uid2 + '">▶</span>' + keyHtml;
      html += '<span class="ms-tree-bracket">{' + keys.length + '}</span>';
      html += '<span class="ms-tree-size">' + bytesToKb(sz2) + '</span>';
      html += '</div>';
      html += '<div class="ms-tree-node" id="' + uid2 + '" style="display:none">';
      var limit2 = Math.min(keys.length, 100);
      for (var j = 0; j < limit2; j++) {
        html += buildTreeHtml(value[keys[j]], keys[j], depth + 1, searchQ);
      }
      if (keys.length > 100) html += '<div class="ms-tree-ellipsis">…' + (keys.length - 100) + ' more keys</div>';
      html += '</div>';
    } else {
      html += '<div class="ms-tree-row">' + keyHtml + '<span>' + esc(String(value)) + '</span></div>';
    }
    return html;
  }

  function renderTree() {
    var root = document.getElementById('ms-tree');
    if (!root) return;
    var data = state.treeData;
    if (data === null || data === undefined) {
      root.innerHTML = '<div class="ms-empty">No data to display.</div>';
      return;
    }

    var q = (document.getElementById('ms-search').value || '').trim().toLowerCase();
    var html = buildTreeHtml(data, null, 0, q || null);
    root.innerHTML = html;

    // Count matches
    var matchCount = root.querySelectorAll('.ms-tree-row--match').length;
    var countEl = document.getElementById('ms-search-count');
    if (countEl) {
      countEl.textContent = q ? (matchCount + ' match' + (matchCount !== 1 ? 'es' : '')) : '';
    }

    // Bind toggle clicks
    root.addEventListener('click', function (evt) {
      var toggle = evt.target.closest && evt.target.closest('.ms-tree-toggle');
      if (!toggle) {
        // check for ellipsis expand click on parent nodes
        if (evt.target.classList && evt.target.classList.contains('ms-tree-toggle')) toggle = evt.target;
        else return;
      }
      if (!toggle) return;
      var treeId = toggle.getAttribute('data-tree-id');
      if (!treeId) return;
      var node = document.getElementById(treeId);
      if (!node) return;
      if (node.style.display === 'none') {
        node.style.display = '';
        toggle.textContent = '▼';
      } else {
        node.style.display = 'none';
        toggle.textContent = '▶';
      }
    });

    // Auto-expand first level
    var firstToggles = root.querySelectorAll(':scope > .ms-tree-row > .ms-tree-toggle');
    firstToggles.forEach(function (t) {
      var id = t.getAttribute('data-tree-id');
      var n = document.getElementById(id);
      if (n) { n.style.display = ''; t.textContent = '▼'; }
    });
  }

  // ═══ Preview Panel ═══

  function renderPreview(data) {
    var summaryRoot = document.getElementById('ms-preview-summary');
    var summary = data && data.summary;
    if (!summaryRoot) return;

    if (summary) {
      var html = '';
      html += '<div><strong>Approx size:</strong> ' + esc(bytesToKb(summary.approxBytes || 0)) + ' · ~' + esc(fmtTokens(summary.approxBytes || 0)) + ' tokens</div>';
      if (summary.topLevelKeys) html += '<div><strong>Top keys:</strong> ' + esc((summary.topLevelKeys || []).join(', ') || '—') + '</div>';
      if (summary.length !== undefined) html += '<div><strong>Length:</strong> ' + esc(summary.length) + '</div>';
      if (summary.keySizes && summary.keySizes.length) {
        html += '<div class="ms-key-sizes"><strong>Key sizes:</strong>';
        summary.keySizes.forEach(function (ks) {
          html += '<span class="ms-key-chip">' + esc(ks.key) + ' <em>' + esc(bytesToKb(ks.approxBytes)) + ' · ~' + esc(fmtTokens(ks.approxBytes)) + ' tok</em></span>';
        });
        html += '</div>';
      }
      summaryRoot.innerHTML = html;
    } else {
      summaryRoot.innerHTML = '<div class="ms-empty">No summary available.</div>';
    }

    if (state.view === 'full') {
      state.treeData = (data && data.payload) || null;
      state.lastPayloadText = JSON.stringify(state.treeData, null, 2);
    } else {
      state.treeData = summary || {};
      state.lastPayloadText = JSON.stringify(state.treeData, null, 2);
    }
    renderTree();
  }

  // ═══ Data Loading ═══

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

        renderAll();
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
    p.set('redact', state.redact ? '1' : '0');
    if (state.selectedAgent) p.set('agent_id', state.selectedAgent);

    var url = getApiBase() + '/memory-stack?' + p.toString();
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error((resp.body && resp.body.error) || ('HTTP ' + resp.status));
        state.lastLayerResp = resp.body || {};
        renderPreview(resp.body || {});
      })
      .catch(function (err) {
        state.lastPayloadText = 'Failed to load layer preview: ' + (err.message || 'Unknown error');
        state.treeData = null;
        renderTree();
      });
  }

  function renderAll() {
    renderHealthDashboard();
    renderFlow();
    renderLayers();
    renderDetail();
  }

  // ═══ Utilities ═══

  function buildCurlCmd() {
    if (!state.selectedLayer) return '';
    var p = new URLSearchParams();
    p.set('layer', state.selectedLayer.id);
    p.set('view', state.view || 'summary');
    p.set('redact', state.redact ? '1' : '0');
    if (state.selectedAgent) p.set('agent_id', state.selectedAgent);
    return 'curl -s "' + getApiBase() + '/memory-stack?' + p.toString() + '" -H "x-company-secret: $SECRET"';
  }

  function copyText(txt, btn, label) {
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.innerHTML = label; }, 1200);
    }).catch(function () {
      btn.textContent = 'Failed';
      setTimeout(function () { btn.innerHTML = label; }, 1200);
    });
  }

  function downloadAll() {
    if (!state.layers.length) return;
    var promises = state.layers.map(function (l) {
      var p = new URLSearchParams();
      p.set('layer', l.id);
      p.set('view', 'full');
      p.set('redact', '0');
      var url = getApiBase() + '/memory-stack?' + p.toString();
      return fetch(url, { headers: getAuthHeaders() }).then(function (r) { return r.json(); }).catch(function () { return null; });
    });

    Promise.all(promises).then(function (results) {
      var exportData = { exportedAt: new Date().toISOString(), layers: {} };
      state.layers.forEach(function (l, i) {
        exportData.layers[l.id] = { meta: l, data: results[i] };
      });
      var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'memory-stack-export-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // ═══ Bindings ═══

  function bindGlobal() {
    var search = document.getElementById('ms-search');
    if (search) search.addEventListener('input', function () { renderTree(); });

    var copyBtn = document.getElementById('ms-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyText(state.lastPayloadText, copyBtn, '<i class="fas fa-copy"></i> Copy');
      });
    }

    var curlBtn = document.getElementById('ms-curl');
    if (curlBtn) {
      curlBtn.addEventListener('click', function () {
        copyText(buildCurlCmd(), curlBtn, '<i class="fas fa-terminal"></i> cURL');
      });
    }

    var downloadBtn = document.getElementById('ms-download');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', downloadAll);
    }

    var autoRefresh = document.getElementById('ms-auto-refresh');
    if (autoRefresh) {
      autoRefresh.addEventListener('change', function () {
        if (state.autoRefreshId) { clearInterval(state.autoRefreshId); state.autoRefreshId = null; }
        if (autoRefresh.checked) {
          state.autoRefreshId = setInterval(function () { loadMeta(); }, 60000);
        }
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

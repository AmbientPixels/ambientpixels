/* ═══════════════════════════════════════════════════════════
   Trends Radar — Application Logic
   Rendering, filters, detail panel, opportunity generator.
   Data fetched from Gemini via geminiproxy.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var TD = window.TrendsData;
  if (!TD) { console.warn('[TrendsApp] TrendsData not loaded'); return; }

  /* ── State ── */
  var state = {
    selectedTrendId: null,
    filterCategory: '',
    filterStage: '',
    sortBy: 'score',
    searchQuery: '',
    loading: false,
    error: null
  };

  /* ── Helpers ── */
  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function stageColor(stage) {
    return stage ? stage.color : '#5ae4ff';
  }

  function metricColor(val) {
    if (val >= 80) return '#f87171';
    if (val >= 60) return '#fbbf24';
    if (val >= 40) return '#34d399';
    return '#60a5fa';
  }

  /* ── SVG Builders ── */
  function buildScoreGauge(score, color) {
    var r = 14;
    var circ = 2 * Math.PI * r;
    var offset = circ * (1 - score / 100);
    return '<svg class="tr-score-gauge" viewBox="0 0 36 36">'
      + '<circle class="tr-score-ring--bg" cx="18" cy="18" r="' + r + '"/>'
      + '<circle class="tr-score-ring--fill" cx="18" cy="18" r="' + r + '"'
      + ' stroke="' + (color || '#a78bfa') + '"'
      + ' stroke-dasharray="' + circ + '"'
      + ' stroke-dashoffset="' + offset + '"'
      + ' transform="rotate(-90 18 18)"/>'
      + '<text class="tr-score-label" x="18" y="18">' + score + '</text>'
      + '</svg>';
  }

  function buildSparkline(history, w, h) {
    w = w || 80;
    h = h || 24;
    if (!history || !history.length) return '';
    var maxVal = Math.max.apply(null, history) || 1;
    var pts = history.map(function (v, i) {
      var x = (i / (history.length - 1)) * w;
      var y = h - (v / maxVal) * (h - 2) - 1;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var areaClose = w + ',' + h + ' 0,' + h;
    return '<svg class="tr-sparkline" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
      + '<polygon class="tr-sparkline-area" points="' + pts.join(' ') + ' ' + areaClose + '"/>'
      + '<polyline class="tr-sparkline-line" points="' + pts.join(' ') + '"/>'
      + '</svg>';
  }

  /* ── Filter Logic ── */
  function getFilteredTrends() {
    var list = TD.trends.slice();
    if (state.filterCategory) {
      list = list.filter(function (t) { return t.category === state.filterCategory; });
    }
    if (state.filterStage) {
      list = list.filter(function (t) { return t.stage.id === state.filterStage; });
    }
    if (state.searchQuery) {
      var q = state.searchQuery.toLowerCase();
      list = list.filter(function (t) {
        return t.name.toLowerCase().indexOf(q) !== -1 ||
               t.description.toLowerCase().indexOf(q) !== -1;
      });
    }
    var field = state.sortBy || 'score';
    if (field === 'name') {
      list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    } else {
      list.sort(function (a, b) { return (b[field] || 0) - (a[field] || 0); });
    }
    return list;
  }

  /* ── Loading State ── */
  function renderLoading() {
    var grid = document.getElementById('tr-grid');
    var stats = document.getElementById('tr-stats');
    if (grid) {
      grid.innerHTML = '<div class="tr-loading">'
        + '<div class="tr-loading-spinner"></div>'
        + '<div class="tr-loading-text">Analyzing trends with Gemini...</div>'
        + '</div>';
    }
    if (stats) {
      stats.innerHTML = [0, 1, 2, 3].map(function () {
        return '<div class="tr-stat tr-stat--skeleton"><div class="tr-stat-label">&nbsp;</div><div class="tr-stat-value">&mdash;</div></div>';
      }).join('');
    }
  }

  function renderError(msg) {
    var grid = document.getElementById('tr-grid');
    if (grid) {
      grid.innerHTML = '<div class="tr-error">'
        + '<i class="fas fa-exclamation-triangle" style="font-size:1.2rem;opacity:0.4;margin-bottom:0.4rem"></i>'
        + '<div>' + esc(msg) + '</div>'
        + '<button class="tr-retry-btn" id="tr-retry">Try Again</button>'
        + '</div>';
      document.getElementById('tr-retry').addEventListener('click', loadTrends);
    }
  }

  /* ── Stats ── */
  function renderStats() {
    var el = document.getElementById('tr-stats');
    if (!el || !TD.trends.length) return;

    var total = TD.trends.length;
    var avgScore = Math.round(TD.trends.reduce(function (s, t) { return s + t.score; }, 0) / total);
    var earlyCount = TD.trends.filter(function (t) { return t.stage.id === 'early_signal'; }).length;

    var catCounts = {};
    TD.trends.forEach(function (t) {
      catCounts[t.category] = (catCounts[t.category] || 0) + 1;
    });
    var topCat = '';
    var topCount = 0;
    Object.keys(catCounts).forEach(function (k) {
      if (catCounts[k] > topCount) { topCount = catCounts[k]; topCat = k; }
    });

    var stats = [
      { label: 'Total Trends',  value: total,    color: '#a78bfa' },
      { label: 'Avg Score',     value: avgScore,  color: '#5ae4ff' },
      { label: 'Early Signals', value: earlyCount, color: '#60a5fa' },
      { label: 'Top Category',  value: TD.getCategoryLabel(topCat), color: '#34d399' }
    ];

    el.innerHTML = stats.map(function (s) {
      return '<div class="tr-stat" style="--tr-stat-color:' + s.color + '">'
        + '<div class="tr-stat-label">' + esc(s.label) + '</div>'
        + '<div class="tr-stat-value">' + esc(String(s.value)) + '</div>'
        + '</div>';
    }).join('');
  }

  /* ── Filters ── */
  function renderFilters() {
    var el = document.getElementById('tr-filters');
    if (!el) return;

    var catOpts = '<option value="">All Categories</option>'
      + TD.CATEGORIES.map(function (c) {
          return '<option value="' + c.id + '">' + esc(c.label) + '</option>';
        }).join('');

    var stageOpts = '<option value="">All Stages</option>'
      + TD.STAGES.map(function (s) {
          return '<option value="' + s.id + '">' + esc(s.label) + '</option>';
        }).join('');

    el.innerHTML =
      '<select id="tr-filter-cat" title="Filter by category">' + catOpts + '</select>'
      + '<select id="tr-filter-stage" title="Filter by stage">' + stageOpts + '</select>'
      + '<select id="tr-filter-sort" title="Sort by">'
      +   '<option value="score">Score</option>'
      +   '<option value="searchGrowth">Search Growth</option>'
      +   '<option value="socialVelocity">Social Velocity</option>'
      +   '<option value="name">Name</option>'
      + '</select>'
      + '<input type="text" class="tr-search" id="tr-filter-search" placeholder="Search trends..." />';

    document.getElementById('tr-filter-cat').addEventListener('change', function () {
      state.filterCategory = this.value; renderGrid();
    });
    document.getElementById('tr-filter-stage').addEventListener('change', function () {
      state.filterStage = this.value; renderGrid();
    });
    document.getElementById('tr-filter-sort').addEventListener('change', function () {
      state.sortBy = this.value; renderGrid();
    });
    document.getElementById('tr-filter-search').addEventListener('input', function () {
      state.searchQuery = this.value; renderGrid();
    });
  }

  /* ── Card Grid ── */
  function renderGrid() {
    var container = document.getElementById('tr-grid');
    if (!container) return;

    var trends = getFilteredTrends();

    if (!trends.length) {
      container.innerHTML = '<div class="tr-empty">No trends match the current filters.</div>';
      return;
    }

    container.innerHTML = trends.map(function (t) {
      var selected = t.id === state.selectedTrendId;
      var color = stageColor(t.stage);
      return '<div class="tr-card' + (selected ? ' tr-card--selected' : '') + '" data-id="' + t.id + '" style="--tr-card-accent:' + color + '">'
        + '<div class="tr-card-head">'
        +   '<div>'
        +     '<div class="tr-card-name">' + esc(t.name) + '</div>'
        +     '<div class="tr-card-category">' + esc(TD.getCategoryLabel(t.category)) + '</div>'
        +   '</div>'
        +   buildScoreGauge(t.score, color)
        + '</div>'
        + '<div class="tr-card-desc">' + esc(t.description) + '</div>'
        + '<div class="tr-card-footer">'
        +   '<span class="tr-badge tr-badge--' + t.stage.id + '">' + esc(t.stage.label) + '</span>'
        +   buildSparkline(t.history)
        + '</div>'
        + '</div>';
    }).join('');

    container.querySelectorAll('.tr-card').forEach(function (el) {
      el.addEventListener('click', function () {
        selectTrend(el.getAttribute('data-id'));
      });
    });
  }

  /* ── Select Trend ── */
  function selectTrend(id) {
    state.selectedTrendId = id;
    var trend = TD.trends.find(function (t) { return t.id === id; });
    if (!trend) return;

    renderGrid();
    renderDetail(trend);
    renderOpportunities(trend);

    var detail = document.getElementById('tr-detail');
    if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ── Detail Panel ── */
  function renderDetail(trend) {
    var panel = document.getElementById('tr-detail');
    if (!panel) return;
    panel.style.display = '';

    var color = stageColor(trend.stage);
    var metrics = [
      { label: 'Search Growth',    value: trend.searchGrowth,   color: metricColor(trend.searchGrowth) },
      { label: 'Social Velocity',  value: trend.socialVelocity, color: metricColor(trend.socialVelocity) },
      { label: 'Dev Activity',     value: trend.devActivity,    color: metricColor(trend.devActivity) }
    ];

    var metricsHtml = metrics.map(function (m) {
      return '<div class="tr-metric-row">'
        + '<span class="tr-metric-label">' + esc(m.label) + '</span>'
        + '<div class="tr-metric-bar"><div class="tr-metric-fill" style="width:' + m.value + '%;background:' + m.color + '"></div></div>'
        + '<span class="tr-metric-value" style="color:' + m.color + '">' + m.value + '</span>'
        + '</div>';
    }).join('');

    var signalsHtml = trend.signals.map(function (s) {
      return '<div class="tr-signal-item"><i class="fas fa-bolt"></i>' + esc(s) + '</div>';
    }).join('');

    panel.innerHTML =
      '<div class="tr-detail-header">'
      +   '<h2>' + esc(trend.name) + '</h2>'
      +   '<button class="tr-detail-close" id="tr-detail-close"><i class="fas fa-times"></i> Close</button>'
      + '</div>'
      + '<div class="tr-detail-meta">'
      +   '<span class="tr-detail-score-big" style="color:' + color + '">' + trend.score + '</span>'
      +   '<span class="tr-badge tr-badge--' + trend.stage.id + '">' + esc(trend.stage.label) + '</span>'
      +   '<span style="font-size:0.6rem;opacity:0.4">' + esc(TD.getCategoryLabel(trend.category)) + '</span>'
      + '</div>'
      + '<div class="tr-detail-grid">'
      +   '<div>'
      +     '<div class="tr-detail-section-title">Signal Breakdown</div>'
      +     metricsHtml
      +     '<div class="tr-detail-sparkline">'
      +       '<div class="tr-detail-section-title">Trend History</div>'
      +       buildSparkline(trend.history, 200, 50)
      +     '</div>'
      +   '</div>'
      +   '<div>'
      +     '<div class="tr-detail-section-title">Key Signals</div>'
      +     signalsHtml
      +     '<div class="tr-detail-relevance"><i class="fas fa-link" style="margin-right:0.3rem;opacity:0.4"></i>' + esc(trend.relevance) + '</div>'
      +   '</div>'
      + '</div>';

    document.getElementById('tr-detail-close').addEventListener('click', function () {
      panel.style.display = 'none';
      state.selectedTrendId = null;
      renderGrid();
    });
  }

  /* ── Opportunity Generator ── */
  function renderOpportunities(trend) {
    var opps = TD.generateOpportunities(trend);
    var list = document.getElementById('tr-opp-list');
    var empty = document.getElementById('tr-opp-empty');
    if (!list || !empty) return;

    empty.style.display = opps.length ? 'none' : '';

    list.innerHTML = opps.map(function (o) {
      var typeLabel = o.type.replace(/_/g, ' ');
      return '<div class="tr-opp-card">'
        + '<div class="tr-opp-type"><i class="fas ' + o.icon + '"></i> ' + esc(typeLabel) + '</div>'
        + '<div class="tr-opp-title">' + esc(o.title) + '</div>'
        + '<div class="tr-opp-desc">' + esc(o.description) + '</div>'
        + '<div class="tr-opp-meta">'
        +   '<span>Effort: ' + esc(o.effort) + '</span>'
        +   '<span>Impact: ' + esc(o.impact) + '</span>'
        + '</div>'
        + '<button class="tr-opp-action"'
        +   ' data-opp-type="' + esc(o.type) + '"'
        +   ' data-opp-title="' + esc(o.title) + '"'
        +   ' data-opp-desc="' + esc(o.description) + '"'
        +   ' data-opp-effort="' + esc(o.effort) + '"'
        +   ' data-opp-impact="' + esc(o.impact) + '">'
        +   '<i class="fas fa-plus"></i> '
        +   (o.type === 'campaign_angle' ? 'Create Campaign' : 'Create Task')
        + '</button>'
        + '</div>';
    }).join('');
  }

  /* ── Opportunity Type → Task Mapping ── */
  var OPP_TASK_MAP = {
    blog_post:      { assignee: 'scribe', taskType: 'blog_post',      priority: 'medium' },
    social_post:    { assignee: 'echo',   taskType: 'social_linkedin', priority: 'medium' },
    video_topic:    { assignee: 'scribe', taskType: 'general',         priority: 'low'    },
    campaign_angle: { assignee: 'nova',   taskType: 'general',         priority: 'high'   }
  };

  function handleCreateTaskClick(btn) {
    if (btn.disabled || btn.classList.contains('tr-opp-action--created')) return;
    if (typeof AgentEngine === 'undefined') {
      console.warn('[TrendsApp] AgentEngine not available');
      return;
    }

    var oppType   = btn.getAttribute('data-opp-type');
    var oppTitle  = btn.getAttribute('data-opp-title');
    var oppDesc   = btn.getAttribute('data-opp-desc');
    var oppEffort = btn.getAttribute('data-opp-effort');
    var oppImpact = btn.getAttribute('data-opp-impact');

    var created = null;

    if (oppType === 'campaign_angle') {
      // Campaign opportunities → create a proper campaign
      if (!AgentEngine.addCampaign) {
        console.warn('[TrendsApp] AgentEngine.addCampaign not available');
        return;
      }
      created = AgentEngine.addCampaign({
        title:            oppTitle,
        description:      oppDesc + '\n\nSource: Trends Radar opportunity (campaign_angle)',
        status:           'active',
        allowedTaskTypes: ['blog_post', 'social_linkedin', 'social_bluesky', 'social_x'],
        provenance:       'trends_radar'
      });
      if (created) {
        btn.classList.add('tr-opp-action--created');
        btn.innerHTML = '<i class="fas fa-check"></i> Campaign Created';
        btn.disabled = true;
        if (typeof window.showDemoToast === 'function') {
          window.showDemoToast('Campaign created: "' + oppTitle.substring(0, 40) + '"');
        }
      }
    } else {
      // All other opportunities → create a task
      if (!AgentEngine.addTask) {
        console.warn('[TrendsApp] AgentEngine.addTask not available');
        return;
      }
      var mapping = OPP_TASK_MAP[oppType] || { assignee: null, taskType: 'general', priority: 'medium' };
      created = AgentEngine.addTask({
        title:       oppTitle,
        description: oppDesc + '\n\nSource: Trends Radar opportunity (' + oppType + ')',
        assignee:    mapping.assignee,
        taskType:    mapping.taskType,
        priority:    mapping.priority,
        effort:      oppEffort,
        impact:      oppImpact,
        status:      'backlog',
        tags:        ['trends-radar', oppType],
        source:      { type: 'trends_radar', title: oppTitle, date: new Date().toISOString() }
      });
      if (created) {
        btn.classList.add('tr-opp-action--created');
        btn.innerHTML = '<i class="fas fa-check"></i> Task Created';
        btn.disabled = true;
        if (typeof window.showDemoToast === 'function') {
          window.showDemoToast('Task created: "' + oppTitle.substring(0, 40) + '"');
        }
      }
    }
  }

  /* ── Scout Insights ── */
  function loadScoutInsights() {
    var el = document.getElementById('tr-scout-content');
    if (!el) return;

    var apiBase = window.location.hostname.indexOf('ambientpixels.ai') !== -1
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
      : '/api';

    fetch(apiBase + '/company-state?key=trendInsights')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var arr = data && data.value ? data.value : data;
        if (!Array.isArray(arr) || !arr.length) {
          el.className = 'tr-scout-empty';
          el.textContent = 'No Scout analysis yet — will appear after next heartbeat cycle.';
          return;
        }
        var latest = arr[arr.length - 1];
        renderScoutInsights(latest);
      })
      .catch(function () {
        el.className = 'tr-scout-empty';
        el.textContent = 'Could not load Scout analysis.';
      });
  }

  function renderScoutInsights(data) {
    var el = document.getElementById('tr-scout-content');
    var ageEl = document.getElementById('tr-scout-age');
    if (!el) return;

    if (!data || !Array.isArray(data.insights) || !data.insights.length) {
      el.className = 'tr-scout-empty';
      el.textContent = 'No Scout analysis yet — will appear after next heartbeat cycle.';
      return;
    }

    if (ageEl && data.timestamp) {
      var d = new Date(data.timestamp);
      ageEl.textContent = '— ' + d.toLocaleString();
    }

    // Show only high + medium significance, capped at 6
    var topInsights = data.insights
      .filter(function (i) { return i.significance === 'high' || i.significance === 'medium'; })
      .sort(function (a, b) {
        var order = { high: 0, medium: 1, low: 2 };
        return (order[a.significance] || 2) - (order[b.significance] || 2);
      })
      .slice(0, 6);

    var summaryHtml = data.summary
      ? '<div class="tr-scout-summary">' + esc(data.summary) + '</div>'
      : '';

    var insightsHtml = '<div class="tr-scout-insights">'
      + topInsights.map(function (ins) {
          var sig = ins.significance || 'low';
          return '<div class="tr-scout-insight tr-scout-insight--' + sig + '">'
            + '<div class="tr-scout-insight-name">' + esc(ins.trendName) + '</div>'
            + '<div class="tr-scout-insight-sig tr-scout-insight-sig--' + sig + '">' + sig + ' significance</div>'
            + '<div class="tr-scout-insight-interp">' + esc(ins.interpretation || '') + '</div>'
            + (ins.actionRecommendation
                ? '<div class="tr-scout-insight-action"><i class="fas fa-arrow-right"></i>' + esc(ins.actionRecommendation) + '</div>'
                : '')
            + '</div>';
        }).join('')
      + '</div>';

    el.className = '';
    el.innerHTML = summaryHtml + insightsHtml;
  }

  /* ── Load Trends (state first, Gemini fallback) ── */
  function loadTrends() {
    if (state.loading) return;
    state.loading = true;
    state.error = null;

    renderLoading();
    setRefreshState(true);

    TD.fetchTrends()
      .then(function () {
        state.loading = false;
        renderStats();
        renderGrid();
        updateSourceHint();
        resetDetailAndOpps();
        setRefreshState(false);
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message;
        renderError(err.message);
        setRefreshState(false);
        console.error('[TrendsApp]', err);
      });
  }

  /* ── Force Refresh (triggers server-side ingestion) ── */
  function refreshTrends() {
    if (state.loading) return;
    state.loading = true;
    state.error = null;

    renderLoading();
    setRefreshState(true);

    TD.refreshTrends()
      .then(function () {
        state.loading = false;
        renderStats();
        renderGrid();
        updateSourceHint();
        resetDetailAndOpps();
        setRefreshState(false);
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message;
        renderError(err.message);
        setRefreshState(false);
        console.error('[TrendsApp] Refresh failed:', err);
      });
  }

  function resetDetailAndOpps() {
    var detail = document.getElementById('tr-detail');
    if (detail) detail.style.display = 'none';
    var oppList = document.getElementById('tr-opp-list');
    var oppEmpty = document.getElementById('tr-opp-empty');
    if (oppList) oppList.innerHTML = '';
    if (oppEmpty) oppEmpty.style.display = '';
    state.selectedTrendId = null;
  }

  function setRefreshState(loading) {
    var btn = document.getElementById('tr-refresh-btn');
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.querySelector('i').className = 'fas fa-rotate fa-spin';
    } else {
      btn.disabled = false;
      btn.querySelector('i').className = 'fas fa-rotate';
    }
  }

  function updateSourceHint() {
    var hint = document.getElementById('tr-source-hint');
    if (!hint) return;
    if (TD.lastSource === 'trendRadar' && TD.lastIngestedAt) {
      var d = new Date(TD.lastIngestedAt);
      hint.textContent = 'Last ingested: ' + d.toLocaleString();
    } else if (TD.lastSource === 'gemini-live') {
      hint.textContent = 'Live from Gemini (no stored data yet)';
    } else {
      hint.textContent = '';
    }
  }

  /* ── Init ── */
  function init() {
    // Add refresh button + source hint to header
    var header = document.querySelector('.company-header');
    if (header) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:0.5rem;margin-top:0.4rem;flex-wrap:wrap';

      var btn = document.createElement('button');
      btn.id = 'tr-refresh-btn';
      btn.className = 'tr-refresh-btn';
      btn.title = 'Trigger server-side trend ingestion and reload';
      btn.innerHTML = '<i class="fas fa-rotate"></i> Refresh';
      btn.addEventListener('click', refreshTrends);
      wrap.appendChild(btn);

      var hint = document.createElement('span');
      hint.id = 'tr-source-hint';
      hint.style.cssText = 'font-size:0.55rem;opacity:0.35';
      wrap.appendChild(hint);

      header.appendChild(wrap);
    }

    renderFilters();

    // Delegate Create Task clicks on opportunity list
    var oppList = document.getElementById('tr-opp-list');
    if (oppList) {
      oppList.addEventListener('click', function (e) {
        var btn = e.target.closest('.tr-opp-action');
        if (btn) handleCreateTaskClick(btn);
      });
    }

    loadTrends();
    loadScoutInsights();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

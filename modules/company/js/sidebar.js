// ── APMode — UI Mode Manager (inline for all sidebar pages) ──
(function () {
  'use strict';
  var MODES = ['executive', 'operator', 'admin'];
  var KEY = 'ap_ui_mode';
  window.APMode = {
    MODES: MODES,
    get: function () { return localStorage.getItem(KEY) || 'executive'; },
    set: function (mode) {
      if (MODES.indexOf(mode) === -1) return;
      localStorage.setItem(KEY, mode);
      window.dispatchEvent(new CustomEvent('ap-mode-change', { detail: { mode: mode } }));
    },
    atLeast: function (required) {
      var current = this.get();
      return MODES.indexOf(current) >= MODES.indexOf(required);
    },
    cycle: function () {
      var idx = MODES.indexOf(this.get());
      var next = MODES[(idx + 1) % MODES.length];
      this.set(next);
      return next;
    }
  };
})();

// ── Hybrid Nav: Left Rail Chips + Top Sub-link Bar ──
// Left rail = category icon chips (like VS Code activity bar)
// Top bar = sub-links for the active category
// Include this script on every company page.

(function () {
  'use strict';

  var BASE = '/modules/company/';

  // ── Mode helpers ──
  function _modeIcon(m) {
    return m === 'admin' ? 'fa-wrench' : m === 'operator' ? 'fa-terminal' : 'fa-crown';
  }
  function _modeLabel(m) {
    return m === 'admin' ? 'Admin' : m === 'operator' ? 'Operator' : 'Executive';
  }
  function _modeTint(m) {
    return m === 'admin' ? '#fbbf24' : m === 'operator' ? '#34d399' : '#c084fc';
  }

  // Navigation structure: 5 categories
  var NAV = [
    {
      id: 'command',
      label: 'Command',
      icon: 'fa-tower-broadcast',
      overview: BASE + 'dashboard.html',
      links: [
        { href: BASE + 'dashboard.html', label: 'Dashboard', icon: 'fa-gauge-high', match: ['dashboard.html'] },
        { href: BASE + 'standup.html', label: 'Standup', icon: 'fa-users', match: ['standup.html'] },
        { href: BASE + 'meetings.html', label: 'Meetings', icon: 'fa-video', match: ['meetings.html'] }
      ]
    },
    {
      id: 'work',
      label: 'Work',
      icon: 'fa-list-check',
      overview: BASE + 'tasks.html',
      links: [
        { href: BASE + 'tasks.html', label: 'Tasks', icon: 'fa-tasks', match: ['tasks.html'] },
        { href: BASE + 'actions.html', label: 'Actions', icon: 'fa-bolt', match: ['actions.html'] },
        { href: BASE + 'inbound.html', label: 'Inbound', icon: 'fa-satellite-dish', match: ['inbound.html'] }
      ]
    },
    {
      id: 'plan',
      label: 'Plan',
      icon: 'fa-compass',
      overview: BASE + 'objectives.html',
      links: [
        { href: BASE + 'objectives.html', label: 'Goals', icon: 'fa-bullseye', match: ['objectives.html'] },
        { href: BASE + 'campaigns.html', label: 'Campaigns', icon: 'fa-layer-group', match: ['campaigns.html', 'directives.html'] },
        { href: BASE + 'calendar.html', label: 'Calendar', icon: 'fa-calendar-alt', match: ['calendar.html'] },
        { href: BASE + 'trends.html', label: 'Trends', icon: 'fa-chart-line', match: ['trends.html'] },
        { href: BASE + 'governance.html', label: 'Playbook', icon: 'fa-scroll', match: ['governance.html'] }
      ]
    },
    {
      id: 'content',
      label: 'Content',
      icon: 'fa-wand-magic-sparkles',
      overview: BASE + 'content-overview.html',
      links: [
        { href: BASE + 'content-overview.html', label: 'Content Hub', icon: 'fa-layer-group', match: ['content-overview.html'] },
        { href: BASE + 'content-engine.html', label: 'Image Engine', icon: 'fa-images', match: ['content-engine.html'] },
        { href: BASE + 'content-gallery.html', label: 'Gallery', icon: 'fa-photo-film', match: ['content-gallery.html'] },
        { href: BASE + 'analytics-hub.html', label: 'Analytics Hub', icon: 'fa-chart-simple', match: ['analytics-hub.html'] },
        { href: BASE + 'attribution.html', label: 'Attribution', icon: 'fa-chart-line', match: ['attribution.html'] },
        { href: BASE + 'bluesky-discovery.html', label: 'Bluesky', icon: 'fa-satellite-dish', match: ['bluesky-discovery.html'] }
      ]
    },
    {
      id: 'system',
      label: 'System',
      icon: 'fa-sliders',
      overview: BASE + 'config-overview.html',
      links: [
        { href: BASE + 'config-overview.html', label: 'Config', icon: 'fa-sliders', match: ['config-overview.html'] },
        { href: BASE + 'workspace.html', label: 'Workspace', icon: 'fa-layer-group', match: ['workspace.html'] },
        { href: BASE + 'memories.html', label: 'Memory', icon: 'fa-brain', match: ['memories.html'] },
        { href: BASE + 'cost-overview.html', label: 'Costs', icon: 'fa-dollar-sign', match: ['cost-overview.html'] },
        { href: BASE + 'agent-performance.html', label: 'Agent Perf', icon: 'fa-gauge-high', match: ['agent-performance.html'] },
        { href: BASE + 'agent-intelligence.html', label: 'Agent Intel', icon: 'fa-lightbulb', match: ['agent-intelligence.html'] },
        { href: BASE + 'governance-report.html', label: 'Governance', icon: 'fa-shield-halved', match: ['governance-report.html'], minMode: 'admin' },
        { href: BASE + 'action-audit.html', label: 'Action Audit', icon: 'fa-receipt', match: ['action-audit.html'], minMode: 'admin' },
        { href: BASE + 'memory-stack.html', label: 'Diagnostics', icon: 'fa-microscope', match: ['memory-stack.html'], minMode: 'admin' }
      ]
    }
  ];

  // Detect current page
  var path = window.location.pathname;
  var currentFile = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
  if (currentFile === '' || currentFile === 'company' || path.endsWith('/company/')) currentFile = 'index.html';

  function isActive(match) {
    for (var i = 0; i < match.length; i++) {
      if (match[i] === currentFile) return true;
      if (match[i] === '' && (currentFile === 'index.html' || currentFile === '')) return true;
    }
    return false;
  }

  // Find active category — default to command
  var activeCatId = 'command';
  NAV.forEach(function (cat) {
    cat.links.forEach(function (link) {
      if (isActive(link.match)) activeCatId = cat.id;
    });
  });

  var selectedCatId = activeCatId;

  // ── Build Left Rail ──
  var rail = document.createElement('aside');
  rail.className = 'sb-rail';

  // Logo at top
  var logo = document.createElement('a');
  logo.href = BASE;
  logo.className = 'sb-rail-logo';
  logo.title = 'AmbientPixels HQ';
  logo.innerHTML = '<i class="fas fa-building"></i>';
  rail.appendChild(logo);

  // Category chips
  var chipsWrap = document.createElement('div');
  chipsWrap.className = 'sb-rail-chips';

  var chipMap = {};

  NAV.forEach(function (cat) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sb-rail-chip' + (cat.id === activeCatId ? ' sb-rail-chip--active' : '');
    chip.title = cat.label;
    chip.innerHTML = '<i class="fas ' + cat.icon + '"></i>' + cat.label;
    chip.addEventListener('click', function () {
      // Navigate to overview page for this category
      if (cat.id !== activeCatId && cat.overview) {
        window.location.href = cat.overview;
      } else {
        selectCategory(cat.id);
      }
    });
    chipMap[cat.id] = chip;
    chipsWrap.appendChild(chip);
  });

  rail.appendChild(chipsWrap);

  // Theme cycling helper
  var THEMES = ['dark', 'dim', 'light'];
  var THEME_ICONS = { dark: 'fa-moon', dim: 'fa-circle-half-stroke', light: 'fa-sun' };
  var THEME_LABELS = { dark: 'Dark', dim: 'Medium (Blue)', light: 'Light (Grey)' };
  function _getTheme() { return localStorage.getItem('preferred-theme') || 'dark'; }
  function _applyTheme(t) {
    localStorage.setItem('preferred-theme', t);
    document.body.setAttribute('data-theme', t);
    document.body.style.background = '';
  }
  // Apply stored theme on load
  _applyTheme(_getTheme());

  // Footer: Wiki + Globe + Blog + Theme + Mode + Auth
  var curMode = window.APMode ? window.APMode.get() : 'executive';
  var curTheme = _getTheme();
  var footer = document.createElement('div');
  footer.className = 'sb-rail-footer';
  footer.innerHTML = '<a href="' + BASE + 'documents.html" class="sb-rail-globe" title="Wiki"><i class="fas fa-book"></i></a>' +
    '<a href="/" class="sb-rail-globe" title="Main Site"><i class="fas fa-globe"></i></a>' +
    '<a href="/blog/" class="sb-rail-globe" title="Public Blog" style="opacity:0.5;"><i class="fas fa-newspaper"></i></a>' +
    '<button type="button" id="sb-theme-btn" class="sb-rail-globe" title="Theme: ' + THEME_LABELS[curTheme] + '" style="background:none; border:none; cursor:pointer; color:inherit; font-size:inherit; padding:0; opacity:0.6;"><i class="fas ' + (THEME_ICONS[curTheme] || 'fa-moon') + '"></i></button>' +
    '<button type="button" id="sb-mode-btn" class="sb-rail-globe sb-mode-btn" title="Mode: ' + _modeLabel(curMode) + '" style="background:none; border:none; cursor:pointer; color:' + _modeTint(curMode) + '; font-size:inherit; padding:0; opacity:0.7;"><i class="fas ' + _modeIcon(curMode) + '"></i></button>' +
    '<button type="button" id="sb-auth-btn" class="sb-rail-globe" title="Loading..." style="opacity:0.4; background:none; border:none; cursor:pointer; color:inherit; font-size:inherit; padding:0;"><i class="fas fa-spinner fa-spin"></i></button>';
  rail.appendChild(footer);

  // Theme toggle handler
  var themeBtn = footer.querySelector('#sb-theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = _getTheme();
      var idx = THEMES.indexOf(cur);
      var next = THEMES[(idx + 1) % THEMES.length];
      _applyTheme(next);
      themeBtn.title = 'Theme: ' + THEME_LABELS[next];
      themeBtn.innerHTML = '<i class="fas ' + THEME_ICONS[next] + '"></i>';
    });
  }

  // Mode toggle handler
  var modeBtn = footer.querySelector('#sb-mode-btn');
  if (modeBtn && window.APMode) {
    modeBtn.addEventListener('click', function () {
      var next = window.APMode.cycle();
      modeBtn.title = 'Mode: ' + _modeLabel(next);
      modeBtn.style.color = _modeTint(next);
      modeBtn.innerHTML = '<i class="fas ' + _modeIcon(next) + '"></i>';
      renderSubLinks(selectedCatId);
    });
  }

  // Check auth status and update button
  fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (data) {
    var btn = document.getElementById('sb-auth-btn');
    if (!btn) return;
    var user = data && data.clientPrincipal;
    if (user) {
      btn.title = 'Logout (' + (user.userDetails || 'user') + ')';
      btn.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
      btn.style.opacity = '0.6';
      btn.addEventListener('click', function () {
        window.location.href = '/.auth/logout?post_logout_redirect_uri=/';
      });
    } else {
      btn.title = 'Sign In';
      btn.innerHTML = '<i class="fas fa-sign-in-alt"></i>';
      btn.style.opacity = '0.6';
      btn.addEventListener('click', function () {
        window.location.href = '/pages/login.html?redirect=' + encodeURIComponent(window.location.pathname);
      });
    }
  }).catch(function () {
    var btn = document.getElementById('sb-auth-btn');
    if (btn) { btn.style.display = 'none'; }
  });

  // ── Build Top Sub-link Bar ──
  var topbar = document.createElement('nav');
  topbar.className = 'sb-topbar';

  function renderSubLinks(catId) {
    topbar.innerHTML = '';
    var cat = NAV.filter(function (c) { return c.id === catId; })[0];
    if (!cat) return;

    // Category label
    var label = document.createElement('span');
    label.className = 'sb-topbar-label';
    label.textContent = cat.label;
    topbar.appendChild(label);

    // Sub-links (filtered by mode)
    cat.links.forEach(function (link) {
      if (link.minMode && window.APMode && !window.APMode.atLeast(link.minMode)) return;
      var a = document.createElement('a');
      a.href = link.href;
      a.className = 'sb-sub' + (isActive(link.match) ? ' sb-sub--active' : '');
      a.innerHTML = '<i class="fas ' + link.icon + '"></i>' + link.label;
      topbar.appendChild(a);
    });

  }

  function selectCategory(catId) {
    selectedCatId = catId;
    Object.keys(chipMap).forEach(function (id) {
      chipMap[id].className = 'sb-rail-chip' + (id === catId ? ' sb-rail-chip--active' : '');
    });
    renderSubLinks(catId);
  }

  // Initial render
  renderSubLinks(selectedCatId);

  // ── Apply APMode attribute to body for CSS-based mode gating ──
  function _applyModeAttr() {
    document.body.setAttribute('data-mode', window.APMode ? window.APMode.get() : 'executive');
  }
  _applyModeAttr();
  window.addEventListener('ap-mode-change', _applyModeAttr);

  // ── Assemble layout ──
  var body = document.body;
  var layout = document.createElement('div');
  layout.className = 'sb-layout';

  var main = document.createElement('div');
  main.className = 'sb-main';

  var content = document.createElement('div');
  content.className = 'sb-content';

  while (body.firstChild) {
    content.appendChild(body.firstChild);
  }

  main.appendChild(topbar);
  main.appendChild(content);

  layout.appendChild(rail);
  layout.appendChild(main);
  body.appendChild(layout);

})();

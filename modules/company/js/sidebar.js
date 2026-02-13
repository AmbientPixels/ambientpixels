// ── Hybrid Nav: Left Rail Chips + Top Sub-link Bar ──
// Left rail = category icon chips (like VS Code activity bar)
// Top bar = sub-links for the active category
// Include this script on every company page.

(function () {
  'use strict';

  var BASE = '/modules/company/';

  // Navigation structure: categories → links
  var NAV = [
    {
      id: 'ops',
      label: 'Ops',
      icon: 'fa-gauge-high',
      overview: BASE + 'ops-overview.html',
      links: [
        { href: BASE + 'ops-overview.html', label: 'Overview', icon: 'fa-gauge-high', match: ['ops-overview.html', 'index.html', ''] },
        { href: BASE + 'dashboard.html', label: 'Dashboard', icon: 'fa-chart-line', match: ['dashboard.html'] },
        { href: BASE + 'standup.html', label: 'Standup', icon: 'fa-users', match: ['standup.html'] }
      ]
    },
    {
      id: 'work',
      label: 'Work',
      icon: 'fa-list-check',
      overview: BASE + 'work-overview.html',
      links: [
        { href: BASE + 'work-overview.html', label: 'Overview', icon: 'fa-list-check', match: ['work-overview.html'] },
        { href: BASE + 'tasks.html', label: 'Tasks', icon: 'fa-tasks', match: ['tasks.html'] },
        { href: BASE + 'actions.html', label: 'Actions', icon: 'fa-bolt', match: ['actions.html'] },
        { href: BASE + 'documents.html', label: 'Docs', icon: 'fa-folder-open', match: ['documents.html'] }
      ]
    },
    {
      id: 'strategy',
      label: 'Plan',
      icon: 'fa-compass',
      overview: BASE + 'plan-overview.html',
      links: [
        { href: BASE + 'plan-overview.html', label: 'Overview', icon: 'fa-compass', match: ['plan-overview.html'] },
        { href: BASE + 'directives.html', label: 'Directives', icon: 'fa-compass', match: ['directives.html'] },
        { href: BASE + 'objectives.html', label: 'Objectives', icon: 'fa-bullseye', match: ['objectives.html'] },
        { href: BASE + 'governance.html', label: 'Governance', icon: 'fa-scroll', match: ['governance.html'] }
      ]
    },
    {
      id: 'config',
      label: 'Config',
      icon: 'fa-sliders',
      overview: BASE + 'config-overview.html',
      links: [
        { href: BASE + 'config-overview.html', label: 'Overview', icon: 'fa-sliders', match: ['config-overview.html'] },
        { href: BASE + 'workspace.html', label: 'Workspace', icon: 'fa-layer-group', match: ['workspace.html'] },
        { href: BASE + 'agent-chat.html', label: 'Agent Chat', icon: 'fa-comments', match: ['agent-chat.html'] }
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

  // Find active category
  var activeCatId = 'ops';
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

  // Globe at bottom
  var footer = document.createElement('div');
  footer.className = 'sb-rail-footer';
  footer.innerHTML = '<a href="/" class="sb-rail-globe" title="Main Site"><i class="fas fa-globe"></i></a>';
  rail.appendChild(footer);

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

    // Sub-links
    cat.links.forEach(function (link) {
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

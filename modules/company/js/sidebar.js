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
        { href: BASE + 'standup.html', label: 'Standup', icon: 'fa-users', match: ['standup.html'] },
        { href: BASE + 'meetings.html', label: 'Meetings', icon: 'fa-video', match: ['meetings.html'] },
        { href: BASE + 'cost-overview.html', label: 'Costs', icon: 'fa-dollar-sign', match: ['cost-overview.html'] },
        { href: BASE + 'social-analytics.html', label: 'Social Analytics', icon: 'fa-chart-simple', match: ['social-analytics.html'] },
        { href: BASE + 'memory-stack.html', label: 'Memory Stack', icon: 'fa-layer-group', match: ['memory-stack.html'] }
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
      id: 'inbound',
      label: 'Inbound',
      icon: 'fa-satellite-dish',
      overview: BASE + 'inbound.html',
      links: [
        { href: BASE + 'inbound.html', label: 'Inbound', icon: 'fa-satellite-dish', match: ['inbound.html'] }
      ]
    },
    {
      id: 'content',
      label: 'Content',
      icon: 'fa-wand-magic-sparkles',
      overview: BASE + 'content-overview.html',
      links: [
        { href: BASE + 'content-overview.html', label: 'Overview', icon: 'fa-wand-magic-sparkles', match: ['content-overview.html'] },
        { href: BASE + 'content-engine.html', label: 'Image Engine', icon: 'fa-images', match: ['content-engine.html'] },
        { href: BASE + 'content-gallery.html', label: 'Gallery', icon: 'fa-photo-film', match: ['content-gallery.html'] }
      ]
    },
    {
      id: 'strategy',
      label: 'Plan',
      icon: 'fa-compass',
      overview: BASE + 'plan-overview.html',
      links: [
        { href: BASE + 'plan-overview.html', label: 'Overview', icon: 'fa-compass', match: ['plan-overview.html'] },
        { href: BASE + 'objectives.html', label: 'Goals', icon: 'fa-bullseye', match: ['objectives.html'] },
        { href: BASE + 'campaigns.html', label: 'Campaigns', icon: 'fa-layer-group', match: ['campaigns.html', 'directives.html'] },
        { href: BASE + 'calendar.html', label: 'Calendar', icon: 'fa-calendar-alt', match: ['calendar.html'] },
        { href: BASE + 'governance.html', label: 'Playbook', icon: 'fa-scroll', match: ['governance.html'] }
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
        { href: BASE + 'memories.html', label: 'Memory', icon: 'fa-brain', match: ['memories.html'] }
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

  // Footer: Globe + Auth
  var footer = document.createElement('div');
  footer.className = 'sb-rail-footer';
  footer.innerHTML = '<a href="/" class="sb-rail-globe" title="Main Site"><i class="fas fa-globe"></i></a>' +
    '<a href="/blog/" class="sb-rail-globe" title="Public Blog" style="opacity:0.5;"><i class="fas fa-newspaper"></i></a>' +
    '<button type="button" id="sb-auth-btn" class="sb-rail-globe" title="Loading..." style="opacity:0.4; background:none; border:none; cursor:pointer; color:inherit; font-size:inherit; padding:0;"><i class="fas fa-spinner fa-spin"></i></button>';
  rail.appendChild(footer);

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
        window.location.href = '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname);
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

    // Sub-links
    cat.links.forEach(function (link) {
      var a = document.createElement('a');
      a.href = link.href;
      a.className = 'sb-sub' + (isActive(link.match) ? ' sb-sub--active' : '');
      a.innerHTML = '<i class="fas ' + link.icon + '"></i>' + link.label;
      topbar.appendChild(a);
    });

    var ambientcore = document.createElement('a');
    ambientcore.href = '/ambientcore/';
    ambientcore.className = 'sb-topbar-ambientcore';
    ambientcore.setAttribute('aria-label', 'AmbientCore overview');
    ambientcore.innerHTML = '<i class="fas fa-server" aria-hidden="true"></i><span>AmbientCore v1.0</span>';
    topbar.appendChild(ambientcore);
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

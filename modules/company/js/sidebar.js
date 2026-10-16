// ── HQ rail: six places, nothing else (2026-10-16) ──
// Today · Inbox · Plan · Team · Results · Workshop. No sub-bar, no UI modes: every page shows everything it has,
// and every tool page is listed in Workshop (≤ 2 clicks from anywhere).
// Plan: docs/superpowers/plans/2026-10-16-hq-simplification-plan.md §1c.
// Include this script on every company page (it wraps the page in the rail layout).

// APMode stays as a shim for legacy pages that still ask (data-mode CSS gating, atLeast checks). The three
// executive/operator/admin modes hid nav items and page parts behind a localStorage flag; now nothing is hidden.
(function () {
  'use strict';
  window.APMode = {
    MODES: ['admin'],
    get: function () { return 'admin'; },
    set: function () {},
    atLeast: function () { return true; },
    cycle: function () { return 'admin'; }
  };
})();

(function () {
  'use strict';

  var BASE = '/modules/company/';

  // Each place: where the rail goes, and the pages that belong to it (so the right item lights up on old pages
  // until they are replaced). Inbox, Plan, Team and Results point at their closest current page until they ship.
  var PLACES = [
    { id: 'today', label: 'Today', icon: 'fa-sun', href: BASE + 'today.html',
      pages: ['today.html', 'index.html', 'dashboard.html', 'cockpit.html', 'office.html'] },
    { id: 'inbox', label: 'Inbox', icon: 'fa-inbox', href: BASE + 'actions.html',
      pages: ['actions.html', 'goals.html', 'allocation.html', 'meetings.html', 'content-overview.html', 'engagement.html', 'inbound.html'] },
    { id: 'plan', label: 'Plan', icon: 'fa-compass', href: BASE + 'campaigns.html',
      pages: ['objectives.html', 'campaigns.html', 'directives.html', 'calendar.html', 'tasks.html', 'standup.html'] },
    { id: 'team', label: 'Team', icon: 'fa-users', href: BASE + 'fleet.html',
      pages: ['agents.html', 'fleet.html', 'agent-performance.html', 'agent-intelligence.html', 'agent-progress.html', 'awareness.html', 'memories.html', 'seasons.html', 'agent-chat.html', 'voice.html'] },
    { id: 'results', label: 'Results', icon: 'fa-chart-line', href: BASE + 'attribution.html',
      pages: ['attribution.html', 'cost-overview.html', 'analytics-hub.html', 'revenue.html'] },
    { id: 'workshop', label: 'Workshop', icon: 'fa-toolbox', href: BASE + 'workshop/index.html', pages: [] }
  ];

  var path = window.location.pathname;
  var currentFile = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
  var inWorkshopDir = path.indexOf(BASE + 'workshop/') === 0;
  var activeId = 'workshop'; // any page not claimed by a place is a Workshop tool
  if (!inWorkshopDir) {
    PLACES.forEach(function (p) { if (p.pages.indexOf(currentFile) !== -1) activeId = p.id; });
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // ── Rail ──
  var rail = el('aside', 'sb-rail');
  rail.setAttribute('aria-label', 'HQ');

  var logo = el('a', 'sb-rail-logo', '<i class="fas fa-building" aria-hidden="true"></i>');
  logo.href = BASE + 'today.html';
  logo.setAttribute('aria-label', 'AmbientPixels HQ');
  logo.setAttribute('data-tooltip', 'AmbientPixels HQ');
  rail.appendChild(logo);

  var nav = el('nav', 'sb-rail-chips');
  PLACES.forEach(function (p) {
    var a = el('a', 'sb-rail-chip sb-rail-chip--place' + (p.id === activeId ? ' sb-rail-chip--active' : ''),
      '<i class="fas ' + p.icon + '" aria-hidden="true"></i><span class="sb-rail-chip-label">' + p.label + '</span>');
    a.href = p.href;
    a.setAttribute('data-place', p.id);
    if (p.id === activeId) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  });
  rail.appendChild(nav);

  // Theme: the three token themes stay (tokens already cover them).
  var THEMES = ['dark', 'dim', 'light'];
  var THEME_ICONS = { dark: 'fa-moon', dim: 'fa-circle-half-stroke', light: 'fa-sun' };
  var THEME_LABELS = { dark: 'Dark', dim: 'Medium (Blue)', light: 'Light (Grey)' };
  function _getTheme() { try { return localStorage.getItem('preferred-theme') || 'dark'; } catch (e) { return 'dark'; } }
  function _applyTheme(t) {
    try { localStorage.setItem('preferred-theme', t); } catch (e) {}
    document.body.setAttribute('data-theme', t);
  }
  _applyTheme(_getTheme());
  document.body.setAttribute('data-mode', 'admin');

  // Footer: Wiki · Main site · Blog · Theme · Sign in/out
  var curTheme = _getTheme();
  var footer = el('div', 'sb-rail-footer');
  footer.innerHTML =
    '<a href="' + BASE + 'documents.html" class="sb-rail-globe" aria-label="Wiki" data-tooltip="Wiki"><i class="fas fa-book" aria-hidden="true"></i></a>' +
    '<a href="/" class="sb-rail-globe" aria-label="Main Site" data-tooltip="Main Site"><i class="fas fa-globe" aria-hidden="true"></i></a>' +
    '<a href="/blog/" class="sb-rail-globe sb-rail-globe--dim" aria-label="Public Blog" data-tooltip="Public Blog"><i class="fas fa-newspaper" aria-hidden="true"></i></a>' +
    '<button type="button" id="sb-theme-btn" class="sb-rail-globe sb-rail-btn" aria-label="Theme: ' + THEME_LABELS[curTheme] + '" data-tooltip="Theme: ' + THEME_LABELS[curTheme] + '"><i class="fas ' + (THEME_ICONS[curTheme] || 'fa-moon') + '" aria-hidden="true"></i></button>' +
    '<button type="button" id="sb-auth-btn" class="sb-rail-globe sb-rail-btn sb-rail-btn--pending" aria-label="Checking sign-in" data-tooltip="Checking sign-in"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i></button>';
  rail.appendChild(footer);

  var themeBtn = footer.querySelector('#sb-theme-btn');
  themeBtn.addEventListener('click', function () {
    var next = THEMES[(THEMES.indexOf(_getTheme()) + 1) % THEMES.length];
    _applyTheme(next);
    themeBtn.setAttribute('aria-label', 'Theme: ' + THEME_LABELS[next]);
    themeBtn.setAttribute('data-tooltip', 'Theme: ' + THEME_LABELS[next]);
    themeBtn.innerHTML = '<i class="fas ' + THEME_ICONS[next] + '" aria-hidden="true"></i>';
  });

  fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (data) {
    var btn = document.getElementById('sb-auth-btn');
    if (!btn) return;
    var user = data && data.clientPrincipal;
    var label = user ? 'Sign out (' + (user.userDetails || 'user') + ')' : 'Sign in';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('data-tooltip', label);
    btn.innerHTML = '<i class="fas ' + (user ? 'fa-sign-out-alt' : 'fa-sign-in-alt') + '" aria-hidden="true"></i>';
    btn.classList.remove('sb-rail-btn--pending');
    btn.addEventListener('click', function () {
      window.location.href = user
        ? '/.auth/logout?post_logout_redirect_uri=/'
        : '/pages/login.html?redirect=' + encodeURIComponent(window.location.pathname);
    });
  }).catch(function () {
    var btn = document.getElementById('sb-auth-btn');
    if (btn) btn.hidden = true;
  });

  // ── Assemble layout: rail + the page ──
  var body = document.body;
  var layout = el('div', 'sb-layout');
  var main = el('div', 'sb-main');
  var content = el('div', 'sb-content');
  while (body.firstChild) content.appendChild(body.firstChild);
  main.appendChild(content);
  layout.appendChild(rail);
  layout.appendChild(main);
  body.appendChild(layout);
})();

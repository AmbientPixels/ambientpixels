/**
 * CHANGE SUMMARY
 * - New file: Inbound module client-side logic v1
 * - Fetches /api/formIntake/recent for submissions list
 * - Renders stats (today, 7d, tasks spawned)
 * - Renders filterable table with type chips
 * - Row click fetches /api/formIntake/item and opens detail drawer
 * - Client-side filtering by type + hide-filtered toggle
 * - v1.1: Duplicate status display — 'Duplicate (linked)' pill,
 *   drawer shows duplicateOf field, unique task count in stats
 * - v1.2: Draft reply link in detail drawer (draftTaskId field)
 */

(function () {
  'use strict';

  var API_BASE = (window.AP_API_BASE || 'https://ambientpixels-nova-api.azurewebsites.net/api');
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    API_BASE = (window.AP_API_BASE || 'http://localhost:7071/api');
  }

  var _items = [];
  var _activeFilter = 'all';
  var _hideFiltered = true;

  // ── DOM refs ──
  var tbody = document.getElementById('inb-tbody');
  var statToday = document.getElementById('inb-stat-today');
  var statWeek = document.getElementById('inb-stat-week');
  var statTasks = document.getElementById('inb-stat-tasks');
  var drawerOverlay = document.getElementById('inb-drawer-overlay');
  var drawer = document.getElementById('inb-drawer');
  var drawerContent = document.getElementById('inb-drawer-content');
  var drawerClose = document.getElementById('inb-drawer-close');
  var hideFilteredCheckbox = document.getElementById('inb-hide-filtered');

  // ── Fetch recent ──
  async function loadRecent() {
    try {
      var resp = await fetch(API_BASE + '/formIntake/recent?days=7&limit=100', {
        headers: { 'Accept': 'application/json' }
      });
      var data = await resp.json();
      if (data.ok && Array.isArray(data.items)) {
        _items = data.items;
        renderStats();
        renderTable();
      } else {
        showError('Failed to load submissions.');
      }
    } catch (err) {
      console.error('[inbound] Load error:', err);
      showError('Connection error. Check API status.');
    }
  }

  // ── Stats ──
  function renderStats() {
    var todayStr = new Date().toISOString().substring(0, 10);
    var todayCount = 0;
    var taskCount = 0;

    var seenTaskIds = {};
    _items.forEach(function (item) {
      if (item.receivedAt && item.receivedAt.substring(0, 10) === todayStr) todayCount++;
      if (item.taskId && item.status !== 'duplicate' && !seenTaskIds[item.taskId]) {
        taskCount++;
        seenTaskIds[item.taskId] = true;
      }
    });

    statToday.textContent = todayCount;
    statWeek.textContent = _items.length;
    statTasks.textContent = taskCount;
  }

  // ── Table rendering ──
  function renderTable() {
    var filtered = _items.filter(function (item) {
      if (_activeFilter !== 'all' && item.type !== _activeFilter) return false;
      if (_hideFiltered && item.spamFlags && item.spamFlags.length > 0) return false;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="inb-empty">No submissions found.</td></tr>';
      return;
    }

    var html = '';
    filtered.forEach(function (item) {
      var time = item.receivedAt ? formatTime(item.receivedAt) : '—';
      var typeClass = 'inb-type--' + (item.type || 'contact');
      var nameEmail = item.name || item.email || '—';
      var source = item.pageUrl ? extractSource(item.pageUrl) : '—';
      var status = getStatus(item);
      var taskCell = item.taskId ? '<span style="font-size:0.6rem;opacity:0.5;">' + item.taskId.substring(0, 12) + '…</span>' : '—';

      html += '<tr data-id="' + (item.id || '') + '">'
        + '<td>' + time + '</td>'
        + '<td><span class="inb-type ' + typeClass + '">' + (item.type || '?') + '</span></td>'
        + '<td>' + escHtml(nameEmail) + '</td>'
        + '<td style="opacity:0.4;font-size:0.68rem;">' + escHtml(source) + '</td>'
        + '<td>' + status + '</td>'
        + '<td>' + taskCell + '</td>'
        + '</tr>';
    });

    tbody.innerHTML = html;

    // Bind row clicks
    var rows = tbody.querySelectorAll('tr[data-id]');
    rows.forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-id');
        if (id) openDetail(id);
      });
    });
  }

  function getStatus(item) {
    if (item.spamFlags && item.spamFlags.length > 0) {
      return '<span class="inb-status inb-status--filtered"><i class="fas fa-shield-halved"></i> Filtered</span>';
    }
    if (item.status === 'duplicate' || item.duplicateOf) {
      return '<span class="inb-status inb-status--duplicate"><i class="fas fa-clone"></i> Duplicate (linked)</span>';
    }
    if (item.status === 'task_created' || item.taskId) {
      return '<span class="inb-status inb-status--task"><i class="fas fa-check-circle"></i> Task Created</span>';
    }
    if (item.type === 'newsletter' || item.status === 'stored') {
      return '<span class="inb-status">Stored Only</span>';
    }
    return '<span class="inb-status" style="color:#fbbf24;">New</span>';
  }

  function formatTime(iso) {
    try {
      var d = new Date(iso);
      var now = new Date();
      var diffMs = now - d;
      if (diffMs < 60000) return 'Just now';
      if (diffMs < 3600000) return Math.floor(diffMs / 60000) + 'm ago';
      if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + 'h ago';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) { return '—'; }
  }

  function extractSource(url) {
    try {
      var u = new URL(url);
      return u.pathname.length > 30 ? u.pathname.substring(0, 30) + '…' : u.pathname;
    } catch (e) { return url.substring(0, 30); }
  }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showError(msg) {
    tbody.innerHTML = '<tr><td colspan="6" class="inb-empty" style="color:#f87171;">' + escHtml(msg) + '</td></tr>';
  }

  // ── Detail drawer ──
  async function openDetail(id) {
    drawerContent.innerHTML = '<p style="opacity:0.3;"><i class="fas fa-spinner fa-spin"></i> Loading…</p>';
    drawerOverlay.classList.add('open');
    drawer.classList.add('open');

    try {
      var resp = await fetch(API_BASE + '/formIntake/item?id=' + encodeURIComponent(id), {
        headers: { 'Accept': 'application/json' }
      });
      var data = await resp.json();
      if (data.ok && data.item) {
        renderDetail(data.item);
      } else {
        drawerContent.innerHTML = '<p style="color:#f87171;">Record not found.</p>';
      }
    } catch (err) {
      drawerContent.innerHTML = '<p style="color:#f87171;">Failed to load details.</p>';
    }
  }

  function renderDetail(item) {
    var html = '<h3>' + escHtml(item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : 'Submission') + ' Details</h3>';

    html += field('ID', item.id);
    html += field('Received', item.receivedAt);
    html += field('Type', item.type);
    if (item.status) html += field('Status', item.status);

    if (item.duplicateOf) {
      html += '<div class="inb-drawer-field">'
        + '<div class="inb-drawer-label">Duplicate Of</div>'
        + '<div class="inb-drawer-value"><a href="#" onclick="event.preventDefault();" data-open-id="' + escHtml(item.duplicateOf) + '" style="color:#38bdf8;cursor:pointer;"><i class="fas fa-link"></i> ' + escHtml(item.duplicateOf) + '</a></div>'
        + '</div>';
    }

    if (item.contact) {
      if (item.contact.name) html += field('Name', item.contact.name);
      html += field('Email', item.contact.email);
      if (item.contact.company) html += field('Company', item.contact.company);
      if (item.contact.role) html += field('Role', item.contact.role);
    }

    if (item.message) {
      if (item.message.subject) html += field('Subject', item.message.subject);
      if (item.message.body) html += field('Message', item.message.body);
    }

    html += field('Page URL', item.pageUrl);
    if (item.referrer) html += field('Referrer', item.referrer);

    if (item.utm) {
      var utmParts = [];
      if (item.utm.source) utmParts.push('source=' + item.utm.source);
      if (item.utm.medium) utmParts.push('medium=' + item.utm.medium);
      if (item.utm.campaign) utmParts.push('campaign=' + item.utm.campaign);
      if (utmParts.length > 0) html += field('UTM', utmParts.join(' · '));
    }

    if (item.consent) {
      html += field('Privacy Accepted', item.consent.privacyAccepted ? 'Yes' : 'No');
      html += field('Newsletter Opt-In', item.consent.newsletterOptIn ? 'Yes' : 'No');
    }

    if (item.antiSpam) {
      var asParts = [];
      if (item.antiSpam.submitDeltaMs != null) asParts.push('Submit time: ' + (item.antiSpam.submitDeltaMs / 1000).toFixed(1) + 's');
      if (item.antiSpam.origin) asParts.push('Origin: ' + item.antiSpam.origin);
      if (item.antiSpam.spamFlags && item.antiSpam.spamFlags.length > 0) asParts.push('Flags: ' + item.antiSpam.spamFlags.join(', '));
      if (asParts.length > 0) html += field('Anti-Spam', asParts.join(' · '));
    }

    if (item.taskId) {
      html += '<div class="inb-drawer-field">'
        + '<div class="inb-drawer-label">Task</div>'
        + '<div class="inb-drawer-value"><a href="/modules/company/tasks.html#' + escHtml(item.taskId) + '"><i class="fas fa-external-link-alt"></i> View Task ' + escHtml(item.taskId.substring(0, 16)) + '</a></div>'
        + '</div>';
    }

    if (item.draftTaskId) {
      html += '<div class="inb-drawer-field">'
        + '<div class="inb-drawer-label">Draft Reply</div>'
        + '<div class="inb-drawer-value"><a href="/modules/company/tasks.html#' + escHtml(item.draftTaskId) + '" style="color:#a78bfa;"><i class="fas fa-envelope-open-text"></i> View Draft ' + escHtml(item.draftTaskId.substring(0, 16)) + '</a></div>'
        + '</div>';
    } else if (item.draftReplyCreated === false && item.status === 'duplicate') {
      html += '<div class="inb-drawer-field">'
        + '<div class="inb-drawer-label">Draft Reply</div>'
        + '<div class="inb-drawer-value" style="opacity:0.4;">Draft exists on original submission</div>'
        + '</div>';
    }

    drawerContent.innerHTML = html;
  }

  function field(label, value) {
    if (!value) return '';
    return '<div class="inb-drawer-field">'
      + '<div class="inb-drawer-label">' + escHtml(label) + '</div>'
      + '<div class="inb-drawer-value">' + escHtml(String(value)) + '</div>'
      + '</div>';
  }

  function closeDrawer() {
    drawerOverlay.classList.remove('open');
    drawer.classList.remove('open');
  }

  // ── Event bindings ──
  if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

  // Filter chips
  var chips = document.querySelectorAll('.inb-chip[data-filter]');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.classList.remove('inb-chip--active'); });
      chip.classList.add('inb-chip--active');
      _activeFilter = chip.getAttribute('data-filter');
      renderTable();
    });
  });

  // Hide filtered toggle
  if (hideFilteredCheckbox) {
    hideFilteredCheckbox.addEventListener('change', function () {
      _hideFiltered = hideFilteredCheckbox.checked;
      renderTable();
    });
  }

  // ── Init ──
  loadRecent();

})();

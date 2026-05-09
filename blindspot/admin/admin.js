/**
 * Blindspot Admin — moderation + per-surface curation editor
 *
 * IIFE → window.BsAdmin. Boots on DOMContentLoaded.
 *
 * Flow:
 *  1. Auth gate — fetch /.auth/me, redirect non-admins to play.html
 *  2. Load all 4 configs in parallel + the published-cards list (for the picker)
 *  3. Render moderation tab + 3 surface tabs
 *  4. Save handlers POST to /api/blindspotadminconfig?key=<key>
 */
(function () {
  'use strict';

  // Mirror of server-side ADMIN_USER_IDS. Client-side gate is UX only;
  // server enforces the real boundary.
  var ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];

  var SURFACES = ['hero', 'hall', 'gallery'];
  var SURFACE_MAX = { hero: 10, hall: 25, gallery: 50 };
  var MODES = [
    { id: 'recent',         label: 'Recent' },
    { id: 'random',         label: 'Random' },
    { id: 'curated',        label: 'Curated' },
    { id: 'highest-rated',  label: 'Highest Rated' }
  ];

  var _userId = null;
  var _allCards = [];
  var _state = {
    moderation: { hiddenIds: [], updatedAt: null, updatedBy: null },
    hero:       { mode: 'recent', curatedIds: [], updatedAt: null, updatedBy: null },
    hall:       { mode: 'recent', curatedIds: [], updatedAt: null, updatedBy: null },
    gallery:    { mode: 'recent', curatedIds: [], updatedAt: null, updatedBy: null }
  };
  var _pickerTarget = null; // 'moderation' or surface name

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function apiUrl(key) {
    if (typeof window.buildApiPath === 'function') {
      return window.buildApiPath('adminConfig', { key: key });
    }
    return '/api/blindspotadminconfig?key=' + key;
  }

  function loadCardsUrl() {
    if (typeof window.buildApiPath === 'function') {
      return window.buildApiPath('loadCards');
    }
    return '/api/cardforgeloadcards';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message, isError) {
    var el = $('#bs-admin-toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'bs-admin-toast' + (isError ? ' bs-admin-toast--error' : '');
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 2400);
  }

  function fmtStamp(cfg) {
    if (!cfg || !cfg.updatedAt) return '';
    try {
      return 'Last saved ' + new Date(cfg.updatedAt).toLocaleString();
    } catch (e) { return ''; }
  }

  // ── Auth gate ──
  async function authGate() {
    try {
      var r = await fetch('/.auth/me');
      var data = await r.json();
      if (data && data.clientPrincipal && data.clientPrincipal.userId) {
        _userId = data.clientPrincipal.userId;
      }
    } catch (e) { /* fall through */ }

    if (!_userId || ADMIN_USER_IDS.indexOf(_userId) < 0) {
      $('#bs-admin-gate').hidden = false;
      setTimeout(function () { window.location.href = '/blindspot/play.html'; }, 2000);
      return false;
    }
    $('#bs-admin-app').hidden = false;
    return true;
  }

  // ── Initial data load ──
  async function loadAll() {
    var keys = ['moderation', 'hero', 'hall', 'gallery'];
    var configResponses = await Promise.all(keys.map(function (k) {
      return fetch(apiUrl(k), { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }));
    keys.forEach(function (k, i) {
      if (configResponses[i]) _state[k] = configResponses[i];
    });

    var cardsResponse = await fetch(loadCardsUrl(), { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    _allCards = (cardsResponse && Array.isArray(cardsResponse.galleryCards)) ? cardsResponse.galleryCards : [];
  }

  // ── Tab switching ──
  function initTabs() {
    $$('.bs-admin-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab');
        $$('.bs-admin-tab').forEach(function (b) { b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
        $$('.bs-admin-panel').forEach(function (p) { p.hidden = (p.id !== 'bs-admin-panel-' + tab); });
      });
    });
  }

  // ── Moderation tab ──
  function renderModerationTab() {
    var listEl = $('#bs-admin-mod-list');
    var countEl = $('#bs-admin-mod-count');
    var stampEl = $('#bs-admin-mod-stamp');
    if (!listEl) return;

    var hidden = _state.moderation.hiddenIds || [];
    countEl.textContent = '(' + hidden.length + ')';
    stampEl.textContent = fmtStamp(_state.moderation);
    listEl.innerHTML = '';

    var byId = new Map();
    for (var i = 0; i < _allCards.length; i++) byId.set(_allCards[i].id, _allCards[i]);

    hidden.forEach(function (id) {
      var card = byId.get(id);
      var slot = document.createElement('div');
      slot.className = 'bs-admin-card-slot';
      var inner = document.createElement('div');
      inner.className = 'bs-admin-card-slot__inner';
      if (card && window.BsCardRenderer && window.BsCardRenderer.render) {
        if (window.BsCardRenderer.ensureCombatStats) window.BsCardRenderer.ensureCombatStats(card);
        inner.innerHTML = window.BsCardRenderer.render(card, 'compact');
      } else {
        inner.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--bs-text-muted);font-size:0.75rem;">' + escHtml(id) + '</div>';
      }
      slot.appendChild(inner);
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'bs-admin-card-slot__remove';
      rm.setAttribute('aria-label', 'Un-hide ' + (card ? card.name : id));
      rm.innerHTML = '<i class="fas fa-times"></i>';
      rm.addEventListener('click', function () {
        _state.moderation.hiddenIds = hidden.filter(function (h) { return h !== id; });
        renderModerationTab();
      });
      slot.appendChild(rm);
      listEl.appendChild(slot);
    });
  }

  function initModerationTab() {
    $('#bs-admin-mod-add').addEventListener('click', function () {
      openPicker('moderation');
    });
    $('#bs-admin-mod-save').addEventListener('click', async function () {
      await saveConfig('moderation', { hiddenIds: _state.moderation.hiddenIds });
    });
  }

  // ── Surface tabs (hero / hall / gallery) ──
  function renderSurfaceTab(surface) {
    var panel = $('#bs-admin-panel-' + surface);
    if (!panel) return;
    var max = SURFACE_MAX[surface];
    var cfg = _state[surface];
    var modeRowHtml = '<div class="bs-admin-mode-row">' +
      MODES.map(function (m) {
        var checked = cfg.mode === m.id ? ' checked' : '';
        return '<label><input type="radio" name="bs-admin-mode-' + surface + '" value="' + m.id + '"' + checked + '> ' + escHtml(m.label) + '</label>';
      }).join('') + '</div>';
    var counterHtml = '<div class="bs-admin-curated__counter"><span id="bs-admin-curated-count-' + surface + '">' + cfg.curatedIds.length + '</span> / ' + max + ' curated</div>';
    var listHtml = '<div class="bs-admin-curated__list" id="bs-admin-curated-list-' + surface + '" role="list"></div>';
    var addBtn = '<button type="button" class="bs-admin-btn bs-admin-btn--secondary" id="bs-admin-curated-add-' + surface + '"><i class="fas fa-plus"></i> Add card</button>';
    var saveBtn = '<div class="bs-admin-panel__footer"><button type="button" class="bs-admin-btn" id="bs-admin-surface-save-' + surface + '">Save</button><span class="bs-admin-panel__stamp" id="bs-admin-surface-stamp-' + surface + '">' + escHtml(fmtStamp(cfg)) + '</span></div>';

    var host = panel.querySelector('.bs-admin-surface');
    host.innerHTML = modeRowHtml + counterHtml + listHtml + addBtn + saveBtn;

    // Mode picker
    host.querySelectorAll('input[name="bs-admin-mode-' + surface + '"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) cfg.mode = radio.value;
      });
    });

    // Render curated list
    renderCuratedList(surface);

    // Add card button
    document.getElementById('bs-admin-curated-add-' + surface).addEventListener('click', function () {
      if (cfg.curatedIds.length >= max) {
        toast('Max ' + max + ' cards for ' + surface, true);
        return;
      }
      openPicker(surface);
    });

    // Save button
    document.getElementById('bs-admin-surface-save-' + surface).addEventListener('click', async function () {
      await saveConfig(surface, { mode: cfg.mode, curatedIds: cfg.curatedIds });
    });
  }

  function renderCuratedList(surface) {
    var listEl = document.getElementById('bs-admin-curated-list-' + surface);
    var countEl = document.getElementById('bs-admin-curated-count-' + surface);
    if (!listEl) return;
    var cfg = _state[surface];
    countEl.textContent = String(cfg.curatedIds.length);
    listEl.innerHTML = '';

    var byId = new Map();
    for (var i = 0; i < _allCards.length; i++) byId.set(_allCards[i].id, _allCards[i]);

    cfg.curatedIds.forEach(function (id) {
      var card = byId.get(id);
      var slot = document.createElement('div');
      slot.className = 'bs-admin-card-slot';
      var inner = document.createElement('div');
      inner.className = 'bs-admin-card-slot__inner';
      if (card && window.BsCardRenderer && window.BsCardRenderer.render) {
        if (window.BsCardRenderer.ensureCombatStats) window.BsCardRenderer.ensureCombatStats(card);
        inner.innerHTML = window.BsCardRenderer.render(card, 'compact');
      } else {
        inner.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--bs-text-muted);font-size:0.75rem;">' + escHtml(id) + '</div>';
      }
      slot.appendChild(inner);
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'bs-admin-card-slot__remove';
      rm.setAttribute('aria-label', 'Remove ' + (card ? card.name : id));
      rm.innerHTML = '<i class="fas fa-times"></i>';
      rm.addEventListener('click', function () {
        cfg.curatedIds = cfg.curatedIds.filter(function (c) { return c !== id; });
        renderCuratedList(surface);
      });
      slot.appendChild(rm);
      listEl.appendChild(slot);
    });
  }

  // ── Card picker modal ──
  function openPicker(target) {
    _pickerTarget = target;
    $('#bs-admin-picker').classList.remove('bs-overlay--hidden');
    $('#bs-admin-picker-search').value = '';
    renderPickerList('');
    setTimeout(function () { $('#bs-admin-picker-search').focus(); }, 50);
  }
  function closePicker() {
    $('#bs-admin-picker').classList.add('bs-overlay--hidden');
    _pickerTarget = null;
  }
  function renderPickerList(query) {
    var listEl = $('#bs-admin-picker-list');
    var q = String(query || '').toLowerCase().trim();
    var filtered = _allCards.filter(function (c) {
      if (!c || !c.id) return false;
      if (q && String(c.name || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).slice(0, 50);

    listEl.innerHTML = '';
    filtered.forEach(function (card) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bs-admin-picker__tile';
      var inner = '';
      if (window.BsCardRenderer && window.BsCardRenderer.render) {
        if (window.BsCardRenderer.ensureCombatStats) window.BsCardRenderer.ensureCombatStats(card);
        inner = window.BsCardRenderer.render(card, 'compact');
      } else {
        inner = '<div style="padding:0.5rem;font-size:0.7rem;color:var(--bs-text-muted);">' + escHtml(card.name || card.id) + '</div>';
      }
      btn.innerHTML = inner + '<span class="bs-admin-picker__tile-name">' + escHtml(card.name || '') + '</span>';
      btn.addEventListener('click', function () {
        if (_pickerTarget === 'moderation') {
          if (_state.moderation.hiddenIds.indexOf(card.id) < 0) _state.moderation.hiddenIds.push(card.id);
          renderModerationTab();
        } else if (_pickerTarget && SURFACES.indexOf(_pickerTarget) >= 0) {
          var cfg = _state[_pickerTarget];
          var max = SURFACE_MAX[_pickerTarget];
          if (cfg.curatedIds.indexOf(card.id) >= 0) {
            toast('Already in list', true);
          } else if (cfg.curatedIds.length >= max) {
            toast('Max ' + max + ' cards', true);
          } else {
            cfg.curatedIds.push(card.id);
            renderCuratedList(_pickerTarget);
          }
        }
        closePicker();
      });
      listEl.appendChild(btn);
    });
  }
  function initPicker() {
    $('#bs-admin-picker-search').addEventListener('input', function (e) {
      renderPickerList(e.target.value);
    });
    $('.bs-admin-picker__close').addEventListener('click', closePicker);
    $('#bs-admin-picker').addEventListener('click', function (e) {
      if (e.target === $('#bs-admin-picker')) closePicker();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#bs-admin-picker').classList.contains('bs-overlay--hidden')) {
        closePicker();
      }
    });
  }

  // ── Save ──
  async function saveConfig(key, body) {
    body.userId = _userId;
    try {
      var r = await fetch(apiUrl(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit'
      });
      if (!r.ok) {
        var err = await r.json().catch(function () { return { error: 'HTTP ' + r.status }; });
        toast('Save failed: ' + err.error, true);
        return;
      }
      var saved = await r.json();
      _state[key] = saved;
      toast('Saved');
      if (key === 'moderation') {
        $('#bs-admin-mod-stamp').textContent = fmtStamp(saved);
      } else {
        var stampEl = document.getElementById('bs-admin-surface-stamp-' + key);
        if (stampEl) stampEl.textContent = fmtStamp(saved);
      }
    } catch (e) {
      toast('Save failed: ' + e.message, true);
    }
  }

  // ── Boot ──
  async function boot() {
    var ok = await authGate();
    if (!ok) return;
    await loadAll();
    initTabs();
    initModerationTab();
    initPicker();
    renderModerationTab();
    SURFACES.forEach(renderSurfaceTab);
    wireStatsLazyLoad();
    wireVideosLazyLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.BsAdmin = { _state: _state }; // expose for debugging

  // ── Stats tab (Task 6) ────────────────────────────────────────────────

  var DELTA_KEYS = [
    { key: 'players',         label: 'Players' },
    { key: 'battlesFought',   label: 'Battles' },
    { key: 'cardsPublished',  label: 'Published' },
    { key: 'aiGenerations',   label: 'AI Gens' }
  ];

  function statsUrl() {
    if (typeof window.buildApiPath === 'function') {
      return window.buildApiPath('stats', { detail: 'admin' });
    }
    return '/api/blindspotstats?detail=admin';
  }

  function fmtNum(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return n.toLocaleString();
  }

  function fmtDelta(n) {
    if (typeof n !== 'number' || !isFinite(n) || n === 0) return '0';
    return (n > 0 ? '+' : '') + n.toLocaleString();
  }

  function fmtRelative(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    if (isNaN(t)) return '—';
    var diff = Date.now() - t;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hr ago';
    return Math.floor(diff / 86400000) + ' days ago';
  }

  function fmtAsOf(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function renderDeltaChips(hostId, deltas) {
    var host = document.getElementById(hostId);
    if (!host) return;
    if (!deltas) { host.innerHTML = '<em>No baseline yet — deltas appear after the next day/week roll.</em>'; return; }
    host.innerHTML = '';
    DELTA_KEYS.forEach(function (def) {
      var chip = document.createElement('span');
      chip.className = 'bs-admin-stats__chip';
      var v = deltas[def.key];
      if (typeof v === 'number' && v > 0) chip.classList.add('bs-admin-stats__chip--up');
      var strong = document.createElement('strong');
      strong.textContent = def.label;
      chip.appendChild(strong);
      chip.appendChild(document.createTextNode(' ' + fmtDelta(v)));
      host.appendChild(chip);
    });
  }

  function renderTopPlayers(list) {
    var host = document.getElementById('bs-admin-stats-top');
    if (!host) return;
    host.innerHTML = '';
    if (!list || !list.length) { host.innerHTML = '<li><em>No players yet.</em></li>'; return; }
    list.forEach(function (p) {
      var li = document.createElement('li');
      li.innerHTML = '<code>' + escHtml(p.userIdShort) + '</code> — ' + fmtNum(p.totalWins) + ' wins';
      host.appendChild(li);
    });
  }

  async function loadStats() {
    try {
      var resp = await fetch(statsUrl(), { credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      if (!data || !data.ok) throw new Error('bad payload');

      ['players', 'cardsForged', 'cardsPublished', 'bossesDefeated', 'battlesFought', 'aiGenerations'].forEach(function (k) {
        var el = document.querySelector('[data-stat="' + k + '"]');
        if (el) el.textContent = fmtNum(data.stats[k]);
      });

      var asOfEl = document.getElementById('bs-admin-stats-asof');
      if (asOfEl) asOfEl.textContent = fmtAsOf(data.asOf);

      var warnEl = document.getElementById('bs-admin-stats-warning');
      if (warnEl) {
        if (data._warning) {
          warnEl.textContent = data._warning;
          warnEl.hidden = false;
        } else {
          warnEl.hidden = true;
          warnEl.textContent = '';
        }
      }

      var ax = data.adminExtras || null;
      renderDeltaChips('bs-admin-stats-day', ax && ax.todayDelta);
      renderDeltaChips('bs-admin-stats-week', ax && ax.weekDelta);

      var actEl = document.getElementById('bs-admin-stats-activity');
      if (actEl) actEl.textContent = ax && ax.lastActivityAt ? fmtRelative(ax.lastActivityAt) : '—';

      renderTopPlayers(ax && ax.topPlayersByWins);
    } catch (err) {
      console.warn('[bs-admin-stats] load failed:', err);
      var asOfEl = document.getElementById('bs-admin-stats-asof');
      if (asOfEl) asOfEl.textContent = 'unavailable';
    }
  }

  // Lazy-load when the Stats tab is first shown. Uses MutationObserver on
  // the panel's [hidden] attribute since the existing tab system just
  // toggles `hidden` on the panel.
  function wireStatsLazyLoad() {
    var panel = document.getElementById('bs-admin-panel-stats');
    if (!panel) return;
    var loaded = false;
    function maybeLoad() {
      if (loaded) return;
      if (!panel.hidden) { loaded = true; loadStats(); }
    }
    var observer = new MutationObserver(maybeLoad);
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    // Also wire to the tab button click directly as a belt-and-suspenders
    // for older browsers / cases where MutationObserver fires before the panel renders
    var btn = document.getElementById('bs-admin-tab-stats');
    if (btn) btn.addEventListener('click', function () { setTimeout(maybeLoad, 0); });
    maybeLoad();
  }

  // ── Videos tab ────────────────────────────────────────────────
  // Per-player profile video upload. v1 admin-only. Lists every unique
  // publisher derived from the published-cards corpus, fetches each
  // player's current profileVideo via /api/blindspotprofileview, and
  // exposes file pickers + remove buttons that hit
  // /api/blindspotsaveprofilevideo with raw binary.

  var MAX_VIDEO_BYTES = 5 * 1024 * 1024;
  var ACCEPTED_VIDEO_MIME = ['video/mp4', 'video/webm'];
  var _videoRows = []; // [{ userId, displayName, avatar, profileVideo, profileVideoUpdatedAt }]
  var _videosLoaded = false;

  function videoSaveUrl(targetUserId, action) {
    var params = { targetUserId: targetUserId };
    if (action) params.action = action;
    if (typeof window.buildApiPath === 'function') {
      return window.buildApiPath('saveProfileVideo', params);
    }
    var qs = 'targetUserId=' + encodeURIComponent(targetUserId) + (action ? '&action=' + encodeURIComponent(action) : '');
    return '/api/blindspotsaveprofilevideo?' + qs;
  }

  // Build a unique-publisher list from the loaded card corpus. Each row
  // gets the publisher's most recent card avatar as a default thumbnail
  // (overwritten by profileImage when the profileview lookup returns).
  function uniquePublishersFromCards(cards) {
    var byId = new Map();
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c || !c.publishedBy) continue;
      var existing = byId.get(c.publishedBy);
      var ts = Date.parse(c.publishDate || c.publishedAt || c.createdAt || c.updatedAt || 0) || 0;
      if (!existing || ts > existing._ts) {
        byId.set(c.publishedBy, {
          userId: c.publishedBy,
          displayName: c.publishedByName || ('Fighter ' + String(c.publishedBy).slice(0, 8)),
          avatar: c.avatar || '',
          _ts: ts,
          // Filled in by hydratePlayerVideos(). Treat empty string as
          // "no video yet" — null would imply still loading.
          profileVideo: '',
          profileVideoUpdatedAt: null,
          // Tri-state load flag: 'pending' until profileview resolves,
          // then 'ready' or 'error'. Used to hint per-row UI.
          _videoStatus: 'pending'
        });
      }
    }
    var rows = Array.from(byId.values());
    rows.sort(function (a, b) {
      return String(a.displayName).toLowerCase().localeCompare(String(b.displayName).toLowerCase());
    });
    return rows;
  }

  // Parallel-fetch each publisher's profileview to get their current
  // video URL + display name + profileImage. Soft-fails per row.
  async function hydratePlayerVideos(rows) {
    var profileViewUrl = function (uid) {
      if (typeof window.buildApiPath === 'function') {
        return window.buildApiPath('profileView', { userId: uid });
      }
      return '/api/blindspotprofileview?userId=' + encodeURIComponent(uid);
    };
    await Promise.all(rows.map(function (row) {
      return fetch(profileViewUrl(row.userId), { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.profile) {
            // Honor the player-set displayName override when present
            row.displayName = data.profile.displayName || row.displayName;
            if (data.profile.profileImage) row.avatar = data.profile.profileImage;
            row.profileVideo = data.profile.profileVideo || '';
            row.profileVideoUpdatedAt = data.profile.profileVideoUpdatedAt || null;
          }
          row._videoStatus = 'ready';
        })
        .catch(function () { row._videoStatus = 'error'; });
    }));
  }

  function renderVideosTab() {
    var listEl = document.getElementById('bs-admin-videos-list');
    if (!listEl) return;
    if (_videoRows.length === 0) {
      listEl.innerHTML = '<p class="bs-admin-videos__empty">No publishers found.</p>';
      return;
    }
    listEl.innerHTML = '';
    _videoRows.forEach(function (row) {
      listEl.appendChild(buildVideoRow(row));
    });
  }

  function buildVideoRow(row) {
    var wrap = document.createElement('div');
    wrap.className = 'bs-admin-video-row';
    wrap.setAttribute('data-userid', row.userId);

    var avatar = document.createElement('div');
    avatar.className = 'bs-admin-video-row__avatar';
    if (row.avatar) {
      var img = document.createElement('img');
      img.src = row.avatar;
      img.alt = '';
      img.loading = 'lazy';
      avatar.appendChild(img);
    } else {
      avatar.innerHTML = '<i class="fas fa-user-shield"></i>';
    }
    wrap.appendChild(avatar);

    var meta = document.createElement('div');
    meta.className = 'bs-admin-video-row__meta';
    var name = document.createElement('div');
    name.className = 'bs-admin-video-row__name';
    name.textContent = row.displayName;
    var sub = document.createElement('div');
    sub.className = 'bs-admin-video-row__sub';
    var statusText;
    if (row._videoStatus === 'pending') statusText = 'Loading…';
    else if (row._videoStatus === 'error') statusText = 'Could not load profile';
    else if (row.profileVideo) statusText = 'Video uploaded';
    else statusText = 'No video';
    sub.textContent = String(row.userId).slice(0, 8) + ' · ' + statusText;
    meta.appendChild(name);
    meta.appendChild(sub);
    wrap.appendChild(meta);

    var preview = document.createElement('div');
    preview.className = 'bs-admin-video-row__preview';
    if (row.profileVideo) {
      var v = document.createElement('video');
      v.src = row.profileVideo;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.controls = true;
      preview.appendChild(v);
    } else {
      preview.innerHTML = '<span class="bs-admin-video-row__noprev">—</span>';
    }
    wrap.appendChild(preview);

    var actions = document.createElement('div');
    actions.className = 'bs-admin-video-row__actions';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/mp4,video/webm';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) {
        uploadVideoForRow(row, fileInput.files[0]);
        fileInput.value = '';
      }
    });

    var uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'bs-admin-btn bs-admin-btn--secondary';
    uploadBtn.innerHTML = row.profileVideo
      ? '<i class="fas fa-arrows-rotate"></i> Replace'
      : '<i class="fas fa-upload"></i> Upload';
    uploadBtn.addEventListener('click', function () { fileInput.click(); });
    actions.appendChild(uploadBtn);

    if (row.profileVideo) {
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bs-admin-btn bs-admin-btn--ghost';
      removeBtn.innerHTML = '<i class="fas fa-trash"></i> Remove';
      removeBtn.addEventListener('click', function () {
        if (!confirm('Remove video for ' + row.displayName + '?')) return;
        deleteVideoForRow(row);
      });
      actions.appendChild(removeBtn);
    }

    actions.appendChild(fileInput);
    wrap.appendChild(actions);

    return wrap;
  }

  async function uploadVideoForRow(row, file) {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) {
      toast('Too large: max ' + Math.round(MAX_VIDEO_BYTES / 1024 / 1024) + ' MB', true);
      return;
    }
    if (ACCEPTED_VIDEO_MIME.indexOf(file.type) < 0) {
      // Some browsers report empty string for the .webm MIME — fall back to
      // extension check rather than rejecting outright.
      var ext = String(file.name || '').toLowerCase().split('.').pop();
      if (ext !== 'mp4' && ext !== 'webm') {
        toast('Only mp4 or webm', true);
        return;
      }
    }
    toast('Uploading ' + row.displayName + '…');
    try {
      var buf = await file.arrayBuffer();
      var r = await fetch(videoSaveUrl(row.userId), {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: buf,
        credentials: 'include'
      });
      if (!r.ok) {
        var err = await r.json().catch(function () { return { error: 'HTTP ' + r.status }; });
        toast('Upload failed: ' + err.error, true);
        return;
      }
      var saved = await r.json();
      row.profileVideo = saved.profileVideo || '';
      row.profileVideoUpdatedAt = new Date().toISOString();
      row._videoStatus = 'ready';
      // Replace just this row in place — re-render is cheaper than DOM
      // surgery and the list is short.
      var existing = document.querySelector('[data-userid="' + row.userId + '"]');
      if (existing && existing.parentNode) {
        existing.parentNode.replaceChild(buildVideoRow(row), existing);
      }
      toast('Saved video for ' + row.displayName);
    } catch (e) {
      toast('Upload failed: ' + e.message, true);
    }
  }

  async function deleteVideoForRow(row) {
    try {
      var r = await fetch(videoSaveUrl(row.userId, 'delete'), {
        method: 'POST',
        credentials: 'include'
      });
      if (!r.ok) {
        var err = await r.json().catch(function () { return { error: 'HTTP ' + r.status }; });
        toast('Delete failed: ' + err.error, true);
        return;
      }
      row.profileVideo = '';
      row.profileVideoUpdatedAt = new Date().toISOString();
      var existing = document.querySelector('[data-userid="' + row.userId + '"]');
      if (existing && existing.parentNode) {
        existing.parentNode.replaceChild(buildVideoRow(row), existing);
      }
      toast('Removed video for ' + row.displayName);
    } catch (e) {
      toast('Delete failed: ' + e.message, true);
    }
  }

  async function loadVideosTab() {
    var listEl = document.getElementById('bs-admin-videos-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="bs-admin-videos__empty">Loading players…</p>';
    _videoRows = uniquePublishersFromCards(_allCards);
    renderVideosTab(); // Show pending state immediately
    await hydratePlayerVideos(_videoRows);
    renderVideosTab();
  }

  function wireVideosLazyLoad() {
    var panel = document.getElementById('bs-admin-panel-videos');
    if (!panel) return;
    function maybeLoad() {
      if (_videosLoaded) return;
      if (!panel.hidden) { _videosLoaded = true; loadVideosTab(); }
    }
    var observer = new MutationObserver(maybeLoad);
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    var btn = document.getElementById('bs-admin-tab-videos');
    if (btn) btn.addEventListener('click', function () { setTimeout(maybeLoad, 0); });
    maybeLoad();
  }

})();

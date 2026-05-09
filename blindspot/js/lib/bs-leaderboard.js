/* ============================================================
   bs-leaderboard.js — Player leaderboard with metric tabs
   IIFE → window.BsLeaderboard
   Fetches /api/blindspotleaderboard?sortBy=wins|bosses|elo|power
   ============================================================ */
(function () {
  'use strict';

  var _cb = {};
  var _activeTab = 'wins';
  var _tabsBound = false;

  var TIMEOUT_MS = 12000;
  var TABS = [
    { id: 'wins',   label: 'Wins',     icon: 'fa-trophy' },
    { id: 'bosses', label: 'Bosses',   icon: 'fa-skull' },
    { id: 'elo',    label: 'PvP Elo',  icon: 'fa-chess-knight' },
    { id: 'power',  label: 'Power',    icon: 'fa-bolt' }
  ];

  function setCallbacks(obj) { _cb = obj || {}; }
  function escHtml(s) { return (_cb.escHtml ? _cb.escHtml(s) : String(s == null ? '' : s)); }

  function fetchLeaderboard(sortBy) {
    var url = (window.buildApiPath ? window.buildApiPath('leaderboard', { sortBy: sortBy }) : '/api/blindspotleaderboard?sortBy=' + sortBy);
    return Promise.race([
      fetch(url, { credentials: 'include' }).then(function (r) {
        if (!r.ok) throw new Error('http_' + r.status);
        return r.json();
      }),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS);
      })
    ]);
  }

  function bindTabs() {
    if (_tabsBound) return;
    var tabBar = document.querySelector('#bs-leaderboard-content .bs-leaderboard__tabs');
    if (!tabBar) return;
    tabBar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-leaderboard-tab]');
      if (!btn) return;
      var tab = btn.getAttribute('data-leaderboard-tab');
      if (!tab || tab === _activeTab) return;
      _activeTab = tab;
      renderLeaderboard();
    });
    _tabsBound = true;
  }

  function setActiveTabUI() {
    var btns = document.querySelectorAll('#bs-leaderboard-content [data-leaderboard-tab]');
    btns.forEach(function (b) {
      var on = b.getAttribute('data-leaderboard-tab') === _activeTab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('is-active', on);
    });
  }

  function rankMedal(rank) {
    if (rank === 1) return '<i class="fas fa-crown" style="color:#FFD700;" aria-hidden="true"></i>';
    if (rank === 2) return '<i class="fas fa-medal" style="color:#C0C0C0;" aria-hidden="true"></i>';
    if (rank === 3) return '<i class="fas fa-medal" style="color:#CD7F32;" aria-hidden="true"></i>';
    return '';
  }

  // Avatar fallback chain: profile image → featured card avatar → silhouette.
  // Mirrors bs-auth-ui.js so the leaderboard avatar matches whatever the
  // player chose for their topbar identity.
  function avatarHtml(p) {
    var src = p.profileImage || (p.featured && p.featured.avatar) || '';
    var alt = escHtml(p.displayName);
    if (src) {
      // Apply the player's saved crop transform when displaying their
      // generated profile image (not when falling back to card art —
      // card art was never cropped for the round frame).
      var fromProfile = !!p.profileImage;
      var t = fromProfile ? (p.profileImageTransform || { scale: 1, posX: 50, posY: 50 }) : { scale: 1, posX: 50, posY: 50 };
      var styleAttr = 'object-position:' + t.posX + '% ' + t.posY + '%; transform: scale(' + t.scale + ');';
      return '<img src="' + escHtml(src) + '" alt="' + alt + '" class="bs-lb-row__avatar-img" style="' + styleAttr + '" loading="lazy">';
    }
    return '<i class="fas fa-user-shield bs-lb-row__avatar-fallback" aria-hidden="true"></i>';
  }

  function primaryStatFor(tab, p) {
    if (tab === 'wins')   return { value: p.totalWins, label: 'WINS' };
    if (tab === 'bosses') return { value: (p.highestBoss || 0) + (p.ascension > 0 ? '/10 · Asc ' + p.ascension : '/10'), label: 'BOSSES' };
    if (tab === 'elo')    return { value: p.pvpElo, label: p.peakRank.toUpperCase() };
    if (tab === 'power')  return { value: (p.featured ? p.featured.power : 0), label: 'POWER' };
    return { value: '', label: '' };
  }

  function secondaryLine(p) {
    // Compact second line under name: featured card chip if present, else PvP record.
    if (p.featured && p.featured.name) {
      var classBit = p.featured.class ? ' · ' + escHtml(p.featured.class) : '';
      return '<span class="bs-lb-row__featured"><i class="fas fa-id-card" aria-hidden="true"></i> ' + escHtml(p.featured.name) + classBit + '</span>';
    }
    if (p.pvpRecord && (p.pvpRecord.w > 0 || p.pvpRecord.l > 0)) {
      return '<span class="bs-lb-row__featured"><i class="fas fa-chess-knight" aria-hidden="true"></i> ' + p.pvpRecord.w + 'W / ' + p.pvpRecord.l + 'L PvP</span>';
    }
    return '<span class="bs-lb-row__featured bs-lb-row__featured--muted">No card on display</span>';
  }

  function renderRow(p, myUserId) {
    var isMe = myUserId && p.userId === myUserId;
    var medal = rankMedal(p.rank);
    var stat = primaryStatFor(_activeTab, p);
    var href = '/blindspot/profile.html?u=' + encodeURIComponent(p.userId);
    return '<a class="bs-lb-row' + (isMe ? ' bs-lb-row--me' : '') + (p.rank <= 3 ? ' bs-lb-row--top3' : '') + '" data-user-id="' + escHtml(p.userId) + '" href="' + href + '" aria-label="View ' + escHtml(p.displayName) + ' profile">'
      + '<div class="bs-lb-row__rank">' + (medal || ('#' + p.rank)) + '</div>'
      + '<div class="bs-lb-row__avatar">' + avatarHtml(p) + '</div>'
      + '<div class="bs-lb-row__body">'
      +   '<div class="bs-lb-row__name">' + escHtml(p.displayName) + (isMe ? ' <span class="bs-lb-row__you">(you)</span>' : '') + '</div>'
      +   '<div class="bs-lb-row__sub">' + secondaryLine(p) + '</div>'
      + '</div>'
      + '<div class="bs-lb-row__stat">'
      +   '<div class="bs-lb-row__stat-value">' + escHtml(stat.value) + '</div>'
      +   '<div class="bs-lb-row__stat-label">' + escHtml(stat.label) + '</div>'
      + '</div>'
      + '</a>';
  }

  function ensureMarkup() {
    var container = document.getElementById('bs-leaderboard-content');
    if (!container) return null;
    if (!container.querySelector('.bs-leaderboard__tabs')) {
      var tabsHtml = '<div class="bs-leaderboard__tabs" role="tablist">'
        + TABS.map(function (t) {
            var sel = t.id === _activeTab;
            return '<button type="button" class="bs-leaderboard__tab' + (sel ? ' is-active' : '') + '" data-leaderboard-tab="' + t.id + '" role="tab" aria-selected="' + (sel ? 'true' : 'false') + '">'
              + '<i class="fas ' + t.icon + '" aria-hidden="true"></i> ' + t.label
              + '</button>';
          }).join('')
        + '</div>'
        + '<div id="bs-leaderboard-list" class="bs-leaderboard__list" role="tabpanel" aria-live="polite"></div>';
      container.innerHTML = tabsHtml;
    }
    bindTabs();
    return container.querySelector('#bs-leaderboard-list');
  }

  function renderLeaderboard() {
    var listEl = ensureMarkup();
    if (!listEl) return;
    setActiveTabUI();

    listEl.innerHTML = '<div class="bs-loading"><div class="bs-spinner" role="status"></div> <i class="fas fa-trophy" style="color:var(--bs-accent);margin:0 0.3em;" aria-hidden="true"></i>Consulting the ranks…</div>';

    var thisTab = _activeTab; // capture so a fast tab switch doesn't render stale data

    fetchLeaderboard(_activeTab).then(function (data) {
      if (thisTab !== _activeTab) return; // a newer fetch is in flight

      var players = (data && Array.isArray(data.players)) ? data.players : [];
      if (players.length === 0) {
        listEl.innerHTML = '<p class="bs-leaderboard__empty">No qualifying fighters yet. Win a fight to land on the board.</p>';
        return;
      }

      var myUserId = _cb.getUserId ? _cb.getUserId() : null;
      // Fallback: getSelectedCard exposes the current card; profile.userId is preferred but optional.
      // If a player isn't authed there's nothing to highlight as "(you)".

      listEl.innerHTML = players.map(function (p) { return renderRow(p, myUserId); }).join('');
    }).catch(function (err) {
      if (thisTab !== _activeTab) return;
      var msg = (err && err.message === 'timeout')
        ? 'Could not load leaderboard. Try again later.'
        : 'Failed to load leaderboard.';
      listEl.innerHTML = '<p class="bs-leaderboard__error">' + msg + '</p>';
    });
  }

  window.BsLeaderboard = {
    setCallbacks: setCallbacks,
    render: renderLeaderboard,
    setActiveTab: function (tab) { if (TABS.some(function (t) { return t.id === tab; })) _activeTab = tab; }
  };
})();

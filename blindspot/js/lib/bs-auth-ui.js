/* ============================================================
   bs-auth-ui.js
   Topbar identity chip + dropdown menu (main + settings views).
   IIFE on window.BsAuthUI.

   Responsibilities:
     - Read /.auth/me to detect signed-in vs guest
     - Populate the chip (name + avatar) and menu header
     - Toggle between chip (signed-in) and Sign In button (guest)
     - Drive the dropdown: open / close, view switching, focus trap,
       outside-click + Esc behavior, item handlers (Fighter Profile,
       Settings, How to Play, Sign Out)
     - Persist Reduce Effects preference (lives on the Settings view)

   Public API:
     setCallbacks(cbs)   accepts { showScreen, renderStatsScreen,
                                   renderLobby, openHowToPlay }
     update()            re-runs the auth check + populates UI
     refreshAvatar()     re-pulls the equipped card avatar URL into
                         both chip and menu header (after a card swap)
   ============================================================ */
(function () {
  'use strict';

  var ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];
  var REDUCE_EFFECTS_KEY = 'bs-reduce-effects';
  var _cb = {};
  var _menuBound = false;

  function setCallbacks(obj) { _cb = obj || {}; }

  // ── Reduce Effects (lives on the Settings sub-panel in Phase 5) ──

  function isReduceEffectsOn() {
    try { return localStorage.getItem(REDUCE_EFFECTS_KEY) === 'true'; }
    catch (e) { return false; }
  }

  function applyReduceEffects(on) {
    document.body.classList.toggle('bs-reduce-effects', !!on);
    var item = document.getElementById('bs-topbar-menu-effects');
    var state = document.getElementById('bs-topbar-menu-effects-state');
    if (item) item.setAttribute('aria-checked', on ? 'true' : 'false');
    if (state) state.textContent = on ? 'On' : 'Off';
  }

  // ── Selected card cache (avatar source for chip + menu header) ──

  function getSelectedCardFromCache() {
    try {
      var deck = JSON.parse(localStorage.getItem('bs-deck') || '[]');
      var selectedId = localStorage.getItem('bs-selected-card-id');
      var card = (selectedId && deck.find(function (c) { return c && c.id === selectedId; })) || deck[0];
      return card || null;
    } catch (e) { return null; }
  }

  function setAvatarSource(imgEl, fallbackEl, url) {
    if (!imgEl) return;
    if (url) {
      imgEl.src = url;
      imgEl.removeAttribute('hidden');
      if (fallbackEl) fallbackEl.setAttribute('hidden', '');
    } else {
      imgEl.removeAttribute('src');
      imgEl.setAttribute('hidden', '');
      if (fallbackEl) fallbackEl.removeAttribute('hidden');
    }
  }

  function updateAvatars() {
    var card = getSelectedCardFromCache();
    var url = card && card.avatar ? String(card.avatar).trim() : '';

    // Chip avatar (24px in the trigger).
    setAvatarSource(
      document.getElementById('bs-topbar-user-avatar-img'),
      document.querySelector('.bs-topbar__user-avatar-fallback'),
      url
    );

    // Menu header avatar (40px in the dropdown header).
    setAvatarSource(
      document.getElementById('bs-topbar-menu-avatar-img'),
      document.querySelector('.bs-topbar__user-menu-avatar-fallback'),
      url
    );
  }

  function guestGreetingName() {
    var card = getSelectedCardFromCache();
    if (card && card.name && String(card.name).trim()) return String(card.name).trim();
    return 'Stranger';
  }

  // ── Menu views (main vs settings) ──

  function getView(name) {
    return document.getElementById('bs-topbar-menu-view-' + name);
  }

  function setView(name) {
    var main = getView('main');
    var settings = getView('settings');
    if (!main || !settings) return;
    if (name === 'settings') {
      main.setAttribute('hidden', '');
      settings.removeAttribute('hidden');
      focusFirstIn(settings);
    } else {
      settings.setAttribute('hidden', '');
      main.removeAttribute('hidden');
      focusFirstIn(main);
    }
  }

  function getActiveView() {
    var settings = getView('settings');
    return settings && !settings.hasAttribute('hidden') ? settings : getView('main');
  }

  // ── Focus trap helpers ──

  function getFocusables(view) {
    if (!view) return [];
    var nodes = view.querySelectorAll('a[href]:not([hidden]), button:not([hidden]):not([disabled])');
    return Array.prototype.filter.call(nodes, function (n) {
      // Skip elements inside hidden subtrees (admin item, etc).
      var p = n;
      while (p && p !== view) {
        if (p.hasAttribute('hidden')) return false;
        p = p.parentNode;
      }
      return true;
    });
  }

  function focusFirstIn(view) {
    var f = getFocusables(view);
    if (f.length) f[0].focus();
  }

  // ── Open / close ──

  function setMenuOpen(open) {
    var chip = document.getElementById('bs-topbar-user-chip');
    var menu = document.getElementById('bs-topbar-user-menu');
    if (!chip || !menu) return;
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      // Always start at the main view; settings should be a deliberate
      // sub-navigation, not a sticky panel.
      setView('main');
      menu.removeAttribute('hidden');
      // Focus the first interactive item so keyboard users land in
      // the menu directly.
      focusFirstIn(getView('main'));
    } else {
      menu.setAttribute('hidden', '');
      // Reset settings view so it doesn't briefly flash on next open.
      var settings = getView('settings');
      if (settings) settings.setAttribute('hidden', '');
      var main = getView('main');
      if (main) main.removeAttribute('hidden');
    }
  }

  // ── Bind menu (idempotent) ──

  function bindMenu() {
    if (_menuBound) return;
    var chip = document.getElementById('bs-topbar-user-chip');
    var menu = document.getElementById('bs-topbar-user-menu');
    if (!chip || !menu) return;
    _menuBound = true;

    // Chip click toggles the menu.
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = chip.getAttribute('aria-expanded') === 'true';
      setMenuOpen(!open);
    });

    // Outside-click closes. mousedown beats document-level click race
    // conditions on touch devices.
    document.addEventListener('mousedown', function (e) {
      if (chip.getAttribute('aria-expanded') !== 'true') return;
      if (chip.contains(e.target) || menu.contains(e.target)) return;
      setMenuOpen(false);
    });

    // Esc handling: on settings view it goes back to main; on main it
    // closes the menu and restores focus to the chip.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (chip.getAttribute('aria-expanded') !== 'true') return;
      var settings = getView('settings');
      if (settings && !settings.hasAttribute('hidden')) {
        setView('main');
        var settingsBtn = document.getElementById('bs-topbar-menu-settings');
        if (settingsBtn) settingsBtn.focus();
      } else {
        setMenuOpen(false);
        chip.focus();
      }
    });

    // Tab focus trap inside the menu. Captures Tab on the menu element
    // and wraps focus around the focusables in the active view.
    menu.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var view = getActiveView();
      var f = getFocusables(view);
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // ── Settings view ──

    var settingsBtn = document.getElementById('bs-topbar-menu-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () { setView('settings'); });
    }
    var backBtn = document.getElementById('bs-topbar-menu-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () { setView('main'); });
    }

    // ── Reduce Effects toggle (Settings view) ──

    var effectsBtn = document.getElementById('bs-topbar-menu-effects');
    if (effectsBtn) {
      applyReduceEffects(isReduceEffectsOn());
      effectsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var next = !isReduceEffectsOn();
        try { localStorage.setItem(REDUCE_EFFECTS_KEY, next ? 'true' : 'false'); }
        catch (err) { /* localStorage blocked, apply in-memory only */ }
        applyReduceEffects(next);
      });
    }

    // ── Fighter Profile -> stats screen ──

    var profileBtn = document.getElementById('bs-topbar-menu-profile');
    if (profileBtn) {
      profileBtn.addEventListener('click', function () {
        setMenuOpen(false);
        if (_cb.showScreen) _cb.showScreen('stats');
        if (_cb.renderStatsScreen) _cb.renderStatsScreen();
      });
    }

    // ── How to Play -> existing modal ──

    var howtoBtn = document.getElementById('bs-topbar-menu-howto');
    if (howtoBtn) {
      howtoBtn.addEventListener('click', function () {
        setMenuOpen(false);
        var htp = document.getElementById('bs-howtoplay');
        if (htp) htp.classList.remove('bs-modal-backdrop--hidden');
      });
    }
  }

  // ── Menu header populate ──

  function updateMenuHeader(name) {
    var nameEl = document.getElementById('bs-topbar-menu-name');
    var metaEl = document.getElementById('bs-topbar-menu-meta');
    if (nameEl) nameEl.textContent = name || 'Fighter';
    if (metaEl) {
      var xp = (window.BsState && window.BsState.progress && window.BsState.progress.xp) || 0;
      var level = (window.BsState && typeof window.BsState.computeLevel === 'function') ? window.BsState.computeLevel(xp) : 1;
      var sparks = (window.BsState && window.BsState.progress && window.BsState.progress.sparks) || 0;
      metaEl.textContent = 'LV ' + level + ' · ' + sparks + ' sparks';
    }
  }

  // ── Auth check + populate ──

  function updatePlayAuthUI() {
    var chip = document.getElementById('bs-topbar-user-chip');
    var nameEl = document.getElementById('bs-topbar-user-name');
    var levelChip = document.getElementById('bs-topbar-level');
    var levelNumEl = document.getElementById('bs-topbar-level-num');
    var signin = document.getElementById('bs-topbar-signin');
    var menu = document.getElementById('bs-topbar-user-menu');
    var adminItem = document.getElementById('bs-topbar-menu-admin');
    var lobbyNameEl = document.getElementById('bs-lobby-username');
    if (!chip || !nameEl || !signin || !menu) return;

    bindMenu();

    fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.clientPrincipal) {
        sessionStorage.setItem('isAuthenticated', 'true');
        document.body.setAttribute('data-auth-state', 'signed-in');

        var name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'fighter';
        var xp = (window.BsState && window.BsState.progress && window.BsState.progress.xp) || 0;
        var level = (window.BsState && typeof window.BsState.computeLevel === 'function') ? window.BsState.computeLevel(xp) : 1;

        nameEl.textContent = name;
        if (levelNumEl) levelNumEl.textContent = 'Lv ' + level;
        if (levelChip) levelChip.removeAttribute('hidden');
        updateAvatars();
        updateMenuHeader(name);
        chip.removeAttribute('hidden');
        signin.setAttribute('hidden', '');
        if (lobbyNameEl) lobbyNameEl.textContent = name;

        if (adminItem) {
          if (data.clientPrincipal.userId && ADMIN_USER_IDS.indexOf(data.clientPrincipal.userId) >= 0) {
            adminItem.removeAttribute('hidden');
          } else {
            adminItem.setAttribute('hidden', '');
          }
        }
      } else {
        chip.setAttribute('hidden', '');
        if (levelChip) levelChip.setAttribute('hidden', '');
        setMenuOpen(false);
        signin.removeAttribute('hidden');
        if (lobbyNameEl) lobbyNameEl.textContent = guestGreetingName();
      }
    }).catch(function () {
      chip.setAttribute('hidden', '');
      if (levelChip) levelChip.setAttribute('hidden', '');
      setMenuOpen(false);
      signin.removeAttribute('hidden');
      if (lobbyNameEl) lobbyNameEl.textContent = guestGreetingName();
    });
  }

  window.BsAuthUI = {
    setCallbacks: setCallbacks,
    update: updatePlayAuthUI,
    refreshAvatar: updateAvatars
  };
})();

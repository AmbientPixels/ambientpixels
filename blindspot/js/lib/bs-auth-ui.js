/* ============================================================
   bs-auth-ui.js — Play page topbar auth display
   IIFE → window.BsAuthUI

   Drives the identity chip + dropdown in the topbar (replaces an
   older inline-style blob inside #bs-topbar-user). Markup lives in
   play.html under #bs-topbar-user-wrap; this module:
     - reads /.auth/me to detect signed-in vs guest
     - populates name + level into the chip, reveals admin menu item
       when the userId matches the whitelist
     - toggles between the chip (signed-in) and a "Sign in" button
       (guest) by flipping the [hidden] attribute — no display:none
       overrides so the original CSS still works
     - wires chip click → menu open, outside-click + Esc → close,
       aria-expanded for screen readers
   ============================================================ */
(function () {
  'use strict';

  var ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];
  var _cb = {};
  var _menuBound = false;

  function setCallbacks(obj) { _cb = obj || {}; }

  function bindMenu() {
    if (_menuBound) return;
    _menuBound = true;
    var chip = document.getElementById('bs-topbar-user-chip');
    var menu = document.getElementById('bs-topbar-user-menu');
    if (!chip || !menu) return;

    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = chip.getAttribute('aria-expanded') === 'true';
      setMenuOpen(!open);
    });

    // Outside-click closes the menu. mousedown beats the doc-level click
    // race on touch devices.
    document.addEventListener('mousedown', function (e) {
      if (chip.getAttribute('aria-expanded') !== 'true') return;
      if (chip.contains(e.target) || menu.contains(e.target)) return;
      setMenuOpen(false);
    });

    // Esc closes from anywhere; focus returns to the chip so keyboard
    // users don't lose their place.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (chip.getAttribute('aria-expanded') !== 'true') return;
      setMenuOpen(false);
      chip.focus();
    });
  }

  function setMenuOpen(open) {
    var chip = document.getElementById('bs-topbar-user-chip');
    var menu = document.getElementById('bs-topbar-user-menu');
    if (!chip || !menu) return;
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) menu.removeAttribute('hidden');
    else menu.setAttribute('hidden', '');
  }

  function guestGreetingName() {
    // Guest greeting prefers the player's selected card name (their chosen
    // fighter identity), falls back to the lore-appropriate "Stranger"
    // rather than the generic "fighter". The Stranger is who you are on the
    // splash — staying with that voice when no card name is available reads
    // intentional instead of placeholder.
    try {
      var deck = JSON.parse(localStorage.getItem('bs-deck') || '[]');
      var selectedId = localStorage.getItem('bs-selected-card-id');
      var card = (selectedId && deck.find(function (c) { return c && c.id === selectedId; })) || deck[0];
      if (card && card.name && String(card.name).trim()) return String(card.name).trim();
    } catch (e) { /* fall through */ }
    return 'Stranger';
  }

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
        // Signed in.
        sessionStorage.setItem('isAuthenticated', 'true');
        document.body.setAttribute('data-auth-state', 'signed-in');

        var name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'fighter';

        // Level chip from BsState. Falls back to "Lv 1" if BsState isn't
        // ready (e.g. running on a page that loaded auth-ui before
        // bs-state).
        var xp = (window.BsState && window.BsState.progress && window.BsState.progress.xp) || 0;
        var level = (window.BsState && typeof window.BsState.computeLevel === 'function') ? window.BsState.computeLevel(xp) : 1;

        nameEl.textContent = name;
        if (levelNumEl) levelNumEl.textContent = 'Lv ' + level;
        if (levelChip) levelChip.removeAttribute('hidden');
        chip.removeAttribute('hidden');
        signin.setAttribute('hidden', '');
        if (lobbyNameEl) lobbyNameEl.textContent = name;

        // Admin item — reveal the menu row, not a separate icon link.
        if (adminItem) {
          if (data.clientPrincipal.userId && ADMIN_USER_IDS.indexOf(data.clientPrincipal.userId) >= 0) {
            adminItem.removeAttribute('hidden');
          } else {
            adminItem.setAttribute('hidden', '');
          }
        }
      } else {
        // Not signed in. Hide chip + level, show sign-in button.
        chip.setAttribute('hidden', '');
        if (levelChip) levelChip.setAttribute('hidden', '');
        setMenuOpen(false);
        signin.removeAttribute('hidden');
        if (lobbyNameEl) lobbyNameEl.textContent = guestGreetingName();
      }
    }).catch(function () {
      // Auth check failed — show sign in.
      chip.setAttribute('hidden', '');
      if (levelChip) levelChip.setAttribute('hidden', '');
      setMenuOpen(false);
      signin.removeAttribute('hidden');
      if (lobbyNameEl) lobbyNameEl.textContent = guestGreetingName();
    });
  }

  window.BsAuthUI = {
    setCallbacks: setCallbacks,
    update: updatePlayAuthUI
  };
})();

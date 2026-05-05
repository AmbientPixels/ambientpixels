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
  var REDUCE_EFFECTS_KEY = 'bs-reduce-effects';
  var _cb = {};
  var _menuBound = false;

  function setCallbacks(obj) { _cb = obj || {}; }

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

  function bindMenu() {
    if (_menuBound) return;
    _menuBound = true;
    var chip = document.getElementById('bs-topbar-user-chip');
    var menu = document.getElementById('bs-topbar-user-menu');
    if (!chip || !menu) return;

    // Reduce-effects toggle. Lives in the user dropdown so it's
    // discoverable but doesn't compete with primary CTAs. The class
    // is already applied by an inline <head> script before this binds
    // so the menu state just reflects current truth.
    var effectsBtn = document.getElementById('bs-topbar-menu-effects');
    if (effectsBtn) {
      applyReduceEffects(isReduceEffectsOn());
      effectsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var next = !isReduceEffectsOn();
        try { localStorage.setItem(REDUCE_EFFECTS_KEY, next ? 'true' : 'false'); }
        catch (err) { /* localStorage blocked — apply in-memory only */ }
        applyReduceEffects(next);
      });
    }

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

  function getSelectedCardFromCache() {
    // The lobby keeps the deck mirrored in localStorage as bs-deck and
    // the active card id as bs-selected-card-id. Reading directly from
    // there avoids needing a callback dependency on blindspot-flow.js
    // and matches the pattern guestGreetingName already uses.
    try {
      var deck = JSON.parse(localStorage.getItem('bs-deck') || '[]');
      var selectedId = localStorage.getItem('bs-selected-card-id');
      var card = (selectedId && deck.find(function (c) { return c && c.id === selectedId; })) || deck[0];
      return card || null;
    } catch (e) { return null; }
  }

  function guestGreetingName() {
    // Guest greeting prefers the player's selected card name (their chosen
    // fighter identity), falls back to the lore-appropriate Stranger
    // rather than the generic "fighter". The Stranger is who you are on
    // the splash; staying with that voice when no card name is available
    // reads intentional instead of placeholder.
    var card = getSelectedCardFromCache();
    if (card && card.name && String(card.name).trim()) return String(card.name).trim();
    return 'Stranger';
  }

  function updateUserAvatar() {
    // Pulls the equipped card's avatar URL from the same cache the
    // lobby reads. Falls back to the silhouette icon (fa-user-shield
    // already in markup) if no card or no avatar URL.
    var img = document.getElementById('bs-topbar-user-avatar-img');
    var fallback = document.querySelector('.bs-topbar__user-avatar-fallback');
    if (!img) return;
    var card = getSelectedCardFromCache();
    var url = card && card.avatar ? String(card.avatar).trim() : '';
    if (url) {
      img.src = url;
      img.removeAttribute('hidden');
      if (fallback) fallback.setAttribute('hidden', '');
    } else {
      img.removeAttribute('src');
      img.setAttribute('hidden', '');
      if (fallback) fallback.removeAttribute('hidden');
    }
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
        updateUserAvatar();
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
    update: updatePlayAuthUI,
    refreshAvatar: updateUserAvatar
  };
})();

/* ============================================================
   bs-auth-ui.js — Play page topbar auth display
   IIFE → window.BsAuthUI
   ============================================================ */
(function () {
  'use strict';

  var _cb = {};

  function setCallbacks(obj) { _cb = obj || {}; }

  function updatePlayAuthUI() {
    var el = document.getElementById('bs-topbar-user');
    if (!el) return;

    var escHtml = _cb.escHtml || function (s) { return String(s); };

    var lobbyNameEl = document.getElementById('bs-lobby-username');

    // Always check /.auth/me directly — don't rely on _profileData
    fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.clientPrincipal) {
        // User IS logged in
        sessionStorage.setItem('isAuthenticated', 'true');
        document.body.setAttribute('data-auth-state', 'signed-in');

        var name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'fighter';

        // Reveal the admin gear icon if userId matches the admin whitelist.
        var ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];
        if (data.clientPrincipal.userId && ADMIN_USER_IDS.indexOf(data.clientPrincipal.userId) >= 0) {
          var adminLink = document.getElementById('bs-topbar-admin');
          if (adminLink) adminLink.hidden = false;
        }

        // Compute level chip from BsState. Falls back to "Lv 1" if state isn't ready
        // (e.g. running on a page that loaded auth-ui before bs-state).
        var xp = (window.BsState && window.BsState.progress && window.BsState.progress.xp) || 0;
        var level = (window.BsState && typeof window.BsState.computeLevel === 'function') ? window.BsState.computeLevel(xp) : 1;
        var levelChip = ' <span style="color:var(--bs-accent); font-size:0.65rem; margin-left:0.4rem; letter-spacing:0.05em; font-variant-numeric:tabular-nums;">Lv ' + level + '</span>';

        el.innerHTML = '<i class="fas fa-user-check" style="color:var(--bs-accent); font-size:0.6rem;"></i> '
          + escHtml(name)
          + levelChip
          + ' <a href="/.auth/logout?post_logout_redirect_uri=/blindspot/" style="color:var(--bs-text-muted); margin-left:0.5rem; font-size:0.65rem;" title="Sign out"><i class="fas fa-sign-out-alt"></i></a>';
        if (lobbyNameEl) lobbyNameEl.textContent = name;
      } else {
        // Not logged in — show sign in link
        el.innerHTML = '<a href="/blindspot/login.html?redirect=/blindspot/play.html" style="color:var(--bs-accent); font-size:0.7rem;"><i class="fas fa-sign-in-alt"></i> Sign in</a>';
        if (lobbyNameEl) lobbyNameEl.textContent = 'fighter';
      }
    }).catch(function () {
      // Auth check failed — show sign in link
      el.innerHTML = '<a href="/blindspot/login.html?redirect=/blindspot/play.html" style="color:var(--bs-accent); font-size:0.7rem;"><i class="fas fa-sign-in-alt"></i> Sign in</a>';
      if (lobbyNameEl) lobbyNameEl.textContent = 'fighter';
    });
  }

  window.BsAuthUI = {
    setCallbacks: setCallbacks,
    update: updatePlayAuthUI
  };
})();

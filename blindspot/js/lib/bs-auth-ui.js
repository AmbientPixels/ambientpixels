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

    // Always check /.auth/me directly — don't rely on _profileData
    fetch('/.auth/me').then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.clientPrincipal) {
        // User IS logged in
        sessionStorage.setItem('isAuthenticated', 'true');
        document.body.setAttribute('data-auth-state', 'signed-in');

        var name = (data.clientPrincipal.userDetails || '').split('@')[0] || 'Player';
        el.innerHTML = '<i class="fas fa-user-check" style="color:var(--bs-accent); font-size:0.6rem;"></i> '
          + escHtml(name)
          + ' <a href="/.auth/logout?post_logout_redirect_uri=/blindspot/" style="color:var(--bs-text-muted); margin-left:0.5rem; font-size:0.65rem;" title="Sign out"><i class="fas fa-sign-out-alt"></i></a>';
      } else {
        // Not logged in — show sign in link
        el.innerHTML = '<a href="/blindspot/login.html?redirect=/blindspot/play.html" style="color:var(--bs-accent); font-size:0.7rem;"><i class="fas fa-sign-in-alt"></i> Sign in</a>';
      }
    }).catch(function () {
      // Auth check failed — show sign in link
      el.innerHTML = '<a href="/blindspot/login.html?redirect=/blindspot/play.html" style="color:var(--bs-accent); font-size:0.7rem;"><i class="fas fa-sign-in-alt"></i> Sign in</a>';
    });
  }

  window.BsAuthUI = {
    setCallbacks: setCallbacks,
    update: updatePlayAuthUI
  };
})();

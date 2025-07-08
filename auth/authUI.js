// /auth/authUI.js
// Auth UI using Azure Static Web Apps /.auth endpoints (no MSAL)

(function() {
  // Debug logging
  function debugLog(...args) {
    if (window.DEBUG_AUTH || localStorage.getItem('DEBUG_AUTH') === 'true') console.log('[AUTH]', ...args);
  }

  // Update body attribute for auth state
  function setAuthStateAttr(isSignedIn) {
    document.body?.setAttribute('data-auth-state', isSignedIn ? 'signed-in' : 'signed-out');
  }

  // Bind user profile dropdown events
  function bindDropdownEvents() {
    const btn = document.getElementById('user-profile-button');
    const menu = document.getElementById('user-profile-dropdown');
    if (!btn || !menu) return;
    // Cleanup
    btn.onclick = null;
    document.removeEventListener('click', menu._outsideHandler);
    // Toggle handler
    const toggle = e => {
      e.stopPropagation();
      const vis = menu.classList.toggle('visible');
      btn.setAttribute('aria-expanded', vis);
    };
    btn.addEventListener('click', toggle);
    btn._toggleHandler = toggle;
    // Outside click
    const outside = e => {
      if (!menu.contains(e.target) && menu.classList.contains('visible')) {
        menu.classList.remove('visible');
        btn.setAttribute('aria-expanded','false');
      }
    };
    document.addEventListener('click', outside);
    menu._outsideHandler = outside;
  }

  // Update UI based on sessionStorage auth state
  function updateUI() {
    const isSignedIn = sessionStorage.getItem('ambientPixels_isAuthenticated') === 'true';
    setAuthStateAttr(isSignedIn);

    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const display = document.getElementById('user-display-name');

    if (loginBtn) loginBtn.style.display = isSignedIn ? 'none' : '';
    if (logoutBtn) logoutBtn.style.display = isSignedIn ? '' : 'none';
    if (display) {
      if (isSignedIn) {
        try {
          const info = JSON.parse(sessionStorage.getItem('userInfo'));
          display.textContent = info.displayName || info.name || '';
        } catch {}
      } else {
        display.textContent = '';
      }
    }
  }

  // Trigger Azure SWA B2C login
  function login(e) {
    e?.preventDefault();
    window.location.href = '/.auth/login/aadB2C?p=SignUpSignIn';
  }

  // Trigger logout
  function logout(e) {
    e?.preventDefault();
    sessionStorage.removeItem('ambientPixels_isAuthenticated');
    sessionStorage.removeItem('userInfo');
    window.location.href = '/.auth/logout';
  }

  // Attach click handlers to auth buttons
  function bindAuthButtons() {
    const lb = document.getElementById('login-btn');
    const lo = document.getElementById('logout-btn');
    if (lb) lb.onclick = login;
    if (lo) lo.onclick = logout;
    bindDropdownEvents();
    updateUI();
  }

  // Expose globals for other modules
  window.login = login;
  window.logout = logout;
  window.bindAuthButtons = bindAuthButtons;
  window.updateAuthUI = updateUI;
  window.authModule = {
    getCurrentUser: () => {
      if (sessionStorage.getItem('ambientPixels_isAuthenticated') !== 'true') return null;
      try { return JSON.parse(sessionStorage.getItem('userInfo')); } catch { return null; }
    }
  };

  // Fetch SWA auth info and populate sessionStorage
  async function loadAuthState() {
    try {
      const resp = await fetch('/.auth/me');
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          sessionStorage.setItem('ambientPixels_isAuthenticated', 'true');
          const user = data[0];
          const userInfo = {
            displayName: user.userDetails || '',
            name: user.userDetails || '',
            email: user.userDetails || '',
            userId: user.userId || ''
          };
          sessionStorage.setItem('userInfo', JSON.stringify(userInfo));
        }
      }
    } catch (e) {
      debugLog('loadAuthState error:', e);
    }
  }

  // Initialize on load: first load auth state, then bind buttons
  document.addEventListener('DOMContentLoaded', async () => {
    await loadAuthState();
    bindAuthButtons();
  });
})();

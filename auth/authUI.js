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
    const userProfileContainer = document.getElementById('user-profile-container');
    const displayName = document.getElementById('user-display-name');
    const dropdownName = document.querySelector('.dropdown-user-name');
    const dropdownEmail = document.querySelector('.dropdown-user-email');

    if (loginBtn) loginBtn.style.display = isSignedIn ? 'none' : 'inline-block';
    if (userProfileContainer) userProfileContainer.style.display = isSignedIn ? 'block' : 'none';
    
    if (isSignedIn) {
      try {
        const info = JSON.parse(sessionStorage.getItem('userInfo')) || {};
        const name = info.displayName || info.name || 'User';
        const email = info.email || '';
        
        // Update display name in header
        if (displayName) displayName.textContent = name;
        
        // Update dropdown info
        if (dropdownName) dropdownName.textContent = name;
        if (dropdownEmail) dropdownEmail.textContent = email;
        
        // Update avatar if available
        const avatar = document.getElementById('user-avatar');
        if (avatar) {
          const avatarImg = avatar.querySelector('img');
          if (avatarImg) {
            avatarImg.src = info.photoURL || '/images/avatars/default.png';
            avatarImg.alt = `${name}'s avatar`;
          } else {
            const icon = avatar.querySelector('i');
            if (icon) icon.className = info.photoURL ? 'fas fa-user-circle' : 'fas fa-user-circle';
          }
        }
      } catch (e) {
        debugLog('Error updating UI:', e);
      }
    } else {
      // Clear user info if not signed in
      if (displayName) displayName.textContent = '';
      if (dropdownName) dropdownName.textContent = '';
      if (dropdownEmail) dropdownEmail.textContent = '';
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
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('dropdown-logout-btn');
    
    if (loginBtn) {
      loginBtn.onclick = login;
      loginBtn.addEventListener('click', login);
    }
    
    if (logoutBtn) {
      logoutBtn.onclick = (e) => {
        e.preventDefault();
        logout(e);
      };
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout(e);
      });
    }
    
    // Bind dropdown events
    bindDropdownEvents();
    
    // Update UI state
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
        debugLog('Auth response:', data);
        if (data && data.clientPrincipal) {
          const user = data.clientPrincipal;
          const claims = user.userClaims || [];
          const emailClaim = claims.find(c => c.typ === 'emails' || c.typ === 'preferred_username');
          const nameClaim = claims.find(c => c.typ === 'name' || c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name');
          
          const userInfo = {
            displayName: nameClaim?.val || user.userDetails.split('@')[0] || 'User',
            name: nameClaim?.val || user.userDetails.split('@')[0] || '',
            email: emailClaim?.val || (user.userDetails.includes('@') ? user.userDetails : ''),
            userId: user.userId || '',
            identityProvider: user.identityProvider || '',
            photoURL: '' // Will be populated from user's profile if available
          };
          
          sessionStorage.setItem('ambientPixels_isAuthenticated', 'true');
          sessionStorage.setItem('userInfo', JSON.stringify(userInfo));
          
          // Update UI and bind events
          updateUI();
          bindDropdownEvents();
          
          return true;
        } else {
          // Clear auth state if not authenticated
          sessionStorage.removeItem('ambientPixels_isAuthenticated');
          sessionStorage.removeItem('userInfo');
          updateUI();
          return false;
        }
      }
    } catch (e) {
      debugLog('loadAuthState error:', e);
      sessionStorage.removeItem('ambientPixels_isAuthenticated');
      sessionStorage.removeItem('userInfo');
      updateUI();
      return false;
    }
  }

  // Initialize on load: first load auth state, then bind buttons
  document.addEventListener('DOMContentLoaded', async () => {
    await loadAuthState();
    bindAuthButtons();
  });
})();

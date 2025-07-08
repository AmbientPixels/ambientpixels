// /auth/authUI.js - Simple auth state management for Azure Static Web Apps

(function() {
  // Debug logging
  const debug = window.DEBUG_AUTH || localStorage.getItem('DEBUG_AUTH') === 'true';
  function debugLog(...args) {
    if (debug) console.log('[AUTH]', ...args);
  }

  // Update body attribute for auth state
  function setAuthState(isSignedIn) {
    document.body?.setAttribute('data-auth-state', isSignedIn ? 'signed-in' : 'signed-out');
    
    const loginBtn = document.getElementById('login-btn');
    const userProfile = document.getElementById('user-profile-container');
    
    if (loginBtn) loginBtn.style.display = isSignedIn ? 'none' : 'inline-block';
    if (userProfile) userProfile.style.display = isSignedIn ? 'block' : 'none';
  }

  // Update user info in the UI
  function updateUserInfo(userInfo) {
    if (!userInfo) return;
    
    const displayName = document.getElementById('user-display-name');
    const dropdownName = document.querySelector('.dropdown-user-name');
    const dropdownEmail = document.querySelector('.dropdown-user-email');
    
    const name = userInfo.displayName || userInfo.name || 'User';
    const email = userInfo.email || '';
    
    if (displayName) displayName.textContent = name;
    if (dropdownName) dropdownName.textContent = name;
    if (dropdownEmail) dropdownEmail.textContent = email;
  }

  // Check auth state and update UI
  async function checkAuthState() {
    try {
      const response = await fetch('/.auth/me');
      if (response.ok) {
        const { clientPrincipal } = await response.json();
        
        if (clientPrincipal) {
          const claims = clientPrincipal.userClaims || [];
          const userInfo = {
            userId: clientPrincipal.userId,
            name: clientPrincipal.userDetails.split('@')[0],
            email: clientPrincipal.userDetails.includes('@') ? clientPrincipal.userDetails : '',
            identityProvider: clientPrincipal.identityProvider
          };
          
          // Update session storage
          sessionStorage.setItem('userInfo', JSON.stringify(userInfo));
          sessionStorage.setItem('isAuthenticated', 'true');
          
          // Update UI
          setAuthState(true);
          updateUserInfo(userInfo);
          return true;
        }
      }
    } catch (error) {
      debugLog('Auth check failed:', error);
    }
    
    // Not authenticated
    sessionStorage.removeItem('userInfo');
    sessionStorage.removeItem('isAuthenticated');
    setAuthState(false);
    return false;
  }

  // Initialize auth system
  async function initAuth() {
    debugLog('Initializing auth...');
    
    // Check current auth state
    await checkAuthState();
    
    // Set up logout button
    const logoutBtn = document.getElementById('dropdown-logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = (e) => {
        e.preventDefault();
        window.location.href = '/.auth/logout?post_logout_redirect_uri=' + 
          encodeURIComponent(window.location.href);
      };
    }
    
    // Set up dropdown menu
    const profileBtn = document.getElementById('user-profile-button');
    const dropdown = document.getElementById('user-profile-dropdown');
    
    if (profileBtn && dropdown) {
      profileBtn.onclick = (e) => {
        e.stopPropagation();
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
      };
      
      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        dropdown.style.display = 'none';
      });
    }
    
    debugLog('Auth initialized');
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }
})();

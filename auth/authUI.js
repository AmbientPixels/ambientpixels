// /auth/authUI.js
// Unified, robust authentication logic for AmbientPixels using MSAL.js
// Implements: updateUI, data-auth-state, button loading, fallback guard, modular binding

(function() {
  // Debug logging
  function debugLog(...args) {
    if (window.DEBUG_AUTH || localStorage.getItem('DEBUG_AUTH') === 'true') console.log("[AUTH]", ...args);
  }

  // UI helpers
  function setAuthStateAttr(isSignedIn) {
    document.body && document.body.setAttribute('data-auth-state', isSignedIn ? 'signed-in' : 'signed-out');
  }
  function showButtonLoading(btn, isLoading) {
    if (!btn) return;
    if (isLoading) {
      btn.classList.add('loading');
      btn.disabled = true;
      if (!btn.querySelector('.auth-spinner')) {
        const spinner = document.createElement('span');
        spinner.className = 'auth-spinner';
        spinner.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.appendChild(spinner);
      }
    } else {
      btn.classList.remove('loading');
      btn.disabled = false;
      const spinner = btn.querySelector('.auth-spinner');
      if (spinner) btn.removeChild(spinner);
    }
  }
  function showFallback(message) {
    let fallback = document.getElementById('auth-fallback-message');
    if (!fallback) {
      fallback = document.createElement('div');
      fallback.id = 'auth-fallback-message';
      fallback.style = 'color: #fff; background: #c00; padding: 1em; margin: 1em 0; border-radius: 6px; text-align:center;';
      document.body.prepend(fallback);
    }
    fallback.textContent = message || 'Authentication system unavailable. Please try again later.';
    setAuthStateAttr(false);
    debugLog('Fallback message shown:', fallback.textContent);
  }

  // Main UI update function
  function updateUI() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const greeting = document.getElementById('user-greeting');
    let isSignedIn = false;
    let account = null;
    try {
      if (window.msalInstance && typeof window.msalInstance.getAllAccounts === 'function') {
        const accounts = window.msalInstance.getAllAccounts();
        account = accounts && accounts[0];
        isSignedIn = !!account;
      }
    } catch (e) { debugLog('updateUI account check error:', e); }
    setAuthStateAttr(isSignedIn);
    if (loginBtn) {
      loginBtn.style.display = isSignedIn ? 'none' : '';
      showButtonLoading(loginBtn, false);
      loginBtn.setAttribute('aria-hidden', isSignedIn ? 'true' : 'false');
    }
    if (logoutBtn) {
      logoutBtn.style.display = isSignedIn ? '' : 'none';
      showButtonLoading(logoutBtn, false);
      logoutBtn.setAttribute('aria-hidden', isSignedIn ? 'false' : 'true');
    }
    if (greeting) {
      greeting.style.display = isSignedIn ? '' : 'none';
      greeting.textContent = isSignedIn && account ? `Welcome, ${account.name || account.username}` : '';
    }
    debugLog('UI updated. Signed in:', isSignedIn, 'Account:', account);
  }

  // MSAL interaction_in_progress bug workaround
  if (
    sessionStorage.getItem('msal.interaction.status') === 'interaction_in_progress' &&
    !window.location.hash.includes('id_token') &&
    !window.location.hash.includes('access_token') &&
    !window.location.hash.includes('error')
  ) {
    sessionStorage.removeItem('msal.interaction.status');
    if (typeof showBanner === 'function') {
      showBanner({
        message: 'Recovered from a stuck login state. You may now try logging in again.',
        type: 'info',
        duration: 5000
      });
    }
  }

  // Main MSAL logic
  async function initAuth() {
    debugLog("Initializing MSAL authentication");
    // Get MSAL config from authConfig.js (imported separately)
    if (!window.msalConfig) {
      debugLog('ERROR: msalConfig not found. Make sure authConfig.js is loaded before authUI.js');
      showFallback('Authentication configuration missing. Please contact support.');
      return;
    }
    
    let msalInstance;
    try {
      msalInstance = new msal.PublicClientApplication(window.msalConfig);
      window.msalInstance = msalInstance; // expose for UI helpers
      debugLog('MSAL instance created:', msalInstance);
      if (typeof msalInstance.initialize === 'function') {
        debugLog('Calling msalInstance.initialize()...');
        await msalInstance.initialize();
        debugLog('MSAL instance initialized');
      }
      await handleRedirectResponse();
    } catch (e) {
      debugLog('MSAL instance creation/initialization failed:', e);
      showFallback('Authentication system unavailable. Please refresh or contact support.');
      return;
    }
    bindAuthButtons();
    updateUI();
  }

  async function handleRedirectResponse() {
    try {
      const response = await window.msalInstance.handleRedirectPromise();
      debugLog("handleRedirectPromise response:", response);
      if (response && response.account) {
        window.msalInstance.setActiveAccount(response.account);
        debugLog("Active account set after redirect:", response.account);
      }
    } catch (e) {
      debugLog("handleRedirectPromise error:", e);
      showFallback('Authentication error. Please refresh or contact support.');
    }
    updateUI();
  }

  function getAccount() {
    try {
      const accounts = window.msalInstance.getAllAccounts();
      debugLog("Accounts found:", accounts);
      return accounts.length > 0 ? accounts[0] : null;
    } catch (e) { return null; }
  }
  function isInteractionInProgress() {
    return sessionStorage.getItem('msal.interaction.status') === 'interaction_in_progress';
  }
  function login(event) {
    debugLog("Login button clicked");
    const loginBtn = document.getElementById("login-btn");
    if (event) event.preventDefault();
    if (isInteractionInProgress()) {
      debugLog("Login aborted: interaction already in progress.");
      showButtonLoading(loginBtn, true);
      return;
    }
    showButtonLoading(loginBtn, true);
    try {
      window.msalInstance.loginRedirect({ scopes: ["openid", "profile", "email"] });
    } catch (e) {
      debugLog('loginRedirect error:', e);
      showButtonLoading(loginBtn, false);
      showFallback('Login failed. Please try again.');
    }
  }
  function logout(event) {
    debugLog("Logout button clicked");
    const logoutBtn = document.getElementById("logout-btn");
    if (event) event.preventDefault();
    showButtonLoading(logoutBtn, true);
    try {
      window.msalInstance.logoutRedirect({ 
        postLogoutRedirectUri: window.msalConfig.auth.redirectUri + "?postlogout=true" 
      });
    } catch (e) {
      debugLog('logoutRedirect error:', e);
      showButtonLoading(logoutBtn, false);
      showFallback('Logout failed. Please try again.');
    }
  }
  function bindAuthButtons() {
    const loginBtn = document.getElementById("login-btn");
    if (loginBtn) {
      loginBtn.onclick = null;
      loginBtn.removeEventListener('click', login);
      loginBtn.addEventListener('click', login, {capture: false});
      loginBtn.setAttribute('aria-label', 'Log in to Ambient Pixels');
      loginBtn.setAttribute('tabindex', '0');
      loginBtn.setAttribute('role', 'button');
    }
    
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = null;
      logoutBtn.removeEventListener('click', logout);
      logoutBtn.addEventListener('click', logout, {capture: false});
      logoutBtn.setAttribute('aria-label', 'Log out of Ambient Pixels');
      logoutBtn.setAttribute('tabindex', '0');
      logoutBtn.setAttribute('role', 'button');
    }
    
    updateUI();
    debugLog('Auth buttons bound:', {loginBtn, logoutBtn});
  }

  // Expose needed globals
  window.initAuth = initAuth;
  window.login = login;
  window.logout = logout;
  window.getAccount = getAccount;
  window.bindAuthButtons = bindAuthButtons;
  window.updateAuthUI = updateUI;

  // Ensure MSAL is loaded before calling initAuth
  if (window.msal && typeof msal.PublicClientApplication === 'function') {
    // Check if we have authConfig.js loaded
    if (window.msalConfig) {
      debugLog('MSAL and config loaded, initializing auth');
      initAuth();
    } else {
      debugLog('MSAL loaded but config missing');
      showFallback('Authentication configuration missing. Please contact support.');
    }
  } else {
    debugLog('MSAL library not loaded');
    showFallback('Authentication system unavailable. Please refresh or contact support.');
  }

})();

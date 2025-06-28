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
    debugLog("MSAL config loaded");
    // MSAL config updated for Microsoft Entra External ID (see authConfig.js for source of truth)
    const msalConfig = {
      auth: {
        clientId: "043b76d8-143d-45e8-9481-5097c508b14e", // Entra External ID App (client) ID
        authority: "https://ambientpixelsai.ciamlogin.com/e1b17060-5ec1-49f8-b981-d3ae7207e25d/ambientpixelslogin", // User journey: ambientpixelslogin
        redirectUri: "https://ambientpixels.ai/", // Production/live domain
      },
      cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
    };
    debugLog("redirectUri:", msalConfig.auth.redirectUri);
    let msalInstance;
    try {
      msalInstance = new msal.PublicClientApplication(msalConfig);
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
      window.msalInstance.logoutRedirect({ postLogoutRedirectUri: "https://ambientpixels.ai/?postlogout=true" });
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
    }
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = null;
      logoutBtn.removeEventListener('click', logout);
      logoutBtn.addEventListener('click', logout, {capture: false});
    }
    updateUI();
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
    initAuth();
  } else {
    showFallback('Authentication system unavailable. Please refresh or contact support.');
  }

})();

function debugLog(...args) {
  if (window.DEBUG_AUTH || localStorage.getItem('DEBUG_AUTH') === 'true') console.log("[AUTH]", ...args);
}

async function initAuth() {
  debugLog("MSAL config loaded");
  // MSAL config
  const msalConfig = {
    auth: {
      clientId: "cc50167c-846e-4ed2-b4fe-48ab831615d2",
      authority: "https://login.microsoftonline.com/0450b3ca-5138-4391-9c98-bda7ad24118f/oauth2/v2.0/authorize?p=SignUpSignIn",
      // Force redirectUri to live production domain to avoid local dev issues
      redirectUri: "https://ambientpixels.ai/", // updated by Cascade: always use live domain

    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false,
    },
  };
  debugLog("redirectUri:", msalConfig.auth.redirectUri);
  let msalInstance;
  try {
    msalInstance = new msal.PublicClientApplication(msalConfig);
    debugLog('MSAL instance created:', msalInstance);
    if (typeof msalInstance.initialize === 'function') {
      debugLog('Calling msalInstance.initialize()...');
      await msalInstance.initialize();
      debugLog('MSAL instance initialized');
    }
    // Always handle redirect response after MSAL is initialized
    await handleRedirectResponse();
  } catch (e) {
    debugLog('MSAL instance creation/initialization failed:', e);
    alert('MSAL instance creation/initialization failed: ' + e.message);
    return;
  }
  function getAccount() {
    const accounts = msalInstance.getAllAccounts();
    debugLog("Accounts found:", accounts);
    return accounts.length > 0 ? accounts[0] : null;
  }
  function isInteractionInProgress() {
    return sessionStorage.getItem('msal.interaction.status') === 'interaction_in_progress';
  }
  function login(event) {
    debugLog("Login button clicked");
    if (event) event.preventDefault();
    if (isInteractionInProgress()) {
      debugLog("Login aborted: interaction already in progress.");
      const loginBtn = document.getElementById("login-btn");
      if (loginBtn) loginBtn.disabled = true;
    } else {
      const loginBtn = document.getElementById("login-btn");
      if (loginBtn) loginBtn.disabled = false;
    }
    try {
      msalInstance.loginRedirect({
        scopes: ["openid", "profile", "email"]
      });
      // handleRedirectResponse() should be called after MSAL init, not here
    } catch (e) {
      debugLog('loginRedirect error:', e);
      if (typeof showBanner === 'function') {
        showBanner({ message: 'Login failed: ' + (e.message || e), type: 'error', duration: 6000 });
      } else {
        alert('Login error: ' + e.message);
      }
    }
  }
  async function handleRedirectResponse() {
    try {
      const response = await msalInstance.handleRedirectPromise();
      debugLog("handleRedirectPromise response:", response);
      if (response && response.account) {
        msalInstance.setActiveAccount(response.account);
        debugLog("Active account set after redirect:", response.account);
        updateUI(); // Ensure UI is updated after login
      } else {
        updateUI(); // Also update UI if no response, to cover all cases
      }
    } catch (e) {
      debugLog("handleRedirectPromise error:", e);
      updateUI();
    }
  }
  function logout() {
    debugLog("Logout button clicked");
    try {
      msalInstance.logoutRedirect({
        postLogoutRedirectUri: msalConfig.auth.redirectUri + '?postlogout=true',
      });
    } catch (e) {
      debugLog('logoutRedirect error:', e);
      if (typeof showBanner === 'function') {
        showBanner({ message: 'Logout failed: ' + (e.message || e), type: 'error', duration: 6000 });
      } else {
        alert('Logout error: ' + e.message);
      }
    }
  }
  function bindAuthButtons() {
    const loginBtn = document.getElementById("login-btn");
    if (loginBtn) {
      loginBtn.onclick = null; // Remove any previous handler
      loginBtn.addEventListener('click', login, {capture: false});
    }
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = null;
      logoutBtn.addEventListener('click', logout, {capture: false});
    }
    const userGreeting = document.getElementById("user-greeting");
    // Accessibility improvements
    if (loginBtn) {
      loginBtn.setAttribute('aria-label', 'Log in to Ambient Pixels');
      loginBtn.setAttribute('tabindex', '0');
      loginBtn.setAttribute('role', 'button');
    }
    if (logoutBtn) {
      logoutBtn.setAttribute('aria-label', 'Log out of Ambient Pixels');
      logoutBtn.setAttribute('tabindex', '0');
      logoutBtn.setAttribute('role', 'button');
    }
    debugLog('Binding button events:', {loginBtn, logoutBtn, userGreeting});
    function updateUI() {
      const user = getAccount();
      debugLog('updateUI user:', user);
      if (loginBtn && logoutBtn && userGreeting) {
        if (user) {
          loginBtn.style.display = "none";
          logoutBtn.style.display = "";
          userGreeting.style.display = "";
          userGreeting.textContent = `Welcome, ${user.name || user.username || user.localAccountId}`;
        } else {
          loginBtn.style.display = "";
          logoutBtn.style.display = "none";
          userGreeting.style.display = "none";
        }
      }
      // Always disable login button if interaction is in progress
      if (loginBtn) {
        if (isInteractionInProgress()) {
          loginBtn.disabled = true;
          loginBtn.textContent = "Logging in...";
        } else {
          loginBtn.disabled = false;
          loginBtn.textContent = "Login";
        }
      }
    }
    if (loginBtn) {
      loginBtn.onclick = login;
      debugLog('loginBtn.onclick set');
    } else {
      debugLog('loginBtn not found');
    }
    if (logoutBtn) {
      logoutBtn.onclick = logout;
      debugLog('logoutBtn.onclick set');
    } else {
      debugLog('logoutBtn not found');
    }
    // Only call updateUI if all elements exist
    if (loginBtn && logoutBtn && userGreeting) {
      updateUI();
    }
    // Also update on page load and after navigation
    window.addEventListener('focus', updateUI);
    window.addEventListener('pageshow', updateUI);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindAuthButtons);
  } else {
    bindAuthButtons();
  }
  window.bindAuthButtons = bindAuthButtons;
  // Expose for other scripts if needed
  window.login = login;
  window.logout = logout;
  window.getAccount = getAccount;

  // Listen for MSAL events to update UI on auth state changes
  if (msalInstance && typeof msalInstance.addEventCallback === 'function') {
    msalInstance.addEventCallback((event) => {
      debugLog('MSAL event:', event);
      if (event.eventType === 'msal:loginSuccess' || event.eventType === 'msal:acquireTokenSuccess' || event.eventType === 'msal:logoutSuccess') {
        setTimeout(() => { bindAuthButtons(); }, 100); // update UI after state change
      } else if (event.eventType === 'msal:loginFailure' || event.eventType === 'msal:acquireTokenFailure' || event.eventType === 'msal:logoutFailure') {
        if (typeof showBanner === 'function') {
          showBanner({
            message: 'Authentication error: ' + (event.error?.message || event.error || 'Unknown error'),
            type: 'error',
            duration: 6000
          });
        }
      }
    });
  }
}

// Ensure MSAL is loaded before calling initAuth
if (window.msal && typeof msal.PublicClientApplication === 'function') {
  initAuth();
} else {
  window.addEventListener('DOMContentLoaded', function() {
    if (window.msal && typeof msal.PublicClientApplication === 'function') {
      initAuth();
    } else {
      debugLog('MSAL library not loaded');
    }
  });
}

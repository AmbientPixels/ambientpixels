// /auth/authUI.js
// Unified global authentication logic for AmbientPixels using MSAL.js (Microsoft Entra External ID)

// MSAL interaction_in_progress bug workaround: clear stuck flag if not in redirect
(function() {
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
  function login() {
    debugLog("Login button clicked");
    if (isInteractionInProgress()) {
      debugLog("Login aborted: interaction already in progress.");
      const loginBtn = document.getElementById("login-btn");
      if (loginBtn) loginBtn.disabled = true;
      return;
    } else {
      const loginBtn = document.getElementById("login-btn");
      if (loginBtn) loginBtn.disabled = false;
    }
    try {
      msalInstance.loginRedirect({
        scopes: ["openid", "profile", "email"]
      });
    } catch (e) {
      debugLog('loginRedirect error:', e);
      if (typeof showBanner === 'function') {
        showBanner({ message: 'Login failed: ' + (e.message || e), type: 'error', duration: 6000 });
      } else {
        alert('Login error: ' + e.message);
      }
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
    const logoutBtn = document.getElementById("logout-btn");
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

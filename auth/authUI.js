// /auth/authUI.js
// Unified global authentication logic for AmbientPixels using MSAL.js (Microsoft Entra External ID)

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
      redirectUri: window.location.origin + "/",
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
      alert('Login error: ' + e.message);
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
      alert('Logout error: ' + e.message);
    }
  }
  function bindAuthButtons() {
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const userGreeting = document.getElementById("user-greeting");
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

  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindAuthButtons);
  } else {
    bindAuthButtons();
  }
  // Expose for other scripts if needed
  window.login = login;
  window.logout = logout;
  window.getAccount = getAccount;
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

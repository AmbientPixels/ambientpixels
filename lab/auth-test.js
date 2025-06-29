// /lab/auth-test.js
// Isolated authentication logic for CSP-safe loading

function debugLog(...args) {
  if (window.DEBUG_AUTH || localStorage.getItem('DEBUG_AUTH') === 'true') console.log("[AUTH]", ...args);
}

function initAuth() {
  debugLog("MSAL config loaded");
  // MSAL config
  const msalConfig = {
    auth: {
      clientId: "cc50167c-846e-4ed2-b4fe-48ab831615d2",
      authority: "https://login.microsoftonline.com/0450b3ca-5138-4391-9c98-bda7ad24118f/oauth2/v2.0/authorize?p=SignUpSignIn",
      // For production/live authentication only:
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
  } catch (e) {
    debugLog('MSAL instance creation failed:', e);
    alert('MSAL instance creation failed: ' + e.message);
    return;
  }
  function getAccount() {
    const accounts = msalInstance.getAllAccounts();
    debugLog("Accounts found:", accounts);
    return accounts.length > 0 ? accounts[0] : null;
  }
  function login() {
    debugLog("Login button clicked");
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
        postLogoutRedirectUri: msalConfig.auth.redirectUri,
      });
    } catch (e) {
      debugLog('logoutRedirect error:', e);
      alert('Logout error: ' + e.message);
    }
  }
  document.addEventListener("DOMContentLoaded", function() {
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const userGreeting = document.getElementById("user-greeting");
    debugLog('Binding button events:', {loginBtn, logoutBtn, userGreeting});
    function updateUI() {
      const user = getAccount();
      debugLog('updateUI user:', user);
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
    updateUI();
  });
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

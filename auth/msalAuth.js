// /auth/msalAuth.js
// /auth/msalAuth.js (UMD build, global msal)
// msalConfig definition (if not imported)

function debugLog(...args) {
  if (window.DEBUG_AUTH) {
    console.log(...args);
  }
}

debugLog("MSAL config loaded");
const msalConfig = {
  auth: {
    clientId: "cc50167c-846e-4ed2-b4fe-48ab831615d2",
    authority: "https://login.microsoftonline.com/0450b3ca-5138-4391-9c98-bda7ad24118f",
    // For production/live authentication only:
    redirectUri: window.location.origin + "/",
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

debugLog("redirectUri:", msalConfig.auth.redirectUri);
const msalInstance = new msal.PublicClientApplication(msalConfig);

window.login = function() {
  debugLog("Login button clicked");
  msalInstance.loginRedirect({
    scopes: ["openid", "profile", "email"],
    authority: msalConfig.auth.authority + "/oauth2/v2.0/authorize?p=SignUpSignIn",
  });
};

window.logout = function() {
  debugLog("Logout button clicked");
  msalInstance.logoutRedirect({
    postLogoutRedirectUri: msalConfig.auth.redirectUri,
  });
};

window.getAccount = function() {
  const accounts = msalInstance.getAllAccounts();
  debugLog("Accounts found:", accounts);
  return accounts.length > 0 ? accounts[0] : null;
};

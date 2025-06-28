// /auth/authConfig.js
export function debugLog(...args) {
  if (window.DEBUG_AUTH) console.log("[AUTH]", ...args);
}
debugLog("MSAL config loaded");
debugLog("redirectUri:", msalConfig.auth.redirectUri);
const msalConfig = {
  auth: {
    clientId: "cc50167c-846e-4ed2-b4fe-48ab831615d2", // Entra App (client) ID
    authority: "https://login.microsoftonline.com/0450b3ca-5138-4391-9c98-bda7ad24118f", // Entra Directory (tenant) ID
    // For production/live authentication only:
    redirectUri: window.location.origin + "/", // Local dev URI
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

// /auth/authConfig.js
function debugLog(...args) {
  if (window.DEBUG_AUTH) console.log("[AUTH]", ...args);
}
// updated by Cascade: removed 'export' keyword for browser compatibility
// MSAL config for Microsoft Entra External ID (AmbientPixels)
const msalConfig = {
  auth: {
    clientId: "043b76d8-143d-45e8-9481-5097c508b14e", // Entra External ID App (client) ID
    authority: "https://ambientpixelsai.ciamlogin.com/e1b17060-5ec1-49f8-b981-d3ae7207e25d", // Base authority URL from Azure portal
    knownAuthorities: ["ambientpixelsai.ciamlogin.com"],
    authorityMetadata: {
      "token_endpoint": "https://ambientpixelsai.ciamlogin.com/e1b17060-5ec1-49f8-b981-d3ae7207e25d/oauth2/v2.0/token",
      "authorization_endpoint": "https://ambientpixelsai.ciamlogin.com/e1b17060-5ec1-49f8-b981-d3ae7207e25d/oauth2/v2.0/authorize",
      "end_session_endpoint": "https://ambientpixelsai.ciamlogin.com/e1b17060-5ec1-49f8-b981-d3ae7207e25d/oauth2/v2.0/logout"
    },
    redirectUri: "https://ambientpixels.ai/", // Production/live domain
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

// Expose msalConfig to the global window object
window.msalConfig = msalConfig;

debugLog("MSAL config loaded");
debugLog("redirectUri:", msalConfig.auth.redirectUri);
// updated by Cascade: fixed msalConfig duplication and lint errors

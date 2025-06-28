// /auth/authConfig.js
export function debugLog(...args) {
  if (window.DEBUG_AUTH) console.log("[AUTH]", ...args);
}
debugLog("MSAL config loaded");
debugLog("redirectUri:", msalConfig.auth.redirectUri);
// MSAL config for Microsoft Entra External ID (AmbientPixels)
const msalConfig = {
  auth: {
    clientId: "043b76d8-143d-45e8-9481-5097c508b14e", // Entra External ID App (client) ID
    authority: "https://ambientpixelsai.ciamlogin.com/e1b17060-5ec1-49f8-b981-d3ae7207e25d/SignUpSignIn2025", // User journey: SignUpSignIn2025
    redirectUri: "https://ambientpixels.ai/", // Production/live domain
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

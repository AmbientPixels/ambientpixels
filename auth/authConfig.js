// /auth/authConfig.jsMigrate authentication to Microsoft Entra External ID

- Updated MSAL config in authConfig.js and authUI.js to use new Entra tenant, app (client) ID, and user journey (SignUpSignIn2025)
- Removed all legacy Azure AD B2C values and references
- Ensured robust, accessible login/logout UI in header.html and index.html
- Verified modular, secure, and industry-standard authentication flow
- Documentation and comments updated for clarity and maintainability

This commit completes the transition to Entra External ID for consumer authentication, ensuring future-proof, scalable login flows for AmbientPixels.
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

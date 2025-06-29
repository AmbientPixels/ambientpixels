# 🛡️ AmbientPixels Global Authentication – Onboarding & AI Training Guide

<!--
Last updated: 2025-06-28 by Cascade AI
Contact: winds.dev@ambientpixels.ai
-->

> **Deprecation Notice:**
> As of May 1, 2025, Microsoft Microsoft Entra External ID is no longer available for new tenants. All new authentication projects must use **Microsoft Entra External ID**. Existing B2C tenants are still supported, but new development and onboarding should use Entra External ID. This guide has been updated accordingly.

## 🚀 Quick Start (Entra External ID)
1. Clone the repo and open in your editor.
2. Ensure `/auth/msal-browser.min.js`, `/auth/global-auth.js`, `/auth/authConfig.js`, and `/auth/authUI.js` are present.
3. Register your app and redirect URIs in the **Microsoft Entra External ID** portal (see config below).
4. **Include the authentication script tags in every page's HTML _before_ the header injection script.**
5. The site header (with login/logout buttons) is injected via JS (`init-header-footer.js`). Button event handlers are bound automatically by `authUI.js` after header injection.
6. Open `/auth/auth-test.html` or the main site and test login/logout. Check browser console for `[AUTH]` logs.

---

## 🌐 Microsoft Entra External ID – App Registration Details

**Display name:**  
AmbientPixels Web

**Application (client) ID:**  
043b76d8-143d-45e8-9481-5097c508b14e

**Directory (tenant) ID:**  
e1b17060-5ec1-49f8-b981-d3ae7207e25d

**Supported account types:**  
My organization only (AmbientPixels External ID tenant)

**Redirect URIs:**  
- https://ambientpixels.ai/

---

### Sample `authConfig.js` for MSAL.js
```js
const msalConfig = {
  auth: {
    clientId: "043b76d8-143d-45e8-9481-5097c508b14e",
    authority: "https://ambientpixelsai.ciamlogin.com/e1b17060-5ec1-49f8-b981-d3ae7207e25d/v2.0/", // Base authority URL with v2.0 endpoint
    redirectUri: "https://ambientpixels.ai/",
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

// Expose msalConfig to the global window object
window.msalConfig = msalConfig;
```

---

### Next Steps

1. **Configure Identity Providers:**
   - In the Entra External ID portal, go to Identity > External Identities > All identity providers.
   - Add Microsoft, Google, Facebook, or other providers as needed.
2. **Create a User Journey (User Flow):**
   - Go to Identity > External Identities > User journeys.
   - Create a new journey named **ambientpixelslogin** (case-sensitive) and enable the desired providers.
   - Copy the user journey name exactly as shown in Azure for your MSAL config.
3. **Test Authentication:**
   - Deploy your updated config and test login/signup flows.

---

## Minimal Example HTML (for local test only)
> **Production Note:**  
> In production, login/logout buttons are included in the injected header. Do not add duplicate buttons to your main HTML.  
> Button event handlers are attached by `authUI.js` after header injection—no need for inline `onclick` attributes.
> **IMPORTANT:** Authentication scripts MUST be loaded BEFORE the header injection script to ensure proper button functionality.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AmbientPixels Auth Example</title>
  <!-- Authentication scripts must be loaded first -->
  <script src="/auth/msal-browser.min.js"></script>
  <script src="/auth/authConfig.js"></script>
  <script src="/auth/authUI.js"></script>
  <!-- Header injection script loads after auth scripts -->
  <script src="/js/init-header-footer.js" defer></script>
</head>
<body>
  <!-- Header will be injected here -->
  <header id="nav-header"></header>
  <!-- Main content -->
</body>
</html>
```
<!-- updated by Cascade: Minimal HTML snippet with correct script loading order -->

---

## Authentication Flow & UI Binding

> **Note:**
> For legacy B2C tenants, follow the previous onboarding steps below. For all new projects, use Entra External ID setup as described above.


- The login and logout buttons are part of the header module (`modules/header.html`), injected into each page by `init-header-footer.js`.
- `authUI.js` exposes `bindAuthButtons()` which is called after header injection to attach event handlers and update UI state.
- No inline event handlers or duplicate buttons should be added to page HTML.

---

## Security & Compliance

- **No secrets or sensitive info** are present in frontend code.
- **All scripts are external**; no inline JS or inline event handlers (CSP-compliant).
- **Redirect URI** is hardcoded to the production domain in MSAL config for security.
- **HTTPS is required** for all authentication flows.
- **Tokens** are managed by MSAL.js and stored in `localStorage`.

---

## Testing & Debugging

- Test login/logout on any page; the login prompt should appear in the same tab on first click.
- After login, the UI updates to show the user greeting and logout button.
- To enable debug logs, run in the browser console:
  ```js
  localStorage.setItem('DEBUG_AUTH', 'true');
  ```
- Check the browser console for `[AUTH]` logs.
- If you encounter issues, clear browser cache/localStorage and retry.

---

## Auth Flow Diagram
```
User
 │
 │ clicks Login
 ▼
[login() / MSAL.js]
 │
 │ loginRedirect
 ▼
[Azure Entra External ID (B2C)]
 │
 │ user authenticates
 ▼
[redirectUri]
 │
 │ MSAL handles tokens
 ▼
AmbientPixels App (session starts)
```
<!-- updated by Cascade: Simple ASCII diagram -->

---

## Troubleshooting Table
| Error                                 | Cause                                         | Fix                                                      |
|---------------------------------------|-----------------------------------------------|----------------------------------------------------------|
| uninitialized_public_client_application| Did not await msalInstance.initialize()       | Always await initialize() before calling MSAL APIs        |
| CSP/blocked script errors             | Inline JS or untrusted scripts                | Move all JS to external files, self-host MSAL.js          |
| 404 on MSAL.js                        | CDN or wrong path                             | Always self-host msal-browser.min.js in /auth/            |
| Login fails, no redirect              | Redirect URI not registered in Azure          | Add all URIs to Azure portal app registration             |
| Stuck login state                     | MSAL interaction_in_progress bug              | Use provided workaround in authUI.js                      |
| No [AUTH] logs                        | Debug logging not enabled                     | Run localStorage.setItem('DEBUG_AUTH', 'true') in console |
| endpoints_resolution_error            | Incorrect authority URL format                | Ensure authority URL includes `/v2.0/` segment           |
| CORS errors on authentication         | Double `/v2.0/` in authority URL              | Use correct format: `https://<tenant>.ciamlogin.com/<tenant_id>/v2.0/` |
| Identifier has already been declared  | Multiple loads of nova-whispers.js            | Use IIFE pattern with initialization guard               |
| Login/logout buttons not working      | Incorrect script loading order                | Load auth scripts BEFORE header injection script          |
| Logout button not appearing           | Auth scripts loaded after header injection    | Ensure auth scripts are loaded before init-header-footer.js |

---

## Glossary
- **MSAL:** Microsoft Authentication Library for JS
- **Authority:** Azure endpoint for authentication (includes tenant & user flow)
- **Redirect URI:** Where Azure sends users after login/logout
- **User Flow:** Predefined Microsoft Entra External ID authentication journey (e.g., ambientpixelslogin)
- **CSP:** Content Security Policy (browser security, blocks inline JS)
- **SSO:** Single Sign-On

---

## Overview
AmbientPixels uses Microsoft Entra External ID with MSAL.js for unified, secure authentication across all modules and user flows. This system supports SSO, multiple identity providers, and is designed for CSP compliance and modular global integration.

---

## 1. System Architecture & Flow
- **Frontend:** Static HTML/JS/CSS, no build tools required
- **Auth Logic:** Modularized in `/auth/global-auth.js` (rename/move as needed for production)
- **Library:** Self-hosted `msal-browser.min.js` (avoid CDN reliability issues)
- **Config:** All MSAL config (clientId, authority, redirectUri, etc.) is in `global-auth.js`
- **User Flow:**
  1. User clicks Login → triggers MSAL loginRedirect
  2. Redirects to Entra External ID user flow (ambientpixelslogin)
  3. On success, user is returned to `redirectUri` (must be registered in Azure)
  4. Session/account state is managed via MSAL and localStorage
  5. Logout triggers MSAL logoutRedirect and cleans up session

---

## 2. File & Module Locations
- **/auth/authUI.js** – Main authentication logic (modular, CSP-compliant, Entra External ID)
- **/auth/msal-browser.min.js** – Self-hosted MSAL.js library
- **/auth/auth-test.html** – Test page for isolated auth flow validation
- **/auth/authConfig.js** – Authentication configuration (client ID, authority, redirect URI) isolated for modularity and easy reuse
- **/auth/authUI.js** – UI and global authentication logic for MSAL.js, handles login/logout flows and interaction bug fixes
- **/auth/msal-browser.min.js** – Self-hosted MSAL.js library (required for Entra External ID)
- **/css/** – Uses existing Nova/ambient global theme tokens for styling
- **/docs/logs/global-auth-azure-ad-Entra External ID.md** – This documentation and project log

---

## 3. Configuration & Best Practices
- **MSAL Config:**
  - Always embed the user flow name (e.g., `ambientpixelslogin`) in the `authority` URL
  - Use `window.location.origin + "/"` for `redirectUri` to support both local and live
  - Register all possible redirect URIs in the Azure portal
  - Never hardcode secrets or sensitive info in frontend code
- **CSP Compliance:**
  - No inline JS – all logic in external files
  - Only reference trusted, self-hosted script sources
- **Naming:**
  - Use lowercase, kebab-case for all new modules/scripts
  - Scope new logic under `/lab/`, `/modules/`, or `/nova/` as appropriate
- **Styling:**
  - Use existing Nova/ambient CSS tokens (`--aura-*`, etc.)
  - Never use inline styles unless explicitly approved (Windsurf Rule #1)

---

## 4. Debugging & Troubleshooting
- **Enable persistent debug logging:**
  - In browser console: `localStorage.setItem('DEBUG_AUTH', 'true')`
  - Logs will appear on every page load and button click
  - To disable: `localStorage.removeItem('DEBUG_AUTH')`
- **Common errors:**
  - `uninitialized_public_client_application` – Call and await `msalInstance.initialize()` before any MSAL API usage (required for MSAL.js v3+)
  - CSP/blocked script errors – Ensure all JS is external, not inline
  - 404 on MSAL.js – Always self-host, do not rely on CDN
- **Testing:**
  - Use `/auth/auth-test.html` for isolated flow validation before global rollout
  - Check Network tab for script load errors
  - Use `[AUTH]` logs to trace flow and button bindings

---

## 5. Onboarding Steps for Developers & AI Agents
1. **Read this document and review `/auth/global-auth.js`**
2. **Verify MSAL.js and global-auth.js are loaded in your HTML in this order:**
   ```html
   <script src="/auth/msal-browser.min.js"></script>
   <script src="/auth/global-auth.js"></script>
   ```
3. **Set up Azure app registration:**
   - Register app in Microsoft Entra External ID portal
   - Add all redirect URIs (local, staging, production)
   - Configure user flows (ambientpixelslogin, etc.)
4. **Test the login/logout flow using `/auth/auth-test.html`**
5. **Integrate logic into global navigation or modules as needed**
6. **Keep all logic modular and CSP-compliant**

---

## 6. Common Pitfalls & How to Avoid Them
- **Inline JS:** Will be blocked by CSP on live; always use external scripts
- **Forgot to await `initialize()`:** Required for MSAL.js v3+; otherwise, login will fail
- **Missing redirect URI:** Must be registered in Azure or login will error
- **CDN/MSAL.js 404:** Always self-host MSAL.js
- **Duplicate CSS/JS:** Always check for existing modules before creating new ones (Windsurf Rule #1)

---

## 7. Extending & Integrating Globally
- Move `/auth/global-auth.js` to `/modules/` or `/nova/` for production/global use
- Import and call `initAuth()` in your main layout or navigation
- Use global CSS tokens for styling any new UI elements
- For multi-provider support, extend MSAL config and Azure user flows
- Document any changes in this log for future devs and AI agents

---

## 8. Key References
- **Azure Portal:** [Microsoft Entra External ID Portal](https://entra.microsoft.com/)
- **MSAL.js Docs:** [MSAL.js Browser Docs](https://learn.microsoft.com/en-us/azure/active-directory/develop/msal-overview)
- **AmbientPixels Config Files:**
  - `/auth/global-auth.js` – Auth logic
  - `/auth/msal-browser.min.js` – Library
  - `/data/identity-core.json` – (if used for user mapping)
  - `/docs/logs/global-auth-azure-ad-Entra External ID.md` – This documentation

---

# 🌐 Global Microsoft Entra External ID Authentication

## Project Overview
Implement a unified authentication and user identity system for AmbientPixels using Microsoft Entra External ID. This will provide single sign-on (SSO) across all site modules (Card Forge, Pixel Forge, etc.), supporting multiple identity providers and future user personalization.

---

## Goals
- Centralize user authentication for the entire AmbientPixels ecosystem
- Support SSO and seamless access across all modules
- Enable login with Microsoft, Google, GitHub, and email/password
- Prepare for secure, per-user data storage and profile management

---

## Status
**Phase:** Platform Shift (Microsoft Entra External ID → Microsoft Entra External ID)  
**Created:** 2025-06-27  
**Lead:** Cascade (with Nova oversight)

---

> **⚠️ Platform Update (2025-06-27):**
> As of May 1, 2025, Microsoft Entra External ID is no longer available for new tenants. Microsoft now recommends all new external identity projects use **Microsoft Entra External ID**. This project will migrate to Entra External ID for all authentication and user management features.
>
> - [Entra External ID Overview](https://aka.ms/EEIDOverview)
> - [FAQ for Customers](https://learn.microsoft.com/en-us/entra/external-id/customers/faq-customers)

---

## Next Steps (Entra External ID)
1. Review Microsoft Entra External ID documentation and architecture
2. Register AmbientPixels as an Entra External ID application
3. Configure user flows (ambientpixelslogin, etc.) in Entra
4. Add login/logout UI to global site navigation
5. Integrate Entra External ID with frontend authentication
6. Propagate user state to all modules

---

## References
- [Microsoft Entra External ID Documentation](https://learn.microsoft.com/en-us/azure/active-directory-Entra External ID/)
- [MSAL.js Library](https://github.com/AzureAD/microsoft-authentication-library-for-js)

---

## Log

### 2025-06-27: Microsoft Entra External ID Tenant Created
- **Organization name:** ambientpixels auth
- **Initial domain name:** ambientpixels.onmicrosoft.com
- **Country/Region:** United States
- **Resource group:** ambientpixelsV2
- **Reference:** [Microsoft Docs – Create a B2C tenant](https://learn.microsoft.com/en-us/azure/active-directory-Entra External ID/tutorial-create-tenant)

Tenant successfully created and switched to in Azure Portal.

---

### 2025-06-27: AmbientPixels Web App Registered in Microsoft Entra External ID
- **Display name:** AmbientPixels Web
- **Application (client) ID:** 043b76d8-143d-45e8-9481-5097c508b14e
- **Directory (tenant) ID:** e1b17060-5ec1-49f8-b981-d3ae7207e25d
- **Supported account types:** My organization only

---

## ✅ 2025-06-28: Production-Ready Authentication – Final Code Review & Checklist

### Summary
- All Azure Entra External ID (B2C) settings are aligned with code.
- User flow `ambientpixelslogin` is active and case-correct.
- App registration, client ID, and tenant ID match code and portal.
- Redirect URI `https://ambientpixels.ai/` is registered for SPA and Web.
- All frontend auth scripts are loaded at the end of `<body>` in `index.html`.
- No secrets or sensitive data in frontend code. No inline JS for auth.
- Header and login/logout UI are injected via JS; no duplicate buttons in HTML.
- OpenID config endpoint returns valid JSON; authority URL is for MSAL only (not for direct navigation).
- MSAL authority URL correctly includes `/v2.0/` segment without duplicating it.
- `msalConfig` is properly exposed to the global window object.
- `nova-whispers.js` uses a robust IIFE pattern with initialization guard to prevent duplicate declarations.

### Authority vs. OpenID Endpoint
- **Authority URL:** Used by MSAL.js and OpenID clients for authentication flow. Not meant for direct browser navigation.
- **OpenID Configuration Endpoint:** Used for debugging/discovery. Returns JSON at:
  `https://ambientpixelsai.ciamlogin.com/e1b17060-5ec1-49f8-b981-d3ae7207e25d/ambientpixelslogin/v2.0/.well-known/openid-configuration`

### Ready-to-Commit Checklist
- [x] Azure user flow and app registration confirmed
- [x] `authConfig.js` and `authUI.js` match Azure settings
- [x] All scripts loaded externally in `index.html`
- [x] No inline JS or duplicate login/logout buttons
- [x] Documentation updated with troubleshooting and best practices
- [x] Live test and onboarding checklist complete

---

### Script Loading & Multi-Page Best Practices

#### nova-whispers.js Module Pattern
The `nova-whispers.js` script uses a robust singleton pattern to prevent duplicate declarations when loaded across multiple pages or contexts:

```js
// nova-whispers.js
// Updated by Cascade: Implemented robust module pattern to prevent duplicate declarations

(function() {
  // Only initialize once
  if (window.novaWhispersInitialized) {
    return;
  }
  
  // Mark as initialized
  window.novaWhispersInitialized = true;
  
  // Define whisper sets only if not already defined
  window.whisperSets = window.whisperSets || {
    // whisper sets here
  };

  // All functions properly scoped inside the IIFE
  function rotateWhispers(targetId, context) {
    // implementation
  }

  function initWhispers() {
    // implementation
  }

  // Initialize on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWhispers);
  } else {
    initWhispers();
  }
})(); // Close the IIFE
```

#### Best Practices for Script Loading
- **Use IIFE Pattern**: Wrap scripts in Immediately Invoked Function Expressions to avoid polluting the global namespace
- **Implement Guards**: Use initialization flags (e.g., `window.novaWhispersInitialized`) to prevent duplicate execution
- **Expose Selectively**: Only expose what's needed to the global scope (e.g., `window.whisperSets`)
- **Proper Scoping**: Keep functions and variables inside the IIFE to prevent conflicts
- **DOM Ready Check**: Use `document.readyState` to safely initialize DOM-dependent code

#### Authority URL Format for Microsoft Entra External ID
The correct format for the authority URL in MSAL configuration is:
```
https://<tenant-name>.ciamlogin.com/<tenant_id>/v2.0/
```

Important notes:
- The `/v2.0/` segment is required for Microsoft Entra External ID to use the OpenID Connect v2.0 protocol endpoints
- Do not include the user flow name in the authority URL - this is handled by MSAL internally
- Ensure `msalConfig` is exposed globally via `window.msalConfig = msalConfig;` for proper initialization

#### Authentication System: Future Improvements
The following improvements are recommended for future development once the basic login/logout functionality is stable:

1. **Token Refresh Logic**: Implement automatic token refresh for long-running sessions to prevent session timeouts
   ```js
   // Example token refresh implementation
   function setupTokenRefresh(tokenExpiryTime) {
     const refreshBuffer = 5 * 60 * 1000; // 5 minutes before expiry
     const refreshTime = tokenExpiryTime - refreshBuffer;
     setTimeout(() => {
       msalInstance.acquireTokenSilent({...});
     }, refreshTime);
   }
   ```

2. **Enhanced Caching Strategy**: Optimize token caching for better performance
   ```js
   // In authConfig.js
   const msalConfig = {
     cache: {
       cacheLocation: "localStorage",
       storeAuthStateInCookie: true, // Enable for IE/Edge
       secureCookies: true
     }
   };
   ```

3. **Robust Error Recovery**: Add more detailed error handling and recovery mechanisms
   ```js
   try {
     await msalInstance.handleRedirectPromise();
   } catch (error) {
     if (error instanceof msal.InteractionRequiredAuthError) {
       // Specific handling for interaction required
     } else if (error instanceof msal.ServerError) {
       // Handle server errors
     } else {
       // Generic error handling
     }
   }
   ```

4. **User Profile Enhancement**: Expand user profile information display
5. **Logout Confirmation**: Add a confirmation dialog before logout for better UX
6. **Session Timeout Notification**: Implement a notification system for impending session timeouts
7. **Multi-Tab Support**: Improve handling of authentication across multiple browser tabs using the Storage event

---
<!-- updated by Cascade: Final code review, authority/OpenID clarification, and commit checklist added 2025-06-28 -->
- **Redirect URIs:** 1 web (http://localhost:3000/), 0 spa, 0 public client

---

### 2025-06-27: ambientpixelslogin User Flow Created in Microsoft Entra External ID
- **User flow name:** ambientpixelslogin
- **Identity provider:** Email with password (local accounts)
- **User attributes collected:** Given Name, Surname, Email

---

## Migration Note
This project was migrated from Azure AD B2C to Microsoft Entra External ID on 2025-06-27. All references to Azure AD B2C and 'SignUpSignIn' have been updated to use Entra External ID and 'ambientpixelslogin' respectively.
- **Display name:** AmbientPixels Web
- **Application (client) ID:** 40d939e3-1ce0-45c3-9562-c1acfaf0aa92
- **Directory (tenant) ID:** 96bfe658-4094-4192-88f8-5b0874471c7e
- **Supported account types:** My organization only
- **Redirect URIs:** (to be updated after adding web URI)

---

## Log
- **2025-06-27:** Project initialized, planning phase started.

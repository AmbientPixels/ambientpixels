# 🛡️ AmbientPixels Global Authentication – Onboarding & AI Training Guide

<!--
Last updated: 2025-06-28 by Cascade AI
Contact: winds.dev@ambientpixels.ai
-->

> **Deprecation Notice:**
> As of May 1, 2025, Microsoft Azure AD B2C is no longer available for new tenants. All new authentication projects must use **Microsoft Entra External ID**. Existing B2C tenants are still supported, but new development and onboarding should use Entra External ID. This guide has been updated accordingly.

## 🚀 Quick Start (Entra External ID)
1. Clone the repo and open in your editor.
2. Ensure `/auth/msal-browser.min.js`, `/auth/global-auth.js`, `/auth/authConfig.js`, and `/auth/authUI.js` are present.
3. Register your app and redirect URIs in the **Microsoft Entra External ID** portal (see config below).
4. **Include the script tags below in every page’s HTML _before_ any login buttons or header injection.**
5. The site header (with login/logout buttons) is injected via JS (`init-header-footer.js`). Button event handlers are bound automatically by `authUI.js` after header injection.
6. Open `/auth/auth-test.html` or the main site and test login/logout. Check browser console for `[AUTH]` logs.

---

## Minimal Example HTML (for local test only)
> **Production Note:**  
> In production, login/logout buttons are included in the injected header. Do not add duplicate buttons to your main HTML.  
> Button event handlers are attached by `authUI.js` after header injection—no need for inline `onclick` attributes.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AmbientPixels Auth Example</title>
  <script src="/auth/msal-browser.min.js"></script>
  <script src="/auth/authConfig.js"></script>
  <script src="/auth/authUI.js"></script>
  <script src="/js/init-header-footer.js"></script>
</head>
<body>
  <!-- Header will be injected here -->
  <header id="nav-header"></header>
  <!-- Main content -->
</body>
</html>
```
<!-- updated by Cascade: Minimal HTML snippet for onboarding and header injection -->

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

---

## Glossary
- **MSAL:** Microsoft Authentication Library for JS
- **Authority:** Azure endpoint for authentication (includes tenant & user flow)
- **Redirect URI:** Where Azure sends users after login/logout
- **User Flow:** Predefined Azure B2C authentication journey (e.g., SignUpSignIn)
- **CSP:** Content Security Policy (browser security, blocks inline JS)
- **SSO:** Single Sign-On

---

## Overview
AmbientPixels uses Microsoft Entra External ID (formerly Azure AD B2C) with MSAL.js for unified, secure authentication across all modules and user flows. This system supports SSO, multiple identity providers, and is designed for CSP compliance and modular global integration.

---

## 1. System Architecture & Flow
- **Frontend:** Static HTML/JS/CSS, no build tools required
- **Auth Logic:** Modularized in `/auth/global-auth.js  /* updated by Cascade: migrated from /lab/ */` (rename/move as needed for production)
- **Library:** Self-hosted `msal-browser.min.js` (avoid CDN reliability issues)
- **Config:** All MSAL config (clientId, authority, redirectUri, etc.) is in `global-auth.js`
- **User Flow:**
  1. User clicks Login → triggers MSAL loginRedirect
  2. Redirects to Entra External ID user flow (SignUpSignIn)
  3. On success, user is returned to `redirectUri` (must be registered in Azure)
  4. Session/account state is managed via MSAL and localStorage
  5. Logout triggers MSAL logoutRedirect and cleans up session

---

## 2. File & Module Locations
- **/auth/global-auth.js  /* updated by Cascade: migrated from /lab/ */** – Main authentication logic (modular, CSP-compliant)
- **/auth/msal-browser.min.js** – Self-hosted MSAL.js library
- **/auth/auth-test.html  /* updated by Cascade: migrated from /lab/ */** – Test page for isolated auth flow validation
- **/auth/authConfig.js** – Authentication configuration (client ID, authority, redirect URI) isolated for modularity and easy reuse
- **/auth/authUI.js** – UI and global authentication logic for MSAL.js, handles login/logout flows and interaction bug fixes
- **/auth/msalAuth.js** – UMD build for exposing global login/logout functions, useful for legacy or framework-agnostic integration
- **/css/** – Uses existing Nova/ambient global theme tokens for styling
- **/docs/logs/global-auth-azure-ad-b2c.md** – This documentation and project log

<!-- updated by Cascade: rationale for multiple JS files -->
> **Note:** Multiple JavaScript files are used in `/auth/` to ensure separation of concerns, modularity, and maintainability. 
> - `authConfig.js` isolates configuration for easy updates and reuse.
> - `authUI.js` handles UI logic and MSAL integration.
> - `msalAuth.js` provides global login/logout functions for legacy or global use.
> - `msal-browser.min.js` is the self-hosted MSAL library.
> This structure is CSP-compliant, prevents code duplication, and makes the system easier to maintain and extend.

---

## 3. Configuration & Best Practices
- **MSAL Config:**
  - Always embed the user flow name (e.g., `SignUpSignIn`) in the `authority` URL
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
  - Use `/auth/auth-test.html  /* updated by Cascade: migrated from /lab/ */` for isolated flow validation before global rollout
  - Check Network tab for script load errors
  - Use `[AUTH]` logs to trace flow and button bindings

---

## 5. Onboarding Steps for Developers & AI Agents
1. **Read this document and review `/auth/global-auth.js  /* updated by Cascade: migrated from /lab/ */`**
2. **Verify MSAL.js and global-auth.js are loaded in your HTML in this order:**
   ```html
   <script src="/auth/msal-browser.min.js"></script>
   <script src="/auth/global-auth.js  /* updated by Cascade: migrated from /lab/ */"></script>
   ```
3. **Set up Azure app registration:**
   - Register app in Microsoft Entra External ID portal
   - Add all redirect URIs (local, staging, production)
   - Configure user flows (SignUpSignIn, etc.)
4. **Test the login/logout flow using `/auth/auth-test.html  /* updated by Cascade: migrated from /lab/ */`**
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
- Move `/auth/global-auth.js  /* updated by Cascade: migrated from /lab/ */` to `/modules/` or `/nova/` for production/global use
- Import and call `initAuth()` in your main layout or navigation
- Use global CSS tokens for styling any new UI elements
- For multi-provider support, extend MSAL config and Azure user flows
- Document any changes in this log for future devs and AI agents

---

## 8. Key References
- **Azure Portal:** [Microsoft Entra External ID Portal](https://entra.microsoft.com/)
- **MSAL.js Docs:** [MSAL.js Browser Docs](https://learn.microsoft.com/en-us/azure/active-directory/develop/msal-overview)
- **AmbientPixels Config Files:**
  - `/auth/global-auth.js  /* updated by Cascade: migrated from /lab/ */` – Auth logic
  - `/auth/msal-browser.min.js` – Library
  - `/data/identity-core.json` – (if used for user mapping)
  - `/docs/logs/global-auth-azure-ad-b2c.md` – This documentation

---

# 🌐 Global Azure AD B2C Authentication

## Project Overview
Implement a unified authentication and user identity system for AmbientPixels using Azure AD B2C. This will provide single sign-on (SSO) across all site modules (Card Forge, Pixel Forge, etc.), supporting multiple identity providers and future user personalization.

---

## Goals
- Centralize user authentication for the entire AmbientPixels ecosystem
- Support SSO and seamless access across all modules
- Enable login with Microsoft, Google, GitHub, and email/password
- Prepare for secure, per-user data storage and profile management

---

## Status
**Phase:** Platform Shift (Azure AD B2C → Microsoft Entra External ID)  
**Created:** 2025-06-27  
**Lead:** Cascade (with Nova oversight)

---

> **⚠️ Platform Update (2025-06-27):**
> As of May 1, 2025, Azure AD B2C is no longer available for new tenants. Microsoft now recommends all new external identity projects use **Microsoft Entra External ID**. This project will migrate to Entra External ID for all authentication and user management features.
>
> - [Entra External ID Overview](https://aka.ms/EEIDOverview)
> - [FAQ for Customers](https://learn.microsoft.com/en-us/entra/external-id/customers/faq-customers)

--- nice

## Next Steps (Entra External ID)
1. Review Microsoft Entra External ID documentation and architecture
2. Register AmbientPixels as an Entra External ID application
3. Configure user flows (sign up/in, profile edit, password reset) in Entra
4. Add login/logout UI to global site navigation
5. Integrate Entra External ID with frontend authentication
6. Propagate user state to all modules

---

## References
- [Azure AD B2C Documentation](https://learn.microsoft.com/en-us/azure/active-directory-b2c/)
- [MSAL.js Library](https://github.com/AzureAD/microsoft-authentication-library-for-js)

---

## Log

### 2025-06-27: Azure AD B2C Tenant Created
- **Organization name:** ambientpixels auth
- **Initial domain name:** ambientpixels.onmicrosoft.com
- **Country/Region:** United States
- **Resource group:** ambientpixelsV2
- **Reference:** [Microsoft Docs – Create a B2C tenant](https://learn.microsoft.com/en-us/azure/active-directory-b2c/tutorial-create-tenant)

Tenant successfully created and switched to in Azure Portal.

---

### 2025-06-27: AmbientPixels Web App Registered in Microsoft Entra External ID
- **Display name:** AmbientPixels Web
- **Application (client) ID:** cc50167c-846e-4ed2-b4fe-48ab831615d2
- **Directory (tenant) ID:** 0450b3ca-5138-4391-9c98-bda7ad24118f
- **Supported account types:** My organization only
- **Redirect URIs:** 1 web (http://localhost:3000/), 0 spa, 0 public client

---

### 2025-06-27: SignUpSignIn User Flow Created in Microsoft Entra External ID
- **User flow name:** SignUpSignIn
- **Identity provider:** Email with password (local accounts)
- **User attributes collected:** Given Name, Surname, Email

---

### 2025-06-27: AmbientPixels Web App Registered in Azure AD B2C
- **Display name:** AmbientPixels Web
- **Application (client) ID:** 40d939e3-1ce0-45c3-9562-c1acfaf0aa92
- **Directory (tenant) ID:** 96bfe658-4094-4192-88f8-5b0874471c7e
- **Supported account types:** My organization only
- **Redirect URIs:** (to be updated after adding web URI)

---

## Log
- **2025-06-27:** Project initialized, planning phase started.

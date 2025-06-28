# 🛡️ AmbientPixels Global Authentication – Onboarding & AI Training Guide

## Overview
AmbientPixels uses Microsoft Entra External ID (formerly Azure AD B2C) with MSAL.js for unified, secure authentication across all modules and user flows. This system supports SSO, multiple identity providers, and is designed for CSP compliance and modular global integration.

---

## 1. System Architecture & Flow
- **Frontend:** Static HTML/JS/CSS, no build tools required
- **Auth Logic:** Modularized in `/lab/global-auth.js` (rename/move as needed for production)
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
- **/lab/global-auth.js** – Main authentication logic (modular, CSP-compliant)
- **/auth/msal-browser.min.js** – Self-hosted MSAL.js library
- **/lab/auth-test.html** – Test page for isolated auth flow validation
- **/css/** – Uses existing Nova/ambient global theme tokens for styling
- **/docs/logs/global-auth-azure-ad-b2c.md** – This documentation and project log

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
  - Use `/lab/auth-test.html` for isolated flow validation before global rollout
  - Check Network tab for script load errors
  - Use `[AUTH]` logs to trace flow and button bindings

---

## 5. Onboarding Steps for Developers & AI Agents
1. **Read this document and review `/lab/global-auth.js`**
2. **Verify MSAL.js and global-auth.js are loaded in your HTML in this order:**
   ```html
   <script src="/auth/msal-browser.min.js"></script>
   <script src="/lab/global-auth.js"></script>
   ```
3. **Set up Azure app registration:**
   - Register app in Microsoft Entra External ID portal
   - Add all redirect URIs (local, staging, production)
   - Configure user flows (SignUpSignIn, etc.)
4. **Test the login/logout flow using `/lab/auth-test.html`**
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
- Move `/lab/global-auth.js` to `/modules/` or `/nova/` for production/global use
- Import and call `initAuth()` in your main layout or navigation
- Use global CSS tokens for styling any new UI elements
- For multi-provider support, extend MSAL config and Azure user flows
- Document any changes in this log for future devs and AI agents

---

## 8. Key References
- **Azure Portal:** [Microsoft Entra External ID Portal](https://entra.microsoft.com/)
- **MSAL.js Docs:** [MSAL.js Browser Docs](https://learn.microsoft.com/en-us/azure/active-directory/develop/msal-overview)
- **AmbientPixels Config Files:**
  - `/lab/global-auth.js` – Auth logic
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

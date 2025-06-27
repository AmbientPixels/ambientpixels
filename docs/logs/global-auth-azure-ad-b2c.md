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
**Phase:** Planning  
**Created:** 2025-06-27  
**Lead:** Cascade (with Nova oversight)

---

## Initial Steps
1. Create Azure AD B2C tenant and register main AmbientPixels web app
2. Configure user flows (sign up/in, profile edit, password reset)
3. Add login/logout UI to global site navigation
4. Integrate MSAL.js for authentication
5. Propagate user state to all modules

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

### 2025-06-27: AmbientPixels Web App Registered in Azure AD B2C
- **Display name:** AmbientPixels Web
- **Application (client) ID:** 40d939e3-1ce0-45c3-9562-c1acfaf0aa92
- **Directory (tenant) ID:** 96bfe658-4094-4192-88f8-5b0874471c7e
- **Supported account types:** My organization only
- **Redirect URIs:** (to be updated after adding web URI)

---

## Log
- **2025-06-27:** Project initialized, planning phase started.

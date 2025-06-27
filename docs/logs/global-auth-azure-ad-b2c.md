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

---

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

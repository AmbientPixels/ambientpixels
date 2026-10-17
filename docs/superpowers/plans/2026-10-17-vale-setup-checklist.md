# Vale mail — setup checklist (Chad, ~20 min)

Everything below is **dormant until step 7**. Code is already live; nothing reads mail until both switches are on.
Spec: `docs/superpowers/specs/2026-10-17-vale-ceo-assistant-design.md` §9. Tenant: `c4ssinilive.onmicrosoft.com` (`96bfe658-4094-4192-88f8-5b0874471c7e`).

## 1. Register the "Vale" app (Entra admin center, signed in as admin@c4ssinilive.onmicrosoft.com)

Entra → **App registrations → New registration**
- Name `Vale` · **Single tenant** · Redirect URI: platform **Web**, `https://ambientpixels-nova-api.azurewebsites.net/api/vale-connect/callback` → **Register**.
- Copy **Application (client) ID** → `<APP_ID>`.

On the new app:
- **Authentication → Add a platform → Single-page application**: `https://ambientpixels.ai/modules/company/office.html`
- **Expose an API → Add** Application ID URI `api://<APP_ID>` → **Add a scope** `access_as_user` (Admins and users; display name "Access Vale as you").
- **Manifest**: set `"requestedAccessTokenVersion": 2` (in `api`) → Save.
- **API permissions → Add → Microsoft Graph → Delegated**: `openid`, `profile`, `offline_access`, `User.Read`, `Mail.Read`, `Calendars.Read` → **Grant admin consent**.
  **Do NOT add any *Application* permission (especially `Mail.Send`).** Sending is granted only by step 3, scoped to vale@.
- **Certificates & secrets → New client secret** (24 months) → copy the **Value** → `<SECRET>`. Put a calendar reminder 2 weeks before it expires.
- **Enterprise applications → Vale** → copy its **Object ID** → `<SP_OBJECT_ID>` (this is *not* the app registration's object ID).

## 2. Vale's mailbox (Exchange admin center)

Recipients → Mailboxes → **Add a shared mailbox**: name `Vale`, address `vale@ambientpixels.ai`. Free, no license.

## 3. Let Vale send only as herself (Exchange Online PowerShell)

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline -UserPrincipalName admin@c4ssinilive.onmicrosoft.com

New-ServicePrincipal -AppId <APP_ID> -ObjectId <SP_OBJECT_ID> -DisplayName "Vale"
New-ManagementScope -Name "Vale mailbox only" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'vale@ambientpixels.ai'"
New-ManagementRoleAssignment -App <APP_ID> -Role "Application Mail.Send" -CustomResourceScope "Vale mailbox only"

# Must show InScope True for vale@ and False for chad@:
Test-ServicePrincipalAuthorization -Identity <APP_ID> -Resource vale@ambientpixels.ai
Test-ServicePrincipalAuthorization -Identity <APP_ID> -Resource chad@ambientpixels.ai
```
Takes 30 min–2 h to apply. Vale's app token will show an empty `roles` claim — that's expected with RBAC for Applications.

## 4. Function App settings (`ambientpixels-nova-api`)

| Setting | Value |
|---|---|
| `VALE_TENANT_ID` | `96bfe658-4094-4192-88f8-5b0874471c7e` |
| `VALE_CLIENT_ID` | `<APP_ID>` |
| `VALE_CLIENT_SECRET` | `<SECRET>` |
| `VALE_CEO_OID` | `az ad user show --id chad@ambientpixels.ai --query id -o tsv` |
| `VALE_TOKEN_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — never commit it |

Leave `VALE_STRICT_AUTH` and `VALE_MAIL_ENABLED` **unset** for now.

## 5. Site config

`data/vale-config.json`: set `"clientId": "<APP_ID>"` and `"scope": "api://<APP_ID>/access_as_user"`, commit, wait for the deploy.

## 6. Sign in

Open `https://ambientpixels.ai/modules/company/office.html?vale=1` → **Sign in with Microsoft** as `chad@ambientpixels.ai`. The Mail card should say "Not connected".

## 7. Lock it, connect, switch on — in this order

1. Set `VALE_STRICT_AUTH=1` (Vale's pages now open only for your Microsoft sign-in). Reload the Office page; it should still work.
2. Click **Connect** → approve the read-only permissions. The card shows "Connected".
3. Set `VALE_MAIL_ENABLED=1`. The first brief arrives at 06:30 Pacific (catch-up until 09:00).

## 8. Tune

- In the Mail card's **Sorting rules**: add important people; check the client domains (`hansonconsultgroup.com`, `evergreengoodwill.org`).
- Day-job hours (for the "during your Microsoft hours" flag): `ceoProfile.workHours = { "days": [1,2,3,4,5], "start": "08:00", "end": "17:00" }` — set via Vale chat or ask Claude to write it.

## Undo

- Stop everything: unset `VALE_MAIL_ENABLED`.
- Cut her access: Office → **Disconnect** (deletes the stored token), and/or Entra → Enterprise applications → Vale → Users and groups / Permissions → revoke.
- Back to the old gate: unset `VALE_STRICT_AUTH` — mail data stays locked to Microsoft sign-in regardless.

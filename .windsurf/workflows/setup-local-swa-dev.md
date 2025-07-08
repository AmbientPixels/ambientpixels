---
description: Setup local dev environment with Azure Static Web Apps CLI for B2C auth
---

1. In your Azure AD B2C app registration, add a redirect URI for localhost:
   - http://localhost:4280/.auth/login/aadB2C/callback

2. Install the SWA CLI globally:
   ```bash
   npm install -g @azure/static-web-apps-cli
   ```

3. In your project `package.json`, add a dev script under `scripts`:
   ```json
   {
     "scripts": {
       "start:dev": "swa start . --app-location ."
     }
   }
   ```

4. Start your local site with:
   ```bash
   npm run start:dev
   ```

5. Browse to http://localhost:4280 and test login/logout flows against your B2C tenant.

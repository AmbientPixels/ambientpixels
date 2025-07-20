// auth-microsoft.js
// Handles Microsoft (Entra ID) authentication using MSAL.js
// You must fill in your clientId below from your Azure App Registration

const msalConfig = {
  auth: {
    clientId: '232e176a-71f6-4a55-af28-6271300a1d0a', // ambientpixels-nova-api App Registration
    authority: 'https://login.microsoftonline.com/common', // Multi-tenant
    redirectUri: window.location.origin + '/cardforge/'
  }
};

const msalInstance = new window.msal.PublicClientApplication(msalConfig);

async function getAccessToken() {
  let accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    // Prompt user to login
    await msalInstance.loginPopup({ scopes: ['User.Read'] });
    accounts = msalInstance.getAllAccounts();
  }
  const account = accounts[0];
  const result = await msalInstance.acquireTokenSilent({
    account,
    scopes: ['api://232e176a-71f6-4a55-af28-6271300a1d0a/.default'] // ambientpixels-nova-api API scope
  });
  return result.accessToken;
}

window.CardForgeAuth = {
  msalInstance,
  getAccessToken
};

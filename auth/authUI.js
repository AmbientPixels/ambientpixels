// /auth/authUI.js
// Unified, robust authentication logic for AmbientPixels using MSAL.js
// Implements: updateUI, data-auth-state, button loading, fallback guard, modular binding

(function() {
  // Debug logging
  function debugLog(...args) {
    if (window.DEBUG_AUTH || localStorage.getItem('DEBUG_AUTH') === 'true') console.log("[AUTH]", ...args);
  }
  
  // Set a flag to track if we're authenticated
  let isAuthenticated = false;

  // UI helpers
  function setAuthStateAttr(isSignedIn) {
    document.body && document.body.setAttribute('data-auth-state', isSignedIn ? 'signed-in' : 'signed-out');
  }
  function showButtonLoading(btn, isLoading) {
    if (!btn) return;
    if (isLoading) {
      btn.classList.add('loading');
      btn.disabled = true;
      if (!btn.querySelector('.auth-spinner')) {
        const spinner = document.createElement('span');
        spinner.className = 'auth-spinner';
        spinner.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.appendChild(spinner);
      }
    } else {
      btn.classList.remove('loading');
      btn.disabled = false;
      const spinner = btn.querySelector('.auth-spinner');
      if (spinner) btn.removeChild(spinner);
    }
  }
  function showFallback(message) {
    let fallback = document.getElementById('auth-fallback-message');
    if (!fallback) {
      fallback = document.createElement('div');
      fallback.id = 'auth-fallback-message';
      fallback.style = 'color: #fff; background: #c00; padding: 1em; margin: 1em 0; border-radius: 6px; text-align:center;';
      document.body.prepend(fallback);
    }
    fallback.textContent = message || 'Authentication system unavailable. Please try again later.';
    setAuthStateAttr(false);
    debugLog('Fallback message shown:', fallback.textContent);
  }

  // Main UI update function
  function updateUI() {
    const loginBtn = document.getElementById('login-btn');
    const userProfileContainer = document.getElementById('user-profile-container');
    const userDisplayName = document.getElementById('user-display-name');
    const dropdownUserName = document.querySelector('.dropdown-user-name');
    const dropdownUserEmail = document.querySelector('.dropdown-user-email');
    const logoutBtn = document.getElementById('logout-btn');
    const greeting = document.getElementById('user-greeting');
    
    // Log DOM elements for debugging
    debugLog('updateUI DOM elements:', { 
      loginBtn: loginBtn ? 'found' : 'missing', 
      logoutBtn: logoutBtn ? 'found' : 'missing',
      greeting: greeting ? 'found' : 'missing',
      userProfileContainer: userProfileContainer ? 'found' : 'missing'
    });
    
    let isSignedIn = false;
    let account = null;
    try {
      if (window.msalInstance && typeof window.msalInstance.getAllAccounts === 'function') {
        const accounts = window.msalInstance.getAllAccounts();
        account = accounts && accounts[0];
        isSignedIn = !!account;
        
        // Store authentication state for future reference
        isAuthenticated = isSignedIn;
        
        // Persist authentication state in sessionStorage for page reloads
        if (isSignedIn) {
          sessionStorage.setItem('ambientPixels_isAuthenticated', 'true');
        } else if (!isSignedIn && sessionStorage.getItem('ambientPixels_isAuthenticated') === 'true') {
          // Only clear if we're explicitly not signed in
          sessionStorage.removeItem('ambientPixels_isAuthenticated');
        }
        
        debugLog('updateUI account check:', { 
          msalInstanceExists: !!window.msalInstance,
          accountsFound: accounts ? accounts.length : 0,
          isSignedIn: isSignedIn,
          accountDetails: account ? {
            name: account.name,
            username: account.username,
            localAccountId: account.localAccountId
          } : 'none'
        });
      } else {
        debugLog('updateUI: msalInstance or getAllAccounts not available');
        
        // Check if we have a persisted authentication state
        if (sessionStorage.getItem('ambientPixels_isAuthenticated') === 'true') {
          debugLog('Using persisted authentication state from sessionStorage');
          isSignedIn = true;
          isAuthenticated = true;
        }
      }
    } catch (e) { debugLog('updateUI account check error:', e); }
    
    setAuthStateAttr(isSignedIn);
    if (loginBtn) {
      loginBtn.style.display = isSignedIn ? 'none' : '';
      showButtonLoading(loginBtn, false);
      loginBtn.setAttribute('aria-hidden', isSignedIn ? 'true' : 'false');
      debugLog('loginBtn visibility set to:', isSignedIn ? 'hidden' : 'visible');
    }
    if (logoutBtn) {
      logoutBtn.style.display = isSignedIn ? '' : 'none';
      showButtonLoading(logoutBtn, false);
      logoutBtn.setAttribute('aria-hidden', isSignedIn ? 'false' : 'true');
      debugLog('logoutBtn visibility set to:', isSignedIn ? 'visible' : 'hidden');
    }
    if (greeting) {
      greeting.style.display = isSignedIn ? '' : 'none';
      let displayName = '';
      if (isSignedIn && account) {
        // Determine the best display name to use
        let displayName = account.name;

        // Fallback if name is not useful (null, empty, or "unknown")
        if (!displayName || displayName.trim().toLowerCase() === 'unknown' || displayName.trim() === '') {
          displayName = account.username;
        }
        
        // If the name is an email, extract the part before the @
        if (displayName && displayName.includes('@')) {
          displayName = displayName.split('@')[0];
        }

        // Final fallback if no name could be determined
        displayName = displayName || 'Grid Visitor';

        greeting.textContent = `Welcome, ${displayName}`;
        debugLog('Greeting displayName:', displayName);
        debugLog('Account object:', account);
      } else {
        greeting.textContent = '';
      }
    }
    if (userProfileContainer) {
      userProfileContainer.style.display = isSignedIn ? '' : 'none';
      if (isSignedIn && account) {
        // Determine the best display name to use
        let displayName = account.name;

        // Fallback if name is not useful (null, empty, or "unknown")
        if (!displayName || displayName.trim().toLowerCase() === 'unknown' || displayName.trim() === '') {
          displayName = account.username;
        }
        
        // If the name is an email, extract the part before the @
        if (displayName && displayName.includes('@')) {
          displayName = displayName.split('@')[0];
        }

        // Final fallback if no name could be determined
        displayName = displayName || 'Grid Visitor';

        const userEmail = account.username || account.idTokenClaims?.email || 'No email available';

        if(userDisplayName) userDisplayName.textContent = displayName;
        if(dropdownUserName) dropdownUserName.textContent = displayName;
        if(dropdownUserEmail) dropdownUserEmail.textContent = userEmail;

        debugLog('Profile dropdown updated:', { displayName, userEmail });
        debugLog('Account object:', account);
      } 
    }
    debugLog('UI updated. Signed in:', isSignedIn, 'Account:', account);
  }

  // MSAL interaction_in_progress bug workaround
  if (
    sessionStorage.getItem('msal.interaction.status') === 'interaction_in_progress' &&
    !window.location.hash.includes('id_token') &&
    !window.location.hash.includes('access_token') &&
    !window.location.hash.includes('error')
  ) {
    sessionStorage.removeItem('msal.interaction.status');
    if (typeof showBanner === 'function') {
      showBanner({
        message: 'Recovered from a stuck login state. You may now try logging in again.',
        type: 'info',
        duration: 5000
      });
    }
  }

  // Main MSAL logic
  async function initAuth() {
    debugLog("Initializing MSAL authentication");
    // Get MSAL config from authConfig.js (imported separately)
    if (!window.msalConfig) {
      debugLog('ERROR: msalConfig not found. Make sure authConfig.js is loaded before authUI.js');
      showFallback('Authentication configuration missing. Please contact support.');
      return;
    }
    
    let msalInstance;
    try {
      msalInstance = new msal.PublicClientApplication(window.msalConfig);
      window.msalInstance = msalInstance; // expose for UI helpers
      debugLog('MSAL instance created:', msalInstance);
      if (typeof msalInstance.initialize === 'function') {
        debugLog('Calling msalInstance.initialize()...');
        await msalInstance.initialize();
        debugLog('MSAL instance initialized');
      }
      await handleRedirectResponse();
    } catch (e) {
      debugLog('MSAL instance creation/initialization failed:', e);
      showFallback('Authentication system unavailable. Please refresh or contact support.');
      return;
    }
    bindAuthButtons();
    updateUI();
  }

  async function handleRedirectResponse() {
    debugLog("Starting handleRedirectPromise...");
    try {
      // Check if we're on a post-login redirect
      const isRedirectCallback = window.location.hash && 
        (window.location.hash.includes('id_token') || 
         window.location.hash.includes('access_token') || 
         window.location.hash.includes('error'));
      
      debugLog("Is redirect callback:", isRedirectCallback, "Hash:", window.location.hash);
      
      const response = await window.msalInstance.handleRedirectPromise();
      debugLog("handleRedirectPromise completed, response:", response);
      
      if (response && response.account) {
        window.msalInstance.setActiveAccount(response.account);
        debugLog("Active account set after redirect:", response.account);
        
        // Mark as authenticated
        isAuthenticated = true;
        sessionStorage.setItem('ambientPixels_isAuthenticated', 'true');
        
        // Show welcome banner
        if (window.banner && typeof window.banner.show === 'function') {
          const userName = response.account.name || response.account.username || 'User';
          window.banner.show({
            message: `Welcome, ${userName}! You are now logged in.`,
            type: 'success',
            duration: 5000,
            icon: 'fas fa-user-check'
          });
          debugLog("Displayed welcome banner for user:", userName);
        } else {
          debugLog("Banner system not available for login notification");
        }
        
        // Force UI update with a small delay to ensure DOM is ready
        setTimeout(() => {
          debugLog("Delayed UI update after successful login");
          updateUI();
          
          // Force a re-binding of auth buttons after successful login
          setTimeout(() => {
            debugLog("Re-binding auth buttons after successful login");
            bindAuthButtons();
          }, 100);
        }, 100);
      } else {
        // No response from redirect, check if we have an account anyway
        const accounts = window.msalInstance.getAllAccounts();
        debugLog("No redirect response, checking existing accounts:", accounts);
        if (accounts && accounts.length > 0) {
          window.msalInstance.setActiveAccount(accounts[0]);
          debugLog("Set active account from existing accounts:", accounts[0]);
          isAuthenticated = true;
          sessionStorage.setItem('ambientPixels_isAuthenticated', 'true');
        }
      }
    } catch (e) {
      debugLog("handleRedirectPromise error:", e);
      showFallback('Authentication error. Please refresh or contact support.');
    }
    
    // Always update UI regardless of redirect response
    updateUI();
    
    // Log final auth state
    const finalAccount = getAccount();
    debugLog("Final auth state after handleRedirectResponse:", {
      hasAccount: !!finalAccount,
      accountDetails: finalAccount ? {
        name: finalAccount.name,
        username: finalAccount.username
      } : 'none'
    });
  }

  function getAccount() {
    try {
      const accounts = window.msalInstance.getAllAccounts();
      debugLog("Accounts found:", accounts);
      return accounts.length > 0 ? accounts[0] : null;
    } catch (e) { return null; }
  }
  function isInteractionInProgress() {
    return sessionStorage.getItem('msal.interaction.status') === 'interaction_in_progress';
  }
  function login(event) {
    debugLog("Login button clicked");
    const loginBtn = document.getElementById("login-btn");
    if (event) event.preventDefault();
    if (isInteractionInProgress()) {
      debugLog("Login aborted: interaction already in progress.");
      showButtonLoading(loginBtn, true);
      return;
    }
    showButtonLoading(loginBtn, true);
    try {
      window.msalInstance.loginRedirect({ scopes: ["openid", "profile", "email"] });
    } catch (e) {
      debugLog('loginRedirect error:', e);
      showButtonLoading(loginBtn, false);
      showFallback('Login failed. Please try again.');
    }
  }
  function logout(event) {
    debugLog("Logout button clicked");
    const logoutBtn = document.getElementById("logout-btn");
    if (event) event.preventDefault();
    
    // Get account info before logout for banner
    let userName = 'User';
    try {
      const account = getAccount();
      if (account) {
        userName = account.name || account.username || 'User';
      }
    } catch (e) {
      debugLog('Error getting account info for logout banner:', e);
    }
    
    // Show logout banner
    if (window.banner && typeof window.banner.show === 'function') {
      window.banner.show({
        message: `Goodbye, ${userName}! You have been logged out.`,
        type: 'info',
        duration: 4000,
        icon: 'fas fa-sign-out-alt'
      });
      debugLog("Displayed logout banner for user:", userName);
    }
    
    showButtonLoading(logoutBtn, true);
    try {
      // Clear authentication state before redirect
      isAuthenticated = false;
      sessionStorage.removeItem('ambientPixels_isAuthenticated');
      
      window.msalInstance.logoutRedirect({ 
        postLogoutRedirectUri: "https://ambientpixels.ai/" 
      });
      // Note: Update Azure portal front-channel logout URL to match this
    } catch (e) {
      debugLog('logoutRedirect error:', e);
      showButtonLoading(logoutBtn, false);
      showFallback('Logout failed. Please try again.');
    }
  }
  function bindAuthButtons() {
    debugLog('bindAuthButtons called - binding auth buttons and updating UI');
    
    const loginBtn = document.getElementById("login-btn");
    if (loginBtn) {
      loginBtn.onclick = null;
      loginBtn.removeEventListener('click', login);
      loginBtn.addEventListener('click', login, {capture: false});
      loginBtn.setAttribute('aria-label', 'Log in to Ambient Pixels');
      loginBtn.setAttribute('tabindex', '0');
      loginBtn.setAttribute('role', 'button');
      debugLog('Login button bound successfully');
    } else {
      debugLog('WARNING: Login button not found in DOM');
    }
    
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = null;
      logoutBtn.removeEventListener('click', logout);
      logoutBtn.addEventListener('click', logout, {capture: false});
      logoutBtn.setAttribute('aria-label', 'Log out of Ambient Pixels');
      logoutBtn.setAttribute('tabindex', '0');
      logoutBtn.setAttribute('role', 'button');
      debugLog('Logout button bound successfully');
    } else {
      debugLog('WARNING: Logout button not found in DOM');
    }
    
    // Bind new profile dropdown elements
    const userProfileButton = document.getElementById('user-profile-button');
    const userProfileDropdown = document.getElementById('user-profile-dropdown');
    const dropdownLogoutBtn = document.getElementById('dropdown-logout-btn');

    if (userProfileButton && userProfileDropdown) {
      userProfileButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = userProfileDropdown.classList.toggle('visible');
        userProfileButton.setAttribute('aria-expanded', isVisible);
        debugLog('Profile dropdown toggled, visible:', isVisible);
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!userProfileDropdown.contains(e.target) && userProfileDropdown.classList.contains('visible')) {
          userProfileDropdown.classList.remove('visible');
          userProfileButton.setAttribute('aria-expanded', 'false');
          debugLog('Profile dropdown closed due to outside click');
        }
      });

      debugLog('User profile dropdown button bound successfully');
    } else {
      debugLog('WARNING: User profile button or dropdown not found in DOM');
    }

    if (dropdownLogoutBtn) {
      dropdownLogoutBtn.addEventListener('click', logout, {capture: false});
      debugLog('Dropdown logout button bound successfully');
    } else {
      debugLog('WARNING: Dropdown logout button not found in DOM');
    }
    
    // Force a UI update with the current authentication state
    updateUI();
    
    // If we know we're authenticated, make sure logout button is visible
    if (isAuthenticated) {
      const refreshedLogoutBtn = document.getElementById("logout-btn");
      if (refreshedLogoutBtn) {
        refreshedLogoutBtn.style.display = '';
        debugLog('Forced logout button visibility due to known authenticated state');
      }
    }
    
    // If we know we're authenticated, make sure profile container is visible
    const userProfileContainer = document.getElementById('user-profile-container');
    if (isAuthenticated && userProfileContainer) {
        userProfileContainer.style.display = '';
        debugLog('Forced profile container visibility due to known authenticated state');
    }
    
    debugLog('Auth elements bound:', {loginBtn, userProfileButton, dropdownLogoutBtn});
  }

  // Expose needed globals
  window.initAuth = initAuth;
  window.login = login;
  window.logout = logout;
  window.getAccount = getAccount;
  window.bindAuthButtons = bindAuthButtons;
  window.updateAuthUI = updateUI;

  // --- Initialization Guard ---
  // This robustly waits for dependencies to be ready before initializing,
  // preventing race conditions with dynamically loaded scripts.
  function initializeWhenReady() {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const msalReady = typeof msal !== 'undefined' && msal.PublicClientApplication;
      const configReady = typeof msalConfig !== 'undefined';

      if (msalReady && configReady) {
        clearInterval(checkInterval);
        debugLog('Auth dependencies ready, initializing...');
        initAuth();
      } else if (Date.now() - startTime > 5000) { // 5-second timeout
        clearInterval(checkInterval);
        debugLog('ERROR: Auth dependencies did not load in time.');
        showFallback('Authentication system unavailable. Please refresh or contact support.');
      }
    }, 100);
  }

  // Start the initialization check once the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWhenReady);
  } else {
    initializeWhenReady();
  }

})();

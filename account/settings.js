// Debug mode disabled for production
const DEBUG = false;

// Status message management
function showStatusMessage(message, type = 'info', duration = 5000) {
    const statusEl = document.getElementById('status-message');
    if (!statusEl) return;
    
    // Set message content and type
    statusEl.querySelector('.status-text').textContent = message;
    
    // Set icon based on type
    const iconMap = {
        success: '✓',
        error: '⚠',
        info: 'ⓘ'
    };
    statusEl.querySelector('.status-icon').textContent = iconMap[type] || iconMap.info;
    
    // Update classes
    statusEl.className = 'status-message visible';
    statusEl.classList.add(type);
    statusEl.hidden = false;
    
    // Auto-hide after duration if specified
    if (duration > 0) {
        setTimeout(() => {
            hideStatusMessage();
        }, duration);
    }
    
    // Add close button handler
    const closeBtn = statusEl.querySelector('.status-close');
    if (closeBtn) {
        const closeHandler = () => {
            hideStatusMessage();
            closeBtn.removeEventListener('click', closeHandler);
        };
        closeBtn.addEventListener('click', closeHandler);
    }
}

function hideStatusMessage() {
    const statusEl = document.getElementById('status-message');
    if (statusEl) {
        statusEl.classList.remove('visible');
        // Wait for animation to complete before hiding
        setTimeout(() => {
            statusEl.hidden = true;
            statusEl.className = 'status-message';
            statusEl.querySelector('.status-text').textContent = '';
        }, 300);
    }
}

function debugLog(...args) {
    if (DEBUG) {
        console.log('[Account]', ...args);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    debugLog('DOM loaded, checking auth status...');
    
    // Add loading class to body
    document.body.classList.add('loading');
    
    // Check if user is authenticated and load profile data
    checkAuthAndLoadProfile()
        .catch(error => {
            console.error('Error in auth check:', error);
            showNotAuthenticated();
        })
        .finally(() => {
            // Remove loading class when done (whether success or error)
            document.body.classList.remove('loading');
        });
});

async function checkAuthAndLoadProfile() {
    try {
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        // For local development without SWA CLI
        if (isLocalhost && !window.location.port.includes('4280')) {
            debugLog('Running in local development mode with mock user');
            const mockUser = {
                userId: 'local-dev-user',
                userDetails: 'dev@ambientpixels.local',
                identityProvider: 'local-dev',
                userRoles: ['authenticated', 'anonymous']
            };
            
            // Add a small delay to simulate network request
            await new Promise(resolve => setTimeout(resolve, 500));
            
            window.currentUser = mockUser;
            populateProfileData(mockUser);
            bindActionButtons();
            document.body.classList.remove('loading');
            document.body.classList.add('authenticated');
            
            showStatusMessage('Running in local development mode with mock user data', 'info', 5000);
            return;
        }
        
        // Normal auth flow for production or SWA CLI
        debugLog('Fetching auth status from /.auth/me');
        const response = await fetch('/.auth/me');
        
        if (!response.ok) {
            const errorText = await response.text();
            debugLog('Auth status fetch failed:', response.status, errorText);
            throw new Error(`Failed to fetch auth status: ${response.status} ${response.statusText}`);
        }
        
        const authData = await response.json();
        debugLog('Auth response:', JSON.stringify(authData, null, 2));
        
        if (!authData) {
            throw new Error('Empty auth response');
        }
        
        const user = authData.clientPrincipal || authData; // Handle different response formats
        
        if (user && user.userDetails) {
            debugLog('User authenticated:', user.userDetails);
            // Expose user data for client-side utilities
            window.currentUser = user;
            populateProfileData(user);
            bindActionButtons();
            
            // Show the main content
            document.body.classList.remove('loading');
            document.body.classList.add('authenticated');
        } else {
            debugLog('No authenticated user found in response');
            showNotAuthenticated();
        }
    } catch (error) {
        console.error('Error checking authentication status:', error);
        debugLog('Auth check error details:', error);
        
        // Show appropriate error message and redirect to login
        showStatusMessage('Authentication required. Redirecting to login...', 'error', 2000);
        
        // Redirect to login after a short delay
        setTimeout(() => {
            const redirectUri = encodeURIComponent(window.location.href);
            window.location.href = `/pages/login.html?redirect=${redirectUri}`;
        }, 2000);
    }
}

function populateProfileData(user) {
    debugLog('Populating profile data for user:', user);
    
    const displayNameField = document.getElementById('displayName');
    const emailField = document.getElementById('email');
    const rawProfile = document.getElementById('raw-profile');
    
    if (!user) {
        debugLog('No user data provided to populateProfileData');
        return;
    }

    // Extract user details - handle different possible auth providers
    let displayName = user.userDetails || user.name || user.preferred_username || user.email || 'Guest';
    let userEmail = user.userDetails || user.email || user.preferred_username || 'No email available';
    
    // Clean up display name
    if (displayName && displayName.includes('@')) {
        displayName = displayName.split('@')[0];
    }
    
    // Format display name (capitalize first letter of each word)
    displayName = displayName
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .trim() || 'Grid Visitor';

    debugLog('Setting display name:', displayName);
    debugLog('Setting email:', userEmail);
    
    // Update the DOM elements
    if (displayNameField) {
        displayNameField.value = displayName;
        displayNameField.setAttribute('title', displayName); // Add tooltip
    } else {
        debugLog('Display name field not found in the DOM');
    }

    if (emailField) {
        emailField.value = userEmail;
        emailField.setAttribute('title', userEmail); // Add tooltip
    } else {
        debugLog('Email field not found in the DOM');
    }
    
    // Show raw data in the pre element if it exists
    if (rawProfile) {
        rawProfile.textContent = JSON.stringify(user, null, 2);
    }
    
    // Update the page title with the user's name
    if (displayName && displayName !== 'Grid Visitor') {
        document.title = `${displayName}'s Account - AmbientPixels`;
    }
}

function showNotAuthenticated() {
    console.warn('User not authenticated');
    
    // Check if we're running locally
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    if (isLocalhost) {
        // For local development, show a message instead of redirecting
        const loginUrl = `https://${window.location.hostname}:4280/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(window.location.href)}`;
        document.body.innerHTML = `
            <div style="max-width: 600px; margin: 2rem auto; padding: 2rem; background: #1e1e2d; border-radius: 8px; color: #e6eaf3;">
                <h2>Authentication Required</h2>
                <p>This page requires authentication. When running locally, you need to use the Azure Static Web Apps CLI to enable authentication.</p>
                <p>Please run the following command in your project directory:</p>
                <pre style="background: #2a2d40; padding: 1rem; border-radius: 4px; overflow-x: auto;">npm install -g @azure/static-web-apps-cli
swa start http://localhost:5500 --run "npx http-server -p 5500" --api-location api</pre>
                <p>Then visit: <a href="${loginUrl}" style="color: #64d3ff;">Login with Azure AD</a></p>
                <p><strong>Note:</strong> Make sure to use the correct port (usually 4280) that the SWA CLI is running on.</p>
                <button onclick="window.location.href='${loginUrl}'" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #64d3ff; color: #10131a; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
                    Continue to Login
                </button>
            </div>
        `;
    } else {
        // In production, redirect to the auth endpoint
        window.location.href = `/pages/login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    }
}

function bindActionButtons() {
    const copyEmailBtn = document.getElementById('copy-email-btn');
    const downloadProfileBtn = document.getElementById('download-profile-btn');
    const toggleRawBtn = document.getElementById('toggle-raw-btn');
    const rawProfile = document.getElementById('raw-profile');

    // Copy email to clipboard
    if (copyEmailBtn) {
        copyEmailBtn.addEventListener('click', async () => {
            const email = document.getElementById('email')?.value;
            if (email && email !== 'No email available') {
                try {
                    await navigator.clipboard.writeText(email);
                    showStatusMessage('Email copied to clipboard!', 'success');
                } catch (err) {
                    console.error('Failed to copy email:', err);
                    showStatusMessage('Failed to copy email', 'error');
                }
            }
        });
    }

    // Download profile as JSON
    if (downloadProfileBtn) {
        downloadProfileBtn.addEventListener('click', () => {
            const user = window.currentUser;
            if (user) {
                try {
                    const dataStr = JSON.stringify(user, null, 2);
                    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
                    const exportName = `profile_${new Date().toISOString().slice(0, 10)}.json`;
                    
                    const linkElement = document.createElement('a');
                    linkElement.setAttribute('href', dataUri);
                    linkElement.setAttribute('download', exportName);
                    linkElement.click();
                    
                    showStatusMessage('Profile downloaded successfully!', 'success');
                } catch (err) {
                    console.error('Error downloading profile:', err);
                    showStatusMessage('Failed to download profile', 'error');
                }
            } else {
                showStatusMessage('No user data available to download', 'error');
            }
        });
    }

    // Toggle raw profile data
    if (toggleRawBtn && rawProfile) {
        toggleRawBtn.addEventListener('click', () => {
            const isVisible = rawProfile.hidden;
            rawProfile.hidden = !isVisible;
            toggleRawBtn.textContent = isVisible ? 'Hide Raw Data' : 'Show Raw Data';
            
            // Auto-hide after 10 seconds if showing
            if (isVisible) {
                setTimeout(() => {
                    if (!rawProfile.hidden) {
                        rawProfile.hidden = true;
                        toggleRawBtn.textContent = 'Show Raw Data';
                    }
                }, 10000);
            }
        });
    }
}

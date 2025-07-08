# Account Settings Page

## 🚀 Quick Start (For AI Assistants)

### Key Context
- **Purpose**: User account management and authentication
- **Tech Stack**: HTML, CSS, JavaScript, Azure Static Web Apps
- **Auth Provider**: Azure AD (with local dev fallback)

### Key Files & Functions
- `account/index.html` - Main page structure
- `account/settings.js` - Core logic (auth, user data)
  - `checkAuthAndLoadProfile()` - Main auth flow
  - `populateProfileData(user)` - Updates UI with user data
  - `bindActionButtons()` - Event handlers
- `account/settings.css` - Page-specific styles
- `css/components.css` - Shared UI components

### Development Mode
- Set `const DEBUG = true;` in `settings.js`
- Uses mock user data when running locally
- Debug logs are prefixed with '[Account]'

### Common Patterns
1. **Styling**:
   - Use `.glass-button` for all buttons
   - Follow dark theme patterns from `theme.css`
   - No inline styles - use utility classes

2. **Auth Flow**:
   - Checks `/.auth/me` for session
   - Redirects to Azure AD if not authenticated
   - Handles token validation and user data population

## Overview
The Account Settings page allows authenticated users to view and manage their profile information, avatar, and account settings. This document covers the page's features, development mode configuration, and deployment considerations.

## Features

### Profile Information
- Displays user's display name and email
- Shows the identity provider used for authentication
- Provides options to copy email or download profile data

### Avatar Settings
- Displays current avatar
- Allows users to change their avatar (functionality to be implemented)

### Account Management
- Provides options for account management
- Includes a secure delete account option with confirmation

## Development Mode

### Enabling Development Mode
Development mode allows for local testing without requiring authentication. To enable:

1. Open `account/settings.js`
2. Set `const DEBUG = true;` at the top of the file
3. For local development without Azure Static Web Apps CLI, modify the `checkAuthAndLoadProfile` function to use mock data:

```javascript
// In account/settings.js
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
```

### Disabling Development Mode for Production
Before deploying to production:

1. Ensure `const DEBUG = false;` is set in `account/settings.js`
2. Verify all mock user code is removed or properly gated behind environment checks
3. Test the authentication flow with real Azure AD credentials

## Authentication Flow

The page implements the following authentication flow:

1. On page load, checks if user is authenticated via `/.auth/me`
2. If not authenticated, redirects to Azure AD login
3. After successful login, redirects back to the account page
4. Shows appropriate error messages for authentication failures

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DEBUG` | Enables/disables debug logging | No | `false` |

## Dependencies

- Azure Static Web Apps authentication
- Font Awesome for icons
- Site-wide CSS components and utilities

## Deployment Notes

1. Ensure Azure Static Web Apps authentication is properly configured
2. Verify all API endpoints in the code match the production environment
3. Test all authentication flows before deploying to production

## Troubleshooting

### Authentication Issues
- Verify Azure AD configuration in the Azure Portal
- Check browser console for any CORS or network errors
- Ensure redirect URIs are properly configured in Azure AD

### Styling Issues
- Verify all CSS files are properly linked
- Check for any console errors related to missing assets
- Ensure all CSS variables are properly defined in the theme

## Upcoming Features & Future Work

### User Profile Enhancements
- [ ] **Profile Picture Upload**
  - Allow users to upload and crop profile pictures
  - Support for webcam capture
  - Integration with Azure Blob Storage for image hosting

- [ ] **Profile Customization**
  - Customizable profile URL
  - Bio/About section
  - Social media links
  - Theme preferences (light/dark mode)

### Security & Privacy
- [ ] **Two-Factor Authentication (2FA)**
  - Integration with authenticator apps
  - Backup codes
  - SMS/Email verification options

- [ ] **Login Activity**
  - View recent login history
  - Device management
  - Session timeout controls

### Account Management
- [ ] **Account Export**
  - Full data export in standard formats (JSON, PDF)
  - Selective data export options

- [ ] **Account Recovery**
  - Enhanced recovery options
  - Security question setup
  - Trusted contacts

### Integration
- [ ] **Third-party Connections**
  - OAuth provider connections (Google, GitHub, etc.)
  - Application integrations
  - API key management

### Performance & Accessibility
- [ ] **Progressive Enhancement**
  - Offline support for basic profile viewing
  - Improved loading states
  - Better error handling

## Related Documentation

- [Azure Static Web Apps Authentication](https://docs.microsoft.com/en-us/azure/static-web-apps/authentication-authorization)
- [Azure AD Integration](https://docs.microsoft.com/en-us/azure/static-web-apps/authentication-custom?tabs=aad)
- [Project Style Guide](./STYLE-GUIDE.md)

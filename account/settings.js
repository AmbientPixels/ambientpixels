document.addEventListener('DOMContentLoaded', () => {
    // A small delay to ensure MSAL instance is initialized by authUI.js
    setTimeout(initializeAccountSettings, 100);
});

function initializeAccountSettings() {
    const msalInstance = window.msalInstance;
    if (!msalInstance) {
        console.error('MSAL instance not found. Account settings cannot be loaded.');
        return;
    }

    const accounts = msalInstance.getAllAccounts();
    const account = accounts && accounts[0];

    if (account) {
        populateProfileData(account);
        bindActionButtons();
    } else {
        console.warn('No authenticated user found. Redirecting or showing login prompt might be needed.');
        // Optional: Redirect to login or show an access denied message.
        // For now, we just disable the form.
        document.getElementById('displayName').value = 'Not logged in';
        document.getElementById('email').value = 'Not logged in';
    }
}

function populateProfileData(account) {
    const displayNameField = document.getElementById('displayName');
    const emailField = document.getElementById('email');

    // Use the same robust name-finding logic as in authUI.js
    let displayName = account.name;
    if (!displayName || displayName.trim().toLowerCase() === 'unknown' || displayName.trim() === '') {
        displayName = account.username;
    }
    if (displayName && displayName.includes('@')) {
        displayName = displayName.split('@')[0];
    }
    displayName = displayName || 'Grid Visitor';

    const userEmail = account.username || 'No email available';

    if (displayNameField) {
        displayNameField.value = displayName;
    }

    if (emailField) {
        emailField.value = userEmail;
    }
}

function bindActionButtons() {
    const changeAvatarBtn = document.getElementById('change-avatar-btn');
    const deleteAccountBtn = document.getElementById('delete-account-btn');

    if (changeAvatarBtn) {
        changeAvatarBtn.addEventListener('click', () => {
            // Placeholder for avatar picker modal functionality
            alert('Avatar picker modal coming soon!');
        });
    }

    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', () => {
            // Placeholder for account deletion flow
            if (confirm('Are you sure you want to delete your account? This action is permanent.')) {
                alert('Account deletion functionality is not yet implemented.');
            }
        });
    }
}

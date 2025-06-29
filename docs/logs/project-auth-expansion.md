# Project: Global Auth UX Expansion

**Status:** Active
**Last Updated:** 2025-06-29

## Overview
This project expands the AmbientPixels authentication experience with modern user UX features:
- User profile dropdown in header
- Avatar picker modal (with curated images)
- Account/settings page
- Banner feedback for sign-in/out
- Polished transitions and accessibility improvements

## Goals
- Enhance user engagement and personalization
- Maintain Windsurf/Nova design consistency
- Ensure modular, DRY, and accessible code

## Milestones
- [x] Header profile dropdown with avatar
- [ ] Avatar picker modal and persistence
- [ ] Account/settings page
- [ ] Banner integration for auth events
- [ ] Documentation and onboarding update

## Progress Log
- **2025-06-29:** Implemented the user profile dropdown in the header. Added HTML, CSS, and JS to manage UI and user interaction. Updated documentation.
- **2025-06-29:** Project created and initialized. Planning and requirements defined.

---

## Implementation Details

This section provides a technical overview of the user profile dropdown feature for onboarding and future development.

### 1. File Architecture

The feature is built using three core files:

-   **`/modules/header.html`**: Contains the static HTML structure for the navigation bar, including the user profile dropdown container. This file is dynamically loaded into pages across the site.
-   **`/css/components.css`**: Holds all the styling for the dropdown component, including layout, colors, hover effects, and animations. The styles are prefixed with `.user-profile-` for easy identification.
-   **`/auth/authUI.js`**: The brain of the operation. This script handles all authentication logic, UI updates, and event handling for the dropdown.

### 2. Component Breakdown: `header.html`

The dropdown is housed within the `.nav-utility` div and is structured as follows:

-   **`#user-profile-container`**: The main wrapper, hidden by default and shown only when a user is signed in.
-   **`#user-profile-button`**: The clickable element that toggles the dropdown. It contains the avatar, display name, and a caret icon.
    -   **`#user-avatar`**: Displays the user's avatar. It defaults to a Font Awesome icon (`<i class="fas fa-user-circle"></i>`) but is designed to hold an `<img>` tag for custom avatars in the future.
    -   **`#user-display-name`**: Shows the user's preferred name.
-   **`#user-profile-dropdown`**: The menu that appears when the button is clicked. It has the `.visible` class when active.
    -   **`.dropdown-header`**: Displays the user's full name and email.
    -   **`.dropdown-item`**: Links for "Account Settings" and "Logout".

### 3. JavaScript Logic: `authUI.js`

The `authUI.js` script orchestrates the entire feature:

-   **`updateUI()` function**: This is the core function for UI state management. When a user is authenticated, it:
    1.  Hides the "Login" button.
    2.  Shows the `#user-profile-container`.
    3.  Populates the user's display name, full name, and email in the appropriate elements. It uses a fallback mechanism to ensure a friendly name is always displayed.
-   **`bindAuthButtons()` function**: This function sets up all necessary event listeners:
    1.  A `click` listener on `#user-profile-button` toggles the `.visible` class on the dropdown and updates the `aria-expanded` attribute for accessibility.
    2.  A global `click` listener on the `document` handles closing the dropdown when the user clicks anywhere outside of it.
    3.  A `click` listener on `#dropdown-logout-btn` calls the existing `logout()` function.

### 4. How to Extend

To add a new link to the dropdown menu:

1.  Open `/modules/header.html`.
2.  Add a new `<a>` tag inside the `#user-profile-dropdown` div, following the existing pattern:

    ```html
    <a href="/your-new-link/" class="dropdown-item">
      <i class="fas fa-your-icon fa-fw"></i>
      <span>Your Link Text</span>
    </a>
    ```

3.  No JavaScript changes are needed unless the new item requires custom logic.

## Related Files & Links
- `/auth/authUI.js`
- `/auth/authConfig.js`
- `/images/image-packs/characters/`
- `/images/image-packs/characters-02/`
- `/images/image-packs/characters-03-super-heroes/`
- `/docs/logs/projects.json`

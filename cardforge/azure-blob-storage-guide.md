# CardForge V2 – Azure Blob Storage Integration Guide

## Overview
This document explains how CardForge V2 uses Azure Blob Storage for card data persistence, gallery publishing, and user collections. It provides onboarding instructions for developers and technical details for debugging or extending the system.

---

## 1. What is Azure Blob Storage?
Azure Blob Storage is a scalable, cloud-based object storage solution by Microsoft. In CardForge, it is used to store card JSON data for both private user collections and the public card gallery.

---

## 2. Onboarding – Getting Started

### Prerequisites
- Azure account with Blob Storage access
- Access to CardForge API endpoints (see below)
- Proper API keys/credentials (if required for your environment)

### CardForge API Endpoints (Configured in `js/config.js`)
- `loadCards` – Loads card blobs for the current user
- `saveCard` – Saves a card as a blob to Azure
- `publish` – Publishes a card to the public gallery (uploads to a gallery blob container)
- `template` – Loads starter templates from blob storage

**Config Example:**
```js
window._config = {
  apiEndpoints: {
    base: 'https://ambientpixels-nova-api.azurewebsites.net/api',
    loadCards: 'cardforgeloadcards',
    saveCard: 'cardforgesavecards',
    publish: 'cardforgepublish',
    template: 'cardforgetemplate'
  },
  ...
};
```

---

## 3. How Card Data Flows with Blob Storage

### Save Card
- User edits a card and clicks "Save".
- Card data is serialized as JSON.
- Frontend sends POST request to `saveCard` endpoint.
- API uploads JSON blob to user’s container in Azure.

### Load Cards
- UI requests user’s cards from `loadCards` endpoint.
- API fetches blobs from Azure and returns JSON array.
- UI displays cards in "My Cards" section.

### Publish Card
- User clicks "Publish".
- Card data sent to `publish` endpoint.
- API uploads to public gallery blob container.
- Card appears in the global gallery.

### Templates
- UI loads templates from `template` endpoint.
- API fetches template blobs from Azure.

---

## 4. Technical Details

### API Request Example
```js
fetch(`${window._config.apiEndpoints.base}/${window._config.apiEndpoints.saveCard}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cardData)
});
```

### Blob Storage Structure
- **User Cards:** Each user has a container/folder for their cards (e.g., `user-<id>/card-<id>.json`)
- **Gallery:** Published cards are stored in a shared container (e.g., `gallery/card-<id>.json`)
- **Templates:** Templates live in a separate container (e.g., `templates/character.json`)

### Security
- API handles all authentication and authorization
- Direct access to Azure Storage from the frontend is NOT permitted
- All blob operations must go through the API

---

## 5. Troubleshooting & Debugging
- Check API endpoint configuration in `js/config.js`
- Use browser dev tools to inspect network requests
- 400/401 errors usually mean authentication or endpoint issues
- 500 errors may indicate Azure or API-side problems
- Check Azure portal for blob container status

---

## 6. Extending Blob Functionality
- Add new endpoints to API for additional blob operations (e.g., batch delete, export)
- Update frontend to call new endpoints as needed
- Ensure all new blob operations are secure and validated

---

## 7. References
- [Azure Blob Storage Documentation](https://learn.microsoft.com/en-us/azure/storage/blobs/)
- CardForge API code: `js/cardforge-forge-actions.js`, `js/cardforge-publish.js`, `js/cardforge-template-loader.js`
- CardForge config: `js/config.js`
- Forge Tab implementation: `docs/forge-tab-implementation.md`

---

**© 2025 AmbientPixels – CardForge Team**

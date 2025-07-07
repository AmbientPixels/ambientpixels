# CardForge API Documentation

## Overview

CardForge is a card creation and publishing system for AmbientPixels that allows users to create, save, and publish different types of cards (character, location, item). The system supports both signed-in and anonymous user experiences with appropriate permissions.

## API Naming Convention

All CardForge APIs follow a consistent naming convention:
- Prefix: `cardforge`
- Case: all lowercase
- Example: `cardforgetemplate`, `cardforgeloadcards`, `cardforgesavecards`

## Data Storage

CardForge uses Azure Blob Storage for data persistence:
- **Default Cards**: `default-cards.json` - Contains example cards for logged-out users
- **Published Cards**: `published-cards.json` - Contains cards for the public gallery
- **User Cards**: `user/{userId}/cards.json` - Contains cards for each authenticated user

## API Endpoints

### GET `/api/cardforgetemplate`

Returns a template for creating cards based on the specified type.

**Query Parameters:**
- `type` (string): The type of template to retrieve. Valid values: `character`, `location`, `item`. Default: `character`.

**Response:**
```json
{
  "type": "character",
  "name": "Character Card",
  "description": "Template for creating character cards",
  "theme": "nova-crystalline",
  "fields": {
    "name": {
      "type": "text",
      "label": "Character Name",
      "placeholder": "Enter character name",
      "description": "The name of your character",
      "required": true,
      "maxLength": 30
    },
    // Additional fields...
  }
}
```

**Status Codes:**
- 200: Success
- 400: Invalid template type
- 500: Server error

### GET `/api/cardforgeloadcards`

Loads cards based on the user's authentication status. For signed-in users, returns their personal cards; for anonymous users, returns default cards. Always includes public gallery cards. The response includes `userCards`, `galleryCards`, `defaultCards`, and `diagnostics` information.

**Headers:**
- None required. For authenticated users, ensure requests include credentials (e.g., add `credentials: 'include'` to `fetch` calls) so Azure Static Web Apps EasyAuth can forward the user principal.

**Response:**
```json
{
  "userCards": [ /* array of user card objects */ ],
  "galleryCards": [ /* array of gallery card objects */ ],
  "defaultCards": [ /* array of default card objects for anonymous users */ ],
  "diagnostics": {
    "requestId": "req_1625566400_xk3a4b2",
    "timestamp": "2025-07-07T13:34:40-07:00",
    "authenticated": true,
    "userCardsCount": 2,
    "galleryCardsCount": 5,
    "defaultCardsCount": 3,
    "environment": "Development",
    "storageAccount": "cardforgeblobdata",
    "containerName": "cardforge",
    "defaultCardsPath": "default-cards.json",
    "publishedCardsPath": "published-cards.json",
    "userCardsPath": "user/user-123/cards.json"
  }
}
```

**Data Sources:**
- For authenticated users: `user/{userId}/cards.json` in Blob Storage
- For anonymous users: `default-cards.json` in Blob Storage
- Gallery cards: `published-cards.json` in Blob Storage

**Status Codes:**
- 200: Success
- 500: Server error

### POST `/api/cardforgesavecards`

Saves a card to the user's personal collection. Requires authentication.

**Headers:**
- `Content-Type`: `application/json`
- `X-CSRF-Token` (string): Required for authenticated requests; obtain via `window.authModule.getCsrfToken()`. Ensure `fetch` includes credentials (`credentials: 'include'`).

**Request Body:**
```json
{
  "id": "card-123456", // Optional for new cards
  "name": "Card Name",
  "class": "Card Class",
  "quote": "Card Quote",
  "avatar": "https://example.com/image.jpg",
  "achievement": "Card Achievement"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Card saved successfully",
  "cardId": "card-123456"
}
```

**Status Codes:**
- 200: Success
- 400: Invalid card data
- 401: Authentication required
- 500: Server error

### POST `/api/cardforgepublish`

Publishes a card to the public gallery. Requires authentication.

**Headers:**
- `Content-Type`: `application/json`
- `X-CSRF-Token` (string): Required for authenticated requests; obtain via `window.authModule.getCsrfToken()`. Ensure `fetch` includes credentials (`credentials: 'include'`).

**Request Body:**
```json
{
  "cardId": "card-123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Card card-123456 published successfully",
  "data": {
    "cardId": "card-123456",
    "publishedAt": "2025-07-07T12:00:00Z"
  }
}
```

**Status Codes:**
- 200: Success
- 400: Missing card ID
- 401: Authentication required
- 404: Card not found
- 500: Server error

## Frontend Integration

### JavaScript Modules

- `card-forge.js`: Main CardForge functionality for loading and saving cards
- `cardforge-template-loader.js`: Handles dynamic template loading and form updates
- `cardforge-publish.js`: Handles publishing cards to the gallery
- `debug-utils.js`: Debugging utilities for CardForge APIs

### Authentication Integration

CardForge integrates with the AmbientPixels authentication system via `window.authModule`. The UI adapts based on authentication status:

- Signed-in users: Can save and publish cards
- Anonymous users: Can view public cards and create cards (but not save)

### User Experience

1. Users select a card template type (character, location, item)
2. Form fields update dynamically based on the selected template
3. Users fill in card details and can preview the card
4. Signed-in users can save their cards to their personal collection
5. Saved cards can be published to the public gallery

## Storage

CardForge uses Azure Blob Storage for data persistence:

- User cards: `user/{userId}/cards.json`
- Public gallery: `published-cards.json`

## Future Enhancements

Potential future enhancements for CardForge:

1. Card editing and deletion
2. Card sharing via direct links
3. Card rating and commenting system
4. Advanced card templates with custom fields
5. Card collections and organization

## Development Guidelines

When extending CardForge, follow these guidelines:

1. Maintain the `cardforge` prefix and lowercase naming convention for all APIs
2. Use proper authentication checks for protected operations
3. Validate all user inputs on both client and server
4. Handle both signed-in and anonymous user experiences
5. Follow the existing pattern for API responses and error handling

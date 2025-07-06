# CardForge API Documentation

## Overview

CardForge is a card creation and publishing system for AmbientPixels that allows users to create, save, and publish different types of cards (character, location, item). The system supports both signed-in and anonymous user experiences with appropriate permissions.

## API Naming Convention

All CardForge APIs follow a consistent naming convention:
- Prefix: `cardforge`
- Case: all lowercase
- Example: `cardforgetemplate`, `cardforgeloadcards`, `cardforgesavecards`

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

Loads cards based on the user's authentication status. For signed-in users, returns their personal cards. For anonymous users, returns public gallery cards.

**Headers:**
- `X-User-ID` (string): The user's ID for authentication. If not provided or "anonymous", user is treated as anonymous.

**Response:**
```json
[
  {
    "id": "card-123456",
    "name": "Card Name",
    "class": "Card Class",
    "quote": "Card Quote",
    "avatar": "https://example.com/image.jpg",
    "achievement": "Card Achievement",
    "createdAt": "2025-07-06T12:00:00Z",
    "lastModified": "2025-07-06T12:30:00Z",
    "userId": "user-123"
  }
  // Additional cards...
]
```

**Status Codes:**
- 200: Success
- 500: Server error

### POST `/api/cardforgesavecards`

Saves a card to the user's personal collection. Requires authentication.

**Headers:**
- `X-User-ID` (string): The user's ID for authentication. Required.
- `Content-Type`: `application/json`

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
- `X-User-ID` (string): The user's ID for authentication. Required.
- `Content-Type`: `application/json`

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
  "message": "Card published successfully",
  "publishId": "pub-123456"
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

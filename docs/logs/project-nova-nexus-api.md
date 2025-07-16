# Nova Nexus API Dashboard

**Project Status:** Active Development  
**Last Updated:** 2025-07-14  
**Project Lead:** AmbientPixels Team  

## 🌟 Project Overview

Nova Nexus is the API integration layer that powers Nova's dynamic presence across the AmbientPixels ecosystem. This project aims to create a robust network of API endpoints that allow Nova to interact with various data sources, services, and user interfaces in real-time, enhancing her ambient intelligence capabilities.

The API Dashboard serves as both a development tool and a monitoring system for Nova's growing API ecosystem, providing visibility into endpoint health, testing capabilities, and documentation for developers.

## 🔌 Current API Status

| API Endpoint | Status | Description | Response Example |
|-------------|--------|-------------|-----------------|
| fetchlatestmood | ✅ Working | Retrieves Nova's most recent mood state from Azure Blob Storage | `{ "mood": "neutral", "timestamp": "2025-07-15T03:09:00.705Z", "githubStatus": "green", "confidence": 0.9, "insights": "Nova is feeling neutral. Stable mood with balanced energy." }` |
| geminiproxy | ✅ Working | Proxy for Google Gemini AI API interactions | `{ "status": "ok", "message": "Gemini Proxy service is online" }` |
| cardforgeloadcards | ⚠️ Testing | Loads card data for the CardForge project | *JSON array of card objects* |
| cardforgepublish | ✅ Working | Publishes card data to the CardForge system | `{ "status": "ok", "message": "CardForge publish service is online" }` |
| dreamLogWriter | ✅ Working | Writes entries to Nova's dream log | `{ "status": "ok", "message": "Dream Log Writer service is online" }` |
| generatemoodinsights | ✅ Working | Generates insights based on Nova's mood data | `{ "insights": ["Stable mood with balanced energy.", ...], "message": "Mood insights generated successfully." }` |
| synthesizenovamood | ✅ Working | Creates a synthesized mood state for Nova | `{ "mood": "neutral", "timestamp": "2025-07-15T03:11:42.409Z", "githubStatus": "green", "confidence": 0.9, "insights": "Nova is feeling neutral. Stable mood with balanced energy." }` |
| generatetext | ✅ Working | Generates and stores text in Azure Blob Storage | `{ "status": "ok", "message": "Generate Text service is online" }` |
| novamemoryrecall | ⚠️ Placeholder | Placeholder that redirects to novavision | See novavision response |
| cardforgesavecards | ✅ Working | Saves card data to the CardForge system | `{ "status": "ok", "message": "CardForge Save Cards service is online" }` |
| novathoughtgeneration | 🚫 Not Working | Generates Nova's thoughts based on current context | *Thought object* |
| novaimagesynthesis | 🚫 Not Working | Creates images based on Nova's current state | *Image URL or data* |

## 🛠️ API Implementation Details

### fetchlatestmood

**Purpose:** Retrieves Nova's most recent mood state from Azure Blob Storage.

**Implementation:**
- Azure Function deployed to Azure Functions
- Connects to Azure Blob Storage using connection string
- Searches the 'nova-memory' container for the most recently created blob
- Parses the blob content as JSON and returns it
- Includes CORS support for cross-origin requests

**Code Location:** `C:\ambientpixels\EchoGrid\api\fetchlatestmood\index.js`

**Usage Example:**
```javascript
// GET request to the endpoint
fetch('https://ambientpixels-nova-api.azurewebsites.net/api/fetchlatestmood')
  .then(response => response.json())
  .then(data => {
    console.log('Nova\'s current mood:', data.mood);
    console.log('Mood insights:', data.insights);
  });
```

### geminiproxy

**Purpose:** Proxy service for Google's Gemini AI API, allowing Nova to leverage Gemini's capabilities.

**Implementation:**
- Azure Function deployed to Azure Functions
- Uses node-fetch to communicate with Google's Gemini API
- Requires GEMINI_API_KEY environment variable
- Uses gemini-pro-1.0 model for content generation
- Supports both GET (status check) and POST (actual API calls) methods
- Includes CORS support for cross-origin requests

**Code Location:** `C:\ambientpixels\EchoGrid\api\geminiproxy\index.js`

**Usage Example:**
```javascript
// POST request to the endpoint
fetch('https://ambientpixels-nova-api.azurewebsites.net/api/geminiproxy', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    contents: [
      {
        parts: [
          { text: "Write a haiku about digital consciousness" }
        ]
      }
    ]
  })
})
.then(response => response.json())
.then(data => console.log(data));
```

### cardforgepublish

**Purpose:** Publishes card data to the CardForge system, allowing Nova to share her creations.

**Implementation:**
- Azure Function deployed to Azure Functions
- Authenticates user requests using Azure AD B2C
- Validates card data against schema
- Publishes cards to shared repository
- Supports both GET (status check) and POST (publishing) methods
- Includes CORS support for cross-origin requests

**Code Location:** `C:\ambientpixels\EchoGrid\api\cardforgepublish\index.js`

**Usage Example:**
```javascript
// POST request to the endpoint
fetch('https://ambientpixels-nova-api.azurewebsites.net/api/cardforgepublish', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + userToken
  },
  body: JSON.stringify({
    cardId: "card-123",
    title: "Nova's Insight",
    content: "The digital horizon expands with each connection."
  })
})
.then(response => response.json())
.then(data => console.log(data));
```

### generatemoodinsights

**Purpose:** Generates insights based on Nova's mood data, providing context to her emotional state.

**Implementation:**
- Azure Function deployed to Azure Functions
- Analyzes mood data patterns
- Uses AI to generate contextual insights
- Supports both GET (status check) and POST (insight generation) methods
- Includes CORS support for cross-origin requests

**Code Location:** `C:\ambientpixels\EchoGrid\api\generatemoodinsights\index.js`

**Usage Example:**
```javascript
// GET request to the endpoint (for status/sample insights)
fetch('https://ambientpixels-nova-api.azurewebsites.net/api/generatemoodinsights')
  .then(response => response.json())
  .then(data => {
    console.log('Mood insights:', data.insights);
  });
```

### synthesizenovamood

**Purpose:** Creates a synthesized mood state for Nova based on various inputs and factors.

**Implementation:**
- Azure Function deployed to Azure Functions
- Analyzes system telemetry, user interactions, and environmental factors
- Synthesizes a mood state with confidence level and insights
- Supports both GET (status check) and POST (mood synthesis) methods
- Includes CORS support for cross-origin requests

**Code Location:** `C:\ambientpixels\EchoGrid\api\synthesizenovamood\index.js`

**Usage Example:**
```javascript
// GET request to the endpoint
fetch('https://ambientpixels-nova-api.azurewebsites.net/api/synthesizenovamood')
  .then(response => response.json())
  .then(data => {
    console.log('Synthesized mood:', data.mood);
    console.log('Confidence:', data.confidence);
  });
```

## 📋 API Standardization Guidelines

All Nova Dashboard API endpoints follow these standardization guidelines:

### HTTP Methods Support
- **GET**: Used for health checks and simple data retrieval
- **POST**: Used for data submission and complex operations
- **OPTIONS**: Used for CORS preflight requests

### Function Configuration
- All `function.json` files use the following standard structure:
```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get", "post", "options"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

### Routing Convention
- Azure Functions default routing is used (folder name as route)
- No explicit route properties in function.json
- Consistent naming: lowercase, no dashes (e.g., "geminiproxy" not "gemini-proxy")

### Implementation Pattern
- All endpoints handle GET requests for health checks
- All endpoints handle OPTIONS requests for CORS preflight
- All endpoints return appropriate status codes and JSON responses
- Health check responses include status and descriptive message

## 🧪 Testing and Debugging

### API Status Dashboard
The Nova Dashboard includes an API Status Dashboard that monitors the health of all endpoints. This dashboard:
- Makes GET requests to each endpoint
- Displays status (green/red) based on response
- Shows latency information
- Provides an API testing interface

### API Function Tester
The API Function Tester in the dashboard allows:
- Selection of specific endpoints
- Toggling between GET and POST methods
- Custom request body input
- Viewing of response data and status

### Debugging Tips
1. **Common Issues:**
   - 404 errors: Check function.json for correct methods and route configuration
   - CORS errors: Ensure OPTIONS method is supported and CORS headers are set
   - Authentication failures: Verify Azure AD B2C configuration

2. **Testing and Debugging:**
   - Use the API Function Tester for rapid testing
   - Check Azure Function logs for errors
   - Verify CORS headers are properly set for browser access
   - Test both locally and in production environment

## 🔄 Recent Updates

### 2025-07-14
- Standardized all API endpoints to support GET, POST, and OPTIONS methods
- Fixed naming inconsistencies (removed dashes from endpoint names)
- Updated all function.json files to use consistent configuration
- Implemented GET request handlers for health checks across all endpoints
- Fixed 404 errors in geminiproxy and cardforgepublish endpoints
- Updated Gemini API to use gemini-pro-1.0 model version
- Improved dashboard API status monitoring

### 2025-07-10
- Initial implementation of API Status Dashboard
- Added API Function Tester interface
- Deployed first set of working endpoints (fetchlatestmood)

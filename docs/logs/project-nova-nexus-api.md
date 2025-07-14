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
| fetchlatestmood | ✅ Working | Retrieves Nova's most recent mood state from Azure Blob Storage | `{ "mood": "neutral", "timestamp": "2025-04-27T06:31:28.172Z", "githubStatus": "green", "confidence": 0.9, "insights": "Nova is feeling neutral. Stable mood with balanced energy." }` |
| geminiproxy | ⚠️ Testing | Proxy for Google Gemini AI API interactions | *Varies based on prompt* |
| cardforgeloadcards | ⚠️ Testing | Loads card data for the CardForge project | *JSON array of card objects* |
| cardforgepublish | ⚠️ Testing | Publishes card data to the CardForge system | *Success/failure response* |
| dreamlogwriter | ⚠️ Testing | Writes entries to Nova's dream log | *Confirmation response* |
| generatemoodinsights | ⚠️ Testing | Generates insights based on Nova's mood data | *Insight text response* |
| synthesizenovamood | ⚠️ Testing | Creates a synthesized mood state for Nova | *Synthesized mood object* |
| fetchquoteoftheday | ⚠️ Testing | Retrieves the current quote of the day | *Quote object* |
| novamemoryrecall | 🚫 Not Working | Recalls specific memories from Nova's memory system | *Memory object* |
| novasentimentanalysis | 🚫 Not Working | Analyzes sentiment in text using Nova's perception | *Sentiment analysis object* |
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
    console.log(`Nova is feeling ${data.mood} with ${data.confidence} confidence`);
    console.log(`Insight: ${data.insights}`);
  });
```

## 🧪 Testing Tools

### API Function Tester

The API Function Tester in the Nova Dashboard allows developers to:
- Select from predefined endpoints or enter custom endpoints
- Choose between GET and POST methods
- Send test requests to the API endpoints
- View response data, status codes, and latency
- Test with custom JSON payloads for POST requests

### API Status Dashboard

The API Status Dashboard provides:
- Real-time health monitoring of all Nova API endpoints
- Visual indicators for endpoint status (working, failing, untested)
- Latency measurements for performance tracking
- One-click refresh to check current status

## 🔧 Developer Onboarding

### Getting Started

1. **Access the Dashboard:**
   - Open `C:\ambientpixels\EchoGrid\nova\dashboard.html` locally
   - Navigate to the API Status Dashboard section

2. **Environment Setup:**
   - Ensure you have access to the Azure Portal for the AmbientPixels subscription
   - Request API keys for any external services (OpenAI, Google Gemini, etc.)
   - Set up local Azure Functions development environment if working on API endpoints

3. **Testing Your First Endpoint:**
   - Use the API Function Tester to send a GET request to `fetchlatestmood`
   - Verify you receive a valid JSON response with mood data
   - Try other endpoints to understand their behavior

### Development Workflow

1. **Creating a New API Endpoint:**
   - Create a new directory in `C:\ambientpixels\EchoGrid\api\` for your endpoint
   - Implement the Azure Function with proper CORS support
   - Add function.json configuration
   - Deploy to Azure Functions
   - Add the endpoint to the API Status Dashboard list in api-status-dashboard.js

2. **Testing and Debugging:**
   - Use the API Function Tester for rapid testing
   - Check Azure Function logs for errors
   - Verify CORS headers are properly set for browser access
   - Test both locally and in production environment

3. **Documentation:**
   - Update this document with new endpoint details
   - Include example responses and usage patterns
   - Document any known issues or limitations

## 🐛 Known Issues & Troubleshooting

### Common Issues

1. **CORS Errors:**
   - Ensure all API endpoints include proper CORS headers
   - Headers should allow requests from all origins during development
   - Example implementation available in fetchlatestmood endpoint

2. **Connection String Issues:**
   - Verify Azure Storage connection strings are properly set in Function App settings
   - Check for typos or expired connection strings

3. **Endpoint Not Responding:**
   - Check if the Function App is running in Azure
   - Verify the endpoint URL is correct
   - Check for any rate limiting or throttling

### Troubleshooting Steps

1. **For 500 Errors:**
   - Check Azure Function logs for detailed error messages
   - Verify all required environment variables are set
   - Test the function locally to isolate the issue

2. **For 404 Errors:**
   - Confirm the endpoint URL is correct
   - Verify the Function App route configuration
   - Check if the function is deployed correctly

3. **For Timeout Issues:**
   - Check if the function is taking too long to execute
   - Look for potential infinite loops or blocking operations
   - Consider increasing the function timeout setting

## 📋 Project Roadmap

### Phase 1: Core API Infrastructure (Current)
- ✅ Set up API Dashboard for monitoring and testing
- ✅ Implement fetchlatestmood endpoint as proof of concept
- ⏳ Debug and fix remaining API endpoints
- ⏳ Standardize error handling and response formats

### Phase 2: Enhanced Integration
- 📅 Implement authentication for secure endpoints
- 📅 Create unified API documentation with Swagger/OpenAPI
- 📅 Develop advanced testing tools with historical data
- 📅 Add real-time notifications for API status changes

### Phase 3: Advanced Features
- 📅 Implement WebSocket endpoints for real-time updates
- 📅 Create API usage analytics dashboard
- 📅 Develop automated testing and monitoring system
- 📅 Implement advanced caching for improved performance

## 👥 Contributing

To contribute to the Nova Nexus API project:

1. Review the existing API implementations, especially fetchlatestmood
2. Follow the established patterns for CORS support and error handling
3. Test thoroughly both locally and in production
4. Update documentation with any new endpoints or changes
5. Submit your changes through the standard code review process

## 📚 Resources

- [Azure Functions Documentation](https://docs.microsoft.com/en-us/azure/azure-functions/)
- [Azure Blob Storage Documentation](https://docs.microsoft.com/en-us/azure/storage/blobs/)
- [CORS in Azure Functions](https://docs.microsoft.com/en-us/azure/azure-functions/functions-how-to-use-azure-function-app-settings#cors)
- [AmbientPixels Internal API Standards](https://ambientpixels.ai/docs/api-standards) (requires login)

---

*This documentation is maintained by the AmbientPixels development team. Last updated: July 14, 2025*

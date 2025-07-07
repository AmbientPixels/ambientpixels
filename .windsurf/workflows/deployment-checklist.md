---
description: Azure Static Web App Production Deployment Checklist
---

# Azure Static Web App Production Deployment Checklist

This checklist ensures all critical components are properly configured before final deployment.

## Pre-Deployment Verification

1. Verify Azure Static Web App configuration:
   ```bash
   # Check staticwebapp.config.json for proper settings
   cat staticwebapp.config.json
   ```

2. Verify Application Insights instrumentation key:
   ```bash
   # Confirm the key is properly set in config.js
   cat cardforge/js/config.js | grep instrumentationKey
   ```

3. Test authentication flow:
   ```bash
   # Run the application locally and test login/logout
   npm run start
   ```

4. Verify Azure Functions configuration:
   ```bash
   # Check function.json files for proper bindings and auth levels
   find api -name "function.json" -exec cat {} \;
   ```

## Deployment Steps

1. Commit all changes to the main branch:
   ```bash
   git add .
   git commit -m "Production readiness improvements: auth fixes, CSP, and optimistic concurrency"
   git push origin main
   ```

2. Monitor deployment in Azure Portal:
   - Navigate to your Static Web App resource
   - Check "Deployment history" section
   - Verify build and deployment success

## Post-Deployment Verification

1. Test authentication in production:
   - Navigate to the production URL
   - Verify login/logout functionality
   - Test card creation and publishing

2. Verify Application Insights telemetry:
   ```bash
   # Open Azure Portal and check Application Insights resource
   # Verify data is flowing in from the production application
   ```

3. Check for any 401 errors in Application Insights:
   - Navigate to "Failures" section
   - Filter for HTTP 401 status codes
   - Verify no authentication issues are occurring

## Monitoring Setup

1. Set up alerts in Application Insights:
   - Create alert for HTTP 401 errors
   - Create alert for HTTP 500 errors
   - Create alert for high response time (>1s)

2. Set up availability tests:
   - Create a ping test for the main application URL
   - Create a multi-step test for authentication flow

3. Configure dashboard for key metrics:
   - User sessions
   - API response times
   - Error rates
   - Blob storage operations

// CardForge API Endpoint Test
// Following Windsurf Dev Protocol - Test before modifying

console.log('🌊 Testing CardForge API Endpoints');

// Test API endpoints with graceful error handling
async function testEndpoint(url, options = {}) {
  console.log(`Testing: ${url}`);
  try {
    const response = await fetch(url, options);
    console.log(`Status: ${response.status} ${response.statusText}`);
    if (response.ok) {
      const data = await response.json();
      console.log('Data:', data);
    }
    return response;
  } catch (error) {
    console.error(`Error accessing ${url}:`, error.message);
  }
}

// Main test function
async function runTests() {
  console.log('=== Testing Production Endpoints ===');
  
  // Test gallery endpoint (public)
  await testEndpoint('https://ambientpixels.ai/api/cards');
  
  // Test personal cards endpoint (authenticated)
  await testEndpoint('https://ambientpixels.ai/api/myCards', {
    headers: {
      'X-User-ID': 'test-user-id'
    }
  });
  
  console.log('=== Testing Static Web App Endpoint ===');
  
  // Test gallery endpoint on static web app domain
  await testEndpoint('https://calm-sky-05cc8e110.6.azurestaticapps.net/api/cards');

  console.log('=== All tests completed ===');
}

// Run tests when loaded in browser console
runTests();

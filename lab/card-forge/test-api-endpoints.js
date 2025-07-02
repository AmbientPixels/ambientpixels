// CardForge API Endpoint Test - v1.1
// Following Windsurf Dev Protocol - Replace with Precision

console.log('🌊 Testing CardForge API Endpoints');

// Test API endpoints with graceful error handling
async function testEndpoint(url, options = {}) {
  console.log(`Testing: ${url}`);
  try {
    const response = await fetch(url, options);
    console.log(`Status: ${response.status} ${response.statusText}`);
    if (response.ok) {
      try {
        const data = await response.json();
        console.log('Data:', data);
        return { status: response.status, data };
      } catch (jsonError) {
        console.log('Response not JSON format');
        const text = await response.text();
        console.log('Text response:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
        return { status: response.status, text };
      }
    }
    return { status: response.status };
  } catch (error) {
    console.error(`Error accessing ${url}:`, error.message);
    // For CORS errors, suggest opening directly
    if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
      console.log(`⚠️ CORS error detected. Try opening this URL directly: ${url}`);
    }
    return { error: error.message };
  }
}

// Main test function
async function runTests() {
  console.log('=== Testing Production Endpoints ===');
  
  // Test gallery endpoint (public)
  const galleryResult = await testEndpoint('https://ambientpixels.ai/api/cards');
  
  // Test personal cards endpoint (authenticated)
  const personalResult = await testEndpoint('https://ambientpixels.ai/api/myCards', {
    headers: {
      'X-User-ID': 'test-user-id'
    }
  });
  
  console.log('=== Testing Static Web App Endpoint ===');
  
  // Test gallery endpoint on static web app domain
  await testEndpoint('https://calm-sky-05cc8e110.6.azurestaticapps.net/api/cards');

  console.log('=== Testing Direct Load in New Tab ===');
  console.log('Opening direct URL test in new tab to bypass CORS...');
  window.open('https://calm-sky-05cc8e110.6.azurestaticapps.net/api/cards', '_blank');

  console.log('=== All tests completed ===');
  return { galleryResult, personalResult };
}

// Run tests when loaded in browser console
runTests();

// Helper for manual testing
window.testCardForgeAPI = runTests;

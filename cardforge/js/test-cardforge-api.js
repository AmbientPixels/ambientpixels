/**
 * CardForge API Test Script
 * This script tests the CardForge API endpoints to verify they're working correctly
 */

// Configuration options
const config = {
  debug: true,
  apiBasePath: '/api', // Simulates production environment
  logToConsole: true
};

// Card data for testing
const testCard = {
  id: `test-card-${Date.now()}`,
  name: "Test Card",
  type: "character",
  class: "Tester",
  quote: "Just making sure everything works!",
  avatar: "https://placekitten.com/200/200",
  stats: {
    strength: 10,
    intelligence: 10,
    charisma: 10
  },
  description: "This is a test card created by the API test script."
};

// Initialize test environment
function initTestEnvironment() {
  console.log("🧪 CardForge API Test Script");
  console.log("====================================");
  console.log(`Test started at: ${new Date().toISOString()}`);
  console.log(`API base path: ${config.apiBasePath}`);
}

// Helper function to make API calls
async function callApi(endpoint, method = 'GET', body = null) {
  const fullUrl = `${config.apiBasePath}/${endpoint}`;
  console.log(`Calling ${method} ${fullUrl}`);
  
  const options = {
    method,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Test-Client': 'cardforge-test-script',
      'X-User-Id': 'test-user-1234' // Simulates an authenticated user
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const startTime = Date.now();
    const response = await fetch(fullUrl, options);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`Response status: ${response.status} (took ${duration}ms)`);
    
    // Try to parse response as JSON
    try {
      const data = await response.json();
      console.log("Response data:", data);
      return { 
        success: response.ok, 
        status: response.status, 
        data,
        duration 
      };
    } catch (e) {
      const text = await response.text();
      console.error("Failed to parse JSON response:", text);
      return { 
        success: false, 
        status: response.status, 
        error: "Invalid JSON response", 
        text,
        duration 
      };
    }
  } catch (error) {
    console.error(`API call failed: ${error.message}`);
    return { 
      success: false, 
      error: error.message,
      duration: 0
    };
  }
}

// Test functions for each API
async function testLoadCards() {
  console.log("\n🔍 Testing cardforgeloadcards API...");
  const result = await callApi('cardforgeloadcards');
  
  if (result.success) {
    console.log(`✅ Success! Loaded ${result.data.userCards?.length || 0} user cards and ${result.data.galleryCards?.length || 0} gallery cards`);
    if (result.data.diagnostics) {
      console.log("📊 API Diagnostics:", result.data.diagnostics);
    }
    return true;
  } else {
    console.error("❌ Failed to load cards:", result.error || result.status);
    return false;
  }
}

async function testGetTemplate() {
  console.log("\n📄 Testing cardforgetemplate API...");
  const result = await callApi('cardforgetemplate?type=character');
  
  if (result.success) {
    console.log(`✅ Success! Loaded ${result.data.type} template`);
    return true;
  } else {
    console.error("❌ Failed to get template:", result.error || result.status);
    return false;
  }
}

async function runAllTests() {
  initTestEnvironment();
  
  let passedTests = 0;
  let totalTests = 0;
  
  // Test 1: Load cards
  totalTests++;
  if (await testLoadCards()) passedTests++;
  
  // Test 2: Get template
  totalTests++;
  if (await testGetTemplate()) passedTests++;
  
  // Results
  console.log("\n====================================");
  console.log(`🧪 Test Results: ${passedTests}/${totalTests} tests passed`);
  console.log(`Test completed at: ${new Date().toISOString()}`);
  console.log("====================================");
}

// Run the tests
runAllTests().catch(error => {
  console.error("Test runner failed:", error);
});

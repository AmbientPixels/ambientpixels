// CardForge publish endpoint test script
// Tests publishing API with various authentication formats

const testCardId = 'test-card-' + Date.now();

// Get auth data from DOM (same as production code)
function getAuthData() {
  console.log('Getting auth data...');
  
  // Check if authenticated
  const authState = document.body.getAttribute('data-auth-state');
  console.log(`Auth state: ${authState}`);
  
  let userId = null;
  
  // Try CardForgeAuth (primary method)
  if (window.CardForgeAuth && typeof window.CardForgeAuth.getUserId === 'function') {
    userId = window.CardForgeAuth.getUserId();
    console.log(`CardForgeAuth.getUserId() returned: ${userId}`);
  }
  
  // Try session storage
  const userInfoStr = sessionStorage.getItem('userInfo');
  console.log(`userInfo in sessionStorage: ${userInfoStr ? 'found' : 'not found'}`);
  
  if (userInfoStr) {
    try {
      const userInfo = JSON.parse(userInfoStr);
      console.log('Session storage userInfo:', userInfo);
    } catch (e) {
      console.error('Error parsing userInfo:', e);
    }
  }
  
  // Try localStorage
  const persistentUserId = localStorage.getItem('cardforge_persistent_user_id');
  console.log(`Persistent user ID in localStorage: ${persistentUserId || 'not found'}`);
  
  return {
    userId,
    authState,
    persistentUserId
  };
}

// Test publishing with different header configurations
async function testPublish() {
  const results = document.getElementById('test-results');
  results.innerHTML = '<h3>Running tests...</h3>';
  
  const authData = getAuthData();
  if (!authData.userId) {
    results.innerHTML += '<p class="error">No user ID found. Please sign in first.</p>';
    return;
  }
  
  const testCard = {
    id: testCardId,
    name: 'Test Card',
    description: 'This is a test card created by the debugging tool',
    avatar: 'cyber-erenity.jpg',
    stats: [{label: 'Debug', value: 10}],
    badges: ['test'],
    theme: 'rare',
    style: 'rpg',
    userId: authData.userId
  };
  
  // First, try to save this card to the user's storage
  results.innerHTML += '<h4>Step 1: Saving test card to user storage</h4>';
  
  try {
    const saveResponse = await fetch('/api/saveCardData', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': authData.userId
      },
      body: JSON.stringify([testCard])
    });
    
    const saveResult = await saveResponse.json();
    results.innerHTML += `<p>${saveResponse.ok ? '✅' : '❌'} Save response: ${saveResponse.status} ${saveResponse.statusText}</p>`;
    results.innerHTML += `<pre>${JSON.stringify(saveResult, null, 2)}</pre>`;
  } catch (error) {
    results.innerHTML += `<p class="error">Error saving card: ${error.message}</p>`;
    return;
  }
  
  // Test different header combinations
  const testCases = [
    {
      name: 'Standard case (mixed-case X-User-ID header)',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': authData.userId
      },
      body: {
        cardId: testCardId,
        userId: authData.userId,
        card: testCard
      }
    },
    {
      name: 'Lowercase header (x-user-id)',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': authData.userId
      },
      body: {
        cardId: testCardId,
        userId: authData.userId,
        card: testCard
      }
    },
    {
      name: 'userId in body only (no header)',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        cardId: testCardId,
        userId: authData.userId,
        card: testCard
      }
    },
    {
      name: 'Direct userId in body (not nested)',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        cardId: testCardId,
        userId: authData.userId,
        card: testCard
      }
    },
    {
      name: 'userId as query parameter',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        cardId: testCardId,
        card: testCard
      },
      query: `userId=${encodeURIComponent(authData.userId)}`
    }
  ];
  
  results.innerHTML += '<h4>Step 2: Testing publish with different auth configurations</h4>';
  
  for (const [index, test] of testCases.entries()) {
    results.innerHTML += `<h5>Test ${index + 1}: ${test.name}</h5>`;
    
    try {
      const queryString = test.query ? `?${test.query}` : '';
      const url = `/api/cards/publish/${testCardId}${queryString}`;
      results.innerHTML += `<p>URL: ${url}</p>`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: test.headers,
        body: JSON.stringify(test.body)
      });
      
      let responseText;
      let result;
      
      try {
        result = await response.json();
        responseText = JSON.stringify(result, null, 2);
      } catch (e) {
        responseText = 'Failed to parse response as JSON';
      }
      
      const statusClass = response.ok ? 'success' : 'error';
      results.innerHTML += `<p class="${statusClass}">Status: ${response.status} ${response.statusText}</p>`;
      results.innerHTML += `<p>Headers sent:</p><pre>${JSON.stringify(test.headers, null, 2)}</pre>`;
      results.innerHTML += `<p>Response:</p><pre>${responseText}</pre>`;
    } catch (error) {
      results.innerHTML += `<p class="error">Error: ${error.message}</p>`;
    }
    
    results.innerHTML += '<hr>';
  }
  
  results.innerHTML += '<h4>Test complete!</h4>';
}

// Create UI for the test
function createTestUI() {
  const container = document.createElement('div');
  container.className = 'debug-panel';
  container.style.cssText = 'position: fixed; top: 20px; left: 20px; right: 20px; bottom: 20px; background: rgba(0,0,0,0.8); color: #fff; padding: 20px; z-index: 1000; overflow: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.5);';
  
  container.innerHTML = `
    <h2>CardForge Publish API Debug Tool</h2>
    <button id="run-test" class="glass-button">Run Auth Tests</button>
    <button id="close-debug" class="glass-button mt-2">Close</button>
    <div id="test-results" class="mt-3" style="font-family: monospace;"></div>
  `;
  
  document.body.appendChild(container);
  
  document.getElementById('run-test').addEventListener('click', testPublish);
  document.getElementById('close-debug').addEventListener('click', () => {
    document.body.removeChild(container);
  });
}

// Initialize when loaded
document.addEventListener('DOMContentLoaded', () => {
  const startDebugBtn = document.createElement('button');
  startDebugBtn.id = 'start-debug-btn';
  startDebugBtn.className = 'glass-button fixed';
  startDebugBtn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999;';
  startDebugBtn.innerHTML = '<i class="fas fa-bug"></i> Debug Publish';
  startDebugBtn.addEventListener('click', createTestUI);
  
  document.body.appendChild(startDebugBtn);
  console.log('Publish debug tool initialized');
});

// Start immediately if page already loaded
if (document.readyState !== 'loading') {
  const existingBtn = document.getElementById('start-debug-btn');
  if (!existingBtn) {
    console.log('Page already loaded, initializing debug tool');
    const startDebugBtn = document.createElement('button');
    startDebugBtn.id = 'start-debug-btn';
    startDebugBtn.className = 'glass-button fixed';
    startDebugBtn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999;';
    startDebugBtn.innerHTML = '<i class="fas fa-bug"></i> Debug Publish';
    startDebugBtn.addEventListener('click', createTestUI);
    
    document.body.appendChild(startDebugBtn);
    console.log('Publish debug tool initialized (delayed)');
  }
}

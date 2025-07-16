/**
 * Nova Dashboard API Functionality
 * Created by Cascade 2025-07-10
 * Combines API Function Tester and API Status Dashboard functionality
 */

// Shared API base URL
const PROD_API_BASE = 'https://ambientpixels-nova-api.azurewebsites.net/api/';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize both components
  initApiTester();
  initApiStatusDashboard();
});

/**
 * API Function Tester
 * Handles the API testing form functionality
 */
function initApiTester() {
  // Elements
  const form = document.getElementById('api-tester-form');
  const endpointSelect = document.getElementById('api-endpoint-select');
  const endpointInput = document.getElementById('api-endpoint');
  const methodGetBtn = document.getElementById('api-method-get');
  const methodPostBtn = document.getElementById('api-method-post');
  const methodHidden = document.getElementById('api-method');
  const bodyLabel = document.getElementById('api-body-label');
  const bodyInput = document.getElementById('api-body');
  const statusDot = document.getElementById('api-status-dot');
  const statusText = document.getElementById('api-status-text');
  const latencySpan = document.getElementById('api-latency');
  const resultDiv = document.getElementById('api-test-result');

  // Endpoint dropdown logic
  endpointSelect.addEventListener('change', () => {
    endpointInput.value = endpointSelect.value;
  });
  endpointInput.addEventListener('input', () => {
    if (endpointInput.value !== endpointSelect.value) endpointSelect.value = '';
  });

  // Method toggle logic
  function setMethod(method) {
    methodHidden.value = method;
    if (method === 'GET') {
      methodGetBtn.classList.add('updated-tag');
      methodGetBtn.classList.remove('filter-pill');
      methodPostBtn.classList.remove('updated-tag');
      methodPostBtn.classList.add('filter-pill');
      methodGetBtn.setAttribute('aria-pressed', 'true');
      methodPostBtn.setAttribute('aria-pressed', 'false');
      bodyLabel.classList.add('api-body-hidden');
    } else {
      methodPostBtn.classList.add('updated-tag');
      methodPostBtn.classList.remove('filter-pill');
      methodGetBtn.classList.remove('updated-tag');
      methodGetBtn.classList.add('filter-pill');
      methodPostBtn.setAttribute('aria-pressed', 'true');
      methodGetBtn.setAttribute('aria-pressed', 'false');
      bodyLabel.classList.remove('api-body-hidden');
    }
  }
  methodGetBtn.addEventListener('click', () => setMethod('GET'));
  methodPostBtn.addEventListener('click', () => setMethod('POST'));
  setMethod('GET');

  // Form submit logic
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusDot.classList.remove('api-status-dot');
    statusDot.className = 'soon-tag';
    statusText.textContent = 'Loading...';
    latencySpan.textContent = '';
    resultDiv.textContent = '';
    
    const endpoint = endpointInput.value.trim().replace(/^(\/api\/)?/, '');
    const method = methodHidden.value;
    let options = { method };
    
    if (method === 'POST') {
      try {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = bodyInput.value ? JSON.stringify(JSON.parse(bodyInput.value)) : '{}';
      } catch {
        statusText.textContent = 'Invalid JSON in body.';
        statusDot.className = 'filter-pill';
        return;
      }
    }
    
    const url = PROD_API_BASE + endpoint;
    const t0 = performance.now();
    
    try {
      const res = await fetch(url, options);
      const latency = Math.round(performance.now() - t0);
      let text = await res.text();
      
      try { 
        text = JSON.stringify(JSON.parse(text), null, 2); 
      } catch {}
      
      statusDot.className = res.ok ? 'updated-tag' : 'filter-pill';
      statusText.textContent = `Status: ${res.status} (${res.statusText})`;
      latencySpan.textContent = `Latency: ${latency}ms`;
      
      // Create pre element with proper styling
      const pre = document.createElement('pre');
      pre.className = 'api-result-pre';
      pre.textContent = text;
      resultDiv.innerHTML = '';
      resultDiv.appendChild(pre);
    } catch (err) {
      statusDot.className = 'filter-pill';
      statusText.textContent = 'Request failed: ' + err;
      latencySpan.textContent = '';
      resultDiv.textContent = '';
    }
  });
}

/**
 * API Status Dashboard
 * Displays the health status of Nova API endpoints in a visual dashboard
 */
function initApiStatusDashboard() {
  // API endpoints to monitor
  const apiEndpoints = [
    'geminiproxy', // Updated by Cascade 2025-07-14: removed dash for consistency with folder name
    'cardforgeloadcards',
    'cardforgepublish',
    'fetchlatestmood',
    'dreamLogWriter', // Updated by Cascade 2025-07-15: using correct camelCase name
    'generatemoodinsights',
    'synthesizenovamood',
    'generatetext', // Updated by Cascade 2025-07-15: replaced fetchquoteoftheday with generatetext
    'novamemoryrecall',
    'novasentimentanalysis',
    'novathoughtgeneration',
    'novaimagesynthesis'
  ];
  
  const apiStatusGrid = document.getElementById('api-status-grid');
  const refreshButton = document.getElementById('refresh-api-status');
  const lastCheckTime = document.getElementById('last-check-time');
  
  // Create API status cards
  function createApiStatusCards() {
    apiStatusGrid.innerHTML = '';
    apiEndpoints.forEach(endpoint => {
      const card = document.createElement('div');
      card.className = 'api-status-card';
      card.id = `status-card-${endpoint}`;
      
      card.innerHTML = `
        <div class="api-status-header">
          <div class="api-status-name">${endpoint}</div>
          <div class="api-status-indicator untested" id="indicator-${endpoint}"></div>
        </div>
        <div class="api-status-details">
          <div id="status-${endpoint}">Status: Untested</div>
          <div class="api-status-latency" id="latency-${endpoint}">Latency: --</div>
        </div>
      `;
      
      apiStatusGrid.appendChild(card);
    });
  }
  
  /* updated by Cascade 2025-07-14 - improved API status checking */
  // Check API status
  async function checkApiStatus(endpoint) {
    const statusCard = document.getElementById(`status-card-${endpoint}`);
    const indicatorEl = document.getElementById(`indicator-${endpoint}`);
    const statusEl = document.getElementById(`status-${endpoint}`);
    const latencyEl = document.getElementById(`latency-${endpoint}`);
    
    statusEl.textContent = 'Status: Checking...';
    
    // Special handling for cardforgeloadcards endpoint which may take longer to respond
    // Use a longer timeout for this specific endpoint
    
    const t0 = performance.now();
    try {
      // Use a controller for better timeout handling
      const controller = new AbortController();
      // Use a longer timeout for cardforgeloadcards endpoint
      const timeoutMs = endpoint === 'cardforgeloadcards' ? 15000 : 5000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      // Special handling for dreamLogWriter endpoint which uses camelCase in Azure
      /* updated by Cascade 2025-07-15 */
      let apiEndpoint = endpoint;
      if (endpoint === 'dreamlogwriter') {
        apiEndpoint = 'dreamLogWriter'; // Use camelCase for the actual API call
      }
      
      const response = await fetch(`${PROD_API_BASE}${apiEndpoint}`, { 
        method: 'GET',
        signal: controller.signal,
        // Add cache control to prevent stale responses
        cache: 'no-cache',
        headers: {
          'Accept': 'application/json',
          'X-Dashboard-Check': 'true'
        }
      });
      
      // Clear the timeout
      clearTimeout(timeoutId);
      
      const latency = Math.round(performance.now() - t0);
      latencyEl.textContent = `Latency: ${latency}ms`;
      
      // Only check for HTTP 200 status, don't validate response data
      if (response.ok) {
        indicatorEl.className = 'api-status-indicator ok';
        statusEl.textContent = `Status: ${response.status} OK`;
        
        // Log successful response but don't require valid JSON or non-empty arrays
        try {
          // Just try to read the response but don't do anything with it
          // This confirms we can read the body without errors
          const text = await response.text();
          
          // Optional: Log response size for debugging
          if (text && text.length > 0) {
            console.debug(`API ${endpoint} returned ${text.length} bytes`);
          }
        } catch (parseError) {
          console.warn(`API ${endpoint} returned 200 but had invalid response format:`, parseError);
          // Still show green since HTTP status is OK
        }
      } else {
        indicatorEl.className = 'api-status-indicator fail';
        statusEl.textContent = `Status: ${response.status} Error`;
        console.warn(`API ${endpoint} returned non-OK status:`, response.status);
      }
    } catch (error) {
      indicatorEl.className = 'api-status-indicator fail';
      
      // Provide more specific error messages
      if (error.name === 'AbortError') {
        statusEl.textContent = 'Status: Timeout';
        console.warn(`API ${endpoint} timed out after 5000ms`);
      } else {
        statusEl.textContent = 'Status: Failed';
        console.error(`API ${endpoint} check failed:`, error);
      }
      
      latencyEl.textContent = 'Latency: --';
    }
  }
  
  // Check all API endpoints
  async function checkAllApiStatus() {
    lastCheckTime.textContent = `Last check: ${new Date().toLocaleTimeString()}`;
    
    // Check each endpoint with a slight delay to avoid overwhelming the server
    for (const endpoint of apiEndpoints) {
      await checkApiStatus(endpoint);
      // Small delay between checks
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  // Initialize API status cards
  createApiStatusCards();
  
  // Set up refresh button
  refreshButton.addEventListener('click', () => {
    checkAllApiStatus();
  });
  
  // Initial check after a short delay
  setTimeout(() => {
    checkAllApiStatus();
  }, 1000);
}

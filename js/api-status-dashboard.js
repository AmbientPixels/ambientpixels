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
    'dreamlogwriter',
    'generatemoodinsights',
    'synthesizenovamood',
    'fetchquoteoftheday',
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
  
  // Check API status
  async function checkApiStatus(endpoint) {
    const indicatorEl = document.getElementById(`indicator-${endpoint}`);
    const statusEl = document.getElementById(`status-${endpoint}`);
    const latencyEl = document.getElementById(`latency-${endpoint}`);
    
    // Set to loading state
    indicatorEl.className = 'api-status-indicator loading';
    statusEl.textContent = 'Status: Checking...';
    
    const t0 = performance.now();
    try {
      const response = await fetch(`${PROD_API_BASE}${endpoint}`, { 
        method: 'GET',
        // Add a timeout to avoid hanging requests
        signal: AbortSignal.timeout(5000)
      });
      
      const latency = Math.round(performance.now() - t0);
      latencyEl.textContent = `Latency: ${latency}ms`;
      
      if (response.ok) {
        indicatorEl.className = 'api-status-indicator ok';
        statusEl.textContent = `Status: ${response.status} OK`;
      } else {
        indicatorEl.className = 'api-status-indicator fail';
        statusEl.textContent = `Status: ${response.status} Error`;
      }
    } catch (error) {
      indicatorEl.className = 'api-status-indicator fail';
      statusEl.textContent = 'Status: Failed';
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

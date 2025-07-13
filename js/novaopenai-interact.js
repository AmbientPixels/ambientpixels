// novaopenai-interact.js
// Handles UI and logic for the NovaOpenAI Azure Function interaction section
// Added by Cascade 2025-07-12
console.log("[Cascade Debug] Loaded novaopenai-interact.js"); // updated by Cascade 2025-07-12

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Cascade Debug] DOMContentLoaded fired'); // updated by Cascade 2025-07-12
  const form = document.getElementById('novaopenai-interact-form');
  if (!form) {
    console.log('[Cascade Debug] Form not found: #novaopenai-interact-form'); // updated by Cascade 2025-07-12
    return;
  }

  const opSelect = document.getElementById('novaopenai-operation');
  const depInput = document.getElementById('novaopenai-deployment');
  const payloadInput = document.getElementById('novaopenai-payload');
  const statusDot = document.getElementById('novaopenai-status-dot');
  const statusText = document.getElementById('novaopenai-status-text');
  const latencyEl = document.getElementById('novaopenai-latency');
  const requestEl = document.getElementById('novaopenai-request');
  const responseEl = document.getElementById('novaopenai-response');
  console.log('[Cascade Debug] DOM lookups:', {
    opSelect, depInput, payloadInput, statusDot, statusText, latencyEl, requestEl, responseEl
  }); // updated by Cascade 2025-07-12

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('[Cascade Debug] Form submit initiated'); // updated by Cascade 2025-07-12
    statusDot.style.background = '#999';
    statusText.textContent = 'Sending...';
    latencyEl.textContent = '';
    requestEl.textContent = '';
    responseEl.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnHTML = submitBtn.innerHTML;
    submitBtn.disabled = true; // Disable submit during request
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...'; // Show loading spinner
    // updated by Cascade 2025-07-12
    let payload;
    try {
      console.log('[Cascade Debug] Payload input value:', payloadInput.value); // updated by Cascade 2025-07-12
      payload = JSON.parse(payloadInput.value.trim()); // Trim whitespace before parsing
      console.log('[Cascade Debug] Parsed payload:', payload); // updated by Cascade 2025-07-12
      // updated by Cascade 2025-07-12
    } catch (err) {
      console.log('[Cascade Debug] JSON parse error (payload):', err); // updated by Cascade 2025-07-12
      statusDot.style.background = '#e74c3c';
      statusText.textContent = 'Invalid JSON in payload.';
      responseEl.textContent = err.toString();
      submitBtn.disabled = false; // Re-enable submit on error
      submitBtn.innerHTML = originalBtnHTML; // Restore original button content
      // updated by Cascade 2025-07-12
      return;
    }

    const body = {
      operation: opSelect.value,
      deploymentId: depInput.value || 'gpt-4o-nova',
      payload
    };
    console.log('[Cascade Debug] Request body:', body); // updated by Cascade 2025-07-12
    requestEl.textContent = 'Request: ' + JSON.stringify(body, null, 2);
    const t0 = performance.now();
    try {
      console.log('[Cascade Debug] Sending fetch to /api/novaopenai'); // updated by Cascade 2025-07-12
      const res = await fetch('/api/novaopenai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      console.log('[Cascade Debug] Fetch response object:', res); // updated by Cascade 2025-07-12
      const t1 = performance.now();
      latencyEl.textContent = `Latency: ${(t1 - t0).toFixed(0)}ms`;
      statusDot.style.background = res.ok ? '#27ae60' : '#e67e22';
      statusText.textContent = res.status + ' ' + res.statusText;
      const raw = await res.text();
      console.log("[Cascade Debug] Raw response:", raw); // updated by Cascade 2025-07-12
      try {
        const data = JSON.parse(raw);
        if (data.error) {
          console.log('[Cascade Debug] API error object received:', data); // updated by Cascade 2025-07-12
          responseEl.textContent = 'API Error: ' + JSON.stringify(data, null, 2);
          statusDot.style.background = '#e74c3c';
          statusText.textContent = 'API Error';
        } else {
          console.log('[Cascade Debug] Successful API response:', data); // updated by Cascade 2025-07-12
          responseEl.textContent = 'Response: ' + JSON.stringify(data, null, 2);
        }
      } catch (jsonErr) {
        console.log("[Cascade Debug] JSON parse error (response):", jsonErr); // updated by Cascade 2025-07-12
        responseEl.textContent = 'Error: ' + raw;
        statusDot.style.background = '#e74c3c';
        statusText.textContent = 'Invalid Response';
      }
      // updated by Cascade 2025-07-12
      // updated by Cascade 2025-07-12
      // updated by Cascade 2025-07-12
    } catch (err) {
      statusDot.style.background = '#e74c3c';
      statusText.textContent = 'Error';
      responseEl.textContent = err.toString();
      // updated by Cascade 2025-07-12
    }
    submitBtn.disabled = false; // Re-enable submit after request
    submitBtn.innerHTML = originalBtnHTML; // Restore original button content
    console.log('[Cascade Debug] Submit handler complete'); // updated by Cascade 2025-07-12
    // updated by Cascade 2025-07-12
  });
});
// updated by Cascade 2025-07-12

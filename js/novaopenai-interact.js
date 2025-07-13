// novaopenai-interact.js
// Handles UI and logic for the NovaOpenAI Azure Function interaction section
// Added by Cascade 2025-07-12

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('novaopenai-interact-form');
  if (!form) return;

  const opSelect = document.getElementById('novaopenai-operation');
  const depInput = document.getElementById('novaopenai-deployment');
  const payloadInput = document.getElementById('novaopenai-payload');
  const statusDot = document.getElementById('novaopenai-status-dot');
  const statusText = document.getElementById('novaopenai-status-text');
  const latencyEl = document.getElementById('novaopenai-latency');
  const requestEl = document.getElementById('novaopenai-request');
  const responseEl = document.getElementById('novaopenai-response');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
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
      payload = JSON.parse(payloadInput.value.trim()); // Trim whitespace before parsing
      // updated by Cascade 2025-07-12
    } catch (err) {
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
    requestEl.textContent = 'Request: ' + JSON.stringify(body, null, 2);
    const t0 = performance.now();
    try {
      const res = await fetch('/api/novaopenai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const t1 = performance.now();
      latencyEl.textContent = `Latency: ${(t1 - t0).toFixed(0)}ms`;
      statusDot.style.background = res.ok ? '#27ae60' : '#e67e22';
      statusText.textContent = res.status + ' ' + res.statusText;
      const raw = await res.text();
      try {
        const data = JSON.parse(raw);
        responseEl.textContent = 'Response: ' + JSON.stringify(data, null, 2);
      } catch (jsonErr) {
        responseEl.textContent = 'Error: ' + raw;
      }
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
    // updated by Cascade 2025-07-12
  });
});
// updated by Cascade 2025-07-12

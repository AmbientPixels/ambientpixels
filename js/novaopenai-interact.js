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

    let payload;
    try {
      payload = JSON.parse(payloadInput.value);
    } catch (err) {
      statusDot.style.background = '#e74c3c';
      statusText.textContent = 'Invalid JSON in payload.';
      responseEl.textContent = err.toString();
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
      const data = await res.json();
      responseEl.textContent = 'Response: ' + JSON.stringify(data, null, 2);
    } catch (err) {
      statusDot.style.background = '#e74c3c';
      statusText.textContent = 'Error';
      responseEl.textContent = err.toString();
    }
  });
});
// updated by Cascade 2025-07-12

// novaopenai-interact.js
// Minimal, robust Azure OpenAI frontend integration (rebuilt from scratch 2025-07-12)

window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('novaopenai-interact-form');
  const opSelect = document.getElementById('novaopenai-operation');
  const depInput = document.getElementById('novaopenai-deployment');
  const payloadInput = document.getElementById('novaopenai-payload');
  const statusDot = document.getElementById('novaopenai-status-dot');
  const statusText = document.getElementById('novaopenai-status-text');
  const latencyEl = document.getElementById('novaopenai-latency');
  const requestEl = document.getElementById('novaopenai-request');
  const responseEl = document.getElementById('novaopenai-response');

  if (!form || !opSelect || !depInput || !payloadInput || !statusDot || !statusText || !latencyEl || !requestEl || !responseEl) {
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusDot.style.background = '#999';
    statusText.textContent = 'Sending...';
    latencyEl.textContent = '';
    requestEl.textContent = '';
    responseEl.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }

    // Validate JSON payload
    let payload;
    try {
      payload = JSON.parse(payloadInput.value.trim());
    } catch (err) {
      statusDot.style.background = '#e74c3c';
      statusText.textContent = 'Invalid JSON';
      responseEl.textContent = 'JSON parse error: ' + err.message;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHTML;
      }
      return;
    }

    // Build request body
    const body = {
      operation: opSelect.value,
      deploymentId: depInput.value || 'gpt-4o-nova',
      payload
    };
    requestEl.textContent = JSON.stringify(body, null, 2);
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
        responseEl.textContent = JSON.stringify(data, null, 2);
      } catch {
        responseEl.textContent = raw;
      }
    } catch (err) {
      statusDot.style.background = '#e74c3c';
      statusText.textContent = 'Network error';
      responseEl.textContent = err.message;
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHTML;
      }
    }
  });
});

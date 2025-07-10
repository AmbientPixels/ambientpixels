// File: /js/nova-ai.js – Non-module safe version

async function generateNovaText(prompt) {
  try {
    const res = await fetch('/api/generate-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();

    if (!res.ok || !data.text) {
      console.warn('[Nova AI] Error:', data.error || 'No text returned');
      return '⚠️ Unable to generate response.';
    }

    return data.text.trim();
  } catch (err) {
    console.error('[Nova AI] Fetch failed:', err);
    return '⚠️ Connection to Nova AI failed.';
  }
}

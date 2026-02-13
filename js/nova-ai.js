// File: /js/nova-ai.js – Non-module safe version
// Refactored to use NovaSoul engine when available

async function generateNovaText(prompt) {
  // Delegate to NovaSoul if available (AI-persistent mode)
  if (typeof NovaSoul !== 'undefined' && NovaSoul.isAwake()) {
    try {
      const reply = await NovaSoul.chat(prompt);
      if (reply) return reply;
    } catch (err) {
      console.warn('[Nova AI] NovaSoul fallback:', err.message);
    }
  }

  // Fallback: call novachat endpoint directly
  try {
    const endpoint = window.location.hostname.includes('ambientpixels.ai')
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api/novachat'
      : '/api/novachat';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, mode: 'chat' })
    });

    const data = await res.json();

    if (!res.ok || !data.reply) {
      console.warn('[Nova AI] Error:', data.error || 'No reply returned');
      return 'Nova encountered a glitch in the signal...';
    }

    return data.reply.trim();
  } catch (err) {
    console.error('[Nova AI] Fetch failed:', err);
    return 'Nova could not connect. The signal fades...';
  }
}

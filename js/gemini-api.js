// gemini-api.js
// Modular utility for interacting with Gemini API via backend proxy or direct (dev only)
// Usage: import { sendGeminiPrompt } from './gemini-api.js';

/**
 * Sends a prompt to Gemini API via backend proxy.
 * @param {string} prompt - The text prompt to send.
 * @param {object} [options] - Optional parameters (model, temperature, etc.)
 * @returns {Promise<object>} Gemini API response JSON
 */
export async function sendGeminiPrompt(prompt, options = {}) {
  const endpoint = '/api/gemini-proxy'; // Always use proxy for production
  const payload = {
    prompt,
    ...options
  };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Gemini API error: ' + response.status);
    return await response.json();
  } catch (error) {
    console.error('[Gemini API]', error);
    throw error;
  }
}

// For local/dev direct calls (not recommended for production, exposes API key!)
// Uncomment and configure if needed:
// export async function sendGeminiPromptDirect(prompt, options = {}) {
//   const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=YOUR_API_KEY';
//   // ...rest of fetch logic
// }

// File: /js/nova-ai.js – Nova AI Client Fetch Module

/**
 * Send a prompt to Nova's backend AI generator.
 * @param {string} prompt - The prompt to send to Hugging Face via Azure Function.
 * @returns {Promise<string>} - The AI-generated response text.
 */
export async function generateNovaText(prompt) {
    try {
      const res = await fetch('https://ambientpixels-meme-api-fn.azurewebsites.net/api/generate-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
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
  
  // Example use (for dev):
  // generateNovaText("What is the sound of static electricity?").then(console.log);
  
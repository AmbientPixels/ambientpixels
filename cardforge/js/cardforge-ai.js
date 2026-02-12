/* CardForge AI Generator
 * Hooks into Gemini proxy to auto-generate card quote and biography
 * from the card's name, class, and rarity fields.
 * Created: 2025-02-12
 */

(function () {
  'use strict';

  const GEMINI_ENDPOINT = 'https://ambientpixels-nova-api.azurewebsites.net/api/geminiproxy';

  // ===== DOM REFERENCES =====
  function getFields() {
    return {
      name: document.getElementById('card-name'),
      cardClass: document.getElementById('card-class'),
      rarity: document.getElementById('card-rarity'),
      quote: document.getElementById('card-quote'),
      bio: document.getElementById('card-bio')
    };
  }

  // ===== PROMPT BUILDER =====
  function buildPrompt(name, cardClass, rarity) {
    return [
      'You are a creative trading-card writer for a fantasy / sci-fi card game.',
      'Given the following card details, generate TWO things:',
      '1. A short, punchy quote or tagline (max 120 characters).',
      '2. A vivid biography paragraph (max 220 characters) that hints at the character\'s backstory.',
      '',
      `Card Name: ${name}`,
      cardClass ? `Class / Type: ${cardClass}` : '',
      rarity ? `Rarity: ${rarity}` : '',
      '',
      'Return ONLY valid JSON in this exact format (no markdown, no code fences):',
      '{"quote":"...","biography":"..."}'
    ].filter(Boolean).join('\n');
  }

  // ===== GEMINI CALL =====
  async function callGemini(prompt) {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `API error ${res.status}`);
    }

    const data = await res.json();
    // Gemini response structure: data.candidates[0].content.parts[0].text
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('No text in Gemini response');
    return raw;
  }

  // ===== PARSE RESPONSE =====
  function parseAIResponse(raw) {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Fallback: try to extract quote and biography from freeform text
      const quoteMatch = cleaned.match(/"quote"\s*:\s*"([^"]+)"/);
      const bioMatch = cleaned.match(/"biography"\s*:\s*"([^"]+)"/);
      if (quoteMatch || bioMatch) {
        return {
          quote: quoteMatch ? quoteMatch[1] : '',
          biography: bioMatch ? bioMatch[1] : ''
        };
      }
      console.warn('[CardForge AI] Could not parse response:', cleaned);
      throw new Error('Could not parse AI response');
    }
  }

  // ===== UI STATE HELPERS =====
  function setButtonState(btn, state) {
    const icon = btn.querySelector('.cf-ai-btn-icon');
    const label = btn.querySelector('.cf-ai-btn-label');

    switch (state) {
      case 'loading':
        btn.disabled = true;
        btn.classList.add('cf-ai-loading');
        if (icon) icon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        if (label) label.textContent = 'Generating...';
        break;
      case 'success':
        btn.disabled = false;
        btn.classList.remove('cf-ai-loading');
        btn.classList.add('cf-ai-success');
        if (icon) icon.innerHTML = '<i class="fas fa-check"></i>';
        if (label) label.textContent = 'Generated!';
        setTimeout(() => resetButton(btn), 2000);
        break;
      case 'error':
        btn.disabled = false;
        btn.classList.remove('cf-ai-loading');
        btn.classList.add('cf-ai-error');
        if (icon) icon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
        if (label) label.textContent = 'Failed — Retry';
        setTimeout(() => resetButton(btn), 3000);
        break;
      default:
        resetButton(btn);
    }
  }

  function resetButton(btn) {
    btn.disabled = false;
    btn.classList.remove('cf-ai-loading', 'cf-ai-success', 'cf-ai-error');
    const icon = btn.querySelector('.cf-ai-btn-icon');
    const label = btn.querySelector('.cf-ai-btn-label');
    if (icon) icon.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i>';
    if (label) label.textContent = 'AI Generate';
  }

  // ===== MAIN HANDLER =====
  async function handleAIGenerate(btn) {
    const fields = getFields();
    const name = fields.name?.value?.trim();

    if (!name) {
      // Briefly highlight the name field
      fields.name?.focus();
      fields.name?.classList.add('cf-ai-highlight');
      setTimeout(() => fields.name?.classList.remove('cf-ai-highlight'), 1500);
      return;
    }

    const cardClass = fields.cardClass?.value?.trim() || '';
    const rarity = fields.rarity?.value?.trim() || '';
    const prompt = buildPrompt(name, cardClass, rarity);

    setButtonState(btn, 'loading');

    try {
      const raw = await callGemini(prompt);
      const result = parseAIResponse(raw);

      // Populate fields
      if (result.quote && fields.quote) {
        fields.quote.value = result.quote;
        fields.quote.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (result.biography && fields.bio) {
        fields.bio.value = result.biography;
        fields.bio.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Trigger preview update if available
      if (window.CardForgeEditor?.updateCardPreview) {
        window.CardForgeEditor.updateCardPreview();
      }

      setButtonState(btn, 'success');
    } catch (err) {
      console.error('[CardForge AI] Generation failed:', err);
      setButtonState(btn, 'error');
    }
  }

  // ===== INIT =====
  function init() {
    const btn = document.getElementById('cf-ai-generate-btn');
    if (!btn) return;
    btn.addEventListener('click', () => handleAIGenerate(btn));
  }

  // Run on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

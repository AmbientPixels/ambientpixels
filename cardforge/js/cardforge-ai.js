/* CardForge AI Generator
 * Full AI card generation: text fields + artwork via Gemini.
 * Supports two modes:
 *   1. Quick Generate — fills quote + biography from existing name/class/rarity
 *   2. Full Card — generates ALL fields + card artwork from a freeform prompt
 * Created: 2025-02-12 | Expanded: 2025-02-12
 */

(function () {
  'use strict';

  const GEMINI_ENDPOINT = 'https://ambientpixels-nova-api.azurewebsites.net/api/geminiproxy';
  const TEXT_MODEL = 'gemini-2.0-flash';
  const IMAGE_MODEL = 'gemini-2.5-flash-image';

  // ===== DOM REFERENCES =====
  function getFields() {
    return {
      name: document.getElementById('card-name'),
      cardClass: document.getElementById('card-class'),
      rarity: document.getElementById('card-rarity'),
      level: document.getElementById('card-level'),
      quote: document.getElementById('card-quote'),
      bio: document.getElementById('card-bio'),
      avatar: document.getElementById('card-avatar')
    };
  }

  // ===== GEMINI CALLS =====
  async function callGemini(prompt, opts = {}) {
    const payload = { prompt };
    if (opts.model) payload.model = opts.model;
    if (opts.generationConfig) payload.generationConfig = opts.generationConfig;

    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[CardForge AI] Response status:', res.status, 'Body:', errText);
      let errObj = {};
      try { errObj = JSON.parse(errText); } catch (e) { /* not JSON */ }
      throw new Error(errObj.error || `API error ${res.status}`);
    }

    return res.json();
  }

  function extractText(data) {
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('No text in Gemini response');
    return raw;
  }

  function extractImage(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
        return {
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png'
        };
      }
    }
    return null;
  }

  // ===== PARSE JSON RESPONSE =====
  function parseJSON(raw) {
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn('[CardForge AI] JSON parse failed, trying regex fallback');
      const obj = {};
      const keys = ['name', 'class', 'rarity', 'level', 'quote', 'biography', 'imagePrompt'];
      keys.forEach(k => {
        const m = cleaned.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`, 'i'));
        if (m) obj[k] = m[1];
      });
      // Try numeric level
      const lvl = cleaned.match(/"level"\s*:\s*(\d+)/i);
      if (lvl) obj.level = parseInt(lvl[1], 10);
      if (Object.keys(obj).length > 0) return obj;
      throw new Error('Could not parse AI response');
    }
  }

  // ===== PROMPT BUILDERS =====
  function buildQuoteBioPrompt(name, cardClass, rarity) {
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

  function buildFullCardPrompt(userPrompt) {
    return [
      'You are a creative trading-card designer for a fantasy / sci-fi card game.',
      'Based on the user\'s description below, generate a COMPLETE card with these fields:',
      '',
      '- name: Character name (max 30 chars)',
      '- class: Class or type, e.g. "Ranger", "Mage", "Artifact" (max 25 chars)',
      '- rarity: One of "Common", "Uncommon", "Rare", "Epic", "Legendary"',
      '- level: A number 1-100 appropriate to the rarity',
      '- quote: A punchy tagline (max 120 chars)',
      '- biography: A vivid backstory hint (max 220 chars)',
      '- imagePrompt: A detailed visual description for generating the card artwork (max 200 chars). Describe the character\'s appearance, pose, and mood. Do NOT include text or card frames.',
      '',
      `User Description: ${userPrompt}`,
      '',
      'Return ONLY valid JSON (no markdown, no code fences):',
      '{"name":"...","class":"...","rarity":"...","level":0,"quote":"...","biography":"...","imagePrompt":"..."}'
    ].join('\n');
  }

  // ===== UI STATE HELPERS =====
  function setButtonState(btn, state, labelText) {
    const icon = btn.querySelector('.cf-ai-btn-icon') || btn.querySelector('.roll-icon');
    const label = btn.querySelector('.cf-ai-btn-label') || btn.querySelector('.roll-label');

    btn.classList.remove('cf-ai-loading', 'cf-ai-success', 'cf-ai-error');

    switch (state) {
      case 'loading':
        btn.disabled = true;
        btn.classList.add('cf-ai-loading');
        if (icon) icon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        if (label) label.textContent = labelText || 'Generating...';
        break;
      case 'success':
        btn.disabled = false;
        btn.classList.add('cf-ai-success');
        if (icon) icon.innerHTML = '<i class="fas fa-check"></i>';
        if (label) label.textContent = labelText || 'Generated!';
        setTimeout(() => resetButton(btn), 2500);
        break;
      case 'error':
        btn.disabled = false;
        btn.classList.add('cf-ai-error');
        if (icon) icon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
        if (label) label.textContent = labelText || 'Failed — Retry';
        setTimeout(() => resetButton(btn), 3000);
        break;
      default:
        resetButton(btn);
    }
  }

  function resetButton(btn) {
    btn.disabled = false;
    btn.classList.remove('cf-ai-loading', 'cf-ai-success', 'cf-ai-error');
    const icon = btn.querySelector('.cf-ai-btn-icon') || btn.querySelector('.roll-icon');
    const label = btn.querySelector('.cf-ai-btn-label') || btn.querySelector('.roll-label');
    const defaultIcon = btn.dataset.defaultIcon || 'fa-wand-magic-sparkles';
    const defaultLabel = btn.dataset.defaultLabel || 'AI Generate';
    if (icon) icon.innerHTML = `<i class="fas ${defaultIcon}"></i>`;
    if (label) label.textContent = defaultLabel;
  }

  // ===== SET FIELD VALUE =====
  function setField(el, value) {
    if (!el || value == null) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function triggerPreviewUpdate() {
    if (window.CardForgeEditor?.updateCardPreview) {
      window.CardForgeEditor.updateCardPreview();
    }
  }

  // ===== HANDLER: Quick Generate (quote + bio) =====
  async function handleQuickGenerate(btn) {
    const fields = getFields();
    const name = fields.name?.value?.trim();

    if (!name) {
      fields.name?.focus();
      fields.name?.classList.add('cf-ai-highlight');
      setTimeout(() => fields.name?.classList.remove('cf-ai-highlight'), 1500);
      return;
    }

    const cardClass = fields.cardClass?.value?.trim() || '';
    const rarity = fields.rarity?.value?.trim() || '';
    const prompt = buildQuoteBioPrompt(name, cardClass, rarity);

    setButtonState(btn, 'loading');

    try {
      const data = await callGemini(prompt, { model: TEXT_MODEL });
      const result = parseJSON(extractText(data));
      const fields2 = getFields();
      setField(fields2.quote, result.quote);
      setField(fields2.bio, result.biography);
      triggerPreviewUpdate();
      setButtonState(btn, 'success');
    } catch (err) {
      console.error('[CardForge AI] Quick generate failed:', err);
      setButtonState(btn, 'error');
    }
  }

  // ===== HANDLER: Full Card Generate =====
  async function handleFullCardGenerate(btn) {
    const promptInput = document.getElementById('cf-ai-prompt');
    const userPrompt = promptInput?.value?.trim();

    if (!userPrompt) {
      promptInput?.focus();
      promptInput?.classList.add('cf-ai-highlight');
      setTimeout(() => promptInput?.classList.remove('cf-ai-highlight'), 1500);
      return;
    }

    setButtonState(btn, 'loading', 'Creating card...');

    try {
      // Step 1: Generate all text fields
      const textPrompt = buildFullCardPrompt(userPrompt);
      const textData = await callGemini(textPrompt, { model: TEXT_MODEL });
      const card = parseJSON(extractText(textData));
      console.log('[CardForge AI] Card data:', card);

      // Populate text fields
      const fields = getFields();
      setField(fields.name, card.name);
      setField(fields.cardClass, card.class);
      setField(fields.rarity, card.rarity);
      if (card.level) setField(fields.level, card.level);
      setField(fields.quote, card.quote);
      setField(fields.bio, card.biography);
      triggerPreviewUpdate();

      // Step 2: Generate card artwork
      if (card.imagePrompt) {
        setButtonState(btn, 'loading', 'Generating artwork...');
        try {
          const imagePromptText = `Create a trading card character portrait: ${card.imagePrompt}. Style: detailed digital fantasy art, dramatic lighting, no text, no card borders.`;
          const imgData = await callGemini(imagePromptText, {
            model: IMAGE_MODEL,
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
          });

          const img = extractImage(imgData);
          if (img) {
            const dataUrl = `data:${img.mimeType};base64,${img.base64}`;
            setField(fields.avatar, dataUrl);

            // Update card preview image if the editor supports it
            const previewImg = document.querySelector('.card-avatar-img, .card-front .avatar img');
            if (previewImg) {
              previewImg.src = dataUrl;
            }
            triggerPreviewUpdate();
            console.log('[CardForge AI] Artwork generated successfully');
          } else {
            console.warn('[CardForge AI] No image in response, text fields still applied');
          }
        } catch (imgErr) {
          console.warn('[CardForge AI] Image generation failed, text fields still applied:', imgErr);
        }
      }

      setButtonState(btn, 'success', 'Card Created!');
    } catch (err) {
      console.error('[CardForge AI] Full card generation failed:', err);
      setButtonState(btn, 'error');
    }
  }

  // ===== INIT =====
  function init() {
    // Quick Generate button (quote + bio from existing fields)
    const quickBtn = document.getElementById('cf-ai-generate-btn');
    if (quickBtn) {
      quickBtn.dataset.defaultIcon = 'fa-wand-magic-sparkles';
      quickBtn.dataset.defaultLabel = 'AI Generate';
      quickBtn.addEventListener('click', () => handleQuickGenerate(quickBtn));
    }

    // Full Card Generate button
    const fullBtn = document.getElementById('cf-ai-full-generate-btn');
    if (fullBtn) {
      fullBtn.dataset.defaultIcon = 'fa-bolt';
      fullBtn.dataset.defaultLabel = 'Create Full Card';
      fullBtn.addEventListener('click', () => handleFullCardGenerate(fullBtn));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

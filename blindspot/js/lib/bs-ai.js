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

  // ===== AI USAGE TRACKING =====
  const AI_DAILY_LIMIT = 5;
  const AI_USAGE_KEY = 'cardforge-ai-usage';

  function getAiUsage() {
    try {
      const raw = localStorage.getItem(AI_USAGE_KEY);
      if (!raw) return { date: '', count: 0 };
      const data = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      if (data.date !== today) return { date: today, count: 0 };
      return data;
    } catch (e) { return { date: '', count: 0 }; }
  }

  function incrementAiUsage() {
    const today = new Date().toISOString().slice(0, 10);
    const usage = getAiUsage();
    usage.date = today;
    usage.count++;
    localStorage.setItem(AI_USAGE_KEY, JSON.stringify(usage));
    updateAiCounter();
  }

  function getAiRemaining() {
    if (window.Entitlements && window.Entitlements.isPro()) return 999;
    return Math.max(0, AI_DAILY_LIMIT - getAiUsage().count);
  }

  function updateAiCounter() {
    const counter = document.getElementById('cf-ai-remaining');
    if (counter) {
      if (window.Entitlements && window.Entitlements.isPro()) {
        counter.textContent = 'Pro \u2014 unlimited';
        counter.style.color = '#FFD700';
        return;
      }
      const remaining = getAiRemaining();
      counter.textContent = remaining + '/' + AI_DAILY_LIMIT + ' free today';
      counter.style.color = remaining === 0 ? '#ff6b6b' : 'rgba(255,255,255,0.4)';
    }
  }

  // ===== GEMINI CALLS =====
  async function callGemini(prompt, opts = {}) {
    // Check daily limit
    if (getAiRemaining() <= 0) {
      if (window.Entitlements && window.Entitlements.showUpgradePrompt) {
        window.Entitlements.showUpgradePrompt('Unlimited AI Generations');
      }
      throw new Error('Daily AI limit reached (' + AI_DAILY_LIMIT + '/day).');
    }
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

    // Only count usage on successful API call
    if (!opts.skipUsageIncrement) incrementAiUsage();
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
  function buildQuotePrompt(name, cardClass, rarity) {
    return [
      'You are a creative trading-card writer for a fantasy / sci-fi card game.',
      'Given the following card details, generate a short, punchy quote or tagline (max 120 characters).',
      '',
      `Card Name: ${name}`,
      cardClass ? `Class / Type: ${cardClass}` : '',
      rarity ? `Rarity: ${rarity}` : '',
      '',
      'Return ONLY valid JSON (no markdown, no code fences):',
      '{"quote":"..."}'
    ].filter(Boolean).join('\n');
  }

  function buildBioPrompt(name, cardClass, rarity) {
    return [
      'You are a creative trading-card writer for a fantasy / sci-fi card game.',
      'Given the following card details, generate a vivid biography paragraph (max 220 characters) that hints at the character\'s backstory.',
      '',
      `Card Name: ${name}`,
      cardClass ? `Class / Type: ${cardClass}` : '',
      rarity ? `Rarity: ${rarity}` : '',
      '',
      'Return ONLY valid JSON (no markdown, no code fences):',
      '{"biography":"..."}'
    ].filter(Boolean).join('\n');
  }

  function buildFullCardPrompt(userPrompt) {
    return [
      'You are a creative trading-card designer for a fantasy / sci-fi card game.',
      'Based on the user\'s description below, generate a COMPLETE card with these fields:',
      '',
      '- name: Character name (max 30 chars)',
      '- class: MUST be one of: Fighter, Enforcer, Berserker, Caster, Hacker, Scholar, Scout, Rogue, Pilot, Guardian, Medic, Trickster, Wildcard',
      '- subclass: A creative title or specialization (max 25 chars), e.g. "Shadow Operative", "Void Walker", "Neon Samurai"',
      '- rarity: One of "Common", "Uncommon", "Rare", "Epic", "Legendary"',
      '- level: A number 1-100 appropriate to the rarity',
      '- quote: A punchy tagline (max 120 chars)',
      '- biography: A vivid backstory hint (max 220 chars)',
      '- stats: An array of 3-5 objects with "name" (string, e.g. "Attack", "Defense", "Speed") and "value" (number 0-100)',
      '- attributes: An array of 3-5 objects with "name" (string, e.g. "Element", "Faction", "Origin") and "value" (string). Do NOT use "Level", "Experience", "XP", "Rank", "Wins", or "Losses" as attribute names — those come from the arena system.',
      '- imagePrompt: A detailed visual description for generating the card artwork (max 200 chars). Describe the character\'s appearance, pose, and mood. Do NOT include text or card frames.',
      '',
      'Do NOT include a "badges" field — buffs are assigned by the game progression system.',
      '',
      `User Description: ${userPrompt}`,
      '',
      'Return ONLY valid JSON (no markdown, no code fences):',
      '{"name":"...","class":"...","subclass":"...","rarity":"...","level":0,"quote":"...","biography":"...","stats":[{"name":"...","value":0}],"attributes":[{"name":"...","value":"..."}],"imagePrompt":"..."}'
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

  // ===== HANDLER: Generate Quote Only =====
  async function handleGenerateQuote(btn) {
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
    const prompt = buildQuotePrompt(name, cardClass, rarity);

    setButtonState(btn, 'loading');

    try {
      const data = await callGemini(prompt, { model: TEXT_MODEL });
      const result = parseJSON(extractText(data));
      setField(getFields().quote, result.quote);
      triggerPreviewUpdate();
      setButtonState(btn, 'success');
    } catch (err) {
      console.error('[CardForge AI] Quote generation failed:', err);
      setButtonState(btn, 'error');
    }
  }

  // ===== HANDLER: Generate Bio Only =====
  async function handleGenerateBio(btn) {
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
    const prompt = buildBioPrompt(name, cardClass, rarity);

    setButtonState(btn, 'loading');

    try {
      const data = await callGemini(prompt, { model: TEXT_MODEL });
      const result = parseJSON(extractText(data));
      setField(getFields().bio, result.biography);
      triggerPreviewUpdate();
      setButtonState(btn, 'success');
    } catch (err) {
      console.error('[CardForge AI] Bio generation failed:', err);
      setButtonState(btn, 'error');
    }
  }

  // ===== HANDLER: Generate Image Only =====
  async function handleGenerateImage(btn) {
    const promptInput = document.getElementById('cf-ai-image-prompt');
    const userPrompt = promptInput?.value?.trim();

    if (!userPrompt) {
      promptInput?.focus();
      promptInput?.classList.add('cf-ai-highlight');
      setTimeout(() => promptInput?.classList.remove('cf-ai-highlight'), 1500);
      return;
    }

    setButtonState(btn, 'loading', 'Generating artwork...');

    try {
      const imagePromptText = `Create a trading card character portrait: ${userPrompt}. Style: detailed digital fantasy art, dramatic lighting, no text, no card borders.`;
      console.log('[CardForge AI] Requesting artwork with prompt:', imagePromptText);
      const imgData = await callGemini(imagePromptText, {
        model: IMAGE_MODEL,
        generationConfig: { responseModalities: ['Image'] }
      });

      const img = extractImage(imgData);
      if (img) {
        const dataUrl = `data:${img.mimeType};base64,${img.base64}`;
        const fields = getFields();
        setField(fields.avatar, dataUrl);

        const previewImg = document.querySelector('.card-avatar, .card-avatar-img, .card-front .avatar img');
        if (previewImg) {
          previewImg.src = dataUrl;
        }
        triggerPreviewUpdate();
        console.log('[CardForge AI] Artwork generated successfully');
        setButtonState(btn, 'success', 'Artwork Applied!');
      } else {
        console.warn('[CardForge AI] No image in response');
        setButtonState(btn, 'error', 'No image returned');
      }
    } catch (err) {
      console.error('[CardForge AI] Image generation failed:', err);
      setButtonState(btn, 'error');
    }
  }

  // ===== HANDLER: Full Card Generate =====
  // Random archetypes used when the user clicks Generate with an empty prompt
  const SURPRISE_PROMPTS = [
    'A mysterious shadow assassin who wields twin moonblades',
    'An ancient dragon scholar guarding a library of forbidden spells',
    'A cyberpunk street samurai with neon-lit prosthetic arms',
    'A celestial healer born from starlight, carrying a crystal staff',
    'A rogue alchemist who brews potions from enchanted mushrooms',
    'A battle-scarred orc warlord seeking redemption',
    'A time-traveling clockwork engineer with brass goggles',
    'A frost witch living atop an enchanted glacier',
    'A pirate captain whose ship sails through the clouds',
    'A forest guardian shapeshifter bonded with an ancient wolf spirit',
    'A fallen angel wielding a sword of black flame',
    'A desert nomad who commands swirling sandstorms',
    'An elven bard whose songs can shatter stone walls',
    'A void walker who steps between dimensions',
    'A volcanic knight forged in living magma armor'
  ];

  async function handleFullCardGenerate(btn) {
    const promptInput = document.getElementById('cf-ai-prompt');
    let userPrompt = promptInput?.value?.trim();

    if (!userPrompt) {
      userPrompt = SURPRISE_PROMPTS[Math.floor(Math.random() * SURPRISE_PROMPTS.length)];
      if (promptInput) promptInput.value = userPrompt;
    }

    setButtonState(btn, 'loading', 'Creating card...');

    try {
      // Step 1: Generate all text fields
      const textPrompt = buildFullCardPrompt(userPrompt);
      const textData = await callGemini(textPrompt, { model: TEXT_MODEL });
      const card = parseJSON(extractText(textData));
      console.log('[CardForge AI] Card data:', card);

      // Validate class against allowed list
      const validClasses = ['Fighter', 'Enforcer', 'Berserker', 'Caster', 'Hacker', 'Scholar', 'Scout', 'Rogue', 'Pilot', 'Guardian', 'Medic', 'Trickster', 'Wildcard'];
      if (card.class && !validClasses.includes(card.class)) {
        // Try case-insensitive match
        const match = validClasses.find(c => c.toLowerCase() === (card.class || '').toLowerCase());
        card.class = match || 'Fighter';
      }

      // Populate text fields
      const fields = getFields();
      setField(fields.name, card.name);
      setField(fields.cardClass, card.class);
      // Set subclass field
      const subclassField = document.getElementById('card-subclass');
      if (subclassField && card.subclass) subclassField.value = card.subclass;
      setField(fields.rarity, card.rarity);
      if (card.level) setField(fields.level, card.level);
      setField(fields.quote, card.quote);
      setField(fields.bio, card.biography);

      // Populate stats (capped to 5)
      if (Array.isArray(card.stats) && window.CardForge?.createStatRow) {
        const statsContainer = document.getElementById('stats-editor');
        if (statsContainer) {
          statsContainer.innerHTML = '';
          card.stats.slice(0, 5).forEach(function (s) {
            statsContainer.appendChild(
              window.CardForge.createStatRow(s.name || '', s.value || 0)
            );
          });
        }
      }

      // Populate attributes (capped to rank-based slot cap)
      if (Array.isArray(card.attributes) && window.CardForge?.createAttributeRow) {
        const attrContainer = document.getElementById('attribute-editor');
        const attrCap = (window.EffectTiers && window.EffectTiers.getSlotCap)
          ? window.EffectTiers.getSlotCap('attributes') : 4;
        if (attrContainer) {
          attrContainer.innerHTML = '';
          card.attributes.slice(0, attrCap).forEach(function (a) {
            attrContainer.appendChild(
              window.CardForge.createAttributeRow(a.name || '', a.value || '')
            );
          });
        }
      }

      // Populate badges — use unlocked BUFF_DEFS, respect slot cap and qty cap
      if (window.CardForge?.createBadgeRow) {
        const badgeContainer = document.getElementById('micro-editor');
        if (badgeContainer) {
          badgeContainer.innerHTML = '';
          const ET = window.EffectTiers;
          const buffCap = (ET && ET.getSlotCap) ? ET.getSlotCap('buffs') : 2;
          const maxQty = (ET && ET.getMaxBuffQty) ? ET.getMaxBuffQty() : 1;
          const unlocked = (ET && ET.getUnlockedBuffs) ? ET.getUnlockedBuffs() : [];

          if (unlocked.length > 0) {
            // Shuffle unlocked buffs and pick up to slot cap
            const shuffled = [...unlocked].sort(() => Math.random() - 0.5).slice(0, buffCap);
            shuffled.forEach(function (buff) {
              const qty = Math.floor(Math.random() * maxQty) + 1;
              badgeContainer.appendChild(
                window.CardForge.createBadgeRow(buff.key, buff.icon, buff.description, qty)
              );
            });
          }
        }
      }

      triggerPreviewUpdate();

      // Step 2: Generate card artwork
      if (card.imagePrompt) {
        setButtonState(btn, 'loading', 'Generating artwork...');
        try {
          const imagePromptText = `Create a trading card character portrait: ${card.imagePrompt}. Style: detailed digital fantasy art, dramatic lighting, no text, no card borders.`;
          console.log('[CardForge AI] Requesting artwork with prompt:', imagePromptText);
          const imgData = await callGemini(imagePromptText, {
            model: IMAGE_MODEL,
            generationConfig: { responseModalities: ['Image'] }
          });
          console.log('[CardForge AI] Image response:', JSON.stringify(imgData).substring(0, 500));

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
      const msg = err.message && err.message.includes('Daily AI limit')
        ? 'Limit reached'
        : 'Failed — Retry';
      setButtonState(btn, 'error', msg);
    }
  }

  // ===== INIT =====
  function init() {
    // Quote Generate button
    const quoteBtn = document.getElementById('cf-ai-quote-btn');
    if (quoteBtn) {
      quoteBtn.dataset.defaultIcon = 'fa-wand-magic-sparkles';
      quoteBtn.dataset.defaultLabel = 'AI Generate Quote';
      quoteBtn.addEventListener('click', () => handleGenerateQuote(quoteBtn));
    }

    // Bio Generate button
    const bioBtn = document.getElementById('cf-ai-bio-btn');
    if (bioBtn) {
      bioBtn.dataset.defaultIcon = 'fa-wand-magic-sparkles';
      bioBtn.dataset.defaultLabel = 'AI Generate Bio';
      bioBtn.addEventListener('click', () => handleGenerateBio(bioBtn));
    }

    // Full Card Generate button
    const fullBtn = document.getElementById('cf-ai-full-generate-btn');
    if (fullBtn) {
      fullBtn.dataset.defaultIcon = 'fa-bolt';
      fullBtn.dataset.defaultLabel = 'Create Full Card';
      fullBtn.addEventListener('click', () => handleFullCardGenerate(fullBtn));
    }

    // Standalone Image Generate button (Artwork section)
    const imgBtn = document.getElementById('cf-ai-image-btn');
    if (imgBtn) {
      imgBtn.dataset.defaultIcon = 'fa-image';
      imgBtn.dataset.defaultLabel = 'AI Generate Artwork';
      imgBtn.addEventListener('click', () => handleGenerateImage(imgBtn));
    }

    // Initialize AI usage counter
    updateAiCounter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose AI functions for Quick Build wizard and other modules
  window.CardForgeAI = {
    callGemini,
    buildFullCardPrompt,
    extractText,
    extractImage,
    parseJSON,
    getAiRemaining,
    incrementAiUsage: incrementAiUsage,
    TEXT_MODEL,
    IMAGE_MODEL,
    GEMINI_ENDPOINT
  };
})();

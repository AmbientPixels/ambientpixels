/**
 * adventure-ai.js — StoryForge Gemini proxy calls, prompt building, JSON parsing
 */
window.AdventureAI = (function () {
  'use strict';
  var DEBUG = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  var GEMINI_ENDPOINT = 'https://ambientpixels-nova-api.azurewebsites.net/api/geminiproxy';
  var TEXT_MODEL = 'gemini-2.5-flash';
  var IMAGE_MODEL = 'gemini-2.5-flash-image';
  var TTS_MODEL = 'gemini-2.5-flash-preview-tts';

  // --- Art Style Definitions ---
  var ART_STYLES = {
    cinematic_realism: {
      id: 'cinematic_realism',
      label: 'Cinematic Realism',
      icon: 'fa-film',
      prompt: 'Photorealistic photograph. This MUST look like a real photograph taken with a high-end cinema camera. NOT a painting, NOT an illustration, NOT digital art, NOT concept art. Real skin textures, real fabric, real materials, real lighting. Film-grade color grading with shallow depth of field, natural volumetric lighting, and subtle lens effects like bokeh and chromatic aberration. Shot on ARRI Alexa with anamorphic lens. Think movie still from a big-budget film.'
    },
    cinematic_fantasy: {
      id: 'cinematic_fantasy',
      label: 'Cinematic Fantasy',
      icon: 'fa-wand-sparkles',
      prompt: 'Epic digital fantasy painting. This MUST look like high-end RPG concept art — lush painterly brushwork with cinematic lighting. NOT photorealistic, NOT a photograph, NOT cel-shaded, NOT cartoon. Rich jewel-tone colors, dramatic volumetric light rays, magical glowing particles. Visible brushstrokes with blended edges. Think Blizzard or Magic: The Gathering key art.'
    },
    graphic_novel: {
      id: 'graphic_novel',
      label: 'Graphic Novel',
      icon: 'fa-book-open',
      prompt: 'Bold graphic novel comic book art. This MUST have strong black ink outlines, cel-shaded flat color fills, and high-contrast shadows. NOT painterly, NOT photorealistic, NOT soft or blended. Heavy linework like a pen-and-ink drawing with limited flat colors. Dramatic spot blacks, dynamic angles, and exaggerated perspective. Think Frank Miller or Mike Mignola comic panels.'
    },
    dark_fantasy: {
      id: 'dark_fantasy',
      label: 'Dark Fantasy',
      icon: 'fa-skull',
      prompt: 'Dark gothic oil painting. This MUST look like a traditional oil painting — heavy impasto brushwork with thick visible texture. NOT digital, NOT clean, NOT photorealistic. Somber desaturated palette with sickly amber and pale moonlight. Grim decaying detail — corroded metal, cracked stone, twisted forms. Oppressive fog and deep shadow. Think Beksinski or Frazetta dark fantasy art.'
    },
    storybook: {
      id: 'storybook',
      label: 'Storybook',
      icon: 'fa-book',
      prompt: 'Hand-painted watercolor storybook illustration. This MUST look like a page from a classic children\'s book — soft watercolor washes on textured paper with gentle ink outlines. NOT digital, NOT photorealistic, NOT sharp or glossy. Warm pastel palette with golden light. Slightly stylized proportions, cozy and charming. Visible paper grain and soft bleeding edges. Think Arthur Rackham or Studio Ghibli concept art.'
    },
    cyberpunk_neon: {
      id: 'cyberpunk_neon',
      label: 'Cyberpunk Neon',
      icon: 'fa-bolt',
      prompt: 'Neon-drenched cyberpunk digital art. This MUST be dominated by vivid neon lighting — hot pink, electric blue, acid green — against deep black and purple. NOT subtle, NOT muted, NOT painterly, NOT watercolor. Rain-slicked reflective surfaces everywhere. Dense urban megastructures with holographic signs. Extreme contrast — blown-out neon highlights crushing into pure black shadows. Think Blade Runner 2049 meets Akira.'
    },
    vintage_pulp: {
      id: 'vintage_pulp',
      label: 'Vintage Pulp',
      icon: 'fa-newspaper',
      prompt: 'Retro 1940s-60s pulp magazine cover art. This MUST look like a painted magazine cover — bold saturated colors, dramatic action poses, slightly exaggerated heroic anatomy. NOT modern, NOT photorealistic, NOT digital-looking. Warm faded palette with visible traditional brushwork. Paper grain texture and subtle halftone dot patterns. Strong theatrical lighting. Think vintage adventure book covers or old sci-fi magazine art.'
    },
    minimal_symbolic: {
      id: 'minimal_symbolic',
      label: 'Minimal Symbolic',
      icon: 'fa-shapes',
      prompt: 'Minimalist symbolic poster art. This MUST use only bold geometric shapes, silhouettes, and 3-5 flat colors maximum with strong negative space. NOT detailed, NOT realistic, NOT painterly, NOT illustrated. Abstract representation using simple clean forms and sharp vector-like edges. Mood through color and composition only, not through detail or texture. Think Saul Bass movie posters or Olly Moss art prints.'
    }
  };

  var GENRE_VOICES = {
    fantasy: 'Charon',
    horror: 'Fenrir',
    scifi: 'Kore',
    detective: 'Orus',
    postapoc: 'Puck',
    pirate: 'Leda'
  };

  var DAILY_LIMIT_KEY = 'storyforge-ai-usage';
  var DAILY_LIMIT = 15; // adventures per day

  function buildEquippedLine(state) {
    if (!state.equipped) return 'none';
    var parts = [];
    ['weapon', 'armor'].forEach(function (slot) {
      if (state.equipped[slot]) {
        var item = state.inventory.find(function (i) { return i.id === state.equipped[slot]; });
        if (item) parts.push(item.name + ' (' + slot + ')');
      }
    });
    return parts.length ? parts.join(', ') : 'none';
  }

  // --- Generate opening scene ---
  function generateOpeningScene(genre, playerName, character) {
    var prompt = buildOpeningPrompt(genre, playerName, character);
    return callTextAPIWithRetry(prompt);
  }

  // --- Generate next scene ---
  function generateNextScene(genre, state, choiceText, skillCheckResult) {
    var prompt = buildScenePrompt(genre, state, choiceText, skillCheckResult);
    return callTextAPIWithRetry(prompt);
  }

  // --- Generate continuation choices for a resumed adventure ---
  function generateContinuation(genre, state) {
    var prompt = genre.genrePrompt + '\n\n' +
      'The player is RESUMING a saved adventure. Generate choices for the current scene.\n\n' +
      'GAME STATE:\n' +
      '- Genre: ' + genre.name + '\n' +
      '- Turn: ' + state.turnCount + '/' + state.maxTurns + '\n' +
      '- Player: ' + state.playerName + '\n' +
      ((state.character && state.character.description) ? '- Appearance: ' + state.character.description + '\n' : '') +
      '- HP: ' + state.stats.hp + '/' + state.stats.maxHp + '\n' +
      '- Inventory: ' + (state.inventory.length ? state.inventory.map(function (i) { return i.name; }).join(', ') : 'empty') + '\n' +
      '- Equipped: ' + buildEquippedLine(state) + '\n' +
      '- Companions: ' + (state.companions.length ? state.companions.map(function (c) { return c.name; }).join(', ') : 'none') + '\n' +
      '- Key Events: ' + (state.eventLog.length ? state.eventLog.join(', ') : 'adventure just began') + '\n' +
      '- Last Scene: ' + (state.lastSceneText || '(opening)').substring(0, 500) + '\n\n' +
      'RULES:\n' +
      '- Do NOT write a new scene. The player already sees the last scene text.\n' +
      '- Generate ONLY the choices array and stateChanges. Set sceneText to "" and imagePrompt to "".\n' +
      '- Present 3-4 choices that logically follow from the last scene.\n' +
      '- Include at least one cautious, one bold, and one creative option.\n' +
      '- If a choice involves risk, add a skillCheck.\n\n' +
      RESPONSE_FORMAT;

    return callTextAPIWithRetry(prompt);
  }

  // --- Genre theme keywords (subject matter only, no rendering style) ---
  var GENRE_THEMES = {
    fantasy: 'medieval setting, ancient stone ruins, torchlight, moonlit landscapes, swords and armor',
    horror: 'dark atmosphere, fog and shadows, unsettling environments, dread and tension',
    scifi: 'futuristic technology, alien landscapes, starships, neon and chrome',
    detective: 'rain-slicked streets, urban noir, crime scenes, dramatic shadows',
    postapoc: 'ruined cities, dust and rust, desolate landscapes, overgrown architecture',
    pirate: 'tropical seas, wooden ships, island ports, golden sunlight, ocean waves'
  };

  // --- Generate scene image ---
  function generatePortraitImage(characterDesc, genre, artStyleId) {
    var artStyle = ART_STYLES[artStyleId] || ART_STYLES.cinematic_fantasy;
    var theme = GENRE_THEMES[genre.id] || '';
    var prompt = 'CRITICAL STYLE INSTRUCTION — follow this exactly: ' + artStyle.prompt + ' ' +
      'Subject: Professional character portrait, head and shoulders, centered subject. ' +
      'The character is ' + characterDesc + '. ' +
      'Setting elements: ' + theme + '. ' +
      'Close-up portrait, face and upper body only. Single character, no background figures. ' +
      'Dramatic directional lighting with rim light. Circular vignette composition. ' +
      'No text, no watermarks, no UI elements, no borders, no logos.';
    return callImageAPI(prompt);
  }

  function generateSceneImage(imagePrompt, genre, characterDesc, artStyleId) {
    var artStyle = ART_STYLES[artStyleId] || ART_STYLES.cinematic_fantasy;
    var theme = GENRE_THEMES[genre.id] || '';
    var charClause = characterDesc ? 'The protagonist (' + characterDesc + ') is visible in the scene. ' : '';
    var fullPrompt = 'CRITICAL STYLE INSTRUCTION — follow this exactly: ' + artStyle.prompt + ' ' +
      'Subject: Adventure game scene. ' + charClause +
      'Scene: ' + imagePrompt + '. ' +
      'Setting elements: ' + theme + '. ' +
      'Wide 16:9 landscape composition with clear foreground, midground, and background layers. ' +
      'Strong atmospheric perspective — depth through haze, light falloff, or scale. ' +
      'No text, no watermarks, no UI elements, no borders, no logos. ' +
      'REMEMBER: ' + artStyle.prompt;

    return callImageAPI(fullPrompt);
  }

  // --- Build opening prompt ---
  function buildOpeningPrompt(genre, playerName, character) {
    var charLine = (character && character.description) ? 'CHARACTER APPEARANCE: ' + playerName + ' is ' + character.description + '\n' : '';
    return genre.genrePrompt + '\n\n' +
      'Generate the OPENING SCENE of a new adventure.\n\n' +
      'PLAYER: ' + playerName + '\n' +
      charLine +
      'GENRE: ' + genre.name + '\n' +
      'TURN: 1/25\n\n' +
      'RULES:\n' +
      '- Write exactly 3 paragraphs: (1) establish the setting with sensory detail, (2) introduce the situation and stakes, (3) set up the first decision point.\n' +
      '- Use all five senses — not just sight. Include sounds, smells, textures, temperature.\n' +
      '- Vary sentence length: mix short punchy beats with longer flowing descriptions.\n' +
      '- Present exactly 3-4 choices. At least one cautious, one bold, one creative.\n' +
      '- Each choice must lead to a DIFFERENT outcome — never offer three flavors of the same action.\n' +
      '- Each choice should hint at its consequence without spoiling it.\n' +
      '- If a choice involves risk, add a skillCheck with stat (strength/dexterity/intelligence/charisma) and difficulty (8-16).\n' +
      '- Suggest any immediate inventory finds or companion encounters via stateChanges.\n' +
      '- IMPORTANT: Every item or companion mentioned in the narrative MUST appear in stateChanges.addItems or stateChanges.addCompanion. Do not describe the player finding/receiving items without adding them.\n' +
      '- Generate a visual description for the scene illustration (max 150 chars).\n\n' +
      RESPONSE_FORMAT;
  }

  // --- Build scene prompt ---
  function buildScenePrompt(genre, state, choiceText, skillCheckResult) {
    var skillInfo = '';
    if (skillCheckResult) {
      skillInfo = '\nSKILL CHECK RESULT: Player attempted action requiring ' +
        skillCheckResult.stat.toUpperCase() + ' check. ' +
        'Rolled ' + skillCheckResult.total + ' vs DC ' + skillCheckResult.difficulty + ' — ' +
        (skillCheckResult.success ? 'SUCCESS' : 'FAILURE') +
        (skillCheckResult.critical === 'critical_success' ? ' (NATURAL 20 — CRITICAL SUCCESS!)' : '') +
        (skillCheckResult.critical === 'critical_failure' ? ' (NATURAL 1 — CRITICAL FAILURE!)' : '') + '\n';
    }

    return genre.genrePrompt + '\n\n' +
      'Continue the adventure based on the player\'s choice.\n\n' +
      'GAME STATE:\n' +
      '- Genre: ' + genre.name + '\n' +
      '- Turn: ' + (state.turnCount + 1) + '/' + state.maxTurns + '\n' +
      '- Player: ' + state.playerName + '\n' +
      ((state.character && state.character.description) ? '- Appearance: ' + state.character.description + '\n' : '') +
      '- HP: ' + state.stats.hp + '/' + state.stats.maxHp + '\n' +
      '- Gold: ' + state.stats.gold + '\n' +
      '- Reputation: ' + state.stats.reputation + '\n' +
      '- STR: ' + state.stats.strength + ' DEX: ' + state.stats.dexterity +
      ' INT: ' + state.stats.intelligence + ' CHA: ' + state.stats.charisma + '\n' +
      '- Inventory: ' + (state.inventory.length ? state.inventory.map(function (i) { return i.name; }).join(', ') : 'empty') + '\n' +
      '- Equipped: ' + buildEquippedLine(state) + '\n' +
      '- Companions: ' + (state.companions.length ? state.companions.map(function (c) { return c.name + ' (' + c.type + ')'; }).join(', ') : 'none') + '\n' +
      '- Key Events: ' + (state.eventLog.length ? state.eventLog.join(', ') : 'adventure just began') + '\n\n' +
      '- Last Scene: ' + (state.lastSceneText || '(opening)').substring(0, 500) + '\n' +
      '- Player\'s Choice: ' + choiceText + '\n' +
      skillInfo + '\n' +
      'RULES:\n' +
      '- Write exactly 3 paragraphs: (1) consequence of the choice — what happens immediately, (2) exploration/discovery — what the player sees, hears, finds, (3) new tension — set up the next decision point.\n' +
      '- Use all five senses. Include sounds, smells, textures, temperature — not just visual descriptions.\n' +
      '- Vary sentence length: short punchy beats for action, longer flowing prose for atmosphere.\n' +
      '- Do NOT start consecutive paragraphs the same way.\n' +
      '- If the player has companions, give them dialogue or actions in the scene — they are not silent followers.\n' +
      '- Reference equipped items naturally in the prose (e.g., "You grip your cutlass" not just "You attack").\n' +
      '- Present 3-4 choices. At least one cautious, one bold, one creative.\n' +
      '- Each choice must lead to a DIFFERENT outcome — never offer three flavors of the same action.\n' +
      '- Never offer "do nothing" or "wait and see" as a choice.\n' +
      '- At least one choice should leverage the player\'s inventory or companions if available.\n' +
      '- Bold choices should have higher risk AND higher reward in stateChanges.\n' +
      '- Each choice should hint at its consequence without spoiling it.\n' +
      '- If a choice involves risk, add a skillCheck (stat + difficulty 8-18).\n' +
      '- Track HP changes (damage: -5 to -25, healing: +10 to +30), inventory, companions, reputation.\n' +
      '- IMPORTANT: Every item or companion mentioned in the narrative MUST appear in stateChanges. Do not describe the player finding/receiving/losing items without including them in addItems/removeItems.\n' +
      '- If HP <= 0, this is a DEATH scene — set isEnding:true, endingType:"death", no choices.\n' +
      '- If turn >= 20, steer toward climax. At turn 25, force a resolution.\n' +
      (state.turnCount >= 19 ? '- IMPORTANT: We are nearing the end. Start wrapping up the story arc.\n' : '') +
      (state.turnCount >= 24 ? '- FINAL TURN: This MUST be the ending. Set isEnding:true, endingType:"victory" or "escape".\n' : '') +
      '- Generate a visual description for the scene (max 150 chars).\n\n' +
      RESPONSE_FORMAT;
  }

  var RESPONSE_FORMAT =
    'Return ONLY valid JSON (no markdown, no code fences, no extra text):\n' +
    '{\n' +
    '  "sceneText": "2-4 paragraphs of narrative prose",\n' +
    '  "imagePrompt": "short visual scene description for illustration, max 150 chars",\n' +
    '  "choices": [\n' +
    '    { "id": "a", "text": "choice text", "skillCheck": null },\n' +
    '    { "id": "b", "text": "choice text", "skillCheck": { "stat": "dexterity", "difficulty": 12 } },\n' +
    '    { "id": "c", "text": "choice text", "skillCheck": null }\n' +
    '  ],\n' +
    '  "stateChanges": {\n' +
    '    "hpDelta": 0,\n' +
    '    "goldDelta": 0,\n' +
    '    "reputationDelta": 0,\n' +
    '    "addItems": [],\n' +
    '    "removeItems": [],\n' +
    '    "addCompanion": null,\n' +
    '    "removeCompanion": null,\n' +
    '    "eventTag": "short_event_tag"\n' +
    '  },\n' +
    '  "isEnding": false,\n' +
    '  "endingType": null\n' +
    '}';

  // --- API calls ---
  var TIMEOUT_MS = 30000; // 30-second request timeout

  function callTextAPIWithRetry(prompt, maxRetries) {
    maxRetries = maxRetries || 3;
    var attempt = 0;
    function tryCall() {
      attempt++;
      return callTextAPI(prompt).catch(function (err) {
        if (attempt < maxRetries) {
          DEBUG && console.warn('AI call attempt ' + attempt + ' failed, retrying...', err.message);
          // Exponential backoff: 2s, 4s, 8s
          return new Promise(function (resolve) {
            setTimeout(resolve, 2000 * Math.pow(2, attempt - 1));
          }).then(tryCall);
        }
        throw err;
      });
    }
    return tryCall();
  }

  function callTextAPI(prompt) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    return fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, model: TEXT_MODEL }),
      signal: controller.signal
    })
    .then(function (res) {
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('AI request failed (' + res.status + ')');
      return res.json();
    })
    .then(function (data) {
      var text = data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) throw new Error('No text in AI response');
      return parseSceneJSON(text);
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error('AI request timed out — try again');
      throw err;
    });
  }

  function callImageAPI(prompt) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    return fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        model: IMAGE_MODEL,
        generationConfig: { responseModalities: ['Image'] }
      }),
      signal: controller.signal
    })
    .then(function (res) {
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('Image request failed (' + res.status + ')');
      return res.json();
    })
    .then(function (data) {
      var parts = (data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts) || [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].inlineData) {
          var mime = parts[i].inlineData.mimeType || 'image/png';
          return 'data:' + mime + ';base64,' + parts[i].inlineData.data;
        }
      }
      return null;
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      if (typeof UI !== 'undefined') UI.toast('Scene illustration unavailable', 'warning');
      return null; // Image generation is non-critical
    });
  }

  // --- Fallback scene when AI completely fails ---
  function createFallbackScene() {
    return {
      sceneText: 'The mists close in, obscuring the path ahead. Though the details are unclear, you sense the journey is far from over. Three paths emerge from the fog...',
      choices: [
        { id: 'fallback_1', text: 'Press forward cautiously' },
        { id: 'fallback_2', text: 'Search the immediate area' },
        { id: 'fallback_3', text: 'Wait and observe' }
      ],
      stateChanges: {},
      imagePrompt: null,
      isEnding: false,
      endingType: null
    };
  }

  // Convert base64 to ArrayBuffer
  function base64ToArrayBuffer(base64) {
    var raw = atob(base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }

  // Convert raw PCM base64 to WAV ArrayBuffer (Gemini TTS returns audio/L16;rate=24000)
  function pcmToWavArrayBuffer(base64Pcm, sampleRate) {
    sampleRate = sampleRate || 24000;
    var raw = atob(base64Pcm);
    var pcmBytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) pcmBytes[i] = raw.charCodeAt(i);

    var numChannels = 1;
    var bitsPerSample = 16;
    var byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    var blockAlign = numChannels * (bitsPerSample / 8);
    var dataSize = pcmBytes.length;
    var headerSize = 44;
    var buffer = new ArrayBuffer(headerSize + dataSize);
    var view = new DataView(buffer);

    function writeString(offset, str) {
      for (var j = 0; j < str.length; j++) view.setUint8(offset + j, str.charCodeAt(j));
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    new Uint8Array(buffer, headerSize).set(pcmBytes);
    return buffer;
  }

  function callTTSAPI(text, voiceName) {
    return fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: text,
        model: TTS_MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName || 'Kore'
              }
            }
          }
        }
      })
    })
    .then(function (res) {
      if (!res.ok) throw new Error('TTS request failed (' + res.status + ')');
      return res.json();
    })
    .then(function (data) {
      var parts = (data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts) || [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].inlineData && parts[i].inlineData.data) {
          var mime = parts[i].inlineData.mimeType || '';
          // If already a browser-playable format, decode base64 to ArrayBuffer
          if (mime === 'audio/wav' || mime === 'audio/mp3' || mime === 'audio/mpeg') {
            return base64ToArrayBuffer(parts[i].inlineData.data);
          }
          // Raw PCM (audio/L16) — wrap with WAV header, return ArrayBuffer
          var rate = 24000;
          var rateMatch = mime.match(/rate=(\d+)/);
          if (rateMatch) rate = parseInt(rateMatch[1], 10);
          return pcmToWavArrayBuffer(parts[i].inlineData.data, rate);
        }
      }
      return null;
    })
    .catch(function (err) {
      DEBUG && console.warn('[TTS] Error:', err);
      return null;
    });
  }

  // --- Parse AI JSON response ---
  function parseSceneJSON(text) {
    // Strip markdown code fences if present
    var cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
      var parsed = JSON.parse(cleaned);
      return validateScene(parsed);
    } catch (e) {
      // Try to extract JSON from surrounding text
      var match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          var extracted = JSON.parse(match[0]);
          return validateScene(extracted);
        } catch (e2) {
          throw new Error('Failed to parse AI response as JSON');
        }
      }
      throw new Error('No JSON found in AI response');
    }
  }

  function validateScene(scene) {
    // Ensure required fields exist with defaults
    scene.sceneText = scene.sceneText || 'The story continues...';
    scene.imagePrompt = scene.imagePrompt || 'mysterious atmospheric scene';
    scene.choices = scene.choices || [];
    scene.stateChanges = scene.stateChanges || {};
    scene.isEnding = !!scene.isEnding;
    scene.endingType = scene.endingType || null;

    // Ensure choices have IDs
    var keys = ['a', 'b', 'c', 'd'];
    scene.choices = scene.choices.slice(0, 4).map(function (choice, i) {
      return {
        id: choice.id || keys[i],
        text: choice.text || 'Continue',
        skillCheck: choice.skillCheck || null
      };
    });

    // Ensure at least 2 choices if not an ending
    if (!scene.isEnding && scene.choices.length < 2) {
      scene.choices = [
        { id: 'a', text: 'Continue cautiously', skillCheck: null },
        { id: 'b', text: 'Press forward boldly', skillCheck: null },
        { id: 'c', text: 'Look for another way', skillCheck: null }
      ];
    }

    return scene;
  }

  // --- Rate limiting ---
  function checkDailyLimit(limit) {
    var data = getDailyUsage();
    return data.count < (limit || DAILY_LIMIT);
  }

  function incrementUsage() {
    var data = getDailyUsage();
    data.count++;
    localStorage.setItem(DAILY_LIMIT_KEY, JSON.stringify(data));
  }

  function getDailyUsage() {
    var today = new Date().toISOString().split('T')[0];
    try {
      var stored = JSON.parse(localStorage.getItem(DAILY_LIMIT_KEY) || '{}');
      if (stored.date === today) return stored;
    } catch (e) { /* ignore */ }
    return { date: today, count: 0 };
  }

  function getRemainingUsage(limit) {
    var data = getDailyUsage();
    return Math.max(0, (limit || DAILY_LIMIT) - data.count);
  }

  return {
    generateOpeningScene: generateOpeningScene,
    generateNextScene: generateNextScene,
    generateContinuation: generateContinuation,
    generateSceneImage: generateSceneImage,
    generatePortraitImage: generatePortraitImage,
    callTTSAPI: callTTSAPI,
    GENRE_VOICES: GENRE_VOICES,
    ART_STYLES: ART_STYLES,
    checkDailyLimit: checkDailyLimit,
    incrementUsage: incrementUsage,
    getRemainingUsage: getRemainingUsage,
    createFallbackScene: createFallbackScene
  };
})();

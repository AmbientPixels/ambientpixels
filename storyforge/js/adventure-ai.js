/**
 * adventure-ai.js — StoryForge Gemini proxy calls, prompt building, JSON parsing
 */
window.AdventureAI = (function () {
  'use strict';

  var GEMINI_ENDPOINT = '/api/geminiproxy';
  var TEXT_MODEL = 'gemini-2.0-flash';
  var IMAGE_MODEL = 'gemini-2.5-flash-image';

  var DAILY_LIMIT_KEY = 'storyforge-ai-usage';
  var DAILY_LIMIT = 15; // adventures per day

  // --- Generate opening scene ---
  function generateOpeningScene(genre, playerName) {
    var prompt = buildOpeningPrompt(genre, playerName);
    return callTextAPI(prompt);
  }

  // --- Generate next scene ---
  function generateNextScene(genre, state, choiceText, skillCheckResult) {
    var prompt = buildScenePrompt(genre, state, choiceText, skillCheckResult);
    return callTextAPI(prompt);
  }

  // --- Generate continuation choices for a resumed adventure ---
  function generateContinuation(genre, state) {
    var prompt = genre.genrePrompt + '\n\n' +
      'The player is RESUMING a saved adventure. Generate choices for the current scene.\n\n' +
      'GAME STATE:\n' +
      '- Genre: ' + genre.name + '\n' +
      '- Turn: ' + state.turnCount + '/' + state.maxTurns + '\n' +
      '- Player: ' + state.playerName + '\n' +
      '- HP: ' + state.stats.hp + '/' + state.stats.maxHp + '\n' +
      '- Inventory: ' + (state.inventory.length ? state.inventory.map(function (i) { return i.name; }).join(', ') : 'empty') + '\n' +
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

    return callTextAPI(prompt);
  }

  // --- Generate scene image ---
  function generateSceneImage(imagePrompt, genre) {
    var fullPrompt = 'Create a single illustration for an interactive adventure game scene. ' +
      'Style: ' + (genre.imageStyleHint || 'fantasy illustration') + '. ' +
      'Scene: ' + imagePrompt + '. ' +
      'No text, no UI elements, no borders. Wide landscape format. Atmospheric and immersive.';

    return callImageAPI(fullPrompt);
  }

  // --- Build opening prompt ---
  function buildOpeningPrompt(genre, playerName) {
    return genre.genrePrompt + '\n\n' +
      'Generate the OPENING SCENE of a new adventure.\n\n' +
      'PLAYER: ' + playerName + '\n' +
      'GENRE: ' + genre.name + '\n' +
      'TURN: 1/25\n\n' +
      'RULES:\n' +
      '- Write 2-4 paragraphs of vivid ' + genre.name.toLowerCase() + ' prose introducing the setting and situation.\n' +
      '- Present exactly 3-4 choices. At least one cautious, one bold, one creative.\n' +
      '- If a choice involves risk, add a skillCheck with stat (strength/dexterity/intelligence/charisma) and difficulty (8-16).\n' +
      '- Suggest any immediate inventory finds or companion encounters via stateChanges.\n' +
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
      '- HP: ' + state.stats.hp + '/' + state.stats.maxHp + '\n' +
      '- Gold: ' + state.stats.gold + '\n' +
      '- Reputation: ' + state.stats.reputation + '\n' +
      '- STR: ' + state.stats.strength + ' DEX: ' + state.stats.dexterity +
      ' INT: ' + state.stats.intelligence + ' CHA: ' + state.stats.charisma + '\n' +
      '- Inventory: ' + (state.inventory.length ? state.inventory.map(function (i) { return i.name; }).join(', ') : 'empty') + '\n' +
      '- Companions: ' + (state.companions.length ? state.companions.map(function (c) { return c.name + ' (' + c.type + ')'; }).join(', ') : 'none') + '\n' +
      '- Key Events: ' + (state.eventLog.length ? state.eventLog.join(', ') : 'adventure just began') + '\n\n' +
      '- Last Scene: ' + (state.lastSceneText || '(opening)').substring(0, 500) + '\n' +
      '- Player\'s Choice: ' + choiceText + '\n' +
      skillInfo + '\n' +
      'RULES:\n' +
      '- Write 2-4 paragraphs describing what happens.\n' +
      '- Present 3-4 choices. At least one cautious, one bold, one creative.\n' +
      '- If a choice involves risk, add a skillCheck (stat + difficulty 8-18).\n' +
      '- Track HP changes (damage: -5 to -25, healing: +10 to +30), inventory, companions, reputation.\n' +
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
  function callTextAPI(prompt) {
    return fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, model: TEXT_MODEL })
    })
    .then(function (res) {
      if (!res.ok) throw new Error('AI request failed (' + res.status + ')');
      return res.json();
    })
    .then(function (data) {
      var text = data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) throw new Error('No text in AI response');
      return parseSceneJSON(text);
    });
  }

  function callImageAPI(prompt) {
    return fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        model: IMAGE_MODEL,
        generationConfig: { responseModalities: ['Image'] }
      })
    })
    .then(function (res) {
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
    .catch(function () {
      return null; // Image generation is non-critical
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
  function checkDailyLimit() {
    var data = getDailyUsage();
    return data.count < DAILY_LIMIT;
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

  function getRemainingUsage() {
    var data = getDailyUsage();
    return Math.max(0, DAILY_LIMIT - data.count);
  }

  return {
    generateOpeningScene: generateOpeningScene,
    generateNextScene: generateNextScene,
    generateContinuation: generateContinuation,
    generateSceneImage: generateSceneImage,
    checkDailyLimit: checkDailyLimit,
    incrementUsage: incrementUsage,
    getRemainingUsage: getRemainingUsage
  };
})();

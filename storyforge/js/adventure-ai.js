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

  // --- Build condensed story history from turns array ---
  // Recent 5 turns: full excerpt + choice + dice result
  // Older turns: choice + event tag only (compact)
  var RECENT_TURNS = 5;

  function buildStoryHistory(state) {
    var turns = state.turns;
    if (!turns || !turns.length) return '';

    var lines = [];
    var cutoff = turns.length - RECENT_TURNS;

    for (var i = 0; i < turns.length; i++) {
      var t = turns[i];
      var num = t.turnNumber || (i + 1);

      if (i < cutoff) {
        // Compact: just the choice + event tag
        var compact = 'T' + num + ': ' + (t.choiceMade || '(start)');
        if (t.diceRoll) compact += ' [' + (t.diceRoll.success ? 'PASS' : 'FAIL') + ']';
        lines.push(compact);
      } else {
        // Detailed: excerpt + choice + dice
        var detail = 'T' + num + ': ';
        if (t.sceneExcerpt) detail += t.sceneExcerpt;
        if (t.choiceMade) detail += ' → Chose: ' + t.choiceMade;
        if (t.diceRoll) detail += ' [Roll ' + t.diceRoll.total + ' — ' + (t.diceRoll.success ? 'SUCCESS' : 'FAILURE') + ']';
        lines.push(detail);
      }
    }

    return '\nSTORY SO FAR (player\'s journey — reference earlier events, callback to past choices):\n' +
      lines.join('\n') + '\n';
  }

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
    // Build plot seed context if available
    var plotContext = '';
    if (state.plotSeed) {
      var ps = state.plotSeed;
      plotContext = '\nSTORY BLUEPRINT (hidden from player — use this to guide choices):\n' +
        '- Antagonist: ' + (ps.antagonist || 'unknown') + '\n' +
        '- Central Conflict: ' + (ps.centralConflict || 'unknown') + '\n' +
        '- Plot Points: ' + (ps.keyPlotPoints ? ps.keyPlotPoints.join(' | ') : 'none') + '\n' +
        '- Hidden Clue: ' + (ps.hiddenClue || 'none') + '\n';
    }

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
      '- Companions: ' + (state.companions.length ? state.companions.map(function (c) {
        var loyalty = c.loyalty != null ? c.loyalty : 50;
        return c.name + ' (loyalty: ' + loyalty + ', mood: ' + (c.mood || 'neutral') + ')';
      }).join(', ') : 'none') + '\n' +
      '- Location: ' + (state.currentLocation || 'unknown') + '\n' +
      '- Visited: ' + (state.visitedLocations && state.visitedLocations.length ? state.visitedLocations.join(', ') : 'none') + '\n' +
      '- Key Events: ' + (state.eventLog.length ? state.eventLog.join(', ') : 'adventure just began') + '\n' +
      '- Last Scene: ' + (state.lastSceneText || '(opening)').substring(0, 500) + '\n' +
      plotContext +
      buildStoryHistory(state) + '\n' +
      'RULES:\n' +
      '- Do NOT write a new scene. The player already sees the last scene text.\n' +
      '- Generate ONLY the choices array and stateChanges. Set sceneText to "" and imagePrompt to "".\n' +
      '- Present 3-4 choices that logically follow from the last scene AND advance the overarching plot.\n' +
      '- Include at least one cautious, one bold, and one creative option.\n' +
      '- If a choice involves risk, add a skillCheck.\n' +
      '- Include companionLoyalty, location, and decision in stateChanges where relevant.\n\n' +
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
    var charClause = characterDesc
      ? 'The protagonist (' + characterDesc + ') MUST be clearly visible in the foreground, facing the viewer or at a three-quarter angle so their face and facial features are fully visible. Never show the protagonist from behind, silhouetted, or with their face obscured. '
      : '';
    var fullPrompt = 'CRITICAL STYLE INSTRUCTION — follow this exactly: ' + artStyle.prompt + ' ' +
      'Subject: Adventure game scene. ' + charClause +
      'Scene: ' + imagePrompt + '. ' +
      'Setting elements: ' + theme + '. ' +
      'Wide 16:9 landscape composition with clear foreground, midground, and background layers. ' +
      'Strong atmospheric perspective — depth through haze, light falloff, or scale. ' +
      'No text, no watermarks, no UI elements, no borders, no logos. ' +
      (characterDesc ? 'IMPORTANT: The protagonist\'s face must be clearly visible — front-facing or three-quarter view, well-lit, with recognizable facial features. ' : '') +
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
      'STORY STRUCTURE:\n' +
      'This adventure has a 3-act structure over 25 turns. You must plan an overarching PLOT with a beginning, middle, and end.\n' +
      '- Act 1 (turns 1-7): SETUP — introduce the world, the central conflict, and plant the seeds of the mystery or threat. The antagonist should be hinted at but not fully revealed.\n' +
      '- Act 2 (turns 8-18): RISING ACTION — complications, betrayals, revelations. Stakes escalate. The player discovers the true scope of the threat. Include a "darkest moment" setback around turns 15-18.\n' +
      '- Act 3 (turns 19-25): CLIMAX & RESOLUTION — confrontation with the antagonist, payoff of planted clues, and a satisfying conclusion shaped by the player\'s choices.\n\n' +
      'In this opening scene, you MUST also generate:\n' +
      '1. A "storyTitle" — an evocative, genre-appropriate title for this adventure (3-6 words, like a book or movie title). Examples: "Ashes of the Iron Coast", "The Whispering Protocol", "Blood Beneath the Floorboards".\n' +
      '2. A "plotSeed" — a hidden story blueprint that will guide the entire adventure. This includes an antagonist, a central conflict, 4 key plot points (one per act), and a hidden clue planted in the opening scene that pays off later.\n\n' +
      'RULES:\n' +
      '- Write exactly 3 paragraphs: (1) establish the setting with sensory detail, (2) introduce the situation and stakes — hint at the central conflict, (3) set up the first decision point.\n' +
      '- Plant at least one subtle clue or detail that connects to the plotSeed.hiddenClue — something the player might notice on replay.\n' +
      '- Use all five senses — not just sight. Include sounds, smells, textures, temperature.\n' +
      '- Vary sentence length: mix short punchy beats with longer flowing descriptions.\n' +
      '- LOCATION: Name the starting location in "location" field and stateChanges.location. Use a specific, evocative name (e.g. "The Rusted Anchor Tavern", "Sector 7 Undercity", "Blackmoor Crossroads").\n' +
      '- Present exactly 3-4 choices. At least one cautious, one bold, one creative.\n' +
      '- Each choice must lead to a DIFFERENT outcome — never offer three flavors of the same action.\n' +
      '- Each choice should hint at its consequence without spoiling it.\n' +
      '- If a choice involves risk, add a skillCheck with stat (strength/dexterity/intelligence/charisma) and difficulty (8-16).\n' +
      '- Suggest any immediate inventory finds or companion encounters via stateChanges.\n' +
      '- Items can have type "weapon", "armor", "consumable", "tool", or "quest_item". Use "consumable" for healing potions, herbs, medkits, elixirs, or any restorative item the player can use from inventory.\n' +
      '- QUEST ITEMS: Use type "quest_item" for narratively significant items (a mysterious key, a coded letter, an ancient artifact). These can\'t be dropped and should be referenced later in the story. Plant at least one quest item in the first 3 turns.\n' +
      '- Weapons and armor can have a "bonus" (1-3) and optionally "bonusStat" (strength/dexterity/intelligence/charisma). Higher bonus = rarer/more powerful.\n' +
      '- If introducing a companion, give them a distinct personality trait, a line of dialogue, and set their mood. Companions have loyalty (starts at 50) and mood (neutral/inspired/wary/frightened/angry).\n' +
      '- Set "pacingSignal" to "building" for the opening scene.\n' +
      '- IMPORTANT: Every item or companion mentioned in the narrative MUST appear in stateChanges.addItems or stateChanges.addCompanion. Do not describe the player finding/receiving items without adding them.\n' +
      '- Generate a visual description for the scene illustration (max 150 chars).\n\n' +
      OPENING_RESPONSE_FORMAT;
  }

  // --- Act structure helper (scales with dynamic maxTurns) ---
  function getActInfo(turnCount, maxTurns) {
    maxTurns = maxTurns || 25;
    var turn = turnCount + 1; // next turn number
    // Scale act boundaries proportionally
    var act1End = Math.round(maxTurns * 0.28);    // ~7 for 25
    var act2aEnd = Math.round(maxTurns * 0.56);   // ~14 for 25
    var act2bEnd = Math.round(maxTurns * 0.72);   // ~18 for 25
    var act3End = maxTurns - 1;

    if (turn <= act1End) return { act: 1, label: 'Act 1 — SETUP', guidance: 'Introduce the world, establish the central conflict, and plant clues. The antagonist should be hinted at or encountered indirectly. Build the player\'s connection to allies, locations, and stakes.' };
    if (turn <= act2aEnd) return { act: 2, label: 'Act 2a — RISING ACTION', guidance: 'Escalate complications. Reveal new dimensions of the conflict. Introduce betrayals, twists, or revelations that deepen the mystery. The antagonist\'s presence should grow more threatening.' };
    if (turn <= act2bEnd) return { act: 2.5, label: 'Act 2b — DARKEST MOMENT', guidance: 'The player should face a major setback — a betrayal, a loss, a failed plan, or a devastating revelation. This is the low point before the final push. Make it personal and connected to earlier choices.' };
    if (turn <= act3End) return { act: 3, label: 'Act 3 — CLIMAX', guidance: 'Build toward the final confrontation with the antagonist. Earlier clues and planted details should pay off. The player\'s choices throughout the adventure should shape how this plays out.' };
    return { act: 3, label: 'Act 3 — RESOLUTION', guidance: 'This is the FINAL scene. Resolve the central conflict decisively. Reference the hidden clue from the opening. Give the player\'s journey a satisfying conclusion shaped by their choices.' };
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

    var actInfo = getActInfo(state.turnCount, state.maxTurns);

    // Build plot seed context if available
    var plotContext = '';
    if (state.plotSeed) {
      var ps = state.plotSeed;
      plotContext = '\nSTORY BLUEPRINT (hidden from player — use this to guide the narrative):\n' +
        '- Antagonist: ' + (ps.antagonist || 'unknown') + '\n' +
        '- Central Conflict: ' + (ps.centralConflict || 'unknown') + '\n' +
        '- Plot Points: ' + (ps.keyPlotPoints ? ps.keyPlotPoints.join(' | ') : 'none') + '\n' +
        '- Hidden Clue from Opening: ' + (ps.hiddenClue || 'none') + '\n' +
        '- Current Act: ' + actInfo.label + '\n' +
        '- Act Guidance: ' + actInfo.guidance + '\n';
    }

    // Build companion details with loyalty/mood
    var companionLine = 'none';
    if (state.companions.length) {
      companionLine = state.companions.map(function (c) {
        var loyalty = c.loyalty != null ? c.loyalty : 50;
        var loyaltyLabel = loyalty >= 80 ? 'devoted' : loyalty >= 60 ? 'loyal' : loyalty >= 40 ? 'neutral' : loyalty >= 20 ? 'wary' : 'hostile';
        return c.name + ' (' + c.type + ', ' + loyaltyLabel + ', mood: ' + (c.mood || 'neutral') + ')';
      }).join(', ');
    }

    // Build decisions context
    var decisionsContext = '';
    if (state.decisions && state.decisions.length) {
      var recentDecisions = state.decisions.slice(-8);
      decisionsContext = '\nKEY DECISIONS (reference these — choices should have consequences):\n' +
        recentDecisions.map(function (d) {
          return '- Turn ' + d.turn + ': ' + d.description + (d.impact ? ' → ' + d.impact : '');
        }).join('\n') + '\n';
    }

    // Build location context
    var locationContext = '';
    if (state.currentLocation || (state.visitedLocations && state.visitedLocations.length)) {
      locationContext = '\nWORLD MAP:\n' +
        '- Current Location: ' + (state.currentLocation || 'unknown') + '\n' +
        '- Visited: ' + (state.visitedLocations && state.visitedLocations.length ? state.visitedLocations.join(', ') : 'none') + '\n' +
        '- Create spatially coherent world: if the player travels, name the new location. Revisiting a location should feel different (changed by events).\n';
    }

    // Struggle indicator for adaptive difficulty
    var struggleInfo = '';
    if (typeof window.AdventureRPG !== 'undefined' && window.AdventureRPG.getStruggleScore) {
      var struggleScore = window.AdventureRPG.getStruggleScore(state);
      if (struggleScore <= -2) struggleInfo = '- ADAPTIVE: Player is STRUGGLING badly. Ease up — offer an escape route, a healing opportunity, or an ally. Lower skill check difficulties.\n';
      else if (struggleScore <= -1) struggleInfo = '- ADAPTIVE: Player is having a tough time. Include a helpful item or NPC, and keep one low-risk choice available.\n';
      else if (struggleScore >= 2) struggleInfo = '- ADAPTIVE: Player is breezing through. Increase challenge — tougher enemies, higher stakes, moral dilemmas with no safe option.\n';
    }

    return genre.genrePrompt + '\n\n' +
      'Continue the adventure based on the player\'s choice.\n\n' +
      'GAME STATE:\n' +
      '- Genre: ' + genre.name + '\n' +
      '- Turn: ' + (state.turnCount + 1) + '/' + state.maxTurns + '\n' +
      '- Difficulty: ' + (state.difficulty || 'normal').toUpperCase() + '\n' +
      '- Player: ' + state.playerName + '\n' +
      ((state.character && state.character.description) ? '- Appearance: ' + state.character.description + '\n' : '') +
      '- HP: ' + state.stats.hp + '/' + state.stats.maxHp + '\n' +
      '- Gold: ' + state.stats.gold + '\n' +
      '- Reputation: ' + state.stats.reputation + '\n' +
      '- STR: ' + state.stats.strength + ' DEX: ' + state.stats.dexterity +
      ' INT: ' + state.stats.intelligence + ' CHA: ' + state.stats.charisma + '\n' +
      '- Inventory: ' + (state.inventory.length ? state.inventory.map(function (i) {
        var extra = i.type === 'quest_item' ? ' [QUEST]' : '';
        return i.name + extra;
      }).join(', ') : 'empty') + '\n' +
      '- Equipped: ' + buildEquippedLine(state) + '\n' +
      '- Companions: ' + companionLine + '\n' +
      '- Location: ' + (state.currentLocation || 'unknown') + '\n' +
      '- Key Events: ' + (state.eventLog.length ? state.eventLog.join(', ') : 'adventure just began') + '\n\n' +
      '- Last Scene: ' + (state.lastSceneText || '(opening)').substring(0, 500) + '\n' +
      '- Player\'s Choice: ' + choiceText + '\n' +
      skillInfo +
      plotContext +
      decisionsContext +
      locationContext +
      buildStoryHistory(state) + '\n' +
      'RULES:\n' +
      '- PACING: Turn ' + (state.turnCount + 1) + ' of ' + state.maxTurns + ' (' + (state.maxTurns - state.turnCount - 1) + ' turns remaining). ' + actInfo.label + '. ' + actInfo.guidance + '\n' +
      '- Set "pacingSignal" to indicate story momentum: "building" (setup/exploration), "rising" (complications/escalation), "climax_ready" (ready for final confrontation), "resolving" (wrapping up). This helps the game engine adjust turn limits dynamically.\n' +
      struggleInfo +
      '- Write exactly 3 paragraphs: (1) consequence of the choice — what happens immediately, (2) exploration/discovery — what the player sees, hears, finds, (3) new tension — set up the next decision point.\n' +
      '- ADVANCE THE PLOT: Every scene must move the overarching story forward. Reference earlier events from STORY SO FAR, callback to past player choices, foreshadow upcoming plot points, and connect scenes to the central conflict. Do NOT write disconnected episodic scenes.\n' +
      '- DECISIONS MATTER: Reference the player\'s KEY DECISIONS from above. If they saved someone, that person should return. If they chose violence, NPCs should react with fear. If they were merciful, allies should be more trusting. Include a "decision" in stateChanges for meaningful choices — these accumulate and shape later scenes.\n' +
      '- Use all five senses. Include sounds, smells, textures, temperature — not just visual descriptions.\n' +
      '- Vary sentence length: short punchy beats for action, longer flowing prose for atmosphere.\n' +
      '- Do NOT start consecutive paragraphs the same way.\n' +
      '- COMPANIONS: If the player has companions, they MUST have at least 1-2 lines of dialogue or a meaningful action every scene. Companions have loyalty (0-100) and mood — their behavior should reflect this. A wary companion questions the player\'s decisions. A devoted one fights harder. A frightened one might refuse dangerous tasks. Set "companionLoyalty" in stateChanges when the player\'s choice affects a companion (brave actions: +5-10, betrayal/cruelty: -10-20, saving them: +15-20). If loyalty reaches 0, the companion LEAVES.\n' +
      '- EQUIPMENT: Reference equipped items naturally in the prose. When adding weapons or armor, give them a "bonus" (1-3) and optionally a "bonusStat". Mundane: bonus 1. Fine/enchanted: bonus 2. Legendary/rare: bonus 3.\n' +
      '- QUEST ITEMS: Items with type "quest_item" are narratively significant — they can\'t be dropped. Reference them when relevant to the plot. If the player has a quest item that could solve the current problem, hint at it in the choices.\n' +
      '- LOCATIONS: Set "location" in stateChanges with the current place name. Create a coherent world — name locations consistently. When revisiting a location, describe how it\'s changed.\n' +
      '- Present 3-4 choices. At least one cautious, one bold, one creative.\n' +
      '- Each choice must lead to a DIFFERENT outcome — never offer three flavors of the same action.\n' +
      '- Never offer "do nothing" or "wait and see" as a choice.\n' +
      '- At least one choice should leverage the player\'s inventory or companions if available.\n' +
      '- Bold choices should have higher risk AND higher reward in stateChanges.\n' +
      '- Each choice should hint at its consequence without spoiling it.\n' +
      '- If a choice involves risk, add a skillCheck (stat + difficulty 8-18).\n' +
      '- Track HP changes, inventory, companions, reputation. Damage range: ' +
      (state.difficulty === 'easy' ? '-3 to -15' : state.difficulty === 'hard' ? '-10 to -30' : '-5 to -25') +
      ', healing range: ' + (state.difficulty === 'easy' ? '+15 to +35' : state.difficulty === 'hard' ? '+5 to +20' : '+10 to +30') + '.\n' +
      '- HEALING ITEMS: When the player discovers potions, herbs, medkits, elixirs, or similar restorative items, add them with type "consumable". The player can use these from their inventory between scenes.' +
      (state.difficulty === 'easy' ? ' On Easy mode — include healing items generously, drop one whenever HP is below 60%.' :
       state.difficulty === 'hard' ? ' On Hard mode — healing items are scarce. Only include one if HP drops below 25%.' :
       ' If HP is below 40%, try to weave a healing item find into the scene naturally.') + '\n' +
      '- IMPORTANT: Every item or companion mentioned in the narrative MUST appear in stateChanges. Do not describe the player finding/receiving/losing items without including them in addItems/removeItems.\n' +
      '- If HP <= 0, this is a DEATH scene — set isEnding:true, endingType:"death", no choices.\n' +
      (state.turnCount >= 18 ? '- IMPORTANT: We are in the final act. Start steering toward the climax confrontation with the antagonist.\n' : '') +
      (state.turnCount >= state.maxTurns - 1 ? '- FINAL TURN: This MUST be the ending. Set isEnding:true, endingType:"victory" or "escape". Resolve the central conflict. Reference the hidden clue from the opening. Give the story a satisfying conclusion.\n' : '') +
      '- Generate a visual description for the scene (max 150 chars).\n\n' +
      RESPONSE_FORMAT;
  }

  var RESPONSE_FORMAT =
    'Return ONLY valid JSON (no markdown, no code fences, no extra text):\n' +
    '{\n' +
    '  "sceneText": "2-4 paragraphs of narrative prose",\n' +
    '  "imagePrompt": "short visual scene description — protagonist facing viewer or three-quarter angle with face visible, never from behind. Max 150 chars",\n' +
    '  "location": "Name of current location (e.g. The Sunken Crypt, Dockside Market)",\n' +
    '  "choices": [\n' +
    '    { "id": "a", "text": "choice text", "skillCheck": null },\n' +
    '    { "id": "b", "text": "choice text", "skillCheck": { "stat": "dexterity", "difficulty": 12 } },\n' +
    '    { "id": "c", "text": "choice text", "skillCheck": null }\n' +
    '  ],\n' +
    '  "stateChanges": {\n' +
    '    "hpDelta": 0,\n' +
    '    "goldDelta": 0,\n' +
    '    "reputationDelta": 0,\n' +
    '    "addItems": [{"name":"Item Name","type":"weapon|armor|consumable|tool|quest_item","description":"short desc","bonus":1,"bonusStat":"strength"}],\n' +
    '    "removeItems": [],\n' +
    '    "addCompanion": null,\n' +
    '    "removeCompanion": null,\n' +
    '    "companionLoyalty": {"CompanionName": {"delta": 5, "mood": "inspired|loyal|wary|frightened|angry"}},\n' +
    '    "location": "Current Location Name",\n' +
    '    "decision": {"id": "short_id", "description": "what the player decided", "impact": "how this might matter later"},\n' +
    '    "eventTag": "short_event_tag"\n' +
    '  },\n' +
    '  "pacingSignal": "building|rising|climax_ready|resolving",\n' +
    '  "isEnding": false,\n' +
    '  "endingType": null\n' +
    '}';

  var OPENING_RESPONSE_FORMAT =
    'Return ONLY valid JSON (no markdown, no code fences, no extra text):\n' +
    '{\n' +
    '  "storyTitle": "Evocative 3-6 word title for this adventure",\n' +
    '  "sceneText": "2-4 paragraphs of narrative prose",\n' +
    '  "imagePrompt": "short visual scene description — protagonist facing viewer or three-quarter angle with face visible, never from behind. Max 150 chars",\n' +
    '  "location": "Name of starting location (e.g. The Sunken Crypt, Dockside Market)",\n' +
    '  "choices": [\n' +
    '    { "id": "a", "text": "choice text", "skillCheck": null },\n' +
    '    { "id": "b", "text": "choice text", "skillCheck": { "stat": "dexterity", "difficulty": 12 } },\n' +
    '    { "id": "c", "text": "choice text", "skillCheck": null }\n' +
    '  ],\n' +
    '  "stateChanges": {\n' +
    '    "hpDelta": 0,\n' +
    '    "goldDelta": 0,\n' +
    '    "reputationDelta": 0,\n' +
    '    "addItems": [{"name":"Item Name","type":"weapon|armor|consumable|tool|quest_item","description":"short desc","bonus":1,"bonusStat":"strength"}],\n' +
    '    "removeItems": [],\n' +
    '    "addCompanion": null,\n' +
    '    "removeCompanion": null,\n' +
    '    "location": "Starting Location Name",\n' +
    '    "decision": null,\n' +
    '    "eventTag": "short_event_tag"\n' +
    '  },\n' +
    '  "pacingSignal": "building",\n' +
    '  "isEnding": false,\n' +
    '  "endingType": null,\n' +
    '  "plotSeed": {\n' +
    '    "antagonist": "Name and 1-sentence description of the main villain or opposing force",\n' +
    '    "centralConflict": "1-sentence description of the core problem the player must resolve",\n' +
    '    "keyPlotPoints": [\n' +
    '      "Act 1 (turns 1-7): Setup event or discovery that hooks the player",\n' +
    '      "Act 2 (turns 8-14): Major complication or betrayal that raises the stakes",\n' +
    '      "Act 2b (turns 15-18): Darkest moment — the player suffers a setback or loss",\n' +
    '      "Act 3 (turns 19-25): Climax confrontation and resolution"\n' +
    '    ],\n' +
    '    "hiddenClue": "A subtle detail planted in this opening scene that becomes important later"\n' +
    '  }\n' +
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
    scene.pacingSignal = scene.pacingSignal || null;

    // Propagate top-level location into stateChanges if present
    if (scene.location && !scene.stateChanges.location) {
      scene.stateChanges.location = scene.location;
    }

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

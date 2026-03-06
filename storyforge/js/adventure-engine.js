/**
 * adventure-engine.js — StoryForge core game loop, state machine, turn processing
 */
(function () {
  'use strict';

  var UI = window.AdventureUI;
  var RPG = window.AdventureRPG;
  var AI = window.AdventureAI;
  var Storage = window.AdventureStorage;
  var Ent = window.AdventureEntitlements;

  var genres = [];
  var selectedGenre = null;
  var gameState = null;
  var currentScene = null;
  var isProcessing = false;
  var currentNarration = null; // { source, ctx } for Web Audio playback
  var audioCtx = null; // Shared AudioContext, unlocked on first user gesture

  // --- Initialize ---
  function init() {
    var entPromise = Ent ? Ent.load() : Promise.resolve(null);
    Promise.all([loadGenres(), entPromise]).then(function () {
      bindEvents();
      handleUrlParams();
    });
  }

  // --- URL Parameter Handling ---
  function handleUrlParams() {
    var params = new URLSearchParams(window.location.search);
    var genreId = params.get('genre');
    var continueId = params.get('continue');

    if (continueId) {
      // Resume saved adventure
      UI.showLoading(UI.$('sceneText'), 'Loading saved adventure...');
      UI.showScreen('screenPlay');
      Storage.loadAdventure(continueId).then(function (adventure) {
        if (!adventure) {
          UI.toast('Saved adventure not found', 'error');
          UI.showScreen('screenGenreSelect');
          return;
        }
        resumeAdventure(adventure);
      }).catch(function () {
        UI.toast('Failed to load adventure', 'error');
        UI.showScreen('screenGenreSelect');
      });
    } else if (genreId) {
      // Auto-select genre from hub link
      selectedGenre = genres.find(function (g) { return g.id === genreId; });
      if (selectedGenre) {
        UI.$('advApp').setAttribute('data-genre', selectedGenre.id);
        var card = document.querySelector('.adv-genre-card[data-genre="' + genreId + '"]');
        if (card) card.classList.add('adv-genre-card--selected');
        showCharacterCreator(selectedGenre);
      }
      UI.showScreen('screenGenreSelect');
    } else {
      UI.showScreen('screenGenreSelect');
    }
  }

  // --- Resume Saved Adventure ---
  function resumeAdventure(adventure) {
    gameState = adventure;
    selectedGenre = genres.find(function (g) { return g.id === adventure.genre; });

    if (selectedGenre) {
      UI.$('advApp').setAttribute('data-genre', selectedGenre.id);
    }

    UI.showScreen('screenPlay');
    UI.$('pauseBtn').style.display = '';
    updateSidebar();

    // Render the last scene text
    UI.$('turnLabel').textContent = 'Turn ' + gameState.turnCount;
    UI.$('progressFill').style.width = ((gameState.turnCount / gameState.maxTurns) * 100) + '%';
    UI.$('sceneText').innerHTML = '<p>' + UI.escapeHtml(gameState.lastSceneText || 'Your adventure continues...').replace(/\n\n/g, '</p><p>') + '</p>';
    injectNarrateButton(gameState.lastSceneText || 'Your adventure continues...');

    // Show first scene image if available
    if (gameState.firstSceneImage) {
      var img = UI.$('sceneImage');
      img.src = gameState.firstSceneImage;
      img.classList.add('adv-scene__image--loaded');
      UI.$('sceneImagePlaceholder').style.display = 'none';
    }

    // Generate fresh choices for the current scene
    isProcessing = true;
    AI.generateContinuation(selectedGenre, gameState)
      .then(function (scene) {
        currentScene = scene;
        renderChoices(scene.choices);
        isProcessing = false;
      })
      .catch(function () {
        // Fallback: offer generic choices
        currentScene = {
          choices: [
            { id: 'explore', text: 'Look around and assess the situation' },
            { id: 'proceed', text: 'Press forward cautiously' },
            { id: 'rest', text: 'Take a moment to rest and recover' }
          ]
        };
        renderChoices(currentScene.choices);
        isProcessing = false;
      });
  }

  function loadGenres() {
    return fetch('/storyforge/data/genres.json?v=2')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        genres = data.genres || [];
        renderGenreGrid();
      })
      .catch(function (err) {
        UI.toast('Failed to load genres', 'error');
        console.error('Genre load error:', err);
      });
  }

  // --- Genre Selection ---
  function renderGenreGrid() {
    var grid = UI.$('genreGrid');
    if (!grid) return;

    grid.innerHTML = genres.map(function (g) {
      return '<div class="adv-genre-card" data-genre="' + g.id + '">' +
        '<img class="adv-genre-card__img" src="images/genre-' + g.id + '.png" alt="' + g.name + '" loading="lazy" />' +
        '<div class="adv-genre-card__name">' + g.name + '</div>' +
        '<div class="adv-genre-card__desc">' + g.description + '</div>' +
      '</div>';
    }).join('');

    grid.addEventListener('click', function (e) {
      var card = e.target.closest('.adv-genre-card');
      if (!card) return;
      grid.querySelectorAll('.adv-genre-card').forEach(function (c) {
        c.classList.remove('adv-genre-card--selected');
      });
      card.classList.add('adv-genre-card--selected');
      selectedGenre = genres.find(function (g) { return g.id === card.dataset.genre; });
      UI.$('advApp').setAttribute('data-genre', selectedGenre.id);
      showCharacterCreator(selectedGenre);
    });
  }

  // --- Events ---
  function bindEvents() {
    UI.$('startAdventureBtn').addEventListener('click', startAdventure);
    UI.$('newAdventureBtn').addEventListener('click', function () {
      gameState = null;
      currentScene = null;
      selectedGenre = null;
      UI.$('startAdventureBtn').disabled = true;
      UI.$('advApp').removeAttribute('data-genre');
      document.querySelectorAll('.adv-genre-card').forEach(function (c) {
        c.classList.remove('adv-genre-card--selected');
      });
      var creator = UI.$('characterCreator');
      if (creator) creator.style.display = 'none';
      resetPortrait();
      var hint = UI.$('portraitHint');
      if (hint) hint.style.display = '';
      UI.showScreen('screenGenreSelect');
    });

    var portraitBtn = UI.$('generatePortraitBtn');
    if (portraitBtn) portraitBtn.addEventListener('click', generatePortrait);

    UI.$('pauseBtn').addEventListener('click', showPauseMenu);
    UI.$('resumeBtn').addEventListener('click', hidePauseMenu);
    UI.$('saveQuitBtn').addEventListener('click', function () {
      saveAdventure();
      UI.toast('Adventure saved', 'success');
      setTimeout(function () { window.location.href = '/storyforge/'; }, 500);
    });
    UI.$('abandonBtn').addEventListener('click', function () {
      if (confirm('Abandon this adventure? Progress will be lost.')) {
        gameState = null;
        currentScene = null;
        window.location.href = '/storyforge/';
      }
    });

    // Keyboard shortcuts for choices (1-4) + Escape for pause
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && gameState) {
        var overlay = UI.$('pauseOverlay');
        if (overlay.style.display === 'none') {
          showPauseMenu();
        } else {
          hidePauseMenu();
        }
        return;
      }
      if (isProcessing) return;
      var num = parseInt(e.key);
      if (num >= 1 && num <= 4) {
        var choices = document.querySelectorAll('.adv-choice:not(:disabled)');
        if (choices[num - 1]) choices[num - 1].click();
      }
    });
  }

  // --- Character Creator ---
  function showCharacterCreator(genre) {
    var creator = UI.$('characterCreator');
    var container = UI.$('charOptionsContainer');
    if (!genre || !genre.characterOptions || Object.keys(genre.characterOptions).length === 0) {
      if (creator) creator.style.display = 'none';
      return;
    }
    creator.style.display = '';
    var keys = Object.keys(genre.characterOptions);
    container.innerHTML = keys.map(function (key) {
      var opts = genre.characterOptions[key];
      var label = key.replace(/([A-Z])/g, ' $1').replace(/^./, function (s) { return s.toUpperCase(); });
      return '<div class="adv-char-creator__field">' +
        '<label class="adv-char-creator__label">' + label + '</label>' +
        '<select class="adv-char-creator__select" data-char-key="' + key + '">' +
        opts.map(function (opt, i) {
          return '<option value="' + i + '">' + UI.escapeHtml(opt.label) + '</option>';
        }).join('') +
        '</select></div>';
    }).join('');
    container.querySelectorAll('.adv-char-creator__select').forEach(function (sel) {
      sel.addEventListener('change', updateCharacterPreview);
    });
    updateCharacterPreview();
    renderStatAllocator(genre);
  }

  function updateCharacterPreview() {
    var preview = UI.$('charPreviewText');
    if (!preview) return;
    var desc = buildCharacterDescription();
    preview.textContent = desc || '';
  }

  function buildCharacterDescription() {
    if (!selectedGenre || !selectedGenre.characterOptions) return '';
    var parts = [];
    document.querySelectorAll('.adv-char-creator__select').forEach(function (sel) {
      var key = sel.dataset.charKey;
      var idx = parseInt(sel.value, 10);
      var opts = selectedGenre.characterOptions[key];
      if (opts && opts[idx] && opts[idx].promptFragment) {
        parts.push(opts[idx].promptFragment);
      }
    });
    return parts.join(', ');
  }

  function collectCharacterSelections() {
    if (!selectedGenre || !selectedGenre.characterOptions) return null;
    var selections = {};
    document.querySelectorAll('.adv-char-creator__select').forEach(function (sel) {
      var key = sel.dataset.charKey;
      var idx = parseInt(sel.value, 10);
      var opts = selectedGenre.characterOptions[key];
      if (opts && opts[idx]) {
        selections[key] = { label: opts[idx].label, promptFragment: opts[idx].promptFragment };
      }
    });
    return { selections: selections, description: buildCharacterDescription() };
  }

  // --- Character Portrait ---
  var generatedPortraitDataUrl = null;

  function generatePortrait() {
    if (!selectedGenre) return;
    var btn = UI.$('generatePortraitBtn');
    var img = UI.$('portraitImage');
    var placeholder = UI.$('portraitPlaceholder');
    if (!btn || !img) return;

    var charDesc = buildCharacterDescription();
    if (!charDesc) {
      UI.toast('Select appearance options first', 'warning');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    placeholder.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    AI.generatePortraitImage(charDesc, selectedGenre)
      .then(function (dataUrl) {
        if (dataUrl) {
          generatedPortraitDataUrl = dataUrl;
          img.onload = function () {
            img.classList.add('adv-portrait__image--loaded');
            placeholder.style.display = 'none';
          };
          img.src = dataUrl;
          btn.innerHTML = '<i class="fas fa-rotate"></i> Regenerate';
          UI.$('startAdventureBtn').disabled = false;
          var hint = UI.$('portraitHint');
          if (hint) hint.style.display = 'none';
        } else {
          placeholder.innerHTML = '<i class="fas fa-user-circle"></i>';
          UI.toast('Portrait generation failed — try again', 'warning');
        }
        btn.disabled = false;
      })
      .catch(function () {
        placeholder.innerHTML = '<i class="fas fa-user-circle"></i>';
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Portrait';
        btn.disabled = false;
      });
  }

  function resetPortrait() {
    generatedPortraitDataUrl = null;
    var img = UI.$('portraitImage');
    var placeholder = UI.$('portraitPlaceholder');
    var btn = UI.$('generatePortraitBtn');
    if (img) {
      img.src = '';
      img.classList.remove('adv-portrait__image--loaded');
    }
    if (placeholder) {
      placeholder.style.display = '';
      placeholder.innerHTML = '<i class="fas fa-user-circle"></i>';
    }
    if (btn) {
      btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Portrait';
      btn.disabled = false;
    }
  }

  function renderSidebarPortrait() {
    var container = UI.$('sidebarPortrait');
    if (!container || !gameState) return;
    var portraitSrc = gameState.portraitImage || generatedPortraitDataUrl;
    if (!portraitSrc) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';
    container.innerHTML =
      '<div class="adv-sidebar__portrait-frame"><img src="' + portraitSrc + '" alt="Portrait" /></div>' +
      '<div class="adv-sidebar__portrait-name">' + UI.escapeHtml(gameState.playerName) + '</div>';
  }

  // --- Stat Allocator ---
  var STAT_KEYS = ['strength', 'dexterity', 'intelligence', 'charisma'];
  var STAT_COLORS = { strength: '#ff5252', dexterity: '#00e676', intelligence: '#7b2fff', charisma: '#ffd740' };
  var STAT_MIN = 4;
  var STAT_MAX = 20;
  var activePresetLabel = null;

  function getStatBudget(genre) {
    var s = genre.startingStats;
    return s.strength + s.dexterity + s.intelligence + s.charisma;
  }

  function getDefaultStats(genre) {
    var s = genre.startingStats;
    return { strength: s.strength, dexterity: s.dexterity, intelligence: s.intelligence, charisma: s.charisma };
  }

  function renderStatAllocator(genre) {
    var rowsEl = UI.$('statSliderRows');
    var presetsEl = UI.$('archetypePresets');
    if (!rowsEl || !presetsEl) return;

    var budget = getStatBudget(genre);
    var defaults = getDefaultStats(genre);
    var hints = genre.statHints || {};
    activePresetLabel = null;

    // Render slider rows
    rowsEl.innerHTML = STAT_KEYS.map(function (key) {
      var val = defaults[key];
      var icon = RPG.STAT_ICONS[key] || 'fa-circle';
      var label = RPG.STAT_LABELS[key] || key;
      var color = STAT_COLORS[key];
      var hint = hints[key] || '';
      var mod = Math.floor((val - 10) / 2);
      var modStr = mod >= 0 ? '+' + mod : '' + mod;
      var modClass = mod > 0 ? ' adv-stat-row__modifier--positive' : (mod < 0 ? ' adv-stat-row__modifier--negative' : '');
      var fillPct = ((val - STAT_MIN) / (STAT_MAX - STAT_MIN)) * 100;
      return '<div class="adv-stat-row" data-stat-key="' + key + '">' +
        '<i class="fas ' + icon + ' adv-stat-row__icon" style="color:' + color + '"></i>' +
        '<span class="adv-stat-row__label" title="' + UI.escapeHtml(hint) + '">' + label + '</span>' +
        '<input type="range" class="adv-stat-row__slider" data-stat-key="' + key + '" ' +
          'min="' + STAT_MIN + '" max="' + STAT_MAX + '" value="' + val + '" ' +
          'style="--fill:' + fillPct + '%" aria-label="' + label + '" />' +
        '<span class="adv-stat-row__value">' + val + '</span>' +
        '<span class="adv-stat-row__modifier' + modClass + '">' + modStr + '</span>' +
      '</div>';
    }).join('');

    // Bind slider events
    rowsEl.querySelectorAll('.adv-stat-row__slider').forEach(function (slider) {
      slider.addEventListener('input', function () {
        enforceStatBudget(slider.dataset.statKey, parseInt(slider.value));
        updateSliderDisplay(slider);
        updateStatBudgetDisplay(budget);
        updateStatPreviewSentence();
        activePresetLabel = null;
        updatePresetHighlight();
      });
    });

    // Render archetype presets
    var presets = genre.archetypePresets || [];
    presetsEl.innerHTML = presets.map(function (p) {
      return '<button type="button" class="adv-archetype-btn" data-preset-label="' + UI.escapeHtml(p.label) + '">' +
        '<i class="fas ' + p.icon + '"></i> ' + UI.escapeHtml(p.label) +
      '</button>';
    }).join('');

    presetsEl.querySelectorAll('.adv-archetype-btn').forEach(function (btn, idx) {
      btn.addEventListener('click', function () {
        applyArchetypePreset(presets[idx]);
        activePresetLabel = presets[idx].label;
        updatePresetHighlight();
        updateStatBudgetDisplay(budget);
        updateStatPreviewSentence();
      });
    });

    // Reset button
    var resetBtn = UI.$('statResetBtn');
    if (resetBtn) {
      resetBtn.onclick = function () {
        applyArchetypePreset({ stats: defaults });
        activePresetLabel = null;
        updatePresetHighlight();
        updateStatBudgetDisplay(budget);
        updateStatPreviewSentence();
      };
    }

    updateStatBudgetDisplay(budget);
    updateStatPreviewSentence();
  }

  function enforceStatBudget(changedKey, requestedValue) {
    if (!selectedGenre) return;
    var budget = getStatBudget(selectedGenre);
    var slider = document.querySelector('.adv-stat-row__slider[data-stat-key="' + changedKey + '"]');
    if (!slider) return;

    var otherTotal = 0;
    document.querySelectorAll('.adv-stat-row__slider').forEach(function (s) {
      if (s.dataset.statKey !== changedKey) {
        otherTotal += parseInt(s.value) || 0;
      }
    });

    var maxAllowed = Math.min(STAT_MAX, budget - otherTotal);
    var clamped = Math.min(requestedValue, Math.max(STAT_MIN, maxAllowed));
    slider.value = clamped;
  }

  function updateSliderDisplay(slider) {
    var row = slider.closest('.adv-stat-row');
    var val = parseInt(slider.value);
    var fillPct = ((val - STAT_MIN) / (STAT_MAX - STAT_MIN)) * 100;
    slider.style.setProperty('--fill', fillPct + '%');
    row.querySelector('.adv-stat-row__value').textContent = val;
    var mod = Math.floor((val - 10) / 2);
    var modStr = mod >= 0 ? '+' + mod : '' + mod;
    var modEl = row.querySelector('.adv-stat-row__modifier');
    modEl.textContent = modStr;
    modEl.className = 'adv-stat-row__modifier' +
      (mod > 0 ? ' adv-stat-row__modifier--positive' : (mod < 0 ? ' adv-stat-row__modifier--negative' : ''));
  }

  function updateStatBudgetDisplay(budget) {
    var display = UI.$('statBudgetDisplay');
    if (!display) return;
    var used = 0;
    document.querySelectorAll('.adv-stat-row__slider').forEach(function (s) {
      used += parseInt(s.value) || 0;
    });
    var remaining = budget - used;
    display.textContent = remaining + ' / ' + budget;
    display.classList.toggle('adv-stat-allocator__budget--empty', remaining <= 0);
    display.classList.toggle('adv-stat-allocator__budget--low', remaining > 0 && remaining <= 4);
  }

  function applyArchetypePreset(preset) {
    STAT_KEYS.forEach(function (key) {
      var slider = document.querySelector('.adv-stat-row__slider[data-stat-key="' + key + '"]');
      if (slider && preset.stats[key] != null) {
        slider.value = preset.stats[key];
        updateSliderDisplay(slider);
      }
    });
  }

  function updatePresetHighlight() {
    document.querySelectorAll('.adv-archetype-btn').forEach(function (btn) {
      btn.classList.toggle('adv-archetype-btn--active', btn.dataset.presetLabel === activePresetLabel);
    });
  }

  function updateStatPreviewSentence() {
    var preview = UI.$('statPreviewText');
    if (!preview) return;

    var vals = {};
    document.querySelectorAll('.adv-stat-row__slider').forEach(function (s) {
      vals[s.dataset.statKey] = parseInt(s.value);
    });

    var parts = [];

    // Highest stat descriptor
    var highest = STAT_KEYS.reduce(function (a, b) { return vals[a] >= vals[b] ? a : b; });
    var lowest = STAT_KEYS.reduce(function (a, b) { return vals[a] <= vals[b] ? a : b; });
    var descriptors = {
      strength: { high: 'Powerful', low: 'Frail' },
      dexterity: { high: 'Agile', low: 'Clumsy' },
      intelligence: { high: 'Brilliant', low: 'Simple' },
      charisma: { high: 'Charming', low: 'Awkward' }
    };

    if (vals[highest] >= 14) parts.push(descriptors[highest].high);
    if (vals[lowest] <= 6 && lowest !== highest) parts.push('but ' + descriptors[lowest].low.toLowerCase());

    // Strategy description
    if (vals.strength >= 14 && vals.dexterity >= 14) {
      parts.push('— a natural fighter');
    } else if (vals.intelligence >= 14 && vals.charisma >= 14) {
      parts.push('— silver-tongued and sharp');
    } else if (vals.strength >= 14 && vals.intelligence <= 8) {
      parts.push('— brawn over brains');
    } else if (vals.intelligence >= 14 && vals.strength <= 8) {
      parts.push('— wits over muscle');
    } else if (vals[highest] - vals[lowest] <= 2) {
      parts.push('— a balanced soul');
    }

    preview.textContent = parts.join(' ') || 'Balanced across all stats';
  }

  function collectStatAllocations() {
    var stats = {};
    document.querySelectorAll('.adv-stat-row__slider').forEach(function (s) {
      stats[s.dataset.statKey] = parseInt(s.value);
    });
    return stats;
  }

  // --- Start Adventure ---
  function startAdventure() {
    if (!selectedGenre || isProcessing) return;

    // Genre gating: check if user can access this genre tier
    if (Ent && !Ent.canAccessGenre(selectedGenre.id, selectedGenre.tier)) {
      Ent.showUpgradePrompt('The ' + selectedGenre.name + ' genre requires StoryForge Pro.');
      return;
    }

    // Dynamic daily limit from entitlements
    var dailyLimit = (Ent && Ent.getDailyLimit) ? Ent.getDailyLimit() : 15;
    if (!AI.checkDailyLimit(dailyLimit)) {
      if (Ent && !Ent.isPro()) {
        Ent.showUpgradePrompt('You\'ve used all ' + dailyLimit + ' free adventures today. Upgrade for unlimited.');
      } else {
        UI.toast('Daily limit reached', 'warning');
      }
      return;
    }

    var nameInput = UI.$('playerNameInput');
    var playerName = (nameInput.value || '').trim() || RPG.generateName();
    var characterAppearance = collectCharacterSelections();
    var customStats = collectStatAllocations();

    gameState = RPG.createState(selectedGenre, playerName, characterAppearance, customStats);
    if (generatedPortraitDataUrl) {
      gameState.portraitImage = generatedPortraitDataUrl;
    }
    isProcessing = true;

    UI.showScreen('screenPlay');
    UI.$('pauseBtn').style.display = '';
    UI.showLoading(UI.$('sceneText'), 'Forging your story...');
    UI.$('choicesContainer').innerHTML = '';
    updateSidebar();

    AI.incrementUsage();

    AI.generateOpeningScene(selectedGenre, playerName, gameState.character)
      .then(function (scene) {
        currentScene = scene;
        gameState.turnCount = 1;
        gameState.lastSceneText = scene.sceneText;
        RPG.applyStateChanges(gameState, scene.stateChanges);
        renderScene(scene);
        generateAndShowImage(scene.imagePrompt);
      })
      .catch(function (err) {
        UI.toast('Failed to generate scene: ' + err.message, 'error');
        console.error('Scene generation error:', err);
        isProcessing = false;
      });
  }

  // --- Narration (TTS via Web Audio API) ---
  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume on every user gesture to handle suspended state
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function stopNarration() {
    if (currentNarration) {
      try { currentNarration.source.stop(); } catch (e) {}
      currentNarration = null;
    }
    var btn = document.querySelector('.adv-narrate');
    if (btn) {
      btn.classList.remove('adv-narrate--loading', 'adv-narrate--playing');
      btn.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    }
  }

  function narrateScene(text) {
    var btn = document.querySelector('.adv-narrate');
    if (!btn) return;

    // Toggle off if already playing
    if (currentNarration) {
      stopNarration();
      return;
    }

    // Unlock AudioContext immediately within user-gesture context
    var ctx = ensureAudioContext();

    // Loading state
    btn.classList.add('adv-narrate--loading');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';

    var sessionId = {};  // unique ref to detect stale callbacks
    currentNarration = { source: null, id: sessionId };

    var voice = (gameState && AI.GENRE_VOICES[gameState.genre]) || 'Kore';
    AI.callTTSAPI(text, voice).then(function (audioUrl) {
      if (!currentNarration || currentNarration.id !== sessionId) {
        // User stopped narration while TTS was loading
        if (audioUrl && audioUrl.indexOf('blob:') === 0) URL.revokeObjectURL(audioUrl);
        return;
      }
      if (!audioUrl) {
        stopNarration();
        UI.toast('Narration unavailable', 'warning');
        return;
      }

      // Fetch the audio data as ArrayBuffer for Web Audio API
      return fetch(audioUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        if (audioUrl.indexOf('blob:') === 0) URL.revokeObjectURL(audioUrl);
        if (!currentNarration || currentNarration.id !== sessionId) return;
        return ctx.decodeAudioData(buf);
      }).then(function (audioBuffer) {
        if (!audioBuffer || !currentNarration || currentNarration.id !== sessionId) return;

        var source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentNarration = { source: source, id: sessionId };

        source.onended = function () {
          if (currentNarration && currentNarration.id === sessionId) {
            currentNarration = null;
            btn.classList.remove('adv-narrate--playing');
            btn.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
          }
        };

        source.start(0);
        btn.classList.remove('adv-narrate--loading');
        btn.classList.add('adv-narrate--playing');
        btn.innerHTML = '<i class="fas fa-stop"></i> Stop';
      });
    }).catch(function (err) {
      console.warn('[TTS] Playback error:', err);
      stopNarration();
      UI.toast('Audio playback failed', 'error');
    });
  }

  function injectNarrateButton(sceneText) {
    var el = UI.$('sceneText');
    if (!el) return;
    var btn = document.createElement('button');
    btn.className = 'adv-narrate';
    btn.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    btn.addEventListener('click', function () {
      narrateScene(sceneText);
    });
    el.appendChild(btn);
  }

  // --- Render Scene ---
  function renderScene(scene) {
    // Stop any playing narration from previous scene
    stopNarration();

    // Turn bar
    UI.$('turnLabel').textContent = 'Turn ' + gameState.turnCount;
    UI.$('progressFill').style.width = ((gameState.turnCount / gameState.maxTurns) * 100) + '%';

    // Scene entrance animation
    var sceneTextEl = UI.$('sceneText');
    sceneTextEl.classList.remove('adv-scene-enter');
    void sceneTextEl.offsetWidth; // force reflow to restart animation
    sceneTextEl.classList.add('adv-scene-enter');

    // Typewriter text
    UI.typewriter(sceneTextEl, scene.sceneText).then(function () {
      injectNarrateButton(scene.sceneText);
      if (scene.isEnding) {
        showEnding(scene);
      } else {
        renderChoices(scene.choices);
      }
      isProcessing = false;
    });

    updateSidebar();
    saveAdventure();
  }

  // --- Render Choices ---
  function renderChoices(choices) {
    var container = UI.$('choicesContainer');
    container.innerHTML = choices.map(function (choice, i) {
      var skillBadge = '';
      if (choice.skillCheck) {
        var label = (RPG.STAT_LABELS[choice.skillCheck.stat] || choice.skillCheck.stat) +
          ' DC' + choice.skillCheck.difficulty;
        skillBadge = '<span class="adv-choice__skill">' + label + '</span>';
      }
      return '<button class="adv-choice" data-choice-id="' + choice.id + '" data-index="' + i + '">' +
        '<span class="adv-choice__key">' + (i + 1) + '</span>' +
        '<span class="adv-choice__text">' + UI.escapeHtml(choice.text) + '</span>' +
        skillBadge +
      '</button>';
    }).join('');

    container.querySelectorAll('.adv-choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleChoice(btn.dataset.choiceId);
      });
    });
  }

  // --- Handle Choice ---
  function handleChoice(choiceId) {
    if (isProcessing || !currentScene) return;
    isProcessing = true;

    var choice = currentScene.choices.find(function (c) { return c.id === choiceId; });
    if (!choice) { isProcessing = false; return; }

    // Highlight selected choice
    document.querySelectorAll('.adv-choice').forEach(function (btn) {
      btn.disabled = true;
      if (btn.dataset.choiceId === choiceId) btn.classList.add('adv-choice--selected');
    });

    // Skill check?
    if (choice.skillCheck) {
      performSkillCheck(choice);
    } else {
      generateNextTurn(choice.text, null);
    }
  }

  // --- Skill Check ---
  function performSkillCheck(choice) {
    var sc = choice.skillCheck;
    var result = RPG.rollSkillCheck(gameState.stats, gameState.companions, sc.stat, sc.difficulty, gameState.equipped);

    showDiceRoll(result).then(function () {
      // Apply failure damage
      if (!result.success) {
        var dmg = -(5 + Math.floor(Math.random() * 11)); // -5 to -15
        if (result.critical === 'critical_failure') dmg *= 2;
        gameState.stats.hp = Math.max(0, gameState.stats.hp + dmg);
        UI.$('hpFill').parentElement.classList.add('adv-hp-flash');
        setTimeout(function () {
          UI.$('hpFill').parentElement.classList.remove('adv-hp-flash');
        }, 500);
        updateSidebar();
      }

      if (result.critical === 'critical_success') {
        var heal = 5;
        gameState.stats.hp = Math.min(gameState.stats.maxHp, gameState.stats.hp + heal);
      }

      generateNextTurn(choice.text, result);
    });
  }

  // --- Dice Roll Animation ---
  function showDiceRoll(result) {
    return new Promise(function (resolve) {
      var panel = UI.$('dicePanel');
      var valueEl = UI.$('diceValue');
      var labelEl = UI.$('diceLabel');
      var resultEl = UI.$('diceResult');

      panel.classList.add('adv-dice--active');
      labelEl.textContent = RPG.STAT_LABELS[result.stat] + ' Check (DC ' + result.difficulty + ')';

      // Animate dice rolling
      var rollCount = 0;
      var maxRolls = 12;
      var rollInterval = setInterval(function () {
        valueEl.textContent = Math.floor(Math.random() * 20) + 1;
        rollCount++;
        if (rollCount >= maxRolls) {
          clearInterval(rollInterval);
          // Show final result
          valueEl.textContent = result.roll;
          panel.classList.add('adv-dice--rolling');

          var bonusText = '';
          if (result.modifier !== 0) bonusText += (result.modifier > 0 ? '+' : '') + result.modifier;
          if (result.companionBonus) bonusText += '+' + result.companionBonus;
          if (bonusText) labelEl.textContent += ' | Roll: ' + result.roll + bonusText + ' = ' + result.total;

          if (result.critical) {
            resultEl.className = 'adv-dice__result adv-dice__result--critical';
            resultEl.textContent = result.critical === 'critical_success' ? 'CRITICAL SUCCESS!' : 'CRITICAL FAILURE!';
          } else if (result.success) {
            resultEl.className = 'adv-dice__result adv-dice__result--success';
            resultEl.textContent = 'Success! (' + result.total + ' vs DC ' + result.difficulty + ')';
          } else {
            resultEl.className = 'adv-dice__result adv-dice__result--failure';
            resultEl.textContent = 'Failed! (' + result.total + ' vs DC ' + result.difficulty + ')';
          }

          setTimeout(function () {
            panel.classList.remove('adv-dice--active', 'adv-dice--rolling');
            resolve();
          }, 1800);
        }
      }, 80);
    });
  }

  // --- Generate Next Turn ---
  function generateNextTurn(choiceText, skillCheckResult) {
    var sceneEl = UI.$('sceneText');
    sceneEl.classList.add('adv-scene-exit');
    UI.$('choicesContainer').innerHTML = '';

    setTimeout(function () {
      sceneEl.classList.remove('adv-scene-exit');
      UI.showLoading(sceneEl, 'The story unfolds...');
      showImagePlaceholder();
      doGenerateNextTurn(choiceText, skillCheckResult);
    }, 300);
  }

  function doGenerateNextTurn(choiceText, skillCheckResult) {
    AI.generateNextScene(selectedGenre, gameState, choiceText, skillCheckResult)
      .then(function (scene) {
        currentScene = scene;
        gameState.turnCount++;
        gameState.lastSceneText = scene.sceneText;

        // Add to turn history
        if (!gameState.turns) gameState.turns = [];
        gameState.turns.push({
          turnNumber: gameState.turnCount,
          sceneExcerpt: scene.sceneText.substring(0, 200),
          choiceMade: choiceText,
          diceRoll: skillCheckResult ? { roll: skillCheckResult.roll, total: skillCheckResult.total, success: skillCheckResult.success } : null
        });

        RPG.applyStateChanges(gameState, scene.stateChanges);

        // Check for death
        if (!RPG.isAlive(gameState)) {
          scene.isEnding = true;
          scene.endingType = 'death';
        }

        renderScene(scene);
        generateAndShowImage(scene.imagePrompt);
      })
      .catch(function (err) {
        UI.toast('Failed to generate scene: ' + err.message, 'error');
        console.error('Scene generation error:', err);
        isProcessing = false;
        // Offer a retry option
        UI.$('choicesContainer').innerHTML =
          '<button class="adv-choice" onclick="location.reload()"><span class="adv-choice__key">!</span>' +
          '<span class="adv-choice__text">Something went wrong — click to retry</span></button>';
      });
  }

  // --- Loading text cycling ---
  var GENRE_LOADING_MESSAGES = {
    fantasy: [
      'Ancient runes shimmer in the darkness...',
      'The mist parts to reveal a new path...',
      'Magic weaves the world into being...',
      'A distant horn echoes through the valley...',
      'The tapestry of fate unfolds...'
    ],
    horror: [
      'Something stirs in the shadows...',
      'The floorboards creak beneath unseen weight...',
      'A cold breath brushes your neck...',
      'The lights flicker and dim...',
      'Silence falls — too silent...'
    ],
    scifi: [
      'Scanning dimensional frequencies...',
      'Quantum field stabilizing...',
      'Neural link synchronizing...',
      'Rendering holographic environment...',
      'Calibrating sensory array...'
    ],
    detective: [
      'Piecing together the evidence...',
      'A clue catches your eye...',
      'The city hums with secrets...',
      'Smoke curls under the lamplight...',
      'The plot thickens...'
    ],
    postapoc: [
      'Static crackles across the wasteland...',
      'Dust settles on the ruins...',
      'A signal breaks through the interference...',
      'The Geiger counter ticks softly...',
      'Shadows shift between the wreckage...'
    ],
    pirate: [
      'The horizon shimmers with promise...',
      'Salt spray fills the air...',
      'The compass needle spins and settles...',
      'Waves crash against the hull...',
      'A new heading is charted...'
    ]
  };

  var GENRE_LOADING_ICONS = {
    fantasy: 'fa-dragon',
    horror: 'fa-ghost',
    scifi: 'fa-rocket',
    detective: 'fa-magnifying-glass',
    postapoc: 'fa-radiation',
    pirate: 'fa-skull-crossbones'
  };

  var loadingTextInterval = null;

  function startLoadingTextCycle() {
    stopLoadingTextCycle();
    var genreId = selectedGenre ? selectedGenre.id : null;
    var messages = (genreId && GENRE_LOADING_MESSAGES[genreId]) || ['Generating scene...'];
    var icon = (genreId && GENRE_LOADING_ICONS[genreId]) || 'fa-image';

    // Set genre icon
    var iconEl = UI.$('loadingIcon');
    if (iconEl) iconEl.className = 'fas ' + icon;

    var textEl = UI.$('loadingText');
    if (!textEl) return;
    var idx = Math.floor(Math.random() * messages.length);
    textEl.textContent = messages[idx];
    textEl.classList.remove('adv-loading-text--fade');

    loadingTextInterval = setInterval(function () {
      textEl.classList.add('adv-loading-text--fade');
      setTimeout(function () {
        idx = (idx + 1) % messages.length;
        textEl.textContent = messages[idx];
        textEl.classList.remove('adv-loading-text--fade');
      }, 400);
    }, 2500);
  }

  function stopLoadingTextCycle() {
    if (loadingTextInterval) {
      clearInterval(loadingTextInterval);
      loadingTextInterval = null;
    }
  }

  // --- Image ---
  function generateAndShowImage(imagePrompt) {
    // Image frequency gating: free tier gets images every 2 turns
    var freq = (Ent && Ent.getImageFrequency) ? Ent.getImageFrequency() : 1;
    if (freq > 1 && gameState.turnCount % freq !== 1) {
      // Skip image on this turn for free tier
      var placeholder = UI.$('sceneImagePlaceholder');
      placeholder.innerHTML = '<i class="fas fa-image"></i><span>Images every scene with Pro</span>';
      placeholder.style.display = '';
      UI.$('sceneImage').classList.remove('adv-scene__image--loaded');
      return;
    }

    showImagePlaceholder();
    var charDesc = (gameState && gameState.character) ? gameState.character.description : '';
    AI.generateSceneImage(imagePrompt, selectedGenre, charDesc)
      .then(function (dataUrl) {
        if (dataUrl) {
          var img = UI.$('sceneImage');
          img.onload = function () {
            stopLoadingTextCycle();
            img.classList.add('adv-scene__image--loaded');
            UI.$('sceneImagePlaceholder').style.display = 'none';
          };
          img.src = dataUrl;
          // Store for potential gallery use
          if (gameState.turnCount === 1) {
            gameState.firstSceneImage = dataUrl;
          }
        } else {
          // Show "unavailable" state instead of infinite spinner
          stopLoadingTextCycle();
          var placeholder = UI.$('sceneImagePlaceholder');
          placeholder.innerHTML = '<i class="fas fa-image"></i><span>Image unavailable</span>';
        }
      });
  }

  function showImagePlaceholder() {
    var img = UI.$('sceneImage');
    img.classList.remove('adv-scene__image--loaded');
    img.src = '';
    var placeholder = UI.$('sceneImagePlaceholder');
    placeholder.innerHTML = '<i class="fas fa-image" id="loadingIcon"></i><span class="adv-loading-text" id="loadingText">Generating scene...</span>';
    placeholder.style.display = '';
    startLoadingTextCycle();
  }

  // --- Inventory Interactions ---
  function bindInventoryEvents(container) {
    // Accordion: tap item row to expand/collapse
    container.querySelectorAll('.adv-inventory__item').forEach(function (row) {
      row.addEventListener('click', function () {
        var itemId = row.dataset.itemId;
        var detail = container.querySelector('[data-detail-for="' + itemId + '"]');
        var wasOpen = row.classList.contains('adv-inventory__item--open');

        // Close all
        container.querySelectorAll('.adv-inventory__item--open').forEach(function (r) {
          r.classList.remove('adv-inventory__item--open');
        });
        container.querySelectorAll('.adv-inventory__detail--open').forEach(function (d) {
          d.classList.remove('adv-inventory__detail--open');
        });

        // Toggle current
        if (!wasOpen && detail) {
          row.classList.add('adv-inventory__item--open');
          detail.classList.add('adv-inventory__detail--open');
        }
      });
    });

    // Action buttons
    container.querySelectorAll('.adv-inventory__btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isProcessing) return;
        var action = btn.dataset.action;
        var itemId = btn.dataset.itemId;

        if (action === 'equip') {
          RPG.equipItem(gameState, itemId);
          var item = gameState.inventory.find(function (i) { return i.id === itemId; });
          UI.toast('Equipped ' + (item ? item.name : 'item'), 'success');
          updateSidebar();
          saveAdventure();
        } else if (action === 'unequip') {
          var slot = btn.dataset.slot;
          var equipped = RPG.getEquippedItem(gameState, slot);
          RPG.unequipItem(gameState, slot);
          UI.toast('Unequipped ' + (equipped ? equipped.name : 'item'), 'info');
          updateSidebar();
          saveAdventure();
        } else if (action === 'use') {
          var effect = RPG.useConsumable(gameState, itemId);
          if (effect) {
            UI.toast('Used item: +' + effect.value + ' HP', 'success');
            UI.$('hpFill').parentElement.classList.add('adv-heal-glow');
            setTimeout(function () {
              UI.$('hpFill').parentElement.classList.remove('adv-heal-glow');
            }, 600);
            updateSidebar();
            saveAdventure();
          }
        } else if (action === 'drop') {
          var dropItem = gameState.inventory.find(function (i) { return i.id === itemId; });
          if (RPG.dropItem(gameState, itemId)) {
            UI.toast('Dropped ' + (dropItem ? dropItem.name : 'item'), 'info');
            updateSidebar();
            saveAdventure();
          }
        }
      });
    });
  }

  // --- Update Sidebar ---
  function updateSidebar() {
    if (!gameState) return;
    renderSidebarPortrait();
    var stats = gameState.stats;

    // HP
    var hpPct = (stats.hp / stats.maxHp) * 100;
    var fill = UI.$('hpFill');
    fill.style.width = hpPct + '%';
    fill.className = 'adv-hp__fill' +
      (hpPct <= 25 ? ' adv-hp__fill--danger' : (hpPct <= 50 ? ' adv-hp__fill--warning' : ''));
    UI.$('hpValue').textContent = stats.hp;
    UI.$('hpMax').textContent = '/ ' + stats.maxHp;

    // Stats
    var statsHtml = ['strength', 'dexterity', 'intelligence', 'charisma', 'gold', 'reputation'].map(function (key) {
      var icon = RPG.STAT_ICONS[key] || 'fa-circle';
      var label = RPG.STAT_LABELS[key] || key;
      var val = stats[key];
      var valClass = '';
      if (key === 'reputation') {
        valClass = val > 10 ? 'adv-stat__value--good' : (val < -10 ? 'adv-stat__value--danger' : '');
      }
      return '<div class="adv-stat">' +
        '<span class="adv-stat__label"><i class="fas ' + icon + '"></i> ' + label + '</span>' +
        '<span class="adv-stat__value ' + valClass + '">' + val + '</span>' +
      '</div>';
    }).join('');
    UI.$('statsContainer').innerHTML = statsHtml;

    // Inventory
    if (!gameState.equipped) gameState.equipped = { weapon: null, armor: null };
    UI.$('inventoryCount').textContent = '(' + gameState.inventory.length + '/' + RPG.MAX_INVENTORY + ')';
    if (gameState.inventory.length) {
      var invContainer = UI.$('inventoryContainer');
      invContainer.innerHTML = gameState.inventory.map(function (item) {
        var icon = RPG.ITEM_ICONS[item.type] || 'fa-box';
        var qty = item.quantity > 1 ? ' x' + item.quantity : '';
        var isEquipped = gameState.equipped.weapon === item.id || gameState.equipped.armor === item.id;
        var isEquippable = item.type === 'weapon' || item.type === 'armor';
        var isConsumable = item.type === 'consumable';
        var canDrop = item.type !== 'quest_item';
        var typeClass = ' adv-inventory__item--' + item.type;
        var equippedClass = isEquipped ? ' adv-inventory__item--equipped' : '';

        // Item row
        var html = '<div class="adv-inventory__item' + typeClass + equippedClass +
          '" data-item-id="' + item.id + '">' +
          '<span class="adv-inventory__icon"><i class="fas ' + icon + '"></i>' +
          (isEquipped ? '<span class="adv-inventory__badge">E</span>' : '') +
          '</span>' +
          '<span class="adv-inventory__name">' + UI.escapeHtml(item.name) + qty + '</span>' +
          '<i class="fas fa-chevron-right adv-inventory__expand-icon"></i>' +
        '</div>';

        // Detail panel
        var actions = '';
        if (isEquippable) {
          var slot = item.type === 'weapon' ? 'weapon' : 'armor';
          var bonusStat = RPG.EQUIP_BONUS_MAP[slot];
          var bonusLabel = RPG.STAT_LABELS[bonusStat] || bonusStat;
          if (isEquipped) {
            actions += '<button class="adv-inventory__btn adv-inventory__btn--unequip" data-action="unequip" data-slot="' + slot + '"><i class="fas fa-times"></i> Unequip</button>';
          } else {
            actions += '<button class="adv-inventory__btn adv-inventory__btn--equip" data-action="equip" data-item-id="' + item.id + '"><i class="fas fa-hand-fist"></i> Equip (+1 ' + bonusLabel + ')</button>';
          }
        }
        if (isConsumable) {
          actions += '<button class="adv-inventory__btn adv-inventory__btn--use" data-action="use" data-item-id="' + item.id + '"><i class="fas fa-flask-vial"></i> Use</button>';
        }
        if (canDrop) {
          actions += '<button class="adv-inventory__btn adv-inventory__btn--drop" data-action="drop" data-item-id="' + item.id + '"><i class="fas fa-trash-can"></i> Drop</button>';
        }

        html += '<div class="adv-inventory__detail" data-detail-for="' + item.id + '">' +
          '<div class="adv-inventory__desc">' + UI.escapeHtml(item.description || 'No description.') + '</div>' +
          '<div class="adv-inventory__actions">' + actions + '</div>' +
        '</div>';

        return html;
      }).join('');

      // Bind item interactions
      bindInventoryEvents(invContainer);
    } else {
      UI.$('inventoryContainer').innerHTML = '<div class="adv-inventory__empty">Empty</div>';
    }

    // Companions
    UI.$('companionCount').textContent = '(' + gameState.companions.length + '/' + RPG.MAX_COMPANIONS + ')';
    if (gameState.companions.length) {
      UI.$('companionsContainer').innerHTML = gameState.companions.map(function (comp) {
        return '<div class="adv-companion">' +
          '<div class="adv-companion__icon"><i class="fas fa-user"></i></div>' +
          '<div class="adv-companion__info">' +
            '<div class="adv-companion__name">' + UI.escapeHtml(comp.name) + '</div>' +
            '<div class="adv-companion__bonus">+2 ' + (RPG.STAT_LABELS[comp.bonus] || comp.bonus) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    } else {
      UI.$('companionsContainer').innerHTML = '<div class="adv-inventory__empty">No companions</div>';
    }

    // Journal (turn history + event log fallback)
    var journalHtml = '';
    if (gameState.turns && gameState.turns.length) {
      journalHtml = gameState.turns.slice().reverse().map(function (turn) {
        var diceIcon = '';
        if (turn.diceRoll) {
          diceIcon = turn.diceRoll.success
            ? ' <i class="fas fa-dice-d20 adv-journal__dice--pass"></i>'
            : ' <i class="fas fa-dice-d20 adv-journal__dice--fail"></i>';
        }
        return '<div class="adv-journal__entry">' +
          '<div class="adv-journal__turn">Turn ' + turn.turnNumber + diceIcon + '</div>' +
          '<div class="adv-journal__choice"><i class="fas fa-arrow-right"></i> ' + UI.escapeHtml(turn.choiceMade) + '</div>' +
        '</div>';
      }).join('');
    } else if (gameState.eventLog.length) {
      journalHtml = gameState.eventLog.map(function (evt) {
        return '<div class="adv-event">' + UI.escapeHtml(evt.replace(/_/g, ' ')) + '</div>';
      }).reverse().join('');
    }
    UI.$('eventsContainer').innerHTML = journalHtml ||
      '<div class="adv-event" style="color:rgba(216,224,229,0.3);font-style:italic;">Adventure begins...</div>';
  }

  // --- Ending ---
  function showEnding(scene) {
    UI.showScreen('screenEnding');
    UI.$('pauseBtn').style.display = 'none';

    var type = scene.endingType || 'escape';
    var icons = { victory: 'fa-trophy', death: 'fa-skull', escape: 'fa-person-running' };
    var titles = { victory: 'Victory!', death: 'You Died', escape: 'Escaped!' };

    UI.$('endingIcon').innerHTML = '<i class="fas ' + (icons[type] || icons.escape) + '"></i>';
    UI.$('endingIcon').className = 'adv-ending__icon adv-ending__icon--' + type;
    UI.$('endingTitle').textContent = titles[type] || 'The End';
    UI.$('endingText').textContent = scene.sceneText;

    UI.$('endingStats').innerHTML =
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">' + gameState.turnCount + '</div><div class="adv-ending__stat-label">Turns</div></div>' +
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">' + gameState.stats.gold + '</div><div class="adv-ending__stat-label">Gold</div></div>' +
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">' + gameState.inventory.length + '</div><div class="adv-ending__stat-label">Items</div></div>' +
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">' + gameState.companions.length + '</div><div class="adv-ending__stat-label">Allies</div></div>';

    gameState.status = 'completed';
    gameState.ending = { type: type, text: scene.sceneText };
    saveAdventure();

    // Wire share/publish button
    var shareBtn = UI.$('shareBtn');
    if (shareBtn) {
      shareBtn.onclick = function () {
        var ShareMod = window.AdventureShare;
        if (!ShareMod) {
          UI.toast('Share module not loaded', 'error');
          return;
        }
        shareBtn.disabled = true;
        shareBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';

        ShareMod.publishAdventure(gameState.adventureId)
          .then(function () {
            return ShareMod.copyShareLink(gameState.adventureId);
          })
          .then(function () {
            UI.toast('Published! Share link copied to clipboard.', 'success');
            shareBtn.innerHTML = '<i class="fas fa-check"></i> Shared!';
          })
          .catch(function (err) {
            UI.toast('Failed to publish: ' + err.message, 'error');
            shareBtn.disabled = false;
            shareBtn.innerHTML = '<i class="fas fa-share-nodes"></i> Share';
          });
      };
    }
  }

  // --- Pause Menu ---
  function showPauseMenu() {
    if (!gameState) return;
    saveAdventure();
    UI.$('pauseInfo').textContent = 'Turn ' + gameState.turnCount + ' of ' + gameState.maxTurns +
      ' | ' + gameState.playerName + ' | HP: ' + gameState.stats.hp + '/' + gameState.stats.maxHp;
    UI.$('pauseOverlay').style.display = '';
  }

  function hidePauseMenu() {
    UI.$('pauseOverlay').style.display = 'none';
  }

  // --- Save Adventure ---
  function saveAdventure() {
    if (!gameState) return;
    if (!gameState.adventureId) {
      gameState.adventureId = 'sf_' + Date.now();
    }
    gameState.updatedAt = new Date().toISOString();
    if (!gameState.createdAt) gameState.createdAt = gameState.updatedAt;
    Storage.saveAdventure(gameState);
  }

  // --- Boot ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

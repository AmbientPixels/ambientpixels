/**
 * adventure-engine.js — StoryForge core game loop, state machine, turn processing
 */
(function () {
  'use strict';

  var UI = window.AdventureUI;
  var RPG = window.AdventureRPG;
  var AI = window.AdventureAI;
  var Storage = window.AdventureStorage;

  var genres = [];
  var selectedGenre = null;
  var gameState = null;
  var currentScene = null;
  var isProcessing = false;

  // --- Initialize ---
  function init() {
    loadGenres().then(function () {
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
        UI.$('startAdventureBtn').disabled = false;
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
    return fetch('/storyforge/data/genres.json')
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
        '<div class="adv-genre-card__icon" style="color:' + g.color + '">' +
          '<i class="fas ' + g.icon + '"></i>' +
        '</div>' +
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
      UI.$('startAdventureBtn').disabled = false;
      UI.$('advApp').setAttribute('data-genre', selectedGenre.id);
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
      UI.showScreen('screenGenreSelect');
    });

    UI.$('pauseBtn').addEventListener('click', function () {
      saveAdventure();
      UI.toast('Adventure saved', 'success');
    });

    // Keyboard shortcuts for choices (1-4)
    document.addEventListener('keydown', function (e) {
      if (isProcessing) return;
      var num = parseInt(e.key);
      if (num >= 1 && num <= 4) {
        var choices = document.querySelectorAll('.adv-choice:not(:disabled)');
        if (choices[num - 1]) choices[num - 1].click();
      }
    });
  }

  // --- Start Adventure ---
  function startAdventure() {
    if (!selectedGenre || isProcessing) return;

    if (!AI.checkDailyLimit()) {
      UI.toast('Daily limit reached (' + AI.getRemainingUsage() + ' remaining)', 'warning');
      return;
    }

    var nameInput = UI.$('playerNameInput');
    var playerName = (nameInput.value || '').trim() || RPG.generateName();

    gameState = RPG.createState(selectedGenre, playerName);
    isProcessing = true;

    UI.showScreen('screenPlay');
    UI.$('pauseBtn').style.display = '';
    UI.showLoading(UI.$('sceneText'), 'Forging your story...');
    UI.$('choicesContainer').innerHTML = '';
    updateSidebar();

    AI.incrementUsage();

    AI.generateOpeningScene(selectedGenre, playerName)
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

  // --- Render Scene ---
  function renderScene(scene) {
    // Turn bar
    UI.$('turnLabel').textContent = 'Turn ' + gameState.turnCount;
    UI.$('progressFill').style.width = ((gameState.turnCount / gameState.maxTurns) * 100) + '%';

    // Typewriter text
    UI.typewriter(UI.$('sceneText'), scene.sceneText).then(function () {
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
    var result = RPG.rollSkillCheck(gameState.stats, gameState.companions, sc.stat, sc.difficulty);

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
    UI.showLoading(UI.$('sceneText'), 'The story unfolds...');
    UI.$('choicesContainer').innerHTML = '';
    showImagePlaceholder();

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

  // --- Image ---
  function generateAndShowImage(imagePrompt) {
    showImagePlaceholder();
    AI.generateSceneImage(imagePrompt, selectedGenre)
      .then(function (dataUrl) {
        if (dataUrl) {
          var img = UI.$('sceneImage');
          img.onload = function () {
            img.classList.add('adv-scene__image--loaded');
            UI.$('sceneImagePlaceholder').style.display = 'none';
          };
          img.src = dataUrl;
          // Store for potential gallery use
          if (gameState.turnCount === 1) {
            gameState.firstSceneImage = dataUrl;
          }
        }
      });
  }

  function showImagePlaceholder() {
    var img = UI.$('sceneImage');
    img.classList.remove('adv-scene__image--loaded');
    img.src = '';
    UI.$('sceneImagePlaceholder').style.display = '';
  }

  // --- Update Sidebar ---
  function updateSidebar() {
    if (!gameState) return;
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
    UI.$('inventoryCount').textContent = '(' + gameState.inventory.length + '/' + RPG.MAX_INVENTORY + ')';
    if (gameState.inventory.length) {
      UI.$('inventoryContainer').innerHTML = gameState.inventory.map(function (item) {
        var icon = RPG.ITEM_ICONS[item.type] || 'fa-box';
        var qty = item.quantity > 1 ? ' x' + item.quantity : '';
        return '<div class="adv-inventory__item" title="' + UI.escapeHtml(item.description) + '">' +
          '<i class="fas ' + icon + '"></i>' +
          '<span>' + UI.escapeHtml(item.name) + qty + '</span>' +
        '</div>';
      }).join('');
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

    // Event log
    if (gameState.eventLog.length) {
      UI.$('eventsContainer').innerHTML = gameState.eventLog.map(function (evt) {
        return '<div class="adv-event">' + UI.escapeHtml(evt.replace(/_/g, ' ')) + '</div>';
      }).reverse().join('');
    }
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

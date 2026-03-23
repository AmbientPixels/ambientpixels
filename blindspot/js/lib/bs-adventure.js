/**
 * Blindspot CYOA Pre-Boss Adventure Module
 * JSON-driven choose-your-own-adventure sequences before boss fights.
 * Grants temporary stat buffs/debuffs + collectible items for the upcoming battle.
 * Supports: stat-gated choices, class-specific choices, adaptive DC, resonance, ascension text.
 * Fully decoupled — borrows patterns from StoryForge, shares no code.
 */
window.BsAdventure = (function () {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================
  var MANIFEST_URL = '/blindspot/data/adventures/manifest.json';
  var ADVENTURE_BASE = '/blindspot/data/adventures/';
  var TYPEWRITER_SPEED = 18;
  var DICE_SPIN_COUNT = 12;
  var DICE_SPIN_INTERVAL = 80;
  var DICE_HOLD_TIME = 1800;
  var BUFF_TOAST_DURATION = 1200;
  var SCENE_TRANSITION_MS = 500;

  var STAT_LABELS = {
    str: 'STR', agi: 'AGI', int: 'INT', end: 'END', lck: 'LCK'
  };

  // ============================================================
  // ADVENTURE ITEMS
  // ============================================================
  var ADVENTURE_ITEMS = {
    smoke_bomb:    { id: 'smoke_bomb',    name: 'Smoke Bomb',    icon: 'fa-smog',              effect: 'skip_attack',     description: "Skip opponent's next attack" },
    war_cry:       { id: 'war_cry',       name: 'War Cry',       icon: 'fa-fire',              effect: 'damage_boost',    value: 30, description: '+30% damage on next strike' },
    focus_elixir:  { id: 'focus_elixir',  name: 'Focus Elixir',  icon: 'fa-flask-vial',        effect: 'full_charges',    description: 'Refill all ability charges' },
    iron_skin:     { id: 'iron_skin',     name: 'Iron Skin',     icon: 'fa-shield-virus',      effect: 'damage_reduce',   value: 50, description: 'Block 50% damage for 1 round' },
    lucky_coin:    { id: 'lucky_coin',    name: 'Lucky Coin',    icon: 'fa-coins',             effect: 'guaranteed_crit', description: 'Guaranteed crit on next attack' },
    healing_salve: { id: 'healing_salve', name: 'Healing Salve', icon: 'fa-heart-circle-plus', effect: 'heal_percent',    value: 25, description: 'Restore 25% max HP' }
  };
  var MAX_ADVENTURE_ITEMS = 3;

  // ============================================================
  // STATE
  // ============================================================
  var _manifest = null;
  var _adventureCache = {};
  var _accumulatedBuffs = {};
  var _accumulatedItems = [];
  var _isProcessing = false;
  var _resolvePromise = null;
  var _rejectPromise = null;
  var _containerEl = null;
  var _playerStats = null;
  var _playerClass = '';
  var _bossWeakness = null;
  var _resonanceBonus = 0;
  var _ascensionLevel = 0;
  var _currentAdventure = null;
  var _sceneCount = 0;
  var _sceneIndex = 0;
  var _keydownHandler = null;
  var _previousMusicKey = null;
  var _prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ============================================================
  // HELPERS
  // ============================================================

  function $(id) { return document.getElementById(id); }

  function scrollToChoices() {
    // Smooth scroll the adventure overlay so choices are visible
    if (_containerEl) {
      var choicesEl = $('bs-adventure-choices');
      var footerEl = $('bs-adventure-footer');
      var target = (footerEl && footerEl.style.display !== 'none') ? footerEl : choicesEl;
      if (target) {
        setTimeout(function () { target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
      }
    }
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function safeLSGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeLSSet(key, val) {
    try { localStorage.setItem(key, val); }
    catch (e) {
      try { localStorage.removeItem('bs-image-cache'); localStorage.removeItem('bs-cosmetic-cache'); localStorage.setItem(key, val); }
      catch (e2) { /* give up */ }
    }
  }
  function safeLSRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ============================================================
  // MANIFEST & LOADING
  // ============================================================

  function init() {
    return fetch(MANIFEST_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('Manifest fetch failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        _manifest = data;
        console.log('[BsAdventure] Manifest loaded:', data.adventures.length, 'adventures');
      })
      .catch(function (err) {
        console.warn('[BsAdventure] Manifest load failed:', err);
        _manifest = { adventures: [] };
      });
  }

  function hasAdventure(bossId) {
    return _manifest && _manifest.adventures && _manifest.adventures.indexOf(bossId) !== -1;
  }

  function loadAdventure(bossId) {
    if (_adventureCache[bossId]) return Promise.resolve(_adventureCache[bossId]);
    return fetch(ADVENTURE_BASE + bossId + '.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Adventure fetch failed: ' + res.status);
        return res.json();
      })
      .then(function (data) { _adventureCache[bossId] = data; return data; });
  }

  // ============================================================
  // TYPEWRITER
  // ============================================================

  var _activeTypewriter = null;

  function typewriter(el, text, speed) {
    speed = speed || TYPEWRITER_SPEED;
    if (_activeTypewriter) { _activeTypewriter.skip(); _activeTypewriter = null; }

    if (_prefersReducedMotion) {
      var paragraphs = text.split('\n\n');
      el.innerHTML = paragraphs.map(function (p) { return '<p>' + escHtml(p.trim()) + '</p>'; }).join('');
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      var paragraphs = text.split('\n\n');
      var html = paragraphs.map(function (p) { return '<p>' + escHtml(p.trim()) + '</p>'; }).join('');
      el.innerHTML = '';
      var i = 0, inTag = false, finished = false;

      function finish() {
        if (finished) return;
        finished = true;
        _activeTypewriter = null;
        el.innerHTML = html;
        el.style.cursor = '';
        el.removeEventListener('click', finish);
        resolve();
      }

      _activeTypewriter = { skip: finish };
      el.style.cursor = 'pointer';
      el.addEventListener('click', finish);

      function tick() {
        if (finished) return;
        if (i >= html.length) { finish(); return; }
        if (html[i] === '<') inTag = true;
        if (inTag) { while (i < html.length && inTag) { if (html[i] === '>') inTag = false; i++; } }
        else { i++; }
        el.innerHTML = html.substring(0, i) + '<span class="bs-adventure__cursor"></span>';
        setTimeout(tick, speed);
      }
      tick();
    });
  }

  // ============================================================
  // SKILL CHECK (d20 adapted for 0-100 stats)
  // ============================================================

  function rollSkillCheck(playerStats, stat, dc, bonus) {
    bonus = bonus || 0;
    var roll = Math.floor(Math.random() * 20) + 1;
    var statVal = playerStats[stat] || 50;
    var modifier = Math.floor((statVal - 50) / 10) + bonus;
    var total = roll + modifier;
    var success = total >= dc;
    var critical = roll === 20 ? 'critical_success' : (roll === 1 ? 'critical_failure' : null);
    if (roll === 20) success = true;
    if (roll === 1) success = false;

    return { roll: roll, modifier: modifier, total: total, dc: dc, stat: stat, success: success, critical: critical };
  }

  // ============================================================
  // DICE ROLL ANIMATION
  // ============================================================

  function showDiceRoll(result) {
    return new Promise(function (resolve) {
      var panel = $('bs-adventure-dice');
      var valueEl = $('bs-adventure-dice-value');
      var labelEl = $('bs-adventure-dice-label');
      var resultEl = $('bs-adventure-dice-result');
      if (!panel || !valueEl || !labelEl || !resultEl) { resolve(); return; }

      panel.classList.add('bs-adventure__dice--active');
      labelEl.textContent = STAT_LABELS[result.stat] + ' Check (DC ' + result.dc + ')';
      resultEl.textContent = '';
      resultEl.className = 'bs-adventure__dice-result';
      if (window.ArenaAudio) window.ArenaAudio.play('click');

      function showFinal() {
        valueEl.textContent = result.roll;
        var bonusText = '';
        if (result.modifier !== 0) bonusText = (result.modifier > 0 ? '+' : '') + result.modifier;
        if (bonusText) labelEl.textContent = STAT_LABELS[result.stat] + ' Check (DC ' + result.dc + ') | Roll: ' + result.roll + bonusText + ' = ' + result.total;

        if (result.critical) {
          resultEl.className = 'bs-adventure__dice-result bs-adventure__dice-result--critical';
          resultEl.textContent = result.critical === 'critical_success' ? 'CRITICAL SUCCESS!' : 'CRITICAL FAILURE!';
        } else if (result.success) {
          resultEl.className = 'bs-adventure__dice-result bs-adventure__dice-result--success';
          resultEl.textContent = 'Success! (' + result.total + ' vs DC ' + result.dc + ')';
        } else {
          resultEl.className = 'bs-adventure__dice-result bs-adventure__dice-result--failure';
          resultEl.textContent = 'Failed! (' + result.total + ' vs DC ' + result.dc + ')';
        }
        if (window.ArenaAudio) window.ArenaAudio.play(result.success ? 'hit' : 'guard');
        valueEl.classList.add('bs-adventure__dice-value--burst');

        var holdTime = _prefersReducedMotion ? 600 : DICE_HOLD_TIME;
        setTimeout(function () {
          panel.classList.remove('bs-adventure__dice--active');
          valueEl.classList.remove('bs-adventure__dice-value--burst');
          resolve();
        }, holdTime);
      }

      if (_prefersReducedMotion) { showFinal(); }
      else {
        var rollCount = 0;
        var spinInterval = setInterval(function () {
          valueEl.textContent = Math.floor(Math.random() * 20) + 1;
          rollCount++;
          if (rollCount >= DICE_SPIN_COUNT) { clearInterval(spinInterval); showFinal(); }
        }, DICE_SPIN_INTERVAL);
      }
    });
  }

  // ============================================================
  // BUFF MANAGEMENT
  // ============================================================

  function accumulateBuffs(buffs, multiplier) {
    multiplier = multiplier || 1;
    if (!buffs) return;
    var keys = Object.keys(buffs);
    for (var i = 0; i < keys.length; i++) {
      var stat = keys[i];
      var val = Math.round(buffs[stat] * multiplier);
      _accumulatedBuffs[stat] = (_accumulatedBuffs[stat] || 0) + val;
    }
  }

  function showBuffToast(buffs, container) {
    if (!buffs || Object.keys(buffs).length === 0) return;
    var toast = document.createElement('div');
    toast.className = 'bs-adventure__buff-toast';
    var parts = [];
    var keys = Object.keys(buffs);
    for (var i = 0; i < keys.length; i++) {
      var stat = keys[i], val = buffs[stat];
      var cls = val > 0 ? 'bs-adventure__buff-chip--positive' : 'bs-adventure__buff-chip--negative';
      parts.push('<span class="bs-adventure__buff-chip ' + cls + '">' + (val > 0 ? '+' : '') + val + ' ' + STAT_LABELS[stat] + '</span>');
    }
    toast.innerHTML = parts.join(' ');
    container.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, BUFF_TOAST_DURATION + 300);
  }

  function renderBuffBar() {
    var buffsEl = $('bs-adventure-buffs');
    if (!buffsEl) return;
    var html = '';

    // Buff chips
    var keys = Object.keys(_accumulatedBuffs);
    for (var i = 0; i < keys.length; i++) {
      var stat = keys[i], val = _accumulatedBuffs[stat];
      if (val === 0) continue;
      var cls = val > 0 ? 'bs-adventure__buff-chip--positive' : 'bs-adventure__buff-chip--negative';
      html += '<span class="bs-adventure__buff-chip ' + cls + '">' + (val > 0 ? '+' : '') + val + ' ' + STAT_LABELS[stat] + '</span> ';
    }

    // Item chips
    for (var j = 0; j < _accumulatedItems.length; j++) {
      var item = _accumulatedItems[j];
      html += '<span class="bs-adventure__item-chip"><i class="fas ' + (item.icon || 'fa-box') + '"></i> ' + escHtml(item.name) + '</span> ';
    }

    buffsEl.innerHTML = html;
  }

  // ============================================================
  // ITEM MANAGEMENT
  // ============================================================

  function accumulateItem(itemId) {
    if (!itemId || !ADVENTURE_ITEMS[itemId]) return;
    if (_accumulatedItems.length >= MAX_ADVENTURE_ITEMS) return;
    _accumulatedItems.push(Object.assign({}, ADVENTURE_ITEMS[itemId]));
  }

  function showItemToast(itemDef, container) {
    if (!itemDef) return;
    var toast = document.createElement('div');
    toast.className = 'bs-adventure__item-toast';
    toast.innerHTML = '<i class="fas ' + (itemDef.icon || 'fa-box') + '"></i> Found: ' + escHtml(itemDef.name);
    container.appendChild(toast);
    if (window.ArenaAudio) window.ArenaAudio.play('loot');
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, BUFF_TOAST_DURATION + 500);
  }

  // ============================================================
  // SCENE IMAGE GENERATION
  // ============================================================

  function generateSceneImage(imagePrompt) {
    if (!imagePrompt || !window.CardForgeAI || !window.CardForgeAI.callGemini) return;
    var imgEl = $('bs-adventure-image');
    var loadingEl = $('bs-adventure-image-loading');
    if (!imgEl) return;

    imgEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'flex';

    var prompt = 'Dark fantasy scene: ' + imagePrompt + '. Atmosphere: moody, cinematic lighting, no text, no UI elements, no words. Style: dark fantasy digital painting, dramatic shadows.';
    window.CardForgeAI.callGemini(prompt, {
      model: window.CardForgeAI.IMAGE_MODEL,
      generationConfig: { responseModalities: ['Image'] },
      skipUsageIncrement: true
    })
    .then(function (data) {
      var img = window.CardForgeAI.extractImage(data);
      if (img) {
        imgEl.src = 'data:' + img.mimeType + ';base64,' + img.base64;
        imgEl.style.display = '';
        imgEl.classList.add('bs-adventure__image--reveal');
        setTimeout(function () { imgEl.classList.remove('bs-adventure__image--reveal'); }, 700);
      }
      if (loadingEl) loadingEl.style.display = 'none';
    })
    .catch(function (err) {
      console.warn('[BsAdventure] Image generation failed:', err);
      if (loadingEl) loadingEl.style.display = 'none';
      imgEl.style.display = 'none';
    });
  }

  // ============================================================
  // MUSIC
  // ============================================================

  function playSceneMusic(musicId) {
    if (!musicId || !window.ArenaAudio || !window.ArenaAudio.playMusic) return;
    window.ArenaAudio.playMusic(musicId);
  }

  function savePreviousMusic() {
    if (window.ArenaAudio && window.ArenaAudio._currentMusicKey !== undefined) {
      _previousMusicKey = window.ArenaAudio._currentMusicKey;
    } else { _previousMusicKey = 'menu'; }
  }

  function restorePreviousMusic() {
    if (_previousMusicKey && window.ArenaAudio && window.ArenaAudio.playMusic) window.ArenaAudio.playMusic(_previousMusicKey);
    _previousMusicKey = null;
  }

  // ============================================================
  // KEYBOARD NAVIGATION
  // ============================================================

  function setupKeyboardNav(choiceCount) {
    removeKeyboardNav();
    _keydownHandler = function (e) {
      if (_isProcessing) return;
      var num = parseInt(e.key, 10);
      if (num >= 1 && num <= choiceCount) {
        var btn = document.querySelector('.bs-adventure__choice[data-index="' + (num - 1) + '"]');
        if (btn && !btn.disabled) btn.click();
      }
    };
    document.addEventListener('keydown', _keydownHandler);
  }

  function removeKeyboardNav() {
    if (_keydownHandler) { document.removeEventListener('keydown', _keydownHandler); _keydownHandler = null; }
  }

  // ============================================================
  // ADAPTIVE DC
  // ============================================================

  function computeAdaptiveDC(baseDC) {
    // Adjust DC based on total card power + ascension level
    var totalPower = 0;
    if (_playerStats) {
      var sKeys = Object.keys(_playerStats);
      for (var k = 0; k < sKeys.length; k++) totalPower += (_playerStats[sKeys[k]] || 0);
    }
    var dcOffset = Math.floor((totalPower - 250) / 75);
    dcOffset = Math.max(-2, Math.min(3, dcOffset));
    var ascOffset = _ascensionLevel || 0;
    return Math.max(1, baseDC + dcOffset + ascOffset);
  }

  // ============================================================
  // CHOICE RENDERING & HANDLING
  // ============================================================

  function filterChoices(choices, playerStats) {
    var visible = choices.filter(function (choice) {
      // Stat gate
      if (choice.requires) {
        var rKeys = Object.keys(choice.requires);
        for (var i = 0; i < rKeys.length; i++) {
          if ((playerStats[rKeys[i]] || 0) < choice.requires[rKeys[i]]) return false;
        }
      }
      // Class gate
      if (choice.classRequired) {
        var match = choice.classRequired.some(function (c) { return c.toLowerCase() === _playerClass; });
        if (!match) return false;
      }
      return true;
    });

    // Safety: ensure at least 2 choices visible
    if (visible.length < 2) {
      visible = choices.filter(function (c) { return !c.requires && !c.classRequired; });
      if (visible.length < 2) visible = choices.slice(0, 2);
    }
    return visible;
  }

  function renderChoices(choices, container, playerStats) {
    var choicesEl = $('bs-adventure-choices');
    if (!choicesEl) return;

    var visible = filterChoices(choices, playerStats);

    choicesEl.innerHTML = visible.map(function (choice, i) {
      var dcBadge = '';
      if (choice.skillCheck) {
        var adjustedDC = computeAdaptiveDC(choice.skillCheck.dc);
        var label = STAT_LABELS[choice.skillCheck.stat] + ' DC' + adjustedDC;
        dcBadge = '<span class="bs-adventure__choice-dc">' + label + '</span>';
      }
      var classModifier = choice.classRequired ? ' bs-adventure__choice--class' : '';
      var classBadge = choice.classRequired ? '<span class="bs-adventure__choice-class-badge"><i class="fas fa-star"></i></span>' : '';
      var itemBadge = '';
      var itemSrc = choice.item || (choice.success && choice.success.item) || null;
      if (itemSrc && ADVENTURE_ITEMS[itemSrc]) {
        itemBadge = '<span class="bs-adventure__choice-item-hint"><i class="fas ' + ADVENTURE_ITEMS[itemSrc].icon + '"></i></span>';
      }

      return '<button class="bs-adventure__choice' + classModifier + '" data-choice-id="' + escHtml(choice.id) + '" data-index="' + i + '">' +
        classBadge +
        '<span class="bs-adventure__choice-key">' + (i + 1) + '</span>' +
        '<span class="bs-adventure__choice-text">' + escHtml(choice.text) + '</span>' +
        itemBadge +
        dcBadge +
      '</button>';
    }).join('');

    // Click handlers
    choicesEl.querySelectorAll('.bs-adventure__choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var choiceId = btn.dataset.choiceId;
        var choice = visible.find(function (c) { return c.id === choiceId; });
        if (choice) handleChoice(choice, btn, container, playerStats);
      });
    });

    setupKeyboardNav(visible.length);
  }

  function handleChoice(choice, btn, container, playerStats) {
    if (_isProcessing) return;
    _isProcessing = true;
    removeKeyboardNav();

    var allBtns = document.querySelectorAll('.bs-adventure__choice');
    allBtns.forEach(function (b) {
      b.disabled = true;
      if (b === btn) b.classList.add('bs-adventure__choice--selected');
    });

    if (window.ArenaAudio) window.ArenaAudio.play('click');

    if (choice.skillCheck) {
      var adjustedDC = computeAdaptiveDC(choice.skillCheck.dc);
      var result = rollSkillCheck(playerStats, choice.skillCheck.stat, adjustedDC, _resonanceBonus);
      showDiceRoll(result).then(function () {
        var outcome = result.success ? choice.success : choice.failure;
        var multiplier = result.critical ? 2 : 1;
        if (outcome && outcome.buffs) {
          accumulateBuffs(outcome.buffs, multiplier);
          showBuffToast(outcome.buffs, container);
        }
        // Item reward from outcome
        if (outcome && outcome.item) {
          accumulateItem(outcome.item);
          showItemToast(ADVENTURE_ITEMS[outcome.item], container);
        }
        renderBuffBar();
        var nextScene = outcome ? outcome.next : null;
        if (nextScene) {
          setTimeout(function () { _isProcessing = false; renderScene(nextScene, _currentAdventure, container, playerStats); }, BUFF_TOAST_DURATION);
        } else { _isProcessing = false; finishAdventure(); }
      });
    } else {
      if (choice.buffs) {
        accumulateBuffs(choice.buffs);
        showBuffToast(choice.buffs, container);
      }
      // Item reward from direct choice
      if (choice.item) {
        accumulateItem(choice.item);
        showItemToast(ADVENTURE_ITEMS[choice.item], container);
      }
      renderBuffBar();
      var nextScene = choice.next;
      if (nextScene) {
        setTimeout(function () { _isProcessing = false; renderScene(nextScene, _currentAdventure, container, playerStats); }, BUFF_TOAST_DURATION);
      } else { _isProcessing = false; finishAdventure(); }
    }
  }

  // ============================================================
  // SCENE RENDERING
  // ============================================================

  function countScenes(adventure) {
    var count = 0, visited = {}, sceneId = adventure.startScene;
    while (sceneId && adventure.scenes[sceneId] && !visited[sceneId]) {
      visited[sceneId] = true;
      count++;
      var scene = adventure.scenes[sceneId];
      if (scene.isFinal || !scene.choices || scene.choices.length === 0) break;
      var first = scene.choices[0];
      sceneId = first.next || (first.success && first.success.next) || null;
    }
    return count;
  }

  function getSceneText(scene) {
    // Ascension text variant
    if (_ascensionLevel >= 1 && scene.ascensionText) return scene.ascensionText;
    // Auto-prepend for ascension 2+ without explicit variant
    if (_ascensionLevel >= 2 && !scene.ascensionText) {
      return 'Ascension ' + _ascensionLevel + ' \u2014 The arena has shifted since your last visit.\n\n' + scene.text;
    }
    return scene.text;
  }

  function renderScene(sceneId, adventure, container, playerStats) {
    var scene = adventure.scenes[sceneId];
    if (!scene) { console.error('[BsAdventure] Scene not found:', sceneId); finishAdventure(); return; }

    _sceneIndex++;

    var progressEl = $('bs-adventure-progress');
    if (progressEl) progressEl.textContent = 'Scene ' + _sceneIndex + ' / ' + _sceneCount;

    // Reset image
    var imgEl = $('bs-adventure-image');
    if (imgEl) { imgEl.style.display = 'none'; imgEl.src = ''; }
    var loadingEl = $('bs-adventure-image-loading');
    if (loadingEl) loadingEl.style.display = 'none';

    // Clear choices
    var choicesEl = $('bs-adventure-choices');
    if (choicesEl) choicesEl.innerHTML = '';

    // Hide footer
    var footerEl = $('bs-adventure-footer');
    if (footerEl) footerEl.style.display = 'none';

    // Scene music
    if (scene.music) playSceneMusic(scene.music);

    // Scene image (fire and forget)
    if (scene.imagePrompt) generateSceneImage(scene.imagePrompt);

    // Resonance banner (first scene only)
    if (_sceneIndex === 1 && _resonanceBonus > 0) {
      var bodyEl = $('bs-adventure-body');
      if (bodyEl) {
        // Remove any previous resonance banner
        var old = bodyEl.querySelector('.bs-adventure__resonance');
        if (old) old.remove();
        var resonanceEl = document.createElement('div');
        resonanceEl.className = 'bs-adventure__resonance';
        resonanceEl.innerHTML = '<i class="fas fa-link"></i> Resonance: Your strength aligns with this enemy\'s weakness \u2014 +' + _resonanceBonus + ' to all skill checks';
        bodyEl.insertBefore(resonanceEl, bodyEl.firstChild);
      }
    }

    // Scene text
    var textEl = $('bs-adventure-text');
    if (textEl) {
      textEl.classList.remove('bs-adventure__text--entering');
      void textEl.offsetWidth;
      textEl.classList.add('bs-adventure__text--entering');

      var sceneText = getSceneText(scene);

      if (scene.isFinal) {
        typewriter(textEl, sceneText).then(function () { renderSummary(container); scrollToChoices(); });
      } else {
        typewriter(textEl, sceneText).then(function () {
          renderChoices(scene.choices, container, playerStats);
          scrollToChoices();
        });
        // Early choice reveal
        if (!_prefersReducedMotion && scene.choices) {
          setTimeout(function () {
            if (choicesEl && choicesEl.children.length === 0) {
              renderChoices(scene.choices, container, playerStats);
              choicesEl.style.opacity = '0.4';
            }
          }, 3000);
        }
      }
    }
  }

  // ============================================================
  // SUMMARY & FINISH
  // ============================================================

  function renderSummary(container) {
    var footerEl = $('bs-adventure-footer');
    if (footerEl) footerEl.style.display = '';

    renderBuffBar();

    var fightBtn = $('bs-adventure-fight');
    if (fightBtn) {
      var handler = function () {
        fightBtn.removeEventListener('click', handler);
        finishAdventure();
      };
      fightBtn.addEventListener('click', handler);
    }
  }

  function finishAdventure() {
    removeKeyboardNav();
    restorePreviousMusic();

    if (_containerEl) _containerEl.classList.add('bs-overlay--hidden');
    document.body.classList.remove('bs-adventure-active');

    // Remove resonance banner
    var resonance = _containerEl && _containerEl.querySelector('.bs-adventure__resonance');
    if (resonance) resonance.remove();

    if (_resolvePromise) {
      _resolvePromise({ buffs: _accumulatedBuffs, items: _accumulatedItems, skipped: false });
    }

    _resolvePromise = null;
    _rejectPromise = null;
    _currentAdventure = null;
    _containerEl = null;
    _playerStats = null;
  }

  // ============================================================
  // LAUNCH
  // ============================================================

  function launch(bossId, playerStats, options) {
    options = options || {};

    return new Promise(function (resolve, reject) {
      _resolvePromise = resolve;
      _rejectPromise = reject;
      _accumulatedBuffs = {};
      _accumulatedItems = [];
      _isProcessing = false;
      _sceneIndex = 0;
      _playerStats = playerStats;
      _playerClass = (options.playerClass || '').toLowerCase();
      _bossWeakness = options.bossWeakness || null;
      _ascensionLevel = options.ascension || 0;
      _containerEl = options.containerEl || $('bs-adventure-overlay');

      // Compute resonance: player's highest stat matches boss weakness
      _resonanceBonus = 0;
      if (_bossWeakness && playerStats) {
        var highestStat = null, highestVal = -1;
        var sKeys = Object.keys(playerStats);
        for (var i = 0; i < sKeys.length; i++) {
          if ((playerStats[sKeys[i]] || 0) > highestVal) {
            highestVal = playerStats[sKeys[i]];
            highestStat = sKeys[i];
          }
        }
        if (highestStat === _bossWeakness) _resonanceBonus = 2;
      }

      if (!_containerEl) { reject(new Error('No adventure container element')); return; }

      loadAdventure(bossId)
        .then(function (adventure) {
          _currentAdventure = adventure;
          _sceneCount = countScenes(adventure);

          var titleEl = $('bs-adventure-title');
          if (titleEl) titleEl.textContent = adventure.title;

          savePreviousMusic();

          _containerEl.classList.remove('bs-overlay--hidden');
          _containerEl.style.display = '';
          document.body.classList.add('bs-adventure-active');

          renderScene(adventure.startScene, adventure, _containerEl, playerStats);
        })
        .catch(function (err) {
          console.error('[BsAdventure] Launch failed:', err);
          _resolvePromise = null;
          _rejectPromise = null;
          reject(err);
        });
    });
  }

  // ============================================================
  // INIT
  // ============================================================

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    launch: launch,
    hasAdventure: hasAdventure,
    init: init,
    ITEMS: ADVENTURE_ITEMS  // expose for battle UI to read item defs
  };
})();

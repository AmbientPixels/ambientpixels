/**
 * adventure-engine.js — StoryForge core game loop, state machine, turn processing
 */
(function () {
  'use strict';
  var DEBUG = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

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
  function setProcessing(val) {
    isProcessing = val;
    var app = UI.$('advApp');
    if (app) app.classList.toggle('adv-app--processing', val);
  }
  // Downscale an image data-URL to a small JPEG thumbnail
  function createThumbnail(dataUrl, maxW, maxH, cb) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      var scale = Math.min(maxW / img.width, maxH / img.height, 1);
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.5));
    };
    img.onerror = function () { cb(null); };
    img.src = dataUrl;
  }

  var currentNarration = null; // { source, ctx } for Web Audio playback
  var audioCtx = null; // Shared AudioContext, unlocked on first user gesture
  var narrationEnabled = localStorage.getItem('sf_narration') !== 'off'; // on by default
  var narrationVolume = parseFloat(localStorage.getItem('sf_narration_vol')) || 0.8;
  var gainNode = null; // shared GainNode for volume control

  // Wizard state
  var wizardStep = 1;
  var WIZARD_STEPS = 3;
  var selectedArtStyle = 'cinematic_fantasy'; // default

  // Best-fit art style per genre (pre-selected when genre is chosen)
  var GENRE_ART_DEFAULTS = {
    fantasy: 'cinematic_fantasy',
    horror: 'dark_fantasy',
    scifi: 'cyberpunk_neon',
    detective: 'cinematic_realism',
    postapoc: 'cinematic_realism',
    pirate: 'vintage_pulp'
  };

  // XP/Level system
  var XP_PER_LEVEL = [0, 30, 80, 150, 250, 400]; // cumulative thresholds
  var XP_EVENTS = {
    choiceMade: 5,
    skillCheckPass: 15,
    skillCheckFail: 5,
    skillCheckCritical: 25,
    itemFound: 8,
    companionGained: 12,
    turnSurvived: 3
  };

  function initNarrationToggle() {
    var btn = UI.$('narrationToggle');
    if (!btn) return;
    updateToggleUI(btn);
    btn.addEventListener('click', function () {
      narrationEnabled = !narrationEnabled;
      localStorage.setItem('sf_narration', narrationEnabled ? 'on' : 'off');
      updateToggleUI(btn);
      if (!narrationEnabled) {
        stopNarration();
      } else if (preloadedAudioBuffer && !currentNarration) {
        // Unmuted with audio ready — play it
        playBuffer(preloadedAudioBuffer);
      }
    });

    var slider = UI.$('narrationVolume');
    if (slider) {
      slider.value = narrationVolume;
      slider.addEventListener('input', function () {
        narrationVolume = parseFloat(slider.value);
        localStorage.setItem('sf_narration_vol', narrationVolume);
        if (gainNode) gainNode.gain.value = narrationVolume;
      });
    }
  }

  function updateNarrationControlsVisibility() {
    var controls = document.querySelector('.adv-narration-controls');
    if (controls) controls.style.display = '';
  }

  function initAmbientToggle() {
    var btn = UI.$('ambientToggle');
    if (!btn) return;
    // Set initial state
    var isOn = typeof StoryAudio !== 'undefined' ? StoryAudio.enabled : false;
    updateAmbientToggleUI(btn, isOn);

    btn.addEventListener('click', function () {
      if (typeof StoryAudio === 'undefined') return;
      var newState = !StoryAudio.enabled;
      StoryAudio.setEnabled(newState);
      updateAmbientToggleUI(btn, newState);
      if (newState && selectedGenre && !StoryAudio.isAmbientPlaying()) {
        StoryAudio.startAmbient(selectedGenre.id);
      }
    });

    var slider = UI.$('ambientVolume');
    if (slider && typeof StoryAudio !== 'undefined') {
      slider.value = StoryAudio.ambientVolume;
      slider.addEventListener('input', function () {
        StoryAudio.setAmbientVolume(parseFloat(slider.value));
      });
    }
  }

  function updateAmbientToggleUI(btn, isOn) {
    if (isOn) {
      btn.classList.remove('adv-narration-toggle--muted');
      btn.classList.add('adv-narration-toggle--active');
      btn.title = 'Ambient music on — click to mute';
    } else {
      btn.classList.remove('adv-narration-toggle--active');
      btn.classList.add('adv-narration-toggle--muted');
      btn.title = 'Ambient music off — click to enable';
    }
  }

  function updateToggleUI(btn) {
    if (narrationEnabled) {
      btn.classList.remove('adv-narration-toggle--muted');
      btn.innerHTML = '<i class="fas fa-volume-up"></i>';
      btn.title = 'Narration on — click to mute';
    } else {
      btn.classList.add('adv-narration-toggle--muted');
      btn.innerHTML = '<i class="fas fa-volume-xmark"></i>';
      btn.title = 'Narration off — click to unmute';
    }
  }

  // Reduced-motion preference
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Initialize ---
  function init() {
    // Wait for auth check to complete before loading entitlements
    var authPromise = window.authReady || Promise.resolve();
    var entPromise = authPromise.then(function () { return Ent ? Ent.load() : null; });
    Promise.all([loadGenres(), entPromise]).then(function () {
      bindEvents();
      initTouchSwipe();
      initBottomSheet();
      handleUrlParams();
      updateDailyLimitBadge();
    });
  }

  function updateDailyLimitBadge() {
    var badge = UI.$('dailyLimitBadge');
    if (!badge) return;
    if (Ent && Ent.isPro()) { badge.style.display = 'none'; return; }
    var limit = (Ent && Ent.getDailyLimit) ? Ent.getDailyLimit() : 3;
    var remaining = AI.getRemainingUsage(limit);
    badge.innerHTML = '<i class="fas fa-bolt"></i> ' + remaining + ' of ' + limit + ' free adventures remaining today';
    badge.className = 'adv-daily-limit' + (remaining === 0 ? ' adv-daily-limit--empty' : '');
    badge.style.display = '';
  }

  // --- Wizard Navigation ---
  function goToWizardStep(step) {
    if (step < 1 || step > WIZARD_STEPS) return;
    var prevStep = wizardStep;
    wizardStep = step;

    // Update step indicators
    document.querySelectorAll('.adv-wizard__step').forEach(function (el) {
      var s = parseInt(el.dataset.step);
      el.classList.remove('adv-wizard__step--active', 'adv-wizard__step--done');
      if (s === step) {
        el.classList.add('adv-wizard__step--active');
        el.setAttribute('aria-current', 'step');
      } else {
        el.removeAttribute('aria-current');
        if (s < step) el.classList.add('adv-wizard__step--done');
      }
    });

    // Update step lines
    var lines = document.querySelectorAll('.adv-wizard__step-line');
    lines.forEach(function (line, idx) {
      line.classList.toggle('adv-wizard__step-line--done', idx < step - 1);
    });

    // Animate panel transition
    var panels = document.querySelectorAll('.adv-wizard__panel');
    var direction = step > prevStep ? 1 : -1;
    panels.forEach(function (panel) {
      var p = parseInt(panel.dataset.panel);
      if (p === prevStep) {
        panel.classList.remove('adv-wizard__panel--active');
        panel.classList.add('adv-wizard__panel--exit-left');
        panel.style.transform = 'translateX(' + (-40 * direction) + 'px)';
        setTimeout(function () {
          panel.classList.remove('adv-wizard__panel--exit-left');
          panel.style.transform = '';
        }, 400);
      } else if (p === step) {
        panel.style.transform = 'translateX(' + (40 * direction) + 'px)';
        panel.classList.add('adv-wizard__panel--active');
        // Force reflow for animation
        panel.offsetHeight;
        panel.style.transform = '';
      }
    });

    // Update nav buttons
    var prevBtn = UI.$('wizardPrevBtn');
    var nextBtn = UI.$('wizardNextBtn');
    var startBtn = UI.$('startAdventureBtn');
    prevBtn.style.display = step > 1 ? '' : 'none';

    if (step === WIZARD_STEPS) {
      nextBtn.style.display = 'none';
      startBtn.style.display = '';
      startBtn.disabled = !generatedPortraitDataUrl;
    } else {
      nextBtn.style.display = '';
      startBtn.style.display = 'none';
      updateWizardNextEnabled();
    }
  }

  function updateWizardNextEnabled() {
    var nextBtn = UI.$('wizardNextBtn');
    var hint = UI.$('wizardHint');
    if (!nextBtn) return;
    var hintText = '';
    if (wizardStep === 1) {
      nextBtn.disabled = !selectedGenre;
      hintText = !selectedGenre ? 'Select a genre to continue' : '';
    } else if (wizardStep === 2) {
      var hasPortrait = !!generatedPortraitDataUrl;
      nextBtn.disabled = !hasPortrait;
      hintText = !hasPortrait ? 'Generate a portrait to continue' : '';
    }
    if (hint) hint.textContent = hintText;
  }

  function resetWizard() {
    wizardStep = 1;
    selectedGenre = null;
    selectedArtStyle = 'cinematic_fantasy';
    UI.$('advApp').removeAttribute('data-genre');
    document.querySelectorAll('.adv-genre-card').forEach(function (c) {
      c.classList.remove('adv-genre-card--selected');
    });
    resetPortrait();
    goToWizardStep(1);
  }

  // --- Stat Radar Chart ---
  function drawStatRadar() {
    var canvas = document.getElementById('statRadarCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;
    var cx = W / 2;
    var cy = H / 2;
    var R = Math.min(cx, cy) - 30;

    ctx.clearRect(0, 0, W, H);

    var labels = ['STR', 'DEX', 'INT', 'CHA'];
    var vals = [];
    STAT_KEYS.forEach(function (key) {
      var slider = document.querySelector('.adv-stat-row__slider[data-stat-key="' + key + '"]');
      vals.push(slider ? parseInt(slider.value) : 10);
    });

    var n = labels.length;
    var angleStep = (Math.PI * 2) / n;
    var startAngle = -Math.PI / 2; // top

    // Get accent color from CSS
    var style = getComputedStyle(document.documentElement);
    var accentRgb = style.getPropertyValue('--sf-accent-rgb').trim() || '124, 58, 237';

    // Draw grid rings
    [0.25, 0.5, 0.75, 1].forEach(function (frac) {
      ctx.beginPath();
      for (var i = 0; i <= n; i++) {
        var angle = startAngle + i * angleStep;
        var x = cx + Math.cos(angle) * R * frac;
        var y = cy + Math.sin(angle) * R * frac;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(' + accentRgb + ', 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Draw axis lines
    for (var i = 0; i < n; i++) {
      var angle = startAngle + i * angleStep;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
      ctx.strokeStyle = 'rgba(' + accentRgb + ', 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw stat polygon (filled)
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var angle = startAngle + i * angleStep;
      var frac = (vals[i] - STAT_MIN) / (STAT_MAX - STAT_MIN);
      var x = cx + Math.cos(angle) * R * frac;
      var y = cy + Math.sin(angle) * R * frac;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(' + accentRgb + ', 0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(' + accentRgb + ', 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw stat dots
    for (var i = 0; i < n; i++) {
      var angle = startAngle + i * angleStep;
      var frac = (vals[i] - STAT_MIN) / (STAT_MAX - STAT_MIN);
      var x = cx + Math.cos(angle) * R * frac;
      var y = cy + Math.sin(angle) * R * frac;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + accentRgb + ', 0.8)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw labels
    ctx.font = '600 11px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < n; i++) {
      var angle = startAngle + i * angleStep;
      var lx = cx + Math.cos(angle) * (R + 18);
      var ly = cy + Math.sin(angle) * (R + 18);
      ctx.fillStyle = 'rgba(' + accentRgb + ', 0.7)';
      ctx.fillText(labels[i], lx, ly);
      // Value below label
      ctx.font = '700 10px "Chakra Petch", sans-serif';
      ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
      ctx.fillText(vals[i], lx, ly + 13);
      ctx.font = '600 11px "Chakra Petch", sans-serif';
    }
  }

  // --- XP / Level System ---
  function getPlayerXP() {
    return (gameState && gameState.xp) || 0;
  }

  function getPlayerLevel(xp) {
    for (var i = XP_PER_LEVEL.length - 1; i >= 0; i--) {
      if (xp >= XP_PER_LEVEL[i]) return i + 1;
    }
    return 1;
  }

  function awardXP(event) {
    if (!gameState) return;
    var amount = XP_EVENTS[event] || 0;
    if (!amount) return;
    if (!gameState.xp) gameState.xp = 0;
    var prevLevel = getPlayerLevel(gameState.xp);
    gameState.xp += amount;
    var newLevel = getPlayerLevel(gameState.xp);
    updateLevelBar();
    if (newLevel > prevLevel) {
      // Level up notification
      UI.toast('Level Up! You are now Level ' + newLevel, 'success');
      var badge = UI.$('levelBadge');
      if (badge) {
        badge.classList.add('adv-level-bar__badge--level-up');
        setTimeout(function () { badge.classList.remove('adv-level-bar__badge--level-up'); }, 1000);
      }
      playSfx('levelUp');
    }
  }

  function updateLevelBar() {
    if (!gameState) return;
    var xp = gameState.xp || 0;
    var level = getPlayerLevel(xp);
    var bar = UI.$('levelBar');
    if (bar) bar.style.display = '';
    var badge = UI.$('levelBadge');
    if (badge) badge.textContent = 'Lv ' + level;

    // Calculate fill percentage for current level
    var currentThreshold = XP_PER_LEVEL[level - 1] || 0;
    var nextThreshold = XP_PER_LEVEL[level] || (currentThreshold + 100);
    var pct = ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100;
    pct = Math.min(100, Math.max(0, pct));
    var fill = UI.$('levelFill');
    if (fill) fill.style.width = pct + '%';

    var xpDisplay = UI.$('levelXp');
    if (xpDisplay) xpDisplay.textContent = xp + ' XP';
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
      updateNarrationControlsVisibility();
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
      // Auto-select genre from hub link — jump to step 2
      selectedGenre = genres.find(function (g) { return g.id === genreId; });
      if (selectedGenre) {
        UI.$('advApp').setAttribute('data-genre', selectedGenre.id);
        selectedArtStyle = GENRE_ART_DEFAULTS[selectedGenre.id] || 'cinematic_fantasy';
        if (StoryAudio.preloadGenre) StoryAudio.preloadGenre(selectedGenre.id);
        var card = document.querySelector('.adv-genre-card[data-genre="' + genreId + '"]');
        if (card) card.classList.add('adv-genre-card--selected');
        showCharacterCreator(selectedGenre);
        goToWizardStep(2);
      }
      UI.showScreen('screenGenreSelect');
    } else {
      UI.showScreen('screenGenreSelect');
    }
  }

  // --- Resume Saved Adventure ---
  // --- Story Recap on Continue ---
  function showRecap(adventure, onDismiss) {
    var turns = adventure.turns;
    if (!turns || turns.length === 0) { onDismiss(); return; }

    var overlay = UI.$('recapOverlay');
    var header = UI.$('recapHeader');
    var timeline = UI.$('recapTimeline');
    if (!overlay || !header || !timeline) { onDismiss(); return; }

    // Header info
    var genreData = genres.find(function (g) { return g.id === adventure.genre; });
    var genreName = genreData ? genreData.name : adventure.genre;
    header.innerHTML =
      '<span><i class="fas fa-user"></i> ' + UI.escapeHtml(adventure.playerName || 'Hero') + '</span>' +
      '<span><i class="fas fa-masks-theater"></i> ' + genreName + '</span>' +
      '<span><i class="fas fa-heart"></i> HP ' + adventure.stats.hp + '/' + adventure.stats.maxHp + '</span>' +
      '<span><i class="fas fa-shoe-prints"></i> Turn ' + adventure.turnCount + '/' + adventure.maxTurns + '</span>';

    // Show last 5 turns
    var recentTurns = turns.slice(-5);
    timeline.innerHTML = recentTurns.map(function (t) {
      var excerpt = (t.sceneExcerpt || '').substring(0, 120);
      if ((t.sceneExcerpt || '').length > 120) excerpt += '...';
      var choiceHtml = t.choiceMade ? '<div class="adv-recap__turn-choice">' + UI.escapeHtml(t.choiceMade) + '</div>' : '';
      return '<div class="adv-recap__turn">' +
        '<div class="adv-recap__turn-num">Turn ' + t.turnNumber + '</div>' +
        '<div class="adv-recap__turn-scene">' + UI.escapeHtml(excerpt) + '</div>' +
        choiceHtml +
      '</div>';
    }).join('');

    overlay.style.display = '';

    var continueBtn = UI.$('recapContinueBtn');
    function dismiss() {
      overlay.style.display = 'none';
      continueBtn.removeEventListener('click', dismiss);
      onDismiss();
    }
    continueBtn.addEventListener('click', dismiss);
  }

  function resumeAdventure(adventure) {
    gameState = adventure;
    selectedGenre = genres.find(function (g) { return g.id === adventure.genre; });

    if (selectedGenre) {
      UI.$('advApp').setAttribute('data-genre', selectedGenre.id);
    }

    UI.showScreen('screenPlay');
    UI.$('pauseBtn').style.display = '';
    UI.$('immersiveBtn').style.display = '';
    // Start ambient music on resume
    ensureAudioContext();
    if (typeof StoryAudio !== 'undefined' && audioCtx) {
      StoryAudio.init(audioCtx);
      StoryAudio.startAmbient(selectedGenre ? selectedGenre.id : 'fantasy');
    }
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

    // Show recap then generate fresh choices
    function generateChoices() {
      setProcessing(true);
      AI.generateContinuation(selectedGenre, gameState)
        .then(function (scene) {
          currentScene = scene;
          renderChoices(scene.choices);
          setProcessing(false);
        })
        .catch(function () {
          currentScene = {
            choices: [
              { id: 'explore', text: 'Look around and assess the situation' },
              { id: 'proceed', text: 'Press forward cautiously' },
              { id: 'rest', text: 'Take a moment to rest and recover' }
            ]
          };
          renderChoices(currentScene.choices);
          setProcessing(false);
        });
    }

    showRecap(adventure, generateChoices);
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
        '<img class="adv-genre-card__img" src="images/genre-' + g.id + '.webp" alt="' + g.name + '" loading="lazy" />' +
        '<div class="adv-genre-card__name">' + g.name + '</div>' +
        '<div class="adv-genre-card__desc">' + g.description + '</div>' +
      '</div>';
    }).join('') +
      '<div class="adv-genre-card adv-genre-card--coming-soon">' +
        '<div class="adv-genre-card__coming-soon-icon"><i class="fas fa-plus"></i></div>' +
        '<div class="adv-genre-card__name">More Coming Soon</div>' +
        '<div class="adv-genre-card__desc">New genres & stories on the way</div>' +
      '</div>';

    grid.addEventListener('click', function (e) {
      var card = e.target.closest('.adv-genre-card');
      if (!card || card.classList.contains('adv-genre-card--coming-soon')) return;
      grid.querySelectorAll('.adv-genre-card').forEach(function (c) {
        c.classList.remove('adv-genre-card--selected');
      });
      card.classList.add('adv-genre-card--selected');
      selectedGenre = genres.find(function (g) { return g.id === card.dataset.genre; });
      UI.$('advApp').setAttribute('data-genre', selectedGenre.id);
      selectedArtStyle = GENRE_ART_DEFAULTS[selectedGenre.id] || 'cinematic_fantasy';
      // Preload ambient loop during wizard so it's ready by turn 1
      if (StoryAudio.preloadGenre) StoryAudio.preloadGenre(selectedGenre.id);
      showCharacterCreator(selectedGenre);
      updateWizardNextEnabled();
    });
  }

  // --- Events ---
  function bindEvents() {
    initNarrationToggle();
    initAmbientToggle();
    // Sync narrator checkbox with stored preference
    var narratorCheckbox = UI.$('narratorToggle');
    if (narratorCheckbox) narratorCheckbox.checked = narrationEnabled;
    UI.$('startAdventureBtn').addEventListener('click', startAdventure);

    // Wizard navigation
    UI.$('wizardNextBtn').addEventListener('click', function () {
      if (wizardStep === 1 && !selectedGenre) return;
      if (wizardStep === 1) {
        // Moving to step 2 — ensure character creator is populated
        showCharacterCreator(selectedGenre);
      }
      if (wizardStep === 2) {
        // Moving to step 3 — ensure stat allocator is rendered
        renderStatAllocator(selectedGenre);
        setTimeout(drawStatRadar, 50);
      }
      goToWizardStep(wizardStep + 1);
    });

    UI.$('wizardPrevBtn').addEventListener('click', function () {
      goToWizardStep(wizardStep - 1);
    });

    // Wizard step indicators are clickable (only to completed steps)
    document.querySelectorAll('.adv-wizard__step').forEach(function (stepEl) {
      stepEl.addEventListener('click', function () {
        var target = parseInt(stepEl.dataset.step);
        if (target < wizardStep) {
          goToWizardStep(target);
        } else if (target === wizardStep + 1) {
          // Allow clicking next step if current is valid
          UI.$('wizardNextBtn').click();
        }
      });
    });

    UI.$('newAdventureBtn').addEventListener('click', function () {
      gameState = null;
      currentScene = null;
      resetPortrait();
      resetWizard();
      UI.showScreen('screenGenreSelect');
    });

    var portraitBtn = UI.$('generatePortraitBtn');
    if (portraitBtn) portraitBtn.addEventListener('click', generatePortrait);

    // --- Immersive mode ---
    var immersiveBtn = UI.$('immersiveBtn');
    var sidebarToggle = UI.$('sidebarToggle');
    if (immersiveBtn) {
      immersiveBtn.addEventListener('click', toggleImmersiveMode);
    }
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
        var sidebar = document.querySelector('.adv-sidebar');
        if (sidebar) sidebar.classList.toggle('adv-sidebar--open');
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'f' || e.key === 'F') {
        // Don't trigger if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        toggleImmersiveMode();
      }
      if (e.key === 'Escape') {
        var app = UI.$('advApp');
        if (app && app.classList.contains('adv-app--immersive')) {
          toggleImmersiveMode();
        }
      }
    });

    // Immersive mode: reveal header when mouse is near top of screen
    var headerRevealTimer = null;
    document.addEventListener('mousemove', function (e) {
      var app = UI.$('advApp');
      if (!app || !app.classList.contains('adv-app--immersive')) return;
      var header = document.querySelector('.adv-header');
      if (!header) return;
      if (e.clientY <= 48) {
        header.classList.add('adv-header--visible');
        clearTimeout(headerRevealTimer);
      } else if (e.clientY > 80) {
        // Delay hiding so user can interact with header
        clearTimeout(headerRevealTimer);
        headerRevealTimer = setTimeout(function () {
          header.classList.remove('adv-header--visible');
        }, 400);
      }
    });

    UI.$('pauseBtn').addEventListener('click', showPauseMenu);
    UI.$('resumeBtn').addEventListener('click', hidePauseMenu);
    UI.$('saveQuitBtn').addEventListener('click', function () {
      var btn = UI.$('saveQuitBtn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      saveAdventure().then(function () {
        UI.toast('Adventure saved', 'success');
        window.location.href = '/storyforge/';
      });
    });
    UI.$('abandonBtn').addEventListener('click', function () {
      hidePauseMenu();
      UI.showConfirm('Abandon Adventure?', 'All progress will be lost. This cannot be undone.', 'Abandon').then(function (ok) {
        if (!ok) { showPauseMenu(); return; }
        var adventureId = gameState ? gameState.adventureId : null;
        gameState = null;
        currentScene = null;
        if (adventureId) Storage.deleteAdventure(adventureId);
        window.location.href = '/storyforge/';
      });
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
    var container = UI.$('charOptionsContainer');
    if (!genre || !genre.characterOptions || Object.keys(genre.characterOptions).length === 0) {
      return;
    }
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
    showArtStyleGrid();
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

  // --- Art Style Selector ---
  function showArtStyleGrid() {
    var grid = UI.$('artStyleGrid');
    if (!grid) return;
    var styles = AI.ART_STYLES;
    var keys = Object.keys(styles);
    grid.innerHTML = keys.map(function (key) {
      var s = styles[key];
      var active = key === selectedArtStyle ? ' adv-art-style__card--active' : '';
      return '<button type="button" class="adv-art-style__card' + active + '" data-style="' + key + '">' +
        '<i class="fas ' + s.icon + ' adv-art-style__icon"></i>' +
        '<span class="adv-art-style__name">' + UI.escapeHtml(s.label) + '</span>' +
        '</button>';
    }).join('');
    grid.addEventListener('click', function (e) {
      var card = e.target.closest('.adv-art-style__card');
      if (!card) return;
      selectedArtStyle = card.dataset.style;
      grid.querySelectorAll('.adv-art-style__card').forEach(function (c) {
        c.classList.toggle('adv-art-style__card--active', c.dataset.style === selectedArtStyle);
      });
    });
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

    AI.generatePortraitImage(charDesc, selectedGenre, selectedArtStyle)
      .then(function (dataUrl) {
        if (dataUrl) {
          generatedPortraitDataUrl = dataUrl;
          img.onload = function () {
            img.classList.add('adv-portrait__image--loaded');
            placeholder.style.display = 'none';
            // Activate glow ring
            var frame = UI.$('portraitFrame');
            if (frame) frame.classList.add('adv-portrait__frame--has-portrait');
          };
          img.src = dataUrl;
          btn.innerHTML = '<i class="fas fa-rotate"></i> Regenerate';
          updateWizardNextEnabled();
          // Enable start button if on step 3
          if (wizardStep === WIZARD_STEPS) {
            UI.$('startAdventureBtn').disabled = false;
          }
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
    var frame = UI.$('portraitFrame');
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
    if (frame) frame.classList.remove('adv-portrait__frame--has-portrait');
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
        '<span class="adv-stat-row__label">' + label +
          (hint ? '<span class="adv-stat-hint" title="' + UI.escapeHtml(hint) + '"><i class="fas fa-circle-info"></i></span>' : '') +
        '</span>' +
        '<input type="range" class="adv-stat-row__slider" data-stat-key="' + key + '" ' +
          'min="' + STAT_MIN + '" max="' + STAT_MAX + '" value="' + val + '" ' +
          'style="--fill:' + fillPct + '%" aria-label="' + label + '" />' +
        '<span class="adv-stat-row__value">' + val + '</span>' +
        '<span class="adv-stat-row__modifier' + modClass + '">' + modStr + '</span>' +
      '</div>';
    }).join('');

    // Bind slider events (RAF-gated to prevent excessive DOM writes)
    var sliderRafPending = false;
    rowsEl.querySelectorAll('.adv-stat-row__slider').forEach(function (slider) {
      slider.addEventListener('input', function () {
        enforceStatBudget(slider.dataset.statKey, parseInt(slider.value));
        if (!sliderRafPending) {
          sliderRafPending = true;
          requestAnimationFrame(function () {
            sliderRafPending = false;
            updateSliderDisplay(slider);
            updateStatBudgetDisplay(budget);
            updateStatPreviewSentence();
            activePresetLabel = null;
            updatePresetHighlight();
            drawStatRadar();
          });
        }
      });
    });

    // Render archetype cards
    var presets = genre.archetypePresets || [];
    presetsEl.innerHTML = presets.map(function (p) {
      var statSummary = STAT_KEYS.map(function (k) {
        return RPG.STAT_LABELS[k].substring(0, 3).toUpperCase() + ' ' + p.stats[k];
      }).join(' / ');
      return '<div class="adv-archetype-card" data-preset-label="' + UI.escapeHtml(p.label) + '">' +
        '<div class="adv-archetype-card__icon"><i class="fas ' + p.icon + '"></i></div>' +
        '<div class="adv-archetype-card__name">' + UI.escapeHtml(p.label) + '</div>' +
        '<div class="adv-archetype-card__stats">' + statSummary + '</div>' +
      '</div>';
    }).join('');

    presetsEl.querySelectorAll('.adv-archetype-card').forEach(function (card, idx) {
      card.addEventListener('click', function () {
        applyArchetypePreset(presets[idx]);
        activePresetLabel = presets[idx].label;
        updatePresetHighlight();
        updateStatBudgetDisplay(budget);
        updateStatPreviewSentence();
        drawStatRadar();
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
        drawStatRadar();
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
    document.querySelectorAll('.adv-archetype-card').forEach(function (card) {
      card.classList.toggle('adv-archetype-card--active', card.dataset.presetLabel === activePresetLabel);
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

    // Apply narrator preference from character creation
    var narratorCheckbox = UI.$('narratorToggle');
    if (narratorCheckbox) {
      narrationEnabled = narratorCheckbox.checked;
      localStorage.setItem('sf_narration', narrationEnabled ? 'on' : 'off');
      var toggleBtn = UI.$('narrationToggle');
      if (toggleBtn) updateToggleUI(toggleBtn);
    }
    updateNarrationControlsVisibility();

    // Unlock AudioContext on user gesture so TTS can auto-play when scene arrives
    ensureAudioContext();
    // Init procedural audio system (shares AudioContext)
    if (typeof StoryAudio !== 'undefined' && audioCtx) {
      StoryAudio.init(audioCtx);
    }

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
    gameState.artStyle = selectedArtStyle;
    gameState.xp = 0;
    if (generatedPortraitDataUrl) {
      gameState.portraitImage = generatedPortraitDataUrl;
    }
    setProcessing(true);

    UI.showScreen('screenPlay');
    UI.$('pauseBtn').style.display = '';
    UI.$('immersiveBtn').style.display = '';
    // Start genre ambient music
    if (typeof StoryAudio !== 'undefined') {
      StoryAudio.startAmbient(selectedGenre.id);
    }
    UI.showLoading(UI.$('sceneText'), 'Forging your story...');
    UI.$('choicesContainer').innerHTML = '';
    updateSidebar();
    // Start genre-themed loading messages during text generation
    startLoadingTextCycle();

    AI.incrementUsage();

    AI.generateOpeningScene(selectedGenre, playerName, gameState.character)
      .then(function (scene) {
        stopLoadingTextCycle();
        // Kick off TTS immediately — don't wait for renderScene
        preloadTTS(scene.sceneText);
        currentScene = scene;
        gameState.turnCount = 1;
        gameState.lastSceneText = scene.sceneText;
        // Store plot seed for story continuity across all turns
        if (scene.plotSeed) {
          gameState.plotSeed = scene.plotSeed;
          DEBUG && console.log('[Plot] Seed:', scene.plotSeed);
        }
        RPG.applyStateChanges(gameState, scene.stateChanges);
        renderScene(scene);
        generateAndShowImage(scene.imagePrompt);
        // Trigger first-time tutorial after opening scene
        if (typeof AdventureTutorial !== 'undefined') AdventureTutorial.start();
      })
      .catch(function (err) {
        stopLoadingTextCycle();
        console.error('Scene generation error:', err);
        // Use fallback scene so the player isn't stuck
        var fallback = AI.createFallbackScene();
        UI.toast('AI took too long — here\'s a simplified scene. Your next choice will reconnect.', 'warning');
        currentScene = fallback;
        gameState.turnCount = 1;
        gameState.lastSceneText = fallback.sceneText;
        renderScene(fallback);
        // Show retry button alongside choices
        var retryHtml = '<button class="adv-btn adv-btn--outline" id="retryOpeningBtn"><i class="fas fa-redo"></i> Retry with AI</button>';
        UI.$('choicesContainer').insertAdjacentHTML('beforeend', retryHtml);
        var retryBtn = UI.$('retryOpeningBtn');
        if (retryBtn) {
          retryBtn.addEventListener('click', function () {
            retryBtn.remove();
            setProcessing(true);
            UI.showLoading(UI.$('sceneText'), 'Retrying...');
            startLoadingTextCycle();
            AI.generateOpeningScene(selectedGenre, playerName, gameState.character)
              .then(function (scene) {
                stopLoadingTextCycle();
                preloadTTS(scene.sceneText);
                currentScene = scene;
                gameState.lastSceneText = scene.sceneText;
                if (scene.plotSeed) gameState.plotSeed = scene.plotSeed;
                RPG.applyStateChanges(gameState, scene.stateChanges);
                renderScene(scene);
                generateAndShowImage(scene.imagePrompt);
              })
              .catch(function () {
                stopLoadingTextCycle();
                UI.toast('Still unable to reach AI. Try again later.', 'error');
                setProcessing(false);
              });
          });
        }
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
    // Restore ambient volume
    if (typeof StoryAudio !== 'undefined') StoryAudio.duckForNarration(false);
    var wave = UI.$('narrationWave');
    if (wave) wave.style.display = 'none';
  }

  // Preloaded audio buffer for current scene (filled by TTS fetch in parallel with typewriter)
  var preloadedAudioBuffer = null;
  var preloadSessionId = null;

  function showTTSLoading(show) {
    var el = UI.$('ttsLoading');
    if (el) el.classList.toggle('adv-tts-loading--active', !!show);
    var btn = UI.$('narrationToggle');
    if (btn) btn.classList.toggle('adv-narration-toggle--loading', !!show);
  }

  // Returns a Promise that resolves with the AudioBuffer (or null)
  function preloadTTS(text) {
    preloadSessionId = null;
    preloadedAudioBuffer = null;
    if (!narrationEnabled) return Promise.resolve(null);
    var ctx = ensureAudioContext();
    var sessionId = {};
    preloadSessionId = sessionId;
    showTTSLoading(true);

    var voice = (gameState && AI.GENRE_VOICES[gameState.genre]) || 'Kore';
    return AI.callTTSAPI(text, voice).then(function (wavBuffer) {
      if (preloadSessionId !== sessionId || !wavBuffer) { showTTSLoading(false); return null; }
      return ctx.decodeAudioData(wavBuffer);
    }).then(function (audioBuffer) {
      showTTSLoading(false);
      if (preloadSessionId !== sessionId || !audioBuffer) return null;
      preloadedAudioBuffer = audioBuffer;
      tryAutoPlay();
      return audioBuffer;
    }).catch(function (err) {
      showTTSLoading(false);
      DEBUG && console.warn('[TTS] Preload error:', err);
      return null;
    });
  }

  function tryAutoPlay() {
    if (!narrationEnabled || !preloadedAudioBuffer || !audioCtx) return;
    playBuffer(preloadedAudioBuffer);
  }

  function playBuffer(audioBuffer) {
    stopNarration();
    var ctx = ensureAudioContext();
    // Ensure context is running (may have been suspended by browser policy)
    if (ctx.state === 'suspended') {
      ctx.resume().then(function () { doPlayBuffer(audioBuffer); });
      return;
    }
    doPlayBuffer(audioBuffer);
  }

  function doPlayBuffer(audioBuffer) {
    var ctx = audioCtx;
    if (!ctx) return;
    if (!gainNode) {
      gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);
    }
    gainNode.gain.value = narrationVolume;
    var source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);

    var sessionId = {};
    currentNarration = { source: source, id: sessionId };

    source.onended = function () {
      if (currentNarration && currentNarration.id === sessionId) {
        currentNarration = null;
        var wave = UI.$('narrationWave');
        if (wave) wave.style.display = 'none';
        // Restore ambient volume when narration finishes naturally
        if (typeof StoryAudio !== 'undefined') StoryAudio.duckForNarration(false);
      }
    };

    source.start(0);
    // Duck ambient music during narration
    if (typeof StoryAudio !== 'undefined') StoryAudio.duckForNarration(true);
    // Show waveform indicator
    var wave = UI.$('narrationWave');
    if (wave) {
      wave.style.display = '';
      wave.classList.remove('adv-narration-wave--paused');
    }
  }

  // --- Render Scene ---
  function renderScene(scene) {
    // Stop any playing narration from previous scene
    stopNarration();

    // Turn bar
    UI.$('turnLabel').textContent = 'Turn ' + gameState.turnCount;
    UI.$('progressFill').style.width = ((gameState.turnCount / gameState.maxTurns) * 100) + '%';

    // Scene entrance animation with blur transition + SFX
    playSfx('sceneTransition');
    var sceneTextEl = UI.$('sceneText');
    sceneTextEl.classList.remove('adv-scene-enter', 'adv-scene__text--transitioning');
    void sceneTextEl.offsetWidth; // force reflow to restart animation
    sceneTextEl.classList.add('adv-scene-enter', 'adv-scene__text--transitioning');

    // TTS already kicked off before renderScene — see generateOpeningScene / doGenerateNextTurn

    // Show choices early at low opacity after 3s, fully reveal when typewriter completes
    var earlyChoiceTimer = null;
    if (!scene.isEnding && scene.choices && scene.choices.length) {
      earlyChoiceTimer = setTimeout(function () {
        var container = UI.$('choicesContainer');
        if (container && !container.children.length) {
          renderChoices(scene.choices);
          container.style.opacity = '0.4';
          container.title = 'Click story text to skip ahead';
        }
      }, 3000);
    }

    // Typewriter starts immediately, no waiting for audio
    UI.typewriter(sceneTextEl, scene.sceneText).then(function () {
      if (earlyChoiceTimer) clearTimeout(earlyChoiceTimer);
      if (scene.isEnding) {
        showEnding(scene);
      } else {
        var container = UI.$('choicesContainer');
        container.style.opacity = '';
        container.title = '';
        if (!container.children.length) renderChoices(scene.choices);
      }
      setProcessing(false);
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
        '<span class="adv-choice__key" aria-hidden="true">' + (i + 1) + '</span>' +
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
    setProcessing(true);

    // Stop current narration immediately when user advances
    stopNarration();

    // Unlock AudioContext on user gesture so TTS can auto-play later
    ensureAudioContext();

    var choice = currentScene.choices.find(function (c) { return c.id === choiceId; });
    if (!choice) { setProcessing(false); return; }

    // Highlight selected choice + SFX
    playSfx('choiceSelect');
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
        playSfx('damage');
        UI.$('hpFill').parentElement.classList.add('adv-hp-flash');
        setTimeout(function () {
          UI.$('hpFill').parentElement.classList.remove('adv-hp-flash');
        }, 500);
        updateSidebar();
      }

      if (result.critical === 'critical_success') {
        var heal = 5;
        gameState.stats.hp = Math.min(gameState.stats.maxHp, gameState.stats.hp + heal);
        playSfx('heal');
      }

      generateNextTurn(choice.text, result);
    });
  }

  // --- Sound Effects — delegates to StoryAudio module ---
  var SFX_MAP = {
    dice: 'diceRoll', success: 'diceSuccess', failure: 'diceFail',
    critical: 'diceCritical', damage: 'damage', item: 'itemPickup'
  };
  function playSfx(type) {
    if (typeof StoryAudio !== 'undefined') {
      StoryAudio.sfx(SFX_MAP[type] || type);
    }
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
      playSfx('dice');

      function showFinalDice() {
        valueEl.textContent = result.roll;
        panel.classList.add('adv-dice--rolling');

        var bonusText = '';
        if (result.modifier !== 0) bonusText += (result.modifier > 0 ? '+' : '') + result.modifier;
        if (result.companionBonus) bonusText += '+' + result.companionBonus;
        if (bonusText) labelEl.textContent += ' | Roll: ' + result.roll + bonusText + ' = ' + result.total;

        if (result.critical) {
          resultEl.className = 'adv-dice__result adv-dice__result--critical';
          resultEl.textContent = result.critical === 'critical_success' ? 'CRITICAL SUCCESS!' : 'CRITICAL FAILURE!';
          playSfx(result.critical === 'critical_success' ? 'success' : 'failure');
        } else if (result.success) {
          resultEl.className = 'adv-dice__result adv-dice__result--success';
          resultEl.textContent = 'Success! (' + result.total + ' vs DC ' + result.difficulty + ')';
          playSfx('success');
        } else {
          resultEl.className = 'adv-dice__result adv-dice__result--failure';
          resultEl.textContent = 'Failed! (' + result.total + ' vs DC ' + result.difficulty + ')';
          playSfx('failure');
        }

        setTimeout(function () {
          panel.classList.remove('adv-dice--active', 'adv-dice--rolling');
          resolve();
        }, prefersReducedMotion ? 600 : 1800);
      }

      if (prefersReducedMotion) {
        showFinalDice();
      } else {
        var rollCount = 0;
        var maxRolls = 12;
        var rollInterval = setInterval(function () {
          valueEl.textContent = Math.floor(Math.random() * 20) + 1;
          rollCount++;
          if (rollCount >= maxRolls) {
            clearInterval(rollInterval);
            showFinalDice();
          }
        }, 80);
      }
    });
  }

  // --- Generate Next Turn ---
  function generateNextTurn(choiceText, skillCheckResult) {
    var sceneEl = UI.$('sceneText');
    UI.$('choicesContainer').innerHTML = '';

    if (prefersReducedMotion) {
      UI.showLoading(sceneEl, 'The story unfolds...');
      showImagePlaceholder();
      doGenerateNextTurn(choiceText, skillCheckResult);
    } else {
      sceneEl.classList.add('adv-scene-exit');
      setTimeout(function () {
        sceneEl.classList.remove('adv-scene-exit');
        UI.showLoading(sceneEl, 'The story unfolds...');
        showImagePlaceholder();
        doGenerateNextTurn(choiceText, skillCheckResult);
      }, 300);
    }
  }

  function doGenerateNextTurn(choiceText, skillCheckResult) {
    AI.generateNextScene(selectedGenre, gameState, choiceText, skillCheckResult)
      .then(function (scene) {
        // Kick off TTS immediately — don't wait for renderScene
        preloadTTS(scene.sceneText);
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

        // Award XP
        awardXP('choiceMade');
        awardXP('turnSurvived');
        if (skillCheckResult) {
          if (skillCheckResult.critical === 'critical_success') awardXP('skillCheckCritical');
          else if (skillCheckResult.success) awardXP('skillCheckPass');
          else awardXP('skillCheckFail');
        }
        if (scene.stateChanges) {
          if (scene.stateChanges.addItems && scene.stateChanges.addItems.length) awardXP('itemFound');
          if (scene.stateChanges.addCompanion) awardXP('companionGained');
        }

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
        setProcessing(false);
        // Offer a retry option that retries the same turn
        var retryBtn = document.createElement('button');
        retryBtn.className = 'adv-choice';
        retryBtn.innerHTML = '<span class="adv-choice__key" aria-hidden="true">!</span>' +
          '<span class="adv-choice__text">Something went wrong \u2014 click to retry</span>';
        retryBtn.addEventListener('click', function () {
          setProcessing(true);
          UI.$('choicesContainer').innerHTML = '';
          UI.showLoading(UI.$('sceneText'), 'Retrying...');
          doGenerateNextTurn(choiceText, skillCheckResult);
        });
        UI.$('choicesContainer').innerHTML = '';
        UI.$('choicesContainer').appendChild(retryBtn);
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

  var loadingTextInterval = null;

  function startLoadingTextCycle() {
    stopLoadingTextCycle();
    var genreId = selectedGenre ? selectedGenre.id : null;
    var messages = (genreId && GENRE_LOADING_MESSAGES[genreId]) || ['Generating scene...'];

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
      placeholder.innerHTML = '<span class="adv-loading-text">Images every scene with Pro</span>';
      placeholder.style.display = '';
      UI.$('sceneImage').classList.remove('adv-scene__image--loaded');
      return;
    }

    showImagePlaceholder();
    var charDesc = (gameState && gameState.character) ? gameState.character.description : '';
    var artStyle = (gameState && gameState.artStyle) ? gameState.artStyle : selectedArtStyle;
    AI.generateSceneImage(imagePrompt, selectedGenre, charDesc, artStyle)
      .then(function (dataUrl) {
        if (dataUrl) {
          var img = UI.$('sceneImage');
          img.onload = function () {
            stopLoadingTextCycle();
            img.classList.remove('adv-scene__image--crossfade');
            void img.offsetWidth;
            img.classList.add('adv-scene__image--loaded', 'adv-scene__image--crossfade');
            UI.$('sceneImagePlaceholder').style.display = 'none';
          };
          img.src = dataUrl;
          // Store for potential gallery use
          if (gameState.turnCount === 1) {
            gameState.firstSceneImage = dataUrl;
            // Create small thumbnail for save cards (localStorage-safe)
            createThumbnail(dataUrl, 160, 100, function (thumbUrl) {
              if (thumbUrl) gameState.thumbnailImage = thumbUrl;
            });
          }
        } else {
          // Show "unavailable" state instead of infinite spinner
          stopLoadingTextCycle();
          var placeholder = UI.$('sceneImagePlaceholder');
          placeholder.innerHTML = '<span class="adv-loading-text">Image unavailable</span>';
        }
      })
      .catch(function () {
        stopLoadingTextCycle();
        var placeholder = UI.$('sceneImagePlaceholder');
        if (placeholder) placeholder.innerHTML = '<span class="adv-loading-text">Image unavailable</span>';
      });
  }

  function showImagePlaceholder() {
    var img = UI.$('sceneImage');
    img.classList.remove('adv-scene__image--loaded');
    img.src = '';
    var placeholder = UI.$('sceneImagePlaceholder');
    placeholder.innerHTML = '<span class="adv-loading-text" id="loadingText">Generating scene...</span>';
    placeholder.style.display = '';
    startLoadingTextCycle();
  }

  // --- Inventory Interactions ---
  function bindInventoryEvents(container) {
    // Accordion: tap/key item row to expand/collapse
    container.querySelectorAll('.adv-inventory__item').forEach(function (row) {
      function toggleRow() {
        var itemId = row.dataset.itemId;
        var detail = container.querySelector('[data-detail-for="' + itemId + '"]');
        var wasOpen = row.classList.contains('adv-inventory__item--open');

        // Close all
        container.querySelectorAll('.adv-inventory__item--open').forEach(function (r) {
          r.classList.remove('adv-inventory__item--open');
          r.setAttribute('aria-expanded', 'false');
        });
        container.querySelectorAll('.adv-inventory__detail--open').forEach(function (d) {
          d.classList.remove('adv-inventory__detail--open');
        });

        // Toggle current
        if (!wasOpen && detail) {
          row.classList.add('adv-inventory__item--open');
          row.setAttribute('aria-expanded', 'true');
          detail.classList.add('adv-inventory__detail--open');
        }
      }

      row.addEventListener('click', toggleRow);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(); }
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
    try { renderSidebarPortrait(); } catch (e) { DEBUG && console.warn('[Sidebar] portrait error:', e); }
    try { updateLevelBar(); } catch (e) { DEBUG && console.warn('[Sidebar] level bar error:', e); }
    var stats = gameState.stats;

    // HP
    try {
      var hpPct = (stats.hp / stats.maxHp) * 100;
      var fill = UI.$('hpFill');
      if (fill) {
        fill.style.width = hpPct + '%';
        fill.className = 'adv-hp__fill' +
          (hpPct <= 25 ? ' adv-hp__fill--danger' : (hpPct <= 50 ? ' adv-hp__fill--warning' : ''));
      }
      var hpVal = UI.$('hpValue');
      if (hpVal) hpVal.textContent = stats.hp;
      var hpMax = UI.$('hpMax');
      if (hpMax) hpMax.textContent = '/ ' + stats.maxHp;

      // Critical HP vignette
      var sceneEl = document.querySelector('.adv-scene');
      if (sceneEl) {
        if (hpPct <= 25) sceneEl.classList.add('adv-scene--critical');
        else sceneEl.classList.remove('adv-scene--critical');
      }
    } catch (e) { DEBUG && console.warn('[Sidebar] HP error:', e); }

    // Stats (with buff indicators)
    try {
      var equipBonusMap = { weapon: 'strength', armor: 'dexterity' };
      var statsHtml = ['strength', 'dexterity', 'intelligence', 'charisma', 'gold', 'reputation'].map(function (key) {
        var icon = RPG.STAT_ICONS[key] || 'fa-circle';
        var label = RPG.STAT_LABELS[key] || key;
        var val = stats[key];
        var valClass = '';
        if (key === 'reputation') {
          valClass = val > 10 ? 'adv-stat__value--good' : (val < -10 ? 'adv-stat__value--danger' : '');
        }

        // Check for active buffs on this stat
        var buffs = [];
        if (gameState.equipped) {
          for (var slot in equipBonusMap) {
            if (equipBonusMap[slot] === key && gameState.equipped[slot]) {
              var eqItem = gameState.inventory.find(function (i) { return i.id === gameState.equipped[slot]; });
              buffs.push({ value: 1, source: eqItem ? eqItem.name : slot, type: 'equip' });
            }
          }
        }
        if (gameState.companions) {
          gameState.companions.forEach(function (comp) {
            if (comp.bonus === key) {
              buffs.push({ value: 2, source: comp.name, type: 'companion' });
            }
          });
        }

        var buffHtml = buffs.map(function (b) {
          var cls = b.type === 'companion' ? 'adv-stat__buff--companion' : 'adv-stat__buff--equip';
          var buffIcon = b.type === 'companion' ? 'fa-paw' : 'fa-shield-halved';
          return '<span class="adv-stat__buff ' + cls + '" title="' + UI.escapeHtml(b.source) + '">' +
            '<i class="fas ' + buffIcon + '"></i>+' + b.value +
          '</span>';
        }).join('');

        return '<div class="adv-stat">' +
          '<span class="adv-stat__label"><i class="fas ' + icon + '"></i> ' + label + '</span>' +
          '<span class="adv-stat__value ' + valClass + '">' + val + buffHtml + '</span>' +
        '</div>';
      }).join('');
      UI.$('statsContainer').innerHTML = statsHtml;
    } catch (e) { DEBUG && console.warn('[Sidebar] stats error:', e); }

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
          '" data-item-id="' + item.id + '" role="button" tabindex="0" aria-expanded="false">' +
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
      var COMPANION_ICONS = {
        warrior: 'fa-shield-halved', fighter: 'fa-shield-halved',
        mage: 'fa-hat-wizard', wizard: 'fa-hat-wizard', sorcerer: 'fa-hat-wizard',
        rogue: 'fa-mask', thief: 'fa-mask',
        healer: 'fa-heart-pulse', cleric: 'fa-heart-pulse',
        ranger: 'fa-bow-arrow', archer: 'fa-bullseye',
        animal: 'fa-paw', beast: 'fa-paw', wolf: 'fa-paw', dog: 'fa-dog', cat: 'fa-cat',
        bird: 'fa-crow', dragon: 'fa-dragon',
        spirit: 'fa-ghost', ghost: 'fa-ghost',
        robot: 'fa-robot', droid: 'fa-robot',
        merchant: 'fa-coins', trader: 'fa-coins',
        pirate: 'fa-skull-crossbones', sailor: 'fa-anchor',
        detective: 'fa-magnifying-glass', scientist: 'fa-flask'
      };

      UI.$('companionsContainer').innerHTML = gameState.companions.map(function (comp) {
        var compType = (comp.type || '').toLowerCase();
        var compIcon = COMPANION_ICONS[compType] || 'fa-user';
        // Also check name for animal/creature keywords
        var nameLower = (comp.name || '').toLowerCase();
        if (compIcon === 'fa-user') {
          Object.keys(COMPANION_ICONS).forEach(function (k) {
            if (nameLower.indexOf(k) !== -1) compIcon = COMPANION_ICONS[k];
          });
        }
        return '<div class="adv-companion">' +
          '<div class="adv-companion__icon"><i class="fas ' + compIcon + '"></i></div>' +
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

    updateBottomSheetMini();
  }

  // --- Ending ---
  function showEnding(scene) {
    UI.showScreen('screenEnding');
    UI.$('pauseBtn').style.display = 'none';
    UI.$('immersiveBtn').style.display = 'none';
    // Exit immersive if active
    var app = UI.$('advApp');
    if (app && app.classList.contains('adv-app--immersive')) toggleImmersiveMode();

    // Fade out ambient and play ending SFX
    if (typeof StoryAudio !== 'undefined') {
      StoryAudio.stopAmbient(3000);
    }
    var type = scene.endingType || 'escape';
    var endingSfx = { victory: 'endingVictory', death: 'endingDeath', escape: 'endingEscape' };
    playSfx(endingSfx[type] || 'endingEscape');
    var icons = { victory: 'fa-trophy', death: 'fa-skull', escape: 'fa-person-running' };
    var titles = { victory: 'Victory!', death: 'You Died', escape: 'Escaped!' };

    UI.$('endingIcon').innerHTML = '<i class="fas ' + (icons[type] || icons.escape) + '"></i>';
    UI.$('endingIcon').className = 'adv-ending__icon adv-ending__icon--' + type;
    UI.$('endingTitle').textContent = titles[type] || 'The End';
    UI.$('endingText').textContent = scene.sceneText;

    var finalLevel = getPlayerLevel(gameState.xp || 0);
    UI.$('endingStats').innerHTML =
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">' + gameState.turnCount + '</div><div class="adv-ending__stat-label">Turns</div></div>' +
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">Lv ' + finalLevel + '</div><div class="adv-ending__stat-label">Level</div></div>' +
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">' + gameState.stats.gold + '</div><div class="adv-ending__stat-label">Gold</div></div>' +
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">' + gameState.inventory.length + '</div><div class="adv-ending__stat-label">Items</div></div>' +
      '<div class="adv-ending__stat"><div class="adv-ending__stat-value">' + gameState.companions.length + '</div><div class="adv-ending__stat-label">Allies</div></div>';

    // Achievement badges
    var badges = [];
    if (type === 'victory') badges.push({ icon: 'fa-crown', label: 'Victorious' });
    if (gameState.turnCount >= 20) badges.push({ icon: 'fa-hourglass-end', label: 'Marathon' });
    if (gameState.turnCount <= 5) badges.push({ icon: 'fa-bolt', label: 'Speedrun' });
    if (gameState.stats.gold >= 100) badges.push({ icon: 'fa-gem', label: 'Wealthy' });
    if (gameState.companions.length >= 2) badges.push({ icon: 'fa-people-group', label: 'Leader' });
    if (gameState.inventory.length >= 6) badges.push({ icon: 'fa-suitcase', label: 'Collector' });
    if (gameState.stats.hp === gameState.stats.maxHp && type === 'victory') badges.push({ icon: 'fa-shield-heart', label: 'Untouched' });
    if (type === 'death' && gameState.turnCount >= 15) badges.push({ icon: 'fa-skull-crossbones', label: 'Valiant Fall' });

    if (badges.length) {
      var badgesHtml = '<div class="adv-ending__badges">' +
        badges.map(function (b) {
          return '<span class="adv-ending__badge"><i class="fas ' + b.icon + '"></i> ' + b.label + '</span>';
        }).join('') + '</div>';
      UI.$('endingStats').insertAdjacentHTML('afterend', badgesHtml);
    }

    gameState.status = 'completed';
    gameState.badges = badges.map(function (b) { return b.label; });
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

    // Wire Play Again button
    var playAgainBtn = UI.$('playAgainBtn');
    if (playAgainBtn && gameState.genre) {
      playAgainBtn.style.display = '';
      playAgainBtn.onclick = function () {
        window.location.href = '/storyforge/play.html?genre=' + gameState.genre;
      };
    }

    // Wire star rating
    var starsContainer = UI.$('endingStars');
    if (starsContainer) {
      var stars = starsContainer.querySelectorAll('.adv-ending__star');
      stars.forEach(function (star) {
        star.addEventListener('click', function () {
          var rating = parseInt(star.dataset.rating);
          gameState.rating = rating;
          saveAdventure();
          // Highlight stars up to rating
          stars.forEach(function (s) {
            s.classList.toggle('adv-ending__star--active', parseInt(s.dataset.rating) <= rating);
          });
        });
        // Hover preview
        star.addEventListener('mouseenter', function () {
          var r = parseInt(star.dataset.rating);
          stars.forEach(function (s) {
            s.classList.toggle('adv-ending__star--active', parseInt(s.dataset.rating) <= r);
          });
        });
      });
      starsContainer.addEventListener('mouseleave', function () {
        var current = gameState.rating || 0;
        stars.forEach(function (s) {
          s.classList.toggle('adv-ending__star--active', parseInt(s.dataset.rating) <= current);
        });
      });
    }
  }

  // --- Immersive Mode ---
  function toggleImmersiveMode() {
    var app = UI.$('advApp');
    if (!app) return;
    var isImmersive = app.classList.toggle('adv-app--immersive');
    var btn = UI.$('immersiveBtn');
    if (btn) {
      var icon = btn.querySelector('i');
      if (icon) icon.className = isImmersive ? 'fas fa-compress' : 'fas fa-expand';
      btn.title = isImmersive ? 'Exit immersive (Esc)' : 'Immersive mode (F)';
    }
    // Close sidebar panel if exiting immersive
    if (!isImmersive) {
      var sidebar = document.querySelector('.adv-sidebar');
      if (sidebar) sidebar.classList.remove('adv-sidebar--open');
    }
  }

  // --- Pause Menu ---
  var pausePreviousFocus = null;

  function showPauseMenu() {
    if (!gameState) return;
    pausePreviousFocus = document.activeElement;
    saveAdventure();
    UI.$('pauseInfo').textContent = 'Turn ' + gameState.turnCount + ' of ' + gameState.maxTurns +
      ' | ' + gameState.playerName + ' | HP: ' + gameState.stats.hp + '/' + gameState.stats.maxHp;
    UI.$('pauseOverlay').style.display = '';
    UI.$('resumeBtn').focus();
  }

  function hidePauseMenu() {
    UI.$('pauseOverlay').style.display = 'none';
    if (pausePreviousFocus && pausePreviousFocus.focus) pausePreviousFocus.focus();
  }

  // --- Save Adventure ---
  function saveAdventure() {
    if (!gameState) return Promise.resolve();
    if (!gameState.adventureId) {
      gameState.adventureId = 'sf_' + Date.now();
    }
    gameState.updatedAt = new Date().toISOString();
    if (!gameState.createdAt) gameState.createdAt = gameState.updatedAt;
    return Storage.saveAdventure(gameState);
  }

  // --- Touch Swipe for Choices (mobile) ---
  var swipeStartX = 0;
  var swipeStartY = 0;
  var highlightedIdx = -1;

  function initTouchSwipe() {
    var container = UI.$('choicesContainer');
    if (!container) return;

    container.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      swipeStartX = t.clientX;
      swipeStartY = t.clientY;
    }, { passive: true });

    container.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - swipeStartX;
      var dy = t.clientY - swipeStartY;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;

      var choices = container.querySelectorAll('.adv-choice:not(:disabled)');
      if (!choices.length) return;

      if (highlightedIdx < 0) highlightedIdx = 0;
      if (dx < 0) {
        highlightedIdx = Math.min(choices.length - 1, highlightedIdx + 1);
      } else {
        highlightedIdx = Math.max(0, highlightedIdx - 1);
      }

      choices.forEach(function (c, i) {
        c.classList.toggle('adv-choice--highlighted', i === highlightedIdx);
      });
      choices[highlightedIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, { passive: true });
  }

  // Reset highlight when new choices render
  var origRenderChoices = renderChoices;
  renderChoices = function (choices) {
    highlightedIdx = -1;
    origRenderChoices(choices);
  };

  // --- Bottom Sheet Sidebar (mobile) ---
  function initBottomSheet() {
    var sidebar = document.querySelector('.adv-sidebar');
    if (!sidebar) return;

    // Inject drag handle
    var handle = document.createElement('div');
    handle.className = 'adv-sidebar__handle';
    handle.innerHTML = '<div class="adv-sidebar__handle-bar"></div>';
    sidebar.prepend(handle);

    // Inject mini summary bar
    var mini = document.createElement('div');
    mini.className = 'adv-sidebar__mini';
    mini.id = 'sidebarMini';
    sidebar.insertBefore(mini, handle.nextSibling);

    // Tap handle to toggle
    handle.addEventListener('click', function () {
      sidebar.classList.toggle('adv-sidebar--sheet-open');
    });

    // Swipe up/down on handle to open/close
    var handleStartY = 0;
    handle.addEventListener('touchstart', function (e) {
      handleStartY = e.touches[0].clientY;
    }, { passive: true });
    handle.addEventListener('touchend', function (e) {
      var dy = e.changedTouches[0].clientY - handleStartY;
      if (dy < -30) sidebar.classList.add('adv-sidebar--sheet-open');
      else if (dy > 30) sidebar.classList.remove('adv-sidebar--sheet-open');
    }, { passive: true });
  }

  function updateBottomSheetMini() {
    var mini = UI.$('sidebarMini');
    if (!mini || !gameState) return;
    var hp = gameState.stats.hp;
    var maxHp = gameState.stats.maxHp;
    mini.innerHTML =
      '<span><i class="fas fa-heart"></i> ' + hp + '/' + maxHp + '</span>' +
      '<span><i class="fas fa-shoe-prints"></i> Turn ' + gameState.turnCount + '/' + gameState.maxTurns + '</span>' +
      '<span><i class="fas fa-coins"></i> ' + gameState.stats.gold + '</span>';
  }

  // --- Boot ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

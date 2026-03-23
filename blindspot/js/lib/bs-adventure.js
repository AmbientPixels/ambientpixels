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
  var _lastChoiceText = '';       // tracks what the player chose (for AI context)
  var _sceneHistory = [];         // brief log of scenes visited
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

  function hideChoices() {
    var el = $('bs-adventure-choices');
    if (el) el.classList.remove('bs-adventure__choices--revealed');
  }

  function revealChoices() {
    var el = $('bs-adventure-choices');
    if (el) {
      el.classList.add('bs-adventure__choices--revealed');
      scrollToChoices();
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
      var verb = val > 0 ? 'Gained' : 'Lost';
      parts.push('<span class="bs-adventure__buff-chip ' + cls + '">' + verb + ' ' + (val > 0 ? '+' : '') + val + ' ' + STAT_LABELS[stat] + '</span>');
    }
    toast.innerHTML = parts.join(' ');
    // Insert toast into the story body so it's visible in the scroll area
    var bodyEl = $('bs-adventure-body');
    (bodyEl || container).appendChild(toast);
    // Hold, then fade out smoothly before removing
    setTimeout(function () {
      toast.classList.add('bs-adventure__buff-toast--fading');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 600);
    }, BUFF_TOAST_DURATION);
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
    var bodyEl = $('bs-adventure-body');
    (bodyEl || container).appendChild(toast);
    if (window.ArenaAudio) window.ArenaAudio.play('loot');
    setTimeout(function () {
      toast.classList.add('bs-adventure__buff-toast--fading');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 600);
    }, BUFF_TOAST_DURATION);
  }

  // ============================================================
  // LOADING STATE — IMAGE PARTICLES + ROTATING ICONS
  // ============================================================

  var LOADING_ICONS = ['fa-eye', 'fa-scroll', 'fa-compass', 'fa-fire', 'fa-hat-wizard', 'fa-moon'];
  var _iconInterval = null;
  var _particleRaf = null;
  var _particles = [];

  function startImageLoading() {
    var loadingEl = $('bs-adventure-image-loading');
    if (!loadingEl) return;
    loadingEl.style.display = 'flex';

    // Build loading HTML: canvas for particles + icon + sublabel
    loadingEl.innerHTML = '<canvas class="bs-adventure__particle-canvas"></canvas>'
      + '<div class="bs-adventure__loading-icon"><i class="fas ' + LOADING_ICONS[0] + '"></i></div>'
      + '<span class="bs-adventure__loading-label">Scrying...</span>';

    // Rotating icons
    var iconEl = loadingEl.querySelector('.bs-adventure__loading-icon i');
    var idx = 0;
    _iconInterval = setInterval(function () {
      idx = (idx + 1) % LOADING_ICONS.length;
      if (iconEl) {
        iconEl.style.opacity = '0';
        setTimeout(function () {
          iconEl.className = 'fas ' + LOADING_ICONS[idx];
          iconEl.style.opacity = '1';
        }, 200);
      }
    }, 2000);

    // Particle system on canvas
    var canvas = loadingEl.querySelector('.bs-adventure__particle-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    function resize() {
      canvas.width = loadingEl.offsetWidth;
      canvas.height = loadingEl.offsetHeight;
    }
    resize();
    _particles = [];
    for (var i = 0; i < 30; i++) {
      _particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.2 - Math.random() * 0.5,
        r: 1 + Math.random() * 2,
        a: 0.3 + Math.random() * 0.5,
        life: Math.random()
      });
    }
    function animateParticles() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      _particles.forEach(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.003;
        if (p.life <= 0 || p.y < -5) {
          p.x = Math.random() * canvas.width;
          p.y = canvas.height + 5;
          p.life = 0.7 + Math.random() * 0.3;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 159, 39, ' + (p.a * p.life) + ')';
        ctx.fill();
      });
      _particleRaf = requestAnimationFrame(animateParticles);
    }
    animateParticles();
  }

  function stopImageLoading() {
    if (_iconInterval) { clearInterval(_iconInterval); _iconInterval = null; }
    if (_particleRaf) { cancelAnimationFrame(_particleRaf); _particleRaf = null; }
    _particles = [];
    var loadingEl = $('bs-adventure-image-loading');
    if (loadingEl) loadingEl.style.display = 'none';
  }

  // ============================================================
  // LOADING STATE — ROTATING TEXT PHRASES
  // ============================================================

  var LOADING_PHRASES = [
    'The shadows stir\u2026',
    'Fate is being written\u2026',
    'A whisper echoes through the dark\u2026',
    'The dungeon remembers\u2026',
    'Ancient forces converge\u2026',
    'The path reveals itself\u2026',
    'Embers flicker in the void\u2026',
    'Something watches from the dark\u2026'
  ];
  var _phraseInterval = null;

  function startTextLoading(textEl) {
    if (!textEl) return;
    var idx = Math.floor(Math.random() * LOADING_PHRASES.length);
    textEl.innerHTML = '<p class="bs-adventure__text-loading">'
      + '<span class="bs-adventure__text-loading-phrase">' + LOADING_PHRASES[idx] + '</span>'
      + '<span class="bs-adventure__cursor"></span>'
      + '</p>';

    _phraseInterval = setInterval(function () {
      idx = (idx + 1) % LOADING_PHRASES.length;
      var phraseEl = textEl.querySelector('.bs-adventure__text-loading-phrase');
      if (phraseEl) {
        phraseEl.style.opacity = '0';
        setTimeout(function () {
          if (phraseEl) {
            phraseEl.textContent = LOADING_PHRASES[idx];
            phraseEl.style.opacity = '1';
          }
        }, 300);
      }
    }, 3000);
  }

  function stopTextLoading() {
    if (_phraseInterval) { clearInterval(_phraseInterval); _phraseInterval = null; }
  }

  // ============================================================
  // SCENE IMAGE GENERATION
  // ============================================================

  function generateSceneImage(imagePrompt) {
    if (!imagePrompt || !window.CardForgeAI || !window.CardForgeAI.callGemini) return;
    var imgEl = $('bs-adventure-image');
    if (!imgEl) return;

    imgEl.style.display = 'none';
    startImageLoading();

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
      stopImageLoading();
    })
    .catch(function (err) {
      console.warn('[BsAdventure] Image generation failed:', err);
      stopImageLoading();
      imgEl.style.display = 'none';
    });
  }

  // ============================================================
  // AI SCENE TEXT GENERATION
  // ============================================================

  // ---- WORLD LORE + NARRATIVE BACKBONE ----
  var BLINDSPOT_LORE = [
    'WORLD: The Blindspot is an ancient arena between worlds — a pocket dimension built by The Architect as a proving ground.',
    'Warriors enter through a tear in reality they can\'t explain. They don\'t remember choosing to come. The arena chose them.',
    'The Blindspot feeds on conflict. Every fight makes it stronger. Corridors shift between visits. The walls remember. The air watches.',
    'No one has ever beaten all 10 bosses. The Architect designed it that way — or so the legends say.',
    '',
    'THE PLAYER\'S JOURNEY: You woke up here with nothing but a card — your identity, your weapon, your soul made physical.',
    'You don\'t know why the Blindspot chose you. But with each boss you defeat, fragments of the truth surface.',
    'The bosses aren\'t just guardians. They\'re pieces of something — or someone. Each one tests a different part of who you are.',
    'By the time you reach the Architect, you\'ll understand: the arena wasn\'t trying to stop you. It was building you.'
  ].join('\n');

  // ---- NARRATIVE ARC PER BOSS (story beats the AI must weave in) ----
  var STORY_BEATS = {
    'bs-boss-1': 'ACT 1 — THE THRESHOLD. The player just arrived. They don\'t know why they\'re here. The Gatekeeper doesn\'t explain — it just evaluates. The arena feels impersonal, mechanical. STORY BEAT: The player notices something strange — a mark on the wall, a symbol that matches something on their card. It means nothing yet. Plant the seed.',
    'bs-boss-2': 'ACT 1 — THE RULES. The Warden enforces the arena\'s laws. But some rules seem arbitrary, like they\'re protecting something deeper. STORY BEAT: The Warden says something cryptic: "You\'re not the first. You won\'t be the last. But you\'re the first who carries THAT mark." The player doesn\'t understand yet.',
    'bs-boss-3': 'ACT 1 — THE WARNING. The Ghost is made of every fighter who failed before you. It whispers fragments of their final thoughts. STORY BEAT: Among the whispers, the player hears a voice that sounds like their own — but from a future that hasn\'t happened. "Turn back." They can\'t.',
    'bs-boss-4': 'ACT 2 — THE PATTERN. The Cipher has been watching since Boss 1. It knows the player\'s patterns, their choices, their weaknesses. STORY BEAT: The Cipher reveals that every challenger\'s journey is recorded. The player sees data about previous challengers — all failed at different points. None made it past Boss 7. The Architect is paying attention now.',
    'bs-boss-5': 'ACT 2 — THE TEST OF WILL. The Brute doesn\'t care about strategy or secrets. It only respects survival. STORY BEAT: After the approach, the player finds a mural — ancient, crumbling — showing a figure that looks like the Architect, but younger. Fighting. In THIS arena. The Architect was once a challenger too.',
    'bs-boss-6': 'ACT 2 — THE REVELATION. The Sage knows the truth and doesn\'t hide it. STORY BEAT: The Sage tells the player directly: "The Architect built this arena to find a replacement. Every boss is a test of a quality he values. You\'re being shaped, not tested." The player must decide if this changes anything.',
    'bs-boss-7': 'ACT 3 — THE COMMITMENT. Beyond the Iron, there\'s no going back. The arena stops pretending to be fair. STORY BEAT: The Iron speaks for the first time in centuries: "The last three who reached me chose to leave. The arena let them forget. You won\'t have that choice." The corridors behind the player have disappeared.',
    'bs-boss-8': 'ACT 3 — THE DOUBT. The Trickster shows the player what they could become — and it\'s not flattering. STORY BEAT: The Trickster reveals that the Architect went mad building this place. The "successor" isn\'t a reward — it\'s a prison. The Architect wants to LEAVE and needs someone to take his place. Is winning actually losing?',
    'bs-boss-9': 'ACT 3 — THE COST. The Feral was once a challenger who won. It chose to stay. The arena consumed it. STORY BEAT: The player recognizes the Feral\'s card — it\'s ancient, cracked, but real. This was a person once. A champion. The arena didn\'t reward them — it hollowed them out. This is what happens if you stay too long.',
    'bs-boss-10': 'ACT 3 — THE CHOICE. The Architect is tired. Ancient. He built the Blindspot eons ago and has been trapped maintaining it ever since. STORY BEAT: The Architect doesn\'t want to fight — he wants to talk. He offers the truth: "Win, and you can take my place. The arena will be yours — infinite power, infinite isolation. Or walk away, and the Blindspot closes forever. No more challengers. No more proving. Just silence." The player fights regardless — the arena demands it. But the story hangs on what comes after.'
  };

  // ---- Boss personality + environment ----
  var BOSS_VOICE = {
    'bs-boss-1':  'The Gatekeeper is stoic and mechanical. Speaks in clipped, evaluative sentences. Environment: utilitarian training corridors, stone, function over form. It has no personality — it IS the test.',
    'bs-boss-2':  'The Warden is disciplined and cold, but hints at something beneath — a flicker of recognition. Environment: prison architecture, iron bars, rules carved in stone. Order imposed through structure.',
    'bs-boss-3':  'The Ghost speaks in overlapping whispers — fragments of other fighters\' last words. Eerie, fragmented, sad. Environment: shadowless corridors, shimmer, things that aren\'t quite there. Reality is thin.',
    'bs-boss-4':  'The Cipher is clinical, data-driven, almost amused by inefficiency. It speaks in analysis. Environment: server room aesthetics — cables, pulsing screens, holographic data. Information weaponized.',
    'bs-boss-5':  'The Brute doesn\'t speak in words — it communicates through violence and presence. Grunts, roars, the crack of stone. Environment: raw mountain, caves, bones. Primal and unrefined.',
    'bs-boss-6':  'The Sage is patient, knowing, slightly condescending. It speaks in truths that feel like traps. Environment: infinite library, floating books, ink that moves. Knowledge made physical.',
    'bs-boss-7':  'The Iron barely speaks. When it does, the words land like hammers. Absolute conviction. Environment: seamless metal fortress, forges, anvils. A monument to endurance.',
    'bs-boss-8':  'The Trickster is theatrical, mocking, unsettling. It tells uncomfortable truths disguised as jokes. Environment: carnival nightmare — shifting colors, mirrors, impossible geometry.',
    'bs-boss-9':  'The Feral doesn\'t speak. It snarls, breathes, stalks. But in rare moments of clarity, a human word escapes — a name, a plea. Environment: blood-marked hunting grounds, bones, primal heat.',
    'bs-boss-10': 'The Architect speaks softly, wearily, like someone who has had this conversation a thousand times. Not hostile — resigned. Environment: the Forge Eternal — white-hot creation light, floating unfinished cards, the hum of a universe being maintained.'
  };

  function generateSceneText(scene, adventure) {
    if (!window.CardForgeAI || !window.CardForgeAI.callGemini) {
      return Promise.resolve(null);
    }

    var bossVoice = BOSS_VOICE[adventure.bossId] || '';
    var choiceOptions = '';
    if (scene.choices) {
      choiceOptions = scene.choices.map(function (c) { return '- ' + c.text; }).join('\n');
    }

    var historyContext = '';
    if (_sceneHistory.length > 0) {
      historyContext = '\nSTORY SO FAR:\n' + _sceneHistory.map(function (h) {
        return '- Scene ' + h.scene + ': ' + h.summary + (h.choice ? ' \u2192 Player chose: ' + h.choice : '');
      }).join('\n') + '\n';
    }

    var ascensionContext = '';
    if (_ascensionLevel >= 1) {
      ascensionContext = '\nASCENSION ' + _ascensionLevel + ': The player has beaten this boss before and chose to return. ' +
        'The Blindspot remembers them. The boss recognizes them. The arena has evolved — corridors shift, traps are different, ' +
        'the boss is smarter. Write as if the arena is testing whether the player has truly grown.\n';
    }

    var prompt = [
      BLINDSPOT_LORE,
      '',
      'BOSS PERSONALITY: ' + bossVoice,
      '',
      'NARRATIVE THREAD FOR THIS BOSS:',
      STORY_BEATS[adventure.bossId] || '',
      '',
      'You are narrating a scene in the Blindspot arena. Write exactly 2 SHORT paragraphs (50-80 words total). Be punchy and concise.',
      'CRITICAL: Weave the NARRATIVE THREAD into the scene naturally. The story beat should surface through environment details, boss dialogue, or things the player notices — not through exposition.',
      '',
      'ADVENTURE: "' + adventure.title + '"',
      'BOSS: ' + (_bossesById_name || adventure.bossId),
      'SCENE: ' + (_sceneIndex + 1) + ' of ' + _sceneCount + (scene.isFinal ? ' (FINAL \u2014 the moment before the boss fight)' : ''),
      '',
      'SCENE GUIDE (atmosphere and setting reference):',
      scene.text,
      '',
      'PLAYER: ' + (_playerClass || 'unknown') + ' class',
      'STATS: STR ' + (_playerStats.str || 0) + ' AGI ' + (_playerStats.agi || 0) + ' INT ' + (_playerStats.int || 0) + ' END ' + (_playerStats.end || 0) + ' LCK ' + (_playerStats.lck || 0),
      _lastChoiceText ? 'LAST CHOICE: "' + _lastChoiceText + '"' : '',
      historyContext,
      ascensionContext,
      scene.isFinal ? 'FINAL SCENE: The boss is present. Include the story beat revelation. End with tension and the boss\'s voice.' : '',
      choiceOptions ? 'The player will choose from these options next:\n' + choiceOptions : '',
      '',
      'Return ONLY valid JSON (no markdown, no code fences):',
      '{"sceneText":"Your narrative here. Use \\n\\n between paragraphs.","imagePrompt":"A 1-2 sentence visual description for AI image generation. Dark fantasy style. Describe the specific scene, environment, lighting, mood. Max 150 chars."}'
    ].filter(Boolean).join('\n');

    return window.CardForgeAI.callGemini(prompt, {
      model: window.CardForgeAI.TEXT_MODEL,
      skipUsageIncrement: true
    })
    .then(function (data) {
      var raw = window.CardForgeAI.extractText(data);
      if (!raw || raw.trim().length < 20) return null;

      // Try parsing as JSON first (preferred)
      try {
        var cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        var parsed = JSON.parse(cleaned);
        if (parsed.sceneText && parsed.sceneText.length > 20) {
          return { text: parsed.sceneText.trim(), imagePrompt: parsed.imagePrompt || null };
        }
      } catch (e) { /* not JSON, treat as plain text */ }

      // Fallback: treat entire response as plain text
      var text = raw.trim().replace(/^```[\s\S]*?```$/gm, '').trim();
      text = text.replace(/^\*\*.*?\*\*\s*/gm, '');
      text = text.replace(/^#+\s*/gm, '');
      if (text.length > 20) return { text: text, imagePrompt: null };
      return null;
    })
    .catch(function (err) {
      console.warn('[BsAdventure] AI text generation failed, using fallback:', err);
      return null;
    });
  }

  // Cached boss name (set during launch)
  var _bossesById_name = '';

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
      var rollModifier = '';
      if (choice.skillCheck) {
        var adjustedDC = computeAdaptiveDC(choice.skillCheck.dc);
        var label = STAT_LABELS[choice.skillCheck.stat] + ' DC' + adjustedDC;
        dcBadge = '<span class="bs-adventure__choice-dc"><i class="fas fa-dice-d20"></i> ' + label + '</span>';
        rollModifier = ' bs-adventure__choice--roll';
      }
      var classModifier = choice.classRequired ? ' bs-adventure__choice--class' : '';
      var classBadge = choice.classRequired ? '<span class="bs-adventure__choice-class-badge"><i class="fas fa-star"></i></span>' : '';
      var itemBadge = '';
      var itemSrc = choice.item || (choice.success && choice.success.item) || null;
      if (itemSrc && ADVENTURE_ITEMS[itemSrc]) {
        itemBadge = '<span class="bs-adventure__choice-item-hint"><i class="fas ' + ADVENTURE_ITEMS[itemSrc].icon + '"></i></span>';
      }

      return '<button class="bs-adventure__choice' + classModifier + rollModifier + '" data-choice-id="' + escHtml(choice.id) + '" data-index="' + i + '">' +
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
    _lastChoiceText = choice.text || '';

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

    // Reset image + stop any previous loading animations
    var imgEl = $('bs-adventure-image');
    if (imgEl) { imgEl.style.display = 'none'; imgEl.src = ''; }
    stopImageLoading();
    stopTextLoading();

    // Clear choices and hide until typewriter finishes
    var choicesEl = $('bs-adventure-choices');
    if (choicesEl) choicesEl.innerHTML = '';
    hideChoices();

    // Hide footer
    var footerEl = $('bs-adventure-footer');
    if (footerEl) footerEl.style.display = 'none';

    // Scene music
    if (scene.music) playSceneMusic(scene.music);

    // Scene image — start particle + icon loading state
    startImageLoading();

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

    // Scene text — try AI generation first, fall back to static JSON text
    var textEl = $('bs-adventure-text');
    if (textEl) {
      textEl.classList.remove('bs-adventure__text--entering');
      void textEl.offsetWidth;
      textEl.classList.add('bs-adventure__text--entering');

      // Show rotating atmospheric phrases while AI generates
      startTextLoading(textEl);

      var fallbackText = getSceneText(scene);

      generateSceneText(scene, adventure).then(function (aiResult) {
        stopTextLoading();
        var sceneText = (aiResult && aiResult.text) ? aiResult.text : fallbackText;

        // Generate image from AI prompt, or fall back to static JSON prompt
        var imgPrompt = (aiResult && aiResult.imagePrompt) ? aiResult.imagePrompt : scene.imagePrompt;
        if (imgPrompt) generateSceneImage(imgPrompt);

        // Track for AI context
        _sceneHistory.push({
          scene: _sceneIndex,
          summary: sceneText.substring(0, 120),
          choice: _lastChoiceText || null
        });

        if (scene.isFinal) {
          typewriter(textEl, sceneText).then(function () { renderSummary(container); revealChoices(); });
        } else {
          typewriter(textEl, sceneText).then(function () {
            renderChoices(scene.choices, container, playerStats);
            revealChoices();
          });
        }
      });
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
    stopImageLoading();
    stopTextLoading();

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
      _lastChoiceText = '';
      _sceneHistory = [];
      _playerStats = playerStats;
      _playerClass = (options.playerClass || '').toLowerCase();
      _bossWeakness = options.bossWeakness || null;
      _ascensionLevel = options.ascension || 0;
      _bossesById_name = options.bossName || '';
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

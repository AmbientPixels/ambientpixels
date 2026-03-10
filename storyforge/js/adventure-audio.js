/**
 * adventure-audio.js — MP3 ambient music & SFX for StoryForge
 * Plays genre-specific ambient loops and short sound effects from audio files.
 *
 * API:
 *   StoryAudio.init(audioCtx)              — share the engine's AudioContext
 *   StoryAudio.startAmbient(genreId)        — begin genre-adaptive ambient music
 *   StoryAudio.stopAmbient([fadeMs])         — fade out and stop ambient
 *   StoryAudio.setAmbientVolume(0-1)         — set ambient volume
 *   StoryAudio.duckForNarration(duck)        — lower ambient during TTS
 *   StoryAudio.sfx(name)                     — play a sound effect
 *   StoryAudio.isAmbientPlaying()            — boolean
 *   StoryAudio.setEnabled(bool)              — master toggle
 *   StoryAudio.setSfxVolume(0-1)             — set SFX volume
 *   StoryAudio.preloadGenre(genreId)         — preload ambient loop for a genre
 *
 * File structure:
 *   audio/ambient/{genre}-{n}.mp3   (e.g. fantasy-1.mp3, horror-2.mp3)
 *   audio/sfx/{name}.mp3            (e.g. dice-roll.mp3, level-up.mp3)
 */
var StoryAudio = (function () {
  'use strict';

  var AUDIO_BASE = 'audio/';

  var ctx = null;
  var masterGain = null;
  var ambientGain = null;
  var sfxGain = null;
  var enabled = localStorage.getItem('sf_audio') !== 'off';
  var ambientVolume = parseFloat(localStorage.getItem('sf_ambient_vol')) || 0.35;
  var sfxVolume = parseFloat(localStorage.getItem('sf_sfx_vol')) || 0.5;

  // Current ambient state
  var currentAmbient = null; // { source, buffer, genre, fadeTimer }

  // Caches
  var ambientBufferCache = {}; // genreId -> AudioBuffer
  var sfxBufferCache = {};     // sfxName -> AudioBuffer

  /* ══════════════════════════════════════════════════════════════════
     GENRE LOOP MANIFEST — files per genre (randomly selected)
     ══════════════════════════════════════════════════════════════════ */
  var GENRE_LOOPS = {
    fantasy:   ['fantasy-1.mp3', 'fantasy-2.mp3', 'fantasy-3.mp3', 'fantasy-4.mp3'],
    horror:    ['horror-1.mp3', 'horror-2.mp3', 'horror-3.mp3'],
    scifi:     ['scifi-1.mp3', 'scifi-2.mp3', 'scifi-3.mp3', 'scifi-4.mp3'],
    detective: ['detective-1.mp3', 'detective-2.mp3', 'detective-3.mp3'],
    postapoc:  ['postapoc-1.mp3', 'postapoc-2.mp3', 'postapoc-3.mp3', 'postapoc-4.mp3'],
    pirate:    ['pirate-1.mp3', 'pirate-2.mp3', 'pirate-3.mp3', 'pirate-4.mp3', 'pirate-5.mp3'],
    superhero: ['superhero-1.mp3', 'superhero-2.mp3', 'superhero-3.mp3', 'superhero-4.mp3', 'superhero-5.mp3']
  };

  /* ══════════════════════════════════════════════════════════════════
     SFX MANIFEST — maps engine SFX names to MP3 filenames
     ══════════════════════════════════════════════════════════════════ */
  var SFX_FILES = {
    // UI
    choiceHover:     'choice-hover.mp3',
    choiceSelect:    'choice-select.mp3',
    // Dice
    diceRoll:        'dice-roll.mp3',
    diceSuccess:     'dice-success.mp3',
    diceFail:        'dice-fail.mp3',
    diceCritical:    'dice-critical.mp3',
    // Game events
    damage:          'damage.mp3',
    heal:            'heal.mp3',
    itemPickup:      'item-pickup.mp3',
    itemDrop:        'item-drop.mp3',
    companionJoin:   'companion-join.mp3',
    levelUp:         'level-up.mp3',
    // Transitions
    sceneTransition: 'scene-transition.mp3',
    endingVictory:   'ending-victory.mp3',
    endingDeath:     'ending-death.mp3',
    endingEscape:    'ending-escape.mp3'
  };

  /* ══════════════════════════════════════════════════════════════════
     FETCH + DECODE HELPER
     ══════════════════════════════════════════════════════════════════ */
  function loadAudioBuffer(url) {
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Audio fetch failed: ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (arrayBuf) {
        return ctx.decodeAudioData(arrayBuf);
      });
  }

  /* ══════════════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════════════ */
  function init(audioContext) {
    ctx = audioContext;
    masterGain = ctx.createGain();
    masterGain.gain.value = enabled ? 1 : 0;
    masterGain.connect(ctx.destination);

    ambientGain = ctx.createGain();
    ambientGain.gain.value = ambientVolume;
    ambientGain.connect(masterGain);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = sfxVolume;
    sfxGain.connect(masterGain);

    // Preload all SFX (small files, ~10-30KB each)
    Object.keys(SFX_FILES).forEach(function (name) {
      var url = AUDIO_BASE + 'sfx/' + SFX_FILES[name];
      loadAudioBuffer(url)
        .then(function (buffer) { sfxBufferCache[name] = buffer; })
        .catch(function () { /* SFX file missing — sfx() will silently skip */ });
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     PRELOAD — load a genre's ambient loop ahead of time
     Call during character wizard so loop is ready by turn 1.
     ══════════════════════════════════════════════════════════════════ */
  function preloadGenre(genreId) {
    if (!ctx) return Promise.resolve(null);
    if (ambientBufferCache[genreId]) return Promise.resolve(ambientBufferCache[genreId]);

    var loops = GENRE_LOOPS[genreId] || GENRE_LOOPS.fantasy;
    var file = loops[Math.floor(Math.random() * loops.length)];
    var url = AUDIO_BASE + 'ambient/' + file;

    return loadAudioBuffer(url)
      .then(function (buffer) {
        ambientBufferCache[genreId] = buffer;
        return buffer;
      })
      .catch(function (err) {
        console.warn('Ambient preload failed for ' + genreId + ':', err.message);
        return null;
      });
  }

  /* ══════════════════════════════════════════════════════════════════
     AMBIENT MUSIC ENGINE
     ══════════════════════════════════════════════════════════════════ */
  function startAmbient(genreId) {
    if (!ctx || !enabled) return;

    // If same genre is already playing, don't restart
    if (currentAmbient && currentAmbient.genre === genreId) return;

    // If switching genres, crossfade
    var hadPrevious = currentAmbient !== null;
    if (hadPrevious) {
      // Fade out old ambient over 2 seconds
      fadeOutCurrent(2000);
    } else {
      stopAmbient(0);
    }

    var doStart = function (buffer) {
      if (!buffer || !ctx) return;

      var source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      // If crossfading from previous, use a dedicated gain for fade-in
      var sourceGain = ctx.createGain();
      sourceGain.gain.value = hadPrevious ? 0 : 1;
      source.connect(sourceGain);
      sourceGain.connect(ambientGain);
      source.start(0);

      if (hadPrevious) {
        // Fade in over 2 seconds
        sourceGain.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
      }

      currentAmbient = {
        source: source,
        sourceGain: sourceGain,
        genre: genreId,
        fadeTimer: null
      };
    };

    // Use cached buffer or load fresh
    if (ambientBufferCache[genreId]) {
      doStart(ambientBufferCache[genreId]);
    } else {
      preloadGenre(genreId).then(doStart);
    }
  }

  // Fade out the current ambient without clearing currentAmbient reference
  // (used for crossfade transitions)
  function fadeOutCurrent(fadeMs) {
    if (!currentAmbient) return;
    var old = currentAmbient;
    currentAmbient = null;

    var fadeSec = fadeMs / 1000;
    if (old.sourceGain && ctx) {
      old.sourceGain.gain.setTargetAtTime(0, ctx.currentTime, fadeSec / 3);
    }
    setTimeout(function () {
      try {
        old.source.stop();
        old.source.disconnect();
        old.sourceGain.disconnect();
      } catch (e) {}
    }, fadeMs + 100);
  }

  function stopAmbient(fadeMs) {
    if (!currentAmbient) return;
    var fade = (fadeMs !== undefined) ? fadeMs : 2000;

    if (currentAmbient.fadeTimer) {
      clearTimeout(currentAmbient.fadeTimer);
    }

    var amb = currentAmbient;
    currentAmbient = null;

    if (fade <= 0 || !ctx) {
      // Immediate stop
      try {
        amb.source.stop();
        amb.source.disconnect();
        amb.sourceGain.disconnect();
      } catch (e) {}
      return;
    }

    // Fade out via the source gain node
    var now = ctx.currentTime;
    var fadeSec = fade / 1000;
    amb.sourceGain.gain.setValueAtTime(amb.sourceGain.gain.value, now);
    amb.sourceGain.gain.linearRampToValueAtTime(0, now + fadeSec);

    setTimeout(function () {
      try {
        amb.source.stop();
        amb.source.disconnect();
        amb.sourceGain.disconnect();
      } catch (e) {}
    }, fade + 100);
  }

  /* ══════════════════════════════════════════════════════════════════
     SFX ENGINE
     ══════════════════════════════════════════════════════════════════ */
  function sfx(name) {
    if (!ctx || !enabled) return;
    var buffer = sfxBufferCache[name];
    if (!buffer) return; // Not loaded yet or file missing

    var source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(sfxGain);
    source.start(0);
  }

  /* ══════════════════════════════════════════════════════════════════
     DUCKING — lower ambient during TTS narration
     ══════════════════════════════════════════════════════════════════ */
  function duckForNarration(duck) {
    if (!ambientGain || !ctx) return;
    var now = ctx.currentTime;
    var target = duck ? ambientVolume * 0.2 : ambientVolume;
    ambientGain.gain.setTargetAtTime(target, now, 0.5);
  }

  /* ══════════════════════════════════════════════════════════════════
     CONTROLS
     ══════════════════════════════════════════════════════════════════ */
  function setAmbientVolume(val) {
    ambientVolume = Math.max(0, Math.min(1, val));
    localStorage.setItem('sf_ambient_vol', ambientVolume);
    if (ambientGain && ctx) ambientGain.gain.setTargetAtTime(ambientVolume, ctx.currentTime, 0.1);
  }

  function setSfxVolume(val) {
    sfxVolume = Math.max(0, Math.min(1, val));
    localStorage.setItem('sf_sfx_vol', sfxVolume);
    if (sfxGain && ctx) sfxGain.gain.setTargetAtTime(sfxVolume, ctx.currentTime, 0.1);
  }

  function setEnabled(val) {
    enabled = !!val;
    localStorage.setItem('sf_audio', enabled ? 'on' : 'off');
    if (masterGain && ctx) masterGain.gain.setTargetAtTime(enabled ? 1 : 0, ctx.currentTime, 0.1);
    if (!enabled) stopAmbient(0);
  }

  function isAmbientPlaying() {
    return currentAmbient !== null;
  }

  /* ══════════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════════ */
  return {
    init: init,
    startAmbient: startAmbient,
    stopAmbient: stopAmbient,
    setAmbientVolume: setAmbientVolume,
    setSfxVolume: setSfxVolume,
    duckForNarration: duckForNarration,
    sfx: sfx,
    isAmbientPlaying: isAmbientPlaying,
    setEnabled: setEnabled,
    preloadGenre: preloadGenre,
    get enabled() { return enabled; },
    get ambientVolume() { return ambientVolume; },
    get sfxVolume() { return sfxVolume; }
  };
})();

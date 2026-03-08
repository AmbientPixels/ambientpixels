/**
 * Arena Audio — sound effects for battle events
 * Mute state persisted to localStorage. Respects prefers-reduced-motion.
 */
window.ArenaAudio = (function () {
  'use strict';

  var STORAGE_KEY = 'arena_audio_muted';
  var BASE_PATH = '/cardforge/audio/';

  // Sound definitions — keys match battle events
  var SOUNDS = {
    strike:    'strike.wav',
    guard:     'guard.wav',
    ability:   'ability.mp3',
    heal:      'heal.wav',
    crit:      'crit.mp3',
    victory:   'victory.mp3',
    defeat:    'defeat.wav',
    click:     'click.wav',
    hit:       'hit.wav',
    charge:    'charge.wav'
  };

  // A4: looping battle music tracks (files optional — degrade silently if missing)
  var MUSIC_TRACKS = {
    arenaMenu:    'arena-menu.wav',
    battleMid:    'battle-mid.wav',
    battleHigh:   'battle-intense.wav',
    battleLowHp:  'battle-low.wav'
  };

  var _muted = false;
  var _volume = 0.5;
  var _cache = {};
  var _musicCache = {};
  var _currentMusicKey = null;
  var _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Check reduced motion preference
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      _muted = true;
    }

    // Load saved mute state
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      _muted = saved === 'true';
    }

    // Preload all SFX
    for (var key in SOUNDS) {
      if (SOUNDS.hasOwnProperty(key)) {
        var audio = new Audio();
        audio.preload = 'auto';
        audio.src = BASE_PATH + SOUNDS[key];
        audio.volume = _volume;
        _cache[key] = audio;
      }
    }

    // Pre-create music players (loop-capable, not cloned on play)
    for (var mkey in MUSIC_TRACKS) {
      if (MUSIC_TRACKS.hasOwnProperty(mkey)) {
        var music = new Audio();
        music.loop = true;
        music.preload = 'none'; // lazy — only load when needed
        music.src = BASE_PATH + MUSIC_TRACKS[mkey];
        music.volume = 0;
        _musicCache[mkey] = music;
      }
    }

    updateToggleIcon();
  }

  // A4: start a looping music track, crossfade from previous
  function playMusic(key) {
    if (_muted || !_musicCache[key]) return;
    if (_currentMusicKey === key) return; // already playing

    // Fade out previous
    if (_currentMusicKey && _musicCache[_currentMusicKey]) {
      var prev = _musicCache[_currentMusicKey];
      _fadeOut(prev, 800, function () { prev.pause(); prev.currentTime = 0; });
    }

    _currentMusicKey = key;
    var track = _musicCache[key];
    track.currentTime = 0;
    track.volume = 0;
    track.play().catch(function () {}); // ignore autoplay policy
    _fadeIn(track, _volume * 0.45, 1200); // music at ~45% of SFX volume
  }

  function stopMusic() {
    if (!_currentMusicKey) return;
    var track = _musicCache[_currentMusicKey];
    if (track) {
      _fadeOut(track, 600, function () { track.pause(); track.currentTime = 0; });
    }
    _currentMusicKey = null;
  }

  function _fadeIn(audioEl, targetVol, durationMs) {
    var steps = 20;
    var stepTime = durationMs / steps;
    var stepVol = targetVol / steps;
    var current = 0;
    var interval = setInterval(function () {
      current++;
      audioEl.volume = Math.min(targetVol, current * stepVol);
      if (current >= steps) clearInterval(interval);
    }, stepTime);
  }

  function _fadeOut(audioEl, durationMs, onDone) {
    var startVol = audioEl.volume;
    var steps = 20;
    var stepTime = durationMs / steps;
    var stepVol = startVol / steps;
    var current = 0;
    var interval = setInterval(function () {
      current++;
      audioEl.volume = Math.max(0, startVol - current * stepVol);
      if (current >= steps) {
        clearInterval(interval);
        if (onDone) onDone();
      }
    }, stepTime);
  }

  // A4: called after each round to escalate music with battle intensity
  function checkMusicEscalation(round, playerHp, playerMax, opHp, opMax) {
    var minHpPct = Math.min(playerHp / playerMax, opHp / opMax) * 100;

    // Low HP overrides round-based escalation (most dramatic)
    if (minHpPct <= 25) {
      playMusic('battleLowHp');
      return;
    }
    if (round >= 9) {
      playMusic('battleHigh');
      return;
    }
    if (round >= 5) {
      playMusic('battleMid');
    }
  }

  function play(key) {
    if (_muted || !_cache[key]) return;

    // Clone so overlapping sounds work
    var sound = _cache[key].cloneNode();
    sound.volume = _volume;
    sound.play().catch(function () {
      // Browser autoplay policy — silently ignore
    });
  }

  function isMuted() {
    return _muted;
  }

  function toggleMute() {
    _muted = !_muted;
    localStorage.setItem(STORAGE_KEY, _muted);
    updateToggleIcon();
    // Play a click to confirm unmute
    if (!_muted) play('click');
  }

  function setVolume(val) {
    _volume = Math.max(0, Math.min(1, val));
    for (var key in _cache) {
      if (_cache.hasOwnProperty(key)) {
        _cache[key].volume = _volume;
      }
    }
  }

  function updateToggleIcon() {
    var btn = document.getElementById('arena-audio-toggle');
    if (!btn) return;
    var icon = btn.querySelector('i');
    if (icon) {
      icon.className = _muted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
    }
    btn.title = _muted ? 'Unmute sounds' : 'Mute sounds';
  }

  return {
    init: init,
    play: play,
    isMuted: isMuted,
    toggleMute: toggleMute,
    setVolume: setVolume,
    playMusic: playMusic,
    stopMusic: stopMusic,
    checkMusicEscalation: checkMusicEscalation
  };
})();

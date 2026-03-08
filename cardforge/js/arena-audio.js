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

  var _muted = false;
  var _volume = 0.5;
  var _cache = {};
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

    // Preload all sounds
    for (var key in SOUNDS) {
      if (SOUNDS.hasOwnProperty(key)) {
        var audio = new Audio();
        audio.preload = 'auto';
        audio.src = BASE_PATH + SOUNDS[key];
        audio.volume = _volume;
        _cache[key] = audio;
      }
    }

    updateToggleIcon();
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
    setVolume: setVolume
  };
})();

/**
 * Arena Audio — split SFX and music controls
 * SFX: mute toggle only. Music: mute toggle + volume slider.
 * All state persisted to localStorage. Respects prefers-reduced-motion.
 */
window.ArenaAudio = (function () {
  'use strict';

  var KEY_SFX_MUTED    = 'arena_sfx_muted';
  var KEY_MUSIC_MUTED  = 'arena_music_muted';
  var KEY_MUSIC_VOL    = 'arena_music_volume';
  var BASE_PATH        = '/cardforge/audio/';

  // Sound definitions — keys match battle events
  var SOUNDS = {
    strike:     'strike.wav',
    guard:      'guard.wav',
    ability:    'ability.mp3',
    heal:       'heal.wav',
    crit:       'crit.mp3',
    victory:    'victory.mp3',
    defeat:     'defeat.wav',
    click:      'click.wav',
    hit:        'hit.wav',
    charge:     'charge.wav',
    crowd:      'crowd.mp3',
    last_stand: 'last-stand.mp3',
    killshot:   'killshot.mp3'
  };

  // One track per arena + menu. Add new arenas here as they're created.
  // Files degrade silently if missing.
  var MUSIC_TRACKS = {
    menu:              'arena-menu01.wav',
    'colosseum':       'arena-colosseum.mp3',
    'shadow-pit':      'arena-shadow-pit.mp3',
    'forge-grounds':   'arena-forge-grounds.mp3',
    'crystal-sanctum': 'arena-crystal-sanctum.mp3',
    'void-rift':       'arena-void-rift.mp3',
    'throne':          'arena-throne.mp3'
  };

  var _sfxMuted       = false;
  var _musicMuted     = false;
  var _sfxVolume      = 0.5;
  var _musicVolume    = 0.5;
  var _cache          = {};
  var _musicCache     = {};
  var _currentMusicKey = null;
  var _initialized    = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Respect reduced motion
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      _sfxMuted = true;
      _musicMuted = true;
    }

    // Load saved states
    var savedSfx   = localStorage.getItem(KEY_SFX_MUTED);
    var savedMusic = localStorage.getItem(KEY_MUSIC_MUTED);
    var savedVol   = localStorage.getItem(KEY_MUSIC_VOL);
    if (savedSfx   !== null) _sfxMuted   = savedSfx   === 'true';
    if (savedMusic !== null) _musicMuted = savedMusic  === 'true';
    if (savedVol   !== null) _musicVolume = Math.max(0, Math.min(1, parseFloat(savedVol) || 0.5));

    // Preload SFX
    for (var key in SOUNDS) {
      if (SOUNDS.hasOwnProperty(key)) {
        var audio = new Audio();
        audio.preload = 'auto';
        audio.src = BASE_PATH + SOUNDS[key];
        audio.volume = _sfxVolume;
        _cache[key] = audio;
      }
    }

    // Pre-create music players (lazy load)
    for (var mkey in MUSIC_TRACKS) {
      if (MUSIC_TRACKS.hasOwnProperty(mkey)) {
        var music = new Audio();
        music.loop = true;
        music.preload = 'none';
        music.src = BASE_PATH + MUSIC_TRACKS[mkey];
        music.volume = 0;
        _musicCache[mkey] = music;
      }
    }

    // Bind SFX toggle
    var sfxBtn = document.getElementById('arena-sfx-toggle');
    if (sfxBtn) sfxBtn.addEventListener('click', toggleSfx);

    // Bind music toggle
    var musicBtn = document.getElementById('arena-music-toggle');
    if (musicBtn) musicBtn.addEventListener('click', toggleMusic);

    // Bind volume slider
    var volSlider = document.getElementById('arena-music-volume');
    if (volSlider) {
      volSlider.value = Math.round(_musicVolume * 100);
      volSlider.addEventListener('input', function () {
        setMusicVolume(parseInt(this.value, 10) / 100);
      });
    }

    updateSfxIcon();
    updateMusicIcon();
  }

  // ── Music ────────────────────────────────────────────────────────────────

  function playMusic(key) {
    if (_musicMuted || !_musicCache[key]) return;
    if (_currentMusicKey === key) return;

    if (_currentMusicKey && _musicCache[_currentMusicKey]) {
      var prev = _musicCache[_currentMusicKey];
      _fadeOut(prev, 800, function () { prev.pause(); prev.currentTime = 0; });
    }

    _currentMusicKey = key;
    var track = _musicCache[key];
    track.currentTime = 0;
    track.volume = 0;
    track.play().catch(function () {});
    _fadeIn(track, _musicVolume * 0.45, 1200);
  }

  function stopMusic() {
    if (!_currentMusicKey) return;
    var track = _musicCache[_currentMusicKey];
    if (track) {
      _fadeOut(track, 600, function () { track.pause(); track.currentTime = 0; });
    }
    _currentMusicKey = null;
  }

  function playArenaMusic(arenaId) {
    var key = arenaId && MUSIC_TRACKS[arenaId] ? arenaId : 'menu';
    playMusic(key);
  }

  function toggleMusic() {
    _musicMuted = !_musicMuted;
    localStorage.setItem(KEY_MUSIC_MUTED, _musicMuted);
    if (_musicMuted) {
      // Fade out current track without clearing key — resumes on unmute
      if (_currentMusicKey && _musicCache[_currentMusicKey]) {
        _fadeOut(_musicCache[_currentMusicKey], 500, function () {
          _musicCache[_currentMusicKey] && (_musicCache[_currentMusicKey].pause());
        });
      }
    } else {
      // Resume current track
      if (_currentMusicKey && _musicCache[_currentMusicKey]) {
        var track = _musicCache[_currentMusicKey];
        track.play().catch(function () {});
        _fadeIn(track, _musicVolume * 0.45, 800);
      }
    }
    updateMusicIcon();
  }

  function setMusicVolume(val) {
    _musicVolume = Math.max(0, Math.min(1, val));
    localStorage.setItem(KEY_MUSIC_VOL, _musicVolume);
    if (_currentMusicKey && _musicCache[_currentMusicKey] && !_musicMuted) {
      _musicCache[_currentMusicKey].volume = _musicVolume * 0.45;
    }
  }

  // ── SFX ─────────────────────────────────────────────────────────────────

  function play(key) {
    if (_sfxMuted || !_cache[key]) return;
    var sound = _cache[key].cloneNode();
    sound.volume = _sfxVolume;
    sound.play().catch(function () {});
  }

  function toggleSfx() {
    _sfxMuted = !_sfxMuted;
    localStorage.setItem(KEY_SFX_MUTED, _sfxMuted);
    updateSfxIcon();
    if (!_sfxMuted) play('click');
  }

  // ── Icons ────────────────────────────────────────────────────────────────

  function updateSfxIcon() {
    var btn = document.getElementById('arena-sfx-toggle');
    if (!btn) return;
    var icon = btn.querySelector('i');
    if (icon) icon.className = _sfxMuted ? 'fas fa-bolt-slash' : 'fas fa-bolt';
    btn.title = _sfxMuted ? 'Unmute SFX' : 'Mute SFX';
    btn.classList.toggle('arena-audio-toggle--muted', _sfxMuted);
  }

  function updateMusicIcon() {
    var btn = document.getElementById('arena-music-toggle');
    if (!btn) return;
    var icon = btn.querySelector('i');
    // fa-music-slash doesn't exist in FA Free — use volume icons instead
    if (icon) icon.className = _musicMuted ? 'fas fa-volume-xmark' : 'fas fa-music';
    btn.title = _musicMuted ? 'Unmute music' : 'Mute music';
    // Toggle muted state on the parent control, not the button, to avoid opacity hiding the button
    var control = document.getElementById('arena-music-control');
    if (control) control.classList.toggle('arena-music-control--muted', _musicMuted);
    var slider = document.getElementById('arena-music-volume');
    if (slider) slider.disabled = _musicMuted;
  }

  // ── Fade helpers ─────────────────────────────────────────────────────────

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

  // ── Legacy compat ────────────────────────────────────────────────────────
  // isMuted / toggleMute kept so any external callers don't break
  function isMuted()    { return _sfxMuted; }
  function toggleMute() { toggleSfx(); }
  function setVolume(val) { _sfxVolume = Math.max(0, Math.min(1, val)); }

  return {
    init,
    play,
    isMuted,
    toggleMute,
    toggleSfx,
    toggleMusic,
    setVolume,
    setMusicVolume,
    playMusic,
    playArenaMusic,
    stopMusic
  };
})();

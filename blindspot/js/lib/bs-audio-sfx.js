/**
 * Blindspot SFX & Battle Ambient Audio
 *
 * Web Audio API synthesized sound effects — no audio files needed.
 * Respects ArenaAudio mute toggle.
 *
 * API: window.BsSfx.play(name), window.BsSfx.startAmbient(), window.BsSfx.stopAmbient()
 */
window.BsSfx = (function () {
  'use strict';

  var _audioCtx = null;
  var _ambientNodes = null;

  function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  }

  // ============================================================
  // SFX DEFINITIONS — each creates oscillator nodes and schedules them
  // ============================================================

  var SFX_DEFS = {
    // Loot drop: bright sparkle arpeggio (3 rising notes)
    loot: function (ctx) {
      var t = ctx.currentTime;
      [523, 659, 784].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, t + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.08);
        osc.stop(t + i * 0.08 + 0.3);
      });
    },

    // Boss defeat: triumphant fanfare (power chord + octave rise)
    bossDefeat: function (ctx) {
      var t = ctx.currentTime;
      [[262, 0], [330, 0.05], [392, 0.1], [523, 0.2]].forEach(function (pair) {
        var freq = pair[0], delay = pair[1];
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + delay);
        osc.stop(t + delay + 0.55);
      });
    },

    // Ascension: ethereal rising sweep with shimmer
    ascension: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.6);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.setValueAtTime(0.2, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.85);
      // Shimmer overtone
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(660, t + 0.2);
      osc2.frequency.exponentialRampToValueAtTime(1760, t + 0.7);
      gain2.gain.setValueAtTime(0.08, t + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(t + 0.2);
      osc2.stop(t + 0.95);
    },

    // Forge complete: anvil hit (short noise burst + metallic ring)
    forgeComplete: function (ctx) {
      var t = ctx.currentTime;
      var bufferSize = ctx.sampleRate * 0.05;
      var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
      var noise = ctx.createBufferSource();
      noise.buffer = buffer;
      var nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.25, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      noise.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(t);
      noise.stop(t + 0.1);
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1047;
      gain.gain.setValueAtTime(0.1, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + 0.02);
      osc.stop(t + 0.45);
    },

    // Battle win: short victory jingle
    battleWin: function (ctx) {
      var t = ctx.currentTime;
      [392, 494, 587, 784].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, t + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.1);
        osc.stop(t + i * 0.1 + 0.35);
      });
    },

    // Battle loss: descending minor notes
    battleLoss: function (ctx) {
      var t = ctx.currentTime;
      [392, 349, 311, 262].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, t + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.15);
        osc.stop(t + i * 0.15 + 0.4);
      });
    },

    // Combat move SFX
    strikeHit: function (ctx) {
      var t = ctx.currentTime;
      var bufSize = Math.floor(ctx.sampleRate * 0.06);
      var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var g = ctx.createGain(); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
      src.connect(lp); lp.connect(g); g.connect(ctx.destination);
      src.start(t); src.stop(t + 0.15);
    },
    guardBlock: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = 300;
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.18);
    },
    abilityZap: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(600, t); osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);
      g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.22);
    },
    healChime: function (ctx) {
      var t = ctx.currentTime;
      [523, 659, 784].forEach(function(freq, i) {
        var osc = ctx.createOscillator(); var g = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0.08, t + i * 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.2);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t + i * 0.06); osc.stop(t + i * 0.06 + 0.25);
      });
    },
    counterPing: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(1200, t); osc.frequency.exponentialRampToValueAtTime(600, t + 0.1);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.18);
    },
    critHit: function (ctx) {
      var t = ctx.currentTime;
      var bufSize = Math.floor(ctx.sampleRate * 0.1);
      var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var g = ctx.createGain(); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
      src.connect(hp); hp.connect(g); g.connect(ctx.destination);
      src.start(t); src.stop(t + 0.25);
    },

    // ════════════════════════════════════════════════════════════
    // MOVE BUTTON PRESS / RELEASE — tactile audio matching the
    // hold-and-release physical depression. moveBtnPress fires
    // on pointerdown (universal, brief), moveBtnRelease_<move>
    // fires on click (per-move character — pitch + texture
    // tuned to the move's color identity).
    // ════════════════════════════════════════════════════════════

    // Universal press-down — quiet ~30ms lowpass noise burst.
    // Reads as "key going down" without being annoying on rapid
    // pressing. Same sound for every move.
    moveBtnPress: function (ctx) {
      var t = ctx.currentTime;
      var bufSize = Math.floor(ctx.sampleRate * 0.04);
      var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(lp); lp.connect(g); g.connect(ctx.destination);
      src.start(t); src.stop(t + 0.05);
    },

    // Strike — low percussive thunk + brief ember crackle (oxblood weight)
    moveBtnRelease_strike: function (ctx) {
      var t = ctx.currentTime;
      [110, 200].forEach(function (freq, i) {
        var osc = ctx.createOscillator(); var g = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0.18 - i * 0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.20);
      });
      var bufSize = Math.floor(ctx.sampleRate * 0.05);
      var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize) * 0.6;
      var src = ctx.createBufferSource(); src.buffer = buf;
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.08, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      src.connect(hp); hp.connect(g2); g2.connect(ctx.destination);
      src.start(t); src.stop(t + 0.07);
    },

    // Guard — glassy cyan ping (740Hz pure tone + harmonic)
    moveBtnRelease_guard: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 740;
      g.gain.setValueAtTime(0.13, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.25);
      var osc2 = ctx.createOscillator(); var g2 = ctx.createGain();
      osc2.type = 'sine'; osc2.frequency.value = 1480;
      g2.gain.setValueAtTime(0.04, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.start(t); osc2.stop(t + 0.18);
    },

    // Ability (generic) — mystical bell chime (660 + 990, detuned harmonic)
    moveBtnRelease_ability: function (ctx) {
      var t = ctx.currentTime;
      [660, 990].forEach(function (freq) {
        var osc = ctx.createOscillator(); var g = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0.10, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.32);
      });
    },

    // Heal — warm rising chime (880 → 1175 glissando + warm undertone)
    moveBtnRelease_heal: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1175, t + 0.18);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.28);
      var osc2 = ctx.createOscillator(); var g2 = ctx.createGain();
      osc2.type = 'triangle'; osc2.frequency.value = 440;
      g2.gain.setValueAtTime(0.05, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.start(t); osc2.stop(t + 0.22);
    },

    // Counter — sharp metal tink (1480 → 800Hz, very short)
    moveBtnRelease_counter: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1480, t);
      osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.12);
    },

    // Power Strike (STR-family) — deeper sub-thunk + bandpass crack noise
    moveBtnRelease_powerstrike: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(80, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + 0.25);
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.32);
      var bufSize = Math.floor(ctx.sampleRate * 0.08);
      var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize) * 0.7;
      var src = ctx.createBufferSource(); src.buffer = buf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 2;
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.12, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      src.connect(bp); bp.connect(g2); g2.connect(ctx.destination);
      src.start(t); src.stop(t + 0.10);
    },

    // Arcane Blast (INT-family) — high electric zap + bandpass noise
    moveBtnRelease_arcaneblast: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(400, t + 0.15);
      g.gain.setValueAtTime(0.11, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.20);
      var bufSize = Math.floor(ctx.sampleRate * 0.12);
      var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.4;
      var src = ctx.createBufferSource(); src.buffer = buf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 5;
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.07, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(bp); bp.connect(g2); g2.connect(ctx.destination);
      src.start(t); src.stop(t + 0.14);
    },

    // Shadow Strike (AGI-family) — dark filtered noise sweep (stealth swish)
    moveBtnRelease_shadowstrike: function (ctx) {
      var t = ctx.currentTime;
      var bufSize = Math.floor(ctx.sampleRate * 0.18);
      var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / bufSize);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2000, t);
      lp.frequency.exponentialRampToValueAtTime(400, t + 0.18);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.10, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      src.connect(lp); lp.connect(g); g.connect(ctx.destination);
      src.start(t); src.stop(t + 0.20);
    },

    // Fortify (END-family) — deep gong resonance with slow attack
    moveBtnRelease_fortify: function (ctx) {
      var t = ctx.currentTime;
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = 160;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.48);
      var osc2 = ctx.createOscillator(); var g2 = ctx.createGain();
      osc2.type = 'sine'; osc2.frequency.value = 480;
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(0.06, t + 0.04);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.start(t); osc2.stop(t + 0.32);
    },

    // Wild Card (LCK-family) — pitched-random tone (different note each press)
    moveBtnRelease_wildcard: function (ctx) {
      var t = ctx.currentTime;
      var freqs = [523, 622, 698, 784, 880, 988, 1175];
      var freq = freqs[Math.floor(Math.random() * freqs.length)];
      var osc = ctx.createOscillator(); var g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.13, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.22);
      var harm = freq * (1 + Math.random() * 0.5);
      var osc2 = ctx.createOscillator(); var g2 = ctx.createGain();
      osc2.type = 'triangle'; osc2.frequency.value = harm;
      g2.gain.setValueAtTime(0.05, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.start(t); osc2.stop(t + 0.18);
    },

    // Page flip — 8 paper-swish bursts at decelerating intervals (~2.3s).
    // Same flip-paced rhythm as crateRatchet, but highpass-filtered noise
    // reads as paper/page flicks instead of square-wave arcade clicks.
    // Designed for the splash slot-machine roll where each "flick" lands
    // roughly when a card slides past the visible window.
    pageFlip: function (ctx) {
      var t = ctx.currentTime;
      for (var i = 0; i < 8; i++) {
        var delay = i * (0.12 + i * 0.03);
        var bufferSize = Math.floor(ctx.sampleRate * 0.1);
        var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        var data = buffer.getChannelData(0);
        for (var j = 0; j < bufferSize; j++) data[j] = (Math.random() * 2 - 1) * 0.6;
        var noise = ctx.createBufferSource();
        noise.buffer = buffer;
        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1500;
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(0.15, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.08);
        noise.connect(hp); hp.connect(gain); gain.connect(ctx.destination);
        noise.start(t + delay); noise.stop(t + delay + 0.1);
      }
    },

    // Crate ratchet — rapid ticking that slows (roulette clicks)
    crateRatchet: function (ctx) {
      var t = ctx.currentTime;
      for (var i = 0; i < 12; i++) {
        var delay = i * (0.08 + i * 0.015);
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 800 + Math.random() * 200;
        gain.gain.setValueAtTime(0.1, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.04);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t + delay); osc.stop(t + delay + 0.05);
      }
    },

    // Crate reveal — cymbal crash (noise burst + rising tone)
    crateReveal: function (ctx) {
      var t = ctx.currentTime;
      var bufferSize = Math.floor(ctx.sampleRate * 0.15);
      var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      var noise = ctx.createBufferSource();
      noise.buffer = buffer;
      var nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.18, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 3000;
      noise.connect(hp); hp.connect(nGain); nGain.connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.6);
      var osc = ctx.createOscillator();
      var oGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(1760, t + 0.3);
      oGain.gain.setValueAtTime(0.12, t);
      oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.connect(oGain); oGain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.5);
    }
  };

  // ============================================================
  // BATTLE AMBIENT AUDIO
  // Low rumble drone + subtle crowd murmur via oscillators.
  // Fades in on battle start, out on result. Respects mute.
  // ============================================================

  function startBattleAmbient() {
    stopBattleAmbient();
    if (window.ArenaAudio && window.ArenaAudio.isMuted()) return;
    try {
      var ctx = getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime;
      var master = ctx.createGain();
      master.gain.setValueAtTime(0, t);
      master.gain.linearRampToValueAtTime(0.12, t + 2);
      master.connect(ctx.destination);

      // Low rumble: brown-noise through a tight lowpass (sub-bass)
      var bufSize = ctx.sampleRate * 2;
      var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var d = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < bufSize; i++) {
        var white = Math.random() * 2 - 1;
        last = (last + (0.02 * white)) / 1.02;
        d[i] = last * 3.5;
      }
      var noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 100;
      var noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.7;
      noise.connect(lp);
      lp.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(t);

      // Drone hum: two detuned sine oscillators for subtle beating
      var osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 55;
      var osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 55.5;
      var droneGain = ctx.createGain();
      droneGain.gain.value = 0.4;
      osc1.connect(droneGain);
      osc2.connect(droneGain);
      droneGain.connect(master);
      osc1.start(t);
      osc2.start(t);

      // Crowd murmur: bandpass-filtered noise (distant crowd feel)
      var crowdBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      var cd = crowdBuf.getChannelData(0);
      for (var j = 0; j < bufSize; j++) cd[j] = (Math.random() * 2 - 1);
      var crowdSrc = ctx.createBufferSource();
      crowdSrc.buffer = crowdBuf;
      crowdSrc.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 0.8;
      var crowdGain = ctx.createGain();
      crowdGain.gain.value = 0.15;
      crowdSrc.connect(bp);
      bp.connect(crowdGain);
      crowdGain.connect(master);
      crowdSrc.start(t);

      _ambientNodes = { master: master, sources: [noise, osc1, osc2, crowdSrc], ctx: ctx };
    } catch (e) { /* audio not supported */ }
  }

  function stopBattleAmbient() {
    if (!_ambientNodes) return;
    try {
      var ctx = _ambientNodes.ctx;
      var t = ctx.currentTime;
      _ambientNodes.master.gain.linearRampToValueAtTime(0, t + 1.5);
      var sources = _ambientNodes.sources;
      setTimeout(function () {
        sources.forEach(function (s) { try { s.stop(); } catch (e) { /* already stopped */ } });
      }, 2000);
    } catch (e) { /* fail silently */ }
    _ambientNodes = null;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  function play(name) {
    if (window.ArenaAudio && window.ArenaAudio.isMuted()) return;
    try {
      var ctx = getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      var sfx = SFX_DEFS[name];
      if (sfx) sfx(ctx);
    } catch (e) { /* audio not supported — fail silently */ }
  }

  return {
    play: play,
    startAmbient: startBattleAmbient,
    stopAmbient: stopBattleAmbient
  };
})();

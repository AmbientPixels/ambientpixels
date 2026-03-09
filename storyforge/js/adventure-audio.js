/**
 * adventure-audio.js — Procedural ambient music & SFX for StoryForge
 * Uses Web Audio API exclusively — zero audio files required.
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
 */
var StoryAudio = (function () {
  'use strict';

  var ctx = null;
  var masterGain = null;
  var ambientGain = null;
  var sfxGain = null;
  var enabled = localStorage.getItem('sf_audio') !== 'off';
  var ambientVolume = parseFloat(localStorage.getItem('sf_ambient_vol')) || 0.35;
  var sfxVolume = parseFloat(localStorage.getItem('sf_sfx_vol')) || 0.5;
  var currentAmbient = null; // { nodes[], genre, animFrame }

  /* ══════════════════════════════════════════════════════════════════
     GENRE PROFILES — musical DNA for procedural generation
     ══════════════════════════════════════════════════════════════════ */
  var GENRE_MUSIC = {
    fantasy: {
      // Ethereal reverb pads, soft harmonic intervals
      baseFreq: 110,         // A2
      chordIntervals: [1, 1.25, 1.5, 2],  // root, maj3, P5, octave
      waveform: 'sine',
      detune: 5,
      filterFreq: 800,
      filterQ: 2,
      lfoRate: 0.15,
      lfoDepth: 20,
      reverbTime: 3,
      padCount: 3,
      shimmer: true,
      noiseLevel: 0.02
    },
    horror: {
      // Low dissonant drones, detuned, unsettling
      baseFreq: 55,          // A1
      chordIntervals: [1, 1.06, 1.414, 1.888],  // root, minor2nd, tritone, min7
      waveform: 'sawtooth',
      detune: 15,
      filterFreq: 400,
      filterQ: 8,
      lfoRate: 0.08,
      lfoDepth: 40,
      reverbTime: 5,
      padCount: 3,
      shimmer: false,
      noiseLevel: 0.06
    },
    scifi: {
      // Clean filtered arpeggios, sine pads
      baseFreq: 220,         // A3
      chordIntervals: [1, 1.189, 1.498, 2],  // root, min3, P5, octave
      waveform: 'sine',
      detune: 2,
      filterFreq: 1200,
      filterQ: 4,
      lfoRate: 0.3,
      lfoDepth: 50,
      reverbTime: 2,
      padCount: 4,
      shimmer: true,
      noiseLevel: 0.01
    },
    detective: {
      // Warm muted tones, jazzy intervals
      baseFreq: 146.83,      // D3
      chordIntervals: [1, 1.26, 1.498, 1.782],  // root, maj3, P5, maj7
      waveform: 'triangle',
      detune: 3,
      filterFreq: 600,
      filterQ: 1.5,
      lfoRate: 0.1,
      lfoDepth: 10,
      reverbTime: 2.5,
      padCount: 3,
      shimmer: false,
      noiseLevel: 0.03
    },
    postapoc: {
      // Industrial hum, wind-like noise, sparse
      baseFreq: 73.42,       // D2
      chordIntervals: [1, 1.335, 1.498, 1.888],  // root, P4-ish, P5, min7
      waveform: 'sawtooth',
      detune: 8,
      filterFreq: 350,
      filterQ: 3,
      lfoRate: 0.05,
      lfoDepth: 30,
      reverbTime: 4,
      padCount: 2,
      shimmer: false,
      noiseLevel: 0.1
    },
    pirate: {
      // Warm fifths, wave-like sweeps
      baseFreq: 130.81,      // C3
      chordIntervals: [1, 1.26, 1.498, 2],  // root, maj3, P5, octave
      waveform: 'triangle',
      detune: 4,
      filterFreq: 900,
      filterQ: 2,
      lfoRate: 0.2,
      lfoDepth: 25,
      reverbTime: 2,
      padCount: 3,
      shimmer: true,
      noiseLevel: 0.04
    }
  };

  /* ══════════════════════════════════════════════════════════════════
     SFX DEFINITIONS — procedural sound effect parameters
     ══════════════════════════════════════════════════════════════════ */
  var SFX_DEFS = {
    // UI
    choiceHover: { type: 'tone', freq: 600, dur: 0.06, wave: 'sine', vol: 0.15, slide: 50 },
    choiceSelect: { type: 'tone', freq: 440, dur: 0.12, wave: 'sine', vol: 0.25, slide: 220 },

    // Dice
    diceRoll: { type: 'noise', dur: 0.4, filterFreq: 3000, filterDecay: 800, vol: 0.2 },
    diceSuccess: { type: 'chord', freqs: [523, 659, 784], dur: 0.3, wave: 'sine', vol: 0.2 },
    diceFail: { type: 'tone', freq: 200, dur: 0.25, wave: 'sawtooth', vol: 0.15, slide: -100 },
    diceCritical: { type: 'chord', freqs: [523, 659, 784, 1047], dur: 0.5, wave: 'sine', vol: 0.25 },

    // Game events
    damage: { type: 'noise', dur: 0.15, filterFreq: 2000, filterDecay: 200, vol: 0.3 },
    heal: { type: 'chord', freqs: [440, 554, 659], dur: 0.4, wave: 'sine', vol: 0.2 },
    itemPickup: { type: 'tone', freq: 880, dur: 0.1, wave: 'sine', vol: 0.2, slide: 440 },
    itemDrop: { type: 'tone', freq: 440, dur: 0.1, wave: 'sine', vol: 0.15, slide: -220 },
    companionJoin: { type: 'chord', freqs: [330, 440, 554], dur: 0.5, wave: 'triangle', vol: 0.2 },
    levelUp: { type: 'arp', freqs: [440, 554, 659, 880], dur: 0.08, wave: 'sine', vol: 0.25 },

    // Transitions
    sceneTransition: { type: 'sweep', startFreq: 200, endFreq: 800, dur: 0.5, vol: 0.1 },
    endingVictory: { type: 'arp', freqs: [523, 659, 784, 1047, 1319], dur: 0.12, wave: 'sine', vol: 0.2 },
    endingDeath: { type: 'tone', freq: 100, dur: 1.0, wave: 'sawtooth', vol: 0.2, slide: -50 },
    endingEscape: { type: 'sweep', startFreq: 300, endFreq: 1200, dur: 0.6, vol: 0.15 }
  };

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
  }

  /* ══════════════════════════════════════════════════════════════════
     CONVOLUTION REVERB (impulse response)
     ══════════════════════════════════════════════════════════════════ */
  function createReverb(duration) {
    var sampleRate = ctx.sampleRate;
    var length = sampleRate * duration;
    var impulse = ctx.createBuffer(2, length, sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var data = impulse.getChannelData(ch);
      for (var i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    var conv = ctx.createConvolver();
    conv.buffer = impulse;
    return conv;
  }

  /* ══════════════════════════════════════════════════════════════════
     AMBIENT MUSIC ENGINE
     ══════════════════════════════════════════════════════════════════ */
  function startAmbient(genreId) {
    if (!ctx || !enabled) return;
    stopAmbient(0); // immediate stop if already playing

    var profile = GENRE_MUSIC[genreId] || GENRE_MUSIC.fantasy;
    var nodes = [];

    // Create reverb
    var reverb = createReverb(profile.reverbTime);
    var reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.4;
    reverb.connect(reverbGain);
    reverbGain.connect(ambientGain);
    nodes.push(reverb, reverbGain);

    // Dry path
    var dryGain = ctx.createGain();
    dryGain.gain.value = 0.6;
    dryGain.connect(ambientGain);
    nodes.push(dryGain);

    // Master filter for the ambient
    var masterFilter = ctx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = profile.filterFreq;
    masterFilter.Q.value = profile.filterQ;
    masterFilter.connect(reverb);
    masterFilter.connect(dryGain);
    nodes.push(masterFilter);

    // LFO for filter sweep
    var lfo = ctx.createOscillator();
    var lfoGainNode = ctx.createGain();
    lfo.frequency.value = profile.lfoRate;
    lfo.type = 'sine';
    lfoGainNode.gain.value = profile.lfoDepth;
    lfo.connect(lfoGainNode);
    lfoGainNode.connect(masterFilter.frequency);
    lfo.start();
    nodes.push(lfo, lfoGainNode);

    // Pad oscillators
    for (var i = 0; i < profile.padCount; i++) {
      var interval = profile.chordIntervals[i % profile.chordIntervals.length];
      var freq = profile.baseFreq * interval;

      var osc = ctx.createOscillator();
      osc.type = profile.waveform;
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * profile.detune * 2;

      var padGain = ctx.createGain();
      padGain.gain.value = 0;
      // Fade in slowly
      padGain.gain.setTargetAtTime(0.12 / profile.padCount, ctx.currentTime + i * 0.5, 1.5);

      osc.connect(padGain);
      padGain.connect(masterFilter);
      osc.start();
      nodes.push(osc, padGain);
    }

    // Shimmer — high octave sine with slow fade in/out cycle
    if (profile.shimmer) {
      var shimmerOsc = ctx.createOscillator();
      shimmerOsc.type = 'sine';
      shimmerOsc.frequency.value = profile.baseFreq * 4;
      shimmerOsc.detune.value = 7;

      var shimmerGain = ctx.createGain();
      shimmerGain.gain.value = 0;

      shimmerOsc.connect(shimmerGain);
      shimmerGain.connect(masterFilter);
      shimmerOsc.start();
      nodes.push(shimmerOsc, shimmerGain);

      // Animate shimmer with slow breathing
      function animateShimmer() {
        if (!currentAmbient) return;
        var t = ctx.currentTime;
        var breath = Math.sin(t * 0.3) * 0.5 + 0.5; // 0-1, ~3.3s cycle
        shimmerGain.gain.setTargetAtTime(breath * 0.03, t, 0.1);
        currentAmbient.animFrame = requestAnimationFrame(animateShimmer);
      }
      requestAnimationFrame(animateShimmer);
    }

    // Background noise (wind/static)
    if (profile.noiseLevel > 0) {
      var bufferSize = ctx.sampleRate * 2;
      var noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      var noiseData = noiseBuffer.getChannelData(0);
      for (var j = 0; j < bufferSize; j++) {
        noiseData[j] = (Math.random() * 2 - 1);
      }

      var noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      var noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = profile.filterFreq * 0.5;
      noiseFilter.Q.value = 0.5;

      var noiseGainNode = ctx.createGain();
      noiseGainNode.gain.value = 0;
      noiseGainNode.gain.setTargetAtTime(profile.noiseLevel, ctx.currentTime + 1, 2);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGainNode);
      noiseGainNode.connect(masterFilter);
      noiseSource.start();
      nodes.push(noiseSource, noiseFilter, noiseGainNode);
    }

    currentAmbient = { nodes: nodes, genre: genreId, animFrame: null };
  }

  function stopAmbient(fadeMs) {
    if (!currentAmbient) return;
    var fade = (fadeMs !== undefined) ? fadeMs : 2000;

    if (currentAmbient.animFrame) {
      cancelAnimationFrame(currentAmbient.animFrame);
    }

    var nodesToStop = currentAmbient.nodes;
    currentAmbient = null;

    if (fade <= 0 || !ctx) {
      // Immediate stop
      stopNodes(nodesToStop);
      return;
    }

    // Fade out via ambientGain, then stop
    var now = ctx.currentTime;
    ambientGain.gain.setValueAtTime(ambientGain.gain.value, now);
    ambientGain.gain.linearRampToValueAtTime(0, now + fade / 1000);

    setTimeout(function () {
      stopNodes(nodesToStop);
      ambientGain.gain.value = ambientVolume;
    }, fade + 50);
  }

  function stopNodes(nodes) {
    nodes.forEach(function (node) {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {}
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     SFX ENGINE
     ══════════════════════════════════════════════════════════════════ */
  function sfx(name) {
    if (!ctx || !enabled) return;
    var def = SFX_DEFS[name];
    if (!def) return;

    switch (def.type) {
      case 'tone': playTone(def); break;
      case 'chord': playChord(def); break;
      case 'noise': playNoise(def); break;
      case 'arp': playArp(def); break;
      case 'sweep': playSweep(def); break;
    }
  }

  function playTone(def) {
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = def.wave || 'sine';
    osc.frequency.setValueAtTime(def.freq, now);
    if (def.slide) osc.frequency.linearRampToValueAtTime(def.freq + def.slide, now + def.dur);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(def.vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + def.dur);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + def.dur + 0.05);
  }

  function playChord(def) {
    var now = ctx.currentTime;
    def.freqs.forEach(function (freq) {
      var osc = ctx.createOscillator();
      osc.type = def.wave || 'sine';
      osc.frequency.value = freq;

      var gain = ctx.createGain();
      gain.gain.setValueAtTime(def.vol / def.freqs.length, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + def.dur);

      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(now);
      osc.stop(now + def.dur + 0.05);
    });
  }

  function playNoise(def) {
    var now = ctx.currentTime;
    var bufferSize = ctx.sampleRate * def.dur;
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    var source = ctx.createBufferSource();
    source.buffer = buffer;

    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(def.filterFreq, now);
    filter.frequency.exponentialRampToValueAtTime(def.filterDecay || 100, now + def.dur);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(def.vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + def.dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain);
    source.start(now);
  }

  function playArp(def) {
    var now = ctx.currentTime;
    def.freqs.forEach(function (freq, i) {
      var t = now + i * def.dur;
      var osc = ctx.createOscillator();
      osc.type = def.wave || 'sine';
      osc.frequency.value = freq;

      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(def.vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + def.dur * 2);

      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + def.dur * 2.5);
    });
  }

  function playSweep(def) {
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(def.startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(def.endFreq, now + def.dur);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(def.vol, now);
    gain.gain.setValueAtTime(def.vol, now + def.dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, now + def.dur);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + def.dur + 0.05);
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
    if (ambientGain) ambientGain.gain.setTargetAtTime(ambientVolume, ctx.currentTime, 0.1);
  }

  function setSfxVolume(val) {
    sfxVolume = Math.max(0, Math.min(1, val));
    localStorage.setItem('sf_sfx_vol', sfxVolume);
    if (sfxGain) sfxGain.gain.setTargetAtTime(sfxVolume, ctx.currentTime, 0.1);
  }

  function setEnabled(val) {
    enabled = !!val;
    localStorage.setItem('sf_audio', enabled ? 'on' : 'off');
    if (masterGain) masterGain.gain.setTargetAtTime(enabled ? 1 : 0, ctx.currentTime, 0.1);
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
    get enabled() { return enabled; },
    get ambientVolume() { return ambientVolume; },
    get sfxVolume() { return sfxVolume; }
  };
})();

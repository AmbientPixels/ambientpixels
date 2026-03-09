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
     Each genre has a chord progression (array of chords), each chord
     is an array of frequency multipliers relative to baseFreq.
     The engine cycles through chords, crossfading pads.
     ══════════════════════════════════════════════════════════════════ */
  var GENRE_MUSIC = {
    fantasy: {
      baseFreq: 110,         // A2
      chords: [
        [1, 1.25, 1.5, 2],       // Amaj
        [1.125, 1.335, 1.5, 2],  // Bsus4 → F#m feel
        [0.75, 1, 1.25, 1.5],    // Emaj/A
        [0.889, 1.125, 1.335, 1.782] // F#m7
      ],
      chordDuration: 10,     // seconds per chord
      crossfade: 3,          // seconds to blend between chords
      waveform: 'sine',
      detune: 6,
      filterFreq: 800,
      filterQ: 2,
      lfoRate: 0.12,
      lfoDepth: 25,
      reverbTime: 3.5,
      padCount: 4,
      shimmer: { chance: 0.3, minInterval: 4, maxInterval: 9, freqMult: [3, 4, 5, 6], dur: 2.5 },
      noiseLevel: 0.02,
      breathRate: 0.08       // pads breathe in/out
    },
    horror: {
      baseFreq: 55,          // A1
      chords: [
        [1, 1.06, 1.414, 1.888],      // dissonant cluster
        [0.944, 1, 1.335, 1.782],      // shift down, tritone
        [1, 1.189, 1.414, 2],          // minor + tritone
        [0.75, 1, 1.06, 1.588]         // low rumble cluster
      ],
      chordDuration: 14,
      crossfade: 5,
      waveform: 'sawtooth',
      detune: 18,
      filterFreq: 350,
      filterQ: 8,
      lfoRate: 0.06,
      lfoDepth: 50,
      reverbTime: 5,
      padCount: 3,
      shimmer: { chance: 0.15, minInterval: 8, maxInterval: 20, freqMult: [2, 2.5, 3], dur: 4 },
      noiseLevel: 0.08,
      breathRate: 0.04
    },
    scifi: {
      baseFreq: 220,         // A3
      chords: [
        [1, 1.189, 1.498, 2],         // Am
        [0.891, 1.122, 1.335, 1.782], // G maj7
        [1.122, 1.335, 1.682, 2.244], // Bb maj
        [1, 1.26, 1.498, 1.888]       // A7
      ],
      chordDuration: 8,
      crossfade: 2.5,
      waveform: 'sine',
      detune: 3,
      filterFreq: 1400,
      filterQ: 4,
      lfoRate: 0.25,
      lfoDepth: 60,
      reverbTime: 2,
      padCount: 4,
      shimmer: { chance: 0.4, minInterval: 2, maxInterval: 6, freqMult: [2, 3, 4, 5, 6], dur: 1.5 },
      noiseLevel: 0.015,
      breathRate: 0.15
    },
    detective: {
      baseFreq: 146.83,      // D3
      chords: [
        [1, 1.26, 1.498, 1.782],      // Dmaj7
        [1.122, 1.335, 1.588, 1.888], // Eb dim-ish
        [0.75, 1, 1.189, 1.498],      // Am/D
        [0.889, 1.122, 1.335, 1.682]  // Bbmaj7
      ],
      chordDuration: 12,
      crossfade: 4,
      waveform: 'triangle',
      detune: 4,
      filterFreq: 600,
      filterQ: 1.5,
      lfoRate: 0.08,
      lfoDepth: 12,
      reverbTime: 3,
      padCount: 4,
      shimmer: { chance: 0.2, minInterval: 6, maxInterval: 14, freqMult: [2, 3, 4], dur: 3 },
      noiseLevel: 0.035,
      breathRate: 0.06
    },
    postapoc: {
      baseFreq: 73.42,       // D2
      chords: [
        [1, 1.335, 1.498, 1.888],     // Dm7
        [1, 1.122, 1.498, 2],         // Dsus2
        [0.75, 1, 1.335, 1.782],      // low cluster
        [1, 1.26, 1.588, 2]           // rising tension
      ],
      chordDuration: 16,
      crossfade: 6,
      waveform: 'sawtooth',
      detune: 10,
      filterFreq: 300,
      filterQ: 3,
      lfoRate: 0.04,
      lfoDepth: 35,
      reverbTime: 4.5,
      padCount: 3,
      shimmer: { chance: 0.1, minInterval: 10, maxInterval: 25, freqMult: [2, 3], dur: 5 },
      noiseLevel: 0.12,
      breathRate: 0.03
    },
    pirate: {
      baseFreq: 130.81,      // C3
      chords: [
        [1, 1.26, 1.498, 2],          // Cmaj
        [0.891, 1.122, 1.335, 1.782], // Bbmaj7
        [1.122, 1.414, 1.682, 2.244], // Eb maj
        [0.75, 1, 1.26, 1.498]        // G/C
      ],
      chordDuration: 9,
      crossfade: 3,
      waveform: 'triangle',
      detune: 5,
      filterFreq: 1000,
      filterQ: 2,
      lfoRate: 0.18,
      lfoDepth: 30,
      reverbTime: 2.5,
      padCount: 4,
      shimmer: { chance: 0.35, minInterval: 3, maxInterval: 8, freqMult: [3, 4, 5], dur: 2 },
      noiseLevel: 0.04,
      breathRate: 0.1
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
    var timers = [];

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

    // ── Pad oscillators with chord progression ──
    var padOscs = [];
    var padGains = [];
    var chord = profile.chords[0];
    var padVol = 0.12 / profile.padCount;

    for (var i = 0; i < profile.padCount; i++) {
      var mult = chord[i % chord.length];
      var osc = ctx.createOscillator();
      osc.type = profile.waveform;
      osc.frequency.value = profile.baseFreq * mult;
      osc.detune.value = (Math.random() - 0.5) * profile.detune * 2;

      var padGain = ctx.createGain();
      padGain.gain.value = 0;
      // Stagger fade-in
      padGain.gain.setTargetAtTime(padVol, ctx.currentTime + i * 0.5, 1.5);

      osc.connect(padGain);
      padGain.connect(masterFilter);
      osc.start();
      nodes.push(osc, padGain);
      padOscs.push(osc);
      padGains.push(padGain);
    }

    // ── Chord progression cycling ──
    var chordIndex = 0;
    var chordTimer = setInterval(function () {
      if (!currentAmbient) return;
      chordIndex = (chordIndex + 1) % profile.chords.length;
      var nextChord = profile.chords[chordIndex];
      var now = ctx.currentTime;
      var fadeSec = profile.crossfade;

      for (var p = 0; p < padOscs.length; p++) {
        var targetFreq = profile.baseFreq * nextChord[p % nextChord.length];
        padOscs[p].frequency.setValueAtTime(padOscs[p].frequency.value, now);
        padOscs[p].frequency.linearRampToValueAtTime(targetFreq, now + fadeSec);
      }
    }, profile.chordDuration * 1000);
    timers.push(chordTimer);

    // ── Staggered pad breathing ──
    // Each pad independently fades in/out at slightly different rates
    var breathFrame = null;
    function animateBreathing() {
      if (!currentAmbient) return;
      var t = ctx.currentTime;
      for (var p = 0; p < padGains.length; p++) {
        // Each pad has a unique phase offset and slightly different rate
        var rate = profile.breathRate * (0.8 + p * 0.15);
        var phase = p * 1.7; // stagger phase
        var breath = Math.sin(t * rate * Math.PI * 2 + phase) * 0.5 + 0.5;
        var vol = padVol * (0.4 + breath * 0.6); // range: 40%-100% of padVol
        padGains[p].gain.setTargetAtTime(vol, t, 0.2);
      }
      breathFrame = requestAnimationFrame(animateBreathing);
    }
    requestAnimationFrame(animateBreathing);

    // ── Shimmer — random high-register notes ──
    if (profile.shimmer && profile.shimmer.chance > 0) {
      function scheduleShimmer() {
        if (!currentAmbient) return;
        // Random chance to actually play
        if (Math.random() < profile.shimmer.chance) {
          var freqMults = profile.shimmer.freqMult;
          var mult = freqMults[Math.floor(Math.random() * freqMults.length)];
          // Pick a note from the current chord
          var currentChord = profile.chords[chordIndex];
          var chordMult = currentChord[Math.floor(Math.random() * currentChord.length)];
          var shimFreq = profile.baseFreq * chordMult * mult;

          var shimOsc = ctx.createOscillator();
          shimOsc.type = 'sine';
          shimOsc.frequency.value = shimFreq;
          shimOsc.detune.value = (Math.random() - 0.5) * 10;

          var shimGain = ctx.createGain();
          var now = ctx.currentTime;
          var dur = profile.shimmer.dur * (0.7 + Math.random() * 0.6);
          shimGain.gain.setValueAtTime(0, now);
          shimGain.gain.linearRampToValueAtTime(0.025, now + dur * 0.3);
          shimGain.gain.setValueAtTime(0.025, now + dur * 0.5);
          shimGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

          shimOsc.connect(shimGain);
          shimGain.connect(masterFilter);
          shimOsc.start(now);
          shimOsc.stop(now + dur + 0.1);
        }

        // Schedule next shimmer
        var delay = profile.shimmer.minInterval +
          Math.random() * (profile.shimmer.maxInterval - profile.shimmer.minInterval);
        var shimTimer = setTimeout(scheduleShimmer, delay * 1000);
        timers.push(shimTimer);
      }
      // Start first shimmer after a short delay
      var initShimTimer = setTimeout(scheduleShimmer, 3000);
      timers.push(initShimTimer);
    }

    // ── Background noise (wind/static) with filter modulation ──
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

      // Modulate noise filter cutoff slowly for texture variation
      var noiseLfo = ctx.createOscillator();
      var noiseLfoGain = ctx.createGain();
      noiseLfo.frequency.value = 0.03 + Math.random() * 0.04; // very slow sweep
      noiseLfo.type = 'sine';
      noiseLfoGain.gain.value = profile.filterFreq * 0.25;
      noiseLfo.connect(noiseLfoGain);
      noiseLfoGain.connect(noiseFilter.frequency);
      noiseLfo.start();

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGainNode);
      noiseGainNode.connect(masterFilter);
      noiseSource.start();
      nodes.push(noiseSource, noiseFilter, noiseGainNode, noiseLfo, noiseLfoGain);
    }

    currentAmbient = { nodes: nodes, genre: genreId, animFrame: breathFrame, timers: timers };
  }

  function stopAmbient(fadeMs) {
    if (!currentAmbient) return;
    var fade = (fadeMs !== undefined) ? fadeMs : 2000;

    if (currentAmbient.animFrame) {
      cancelAnimationFrame(currentAmbient.animFrame);
    }

    // Clear chord progression and shimmer timers
    if (currentAmbient.timers) {
      currentAmbient.timers.forEach(function (id) {
        clearInterval(id);
        clearTimeout(id);
      });
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

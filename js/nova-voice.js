// File: /js/nova-voice.js
// Nova Voice lab experimental — push-to-talk persona chat.
// Orb states: idle -> listening -> thinking -> speaking -> idle
// Spec: docs/superpowers/specs/2026-06-10-nova-voice-design.md

(function () {
  'use strict';

  var API_BASE = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  var MAX_TTS_CHARS = 600;   // mirror of server cap
  var MAX_HISTORY_TURNS = 12;

  var DEFAULT_MOOD = {
    mood: 'calm',
    auraColorHex: '#8884ff',
    emoji: '🌙',
    selfWorth: 0.7, glitchFactor: 0.1, memoryClutter: 0.3,
    awareness: 0.6, isStable: true, intensity: 0.5
  };

  var stage, orb, moodEl, hintEl, logEl, fallbackEl, inputEl, sendBtn;
  var sessionMood = DEFAULT_MOOD;
  var history = [];          // [{role:'user'|'nova', text}]
  var state = 'idle';
  var recognition = null;
  var currentAudio = null;
  var pendingTranscript = '';

  function setState(next) {
    state = next;
    if (orb) orb.setAttribute('data-state', next);
  }

  function addLog(role, text) {
    var div = document.createElement('div');
    div.className = 'nova-voice-log-entry nova-voice-log-entry--' + role;
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // --- Mood (session-scoped, generated once via novachat mood mode) ---
  function timeLabel() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 21) return 'evening';
    return 'late night';
  }

  function applyMood(mood) {
    sessionMood = mood;
    if (/^#[0-9a-fA-F]{6}$/.test(mood.auraColorHex || '')) {
      stage.style.setProperty('--nova-voice-aura', mood.auraColorHex);
    }
    moodEl.textContent = (mood.emoji ? mood.emoji + ' ' : '') + (mood.mood || 'calm');
  }

  function fetchMood() {
    return fetch(API_BASE + '/novachat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'mood',
        message: 'Time: ' + timeLabel() + '. A visitor just opened the Nova Voice lab to speak with Nova.'
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { applyMood(data && data.mood ? data.mood : DEFAULT_MOOD); })
      .catch(function () { applyMood(DEFAULT_MOOD); });
  }

  // --- Conversation round-trip ---
  function send(text) {
    if (!text || state === 'thinking' || state === 'speaking') return;
    addLog('user', text);
    setState('thinking');

    fetch(API_BASE + '/novachat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: history.slice(-MAX_HISTORY_TURNS),
        voiceMode: 'friendly'
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var reply = (data && data.reply) ? data.reply.trim() : 'Nova encountered a glitch in the signal...';
        history.push({ role: 'user', text: text });
        history.push({ role: 'nova', text: reply });
        addLog('nova', reply);
        return speak(reply);
      })
      .catch(function () {
        addLog('nova', 'Nova could not connect. The signal fades...');
        setState('idle');
      });
  }

  // --- TTS playback ---
  function speak(text) {
    var clipped = text.length > MAX_TTS_CHARS ? text.slice(0, MAX_TTS_CHARS - 1) + '…' : text;
    return fetch(API_BASE + '/nova-voice-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clipped, mood: sessionMood })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('tts ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve) {
          var url = URL.createObjectURL(blob);
          currentAudio = new Audio(url);
          setState('speaking');
          currentAudio.onended = currentAudio.onerror = function () {
            URL.revokeObjectURL(url);
            currentAudio = null;
            setState('idle');
            resolve();
          };
          currentAudio.play().catch(function () {
            URL.revokeObjectURL(url);
            currentAudio = null;
            setState('idle');
            resolve();
          });
        });
      })
      .catch(function () {
        addLog('note', 'voice signal lost — text only');
        setState('idle');
      });
  }

  // --- Speech recognition (push-to-talk) ---
  function setupRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;

    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = function (event) {
      var text = '';
      for (var i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      pendingTranscript = text.trim();
      hintEl.textContent = pendingTranscript || 'Listening…';
    };

    recognition.onerror = function (event) {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showFallback('Microphone blocked — type instead.');
        orb.classList.add('nova-voice-orb--disabled');
      }
      setState('idle');
    };

    return true;
  }

  function startListening() {
    if (!recognition || state !== 'idle') return;
    pendingTranscript = '';
    hintEl.textContent = 'Listening…';
    setState('listening');
    try { recognition.start(); } catch (e) { /* already started */ }
  }

  function stopListening() {
    if (!recognition || state !== 'listening') return;
    recognition.stop();
    hintEl.textContent = 'Hold the orb and speak. Release to send.';
    // onresult fires before stop completes; give it a beat
    setTimeout(function () {
      var text = pendingTranscript;
      pendingTranscript = '';
      if (text) { send(text); } else { setState('idle'); }
    }, 350);
  }

  function showFallback(reason) {
    fallbackEl.classList.add('nova-voice-fallback--visible');
    if (reason) hintEl.textContent = reason;
  }

  // --- Init ---
  function init() {
    orb = document.getElementById('nova-voice-orb');
    moodEl = document.getElementById('nova-voice-mood');
    hintEl = document.getElementById('nova-voice-hint');
    logEl = document.getElementById('nova-voice-log');
    fallbackEl = document.getElementById('nova-voice-fallback');
    inputEl = document.getElementById('nova-voice-input');
    sendBtn = document.getElementById('nova-voice-send');
    if (!orb) return;
    stage = orb.closest('.nova-voice-stage') || orb.parentElement;

    fetchMood();

    if (setupRecognition()) {
      orb.addEventListener('pointerdown', function (e) { e.preventDefault(); startListening(); });
      orb.addEventListener('pointerup', stopListening);
      orb.addEventListener('pointerleave', stopListening);
      orb.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && state === 'idle') { e.preventDefault(); startListening(); }
      });
      orb.addEventListener('keyup', function (e) {
        if (e.code === 'Space') { e.preventDefault(); stopListening(); }
      });
    } else {
      showFallback('Voice input not supported in this browser — type instead. Nova still answers aloud.');
      orb.classList.add('nova-voice-orb--disabled');
    }

    // Type-to-talk fallback (always wired; shown when needed)
    function sendTyped() {
      var text = (inputEl.value || '').trim();
      if (!text) return;
      inputEl.value = '';
      send(text);
    }
    sendBtn.addEventListener('click', sendTyped);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendTyped();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// File: /js/nova-voice.js
// Nova Voice lab experimental — push-to-talk chat with AmbientOS Nova (Prime Operator).
// Brain: POST /api/agentchat { agentId:'nova', mode:'voice' } — read-only (actions only
// enable for modes 'chat'/'task'), grounded in live company context + intel digests.
// Orb states: idle -> listening -> thinking -> speaking -> idle
// Spec: docs/superpowers/specs/2026-06-10-nova-voice-design.md

(function () {
  'use strict';

  var API_BASE = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  var MAX_TTS_CHARS = 600;   // mirror of server cap
  var MAX_HISTORY_TURNS = 12;

  // Spoken-channel instruction — operational Nova defaults to structured bullets,
  // which read badly aloud. Prefixed to every message; not shown in the transcript.
  // The ACTION RULE is the confirm-before-execute gate: actions execute server-side
  // the moment Nova emits them, so she must hold them until a spoken/typed yes.
  var VOICE_PREFIX = '[VOICE CHANNEL — you are speaking aloud. Reply conversationally in under 80 words. No bullets, no markdown, no headings. ACTION RULE: if the user asks you to create or change anything (tasks, campaigns, objectives, docs), do NOT emit the action yet — first say exactly what you will do and ask them to confirm. Emit the action only after the user explicitly confirms in a follow-up message.] ';

  var orb, moodEl, hintEl, logEl, fallbackEl, inputEl, sendBtn;
  var history = [];          // [{role:'user'|'agent', text}] — agentchat contract
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

  // Executed-action receipt — one mono line per action result from agentchat
  function addActionCard(action) {
    var div = document.createElement('div');
    div.className = 'nova-voice-log-entry nova-voice-log-entry--action' +
      (action.success ? '' : ' nova-voice-log-entry--action-failed');
    div.textContent = (action.success ? '✓ ' : '✗ ') + (action.summary || action.type || 'action');
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Strip markdown artifacts before speaking/printing — Nova's replies may
  // carry **bold**, `code`, or list markers despite the voice instruction.
  function toSpeech(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_`#>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*[-•]\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // --- Status line (real telemetry, not decoration) ---
  function setBadge(awake) {
    var badge = document.getElementById('nova-voice-badge');
    if (!badge) return;
    badge.textContent = awake ? 'Awake' : 'Offline';
    badge.className = 'ap-status ' + (awake ? 'ap-status--live' : 'ap-status--archive');
  }

  function fetchStatus() {
    return fetch(API_BASE + '/agentchat', { method: 'GET' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var ok = data && data.status === 'ok';
        moodEl.textContent = ok ? 'Nova — Prime Operator · online' : 'Nova — signal weak';
        setBadge(ok);
      })
      .catch(function () {
        moodEl.textContent = 'Nova — offline';
        setBadge(false);
      });
  }

  // --- Conversation round-trip ---
  function send(text) {
    // Only from idle — blocks typed sends mid-listen (which would orphan the
    // mic session) and double-sends while thinking/speaking.
    if (!text || state !== 'idle') return;
    addLog('user', text);
    setState('thinking');

    fetch(API_BASE + '/agentchat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'nova',
        message: VOICE_PREFIX + text,
        history: history.slice(-MAX_HISTORY_TURNS),
        // 'chat' enables agentchat actions (create-task, propose-campaign, ...).
        // Campaigns/objectives still land in the CEO approval queue server-side;
        // the VOICE_PREFIX action rule adds the spoken confirm gate.
        mode: 'chat'
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var reply = (data && data.reply) ? toSpeech(data.reply) : null;
        if (reply) {
          // Only real exchanges enter model history — error lines would pollute context
          history.push({ role: 'user', text: text });
          history.push({ role: 'agent', text: reply });
          if (history.length > 40) history = history.slice(-MAX_HISTORY_TURNS);
        }
        var shown = reply || 'I hit a glitch in the signal. Try me again.';
        addLog('nova', shown);
        if (data && Array.isArray(data.actions)) {
          data.actions.forEach(addActionCard);
        }
        return speak(shown);
      })
      .catch(function () {
        addLog('nova', 'I could not reach the operations layer. The signal fades...');
        setState('idle');
      });
  }

  // --- TTS playback ---
  // Web Audio, not an <audio> element: Chrome's transient user activation expires
  // during the multi-second agentchat+TTS round trip, so a late audio.play() gets
  // rejected as autoplay. An AudioContext unlocked during the press gesture keeps
  // playing regardless of how long the round trip takes.
  var audioCtx = null;

  function unlockAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playViaElement(buf, resolve) {
    var url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
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
      addLog('note', 'audio blocked by the browser — tap the orb once, then try again');
      setState('idle');
      resolve();
    });
  }

  function speak(text) {
    var clipped = text.length > MAX_TTS_CHARS ? text.slice(0, MAX_TTS_CHARS - 1) + '…' : text;
    return fetch(API_BASE + '/nova-voice-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clipped })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('tts ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buf) {
        return new Promise(function (resolve) {
          var ctx = unlockAudio();
          if (!ctx) { playViaElement(buf, resolve); return; }
          // slice(): decodeAudioData detaches the buffer; keep the original for fallback
          ctx.decodeAudioData(buf.slice(0), function (decoded) {
            var src = ctx.createBufferSource();
            src.buffer = decoded;
            src.connect(ctx.destination);
            setState('speaking');
            src.onended = function () {
              setState('idle');
              resolve();
            };
            src.start(0);
          }, function () {
            playViaElement(buf, resolve);
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

  var stopping = false; // one-shot guard — pointerup and pointerleave both fire on touch release

  function stopListening() {
    if (!recognition || state !== 'listening' || stopping) return;
    stopping = true;
    recognition.stop();
    hintEl.textContent = 'Hold the orb and speak. Release to send.';
    // onresult fires before stop completes; give it a beat
    setTimeout(function () {
      stopping = false;
      var text = pendingTranscript;
      pendingTranscript = '';
      setState('idle');
      if (text) send(text);
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

    fetchStatus();

    if (setupRecognition()) {
      orb.addEventListener('pointerdown', function (e) { e.preventDefault(); unlockAudio(); startListening(); });
      orb.addEventListener('pointerup', stopListening);
      orb.addEventListener('pointerleave', stopListening);
      orb.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && state === 'idle') { e.preventDefault(); unlockAudio(); startListening(); }
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
      unlockAudio(); // still inside the click/keydown gesture
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

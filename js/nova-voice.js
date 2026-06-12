// File: /js/nova-voice.js
// Nova Voice lab experimental — push-to-talk chat with the AmbientOS crew.
// Brain: POST /api/agentchat { agentId, mode:'chat' } — actions enabled with a
// prompt-gated confirm-before-execute rule; campaigns/objectives stay CEO-approval
// proposals server-side. Each agent speaks with its own whitelisted Azure voice.
// Orb states: idle -> listening -> thinking -> speaking -> idle
// Spec: docs/superpowers/specs/2026-06-10-nova-voice-design.md

(function () {
  'use strict';

  var API_BASE = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  var MAX_TTS_CHARS = 600;   // mirror of server cap
  var MAX_HISTORY_TURNS = 12;

  // Voice names must match the server whitelist in api/nova-voice-tts/ssml.js
  var AGENTS = {
    nova:   { label: 'Nova',   role: 'Prime Operator', voice: 'en-US-AriaNeural' },
    cipher: { label: 'Cipher', role: 'CFO',            voice: 'en-US-DavisNeural' },
    echo:   { label: 'Echo',   role: 'Marketing',      voice: 'en-US-JaneNeural' },
    forge:  { label: 'Forge',  role: 'DevOps',         voice: 'en-US-GuyNeural' },
    pixel:  { label: 'Pixel',  role: 'Design & QC',    voice: 'en-US-JennyNeural' },
    scout:  { label: 'Scout',  role: 'Research',       voice: 'en-US-JasonNeural' },
    scribe: { label: 'Scribe', role: 'Content',        voice: 'en-US-NancyNeural' },
    quill:  { label: 'Quill',  role: 'Editor',         voice: 'en-US-TonyNeural' }
  };
  var currentAgentId = 'nova';

  // Spoken-channel instruction — agents default to structured bullets, which read
  // badly aloud. Prefixed to every message; not shown in the transcript.
  // The ACTION RULE is the confirm-before-execute gate: actions execute server-side
  // the moment the agent emits them, so it must hold them until a spoken/typed yes.
  var VOICE_PREFIX = '[VOICE CHANNEL — you are speaking aloud. Reply conversationally in under 80 words. No bullets, no markdown, no headings. ACTION RULE: if the user asks you to create or change anything (tasks, campaigns, objectives, docs), do NOT emit the action yet — first say exactly what you will do and ask them to confirm. Emit the action only after the user explicitly confirms in a follow-up message.] ';

  // Dead-air cover — short clips in the agent's voice while the round trip runs.
  // Cached per phrase+voice so repeats cost nothing.
  var FILLERS = ['One moment.', 'Checking.', 'On it.', 'Let me look at that.'];
  var fillerIdx = 0;
  var fillerCache = {};

  var orb, moodEl, hintEl, logEl, fallbackEl, inputEl, sendBtn, agentsEl;
  var history = [];          // [{role:'user'|'agent', text}] — agentchat contract
  var state = 'idle';
  var recognition = null;
  var currentAudio = null;   // element-fallback playback
  var currentSource = null;  // Web Audio playback (speech or filler)
  var pendingTranscript = '';
  var serviceOnline = false;
  var greetingText = null;
  var greetingSpoken = false;

  var HINT_DEFAULT = 'Hold the orb and speak. Release to send.';

  function setState(next) {
    state = next;
    if (orb) orb.setAttribute('data-state', next);
    if (recognition && hintEl) {
      if (next === 'speaking') hintEl.textContent = 'Tap the orb to interrupt.';
      else if (next === 'thinking') hintEl.textContent = 'Thinking…';
      else if (next === 'idle') hintEl.textContent = HINT_DEFAULT;
    }
  }

  function speakerLabel() {
    return AGENTS[currentAgentId].label;
  }

  function addLog(role, text, speaker) {
    var div = document.createElement('div');
    div.className = 'nova-voice-log-entry nova-voice-log-entry--' + role;
    if (role === 'nova') div.setAttribute('data-speaker', (speaker || speakerLabel()) + ' —');
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

  // Strip markdown artifacts before speaking/printing — replies may carry
  // **bold**, `code`, or list markers despite the voice instruction.
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

  function statusLine() {
    var a = AGENTS[currentAgentId];
    moodEl.textContent = a.label + ' — ' + a.role + (serviceOnline ? ' · online' : ' · offline');
  }

  function fetchStatus() {
    return fetch(API_BASE + '/agentchat', { method: 'GET' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        serviceOnline = !!(data && data.status === 'ok');
        statusLine();
        setBadge(serviceOnline);
      })
      .catch(function () {
        serviceOnline = false;
        statusLine();
        setBadge(false);
      });
  }

  // --- Audio: Web Audio, not an <audio> element ---
  // Chrome's transient user activation expires during the multi-second round trip,
  // so a late audio.play() gets rejected as autoplay. An AudioContext unlocked
  // during the press gesture keeps playing regardless of round-trip length.
  var audioCtx = null;

  function unlockAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // Barge-in: kill whatever is playing (speech or filler) immediately
  function stopSpeaking() {
    if (currentSource) {
      try { currentSource.onended = null; currentSource.stop(); } catch (e) { /* already stopped */ }
      currentSource = null;
    }
    if (currentAudio) {
      try { currentAudio.onended = currentAudio.onerror = null; currentAudio.pause(); } catch (e) { /* noop */ }
      currentAudio = null;
    }
    if (state === 'speaking') setState('idle');
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

  // isSpeech=true drives the orb state machine; fillers play under 'thinking'
  function playBuffer(buf, isSpeech) {
    return new Promise(function (resolve) {
      var ctx = unlockAudio();
      if (!ctx) {
        if (isSpeech) playViaElement(buf, resolve); else resolve();
        return;
      }
      // slice(): decodeAudioData detaches the buffer; keep the original for fallback/cache
      ctx.decodeAudioData(buf.slice(0), function (decoded) {
        var src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(ctx.destination);
        currentSource = src;
        if (isSpeech) setState('speaking');
        src.onended = function () {
          if (currentSource === src) currentSource = null;
          if (isSpeech) setState('idle');
          resolve();
        };
        src.start(0);
      }, function () {
        if (isSpeech) playViaElement(buf, resolve); else resolve();
      });
    });
  }

  function fetchTts(text, voice) {
    return fetch(API_BASE + '/nova-voice-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, voice: voice })
    }).then(function (res) {
      if (!res.ok) throw new Error('tts ' + res.status);
      return res.arrayBuffer();
    });
  }

  function speak(text, voice) {
    var clipped = text.length > MAX_TTS_CHARS ? text.slice(0, MAX_TTS_CHARS - 1) + '…' : text;
    return fetchTts(clipped, voice)
      .then(function (buf) {
        stopSpeaking(); // cut a still-playing filler before the real reply
        return playBuffer(buf, true);
      })
      .catch(function () {
        addLog('note', 'voice signal lost — text only');
        setState('idle');
      });
  }

  // Cover the round-trip silence with a short clip in the agent's voice.
  // Only plays if we're still thinking when the clip is ready.
  function playFiller(voice) {
    var phrase = FILLERS[fillerIdx++ % FILLERS.length];
    var key = voice + '|' + phrase;
    if (fillerCache[key]) {
      if (state === 'thinking') playBuffer(fillerCache[key], false);
      return;
    }
    fetchTts(phrase, voice)
      .then(function (buf) {
        fillerCache[key] = buf;
        if (state === 'thinking') playBuffer(buf, false);
      })
      .catch(function () { /* fillers are best-effort */ });
  }

  // --- Conversation round-trip ---
  function send(text) {
    // Only from idle — blocks typed sends mid-listen (which would orphan the
    // mic session) and double-sends while thinking/speaking.
    if (!text || state !== 'idle') return;
    var agent = AGENTS[currentAgentId]; // snapshot — user may switch mid-flight
    var agentId = currentAgentId;
    addLog('user', text);
    setState('thinking');
    playFiller(agent.voice);

    fetch(API_BASE + '/agentchat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: agentId,
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
        addLog('nova', shown, agent.label);
        if (data && Array.isArray(data.actions)) {
          data.actions.forEach(addActionCard);
        }
        return speak(shown, agent.voice);
      })
      .catch(function () {
        addLog('nova', 'I could not reach the operations layer. The signal fades...', agent.label);
        setState('idle');
      });
  }

  // --- Proactive greeting ---
  // Fetched at load (read-only mode), shown as the first transcript entry, and
  // spoken on the first neutral gesture — never over the user's own first words.
  function fetchGreeting() {
    fetch(API_BASE + '/agentchat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'nova',
        mode: 'voice', // read-only — greetings must never act
        message: VOICE_PREFIX + 'Open a voice session with a one-or-two sentence spoken greeting: time-appropriate salutation, system health in a phrase, and anything urgent or waiting on the CEO. Under 40 words.'
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.reply || history.length > 0) return;
        greetingText = toSpeech(data.reply);
        addLog('nova', greetingText, 'Nova');
        history.push({ role: 'agent', text: greetingText });
      })
      .catch(function () { /* greeting is best-effort */ });
  }

  function maybeSpeakGreeting(e) {
    if (greetingSpoken || !greetingText || state !== 'idle') return;
    // The orb / input / send are conversation starts — don't talk over them
    var t = e.target;
    if (orb.contains(t) || fallbackEl.contains(t)) return;
    greetingSpoken = true;
    unlockAudio();
    speak(greetingText, AGENTS.nova.voice);
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
    hintEl.textContent = HINT_DEFAULT;
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

  // --- Agent switching ---
  function selectAgent(id) {
    if (!AGENTS[id] || id === currentAgentId) return;
    currentAgentId = id;
    statusLine();
    var btns = agentsEl.querySelectorAll('.nova-voice-agent');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('nova-voice-agent--active', btns[i].getAttribute('data-agent') === id);
    }
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
    agentsEl = document.getElementById('nova-voice-agents');
    if (!orb) return;

    fetchStatus();
    fetchGreeting();
    document.addEventListener('pointerdown', maybeSpeakGreeting);

    if (agentsEl) {
      agentsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.nova-voice-agent');
        if (btn) selectAgent(btn.getAttribute('data-agent'));
      });
    }

    if (setupRecognition()) {
      orb.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        unlockAudio();
        if (state === 'speaking') stopSpeaking(); // barge-in
        startListening();
      });
      orb.addEventListener('pointerup', stopListening);
      orb.addEventListener('pointerleave', stopListening);
      orb.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && (state === 'idle' || state === 'speaking')) {
          e.preventDefault();
          unlockAudio();
          if (state === 'speaking') stopSpeaking();
          startListening();
        }
      });
      orb.addEventListener('keyup', function (e) {
        if (e.code === 'Space') { e.preventDefault(); stopListening(); }
      });
    } else {
      showFallback('Voice input not supported in this browser — type instead. The crew still answers aloud.');
      orb.classList.add('nova-voice-orb--disabled');
    }

    // Type-to-talk fallback (always wired; shown when needed)
    function sendTyped() {
      var text = (inputEl.value || '').trim();
      if (!text) return;
      unlockAudio(); // still inside the click/keydown gesture
      if (state === 'speaking') stopSpeaking(); // typed barge-in
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

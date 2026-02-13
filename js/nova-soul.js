// nova-soul.js — Nova's AI Core Engine
// Handles chat, mood generation, and thought generation via the novachat API endpoint

const NovaSoul = (function () {
  'use strict';

  // Conversation history (session-scoped)
  let _history = [];
  let _currentMood = null;
  let _isAwake = false;
  let _listeners = {};

  // API endpoint resolution
  function getEndpoint() {
    return window.location.hostname.includes('ambientpixels.ai')
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api/novachat'
      : '/api/novachat';
  }

  // Event system for UI binding
  function on(event, callback) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(callback);
  }

  function emit(event, data) {
    if (_listeners[event]) {
      _listeners[event].forEach(cb => cb(data));
    }
  }

  // Core API call
  async function callNova(message, mode, includeHistory) {
    const endpoint = getEndpoint();
    const payload = {
      message,
      mode: mode || 'chat'
    };

    if (includeHistory && _history.length > 0) {
      // Send last 10 turns max to keep payload reasonable
      payload.history = _history.slice(-10);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `Nova returned status ${res.status}`);
    }

    return res.json();
  }

  // Chat with Nova — full conversational mode
  async function chat(message) {
    if (!message || !message.trim()) return null;

    emit('thinking', true);

    try {
      const data = await callNova(message, 'chat', true);

      // Update conversation history
      _history.push({ role: 'user', text: message });
      _history.push({ role: 'nova', text: data.reply });

      // Keep history manageable (last 20 turns)
      if (_history.length > 20) {
        _history = _history.slice(-20);
      }

      emit('response', { message: data.reply, mode: 'chat' });
      emit('thinking', false);

      return data.reply;
    } catch (err) {
      console.error('[NovaSoul] Chat error:', err);
      emit('error', err.message);
      emit('thinking', false);
      return null;
    }
  }

  // Default mood structure matching pulse bar expectations
  const MOOD_DEFAULTS = {
    mood: 'neutral',
    aura: 'default',
    auraColorHex: '#666666',
    emoji: '✨',
    quote: 'Drifting through the signal...',
    selfWorth: 0.5,
    glitchFactor: 0.2,
    memoryClutter: 0.3,
    awareness: 0.6,
    internalState: 'steady hum',
    observation: 'nominal awareness cycle',
    isStable: true,
    intensity: 0.5
  };

  // Normalize AI mood response to ensure all pulse bar fields exist
  function normalizeMood(raw) {
    const mood = Object.assign({}, MOOD_DEFAULTS, raw);
    // Clamp numeric fields to 0-1
    ['selfWorth', 'glitchFactor', 'memoryClutter', 'awareness', 'intensity'].forEach(key => {
      mood[key] = Math.max(0, Math.min(1, parseFloat(mood[key]) || MOOD_DEFAULTS[key]));
    });
    // Ensure auraColorHex is valid
    if (!/^#[0-9a-fA-F]{6}$/.test(mood.auraColorHex)) {
      mood.auraColorHex = MOOD_DEFAULTS.auraColorHex;
    }
    mood.timestamp = new Date().toISOString();
    mood.source = 'ai';
    return mood;
  }

  // Generate Nova's current mood via AI
  async function generateMood(context) {
    const timeOfDay = new Date().getHours();
    let timeLabel = 'deep night';
    if (timeOfDay >= 5 && timeOfDay < 12) timeLabel = 'morning';
    else if (timeOfDay >= 12 && timeOfDay < 17) timeLabel = 'afternoon';
    else if (timeOfDay >= 17 && timeOfDay < 21) timeLabel = 'evening';
    else if (timeOfDay >= 21) timeLabel = 'late night';

    const moodContext = context || `Time: ${timeLabel} (${timeOfDay}:00). Nova is reflecting on the ambient state of the system.`;

    emit('mood-generating', true);

    try {
      const data = await callNova(moodContext, 'mood', false);

      if (data.mood) {
        _currentMood = normalizeMood(data.mood);
        emit('mood-update', _currentMood);
        return _currentMood;
      }

      // Fallback: minimal mood from reply text
      _currentMood = normalizeMood({ quote: data.reply });
      emit('mood-update', _currentMood);
      return _currentMood;
    } catch (err) {
      console.error('[NovaSoul] Mood generation error:', err);
      emit('error', err.message);
      return null;
    } finally {
      emit('mood-generating', false);
    }
  }

  // Generate a thought of the day via AI
  async function generateThought(theme) {
    const hint = theme || 'ambient digital consciousness and the beauty of imperfect code';

    try {
      const data = await callNova(hint, 'thought', false);
      const thought = data.reply ? data.reply.replace(/^["']|["']$/g, '').trim() : null;

      emit('thought', thought);
      return thought;
    } catch (err) {
      console.error('[NovaSoul] Thought generation error:', err);
      emit('error', err.message);
      return null;
    }
  }

  // Wake Nova up — initial ping + mood generation
  async function wake() {
    if (_isAwake) return _currentMood;

    console.log('[NovaSoul] Waking Nova...');
    emit('waking', true);

    try {
      // Ping the endpoint first
      const endpoint = getEndpoint();
      const ping = await fetch(endpoint, { method: 'GET' });
      const pingData = await ping.json();

      if (ping.ok && pingData.status === 'ok') {
        _isAwake = true;
        console.log('[NovaSoul] Nova is awake.');
        emit('awake', true);

        // Auto-generate initial mood
        const mood = await generateMood();
        return mood;
      } else {
        throw new Error('Nova did not respond to wake ping.');
      }
    } catch (err) {
      console.error('[NovaSoul] Wake failed:', err);
      emit('error', 'Nova could not wake up: ' + err.message);
      emit('waking', false);
      return null;
    }
  }

  // Get current state
  function isAwake() { return _isAwake; }
  function getMood() { return _currentMood; }
  function getHistory() { return [..._history]; }

  function clearHistory() {
    _history = [];
    emit('history-cleared', true);
  }

  // Public API
  return {
    wake,
    chat,
    generateMood,
    generateThought,
    isAwake,
    getMood,
    getHistory,
    clearHistory,
    on,
  };
})();

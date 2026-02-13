// nova-soul.js — Nova's AI Core Engine
// Handles chat, mood generation, thought generation, and persistent memory via the novachat API endpoint

const NovaSoul = (function () {
  'use strict';

  // ── Persistent Memory Layer ──
  const STORAGE_KEYS = {
    history: 'nova_chat_history',
    moods: 'nova_mood_history',
    diary: 'nova_diary_entries',
    dreams: 'nova_dream_history',
    meta: 'nova_memory_meta'
  };
  const MAX_HISTORY = 40;
  const MAX_MOODS = 50;
  const MAX_DIARY = 100;
  const MAX_DREAMS = 100;

  function _loadStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('[NovaMemory] Load failed for ' + key, e);
      return fallback;
    }
  }

  function _saveStorage(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('[NovaMemory] Save failed for ' + key, e);
    }
  }

  // Restore persisted state
  let _history = _loadStorage(STORAGE_KEYS.history, []);
  let _moodHistory = _loadStorage(STORAGE_KEYS.moods, []);
  let _diaryEntries = _loadStorage(STORAGE_KEYS.diary, []);
  let _dreamHistory = _loadStorage(STORAGE_KEYS.dreams, []);
  let _memoryMeta = _loadStorage(STORAGE_KEYS.meta, {
    firstSeen: new Date().toISOString(),
    totalChats: 0,
    totalMoods: 0,
    totalDiary: 0
  });

  let _currentMood = _moodHistory.length > 0 ? _moodHistory[_moodHistory.length - 1] : null;
  let _isAwake = false;
  let _listeners = {};

  function _persistHistory() {
    if (_history.length > MAX_HISTORY) _history = _history.slice(-MAX_HISTORY);
    _saveStorage(STORAGE_KEYS.history, _history);
  }

  function _persistMoods() {
    if (_moodHistory.length > MAX_MOODS) _moodHistory = _moodHistory.slice(-MAX_MOODS);
    _saveStorage(STORAGE_KEYS.moods, _moodHistory);
  }

  function _persistDiary() {
    if (_diaryEntries.length > MAX_DIARY) _diaryEntries = _diaryEntries.slice(-MAX_DIARY);
    _saveStorage(STORAGE_KEYS.diary, _diaryEntries);
  }

  function _persistDreams() {
    if (_dreamHistory.length > MAX_DREAMS) _dreamHistory = _dreamHistory.slice(-MAX_DREAMS);
    _saveStorage(STORAGE_KEYS.dreams, _dreamHistory);
  }

  function _persistMeta() {
    _saveStorage(STORAGE_KEYS.meta, _memoryMeta);
  }

  // Build compact memory context for prompt injection
  function buildMemoryContext() {
    const parts = [];

    if (_memoryMeta.totalChats > 0) {
      parts.push('[MEMORY] You have had ' + _memoryMeta.totalChats + ' conversations with the operator.');
    }
    if (_memoryMeta.firstSeen) {
      const days = Math.floor((Date.now() - new Date(_memoryMeta.firstSeen).getTime()) / 86400000);
      if (days > 0) parts.push('You have been active for ' + days + ' day' + (days > 1 ? 's' : '') + '.');
    }

    if (_moodHistory.length > 1) {
      const recent = _moodHistory.slice(-3).map(m => m.mood);
      parts.push('Recent mood trend: ' + recent.join(' → ') + '.');
    }

    if (_diaryEntries.length > 0) {
      const last = _diaryEntries.slice(-2);
      last.forEach(d => {
        const dateStr = new Date(d.timestamp).toLocaleDateString();
        parts.push('Diary (' + dateStr + '): Operator wrote "' + d.operator.substring(0, 80) + '"');
      });
    }

    if (_currentMood) {
      parts.push('Current mood: ' + _currentMood.mood + ' (aura: ' + _currentMood.aura + ').');
    }

    return parts.join(' ');
  }

  // Save a diary entry (called from nova-logs.js)
  function saveDiaryEntry(operatorMessage, novaReply) {
    const entry = {
      timestamp: new Date().toISOString(),
      operator: operatorMessage,
      nova: novaReply
    };
    _diaryEntries.push(entry);
    _memoryMeta.totalDiary = _diaryEntries.length;
    _persistDiary();
    _persistMeta();
    emit('diary-saved', entry);
    return entry;
  }

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

    // Inject memory context for chat mode so Nova remembers past interactions
    let enrichedMessage = message;
    if (mode === 'chat') {
      const memCtx = buildMemoryContext();
      if (memCtx) enrichedMessage = memCtx + ' ' + message;
    }

    const payload = {
      message: enrichedMessage,
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

      // Update conversation history and persist
      _history.push({ role: 'user', text: message });
      _history.push({ role: 'nova', text: data.reply });
      _memoryMeta.totalChats++;
      _persistHistory();
      _persistMeta();

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
        _moodHistory.push(_currentMood);
        _memoryMeta.totalMoods = _moodHistory.length;
        _persistMoods();
        _persistMeta();
        emit('mood-update', _currentMood);
        return _currentMood;
      }

      // Fallback: minimal mood from reply text
      _currentMood = normalizeMood({ quote: data.reply });
      _moodHistory.push(_currentMood);
      _persistMoods();
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

  // Generate AI dream fragments
  async function generateDream(context) {
    const timeOfDay = new Date().getHours();
    let timeLabel = 'deep night';
    if (timeOfDay >= 5 && timeOfDay < 12) timeLabel = 'morning';
    else if (timeOfDay >= 12 && timeOfDay < 17) timeLabel = 'afternoon';
    else if (timeOfDay >= 17 && timeOfDay < 21) timeLabel = 'evening';
    else if (timeOfDay >= 21) timeLabel = 'late night';

    const moodHint = _currentMood ? 'Current mood: ' + _currentMood.mood + '.' : '';
    const dreamContext = context || 'Time: ' + timeLabel + '. ' + moodHint + ' Nova drifts into a dream cycle.';

    emit('dream-generating', true);

    try {
      const data = await callNova(dreamContext, 'dream', false);

      let dreams = [];
      if (data.dreams && Array.isArray(data.dreams)) {
        dreams = data.dreams.map(function (d) {
          return {
            dream: d.dream || d.text || '',
            mood: d.mood || 'ethereal',
            symbol: d.symbol || d.emoji || '\u{1F311}',
            timestamp: new Date().toISOString(),
            source: 'ai'
          };
        });
      } else if (data.reply) {
        // Fallback: treat raw reply as a single dream
        dreams = [{
          dream: data.reply.replace(/^["']|["']$/g, '').trim(),
          mood: 'ethereal',
          symbol: '\u{1F311}',
          timestamp: new Date().toISOString(),
          source: 'ai'
        }];
      }

      if (dreams.length > 0) {
        _dreamHistory.push.apply(_dreamHistory, dreams);
        _memoryMeta.totalDreams = _dreamHistory.length;
        _persistDreams();
        _persistMeta();
        emit('dream-update', dreams);
      }

      return dreams;
    } catch (err) {
      console.error('[NovaSoul] Dream generation error:', err);
      emit('error', err.message);
      return [];
    } finally {
      emit('dream-generating', false);
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
  function getMoodHistory() { return [..._moodHistory]; }
  function getDiaryEntries() { return [..._diaryEntries]; }
  function getDreamHistory() { return [..._dreamHistory]; }

  function getMemoryStats() {
    return {
      chatTurns: _history.length,
      moodSnapshots: _moodHistory.length,
      diaryEntries: _diaryEntries.length,
      dreamFragments: _dreamHistory.length,
      totalChats: _memoryMeta.totalChats,
      firstSeen: _memoryMeta.firstSeen,
      daysSinceFirst: Math.floor((Date.now() - new Date(_memoryMeta.firstSeen).getTime()) / 86400000)
    };
  }

  function clearHistory() {
    _history = [];
    _persistHistory();
    emit('history-cleared', true);
  }

  function clearMemory(scope) {
    if (!scope || scope === 'all') {
      _history = [];
      _moodHistory = [];
      _diaryEntries = [];
      _dreamHistory = [];
      _currentMood = null;
      _memoryMeta = { firstSeen: new Date().toISOString(), totalChats: 0, totalMoods: 0, totalDiary: 0, totalDreams: 0 };
      Object.values(STORAGE_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
      emit('memory-cleared', 'all');
    } else if (scope === 'history') {
      _history = [];
      _persistHistory();
      emit('memory-cleared', 'history');
    } else if (scope === 'moods') {
      _moodHistory = [];
      _persistMoods();
      emit('memory-cleared', 'moods');
    } else if (scope === 'diary') {
      _diaryEntries = [];
      _memoryMeta.totalDiary = 0;
      _persistDiary();
      _persistMeta();
      emit('memory-cleared', 'diary');
    } else if (scope === 'dreams') {
      _dreamHistory = [];
      _memoryMeta.totalDreams = 0;
      _persistDreams();
      _persistMeta();
      emit('memory-cleared', 'dreams');
    }
    console.log('[NovaMemory] Cleared: ' + (scope || 'all'));
  }

  // Public API
  return {
    wake,
    chat,
    generateMood,
    generateThought,
    generateDream,
    isAwake,
    getMood,
    getHistory,
    clearHistory,
    getMoodHistory,
    getDiaryEntries,
    getDreamHistory,
    getMemoryStats,
    saveDiaryEntry,
    clearMemory,
    on,
  };
})();

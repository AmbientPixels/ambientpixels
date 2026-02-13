// agent-engine.js — AmbientPixels Multi-Agent Client Engine
// Manages communication with the agentchat API for all company agents

var AgentEngine = (function () {
  'use strict';

  var STORAGE_PREFIX = 'ap_agent_';
  var MAX_HISTORY = 30;
  var _agents = {};
  var _registry = null;
  var _listeners = {};

  // ── Event system ──
  function on(event, callback) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(callback);
  }

  function emit(event, data) {
    if (_listeners[event]) {
      _listeners[event].forEach(function (cb) { cb(data); });
    }
  }

  // ── Storage helpers ──
  function _loadStorage(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function _saveStorage(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('[AgentEngine] Storage save failed:', key, e);
    }
  }

  // ── Agent state management ──
  function _getAgentState(agentId) {
    if (!_agents[agentId]) {
      _agents[agentId] = {
        history: _loadStorage(STORAGE_PREFIX + agentId + '_history', []),
        lastActive: _loadStorage(STORAGE_PREFIX + agentId + '_lastActive', null)
      };
    }
    return _agents[agentId];
  }

  function _persistAgentHistory(agentId) {
    var state = _getAgentState(agentId);
    if (state.history.length > MAX_HISTORY) {
      state.history = state.history.slice(-MAX_HISTORY);
    }
    _saveStorage(STORAGE_PREFIX + agentId + '_history', state.history);
    _saveStorage(STORAGE_PREFIX + agentId + '_lastActive', new Date().toISOString());
  }

  // ── API endpoint resolution ──
  function getEndpoint() {
    return window.location.hostname.includes('ambientpixels.ai')
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api/agentchat'
      : '/api/agentchat';
  }

  // ── Load agent registry ──
  function loadRegistry() {
    if (_registry) return Promise.resolve(_registry);

    return fetch('/data/company-agents.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        _registry = data;
        emit('registry-loaded', data);
        return data;
      })
      .catch(function (err) {
        console.error('[AgentEngine] Failed to load agent registry:', err);
        return null;
      });
  }

  function getRegistry() {
    return _registry;
  }

  function getAgent(agentId) {
    if (!_registry) return null;
    return _registry.agents.find(function (a) { return a.id === agentId; }) || null;
  }

  // ── Chat with an agent ──
  function chat(agentId, message, mode) {
    var state = _getAgentState(agentId);

    // Add user turn to local history
    state.history.push({ role: 'user', text: message, timestamp: new Date().toISOString() });

    emit('thinking', { agentId: agentId, thinking: true });

    var payload = {
      agentId: agentId,
      message: message,
      mode: mode || 'chat',
      history: state.history.slice(-10) // send last 10 turns for context
    };

    return fetch(getEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Agent API returned ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var reply = data.reply || '';

      // Add agent reply to local history
      state.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      _persistAgentHistory(agentId);

      emit('response', { agentId: agentId, reply: reply, mode: data.mode });
      emit('thinking', { agentId: agentId, thinking: false });

      return reply;
    })
    .catch(function (err) {
      console.error('[AgentEngine] Chat error with ' + agentId + ':', err);
      emit('error', { agentId: agentId, error: err.message });
      emit('thinking', { agentId: agentId, thinking: false });
      return null;
    });
  }

  // ── Get agent chat history ──
  function getHistory(agentId) {
    return _getAgentState(agentId).history;
  }

  // ── Clear agent history ──
  function clearHistory(agentId) {
    var state = _getAgentState(agentId);
    state.history = [];
    _persistAgentHistory(agentId);
    emit('history-cleared', { agentId: agentId });
  }

  // ── Ping the agent service ──
  function ping() {
    return fetch(getEndpoint(), { method: 'GET' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        emit('ping', data);
        return data;
      })
      .catch(function (err) {
        console.error('[AgentEngine] Ping failed:', err);
        return null;
      });
  }

  // ── Get activity summary across all agents ──
  function getActivitySummary() {
    var summary = [];
    if (!_registry) return summary;

    _registry.agents.forEach(function (agent) {
      var state = _getAgentState(agent.id);
      summary.push({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        department: agent.department,
        color: agent.color,
        icon: agent.icon,
        messageCount: state.history.length,
        lastActive: state.lastActive || _loadStorage(STORAGE_PREFIX + agent.id + '_lastActive', null)
      });
    });

    return summary;
  }

  // ── Public API ──
  return {
    on: on,
    loadRegistry: loadRegistry,
    getRegistry: getRegistry,
    getAgent: getAgent,
    chat: chat,
    getHistory: getHistory,
    clearHistory: clearHistory,
    ping: ping,
    getActivitySummary: getActivitySummary
  };
})();

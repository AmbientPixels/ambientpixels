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
  // Delegates through CompanyStore when available (server + local cache),
  // falls back to raw localStorage otherwise. All calls remain synchronous
  // to preserve existing public API contracts.

  function _loadStorage(key, fallback) {
    if (typeof CompanyStore !== 'undefined' && CompanyStore.getStateSync) {
      return CompanyStore.getStateSync(key, fallback);
    }
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function _saveStorage(key, data) {
    if (typeof CompanyStore !== 'undefined' && CompanyStore.setStateSync) {
      // Always write to localStorage immediately for responsive UI
      CompanyStore.setStateSync(key, data);
      // For array data in server mode, merge with server to prevent overwriting
      // heartbeat-created items that aren't in localStorage yet
      if (Array.isArray(data) && CompanyStore.getMode() === 'server' && CompanyStore.getState) {
        CompanyStore.getState(key).then(function (serverData) {
          if (Array.isArray(serverData) && serverData.length > 0) {
            var localIds = {};
            data.forEach(function (item) { if (item && item.id) localIds[item.id] = true; });
            var merged = data.slice();
            var added = 0;
            serverData.forEach(function (item) {
              if (item && item.id && !localIds[item.id]) {
                merged.push(item);
                added++;
              }
            });
            if (added > 0) {
              console.log('[AgentEngine] Merged ' + added + ' server-only items into ' + key);
              CompanyStore.setStateSync(key, merged);
            }
          }
        }).catch(function () { /* server fetch failed, local write already done */ });
      }
      return;
    }
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

    // Init CompanyStore in parallel (non-blocking server probe + sync)
    if (typeof CompanyStore !== 'undefined' && CompanyStore.init) {
      CompanyStore.init().then(function () {
        emit('store-ready', { mode: CompanyStore.getMode() });
        // Pull server state into localStorage so agent-created data shows up
        return CompanyStore.syncFromServer();
      }).then(function () {
        emit('sync-complete', { mode: CompanyStore.getMode() });
        // Periodic sync: keep localStorage fresh every 60s while page is open
        if (CompanyStore.getMode() === 'server') {
          setInterval(function () {
            CompanyStore.syncFromServer().then(function () {
              emit('sync-complete', { mode: 'server', source: 'periodic' });
            });
          }, 60000);
        }
      });
    }

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
      var actions = data.actions || [];

      // Add agent reply to local history
      state.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      _persistAgentHistory(agentId);

      // Track metrics
      _trackCall(agentId, mode || 'chat', message, reply);

      emit('response', { agentId: agentId, reply: reply, actions: actions, mode: data.mode });
      emit('thinking', { agentId: agentId, thinking: false });

      // Re-sync from server if actions were executed so localStorage reflects changes
      if (actions.length > 0 && typeof CompanyStore !== 'undefined' && CompanyStore.syncFromServer) {
        CompanyStore.syncFromServer().then(function () {
          emit('sync-complete', { mode: CompanyStore.getMode(), source: 'chat-action' });
        });
      }

      return { reply: reply, actions: actions };
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

  // ── Metrics & Session Tracking ──
  var METRICS_KEY = 'ap_metrics';
  var SESSION_LOG_KEY = 'ap_session_log';
  var CRON_LOG_KEY = 'ap_cron_log';
  var MAX_SESSIONS = 100;
  var MAX_CRON = 50;

  // Gemini 2.0 Flash pricing (per 1M tokens)
  var PRICING = {
    model: 'gemini-2.0-flash',
    inputPer1M: 0.10,
    outputPer1M: 0.40
  };

  function _loadMetrics() {
    return _loadStorage(METRICS_KEY, {
      totalSessions: 0,
      totalMessages: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      firstUsed: null,
      lastUsed: null
    });
  }

  function _saveMetrics(m) {
    _saveStorage(METRICS_KEY, m);
  }

  // Rough token estimate: ~4 chars per token for English
  function _estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  function _estimateCost(inputTokens, outputTokens) {
    return ((inputTokens / 1000000) * PRICING.inputPer1M) +
           ((outputTokens / 1000000) * PRICING.outputPer1M);
  }

  // Track a completed API call
  function _trackCall(agentId, mode, inputText, outputText) {
    var metrics = _loadMetrics();
    var inputTokens = _estimateTokens(inputText);
    var outputTokens = _estimateTokens(outputText);
    var cost = _estimateCost(inputTokens, outputTokens);

    metrics.totalMessages += 1;
    metrics.totalInputTokens += inputTokens;
    metrics.totalOutputTokens += outputTokens;
    metrics.totalCost += cost;
    metrics.lastUsed = new Date().toISOString();
    if (!metrics.firstUsed) metrics.firstUsed = metrics.lastUsed;

    _saveMetrics(metrics);

    // Log session entry
    var sessions = _loadStorage(SESSION_LOG_KEY, []);
    sessions.push({
      id: 'call-' + Date.now(),
      agentId: agentId,
      mode: mode,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      cost: cost,
      timestamp: new Date().toISOString()
    });
    if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(-MAX_SESSIONS);
    _saveStorage(SESSION_LOG_KEY, sessions);

    emit('metrics-update', { metrics: metrics, latest: sessions[sessions.length - 1] });
  }

  // Log a cron/automation event
  function logCron(agentId, taskName, result) {
    var log = _loadStorage(CRON_LOG_KEY, []);
    log.push({
      agentId: agentId,
      task: taskName,
      result: result || 'completed',
      timestamp: new Date().toISOString()
    });
    if (log.length > MAX_CRON) log = log.slice(-MAX_CRON);
    _saveStorage(CRON_LOG_KEY, log);
    emit('cron-logged', log[log.length - 1]);
  }

  function getMetrics() {
    return _loadMetrics();
  }

  function getSessionLog() {
    return _loadStorage(SESSION_LOG_KEY, []);
  }

  function getCronLog() {
    return _loadStorage(CRON_LOG_KEY, []);
  }

  function getModelFleet() {
    return [{
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      provider: 'Google',
      status: 'active',
      usage: 'All agents — chat, standup, tasks, reports',
      inputPrice: '$0.10 / 1M tokens',
      outputPrice: '$0.40 / 1M tokens'
    }];
  }

  // Get per-agent session breakdown
  function getAgentSessionStats() {
    var sessions = _loadStorage(SESSION_LOG_KEY, []);
    var stats = {};

    sessions.forEach(function (s) {
      if (!stats[s.agentId]) {
        stats[s.agentId] = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, lastCall: null };
      }
      stats[s.agentId].calls += 1;
      stats[s.agentId].inputTokens += s.inputTokens;
      stats[s.agentId].outputTokens += s.outputTokens;
      stats[s.agentId].cost += s.cost;
      stats[s.agentId].lastCall = s.timestamp;
    });

    return stats;
  }

  // Get active (recent) and idle agents
  function getAgentStatuses() {
    var result = { active: [], idle: [] };
    if (!_registry) return result;

    var agentStats = getAgentSessionStats();
    var fiveMinAgo = Date.now() - (5 * 60 * 1000);

    _registry.agents.forEach(function (agent) {
      var stat = agentStats[agent.id];
      var lastActive = stat && stat.lastCall ? new Date(stat.lastCall).getTime() : 0;

      if (lastActive > fiveMinAgo || (_standupRunning && true)) {
        result.active.push({ agent: agent, stat: stat });
      } else {
        result.idle.push({ agent: agent, stat: stat });
      }
    });

    return result;
  }

  // Overnight log — all activity since midnight
  function getOvernightLog() {
    var sessions = _loadStorage(SESSION_LOG_KEY, []);
    var standups = _loadStandupLog();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayMs = today.getTime();

    return {
      sessions: sessions.filter(function (s) { return new Date(s.timestamp).getTime() >= todayMs; }),
      standups: standups.filter(function (s) { return new Date(s.date).getTime() >= todayMs; })
    };
  }

  // ── Daily Standup System ──
  var STANDUP_KEY = 'ap_standup_log';
  var STANDUP_DATE_KEY = 'ap_standup_last_date';
  var MAX_STANDUPS = 14; // keep 2 weeks of standups
  var _standupRunning = false;

  // Standup speaking order: Prime Operator opens, dept heads report, Prime Operator closes
  var STANDUP_ORDER = ['nova', 'forge', 'pixel', 'cipher', 'echo', 'scribe', 'scout', 'nova'];

  function _loadStandupLog() {
    return _loadStorage(STANDUP_KEY, []);
  }

  function _saveStandupLog(log) {
    if (log.length > MAX_STANDUPS) log = log.slice(-MAX_STANDUPS);
    _saveStorage(STANDUP_KEY, log);
  }

  function hasStandupToday() {
    var today = new Date().toISOString().split('T')[0];
    // Fast path: check localStorage flag
    var lastDate = localStorage.getItem(STANDUP_DATE_KEY);
    if (lastDate === today) return true;
    // Fallback: check actual standup log (survives cache clears via server sync)
    var log = _loadStandupLog();
    if (log.length > 0 && log[log.length - 1].dateLabel === today) {
      try { localStorage.setItem(STANDUP_DATE_KEY, today); } catch (e) {}
      return true;
    }
    return false;
  }

  function getStandupLog() {
    return _loadStandupLog();
  }

  function getLatestStandup() {
    var log = _loadStandupLog();
    return log.length > 0 ? log[log.length - 1] : null;
  }

  // Run a full standup — each agent speaks in turn, seeing previous responses
  function runStandup() {
    if (_standupRunning) {
      console.warn('[AgentEngine] Standup already in progress.');
      return Promise.resolve(null);
    }
    if (!_registry) {
      console.error('[AgentEngine] Registry not loaded. Call loadRegistry() first.');
      return Promise.resolve(null);
    }

    _standupRunning = true;
    var standup = {
      id: 'standup-' + Date.now(),
      date: new Date().toISOString(),
      dateLabel: new Date().toISOString().split('T')[0],
      entries: [],
      status: 'in-progress'
    };

    emit('standup-start', standup);

    var transcript = ''; // Running context for each agent

    // Sequential chain: each agent gets previous agents' updates
    var chain = Promise.resolve();

    STANDUP_ORDER.forEach(function (agentId, index) {
      chain = chain.then(function () {
        var agent = getAgent(agentId);
        if (!agent) return;

        // Build context message
        var context = '';
        if (index === 0) {
          context = 'You are opening today\'s standup as Prime Operator. Set the agenda, state top priorities, and flag anything the team needs to address. No one else has spoken yet.';
        } else if (agentId === 'nova' && index > 0) {
          context = 'You are closing the standup as Prime Operator. Summarize what the team reported, flag items that need CEO attention or escalation, assign follow-ups, and note anything for the CEO briefing. Here are the team updates:\n\n' + transcript;
        } else {
          context = 'Here are the updates from team members who already spoke:\n\n' + transcript;
        }

        emit('standup-agent-thinking', { agentId: agentId, agent: agent });

        return _standupCall(agentId, context).then(function (reply) {
          var entry = {
            agentId: agentId,
            name: agent.name,
            role: agent.role,
            color: agent.color,
            icon: agent.icon,
            reply: reply || '(no response)',
            timestamp: new Date().toISOString()
          };

          standup.entries.push(entry);
          transcript += agent.name + ' (' + agent.role + '): ' + (reply || '(no response)') + '\n\n';

          emit('standup-agent-done', entry);
        });
      });
    });

    return chain.then(function () {
      standup.status = 'complete';
      _standupRunning = false;

      // Save to log
      var log = _loadStandupLog();
      log.push(standup);
      _saveStandupLog(log);

      // Mark today as done
      localStorage.setItem(STANDUP_DATE_KEY, standup.dateLabel);

      emit('standup-complete', standup);
      return standup;
    }).catch(function (err) {
      console.error('[AgentEngine] Standup failed:', err);
      standup.status = 'failed';
      _standupRunning = false;
      emit('standup-error', { error: err.message, standup: standup });
      return standup;
    });
  }

  // Internal: call agentchat in standup mode (no local history tracking)
  function _standupCall(agentId, contextMessage) {
    var payload = {
      agentId: agentId,
      message: contextMessage,
      mode: 'standup',
      history: []
    };

    return fetch(getEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Standup API returned ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var reply = data.reply || '';
      _trackCall(agentId, 'standup', contextMessage, reply);
      return reply;
    })
    .catch(function (err) {
      console.error('[AgentEngine] Standup call failed for ' + agentId + ':', err);
      return null;
    });
  }

  function isStandupRunning() {
    return _standupRunning;
  }

  // ── Workspace: Shared Memory ──
  var MEMORY_KEY = 'ap_workspace_memory';
  var MAX_MEMORIES = 200;

  function getMemories() {
    return _loadStorage(MEMORY_KEY, []);
  }

  function addMemory(entry) {
    var memories = getMemories();
    var item = {
      id: 'mem-' + Date.now(),
      type: entry.type || 'note',       // note, conversation, date, decision, milestone
      title: entry.title || '',
      description: entry.description || '',
      content: entry.content || '',
      priority: entry.priority || 'medium', // low, medium, high, critical
      source: entry.source || 'ceo',       // ceo, agent, research, external, meeting
      agentId: entry.agentId || null,    // null = shared, or agent-specific
      tags: entry.tags || [],
      pinned: entry.pinned || false,
      timestamp: new Date().toISOString()
    };
    memories.push(item);
    if (memories.length > MAX_MEMORIES) memories = memories.slice(-MAX_MEMORIES);
    _saveStorage(MEMORY_KEY, memories);
    emit('memory-added', item);
    return item;
  }

  function updateMemory(id, updates) {
    var memories = getMemories();
    var idx = -1;
    for (var i = 0; i < memories.length; i++) {
      if (memories[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return null;
    Object.keys(updates).forEach(function (k) { memories[idx][k] = updates[k]; });
    memories[idx].updatedAt = new Date().toISOString();
    _saveStorage(MEMORY_KEY, memories);
    emit('memory-updated', memories[idx]);
    return memories[idx];
  }

  function deleteMemory(id) {
    var memories = getMemories().filter(function (m) { return m.id !== id; });
    _saveStorage(MEMORY_KEY, memories);
    emit('memory-deleted', { id: id });
  }

  // ── Workspace: Agent Config (personality, heartbeat, role overrides) ──
  var AGENT_CONFIG_KEY = 'ap_agent_configs';

  function getAgentConfigs() {
    return _loadStorage(AGENT_CONFIG_KEY, {});
  }

  function getAgentConfig(agentId) {
    var configs = getAgentConfigs();
    if (!configs[agentId]) {
      // Bootstrap defaults from registry
      var agent = getAgent(agentId);
      configs[agentId] = {
        personality: {
          tone: 'default',
          formality: 'adaptive',
          humor: 'moderate',
          verbosity: 'concise',
          customTraits: ''
        },
        heartbeat: {
          enabled: true,
          intervalMinutes: 60,
          lastBeat: null,
          status: 'idle'
        },
        roleOverride: null,          // null = use registry default
        titleOverride: null,
        systemPromptOverride: null,   // null = use registry default
        notes: '',
        updatedAt: null
      };
      _saveStorage(AGENT_CONFIG_KEY, configs);
    }
    return configs[agentId];
  }

  function updateAgentConfig(agentId, updates) {
    var configs = getAgentConfigs();
    var current = getAgentConfig(agentId);
    // Deep merge for nested objects
    Object.keys(updates).forEach(function (k) {
      if (typeof updates[k] === 'object' && updates[k] !== null && !Array.isArray(updates[k]) && current[k]) {
        Object.keys(updates[k]).forEach(function (subK) {
          current[k][subK] = updates[k][subK];
        });
      } else {
        current[k] = updates[k];
      }
    });
    current.updatedAt = new Date().toISOString();
    configs[agentId] = current;
    _saveStorage(AGENT_CONFIG_KEY, configs);
    emit('agent-config-updated', { agentId: agentId, config: current });
    return current;
  }

  // Record heartbeat for an agent
  function recordHeartbeat(agentId) {
    updateAgentConfig(agentId, { heartbeat: { lastBeat: new Date().toISOString(), status: 'alive' } });
  }

  // ── Workspace: Company Identity ──
  var IDENTITY_KEY = 'ap_workspace_identity';

  function getIdentity() {
    var defaults = {
      companyName: 'AmbientPixels',
      tagline: 'Creative-tech studio powered by AI agents',
      founder: 'Chad Martin',
      founded: '2024',
      mission: 'Build creative tools and experiences powered by AI agents working as a team.',
      brandVoice: 'Warm, direct, creative. Technical but not cold. Human-first.',
      primaryColor: '#8A2BE2',
      values: ['creativity', 'quality', 'autonomy', 'transparency'],
      updatedAt: null
    };
    return _loadStorage(IDENTITY_KEY, defaults);
  }

  function updateIdentity(updates) {
    var identity = getIdentity();
    Object.keys(updates).forEach(function (k) { identity[k] = updates[k]; });
    identity.updatedAt = new Date().toISOString();
    _saveStorage(IDENTITY_KEY, identity);
    emit('identity-updated', identity);
    return identity;
  }

  // ── Workspace: Tools Registry ──
  var TOOLS_KEY = 'ap_workspace_tools';

  function getTools() {
    return _loadStorage(TOOLS_KEY, [
      { id: 'agent-chat', name: 'Agent Chat', icon: 'fas fa-comment', url: '/modules/company/agent-chat.html', category: 'communication', status: 'active', description: 'Chat with any agent individually' },
      { id: 'daily-standup', name: 'Daily Standup', icon: 'fas fa-users', url: '/modules/company/', category: 'coordination', status: 'active', description: 'Run daily team standup meetings' },
      { id: 'task-manager', name: 'Task Manager', icon: 'fas fa-tachometer-alt', url: '/modules/company/dashboard.html', category: 'monitoring', status: 'active', description: 'Monitor sessions, tokens, costs, and logs' },
      { id: 'org-chart', name: 'Org Chart', icon: 'fas fa-sitemap', url: '/modules/company/', category: 'structure', status: 'active', description: 'View company structure and agent roles' },
      { id: 'nova-nexus', name: 'Nova Nexus', icon: 'fas fa-brain', url: '/nova/', category: 'ai-core', status: 'active', description: 'Nova\'s sentient dashboard — mood, dreams, awareness' },
      { id: 'cardforge', name: 'CardForge', icon: 'fas fa-id-card', url: '/cardforge/', category: 'creative-tools', status: 'active', description: 'Trading card creator with AI generation' }
    ]);
  }

  function addTool(tool) {
    var tools = getTools();
    tool.id = tool.id || 'tool-' + Date.now();
    tool.status = tool.status || 'active';
    tools.push(tool);
    _saveStorage(TOOLS_KEY, tools);
    emit('tool-added', tool);
    return tool;
  }

  function updateTool(id, updates) {
    var tools = getTools();
    for (var i = 0; i < tools.length; i++) {
      if (tools[i].id === id) {
        Object.keys(updates).forEach(function (k) { tools[i][k] = updates[k]; });
        _saveStorage(TOOLS_KEY, tools);
        emit('tool-updated', tools[i]);
        return tools[i];
      }
    }
    return null;
  }

  function deleteTool(id) {
    var tools = getTools().filter(function (t) { return t.id !== id; });
    _saveStorage(TOOLS_KEY, tools);
    emit('tool-deleted', { id: id });
  }

  // ── Workspace: Important Dates ──
  var DATES_KEY = 'ap_workspace_dates';

  function getDates() {
    return _loadStorage(DATES_KEY, []);
  }

  function addDate(entry) {
    var dates = getDates();
    var item = {
      id: 'date-' + Date.now(),
      title: entry.title || '',
      date: entry.date || new Date().toISOString().split('T')[0],
      type: entry.type || 'event',   // event, deadline, milestone, recurring
      priority: entry.priority || 'medium', // low, medium, high, critical
      agentId: entry.agentId || null,
      notes: entry.notes || '',
      recurring: entry.recurring || false
    };
    dates.push(item);
    _saveStorage(DATES_KEY, dates);
    emit('date-added', item);
    return item;
  }

  function deleteDate(id) {
    var dates = getDates().filter(function (d) { return d.id !== id; });
    _saveStorage(DATES_KEY, dates);
    emit('date-deleted', { id: id });
  }

  function updateDate(id, updates) {
    var dates = getDates();
    var idx = -1;
    for (var i = 0; i < dates.length; i++) {
      if (dates[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return null;
    Object.keys(updates).forEach(function (k) { dates[idx][k] = updates[k]; });
    dates[idx].updatedAt = new Date().toISOString();
    _saveStorage(DATES_KEY, dates);
    emit('date-updated', dates[idx]);
    return dates[idx];
  }

  // ── Task Manager ──
  var TASKS_KEY = 'ap_tasks';
  var MAX_TASKS = 500;
  var TASK_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done'];
  var TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];

  function getTasks() {
    return _loadStorage(TASKS_KEY, []);
  }

  function getTask(id) {
    var tasks = getTasks();
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) return tasks[i];
    }
    return null;
  }

  function addTask(entry) {
    var tasks = getTasks();
    var task = {
      id: 'task-' + Date.now(),
      title: entry.title || 'Untitled Task',
      description: entry.description || '',
      status: entry.status || 'backlog',
      priority: entry.priority || 'medium',
      assignee: entry.assignee || null,        // agentId or null (unassigned)
      division: entry.division || null,         // division id
      tags: entry.tags || [],
      dueDate: entry.dueDate || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      comments: []
    };
    tasks.push(task);
    if (tasks.length > MAX_TASKS) tasks = tasks.slice(-MAX_TASKS);
    _saveStorage(TASKS_KEY, tasks);
    emit('task-added', task);
    return task;
  }

  function updateTask(id, updates) {
    var tasks = getTasks();
    var idx = -1;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return null;
    var oldStatus = tasks[idx].status;
    Object.keys(updates).forEach(function (k) {
      if (k === 'comments' || k === 'tags') return; // handled separately
      tasks[idx][k] = updates[k];
    });
    tasks[idx].updatedAt = new Date().toISOString();
    // Auto-set completedAt
    if (updates.status === 'done' && oldStatus !== 'done') {
      tasks[idx].completedAt = new Date().toISOString();
    } else if (updates.status && updates.status !== 'done') {
      tasks[idx].completedAt = null;
    }
    _saveStorage(TASKS_KEY, tasks);
    emit('task-updated', tasks[idx]);
    return tasks[idx];
  }

  function deleteTask(id) {
    var tasks = getTasks().filter(function (t) { return t.id !== id; });
    _saveStorage(TASKS_KEY, tasks);
    emit('task-deleted', { id: id });
  }

  function moveTask(id, newStatus) {
    return updateTask(id, { status: newStatus });
  }

  function addTaskComment(taskId, comment) {
    var tasks = getTasks();
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === taskId) {
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          text: comment.text || '',
          agentId: comment.agentId || null,
          timestamp: new Date().toISOString()
        });
        tasks[i].updatedAt = new Date().toISOString();
        _saveStorage(TASKS_KEY, tasks);
        emit('task-comment-added', { taskId: taskId, comment: tasks[i].comments[tasks[i].comments.length - 1] });
        return tasks[i];
      }
    }
    return null;
  }

  function getTasksByStatus(status) {
    return getTasks().filter(function (t) { return t.status === status; });
  }

  function getTasksByAssignee(agentId) {
    return getTasks().filter(function (t) { return t.assignee === agentId; });
  }

  function getTaskStats() {
    var tasks = getTasks();
    var stats = { total: tasks.length, backlog: 0, todo: 0, 'in-progress': 0, review: 0, done: 0, overdue: 0, unassigned: 0 };
    var now = new Date().toISOString().split('T')[0];
    tasks.forEach(function (t) {
      if (stats[t.status] !== undefined) stats[t.status]++;
      if (!t.assignee) stats.unassigned++;
      if (t.dueDate && t.dueDate < now && t.status !== 'done') stats.overdue++;
    });
    return stats;
  }

  // ── Governance: Directives ──
  var DIRECTIVES_KEY = 'ap_directives';
  function getDirectives() { return _loadStorage(DIRECTIVES_KEY, []); }
  function addDirective(dir) {
    var list = getDirectives();
    if (!dir.id) dir.id = 'dir-' + Date.now();
    if (!dir.createdDate) dir.createdDate = new Date().toISOString();
    if (!dir.status) dir.status = 'active';
    if (!dir.linkedObjectives) dir.linkedObjectives = [];
    if (!dir.linkedTasks) dir.linkedTasks = [];
    list.push(dir);
    _saveStorage(DIRECTIVES_KEY, list);
    _logGovernance('directive-created', { directiveId: dir.id, title: dir.title });
    return dir;
  }
  function updateDirective(id, updates) {
    var list = getDirectives();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        Object.keys(updates).forEach(function (k) { if (k !== 'id') list[i][k] = updates[k]; });
        _saveStorage(DIRECTIVES_KEY, list);
        return list[i];
      }
    }
    return null;
  }

  // ── Governance: Objectives ──
  var OBJECTIVES_KEY = 'ap_objectives';
  function getObjectives() { return _loadStorage(OBJECTIVES_KEY, []); }
  function addObjective(obj) {
    var list = getObjectives();
    if (!obj.id) obj.id = 'obj-' + Date.now();
    if (!obj.status) obj.status = 'on_track';
    if (!obj.progressPercentage) obj.progressPercentage = 0;
    if (!obj.owner) obj.owner = 'nova';
    if (!obj.linkedTasks) obj.linkedTasks = [];
    list.push(obj);
    _saveStorage(OBJECTIVES_KEY, list);
    _logGovernance('objective-created', { objectiveId: obj.id, title: obj.title });
    return obj;
  }
  function updateObjective(id, updates) {
    var list = getObjectives();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        Object.keys(updates).forEach(function (k) { if (k !== 'id') list[i][k] = updates[k]; });
        _saveStorage(OBJECTIVES_KEY, list);
        return list[i];
      }
    }
    return null;
  }

  // ── Governance: Approval Queue ──
  var APPROVAL_KEY = 'ap_approval_queue';
  function getApprovalQueue() { return _loadStorage(APPROVAL_KEY, []); }
  function _saveApprovalQueue(queue) { _saveStorage(APPROVAL_KEY, queue); }

  function submitForApproval(taskId, recommendation) {
    var task = getTask(taskId);
    if (!task) return null;
    var queue = getApprovalQueue();
    // Prevent duplicates
    if (queue.some(function (q) { return q.taskId === taskId && q.status === 'pending'; })) return null;
    var entry = {
      id: 'appr-' + Date.now(),
      taskId: taskId,
      taskTitle: task.title,
      originAgent: task.assignee || 'nova',
      riskLevel: task.risk_level || 'low',
      budgetImpact: task.budget_impact || 0,
      brandImpact: task.brand_impact || 'low',
      classification: task.classification || 'advisory',
      proposedDeadline: task.dueDate || null,
      recommendation: recommendation || '',
      status: 'pending',
      submittedAt: new Date().toISOString(),
      resolvedAt: null,
      ceoDecision: null
    };
    queue.push(entry);
    _saveApprovalQueue(queue);
    // Mark task as requiring approval
    updateTask(taskId, { requires_ceo_approval: true, escalated: true });
    _logGovernance('escalation', { taskId: taskId, title: task.title, classification: entry.classification });
    return entry;
  }

  function ceoApprove(approvalId, note) {
    var queue = getApprovalQueue();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === approvalId) {
        queue[i].status = 'approved';
        queue[i].resolvedAt = new Date().toISOString();
        queue[i].ceoDecision = 'approved';
        if (note) queue[i].ceoNote = note;
        _saveApprovalQueue(queue);
        // Unlock task
        updateTask(queue[i].taskId, { requires_ceo_approval: false, escalated: false });
        _logGovernance('ceo-approval', { taskId: queue[i].taskId, title: queue[i].taskTitle, note: note || '' });
        return queue[i];
      }
    }
    return null;
  }

  function ceoReject(approvalId, note) {
    var queue = getApprovalQueue();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === approvalId) {
        queue[i].status = 'rejected';
        queue[i].resolvedAt = new Date().toISOString();
        queue[i].ceoDecision = 'rejected';
        if (note) queue[i].ceoNote = note;
        _saveApprovalQueue(queue);
        _logGovernance('ceo-reject', { taskId: queue[i].taskId, title: queue[i].taskTitle, note: note || '' });
        return queue[i];
      }
    }
    return null;
  }

  function ceoRequestRevision(approvalId, note) {
    var queue = getApprovalQueue();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === approvalId) {
        queue[i].status = 'revision_requested';
        queue[i].resolvedAt = new Date().toISOString();
        queue[i].ceoDecision = 'revision_requested';
        if (note) queue[i].ceoNote = note;
        _saveApprovalQueue(queue);
        _logGovernance('ceo-revision', { taskId: queue[i].taskId, title: queue[i].taskTitle, note: note || '' });
        return queue[i];
      }
    }
    return null;
  }

  function ceoOverride(taskId) {
    var task = getTask(taskId);
    if (!task) return null;
    var prevClassification = task.classification || 'autonomous';
    updateTask(taskId, { requires_ceo_approval: false, escalated: false, classification: 'autonomous' });
    // Also resolve any pending approval for this task
    var queue = getApprovalQueue();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].taskId === taskId && queue[i].status === 'pending') {
        queue[i].status = 'overridden';
        queue[i].resolvedAt = new Date().toISOString();
        queue[i].ceoDecision = 'override';
      }
    }
    _saveApprovalQueue(queue);
    _logGovernance('ceo-override', { taskId: taskId, title: task.title, previousClassification: prevClassification, riskLevel: task.risk_level || 'low' });
    return task;
  }

  // ── Governance Log ──
  var GOVERNANCE_LOG_KEY = 'ap_governance_log';
  function getGovernanceLog() { return _loadStorage(GOVERNANCE_LOG_KEY, []); }
  function _logGovernance(type, data) {
    var log = getGovernanceLog();
    log.push({
      id: 'gov-' + Date.now(),
      type: type,
      data: data,
      timestamp: new Date().toISOString()
    });
    if (log.length > 200) log = log.slice(-200);
    _saveStorage(GOVERNANCE_LOG_KEY, log);
  }

  // ── Action Layer v1 (nested model) ──
  var ACTION_QUEUE_KEY = 'ap_action_queue';
  var ACTIONS_KEY = 'ap_actions';
  var ACTION_AUDIT_KEY = 'ap_action_audit_log';
  var ACTION_RATE_KEY = 'ap_action_rate_counts';

  function getActions() { return _loadStorage(ACTIONS_KEY, []); }
  function _saveActions(list) { _saveStorage(ACTIONS_KEY, list); }
  // Legacy compat — old UI reads from ap_action_queue
  function getActionQueue() { return getActions(); }
  function _saveActionQueue(list) { _saveActions(list); }
  function getActionAuditLog() { return _loadStorage(ACTION_AUDIT_KEY, []); }

  function _logAction(type, data) {
    var log = getActionAuditLog();
    log.push({
      id: 'alog-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      type: type,
      data: data,
      timestamp: new Date().toISOString()
    });
    if (log.length > 500) log = log.slice(-500);
    _saveStorage(ACTION_AUDIT_KEY, log);
  }

  // Rate limiting
  function _getRateCounts() { return _loadStorage(ACTION_RATE_KEY, {}); }
  function _saveRateCounts(counts) { _saveStorage(ACTION_RATE_KEY, counts); }

  function _checkRateLimit(category) {
    var counts = _getRateCounts();
    var today = new Date().toISOString().split('T')[0];
    if (!counts[today]) counts[today] = {};
    var todayCounts = counts[today];
    var current = todayCounts[category] || 0;
    var limits = (typeof CompanySchemas !== 'undefined') ? CompanySchemas.ACTION_RATE_LIMITS : { social: 10, email: 20, git: 15, azure: 5, content: 10 };
    var limit = limits[category] || 10;
    return { allowed: current < limit, current: current, limit: limit };
  }

  function _incrementRateCount(category) {
    var counts = _getRateCounts();
    var today = new Date().toISOString().split('T')[0];
    if (!counts[today]) counts[today] = {};
    counts[today][category] = (counts[today][category] || 0) + 1;
    var keys = Object.keys(counts).sort();
    while (keys.length > 7) { delete counts[keys.shift()]; }
    _saveRateCounts(counts);
  }

  function getRateLimitStatus() {
    var categories = ['social', 'email', 'git', 'azure', 'content'];
    var status = {};
    categories.forEach(function (cat) { status[cat] = _checkRateLimit(cat); });
    return status;
  }

  // Sync legacy fields on an action object
  function _syncLegacy(a) {
    a.execution_status = (a.approval && a.approval.status === 'approved' && a.execution && a.execution.status === 'success') ? 'success'
      : (a.approval && a.approval.status === 'approved' && a.execution && a.execution.status === 'failed') ? 'failed'
      : (a.execution && a.execution.status === 'running') ? 'running'
      : (a.approval && a.approval.status === 'approved') ? 'approved'
      : (a.approval && a.approval.status === 'rejected') ? 'rejected'
      : (a.approval && a.approval.status === 'overridden') ? 'approved'
      : 'pending';
    a.action_type = a.type;
    a.origin_agent = a.created_by;
    a.action_payload = a.payload;
    a.action_category = (typeof CompanySchemas !== 'undefined') ? CompanySchemas.getActionCategory(a.type) : 'unknown';
    a.requires_approval = a.requires_ceo_approval;
    return a;
  }

  // Create action + approval queue entry
  function createAction(data) {
    if (typeof CompanySchemas === 'undefined') return null;
    var action = CompanySchemas.createActionRequest(data);
    var cat = action.action_category;
    var rateCheck = _checkRateLimit(cat);
    if (!rateCheck.allowed) {
      action.execution.status = 'failed';
      action.execution.last_error = { code: 'RATE_LIMIT', message: 'Rate limit exceeded for ' + cat + ' (' + rateCheck.current + '/' + rateCheck.limit + ')' };
      _syncLegacy(action);
    }
    var list = getActions();
    list.push(action);
    _saveActions(list);
    // Also insert into CEO approval queue if requires approval
    if (action.requires_ceo_approval && action.approval.status === 'pending') {
      _addToApprovalQueue(action);
    }
    _logAction('action-created', { actionId: action.id, type: action.type, agent: action.created_by, platform: action.platform, requiresApproval: action.requires_ceo_approval });
    _logGovernance('action-created', { actionId: action.id, type: action.type, agent: action.created_by, platform: action.platform });
    return action;
  }

  // Insert action into existing CEO approval queue (kind:'action')
  function _addToApprovalQueue(action) {
    var queue = getApprovalQueue();
    queue.push({
      id: 'aq-' + action.id,
      kind: 'action',
      action_id: action.id,
      taskId: null,
      taskTitle: action.type + ' (' + action.platform + ')',
      originAgent: action.created_by,
      classification: action.classification,
      riskLevel: action.risk_level,
      budgetImpact: action.budget_impact,
      brandImpact: action.brand_impact,
      status: 'pending',
      timestamp: action.created_at,
      preview: (action.payload && action.payload.text) ? action.payload.text.substring(0, 120) : ''
    });
    _saveStorage(APPROVAL_KEY, queue);
  }

  function getAction(actionId) {
    var list = getActions();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === actionId) return list[i];
    }
    return null;
  }

  function getActionsByStatus(status) {
    return getActions().filter(function (a) { return a.execution_status === status; });
  }

  function getActionsByApprovalStatus(status) {
    return getActions().filter(function (a) { return a.approval && a.approval.status === status; });
  }

  // CEO approves an action
  function approveAction(actionId, note) {
    var list = getActions();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.id === actionId && a.approval && a.approval.status === 'pending') {
        a.approval.status = 'approved';
        a.approval.approved_by = 'Pixelpusher';
        a.approval.approved_at = new Date().toISOString();
        a.approval.decision_note = note || null;
        _syncLegacy(a);
        _saveActions(list);
        // Update approval queue entry
        _updateApprovalQueueForAction(actionId, 'approved');
        _logAction('action-approved', { actionId: actionId, type: a.type, platform: a.platform });
        _logGovernance('ceo-approval', { actionId: actionId, type: a.type, platform: a.platform, context: 'action' });
        return a;
      }
    }
    return null;
  }

  // CEO rejects an action
  function rejectAction(actionId, note) {
    var list = getActions();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.id === actionId && a.approval && a.approval.status === 'pending') {
        a.approval.status = 'rejected';
        a.approval.decision_note = note || null;
        a.execution.status = 'failed';
        a.execution.finished_at = new Date().toISOString();
        _syncLegacy(a);
        _saveActions(list);
        _updateApprovalQueueForAction(actionId, 'rejected');
        _logAction('action-rejected', { actionId: actionId, type: a.type });
        _logGovernance('ceo-reject', { actionId: actionId, type: a.type, context: 'action' });
        return a;
      }
    }
    return null;
  }

  // CEO requests revision on an action
  function requestActionRevision(actionId, note) {
    var list = getActions();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.id === actionId && a.approval && a.approval.status === 'pending') {
        a.approval.status = 'revision_requested';
        a.approval.decision_note = note || null;
        _syncLegacy(a);
        _saveActions(list);
        _updateApprovalQueueForAction(actionId, 'revision_requested');
        _logAction('action-revision', { actionId: actionId, type: a.type });
        _logGovernance('ceo-revision', { actionId: actionId, type: a.type, context: 'action' });
        return a;
      }
    }
    return null;
  }

  // CEO override on an action
  function overrideAction(actionId) {
    var list = getActions();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.id === actionId) {
        a.approval.status = 'overridden';
        a.approval.approved_by = 'Pixelpusher';
        a.approval.approved_at = new Date().toISOString();
        _syncLegacy(a);
        _saveActions(list);
        _updateApprovalQueueForAction(actionId, 'overridden');
        _logAction('action-overridden', { actionId: actionId, type: a.type });
        _logGovernance('ceo-override', { actionId: actionId, type: a.type, context: 'action' });
        return a;
      }
    }
    return null;
  }

  // Update matching approval queue entry status
  function _updateApprovalQueueForAction(actionId, status) {
    var queue = getApprovalQueue();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].action_id === actionId) {
        queue[i].status = status;
        break;
      }
    }
    _saveStorage(APPROVAL_KEY, queue);
  }

  // Mark action as running
  function markActionRunning(actionId) {
    var list = getActions();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.id === actionId && (a.approval.status === 'approved' || a.approval.status === 'overridden')) {
        a.execution.status = 'running';
        a.execution.started_at = new Date().toISOString();
        a.execution.attempts = (a.execution.attempts || 0) + 1;
        _syncLegacy(a);
        _saveActions(list);
        _logAction('action-running', { actionId: actionId, type: a.type });
        return a;
      }
    }
    return null;
  }

  // Complete action with receipt
  function completeAction(actionId, receipt) {
    var list = getActions();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.id === actionId && (a.execution.status === 'running' || a.execution.status === 'pending')) {
        a.execution.status = 'success';
        a.execution.finished_at = new Date().toISOString();
        a.execution.receipt = receipt || null;
        a.execution.last_error = null;
        _syncLegacy(a);
        _saveActions(list);
        _incrementRateCount(a.action_category);
        _logAction('action-success', { actionId: actionId, type: a.type, platform: a.platform, receipt: receipt });
        _logGovernance('action-success', { actionId: actionId, type: a.type, platform: a.platform });
        return a;
      }
    }
    return null;
  }

  // Fail action with error
  function failAction(actionId, error) {
    var list = getActions();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.id === actionId) {
        a.execution.status = 'failed';
        a.execution.finished_at = new Date().toISOString();
        a.execution.last_error = typeof error === 'object' ? error : { code: 'ERROR', message: error || 'Unknown error' };
        _syncLegacy(a);
        _saveActions(list);
        _logAction('action-failed', { actionId: actionId, type: a.type, error: error });
        _logGovernance('action-failed', { actionId: actionId, type: a.type });
        return a;
      }
    }
    return null;
  }

  // Approval bundling
  function approveBundle(bundleId) {
    var list = getActions();
    var approved = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].bundle_id === bundleId && list[i].approval && list[i].approval.status === 'pending') {
        list[i].approval.status = 'approved';
        list[i].approval.approved_by = 'Pixelpusher';
        list[i].approval.approved_at = new Date().toISOString();
        _syncLegacy(list[i]);
        approved.push(list[i]);
        _updateApprovalQueueForAction(list[i].id, 'approved');
        _logAction('action-approved', { actionId: list[i].id, type: list[i].type, bundle: bundleId });
      }
    }
    _saveActions(list);
    if (approved.length > 0) {
      _logGovernance('ceo-approval', { bundle: bundleId, count: approved.length, context: 'action-bundle' });
    }
    return approved;
  }

  // Autonomy Score
  function getAutonomyScore() {
    var tasks = getTasks();
    if (tasks.length === 0) return { score: 100, autonomous: 0, total: 0 };
    var doneTasks = tasks.filter(function (t) { return t.status === 'done'; });
    if (doneTasks.length === 0) return { score: 100, autonomous: 0, total: 0 };
    var autonomous = doneTasks.filter(function (t) {
      return !t.escalated && !t.requires_ceo_approval && (t.classification === 'autonomous' || !t.classification);
    }).length;
    return { score: Math.round((autonomous / doneTasks.length) * 100), autonomous: autonomous, total: doneTasks.length };
  }

  // Risk Heatmap
  function getRiskHeatmap() {
    var tasks = getTasks();
    var objectives = getObjectives();
    var govLog = getGovernanceLog();
    var highRisk = tasks.filter(function (t) { return t.risk_level === 'high' && t.status !== 'done'; });
    var medRisk = tasks.filter(function (t) { return t.risk_level === 'medium' && t.status !== 'done'; });
    var atRiskObjectives = objectives.filter(function (o) { return o.status === 'at_risk' || o.status === 'behind'; });
    var weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    var recentEscalations = govLog.filter(function (e) {
      return e.type === 'escalation' && new Date(e.timestamp).getTime() > weekAgo;
    });
    return {
      highRiskTasks: highRisk, medRiskTasks: medRisk,
      atRiskObjectives: atRiskObjectives,
      escalationFrequency: recentEscalations.length,
      escalationsPerDay: Math.round(recentEscalations.length / 7 * 10) / 10
    };
  }

  // Action stats
  function getActionStats() {
    var list = getActions();
    var pending = 0, approved = 0, running = 0, success = 0, failed = 0, rejected = 0, dryRun = 0;
    list.forEach(function (a) {
      var es = a.execution_status || 'pending';
      switch (es) {
        case 'pending': pending++; break;
        case 'approved': approved++; break;
        case 'running': running++; break;
        case 'success': success++; break;
        case 'failed': failed++; break;
        case 'rejected': rejected++; break;
        case 'dry_run': dryRun++; break;
      }
    });
    return { total: list.length, pending: pending, approved: approved, running: running, success: success, failed: failed, rejected: rejected, dryRun: dryRun };
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
    getActivitySummary: getActivitySummary,
    runStandup: runStandup,
    hasStandupToday: hasStandupToday,
    getStandupLog: getStandupLog,
    getLatestStandup: getLatestStandup,
    isStandupRunning: isStandupRunning,
    getMetrics: getMetrics,
    getSessionLog: getSessionLog,
    getCronLog: getCronLog,
    logCron: logCron,
    getModelFleet: getModelFleet,
    getAgentSessionStats: getAgentSessionStats,
    getAgentStatuses: getAgentStatuses,
    getOvernightLog: getOvernightLog,
    // Workspace
    getMemories: getMemories,
    addMemory: addMemory,
    updateMemory: updateMemory,
    deleteMemory: deleteMemory,
    getAgentConfig: getAgentConfig,
    getAgentConfigs: getAgentConfigs,
    updateAgentConfig: updateAgentConfig,
    recordHeartbeat: recordHeartbeat,
    getIdentity: getIdentity,
    updateIdentity: updateIdentity,
    getTools: getTools,
    addTool: addTool,
    updateTool: updateTool,
    deleteTool: deleteTool,
    getDates: getDates,
    addDate: addDate,
    deleteDate: deleteDate,
    updateDate: updateDate,
    // Tasks
    getTasks: getTasks,
    getTask: getTask,
    addTask: addTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
    moveTask: moveTask,
    addTaskComment: addTaskComment,
    getTasksByStatus: getTasksByStatus,
    getTasksByAssignee: getTasksByAssignee,
    getTaskStats: getTaskStats,
    // Store
    getMorningReport: function () {
      if (typeof CompanyStore !== 'undefined') return CompanyStore.getMorningReport();
      return Promise.resolve(_loadStorage('ap_morning_report', null));
    },
    getCompanyLogs: function (options) {
      if (typeof CompanyStore !== 'undefined') return CompanyStore.getLogs(options);
      return Promise.resolve([]);
    },
    getStoreMode: function () {
      if (typeof CompanyStore !== 'undefined') return CompanyStore.getMode();
      return 'local';
    },
    // Governance
    getDirectives: getDirectives,
    addDirective: addDirective,
    updateDirective: updateDirective,
    getObjectives: getObjectives,
    addObjective: addObjective,
    updateObjective: updateObjective,
    getApprovalQueue: getApprovalQueue,
    submitForApproval: submitForApproval,
    ceoApprove: ceoApprove,
    ceoReject: ceoReject,
    ceoRequestRevision: ceoRequestRevision,
    ceoOverride: ceoOverride,
    getGovernanceLog: getGovernanceLog,
    // Action Layer
    getActions: getActions,
    getActionQueue: getActionQueue,
    getAction: getAction,
    getActionsByStatus: getActionsByStatus,
    getActionsByApprovalStatus: getActionsByApprovalStatus,
    createAction: createAction,
    approveAction: approveAction,
    rejectAction: rejectAction,
    requestActionRevision: requestActionRevision,
    overrideAction: overrideAction,
    markActionRunning: markActionRunning,
    completeAction: completeAction,
    failAction: failAction,
    approveBundle: approveBundle,
    getActionAuditLog: getActionAuditLog,
    getRateLimitStatus: getRateLimitStatus,
    getActionStats: getActionStats,
    // Analytics
    getAutonomyScore: getAutonomyScore,
    getRiskHeatmap: getRiskHeatmap
  };
})();

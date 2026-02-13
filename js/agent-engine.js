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
      CompanyStore.setStateSync(key, data);
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

    // Init CompanyStore in parallel (non-blocking server probe)
    if (typeof CompanyStore !== 'undefined' && CompanyStore.init) {
      CompanyStore.init().then(function () {
        emit('store-ready', { mode: CompanyStore.getMode() });
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

      // Add agent reply to local history
      state.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      _persistAgentHistory(agentId);

      // Track metrics
      _trackCall(agentId, mode || 'chat', message, reply);

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

  // Standup speaking order: department heads first, CEO last to summarize
  var STANDUP_ORDER = ['cipher', 'pixel', 'forge', 'echo', 'nova'];

  function _loadStandupLog() {
    return _loadStorage(STANDUP_KEY, []);
  }

  function _saveStandupLog(log) {
    if (log.length > MAX_STANDUPS) log = log.slice(-MAX_STANDUPS);
    _saveStorage(STANDUP_KEY, log);
  }

  function hasStandupToday() {
    var lastDate = localStorage.getItem(STANDUP_DATE_KEY);
    var today = new Date().toISOString().split('T')[0];
    return lastDate === today;
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
          context = 'You are first to speak in today\'s standup. No one else has spoken yet.';
        } else if (agentId === 'nova') {
          context = 'You are the last to speak. As CEO, wrap up the standup — briefly summarize what the team said, call out anything important, and set the tone for the day. Here are the team updates so far:\n\n' + transcript;
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
      content: entry.content || '',
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
    }
  };
})();

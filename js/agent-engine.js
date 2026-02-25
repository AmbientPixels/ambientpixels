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

  // Business day helper — matches server-side getBusinessDate()
  // Configurable via localStorage 'ap_company_timezone', defaults to America/Los_Angeles
  var DEFAULT_TIMEZONE = 'America/Los_Angeles';
  function _getBusinessDate() {
    var tz = DEFAULT_TIMEZONE;
    try {
      var stored = localStorage.getItem('ap_company_timezone');
      if (stored) tz = stored;
      else if (window.CompanyStore) {
        var settings = CompanyStore.getStateSync('ap_company_settings');
        if (settings && settings.timezone) tz = settings.timezone;
      }
    } catch (e) { /* use default */ }
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var y = parts.find(function (p) { return p.type === 'year'; }).value;
      var m = parts.find(function (p) { return p.type === 'month'; }).value;
      var d = parts.find(function (p) { return p.type === 'day'; }).value;
      return y + '-' + m + '-' + d;
    } catch (e) {
      return new Date(Date.now() - 8 * 3600000).toISOString().split('T')[0];
    }
  }

  function hasStandupToday() {
    var today = _getBusinessDate();
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

  // Valid standup types and decision statuses
  var STANDUP_TYPES = ['Issue', 'Status', 'Directive', 'Launch', 'Cost', 'Brand', 'Strategy', 'Infrastructure', 'Experiment'];
  var DECISION_STATUSES = ['Pending', 'Approved', 'Rejected', 'Deferred', 'NoAction'];
  var IMPACT_EFFORT_ENUM = ['Low', 'Medium', 'High'];

  // Proposal limits (soft caps)
  var MAX_PROPOSED_TASKS_PER_AGENT = 3;
  var MAX_PROPOSED_DIRECTIVES_PER_STANDUP = 2; // unless Nova

  // Slugify helper for topicKey generation
  function _slugify(str) {
    if (!str) return '';
    return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);
  }

  // v2.4: Build preview text — strip markdown, newlines, truncate
  function buildPreview(text, maxLength) {
    if (!text) return '';
    maxLength = maxLength || 160;
    var clean = text
      .replace(/#{1,6}\s?/g, '')       // headings
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // bold/italic
      .replace(/`{1,3}[^`]*`{1,3}/g, '')        // code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links
      .replace(/[\r\n]+/g, ' ')         // newlines
      .replace(/\s{2,}/g, ' ')          // collapse spaces
      .trim();
    if (clean.length <= maxLength) return clean;
    return clean.substring(0, maxLength).replace(/\s+\S*$/, '') + '\u2026';
  }

  // Run a full standup — each agent speaks in turn, seeing previous responses
  // opts: { title, agenda, type, requestedOutputs, template }
  function runStandup(opts) {
    if (_standupRunning) {
      console.warn('[AgentEngine] Standup already in progress.');
      return Promise.resolve(null);
    }
    if (!_registry) {
      console.error('[AgentEngine] Registry not loaded. Call loadRegistry() first.');
      return Promise.resolve(null);
    }

    opts = opts || {};
    _standupRunning = true;
    var standupId = 'standup-' + Date.now();
    var topicKey = opts.topicKey || _slugify(opts.title || 'daily-standup');
    var standup = {
      id: standupId,
      standupId: standupId,
      title: opts.title || 'Daily Standup',
      agenda: opts.agenda || '',
      topicKey: topicKey,
      type: (STANDUP_TYPES.indexOf(opts.type) !== -1) ? opts.type : 'Status',
      requestedOutputs: opts.requestedOutputs || [],
      date: new Date().toISOString(),
      dateLabel: _getBusinessDate(),
      entries: [],
      status: 'in-progress',
      decisionStatus: 'Pending',
      createdAt: new Date().toISOString(),
      createdBy: opts.createdBy || 'ceo',
      proposals: { directives: [], tasks: [] },
      riskSummary: [],
      relatedStandups: [],
      template: opts.template || { isRecurring: false, frequency: null },
      rawReplies: {},
      parseErrors: []
    };

    // Check for related standups by exact topicKey match (v2.3 deterministic)
    var log = _loadStandupLog();
    if (topicKey) {
      log.forEach(function (prev) {
        if (prev.id === standup.id) return;
        if (prev.topicKey && prev.topicKey === topicKey) {
          standup.relatedStandups.push({
            id: prev.id,
            title: prev.title || 'Untitled',
            date: prev.date,
            topicKey: prev.topicKey,
            decisionStatus: prev.decisionStatus || 'N/A'
          });
        }
      });
    }

    emit('standup-start', standup);

    var transcript = ''; // Running context for each agent
    var agendaBlock = standup.agenda ? '\n\nSTANDUP AGENDA: ' + standup.agenda + '\nSTANDUP TYPE: ' + standup.type : '';

    // Sequential chain: each agent gets previous agents' updates
    var chain = Promise.resolve();

    STANDUP_ORDER.forEach(function (agentId, index) {
      chain = chain.then(function () {
        var agent = getAgent(agentId);
        if (!agent) return;

        // Build context message
        var context = '';
        if (index === 0) {
          context = 'You are opening today\'s standup as Prime Operator. Set the agenda, state top priorities, and flag anything the team needs to address. No one else has spoken yet.' + agendaBlock;
        } else if (agentId === 'nova' && index > 0) {
          context = 'You are closing the standup as Prime Operator. Summarize what the team reported, flag items that need CEO attention or escalation, assign follow-ups, and note anything for the CEO briefing. Here are the team updates:\n\n' + transcript + agendaBlock;
        } else {
          context = 'Here are the updates from team members who already spoke:\n\n' + transcript + agendaBlock;
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
          standup.rawReplies[agentId] = reply || '(no response)';
          transcript += agent.name + ' (' + agent.role + '): ' + (reply || '(no response)') + '\n\n';

          // Parse structured proposals and risks from agent reply (resilient)
          try {
            var parsed = _parseStandupReply(reply, agentId);
            if (parsed.tasks.length > 0) {
              // Enforce proposal limit: max 3 tasks per agent
              if (parsed.tasks.length > MAX_PROPOSED_TASKS_PER_AGENT) {
                console.warn('[AgentEngine] Agent ' + agentId + ' proposed ' + parsed.tasks.length + ' tasks, clamping to ' + MAX_PROPOSED_TASKS_PER_AGENT);
                parsed.tasks = parsed.tasks.slice(0, MAX_PROPOSED_TASKS_PER_AGENT);
              }
              parsed.tasks.forEach(function (t) { t.proposedBy = agentId; });
              standup.proposals.tasks = standup.proposals.tasks.concat(parsed.tasks);
            }
            if (parsed.directives.length > 0) {
              parsed.directives.forEach(function (d) { d.proposedBy = agentId; });
              standup.proposals.directives = standup.proposals.directives.concat(parsed.directives);
            }
            if (parsed.risks.length > 0) {
              standup.riskSummary = standup.riskSummary.concat(parsed.risks);
            }
          } catch (parseErr) {
            console.warn('[AgentEngine] Parse error for ' + agentId + ':', parseErr.message);
            standup.parseErrors.push({ agentId: agentId, error: parseErr.message, at: new Date().toISOString() });
          }

          emit('standup-agent-done', entry);
        });
      });
    });

    return chain.then(function () {
      standup.status = 'complete';
      _standupRunning = false;

      // Enforce directive proposal limit: max 2 per standup unless Nova
      var novaDirectives = standup.proposals.directives.filter(function (d) { return d.proposedBy === 'nova'; });
      var otherDirectives = standup.proposals.directives.filter(function (d) { return d.proposedBy !== 'nova'; });
      if (otherDirectives.length > MAX_PROPOSED_DIRECTIVES_PER_STANDUP) {
        console.warn('[AgentEngine] Non-Nova directives exceed limit (' + otherDirectives.length + '), clamping to ' + MAX_PROPOSED_DIRECTIVES_PER_STANDUP);
        otherDirectives = otherDirectives.slice(0, MAX_PROPOSED_DIRECTIVES_PER_STANDUP);
      }
      standup.proposals.directives = novaDirectives.concat(otherDirectives);

      // Deduplicate proposals
      standup.proposals.tasks = _dedupeProposals(standup.proposals.tasks);
      standup.proposals.directives = _dedupeProposals(standup.proposals.directives);

      // Aggregate top 3 risks by severity
      standup.riskSummary = _aggregateRisks(standup.riskSummary);

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

  // ── Standup Decision Engine v2.2 Helpers ──

  // Parse structured sections from agent standup reply
  function _parseStandupReply(reply, agentId) {
    var result = { tasks: [], directives: [], risks: [] };
    if (!reply) return result;

    // Parse [Task] lines: [Task] Title — Assignee — Priority — Impact — Effort — DueDate — Rationale
    var taskRegex = /\[Task\]\s*(.+?)(?:\s*[—–-]\s*(.+?))?(?:\s*[—–-]\s*(urgent|high|medium|low))?(?:\s*[—–-]\s*(High|Medium|Low))?(?:\s*[—–-]\s*(High|Medium|Low))?(?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?(?:\s*[—–-]\s*(.+))?$/gim;
    var m;
    while ((m = taskRegex.exec(reply)) !== null) {
      result.tasks.push({
        title: (m[1] || '').trim(),
        assignee: (m[2] || agentId).trim().toLowerCase(),
        priority: _clampEnum((m[3] || 'medium').toLowerCase(), ['urgent', 'high', 'medium', 'low'], 'medium'),
        impact: _clampEnum(m[4] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
        effort: _clampEnum(m[5] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
        dueDate: m[6] || null,
        rationale: (m[7] || '').trim()
      });
    }

    // Parse [Directive] lines: [Directive] Title — Classification — Owner — Priority — Impact — Effort — Rationale
    var dirRegex = /\[Directive\]\s*(.+?)(?:\s*[—–-]\s*(Strategic|Operational|Financial|Brand|Infrastructure|Experiment))?(?:\s*[—–-]\s*(.+?))?(?:\s*[—–-]\s*(urgent|high|medium|low))?(?:\s*[—–-]\s*(High|Medium|Low))?(?:\s*[—–-]\s*(High|Medium|Low))?(?:\s*[—–-]\s*(.+))?$/gim;
    while ((m = dirRegex.exec(reply)) !== null) {
      result.directives.push({
        title: (m[1] || '').trim(),
        classification: _clampEnum(m[2] || 'Operational', ['Strategic', 'Operational', 'Financial', 'Brand', 'Infrastructure', 'Experiment'], 'Operational'),
        owner: (m[3] || agentId).trim().toLowerCase(),
        priority: _clampEnum((m[4] || 'medium').toLowerCase(), ['urgent', 'high', 'medium', 'low'], 'medium'),
        impact: _clampEnum(m[5] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
        effort: _clampEnum(m[6] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
        rationale: (m[7] || '').trim()
      });
    }

    // Parse risk lines: Risk title — Severity (Low/Medium/High)
    var riskRegex = /(?:^|\n)\s*[-•*]?\s*(?:Risk:?\s*)?(.+?)\s*[—–-]\s*(?:Severity:?\s*)?(Low|Medium|High)/gim;
    while ((m = riskRegex.exec(reply)) !== null) {
      var rTitle = (m[1] || '').trim();
      if (rTitle.length > 3 && rTitle.length < 200) {
        result.risks.push({
          title: rTitle,
          severity: _clampEnum(m[2] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
          reportedBy: agentId
        });
      }
    }

    return result;
  }

  // Clamp value to allowed enum list
  function _clampEnum(val, allowed, fallback) {
    if (!val) return fallback;
    for (var i = 0; i < allowed.length; i++) {
      if (allowed[i].toLowerCase() === val.toLowerCase()) return allowed[i];
    }
    return fallback;
  }

  // Simple word-overlap similarity (0–1)
  function _stringSimilarity(a, b) {
    if (!a || !b) return 0;
    var wa = a.split(/\s+/).filter(Boolean);
    var wb = b.split(/\s+/).filter(Boolean);
    if (wa.length === 0 || wb.length === 0) return 0;
    var set = {};
    wa.forEach(function (w) { set[w] = true; });
    var overlap = 0;
    wb.forEach(function (w) { if (set[w]) overlap++; });
    return overlap / Math.max(wa.length, wb.length);
  }

  // Auto-link tasks to campaigns from the same meeting/standup
  // Matches by title similarity; if only one campaign, all tasks link to it
  function _autoLinkTasksToDirectives(source) {
    var taskIds = source._createdTaskIds || [];
    var cmpIds = source._createdDirectiveIds || source._createdCampaignIds || [];
    if (taskIds.length === 0 || cmpIds.length === 0) return;

    var campaigns = getCampaigns();
    var createdCmps = cmpIds.map(function (cid) {
      for (var i = 0; i < campaigns.length; i++) {
        if (campaigns[i].id === cid && campaigns[i].status === 'active') return campaigns[i];
      }
      return null;
    }).filter(Boolean);
    if (createdCmps.length === 0) return;

    var linked = 0;
    taskIds.forEach(function (tid) {
      var task = getTask(tid);
      if (!task || task.campaign_id) return; // skip if already linked

      var bestCmp = null;
      var bestScore = 0;

      if (createdCmps.length === 1) {
        bestCmp = createdCmps[0];
      } else {
        createdCmps.forEach(function (cmp) {
          var score = _stringSimilarity(task.title.toLowerCase(), cmp.title.toLowerCase());
          var descScore = _stringSimilarity((task.description || '').toLowerCase(), cmp.title.toLowerCase());
          var combined = Math.max(score, descScore);
          if (combined > bestScore) { bestScore = combined; bestCmp = cmp; }
        });
        if (bestScore < 0.15) bestCmp = null;
      }

      if (bestCmp) {
        updateTask(tid, { campaign_id: bestCmp.id });
        linked++;
      }
    });
    if (linked > 0) console.log('[AgentEngine] Auto-linked ' + linked + ' tasks to campaigns');
  }

  // Deduplicate proposals: merge similar titles, combine rationales, keep highest priority/impact
  // v2.3: Tasks only merge when same assignee; directives only merge when same classification
  function _dedupeProposals(proposals) {
    if (proposals.length <= 1) return proposals;
    var PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
    var IMPACT_RANK = { High: 0, Medium: 1, Low: 2 };
    var merged = [];

    proposals.forEach(function (p) {
      var found = false;
      for (var i = 0; i < merged.length; i++) {
        var sim = _stringSimilarity(merged[i].title.toLowerCase(), p.title.toLowerCase());
        if (sim <= 0.5) continue;

        // v2.3 safer rules: require matching key field before merging
        var sameAssignee = !p.assignee || !merged[i].assignee || p.assignee === merged[i].assignee;
        var sameClass = !p.classification || !merged[i].classification || p.classification === merged[i].classification;
        var isTask = !!p.assignee || !!merged[i].assignee;
        var isDir = !!p.classification || !!merged[i].classification;

        if ((isTask && !sameAssignee) || (isDir && !sameClass)) {
          // Similar but different assignee/classification — mark as similar, do NOT merge
          if (!merged[i].similarTo) merged[i].similarTo = [];
          merged[i].similarTo.push(p.title);
          if (!p.similarTo) p.similarTo = [];
          p.similarTo.push(merged[i].title);
          continue;
        }

        // Safe to merge
        if ((PRIORITY_RANK[p.priority] || 3) < (PRIORITY_RANK[merged[i].priority] || 3)) {
          merged[i].priority = p.priority;
        }
        if ((IMPACT_RANK[p.impact] || 2) < (IMPACT_RANK[merged[i].impact] || 2)) {
          merged[i].impact = p.impact;
        }
        if (p.rationale && merged[i].rationale.indexOf(p.rationale) === -1) {
          merged[i].rationale = (merged[i].rationale ? merged[i].rationale + ' | ' : '') + p.rationale;
        }
        if (p.proposedBy && merged[i]._proposers) {
          if (merged[i]._proposers.indexOf(p.proposedBy) === -1) merged[i]._proposers.push(p.proposedBy);
        }
        found = true;
        break;
      }
      if (!found) {
        p._proposers = [p.proposedBy || 'unknown'];
        merged.push(p);
      }
    });

    return merged;
  }

  // Aggregate risks: dedupe by title similarity, sort by severity, keep top 3
  function _aggregateRisks(risks) {
    if (risks.length === 0) return [];
    var SEVERITY_RANK = { High: 0, Medium: 1, Low: 2 };
    var deduped = _dedupeProposals(risks.map(function (r) {
      return { title: r.title, severity: r.severity, priority: r.severity, impact: r.severity, rationale: '', reportedBy: r.reportedBy, proposedBy: r.reportedBy };
    }));
    deduped.sort(function (a, b) {
      return (SEVERITY_RANK[a.severity] || 2) - (SEVERITY_RANK[b.severity] || 2);
    });
    return deduped.slice(0, 3).map(function (r) {
      return { title: r.title, severity: r.severity, reportedBy: r.reportedBy };
    });
  }

  // Get a standup by ID
  function getStandupById(id) {
    var log = _loadStandupLog();
    for (var i = 0; i < log.length; i++) {
      if (log[i].id === id) return log[i];
    }
    return null;
  }

  // Update standup decision status (lock/approve/reject/defer)
  function updateStandupDecision(standupId, status, notes) {
    if (DECISION_STATUSES.indexOf(status) === -1) {
      console.warn('[AgentEngine] Invalid decision status:', status);
      return null;
    }
    var log = _loadStandupLog();
    for (var i = 0; i < log.length; i++) {
      if (log[i].id === standupId) {
        log[i].decisionStatus = status;
        log[i].decisionNotes = notes || '';
        log[i].decisionAt = new Date().toISOString();
        log[i].decisionBy = 'ceo';
        if (status === 'Approved' || status === 'Rejected') {
          log[i].locked = true;
        }
        _saveStandupLog(log);
        _logGovernance('standup-decision', { standupId: standupId, status: status, notes: notes || '' });
        emit('standup-decision-updated', log[i]);
        return log[i];
      }
    }
    return null;
  }

  // Create proposals from standup as Pending Approval tasks + directives
  function createProposalsAsPending(standupId) {
    var standup = getStandupById(standupId);
    if (!standup) { console.warn('[AgentEngine] Standup not found:', standupId); return null; }

    var createdTasks = [];
    var createdCampaigns = [];
    var source = { type: 'standup', id: standupId, title: standup.title, date: standup.date };

    // Create tasks as pending-approval
    (standup.proposals.tasks || []).forEach(function (p) {
      var task = addTask({
        title: p.title,
        description: (p.rationale || '') + (p._proposers ? '\n[Proposed by: ' + p._proposers.join(', ') + ']' : ''),
        status: 'pending-approval',
        priority: p.priority || 'medium',
        assignee: p.assignee || null,
        dueDate: p.dueDate || null,
        tags: ['standup-proposal'],
        source: source,
        impact: p.impact || 'Medium',
        effort: p.effort || 'Medium'
      });
      createdTasks.push(task);
    });

    // Create campaigns as pending-approval (was directives)
    (standup.proposals.directives || []).forEach(function (p) {
      var cmp = addDirective({
        title: p.title,
        description: (p.rationale || '') + (p._proposers ? '\n[Proposed by: ' + p._proposers.join(', ') + ']' : ''),
        status: 'pending-approval',
        priority: p.priority || 'medium',
        classification: p.classification || 'Operational',
        owner: p.owner || null,
        impact: p.impact || 'Medium',
        effort: p.effort || 'Medium',
        dependencies: [],
        source: source,
        approval: { status: 'pending', approvedBy: null, approvedAt: null }
      });
      createdCampaigns.push(cmp);
    });

    // Update standup with created artifact IDs
    var log = _loadStandupLog();
    for (var i = 0; i < log.length; i++) {
      if (log[i].id === standupId) {
        log[i]._createdTaskIds = createdTasks.map(function (t) { return t.id; });
        log[i]._createdCampaignIds = createdCampaigns.map(function (c) { return c.id; });
        log[i]._createdDirectiveIds = log[i]._createdCampaignIds; // backward compat
        _saveStandupLog(log);
        break;
      }
    }

    emit('standup-proposals-created', { standupId: standupId, tasks: createdTasks, campaigns: createdCampaigns, directives: createdCampaigns });
    return { tasks: createdTasks, campaigns: createdCampaigns, directives: createdCampaigns };
  }

  // Per-proposal standup decision (v2.7)
  // type: 'task' | 'directive', index: array index, decision: 'approved' | 'activated' | 'rejected' | 'deferred'
  function decideStandupProposal(standupId, type, index, decision) {
    var log = _loadStandupLog();
    var standup = null;
    var si = -1;
    for (var i = 0; i < log.length; i++) {
      if (log[i].id === standupId) { standup = log[i]; si = i; break; }
    }
    if (!standup) { console.warn('[AgentEngine] Standup not found:', standupId); return null; }

    var arr = type === 'task' ? (standup.proposals.tasks || []) : (standup.proposals.directives || []);
    if (index < 0 || index >= arr.length) { console.warn('[AgentEngine] Proposal index out of range:', index); return null; }

    var proposal = arr[index];
    proposal._decision = decision;
    proposal._decidedAt = new Date().toISOString();
    proposal._decidedBy = 'ceo';

    var source = { type: 'standup', id: standupId, title: standup.title, date: standup.date };

    if (decision === 'approved' || decision === 'activated') {
      var created = null;
      if (type === 'task') {
        created = addTask({
          title: proposal.title,
          description: (proposal.rationale || '') + (proposal._proposers ? '\n[Proposed by: ' + proposal._proposers.join(', ') + ']' : ''),
          status: 'todo',
          priority: proposal.priority || 'medium',
          assignee: proposal.assignee || null,
          dueDate: proposal.dueDate || null,
          tags: ['standup-proposal'],
          source: source,
          impact: proposal.impact || 'Medium',
          effort: proposal.effort || 'Medium'
        });
      } else {
        created = addDirective({
          title: proposal.title,
          description: (proposal.rationale || '') + (proposal._proposers ? '\n[Proposed by: ' + proposal._proposers.join(', ') + ']' : ''),
          status: 'active',
          priority: proposal.priority || 'medium',
          classification: proposal.classification || 'Operational',
          owner: proposal.owner || null,
          impact: proposal.impact || 'Medium',
          effort: proposal.effort || 'Medium',
          dependencies: [],
          source: source,
          approval: { status: 'approved', approvedBy: 'ceo', approvedAt: new Date().toISOString() }
        });
      }
      if (created) {
        proposal._createdId = created.id;
        if (type === 'task') {
          if (!standup._createdTaskIds) standup._createdTaskIds = [];
          standup._createdTaskIds.push(created.id);
        } else {
          if (!standup._createdDirectiveIds) standup._createdDirectiveIds = [];
          standup._createdDirectiveIds.push(created.id);
        }
      }
    }

    // Auto-update standup-level decision status
    var allProposals = (standup.proposals.tasks || []).concat(standup.proposals.directives || []);
    var decided = allProposals.filter(function (p) { return p._decision; });
    if (decided.length === allProposals.length && allProposals.length > 0) {
      var anyApproved = decided.some(function (p) { return p._decision === 'approved' || p._decision === 'activated'; });
      standup.decisionStatus = anyApproved ? 'Approved' : 'Rejected';
      standup.locked = true;
      standup.decisionAt = new Date().toISOString();
      standup.decisionBy = 'ceo';
      // Auto-link approved tasks to their best-matching approved directive
      _autoLinkTasksToDirectives(standup);
    }

    log[si] = standup;
    _saveStandupLog(log);
    _logGovernance('standup-proposal-decision', { standupId: standupId, type: type, index: index, decision: decision, title: proposal.title });
    emit('standup-proposal-decided', { standupId: standupId, type: type, index: index, decision: decision, proposal: proposal });
    return standup;
  }

  // v2.3 G) One-click Approve + Activate: approve standup, create proposals if needed, activate all
  function approveAndActivate(standupId) {
    var standup = getStandupById(standupId);
    if (!standup) { console.warn('[AgentEngine] Standup not found:', standupId); return null; }

    // 1) Set decision to Approved
    updateStandupDecision(standupId, 'Approved', 'CEO approved and activated');

    // 2) Create proposals if not already created
    var taskIds = standup._createdTaskIds || [];
    var dirIds = standup._createdDirectiveIds || [];
    if (taskIds.length === 0 && dirIds.length === 0) {
      var created = createProposalsAsPending(standupId);
      if (created) {
        taskIds = created.tasks.map(function (t) { return t.id; });
        dirIds = created.directives.map(function (d) { return d.id; });
      }
    }

    // 3) Activate: move pending-approval tasks → todo, directives → active
    var now = new Date().toISOString();
    var activatedTasks = 0;
    var activatedDirs = 0;

    taskIds.forEach(function (tid) {
      var task = getTask(tid);
      if (task && task.status === 'pending-approval') {
        updateTask(tid, { status: 'todo' });
        activatedTasks++;
      }
    });

    dirIds.forEach(function (did) {
      var dir = null;
      var list = getDirectives();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === did) { dir = list[i]; break; }
      }
      if (dir && dir.status === 'pending-approval') {
        updateDirective(did, {
          status: 'active',
          approval: { status: 'approved', approvedBy: 'ceo', approvedAt: now }
        });
        activatedDirs++;
      }
    });

    // Auto-link tasks to directives
    var standupForLink = getStandupById(standupId);
    if (standupForLink) _autoLinkTasksToDirectives(standupForLink);

    emit('standup-activated', { standupId: standupId, activatedTasks: activatedTasks, activatedDirs: activatedDirs });
    return { activatedTasks: activatedTasks, activatedDirs: activatedDirs };
  }

  // v2.3 E) Get all unique topicKeys from standup log (for dropdown)
  function getStandupTopicKeys() {
    var log = _loadStandupLog();
    var keys = {};
    log.forEach(function (s) {
      if (s.topicKey) {
        keys[s.topicKey] = { topicKey: s.topicKey, title: s.title, date: s.date, decisionStatus: s.decisionStatus };
      }
    });
    return keys;
  }

  // ── Meetings System (v2.6 — On-Demand) ──
  var MEETINGS_KEY = 'ap_meetings';
  var MAX_MEETINGS = 50;
  var _meetingRunning = false;

  // Meeting speaking order: same as standup
  var MEETING_ORDER = STANDUP_ORDER;

  function _loadMeetings() { return _loadStorage(MEETINGS_KEY, []); }
  function _saveMeetings(log) {
    if (log.length > MAX_MEETINGS) log = log.slice(-MAX_MEETINGS);
    _saveStorage(MEETINGS_KEY, log);
  }

  function getMeetings() { return _loadMeetings(); }

  function getLatestMeeting() {
    var log = _loadMeetings();
    return log.length > 0 ? log[log.length - 1] : null;
  }

  function getMeetingById(id) {
    var log = _loadMeetings();
    for (var i = 0; i < log.length; i++) {
      if (log[i].id === id) return log[i];
    }
    return null;
  }

  function isMeetingRunning() { return _meetingRunning; }

  // Run an on-demand meeting — no daily limit, same agent pipeline as standup
  // opts: { title, agenda, type, topicKey, attendees, createdBy }
  function runMeeting(opts) {
    if (_meetingRunning) {
      console.warn('[AgentEngine] Meeting already in progress.');
      return Promise.resolve(null);
    }
    if (!_registry) {
      console.error('[AgentEngine] Registry not loaded. Call loadRegistry() first.');
      return Promise.resolve(null);
    }

    opts = opts || {};
    _meetingRunning = true;
    var meetingId = 'meeting-' + Date.now();
    var topicKey = opts.topicKey || _slugify(opts.title || 'ad-hoc-meeting');

    // Determine attendee order — custom or default MEETING_ORDER
    var attendees = opts.attendees && opts.attendees.length > 0 ? opts.attendees : MEETING_ORDER;

    var meeting = {
      id: meetingId,
      kind: 'meeting',
      title: opts.title || 'Ad-hoc Meeting',
      agenda: opts.agenda || '',
      topicKey: topicKey,
      type: (STANDUP_TYPES.indexOf(opts.type) !== -1) ? opts.type : 'Status',
      attendees: attendees,
      date: new Date().toISOString(),
      dateLabel: _getBusinessDate(),
      entries: [],
      status: 'in-progress',
      decisionStatus: 'Pending',
      createdAt: new Date().toISOString(),
      createdBy: opts.createdBy || 'ceo',
      proposals: { directives: [], tasks: [] },
      riskSummary: [],
      relatedMeetings: [],
      rawReplies: {},
      parseErrors: []
    };

    // Check for related meetings by topicKey
    var log = _loadMeetings();
    if (topicKey) {
      log.forEach(function (prev) {
        if (prev.id === meeting.id) return;
        if (prev.topicKey && prev.topicKey === topicKey) {
          meeting.relatedMeetings.push({
            id: prev.id,
            title: prev.title || 'Untitled',
            date: prev.date,
            topicKey: prev.topicKey,
            decisionStatus: prev.decisionStatus || 'N/A'
          });
        }
      });
    }

    // Also check standup log for related topics
    var standupLog = _loadStandupLog();
    if (topicKey) {
      standupLog.forEach(function (prev) {
        if (prev.topicKey && prev.topicKey === topicKey) {
          meeting.relatedMeetings.push({
            id: prev.id,
            title: prev.title || 'Untitled',
            date: prev.date,
            topicKey: prev.topicKey,
            decisionStatus: prev.decisionStatus || 'N/A',
            source: 'standup'
          });
        }
      });
    }

    emit('meeting-start', meeting);

    var transcript = '';
    var agendaBlock = meeting.agenda ? '\n\nMEETING AGENDA: ' + meeting.agenda + '\nMEETING TYPE: ' + meeting.type : '';

    var chain = Promise.resolve();

    attendees.forEach(function (agentId, index) {
      chain = chain.then(function () {
        var agent = getAgent(agentId);
        if (!agent) return;

        var context = '';
        if (index === 0) {
          context = 'You are opening this on-demand meeting called by the CEO as Prime Operator. Set the agenda, state top priorities, and flag anything the team needs to address. No one else has spoken yet.' + agendaBlock;
        } else if (agentId === 'nova' && index > 0) {
          context = 'You are closing this CEO-called meeting as Prime Operator. Summarize what the team discussed, flag items that need CEO attention or escalation, assign follow-ups, and note action items. Here are the team updates:\n\n' + transcript + agendaBlock;
        } else {
          context = 'This is an on-demand meeting called by the CEO. Here are the updates from team members who already spoke:\n\n' + transcript + agendaBlock;
        }

        emit('meeting-agent-thinking', { agentId: agentId, agent: agent });

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

          meeting.entries.push(entry);
          meeting.rawReplies[agentId] = reply || '(no response)';
          transcript += agent.name + ' (' + agent.role + '): ' + (reply || '(no response)') + '\n\n';

          try {
            var parsed = _parseStandupReply(reply, agentId);
            if (parsed.tasks.length > 0) {
              if (parsed.tasks.length > MAX_PROPOSED_TASKS_PER_AGENT) {
                parsed.tasks = parsed.tasks.slice(0, MAX_PROPOSED_TASKS_PER_AGENT);
              }
              parsed.tasks.forEach(function (t) { t.proposedBy = agentId; });
              meeting.proposals.tasks = meeting.proposals.tasks.concat(parsed.tasks);
            }
            if (parsed.directives.length > 0) {
              parsed.directives.forEach(function (d) { d.proposedBy = agentId; });
              meeting.proposals.directives = meeting.proposals.directives.concat(parsed.directives);
            }
            if (parsed.risks.length > 0) {
              meeting.riskSummary = meeting.riskSummary.concat(parsed.risks);
            }
          } catch (parseErr) {
            console.warn('[AgentEngine] Meeting parse error for ' + agentId + ':', parseErr.message);
            meeting.parseErrors.push({ agentId: agentId, error: parseErr.message, at: new Date().toISOString() });
          }

          emit('meeting-agent-done', entry);
        });
      });
    });

    return chain.then(function () {
      meeting.status = 'complete';
      _meetingRunning = false;

      var novaDirectives = meeting.proposals.directives.filter(function (d) { return d.proposedBy === 'nova'; });
      var otherDirectives = meeting.proposals.directives.filter(function (d) { return d.proposedBy !== 'nova'; });
      if (otherDirectives.length > MAX_PROPOSED_DIRECTIVES_PER_STANDUP) {
        otherDirectives = otherDirectives.slice(0, MAX_PROPOSED_DIRECTIVES_PER_STANDUP);
      }
      meeting.proposals.directives = novaDirectives.concat(otherDirectives);

      meeting.proposals.tasks = _dedupeProposals(meeting.proposals.tasks);
      meeting.proposals.directives = _dedupeProposals(meeting.proposals.directives);
      meeting.riskSummary = _aggregateRisks(meeting.riskSummary);

      var log = _loadMeetings();
      log.push(meeting);
      _saveMeetings(log);

      emit('meeting-complete', meeting);
      return meeting;
    }).catch(function (err) {
      console.error('[AgentEngine] Meeting failed:', err);
      meeting.status = 'failed';
      _meetingRunning = false;
      emit('meeting-error', { error: err.message, meeting: meeting });
      return meeting;
    });
  }

  // Update meeting decision status
  function updateMeetingDecision(meetingId, status, notes) {
    if (DECISION_STATUSES.indexOf(status) === -1) {
      console.warn('[AgentEngine] Invalid decision status:', status);
      return null;
    }
    var log = _loadMeetings();
    for (var i = 0; i < log.length; i++) {
      if (log[i].id === meetingId) {
        log[i].decisionStatus = status;
        log[i].decisionNotes = notes || '';
        log[i].decisionAt = new Date().toISOString();
        log[i].decisionBy = 'ceo';
        if (status === 'Approved' || status === 'Rejected') {
          log[i].locked = true;
        }
        _saveMeetings(log);
        _logGovernance('meeting-decision', { meetingId: meetingId, status: status, notes: notes || '' });
        emit('meeting-decision-updated', log[i]);
        return log[i];
      }
    }
    return null;
  }

  // Create proposals from meeting as Pending Approval tasks + directives
  function createMeetingProposals(meetingId) {
    var meeting = getMeetingById(meetingId);
    if (!meeting) { console.warn('[AgentEngine] Meeting not found:', meetingId); return null; }

    var createdTasks = [];
    var createdDirectives = [];
    var source = { type: 'meeting', id: meetingId, title: meeting.title, date: meeting.date };

    (meeting.proposals.tasks || []).forEach(function (p) {
      var task = addTask({
        title: p.title,
        description: (p.rationale || '') + (p._proposers ? '\n[Proposed by: ' + p._proposers.join(', ') + ']' : ''),
        status: 'pending-approval',
        priority: p.priority || 'medium',
        assignee: p.assignee || null,
        dueDate: p.dueDate || null,
        tags: ['meeting-proposal'],
        source: source,
        impact: p.impact || 'Medium',
        effort: p.effort || 'Medium'
      });
      createdTasks.push(task);
    });

    (meeting.proposals.directives || []).forEach(function (p) {
      var dir = addDirective({
        title: p.title,
        description: (p.rationale || '') + (p._proposers ? '\n[Proposed by: ' + p._proposers.join(', ') + ']' : ''),
        status: 'pending-approval',
        priority: p.priority || 'medium',
        classification: p.classification || 'Operational',
        owner: p.owner || null,
        impact: p.impact || 'Medium',
        effort: p.effort || 'Medium',
        dependencies: [],
        source: source,
        approval: { status: 'pending', approvedBy: null, approvedAt: null }
      });
      createdDirectives.push(dir);
    });

    // Update meeting with created IDs
    var log = _loadMeetings();
    for (var i = 0; i < log.length; i++) {
      if (log[i].id === meetingId) {
        log[i]._createdTaskIds = createdTasks.map(function (t) { return t.id; });
        log[i]._createdDirectiveIds = createdDirectives.map(function (d) { return d.id; });
        _saveMeetings(log);
        break;
      }
    }

    emit('meeting-proposals-created', { meetingId: meetingId, tasks: createdTasks, directives: createdDirectives });
    return { tasks: createdTasks, directives: createdDirectives };
  }

  // Per-proposal decision (v2.7)
  // type: 'task' | 'directive', index: array index, decision: 'approved' | 'activated' | 'rejected' | 'deferred'
  function decideMeetingProposal(meetingId, type, index, decision) {
    var log = _loadMeetings();
    var meeting = null;
    var mi = -1;
    for (var i = 0; i < log.length; i++) {
      if (log[i].id === meetingId) { meeting = log[i]; mi = i; break; }
    }
    if (!meeting) { console.warn('[AgentEngine] Meeting not found:', meetingId); return null; }

    var arr = type === 'task' ? (meeting.proposals.tasks || []) : (meeting.proposals.directives || []);
    if (index < 0 || index >= arr.length) { console.warn('[AgentEngine] Proposal index out of range:', index); return null; }

    var proposal = arr[index];
    proposal._decision = decision;
    proposal._decidedAt = new Date().toISOString();
    proposal._decidedBy = 'ceo';

    var source = { type: 'meeting', id: meetingId, title: meeting.title, date: meeting.date };

    // Create artifact on approve/activate
    if (decision === 'approved' || decision === 'activated') {
      var created = null;
      if (type === 'task') {
        created = addTask({
          title: proposal.title,
          description: (proposal.rationale || '') + (proposal._proposers ? '\n[Proposed by: ' + proposal._proposers.join(', ') + ']' : ''),
          status: 'todo',
          priority: proposal.priority || 'medium',
          assignee: proposal.assignee || null,
          dueDate: proposal.dueDate || null,
          tags: ['meeting-proposal'],
          source: source,
          impact: proposal.impact || 'Medium',
          effort: proposal.effort || 'Medium'
        });
      } else {
        created = addDirective({
          title: proposal.title,
          description: (proposal.rationale || '') + (proposal._proposers ? '\n[Proposed by: ' + proposal._proposers.join(', ') + ']' : ''),
          status: 'active',
          priority: proposal.priority || 'medium',
          classification: proposal.classification || 'Operational',
          owner: proposal.owner || null,
          impact: proposal.impact || 'Medium',
          effort: proposal.effort || 'Medium',
          dependencies: [],
          source: source,
          approval: { status: 'approved', approvedBy: 'ceo', approvedAt: new Date().toISOString() }
        });
      }
      if (created) {
        proposal._createdId = created.id;
        // Track on meeting-level arrays too
        if (type === 'task') {
          if (!meeting._createdTaskIds) meeting._createdTaskIds = [];
          meeting._createdTaskIds.push(created.id);
        } else {
          if (!meeting._createdDirectiveIds) meeting._createdDirectiveIds = [];
          meeting._createdDirectiveIds.push(created.id);
        }
      }
    }

    // Auto-update meeting-level decision status based on all proposals
    var allProposals = (meeting.proposals.tasks || []).concat(meeting.proposals.directives || []);
    var decided = allProposals.filter(function (p) { return p._decision; });
    if (decided.length === allProposals.length && allProposals.length > 0) {
      var anyApproved = decided.some(function (p) { return p._decision === 'approved' || p._decision === 'activated'; });
      meeting.decisionStatus = anyApproved ? 'Approved' : 'Rejected';
      meeting.locked = true;
      meeting.decisionAt = new Date().toISOString();
      meeting.decisionBy = 'ceo';
      // Auto-link approved tasks to their best-matching approved directive
      _autoLinkTasksToDirectives(meeting);
    }

    log[mi] = meeting;
    _saveMeetings(log);
    _logGovernance('meeting-proposal-decision', { meetingId: meetingId, type: type, index: index, decision: decision, title: proposal.title });
    emit('meeting-proposal-decided', { meetingId: meetingId, type: type, index: index, decision: decision, proposal: proposal });
    return meeting;
  }

  // Approve + Activate meeting proposals
  function approveAndActivateMeeting(meetingId) {
    var meeting = getMeetingById(meetingId);
    if (!meeting) { console.warn('[AgentEngine] Meeting not found:', meetingId); return null; }

    updateMeetingDecision(meetingId, 'Approved', 'CEO approved and activated');

    var taskIds = meeting._createdTaskIds || [];
    var dirIds = meeting._createdDirectiveIds || [];
    if (taskIds.length === 0 && dirIds.length === 0) {
      var created = createMeetingProposals(meetingId);
      if (created) {
        taskIds = created.tasks.map(function (t) { return t.id; });
        dirIds = created.directives.map(function (d) { return d.id; });
      }
    }

    var activatedTasks = 0;
    var activatedDirs = 0;

    taskIds.forEach(function (tid) {
      var task = getTask(tid);
      if (task && task.status === 'pending-approval') {
        updateTask(tid, { status: 'todo' });
        activatedTasks++;
      }
    });

    dirIds.forEach(function (did) {
      var list = getDirectives();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === did && list[i].status === 'pending-approval') {
          updateDirective(did, {
            status: 'active',
            approval: { status: 'approved', approvedBy: 'ceo', approvedAt: new Date().toISOString() }
          });
          activatedDirs++;
          break;
        }
      }
    });

    // Auto-link tasks to directives
    var meetingForLink = getMeetingById(meetingId);
    if (meetingForLink) _autoLinkTasksToDirectives(meetingForLink);

    emit('meeting-activated', { meetingId: meetingId, activatedTasks: activatedTasks, activatedDirs: activatedDirs });
    return { activatedTasks: activatedTasks, activatedDirs: activatedDirs };
  }

  // Get all unique meeting topic keys
  function getMeetingTopicKeys() {
    var log = _loadMeetings();
    var keys = {};
    log.forEach(function (m) {
      if (m.topicKey) {
        keys[m.topicKey] = { topicKey: m.topicKey, title: m.title, date: m.date, decisionStatus: m.decisionStatus };
      }
    });
    return keys;
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
        doctrineWeight: 0.4,         // 0.0–0.6, default 0.4 (Operating Doctrine influence)
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

  // Get doctrine influence weight for an agent, clamped to 0.0–0.6
  function getDoctrineWeight(agentId) {
    var config = getAgentConfig(agentId);
    var w = parseFloat(config.doctrineWeight);
    if (isNaN(w)) w = 0.4;
    if (w > 0.6) { console.warn('[AgentEngine] doctrineWeight for ' + agentId + ' exceeded 0.6, clamped.'); w = 0.6; }
    if (w < 0) { console.warn('[AgentEngine] doctrineWeight for ' + agentId + ' below 0, clamped.'); w = 0; }
    return Math.round(w * 100) / 100;
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
  var CAMPAIGNS_KEY = 'ap_campaigns';

  var CAMPAIGN_STOPWORDS = {
    'the': true, 'a': true, 'an': true, 'and': true, 'for': true,
    'to': true, 'of': true, 'in': true, 'on': true, 'with': true, '&': true
  };

  function _normalizeCampaignRef(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (!obj.campaign_id && obj.campaignId) obj.campaign_id = obj.campaignId;
    if (obj.campaign_id === '') obj.campaign_id = null;
    return obj;
  }

  function _normalizeCampaignRecord(c) {
    if (!c || typeof c !== 'object') return c;
    if (!c.id) c.id = 'cmp-' + Date.now();
    if (!c.status) c.status = 'active';
    if (!c.createdAt) c.createdAt = new Date().toISOString();
    if (!c.updatedAt) c.updatedAt = c.createdAt;
    if (!c.title) c.title = 'Untitled Campaign';
    if (!c.description) c.description = '';
    return c;
  }

  function _tokenizeCampaignText(text) {
    var src = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    var raw = src.split(/\s+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (t.length < 3) continue;
      if (CAMPAIGN_STOPWORDS[t]) continue;
      if (out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  function _tokenSet(arr) {
    var s = {};
    for (var i = 0; i < arr.length; i++) s[arr[i]] = true;
    return s;
  }

  function _campaignMatchTrace(trace) {
    try {
      console.log('[CampaignMatch]', JSON.stringify(trace));
    } catch (e) {}
  }

  function _matchActiveCampaign(opts) {
    opts = opts || {};
    var campaigns = getCampaigns().filter(function (c) {
      return c && c.status === 'active' && !c.deletedAt;
    });
    if (campaigns.length === 0) return null;

    var inputTokens = _tokenizeCampaignText((opts.title || '') + ' ' + (opts.description || ''));
    if (inputTokens.length === 0) return null;
    var inputSet = _tokenSet(inputTokens);

    var best = null;
    var bestScore = 0;
    var candidates = [];

    for (var i = 0; i < campaigns.length; i++) {
      var c = campaigns[i];
      var cTokens = _tokenizeCampaignText((c.title || '') + ' ' + (c.description || ''));
      if (cTokens.length === 0) continue;
      var cSet = _tokenSet(cTokens);
      var overlap = [];
      var union = {};
      Object.keys(inputSet).forEach(function (k) { union[k] = true; if (cSet[k]) overlap.push(k); });
      Object.keys(cSet).forEach(function (k) { union[k] = true; });

      var interCount = overlap.length;
      var unionCount = Object.keys(union).length || 1;
      var score = interCount / unionCount;
      var sameObjective = !!(opts.objective_id && c.objective_id && opts.objective_id === c.objective_id);
      if (sameObjective) score += 0.08;
      if (opts.division && c.division && opts.division === c.division) score += 0.04;

      var threshold = sameObjective ? 0.18 : 0.30;
      candidates.push({ id: c.id, baseScore: interCount / unionCount, score: score, overlap: overlap, threshold: threshold });

      if (interCount < 2) continue;
      if (score < threshold) continue;

      if (!best || score > bestScore) {
        best = c;
        bestScore = score;
      } else if (best && Math.abs(score - bestScore) < 0.0001) {
        var cUpdated = c.updatedAt || c.createdAt || '';
        var bUpdated = best.updatedAt || best.createdAt || '';
        if (cUpdated > bUpdated) {
          best = c;
          bestScore = score;
        }
      }
    }

    _campaignMatchTrace({
      objective_id: opts.objective_id || null,
      division: opts.division || null,
      inputTokens: inputTokens,
      candidates: candidates,
      matched: best ? best.id : null
    });

    return best;
  }

  function getCampaigns() {
    var list = _loadStorage(CAMPAIGNS_KEY, []);
    for (var i = 0; i < list.length; i++) { _normalizeCampaignRecord(list[i]); }
    return list;
  }

  function addCampaign(c) {
    var list = getCampaigns();
    var item = {
      id: (c && c.id) || ('cmp-' + Date.now()),
      title: (c && c.title) || 'Untitled Campaign',
      description: (c && c.description) || '',
      status: (c && c.status) || 'active',
      objective_id: (c && c.objective_id) || null,
      division: (c && c.division) || null,
      provenance: (c && c.provenance) || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    };
    _normalizeCampaignRecord(item);
    list.push(item);
    _saveStorage(CAMPAIGNS_KEY, list);
    _logGovernance('campaign-created', { campaignId: item.id, title: item.title, provenance: item.provenance || null });
    return item;
  }

  function updateCampaign(id, updates) {
    var list = getCampaigns();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== id) continue;
      Object.keys(updates || {}).forEach(function (k) {
        if (k === 'id' || k === 'deletedAt') return;
        list[i][k] = updates[k];
      });
      list[i].updatedAt = new Date().toISOString();
      _normalizeCampaignRecord(list[i]);
      _saveStorage(CAMPAIGNS_KEY, list);
      _logGovernance('campaign-updated', { campaignId: id, fields: Object.keys(updates || {}) });
      return list[i];
    }
    return null;
  }

  function archiveCampaign(id) {
    var c = updateCampaign(id, { status: 'archived' });
    if (c) _logGovernance('campaign-archived', { campaignId: id, title: c.title });
    return c;
  }

  function unarchiveCampaign(id) {
    var c = updateCampaign(id, { status: 'active' });
    if (c) _logGovernance('campaign-unarchived', { campaignId: id, title: c.title });
    return c;
  }

  function deleteCampaign(id) {
    var campaigns = getCampaigns();
    var target = null;
    for (var i = 0; i < campaigns.length; i++) {
      if (campaigns[i].id === id) { target = campaigns[i]; break; }
    }
    if (!target) return { ok: false, error: 'not_found' };

    var directives = getDirectives().filter(function (d) {
      return d && d.campaign_id === id && !d.deletedAt;
    });
    var activeDirective = directives.some(function (d) {
      var s = String(d.status || '').toLowerCase();
      return s !== 'completed' && s !== 'archived';
    });

    var tasks = getTasks().filter(function (t) {
      return t && t.campaign_id === id && !t._archived;
    });
    var activeTask = tasks.some(function (t) {
      var s = String(t.status || '').toLowerCase();
      return s !== 'done' && s !== 'completed' && s !== 'archived';
    });

    if (activeDirective || activeTask) {
      return {
        ok: false,
        error: 'active_children',
        activeDirectives: directives.length,
        activeTasks: tasks.length
      };
    }

    var now = new Date().toISOString();
    target.deletedAt = now;
    target.updatedAt = now;
    _saveStorage(CAMPAIGNS_KEY, campaigns);
    _logGovernance('campaign-deleted', { campaignId: id, title: target.title });
    return { ok: true, campaign: target };
  }

  // Non-authoritative: suggest campaign_id via local matching only.
  // Server (heartbeat/agentchat) is the authority for campaign creation.
  function _ensureCampaignForDirective(entry) {
    if (!entry || typeof entry !== 'object') return null;
    _normalizeCampaignRef(entry);
    if (entry.campaign_id) return entry.campaign_id;

    var matched = _matchActiveCampaign({
      title: entry.title || '',
      description: entry.description || '',
      objective_id: entry.objective_id || null,
      division: entry.division || null
    });
    return matched ? matched.id : null;
  }

  // Non-authoritative: suggest campaign_id via local matching only.
  // Server (heartbeat/agentchat) is the authority for campaign creation.
  function _ensureCampaignForTask(entry) {
    if (!entry || typeof entry !== 'object') return null;
    _normalizeCampaignRef(entry);

    if (entry.directive_id) {
      var dirs = getDirectives();
      for (var i = 0; i < dirs.length; i++) {
        if (dirs[i].id === entry.directive_id) {
          _normalizeCampaignRef(dirs[i]);
          if (dirs[i].campaign_id) return dirs[i].campaign_id;
        }
      }
    }

    if (entry.campaign_id) return entry.campaign_id;

    var matched = _matchActiveCampaign({
      title: entry.title || '',
      description: entry.description || '',
      objective_id: entry.objective_id || null,
      division: entry.division || null
    });
    return matched ? matched.id : null;
  }

  function _normalizeTaskNumbers(list) {
    var maxNum = 0;
    var needsBackfill = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].taskNumber && list[i].taskNumber > maxNum) maxNum = list[i].taskNumber;
      if (!list[i].taskNumber) needsBackfill = true;
    }
    if (needsBackfill) {
      var unnumbered = [];
      for (var j = 0; j < list.length; j++) {
        if (!list[j].taskNumber) unnumbered.push(list[j]);
      }
      unnumbered.sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
      for (var k = 0; k < unnumbered.length; k++) {
        unnumbered[k].taskNumber = ++maxNum;
      }
      _saveStorage(TASKS_KEY, list);
    }
    return maxNum;
  }

  function getTasks() {
    var list = _loadStorage(TASKS_KEY, []);
    for (var i = 0; i < list.length; i++) { _normalizeCampaignRef(list[i]); }
    _normalizeTaskNumbers(list);
    return list;
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
    var maxNum = 0;
    for (var n = 0; n < tasks.length; n++) {
      if (tasks[n].taskNumber && tasks[n].taskNumber > maxNum) maxNum = tasks[n].taskNumber;
    }
    var campaignId = _ensureCampaignForTask(entry || {});
    var task = {
      id: 'task-' + Date.now(),
      taskNumber: maxNum + 1,
      title: entry.title || 'Untitled Task',
      description: entry.description || '',
      status: entry.status || 'backlog',
      priority: entry.priority || 'medium',
      assignee: entry.assignee || null,        // agentId or null (unassigned)
      division: entry.division || null,         // division id
      tags: entry.tags || [],
      dueDate: entry.dueDate || null,
      impact: entry.impact || null,            // Low/Medium/High (v2.2)
      effort: entry.effort || null,            // Low/Medium/High (v2.2)
      source: entry.source || null,            // { type, id, title, date } traceability (v2.2)
      parent_task_id: entry.parent_task_id || null, // link to originating task (v2.5)
      directive_id: entry.directive_id || null, // link to parent directive
      campaign_id: campaignId || null,
      objective_id: entry.objective_id || null, // link to parent objective
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
    _normalizeCampaignRef(tasks[idx]);
    if (updates.campaignId && !updates.campaign_id) tasks[idx].campaign_id = updates.campaignId;
    if (!tasks[idx].campaign_id) {
      tasks[idx].campaign_id = _ensureCampaignForTask(tasks[idx]) || null;
    }
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

  function getTaskById(id) {
    var tasks = getTasks();
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) return tasks[i];
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

  // ── v2.5: KPI Registry ──
  var _kpiRegistry = null;
  var _kpiIdSet = null;

  function getKpiRegistry() {
    if (_kpiRegistry) return _kpiRegistry;
    try {
      var stored = _loadStorage('ap_kpi_registry', null);
      if (stored && Array.isArray(stored) && stored.length > 0) { _kpiRegistry = stored; }
    } catch (e) { /* ignore */ }
    if (!_kpiRegistry) {
      _kpiRegistry = [
        { id: 'kpi_site_visits', name: 'Site Visits', unit: 'count', target: null, owner: 'echo', category: 'Growth' },
        { id: 'kpi_gallery_views', name: 'Gallery Views', unit: 'count', target: null, owner: 'echo', category: 'Engagement' },
        { id: 'kpi_cards_generated', name: 'Cards Generated', unit: 'count', target: null, owner: 'pixel', category: 'Product' },
        { id: 'kpi_cards_published', name: 'Cards Published', unit: 'count', target: null, owner: 'pixel', category: 'Activation' },
        { id: 'kpi_social_followers', name: 'Social Followers', unit: 'count', target: null, owner: 'echo', category: 'Growth' },
        { id: 'kpi_error_rate', name: 'Error Rate', unit: 'percent', target: null, owner: 'forge', category: 'Reliability' }
      ];
    }
    _kpiIdSet = {};
    _kpiRegistry.forEach(function (k) { _kpiIdSet[k.id] = true; });
    return _kpiRegistry;
  }

  function _validateKpiIds(ids) {
    if (!ids || !Array.isArray(ids)) return [];
    getKpiRegistry();
    return ids.filter(function (id) {
      if (_kpiIdSet[id]) return true;
      console.warn('[AgentEngine] Unknown KPI id dropped:', id);
      return false;
    });
  }

  function getDirectiveKpiIndex() {
    var directives = getDirectives();
    var kpiToDirectives = {};
    var directiveToKpis = {};
    directives.forEach(function (d) {
      var links = d.kpiLinks || [];
      if (links.length === 0) return;
      directiveToKpis[d.id] = links;
      links.forEach(function (kId) {
        if (!kpiToDirectives[kId]) kpiToDirectives[kId] = [];
        kpiToDirectives[kId].push(d.id);
      });
    });
    return { kpiToDirectives: kpiToDirectives, directiveToKpis: directiveToKpis, kpiToCampaigns: kpiToDirectives, campaignToKpis: directiveToKpis };
  }

  // ── v2.5: Quarterly Board Helpers ──
  function getQuarterRange(year, quarter) {
    var ranges = {
      Q1: ['-01-01', '-03-31'],
      Q2: ['-04-01', '-06-30'],
      Q3: ['-07-01', '-09-30'],
      Q4: ['-10-01', '-12-31']
    };
    var r = ranges[quarter] || ranges.Q1;
    return {
      startISO: year + r[0] + 'T00:00:00.000Z',
      endISO: year + r[1] + 'T23:59:59.999Z'
    };
  }

  function getBoardPacket(opts) {
    opts = opts || {};
    var year = opts.year || new Date().getFullYear();
    var quarter = opts.quarter || ('Q' + (Math.floor(new Date().getMonth() / 3) + 1));
    var range = getQuarterRange(year, quarter);
    var startMs = new Date(range.startISO).getTime();
    var endMs = new Date(range.endISO).getTime();

    function inRange(iso) {
      if (!iso) return false;
      var t = new Date(iso).getTime();
      return t >= startMs && t <= endMs;
    }

    // Standups in quarter
    var log = _loadStandupLog();
    var standups = log.filter(function (s) { return inRange(s.date || s.createdAt); });

    // Decisions (non-Pending)
    var decisions = standups.filter(function (s) { return s.decisionStatus && s.decisionStatus !== 'Pending'; }).map(function (s) {
      return { id: s.id, title: s.title, topicKey: s.topicKey, date: s.date, decisionStatus: s.decisionStatus, decisionNotes: s.decisionNotes || '' };
    });

    // Risks from standups
    var allRisks = [];
    standups.forEach(function (s) {
      (s.riskSummary || []).forEach(function (r) {
        allRisks.push({ description: r.description || r, severity: r.severity || 'medium', date: s.date, standupTitle: s.title });
      });
    });
    var SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
    allRisks.sort(function (a, b) { return (SEV_RANK[a.severity] || 3) - (SEV_RANK[b.severity] || 3); });

    // Directives
    var directives = getDirectives();
    var activeDir = directives.filter(function (d) { return d.status === 'active' && (inRange(d.createdDate) || !d.createdDate); });
    var completedDir = directives.filter(function (d) { return d.status === 'completed' && inRange(d.createdDate); });
    var pendingDir = directives.filter(function (d) { return d.status === 'pending-approval'; });

    // Tasks throughput
    var tasks = getTasks();
    var created = tasks.filter(function (t) { return inRange(t.createdDate || t.createdAt); }).length;
    var completed = tasks.filter(function (t) { return t.status === 'done' && inRange(t.completedAt); }).length;
    var pendingApproval = tasks.filter(function (t) { return t.status === 'pending-approval'; }).length;

    // KPIs
    var kpis = getKpiRegistry();
    var kpiIndex = getDirectiveKpiIndex();
    var kpiData = kpis.map(function (k) {
      var linkedDirIds = kpiIndex.kpiToDirectives[k.id] || [];
      var linkedDirs = linkedDirIds.map(function (did) {
        var d = null;
        directives.forEach(function (dir) { if (dir.id === did) d = dir; });
        return d ? { id: d.id, title: d.title, status: d.status } : null;
      }).filter(Boolean);
      return { id: k.id, name: k.name, unit: k.unit, target: k.target, owner: k.owner, category: k.category, linkedDirectives: linkedDirs };
    });

    // Exec summary (deterministic, no LLM)
    var IMPACT_RANK = { High: 0, Medium: 1, Low: 2 };
    var topCompleted = completedDir.slice().sort(function (a, b) { return (IMPACT_RANK[a.impact] || 2) - (IMPACT_RANK[b.impact] || 2); }).slice(0, 3);
    var topRisks = allRisks.slice(0, 2);
    var summary = '';
    if (topCompleted.length > 0) {
      summary += 'Completed: ' + topCompleted.map(function (d) { return d.title + (d.impact ? ' (' + d.impact + ')' : ''); }).join(', ') + '. ';
    }
    if (topRisks.length > 0) {
      summary += 'Top risks: ' + topRisks.map(function (r) { return r.description + ' [' + r.severity + ']'; }).join('; ') + '. ';
    }
    summary += 'Throughput: ' + created + ' created, ' + completed + ' completed' + (pendingApproval > 0 ? ', ' + pendingApproval + ' pending approval' : '') + '.';

    return {
      quarterKey: year + '-' + quarter,
      dateRange: range,
      kpis: kpiData,
      directives: { active: activeDir, completed: completedDir, pendingApproval: pendingDir },
      decisions: decisions,
      risks: allRisks,
      throughput: { tasksCreated: created, tasksCompleted: completed, pendingApprovalTasks: pendingApproval },
      execSummary: summary
    };
  }

  // ── Governance: Directives (merged into Campaigns) ──
  var DIRECTIVES_KEY = 'ap_directives'; // kept for one-time migration read
  function getDirectives() {
    return getCampaigns(); // directives merged into campaigns
  }
  function addDirective(dir) {
    // Directives now create campaigns directly
    if (!dir.id) dir.id = 'cmp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    if (!dir.createdAt) dir.createdAt = dir.createdDate || new Date().toISOString();
    if (!dir.updatedAt) dir.updatedAt = dir.createdAt;
    if (!dir.status) dir.status = 'active';
    if (!dir.linkedObjectives) dir.linkedObjectives = [];
    if (!dir.classification) dir.classification = 'Operational';
    if (!dir.impact) dir.impact = null;
    if (!dir.effort) dir.effort = null;
    if (!dir.dependencies) dir.dependencies = [];
    if (!dir.source) dir.source = null;
    if (!dir.approval) dir.approval = { status: 'none', approvedBy: null, approvedAt: null };
    if (!dir.owner) dir.owner = null;
    dir.kpiLinks = _validateKpiIds(dir.kpiLinks);
    if (!dir.kpiImpactNotes) dir.kpiImpactNotes = '';
    dir._migratedFromDirective = true;
    var list = getCampaigns();
    _normalizeCampaignRecord(dir);
    list.push(dir);
    _saveStorage(CAMPAIGNS_KEY, list);
    _logGovernance('campaign-created', { campaignId: dir.id, title: dir.title, provenance: 'addDirective' });
    return dir;
  }
  function updateDirective(id, updates) {
    return updateCampaign(id, updates); // delegate to campaigns
  }
  function deleteDirective(id) {
    var result = deleteCampaign(id);
    return result && result.ok;
  }

  // ── Governance: Directive Progress (delegates to Campaign Progress) ──
  function getDirectiveProgress(directiveId) {
    return getCampaignProgress(directiveId); // directives merged into campaigns
  }

  function getAllDirectiveProgress() {
    return getAllCampaignProgress().map(function (item) {
      return { directive: item.campaign, progress: item.progress };
    });
  }

  // ── Campaign Progress ──
  function getCampaignProgress(campaignId) {
    var tasks = getTasks();
    var linked = tasks.filter(function (t) { return t.campaign_id === campaignId; });
    var total = linked.length;
    if (total === 0) return { total: 0, done: 0, inProgress: 0, review: 0, todo: 0, backlog: 0, blocked: 0, overdue: 0, pct: 0, donePct: 0, signal: 'no_tasks', agents: {}, tasks: linked, staleDays: 0 };

    var done = 0, inProgress = 0, review = 0, todo = 0, backlog = 0, blocked = 0, overdue = 0;
    var agents = {};
    var now = new Date();
    var latestUpdate = null;

    linked.forEach(function (t) {
      var s = t.status || 'backlog';
      if (s === 'done') done++;
      else if (s === 'in-progress') inProgress++;
      else if (s === 'review') review++;
      else if (s === 'todo') todo++;
      else backlog++;
      if (t.blocked) blocked++;
      if (t.dueDate && new Date(t.dueDate) < now && s !== 'done') overdue++;

      var agent = t.assignee || 'unassigned';
      if (!agents[agent]) agents[agent] = { total: 0, done: 0, active: 0 };
      agents[agent].total++;
      if (s === 'done') agents[agent].done++;
      else agents[agent].active++;

      var updated = t.updatedAt || t.createdAt;
      if (updated && (!latestUpdate || updated > latestUpdate)) latestUpdate = updated;
    });

    var weightedDone = (done * 1.0) + (review * 0.75) + (inProgress * 0.5) + (todo * 0.25);
    var pct = total > 0 ? Math.round((weightedDone / total) * 100) : 0;
    var donePct = total > 0 ? Math.round((done / total) * 100) : 0;
    var staleDays = latestUpdate ? Math.floor((now - new Date(latestUpdate)) / 86400000) : 999;

    var signal = 'on_track';
    if (blocked > 0) signal = 'blocked';
    else if (overdue > 0) signal = 'at_risk';
    else if (staleDays >= 3 && donePct < 100) signal = 'stale';
    else if (donePct === 100) signal = 'complete';
    else if (inProgress === 0 && review === 0 && done === 0 && todo === 0) signal = 'not_started';

    return { total: total, done: done, inProgress: inProgress, review: review, todo: todo, backlog: backlog, blocked: blocked, overdue: overdue, pct: pct, donePct: donePct, signal: signal, agents: agents, tasks: linked, staleDays: staleDays };
  }

  function getAllCampaignProgress() {
    var campaigns = getCampaigns();
    return campaigns.filter(function (c) { return c && !c.deletedAt; }).map(function (c) {
      return { campaign: c, progress: getCampaignProgress(c.id) };
    });
  }

  // ── Objective Progress (auto-calculated from linked campaigns) ──
  function getObjectiveProgress(objectiveId) {
    var campaigns = getCampaigns().filter(function (c) {
      return c && !c.deletedAt && c.objective_id === objectiveId;
    });
    if (campaigns.length === 0) return { campaigns: 0, totalTasks: 0, doneTasks: 0, inProgress: 0, review: 0, todo: 0, backlog: 0, blocked: 0, overdue: 0, pct: 0, donePct: 0, signal: 'no_campaigns', health: 'neutral', campaignDetails: [] };

    var totalTasks = 0, doneTasks = 0, inProgressTasks = 0, reviewTasks = 0, todoTasks = 0, backlogTasks = 0, blockedTasks = 0, overdueTasks = 0;
    var campaignDetails = [];
    var worstSignal = 'on_track';
    var signalPriority = { blocked: 5, at_risk: 4, stale: 3, not_started: 2, on_track: 1, complete: 0, no_tasks: 1 };

    campaigns.forEach(function (c) {
      var cp = getCampaignProgress(c.id);
      totalTasks += cp.total;
      doneTasks += cp.done;
      inProgressTasks += cp.inProgress;
      reviewTasks += cp.review;
      todoTasks += cp.todo;
      backlogTasks += cp.backlog;
      blockedTasks += cp.blocked;
      overdueTasks += cp.overdue;
      campaignDetails.push({ id: c.id, title: c.title, status: c.status, pct: cp.pct, signal: cp.signal });
      if ((signalPriority[cp.signal] || 0) > (signalPriority[worstSignal] || 0)) {
        worstSignal = cp.signal;
      }
    });

    // Weighted progress across all tasks in all linked campaigns
    var pct = 0;
    var donePct = 0;
    if (totalTasks > 0) {
      var weighted = (doneTasks * 1.0) + (reviewTasks * 0.75) + (inProgressTasks * 0.5) + (todoTasks * 0.25);
      pct = Math.round((weighted / totalTasks) * 100);
      donePct = Math.round((doneTasks / totalTasks) * 100);
    }

    // If all campaigns are complete, goal signal is complete
    var allComplete = campaigns.length > 0 && campaignDetails.every(function (cd) { return cd.signal === 'complete'; });
    if (allComplete) worstSignal = 'complete';

    // Paused campaigns count as at_risk
    var pausedCount = campaigns.filter(function (c) { return c.status === 'paused'; }).length;
    if (pausedCount > 0 && (signalPriority[worstSignal] || 0) < signalPriority['at_risk']) {
      worstSignal = 'at_risk';
    }

    // Health mapping
    var health = 'neutral';
    if (worstSignal === 'complete' || worstSignal === 'on_track') health = 'good';
    else if (worstSignal === 'at_risk' || worstSignal === 'stale') health = 'warn';
    else if (worstSignal === 'blocked') health = 'bad';

    return {
      campaigns: campaigns.length, totalTasks: totalTasks, doneTasks: doneTasks,
      inProgress: inProgressTasks, review: reviewTasks, todo: todoTasks, backlog: backlogTasks,
      blocked: blockedTasks, overdue: overdueTasks, pct: pct, donePct: donePct,
      signal: worstSignal, health: health, campaignDetails: campaignDetails
    };
  }

  function getAllObjectiveProgress() {
    var objectives = getObjectives();
    return objectives.filter(function (o) { return o && !o.deletedAt; }).map(function (o) {
      return { objective: o, progress: getObjectiveProgress(o.id) };
    });
  }

  // ── Governance: Objectives ──
  var OBJECTIVES_KEY = 'ap_objectives';
  function _normalizeObjectiveDirectives(obj) {
    if (!obj) return obj;
    // Normalize to linkedCampaigns as canonical, keep linkedDirectives as alias
    if (!Array.isArray(obj.linkedCampaigns)) {
      if (Array.isArray(obj.linkedDirectives)) {
        obj.linkedCampaigns = obj.linkedDirectives;
      } else if (obj.linkedDirective) {
        obj.linkedCampaigns = [obj.linkedDirective];
      } else {
        obj.linkedCampaigns = [];
      }
    }
    obj.linkedDirectives = obj.linkedCampaigns; // backward compat alias
    return obj;
  }
  function getObjectives() {
    var list = _loadStorage(OBJECTIVES_KEY, []);
    for (var i = 0; i < list.length; i++) { _normalizeObjectiveDirectives(list[i]); }
    return list;
  }
  function addObjective(obj) {
    var list = getObjectives();
    if (!obj.id) obj.id = 'obj-' + Date.now();
    if (!obj.status) obj.status = 'on_track';
    if (!obj.progressPercentage) obj.progressPercentage = 0;
    if (!obj.owner) obj.owner = 'nova';
    if (!obj.linkedTasks) obj.linkedTasks = [];
    _normalizeObjectiveDirectives(obj);
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
        list[i].updatedAt = new Date().toISOString();
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

  // Auto-route design/visual feedback to Pixel when CEO rejects or requests revision
  var _DESIGN_KEYWORDS = /\b(image|hero|visual|design|graphic|photo|picture|thumbnail|banner|logo|layout|branding|square|landscape|portrait|aspect|dimension|resize|format|illustration|icon)\b/i;
  function _autoRouteDesignFeedback(queueItem, note) {
    if (!note || !_DESIGN_KEYWORDS.test(note)) return;
    var tasks = getTasks();
    var actionId = queueItem.action_id || '';
    var itemTitle = queueItem.taskTitle || queueItem.title || 'Untitled';
    // Dedup: skip if active Pixel design-revision task already exists for this action
    var existing = tasks.find(function (t) {
      return t.assignee === 'pixel' && t.status !== 'done' &&
        (t.title || '').indexOf('Design revision') !== -1 &&
        ((t.description || '').indexOf(actionId) !== -1 || (t.title || '').indexOf(itemTitle.substring(0, 30)) !== -1);
    });
    if (existing) return;
    addTask({
      title: 'Design revision: ' + itemTitle.substring(0, 60),
      description: 'CEO flagged a design issue during approval review.\n\n' +
        'CEO feedback: "' + note + '"\n\n' +
        'Action ID: ' + actionId + '\nItem: ' + itemTitle + '\n\n' +
        'Review the CEO feedback and make the requested visual changes. ' +
        'If a hero image needs regeneration, use generate-image with the correct purpose (blog_header for blog posts). ' +
        'If other design work is needed, produce the deliverable accordingly.',
      status: 'todo',
      priority: 'high',
      assignee: 'pixel',
      parent_task_id: queueItem.taskId || null,
      tags: ['design-revision', 'ceo-feedback'],
      source: { type: 'auto:ceo-design-feedback', actionId: actionId }
    });
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
        // Auto-route design feedback to Pixel
        _autoRouteDesignFeedback(queue[i], note);
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
        // Auto-route design feedback to Pixel
        _autoRouteDesignFeedback(queue[i], note);
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

  function getActions() {
    var list = _loadStorage(ACTIONS_KEY, []);
    for (var i = 0; i < list.length; i++) { _syncLegacy(list[i]); }
    return list;
  }
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
    var _appSt = (a.approval && a.approval.status) || '';
    var _exSt = (a.execution && a.execution.status) || '';
    var _isApproved = _appSt === 'approved' || _appSt === 'overridden';
    a.execution_status = (_isApproved && _exSt === 'success') ? 'success'
      : (_isApproved && _exSt === 'failed') ? 'failed'
      : (_exSt === 'running') ? 'running'
      : (_isApproved) ? 'approved'
      : (_appSt === 'rejected') ? 'rejected'
      : (_appSt === 'cancelled') ? 'rejected'
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
      if (a.id === actionId && a.approval && (a.approval.status === 'pending' || a.approval.status === 'revision_requested')) {
        a.approval.status = 'approved';
        a.approval.approved_by = 'Pixelpusher';
        a.approval.approved_at = new Date().toISOString();
        a.approval.decision_note = note || null;
        a.updatedAt = new Date().toISOString();
        // Auto-execute task_completion actions BEFORE _syncLegacy (no external API needed)
        if (a.type === 'task_completion.approve') {
          a.execution = a.execution || {};
          a.execution.status = 'success';
          a.execution.finished_at = new Date().toISOString();
        }
        _syncLegacy(a);
        _saveActions(list);
        // Update approval queue entry
        _updateApprovalQueueForAction(actionId, 'approved');
        // Auto-register artifact when publish_document is approved
        if (a.type === 'publish_document' && a.payload) {
          var docId = a.payload.documentId;
          var artSlug = a.payload.slug || '';
          var artTitle = a.payload.title || artSlug || docId;
          var artUrl = a.payload.public_url || a.payload.target_path || null;
          if (docId) {
            registerArtifact({ id: docId, type: 'article', title: artTitle, slug: artSlug, url: artUrl, status: 'published', publishedAt: new Date().toISOString(), actionId: actionId, documentId: docId, source: a.created_by });
            markArtifactPublished(docId, artUrl);
          }
        }
        // Auto-complete parent task for task_completion (CEO signs off on approval)
        // Social posts: do NOT auto-complete here — task completes after successful EXECUTION
        if (a._parentTaskId && a.type === 'task_completion.approve') {
          var parentTask = getTask(a._parentTaskId);
          if (parentTask && parentTask.status !== 'done') {
            updateTask(a._parentTaskId, { status: 'done' });
            addTaskComment(a._parentTaskId, {
              text: 'Task completed: CEO signed off on deliverable and peer review (' + actionId + ').',
              author: 'system',
              type: 'system'
            });
          }
        }
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
      // Allow reject on pending OR approved (cancel scheduled/approved-but-not-executed)
      if (a.id === actionId && a.approval && (a.approval.status === 'pending' || a.approval.status === 'approved' || a.approval.status === 'revision_requested')) {
        var wasCancelled = a.approval.status === 'approved';
        a.approval.status = wasCancelled ? 'cancelled' : 'rejected';
        a.approval.decision_note = note || null;
        a.updatedAt = new Date().toISOString();
        a.execution.status = 'failed';
        a.execution.finished_at = new Date().toISOString();
        a.execution_status = 'failed';
        _syncLegacy(a);
        _saveActions(list);
        _updateApprovalQueueForAction(actionId, a.approval.status);
        _logAction(wasCancelled ? 'action-cancelled' : 'action-rejected', { actionId: actionId, type: a.type });
        _logGovernance(wasCancelled ? 'ceo-cancel' : 'ceo-reject', { actionId: actionId, type: a.type, context: 'action' });

        // Cascade: close parent task + all child tasks on reject (not cancel)
        if (!wasCancelled && a._parentTaskId) {
          var tasks = getTasks();
          var nowIso = new Date().toISOString();
          var parentTask = tasks.find(function (t) { return t.id === a._parentTaskId; });
          if (parentTask && parentTask.status !== 'done') {
            parentTask.status = 'done';
            parentTask.completedAt = nowIso;
            parentTask.updatedAt = nowIso;
            if (!parentTask.comments) parentTask.comments = [];
            parentTask.comments.push({ id: 'cmt-reject-' + Date.now(), author: 'system', text: 'CEO rejected the linked action — task closed.', type: 'system', createdAt: nowIso });
          }
          tasks.forEach(function (t) {
            if (t.parent_task_id === a._parentTaskId && t.status !== 'done') {
              t.status = 'done';
              t.completedAt = nowIso;
              t.updatedAt = nowIso;
              if (!t.comments) t.comments = [];
              t.comments.push({ id: 'cmt-reject-child-' + Date.now(), author: 'system', text: 'Parent task rejected by CEO — child task closed.', type: 'system', createdAt: nowIso });
            }
          });
          _saveStorage(TASKS_KEY, tasks);
        }

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
      if (a.id === actionId && a.approval && (a.approval.status === 'pending' || a.approval.status === 'revision_requested')) {
        a.approval.status = 'revision_requested';
        a.approval.decision_note = note || null;
        a.updatedAt = new Date().toISOString();
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

  // Async version — awaits server confirmation before resolving
  function requestActionRevisionAsync(actionId, note) {
    var a = requestActionRevision(actionId, note);
    if (!a) return Promise.resolve(null);
    // Explicitly push actions + approvalQueue to server and wait for both
    if (typeof CompanyStore !== 'undefined' && CompanyStore.isServerAvailable && CompanyStore.isServerAvailable()) {
      var actions = getActions();
      var queue = getApprovalQueue();
      return Promise.all([
        CompanyStore.setState(ACTIONS_KEY, actions),
        CompanyStore.setState(APPROVAL_KEY, queue)
      ]).then(function () { return a; })
        .catch(function (err) { console.warn('[AgentEngine] Revision server sync failed:', err); return a; });
    }
    return Promise.resolve(a);
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
        a.updatedAt = new Date().toISOString();
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

  // Reconcile standup/meeting proposals: activate pending tasks+directives, link tasks to directives
  function reconcileProposals() {
    var fixed = { activatedTasks: 0, activatedDirs: 0, linkedTasks: 0 };

    // 1) Activate pending-approval standup/meeting tasks → todo
    var tasks = getTasks();
    tasks.forEach(function (t) {
      if (t.status === 'pending-approval' && t.tags && (t.tags.indexOf('standup-proposal') !== -1 || t.tags.indexOf('meeting-proposal') !== -1)) {
        updateTask(t.id, { status: 'todo' });
        fixed.activatedTasks++;
      }
    });

    // 2) Activate pending-approval directives → active
    var directives = getDirectives();
    directives.forEach(function (d) {
      if (d.status === 'pending-approval') {
        updateDirective(d.id, {
          status: 'active',
          approval: { status: 'approved', approvedBy: 'ceo', approvedAt: new Date().toISOString() }
        });
        fixed.activatedDirs++;
      }
    });

    // 3) Link orphan tasks to best-matching active directive by title similarity
    var activeDirs = getDirectives().filter(function (d) { return d.status === 'active'; });
    if (activeDirs.length > 0) {
      getTasks().forEach(function (t) {
        if (t.directive_id || t.status === 'done') return;
        var bestDir = null;
        var bestScore = 0;
        activeDirs.forEach(function (dir) {
          var score = _stringSimilarity(t.title.toLowerCase(), dir.title.toLowerCase());
          var descScore = _stringSimilarity((t.description || '').toLowerCase(), dir.title.toLowerCase());
          var combined = Math.max(score, descScore);
          if (combined > bestScore) { bestScore = combined; bestDir = dir; }
        });
        if (bestDir && bestScore >= 0.2) {
          updateTask(t.id, { directive_id: bestDir.id });
          fixed.linkedTasks++;
        }
      });
    }

    if (fixed.activatedTasks || fixed.activatedDirs || fixed.linkedTasks) {
      console.log('[AgentEngine] reconcileProposals:', fixed);
    }
    return fixed;
  }

  // Reconcile artifact registry from approved publish_document actions
  // Also recover failed actions that have valid receipts (e.g. RUN_STUCK with receipt)
  function reconcileArtifacts() {
    var list = _loadStorage(ACTIONS_KEY, []);
    var registered = 0;
    var recovered = 0;
    var changed = false;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      // Register artifacts from approved publish_document actions
      if (a.type === 'publish_document' && a.approval && (a.approval.status === 'approved' || a.approval.status === 'overridden') && a.payload && a.payload.documentId) {
        var existing = getArtifactById(a.payload.documentId);
        if (!existing) {
          registerArtifact({
            id: a.payload.documentId,
            type: 'article',
            title: a.payload.title || a.payload.slug || a.payload.documentId,
            slug: a.payload.slug || '',
            url: a.payload.public_url || a.payload.target_path || null,
            status: 'published',
            publishedAt: a.approval.approved_at || new Date().toISOString(),
            actionId: a.id,
            documentId: a.payload.documentId,
            source: a.created_by
          });
          registered++;
        }
      }
      // Recover failed or stuck-running actions that have a valid receipt
      if (a.execution && (a.execution.status === 'failed' || a.execution.status === 'running') && a.execution.receipt) {
        var r = a.execution.receipt;
        if (r.post_id || r.post_url || r.public_url) {
          a.execution.status = 'success';
          a.execution.finished_at = a.execution.finished_at || r.published_at || new Date().toISOString();
          a.execution.last_error = null;
          changed = true;
          recovered++;
        }
      }
      // Unstick running actions with no receipt that have been running >30 min
      if (a.execution && a.execution.status === 'running' && a.execution.started_at && !a.execution.receipt) {
        var runAge = Date.now() - new Date(a.execution.started_at).getTime();
        if (runAge > 30 * 60 * 1000) {
          a.execution.status = 'failed';
          a.execution.finished_at = new Date().toISOString();
          a.execution.last_error = { code: 'RUN_STUCK', message: 'Stuck running for ' + Math.round(runAge / 60000) + ' minutes — auto-reset' };
          changed = true;
          recovered++;
        }
      }
    }
    if (changed) _saveStorage(ACTIONS_KEY, list);
    if (registered > 0 || recovered > 0) console.log('[AgentEngine] reconcileArtifacts:', registered, 'artifacts registered,', recovered, 'failed actions recovered via receipt');
    return registered + recovered;
  }

  // Reconcile approvalQueue against actions store — remove orphans, sync status, backfill missing
  function reconcileApprovalQueue() {
    var queue = getApprovalQueue();
    var actions = getActions();
    var actionMap = {};
    for (var i = 0; i < actions.length; i++) actionMap[actions[i].id] = actions[i];
    var changed = false;
    var cleaned = 0;
    var backfilled = 0;

    // 1. Clean orphans and sync status
    var queueActionIds = {};
    for (var j = queue.length - 1; j >= 0; j--) {
      var entry = queue[j];
      if (entry.kind !== 'action' || !entry.action_id) continue;
      queueActionIds[entry.action_id] = true;
      var action = actionMap[entry.action_id];
      if (!action) {
        // Orphan: approvalQueue entry with no matching action — remove it
        queue.splice(j, 1);
        changed = true;
        cleaned++;
        continue;
      }
      // Sync status if mismatched
      var actionApprovalStatus = (action.approval && action.approval.status) || 'pending';
      if (entry.status === 'pending' && actionApprovalStatus !== 'pending') {
        entry.status = actionApprovalStatus;
        changed = true;
        cleaned++;
      }
    }

    // 2. Backfill: create approvalQueue entries for pending actions missing from queue
    for (var k = 0; k < actions.length; k++) {
      var act = actions[k];
      var approvalStatus = (act.approval && act.approval.status) || '';
      if ((approvalStatus === 'pending' || approvalStatus === 'revision_requested') && !queueActionIds[act.id]) {
        queue.push({
          id: 'aq-' + act.id,
          kind: 'action',
          action_id: act.id,
          actionType: act.type || 'unknown',
          taskTitle: (act.payload && (act.payload.text || act.payload.title || '').substring(0, 100)) || act.type || 'Action',
          originAgent: act.created_by || 'unknown',
          status: 'pending',
          submittedAt: (act.approval && act.approval.submitted_at) || act.created_at || new Date().toISOString(),
          classification: act.classification || 'advisory',
          risk_level: act.risk_level || 'medium'
        });
        changed = true;
        backfilled++;
      }
    }

    if (changed) {
      if (queue.length > 100) queue.splice(0, queue.length - 100);
      _saveStorage(APPROVAL_KEY, queue);
      console.log('[AgentEngine] Reconciled approvalQueue: cleaned ' + cleaned + ', backfilled ' + backfilled);
    }
    return cleaned + backfilled;
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
        // Auto-complete parent task after successful social post execution
        if (a._parentTaskId && (a.type === 'social_post.publish' || a.type === 'social_post.schedule')) {
          var parentTask = getTask(a._parentTaskId);
          if (parentTask && parentTask.status !== 'done') {
            updateTask(a._parentTaskId, { status: 'done' });
            addTaskComment(a._parentTaskId, {
              text: 'Task auto-completed: social post published successfully (' + actionId + ').',
              author: 'system',
              type: 'system'
            });
          }
        }
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

  // Autonomy Score — 6-signal composite, 7-day rolling window
  // Measures: throughput, delegation, completion, escalation, CEO trust, agent learning
  function getAutonomyScore() {
    var now = Date.now();
    var cutoff = new Date(now - 7 * 86400000).toISOString();
    function inWindow(d) { return d && d >= cutoff; }

    var tasks = getTasks();
    var recentTasks = tasks.filter(function (t) { return inWindow(t.updatedAt || t.createdAt); });
    var tasksTotal = recentTasks.length;

    // 1) Task Throughput (25%): tasks moved to done by agents / total tasks
    var doneTasks = recentTasks.filter(function (t) { return t.status === 'done'; });
    var agentDone = doneTasks.filter(function (t) {
      return t.assignee && t.assignee !== 'ceo' && t.assignee !== 'pixelpusher';
    }).length;
    var throughputScore = tasksTotal > 0 ? agentDone / Math.max(tasksTotal, 1) : 0;

    // 2) Delegation (20%): tasks assigned by agents (not CEO)
    var delegated = recentTasks.filter(function (t) {
      return t.assignee && t.source && t.source !== 'ceo' && (typeof t.source !== 'object' || t.source.type !== 'ceo');
    }).length;
    var delegationScore = tasksTotal > 0 ? delegated / tasksTotal : 0;

    // 3) Completion (15%): done tasks without CEO intervention
    var doneAuto = doneTasks.filter(function (t) {
      return !t.escalated && !t.requires_ceo_approval;
    }).length;
    var completionScore = doneTasks.length > 0 ? doneAuto / doneTasks.length : 0;

    // 4) Escalation (15%): tasks NOT escalated / total tasks (inverse = good)
    var notEscalated = recentTasks.filter(function (t) {
      return !t.escalated && !t.requires_ceo_approval;
    }).length;
    var escalationScore = tasksTotal > 0 ? notEscalated / tasksTotal : 0;

    // 5) Approval Rate (10%): CEO-approved actions / total decided actions
    var actions = getActions();
    var recentActions = actions.filter(function (a) { return inWindow(a.created_at || a.createdAt); });
    var decided = recentActions.filter(function (a) {
      return a.approval && (a.approval.status === 'approved' || a.approval.status === 'rejected' || a.approval.status === 'revision_requested');
    });
    var approved = decided.filter(function (a) { return a.approval.status === 'approved'; }).length;
    var approvalScore = decided.length > 0 ? approved / decided.length : 0;

    // 6) Memory Growth (15%): runtime memories accumulated / theoretical max
    var AGENTS_COUNT = 8; // nova, cipher, pixel, forge, echo, scribe, quill, scout
    var MAX_MEMORIES_PER_AGENT = 20;
    var maxMemories = AGENTS_COUNT * MAX_MEMORIES_PER_AGENT; // 160
    var totalMemories = 0;
    var agentMemories = _loadStorage('ap_agent_memories', {});
    if (agentMemories && typeof agentMemories === 'object' && !Array.isArray(agentMemories)) {
      Object.keys(agentMemories).forEach(function (k) {
        if (Array.isArray(agentMemories[k])) totalMemories += agentMemories[k].length;
      });
    }
    var memoryScore = Math.min(totalMemories / maxMemories, 1);

    // Composite
    var composite = (throughputScore * 0.25) + (delegationScore * 0.20) + (completionScore * 0.15) +
                    (escalationScore * 0.15) + (approvalScore * 0.10) + (memoryScore * 0.15);
    var score = Math.round(composite * 100);
    var total = tasksTotal + recentActions.length;

    return {
      score: score, total: total,
      breakdown: {
        throughput: { score: Math.round(throughputScore * 100), count: agentDone, total: tasksTotal, weight: '25%' },
        delegation: { score: Math.round(delegationScore * 100), count: delegated, total: tasksTotal, weight: '20%' },
        completion: { score: Math.round(completionScore * 100), count: doneAuto, total: doneTasks.length, weight: '15%' },
        escalation: { score: Math.round(escalationScore * 100), count: notEscalated, total: tasksTotal, weight: '15%' },
        approval: { score: Math.round(approvalScore * 100), count: approved, total: decided.length, weight: '10%' },
        memory: { score: Math.round(memoryScore * 100), count: totalMemories, total: maxMemories, weight: '15%' }
      },
      window: '7d'
    };
  }

  // Risk Heatmap — derives risk from multiple real signals
  function getRiskHeatmap() {
    var tasks = getTasks();
    var objectives = getObjectives();
    var directives = getDirectives();
    var actions = getActions();
    var govLog = getGovernanceLog();
    var today = new Date().toISOString().split('T')[0];
    var now = Date.now();
    var weekAgo = now - (7 * 86400000);

    // Overdue tasks (not done)
    var overdueTasks = tasks.filter(function (t) {
      return t.status !== 'done' && t.dueDate && t.dueDate.substring(0, 10) < today;
    });

    // High-priority tasks stuck in backlog
    var stuckHighPrio = tasks.filter(function (t) {
      return (t.priority === 'high' || t.priority === 'critical') && t.status === 'backlog';
    });

    // Blocked tasks
    var blockedTasks = tasks.filter(function (t) {
      return t.blocked && t.status !== 'done';
    });

    // At-risk or behind objectives
    var atRiskObjectives = objectives.filter(function (o) {
      return o.status === 'at_risk' || o.status === 'behind';
    });

    // At-risk campaigns (from progress tracker)
    var atRiskCampaigns = directives.filter(function (d) {
      if (d.status !== 'active') return false;
      var p = getCampaignProgress(d.id);
      return p.signal === 'at_risk' || p.signal === 'blocked' || p.signal === 'stale';
    });
    var atRiskDirectives = atRiskCampaigns; // backward compat alias

    // Failed actions (last 7 days)
    var failedActions = actions.filter(function (a) {
      return a.execution_status === 'failed' && a.created_at && new Date(a.created_at).getTime() > weekAgo;
    });

    // Escalations (last 7 days)
    var recentEscalations = govLog.filter(function (e) {
      return e.type === 'escalation' && new Date(e.timestamp).getTime() > weekAgo;
    });

    // Explicit high/medium risk tasks (original fields)
    var explicitHigh = tasks.filter(function (t) { return t.risk_level === 'high' && t.status !== 'done'; });
    var explicitMed = tasks.filter(function (t) { return t.risk_level === 'medium' && t.status !== 'done'; });

    return {
      overdueTasks: overdueTasks,
      stuckHighPrio: stuckHighPrio,
      blockedTasks: blockedTasks,
      atRiskObjectives: atRiskObjectives,
      atRiskCampaigns: atRiskCampaigns,
      atRiskDirectives: atRiskDirectives, // backward compat alias
      failedActions: failedActions,
      escalationFrequency: recentEscalations.length,
      highRiskTasks: explicitHigh,
      medRiskTasks: explicitMed
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

  // ── Artifact Registry (v2.4.4) ──
  var ARTIFACTS_KEY = 'ap_artifacts';

  function getArtifacts() { return _loadStorage(ARTIFACTS_KEY, []); }
  function _saveArtifacts(list) { _saveStorage(ARTIFACTS_KEY, list); }

  function registerArtifact(artifact) {
    if (!artifact || !artifact.id || !artifact.type) return null;
    var list = getArtifacts();
    // Dedup by id
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === artifact.id) return list[i]; // already registered
    }
    var record = {
      id: artifact.id,
      type: artifact.type || 'article',
      title: artifact.title || '',
      slug: artifact.slug || '',
      url: artifact.url || null,
      status: artifact.status || 'draft',
      createdAt: artifact.createdAt || new Date().toISOString(),
      publishedAt: artifact.publishedAt || null,
      source: artifact.source || null,
      actionId: artifact.actionId || null,
      documentId: artifact.documentId || null
    };
    list.push(record);
    if (list.length > 200) list = list.slice(-200);
    _saveArtifacts(list);
    return record;
  }

  function markArtifactPublished(artifactId, url) {
    var list = getArtifacts();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === artifactId) {
        list[i].status = 'published';
        list[i].url = url || list[i].url;
        list[i].publishedAt = new Date().toISOString();
        _saveArtifacts(list);
        return list[i];
      }
    }
    return null;
  }

  function getArtifactById(id) {
    var list = getArtifacts();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function findArtifactBySlug(type, slug) {
    var list = getArtifacts();
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === type && list[i].slug === slug) return list[i];
    }
    return null;
  }

  function findArtifactByActionId(actionId) {
    var list = getArtifacts();
    for (var i = 0; i < list.length; i++) {
      if (list[i].actionId === actionId) return list[i];
    }
    return null;
  }

  function resolveArtifactUrl(ref) {
    if (!ref) return null;
    // ref can be { type: "artifact", id: "art_..." } or just an id string
    var id = (typeof ref === 'object') ? ref.id : ref;
    var art = getArtifactById(id);
    if (!art) return null;
    if (art.status === 'published' && art.url) {
      // Ensure full absolute URL — artifact.url may be stored as relative path
      var url = art.url;
      if (url.charAt(0) === '/' && url.indexOf('//') !== 0) {
        url = 'https://ambientpixels.ai' + url;
      }
      return url;
    }
    return null; // not yet published
  }

  // Resolve all {{ARTICLE_URL}} tokens in an action's payload.text
  function resolveActionTokens(action) {
    if (!action || !action.payload || !action.payload.text) return { resolved: true, text: (action && action.payload) ? action.payload.text : '', missing: [] };
    var text = action.payload.text;
    var tokens = action.tokens || {};
    var missing = [];

    // Replace {{ARTICLE_URL}} or {{ARTICLE_URL:art_...}}
    text = text.replace(/\{\{ARTICLE_URL(?::([^}]+))?\}\}/g, function (match, explicitId) {
      var ref = null;
      if (explicitId) {
        ref = { type: 'artifact', id: explicitId.trim() };
      } else if (tokens.ARTICLE_URL) {
        ref = tokens.ARTICLE_URL;
      }
      if (!ref) { missing.push({ token: 'ARTICLE_URL', reason: 'No artifact reference found' }); return match; }
      var url = resolveArtifactUrl(ref);
      if (!url) { missing.push({ token: 'ARTICLE_URL', artifactId: ref.id, reason: 'Article not yet published' }); return match; }
      return url;
    });

    return { resolved: missing.length === 0, text: text, missing: missing };
  }

  // Check if action dependencies are satisfied
  function checkActionDependencies(action) {
    if (!action) return { ready: true, blockedReason: null };
    var deps = action.dependsOn || [];
    var tokens = action.tokens || {};
    var issues = [];

    var pendingArtifacts = [];

    // Check explicit dependsOn
    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      if (dep.type === 'artifact') {
        var art = getArtifactById(dep.id);
        if (!art) {
          issues.push('Required article not yet created — publish the blog post first');
        } else if (art.status !== 'published') {
          var artTitle = art.title || art.slug || dep.id;
          issues.push('Publish "' + artTitle + '" first');
          pendingArtifacts.push({ id: dep.id, title: artTitle, status: art.status });
        }
      }
    }

    // Check tokens that reference artifacts
    var tokenKeys = Object.keys(tokens);
    for (var j = 0; j < tokenKeys.length; j++) {
      var tk = tokens[tokenKeys[j]];
      if (tk && tk.type === 'artifact') {
        var tArt = getArtifactById(tk.id);
        if (!tArt) {
          if (!issues.length) issues.push('Required article not yet created — publish the blog post first');
        } else if (tArt.status !== 'published') {
          var tTitle = tArt.title || tArt.slug || tk.id;
          if (!pendingArtifacts.some(function (p) { return p.id === tk.id; })) {
            issues.push('Publish "' + tTitle + '" first');
            pendingArtifacts.push({ id: tk.id, title: tTitle, status: tArt.status });
          }
        }
      }
    }

    // Also check for unresolved {{ARTICLE_URL}} in text (skip publish_document — it IS the article)
    var _actionType = action.type || action.action_type || '';
    if (issues.length === 0 && _actionType !== 'publish_document' && action.payload && action.payload.text && /\{\{ARTICLE_URL/.test(action.payload.text)) {
      var resolution = resolveActionTokens(action);
      if (!resolution.resolved) {
        resolution.missing.forEach(function (m) {
          issues.push('Article URL not available yet — publish the linked blog post first');
        });
      }
    }

    if (issues.length === 0) return { ready: true, blockedReason: null, pendingArtifacts: [] };
    return { ready: false, blockedReason: issues.join('; '), pendingArtifacts: pendingArtifacts };
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
    getStandupById: getStandupById,
    updateStandupDecision: updateStandupDecision,
    createProposalsAsPending: createProposalsAsPending,
    approveAndActivate: approveAndActivate,
    decideStandupProposal: decideStandupProposal,
    getStandupTopicKeys: getStandupTopicKeys,
    buildPreview: buildPreview,
    STANDUP_TYPES: STANDUP_TYPES,
    DECISION_STATUSES: DECISION_STATUSES,
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
    getDoctrineWeight: getDoctrineWeight,
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
    getTaskById: getTaskById,
    getTasksByStatus: getTasksByStatus,
    getTasksByAssignee: getTasksByAssignee,
    getTaskStats: getTaskStats,
    // Campaigns
    getCampaigns: getCampaigns,
    addCampaign: addCampaign,
    updateCampaign: updateCampaign,
    archiveCampaign: archiveCampaign,
    unarchiveCampaign: unarchiveCampaign,
    deleteCampaign: deleteCampaign,
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
    deleteDirective: deleteDirective,
    getDirectiveProgress: getDirectiveProgress,
    getAllDirectiveProgress: getAllDirectiveProgress,
    getCampaignProgress: getCampaignProgress,
    getAllCampaignProgress: getAllCampaignProgress,
    getObjectives: getObjectives,
    addObjective: addObjective,
    updateObjective: updateObjective,
    getObjectiveProgress: getObjectiveProgress,
    getAllObjectiveProgress: getAllObjectiveProgress,
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
    requestActionRevisionAsync: requestActionRevisionAsync,
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
    getRiskHeatmap: getRiskHeatmap,
    // v2.5
    getKpiRegistry: getKpiRegistry,
    getDirectiveKpiIndex: getDirectiveKpiIndex,
    getQuarterRange: getQuarterRange,
    getBoardPacket: getBoardPacket,
    // v2.6 Meetings
    getMeetings: getMeetings,
    getLatestMeeting: getLatestMeeting,
    getMeetingById: getMeetingById,
    isMeetingRunning: isMeetingRunning,
    runMeeting: runMeeting,
    updateMeetingDecision: updateMeetingDecision,
    createMeetingProposals: createMeetingProposals,
    approveAndActivateMeeting: approveAndActivateMeeting,
    decideMeetingProposal: decideMeetingProposal,
    getMeetingTopicKeys: getMeetingTopicKeys,
    // v2.4.4 Artifact Registry
    getArtifacts: getArtifacts,
    registerArtifact: registerArtifact,
    markArtifactPublished: markArtifactPublished,
    getArtifactById: getArtifactById,
    findArtifactBySlug: findArtifactBySlug,
    findArtifactByActionId: findArtifactByActionId,
    resolveArtifactUrl: resolveArtifactUrl,
    resolveActionTokens: resolveActionTokens,
    checkActionDependencies: checkActionDependencies,
    reconcileApprovalQueue: reconcileApprovalQueue,
    reconcileProposals: reconcileProposals,
    reconcileArtifacts: reconcileArtifacts
  };
})();
